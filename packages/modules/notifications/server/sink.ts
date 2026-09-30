import { randomUUID } from 'node:crypto';
import type { DomainEventName } from '@rede-social/contracts';
import { withTenantTx } from '@rede-social/core/db/tenant-tx';
import { enqueueInTx } from '@rede-social/core/server/jobs/boss';
import { moduleLogger } from '@rede-social/core/server/logging';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { NOTIFICATIONS_QUEUES } from '../contracts/index';
import { notificationsSystemCtx } from './system-context';

const log = moduleLogger('module-notifications');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The notification sink (07-01), registered on the kernel seam by the app registry
 * (`setNotificationSink`). The bus subscriber for every event any module declared a source for calls
 * it after the producing request committed, and it ONLY enqueues: the fan-out runs in the worker,
 * never inside the producing request (CONTEXT, RESEARCH Pattern 6).
 *
 * - `payload.tenantId` must be a uuid; otherwise the shape is logged and nothing is enqueued.
 * - A tenant with `notifications` disabled enqueues nothing.
 * - The enqueue is `enqueueInTx` inside a tenant-lane transaction of the event's tenant, and
 *   `sinkAt` is stamped ONCE here, so a retried job reuses it unchanged (07-05's reactivations).
 *
 * **Every delivery is its own job (07-04 fix).** Every queue is created with the `short` policy, whose
 * `job_common_i1` unique index keys `(name, coalesce(singleton_key, ''))` over `created` jobs: without
 * a key, a SECOND event enqueued while the first job still waits for the worker was silently dropped
 * (`send` returned null). Each sink call therefore carries a fresh `singletonKey`; idempotency lives
 * where it always did, in the fan-out's dedupe key, not in the queue.
 *
 * **Delivery guarantee: at-most-once** (RESEARCH open question 2, RESOLVED). The bus flushes after
 * commit and swallows handler failures, so an instance dying between commit and this enqueue loses
 * the bell row (logged as `domain_event.handler_failed`). The D-240 refetch keeps the badge honest;
 * the kernel `emitInTx` upgrade path is a recorded deferred item.
 */
export async function notificationsSink(event: DomainEventName, payload: unknown): Promise<void> {
  const tenantId =
    payload !== null && typeof payload === 'object'
      ? (payload as { tenantId?: unknown }).tenantId
      : undefined;
  if (typeof tenantId !== 'string' || !UUID.test(tenantId)) {
    log.warn({ event: 'notifications.sink.bad_payload', name: event }, 'notification sink skipped');
    return;
  }
  const ctx = notificationsSystemCtx(tenantId);
  if (!(await moduleFlags.isEnabled(ctx, 'notifications'))) return;

  await withTenantTx(ctx, (tx) =>
    enqueueInTx(
      tx,
      NOTIFICATIONS_QUEUES.fanout,
      { event, tenantId, payload, sinkAt: new Date().toISOString() },
      { singletonKey: `${event}:${randomUUID()}` },
    ),
  );
}
