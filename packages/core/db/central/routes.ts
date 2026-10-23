import { sql } from 'drizzle-orm';
import { check, index, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '../schema/tenants';
import { platform } from './projects';

/**
 * Phase 09.2-10 (D-486, D-488, D-538): the ROUTE INDEXES. Three small central tables that answer "which tenant
 * does this id belong to?" for the three kinds of request that arrive WITHOUT a tenant host: a payment
 * gateway delivery (it names an integration), a gateway product mapping (it names an external product id) and
 * a Mux delivery (it names a video asset). With the tenant known, the tenant's project follows from
 * `platform.tenant_projects`; without the index there is no database to open.
 *
 * Central set only; RLS on, ZERO policies (see `projects.ts`): only `service_role` through the platform lane
 * reads or writes them. They hold ids and a provider name, nothing else: no token, no e-mail, no payload
 * (PR-9). Authenticity is NEVER decided here (the gateway token's signature and Mux's HMAC do that); the
 * index only decides where a genuine delivery is recorded.
 *
 * WRITTEN FIRST (reserve-then-write): the central row is inserted BEFORE the tenant row it points at. A route
 * whose tenant write then fails is an orphan that answers 404 harmlessly (the tenant read finds nothing) and
 * the writer removes it again; the opposite order would leave a tenant row no delivery could ever find.
 *
 * Every row carries the tenant with a cascading foreign key, so deleting a tenant removes its routes.
 */

/** A gateway integration handle (the uuid in the URL the operator pasted into the gateway) -> its tenant. */
export const paymentIntegrationRoutes = platform
  .table(
    'payment_integration_routes',
    {
      integrationId: uuid('integration_id').primaryKey(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenants.id, { onDelete: 'cascade' }),
      provider: text().notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      check(
        'payment_integration_routes_provider_chk',
        sql`${t.provider} ~ '^[a-z][a-z0-9_]{1,30}$'`,
      ),
      index('payment_integration_routes_tenant_idx').on(t.tenantId),
    ],
  )
  .enableRLS();

/**
 * A gateway product id -> its tenant (D-488). The primary key is what makes the id belong to exactly one
 * tenant across the whole platform: two tenants racing one id leave one row and one refusal, decided here
 * before either tenant row is written.
 */
export const paymentProductRoutes = platform
  .table(
    'payment_product_routes',
    {
      provider: text().notNull(),
      externalProductId: text('external_product_id').notNull(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenants.id, { onDelete: 'cascade' }),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      primaryKey({
        name: 'payment_product_routes_pk',
        columns: [t.provider, t.externalProductId],
      }),
      check('payment_product_routes_provider_chk', sql`${t.provider} ~ '^[a-z][a-z0-9_]{1,30}$'`),
      index('payment_product_routes_tenant_idx').on(t.tenantId),
    ],
  )
  .enableRLS();

/**
 * A Mux (video) asset -> its tenant (DBT-13). The webhook reads the tenant from the passthrough
 * `<tenantId>:<assetId>` first; this table is the safety net for assets created before the passthrough carried
 * the tenant (a bare uuid) and for an event with no passthrough at all (found by `provider_asset_id`). A later
 * contract release drops it once every pre-change asset is final.
 *
 * `provider_asset_id` is unique when present: it is the provider's own asset (or upload) id, learned after
 * the upload starts, so many rows legitimately hold none yet.
 */
export const videoAssetRoutes = platform
  .table(
    'video_asset_routes',
    {
      assetId: uuid('asset_id').primaryKey(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenants.id, { onDelete: 'cascade' }),
      providerAssetId: text('provider_asset_id'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex('video_asset_routes_provider_asset_uq')
        .on(t.providerAssetId)
        .where(sql`${t.providerAssetId} is not null`),
      index('video_asset_routes_tenant_idx').on(t.tenantId),
    ],
  )
  .enableRLS();
