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
  communityAccessListSchema,
  communityAccessSchema,
  productDetailSchema,
  productInputSchema,
  productListQuerySchema,
  productPageSchema,
  purchaseBodySchema,
  purchaseResultSchema,
  STORE_ISSUE_SET,
} from '../contracts/index';
import {
  createProduct,
  getCommunityAccess,
  getProduct,
  listCommunityAccess,
  listProducts,
  purchaseProduct,
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
  .openapi(createProductRoute, async (c) =>
    c.json(await createProduct(c.get('ctx'), c.req.valid('json')), 201),
  )
  .openapi(purchaseRoute, async (c) =>
    c.json(
      await purchaseProduct(c.get('ctx'), c.req.valid('param').productId, c.req.valid('json')),
      200,
    ),
  );
