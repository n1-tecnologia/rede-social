import type { MembershipAccessCut } from '@rede-social/contracts/payments';
import { REALTIME_EVENTS, topicSuffix } from '@rede-social/contracts/realtime';
import { withTenantTx } from '@rede-social/core/db/tenant-tx';
import { type Logger, moduleLogger } from '@rede-social/core/server/logging';
import { sql } from 'drizzle-orm';
import type { LaneRunner } from './membership-blocked';
import { notificationsSystemCtx } from './system-context';

const log = moduleLogger('module-notifications');

/**
 * PAY-17 (09.1-12, D-498, D-499) — the notifications module's answer to the kernel's
 * `membership.access_cut`, delivered by the bus AFTER the cut committed. The twin of
 * `membership-blocked.ts`, deliberately not a generalisation of it: the block handler is shipped and
 * tested, and the two events may diverge (a cut has a return, a block is manual).
 *
 * In a tenant-lane system context for `payload.tenantId` (DATA, not authority: RLS and the definers
 * pin every statement to that tenant), two independent steps:
 *
 * 1. **Eager push cleanup (D-498: a cut member receives no push).** The dead-device definer, called
 *    with `array[userId]`, deletes the cut member's devices now instead of at the next send job's
 *    pre-send sweep. A cut never writes the membership, so the definer was widened to treat a cut
 *    subscription as dead (`20261021020907_push_devices_cut_members.sql`).
 * 2. **The Realtime nudge.** `notifications.changed` on `tenant:<t>:user:<userId>`, the counters-refetch
 *    signal `LiveShell` already listens to. The member's open app refetches its counters, the API
 *    answers 403 `SUBSCRIPTION_PENDING`, and the shell lands on the cut screen without a reload. The
 *    payload is ids-only (`{ kind }`).
 *
 * **The session is NOT revoked (D-499).** The identity is shared across communities: a person cut in
 * one community may hold a live subscription in another, and signing them out of Supabase would end
 * that session too. The API already refuses the cut member on the very next request, so this handler
 * only makes the open app notice and forgets its devices; the access token's expiry is no longer the
 * tail.
 *
 * BEST-EFFORT, BOTH. Each step runs in its OWN transaction (a failed statement would otherwise abort
 * the other), and a failure is logged as `notifications.membership_access_cut_failed` with ids only
 * (never the user id, an endpoint or an e-mail) and NEVER thrown: the cut already committed, and
 * nothing here may undo or delay it. The payload is data, not authority.
 */
export function createMembershipAccessCutHandler(
  run: LaneRunner = (ctx, fn) => withTenantTx(ctx, fn),
  logger: Pick<Logger, 'info' | 'error'> = log,
): (payload: MembershipAccessCut) => Promise<void> {
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
        { err, event: 'notifications.membership_access_cut_failed', step: 'push_cleanup', ...ids },
        'eager push cleanup after an access cut failed',
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
        {
          err,
          event: 'notifications.membership_access_cut_failed',
          step: 'realtime_nudge',
          ...ids,
        },
        'realtime nudge after an access cut failed',
      );
    }

    logger.info(
      { event: 'notifications.membership_access_cut', ...ids, devicesRemoved },
      'cut member devices cleaned and app nudged',
    );
  };
}

/** The manifest's subscriber (`module.ts` `events`). */
export const onMembershipAccessCut = createMembershipAccessCutHandler();
