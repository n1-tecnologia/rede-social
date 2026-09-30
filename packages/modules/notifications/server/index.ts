import { inAppChannel } from './channels/in-app';
import { registerChannel } from './channels/registry';

/**
 * `@rede-social/module-notifications/server` — everything the API tier may touch. The app imports
 * THIS, never a file path inside the package (the `exports` map has no `./server/*`).
 *
 * NOTIF-04: the `in_app` adapter registers itself on the channel registry at import time. 07-06's
 * push adapter registers the same way from its own file.
 */
registerChannel(inAppChannel);

export {
  channel,
  deliverIntent,
  registerChannel,
  registeredChannels,
} from './channels/registry';
export type { ChannelResult, DeliveryBatch, NotificationChannel } from './channels/types';
export { notificationsFanoutJob } from './fanout-job';
export { notificationsRoutes } from './routes';
export { countUnseen, listNotifications, markAllRead, markAllSeen, markRead } from './service';
export { notificationsSink } from './sink';
export { NOTIFICATIONS_SYSTEM_USER_ID, notificationsSystemCtx } from './system-context';
export { inAppChannel };
