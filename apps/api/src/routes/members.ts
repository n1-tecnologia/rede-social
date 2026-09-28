import { createRoute, z } from '@hono/zod-openapi';
import { apiErrorEnvelopeSchema } from '@rede-social/contracts';
import {
  memberListQuerySchema,
  memberListSchema,
  memberProfileSchema,
} from '@rede-social/contracts/profiles';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { getMemberProfile, listMembers } from '@rede-social/core/server/profiles/index';
import { createOpenApiApp } from '../http/openapi';

/**
 * `/v1/members/*` (PROF-02, PROF-03, TENANT-04) — the member directory and one member's profile.
 *
 * TENANT LANE ONLY: both handlers run behind `requireAuth`, so `ctx.tenantId` is the membership of
 * record and every read passes through the `member_profiles_tenant_select` RLS policy. A tenant-B
 * session cannot list, search or open a tenant-A member — the foreign rows are not refused, they are
 * invisible. A `super_admin` has no membership and therefore no business here.
 *
 * THE TWO ROUTES APPLY DELIBERATELY DIFFERENT PREDICATES (D-47) and each service function says so
 * next to its own query: the LIST hides staff (`role = 'member'`), the SINGLE-MEMBER route does not
 * filter on role at all, because a staff member's profile stays openable by direct link — from their
 * content in Phase 4, or the support conversation in Phase 7 — while never appearing in a browsable
 * roster of who runs the community.
 *
 * Logging: `members.read` is emitted here; the list line (`members.list`) is emitted by
 * `listMembers` in the kernel, where the NORMALISED term is known, so the route does not duplicate
 * it with a weaker payload. Neither line ever carries the search text (T-03-24).
 */
const members = createOpenApiApp();
members.use('*', requireAuth);

const envelope = (description: string) => ({
  description,
  content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
});

const memberParams = z.object({ membershipId: z.uuid() });

const listRoute = createRoute({
  method: 'get',
  path: '/',
  request: { query: memberListQuerySchema },
  responses: {
    200: {
      description:
        'One keyset page of the community\'s browsable members — `role = "member"`, `status = "active"`, not soft-deleted (D-47) — ordered by the accent-folded lower-cased display name then `member_profiles.id`. `q` is an accent- and case-insensitive SUBSTRING of the name (`%`, `_` and `\\` are literal). `cursor` is OPAQUE: pass back the previous `nextCursor` verbatim. `nextCursor` is non-null exactly when another row exists',
      content: { 'application/json': { schema: memberListSchema } },
    },
    400: envelope(
      'VALIDATION_FAILED — `limit` outside 1..50, a `q` longer than 80 characters, or an unknown query key. A tampered `cursor` is NOT an error: it answers the first page',
    ),
  },
});

const readRoute = createRoute({
  method: 'get',
  path: '/{membershipId}',
  request: { params: memberParams },
  responses: {
    200: {
      description:
        "Another member's profile: photo, display name and bio ONLY (D-45). Staff profiles are reachable here by direct link even though they never appear in the list (D-47)",
      content: { 'application/json': { schema: memberProfileSchema } },
    },
    404: envelope(
      "NOT_FOUND — unknown, other tenant, blocked, invited or removed: ONE identical body for all five, with no details payload and never naming a tenant (D-23), so the directory cannot be used to probe another community's membership",
    ),
  },
});

export const membersRoutes = members
  .openapi(listRoute, async (c) => {
    const ctx = c.get('ctx');
    const page = await listMembers(ctx, c.req.valid('query'));
    c.header('Cache-Control', 'no-store');
    return c.json(page, 200);
  })
  .openapi(readRoute, async (c) => {
    const ctx = c.get('ctx');
    const profile = await getMemberProfile(ctx, c.req.valid('param').membershipId);
    c.get('logger').info(
      {
        event: 'members.read',
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        requestId: ctx.requestId,
      },
      'member profile read',
    );
    c.header('Cache-Control', 'no-store');
    return c.json(profile, 200);
  });
