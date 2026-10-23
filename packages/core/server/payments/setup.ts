import type {
  AccessProduct,
  AccessProductBody,
  AccessProductPatch,
  PaymentsOverview,
  RemoveAccessProductResult,
  SaveIntegrationBody,
  StoreMappingBody,
  StoreMappingResponse,
} from '@rede-social/contracts/payments';
import { and, asc, eq, sql } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { paymentIntegrations, paymentProducts } from '../../db/schema';
import { type Tx, withTenantTx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';
import { env } from '../env';
import { ApiError } from '../http/api-error';
import { moduleLogger } from '../logging';
import { moduleFlags } from '../modules/flags-cache';
import { readGate, setupLock } from './gate';
import { deterministicIntegrationId } from './ids';
import { enabledProviders, gatewayAdapter } from './index';
import { releaseIntegrationRoute, reserveIntegrationRoute } from './routes';
import { paymentsKey, sealSecret } from './secret';

/**
 * The admin setup of the Pagamentos module (09.1-09, D-491, D-494, D-501, D-502): the overview, the
 * integration save and the access-product CRUD. The routes in `packages/modules/payments` are thin
 * wrappers over this file, so the rule that THE TENANT COMES ONLY FROM `ctx.tenantId` (never from a body
 * or a path) and that every admin-lane statement names it stays in one place the Biome lane rule can see.
 *
 * Lanes. `payment_integrations` has ZERO policies (the sealed token is never readable from a tenant
 * lane), so it is read and written here through `withAdminTx` with an explicit `tenant_id` predicate.
 * `payment_products` has `admin_tenant` policies (defence in depth), so it goes through `withTenantTx`
 * and ALSO carries an explicit `tenant_id` predicate.
 *
 * RESERVE, THEN WRITE (09.2-10, D-488, DBT-16). A gateway delivery carries no host, so every handle it can
 * name is indexed centrally (`platform.payment_integration_routes`, `platform.payment_product_routes`). The
 * central row is written BEFORE the tenant row it points at (an orphan answers 404 harmlessly, and a product
 * id's primary key decides which tenant holds it before either tenant writes), and removed again when the
 * tenant write fails; a mapping that changes or goes away deletes its old route after the tenant write
 * commits. `routes.ts` holds the statements; this file holds the order.
 */

const log = moduleLogger('payments-setup');

type Rows<T> = T[];
const rowsOf = <T>(result: unknown): Rows<T> => result as Rows<T>;

/**
 * The provider a NEW integration or mapping uses when the body names none (planning decision 7): the
 * first non-test adapter this process accepts, falling back to the test adapter only when it is the only
 * one enabled. A local stack with every adapter picks the real one; a CI stack with only `fake` works.
 */
export function defaultProvider(): string {
  const enabled = enabledProviders();
  const chosen = enabled.find((name) => name !== 'fake') ?? enabled[0];
  if (!chosen) throw new ApiError(400, 'VALIDATION_FAILED', { payments: 'provider_unavailable' });
  return chosen;
}

type IntegrationRow = { id: string; provider: string; lastEventAt: Date | null };

/** The tenant's integration: the oldest row when it has more than one provider. Admin lane, tenant pinned. */
async function readIntegration(tenantId: string): Promise<IntegrationRow | null> {
  return withAdminTx({ tenantId }, async (tx) => {
    const [row] = await tx
      .select({
        id: paymentIntegrations.id,
        provider: paymentIntegrations.provider,
        lastEventAt: paymentIntegrations.lastEventAt,
      })
      .from(paymentIntegrations)
      .where(eq(paymentIntegrations.tenantId, tenantId))
      .orderBy(asc(paymentIntegrations.createdAt), asc(paymentIntegrations.id))
      .limit(1);
    return row ?? null;
  });
}

/** The provider the tenant's products are registered under: its integration's, else the default. */
export async function tenantProvider(tenantId: string): Promise<string> {
  return (await readIntegration(tenantId))?.provider ?? defaultProvider();
}

/** SQLSTATE 23505 on the GLOBAL `(provider, external_product_id)` index, possibly wrapped by drizzle. */
export function isProductTaken(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const e = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (e.code === '23505') {
      const name = typeof e.constraint_name === 'string' ? e.constraint_name : '';
      return name === '' || name === 'payment_products_provider_ext_uq';
    }
    current = e.cause;
  }
  return false;
}

/** The 409 for a gateway product id someone already holds. Names no tenant and no constraint (T-09.1-41). */
export const gatewayProductTaken = () =>
  new ApiError(409, 'CONFLICT', { payments: 'gateway_product_taken' });

type AccessRow = {
  id: string;
  name: string | null;
  externalProductId: string;
  checkoutUrl: string | null;
  createdAt: Date;
};

const accessColumns = {
  id: paymentProducts.id,
  name: paymentProducts.name,
  externalProductId: paymentProducts.externalProductId,
  checkoutUrl: paymentProducts.checkoutUrl,
  createdAt: paymentProducts.createdAt,
};

/** The tenant's access products in creation order `(created_at, id)`, oldest first. */
async function listAccessRows(tx: Tx, tenantId: string): Promise<AccessRow[]> {
  return tx
    .select(accessColumns)
    .from(paymentProducts)
    .where(and(eq(paymentProducts.tenantId, tenantId), eq(paymentProducts.kind, 'access')))
    .orderBy(asc(paymentProducts.createdAt), asc(paymentProducts.id));
}

/** A-UI-7: the id of the OLDEST access product that has a link, the one "Assinar" opens. */
const feedsId = (rows: AccessRow[]): string | null =>
  rows.find((row) => row.checkoutUrl !== null)?.id ?? null;

const toAccessProduct = (row: AccessRow, feeds: string | null): AccessProduct => ({
  id: row.id,
  name: row.name ?? '',
  externalProductId: row.externalProductId,
  checkoutUrl: row.checkoutUrl,
  feedsSubscribeButton: row.id === feeds,
  createdAt: row.createdAt.toISOString(),
});

/** One access product as the API answers it, with the `feedsSubscribeButton` of the current set. */
async function answerFor(tx: Tx, tenantId: string, id: string): Promise<AccessProduct> {
  const rows = await listAccessRows(tx, tenantId);
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  return toAccessProduct(row, feedsId(rows));
}

/**
 * The webhook URL base: `API_PUBLIC_URL` when the deploy sets it (A-P19), else the request's own origin.
 * Trailing slashes are dropped so the path is always exactly one slash from the base.
 */
const baseUrl = (origin: string) => (env.API_PUBLIC_URL ?? origin).replace(/\/+$/, '');

/**
 * `GET /v1/payments/overview`: what the Pagamentos screen needs in one read. `webhookUrl` carries the id
 * of the row when one exists and the DERIVED id (`deterministicIntegrationId`) otherwise, so the admin
 * can copy the URL before saving the token and the row, once created, has exactly that id. The token is
 * never part of this answer (D-486). The optional `storeProductsWithoutLink` of the UI-SPEC is NOT sent:
 * computing it would make the kernel read the store's tables (planning decision 6).
 */
export async function getOverview(
  ctx: RequestContext,
  input: { origin: string },
): Promise<PaymentsOverview> {
  const integration = await readIntegration(ctx.tenantId);
  const provider = integration?.provider ?? defaultProvider();
  const id = integration?.id ?? deterministicIntegrationId(ctx.tenantId, provider);

  const { rows, required } = await withTenantTx(ctx, async (tx) => ({
    rows: await listAccessRows(tx, ctx.tenantId),
    required: await readGate(tx, ctx.tenantId),
  }));
  const feeds = feedsId(rows);

  return {
    integration: {
      provider,
      gatewayName: gatewayAdapter(provider)?.displayName ?? provider,
      connected: integration !== null,
      webhookUrl: `${baseUrl(input.origin)}/v1/webhooks/${provider}/${id}`,
      lastEventAt: integration?.lastEventAt?.toISOString() ?? null,
    },
    accessProducts: rows.map((row) => toAccessProduct(row, feeds)),
    gate: { required, canEnable: integration !== null && rows.length >= 1 },
    serverNow: new Date().toISOString(),
  };
}

/**
 * `PUT /v1/payments/integration`: saves the webhook token (D-486, PAY-04). It is sealed with
 * `sealSecret(token, id)` BOUND to the row's id and replaced atomically with a fresh IV on every save
 * (`secret_set_at` advances); the token is never returned, logged or put in an error. The row id is the
 * derived one on first save and the EXISTING row's id afterwards (a sealed value opens only for the id it
 * was sealed with). A saved integration cannot be removed in this phase.
 */
export async function saveIntegration(
  ctx: RequestContext,
  body: SaveIntegrationBody,
): Promise<{ connected: true }> {
  const provider = body.provider ?? defaultProvider();
  if (!enabledProviders().includes(provider)) {
    throw new ApiError(400, 'VALIDATION_FAILED', { payments: 'provider_unavailable' });
  }

  // The handle: the existing row's id, else the derived one. The central route is reserved FIRST, so a
  // delivery for this handle can be routed the moment the tenant row exists (D-488).
  const known = await withAdminTx({ tenantId: ctx.tenantId }, async (tx) =>
    rowsOf<{ id: string }>(
      await tx.execute(sql`
        select id::text as id from public.payment_integrations
         where tenant_id = ${ctx.tenantId}::uuid and provider = ${provider}`),
    ),
  );
  const integrationId = known[0]?.id ?? deterministicIntegrationId(ctx.tenantId, provider);
  const reservation = await reserveIntegrationRoute({
    integrationId,
    tenantId: ctx.tenantId,
    provider,
  });
  if (reservation.taken) throw new ApiError(500, 'INTERNAL');

  try {
    await withAdminTx({ tenantId: ctx.tenantId }, async (tx) => {
      const [existing] = rowsOf<{ id: string }>(
        await tx.execute(sql`
          select id::text as id from public.payment_integrations
           where tenant_id = ${ctx.tenantId}::uuid and provider = ${provider}
             for update`),
      );
      const id = existing?.id ?? integrationId;
      // A row appeared under another handle between the read and the lock: the route reserved above does
      // not point at it. Refuse; the next save reads the row first and reserves the right handle.
      if (id !== integrationId) throw new ApiError(409, 'CONFLICT');
      const sealed = sealSecret(body.token, id);
      await tx.execute(sql`
        insert into public.payment_integrations
               (id, tenant_id, provider, secret_sealed, secret_key_id, secret_set_at)
        values (${id}::uuid, ${ctx.tenantId}::uuid, ${provider}, ${sealed},
                ${paymentsKey().keyId}::smallint, now())
        on conflict (tenant_id, provider) do update
           set secret_sealed = excluded.secret_sealed,
               secret_key_id = excluded.secret_key_id,
               secret_set_at = now(),
               updated_at = now()`);
    });
  } catch (error) {
    // Compensation: take back the route this call inserted, unless a concurrent save made the row exist.
    if (reservation.inserted) await releaseOrphanIntegrationRoute(ctx.tenantId, integrationId);
    throw error;
  }

  moduleFlags.invalidate(ctx.tenantId);
  // Ids and the provider name only: the token and the sealed string never reach a log line.
  log.info(
    { event: 'payments.integration.saved', tenantId: ctx.tenantId, userId: ctx.userId, provider },
    'payments integration saved',
  );
  return { connected: true };
}

/** Removes the route of an integration whose tenant row does not exist. Never throws. */
async function releaseOrphanIntegrationRoute(
  tenantId: string,
  integrationId: string,
): Promise<void> {
  try {
    const rows = await withAdminTx({ tenantId }, async (tx) =>
      rowsOf<{ id: string }>(
        await tx.execute(sql`
          select id::text as id from public.payment_integrations
           where id = ${integrationId}::uuid and tenant_id = ${tenantId}::uuid`),
      ),
    );
    if (rows.length === 0) await releaseIntegrationRoute(integrationId, tenantId);
  } catch (error) {
    log.error(
      {
        event: 'payments.integration_route.release_failed',
        tenantId,
        err: error instanceof Error ? error.message : String(error),
      },
      'could not remove an integration route; an orphan route answers 404',
    );
  }
}

/**
 * `POST /v1/payments/access-products` (D-494, D-502): registers a gateway product that opens the door.
 * Tenant lane (`payment_products` has `admin_tenant` policies) with the explicit predicate too. A gateway
 * id any tenant already holds is `409 gateway_product_taken` (the unique index arbitrates, so two tenants
 * racing one id leave one row), naming nobody.
 */
export async function createAccessProduct(
  ctx: RequestContext,
  body: AccessProductBody,
): Promise<AccessProduct> {
  const provider = await tenantProvider(ctx.tenantId);
  try {
    return await withTenantTx(ctx, async (tx) => {
      const [created] = await tx
        .insert(paymentProducts)
        .values({
          tenantId: ctx.tenantId,
          provider,
          kind: 'access',
          name: body.name,
          externalProductId: body.externalProductId,
          checkoutUrl: body.checkoutUrl ?? null,
          createdByUserId: ctx.userId,
        })
        .returning({ id: paymentProducts.id });
      if (!created) throw new ApiError(500, 'INTERNAL');
      return answerFor(tx, ctx.tenantId, created.id);
    });
  } catch (error) {
    if (isProductTaken(error)) throw gatewayProductTaken();
    throw error;
  }
}

/**
 * `PATCH /v1/payments/access-products/{id}` (D-502): only the keys present in the patch are written (an
 * empty patch was already refused as `nothing_to_update` by the contract); a `null` link removes it.
 * A missing row, or one of another tenant, is the bare 404 (D-23); a gateway id someone else holds is
 * `409 gateway_product_taken`. Repeating the same patch answers the same body.
 */
export async function updateAccessProduct(
  ctx: RequestContext,
  id: string,
  patch: AccessProductPatch,
): Promise<AccessProduct> {
  const set: Partial<typeof paymentProducts.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.externalProductId !== undefined) set.externalProductId = patch.externalProductId;
  if (patch.checkoutUrl !== undefined) set.checkoutUrl = patch.checkoutUrl;
  try {
    return await withTenantTx(ctx, async (tx) => {
      const [updated] = await tx
        .update(paymentProducts)
        .set(set)
        .where(
          and(
            eq(paymentProducts.id, id),
            eq(paymentProducts.tenantId, ctx.tenantId),
            eq(paymentProducts.kind, 'access'),
          ),
        )
        .returning({ id: paymentProducts.id });
      if (!updated) throw new ApiError(404, 'NOT_FOUND');
      return answerFor(tx, ctx.tenantId, updated.id);
    });
  } catch (error) {
    if (isProductTaken(error)) throw gatewayProductTaken();
    throw error;
  }
}

/**
 * `DELETE /v1/payments/access-products/{id}`. While the gate is ON the LAST access product cannot go
 * (`409 last_access_product`, UI-D-515): the door would stay locked with nothing that opens it. The
 * setup lock serialises this with `setGate`, so two removals racing, or a removal racing the switch,
 * can never leave the gate on with no product (T-09.1-43). A second delete is the bare 404.
 */
export async function removeAccessProduct(
  ctx: RequestContext,
  id: string,
): Promise<RemoveAccessProductResult> {
  return withTenantTx(ctx, async (tx) => {
    await tx.execute(setupLock(ctx.tenantId));
    const rows = await listAccessRows(tx, ctx.tenantId);
    if (!rows.some((row) => row.id === id)) throw new ApiError(404, 'NOT_FOUND');
    if (rows.length === 1 && (await readGate(tx, ctx.tenantId))) {
      throw new ApiError(409, 'CONFLICT', { payments: 'last_access_product' });
    }
    await tx
      .delete(paymentProducts)
      .where(
        and(
          eq(paymentProducts.id, id),
          eq(paymentProducts.tenantId, ctx.tenantId),
          eq(paymentProducts.kind, 'access'),
        ),
      );
    return { id };
  });
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The store product must belong to the caller's tenant, confirmed with the store's PUBLISHED seam
 * `app.store_product_exists(uuid)` (plan 06), never by reading a store table (MOD-02). Unknown, foreign
 * and not-a-uuid are all the same bare 404 (D-23): nothing says which.
 */
async function assertStoreProduct(tx: Tx, productId: string): Promise<void> {
  const [row] = rowsOf<{ ok: boolean }>(
    await tx.execute(sql`select app.store_product_exists(${productId}::uuid) as ok`),
  );
  if (!row?.ok) throw new ApiError(404, 'NOT_FOUND');
}

async function mappingOf(tx: Tx, tenantId: string, productId: string) {
  const [row] = await tx
    .select({
      externalProductId: paymentProducts.externalProductId,
      checkoutUrl: paymentProducts.checkoutUrl,
    })
    .from(paymentProducts)
    .where(
      and(
        eq(paymentProducts.tenantId, tenantId),
        eq(paymentProducts.kind, 'store_product'),
        eq(paymentProducts.targetId, productId),
      ),
    );
  return row ?? null;
}

/** `GET /v1/payments/store-products/{productId}` (A-P12): the gateway product that sells a store product. */
export async function getStoreMapping(
  ctx: RequestContext,
  productId: string,
): Promise<StoreMappingResponse> {
  if (!UUID_SHAPE.test(productId)) throw new ApiError(404, 'NOT_FOUND');
  const connected = (await readIntegration(ctx.tenantId)) !== null;
  return withTenantTx(ctx, async (tx) => {
    await assertStoreProduct(tx, productId);
    return { connected, mapping: await mappingOf(tx, ctx.tenantId, productId) };
  });
}

/**
 * `PUT /v1/payments/store-products/{productId}`: upserts the mapping of that store product. The body is
 * the WHOLE mapping (a link not sent means no link); `externalProductId` is required (the contract
 * refuses a body without it as `gateway_product_id_required`). Saving is a SEPARATE call after the store
 * save (the web orders them, A-P12). The unique `(tenant_id, target_id)` index arbitrates two concurrent
 * PUTs of one product, so they leave exactly one row; a gateway id any registration holds is
 * `409 gateway_product_taken`.
 */
export async function putStoreMapping(
  ctx: RequestContext,
  productId: string,
  body: StoreMappingBody,
): Promise<StoreMappingResponse> {
  if (!UUID_SHAPE.test(productId)) throw new ApiError(404, 'NOT_FOUND');
  const integration = await readIntegration(ctx.tenantId);
  const provider = integration?.provider ?? defaultProvider();
  const externalProductId = body.externalProductId ?? '';
  const checkoutUrl = body.checkoutUrl ?? null;
  try {
    return await withTenantTx(ctx, async (tx) => {
      await assertStoreProduct(tx, productId);
      await tx
        .insert(paymentProducts)
        .values({
          tenantId: ctx.tenantId,
          provider,
          kind: 'store_product',
          targetId: productId,
          externalProductId,
          checkoutUrl,
          createdByUserId: ctx.userId,
        })
        .onConflictDoUpdate({
          target: [paymentProducts.tenantId, paymentProducts.targetId],
          targetWhere: sql`kind = 'store_product'`,
          set: { provider, externalProductId, checkoutUrl, updatedAt: new Date() },
        });
      return {
        connected: integration !== null,
        mapping: await mappingOf(tx, ctx.tenantId, productId),
      };
    });
  } catch (error) {
    if (isProductTaken(error)) throw gatewayProductTaken();
    throw error;
  }
}

/** `DELETE /v1/payments/store-products/{productId}`: removes the mapping; removing what is not mapped is a no-op. */
export async function deleteStoreMapping(
  ctx: RequestContext,
  productId: string,
): Promise<StoreMappingResponse> {
  if (!UUID_SHAPE.test(productId)) throw new ApiError(404, 'NOT_FOUND');
  const connected = (await readIntegration(ctx.tenantId)) !== null;
  return withTenantTx(ctx, async (tx) => {
    await assertStoreProduct(tx, productId);
    await tx
      .delete(paymentProducts)
      .where(
        and(
          eq(paymentProducts.tenantId, ctx.tenantId),
          eq(paymentProducts.kind, 'store_product'),
          eq(paymentProducts.targetId, productId),
        ),
      );
    return { connected, mapping: null };
  });
}
