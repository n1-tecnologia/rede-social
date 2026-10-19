import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { requireModule } from '@rede-social/core/server/modules/require-module';
import { requirePermission } from '@rede-social/core/server/rbac/permissions';
import { followResultSchema, SOCIAL_FOLLOW_ISSUE_SET } from '../contracts/index';
import { followMember, unfollowMember } from './service';

/**
 * The module owns its guard chain: the mount in `apps/api/src/app.ts` is a plain
 * `.route('/v1/social', socialRoutes)` and cannot forget a guard, because they live here.
 *
 * Order is the ROLE-06 order: `requireAuth` (401) -> `requireModule('feed')` and
 * `requireModule('social')` (404 `MODULE_DISABLED`, a missing row included) ->
 * `requirePermission('social.participate')` per route (403, composed for the role `member` ONLY by
 * construction, see `SOCIAL_PERMISSIONS`). BOTH module guards are chained because `requires: ['feed']`
 * is enforced by the permission composition and the bootstrap, NOT by `requireModule`, which asks
 * the flags cache for exactly one key (RESEARCH Pattern 1, Pitfall 12, T-09-02): with only the
 * `social` guard, a tenant with `feed` off and `social` on would still answer these routes.
 *
 * A Zod issue whose `message` is a closed follow code is lifted to `details.follow`; anything else
 * is the generic `details.issues` list (the store and events `defaultHook` precedent).
 */
const social = new OpenAPIHono<AppEnv>({
  defaultHook: (result) => {
    if (!result.success) {
      const issue = result.error.issues
        .map((candidate) => candidate.message)
        .find((message) => SOCIAL_FOLLOW_ISSUE_SET.has(message));
      if (issue) throw new ApiError(400, 'VALIDATION_FAILED', { follow: issue });
      throw new ApiError(400, 'VALIDATION_FAILED', {
        issues: result.error.issues.map((candidate) => ({
          path: candidate.path.map(String).join('.'),
          message: candidate.message,
        })),
      });
    }
  },
});

social.use('*', requireAuth, requireModule('feed'), requireModule('social'));

const membershipParamSchema = z.object({ membershipId: z.uuid() });

const FOLLOW_ERRORS = {
  400: {
    description:
      '`VALIDATION_FAILED`: the id is not a uuid, or (PUT) it is the caller’s own membership (`details.follow = "self_follow"`, D-467)',
  },
  403: {
    description:
      '`FORBIDDEN`: the caller is not a `member` (`admin_tenant` and `support_tenant` are outside the graph, D-467). Answered before the target is looked up',
  },
  404: {
    description:
      '`MODULE_DISABLED` when `social` or `feed` is off for this tenant (D-483). Otherwise the target is unknown, another tenant’s, staff, blocked, invited or removed: ONE bare code with no details (D-23, T-09-03)',
  },
} as const;

const followRoute = createRoute({
  method: 'put',
  path: '/follows/{membershipId}',
  middleware: [requirePermission('social.participate')] as const,
  request: { params: membershipParamSchema },
  responses: {
    200: {
      description:
        'The caller now follows that member. Idempotent: a repeat answers the same 200 and leaves one row. `followerCount` is the target’s live follower count (blocked and removed followers are not counted, D-484)',
      content: { 'application/json': { schema: followResultSchema } },
    },
    ...FOLLOW_ERRORS,
  },
});

const unfollowRoute = createRoute({
  method: 'delete',
  path: '/follows/{membershipId}',
  middleware: [requirePermission('social.participate')] as const,
  request: { params: membershipParamSchema },
  responses: {
    200: {
      description:
        'The caller’s own follow row toward that member is gone. NEVER 404 or 409: a repeat, an unknown id, and a target that was blocked or demoted since all answer 200 `following: false` (the row is the caller’s own and must stay removable). `followerCount` is the target’s live count, 0 when the target is no longer a live member',
      content: { 'application/json': { schema: followResultSchema } },
    },
    ...FOLLOW_ERRORS,
  },
});

export const socialRoutes = social
  .openapi(followRoute, async (c) => {
    const result = await followMember(c.get('ctx'), c.req.valid('param').membershipId);
    c.header('Cache-Control', 'no-store');
    return c.json(result, 200);
  })
  .openapi(unfollowRoute, async (c) => {
    const result = await unfollowMember(c.get('ctx'), c.req.valid('param').membershipId);
    c.header('Cache-Control', 'no-store');
    return c.json(result, 200);
  });
