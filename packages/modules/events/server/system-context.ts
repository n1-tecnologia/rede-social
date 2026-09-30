import type { RequestContext } from '@rede-social/core/server/auth/context';

/**
 * The zero user: never a real user, so nothing written or emitted under this lane can be mistaken
 * for a member's own action. The events module cannot import the notifications module's system
 * context (MOD-02), so it owns its own (07-05 planning decision 2).
 */
export const EVENTS_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * The worker's tenant lane for one event's tenant (the `events.reminder` job). `tenantId` comes from
 * the job payload and is DATA, not authority (T-07-29): RLS and the explicit predicates still pin
 * every read to that tenant.
 *
 * `member`, not a staff role, on purpose: the job reads `events` and `event_attendances`, which every
 * member of the tenant may read, and must never reach `event_secrets` (an `admin_tenant`-only policy).
 *
 * A fresh `events` array per call: the job emits `event.reminder_due` on it and flushes it itself.
 */
export function eventsSystemCtx(tenantId: string): RequestContext {
  return {
    userId: EVENTS_SYSTEM_USER_ID,
    tenantId,
    role: 'member',
    requestId: 'job:events',
    events: [],
  };
}
