import { createRoute, z } from '@hono/zod-openapi';
import { apiErrorEnvelopeSchema } from '@rede-social/contracts';
import {
  memberListQuerySchema,
  memberListSchema,
  memberProfileSchema,
} from '@rede-social/contracts/profiles';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { getMemberProfile, listMembers } from '@rede-social/core/server/profiles/index';
import { permissionsForRequest } from '@rede-social/core/server/rbac/permissions';
import { createMiddleware } from 'hono/factory';
import { createOpenApiApp } from '../http/openapi';

/**
 * `/v1/members/*` (PROF-02, PROF-03, TENANT-04) — the member directory and one member's profile.
 *
 * WHO MAY CALL WHICH (pendencias-backend item 7, quick 261016-jsq; 09-02, D-466): the LIST (with or
 * without `q`) is for the tenant's staff (`admin_tenant`, `support_tenant`), always, and for a
 * `member` ONLY while `social` is on for the tenant (the member holds `social.participate`, composed
 * for the role `member` only while `social` is effective). Anyone else answers 403 `FORBIDDEN`,
 * before the query is validated. The directory never lists staff and never a blocked member (D-467,
 * D-484). The SINGLE read stays open to every tenant role, `member` included: it opens a profile from
 * an author's name and serves the author's @ on posts.
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

/**
 * D-466 (09-02, reopening pendencias-backend item 7): the directory is the staff's tool, and a
 * member's too while `social` is on. The gate is a small middleware rather than `requireRole`:
 *  - `admin_tenant` and `support_tenant` always pass (role-based on purpose, like
 *    `canBrowseMemberDirectory` in apps/web/lib/member-directory.ts: `support_tenant` holds no
 *    kernel permission, D-223, so no permission names "the staff"); the role is the membership of
 *    record on this host, read by `requireAuth` (ROLE-06);
 *  - a `member` passes only when the composed permissions hold `social.participate`, read BEFORE any
 *    other work, so with `social` off (or `feed` off, `requires`) the old 403 stands and nothing about
 *    `q`, `cursor` or `limit` is learned;
 *  - anything else is 403 `FORBIDDEN` with no details. `super_admin` never reaches here:
 *    `requireAuth` answers 403 `NO_MEMBERSHIP` first.
 * The literal below is the string a reviewer greps for (the `canManageStore` precedent).
 */
const listGate = createMiddleware<AppEnv>(async (c, next) => {
  const ctx = c.get('ctx');
  if (!ctx) throw new ApiError(401, 'UNAUTHENTICATED');
  if (ctx.role === 'admin_tenant' || ctx.role === 'support_tenant') return next();
  if (ctx.role === 'member' && (await permissionsForRequest(ctx)).includes('social.participate')) {
    return next();
  }
  throw new ApiError(403, 'FORBIDDEN');
});

const listRoute = createRoute({
  method: 'get',
  path: '/',
  middleware: [listGate] as const,
  request: { query: memberListQuerySchema },
  responses: {
    200: {
      description:
        'One keyset page of the community\'s browsable members — `role = "member"`, `status = "active"`, not blocked, not soft-deleted (D-47, D-484) — ordered by the accent-folded lower-cased display name then `member_profiles.id`. `q` is an accent- and case-insensitive SUBSTRING of the name (`%`, `_` and `\\` are literal). `cursor` is OPAQUE: pass back the previous `nextCursor` verbatim. `nextCursor` is non-null exactly when another row exists',
      content: { 'application/json': { schema: memberListSchema } },
    },
    400: envelope(
      'VALIDATION_FAILED — `limit` outside 1..50, a `q` longer than 80 characters, or an unknown query key. A tampered `cursor` is NOT an error: it answers the first page',
    ),
    403: envelope(
      "FORBIDDEN — the caller is a `member` of a tenant where `social` is off (or `feed` is off): the directory is for the tenant's staff (`admin_tenant`, `support_tenant`) always, and for a member only while `social` is on (D-466). Answered before the query is validated, so a member learns nothing about `q`, `cursor` or `limit`; no details payload",
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
        "Another member's profile: photo, display name and bio ONLY (D-45). Staff profiles are reachable here by direct link even though they never appear in the list (D-47). Open to every tenant role, `member` included: it opens a profile from an author's name and serves the author's @ on posts",
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
