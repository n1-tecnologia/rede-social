import type { DomainEventName } from '@rede-social/contracts';

/**
 * Where a domain event with notification sources goes after commit (07-01). The notifications
 * module registers its implementation (enqueue one `notifications.fanout` job) through the app
 * registry, exactly like `setPermissionResolver`; the kernel never imports it (MOD-02).
 *
 * Unlike the permission seam, the default here is a NO-OP rather than a throw: a build without the
 * notifications module simply notifies nobody, which is the correct behaviour of an absent module.
 */
export type NotificationSink = (event: DomainEventName, payload: unknown) => Promise<void>;

const noop: NotificationSink = async () => {};

let sink: NotificationSink = noop;

/** Called once, at import time, by the app registry. Last registration wins (tests). */
export function setNotificationSink(fn: NotificationSink): void {
  sink = fn;
}

/** The registered sink, or the no-op when the notifications module is absent. */
export function notificationSink(): NotificationSink {
  return sink;
}
