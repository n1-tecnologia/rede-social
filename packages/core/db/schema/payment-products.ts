import { PAYMENT_PRODUCT_KINDS } from '@rede-social/contracts/payments';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
import { tenants } from './tenants';

/** This tenant's rows, and only for the `admin_tenant` claim: read AND write (planning decision 7). */
const TENANT_ADMIN = sql`tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant'`;

const kindList = sql.raw(PAYMENT_PRODUCT_KINDS.map((kind) => `'${kind}'`).join(','));

/**
 * Phase 09.1-05 (D-488, PAY-01): the GLOBAL map from a gateway's product id to exactly one tenant and
 * exactly one kind. `access` is the platform door (D-485, level one: a tenant may register several,
 * D-494, each with a name and an optional checkout link for the Assinar button); `store_product` is a
 * store product bought through the gateway (level two), whose `target_id` is the store product.
 *
 * It is NOT a column on `store_products`: access products have no store row, and the store stays free
 * of gateway knowledge (it asks the kernel seam functions `app.payments_gateway_mode()` and
 * `app.payments_checkout_url()` by name). So `target_id` has NO Drizzle reference: its foreign key to
 * `store_products(id)` is hand SQL in plan 06 (MOD-02: the kernel does not import a module's schema).
 *
 * THE UNIQUE INDEX IS GLOBAL, ON PURPOSE: `unique (provider, external_product_id)` means a gateway
 * product can never mean two things, and the webhook resolves tenant and kind with one lookup. A
 * second tenant that registers the same id hits it (SQLSTATE 23505); plan 09 turns that into
 * `gateway_product_taken` WITHOUT naming the first tenant or the constraint (P2). The second partial
 * unique index, `(tenant_id, target_id) where kind = 'store_product'`, makes a store product carry at
 * most one mapping. The database, not the route, is the arbiter of both (P1).
 *
 * The product id is stored TRIMMED, 1 to 128 characters, and compared EXACTLY, case-sensitive: `Abc`
 * and `abc` are two ids (P69). A name is required for `access` and absent for `store_product` (the
 * store product already has one); the checkout link, when present, is `https:` with no space.
 *
 * READ AND WRITE are the `admin_tenant` claim only, on this tenant's rows: a gateway product id is
 * admin information, and a member lane that could read the table would learn what the tenant sells and
 * where (the store's `TENANT_ADMIN` predicate applied to SELECT as well). Plan 09's service uses
 * `withTenantTx` for it, which is defence in depth over an explicit predicate. There is no policy for
 * any other role, and the custom migration revokes `truncate` (RLS does not see TRUNCATE).
 */
export const paymentProducts = pgTable(
  'payment_products',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** A FORMAT, never an enum (D-486). */
    provider: text().notNull(),
    /** `access` | `store_product`. */
    kind: text().notNull(),
    /** Access products only: what the admin calls it. Null for a store product. */
    name: text(),
    externalProductId: text('external_product_id').notNull(),
    /** The gateway's checkout page: feeds "Assinar" / "Regularizar" / "Comprar". `https:` only. */
    checkoutUrl: text('checkout_url'),
    /** Store products only: the `store_products.id`. FK is hand SQL in plan 06. */
    targetId: uuid('target_id'),
    /** The admin who registered it. No foreign key, on purpose: a deleted account must not block history. */
    createdByUserId: uuid('created_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('payment_products_provider_chk', sql`${t.provider} ~ '^[a-z][a-z0-9_]{1,30}$'`),
    check('payment_products_kind_chk', sql`${t.kind} in (${kindList})`),
    check(
      'payment_products_ext_id_chk',
      sql`${t.externalProductId} = btrim(${t.externalProductId}) and length(${t.externalProductId}) between 1 and 128`,
    ),
    check(
      'payment_products_name_chk',
      sql`(${t.kind} = 'access') = (${t.name} is not null) and (${t.name} is null or (${t.name} = btrim(${t.name}) and length(${t.name}) between 1 and 80))`,
    ),
    check(
      'payment_products_target_chk',
      sql`(${t.kind} = 'store_product') = (${t.targetId} is not null)`,
    ),
    check(
      'payment_products_url_chk',
      sql`${t.checkoutUrl} is null or (${t.checkoutUrl} ~ '^https://[^[:space:]]+$' and length(${t.checkoutUrl}) <= 2048)`,
    ),
    // GLOBAL: one gateway product, one meaning (D-488).
    uniqueIndex('payment_products_provider_ext_uq').on(t.provider, t.externalProductId),
    // A store product carries at most one mapping.
    uniqueIndex('payment_products_target_uq')
      .on(t.tenantId, t.targetId)
      .where(sql`${t.kind} = 'store_product'`),
    // The Pagamentos list: this tenant's mappings of one kind, oldest first.
    index('payment_products_tenant_kind_idx').on(t.tenantId, t.kind, t.createdAt, t.id),
    pgPolicy('payment_products_select_admin', {
      for: 'select',
      to: authenticatedRole,
      using: TENANT_ADMIN,
    }),
    pgPolicy('payment_products_insert_admin', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: TENANT_ADMIN,
    }),
    pgPolicy('payment_products_update_admin', {
      for: 'update',
      to: authenticatedRole,
      using: TENANT_ADMIN,
      withCheck: TENANT_ADMIN,
    }),
    pgPolicy('payment_products_delete_admin', {
      for: 'delete',
      to: authenticatedRole,
      using: TENANT_ADMIN,
    }),
  ],
).enableRLS();
