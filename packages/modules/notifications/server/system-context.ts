import type { RequestContext } from '@rede-social/core/server/auth/context';

/**
 * The zero user: never a real user, so the owner-scoped `notifications` policies show this lane no
 * row, and nothing written under it can be mistaken for a member's own action.
 */
export const NOTIFICATIONS_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * The worker's tenant lane for one event's tenant (planning decision 6). `payload.tenantId` is DATA,
 * not authority (the unfurl precedent, T-07-05): RLS and the definers still pin every read and write
 * to this tenant.
 *
 * `support_tenant`, not `member`, on purpose: 07-08's participant-aware chat policies must admit the
 * chat source reading a conversation, while `event_secrets` (an `admin_tenant`-only policy) stays
 * closed to the worker.
 */
export function notificationsSystemCtx(tenantId: string): RequestContext {
  return {
    userId: NOTIFICATIONS_SYSTEM_USER_ID,
    tenantId,
    role: 'support_tenant',
    requestId: 'job:notifications',
    events: [],
  };
}
