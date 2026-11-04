---
phase: "13"
slug: "app-nativo-ios-e-android-por-tenant-white-label"
created: "2026-11-04"
purpose: "External API coverage matrix (plan:pre capability, ai-integration contribution). Full coverage is the default: every capability starts INTEGRATE and this file is the subtraction record. An OPT-OUT without a one-line reason is a planning defect."
---

# Phase 13 — External API Coverage

Four external services are integrated: Apple APNs (D-606), Firebase Cloud Messaging HTTP v1 (D-606), the App Store Connect API (D-605, D-607, D-619) and the Google Play Developer API (D-605, D-607, D-619). Capabilities were enumerated from the vendors' current reference pages as read in `13-RESEARCH.md` (2026-11-04); anything the research marked `[ASSUMED]` is marked so here and must be proven by the plan that owns it before the code depends on it. "Plan" is the plan that owns the INTEGRATE row.

Rule applied to every OPT-OUT below: it is either (a) a capability the product has no use for in stage 1 (D-600), (b) a decision locked by Igor (D-615 no in-app purchase, D-619 never submit for review), or (c) a capability the vendor does not expose through its API (so it becomes a manual checklist row, D-607).

## 1. Apple Push Notification service (provider API) — plans 13-12 (transport), 13-05/13-09 (key custody)

| Capability | Decision | Reason for OPT-OUT |
|---|---|---|
| Token-based authentication (ES256 provider token, `kid` + team id `iss`, refreshed every 20-60 min) | INTEGRATE | |
| Certificate-based authentication (per-app `.p12`) | OPT-OUT | Expires yearly and is per app; one token key per team covers every bundle id of that tenant |
| HTTP/2 `POST /3/device/<token>` on the production host | INTEGRATE | |
| Sandbox host `api.sandbox.push.apple.com` per device `app_environment` | INTEGRATE | |
| `apns-push-type: alert` with `title`/`body`, `sound: default` | INTEGRATE | |
| `aps.badge` (the per-recipient count the job already computes) | INTEGRATE | |
| `aps.thread-id` (grouping by the payload `tag`) | INTEGRATE | |
| `apns-priority` 10 / 5 from the payload `urgency` | INTEGRATE | |
| `apns-expiration` from `ttlSeconds` | INTEGRATE | |
| `apns-collapse-id` from the payload `tag` (64-byte bound) | INTEGRATE | |
| `apns-topic` = bundle id | INTEGRATE | |
| Custom `url` and `v` keys in the payload (same-origin path) | INTEGRATE | |
| Error reasons: 410 `Unregistered` to `gone`, 400 `BadDeviceToken` / `DeviceTokenNotForTopic` to `dropped` after confirmation, 403 provider-token reasons to `retry` with an alert (never delete devices), 429 / 5xx to `retry` | INTEGRATE | |
| `apns-id` response header kept in a shape-only log line for support correlation (never the token) | INTEGRATE | |
| Per-team HTTP/2 session pool, reopened after a key rotation | INTEGRATE | |
| `apns-push-type: background` (silent, `content-available`) | OPT-OUT | The badge and the alert travel together; silent pushes are throttled by iOS and nothing in stage 1 needs a background wake |
| Notification Service Extension (`mutable-content`, rich media) | OPT-OUT | Needs a native extension target in the binary; stage 2 |
| Notification categories and actions | OPT-OUT | No actionable notifications in the product |
| `interruption-level`, `relevance-score` | OPT-OUT | One level of importance per event today (the payload `urgency` already maps to priority) |
| Push types `voip`, `location`, `complication`, `fileprovider`, `liveactivity`, `widgets`, `pushtotalk` | OPT-OUT | Not product features |
| Broadcast push (channel based, iOS 18) | OPT-OUT | Fan-out is per member from the tenant's own database (D-606); channels would move audience membership to Apple |
| Pushes to watchOS / macOS / tvOS | OPT-OUT | iPhone and Android only (D-600) |

## 2. Firebase Cloud Messaging HTTP v1 (Android) and Firebase Management — plans 13-12, 13-29, 13-30

| Capability | Decision | Reason for OPT-OUT |
|---|---|---|
| `projects/<id>/messages:send` to one registration token | INTEGRATE | |
| OAuth2 access token from the platform sender service account (`firebase.messaging` scope) through `google-auth-library` | INTEGRATE | |
| `notification` + `data` message (the OS shows it with no JS running; `data.url`, `tag`, `v`, `badge` as strings) | INTEGRATE | |
| `android.priority` HIGH / NORMAL, `android.ttl`, `android.collapse_key` | INTEGRATE | |
| `android.notification.channel_id`, `tag`, `notification_count` | INTEGRATE | |
| `validate_only` dry run, used by the release preflight to prove the sender account works without delivering | INTEGRATE | |
| Error mapping: 404 `UNREGISTERED` to `gone`, 403 `SENDER_ID_MISMATCH` to `gone`, 400 `INVALID_ARGUMENT` to `dropped`, 429 `QUOTA_EXCEEDED` / 500 / 503 to `retry` | INTEGRATE | |
| Management API: create the tenant's Android app in the platform Firebase project and fetch its `google-services.json` | INTEGRATE | `[ASSUMED]` the `getConfig` call (research A3); the spike or plan 13-29 proves it, and the fallback is one manual checklist row |
| Topic messaging and condition targeting | OPT-OUT | Audience membership must stay in the tenant's own project (D-606); topics would store it in Firebase |
| Batch send | OPT-OUT | The legacy batch endpoint is gone; one request per device fits the job's per-subscription retry bookkeeping |
| `apns` block (iOS through FCM) | OPT-OUT | iOS uses direct APNs (research F2); no iOS Firebase app is created |
| `webpush` block | OPT-OUT | Browsers keep `web-push` unchanged (D-603) |
| Notification image, `fcm_options.analytics_label`, delivery data export to BigQuery | OPT-OUT | No stage 1 use; analytics are a later phase |
| Firebase Management: create an iOS app per tenant | OPT-OUT | Direct APNs needs no Firebase iOS app |
| Instance ID token management APIs | OPT-OUT | Dead tokens are learned from send errors |

## 3. App Store Connect API — plans 13-29 (script), 13-30 (workflow), 13-31 (listing)

| Capability | Decision | Reason for OPT-OUT |
|---|---|---|
| API key authentication (ES256 JWT, issuer id + key id, 20-minute expiry) | INTEGRATE | |
| Bundle IDs: list, register, enable capabilities (Push Notifications, Associated Domains) | INTEGRATE | |
| Certificates: list / create the distribution certificate (through fastlane `cert` with the key, `[ASSUMED]` research A2) | INTEGRATE | |
| Provisioning profiles: create / reuse an App Store profile | INTEGRATE | |
| Apps: list / read to detect that the app record exists (preflight) | INTEGRATE | |
| Builds: upload to TestFlight and poll processing state | INTEGRATE | |
| TestFlight: attach the processed build to an existing internal group | INTEGRATE | |
| App Information and version localizations: description, keywords, support URL, privacy-policy URL (template text, D-607) | INTEGRATE | |
| Age-rating declaration answers (template answers, research OQ-3) | INTEGRATE | |
| App Review detail: contact, demo account (reviewer), Review Notes (D-607, 2.1(a)) | INTEGRATE | |
| Apps: create the app record | OPT-OUT | The API answers "the resource 'apps' does not allow 'CREATE'"; a manual checklist row (research F5b) |
| Submit for review (review submissions) | OPT-OUT | Locked by D-619 and Apple 4.2.6: the tenant presses "enviar para revisão" |
| Screenshots and app previews upload | OPT-OUT | D-607: screenshots are a checklist step, not generated code |
| Pricing and territory availability | OPT-OUT | Tenant commercial decision, set once in the console (a free app in the chosen countries); a manual checklist row |
| App Privacy ("nutrition label") answers | OPT-OUT | No public API exposes them; the template answers are shown read-only and entered by hand |
| Devices registration | OPT-OUT | Distribution profiles and TestFlight need no registered devices |
| TestFlight external groups and beta app review | OPT-OUT | Internal testing only (D-619) |
| Testers and users management (invites, roles) | OPT-OUT | The tenant invites the platform with a publishing role (D-604); a manual checklist row |
| In-app purchases and subscriptions | OPT-OUT | D-615: no in-app purchase in this phase |
| Sales / analytics reports, customer reviews and replies, Xcode Cloud | OPT-OUT | Not part of the release path |

## 4. Google Play Developer API (androidpublisher) — plans 13-29, 13-30, 13-31

| Capability | Decision | Reason for OPT-OUT |
|---|---|---|
| Service-account OAuth2 authentication | INTEGRATE | |
| `edits.insert` / `validate` / `commit` | INTEGRATE | |
| `edits.bundles.upload` (AAB signed with the platform-held upload key) | INTEGRATE | |
| `edits.tracks.update` to the internal track | INTEGRATE | |
| `edits.listings` (title, short and full description, template text, D-607) | INTEGRATE | |
| `edits.details` (contact e-mail, website, default language) | INTEGRATE | |
| `edits.images` for the high-resolution icon derived from the branding | INTEGRATE | |
| Promote to closed / open / production tracks | OPT-OUT | The tenant publishes (D-619, D-604); the checklist row "app enviado para revisão" |
| Screenshots and feature graphic upload | OPT-OUT | D-607: a checklist step (the "capturas de tela" row covers the feature graphic) |
| APK upload | OPT-OUT | App Bundles only |
| `apps.create` / create the app in Play Console | OPT-OUT | Not exposed by the API; a manual checklist row (research F5c) |
| Play App Signing certificate fingerprint | OPT-OUT | Not exposed; the operator pastes the SHA-256 into the Links card after the first upload (UI-D-624) |
| Data safety form and content rating (IARC) | OPT-OUT | Console questionnaires, same template answers for every tenant, stored read-only in the App tab and entered once per tenant |
| App access instructions (reviewer account) | OPT-OUT | Console-only; the reviewer account and the text are shown in the listing card for the operator to paste |
| Testers management for the internal track | OPT-OUT | Internal testing lists are Google Groups or e-mail lists maintained in the console by the tenant |
| Reviews and replies, vitals reporting, device catalog, internal app sharing | OPT-OUT | Not part of the release path |
| In-app products, subscriptions, purchase verification | OPT-OUT | D-615: no in-app purchase in this phase |
| Developer account users and permissions | OPT-OUT | The tenant invites the platform with a publishing role (D-604); a manual checklist row |
