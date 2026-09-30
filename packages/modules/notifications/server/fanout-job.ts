import type { DomainEventName } from '@rede-social/contracts';
import { withTenantTx } from '@rede-social/core/db/tenant-tx';
import { moduleLogger } from '@rede-social/core/server/logging';
import type { JobDefinition } from '@rede-social/core/server/modules/manifest';
import { retractionsFor, sourcesFor } from '@rede-social/core/server/notifications/source';
import {
  NOTIFICATIONS_QUEUES,
  type NotificationsFanoutJob,
  notificationsFanoutJobSchema,
} from '../contracts/index';
import { deliverIntent } from './channels/registry';
import { retractNotifications } from './retract';
import { notificationsSystemCtx } from './system-context';

const log = moduleLogger('module-notifications');

/**
 * `notifications.fanout` (NOTIF-01): runs in the WORKER. Inside ONE tenant-lane transaction of the
 * payload's tenant it asks every source registered for the event (the producer modules' own
 * `notificationSources`, through the kernel seam) for intents, and delivers each through the channel
 * registry. Then, in the SAME transaction, every retraction registered for the event (07-04) blanks
 * the rows about a deleted target (`app.notifications_retract`, keep-and-mark). A retraction publishes
 * no signal: the counts are unchanged, and the D-240 refetch brings the open list up to date.
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
      let retracted = 0;
      for (const source of sourcesFor(name)) {
        for (const intent of await source.resolve(tx, payload as never, { sinkAt })) {
          intents += 1;
          const result = await deliverIntent(tx, tenantId, intent);
          delivered += result.delivered.in_app?.length ?? 0;
        }
      }
      for (const retraction of retractionsFor(name)) {
        retracted += await retractNotifications(tx, retraction.match(payload as never));
      }
      return { intents, delivered, retracted };
    });

    log.info(
      { event: 'notifications.fanout', name, tenantId, ...summary },
      'notifications fanned out',
    );
  },
};
