import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { requireModule } from '@rede-social/core/server/modules/require-module';
import {
  permissionsForRequest,
  requirePermission,
} from '@rede-social/core/server/rbac/permissions';
import {
  COMMUNITY_ISSUE_SET,
  communityPageSchema,
  communityQuerySchema,
  communitySummarySchema,
  createCommunitySchema,
  reorderCommunitiesSchema,
  updateCommunitySchema,
} from '../contracts/index';
import {
  createCommunity,
  getCommunity,
  listCommunities,
  reorderCommunities,
  updateCommunity,
} from './service';

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

/**
 * The list route carries NO permission middleware: every member lists (COMM-02). The ONE guarded
 * value is `status=archived`, checked inside the handler (D-89) — see `communitiesRoutes` below.
 */
const listRoute = createRoute({
  method: 'get',
  path: '/',
  request: { query: communityQuerySchema },
  responses: {
    200: {
      description:
        "One keyset page of the tenant's communities. By default (`status` absent or `active`) the ACTIVE communities in the order an admin chose (`PUT /v1/communities/order`), most recent activity first inside it — until an admin reorders, that is simply most recent activity first, and a community created after a reorder is listed first; every member of the tenant receives the same set in the same order regardless of role (COMM-02). With `status=archived`, for managers only, the ARCHIVED communities, most recently archived first (`updated_at desc`, so an archived community edited afterwards moves to the top). `nextCursor` is non-null exactly when another community exists; it is OPAQUE, belongs to the status it was issued for, and must be passed back untouched.",
      content: { 'application/json': { schema: communityPageSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED`: an unknown `status` value. The filter is the closed enum `active` | `archived`, exact and case-sensitive.',
    },
    403: {
      description:
        '`status=archived` requested by a caller without `communities.community.manage` in this tenant',
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

/**
 * 2026-10-03 — the admin's order of the ACTIVE list, as ONE full permutation.
 *
 * `PUT` because the body REPLACES the whole order and a repeat of it is a no-op (idempotent). The
 * path is a literal segment, `/order`, beside `/{communityId}`: no other verb is declared on
 * `/{communityId}` with `PUT`, and a uuid param could never match the word anyway.
 *
 * The guard is the same permission every other community write carries (T-05-03): a member is 403,
 * before the body is even compared with anything.
 */
const reorderCommunitiesRoute = createRoute({
  method: 'put',
  path: '/order',
  // The literal, not `COMMUNITY_PERMISSIONS.manage`: this string is the one thing a reviewer greps
  // for when asking "what guards reordering the communities?", and an indirection here is the kind
  // that hides a change.
  middleware: [requirePermission('communities.community.manage')] as const,
  request: {
    body: {
      content: { 'application/json': { schema: reorderCommunitiesSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description:
        'The first page of the ACTIVE list in the new order — the same page `GET /v1/communities` now answers every member. `position` becomes 1..n in the order of `ids`, in ONE statement under a lock on the tenant’s active rows; only rows whose position really changes are written, so repeating the same order changes nothing (not even `updated_at`). Archived communities are never touched.',
      content: { 'application/json': { schema: communityPageSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED`: `ids` is empty, longer than `COMMUNITY_MAX_ORDER`, holds something that is not a uuid, or names the same community twice; or the body has another key. Nothing is written.',
    },
    403: {
      description: 'The caller does not hold `communities.community.manage` in this tenant',
    },
    409: {
      description:
        '`CONFLICT` with `details.community` = `order_stale`: `ids` is not exactly the tenant’s current ACTIVE communities — one was created, archived or removed since the list was loaded, or an id is unknown or another tenant’s (one answer for all of them, so no existence oracle). Nothing is written; reload the list and try again.',
    },
  },
});

export const communitiesRoutes = communities
  .openapi(listRoute, async (c) => {
    const ctx = c.get('ctx');
    const query = c.req.valid('query');
    // D-89: the archived list is a MANAGER read. The API REFUSES a caller without the permission —
    // it never serves the rows and never silently answers the active list instead (the web tier is
    // where the coercion lives, 05.1-03). `permissionsForRequest` is the same resolver
    // `requirePermission` evaluates, and the literal is the string a reviewer greps for — the same
    // reason the write routes spell it out rather than going through `COMMUNITY_PERMISSIONS.manage`.
    if (query.status === 'archived') {
      const granted = await permissionsForRequest(ctx);
      if (!granted.includes('communities.community.manage')) throw new ApiError(403, 'FORBIDDEN');
    }
    return c.json(await listCommunities(ctx, query), 200);
  })
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
  })
  .openapi(reorderCommunitiesRoute, async (c) =>
    c.json(await reorderCommunities(c.get('ctx'), c.req.valid('json')), 200),
  );
