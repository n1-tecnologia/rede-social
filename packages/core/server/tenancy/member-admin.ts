import type { TenantRole } from '@rede-social/contracts';
import type { AdminMember, MemberAdminRefusal } from '@rede-social/contracts/moderation';
import { sql } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import type { Tx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';
import { emit } from '../events/bus';
import { ApiError } from '../http/api-error';
import { moduleLogger } from '../logging';
import { recordModerationAction } from '../moderation/log';
import { readMemberForAdmin } from './admin-members';

const log = moduleLogger('member-admin');

/**
 * Block and unblock ONE membership (MODER-02, D-330..D-333) — the admin's strongest tool, so it is
 * exact, logged, reversible and impossible to aim at the wrong tenant or at oneself.
 *
 * PER MEMBERSHIP, NEVER THE IDENTITY (08.1 D-304). Every statement targets one `memberships` row by
 * id AND `tenant_id = ${ctx.tenantId}`; nothing here touches `users` or `auth.users`, so another
 * tenant's membership of the same identity can never change.
 *
 * ADMIN LANE, TENANT PREDICATE ON EVERY STATEMENT (RESEARCH Pattern 4, Pitfall 5, T-08-19). Membership
 * writes are refused to the tenant lane by design (`memberships_tenant_select` is SELECT-only, see
 * `db/schema/memberships.ts`), so this runs in `withAdminTx`, where RLS is off: the explicit
 * `tenant_id = ${ctx.tenantId}` is the only isolation, and a rede-lab id from a rede-demo admin is the
 * bare 404.
 *
 * BOTH COLUMNS (RESEARCH Pitfall 3). A block sets `status = 'blocked'` AND `blocked_at = now()`; an
 * unblock sets `status = 'active'` AND `blocked_at = null`. Every reader — `app.membership_for_user`,
 * the directory, the profile, push, Realtime, fan-out — therefore agrees.
 *
 * THE D-332 GUARDS UNDER ROW LOCKS (T-08-20). `lockAdminsAndTarget` locks every ACTIVE admin of the
 * tenant plus the target in ONE statement, `order by id for update`, so two admins acting at once
 * always lock in the same order (no deadlock) and the second waits for the first. In READ COMMITTED a
 * waiting `for update` re-evaluates its predicate against the committed row, so the waiter sees the
 * admin set AFTER the first transaction: with exactly two admins blocking each other, one blocks and
 * the other is refused `last_admin`, and the tenant always keeps one active admin.
 *
 * IDEMPOTENT (MODER-02, explicit). Blocking an already-blocked membership, or unblocking an active
 * one, returns the current state with NO write and NO log row — a double tap or two admins acting at
 * once never duplicate the audit.
 *
 * LOGGED IN THE SAME TRANSACTION (T-08-21). `recordModerationAction(tx, …)` writes the
 * `member_blocked` / `member_unblocked` row inside the update's transaction; the optional reason
 * (D-331) is written ONLY there. Pino lines carry ids only.
 *
 * CONTENT IS UNTOUCHED (D-330). Nothing here reads or writes a post, comment, story or message.
 *
 * AFTER COMMIT, a block emits `membership.blocked { tenantId, userId, membershipId }` (ids only); the
 * notifications module cleans the member's push devices and nudges their open app. Both are
 * best-effort and can never undo the block (`flush` never rethrows).
 */

export type AccessChangeKind = 'block' | 'unblock';

/** The locked target, as the guard decision reads it. `blocked` is the folded state. */
export type LockedTarget = {
  id: string;
  userId: string;
  role: TenantRole;
  /** `status = 'invited'` — the raw column: an invite cannot be acted on until it is accepted (A7). */
  invited: boolean;
  /** `status = 'blocked' or blocked_at is not null` — the `app.membership_for_user` folding. */
  blocked: boolean;
};

export type AccessDecision =
  | { outcome: 'refuse'; refusal: MemberAdminRefusal }
  | { outcome: 'noop' }
  | { outcome: 'write' };

/**
 * THE guard decision, pure so every branch is unit-tested (`tests/member-admin-guards.test.ts`).
 * In order:
 *
 * 1. the actor aims at their own membership → `self` (no self-block, no self-unblock);
 * 2. the target is still `invited` → `not_active`;
 * 3. the target is already in the requested state → `noop` (200, no write, no log row);
 * 4. a BLOCK of an active admin while the active-admin set holds one or fewer → `last_admin`.
 *    Unblocking has no such check: it only ever adds an admin back.
 *
 * `activeAdminIds` is the LOCKED active-admin set, read in the same statement as the target.
 */
export function decideAccessChange(
  target: LockedTarget,
  activeAdminIds: readonly string[],
  actorUserId: string,
  kind: AccessChangeKind,
): AccessDecision {
  if (target.userId === actorUserId) return { outcome: 'refuse', refusal: 'self' };
  if (target.invited) return { outcome: 'refuse', refusal: 'not_active' };
  if (kind === 'block') {
    if (target.blocked) return { outcome: 'noop' };
    if (activeAdminIds.includes(target.id) && activeAdminIds.length <= 1) {
      return { outcome: 'refuse', refusal: 'last_admin' };
    }
    return { outcome: 'write' };
  }
  if (!target.blocked) return { outcome: 'noop' };
  return { outcome: 'write' };
}

/**
 * THE role-change decision (ADMIN-02, D-332, 08-05), pure like `decideAccessChange` and pinned the
 * same way (`tests/member-admin-guards.test.ts`). In order:
 *
 * 1. the actor aims at their own membership → `self` (nobody changes their own role, whatever the
 *    display names say: the comparison is the identity, never a name);
 * 2. the target is still `invited` → `not_active`;
 * 3. the target is blocked (the folded state) → `blocked`: unblock first, so a blocked person's role
 *    never changes behind their suspension;
 * 4. the target already holds `role` → `noop` (200, no write, no log row);
 * 5. the target is in the LOCKED active-admin set, the new role is not `admin_tenant`, and the set
 *    holds one or fewer → `last_admin`. Promoting, or demoting one of two admins, is allowed.
 */
export function decideRoleChange(
  target: LockedTarget,
  activeAdminIds: readonly string[],
  actorUserId: string,
  role: TenantRole,
): AccessDecision {
  if (target.userId === actorUserId) return { outcome: 'refuse', refusal: 'self' };
  if (target.invited) return { outcome: 'refuse', refusal: 'not_active' };
  if (target.blocked) return { outcome: 'refuse', refusal: 'blocked' };
  if (target.role === role) return { outcome: 'noop' };
  if (
    role !== 'admin_tenant' &&
    activeAdminIds.includes(target.id) &&
    activeAdminIds.length <= 1
  ) {
    return { outcome: 'refuse', refusal: 'last_admin' };
  }
  return { outcome: 'write' };
}

type LockedRow = {
  id: string;
  user_id: string;
  role: TenantRole;
  status: string;
  blocked: boolean;
  is_target: boolean;
  is_active_admin: boolean;
};

/**
 * ONE statement: every ACTIVE `admin_tenant` of the tenant together with the target, locked
 * `order by id for update`. Returns the active-admin ids and the target; no target is the bare 404
 * (unknown id, another tenant's id, a soft-deleted membership — one answer, no details).
 */
export async function lockAdminsAndTarget(
  tx: Tx,
  ctx: Pick<RequestContext, 'tenantId'>,
  membershipId: string,
): Promise<{ target: LockedTarget; activeAdminIds: string[] }> {
  const rows = await tx.execute<LockedRow>(sql`
    select id,
           user_id,
           role,
           status,
           (status = 'blocked' or blocked_at is not null) as blocked,
           (id = ${membershipId}::uuid) as is_target,
           (role = 'admin_tenant' and status = 'active' and blocked_at is null) as is_active_admin
      from memberships
     where tenant_id = ${ctx.tenantId}::uuid
       and deleted_at is null
       and (
         id = ${membershipId}::uuid
         or (role = 'admin_tenant' and status = 'active' and blocked_at is null)
       )
     order by id
       for update`);

  const targetRow = rows.find((row) => row.is_target);
  if (!targetRow) throw new ApiError(404, 'NOT_FOUND');
  return {
    target: {
      id: targetRow.id,
      userId: targetRow.user_id,
      role: targetRow.role,
      invited: targetRow.status === 'invited',
      blocked: targetRow.blocked,
    },
    activeAdminIds: rows.filter((row) => row.is_active_admin).map((row) => row.id),
  };
}

type AccessChangeResult = { member: AdminMember; changed: boolean; userId: string };

async function changeAccess(
  ctx: RequestContext,
  membershipId: string,
  kind: AccessChangeKind,
  reason: string | undefined,
): Promise<AdminMember> {
  const result = await withAdminTx(async (tx): Promise<AccessChangeResult> => {
    const { target, activeAdminIds } = await lockAdminsAndTarget(tx, ctx, membershipId);
    const decision = decideAccessChange(target, activeAdminIds, ctx.userId, kind);
    if (decision.outcome === 'refuse') {
      throw new ApiError(409, 'CONFLICT', { member: decision.refusal });
    }
    if (decision.outcome === 'write') {
      if (kind === 'block') {
        await tx.execute(sql`
          update memberships set status = 'blocked', blocked_at = now()
           where id = ${target.id}::uuid and tenant_id = ${ctx.tenantId}::uuid`);
      } else {
        await tx.execute(sql`
          update memberships set status = 'active', blocked_at = null
           where id = ${target.id}::uuid and tenant_id = ${ctx.tenantId}::uuid
             and (status = 'blocked' or blocked_at is not null)`);
      }
      await recordModerationAction(tx, ctx, {
        action: kind === 'block' ? 'member_blocked' : 'member_unblocked',
        targetUserId: target.userId,
        targetMembershipId: target.id,
        reason: reason ?? null,
      });
    }
    return {
      member: await readMemberForAdmin(tx, ctx, target.id),
      changed: decision.outcome === 'write',
      userId: target.userId,
    };
  });

  // After commit only: `withAdminTx` has returned, so the row is durable before anyone hears of it.
  if (result.changed && kind === 'block') {
    emit(ctx, 'membership.blocked', {
      tenantId: ctx.tenantId,
      userId: result.userId,
      membershipId: result.member.membershipId,
    });
  }

  // Ids only — never the reason (D-331).
  log.info(
    {
      event: kind === 'block' ? 'member.blocked' : 'member.unblocked',
      tenantId: ctx.tenantId,
      requestId: ctx.requestId,
      membershipId: result.member.membershipId,
      changed: result.changed,
    },
    kind === 'block' ? 'membership blocked' : 'membership unblocked',
  );
  return result.member;
}

/** `POST /v1/admin/members/{membershipId}/block` — see the module docblock for every rule. */
export function blockMembership(
  ctx: RequestContext,
  membershipId: string,
  { reason }: { reason?: string },
): Promise<AdminMember> {
  return changeAccess(ctx, membershipId, 'block', reason);
}

/** `POST /v1/admin/members/{membershipId}/unblock` — no last-admin check: it only adds an admin. */
export function unblockMembership(
  ctx: RequestContext,
  membershipId: string,
  { reason }: { reason?: string },
): Promise<AdminMember> {
  return changeAccess(ctx, membershipId, 'unblock', reason);
}

/**
 * `PUT /v1/admin/members/{membershipId}/role` (ADMIN-02, D-332, 08-05) — changes ONE membership's
 * role, under the SAME row locks as a block: `lockAdminsAndTarget` locks every active admin plus the
 * target `order by id for update`, so two admins demoting each other at once serialise, and the
 * waiter re-reads the committed rows (READ COMMITTED re-evaluates a waiting `for update` against the
 * new row version, so the admin the first transaction demoted has LEFT the set). With exactly two
 * admins that ends in one 200 and one 409 `last_admin`: the tenant always keeps an active admin.
 *
 * The update carries `tenant_id = ${ctx.tenantId}` (admin lane, RLS off), and the `role_changed` row
 * with `details = { from, to }` is written by `recordModerationAction(tx, …)` in the same
 * transaction (T-08-28). A same-role call writes nothing (idempotent).
 *
 * TAKES EFFECT ON THE NEXT REQUEST (D-332): permissions are composed from the membership row on every
 * request (`requireAuth` → the permission resolver), never from the JWT, so the promoted member's
 * very next `GET /v1/me/bootstrap` carries the new permissions without a token refresh, and a demoted
 * admin's next admin call is a 403.
 */
export async function setMembershipRole(
  ctx: RequestContext,
  membershipId: string,
  role: TenantRole,
): Promise<AdminMember> {
  const result = await withAdminTx(
    async (tx): Promise<{ member: AdminMember; changed: boolean; from: TenantRole }> => {
      const { target, activeAdminIds } = await lockAdminsAndTarget(tx, ctx, membershipId);
      const decision = decideRoleChange(target, activeAdminIds, ctx.userId, role);
      if (decision.outcome === 'refuse') {
        throw new ApiError(409, 'CONFLICT', { member: decision.refusal });
      }
      if (decision.outcome === 'write') {
        await tx.execute(sql`
          update memberships set role = ${role}
           where id = ${target.id}::uuid and tenant_id = ${ctx.tenantId}::uuid`);
        await recordModerationAction(tx, ctx, {
          action: 'role_changed',
          targetUserId: target.userId,
          targetMembershipId: target.id,
          details: { from: target.role, to: role },
        });
      }
      return {
        member: await readMemberForAdmin(tx, ctx, target.id),
        changed: decision.outcome === 'write',
        from: target.role,
      };
    },
  );

  // Ids and role names only.
  log.info(
    {
      event: 'member.role_changed',
      tenantId: ctx.tenantId,
      requestId: ctx.requestId,
      membershipId: result.member.membershipId,
      from: result.from,
      to: role,
      changed: result.changed,
    },
    'membership role changed',
  );
  return result.member;
}
