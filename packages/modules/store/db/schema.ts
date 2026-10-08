import { tenantIsolationPolicy } from '@rede-social/core/db/rls';
import { mediaAssets, tenants, users } from '@rede-social/core/db/schema';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/**
 * The store module's tables (08.2, STORE-01..21; RESEARCH §Entitlement Storage, Option B):
 * `store_products`, the products a tenant admin sells; `store_product_communities`, which product
 * opens which community; `store_orders`, one row per purchase; `store_entitlements`, who holds which
 * product. The community gate (`app.community_locked_ids*`, the kernel seam) is computed from these
 * tables once per statement, so nothing is derived and nothing drifts.
 *
 * FOUR THINGS A REVIEWER MUST NOT "FIX":
 *
 * 1. **`store_orders` and `store_entitlements` have a SELECT policy and NO write policy** (STORE-20,
 *    T-08.2-03; the `memberships` precedent): a `FOR ALL` policy would let a member lane grant itself
 *    access. Every write goes through a SECURITY DEFINER function (`app.store_purchase`, later grant
 *    and revoke) that pins `tenant_id = app.tenant_id()` and `user_id = app.user_id()` itself.
 * 2. **`price_cents` on the product is the ONLY price** (D-361). The order copies it into
 *    `amount_cents` at purchase time inside `app.store_purchase`; the client only sends a staleness
 *    check (`expectedAmountCents`), never the amount to charge.
 * 3. **The two partial unique indexes are the arbiters** (T-08.2-05): `store_orders_live_uq` (one
 *    pending or paid order per member and product) and `store_entitlements_active_uq` (one active
 *    entitlement). `app.store_purchase` inserts with `on conflict … do nothing` against them.
 * 4. **`store_product_communities.community_id` has NO drizzle reference.** Its foreign key to
 *    `communities` is hand SQL in `*_store_functions.sql` (MOD-02: the store does not import the
 *    communities schema; the `feed_communities` precedent).
 *
 * Archiving a product touches neither links nor entitlements: a community whose only product is
 * archived stays locked for non-holders and open for holders (RESEARCH Assumption A4).
 *
 * Owned by `packages/modules/store` and picked up by `apps/api/drizzle.config.ts`'s module glob.
 */
export const storeProducts = pgTable(
  'store_products',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Generic authorship (SCHEMA-CONVENTIONS §(c).1). Stored for auditing, never projected. */
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    name: text().notNull(),
    /** `''` rather than NULL: "no description" is ONE value. */
    description: text().notNull().default(''),
    /** NULLABLE (D-69): an image-less product renders the brand gradient. A `cover` asset. */
    imageAssetId: uuid('image_asset_id').references(() => mediaAssets.id),
    /** Integer cents (STORE-02); mirrored by `STORE_MAX_PRICE_CENTS` in `@rede-social/contracts/money`. */
    priceCents: integer('price_cents').notNull(),
    currency: text().notNull().default('BRL'),
    /** `'active' | 'archived'`: a status column with a CHECK, never a boolean (§(d).1). */
    status: text().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The catalogue, newest first. `.nullsFirst()` matches SQL's `order by x desc` (04-03's lesson).
    index('store_products_tenant_created_idx').on(
      t.tenantId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    check('store_products_price_chk', sql`${t.priceCents} between 0 and 10000000`),
    check('store_products_currency_chk', sql`${t.currency} in ('BRL')`),
    check('store_products_status_chk', sql`${t.status} in ('active','archived')`),
    // Who may WRITE a product is `requirePermission('store.product.manage')`, the communities posture.
    tenantIsolationPolicy('store_products_tenant_isolation'),
  ],
).enableRLS();

/** Which product opens which community. Many to many: a community may be opened by several products. */
export const storeProductCommunities = pgTable(
  'store_product_communities',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => storeProducts.id, { onDelete: 'cascade' }),
    /** FK to `communities(id) on delete cascade` is hand SQL (fact 4 above). */
    communityId: uuid('community_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('store_product_communities_uq').on(t.tenantId, t.productId, t.communityId),
    // The gate's lookup: "the products linked to this community".
    index('store_product_communities_tenant_community_idx').on(t.tenantId, t.communityId),
    tenantIsolationPolicy('store_product_communities_tenant_isolation'),
  ],
).enableRLS();

/**
 * The ONE read predicate of both ledgers: this tenant, and the caller's own rows, or every row of the
 * tenant for an `admin_tenant` claim. Read-only by design (fact 1).
 */
const OWN_OR_ADMIN = sql`tenant_id = app.tenant_id() and (user_id = app.user_id() or app.tenant_role() = 'admin_tenant')`;

/**
 * One purchase. `amount_cents` and `currency` are a SNAPSHOT of the product at purchase time (D-361):
 * a later price edit changes only NEW orders. `provider` is `'none'` until a gateway exists; the
 * status vocabulary is what that gateway will plug into (ROADMAP 08.2 SC 3).
 */
export const storeOrders = pgTable(
  'store_orders',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => storeProducts.id),
    status: text().notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text().notNull(),
    provider: text().notNull().default('none'),
    providerRef: text('provider_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: uuid('revoked_by_user_id').references(() => users.id),
  },
  (t) => [
    // THE order arbiter (fact 3): one live order per member and product. A revoked order frees it, so
    // a re-purchase after a revoke is a NEW order and history is kept.
    uniqueIndex('store_orders_live_uq')
      .on(t.tenantId, t.userId, t.productId)
      .where(sql`status in ('pending','paid')`),
    index('store_orders_tenant_user_idx').on(t.tenantId, t.userId),
    check('store_orders_status_chk', sql`${t.status} in ('pending','paid','revoked')`),
    check('store_orders_amount_chk', sql`${t.amountCents} >= 0`),
    check('store_orders_currency_chk', sql`${t.currency} in ('BRL')`),
    check('store_orders_provider_chk', sql`${t.provider} in ('none')`),
    // Fact 1: read-only from every tenant lane. No insert, update or delete policy.
    pgPolicy('store_orders_select_own_or_admin', {
      for: 'select',
      to: authenticatedRole,
      using: OWN_OR_ADMIN,
    }),
  ],
).enableRLS();

/**
 * Who holds which product: from a purchase (`order_id` set) or an admin grant (`granted_by_user_id`
 * set), exactly one of the two (the two CHECKs). Only `status = 'active'` opens a community.
 * `expires_at` is never set in 08.2; it is room for expiring access later.
 */
export const storeEntitlements = pgTable(
  'store_entitlements',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => storeProducts.id),
    source: text().notNull(),
    orderId: uuid('order_id').references(() => storeOrders.id),
    grantedByUserId: uuid('granted_by_user_id').references(() => users.id),
    status: text().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: uuid('revoked_by_user_id').references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    // THE access arbiter (fact 3): at most one active entitlement per member and product.
    uniqueIndex('store_entitlements_active_uq')
      .on(t.tenantId, t.userId, t.productId)
      .where(sql`status = 'active'`),
    // The gate's lookup: "does this user hold an active entitlement".
    index('store_entitlements_tenant_user_status_idx').on(t.tenantId, t.userId, t.status),
    // The buyers list of one product, newest first.
    index('store_entitlements_tenant_product_created_idx').on(
      t.tenantId,
      t.productId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    check('store_entitlements_source_chk', sql`${t.source} in ('purchase','grant')`),
    check('store_entitlements_status_chk', sql`${t.status} in ('active','revoked')`),
    check(
      'store_entitlements_source_order_chk',
      sql`(${t.source} = 'purchase') = (${t.orderId} is not null)`,
    ),
    check(
      'store_entitlements_source_grant_chk',
      sql`(${t.source} = 'grant') = (${t.grantedByUserId} is not null)`,
    ),
    // Fact 1: read-only from every tenant lane. No insert, update or delete policy.
    pgPolicy('store_entitlements_select_own_or_admin', {
      for: 'select',
      to: authenticatedRole,
      using: OWN_OR_ADMIN,
    }),
  ],
).enableRLS();
