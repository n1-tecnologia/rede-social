# @rede-social/module-notifications

The member's notification center and its delivery (NOTIF-01..04): in-app rows with a dedupe key,
subject, object and actor, the Novas/Anteriores keyset list, seen and read marks, the bell's unread
counter, and Web Push. Other modules never import it: they declare `notificationSources` and
`notificationRetractions` in their manifests, the kernel collects them, and this module provides the
one sink (`notificationsSink`) that turns a source event into a fan-out job. The fan-out writes rows
through the channel registry (in-app, push) and push sends run as their own job in the worker.

## Contracts

| Subpath | What it holds |
|---|---|
| `./module` | `notificationsModule`, the manifest |
| `./contracts` | Zod schemas and constants shared with the web app |
| `./server` | `notificationsRoutes`, `notificationsSink`, the fan-out and push jobs, the channel registry, the push transports, the read functions |
| `./ui` | `NotificationList`, `NotificationItem`, `PushSwitchRow`, `SoftAskCard` |
| `./db` | Drizzle tables `notifications`, `pushSubscriptions` with their owner-only RLS policies |

Main contract names (`./contracts`): `notificationQuerySchema`, `notificationRowSchema`,
`notificationPageSchema`, `notificationFactSchema`, `notificationActorSchema`,
`notificationsFanoutJobSchema`, `pushSubscriptionInputSchema`, `pushSubscriptionDeleteSchema`,
`pushSendJobSchema`, `pushPayloadSchema`, `notificationPushHintSchema`, `NOTIFICATIONS_QUEUES`,
`NOTIF_RETENTION_DAYS`, `NOTIF_SECTIONS` and the push limits (`PUSH_SEND_CHUNK`,
`PUSH_PAYLOAD_MAX_BYTES`, `PUSH_MAX_ATTEMPTS`).

Main server names (`./server`): `notificationsRoutes`, `notificationsSink`,
`notificationsFanoutJob`, `pushSendJob`, `runPushSend`, `registerChannel`, `registeredChannels`,
`deliverIntent`, `inAppChannel`, `pushChannel`, `listNotifications`, `countUnseen`, `markRead`,
`markAllRead`, `markAllSeen`, `savePushSubscription`, `deletePushSubscription`, `pushTransport`,
`notificationsSystemCtx`.

## Events emitted

None. The module answers events; it publishes only ids-only Realtime signals on the member's user
topic so the open app refetches its counters.

## Events consumed

- Manifest subscriptions: `membership.blocked` (kernel, 08-04): deletes the blocked member's push
  devices now and sends the counters-refetch nudge, both best-effort after the block committed.
- Through the sink: every event another enabled module declares as a notification source or
  retraction. The API registry calls `setNotificationSink(notificationsSink)` and subscribes one
  handler per distinct event name; this manifest declares no sources of its own.

## Flag key

`notifications` in `tenant_modules`. No `requires`. Taking the module out of the registry leaves the
kernel's default no-op sink, so producers keep working and simply notify nobody (MOD-03).

## Kernel dependencies

- `@rede-social/core/db/schema`
- `@rede-social/core/db/tenant-tx`
- `@rede-social/core/server/auth/context`
- `@rede-social/core/server/auth/require-auth`
- `@rede-social/core/server/env`
- `@rede-social/core/server/http/api-error`
- `@rede-social/core/server/jobs/boss`
- `@rede-social/core/server/logging`
- `@rede-social/core/server/modules/counters`
- `@rede-social/core/server/modules/flags-cache`
- `@rede-social/core/server/modules/manifest`
- `@rede-social/core/server/modules/require-module`
- `@rede-social/core/server/notifications/source`
- `@rede-social/core/server/paging`
- `@rede-social/core/ui`

## Navigation

- Top bar bell "Notificações": placement `topbar`, href `/notificacoes`, icon `bell`, order 10,
  badge `unreadNotifications`.
- Home slots: none.

## Jobs

- `notifications.fanout` (`notificationsFanoutJob`): resolves one source event into rows and
  delivery intents.
- `notifications.push-send` (`pushSendJob`): one Web Push batch, in the worker.
- Sweep function `notifications_prune`: the 90-day retention, run hourly by the kernel sweeper
  through the admin lane.
- `counters`: contributes `unreadNotifications` to `bootstrap.counters`.

## Reuse

The worked example lives in `packages/reuse-fixture` (it mounts the events module the same way). A
host app must provide: a request id and a per-request logger, `flushEventsAfterHandler`, an
`onError` rendering `errorEnvelope`, `setPermissionResolver` (this module adds no permission), the
manifest's `events` subscribed on the bus, its job names registered with `registerJobQueues`, its
`sweepFunctions` registered with `registerSweepFunctions`, `setCountersResolver` composing
`counters`, the sink composition described under "Events consumed", and
`.route('/v1/notifications', notificationsRoutes)`. The routes carry their own `requireAuth` and
`requireModule('notifications')` chain. Push needs the VAPID pair in the kernel env
(`PUSH_TRANSPORT=webpush`); the default `fake` transport records sends in memory and reaches no push service.
