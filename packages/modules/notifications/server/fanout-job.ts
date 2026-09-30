import type { DomainEventName } from '@rede-social/contracts';
import { withTenantTx } from '@rede-social/core/db/tenant-tx';
import { moduleLogger } from '@rede-social/core/server/logging';
import type { JobDefinition } from '@rede-social/core/server/modules/manifest';
import { sourcesFor } from '@rede-social/core/server/notifications/source';
import {
  NOTIFICATIONS_QUEUES,
  type NotificationsFanoutJob,
  notificationsFanoutJobSchema,
} from '../contracts/index';
import { deliverIntent } from './channels/registry';
import { notificationsSystemCtx } from './system-context';

const log = moduleLogger('module-notifications');

/**
 * `notifications.fanout` (NOTIF-01): runs in the WORKER. Inside ONE tenant-lane transaction of the
 * payload's tenant it asks every source registered for the event (the producer modules' own
 * `notificationSources`, through the kernel seam) for intents, and delivers each through the channel
 * registry. Retractions are 07-04's.
 *
 * A malformed payload is DROPPED with a shape-only warning, never raised: pg-boss would retry a raise
 * forever against a shape that can never become valid (the unfurl precedent). A source or delivery
 * failure DOES raise, so the transaction rolls back and pg-boss retries; the dedupe key makes the
 * retry insert nothing twice.
 *
 * Logs carry the shape only: event, counts, kinds. Never an excerpt, a name or a fact (the ids-only
 * prohibition).
 */
export const notificationsFanoutJob: JobDefinition<NotificationsFanoutJob> = {
  name: NOTIFICATIONS_QUEUES.fanout,
  handler: async (raw) => {
    const parsed = notificationsFanoutJobSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn({ event: 'notifications.fanout.bad_payload' }, 'fan-out payload rejected');
      return;
    }
    const { event, tenantId, payload, sinkAt } = parsed.data;
    const name = event as DomainEventName;

    const summary = await withTenantTx(notificationsSystemCtx(tenantId), async (tx) => {
      let intents = 0;
      let delivered = 0;
      for (const source of sourcesFor(name)) {
        for (const intent of await source.resolve(tx, payload as never, { sinkAt })) {
          intents += 1;
          const result = await deliverIntent(tx, tenantId, intent);
          delivered += result.delivered.in_app?.length ?? 0;
        }
      }
      return { intents, delivered };
    });

    log.info(
      { event: 'notifications.fanout', name, tenantId, ...summary },
      'notifications fanned out',
    );
  },
};
