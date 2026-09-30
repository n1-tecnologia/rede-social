import type { Tx } from '@rede-social/core/db/tenant-tx';
import { moduleLogger } from '@rede-social/core/server/logging';
import type {
  NotificationChannelKey,
  NotificationIntent,
} from '@rede-social/core/server/notifications/source';
import type { NotificationChannel } from './types';

const log = moduleLogger('module-notifications');

/**
 * NOTIF-04's seam (RESEARCH Pattern 7): delivery goes through this map, never through a hard-coded
 * call. 07-01 registers `in_app`; 07-06 registers `push` from its own file.
 */
const channels = new Map<NotificationChannelKey, NotificationChannel>();

/** Delivery order: in-app first, because push (07-06) is gated on the rows in-app NEWLY inserted. */
const CANONICAL_ORDER: readonly NotificationChannelKey[] = ['in_app', 'push'];

/** Called at module import time. Registering a key again replaces it (tests). */
export function registerChannel(adapter: NotificationChannel): void {
  channels.set(adapter.key, adapter);
}

/** The registered adapter for `key`; throws for an unregistered key (a wiring bug, not a runtime state). */
export function channel(key: NotificationChannelKey): NotificationChannel {
  const adapter = channels.get(key);
  if (!adapter) throw new Error(`channel ${key} not registered`);
  return adapter;
}

/** The requested keys that are registered, in canonical `in_app`, `push` order, de-duplicated. */
export function registeredChannels(keys: readonly NotificationChannelKey[]): NotificationChannel[] {
  const wanted = new Set(keys);
  return CANONICAL_ORDER.filter((key) => wanted.has(key) && channels.has(key)).map((key) =>
    channel(key),
  );
}

/** Test seam: forget every registration. */
export function resetChannelsForTest(): void {
  channels.clear();
}

/**
 * Deliver one intent through every channel it requests, in canonical order. `in_app`'s `delivered`
 * list becomes the `recipients` of every later channel, so push (07-06) reaches only the members who
 * got a NEW row (a retried job pushes nobody twice). A requested key with no adapter is logged as
 * `notifications.channel_unavailable` and skipped: the job never fails because a channel is absent.
 *
 * Logs carry the SHAPE only (key, kind, counts), never facts (the ids-only prohibition).
 */
export async function deliverIntent(
  tx: Tx,
  tenantId: string,
  intent: NotificationIntent,
): Promise<{ delivered: Partial<Record<NotificationChannelKey, string[]>> }> {
  for (const key of new Set(intent.channels)) {
    if (!channels.has(key)) {
      log.warn(
        { event: 'notifications.channel_unavailable', key, kind: intent.kind, tenantId },
        'notification channel unavailable',
      );
    }
  }

  const delivered: Partial<Record<NotificationChannelKey, string[]>> = {};
  let recipients: string[] = [];
  for (const adapter of registeredChannels(intent.channels)) {
    const result = await adapter.deliver(tx, { tenantId, intent, recipients });
    delivered[adapter.key] = result.delivered;
    if (adapter.key === 'in_app') recipients = result.delivered;
  }
  return { delivered };
}
