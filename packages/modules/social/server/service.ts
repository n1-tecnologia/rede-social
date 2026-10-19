import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleLogger } from '@rede-social/core/server/logging';
import { sql } from 'drizzle-orm';
import type { FollowResult } from '../contracts/index';

// A child of the kernel root (WR-12): severity-formatted, LOG_LEVEL-aware, never a bare pino().
const log = moduleLogger('module-social');

type Ctx = Pick<RequestContext, 'userId' | 'tenantId' | 'role' | 'requestId'>;

/**
 * The social module's service (09-02: the follow graph). Every function is ONE `withTenantTx`, so
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
