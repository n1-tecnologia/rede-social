import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  type EngagementBandId,
  engagementBandSchema,
  OWNER_POST_TYPES,
  type OwnerMemberDetailAnswer,
  type OwnerMemberDetailReady,
  type SnapshotMeta,
} from '../contracts/index';
import { ISO_US, readSnapshotFrame } from './member-lists';

type Ctx = Pick<RequestContext, 'userId' | 'tenantId' | 'role'>;

/** The detail's live lists stop at this many rows (one member's history, T-08.7-15). */
const DETAIL_ROWS = 50;
/** Support turns are counted over the 8 weeks (56 tenant-local days) ending D. */
const SUPPORT_DAYS = 56;

const count = z.number().int().nonnegative();

/**
 * The `insights` jsonb of a member row as `app.dashboard_member_rows` writes it (08.7-02 planning
 * decision 4). Parsed, never trusted: a row of another shape answers `preparing`.
 */
const storedInsightsSchema = z.object({
  last30: z.object({
    activeDays: count,
    likes: count,
    comments: count,
    checkIns: count,
    orders: count,
    strongActions: count,
  }),
  weeklyActiveDays: z.array(count).length(12),
  communities: z.array(z.object({ id: z.uuid().nullable(), actions: count })),
  postTypes: z.array(z.object({ type: z.enum(OWNER_POST_TYPES), interactions: count })),
});

type MemberDb = {
  membership_id: string;
  user_id: string;
  display_name: string;
  avatar_asset_id: string | null;
  joined_at: string;
  last_active_at: string | null;
  band: string;
  band_d30: string | null;
  band_d60: string | null;
  top_community_id: string | null;
  insights: unknown;
  days_since_joined: number;
  days_since_active: number | null;
  timezone: string;
};

const bandOf = (value: string | null): EngagementBandId | null => {
  const parsed = engagementBandSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

/** `YYYY-MM` of `day` (an ISO date) minus `days` calendar days. */
function monthOf(day: string, days: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() - days);
  return at.toISOString().slice(0, 7);
}

/**
 * `GET /v1/dashboard/owner/members/{membershipId}` (08.7-04, D-462, D-460, D-461, INSIGHT-09): one
 * member's detail from their row of the newest build, plus live events, purchases and support counts.
 *
 * - Flags are read FIRST, before the lane (A-WR-03). Module-gated parts are OMITTED, never zeroed
 *   (planning decision 3): `topCommunity` / `communities` (communities), `events` (events),
 *   `purchases` (store), `support` (chat).
 * - The membership must be a role-`member`, not deleted, membership of THIS tenant (explicit
 *   predicate beside RLS), checked FIRST: an unknown uuid, another tenant's membership and a staff
 *   membership are the same `ApiError(404, 'NOT_FOUND')` with no details, before or after any
 *   build (EP-17). A member of this tenant with no row in the newest build (joined after it), or
 *   no build yet, is `preparing`.
 * - Every live read is bounded by the snapshot's `untilAt`, never `now()`. Names, titles and the
 *   product's name are read live (PR-1). Support is counts and minutes only (T-08.7-14).
 */
export async function getOwnerMemberDetail(
  ctx: Ctx,
  membershipId: string,
): Promise<OwnerMemberDetailAnswer> {
  const flags = await moduleFlags.flags(ctx);
  const on = {
    communities: flags.keys.has('communities'),
    events: flags.keys.has('events'),
    store: flags.keys.has('store'),
    chat: flags.keys.has('chat'),
  };

  return withTenantTx(ctx, async (tx) => {
    // EP-17 first, before the snapshot: a foreign or unknown id is the bare 404 in every state.
    if (!(await isTenantMember(tx, ctx.tenantId, membershipId))) {
      throw new ApiError(404, 'NOT_FOUND');
    }
    const frame = await readSnapshotFrame(tx, ctx.tenantId);
    if (!frame) return { state: 'preparing' } as const;
    const { snapshot } = frame;

    const [member] = await tx.execute<MemberDb>(sql`
      select s.membership_id::text as membership_id,
             s.user_id::text as user_id,
             coalesce(mp.display_name, '') as display_name,
             mp.avatar_asset_id::text as avatar_asset_id,
             to_char(ms.joined_at at time zone 'UTC', ${ISO_US}) as joined_at,
             to_char(s.last_active_at at time zone 'UTC', ${ISO_US}) as last_active_at,
             s.band, s.band_d30, s.band_d60,
             s.top_community_id::text as top_community_id,
             s.insights,
             greatest(${snapshot.day}::date - (ms.joined_at at time zone t.timezone)::date, 0)::int
               as days_since_joined,
             -- greatest() skips nulls, so a member who never acted keeps a null here.
             case when s.last_active_at is not null then
               greatest(${snapshot.day}::date - (s.last_active_at at time zone t.timezone)::date, 0)::int
             end as days_since_active,
             t.timezone
        from public.dashboard_member_snapshots s
        join public.memberships ms
          on ms.id = s.membership_id
         and ms.tenant_id = s.tenant_id
         and ms.role = 'member'
         and ms.deleted_at is null
        join public.tenants t on t.id = s.tenant_id
        left join public.member_profiles mp
          on mp.tenant_id = s.tenant_id and mp.membership_id = s.membership_id
       where s.tenant_id = ${ctx.tenantId}::uuid
         and s.membership_id = ${membershipId}::uuid`);
    // A member of this tenant with no row in the newest build (joined after it): not yet built.
    if (!member) return { state: 'preparing' } as const;

    const band = bandOf(member.band);
    const insights = storedInsightsSchema.safeParse(member.insights);
    if (!band || !insights.success) return { state: 'preparing' } as const;
    const stored = insights.data;

    const answer: OwnerMemberDetailReady = {
      state: 'ready',
      snapshot,
      member: {
        membershipId: member.membership_id,
        displayName: member.display_name,
        avatarAssetId: member.avatar_asset_id,
        joinedAt: member.joined_at,
        lastActiveAt: member.last_active_at,
        band,
      },
      bandHistory: [
        { month: monthOf(snapshot.day, 60), band: bandOf(member.band_d60) },
        { month: monthOf(snapshot.day, 30), band: bandOf(member.band_d30) },
        { month: monthOf(snapshot.day, 0), band },
      ],
      last30: {
        ...stored.last30,
        dailyMinutes: { measured: false, reason: 'needs_usage_sessions' },
        postsSeen: { measured: false, reason: 'needs_post_views' },
      },
      weeklyActiveDays: stored.weeklyActiveDays,
      postTypes: stored.postTypes,
      suggestion: {
        kind: band,
        days:
          band === 'new' || member.days_since_active === null
            ? member.days_since_joined
            : member.days_since_active,
      },
    };

    if (on.communities) {
      const names = await communityNames(
        tx,
        ctx.tenantId,
        stored.communities.flatMap((entry) => (entry.id ? [entry.id] : [])),
      );
      answer.communities = stored.communities.flatMap(
        (entry): NonNullable<OwnerMemberDetailReady['communities']> => {
          if (entry.id === null) return [{ communityId: null, name: null, actions: entry.actions }];
          const name = names.get(entry.id);
          return name === undefined
            ? []
            : [{ communityId: entry.id, name, actions: entry.actions }];
        },
      );
      const topName = member.top_community_id ? names.get(member.top_community_id) : undefined;
      answer.topCommunity =
        member.top_community_id && topName !== undefined
          ? { id: member.top_community_id, name: topName }
          : null;
    }
    if (on.events) answer.events = await memberEvents(tx, ctx.tenantId, member.user_id, snapshot);
    if (on.store) {
      answer.purchases = await memberPurchases(tx, ctx.tenantId, member.user_id, snapshot);
    }
    if (on.chat) answer.support = await memberSupport(tx, ctx.tenantId, member, snapshot);
    return answer;
  });
}

/**
 * A role-`member`, not deleted, membership of `tenantId`. Shared by the detail and the member lists:
 * the one gate between an id from the URL and anything read about that person.
 */
export async function isTenantMember(
  tx: Tx,
  tenantId: string,
  membershipId: string,
): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(sql`
    select ms.id::text as id from public.memberships ms
     where ms.id = ${membershipId}::uuid
       and ms.tenant_id = ${tenantId}::uuid
       and ms.role = 'member'
       and ms.deleted_at is null`);
  return rows.length > 0;
}

/** `{a,b,c}`: a Postgres array literal of ids the contract already validated as uuids. */
const uuidArray = (ids: readonly string[]) => `{${ids.join(',')}}`;

async function communityNames(
  tx: Tx,
  tenantId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.execute<{ id: string; name: string }>(sql`
    select c.id::text as id, c.name from public.communities c
     where c.tenant_id = ${tenantId}::uuid
       and c.id = any (${uuidArray(ids)}::uuid[])
       and c.deleted_at is null`);
  return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * The member's RSVPs "vou" (answered before `untilAt`) and walk-ins (checked in before it) on live,
 * active events, the latest `DETAIL_ROWS`, oldest first. `attended`: checked in before `untilAt` →
 * true; else the event ended before `untilAt` → false; else null (still to come at the snapshot).
 */
async function memberEvents(tx: Tx, tenantId: string, userId: string, snapshot: SnapshotMeta) {
  const untilAt = snapshot.windows.untilAt;
  const rows = await tx.execute<{
    event_id: string;
    title: string;
    starts_at: string;
    checked_in: boolean;
    ended: boolean;
  }>(sql`
    select e.id::text as event_id, e.title,
           to_char(e.starts_at at time zone 'UTC', ${ISO_US}) as starts_at,
           (ea.status in ('checked_in', 'walk_in') and ea.checked_in_at < ${untilAt}::timestamptz)
             as checked_in,
           (e.ends_at <= ${untilAt}::timestamptz) as ended
      from public.event_attendances ea
      join public.events e on e.id = ea.event_id and e.tenant_id = ea.tenant_id
     where ea.tenant_id = ${tenantId}::uuid
       and ea.user_id = ${userId}::uuid
       and e.status = 'active'
       and e.deleted_at is null
       and (
         (ea.status in ('going', 'checked_in') and ea.responded_at < ${untilAt}::timestamptz)
         or (ea.status = 'walk_in' and ea.checked_in_at < ${untilAt}::timestamptz)
       )
     order by e.starts_at desc, e.id desc
     limit ${DETAIL_ROWS}`);
  return rows.reverse().map((row) => ({
    eventId: row.event_id,
    title: row.title,
    startsAt: row.starts_at,
    attended: row.checked_in ? true : row.ended ? false : null,
  }));
}

/**
 * The member's paid orders before `untilAt`, the latest `DETAIL_ROWS`, oldest first. `primary` is
 * the member's FIRST paid order of the tenant (by `paid_at, id`), every other one `secondary`. A
 * revoked order is not paid. `expiresAt` is never a date (`needs_access_expiry`).
 */
async function memberPurchases(tx: Tx, tenantId: string, userId: string, snapshot: SnapshotMeta) {
  const rows = await tx.execute<{
    order_id: string;
    product_id: string;
    product_name: string;
    cents: number;
    paid_at: string;
    rn: number;
  }>(sql`
    with paid as (
      select o.id, o.product_id, o.amount_cents, o.paid_at,
             row_number() over (order by o.paid_at, o.id) as rn
        from public.store_orders o
       where o.tenant_id = ${tenantId}::uuid
         and o.user_id = ${userId}::uuid
         and o.status = 'paid'
         and o.paid_at is not null
    )
    select paid.id::text as order_id, paid.product_id::text as product_id, p.name as product_name,
           paid.amount_cents::int as cents,
           to_char(paid.paid_at at time zone 'UTC', ${ISO_US}) as paid_at,
           paid.rn::int as rn
      from paid
      join public.store_products p on p.id = paid.product_id and p.tenant_id = ${tenantId}::uuid
     where paid.paid_at < ${snapshot.windows.untilAt}::timestamptz
     order by paid.paid_at desc, paid.id desc
     limit ${DETAIL_ROWS}`);
  return rows.reverse().map((row) => ({
    orderId: row.order_id,
    productId: row.product_id,
    productName: row.product_name,
    kind: Number(row.rn) === 1 ? ('primary' as const) : ('secondary' as const),
    paidAt: row.paid_at,
    cents: Number(row.cents),
    expiresAt: { measured: false as const, reason: 'needs_access_expiry' as const },
  }));
}

/**
 * The member's support of the 8 weeks (`SUPPORT_DAYS` tenant-local days) ending D: counts and
 * minutes only, never a word (T-08.7-14). One support thread per member exists, so a "conversation"
 * here is a member TURN — the first member message after a staff message (or the thread's first) —
 * the same turn the Atendimento medians use. `lastDaysAgo` = D minus the local day of the latest
 * turn; `medianResponseMinutes` = the median minutes from a turn to the next staff message before
 * `untilAt`, rounded; null without an answered turn. Deleted messages are ignored.
 */
async function memberSupport(tx: Tx, tenantId: string, member: MemberDb, snapshot: SnapshotMeta) {
  const untilAt = snapshot.windows.untilAt;
  const [row] = await tx.execute<{
    conversations: number;
    last_days_ago: number | null;
    median_minutes: number | null;
  }>(sql`
    with msgs as (
      select m.conversation_id, m.seq, m.created_at, m.author_side,
             lag(m.author_side) over (partition by m.conversation_id order by m.seq) as prev_side
        from public.chat_messages m
        join public.chat_conversations c
          on c.id = m.conversation_id and c.tenant_id = m.tenant_id
       where m.tenant_id = ${tenantId}::uuid
         and c.kind = 'support'
         and c.created_by_user_id = ${member.user_id}::uuid
         and m.deleted_at is null
         and m.created_at < ${untilAt}::timestamptz
    ),
    turns as (
      select t.created_at as started_at,
             (select min(s.created_at) from msgs s
               where s.conversation_id = t.conversation_id and s.seq > t.seq
                 and s.author_side = 'staff') as answered_at
        from msgs t
       where t.author_side = 'member'
         and (t.prev_side is null or t.prev_side = 'staff')
         and t.created_at >= ((${snapshot.day}::date - ${SUPPORT_DAYS - 1}::int)::timestamp
                               at time zone ${member.timezone})
    )
    select count(*)::int as conversations,
           (${snapshot.day}::date - (max(started_at) at time zone ${member.timezone})::date)::int
             as last_days_ago,
           round((percentile_cont(0.5) within group (
             order by extract(epoch from answered_at - started_at) / 60)
             filter (where answered_at is not null))::numeric)::int as median_minutes
      from turns`);
  return {
    conversations: Number(row?.conversations ?? 0),
    lastDaysAgo:
      row?.last_days_ago === null || row === undefined ? null : Number(row.last_days_ago),
    medianResponseMinutes:
      row?.median_minutes === null || row === undefined ? null : Number(row.median_minutes),
  };
}
