import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { requireRole } from '@rede-social/core/server/rbac/require-role';
import {
  memberActivityAnswerSchema,
  ownerMembersAnswerSchema,
  ownerOverviewAnswerSchema,
} from '../contracts/index';
import { getMemberActivity } from './activity';
import { getOwnerMembers } from './members';
import { getOwnerOverview } from './overview';

/**
 * The dashboard's routes (08.7-01). The module owns its guard chain, so the mount in
 * `apps/api/src/app.ts` is a plain `.route('/v1/dashboard', dashboardRoutes)` and cannot forget one:
 * `requireAuth` (401; a session on another tenant's host is 403 `TENANT_HOST_MISMATCH`), then a
 * per-route `requireRole('admin_tenant')` on every owner read (403 `FORBIDDEN` for a member or the
 * support team, D-462). The dashboard has no ModuleKey (it is not a tenant toggle), so there is no
 * `requireModule` here; the area routes of later plans add the module of their area
 * (`requireModule('events')`, …) BEFORE the role, the ROLE-06 order.
 *
 * Every answer is `Cache-Control: no-store`: a number of the tenant's business never sits in a
 * shared cache. The admin-only RLS of `dashboard_snapshots` stands behind the role check.
 */
const dashboard = new OpenAPIHono<AppEnv>();

dashboard.use('*', requireAuth);

export const ownerOverviewRoute = createRoute({
  method: 'get',
  path: '/owner/overview',
  middleware: [requireRole('admin_tenant')] as const,
  responses: {
    200: {
      description:
        "The owner's Visão geral from the tenant's newest snapshot (built once a day after the tenant's local midnight, windows ending at the end of that day): `{ state: 'preparing' }` before the first build, else `{ state: 'ready', snapshot: { day, builtAt, windows }, members: { count, newMembers, previous } }` as raw integers (the client derives the change). No name ever travels in it.",
      content: { 'application/json': { schema: ownerOverviewAnswerSchema } },
    },
    401: { description: '`UNAUTHENTICATED`: no session.' },
    403: {
      description:
        '`FORBIDDEN` for any role but `admin_tenant`; `TENANT_HOST_MISMATCH` for a session of another tenant.',
    },
  },
});

export const ownerMembersRoute = createRoute({
  method: 'get',
  path: '/owner/members',
  middleware: [requireRole('admin_tenant')] as const,
  responses: {
    200: {
      description:
        "The owner's Membros (08.7-02) from the tenant's newest snapshot: `{ state: 'preparing' }` before the first build or while the snapshot lacks its `members` key, else `{ state: 'ready', snapshot, growth: { joined, weeklyJoined, left, balance }, engagement, movement, cohorts, atRiskWithPush, communityEngagement?, eventEngagement? }`. `left` and `balance` are always `{ measured: false, reason: 'needs_member_exit' }` (D-465). `communityEngagement` is present only while `communities` is on and `eventEngagement` only while `events` is on (D-460); their names, covers and dates are read live. Band counts are exact (UI-D-486); no member name ever travels in it.",
      content: { 'application/json': { schema: ownerMembersAnswerSchema } },
    },
    401: { description: '`UNAUTHENTICATED`: no session.' },
    403: {
      description:
        '`FORBIDDEN` for any role but `admin_tenant`; `TENANT_HOST_MISMATCH` for a session of another tenant.',
    },
  },
});

/**
 * 08.7-03 (D-463, INSIGHT-01..05, T-08.7-09, T-08.7-10): the member's OWN "Sua atividade". It
 * declares NO path, query or body parameter, so a `?userId=` is simply ignored: the row is selected
 * by the session's own claims. `requireRole('member')`: `admin_tenant` and `support_tenant` get 403
 * `FORBIDDEN` (staff have no member row; the owner panel is their view).
 */
export const memberActivityRoute = createRoute({
  method: 'get',
  path: '/activity',
  middleware: [requireRole('member')] as const,
  responses: {
    200: {
      description:
        "The caller's own activity from their member row of the tenant's newest build: `{ state: 'preparing' }` when the member has no row yet (joined after the last build) or its activity is missing, else `{ state: 'ready', snapshot: { day, builtAt }, likes: { count, previous }, comments: { count, previous }, saves, shares, usage, seen: { stories, posts, videos }, byCommunity?, attendance?, weekStreak }`. Likes, comments, stories and communities cover the last 7 complete tenant-local days (`previous` = the 7 before); attendance the events of the last 30 days; the streak Monday-first weeks. `saves`, `shares`, `usage`, `seen.posts` and `seen.videos` are always `{ measured: false, reason }` (D-455). `byCommunity` only while `communities` is on (names read live, the tenant feed as `communityId: null`), `attendance` only while `events` is on. Nothing of another member ever travels in it.",
      content: { 'application/json': { schema: memberActivityAnswerSchema } },
    },
    401: { description: '`UNAUTHENTICATED`: no session.' },
    403: {
      description:
        '`FORBIDDEN` for any role but `member`; `TENANT_HOST_MISMATCH` for a session of another tenant.',
    },
  },
});

export const dashboardRoutes = dashboard
  .openapi(ownerOverviewRoute, async (c) => {
    const answer = await getOwnerOverview(c.get('ctx'));
    c.header('Cache-Control', 'no-store');
    return c.json(ownerOverviewAnswerSchema.parse(answer), 200);
  })
  .openapi(ownerMembersRoute, async (c) => {
    const answer = await getOwnerMembers(c.get('ctx'));
    c.header('Cache-Control', 'no-store');
    return c.json(ownerMembersAnswerSchema.parse(answer), 200);
  })
  .openapi(memberActivityRoute, async (c) => {
    const answer = await getMemberActivity(c.get('ctx'));
    c.header('Cache-Control', 'no-store');
    return c.json(memberActivityAnswerSchema.parse(answer), 200);
  });
