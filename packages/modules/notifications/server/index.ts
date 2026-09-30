import { inAppChannel } from './channels/in-app';
import { pushChannel } from './channels/push';
import { registerChannel } from './channels/registry';

/**
 * `@rede-social/module-notifications/server` — everything the API tier may touch. The app imports
 * THIS, never a file path inside the package (the `exports` map has no `./server/*`).
 *
 * NOTIF-04: the `in_app` and `push` adapters register themselves on the channel registry at import
 * time. The registry, not this order, decides delivery order (`in_app` first: push is gated on the rows
 * in-app NEWLY inserted). A V2 adapter (e-mail, WhatsApp) is one more file and one more line here.
 */
registerChannel(inAppChannel);
registerChannel(pushChannel);

export {
  channel,
  deliverIntent,
  registerChannel,
  registeredChannels,
} from './channels/registry';
export type { ChannelResult, DeliveryBatch, NotificationChannel } from './channels/types';
export { notificationsFanoutJob } from './fanout-job';
export { isAllowedPushEndpoint, type PushTransportName } from './push/endpoint';
export { buildPushPayload, NEUTRAL_PUSH_ICON, PUSH_TITLE_COPY } from './push/payload';
export { pushSendJob, runPushSend } from './push/send-job';
export {
  type FakePushSend,
  fakePushOutbox,
  fakePushTransport,
  outcomeForStatus,
  type PushOutcome,
  type PushSendOptions,
  type PushTarget,
  type PushTransport,
  pushTransport,
  resetFakePushOutbox,
  webPushTransport,
} from './push/transport';
export { deletePushSubscription, savePushSubscription } from './push-subscriptions';
export { notificationsRoutes } from './routes';
export { countUnseen, listNotifications, markAllRead, markAllSeen, markRead } from './service';
export { notificationsSink } from './sink';
export { NOTIFICATIONS_SYSTEM_USER_ID, notificationsSystemCtx } from './system-context';
export { inAppChannel, pushChannel };
