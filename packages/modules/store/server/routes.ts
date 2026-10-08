import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { requireModule } from '@rede-social/core/server/modules/require-module';
import { requirePermission } from '@rede-social/core/server/rbac/permissions';
import {
  productDetailSchema,
  productInputSchema,
  purchaseBodySchema,
  purchaseResultSchema,
  STORE_ISSUE_SET,
} from '../contracts/index';
import { createProduct, purchaseProduct } from './service';

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
  .openapi(createProductRoute, async (c) =>
    c.json(await createProduct(c.get('ctx'), c.req.valid('json')), 201),
  )
  .openapi(purchaseRoute, async (c) =>
    c.json(
      await purchaseProduct(c.get('ctx'), c.req.valid('param').productId, c.req.valid('json')),
      200,
    ),
  );
