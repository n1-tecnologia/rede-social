import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { requireModule } from '@rede-social/core/server/modules/require-module';
import {
  blockEmail,
  listAccesses,
  releaseEmail,
  removeRelease,
  unblockEmail,
} from '@rede-social/core/server/payments/access';
import { grantEventManually, listEvents } from '@rede-social/core/server/payments/events';
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
  accessEmailBodySchema,
  accessListQuerySchema,
  accessPageSchema,
  accessProductBodySchema,
  accessProductPatchSchema,
  accessProductSchema,
  accessResultSchema,
  eventItemSchema,
  eventsResponseSchema,
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
        '`VALIDATION_FAILED` with `details.payments`: `token_required` (empty or whitespace), `token_invalid` (under 8 characters, or whitespace or a control character inside) or `provider_unavailable`; a token over 512 characters or an unknown key is a generic `details.issues` list. Nothing is written.',
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
        '`{ count, gatewayCut }`: `count` is the live `member`-role memberships of this tenant (active, not blocked, not deleted) whose effective access is `none`, the members a release would admit and the only ones it writes a row for; `gatewayCut` is those whose effective access is `inactive`, cut by the gateway, which outranks a manual release (D-489), so a release does not change them. Staff and any e-mail under a manual block are in neither number. Exact integers from one database tally. Nothing is written.',
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
        'Turns the access gate on or off. ON needs a saved integration and at least one access product (else 409 `gate_requires_setup`); OFF is always allowed. With `required: true` and `releaseExisting: true` the server inserts one manual active access row per `none` member (see the preview) in ONE set-based statement INSIDE the same transaction as the switch, and `released` is the number of rows that statement created for `none` members (never the preview, never a gateway-cut member; repeating the call releases 0 more). `gatewayCut` is the number of live members the gateway has left cut as the write ended (0 when the gate is turned off), read by the same tally in the same transaction. `releaseExisting` false or absent releases nobody. The switch is stored in the module settings; the platform toggle never touches it.',
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

const listAccessesRoute = createRoute({
  method: 'get',
  path: '/accesses',
  middleware: [requirePermission('payments.manage')] as const,
  request: { query: accessListQuerySchema },
  responses: {
    200: {
      description:
        'One keyset page of the e-mails that hold an access row in this tenant, ONE item per normalised e-mail: `{ id, email, source, state, validUntil, hasAccount, updatedAt }`. `state` is `app.access_effective` (`active`, `subscription_pending` for an inactive gateway row, `blocked`); `source` is `manual` when blocked or when no gateway row exists, otherwise the gateway key; `hasAccount` is whether a live membership of this tenant carries the e-mail. Ordered `(updatedAt desc, email desc)`; `q` is a contains match on the e-mail (a spaces-only value filters nothing), `status` filters the computed state, `limit` is 1 to 50 (default 20; outside it is a 400), `cursor` is opaque (a tampered one reads as the first page).',
      content: { 'application/json': { schema: accessPageSchema } },
    },
    400: { description: '`VALIDATION_FAILED`: `limit` out of range or an unknown `status`.' },
    403: { description: 'The caller does not hold `payments.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the module is off for this tenant' },
  },
});

const accessActionBody = {
  body: { content: { 'application/json': { schema: accessEmailBodySchema } }, required: true },
} as const;

const releaseEmailRoute = createRoute({
  method: 'post',
  path: '/accesses/release',
  middleware: [requirePermission('payments.manage')] as const,
  request: accessActionBody,
  responses: {
    200: {
      description:
        'Writes a manual `active` row for the e-mail, before or after the person has an account (so they can sign up). Idempotent. Answers `{ access }`, the updated row.',
      content: { 'application/json': { schema: accessResultSchema } },
    },
    400: { description: '`VALIDATION_FAILED` with `details.payments: email_invalid`.' },
    403: { description: 'The caller does not hold `payments.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the module is off for this tenant' },
    409: {
      description:
        '`CONFLICT` with `details.payments: blocked`: the e-mail is manually blocked; unblock it first.',
    },
  },
});

const blockEmailRoute = createRoute({
  method: 'post',
  path: '/accesses/block',
  middleware: [requirePermission('payments.manage')] as const,
  request: accessActionBody,
  responses: {
    200: {
      description:
        'Writes a manual `blocked` row beside whatever the e-mail already holds; a block outranks every other row. Idempotent. Staff are exempt from the gate, so blocking a staff address changes nothing for them. Answers `{ access }`, the updated row.',
      content: { 'application/json': { schema: accessResultSchema } },
    },
    400: { description: '`VALIDATION_FAILED` with `details.payments: email_invalid`.' },
    403: { description: 'The caller does not hold `payments.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the module is off for this tenant' },
  },
});

const unblockEmailRoute = createRoute({
  method: 'post',
  path: '/accesses/unblock',
  middleware: [requirePermission('payments.manage')] as const,
  request: accessActionBody,
  responses: {
    200: {
      description:
        'Deletes the manual `blocked` row only, so the e-mail returns to exactly the state the other rows say. Idempotent; answers `{ access }`, or `{ access: null }` when no row remains.',
      content: { 'application/json': { schema: accessResultSchema } },
    },
    400: { description: '`VALIDATION_FAILED` with `details.payments: email_invalid`.' },
    403: { description: 'The caller does not hold `payments.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the module is off; otherwise the e-mail holds no row at all (one bare code, no details).',
    },
  },
});

const removeReleaseRoute = createRoute({
  method: 'post',
  path: '/accesses/remove-release',
  middleware: [requirePermission('payments.manage')] as const,
  request: accessActionBody,
  responses: {
    200: {
      description:
        'Deletes the manual `active` row only; a gateway row can never be removed by hand. Answers `{ access }`, or `{ access: null }` when no row remains.',
      content: { 'application/json': { schema: accessResultSchema } },
    },
    400: { description: '`VALIDATION_FAILED` with `details.payments: email_invalid`.' },
    403: { description: 'The caller does not hold `payments.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the module is off; otherwise the e-mail has no manual release (a gateway-only address included). One bare code, no details.',
    },
  },
});

// A string, not a uuid: an id that is not even a uuid is the bare 404 like an unknown one (D-23), so the
// service checks the shape instead of the router answering a 400.
const eventParamSchema = z.object({ eventId: z.string().min(1).max(64) });

const listEventsRoute = createRoute({
  method: 'get',
  path: '/events',
  middleware: [requirePermission('payments.manage')] as const,
  responses: {
    200: {
      description:
        'The latest 50 settled events of this tenant in the total order `(receivedAt desc, id desc)`, never paged and never searchable: `{ id, type, state, email, productName, externalProductId, outcome, receivedAt }` and `serverNow`. `state` is `applied`, `no_account` (the apply job found no member with that e-mail), `unknown_product` or `ignored`; events still received or failed are not listed. `productName` is the access product name or the store product name; `email`, `productName`, `externalProductId` and `outcome` are null when the delivery carried none. NO payload, header, signature or gateway message is ever part of the answer.',
      content: { 'application/json': { schema: eventsResponseSchema } },
    },
    403: { description: 'The caller does not hold `payments.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the module is off for this tenant' },
  },
});

const grantEventRoute = createRoute({
  method: 'post',
  path: '/events/{eventId}/grant',
  middleware: [requirePermission('payments.manage')] as const,
  request: { params: eventParamSchema },
  responses: {
    200: {
      description:
        '"Liberar manualmente": releases the store product of an event that is waiting for an account, through the existing store grant (an entitlement with `source = grant`, no order, no revenue), and answers the event as the list shows it (`applied`). Calling it again on a granted event answers the same row with no second entitlement.',
      content: { 'application/json': { schema: eventItemSchema } },
    },
    403: { description: 'The caller does not hold `payments.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the module is off; otherwise the event is unknown, another tenant’s or not a uuid. One bare code, no details (D-23).',
    },
    409: {
      description:
        '`CONFLICT` with `details.payments`: `no_membership` (no live member carries the e-mail yet; the event is untouched) or `not_grantable` (the event is not a store event waiting for an account).',
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
  .openapi(listAccessesRoute, async (c) =>
    c.json(await listAccesses(c.get('ctx'), c.req.valid('query')), 200),
  )
  .openapi(releaseEmailRoute, async (c) =>
    c.json(await releaseEmail(c.get('ctx'), c.req.valid('json').email), 200),
  )
  .openapi(blockEmailRoute, async (c) =>
    c.json(await blockEmail(c.get('ctx'), c.req.valid('json').email), 200),
  )
  .openapi(unblockEmailRoute, async (c) =>
    c.json(await unblockEmail(c.get('ctx'), c.req.valid('json').email), 200),
  )
  .openapi(removeReleaseRoute, async (c) =>
    c.json(await removeRelease(c.get('ctx'), c.req.valid('json').email), 200),
  )
  .openapi(listEventsRoute, async (c) => c.json(await listEvents(c.get('ctx')), 200))
  .openapi(grantEventRoute, async (c) =>
    c.json(await grantEventManually(c.get('ctx'), c.req.valid('param').eventId), 200),
  )
  .openapi(gatePreviewRoute, async (c) => c.json(await previewGate(c.get('ctx')), 200))
  .openapi(setGateRoute, async (c) =>
    c.json(await setGate(c.get('ctx'), c.req.valid('json')), 200),
  );
