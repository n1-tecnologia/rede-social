import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@tria/core/server/auth/context';
import { requireAuth } from '@tria/core/server/auth/require-auth';
import { ApiError } from '@tria/core/server/http/api-error';
import { requireModule } from '@tria/core/server/modules/require-module';
import { requirePermission } from '@tria/core/server/rbac/permissions';
import {
  createPostSchema,
  feedPageSchema,
  feedPostSchema,
  feedQuerySchema,
} from '../contracts/index';
import { createPost, getPost, listFeed } from './service';

/**
 * The module owns its guard chain: the mount in `apps/api/src/app.ts` is a plain
 * `.route('/v1/feed', feedRoutes)` and cannot forget a guard, because they live here.
 *
 * Order is the ROLE-06 order extended by one, and it matters: `requireAuth` (401 without a session)
 * -> `requireModule` (404 when the tenant does not have the feed — never 403, so a member cannot
 * tell "not allowed" from "not here") -> `requirePermission` on the write route only (403).
 *
 * The write guard is a PERMISSION, never `requireRole` (FEED-08, T-04-03): a role comparison would
 * hard-code V1's "only the admin publishes" into the route, and flipping
 * `tenant_modules['feed'].settings.postingPolicy` to `'members'` would then still need a code change.
 */
const feed = new OpenAPIHono<AppEnv>({
  defaultHook: (result) => {
    if (!result.success) {
      throw new ApiError(400, 'VALIDATION_FAILED', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }
  },
});

feed.use('*', requireAuth, requireModule('feed'));

const listRoute = createRoute({
  method: 'get',
  path: '/',
  request: { query: feedQuerySchema },
  responses: {
    200: {
      description:
        "One keyset page of the tenant's feed, newest first. `nextCursor` is non-null exactly when another post exists; it is OPAQUE and must be passed back untouched.",
      content: { 'application/json': { schema: feedPageSchema } },
    },
  },
});

const getPostRoute = createRoute({
  method: 'get',
  path: '/posts/{postId}',
  request: { params: z.object({ postId: z.uuid() }) },
  responses: {
    200: {
      description: 'One post',
      content: { 'application/json': { schema: feedPostSchema } },
    },
    404: {
      description:
        'No post with that id is visible to this tenant — unknown, another tenant’s, or removed. One bare code, no details (D-23).',
    },
  },
});

const createPostRoute = createRoute({
  method: 'post',
  path: '/posts',
  // The literal, not `FEED_PERMISSIONS.create`: this string is the one thing a reviewer greps for
  // when asking "what guards publishing?", and an indirection here is the kind that hides a change.
  middleware: [requirePermission('feed.post.create')] as const,
  request: {
    body: { content: { 'application/json': { schema: createPostSchema } }, required: true },
  },
  responses: {
    201: {
      description: 'The created post, in the same shape the feed list returns',
      content: { 'application/json': { schema: feedPostSchema } },
    },
    403: {
      description: "The tenant's posting policy does not grant this caller `feed.post.create`",
    },
  },
});

export const feedRoutes = feed
  .openapi(listRoute, async (c) => c.json(await listFeed(c.get('ctx'), c.req.valid('query')), 200))
  .openapi(getPostRoute, async (c) => {
    const { postId } = c.req.valid('param');
    return c.json(await getPost(c.get('ctx'), postId), 200);
  })
  .openapi(createPostRoute, async (c) =>
    c.json(await createPost(c.get('ctx'), c.req.valid('json')), 201),
  );
