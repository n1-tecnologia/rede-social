import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { requireModule } from '@rede-social/core/server/modules/require-module';
import { previewGate, setGate } from '@rede-social/core/server/payments/gate';
import {
  createAccessProduct,
  deleteStoreMapping,
  getOverview,
  getStoreMapping,
  putStoreMapping,
  removeAccessProduct,
  saveIntegration,
  updateAccessProduct,
} from '@rede-social/core/server/payments/setup';
import { requirePermission } from '@rede-social/core/server/rbac/permissions';
import {
  accessProductBodySchema,
  accessProductPatchSchema,
  accessProductSchema,
  gateBodySchema,
  gatePreviewSchema,
  gateResultSchema,
  PAYMENTS_ISSUE_SET,
  paymentsOverviewSchema,
  removeAccessProductResultSchema,
  saveIntegrationBodySchema,
  saveIntegrationResultSchema,
  storeMappingBodySchema,
  storeMappingResponseSchema,
} from '../contracts/index';

/**
 * The module owns its guard chain: the mount in `apps/api/src/app.ts` is a plain
 * `.route('/v1/payments', paymentsRoutes)` and cannot forget a guard, because they live here.
 *
 * Order is the ROLE-06 order: `requireAuth` (401) -> `requireModule('payments')` (404
 * `MODULE_DISABLED` when the tenant does not have the module, a missing row included) ->
 * `requirePermission('payments.manage')` on every route (403, `admin_tenant` only by construction,
 * D-338: see `module.ts`). The literal permission string stays in each route definition: it is the one
 * thing a reviewer greps for when asking "what guards this route?".
 *
 * The routes are thin: the kernel services (`@rede-social/core/server/payments/{setup,gate}`) hold the
 * admin-lane writes and take the tenant ONLY from `ctx.tenantId`. A route never opens the admin lane.
 */

/**
 * A Zod issue whose `message` is a payments machine code is lifted to `details.payments` (the store's
 * `defaultHook` precedent); anything else is the generic `details.issues` list.
 */
const payments = new OpenAPIHono<AppEnv>({
  defaultHook: (result) => {
    if (!result.success) {
      const issue = result.error.issues
        .map((candidate) => candidate.message)
        .find((message) => PAYMENTS_ISSUE_SET.has(message));
      if (issue) throw new ApiError(400, 'VALIDATION_FAILED', { payments: issue });
      throw new ApiError(400, 'VALIDATION_FAILED', {
        issues: result.error.issues.map((candidate) => ({
          path: candidate.path.map(String).join('.'),
          message: candidate.message,
        })),
      });
    }
  },
});

payments.use('*', requireAuth, requireModule('payments'));

const overviewRoute = createRoute({
  method: 'get',
  path: '/overview',
  middleware: [requirePermission('payments.manage')] as const,
  responses: {
    200: {
      description:
        'What the Pagamentos screen needs in one read: the integration (`provider`, `gatewayName`, `connected`, the `webhookUrl` the admin pastes into the gateway, known BEFORE any token is saved, and `lastEventAt`), the access products in creation order with `feedsSubscribeButton` true on exactly one (the OLDEST that has a link), the gate (`required`, and `canEnable`: an integration and at least one access product exist) and `serverNow`. The token is never part of any answer. An empty tenant answers `connected: false`, no products and `canEnable: false`.',
      content: { 'application/json': { schema: paymentsOverviewSchema } },
    },
    403: { description: 'The caller does not hold `payments.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the module is off for this tenant' },
  },
});

const saveIntegrationRoute = createRoute({
  method: 'put',
  path: '/integration',
  middleware: [requirePermission('payments.manage')] as const,
  request: {
    body: {
      content: { 'application/json': { schema: saveIntegrationBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description:
        'Saves the gateway webhook token, 1 to 512 characters after trimming, sealed at rest and bound to its row; every save replaces it atomically with a fresh IV. Write-only: the answer is `{ connected: true }` and no route of this module ever returns the token. `provider` is optional (the default adapter of this process); one that is not enabled here is `details.payments: provider_unavailable`. A saved integration cannot be removed in this phase.',
      content: { 'application/json': { schema: saveIntegrationResultSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.payments`: `token_required` (empty or whitespace) or `provider_unavailable`; a token over 512 characters or an unknown key is a generic `details.issues` list. Nothing is written.',
    },
    403: { description: 'The caller does not hold `payments.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the module is off for this tenant' },
  },
});

const createAccessProductRoute = createRoute({
  method: 'post',
  path: '/access-products',
  middleware: [requirePermission('payments.manage')] as const,
  request: {
    body: { content: { 'application/json': { schema: accessProductBodySchema } }, required: true },
  },
  responses: {
    201: {
      description:
        'Registers a gateway product that opens the door (D-494: a tenant may register several). `name` 1 to 80 code points, `externalProductId` 1 to 128 (stored trimmed, compared case-sensitively), `checkoutUrl` optional: an `https:` URL with a host and no userinfo, at most 2048 characters; an empty string means no link. The provider is the tenant’s integration provider.',
      content: { 'application/json': { schema: accessProductSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.payments`: `name_required`, `name_too_long`, `product_id_required`, `product_id_too_long` or `link_invalid`. Nothing is written.',
    },
    403: { description: 'The caller does not hold `payments.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the module is off for this tenant' },
    409: {
      description:
        '`CONFLICT` with `details.payments: gateway_product_taken`: some registration, of any tenant, already holds that gateway product id. The body never names the other tenant.',
    },
  },
});

const gatePreviewRoute = createRoute({
  method: 'get',
  path: '/gate/preview',
  middleware: [requirePermission('payments.manage')] as const,
  responses: {
    200: {
      description:
        '`{ count }`: the live `member`-role memberships of this tenant (active, not blocked, not deleted) whose effective access is none or inactive, i.e. the members a release would admit. Staff and any e-mail under a manual block are never counted. An exact integer from the database. Nothing is written.',
      content: { 'application/json': { schema: gatePreviewSchema } },
    },
    403: { description: 'The caller does not hold `payments.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the module is off for this tenant' },
  },
});

const setGateRoute = createRoute({
  method: 'put',
  path: '/gate',
  middleware: [requirePermission('payments.manage')] as const,
  request: {
    body: { content: { 'application/json': { schema: gateBodySchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'Turns the access gate on or off. ON needs a saved integration and at least one access product (else 409 `gate_requires_setup`); OFF is always allowed. With `required: true` and `releaseExisting: true` the server inserts one manual active access row per releasable member (see the preview) in ONE set-based statement INSIDE the same transaction as the switch, and `released` is the number of rows that statement created (never the preview; repeating the call releases 0 more). `releaseExisting` false or absent releases nobody. The switch is stored in the module settings; the platform toggle never touches it.',
      content: { 'application/json': { schema: gateResultSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED`: `required` is missing or not a boolean, or an unknown key.',
    },
    403: { description: 'The caller does not hold `payments.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the module is off for this tenant' },
    409: {
      description:
        '`CONFLICT` with `details.payments: gate_requires_setup`: turning the gate ON with no integration or no access product.',
    },
  },
});

const accessProductParamSchema = z.object({ id: z.uuid() });
// A string, not a uuid: a store product id that is not even a uuid is the bare 404 like an unknown one
// (D-23), so the service checks the shape instead of the router answering a 400.
const storeProductParamSchema = z.object({ productId: z.string().min(1).max(64) });

const updateAccessProductRoute = createRoute({
  method: 'patch',
  path: '/access-products/{id}',
  middleware: [requirePermission('payments.manage')] as const,
  request: {
    params: accessProductParamSchema,
    body: { content: { 'application/json': { schema: accessProductPatchSchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The updated access product. Only the keys sent change; `checkoutUrl: null` (or an empty string) removes the link. The same patch twice answers the same body.',
      content: { 'application/json': { schema: accessProductSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.payments`: the create refusals, or `nothing_to_update` for an empty body. Nothing is written.',
    },
    403: { description: 'The caller does not hold `payments.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the module is off; otherwise the product is unknown, another tenant’s or already removed. One bare code, no details (D-23).',
    },
    409: {
      description:
        '`CONFLICT` with `details.payments: gateway_product_taken` (the gateway id is held by another registration).',
    },
  },
});

const removeAccessProductRoute = createRoute({
  method: 'delete',
  path: '/access-products/{id}',
  middleware: [requirePermission('payments.manage')] as const,
  request: { params: accessProductParamSchema },
  responses: {
    200: {
      description:
        'Removes the access product. While the gate is ON the tenant’s LAST access product cannot be removed. A second removal is the bare 404.',
      content: { 'application/json': { schema: removeAccessProductResultSchema } },
    },
    403: { description: 'The caller does not hold `payments.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the module is off; otherwise the product is unknown, another tenant’s or already removed. One bare code, no details (D-23).',
    },
    409: {
      description:
        '`CONFLICT` with `details.payments: last_access_product`: the last access product while the gate is on. Nothing is deleted.',
    },
  },
});

const getStoreMappingRoute = createRoute({
  method: 'get',
  path: '/store-products/{productId}',
  middleware: [requirePermission('payments.manage')] as const,
  request: { params: storeProductParamSchema },
  responses: {
    200: {
      description:
        '`{ connected, mapping }`: the gateway product that sells this store product (`externalProductId`, `checkoutUrl`), or `mapping: null` when it is unmapped. `connected` is whether the tenant has an integration.',
      content: { 'application/json': { schema: storeMappingResponseSchema } },
    },
    403: { description: 'The caller does not hold `payments.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the module is off; otherwise the store product is unknown, another tenant’s or not a uuid. One bare code, no details (D-23).',
    },
  },
});

const putStoreMappingRoute = createRoute({
  method: 'put',
  path: '/store-products/{productId}',
  middleware: [requirePermission('payments.manage')] as const,
  request: {
    params: storeProductParamSchema,
    body: { content: { 'application/json': { schema: storeMappingBodySchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'Upserts the mapping of the store product: `externalProductId` is required, `checkoutUrl` optional (not sent means no link). Saving is a SEPARATE call after the store save. The same body twice leaves the same row and answers the same body.',
      content: { 'application/json': { schema: storeMappingResponseSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.payments`: `gateway_product_id_required` (no id, including a link without one), `product_id_too_long` or `link_invalid`. Nothing is written.',
    },
    403: { description: 'The caller does not hold `payments.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the module is off; otherwise the store product is unknown, another tenant’s or not a uuid. One bare code, no details (D-23).',
    },
    409: {
      description:
        '`CONFLICT` with `details.payments: gateway_product_taken` (the gateway id is held by another registration).',
    },
  },
});

const deleteStoreMappingRoute = createRoute({
  method: 'delete',
  path: '/store-products/{productId}',
  middleware: [requirePermission('payments.manage')] as const,
  request: { params: storeProductParamSchema },
  responses: {
    200: {
      description:
        'Removes the mapping and answers `{ connected, mapping: null }`; removing a product that is not mapped answers the same.',
      content: { 'application/json': { schema: storeMappingResponseSchema } },
    },
    403: { description: 'The caller does not hold `payments.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the module is off; otherwise the store product is unknown, another tenant’s or not a uuid. One bare code, no details (D-23).',
    },
  },
});

export const paymentsRoutes = payments
  .openapi(overviewRoute, async (c) =>
    c.json(await getOverview(c.get('ctx'), { origin: new URL(c.req.url).origin }), 200),
  )
  .openapi(saveIntegrationRoute, async (c) =>
    c.json(await saveIntegration(c.get('ctx'), c.req.valid('json')), 200),
  )
  .openapi(createAccessProductRoute, async (c) =>
    c.json(await createAccessProduct(c.get('ctx'), c.req.valid('json')), 201),
  )
  .openapi(updateAccessProductRoute, async (c) =>
    c.json(
      await updateAccessProduct(c.get('ctx'), c.req.valid('param').id, c.req.valid('json')),
      200,
    ),
  )
  .openapi(removeAccessProductRoute, async (c) =>
    c.json(await removeAccessProduct(c.get('ctx'), c.req.valid('param').id), 200),
  )
  .openapi(getStoreMappingRoute, async (c) =>
    c.json(await getStoreMapping(c.get('ctx'), c.req.valid('param').productId), 200),
  )
  .openapi(putStoreMappingRoute, async (c) =>
    c.json(
      await putStoreMapping(c.get('ctx'), c.req.valid('param').productId, c.req.valid('json')),
      200,
    ),
  )
  .openapi(deleteStoreMappingRoute, async (c) =>
    c.json(await deleteStoreMapping(c.get('ctx'), c.req.valid('param').productId), 200),
  )
  .openapi(gatePreviewRoute, async (c) => c.json(await previewGate(c.get('ctx')), 200))
  .openapi(setGateRoute, async (c) =>
    c.json(await setGate(c.get('ctx'), c.req.valid('json')), 200),
  );
