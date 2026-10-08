import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv, RequestContext } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { requireModule } from '@rede-social/core/server/modules/require-module';
import {
  permissionsForRequest,
  requirePermission,
} from '@rede-social/core/server/rbac/permissions';
import {
  buyersPageSchema,
  buyersQuerySchema,
  communityAccessListSchema,
  communityAccessSchema,
  grantBodySchema,
  grantResultSchema,
  lockPreviewBodySchema,
  lockPreviewSchema,
  productDetailSchema,
  productInputSchema,
  productListQuerySchema,
  productPageSchema,
  productPatchSchema,
  productStatusBodySchema,
  purchaseBodySchema,
  purchaseResultSchema,
  revokeResultSchema,
  STORE_ISSUE_SET,
} from '../contracts/index';
import {
  createProduct,
  getCommunityAccess,
  getProduct,
  grantAccess,
  listBuyers,
  listCommunityAccess,
  listProducts,
  lockPreview,
  purchaseProduct,
  revokeAccess,
  setProductStatus,
  updateProduct,
} from './service';

/**
 * The module owns its guard chain: the mount in `apps/api/src/app.ts` is a plain
 * `.route('/v1/store', storeRoutes)` and cannot forget a guard, because they live here.
 *
 * Order is the ROLE-06 order: `requireAuth` (401) -> `requireModule('store')` (404
 * `MODULE_DISABLED` when the tenant does not have the store, a missing row included, STORE-01) ->
 * `requirePermission('store.product.manage')` on the product writes (403, `admin_tenant` only by
 * default, D-338). Buying carries no permission (RESEARCH Assumption A10).
 */

/**
 * A Zod issue whose `message` is a store machine code is lifted to `details.store` (the events
 * `defaultHook` precedent); anything else is the generic `details.issues` list.
 */
const store = new OpenAPIHono<AppEnv>({
  defaultHook: (result) => {
    if (!result.success) {
      const issue = result.error.issues
        .map((candidate) => candidate.message)
        .find((message) => STORE_ISSUE_SET.has(message));
      if (issue) throw new ApiError(400, 'VALIDATION_FAILED', { store: issue });
      throw new ApiError(400, 'VALIDATION_FAILED', {
        issues: result.error.issues.map((candidate) => ({
          path: candidate.path.map(String).join('.'),
          message: candidate.message,
        })),
      });
    }
  },
});

store.use('*', requireAuth, requireModule('store'));

const productParamSchema = z.object({ productId: z.uuid() });
const communityParamSchema = z.object({ communityId: z.uuid() });
const entitlementParamSchema = z.object({ productId: z.uuid(), entitlementId: z.uuid() });

/**
 * Whether the caller holds `store.product.manage` (08.2-05). The same resolver `requirePermission`
 * evaluates, called BEFORE the tenant transaction opens (one connection per request). The literal
 * is the string a reviewer greps for, the communities `status=archived` precedent.
 */
async function canManageStore(ctx: RequestContext): Promise<boolean> {
  return (await permissionsForRequest(ctx)).includes('store.product.manage');
}

const listProductsRoute = createRoute({
  method: 'get',
  path: '/products',
  request: { query: productListQuerySchema },
  responses: {
    200: {
      description:
        'One keyset page of 20 (`limit` 1..50). `filter=all` (default): the tenant’s ACTIVE products, newest first. `filter=owned`: every product the caller holds an active entitlement to, archived ones included, newest entitlement first. `filter=archived`: archived products, newest first (managers only). `owned` is the caller’s own active entitlement. `nextCursor` is non-null exactly when another row exists.',
      content: { 'application/json': { schema: productPageSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED`: an unknown `filter`, a `limit` outside 1..50, an unknown query key, or a cursor that is longer than 512 characters or was not issued by this list.',
    },
    403: { description: '`filter=archived` without `store.product.manage`' },
    404: { description: '`MODULE_DISABLED` when the store is off for this tenant' },
  },
});

const getProductRoute = createRoute({
  method: 'get',
  path: '/products/{productId}',
  request: { params: productParamSchema },
  responses: {
    200: {
      description:
        'The product: name, description, integer price, image, status, `owned` (the caller’s active entitlement) and its ACTIVE linked communities in the Comunidades list order (`[]` when it opens none). A caller with `store.product.manage` also gets `holderCount`, the exact number of active entitlements.',
      content: { 'application/json': { schema: productDetailSchema } },
    },
    400: { description: '`VALIDATION_FAILED`: the id is not a uuid' },
    404: {
      description:
        '`MODULE_DISABLED` when the store is off; otherwise the product is unknown, another tenant’s, or archived and neither held nor managed by the caller. One bare code, no details (D-23).',
    },
  },
});

const listCommunityAccessRoute = createRoute({
  method: 'get',
  path: '/community-access',
  responses: {
    200: {
      description:
        'One row per GATED community (linked to at least one product), in the Comunidades list order. `locked`: closed for the caller now (always false for staff). `archivedTag`: none of its linked products is active. An open community has no row.',
      content: { 'application/json': { schema: communityAccessListSchema } },
    },
    404: { description: '`MODULE_DISABLED` when the store is off for this tenant' },
  },
});

const getCommunityAccessRoute = createRoute({
  method: 'get',
  path: '/communities/{communityId}/access',
  request: { params: communityParamSchema },
  responses: {
    200: {
      description:
        'The community’s access: `locked` for the caller, `gated` (linked to any product), `archivedTag`, and `buyableProducts` (its ACTIVE linked products, newest first; none means nothing to buy). A caller with `store.product.manage` also gets `products`: every linked product, archived included, with its status (read only: links are written only through the product).',
      content: { 'application/json': { schema: communityAccessSchema } },
    },
    400: { description: '`VALIDATION_FAILED`: the id is not a uuid' },
    404: {
      description:
        '`MODULE_DISABLED` when the store is off; otherwise the community is unknown, another tenant’s, or removed. One bare code, no details (D-23).',
    },
  },
});

const createProductRoute = createRoute({
  method: 'post',
  path: '/products',
  // The literal, not `STORE_PERMISSIONS.manage`: this string is the one thing a reviewer greps for
  // when asking "what guards creating a product?", and an indirection here hides a change (T-06-02).
  middleware: [requirePermission('store.product.manage')] as const,
  request: {
    body: { content: { 'application/json': { schema: productInputSchema } }, required: true },
  },
  responses: {
    201: {
      description:
        'The created product with its linked communities (active ones, in the Comunidades list order). `priceCents` is an integer from 0 to 10000000. Linking a community locks it at once for every member of the tenant who holds no active entitlement to any of its products; staff always read it. `owned` is false: nobody holds a product that was just created.',
      content: { 'application/json': { schema: productDetailSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.store`: `name_required`, `name_too_long`, `description_too_long`, `price_invalid`, `image_invalid` (an image of this tenant that is not a ready cover image), `community_invalid` (not an active community of this tenant) or `too_many_communities` (more than 50). An unknown key is a generic `details.issues` list. Nothing is written.',
    },
    403: { description: 'The caller does not hold `store.product.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the store is off for this tenant; otherwise the image asset id is unknown, another tenant’s, or removed. One bare code, no details (D-23).',
    },
  },
});

// Declared BEFORE any `/products/{productId}` POST route, so the literal path always wins.
const lockPreviewRoute = createRoute({
  method: 'post',
  path: '/products/lock-preview',
  middleware: [requirePermission('store.product.manage')] as const,
  request: {
    body: { content: { 'application/json': { schema: lockPreviewBodySchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'One row per NEWLY locking community: a sent id that is an active community of this tenant with no link to any product today (a community another product gates, or one linked only to `productId`, is left out, and so is any unknown or foreign id). `membersLosingAccess` is the exact count of live `member` memberships holding no active entitlement to `productId` (every live member when it is absent); staff are never counted. Nothing is written.',
      content: { 'application/json': { schema: lockPreviewSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED`: no community id, more than 50 (`details.store: too_many_communities`), a non-uuid, or an unknown key.',
    },
    403: { description: 'The caller does not hold `store.product.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the store is off; otherwise `productId` is unknown or another tenant’s. One bare code, no details (D-23).',
    },
  },
});

const updateProductRoute = createRoute({
  method: 'patch',
  path: '/products/{productId}',
  middleware: [requirePermission('store.product.manage')] as const,
  request: {
    params: productParamSchema,
    body: { content: { 'application/json': { schema: productPatchSchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The updated product as a manager reads it (with `holderCount`). Only the keys sent change. `communityIds` REPLACES the whole link set in the same transaction (the only place a link is written); a newly linked community locks at once for members without access. A new `priceCents` changes only the product: existing orders keep their amount. Entitlements are never touched.',
      content: { 'application/json': { schema: productDetailSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.store` (the create refusals: `name_required`, `name_too_long`, `description_too_long`, `price_invalid`, `image_invalid`, `community_invalid`, `too_many_communities`); an empty body or an unknown key is a generic `details.issues` list. Nothing is written.',
    },
    403: { description: 'The caller does not hold `store.product.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the store is off; otherwise the product, or the image asset, is unknown, another tenant’s, or removed. One bare code, no details (D-23).',
    },
  },
});

const setProductStatusRoute = createRoute({
  method: 'put',
  path: '/products/{productId}/status',
  middleware: [requirePermission('store.product.manage')] as const,
  request: {
    params: productParamSchema,
    body: { content: { 'application/json': { schema: productStatusBodySchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The product with its new status (idempotent: the status it already has answers the unchanged product). `archived` hides it from `filter=all` and refuses NEW purchases (409 `unavailable`); holders keep every community it opens and still see it under `filter=owned`. No link and no entitlement changes.',
      content: { 'application/json': { schema: productDetailSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED`: the id is not a uuid or the status is not `active`/`archived`',
    },
    403: { description: 'The caller does not hold `store.product.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the store is off; otherwise the product is unknown or another tenant’s. One bare code, no details (D-23).',
    },
  },
});

const purchaseRoute = createRoute({
  method: 'post',
  path: '/products/{productId}/purchase',
  request: {
    params: productParamSchema,
    body: { content: { 'application/json': { schema: purchaseBodySchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The caller holds the product: on the first call an order (amount COPIED from the product, provider `none`) and an entitlement are written; a replay, or a concurrent call that lost the race, writes nothing and answers the same shape. `communities` are the product’s active communities, now open to the caller.',
      content: { 'application/json': { schema: purchaseResultSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED`: the id is not a uuid, or `expectedAmountCents` is not an integer price (`details.store: price_invalid`).',
    },
    404: {
      description:
        '`MODULE_DISABLED` when the store is off for this tenant; otherwise the product is unknown or another tenant’s. One bare code, no details (D-23).',
    },
    409: {
      description:
        '`CONFLICT` with `details.store`: `unavailable` (the product is archived; holders keep access) or `price_changed` (`expectedAmountCents` differs from the current price). Nothing is written.',
    },
  },
});

// ── 08.2-06: the admin's escape hatches (D-359, D-360) ──────────────────────────────────────────

const listBuyersRoute = createRoute({
  method: 'get',
  path: '/products/{productId}/buyers',
  // The literal, the createProduct precedent: what guards the holders list is greppable here.
  middleware: [requirePermission('store.product.manage')] as const,
  request: { params: productParamSchema, query: buyersQuerySchema },
  responses: {
    200: {
      description:
        'One keyset page (20 by default, `limit` 1..50) of the product’s ACTIVE holders, newest entitlement first (`created_at desc, id desc`). Each row: `entitlementId`, `membershipId`, `displayName` and `avatarAssetId` (from the holder’s profile in THIS community, through their membership), `source` (`purchase` or `grant`) and `since`. A holder whose membership was removed keeps the row with `membershipId`, `displayName` and `avatarAssetId` null. `total` is the exact count of active holders; a product nobody holds answers `{ items: [], nextCursor: null, total: 0 }`.',
      content: { 'application/json': { schema: buyersPageSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED`: the id is not a uuid, a `limit` outside 1..50, an unknown query key, or a cursor longer than 512 characters or not issued by this list.',
    },
    403: { description: 'The caller does not hold `store.product.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the store is off; otherwise the product is unknown or another tenant’s. One bare code, no details (D-23).',
    },
  },
});

const grantRoute = createRoute({
  method: 'post',
  path: '/products/{productId}/grants',
  middleware: [requirePermission('store.product.manage')] as const,
  request: {
    params: productParamSchema,
    body: { content: { 'application/json': { schema: grantBodySchema } }, required: true },
  },
  responses: {
    200: {
      description:
        '`granted`: the member now holds the product (an entitlement with `source: grant` and no order; the communities it opens are open to them on their next request). `already_active`: the member already held it (a purchase or an earlier grant) and nothing was written. `entitlementId` is the active entitlement either way. An archived product may be granted.',
      content: { 'application/json': { schema: grantResultSchema } },
    },
    400: {
      description: '`VALIDATION_FAILED`: an id is not a uuid, or the body has an unknown key',
    },
    403: {
      description:
        'The caller does not hold `store.product.manage`, or is not this tenant’s `admin_tenant` (the database re-checks the role)',
    },
    404: {
      description:
        '`MODULE_DISABLED` when the store is off; otherwise the product is unknown or another tenant’s, or the membership is unknown, another tenant’s (the same person’s membership in another community included), blocked or removed. One bare code, no details (D-23).',
    },
  },
});

const revokeRoute = createRoute({
  method: 'delete',
  path: '/products/{productId}/entitlements/{entitlementId}',
  middleware: [requirePermission('store.product.manage')] as const,
  request: { params: entitlementParamSchema },
  responses: {
    200: {
      description:
        'The entitlement is `revoked` and, for a purchase, its order too. Both rows stay as history. The member loses the communities on their next request and may buy the product again, which writes a new order and a new entitlement.',
      content: { 'application/json': { schema: revokeResultSchema } },
    },
    400: { description: '`VALIDATION_FAILED`: an id is not a uuid' },
    403: {
      description:
        'The caller does not hold `store.product.manage`, or is not this tenant’s `admin_tenant` (the database re-checks the role)',
    },
    404: {
      description:
        '`MODULE_DISABLED` when the store is off; otherwise no ACTIVE entitlement with this id belongs to this product in this tenant (unknown, another product’s, another tenant’s, or already revoked). One bare code, no details (D-23).',
    },
  },
});

export const storeRoutes = store
  .openapi(listProductsRoute, async (c) => {
    const ctx = c.get('ctx');
    const query = c.req.valid('query');
    // T-08.2-28: archived products are a MANAGER read; refused, never silently answered as `all`.
    if (query.filter === 'archived' && !(await canManageStore(ctx))) {
      throw new ApiError(403, 'FORBIDDEN');
    }
    return c.json(await listProducts(ctx, query), 200);
  })
  .openapi(getProductRoute, async (c) => {
    const ctx = c.get('ctx');
    const canManage = await canManageStore(ctx);
    return c.json(await getProduct(ctx, c.req.valid('param').productId, canManage), 200);
  })
  .openapi(listCommunityAccessRoute, async (c) =>
    c.json(await listCommunityAccess(c.get('ctx')), 200),
  )
  .openapi(getCommunityAccessRoute, async (c) => {
    const ctx = c.get('ctx');
    const canManage = await canManageStore(ctx);
    return c.json(await getCommunityAccess(ctx, c.req.valid('param').communityId, canManage), 200);
  })
  .openapi(lockPreviewRoute, async (c) =>
    c.json(await lockPreview(c.get('ctx'), c.req.valid('json')), 200),
  )
  .openapi(updateProductRoute, async (c) =>
    c.json(
      await updateProduct(c.get('ctx'), c.req.valid('param').productId, c.req.valid('json')),
      200,
    ),
  )
  .openapi(setProductStatusRoute, async (c) =>
    c.json(
      await setProductStatus(
        c.get('ctx'),
        c.req.valid('param').productId,
        c.req.valid('json').status,
      ),
      200,
    ),
  )
  .openapi(createProductRoute, async (c) =>
    c.json(await createProduct(c.get('ctx'), c.req.valid('json')), 201),
  )
  .openapi(purchaseRoute, async (c) =>
    c.json(
      await purchaseProduct(c.get('ctx'), c.req.valid('param').productId, c.req.valid('json')),
      200,
    ),
  )
  .openapi(listBuyersRoute, async (c) =>
    c.json(
      await listBuyers(c.get('ctx'), c.req.valid('param').productId, c.req.valid('query')),
      200,
    ),
  )
  .openapi(grantRoute, async (c) =>
    c.json(
      await grantAccess(c.get('ctx'), c.req.valid('param').productId, c.req.valid('json')),
      200,
    ),
  )
  .openapi(revokeRoute, async (c) => {
    const { productId, entitlementId } = c.req.valid('param');
    return c.json(await revokeAccess(c.get('ctx'), productId, entitlementId), 200);
  });
