import type { MembershipBlocked } from '@rede-social/contracts/moderation';
import { REALTIME_EVENTS, topicSuffix } from '@rede-social/contracts/realtime';
import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { type Logger, moduleLogger } from '@rede-social/core/server/logging';
import { sql } from 'drizzle-orm';
import { notificationsSystemCtx } from './system-context';

const log = moduleLogger('module-notifications');

/** Runs `fn` in the tenant lane of `ctx` — `withTenantTx` in production, a stub in the unit test. */
export type LaneRunner = (
  ctx: RequestContext,
  fn: (tx: Tx) => Promise<unknown>,
) => Promise<unknown>;

/**
 * MODER-02 "revoked immediately" (08-04, RESEARCH Pitfall 6, T-08-24) — the notifications module's
 * answer to the kernel's `membership.blocked`, delivered by the bus AFTER the block committed.
 *
 * In a tenant-lane system context for `payload.tenantId` (DATA, not authority: RLS and the definers
 * pin every statement to that tenant), two independent steps:
 *
 * 1. **Eager push cleanup.** The 07-06 dead-device definer, called with `array[userId]` (07-06 named
 *    Phase 8's block as its eager caller), deletes the blocked member's devices now, instead of at
 *    the next fan-out's lazy sweep.
 * 2. **The Realtime nudge.** `notifications.changed` on `tenant:<t>:user:<userId>`, the counters-refetch
 *    signal `LiveShell` already listens to. The member's open app refetches its counters, the API
 *    answers 403 `MEMBERSHIP_BLOCKED`, and the shell lands on the shipped blocked flow without a
 *    reload. The payload is ids-only (`{ kind }`); the block's reason is never in an event (D-331).
 *
 * BEST-EFFORT, BOTH. Each step runs in its OWN transaction (a failed statement would otherwise abort
 * the other), and a failure is logged as `notifications.membership_blocked_failed` with ids only and
 * NEVER thrown: the block already committed, and nothing here may undo or delay it. The lazy sweep
 * and the access token's expiry remain the backstop.
 */
export function createMembershipBlockedHandler(
  run: LaneRunner = (ctx, fn) => withTenantTx(ctx, fn),
  logger: Pick<Logger, 'info' | 'error'> = log,
): (payload: MembershipBlocked) => Promise<void> {
  return async (payload) => {
    const ctx = notificationsSystemCtx(payload.tenantId);
    const ids = { tenantId: payload.tenantId, membershipId: payload.membershipId };

    let devicesRemoved: number | null = null;
    try {
      await run(ctx, async (tx) => {
        const rows = await tx.execute<{ removed: number }>(
          sql`select app.push_subscriptions_delete_dead(array[${payload.userId}]::uuid[]) as removed`,
        );
        devicesRemoved = Number(rows[0]?.removed ?? 0);
      });
    } catch (err) {
      logger.error(
        { err, event: 'notifications.membership_blocked_failed', step: 'push_cleanup', ...ids },
        'eager push cleanup after a block failed',
      );
    }

    try {
      await run(ctx, (tx) =>
        tx.execute(
          sql`select app.realtime_signal(${topicSuffix.user(payload.userId)}, ${REALTIME_EVENTS.notificationsChanged}, ${JSON.stringify({ kind: 'membership' })}::jsonb)`,
        ),
      );
    } catch (err) {
      logger.error(
        { err, event: 'notifications.membership_blocked_failed', step: 'realtime_nudge', ...ids },
        'realtime nudge after a block failed',
      );
    }

    logger.info(
      { event: 'notifications.membership_blocked', ...ids, devicesRemoved },
      'blocked member devices cleaned and app nudged',
    );
  };
}

/** The manifest's subscriber (`module.ts` `events`). */
export const onMembershipBlocked = createMembershipBlockedHandler();
