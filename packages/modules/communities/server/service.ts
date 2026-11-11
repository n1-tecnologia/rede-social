import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { memberCommunityPolicyFor } from '@rede-social/core/server/communities/member-policy';
import { emit } from '@rede-social/core/server/events/bus';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleLogger } from '@rede-social/core/server/logging';
import { recordModerationAction } from '@rede-social/core/server/moderation/log';
import { decodeCursor, encodeCursor } from '@rede-social/core/server/paging';
import { communityCreateLimiter, safetyLimiterKey } from '@rede-social/core/server/safety/limits';
import { type SQL, sql } from 'drizzle-orm';
import {
  COMMUNITY_PAGE_SIZE,
  COMMUNITY_UNLOCK_NAMES_MAX,
  type CommunityKind,
  type CommunityPage,
  type CommunityQuery,
  type CommunityStatus,
  type CommunitySummary,
  type CommunityViewer,
  type CreateCommunity,
  type ReorderCommunities,
  type UpdateCommunity,
} from '../contracts/index';
import { COMMUNITY_MEMBER_POSITION } from '../db/schema';

const log = moduleLogger('module-communities');

/**
 * The communities service (COMM-01, COMM-02, COMM-03) — a PURE TENANT-LANE area.
 *
 * Every function is `withTenantTx(ctx, …)`: the tenant is never a parameter a caller supplies and
 * never a value this file compares. Layer 3 (`communities_tenant_isolation`) supplies it under the
 * explicit `tenant_id` predicate the statements also carry, which is what makes the cross-tenant 404
 * fall out of the SAME code path as an unknown id — there is nothing here that compares tenant ids,
 * so no later edit can turn that 404 into a 403 that confirms the row exists somewhere (D-23).
 *
 * The admin-lane transaction helper is Biome-confined to `packages/core/server/{tenancy,platform,
 * media}` and is not importable here at all.
 */

/**
 * One hydrated row of the list projection. Snake_case: it comes straight off `tx.execute`, which
 * returns the driver's own row objects — NOT Drizzle's column-mapped ones — so the timestamp arrives
 * as text and is formatted by the statement itself (see `ISO_MICROSECONDS`).
 */
type CommunityRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  cover_asset_id: string | null;
  cover_variant_widths: number[] | null;
  post_count: number;
  status: CommunityStatus;
  last_activity_at: string;
  /** 10-06: whose community this is. Part of the projection now (the viewer flags and the label read it). */
  kind: CommunityKind;
  /**
   * 10-06 (D-703, PR-2b): "the viewer created this MEMBER community", computed IN the statement, so the
   * creator's user id never has to be selected to answer it and can never reach the wire.
   */
  is_owner: boolean;
  /**
   * 10-06 (D-703): the creator's three safe fields, from their LIVE membership and profile; all three are
   * null for an organization community (the join never matches it) and for a creator who is not live.
   */
  creator_membership_id: string | null;
  creator_display_name: string | null;
  creator_avatar_asset_id: string | null;
  /**
   * The caller's own ACTIVE member communities, selected through `extra` only when the caller may create
   * (`memberQuota`). A scalar InitPlan, so it costs no second statement and no per-row work.
   */
  quota_owned_active?: number;
  /**
   * The ARCHIVED list's cursor key only (05.1, D-91): `updated_at` formatted to microseconds by the
   * statement, selected through `communityProjection`'s `extra` column. `toCommunity` never reads it,
   * so it can never reach the wire (`communitySummarySchema` is `.strict()` and unchanged).
   */
  cursor_at?: string;
  /**
   * The ACTIVE list's leading cursor key only (2026-10-03): the admin's `position`, selected through
   * the same `extra` column. Like `cursor_at` it is never read by `toCommunity`, so the position never
   * reaches the wire — the array order already IS the answer.
   */
  cursor_position?: number;
  /**
   * 10-05: the owner seam's second input, selected through the projection's `extra` column by the WRITE
   * paths only (`updateCommunity`). Like the cursor keys, `toCommunity` never reads it, so the creator's
   * user id can never reach the wire (`communitySummarySchema` is `.strict()`, and PR-2b).
   */
  created_by_user_id?: string | null;
};

/**
 * ISO-8601 in UTC with MICROSECOND precision, produced by Postgres rather than by JavaScript — the
 * `listFeed` rule restated for this module's ordering column.
 *
 * This matters for correctness, not tidiness. The cursor's `n` is this exact string, and the page
 * predicate compares it back as `::timestamptz`. Round-tripping through a JS `Date` would truncate
 * `timestamptz`'s microseconds to milliseconds, moving the page boundary EARLIER than the row it
 * came from — which silently SKIPS any community whose activity landed in the same millisecond but a
 * later microsecond. Keeping the full precision in text makes `(last_activity_at, id)` a genuinely
 * total order end to end.
 */
const ISO_MICROSECONDS = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);

/**
 * A cursor's instant must be one this service could have issued BEFORE it reaches a `::timestamptz`
 * cast — the events/chat rule (T-06-04), restated here because modules cannot import each other.
 * `decodeCursor` only proves `n` is a string, and a tampered `n` would otherwise be a 500 instead of
 * the first page. The shape alone is not enough (`2026-02-30` or hour `99` match it and still fail
 * the cast), so the calendar fields must also survive a UTC round trip.
 *
 * It became load-bearing here on 2026-10-03: the two lists now carry DIFFERENT `n` shapes, and a
 * cursor carries no status (D-88), so an active cursor replayed on the archived branch must degrade
 * to page 1 rather than reach the cast as `3~2026-…`.
 */
const CURSOR_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?Z$/;

function isCursorInstant(value: string): boolean {
  const match = CURSOR_INSTANT.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (year < 1000) return false;
  const at = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    at.getUTCFullYear() === year &&
    at.getUTCMonth() === month - 1 &&
    at.getUTCDate() === day &&
    at.getUTCHours() === hour &&
    at.getUTCMinutes() === minute &&
    at.getUTCSeconds() === second
  );
}

/** The ARCHIVED list's cursor: `decodeCursor`, then page 1 (null) unless `n` is a real instant. */
function decodeArchivedCursor(raw: string | undefined) {
  const decoded = decodeCursor(raw);
  return decoded && isCursorInstant(decoded.n) ? decoded : null;
}

/** Postgres `integer` bounds: a position outside them cannot have come from the column. */
const INT4_MIN = -2_147_483_648;
const INT4_MAX = 2_147_483_647;

/**
 * The ACTIVE list's `n` (2026-10-03): `{position}~{last_activity_at}`. The repo has ONE cursor
 * envelope (`{ v, n, id }`, `core/server/paging`), and its docblock forbids a second one — so the
 * list's extra leading key rides INSIDE `n` rather than as a new field. `~` cannot occur in either
 * half (an integer, an ISO instant), so the split is unambiguous.
 *
 * A pre-2026-10-03 cursor (a bare instant) has no `~` and degrades to page 1, which is what any
 * stale cursor does (T-05-05). Nothing parses this outside this file: the web forwards the cursor
 * verbatim and never reads it.
 */
const ACTIVE_KEY = /^(-?\d{1,10})~(.+)$/;

const activeCursorKey = (position: number, lastActivityAt: string): string =>
  `${position}~${lastActivityAt}`;

/** Where an ACTIVE page resumes: after `(position, at, id)` in the list's mixed-direction order. */
type ActiveCursor = { position: number; at: string; id: string };

/**
 * TOTAL, like `decodeCursor`: anything that is not `{int4}~{instant}` over a valid envelope is page
 * 1 (null), and nothing from the string reaches SQL before it passed every check here.
 */
function decodeActiveCursor(raw: string | undefined): ActiveCursor | null {
  const decoded = decodeCursor(raw);
  if (!decoded) return null;
  const match = ACTIVE_KEY.exec(decoded.n);
  if (!match) return null;
  const position = Number(match[1]);
  const at = match[2] ?? '';
  if (!Number.isInteger(position) || position < INT4_MIN || position > INT4_MAX) return null;
  if (!isCursorInstant(at)) return null;
  return { position, at, id: decoded.id };
}

/**
 * THE projection, written once and shared by the list and the detail read so the two can never
 * disagree about what a community looks like.
 *
 * The cover's variant ladder comes back in the SAME statement as the community (Pitfall 3/11): a
 * page costs ONE statement, never one plus N, and `feed-query-budget.test.ts` asserts that with a
 * ceiling AND a floor. The `left join media_assets` carries NO tenant condition —
 * `media_assets_tenant_select` is what decides visibility in this lane, so writing one would be dead
 * weight a reader could mistake for the actual isolation. A soft-deleted cover simply drops out and
 * the card falls back to the `--brand-gradient` block, exactly as a null `cover_asset_id` does.
 *
 * `created_by_user_id` is deliberately ABSENT from the select list (D-67, PR-2b): the creator is
 * projected through TWO LEFT JOINs instead (10-06, D-703), `memberships` pinned to the community's tenant
 * and to a LIVE membership (`status = 'active'`, not blocked, not deleted: the `storyProjection` author
 * shape), then `member_profiles` on `membership_id`, and the join is written to match MEMBER rows only, so an
 * organization community never reads its admin's profile. "The viewer created it" is a boolean computed by
 * the statement (`is_owner`), so a user id is never selected and can never reach a payload by accident.
 * Both joins match at most one row (`memberships_tenant_user_uq`, `member_profiles_membership_uq`), so a
 * community can never be duplicated by them.
 *
 * `extra` (05.1) is how the ARCHIVED list adds the one column its cursor is built from without
 * duplicating this column list — the `storyProjection(viewerUserId, extra)` precedent. Every other
 * call site passes nothing and renders exactly the column list it always did. An extra column is a
 * CURSOR key, never a payload field: `toCommunity` does not read it.
 */
function communityProjection(ctx: RequestContext, extra: SQL | null = null) {
  return sql`
    select c.id,
           c.name,
           c.slug,
           c.description,
           c.cover_asset_id,
           a.variant_widths as cover_variant_widths,
           c.post_count,
           c.status,
           to_char(c.last_activity_at at time zone 'utc', ${ISO_MICROSECONDS}) as last_activity_at,
           c.kind,
           (c.kind = 'member' and c.created_by_user_id = ${ctx.userId}::uuid) as is_owner,
           am.id as creator_membership_id,
           ap.display_name as creator_display_name,
           ap.avatar_asset_id as creator_avatar_asset_id
           ${extra ?? sql``}
      from communities c
      left join media_assets a on a.id = c.cover_asset_id
      left join memberships am
             on c.kind = 'member'
            and am.tenant_id = c.tenant_id
            and am.user_id = c.created_by_user_id
            and am.status = 'active'
            and am.blocked_at is null
            and am.deleted_at is null
      left join member_profiles ap on ap.membership_id = am.id`;
}

/**
 * 10-06: the permission facts the read side needs, computed ONCE per request by the route from
 * `permissionsForRequest` (permissions, never roles: T-05-03). The module never sees the permission set
 * itself, only these booleans, so the host never compares a role or an id and a later change of the
 * composition (the Escopo scope built after Phase 11) is one function.
 */
export type CommunityViewerFlags = {
  /** `communities.community.manage`: the organization's permission over every community. */
  canManage: boolean;
  /** `feed.post.create` and `content.publish`: the organization's voice (the admin; never a member). */
  canPostOrg: boolean;
  /** `stories.story.manage`: stories for an organization community. */
  canCurateOrg: boolean;
  /** `communities.community.manage_own`: the member creator's key over their own community. */
  canManageOwn: boolean;
  /** `stories.story.publish`: the member creator's story key. */
  canPublishStory: boolean;
  /** `communities.community.create`: may create (and therefore has a quota). */
  canCreate: boolean;
};

/** The composed permission set to the module's own flags; the only place that names the strings. */
export function communityViewerFlags(granted: readonly string[]): CommunityViewerFlags {
  const has = (key: string) => granted.includes(key);
  return {
    canManage: has('communities.community.manage'),
    canPostOrg: has('feed.post.create') && has('content.publish'),
    canCurateOrg: has('stories.story.manage'),
    canManageOwn: has('communities.community.manage_own'),
    canPublishStory: has('stories.story.publish'),
    canCreate: has('communities.community.create'),
  };
}

/**
 * 10-06: the per-viewer flags of one row, from the row's kind and ownership and the caller's permission
 * flags. For an ORGANIZATION community the organization's permissions decide; for a MEMBER community the
 * creator holds the member keys and a holder of `manage` may edit (moderation, UI-D-710) but never publish.
 * `canEdit` and `canCurate` require the matching member KEY as well as ownership, so a flag never promises a
 * write the route would refuse (an owner whose `social` was switched off, a creator whose role changed).
 *
 * **`actions` is the Escopo seam, computed here and nowhere else.** `post` and `story` take the value of
 * `canPublish` (today the owner rule of D-706); `like` and `comment` are `true` for every caller the
 * community is returned to (the interaction routes carry no per-route permission, D-701) and `share` is
 * `true` wherever the community is readable (no share gate exists). The per-product action scope built
 * after Phase 11 refines these five at THIS site; this phase adds no per-row grant lookup, because it
 * would change the list statement and its query budget.
 */
function viewerOf(row: CommunityRow, flags: CommunityViewerFlags): CommunityViewer {
  const member = row.kind === 'member';
  const isOwner = row.is_owner === true;
  const canPublish = member ? isOwner && flags.canManageOwn : flags.canPostOrg;
  const canEdit = member ? flags.canManage || (isOwner && flags.canManageOwn) : flags.canManage;
  const canCurate = member ? isOwner && flags.canPublishStory : flags.canCurateOrg;
  return {
    isOwner,
    canPublish,
    canEdit,
    canCurate,
    actions: { like: true, comment: true, share: true, post: canPublish, story: canPublish },
  };
}

/**
 * Row → published contract. Timestamps cross the wire as ISO strings, never as `Date`. `createdBy` is the
 * three safe fields of a MEMBER community's live creator and `null` otherwise (D-703).
 */
const toCommunity = (row: CommunityRow, flags: CommunityViewerFlags): CommunitySummary => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  description: row.description,
  coverAssetId: row.cover_asset_id,
  // `[]` for a cover-less community AND for a cover whose asset the lane cannot see: both are the
  // gradient branch, and the card must not have to tell them apart.
  coverVariantWidths: row.cover_variant_widths ?? [],
  postCount: row.post_count,
  status: row.status,
  lastActivityAt: row.last_activity_at,
  kind: row.kind,
  createdBy:
    row.kind === 'member' && row.creator_membership_id && row.creator_display_name !== null
      ? {
          membershipId: row.creator_membership_id,
          displayName: row.creator_display_name,
          avatarAssetId: row.creator_avatar_asset_id,
        }
      : null,
  viewer: viewerOf(row, flags),
});

/**
 * 10-06 (D-710): the caller's own ACTIVE member communities as a scalar subquery for the list statements'
 * `extra` column. Uncorrelated, so it is an InitPlan evaluated once per statement, not per row, and the list
 * stays ONE statement against the community tables (the query-budget test).
 */
const quotaColumn = (ctx: RequestContext) => sql`,
           (select count(*)::int
              from communities q
             where q.tenant_id = ${ctx.tenantId}::uuid
               and q.kind = 'member'
               and q.created_by_user_id = ${ctx.userId}::uuid
               and q.status = 'active'
               and q.deleted_at is null) as quota_owned_active`;

/**
 * 10-06 (D-708, A12): "this community may be shown to THIS viewer", the SERVICE form of two rules the database
 * also states. An ORGANIZATION community always passes. A MEMBER community passes only while
 *
 *  1. its creator is a LIVE member (`am` is the projection's join to the creator's membership, written with
 *     `status = 'active'`, not blocked, not deleted, so liveness costs nothing and a blocked or departed creator
 *     hides the whole community for everybody, the moderator included; unblocking restores it, nothing is
 *     deleted). RLS (`communities_member_hidden_gate`) says the same and is the backstop; the explicit term keeps
 *     the statement correct on its own, whatever lane runs it, and
 *  2. the VIEWER has not blocked that creator (`app.is_blocked_by_viewer`, the invoker predicate `getPost` and
 *     `NOT_BLOCKED_AUTHOR` use): the community leaves the blocker's list and answers the bare 404 by id, and
 *     nobody else (the creator included) sees a difference (the predicate reads the viewer's own rows only).
 *
 * Both terms are guarded by `c.kind = 'organization' or ...`, so an organization community never evaluates
 * either. A miss is the bare 404 (D-23): there is no distinguishing code.
 */
const MEMBER_COMMUNITY_VISIBLE = sql`
         and (c.kind = 'organization' or am.id is not null)
         and (c.kind = 'organization' or not app.is_blocked_by_viewer(c.created_by_user_id))`;

/**
 * THE active-list statement — one page of the tenant's ACTIVE communities in the list's order —
 * written once and shared by `listCommunities` and by `reorderCommunities`' answer, so the page a
 * reorder hands back can never be ordered differently from the page the next GET returns.
 *
 * **The order is `position asc, last_activity_at desc, id desc`** (2026-10-03), the exact column list
 * and directions of `communities_tenant_position_idx`, so the index DELIVERS the order and no Sort
 * node appears (pgTAP 110 cases 17-18). It is TOTAL: `(position, last_activity_at, id)` cannot tie,
 * so a page boundary can neither duplicate nor skip a row. Every row starts at position 0, so until
 * an admin reorders, the list is D-76's activity order exactly; a reorder writes 1..n, so a community
 * created afterwards (0) is listed FIRST, and inside one position — the never-reordered 0s, or a
 * reactivated community whose old position now coincides with another's — activity still decides.
 *
 * **The keyset runs in MIXED directions**, which is why it is spelled out rather than built from
 * `keysetComparison` (whose row comparison serves one direction): after `(p, at, id)` comes every row
 * with a LATER position, or the same position and an EARLIER `(last_activity_at, id)`. It is written
 * as `position >= p and (position > p or (at, id) < …)` — the same set — because the leading
 * `position >= p` is a range the index can SEEK to (probed: `Index Cond: … AND position >= p`), so a
 * later page starts at the cursor's position group instead of filtering every row before it. Inside
 * that one group the rows before the cursor are still filtered rather than seeked past, which costs
 * nothing at the size of a tenant's community list (the same trade the `… is null or …` guard already
 * makes for the generic plan).
 *
 * The cursor's leading key is the row's own `position`, read back through the projection's `extra`
 * column (`cursor_position`), and its instant is the projection's own `last_activity_at` text, so
 * neither is re-derived in JavaScript (the `ISO_MICROSECONDS` rule).
 *
 * A literal `c.status = 'active'`, never a bound parameter: it is provably implied by the index's
 * partial predicate whatever plan the server caches (pgTAP 110 cases 15, 17 and 18).
 */
async function activePage(
  tx: Tx,
  ctx: RequestContext,
  limit: number,
  after: ActiveCursor | null,
  /** 10-06: add the caller's own active member-community count to the statement (a creator's `memberQuota`). */
  withQuota = false,
): Promise<CommunityRow[]> {
  const afterPosition = after?.position ?? null;
  const afterAt = after?.at ?? null;
  const afterId = after?.id ?? null;
  return tx.execute<CommunityRow>(sql`
      ${communityProjection(
        ctx,
        sql`, c.position as cursor_position${withQuota ? quotaColumn(ctx) : sql``}`,
      )}
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.deleted_at is null
         and c.status = 'active'
         ${MEMBER_COMMUNITY_VISIBLE}
         and (
           ${afterPosition}::int is null
           or (
             c.position >= ${afterPosition}::int
             and (
               c.position > ${afterPosition}::int
               or (c.last_activity_at, c.id) < (${afterAt}::timestamptz, ${afterId}::uuid)
             )
           )
         )
       order by c.position asc, c.last_activity_at desc, c.id desc
       limit ${limit + 1}`);
}

/**
 * The ARCHIVED statement (05.1, D-88/D-91, managers only — the route enforces D-89): `updated_at
 * desc, id desc`, most recently archived first, because there is no `archived_at` and none is added.
 * The accepted consequence, pinned by a test: an archived community EDITED afterwards moves to the
 * top. Its cursor `n` is `updated_at` formatted to microseconds by the statement (`cursor_at`) and
 * never reaches the payload. NO index serves this branch, by decision: the archived set of a tenant
 * is small and only managers read it, and the budget test pins it to ONE statement with the covers
 * hydrated. A later index is a purely additive migration. The admin's `position` plays no part here:
 * the order an admin chooses is the ACTIVE list's, and archiving does not ask for one.
 */
async function archivedPage(
  tx: Tx,
  ctx: RequestContext,
  limit: number,
  after: { n: string; id: string } | null,
  ownOnly: boolean,
  withQuota = false,
): Promise<CommunityRow[]> {
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;
  return tx.execute<CommunityRow>(sql`
      ${communityProjection(
        ctx,
        sql`, to_char(c.updated_at at time zone 'utc', ${ISO_MICROSECONDS}) as cursor_at${
          withQuota ? quotaColumn(ctx) : sql``
        }`,
      )}
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.deleted_at is null
         and c.status = 'archived'
         ${MEMBER_COMMUNITY_VISIBLE}
         ${
           ownOnly
             ? sql`and c.kind = 'member' and c.created_by_user_id = ${ctx.userId}::uuid`
             : sql``
}
         and (
           ${afterAt}::timestamptz is null
           or (c.updated_at, c.id) < (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by c.updated_at desc, c.id desc
       limit ${limit + 1}`);
}

/** The active list's `n`, from the row the statement ordered: `{position}~{last_activity_at}`. */
const activeKey = (row: CommunityRow): string | undefined =>
  row.cursor_position === undefined || row.cursor_position === null
    ? undefined
    : activeCursorKey(row.cursor_position, row.last_activity_at);

/** The archived list's `n`: its own `updated_at`, formatted by the statement. */
const archivedKey = (row: CommunityRow): string | undefined => row.cursor_at;

/**
 * Over-fetched rows → one published page. `nextCursor` is non-null EXACTLY when another row exists
 * (the `limit + 1` rule), so the sentinel never fires a "load more" that comes back empty. Each list
 * passes its OWN key, read back from the statement that ordered by it.
 */
function pageOf(
  rows: CommunityRow[],
  limit: number,
  keyOf: (row: CommunityRow) => string | undefined,
  flags: CommunityViewerFlags,
  memberQuota: CommunityPage['memberQuota'] = null,
): CommunityPage {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const lastKey = last ? keyOf(last) : undefined;
  const nextCursor =
    rows.length > limit && last && lastKey ? encodeCursor({ n: lastKey, id: last.id }) : null;
  return { items: page.map((row) => toCommunity(row, flags)), nextCursor, memberQuota };
}

/** The ACTIVE member communities one user owns (the `memberQuota` of an empty page, 10-06). */
async function ownedActiveCount(tx: Tx, ctx: RequestContext, ownerUserId: string): Promise<number> {
  const owned = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n
      from communities
     where tenant_id = ${ctx.tenantId}::uuid
       and kind = 'member'
       and created_by_user_id = ${ownerUserId}::uuid
       and status = 'active'
       and deleted_at is null`);
  return owned[0]?.n ?? 0;
}

/**
 * `GET /v1/communities?limit=&cursor=&status=` (COMM-02, COMM-03, D-76) — one keyset page of the
 * tenant's ACTIVE communities in the admin's order, most recent activity first inside it (or, with
 * `status=archived`, its archived ones — see the two statements above).
 *
 * **COMM-02 is a POLICY value, expressed as an absence.** Neither statement joins
 * `community_members`: every member of the tenant therefore receives the identical item-id set
 * regardless of role, which is what "all of them" means as a rule rather than as a coincidence. V2's
 * restricted communities add a predicate here and a policy there — not a migration. The admin's
 * order is the same kind of value: one `position` per community, so every member reads the same
 * order an admin chose.
 *
 * **Two branches, two COMPLETE literal statements (05.1, D-88/D-91).** `query.status` picks one in
 * TypeScript; it is never a bound SQL parameter, so each statement's predicate and ordering are fixed
 * text the planner (and pgTAP's EXPLAIN) can match to an index by name.
 *
 * Each branch is its own keyset with its own `n` shape — `{position}~{instant}` for the active list,
 * a bare instant for the archived one — and each decoder is TOTAL: a tampered, truncated, stale or
 * other-list cursor degrades to page 1 instead of raising, and nothing from the string reaches SQL
 * before it passed `cursorSchema` and the shape checks (T-05-05). A cursor carries no status, so a
 * cursor replayed on the other list is exactly such a stale cursor.
 */
export async function listCommunities(
  ctx: RequestContext,
  query: CommunityQuery,
  /**
   * 10-05 (D-713, D-89 scoped to own rows): a caller who holds `communities.community.manage_own` but not
   * `manage` (the member creator) reads the ARCHIVED list of THEIR OWN member communities only. The route
   * computes it from the composed permission set; it is never a client value.
   */
  opts: { ownOnly?: boolean; viewer: CommunityViewerFlags },
): Promise<CommunityPage> {
  const limit = query.limit;
  const archived = query.status === 'archived';

  // 10-06 (D-710): a caller who may create reads their own allowance with the page. The policy is read
  // BEFORE the transaction opens (the flags cache may open a lane of its own on a miss); `null` (no `social`
  // for the tenant) leaves the quota null whatever the permission set said during the cache window.
  const policy = opts.viewer.canCreate ? await memberCommunityPolicyFor(ctx) : null;
  const withQuota = policy !== null;

  const { rows, fallbackOwned } = await withTenantTx(ctx, async (tx) => {
    const page = archived
      ? await archivedPage(
          tx,
          ctx,
          limit,
          decodeArchivedCursor(query.cursor),
          opts.ownOnly === true,
          withQuota,
        )
      : await activePage(tx, ctx, limit, decodeActiveCursor(query.cursor), withQuota);
    // The count rides the first row; an EMPTY page has no row to carry it, so the (rare) empty page asks.
    const fallback =
      withQuota && page.length === 0 ? await ownedActiveCount(tx, ctx, ctx.userId) : 0;
    return { rows: page, fallbackOwned: fallback };
  });

  const memberQuota = policy
    ? { ownedActive: rows[0]?.quota_owned_active ?? fallbackOwned, limit: policy.maxActive }
    : null;
  const { items, nextCursor } = pageOf(
    rows,
    limit,
    archived ? archivedKey : activeKey,
    opts.viewer,
    memberQuota,
  );

  // The SHAPE of the read — counts, ids and flags. A community NAME is member-facing content and
  // never reaches a log line, an error `details` payload or an OpenAPI example (T-05-06).
  log.info(
    {
      event: 'communities.list',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      // A closed enum value — the shape of the read, never its content.
      status: query.status,
      limit,
      returned: items.length,
      hasNext: nextCursor !== null,
    },
    'communities listed',
  );

  return { items, nextCursor, memberQuota };
}

/**
 * `GET /v1/communities/{communityId}` (COMM-03, T-05-01/T-05-02).
 *
 * ONE bare 404 with NO `details` payload for every miss — unknown id, another tenant's id,
 * soft-deleted. A details key here, even `{ community: 'not_found' }` vs `{ community: 'deleted' }`,
 * would be an existence oracle over an enumerable uuid space (D-23, the `getPost` posture).
 *
 * An ARCHIVED community is still readable (05-04 renders it with the "Arquivada" pill): archiving
 * gates the WRITES and removes the row from the list, it does not hide what was already published.
 */
export async function getCommunity(
  ctx: RequestContext,
  communityId: string,
  viewer: CommunityViewerFlags,
): Promise<CommunitySummary> {
  const row = await withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<CommunityRow>(sql`
      ${communityProjection(ctx)}
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.id = ${communityId}::uuid
         and c.deleted_at is null
         ${MEMBER_COMMUNITY_VISIBLE}
       limit 1`);
    return rows[0];
  });

  if (!row) throw new ApiError(404, 'NOT_FOUND');
  return toCommunity(row, viewer);
}

/**
 * The per-tenant URL segment, derived from the display name: lowercased, accent-folded, every run of
 * non-alphanumerics collapsed to a single `-`, trimmed of leading/trailing separators and capped.
 *
 * `normalize('NFD')` + stripping the combining range is what turns "Avisos da Diretoria" into
 * `avisos-da-diretoria` and "Ação" into `acao` — an ASCII slug, so the URL survives copy/paste
 * through systems that mangle percent-encoding. A name made entirely of emoji or punctuation folds
 * to the empty string, which is why `slugCandidate` has a fallback: a community must always have a
 * slug, and `communities_tenant_slug_uq` then disambiguates the collisions that follow.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

/** The base slug plus the nth disambiguating suffix. `n === 0` is the bare slug. */
function slugCandidate(base: string, attempt: number): string {
  const root = base.length > 0 ? base : 'comunidade';
  return attempt === 0 ? root : `${root}-${attempt + 1}`;
}

/** Postgres' unique-violation SQLSTATE, walked out of whatever the driver wrapped it in. */
function isSlugCollision(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (candidate.code === '23505' && candidate.constraint_name === 'communities_tenant_slug_uq') {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/**
 * A `42501` (insufficient privilege, the row-level-security refusal) anywhere in the cause chain: the
 * same walk `isSlugCollision` does, with its own `seen` set. The feed module keeps its own copy because
 * modules never import each other (MOD-02).
 */
function isInsufficientPrivilege(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; cause?: unknown };
    if (candidate.code === '42501') return true;
    current = candidate.cause;
  }
  return false;
}

/** How many suffixes to try before giving up. Ten same-named communities is already absurd. */
const SLUG_ATTEMPTS = 10;

/** What the cover lookup inside a community WRITE's transaction needs to decide. */
type CoverAssetRow = { kind: string; purpose: string; status: string };

/**
 * The cover reference, resolved INSIDE the writing transaction — shared verbatim by create and
 * update (05-09, T-05-40/T-05-41), exactly as `publishStory` resolves a story's asset.
 *
 * **Why this exists at all.** `cover_asset_id` used to go from the request body straight into SQL.
 * The single-column foreign key cannot stand in for this check: Postgres referential integrity runs
 * as the TABLE OWNER and therefore bypasses RLS, so another tenant's asset id PERSISTED — and the
 * 23503-vs-201 split (random uuid → 500; real foreign id → 201) was a working cross-tenant existence
 * oracle over an enumerable uuid space.
 *
 * **Two answers, and the difference between them is the whole point.**
 *  - NO ROW, for any reason — another tenant's, unknown, soft-deleted — is ONE bare 404 with no
 *    `details`, byte-identical to the answer an unknown COMMUNITY id gets. The read runs in the
 *    tenant lane, so `media_assets_tenant_select` is what makes a foreign id simply not come back;
 *    there is nothing here that compares tenant ids, so no later edit can turn this into a 403 that
 *    confirms the asset exists somewhere (D-23).
 *  - A row that IS present but unusable is `400 { community: 'cover_invalid' }`. The caller can see
 *    that one and fixing it is their job, so it is information they already had, not an oracle.
 *
 * **The accepted tuple is exactly `purpose = 'cover'`, `kind = 'image'`, `status = 'ready'`.** The
 * feed's D-53 concession — publish while a video transcodes and show the `processando` placeholder —
 * is a VIDEO concession and is deliberately NOT inherited: a cover is never a video, and a cover
 * whose bytes do not exist yet renders as exactly the `--brand-gradient` block the admin was trying
 * to replace.
 *
 * A null id returns immediately and performs NO lookup: "no cover" is a first-class value (D-69).
 *
 * Its boolean sibling is `coverIsUsable`, which answers the SAME tuple rule off the SAME lookup
 * without throwing — for the one caller that must not refuse a request over a cover the request
 * never asserted (see `updateCommunity`).
 */
async function resolveCoverAsset(
  tx: Tx,
  ctx: RequestContext,
  coverAssetId: string | null,
  /**
   * 10-07 (Pitfall 10, T-10-25): for a MEMBER caller the asset must be one THEY uploaded
   * (`owner_user_id = ctx.userId`), so another user's asset id is the same bare 404 an unknown id is and
   * nothing attaches. `null` for an organization caller (RLS decides, as before) and for a re-sent
   * stored reference.
   */
  ownerUserId: string | null = null,
): Promise<void> {
  if (coverAssetId === null) return;

  const asset = await loadCoverAsset(tx, ctx, coverAssetId, ownerUserId);
  // Unknown, another tenant's, or soft-deleted — one indistinguishable answer, no details.
  if (!asset) throw new ApiError(404, 'NOT_FOUND');
  if (!isUsableCover(asset)) {
    throw new ApiError(400, 'VALIDATION_FAILED', { community: 'cover_invalid' });
  }
}

/**
 * THE cover lookup — one select statement, and every consumer is built on it.
 *
 * `resolveCoverAsset` and `coverIsUsable` answer different questions about the same row (throw vs.
 * boolean), but they must never answer them off different QUERIES: two copies of the
 * `(tenant_id, deleted_at is null)` predicate would eventually drift, and the weaker copy is the one
 * a write path would end up trusting. Same statement, same tuple rule, one place to change either.
 */
async function loadCoverAsset(
  tx: Tx,
  ctx: RequestContext,
  coverAssetId: string,
  ownerUserId: string | null = null,
): Promise<CoverAssetRow | undefined> {
  // 10-07: the owner is a term of the SAME statement (never a second lookup) when a member asserts a cover.
  const ownerOnly = ownerUserId === null ? sql`` : sql`and owner_user_id = ${ownerUserId}::uuid`;
  const rows = await tx.execute<CoverAssetRow>(sql`
    select kind, purpose, status
      from media_assets
     where id = ${coverAssetId}::uuid
       and tenant_id = ${ctx.tenantId}::uuid
       and deleted_at is null
       ${ownerOnly}
     limit 1`);
  return rows[0];
}

/** The accepted tuple, stated ONCE so the throwing and boolean answers cannot disagree. */
function isUsableCover(asset: CoverAssetRow): boolean {
  return asset.purpose === 'cover' && asset.kind === 'image' && asset.status === 'ready';
}

/**
 * Is the STORED cover reference still usable? The non-throwing half of `resolveCoverAsset`.
 *
 * The distinction this exists to serve: a request that ASSERTS a cover id is answerable — refuse it
 * and the admin can see what they sent and fix it. A request that asserts NOTHING about the cover is
 * not: refusing it reports "Comunidade nao encontrada" about a community that is open on the admin's
 * screen, and no later write to that row can ever succeed again. So a dangling stored reference is
 * self-healed (dropped to null) rather than enforced — see `updateCommunity`.
 */
async function coverIsUsable(tx: Tx, ctx: RequestContext, coverAssetId: string): Promise<boolean> {
  const asset = await loadCoverAsset(tx, ctx, coverAssetId);
  return asset !== undefined && isUsableCover(asset);
}

/**
 * 10-05 (D-710, MCOMM-05; EP-15..21): "this member may own one more ACTIVE community", decided INSIDE the
 * writing transaction and race-proof.
 *
 * The transaction first takes `pg_advisory_xact_lock(hashtextextended('communities:own:' || tenant || ':'
 * || user, 0))`: one lock per member of one tenant, released at commit or rollback, so two creates (or a
 * create and a reactivation) by the SAME member queue, and two different members never block each other
 * (EP-21). Only then does it count the member's `kind = 'member'`, `status = 'active'`, `deleted_at is
 * null` rows (archived and removed communities do not count, other members' and the admin's never do) and
 * refuses `400 VALIDATION_FAILED { community: 'limit_reached' }` when the count already reaches the
 * limit. READ COMMITTED gives each statement a fresh snapshot, so under the lock the count sees every
 * earlier committer: after `Promise.all` of N+1 creates exactly N rows exist whatever the commit order.
 *
 * Lowering the limit below what a member already owns removes nothing: only the NEXT create (or
 * reactivation) is refused. A limit of 0 refuses the first. The limit and the lock key are the CREATOR's
 * (`ownerUserId`), so a moderator reactivating somebody's community is held to that member's allowance.
 */
async function assertWithinMemberLimit(
  tx: Tx,
  ctx: RequestContext,
  ownerUserId: string,
  maxActive: number,
): Promise<void> {
  await tx.execute(sql`
    select pg_advisory_xact_lock(
      hashtextextended('communities:own:' || ${ctx.tenantId}::text || ':' || ${ownerUserId}::text, 0))`);
  const owned = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n
      from communities
     where tenant_id = ${ctx.tenantId}::uuid
       and kind = 'member'
       and created_by_user_id = ${ownerUserId}::uuid
       and status = 'active'
       and deleted_at is null`);
  if ((owned[0]?.n ?? 0) >= maxActive) {
    throw new ApiError(400, 'VALIDATION_FAILED', { community: 'limit_reached' });
  }
}

/**
 * `POST /v1/communities` (COMM-01).
 *
 * - `tenantId` and `createdByUserId` come from `ctx`, never from the body (T-04-02, T-07-01). The
 *   policy's `with check (tenant_id = app.tenant_id())` makes a forged stamp a `42501` rather than a
 *   cross-tenant write, so the rule is enforced twice on purpose.
 * - **Two communities may share a NAME.** A repeat create is a second container, not a conflict:
 *   there is no 409 anywhere on this path. `communities_tenant_slug_uq` serialises two concurrent
 *   creates that derive the same slug, and the loser RETRIES the next suffix rather than surfacing a
 *   500 — which is also why the retry loop is a loop and not a pre-flight `select` (a read-then-write
 *   with no lock is exactly the race the unique index exists to win).
 * - `post_count` and `last_activity_at` are NOT in the insert: both are trigger-owned and take their
 *   column defaults (`0` and `now()`), which is the right answer for a community with no posts.
 * - `emit` runs only after `withTenantTx` RESOLVES, and even then only QUEUES the event on
 *   `ctx.events`; the response middleware delivers it once the handler returned. A subscriber can
 *   therefore never observe a community that a rollback erased (MOD-03).
 */
export async function createCommunity(
  ctx: RequestContext,
  input: CreateCommunity,
  viewer: CommunityViewerFlags,
): Promise<CommunitySummary> {
  // The service re-states the route's rule: `createCommunity` is also reachable from the seed and
  // from any handler that assembles its own input, none of which pass through the route validator.
  if (input.name.trim().length === 0) {
    throw new ApiError(400, 'VALIDATION_FAILED', { community: 'name_required' });
  }

  // 10-05 (D-706, D-707): the KIND is stamped from the session, never from the body (the schema is
  // `.strict()` and has no such key). It is the ONE role read of this module, a stamp rather than a
  // permission decision, and it is backed by `communities_kind_insert_gate` in SQL: a member lane may
  // only insert `kind = 'member'` rows of its own at the sentinel position, a staff lane only
  // `'organization'` ones. Ownership everywhere else is tested in the statement, never by role.
  const member = ctx.role === 'member';

  // 10-05 (A6, D-710): a member's creation is rate limited (every ATTEMPT counts, a refused one
  // included, T-10-16) and judged against the tenant's member policy BEFORE the transaction opens (the
  // policy read may use the flags cache, which opens a lane of its own on a miss). A null policy means
  // the `social` module is not effective for the tenant (the flags-cache window after it was switched
  // off): 403, the same answer the permission guard gives once the cache expires.
  let maxActive: number | null = null;
  if (member) {
    if (!communityCreateLimiter.consume(safetyLimiterKey(ctx))) {
      throw new ApiError(429, 'RATE_LIMITED');
    }
    const policy = await memberCommunityPolicyFor(ctx);
    if (!policy) throw new ApiError(403, 'FORBIDDEN');
    maxActive = policy.maxActive;
  }

  const base = slugify(input.name);
  let created: CommunityRow | undefined;

  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
    const slug = slugCandidate(base, attempt);
    try {
      created = await withTenantTx(ctx, (tx) => insertCommunity(tx, ctx, input, slug, maxActive));
      break;
    } catch (error) {
      if (isSlugCollision(error)) continue;
      // T-10-18 / EP-41: `social` was switched off while this instance's flags cache still held the old
      // answer, so the permission guard let a member through and the insert gate (`app.social_enabled()`
      // in SQL) refused the row. That is a permission refusal, not an internal error. MEMBERS ONLY: any
      // other 42501 stays a 500 so a real policy bug is never masked as a user-facing refusal.
      if (member && isInsufficientPrivilege(error)) throw new ApiError(403, 'FORBIDDEN');
      throw error;
    }
  }

  if (!created) throw new ApiError(500, 'INTERNAL');

  emit(ctx, 'community.created', {
    tenantId: ctx.tenantId,
    communityId: created.id,
    actorUserId: ctx.userId,
  });

  log.info(
    {
      event: 'communities.created',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      communityId: created.id,
      // Lengths and flags, never the words themselves (T-05-06).
      nameLength: input.name.length,
      descriptionLength: input.description.length,
      hasCover: created.cover_asset_id !== null,
    },
    'community created',
  );

  return toCommunity(created, viewer);
}

/**
 * The insert and its read-back, in ONE transaction: the created community is returned in exactly the
 * shape the list returns, so the form can prepend it without a second request. Separated out so the
 * slug-collision retry above re-enters a FRESH transaction — retrying inside an aborted one would
 * fail on every statement.
 *
 * The cover is resolved HERE rather than before the retry loop, for the same reason: the lookup
 * belongs to whichever transaction performs the write, so the two cannot interleave with another
 * statement of this request (05-09).
 */
async function insertCommunity(
  tx: Tx,
  ctx: RequestContext,
  input: CreateCommunity,
  slug: string,
  /** The member's allowance, or null for an organization create (no limit, no lock). */
  maxActive: number | null,
): Promise<CommunityRow> {
  const member = maxActive !== null;
  // FIRST statement of the transaction: a refused cover writes nothing at all. `isSlugCollision`
  // matches a 23505 on the slug index alone, so this `ApiError` is re-thrown by the retry loop
  // untouched rather than swallowed as a collision.
  await resolveCoverAsset(tx, ctx, input.coverAssetId ?? null, member ? ctx.userId : null);

  // 10-05 (D-710): the member's own allowance, under their advisory lock, before the insert.
  if (maxActive !== null) await assertWithinMemberLimit(tx, ctx, ctx.userId, maxActive);

  // 10-05 (D-706): a MEMBER's community is stamped `kind = 'member'` at the sentinel position, so it
  // sorts after every organization community whatever order the admin chose and the list statement, its
  // index and its cursor stay untouched. The organization path keeps its original statement byte for
  // byte (kind takes its column default, position 0: the newest lands first, as before).
  const inserted = member
    ? await tx.execute<{ id: string }>(sql`
    insert into communities
      (tenant_id, created_by_user_id, name, slug, description, cover_asset_id, kind, position)
    values (${ctx.tenantId}::uuid,
            ${ctx.userId}::uuid,
            ${input.name},
            ${slug},
            ${input.description},
            ${input.coverAssetId ?? null}::uuid,
            'member',
            ${COMMUNITY_MEMBER_POSITION})
    returning id`)
    : await tx.execute<{ id: string }>(sql`
    insert into communities (tenant_id, created_by_user_id, name, slug, description, cover_asset_id)
    values (${ctx.tenantId}::uuid,
            ${ctx.userId}::uuid,
            ${input.name},
            ${slug},
            ${input.description},
            ${input.coverAssetId ?? null}::uuid)
    returning id`);
  const id = inserted[0]?.id;
  if (!id) throw new ApiError(500, 'INTERNAL');

  const rows = await tx.execute<CommunityRow>(sql`
    ${communityProjection(ctx)}
     where c.id = ${id}::uuid
     limit 1`);
  const row = rows[0];
  if (!row) throw new ApiError(500, 'INTERNAL');
  return row;
}

/**
 * 10-05 (D-713, D-706): the OWNER predicate of the writes that act on one existing community, read by the
 * statement, never by a role. The caller may write when they hold `communities.community.manage` (the
 * organization's permission, any community), or when the community is a MEMBER community they created
 * (`kind = 'member' and created_by_user_id = ctx.userId`). The kind term closes a hole: a creator of an
 * ORGANIZATION community (an admin later demoted to member) does not gain it back through
 * `manage_own`.
 *
 * It runs on a PLAIN read, before the locking read, on purpose: the member lane's UPDATE policy
 * (`communities_member_update_gate`, plan 10-03) hides a row the lane does not own from a `for update`
 * read, so a locking read would turn "visible but not yours" into the bare 404 where the product means
 * 403. Order of answers: a miss is the bare 404 (D-23), then a visible row the caller does not own is 403.
 */
async function assertMayWriteCommunity(
  tx: Tx,
  ctx: RequestContext,
  communityId: string,
  canManage: boolean,
): Promise<void> {
  const seen = await tx.execute<{ kind: string; created_by_user_id: string | null }>(sql`
    select c.kind, c.created_by_user_id
      from communities c
     where c.tenant_id = ${ctx.tenantId}::uuid
       and c.id = ${communityId}::uuid
       and c.deleted_at is null
     limit 1`);
  const row = seen[0];
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  if (canManage) return;
  if (row.kind === 'member' && row.created_by_user_id === ctx.userId) return;
  throw new ApiError(403, 'FORBIDDEN');
}

/**
 * 10-05 (D-711, MCOMM-10, A8): "a moderator acted on somebody's community" - the one log row, written in
 * the SAME transaction as the community write, so a log failure rolls the write back (T-10-17). It is
 * written ONLY when the caller holds `communities.community.manage`, the community is a MEMBER community
 * and the caller is not its creator: the creator's own archive or delete, any action on an organization
 * community, a no-op repeat and an admin's edit of text (A8) write nothing. The guard is the manage
 * permission and never a member permission, so the moderator's actions keep working with `social` off
 * (D-718). The creator is not told: nothing here emits an event or a notification.
 *
 * `excerptSource` is the community's NAME at the time of the action (the writer caps it); the
 * description is deliberately not an input of this function, so it can never reach the log.
 */
async function logModeratorAction(
  tx: Tx,
  ctx: RequestContext,
  action: 'community_archived' | 'community_removed',
  target: {
    id: string;
    name: string;
    kind: string | undefined;
    createdBy: string | null | undefined;
  },
  canManage: boolean,
): Promise<void> {
  if (!canManage || target.kind !== 'member') return;
  if (!target.createdBy || target.createdBy === ctx.userId) return;
  await recordModerationAction(tx, ctx, {
    action,
    targetUserId: target.createdBy,
    subjectType: 'community',
    subjectId: target.id,
    excerptSource: target.name,
    reason: null,
  });
}

/**
 * `PATCH /v1/communities/{communityId}` (COMM-01, UI-D-37) — edit, archive and reactivate.
 *
 * **ONE function, because archive is a STATUS WRITE and not a separate verb.** Splitting it into
 * `archiveCommunity` / `reactivateCommunity` would be three code paths writing one column, and the
 * three would eventually disagree about what an unchanged request answers.
 *
 * **What archive MEANS** (05-RESEARCH §Pattern 7, settled here): a WRITE gate and a LIST gate, never
 * a feed gate. An archived community keeps its existing posts in the merged feed exactly where
 * members already saw them (`listFeed` carries no archive predicate at all — the measured
 * alternative is a sequential scan plus a sort, and the denormalised one is a table-wide UPDATE plus
 * a fourth index plus a new class of drift); disappears from `GET /v1/communities` (one predicate,
 * already there); still OPENS by id, read-only; refuses new posts with the closed `archived` code
 * that 05-03 already raises; and is reversible with one PATCH back to `active`.
 *
 * **Every miss is the SAME bare 404** the read path answers — unknown id, another tenant's,
 * soft-deleted — because the update statement carries the identical predicate and RLS supplies the
 * tenant beneath it. There is nothing here that compares tenant ids, so no later edit can turn that
 * 404 into a 403 that confirms the row exists somewhere (D-23, T-05-20).
 *
 * **`post_count` and `last_activity_at` are not in the `set` list and must never be.** They are
 * trigger-owned; an edit is not activity, and a list ordered by "who edited most recently" would
 * answer a different question than D-76 asks. `updated_at` moves only when something actually
 * changed, which is what makes a no-op PATCH observably a no-op.
 *
 * **Two events, both id-shaped, both after commit.** `community.updated` on a CONTENT change and
 * `community.archived` on the TRANSITION into `archived`. A repeat archive changes no row, so it
 * announces nothing — the event counts transitions, not states.
 */
export async function updateCommunity(
  ctx: RequestContext,
  communityId: string,
  input: UpdateCommunity,
  /** 10-05: the permission flags, read by the route from the composed permission set (`canManage` is the owner seam's). */
  opts: CommunityViewerFlags,
): Promise<CommunitySummary> {
  // The service re-states the route's rule: this function is also reachable from the seed and from
  // any handler that assembles its own input, none of which pass through the route validator.
  if (input.name !== undefined && input.name.trim().length === 0) {
    throw new ApiError(400, 'VALIDATION_FAILED', { community: 'name_required' });
  }

  // 10-05 (D-710): a write that REACTIVATES (`status: 'active'`) is judged against the member allowance
  // too, so archive-and-reactivate can never be a way past the limit. The policy is read BEFORE the
  // transaction (the flags cache may open a lane of its own on a miss).
  const policy = input.status === 'active' ? await memberCommunityPolicyFor(ctx) : null;

  const { row, contentChanged, archivedNow } = await withTenantTx(ctx, async (tx) => {
    // 10-05 (D-713): the owner predicate, before anything is locked or written (see the helper).
    await assertMayWriteCommunity(tx, ctx, communityId, opts.canManage);

    // The row is read FIRST, inside the same transaction, because three of this function's answers
    // depend on what it was: the 404, whether anything actually changed, and whether this write is
    // the transition into `archived` rather than a repeat of it. 10-05: it is read `for update of c`
    // (the joined cover asset is not locked), so two writers of one community (the creator and a
    // moderator archiving at the same time, EP-25) queue and the second one reads the first one's
    // status: exactly one transition happens.
    const current = await tx.execute<CommunityRow>(sql`
      ${communityProjection(ctx, sql`, c.created_by_user_id as created_by_user_id`)}
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.id = ${communityId}::uuid
         and c.deleted_at is null
       limit 1
         for update of c`);
    const before = current[0];
    if (!before) throw new ApiError(404, 'NOT_FOUND');

    const name = input.name ?? before.name;
    const description = input.description ?? before.description;
    let coverAssetId =
      input.coverAssetId === undefined ? before.cover_asset_id : input.coverAssetId;
    const status = input.status ?? before.status;

    // **Validate the cover the REQUEST asserts; never the one the row merely stores.** The
    // difference is the whole of CR-01, and it is a difference in who can act on the refusal:
    //
    //  - The request SENT a `coverAssetId` (an explicit id, or an explicit `null`): it made a claim,
    //    so it owns the answer. `resolveCoverAsset` refuses exactly as before — a re-sent unusable
    //    id is still the bare 404, which is what stops a bad id a pre-fix release wrote from
    //    surviving by being re-sent unchanged. `null` returns before any lookup, so an explicit
    //    clear still costs nothing.
    //  - The request said NOTHING about the cover (rename, description edit, archive, reactivate)
    //    but the STORED reference no longer resolves — the community's own admin retired it through
    //    `DELETE /v1/media/{assetId}`, which is a state the product itself produces. Enforcing it
    //    here bricked the row: every later write 404'd forever and the BFF reported "Comunidade nao
    //    encontrada" about a community open on the admin's screen. A retired cover is "no cover", a
    //    first-class value (D-69), so the dangling reference is DROPPED rather than enforced.
    //
    // The self-heal is BOUNDED by `changedContent` below: nulling the reference makes this PATCH a
    // real write (one `updated_at` move, one `community.updated`), and the next identical PATCH
    // finds nothing dangling and is observably inert again — a one-time repair, not a write forever.
    if (input.coverAssetId !== undefined) {
      // 10-07: a member creator may assert only a cover THEY uploaded; re-sending the stored reference
      // (an admin may have set it, A8) is not a new claim and is judged by the usual tuple rule alone.
      const mustOwn = ctx.role === 'member' && coverAssetId !== before.cover_asset_id;
      await resolveCoverAsset(tx, ctx, coverAssetId, mustOwn ? ctx.userId : null);
    } else if (coverAssetId !== null && !(await coverIsUsable(tx, ctx, coverAssetId))) {
      coverAssetId = null;
    }

    const changedContent =
      name !== before.name ||
      description !== before.description ||
      coverAssetId !== before.cover_asset_id;
    const changedStatus = status !== before.status;

    // Nothing moved: no statement, no `updated_at`, no event. A PATCH identical to the stored row
    // must be observably inert, not merely idempotent in its response body.
    if (!changedContent && !changedStatus) {
      return { row: before, contentChanged: false, archivedNow: false };
    }

    // 10-05 (D-710): archived -> active on a MEMBER community counts against its CREATOR's allowance
    // (the row itself is archived, so it is not counted yet). With `social` off there is no policy and no
    // allowance to enforce; a member cannot reach this path then (the permission leaves the composed set).
    if (
      changedStatus &&
      status === 'active' &&
      before.kind === 'member' &&
      before.created_by_user_id &&
      policy
    ) {
      await assertWithinMemberLimit(tx, ctx, before.created_by_user_id, policy.maxActive);
    }

    await tx.execute(sql`
      update communities
         set name = ${name},
             description = ${description},
             cover_asset_id = ${coverAssetId}::uuid,
             status = ${status},
             updated_at = now()
       where tenant_id = ${ctx.tenantId}::uuid
         and id = ${communityId}::uuid
         and deleted_at is null`);

    const rows = await tx.execute<CommunityRow>(sql`
      ${communityProjection(ctx)}
       where c.id = ${communityId}::uuid
       limit 1`);
    const after = rows[0];
    if (!after) throw new ApiError(500, 'INTERNAL');

    const archivedTransition = changedStatus && status === 'archived';
    // 10-05 (D-711): a moderator's archive of somebody's member community leaves its row, in this very
    // transaction. Read from the LOCKED row, so a second archive of the same community (the repeat, or the
    // creator racing the moderator, EP-24, EP-25) finds the status already `archived`, returns at the
    // no-op above and writes nothing.
    if (archivedTransition) {
      await logModeratorAction(
        tx,
        ctx,
        'community_archived',
        { id: communityId, name, kind: before.kind, createdBy: before.created_by_user_id },
        opts.canManage,
      );
    }

    return { row: after, contentChanged: changedContent, archivedNow: archivedTransition };
  });

  if (contentChanged) {
    emit(ctx, 'community.updated', {
      tenantId: ctx.tenantId,
      communityId: row.id,
      actorUserId: ctx.userId,
    });
  }
  if (archivedNow) {
    emit(ctx, 'community.archived', {
      tenantId: ctx.tenantId,
      communityId: row.id,
      actorUserId: ctx.userId,
    });
  }

  log.info(
    {
      event: 'communities.updated',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      communityId: row.id,
      // Flags and lengths, never the words themselves (T-05-06).
      contentChanged,
      archivedNow,
      status: row.status,
      hasCover: row.cover_asset_id !== null,
    },
    'community updated',
  );

  return toCommunity(row, opts);
}

/**
 * `PUT /v1/communities/order` (2026-10-03) — the admin's order of the ACTIVE list, written as
 * `position = 1..n` in the order the request names. The `reorderHighlights` shape, retargeted.
 *
 * One `withTenantTx`, three steps:
 *  1. **Lock.** The tenant's ACTIVE, live rows are locked `for update`, in id order — one fixed
 *     order, so two reorders racing each other queue instead of deadlocking.
 *  2. **Compare.** The LOCKED id set must equal the request's: same size and identical members.
 *     Anything else — a community created, archived or removed since the admin's screen loaded, an
 *     unknown id, another tenant's id — is ONE `409 { community: 'order_stale' }` and nothing is
 *     written. Locking first is what makes the comparison mean something: an archive racing this
 *     reorder either commits before the lock (its row no longer matches `status = 'active'` when the
 *     lock re-reads it, so the set differs) or waits for it. A create is not blocked by row locks;
 *     one that commits after the comparison simply lands at position 0, which lists it first — the
 *     documented place for a new community, and no row of the admin's order moved.
 *  3. **Renumber.** ONE statement writes `position = 1..n` from `unnest(…) with ordinality`,
 *     touching only rows whose position really changes, and `updated_at` moves with them — and only
 *     with them: a repeat of the same order writes nothing and moves nothing (idempotent, observably
 *     inert, the no-op PATCH rule).
 *
 * The answer is page 1 of the active list in the new order, read by `activePage` — the SAME
 * statement `GET /v1/communities` runs — inside the same transaction, so what the admin sees after
 * saving is exactly what every member's next read returns.
 *
 * **What it never touches.** Archived rows: they are outside the lock, outside the comparison, and
 * the renumber carries the same `status = 'active'` predicate besides. A reactivated community keeps
 * the position it had, and where that now coincides with another row's, activity breaks the tie
 * until the next reorder. `post_count` and `last_activity_at` stay trigger-owned (fact 2 of the
 * schema docblock): an order is not activity.
 *
 * **No event.** Nothing subscribes to an order, and an event nobody reads is a payload shape frozen
 * for free (the `community.reactivated` precedent in the contracts). The log line below carries the
 * shape of the write; adding `community.reordered` later is one line in the contracts.
 *
 * **ORGANIZATION communities only (10-06, D-712, Pitfall 3).** The lock, the comparison and the renumber each
 * carry `c.kind = 'organization'`: a member community is ranked by the sentinel position 1000000 and by
 * activity, never by an admin, so it is outside the permutation, its position is never rewritten, and a body
 * naming one is `order_stale` like any id that is not in the set. `1..n` stays below `COMMUNITY_MAX_ORDER`
 * (200), so a renumbered position can never collide with the sentinel.
 *
 * Duplicates are refused by the contract before this runs (400: a list naming one community twice is
 * malformed, not stale), and re-stated here for any caller that does not pass through the route.
 * Ids are compared lower-cased, because two spellings of one uuid are one community.
 */
export async function reorderCommunities(
  ctx: RequestContext,
  input: ReorderCommunities,
  viewer: CommunityViewerFlags,
): Promise<CommunityPage> {
  const requested = input.ids.map((id) => id.toLowerCase());
  if (new Set(requested).size !== requested.length) {
    throw new ApiError(400, 'VALIDATION_FAILED');
  }

  const { page, moved } = await withTenantTx(ctx, async (tx) => {
    const locked = await tx.execute<{ id: string }>(sql`
      select c.id
        from communities c
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.deleted_at is null
         and c.status = 'active'
         and c.kind = 'organization'
       order by c.id
       for update`);
    const current = new Set(locked.map((row) => row.id));
    if (requested.length !== current.size || requested.some((id) => !current.has(id))) {
      throw new ApiError(409, 'CONFLICT', { community: 'order_stale' });
    }

    // The ids travel as ONE Postgres array literal: drizzle's `sql` would expand a JS array into a
    // comma-separated parameter list. Every element is a Zod-validated uuid AND a member of the set
    // just locked, so nothing caller-shaped reaches the literal.
    const renumbered = await tx.execute<{ id: string }>(sql`
      update communities c
         set position = o.ord::int,
             updated_at = now()
        from unnest(${`{${requested.join(',')}}`}::uuid[]) with ordinality as o(id, ord)
       where c.id = o.id
         and c.tenant_id = ${ctx.tenantId}::uuid
         and c.deleted_at is null
         and c.status = 'active'
         and c.kind = 'organization'
         and c.position <> o.ord
      returning c.id`);

    const rows = await activePage(tx, ctx, COMMUNITY_PAGE_SIZE, null);
    return { page: pageOf(rows, COMMUNITY_PAGE_SIZE, activeKey, viewer), moved: renumbered.length };
  });

  log.info(
    {
      event: 'communities.reordered',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      // Counts only: neither the ids' order nor a name belongs in a log line (T-05-06).
      count: requested.length,
      moved,
    },
    'communities reordered',
  );

  return page;
}

/**
 * `DELETE /v1/communities/{communityId}` (09.3, PEND-04, PEND-06) - an ARCHIVED community is
 * soft-deleted by filling `deleted_at`. One tenant-lane transaction, four steps:
 *
 *  1. **Locking read, tenant-scoped, FIRST.** `select status ... for update` under the explicit
 *     `tenant_id` predicate: an unknown id, another tenant's community (active OR archived) and an
 *     already deleted one are the SAME bare 404, decided BEFORE any state check, so the 409s below are
 *     never an existence oracle (D-23). The `FOR UPDATE` is deliberate: the Loja's link insert takes
 *     `FOR KEY SHARE` on this row through the foreign key of `store_product_communities`, and only
 *     `FOR UPDATE` conflicts with it (a plain UPDATE is `FOR NO KEY UPDATE` and would not), so a
 *     product link committed concurrently with this delete is serialised against it.
 *  2. **Archived only (D-553).** Anything else is `409 { community: 'not_archived' }`, nothing written.
 *  3. **No active product unlocks it (D-554).** The Loja is READ by SQL name and never written (MOD-02):
 *     the active products linking the community, newest first (`created_at desc, id desc`, a
 *     deterministic selection), at most `COMMUNITY_UNLOCK_NAMES_MAX` names plus the total. Links count
 *     regardless of the COMMUNITY's status, as the gate does; archived products do not count. The store
 *     module flag is read in the same transaction from `tenant_modules`, exactly as
 *     `app.community_locked_ids()` reads it (assumption A1): with the Loja off the links unlock nothing
 *     and do not block. Reading it in SQL adds no kernel import and no cached read that could contradict
 *     the gate for one request. The refusal is `409 { community: 'unlock_active', products, count }`.
 *  4. **Soft delete (D-555).** One UPDATE of `deleted_at` and `updated_at`. No row is deleted anywhere:
 *     posts, comments, likes, highlights and store links all stay, and every read already filters
 *     `deleted_at is null`.
 *
 * What it does not do. D-556: `story_community_pins` was dropped in Phase 05.2-11, so there is nothing
 * to treat there; `community_members` is born-unused, so there is no member row; the highlights stay and
 * are hidden by the read filters. D-557: the slug stays with the row (`communities_tenant_slug_uq` has
 * no `deleted_at` predicate), so a new community with the same name gets the numeric suffix.
 *
 * Silent, like the event delete: no `emit(...)`, one ids-only log line (never a name, T-05-06).
 */
export async function deleteCommunity(
  ctx: RequestContext,
  communityId: string,
  /** 10-05: `communities.community.manage`, read by the route from the composed permission set. */
  opts: { canManage: boolean },
): Promise<void> {
  await withTenantTx(ctx, async (tx) => {
    // 10-05 (D-713): the owner predicate first, on a plain read (a visible row the caller does not own is
    // 403, a miss is the bare 404), then the locking read below sees the row for whoever may write it.
    await assertMayWriteCommunity(tx, ctx, communityId, opts.canManage);
    const found = await tx.execute<{
      status: string;
      name: string;
      kind: string;
      created_by_user_id: string | null;
    }>(sql`
      select status, name, kind, created_by_user_id
        from communities
       where tenant_id = ${ctx.tenantId}::uuid
         and id = ${communityId}::uuid
         and deleted_at is null
         for update`);
    const current = found[0];
    if (!current) throw new ApiError(404, 'NOT_FOUND');
    if (current.status !== 'archived') {
      throw new ApiError(409, 'CONFLICT', { community: 'not_archived' });
    }

    const unlocking = await tx.execute<{ id: string; name: string; total: number }>(sql`
      select p.id::text as id, p.name, (count(*) over ())::int as total
        from store_product_communities l
        join store_products p on p.id = l.product_id and p.tenant_id = l.tenant_id
       where l.tenant_id = ${ctx.tenantId}::uuid
         and l.community_id = ${communityId}::uuid
         and p.status = 'active'
         and exists (
           select 1
             from tenant_modules tm
            where tm.tenant_id = l.tenant_id
              and tm.module_key = 'store'
              and tm.enabled)
       order by p.created_at desc, p.id desc
       limit ${COMMUNITY_UNLOCK_NAMES_MAX}`);
    const first = unlocking[0];
    if (first) {
      throw new ApiError(409, 'CONFLICT', {
        community: 'unlock_active',
        products: unlocking.map(({ id, name }) => ({ id, name })),
        count: first.total,
      });
    }

    await tx.execute(sql`
      update communities
         set deleted_at = now(),
             updated_at = now()
       where tenant_id = ${ctx.tenantId}::uuid
         and id = ${communityId}::uuid
         and deleted_at is null`);

    // 10-05 (D-711): a moderator's removal of somebody's member community leaves its row in this same
    // transaction (a log failure rolls the delete back). The creator's own delete writes none.
    await logModeratorAction(
      tx,
      ctx,
      'community_removed',
      {
        id: communityId,
        name: current.name,
        kind: current.kind,
        createdBy: current.created_by_user_id,
      },
      opts.canManage,
    );
  });

  log.info(
    {
      event: 'communities.deleted',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      communityId,
    },
    'community deleted',
  );
}
