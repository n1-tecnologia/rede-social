import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { moduleLogger } from '@rede-social/core/server/logging';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { sql } from 'drizzle-orm';
import {
  MEMBER_ACTIVITY_NOT_MEASURED,
  type MemberActivityAnswer,
  type MemberActivityCommunity,
  type MemberActivityPayload,
  type MemberActivityReady,
  memberActivityPayloadSchema,
} from '../contracts/index';

type Ctx = Pick<RequestContext, 'userId' | 'tenantId' | 'role'>;

// A child of the kernel root (WR-12): severity-formatted, LOG_LEVEL-aware — never a bare pino().
const log = moduleLogger('module-dashboard');

/**
 * `GET /v1/dashboard/activity` (08.7-03, D-463, D-455, D-458, INSIGHT-01..05, INSIGHT-16): the
 * member's OWN "Sua atividade" from their member row of the tenant's newest build.
 *
 * - No parameter exists: the row is selected by the lane's own claims (`tenant_id = app.tenant_id()
 *   and user_id = app.user_id()`), behind the own-or-admin select policy (T-08.7-09). The route is
 *   member-only, so the admin branch of that policy is never reached from here.
 * - The module flags are read FIRST, before the lane opens (the A-WR-03 order).
 * - No member row (joined after the last build), or a null or invalid `activity` → `preparing`,
 *   never a sample, a zero or a dash (INSIGHT-16).
 * - `byCommunity` only while `communities` is on, `attendance` only while `events` is on
 *   (planning decision 4). Community names are joined LIVE in the member's lane; a community the
 *   lane cannot read (deleted since) is dropped, never shown as an id or a placeholder (EP-07).
 * - One log line, ids only (PR-1): never a number of the member's activity.
 */
export async function getMemberActivity(ctx: Ctx): Promise<MemberActivityAnswer> {
  const flags = await moduleFlags.flags(ctx);
  const communitiesOn = flags.keys.has('communities');
  const eventsOn = flags.keys.has('events');
  const answer = await withTenantTx(ctx, async (tx): Promise<MemberActivityAnswer> => {
    const rows = await tx.execute<{
      snapshot_day: string;
      built_at: string;
      activity: unknown;
    }>(sql`
      select s.snapshot_day::text as snapshot_day,
             to_char(s.built_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as built_at,
             s.activity
        from public.dashboard_member_snapshots s
       where s.tenant_id = app.tenant_id()
         and s.user_id = app.user_id()`);
    const row = rows[0];
    if (!row) return { state: 'preparing' };
    const parsed = memberActivityPayloadSchema.safeParse(row.activity);
    if (!parsed.success) return { state: 'preparing' };
    const activity = parsed.data;

    const ready: MemberActivityReady = {
      state: 'ready',
      snapshot: { day: row.snapshot_day, builtAt: row.built_at },
      likes: activity.likes,
      comments: activity.comments,
      saves: MEMBER_ACTIVITY_NOT_MEASURED.saves,
      shares: MEMBER_ACTIVITY_NOT_MEASURED.shares,
      usage: MEMBER_ACTIVITY_NOT_MEASURED.usage,
      seen: {
        stories: activity.storiesSeen,
        posts: MEMBER_ACTIVITY_NOT_MEASURED.posts,
        videos: MEMBER_ACTIVITY_NOT_MEASURED.videos,
      },
      weekStreak: activity.weekStreak,
    };
    if (communitiesOn) ready.byCommunity = await withCommunityNames(tx, activity.byCommunity);
    if (eventsOn) ready.attendance = activity.attendance;
    return ready;
  });
  log.info(
    {
      event: 'dashboard.activity.read',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      state: answer.state,
    },
    'member activity read',
  );
  return answer;
}

/** `{a,b,c}`: a Postgres array literal of ids the contract already validated as uuids. */
function uuidArray(ids: readonly string[]): string {
  return `{${ids.join(',')}}`;
}

/**
 * The stored rows with each community's live name (exactly as stored in `communities.name`, EP-07),
 * the tenant-wide feed kept as `{ communityId: null, name: null }`; unreadable communities dropped.
 * Ordered most interactions first, then by name (pt-BR) and id, so two renders of the same snapshot
 * agree (EP-05, EP-08); the web re-ranks with the "Início" label in place of the null name.
 */
async function withCommunityNames(
  tx: Tx,
  entries: MemberActivityPayload['byCommunity'],
): Promise<MemberActivityCommunity[]> {
  const ids = entries.flatMap((entry) => (entry.communityId ? [entry.communityId] : []));
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const rows = await tx.execute<{ id: string; name: string }>(sql`
      select c.id::text as id, c.name
        from public.communities c
       where c.tenant_id = app.tenant_id()
         and c.id = any (${uuidArray(ids)}::uuid[])
         and c.deleted_at is null`);
    for (const row of rows) names.set(row.id, row.name);
  }
  return entries
    .flatMap((entry): MemberActivityCommunity[] => {
      if (entry.interactions === 0) return [];
      if (entry.communityId === null) {
        return [{ communityId: null, name: null, interactions: entry.interactions }];
      }
      const name = names.get(entry.communityId);
      return name
        ? [{ communityId: entry.communityId, name, interactions: entry.interactions }]
        : [];
    })
    .sort(
      (a, b) =>
        b.interactions - a.interactions ||
        (a.name ?? '').localeCompare(b.name ?? '', 'pt-BR') ||
        (a.communityId ?? '').localeCompare(b.communityId ?? ''),
    );
}
