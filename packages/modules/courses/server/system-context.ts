import type { RequestContext } from '@rede-social/core/server/auth/context';

/**
 * The zero user: never a real user, so nothing read, written or emitted under this lane can be
 * mistaken for a member's own action. The courses module cannot import the notifications module's
 * system context (MOD-02), so it owns its own, like the events module.
 */
export const COURSES_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * The worker's tenant lane for one course job's tenant (`courses.live_reminder`, 08.6-05; plans 06
 * and 07 add their jobs here). `tenantId` comes from the job payload and is DATA, not authority
 * (T-08.6-06): RLS and the explicit predicates still pin every read to that tenant.
 *
 * **`support_tenant`, not `member`** (08.6-05 planning decision 1, a deviation from RESEARCH's
 * sketch): under the `member` claim the zero user holds no entitlement, so the restrictive
 * `course_lives_live_gate` and `course_lessons_course_gate` would hide every product-linked live and
 * lesson, and a reminder for a live sold by a product would skip `not_found`. The staff claim makes
 * the lock seams (`app.live_locked_ids()`, `app.course_locked_ids()`) answer `'{}'`. The jobs read
 * ids, instants and titles only and never answer a member. Recipients never come from a lane select
 * of `course_live_reminders` (the zero user owns no row, R-Pitfall 2): they come from
 * `app.course_live_reminder_user_ids`.
 *
 * A fresh `events` array per call: the job emits on it and flushes it itself.
 */
export function coursesSystemCtx(tenantId: string): RequestContext {
  return {
    userId: COURSES_SYSTEM_USER_ID,
    tenantId,
    role: 'support_tenant',
    requestId: 'job:courses',
    events: [],
  };
}
