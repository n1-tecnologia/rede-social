import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@tria/core/server/auth/context';
import { requireAuth } from '@tria/core/server/auth/require-auth';
import { ApiError } from '@tria/core/server/http/api-error';
import { requireModule } from '@tria/core/server/modules/require-module';
import { requirePermission } from '@tria/core/server/rbac/permissions';
import {
  COMMUNITY_ISSUE_SET,
  communityPageSchema,
  communityQuerySchema,
  communitySummarySchema,
  createCommunitySchema,
  updateCommunitySchema,
} from '../contracts/index';
import { createCommunity, getCommunity, listCommunities, updateCommunity } from './service';

/**
 * The module owns its guard chain: the mount in `apps/api/src/app.ts` is a plain
 * `.route('/v1/communities', communitiesRoutes)` and cannot forget a guard, because they live here.
 *
 * Order is the ROLE-06 order extended by one, and it matters: `requireAuth` (401 without a session)
 * -> `requireModule` (404 when the tenant does not have communities — never 403, so a member cannot
 * tell "not allowed" from "not here") -> `requirePermission` on the write route only (403).
 *
 * The write guard is a PERMISSION, never `requireRole` (T-05-03): a role comparison would hard-code
 * V1's "only the admin creates communities" into the route, and granting the permission to another
 * role later would then still need a code change.
 */

/**
 * The refusals `createCommunitySchema`'s refinement raises, lifted to `details.community`. The
 * refinement carries the MACHINE CODE as its issue `message` (there is nowhere else on a Zod issue
 * to put one), so the web switches on the same closed vocabulary the service uses when it refuses
 * the same shape — one code per rule, whichever layer caught it.
 */
const communities = new OpenAPIHono<AppEnv>({
  defaultHook: (result) => {
    if (!result.success) {
      const community = result.error.issues
        .map((issue) => issue.message)
        .find((message) => COMMUNITY_ISSUE_SET.has(message));
      if (community) throw new ApiError(400, 'VALIDATION_FAILED', { community });
      throw new ApiError(400, 'VALIDATION_FAILED', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }
  },
});

communities.use('*', requireAuth, requireModule('communities'));

const listRoute = createRoute({
  method: 'get',
  path: '/',
  request: { query: communityQuerySchema },
  responses: {
    200: {
      description:
        "One keyset page of the tenant's ACTIVE communities, most recent activity first. Every member of the tenant receives the same set regardless of role (COMM-02). `nextCursor` is non-null exactly when another community exists; it is OPAQUE and must be passed back untouched.",
      content: { 'application/json': { schema: communityPageSchema } },
    },
  },
});

/** The community id every community-scoped route takes; a miss is a bare 404 (D-23). */
const communityIdParam = z.object({ communityId: z.uuid() });

const getCommunityRoute = createRoute({
  method: 'get',
  path: '/{communityId}',
  request: { params: communityIdParam },
  responses: {
    200: {
      description: 'One community',
      content: { 'application/json': { schema: communitySummarySchema } },
    },
    404: {
      description:
        'No community with that id is visible to this tenant — unknown, another tenant’s, or removed. One bare code, no details (D-23).',
    },
  },
});

const createCommunityRoute = createRoute({
  method: 'post',
  path: '/',
  // The literal, not `COMMUNITY_PERMISSIONS.manage`: this string is the one thing a reviewer greps
  // for when asking "what guards creating a community?", and an indirection here is the kind that
  // hides a change.
  middleware: [requirePermission('communities.community.manage')] as const,
  request: {
    body: { content: { 'application/json': { schema: createCommunitySchema } }, required: true },
  },
  responses: {
    201: {
      description:
        'The created community, in the same shape the list returns. Creating two communities with the same NAME is legal: both succeed, with distinct ids and distinct slugs, and neither answers 409.',
      content: { 'application/json': { schema: communitySummarySchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.community` carrying exactly one machine code: `name_required` (a community with no name has nothing for a card to render).',
    },
    403: {
      description: 'The caller does not hold `communities.community.manage` in this tenant',
    },
  },
});

/**
 * COMM-01's write half (05-04): edit, archive and reactivate, on ONE route.
 *
 * Archive is a `status` write rather than a `POST /{id}/archive` verb, so there is exactly one
 * guarded path into every mutation of a community — one place a reviewer has to look, and one place
 * a later change can go wrong. The 404 wording is the read route's, verbatim, because the two
 * answers must be indistinguishable: a PATCH that said something a GET did not would be the
 * existence oracle D-23 removes.
 */
const updateCommunityRoute = createRoute({
  method: 'patch',
  path: '/{communityId}',
  // The literal, not `COMMUNITY_PERMISSIONS.manage`: this string is the one thing a reviewer greps
  // for when asking "what guards editing and archiving a community?", and an indirection here is
  // the kind that hides a change (T-05-18).
  middleware: [requirePermission('communities.community.manage')] as const,
  request: {
    params: communityIdParam,
    body: { content: { 'application/json': { schema: updateCommunitySchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The community as it now stands. A body identical to the stored row is a 200 that writes nothing and moves neither `updated_at` nor the trigger-owned `last_activity_at`; archiving an already-archived community is likewise a 200 that emits no second `community.archived`.',
      content: { 'application/json': { schema: communitySummarySchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.community` carrying exactly one machine code: `name_required`.',
    },
    403: {
      description: 'The caller does not hold `communities.community.manage` in this tenant',
    },
    404: {
      description:
        'No community with that id is visible to this tenant — unknown, another tenant’s, or removed. One bare code, no details (D-23).',
    },
  },
});

export const communitiesRoutes = communities
  .openapi(listRoute, async (c) =>
    c.json(await listCommunities(c.get('ctx'), c.req.valid('query')), 200),
  )
  .openapi(getCommunityRoute, async (c) => {
    const { communityId } = c.req.valid('param');
    return c.json(await getCommunity(c.get('ctx'), communityId), 200);
  })
  .openapi(createCommunityRoute, async (c) =>
    c.json(await createCommunity(c.get('ctx'), c.req.valid('json')), 201),
  )
  .openapi(updateCommunityRoute, async (c) => {
    const { communityId } = c.req.valid('param');
    return c.json(await updateCommunity(c.get('ctx'), communityId, c.req.valid('json')), 200);
  });
