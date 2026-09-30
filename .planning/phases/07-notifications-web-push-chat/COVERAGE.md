# API Coverage — Supabase Realtime (Broadcast) and the Web Push protocol (via `web-push` 3.6.7)

> Full coverage by default. Opt-outs are explicit, reasoned decisions.

Phase 7 integrates two external surfaces. **Supabase Realtime** carries ids-only signals to the
browser over private Broadcast channels (CLAUDE.md Stack Pattern 5). **The Web Push protocol**
(VAPID RFC 8292, aes128gcm RFC 8291, sent through `web-push` to FCM, Mozilla autopush, Apple web push
and WNS endpoints) reaches the installed PWA, together with the browser Push, Notifications and Badging
APIs that receive it. The api-coverage detector returned `detected: true` on the ROADMAP scope, and
this matrix is the plan-time decision record. The notes below the table name the plan that integrates
each capability.

## Supabase Realtime

| capability | decision | reason |
|---|---|---|
| realtime.broadcast-receive-private | INTEGRATE | |
| realtime.authorization-rls | INTEGRATE | |
| realtime.send-from-database | INTEGRATE | |
| realtime.access-token-refresh | INTEGRATE | |
| realtime.private-only-setting | INTEGRATE | |
| realtime.broadcast-changes-trigger | OPT-OUT | ships whole rows (message bodies), which violates the ids-only rule (RESEARCH Pattern 3) |
| realtime.broadcast-rest-api | OPT-OUT | not transactional (it can announce a rolled-back write) and needs the service key in the API |
| realtime.client-broadcast-send | OPT-OUT | explicitly out of scope: the browser is read-only, enforced by having no INSERT policy on realtime.messages |
| realtime.presence | OPT-OUT | not needed yet: online and typing indicators are V2-CHAT-02 |
| realtime.postgres-changes | OPT-OUT | explicitly out of scope: CLAUDE.md "What NOT to use" (per-connection RLS, no topic authorisation) |
| realtime.broadcast-replay | OPT-OUT | not needed: D-240 refetches from the API on (re)subscribe and refocus, with the seq cursor for chat |

## Web Push protocol and browser APIs

| capability | decision | reason |
|---|---|---|
| webpush.send-notification | INTEGRATE | |
| webpush.ttl-header | INTEGRATE | |
| webpush.urgency-header | INTEGRATE | |
| webpush.topic-header | INTEGRATE | |
| webpush.subscription-expiry-404-410 | INTEGRATE | |
| webpush.retryable-failures | INTEGRATE | |
| webpush.generate-request-details | INTEGRATE | |
| webpush.vapid-key-generation | INTEGRATE | |
| browser.push-manager | INTEGRATE | |
| browser.notifications-api | INTEGRATE | |
| browser.badging-api | INTEGRATE | |
| webpush.gcm-api-key | OPT-OUT | not needed: FCM accepts VAPID, and the legacy GCM key path is retired |
| webpush.aesgcm-encoding | OPT-OUT | not needed: every target browser accepts aes128gcm, the library default |
| browser.notification-actions | OPT-OUT | not needed yet: UI-D-266 defines a tap that opens the target and no buttons |
| browser.notification-badge-image | OPT-OUT | not needed yet: UI-D-266 records that tenant branding has no monochrome asset in V1 |
| webpush.declarative-web-push | OPT-OUT | not needed yet: Chromium and Android still need the SW path; the versioned payload makes the switch one server change |

## Notes (what each INTEGRATE row means, and where it is built)

- `realtime.broadcast-receive-private`: the browser `RealtimeClient` subscribes with `config: { private: true }` (07-03, 07-09, 07-10).
- `realtime.authorization-rls`: the SELECT policy on `realtime.messages` calling `app.realtime_topic_allowed(realtime.topic())` (07-01).
- `realtime.send-from-database`: `realtime.send` inside definer triggers and `app.realtime_signal` (07-01, 07-08).
- `realtime.access-token-refresh`: the realtime-js `accessToken` callback, re-authenticated on heartbeat, with an in-memory cache (07-03).
- `realtime.private-only-setting`: `private_only: true` through the dashboard or the Management API, a user-run release step (07-11).
- `webpush.send-notification`: VAPID JWT plus aes128gcm payload encryption through `webpush.sendNotification` (07-06).
- `webpush.ttl-header`, `webpush.urgency-header` and `webpush.topic-header`: set per kind from the intent's push hint (07-06).
- `webpush.subscription-expiry-404-410`: the subscription row is deleted (07-06).
- `webpush.retryable-failures`: 429, 5xx and network errors are re-enqueued for the failed subscriptions only, with backoff (07-06).
- `webpush.generate-request-details`: the deterministic header tests (07-06).
- `webpush.vapid-key-generation`: `web-push generate-vapid-keys`, run once by the user (07-11).
- `browser.push-manager`: `subscribe`, `getSubscription`, `unsubscribe` and `pushsubscriptionchange` (07-07).
- `browser.notifications-api`: `showNotification` (title, body, icon, tag, renotify, data) and `notificationclick` (07-07).
- `browser.badging-api`: `setAppBadge` / `clearAppBadge` from the page and the service worker (07-03, 07-07, 07-09).

*Recorded: 2026-09-30 · plan-phase (standard mode).*
