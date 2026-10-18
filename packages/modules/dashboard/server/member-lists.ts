import { cutOnWord } from '@rede-social/contracts/text';
import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { type SQL, sql } from 'drizzle-orm';
import {
  type EngagementBandId,
  type MembersPayload,
  OWNER_BAND_PAGE_SIZE,
  OWNER_MEMBER_LIST_PAGE_SIZE,
  OWNER_POST_EXCERPT_GRAPHEMES,
  type OwnerActiveDayRow,
  type OwnerBandListAnswer,
  type OwnerBandListQuery,
  type OwnerBandMemberRow,
  type OwnerCommentRow,
  type OwnerLikeRow,
  type OwnerListPost,
  type OwnerMemberListAnswer,
  type OwnerMemberListId,
  type OwnerMemberListQuery,
  type OwnerPostType,
  type OwnerStrongActionRow,
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

/**
 * A role-`member`, not deleted, membership of `tenantId` (explicit predicate beside RLS), with the
 * person's user id and the tenant's timezone, or `null`. Shared by the detail and the member
 * lists: the one gate between an id from the URL and anything read about that person (EP-17).
 */
export async function tenantMember(
  tx: Tx,
  tenantId: string,
  membershipId: string,
): Promise<{ userId: string; timezone: string } | null> {
  const [row] = await tx.execute<{ user_id: string; timezone: string }>(sql`
    select ms.user_id::text as user_id, t.timezone
      from public.memberships ms
      join public.tenants t on t.id = ms.tenant_id
     where ms.id = ${membershipId}::uuid
       and ms.tenant_id = ${tenantId}::uuid
       and ms.role = 'member'
       and ms.deleted_at is null`);
  return row ? { userId: row.user_id, timezone: row.timezone } : null;
}

/** The post columns a list row names, from `p` (a live post) and its first image or video. */
const postColumns = sql`
  p.id::text as post_id_live,
  case when p.id is null then null
       when p.media_kind = 'video' then 'video'
       when p.media_kind = 'gallery' then 'gallery'
       when p.link_preview_id is not null then 'link'
       else 'text' end as post_kind,
  p.caption as post_caption,
  to_char(p.created_at at time zone 'UTC', ${ISO_US}) as post_created_at,
  (select pm.media_asset_id::text from public.feed_post_media pm
    where pm.tenant_id = p.tenant_id and pm.post_id = p.id and pm.kind in ('image', 'video')
    order by pm.kind, pm.position, pm.id limit 1) as post_cover`;

type PostDb = {
  post_id_live: string | null;
  post_kind: OwnerPostType | null;
  post_caption: string | null;
  post_created_at: string | null;
  post_cover: string | null;
};

const postOf = (row: PostDb): OwnerListPost | null =>
  row.post_id_live && row.post_kind && row.post_created_at
    ? {
        id: row.post_id_live,
        kind: row.post_kind,
        excerpt: cutOnWord(row.post_caption ?? '', OWNER_POST_EXCERPT_GRAPHEMES),
        createdAt: row.post_created_at,
        coverAssetId: row.post_cover,
      }
    : null;

type Window = { tenantId: string; userId: string; fromAt: string; untilAt: string };

/** `(at, id) < (n, id)` when a cursor is present, else true: the `at desc, id desc` keyset. */
const keysetBefore = (at: SQL, id: SQL, after: { n: string; id: string } | null) =>
  after ? sql`(${at}, ${id}) < (${after.n}::timestamptz, ${after.id}::uuid)` : sql`true`;

/**
 * `GET /v1/dashboard/owner/members/{membershipId}/lists/{list}` (08.7-04, D-461, D-462, PD-9,
 * INSIGHT-09, EP-21, EP-24, EP-25): the member's OWN rows behind one number of their detail,
 * read live in the admin's lane between the snapshot's `from30At` and `untilAt` (never `now()`),
 * with the SAME predicates as `app.dashboard_member_actions`, so a list agrees with its number:
 *
 * - `likes`: every `feed_likes` row (post, comment or story; a like on content deleted since still
 *   counts and names no post);
 * - `comments`: LIVE comments only (`deleted_at is null`: removed and self-deleted never count);
 *   the row names the post, never the comment's text (PD-9);
 * - `strong-actions`: live comments, check-ins and walk-ins by `checked_in_at`, paid orders by
 *   `paid_at` (members cannot post in V1);
 * - `active-days`: the tenant-local days with a counted action (also likes, RSVPs "vou" by
 *   `responded_at` and live posts), with that day's count.
 *
 * The membership is checked FIRST (the bare 404 of EP-17, before any build); no build → preparing.
 * Order `at desc, id desc` (`day desc` for active days), opaque cursor whose `n` is an ISO instant
 * (a date for active days), `limit` 1..50, 20 by default.
 */
export async function listOwnerMemberItems(
  ctx: Ctx,
  membershipId: string,
  list: OwnerMemberListId,
  input: OwnerMemberListQuery,
): Promise<OwnerMemberListAnswer> {
  const { limit, after } = pageInput(
    input,
    OWNER_MEMBER_LIST_PAGE_SIZE,
    list === 'active-days' ? 'date' : 'instant',
  );
  return withTenantTx(ctx, async (tx) => {
    const member = await tenantMember(tx, ctx.tenantId, membershipId);
    if (!member) throw new ApiError(404, 'NOT_FOUND');
    const frame = await readSnapshotFrame(tx, ctx.tenantId);
    if (!frame) return { state: 'preparing' } as const;
    const { snapshot } = frame;
    const w: Window = {
      tenantId: ctx.tenantId,
      userId: member.userId,
      fromAt: snapshot.windows.from30At,
      untilAt: snapshot.windows.untilAt,
    };
    const base = { state: 'ready' as const, snapshot };

    if (list === 'active-days') {
      const rows = await activeDays(tx, w, member.timezone, after?.n ?? null, limit + 1);
      const page = pageOf(rows, limit, (row) => ({ n: row.day, id: membershipId }));
      return { ...base, list, rows: page.rows, nextCursor: page.nextCursor };
    }
    if (list === 'likes') {
      const rows = await likes(tx, w, after, limit + 1);
      const page = pageOf(rows, limit, (row) => ({ n: row.at, id: row.id }));
      return { ...base, list, rows: page.rows, nextCursor: page.nextCursor };
    }
    if (list === 'comments') {
      const rows = await comments(tx, w, after, limit + 1);
      const page = pageOf(rows, limit, (row) => ({ n: row.at, id: row.id }));
      return { ...base, list, rows: page.rows, nextCursor: page.nextCursor };
    }
    const rows = await strongActions(tx, w, after, limit + 1);
    const page = pageOf(rows, limit, (row) => ({ n: row.at, id: row.id }));
    return { ...base, list, rows: page.rows, nextCursor: page.nextCursor };
  });
}

async function activeDays(
  tx: Tx,
  w: Window,
  timezone: string,
  afterDay: string | null,
  take: number,
): Promise<OwnerActiveDayRow[]> {
  const rows = await tx.execute<{ day: string; actions: number }>(sql`
    with a as (
      select l.created_at as at from public.feed_likes l
       where l.tenant_id = ${w.tenantId}::uuid and l.user_id = ${w.userId}::uuid
         and l.created_at >= ${w.fromAt}::timestamptz and l.created_at < ${w.untilAt}::timestamptz
      union all
      select c.created_at from public.feed_comments c
       where c.tenant_id = ${w.tenantId}::uuid and c.author_user_id = ${w.userId}::uuid
         and c.deleted_at is null
         and c.created_at >= ${w.fromAt}::timestamptz and c.created_at < ${w.untilAt}::timestamptz
      union all
      select p.created_at from public.feed_posts p
       where p.tenant_id = ${w.tenantId}::uuid and p.author_user_id = ${w.userId}::uuid
         and p.deleted_at is null
         and p.created_at >= ${w.fromAt}::timestamptz and p.created_at < ${w.untilAt}::timestamptz
      union all
      select ea.responded_at from public.event_attendances ea
       where ea.tenant_id = ${w.tenantId}::uuid and ea.user_id = ${w.userId}::uuid
         and ea.status in ('going', 'checked_in')
         and ea.responded_at >= ${w.fromAt}::timestamptz
         and ea.responded_at < ${w.untilAt}::timestamptz
      union all
      select ea.checked_in_at from public.event_attendances ea
       where ea.tenant_id = ${w.tenantId}::uuid and ea.user_id = ${w.userId}::uuid
         and ea.status in ('checked_in', 'walk_in')
         and ea.checked_in_at >= ${w.fromAt}::timestamptz
         and ea.checked_in_at < ${w.untilAt}::timestamptz
      union all
      select o.paid_at from public.store_orders o
       where o.tenant_id = ${w.tenantId}::uuid and o.user_id = ${w.userId}::uuid
         and o.status = 'paid'
         and o.paid_at >= ${w.fromAt}::timestamptz and o.paid_at < ${w.untilAt}::timestamptz
    ),
    d as (
      select (a.at at time zone ${timezone})::date as day, count(*)::int as actions
        from a group by 1
    )
    select d.day::text as day, d.actions
      from d
     where ${afterDay}::date is null or d.day < ${afterDay}::date
     order by d.day desc
     limit ${take}`);
  return rows.map((row) => ({ day: row.day, actions: Number(row.actions) }));
}

async function likes(
  tx: Tx,
  w: Window,
  after: { n: string; id: string } | null,
  take: number,
): Promise<OwnerLikeRow[]> {
  const rows = await tx.execute<
    PostDb & {
      id: string;
      at: string;
      target_kind: 'post' | 'comment' | 'story';
      target_post_id: string | null;
      target_story_id: string | null;
    }
  >(sql`
    select l.id::text as id,
           to_char(l.created_at at time zone 'UTC', ${ISO_US}) as at,
           case when l.post_id is not null then 'post'
                when l.comment_id is not null then 'comment'
                else 'story' end as target_kind,
           coalesce(l.post_id, c.post_id)::text as target_post_id,
           coalesce(l.story_id, c.story_id)::text as target_story_id,
           ${postColumns}
      from public.feed_likes l
      left join public.feed_comments c on c.id = l.comment_id and c.tenant_id = l.tenant_id
      left join public.feed_posts p
        on p.id = coalesce(l.post_id, c.post_id) and p.tenant_id = l.tenant_id
       and p.deleted_at is null
     where l.tenant_id = ${w.tenantId}::uuid
       and l.user_id = ${w.userId}::uuid
       and l.created_at >= ${w.fromAt}::timestamptz
       and l.created_at < ${w.untilAt}::timestamptz
       and ${keysetBefore(sql`l.created_at`, sql`l.id`, after)}
     order by l.created_at desc, l.id desc
     limit ${take}`);
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    target: { kind: row.target_kind, postId: row.target_post_id, storyId: row.target_story_id },
    post: postOf(row),
  }));
}

async function comments(
  tx: Tx,
  w: Window,
  after: { n: string; id: string } | null,
  take: number,
): Promise<OwnerCommentRow[]> {
  const rows = await tx.execute<PostDb & { id: string; at: string; story_id: string | null }>(sql`
    select c.id::text as id,
           to_char(c.created_at at time zone 'UTC', ${ISO_US}) as at,
           c.story_id::text as story_id,
           ${postColumns}
      from public.feed_comments c
      left join public.feed_posts p
        on p.id = c.post_id and p.tenant_id = c.tenant_id and p.deleted_at is null
     where c.tenant_id = ${w.tenantId}::uuid
       and c.author_user_id = ${w.userId}::uuid
       and c.deleted_at is null
       and c.created_at >= ${w.fromAt}::timestamptz
       and c.created_at < ${w.untilAt}::timestamptz
       and ${keysetBefore(sql`c.created_at`, sql`c.id`, after)}
     order by c.created_at desc, c.id desc
     limit ${take}`);
  return rows.map((row) => ({ id: row.id, at: row.at, post: postOf(row), storyId: row.story_id }));
}

async function strongActions(
  tx: Tx,
  w: Window,
  after: { n: string; id: string } | null,
  take: number,
): Promise<OwnerStrongActionRow[]> {
  const rows = await tx.execute<
    PostDb & {
      kind: 'comment' | 'check_in' | 'order';
      id: string;
      at: string;
      story_id: string | null;
      event_id: string | null;
      event_title: string | null;
      product_id: string | null;
      product_name: string | null;
      cents: number | null;
    }
  >(sql`
    with s as (
      select 'comment'::text as kind, c.id, c.created_at as at, c.post_id, c.story_id,
             null::uuid as event_id, null::uuid as product_id, null::int as cents
        from public.feed_comments c
       where c.tenant_id = ${w.tenantId}::uuid and c.author_user_id = ${w.userId}::uuid
         and c.deleted_at is null
         and c.created_at >= ${w.fromAt}::timestamptz and c.created_at < ${w.untilAt}::timestamptz
      union all
      select 'check_in', ea.id, ea.checked_in_at, null, null, ea.event_id, null, null
        from public.event_attendances ea
       where ea.tenant_id = ${w.tenantId}::uuid and ea.user_id = ${w.userId}::uuid
         and ea.status in ('checked_in', 'walk_in')
         and ea.checked_in_at >= ${w.fromAt}::timestamptz
         and ea.checked_in_at < ${w.untilAt}::timestamptz
      union all
      select 'order', o.id, o.paid_at, null, null, null, o.product_id, o.amount_cents
        from public.store_orders o
       where o.tenant_id = ${w.tenantId}::uuid and o.user_id = ${w.userId}::uuid
         and o.status = 'paid'
         and o.paid_at >= ${w.fromAt}::timestamptz and o.paid_at < ${w.untilAt}::timestamptz
    )
    select s.kind, s.id::text as id,
           to_char(s.at at time zone 'UTC', ${ISO_US}) as at,
           s.story_id::text as story_id,
           s.event_id::text as event_id, e.title as event_title,
           s.product_id::text as product_id, sp.name as product_name, s.cents,
           ${postColumns}
      from s
      left join public.feed_posts p
        on p.id = s.post_id and p.tenant_id = ${w.tenantId}::uuid and p.deleted_at is null
      left join public.events e
        on e.id = s.event_id and e.tenant_id = ${w.tenantId}::uuid and e.deleted_at is null
      left join public.store_products sp
        on sp.id = s.product_id and sp.tenant_id = ${w.tenantId}::uuid
     where ${keysetBefore(sql`s.at`, sql`s.id`, after)}
     order by s.at desc, s.id desc
     limit ${take}`);
  return rows.map((row): OwnerStrongActionRow => {
    if (row.kind === 'check_in') {
      return {
        kind: 'check_in',
        id: row.id,
        at: row.at,
        eventId: row.event_id ?? '',
        eventTitle: row.event_title,
      };
    }
    if (row.kind === 'order') {
      return {
        kind: 'order',
        id: row.id,
        at: row.at,
        productId: row.product_id ?? '',
        productName: row.product_name,
        cents: Number(row.cents ?? 0),
      };
    }
    return { kind: 'comment', id: row.id, at: row.at, post: postOf(row), storyId: row.story_id };
  });
}
