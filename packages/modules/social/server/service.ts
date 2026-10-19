import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleLogger } from '@rede-social/core/server/logging';
import { decodeCursor, encodeCursor } from '@rede-social/core/server/paging';
import { sql } from 'drizzle-orm';
import type {
  FollowResult,
  FollowState,
  MemberSocialProfile,
  SocialListPage,
  SocialListQuery,
} from '../contracts/index';

// A child of the kernel root (WR-12): severity-formatted, LOG_LEVEL-aware, never a bare pino().
const log = moduleLogger('module-social');

type Ctx = Pick<RequestContext, 'userId' | 'tenantId' | 'role' | 'requestId'>;

/**
 * The social module's service (09-02: the follow graph and its reads). Every function is ONE `withTenantTx`, so
 * every read and write runs under the `authenticated` role with the caller's claims: the
 * `social_follows` policies (own rows only, member-only insert, own delete) are the authority, and
 * this file never opens the admin lane.
 *
 * Log lines carry ids and booleans only (`social.follow` / `social.unfollow`), never a display name,
 * and never the other party's identity beyond the membership id the caller already named (D-468,
 * PR-1: nothing about who follows whom leaves the two parties).
 *
 * "A live member" is the one predicate this file repeats (`LIVE_MEMBER`): role `member`, active, not
 * blocked, not removed. It is a FLAT conjunction on purpose, the `listMembers` posture (D-47): D-484
 * ("a blocked or removed member disappears") is one more `and` on this line, not a helper.
 */
const LIVE_MEMBER = sql`m.role = 'member' and m.status = 'active' and m.blocked_at is null and m.deleted_at is null`;

/**
 * The keyset cursor's instant, formatted as the feed formats it: microseconds preserved, so the
 * `(created_at, id)` comparison never rounds a row across a page boundary (a JS `Date` truncates to
 * milliseconds and would skip a row written in the same millisecond).
 */
const ISO_MICROSECONDS = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);

type Counts = { followers: number; following: number };

/** `app.social_counts` through the lane: `null` when the membership is not a live member here. */
async function countsOf(tx: Tx, membershipId: string): Promise<Counts | null> {
  const rows = await tx.execute<{ counts: Counts | null }>(
    sql`select app.social_counts(${membershipId}::uuid) as counts`,
  );
  return rows[0]?.counts ?? null;
}

/** Postgres' SQLSTATE walked out of whatever the driver wrapped the error in (communities' shape). */
function pgCode(error: unknown): string | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return candidate.code;
    }
    current = candidate.cause;
  }
  return null;
}

/**
 * `PUT /v1/social/follows/{membershipId}` (FOLLOW-01, FOLLOW-02, D-467): the caller follows the
 * member behind that membership. Idempotent: a repeat answers the same 200 and leaves one row.
 *
 * Order: (1) resolve the target in the lane, live members only; no row is the bare 404 with NO
 * details, the same answer for an unknown id, another tenant's, staff, blocked, invited and removed
 * (T-09-03: one body, no existence oracle). (2) Refuse the caller's own membership with the closed
 * code `self_follow`, BEFORE any write. (3) Insert with `on conflict (tenant_id, follower_user_id,
 * followee_user_id) do nothing`: the unique index is the arbiter, so ten parallel PUTs leave one row
 * and answer 200 (EP-34). The insert re-selects the target's liveness in the SAME statement and the
 * insert policy re-checks it, so a target blocked between (1) and (3) stores nothing (EP-35).
 * (4) Read the count back through the definer; `null` there means the target stopped being a live
 * member after all, which is the bare 404 again.
 */
export async function followMember(ctx: Ctx, membershipId: string): Promise<FollowResult> {
  try {
    const result = await withTenantTx(ctx, async (tx) => {
      const target = await tx.execute<{ user_id: string }>(sql`
        select m.user_id
          from memberships m
         where m.id = ${membershipId}::uuid and ${LIVE_MEMBER}
         limit 1`);
      const row = target[0];
      if (!row) throw new ApiError(404, 'NOT_FOUND');
      if (row.user_id === ctx.userId) {
        throw new ApiError(400, 'VALIDATION_FAILED', { follow: 'self_follow' });
      }

      await tx.execute(sql`
        insert into social_follows (tenant_id, follower_user_id, followee_user_id)
        select app.tenant_id(), ${ctx.userId}::uuid, m.user_id
          from memberships m
         where m.id = ${membershipId}::uuid and ${LIVE_MEMBER}
        on conflict (tenant_id, follower_user_id, followee_user_id) do nothing`);

      const counts = await countsOf(tx, membershipId);
      if (!counts) throw new ApiError(404, 'NOT_FOUND');
      return { following: true, followerCount: counts.followers } satisfies FollowResult;
    });
    log.info(
      {
        event: 'social.follow',
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        requestId: ctx.requestId,
        membershipId,
        followerCount: result.followerCount,
      },
      'member followed',
    );
    return result;
  } catch (error) {
    // The insert policy refused a statement the guard had let through: `social` was turned off, or
    // the role changed, between the guard and the write. That is D-483's answer, not a 500.
    if (pgCode(error) === '42501') throw new ApiError(404, 'MODULE_DISABLED');
    throw error;
  }
}

/**
 * `DELETE /v1/social/follows/{membershipId}` (FOLLOW-01, EP-33): removes the CALLER'S OWN row toward
 * that member and answers `following: false` with the target's follower count. Never a 404 and never
 * a 409: a repeat, an unknown id and a target that was blocked or demoted since all answer 200,
 * because unfollowing is the caller's own row and must stay possible after the target stopped being
 * a live member (the lookup here carries NO liveness predicate, unlike the follow). The count is 0
 * when the target is no longer a live member (the definer answers null).
 */
export async function unfollowMember(ctx: Ctx, membershipId: string): Promise<FollowResult> {
  const result = await withTenantTx(ctx, async (tx) => {
    const target = await tx.execute<{ user_id: string }>(sql`
      select m.user_id from memberships m where m.id = ${membershipId}::uuid limit 1`);
    const row = target[0];
    if (!row) return { following: false, followerCount: 0 } satisfies FollowResult;

    await tx.execute(sql`
      delete from social_follows
       where tenant_id = app.tenant_id()
         and follower_user_id = ${ctx.userId}::uuid
         and followee_user_id = ${row.user_id}::uuid`);

    const counts = await countsOf(tx, membershipId);
    return { following: false, followerCount: counts?.followers ?? 0 } satisfies FollowResult;
  });
  log.info(
    {
      event: 'social.unfollow',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      membershipId,
      followerCount: result.followerCount,
    },
    'member unfollowed',
  );
  return result;
}

type ListRow = {
  membership_id: string;
  display_name: string;
  bio: string | null;
  avatar_asset_id: string | null;
  viewer_follows: boolean;
  created_at: string;
  follow_id: string;
};

/**
 * Both private lists, ONE statement each (D-468, D-484). Which side of the edge is the caller:
 * `followers` reads the rows where the caller is the FOLLOWEE and shows the follower; `following`
 * reads the rows where the caller is the FOLLOWER and shows the followee. The caller's id comes from
 * the SESSION (`ctx.userId`), never from a parameter, and the `social_follows_select_own` policy
 * would hide any other row even if a bug passed another id.
 *
 * Liveness is a join, not a post-filter: the other party must be a live member (role `member`,
 * active, not blocked, not removed) IN the statement, so a page is never short because of a filter
 * applied after the limit (planning decision 4). The order is `(created_at desc, id desc)`, the
 * total order the two indexes are built on: two follows with the identical instant occupy two stable
 * adjacent slots a page boundary can neither duplicate nor skip (EP-38). Over-fetch by one decides
 * `nextCursor`, so the UI never offers a "Carregar mais" that returns nothing.
 */
async function listSide(
  ctx: Ctx,
  side: 'followers' | 'following',
  query: SocialListQuery,
): Promise<SocialListPage> {
  const limit = query.limit;
  const after = decodeCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;
  // followers: the caller is the followee and the OTHER party is the follower; following: the reverse.
  const mine = side === 'followers' ? sql`f.followee_user_id` : sql`f.follower_user_id`;
  const other = side === 'followers' ? sql`f.follower_user_id` : sql`f.followee_user_id`;

  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<ListRow>(sql`
      select m.id as membership_id,
             mp.display_name,
             mp.bio,
             mp.avatar_asset_id,
             exists (
               select 1 from social_follows mf
                where mf.tenant_id = f.tenant_id
                  and mf.follower_user_id = ${ctx.userId}::uuid
                  and mf.followee_user_id = ${other}
             ) as viewer_follows,
             to_char(f.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as created_at,
             f.id as follow_id
        from social_follows f
        join memberships m on m.tenant_id = f.tenant_id and m.user_id = ${other}
        join member_profiles mp on mp.membership_id = m.id
       where ${mine} = ${ctx.userId}::uuid
         and ${LIVE_MEMBER}
         and (
           ${afterAt}::timestamptz is null
           or (f.created_at, f.id) < (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by f.created_at desc, f.id desc
       limit ${limit + 1}`),
  );

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ n: last.created_at, id: last.follow_id }) : null;

  log.info(
    {
      event: `social.list_${side}`,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      limit,
      returned: page.length,
      hasNext: nextCursor !== null,
    },
    `${side} listed`,
  );

  return {
    items: page.map((row) => ({
      membershipId: row.membership_id,
      displayName: row.display_name,
      bio: row.bio,
      avatarAssetId: row.avatar_asset_id,
      viewerFollows: row.viewer_follows,
    })),
    nextCursor,
  };
}

/** `GET /v1/social/me/followers` (FOLLOW-03, D-468): the caller's own followers, newest first. */
export const listFollowers = (ctx: Ctx, query: SocialListQuery): Promise<SocialListPage> =>
  listSide(ctx, 'followers', query);

/** `GET /v1/social/me/following` (FOLLOW-03, D-468): who the caller follows, newest first. */
export const listFollowing = (ctx: Ctx, query: SocialListQuery): Promise<SocialListPage> =>
  listSide(ctx, 'following', query);

/**
 * `POST /v1/social/follows/state`: one item per input id, in INPUT order, with `following` read from
 * the caller's OWN rows. An id that is unknown, staff, blocked, removed or of another tenant resolves
 * to no live member and answers `following: false`, the same value an honest "not followed" gives,
 * so the answer carries no existence signal (T-09-03). Duplicate ids answer twice.
 */
export async function followState(ctx: Ctx, membershipIds: string[]): Promise<FollowState> {
  // The ids are Zod-validated uuids; they travel as ONE text parameter cast to `uuid[]` (the
  // communities `unnest` precedent), never spliced into the statement.
  const asked = `{${membershipIds.join(',')}}`;
  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<{ membership_id: string; following: boolean }>(sql`
      select o.id as membership_id,
             (f.id is not null) as following
        from unnest(${asked}::uuid[]) with ordinality as o(id, ord)
        left join memberships m on m.id = o.id and ${LIVE_MEMBER}
        left join social_follows f
               on f.tenant_id = m.tenant_id
              and f.follower_user_id = ${ctx.userId}::uuid
              and f.followee_user_id = m.user_id
       order by o.ord`),
  );
  log.info(
    {
      event: 'social.follow_state',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      asked: membershipIds.length,
      following: rows.filter((row) => row.following).length,
    },
    'follow state read',
  );
  return {
    items: rows.map((row) => ({ membershipId: row.membership_id, following: row.following })),
  };
}

/**
 * `GET /v1/social/members/{membershipId}` (FOLLOW-04, D-468): the two public counts of one member and
 * whether the caller follows them. The counts come from `app.social_counts` (two integers, never a
 * row). The caller's OWN id answers `self: true` with `viewerFollows: false`. A target that is not a
 * live member (staff, blocked, invited, removed, unknown, another tenant's) is the bare 404, so the
 * route is no more an existence oracle than the follow.
 */
export async function getMemberSocial(
  ctx: Ctx,
  membershipId: string,
): Promise<MemberSocialProfile> {
  const result = await withTenantTx(ctx, async (tx) => {
    const target = await tx.execute<{ user_id: string }>(sql`
      select m.user_id from memberships m
       where m.id = ${membershipId}::uuid and ${LIVE_MEMBER}
       limit 1`);
    const row = target[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    const counts = await countsOf(tx, membershipId);
    if (!counts) throw new ApiError(404, 'NOT_FOUND');
    const self = row.user_id === ctx.userId;
    let viewerFollows = false;
    if (!self) {
      const mine = await tx.execute<{ following: boolean }>(sql`
        select exists (
          select 1 from social_follows f
           where f.tenant_id = app.tenant_id()
             and f.follower_user_id = ${ctx.userId}::uuid
             and f.followee_user_id = ${row.user_id}::uuid) as following`);
      viewerFollows = mine[0]?.following ?? false;
    }
    return {
      membershipId,
      followerCount: counts.followers,
      followingCount: counts.following,
      viewerFollows,
      self,
    } satisfies MemberSocialProfile;
  });
  log.info(
    {
      event: 'social.member_read',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      membershipId,
      self: result.self,
      viewerFollows: result.viewerFollows,
      followerCount: result.followerCount,
      followingCount: result.followingCount,
    },
    'member social profile read',
  );
  return result;
}
