import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { sql } from 'drizzle-orm';
import {
  type EngagementBandId,
  type MembersPayload,
  OWNER_BAND_PAGE_SIZE,
  type OwnerBandListAnswer,
  type OwnerBandListQuery,
  type OwnerBandMemberRow,
  type SnapshotMeta,
} from '../contracts/index';
import { readMembersPayload } from './members';
import { NEVER_ACTIVE, pageInput, pageOf } from './paging';
import { readLatestSnapshot, snapshotMetaOf } from './snapshot';

type Ctx = Pick<RequestContext, 'userId' | 'tenantId' | 'role'>;

/** Microsecond ISO instants: a keyset cursor must carry the exact stored value (no repeat, no skip). */
export const ISO_US = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

const DAILY_MINUTES = { measured: false, reason: 'needs_usage_sessions' } as const;

/** The newest build as the owner lists read it: its meta and its `members` payload, or nothing. */
export type SnapshotFrame = { snapshot: SnapshotMeta; members: MembersPayload };

/**
 * The tenant's newest snapshot read in the admin's lane (its admin-only policy applies), or `null`
 * when there is none yet or its windows / `members` key fail their contracts (an older payload
 * version): the caller answers `preparing`, never zeros.
 */
export async function readSnapshotFrame(tx: Tx, tenantId: string): Promise<SnapshotFrame | null> {
  const row = await readLatestSnapshot(tx, tenantId);
  if (!row) return null;
  const snapshot = snapshotMetaOf(row);
  const members = readMembersPayload(row.payload);
  return snapshot && members ? { snapshot, members } : null;
}

export type OwnerBandListInput = OwnerBandListQuery & { band: EngagementBandId };

type BandRowDb = {
  membership_id: string;
  display_name: string;
  avatar_asset_id: string | null;
  joined_at: string;
  last_active_at: string | null;
  top_community_id: string | null;
  top_community_name: string | null;
};

/**
 * `GET /v1/dashboard/owner/members/bands/{band}` (08.7-04, D-462, D-460, INSIGHT-09, EP-21..EP-26):
 * the members of one band of the newest build, in one of three scopes.
 *
 * - The module flags are read FIRST, before the lane (the A-WR-03 order). `scope=community` with
 *   `communities` off and `scope=event` with `events` off answer 404 `MODULE_DISABLED` (D-460).
 * - `scopeId` must be a live community or event OF THIS TENANT (explicit predicate beside RLS): an
 *   absent, unknown or foreign one is the bare 404 `NOT_FOUND`, the same answer for all three
 *   (T-08.7-12). It is checked before the snapshot, so a foreign id is a 404 even before a build.
 * - Band membership is the member rows' (planning decision 1): `base` reads `band`, `community`
 *   reads `community_bands ->> scopeId`, `event` reads `band` of the members whose RSVP "vou"
 *   (`going` or `checked_in`) for that event was answered before the snapshot's `untilAt` — the
 *   same predicate `app.dashboard_area_members` counts with. Only memberships still of role
 *   `member` are listed (a staff membership is never answered as a member, D-462).
 * - `total` is that band's count in the same build's `payload.members` (EP-26); for a community or
 *   an event the payload does not hold (an archived community, an event outside the panel's), it
 *   is counted over the same rows with the same predicate.
 * - Order `last_active_at desc nulls last, membership_id desc` (EP-25), keyset over
 *   `(coalesce(last_active_at, '-infinity'), membership_id)` so equal instants are split by id and
 *   a cursor neither repeats nor skips a row (EP-22). Names and avatars are read live (PR-1).
 */
export async function listOwnerBandMembers(
  ctx: Ctx,
  input: OwnerBandListInput,
): Promise<OwnerBandListAnswer> {
  const flags = await moduleFlags.flags(ctx);
  const communitiesOn = flags.keys.has('communities');
  if (input.scope === 'community' && !communitiesOn) throw new ApiError(404, 'MODULE_DISABLED');
  if (input.scope === 'event' && !flags.keys.has('events')) {
    throw new ApiError(404, 'MODULE_DISABLED');
  }
  const scopeId = input.scope === 'base' ? null : (input.scopeId ?? null);
  if (input.scope !== 'base' && scopeId === null) throw new ApiError(404, 'NOT_FOUND');
  const { limit, after } = pageInput(input, OWNER_BAND_PAGE_SIZE, 'last-active');

  return withTenantTx(ctx, async (tx) => {
    if (scopeId !== null && !(await scopeExists(tx, ctx.tenantId, input.scope, scopeId))) {
      throw new ApiError(404, 'NOT_FOUND');
    }
    const frame = await readSnapshotFrame(tx, ctx.tenantId);
    if (!frame) return { state: 'preparing' } as const;
    const { snapshot, members } = frame;

    const inBand =
      input.scope === 'community'
        ? sql`s.community_bands ->> ${scopeId}::text = ${input.band}`
        : input.scope === 'event'
          ? sql`s.band = ${input.band}
              and exists (
                select 1 from public.event_attendances ea
                 where ea.tenant_id = s.tenant_id
                   and ea.event_id = ${scopeId}::uuid
                   and ea.user_id = s.user_id
                   and ea.status in ('going', 'checked_in')
                   and ea.responded_at < ${snapshot.windows.untilAt}::timestamptz)`
          : sql`s.band = ${input.band}`;
    const fromMemberRows = sql`
      from public.dashboard_member_snapshots s
      join public.memberships ms
        on ms.id = s.membership_id
       and ms.tenant_id = s.tenant_id
       and ms.role = 'member'
       and ms.deleted_at is null`;
    const whereInBand = sql`
     where s.tenant_id = ${ctx.tenantId}::uuid
       and s.snapshot_day = ${snapshot.day}::date
       and ${inBand}`;

    const afterN = after ? (after.n === NEVER_ACTIVE ? '-infinity' : after.n) : null;
    const rows = await tx.execute<BandRowDb>(sql`
      select s.membership_id::text as membership_id,
             coalesce(mp.display_name, '') as display_name,
             mp.avatar_asset_id::text as avatar_asset_id,
             to_char(ms.joined_at at time zone 'UTC', ${ISO_US}) as joined_at,
             to_char(s.last_active_at at time zone 'UTC', ${ISO_US}) as last_active_at,
             tc.id::text as top_community_id,
             tc.name as top_community_name
        ${fromMemberRows}
        left join public.member_profiles mp
          on mp.tenant_id = s.tenant_id and mp.membership_id = s.membership_id
        left join public.communities tc
          on tc.tenant_id = s.tenant_id and tc.id = s.top_community_id and tc.deleted_at is null
        ${whereInBand}
         and (
           ${afterN}::timestamptz is null
           or (coalesce(s.last_active_at, '-infinity'::timestamptz), s.membership_id)
              < (${afterN}::timestamptz, ${after?.id ?? null}::uuid)
         )
       order by coalesce(s.last_active_at, '-infinity'::timestamptz) desc, s.membership_id desc
       limit ${limit + 1}`);

    const stored =
      input.scope === 'base'
        ? members.engagement
        : input.scope === 'community'
          ? members.communityEngagement.find((entry) => entry.id === scopeId)?.bands
          : members.eventEngagement.find((entry) => entry.id === scopeId)?.bands;
    let total = stored?.counts[input.band];
    if (total === undefined) {
      const counted = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n ${fromMemberRows} ${whereInBand}`);
      total = Number(counted[0]?.n ?? 0);
    }

    const page = pageOf(rows, limit, (row) => ({
      n: row.last_active_at ?? NEVER_ACTIVE,
      id: row.membership_id,
    }));
    return {
      state: 'ready',
      snapshot,
      total,
      rows: page.rows.map(
        (row): OwnerBandMemberRow => ({
          membershipId: row.membership_id,
          displayName: row.display_name,
          avatarAssetId: row.avatar_asset_id,
          joinedAt: row.joined_at,
          lastActiveAt: row.last_active_at,
          topCommunity:
            communitiesOn && row.top_community_id && row.top_community_name !== null
              ? { id: row.top_community_id, name: row.top_community_name }
              : null,
          dailyMinutes: DAILY_MINUTES,
        }),
      ),
      nextCursor: page.nextCursor,
    };
  });
}

/** A live community or event of this tenant (the explicit tenant predicate repeats RLS's). */
async function scopeExists(
  tx: Tx,
  tenantId: string,
  scope: OwnerBandListQuery['scope'],
  scopeId: string,
): Promise<boolean> {
  const rows =
    scope === 'community'
      ? await tx.execute<{ id: string }>(sql`
          select c.id::text as id from public.communities c
           where c.id = ${scopeId}::uuid and c.tenant_id = ${tenantId}::uuid
             and c.deleted_at is null`)
      : await tx.execute<{ id: string }>(sql`
          select e.id::text as id from public.events e
           where e.id = ${scopeId}::uuid and e.tenant_id = ${tenantId}::uuid
             and e.deleted_at is null`);
  return rows.length > 0;
}
