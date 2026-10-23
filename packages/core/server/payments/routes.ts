import { and, eq, sql } from 'drizzle-orm';
import { paymentIntegrationRoutes, paymentProductRoutes } from '../../db/central/routes';
import { withPlatformTx } from '../../db/platform-tx';

/**
 * The payments side of the central route indexes (09.2-10, D-486, D-488): `platform.payment_integration_routes`
 * and `platform.payment_product_routes`. A gateway delivery names an integration and never a host, so the
 * integration handle in the URL is resolved to its tenant here BEFORE any tenant database is opened; a product
 * id belongs to exactly one tenant because its central primary key is written BEFORE the tenant's own row.
 *
 * Everything runs in the platform lane (`service_role` on the central project). These tables hold ids and a
 * provider name only: no token, no e-mail, no payload (PR-9). Authenticity is never decided here.
 *
 * RESERVE, THEN WRITE. A writer calls `reserve…` first, performs its tenant write, and calls `release…` only
 * when the tenant write failed AND this call was the one that inserted the row (`inserted: true`). A route
 * whose tenant write never happened is an orphan: a delivery to it answers 404 (the tenant read finds no
 * integration) and a product id it holds answers 'already used' until the writer's compensation, or the
 * operational cleanup query of plan 24, removes it.
 */

export type IntegrationRoute = { tenantId: string; provider: string };

/**
 * The tenant and provider of an integration handle, or `null` when the handle is unknown. ONE indexed
 * primary-key read, the only database work an unknown (well-formed) handle costs.
 */
export async function resolveIntegrationRoute(
  integrationId: string,
): Promise<IntegrationRoute | null> {
  const [row] = await withPlatformTx((tx) =>
    tx
      .select({
        tenantId: paymentIntegrationRoutes.tenantId,
        provider: paymentIntegrationRoutes.provider,
      })
      .from(paymentIntegrationRoutes)
      .where(eq(paymentIntegrationRoutes.integrationId, integrationId))
      .limit(1),
  );
  return row ?? null;
}

/** What `reserve…` answers: `taken` = another tenant holds the key; otherwise whether THIS call inserted it. */
export type Reservation = { taken: true } | { taken: false; inserted: boolean };

type ReserveRow = { inserted: boolean };

/**
 * Inserts the route of an integration, or confirms that this tenant already holds it. One statement: a
 * conflict on the primary key keeps the row when its tenant is the same (so re-saving a token, or healing a
 * handle that predates the index, is harmless) and returns nothing when another tenant holds it (impossible
 * for a derived handle, refused all the same).
 */
export async function reserveIntegrationRoute(input: {
  integrationId: string;
  tenantId: string;
  provider: string;
}): Promise<Reservation> {
  const rows = await withPlatformTx(
    (tx) =>
      tx.execute(sql`
        insert into platform.payment_integration_routes (integration_id, tenant_id, provider)
        values (${input.integrationId}::uuid, ${input.tenantId}::uuid, ${input.provider})
        on conflict (integration_id) do update
           set provider = platform.payment_integration_routes.provider
         where platform.payment_integration_routes.tenant_id = excluded.tenant_id
        returning (xmax = 0) as inserted`) as unknown as Promise<ReserveRow[]>,
  );
  const row = rows[0];
  return row ? { taken: false, inserted: row.inserted === true } : { taken: true };
}

/** Removes the route of an integration (compensation of a failed tenant write). Scoped to the tenant. */
export async function releaseIntegrationRoute(
  integrationId: string,
  tenantId: string,
): Promise<void> {
  await withPlatformTx((tx) =>
    tx
      .delete(paymentIntegrationRoutes)
      .where(
        and(
          eq(paymentIntegrationRoutes.integrationId, integrationId),
          eq(paymentIntegrationRoutes.tenantId, tenantId),
        ),
      ),
  );
}

/**
 * Reserves a gateway product id for a tenant (D-488, DBT-16). The composite primary key is what makes the id
 * belong to exactly one tenant: two tenants racing one id leave one row and one `taken`, decided before
 * either tenant row exists. The same tenant reserving its own id again is `inserted: false`, not `taken`.
 */
export async function reserveProductRoute(input: {
  provider: string;
  externalProductId: string;
  tenantId: string;
}): Promise<Reservation> {
  const rows = await withPlatformTx(
    (tx) =>
      tx.execute(sql`
        insert into platform.payment_product_routes (provider, external_product_id, tenant_id)
        values (${input.provider}, ${input.externalProductId}, ${input.tenantId}::uuid)
        on conflict (provider, external_product_id) do update
           set tenant_id = platform.payment_product_routes.tenant_id
         where platform.payment_product_routes.tenant_id = excluded.tenant_id
        returning (xmax = 0) as inserted`) as unknown as Promise<ReserveRow[]>,
  );
  const row = rows[0];
  return row ? { taken: false, inserted: row.inserted === true } : { taken: true };
}

/** Removes a product route, scoped to the tenant that holds it (never another tenant's row). */
export async function releaseProductRoute(input: {
  provider: string;
  externalProductId: string;
  tenantId: string;
}): Promise<void> {
  await withPlatformTx((tx) =>
    tx
      .delete(paymentProductRoutes)
      .where(
        and(
          eq(paymentProductRoutes.provider, input.provider),
          eq(paymentProductRoutes.externalProductId, input.externalProductId),
          eq(paymentProductRoutes.tenantId, input.tenantId),
        ),
      ),
  );
}
