import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { requireRole } from '@rede-social/core/server/rbac/require-role';
import {
  memberActivityAnswerSchema,
  ownerBandListAnswerSchema,
  ownerBandListQuerySchema,
  ownerBandParamSchema,
  ownerContentAnswerSchema,
  ownerMemberDetailAnswerSchema,
  ownerMemberListAnswerSchema,
  ownerMemberListParamSchema,
  ownerMemberListQuerySchema,
  ownerMemberParamSchema,
  ownerMembersAnswerSchema,
  ownerOverviewAnswerSchema,
} from '../contracts/index';
import { getMemberActivity } from './activity';
import { getOwnerContent } from './content';
import { getOwnerMemberDetail } from './member-detail';
import { listOwnerBandMembers, listOwnerMemberItems } from './member-lists';
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
const dashboard = new OpenAPIHono<AppEnv>({
  // 08.7-04: a path or query that fails its schema (a non-uuid id, an unknown band, scope or list,
  // an unknown query key) is the stable 400 envelope, never the library's raw zod body.
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

/**
 * 08.7-04 (D-462, D-460, INSIGHT-09, EP-21..EP-26): the members of one band of the newest build.
 * Registered BEFORE `/owner/members/{membershipId}` (the static segment first). `admin_tenant` of
 * the same tenant only; the scope's module is checked in the service (404 `MODULE_DISABLED`).
 */
export const ownerBandMembersRoute = createRoute({
  method: 'get',
  path: '/owner/members/bands/{band}',
  middleware: [requireRole('admin_tenant')] as const,
  request: { params: ownerBandParamSchema, query: ownerBandListQuerySchema },
  responses: {
    200: {
      description:
        "One band's members of the newest build: `{ state: 'preparing' }` before the first build, else `{ state: 'ready', snapshot, total, rows, nextCursor }`. `scope=base` (default) is the whole base, `scope=community&scopeId=` that community's base (its `community_bands`), `scope=event&scopeId=` the members whose RSVP \"vou\" for the event was answered before the snapshot's `untilAt`. Rows `{ membershipId, displayName, avatarAssetId, joinedAt, lastActiveAt, topCommunity, dailyMinutes }` ordered `last_active_at desc nulls last, membership_id desc`; `total` is the band count of that scope in the same build. `limit` is clamped to 1..50 (10 by default); a malformed or tampered `cursor` reads page 1.",
      content: { 'application/json': { schema: ownerBandListAnswerSchema } },
    },
    400: { description: '`VALIDATION_FAILED`: an unknown band or scope, a non-uuid `scopeId`.' },
    401: { description: '`UNAUTHENTICATED`: no session.' },
    403: {
      description:
        '`FORBIDDEN` for any role but `admin_tenant`; `TENANT_HOST_MISMATCH` for a session of another tenant.',
    },
    404: {
      description:
        '`MODULE_DISABLED` for `scope=community` with communities off or `scope=event` with events off; the bare `NOT_FOUND` for an absent, unknown or other-tenant `scopeId`.',
    },
  },
});

/**
 * 08.7-04 (D-462, D-460, INSIGHT-09, EP-17): one member's detail. A membership id that is unknown,
 * of another tenant, or of a staff membership is the same bare 404.
 */
export const ownerMemberDetailRoute = createRoute({
  method: 'get',
  path: '/owner/members/{membershipId}',
  middleware: [requireRole('admin_tenant')] as const,
  request: { params: ownerMemberParamSchema },
  responses: {
    200: {
      description:
        "One member's detail: `{ state: 'preparing' }` before the first build, else `{ state: 'ready', snapshot, member, topCommunity?, bandHistory, last30, weeklyActiveDays, communities?, postTypes, events?, purchases?, support?, suggestion }`. `bandHistory` holds the bands at D-60, D-30 and D (null before joining); `last30.dailyMinutes` and `last30.postsSeen` are not measured; `events` (events on), `purchases` (store on; `expiresAt` never a date) and `support` (chat on; counts and minutes only) are read live up to the snapshot's `untilAt`; `topCommunity` and `communities` only with communities on. No comment or message text ever travels in it.",
      content: { 'application/json': { schema: ownerMemberDetailAnswerSchema } },
    },
    400: { description: '`VALIDATION_FAILED`: the id is not a uuid.' },
    401: { description: '`UNAUTHENTICATED`: no session.' },
    403: {
      description:
        '`FORBIDDEN` for any role but `admin_tenant`; `TENANT_HOST_MISMATCH` for a session of another tenant.',
    },
    404: {
      description:
        '`NOT_FOUND`, with no details: no member of this tenant has that membership id (unknown, another tenant, or staff).',
    },
  },
});

/**
 * 08.7-04 (D-461, D-462, PD-9, INSIGHT-09): the rows behind one number of a member's detail.
 * "Publicações vistas" has no list (the `list` enum refuses it, 400).
 */
export const ownerMemberListRoute = createRoute({
  method: 'get',
  path: '/owner/members/{membershipId}/lists/{list}',
  middleware: [requireRole('admin_tenant')] as const,
  request: { params: ownerMemberListParamSchema, query: ownerMemberListQuerySchema },
  responses: {
    200: {
      description:
        "One member's own rows inside the newest snapshot's 30 days (`from30At <= at < untilAt`), most recent first: `{ state: 'preparing' }` before the first build, else `{ state: 'ready', snapshot, list, rows, nextCursor }`. `active-days` rows `{ day, actions }` (`day desc`); `likes` rows name the post, comment or story liked; `comments` rows name the post commented, never the comment's text; `strong-actions` rows are comments, check-ins and walk-ins, and paid orders. `limit` is clamped to 1..50 (20 by default); a malformed or tampered `cursor` reads page 1.",
      content: { 'application/json': { schema: ownerMemberListAnswerSchema } },
    },
    400: { description: '`VALIDATION_FAILED`: the id is not a uuid or the list is unknown.' },
    401: { description: '`UNAUTHENTICATED`: no session.' },
    403: {
      description:
        '`FORBIDDEN` for any role but `admin_tenant`; `TENANT_HOST_MISMATCH` for a session of another tenant.',
    },
    404: {
      description:
        '`NOT_FOUND`, with no details: no member of this tenant has that membership id (unknown, another tenant, or staff).',
    },
  },
});

/**
 * 08.7-06 (D-455, D-458, D-462, UI-D-473, UI-D-484, UI-D-488, INSIGHT-10): the Conteúdo area. Two
 * modules feed it, so there is no `requireModule`: the service answers 404 `MODULE_DISABLED` only
 * when `feed` AND `stories` are both off, and omits the part of the one that is off.
 */
export const ownerContentRoute = createRoute({
  method: 'get',
  path: '/owner/content',
  middleware: [requireRole('admin_tenant')] as const,
  responses: {
    200: {
      description:
        "The owner's Conteúdo from the tenant's newest snapshot: `{ state: 'preparing' }` before the first build or while the snapshot lacks its `content` key, else `{ state: 'ready', snapshot, kinds, items, byKind, kindMetrics, kpis?, interactorsByBand?, weeklyPerPost?, heatmap?, byCommunity? }`. `items` are the live posts and stories published in the snapshot's 30 days, newest first, with member likes and live member comments counted up to `untilAt` (never the feed's counters), a post's `commentMeta` (answered by a reply of a current `admin_tenant` or `support_tenant`) and a story's `views` / `reach` as measured totals of unique member viewers (who viewed is never sent). A post's `views`, `reach`, `saves`, every `shares`, the KPIs `rate`, `views`, `reach` and every `kindMetrics` entry are `{ measured: false, reason }`. The post part (KPIs with their previous-window raw values, `interactorsByBand`, `weeklyPerPost` raw sums, the 7 × 4 `heatmap` of 6-hour local slots) is present only while `feed` is on, `byCommunity` only while `communities` is on too. Captions, covers and community names are read live.",
      content: { 'application/json': { schema: ownerContentAnswerSchema } },
    },
    401: { description: '`UNAUTHENTICATED`: no session.' },
    403: {
      description:
        '`FORBIDDEN` for any role but `admin_tenant`; `TENANT_HOST_MISMATCH` for a session of another tenant.',
    },
    404: { description: '`MODULE_DISABLED`: `feed` and `stories` are both off.' },
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
  .openapi(ownerBandMembersRoute, async (c) => {
    const { band } = c.req.valid('param');
    const answer = await listOwnerBandMembers(c.get('ctx'), { ...c.req.valid('query'), band });
    c.header('Cache-Control', 'no-store');
    return c.json(ownerBandListAnswerSchema.parse(answer), 200);
  })
  .openapi(ownerMemberDetailRoute, async (c) => {
    const { membershipId } = c.req.valid('param');
    const answer = await getOwnerMemberDetail(c.get('ctx'), membershipId);
    c.header('Cache-Control', 'no-store');
    return c.json(ownerMemberDetailAnswerSchema.parse(answer), 200);
  })
  .openapi(ownerMemberListRoute, async (c) => {
    const { membershipId, list } = c.req.valid('param');
    const answer = await listOwnerMemberItems(
      c.get('ctx'),
      membershipId,
      list,
      c.req.valid('query'),
    );
    c.header('Cache-Control', 'no-store');
    return c.json(ownerMemberListAnswerSchema.parse(answer), 200);
  })
  .openapi(ownerContentRoute, async (c) => {
    const answer = await getOwnerContent(c.get('ctx'));
    c.header('Cache-Control', 'no-store');
    return c.json(ownerContentAnswerSchema.parse(answer), 200);
  })
  .openapi(memberActivityRoute, async (c) => {
    const answer = await getMemberActivity(c.get('ctx'));
    c.header('Cache-Control', 'no-store');
    return c.json(memberActivityAnswerSchema.parse(answer), 200);
  });
