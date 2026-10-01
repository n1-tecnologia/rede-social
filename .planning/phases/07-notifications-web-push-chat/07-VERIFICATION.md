---
phase: 07-notifications-web-push-chat
verified: 2026-10-01T02:03:42Z
status: gaps_found
score: 12/15 must-haves verified
covered_files:
  - ".github/workflows/ci.yml"
  - ".github/workflows/deploy-api.yml"
  - ".planning/REQUIREMENTS.md"
  - ".planning/phases/07-notifications-web-push-chat/07-01-PLAN.md"
  - ".planning/phases/07-notifications-web-push-chat/07-01-SUMMARY.md"
  - ".planning/phases/07-notifications-web-push-chat/07-02-PLAN.md"
  - ".planning/phases/07-notifications-web-push-chat/07-02-SUMMARY.md"
  - ".planning/phases/07-notifications-web-push-chat/07-03-PLAN.md"
  - ".planning/phases/07-notifications-web-push-chat/07-03-SUMMARY.md"
  - ".planning/phases/07-notifications-web-push-chat/07-04-PLAN.md"
  - ".planning/phases/07-notifications-web-push-chat/07-04-SUMMARY.md"
  - ".planning/phases/07-notifications-web-push-chat/07-05-PLAN.md"
  - ".planning/phases/07-notifications-web-push-chat/07-05-SUMMARY.md"
  - ".planning/phases/07-notifications-web-push-chat/07-06-PLAN.md"
  - ".planning/phases/07-notifications-web-push-chat/07-06-SUMMARY.md"
  - ".planning/phases/07-notifications-web-push-chat/07-07-PLAN.md"
  - ".planning/phases/07-notifications-web-push-chat/07-07-SUMMARY.md"
  - ".planning/phases/07-notifications-web-push-chat/07-08-PLAN.md"
  - ".planning/phases/07-notifications-web-push-chat/07-08-SUMMARY.md"
  - ".planning/phases/07-notifications-web-push-chat/07-09-PLAN.md"
  - ".planning/phases/07-notifications-web-push-chat/07-09-SUMMARY.md"
  - ".planning/phases/07-notifications-web-push-chat/07-10-PLAN.md"
  - ".planning/phases/07-notifications-web-push-chat/07-10-SUMMARY.md"
  - ".planning/phases/07-notifications-web-push-chat/07-11-PLAN.md"
  - ".planning/phases/07-notifications-web-push-chat/07-11-SUMMARY.md"
  - "apps/api/.env.example"
  - "apps/api/package.json"
  - "apps/api/src/app.ts"
  - "apps/api/src/modules/registry.ts"
  - "apps/api/src/routes/me.ts"
  - "apps/api/tests/integration/bootstrap.test.ts"
  - "apps/api/tests/integration/chat.test.ts"
  - "apps/api/tests/integration/events-reminders.test.ts"
  - "apps/api/tests/integration/isolation.test.ts"
  - "apps/api/tests/integration/modules.test.ts"
  - "apps/api/tests/integration/notifications-prune.test.ts"
  - "apps/api/tests/integration/notifications.test.ts"
  - "apps/api/tests/integration/push.test.ts"
  - "apps/api/tests/integration/realtime-helpers.ts"
  - "apps/api/tests/integration/realtime.test.ts"
  - "apps/api/tests/integration/setup.ts"
  - "apps/api/tests/unit/env.test.ts"
  - "apps/api/tests/unit/registry.test.ts"
  - "apps/api/vitest.config.ts"
  - "apps/web/.env.example"
  - "apps/web/app/(app)/configuracoes/page.tsx"
  - "apps/web/app/(app)/inicio/page.tsx"
  - "apps/web/app/(app)/layout.tsx"
  - "apps/web/app/(app)/notificacoes/NotificationsSurface.tsx"
  - "apps/web/app/(app)/notificacoes/actions.ts"
  - "apps/web/app/(app)/notificacoes/loading.tsx"
  - "apps/web/app/(app)/notificacoes/page.tsx"
  - "apps/web/app/(app)/post/[postId]/page.tsx"
  - "apps/web/app/(app)/suporte/SupportInbox.tsx"
  - "apps/web/app/(app)/suporte/SupportSplit.tsx"
  - "apps/web/app/(app)/suporte/ThreadPane.tsx"
  - "apps/web/app/(app)/suporte/[conversationId]/loading.tsx"
  - "apps/web/app/(app)/suporte/[conversationId]/not-found.tsx"
  - "apps/web/app/(app)/suporte/[conversationId]/page.tsx"
  - "apps/web/app/(app)/suporte/actions.ts"
  - "apps/web/app/(app)/suporte/layout.tsx"
  - "apps/web/app/(app)/suporte/loading.tsx"
  - "apps/web/app/(app)/suporte/page.tsx"
  - "apps/web/app/(auth)/acesso-suspenso/page.tsx"
  - "apps/web/app/(auth)/entrar/page.tsx"
  - "apps/web/app/api/chat/conversations/[conversationId]/messages/route.ts"
  - "apps/web/app/api/chat/conversations/[conversationId]/read/route.ts"
  - "apps/web/app/api/chat/inbox/route.ts"
  - "apps/web/app/api/me/counters/route.ts"
  - "apps/web/app/api/notifications/[notificationId]/read/route.ts"
  - "apps/web/app/api/notifications/read-all/route.ts"
  - "apps/web/app/api/notifications/seen/route.ts"
  - "apps/web/app/api/push/subscriptions/route.test.ts"
  - "apps/web/app/api/push/subscriptions/route.ts"
  - "apps/web/app/api/realtime/token/route.test.ts"
  - "apps/web/app/api/realtime/token/route.ts"
  - "apps/web/app/sw.ts"
  - "apps/web/components/feedback/NoticeToast.tsx"
  - "apps/web/components/push/ForgetSignedOutDevice.tsx"
  - "apps/web/components/push/PushControls.tsx"
  - "apps/web/components/pwa/InstallHint.test.ts"
  - "apps/web/components/pwa/InstallHint.tsx"
  - "apps/web/components/shell/LiveShell.tsx"
  - "apps/web/components/shell/LogoutForm.tsx"
  - "apps/web/e2e/blocked.spec.ts"
  - "apps/web/e2e/chat-admin.ts"
  - "apps/web/e2e/chat.spec.ts"
  - "apps/web/e2e/media-video.spec.ts"
  - "apps/web/e2e/notifications-admin.ts"
  - "apps/web/e2e/notifications.spec.ts"
  - "apps/web/e2e/phase7-smoke.spec.ts"
  - "apps/web/e2e/profile.spec.ts"
  - "apps/web/e2e/push-fake.ts"
  - "apps/web/e2e/push.spec.ts"
  - "apps/web/e2e/shell.spec.ts"
  - "apps/web/i18n/messages.test.ts"
  - "apps/web/lib/chat-cursor.test.ts"
  - "apps/web/lib/chat-cursor.ts"
  - "apps/web/lib/chat-view.test.ts"
  - "apps/web/lib/chat-view.ts"
  - "apps/web/lib/chat.ts"
  - "apps/web/lib/env.ts"
  - "apps/web/lib/feed.ts"
  - "apps/web/lib/notification-renderers.tsx"
  - "apps/web/lib/notifications-bff.ts"
  - "apps/web/lib/notifications-view.test.ts"
  - "apps/web/lib/notifications-view.ts"
  - "apps/web/lib/notifications.ts"
  - "apps/web/lib/push-sw.test.ts"
  - "apps/web/lib/push-sw.ts"
  - "apps/web/lib/push.test.ts"
  - "apps/web/lib/push.ts"
  - "apps/web/lib/registry.tsx"
  - "apps/web/messages/pt-BR/chat.json"
  - "apps/web/messages/pt-BR/feed.json"
  - "apps/web/messages/pt-BR/notifications.json"
  - "apps/web/messages/pt-BR/pwa.json"
  - "apps/web/package.json"
  - "docs/DEPLOY.md"
  - "docs/phase-07-device-test-plan.md"
  - "packages/contracts/package.json"
  - "packages/contracts/src/bootstrap.ts"
  - "packages/contracts/src/realtime.ts"
  - "packages/contracts/src/text.ts"
  - "packages/contracts/tests/bootstrap.test.ts"
  - "packages/contracts/tests/text.test.ts"
  - "packages/core/db/schema/index.ts"
  - "packages/core/package.json"
  - "packages/core/server/env.ts"
  - "packages/core/server/jobs/boss.ts"
  - "packages/core/server/jobs/sweep-functions.ts"
  - "packages/core/server/media/sweep-job.ts"
  - "packages/core/server/modules/counters.ts"
  - "packages/core/server/modules/manifest.ts"
  - "packages/core/server/notifications/sink.ts"
  - "packages/core/server/notifications/source.ts"
  - "packages/core/server/rbac/require-role.ts"
  - "packages/core/tests/before-logout.test.tsx"
  - "packages/core/tests/live-counters.test.tsx"
  - "packages/core/tests/realtime-app-badge.test.ts"
  - "packages/core/tests/realtime-rejoin.test.tsx"
  - "packages/core/tests/realtime-token-source.test.ts"
  - "packages/core/tests/require-role.test.ts"
  - "packages/core/tests/tenant-logo.test.tsx"
  - "packages/core/ui/AppShell.tsx"
  - "packages/core/ui/BeforeLogout.tsx"
  - "packages/core/ui/DesktopRail.tsx"
  - "packages/core/ui/HidingLogoImage.tsx"
  - "packages/core/ui/TenantLogo.tsx"
  - "packages/core/ui/TopBar.tsx"
  - "packages/core/ui/index.ts"
  - "packages/core/ui/realtime/LiveCountersProvider.tsx"
  - "packages/core/ui/realtime/RealtimeProvider.tsx"
  - "packages/core/ui/realtime/SlotBadgeLabels.tsx"
  - "packages/core/ui/realtime/app-badge.ts"
  - "packages/core/ui/realtime/token-source.ts"
  - "packages/core/ui/realtime/useRealtimeTopic.ts"
  - "packages/modules/chat/contracts/index.ts"
  - "packages/modules/chat/db/schema.ts"
  - "packages/modules/chat/module.ts"
  - "packages/modules/chat/package.json"
  - "packages/modules/chat/server/first-name.ts"
  - "packages/modules/chat/server/index.ts"
  - "packages/modules/chat/server/notification-copy.ts"
  - "packages/modules/chat/server/notifications.ts"
  - "packages/modules/chat/server/routes.ts"
  - "packages/modules/chat/server/service.ts"
  - "packages/modules/chat/tests/chat-composer.test.tsx"
  - "packages/modules/chat/tests/contracts.test.ts"
  - "packages/modules/chat/tests/first-name.test.ts"
  - "packages/modules/chat/tests/inbox-row.test.tsx"
  - "packages/modules/chat/tests/message-list.test.tsx"
  - "packages/modules/chat/tests/notification-sources.test.ts"
  - "packages/modules/chat/tests/thread-header.test.tsx"
  - "packages/modules/chat/tsconfig.json"
  - "packages/modules/chat/turbo.json"
  - "packages/modules/chat/ui/ChatComposer.tsx"
  - "packages/modules/chat/ui/DaySeparator.tsx"
  - "packages/modules/chat/ui/InboxRow.tsx"
  - "packages/modules/chat/ui/MessageBubble.tsx"
  - "packages/modules/chat/ui/MessageList.tsx"
  - "packages/modules/chat/ui/ThreadHeader.tsx"
  - "packages/modules/chat/ui/index.ts"
  - "packages/modules/chat/vitest.config.ts"
  - "packages/modules/events/contracts/index.ts"
  - "packages/modules/events/module.ts"
  - "packages/modules/events/server/index.ts"
  - "packages/modules/events/server/notification-copy.ts"
  - "packages/modules/events/server/notifications.ts"
  - "packages/modules/events/server/reminders.ts"
  - "packages/modules/events/server/service.ts"
  - "packages/modules/events/server/system-context.ts"
  - "packages/modules/events/tests/events-payload.test.ts"
  - "packages/modules/events/tests/notification-sources.test.ts"
  - "packages/modules/events/tests/reminders.test.ts"
  - "packages/modules/feed/contracts/index.ts"
  - "packages/modules/feed/module.ts"
  - "packages/modules/feed/server/index.ts"
  - "packages/modules/feed/server/notification-copy.ts"
  - "packages/modules/feed/server/notifications.ts"
  - "packages/modules/feed/server/routes.ts"
  - "packages/modules/feed/server/service.ts"
  - "packages/modules/feed/tests/comments-list-highlight.test.tsx"
  - "packages/modules/feed/tests/linkify-reexport.test.ts"
  - "packages/modules/feed/tests/notification-sources.test.ts"
  - "packages/modules/feed/ui/CommentItem.tsx"
  - "packages/modules/feed/ui/CommentsList.tsx"
  - "packages/modules/feed/ui/index.ts"
  - "packages/modules/feed/ui/linkify.tsx"
  - "packages/modules/notifications/contracts/index.ts"
  - "packages/modules/notifications/db/schema.ts"
  - "packages/modules/notifications/module.ts"
  - "packages/modules/notifications/package.json"
  - "packages/modules/notifications/server/channels/in-app.ts"
  - "packages/modules/notifications/server/channels/push.ts"
  - "packages/modules/notifications/server/channels/registry.ts"
  - "packages/modules/notifications/server/channels/types.ts"
  - "packages/modules/notifications/server/fanout-job.ts"
  - "packages/modules/notifications/server/index.ts"
  - "packages/modules/notifications/server/push-subscriptions.ts"
  - "packages/modules/notifications/server/push/endpoint.ts"
  - "packages/modules/notifications/server/push/payload.ts"
  - "packages/modules/notifications/server/push/send-job.ts"
  - "packages/modules/notifications/server/push/transport.ts"
  - "packages/modules/notifications/server/retract.ts"
  - "packages/modules/notifications/server/routes.ts"
  - "packages/modules/notifications/server/service.ts"
  - "packages/modules/notifications/server/sink.ts"
  - "packages/modules/notifications/server/system-context.ts"
  - "packages/modules/notifications/tests/channels.test.ts"
  - "packages/modules/notifications/tests/contracts.test.ts"
  - "packages/modules/notifications/tests/in-app-signals.test.ts"
  - "packages/modules/notifications/tests/notification-item.test.tsx"
  - "packages/modules/notifications/tests/push-channel.test.ts"
  - "packages/modules/notifications/tests/push-endpoint.test.ts"
  - "packages/modules/notifications/tests/push-payload.test.ts"
  - "packages/modules/notifications/tests/push-switch-row.test.tsx"
  - "packages/modules/notifications/tests/push-transport.test.ts"
  - "packages/modules/notifications/tests/soft-ask-card.test.tsx"
  - "packages/modules/notifications/tsconfig.json"
  - "packages/modules/notifications/turbo.json"
  - "packages/modules/notifications/ui/NotificationItem.tsx"
  - "packages/modules/notifications/ui/NotificationList.tsx"
  - "packages/modules/notifications/ui/PushSwitchRow.tsx"
  - "packages/modules/notifications/ui/SoftAskCard.tsx"
  - "packages/modules/notifications/ui/index.ts"
  - "packages/modules/notifications/vitest.config.ts"
  - "packages/modules/stories/contracts/index.ts"
  - "packages/modules/stories/module.ts"
  - "packages/modules/stories/server/notification-copy.ts"
  - "packages/modules/stories/server/notifications.ts"
  - "packages/modules/stories/tests/notification-sources.test.ts"
  - "packages/ui/package.json"
  - "packages/ui/src/index.ts"
  - "packages/ui/src/primitives/Badge.tsx"
  - "packages/ui/src/text/linkify.tsx"
  - "packages/ui/src/text/url.ts"
  - "packages/ui/tests/button.test.tsx"
  - "packages/ui/tests/linkify.test.tsx"
  - "scripts/arm-event-reminders.ts"
  - "scripts/check-static-routes.sh"
  - "scripts/local-env.sh"
  - "scripts/seed.ts"
  - "supabase/migrations/20260930123126_notifications.sql"
  - "supabase/migrations/20260930123133_notifications_drop_event_id.sql"
  - "supabase/migrations/20260930123213_realtime_authorization.sql"
  - "supabase/migrations/20260930123214_notifications_functions.sql"
  - "supabase/migrations/20260930141455_notifications_retract_prune.sql"
  - "supabase/migrations/20260930142350_notifications_prune_index.sql"
  - "supabase/migrations/20260930142352_notifications_prune.sql"
  - "supabase/migrations/20260930180214_push_subscriptions.sql"
  - "supabase/migrations/20260930180227_push_subscriptions_functions.sql"
  - "supabase/migrations/20260930190151_chat.sql"
  - "supabase/migrations/20260930190229_chat_functions.sql"
  - "supabase/migrations/20261001004630_chat_rls_per_command.sql"
  - "supabase/migrations/20261001004638_chat_rls_grants.sql"
  - "supabase/migrations/20261001010456_notifications_push_withdrawn.sql"
  - "supabase/tests/010-rls-coverage.sql"
  - "supabase/tests/020-tenant-isolation.sql"
  - "supabase/tests/150-realtime-authorization.sql"
  - "supabase/tests/151-notifications.sql"
  - "supabase/tests/152-chat.sql"
  - "supabase/tests/153-push-subscriptions.sql"
covered_digest: "v1:sha256:6abab1611362bc4a6f1f4003207d1c145a68606f25156b95b4d8767969315c37"
behavior_unverified: 1
overrides_applied: 0
gaps:
  - truth: "The local exit gate is green: `TURBO_CACHE=local:r pnpm verify` passes with every Phase 7 spec, pgTAP file and integration file included (07-11 must-have)"
    status: failed
    reason: "07-11's `pnpm verify` never exited 0, and the verifier reproduced one of the residual failures at HEAD. The Phase 7 surfaces themselves are green (pgTAP 731/731, Phase 7 integration 126/126, unit 12/12 tasks, phase7-smoke 8/8, chat/notifications/push e2e 101 passed / 5 project-skipped, all re-run by the verifier). What keeps the gate red is outside Phase 7 code: (1) 34 platform-host e2e cases fail because apps/web/.env.local still carries a different PLATFORM_HOST (they pass with PLATFORM_HOST=rede-social.localhost inline; WINDOWS 59); (2) desktop feed.spec.ts 'a double tap on the gallery likes exactly ONCE' failed 1 of 4 repeats in the verifier's run (DoubleTapHeart's 300 ms window; possibly aggravated by LiveShell's load-time fetch and socket work, unproven); (3) the cold-run mobile feed-comments.spec.ts failNextActions race; (4) a turbo race between web typecheck and build on .next/types."
    artifacts:
      - path: "apps/web/.env.local"
        issue: "PLATFORM_HOST differs from rede-social.localhost (developer-owned file; the verifier did not read it, the inference comes from the inline-env pass)"
      - path: "apps/web/e2e/feed.spec.ts"
        issue: "line 321: the desktop double-tap case is flaky (1/4 at HEAD); a failure at line 342 leaves the like in place and cascades into the next run"
      - path: "apps/web/e2e/feed-comments.spec.ts"
        issue: "failNextActions fails the next POST to /inicio, which a cold dev server's Mux playback-token action can consume"
      - path: "turbo.json"
        issue: "@rede-social/web#typecheck (next typegen) and #build both write apps/web/.next/types in parallel"
    missing:
      - "Developer: set PLATFORM_HOST=rede-social.localhost in apps/web/.env.local (or run `bash scripts/local-env.sh --write`)"
      - "Stabilise or debug the desktop double-tap case: settle the page (LiveShell's token/counters fetch) before the gesture, or /gsd-debug whether a real double tap within ~1 s of load can miss or unlike"
      - "Make feed-comments' failNextActions target only the comment-list action"
      - "Make @rede-social/web#typecheck depend on #build in turbo.json (or point next typegen at a separate dist dir)"
      - "Re-run `TURBO_CACHE=local:r pnpm verify` to exit 0, or accept the override suggested in the report"
deferred:
  - truth: "Real-device push and PWA behaviour (installed iPhone/Android/iPad: prompt from the Home Screen app, tenant name and icon in the OS banner, tag replacement, foreground suppression, app-icon badge, composer above the keyboard)"
    addressed_in: "Phase 8"
    evidence: "Phase 8 success criterion 4: 'the pilot go-live gate passes: ... PWA install + push smoke tests on a real iPhone and Android'. The rows are written in docs/phase-07-device-test-plan.md and still listed under human verification below."
behavior_unverified_items:
  - truth: "07 review C-WR-03: on /notificacoes a load-more page that started before a refresh is dropped (generation guard), and a failed mark-all rolls back only the ids it optimistically added, keeping rows tapped while it was in flight"
    test: "On /notificacoes with more than one page of rows, start a load-more, then trigger a refresh (refocus the tab or receive a notifications.changed signal) before it answers; separately, make 'Marcar todas como lidas' fail (offline) after tapping one row while the request is in flight"
    expected: "No duplicated or stale page is appended after the refresh; after the failed mark-all the tapped row stays read and every other row gets its unread tint back"
    why_human: "The fix (commit 583619c) is present and wired, but no automated test triggers either race; the notifications e2e passes without exercising them"
human_verification:
  - test: "Real-device rows 1-17 of docs/phase-07-device-test-plan.md against production after the 'Phase 7 release' steps of docs/DEPLOY.md (VAPID secrets, Realtime private-only, JWT expiry, API before web)"
    expected: "Every row passes: iOS outside the Home Screen gets the install sheet and never a prompt; from the Home Screen app the prompt follows the tap; banners carry the tenant name and 192 px icon and open the right screen; a second post replaces the first banner; Android focused shows no banner; reminders and support replies arrive; logout and blocking stop pushes; a dead endpoint is deleted; the app-icon badge counts"
    why_human: "Phones cannot reach the *.localhost stack and Phase 7 is not deployed; Playwright cannot emulate iOS standalone, real push services or OS banners (all 17 rows are 'Status: blocked — not run')"
  - test: "Blocked member with an open app: block a member by SQL (device plan row 14) while their app is open on Início and on /suporte"
    expected: "No new join succeeds; the already-open socket stops receiving signals no later than its next token push or re-join (bounded by the 3600 s JWT expiry); every API read is refused and the web moves to /acesso-suspenso on its next call; subscriptions are gone at the next send"
    why_human: "The live suite proves a NEW join is refused (realtime.test 'blocking') and push.test proves subscriptions are dropped before a send, but the residual window of an already-joined socket is documented, not tested; decide whether it is acceptable until Phase 8's block action revokes eagerly"
  - test: "Decide on the C-WR-02 change to the documented token-route gate (T-07-12): GET /api/realtime/token, /api/me/counters, /api/chat/inbox and the messages route now accept a request with NO Sec-Fetch-Site and NO Origin (moving on to the session check), instead of answering 403"
    expected: "The developer accepts the fallback (SameSite=Lax keeps the session cookie off cross-site subresource requests; a cross-origin fetch always sends Origin) or asks for the stricter gate back"
    why_human: "A security posture change the fixer explicitly flagged 'needs your judgement'; tests cover both branches but cannot decide the policy"
  - test: "Review the non-authoritative verdicts on the seven flagged prohibitions (table 'Prohibitions' in this report)"
    expected: "Each holds as described, or the developer records a reason it does not"
    why_human: "Judgment-tier prohibitions (verification: flagged) need explicit human resolution; the verifier's verdict is an LLM judgement, not proof"
---

# Phase 7: Notifications, Web Push & Chat Verification Report

**Phase Goal:** Members are reached in real time - a notification bell with live unread count, Web Push in the installed PWA and a live 1:1 support conversation - all fed by domain events over one shared realtime infrastructure (Supabase Broadcast on private topics, ids only, data always through the API).
**Verified:** 2026-10-01T02:03:42Z (code at HEAD 624f0c0, after the 21 review fixes)
**Status:** gaps_found
**Re-verification:** No, initial verification.

**MVP-mode note (Info).** ROADMAP marks Phase 7 `Mode: mvp`, but the goal is not in user-story form (`user-story.validate` returns `valid: false`). As in every earlier MVP phase here, the verification goes ahead at the orchestrator's request. The user-flow table below is derived from the goal's three promises.

## User Flow Coverage

| Step | Expected | Evidence | Status |
|------|----------|----------|--------|
| Admin publishes; the member's bell rises live | The count goes 0 → 1 with no reload, through `notifications.changed` on `tenant:<t>:all` plus a counters refetch | `phase7-smoke.spec.ts` case 1 passed on mobile and desktop (verifier run); `in-app.ts` publishes `{kind}` once per members broadcast | ✓ |
| Member opens the bell and taps a row | The row opens `/post/{id}` (or `?comentario=`, `/stories/{id}`, `/eventos/{id}`); mark-as-read and mark-all work | `lib/notification-renderers.tsx` hrefs; notifications e2e (verifier run) and smoke case 1 | ✓ |
| Member answers "Vou" and gets reminders | One 24 h row and one 1 h row, from a scheduled job, only for `going` | `events/server/notifications.ts` `resolveReminderDue` reads `status = 'going'` at fire time; `events-reminders.test.ts` 7/7 | ✓ |
| Member turns on push | The prompt comes only from a tap; iOS outside the Home Screen gets the install sheet | `lib/push.ts` `enablePush` (prompt is the first await); the single call site is `PushControls.tsx:99`; push e2e and smoke case 2 | ✓ (browser-emulated) / ? (real device) |
| A push arrives and is tapped | Tenant name and icon, the right screen opens | `push/send-job.ts` (tenant `display_name`, `iconUrls.i192`); `sw.ts` `notificationclick` with a same-origin URL guard; `push.test.ts` case 1 | ✓ server / ? device |
| Member writes to support; staff answer live | Inbox ordered by activity, both sides live, seq order, nothing lost on reconnect, a dot for the member | `chat_functions.sql` triggers; `chat.test.ts` 15/15; `realtime.test.ts` chat 5/5; chat e2e including `4b` (C-CR-01); smoke case 3 | ✓ |

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | **SC 1:** in-app notifications, made by the worker from domain events, for likes on comments, replies, new posts, new events, reminders (24 h and 1 h, `going` only) and support replies. The bell count updates live, a tap opens the target, and mark-as-read works. | ✓ VERIFIED | Sources live in the producer modules (`feed`/`stories`/`events` `server/notifications.ts`). The bus sink (`sink.ts`) only enqueues. `fanout-job.ts` runs in the worker (`worker.ts` registers `MODULE_REGISTRY` jobs). Support replies follow D-228: the chat dot plus a push, no bell row. That was the user's explicit choice in DISCUSSION-LOG ("Badge + push only"). Verifier runs: notifications.test 27/27, events-reminders 7/7, notifications-prune 5/5, smoke case 1 on both projects. |
| 2 | **SC 2 (automated half):** a member can turn on Web Push. On iOS outside standalone the install hint comes first, and the prompt is tap-only. The payload carries the tenant name and icon and the target URL. 404/410 deletes the row. Delivery goes through a channel abstraction. | ✓ VERIFIED | `push.ts` sets 404/410 to `gone`, then `push_subscription_report` deletes the row. `send-job.ts` reads the tenant `display_name` and `i192`. `registry.ts` has `CANONICAL_ORDER ['in_app','push']`, and `server/index.ts` registers both channels. Verifier runs: push.test 10/10 (incl. 410 delete, 503 retry-alone, blocked, handoff), push e2e, smoke case 2. |
| 3 | **SC 3:** the member's single support thread. Staff see an inbox ordered by last activity, with unread markers, and can reply. Both sides are live in seq order with lossless catch-up. The member sees a dot when support replied. | ✓ VERIFIED | `chat_messages_before_insert` assigns the seq under a row lock. `after_insert` publishes `{conversationId, seq}` to `conv:`, `support-inbox` and `user:`. `ThreadPane.tsx` catches up after the cursor on a signal, on SUBSCRIBED and on visible. The C-CR-01 cursor (`chat-cursor.ts`) is fixed. Verifier runs: chat.test 15/15 (20 concurrent sends give seqs 1..20; catch-up 4..9; D-237 dot), realtime chat 5/5, chat e2e incl. `4b`, smoke case 3. |
| 4 | **SC 4:** signals reach only their audience. Foreign user/conv topics and `support-inbox` without the role are rejected by RLS. Payloads are ids only. Blocking drops Realtime access and push subscriptions. | ✓ VERIFIED | `app.realtime_topic_allowed` checks the regex before any cast, requires a live membership of the topic's tenant, and enforces per-suffix rules. `realtime.messages` has one SELECT policy and no INSERT policy. Every publisher sends only `{kind}` or `{conversationId, seq}` (all call sites grepped). Verifier runs: realtime.test 12/12 live (negatives, module gate, a blocked user's new join refused, non-private join gets nothing, rollback delivers nothing, a browser `send` reaches no one), pgTAP 150/152 (0 skips after A-WR-06), isolation.test 31/31, push.test case 5 (blocked → devices deleted). The already-joined-socket residual is under Human Verification. |
| 5 | NOTIF-04: the channel registry takes a future e-mail/WhatsApp adapter as one file plus one key. | ✓ VERIFIED | `channels/registry.ts` has `registerChannel` / `channel` / `registeredChannels`, and the compile-time `everyKeyOrdered` check. module-notifications unit tests 107/107. |
| 6 | EVENT-07: reminders are armed inside the producer transaction, skipped when late, follow start moves, skip cancelled events, and are idempotent per (event, window, user). | ✓ VERIFIED | `armEventReminders(tx` is called at service.ts:468/916/1044. The fire-time checks are in `reminders.ts`. events-reminders.test 7/7. |
| 7 | CHAT-01: a generic schema (`kind`, role-bearing participants, per-conversation `seq`) and one support conversation per member. | ✓ VERIFIED | `20260930190151_chat.sql`. pgTAP 152 passes. chat.test "20 simultaneous first messages make ONE conversation". |
| 8 | The review criticals hold at HEAD: A-CR-01 (member self-enrolment) and C-CR-01 (lost reply). | ✓ VERIFIED | `20261001004630_chat_rls_per_command.sql` has per-command policies, plus the column grants in `…004638`. pgTAP 152 fact 8 passes in the verifier's 731/731 run. chat e2e `4b` passed on both projects in the verifier's run. |
| 9 | D-33 gate: sketch 007 was approved before the gated tasks were coded. | ✓ VERIFIED | README: `approved: true`, `approved_by: igor.vboas`, `approved_at: 2026-09-30`, commit 67ba861 at 13:49. The first gated UI commit is 779be21 (07-04 Task 3) at 14:18. |
| 10 | The release steps are written down and the deploy is wired: VAPID secrets on `api` and `worker`, `PUSH_TRANSPORT=webpush`, private-only Realtime, quota sizing, API before web. | ✓ VERIFIED | `deploy-api.yml` lines 154-198. `docs/DEPLOY.md` has "Phase 7 release" plus the Secret Manager and Vercel rows. `env.ts:173-180` refuses `webpush` without the keys and refuses a `localhost` subject. |
| 11 | The real-device test plan exists, with every row `Status: blocked — not run`. | ✓ VERIFIED | `docs/phase-07-device-test-plan.md` has 17 rows, and all 17 read blocked. No automated pass is recorded. |
| 12 | The UI state contracts (E01-E14) hold in automated form: badges, list states, push row and card, thread, composer, inbox, split view. | ✓ VERIFIED | Verifier runs: web unit 1178/1178 (49 files), module-chat 44, module-notifications 107, core 265. The chat/notifications/push e2e had 101 passed and 5 skipped; each skip is a case scoped to the other project. |
| 13 | **SC 2 (real-device half):** in the installed PWA on a real iPhone, iPad and Android, the prompt comes from the Home Screen app, banners show the tenant name and icon, a tap opens the screen, tags replace banners, and the app-icon badge counts. | ? UNCERTAIN (backstop) | Cannot run locally: phones cannot reach `*.localhost`, and Phase 7 is not deployed. Routed to human. This is also Phase 8 SC 4's go-live gate. |
| 14 | 07 review C-WR-03: the race guards in `NotificationsSurface`. | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | The generation ref and the scoped rollback are present (commit 583619c). No test triggers either race. |
| 15 | 07-11: the local exit gate is green (`pnpm verify` exits 0). | ✗ FAILED | It never exited 0 in 07-11. The verifier reproduced the desktop double-tap failure (1 of 4 repeats) at HEAD. The remaining reds are the env-file `PLATFORM_HOST` (34 platform-host cases), the feed-comments cold flake and the turbo `.next/types` race. None is a Phase 7 surface. See Gaps. |

**Score:** 12/15 truths verified (1 present but behavior-unverified, 1 uncertain/human, 1 failed)

**Override suggestion for truth 15.** The developer may judge that the gate failure is environmental and pre-existing. A phase-7-scoped gate passes: pgTAP, Phase 7 integration, unit, smoke and the three Phase 7 e2e specs, all re-run green here. To accept that, add this to the frontmatter:

```yaml
overrides:
  - must_have: "The local exit gate is green: TURBO_CACHE=local:r pnpm verify passes with every Phase 7 spec, pgTAP file and integration file included"
    reason: "Every Phase 7 spec, pgTAP file and integration file passes; the remaining reds are apps/web/.env.local PLATFORM_HOST (developer file), the Phase 4/5 desktop double-tap flake, the feed-comments cold-run flake and a turbo typegen/build race — tracked in deferred-items.md"
    accepted_by: "igor.vboas"
    accepted_at: "<ISO timestamp>"
```

With that override, the status would become `human_needed`.

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Real-device PWA install and push behaviour (truth 13) | Phase 8 | SC 4: "PWA install + push smoke tests on a real iPhone and Android" in the go-live gate |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/modules/notifications/**` | module package: fan-out, channels, push, routes, UI | ✓ VERIFIED | Registered in `MODULE_REGISTRY` (`registry.ts:52`). Jobs run in `worker.ts`. |
| `packages/modules/chat/**` | chat module: seq, inbox, counters, push-only source | ✓ VERIFIED | `registry.ts:48` `chat: chatModule`. `defaultRolePermissions` grants `chat.support` to both staff roles. |
| `supabase/migrations/20260930123213_realtime_authorization.sql` | topic authoriser, SELECT policy, `realtime_signal` | ✓ VERIFIED | Read in full. Hardened definers. No INSERT policy. |
| `supabase/migrations/20260930123214_notifications_functions.sql` | the only writer of notification rows | ✓ VERIFIED | Tenant from the claim, live predicate, `on conflict do nothing`. |
| `supabase/migrations/20260930141455_notifications_retract_prune.sql` and the `…prune` files | keep-and-mark retraction, 90-day prune | ✓ VERIFIED | notifications-prune.test 5/5, plus the retraction cases. |
| `supabase/migrations/20260930180227_push_subscriptions_functions.sql` | upsert, dead sweep, report | ✓ VERIFIED | pgTAP 153, push.test. |
| `supabase/migrations/20260930190229_chat_functions.sql` | seq and signal triggers | ✓ VERIFIED | Read in full. Ids-only payload. |
| `apps/web/app/sw.ts`, `lib/push-sw.ts` | push, click, resubscribe | ✓ VERIFIED | The `resolveClickUrl` same-origin guard. |
| `apps/web/app/api/realtime/token/route.ts` | BFF token | ✓ VERIFIED | The gate moved to `sameOriginGet` in `lib/notifications-bff.ts` (C-WR-02). The `verify.artifacts` pattern miss is a false negative. |
| `docs/phase-07-device-test-plan.md` | the real-device plan | ✓ VERIFIED | 17 rows, all blocked. |

The tool reported 6 artifact misses and 2 key-link misses. They are glob paths the tool does not expand (`*_realtime_authorization.sql`, etc.), the moved token-route pattern, and a multiline `^approved: true` anchor. The verifier resolved each one by hand (above, and truth 9).

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `apps/api/src/modules/registry.ts` | `core/server/notifications/source.ts` | `registerNotificationSource`, one subscription per event | ✓ WIRED |
| `notifications/server/sink.ts` | `core/server/jobs/boss.ts` | `enqueueInTx(… 'notifications.fanout' …)` | ✓ WIRED |
| `channels/in-app.ts` | `app.notifications_fanout` then `app.realtime_signal` | SQL | ✓ WIRED |
| `channels/registry.ts` | `channels/push.ts` | `registerChannel(pushChannel)` in `server/index.ts` | ✓ WIRED |
| `push/send-job.ts` | `core/server/modules/counters.ts` | `resolveCounters(ctx)`, in its own lane (A-WR-03) | ✓ WIRED |
| `push/transport.ts` | `core/server/env.ts` | `env.PUSH_TRANSPORT` and the VAPID keys | ✓ WIRED |
| `events/server/service.ts` | `events/server/reminders.ts` | `armEventReminders(tx` ×3 | ✓ WIRED |
| `chat_functions.sql` | topics authorised by `realtime_topic_allowed` | `realtime.send` to `conv:` / `support-inbox` / `user:` | ✓ WIRED |
| `RealtimeProvider` / `LiveCountersProvider` / `TopBar` | `/api/realtime/token`, `/api/me/counters`, `useLiveCounters` | fetch and context | ✓ WIRED |
| `ThreadPane.tsx` | `useRealtimeTopic(convTopic…)` | signal → `catchUp()` → `/api/chat/conversations/{id}/messages?afterSeq=` | ✓ WIRED |
| `PushControls.tsx` | `lib/push.ts` → `/api/push/subscriptions` | `enablePush` / `disablePush` | ✓ WIRED |
| `(app)/layout.tsx` | `LiveShell` | VAPID key only when `notifications` is enabled (C-WR-01) | ✓ WIRED |
| `deploy-api.yml` | `env.ts` `assertProductionEnv` | `PUSH_TRANSPORT=webpush` plus 3 secrets on api and worker | ✓ WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| TopBar bell badge | `unreadNotifications` | `countUnseen` via `resolveCounters` → `/v1/me/counters` → `LiveCountersProvider` | DB `count(*)` | ✓ FLOWING |
| Chat slot dot/count | `unreadConversations`, `conversationsBadge` | `chatCounters` (`last_staff_seq > last_read_seq` / awaiting) | DB | ✓ FLOWING |
| `/notificacoes` rows | items | `loadNotifications` → `GET /v1/notifications` keyset | DB | ✓ FLOWING |
| Thread bubbles | messages | `GET /v1/chat/conversations/{id}/messages` | DB, seq order | ✓ FLOWING |
| Push banner | title, icon, body, url, badge | `send-job.ts`: tenant row, branding, hint, `resolveCounters` | DB | ✓ FLOWING |

### Behavioral Spot-Checks (all run by the verifier at HEAD)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| pgTAP incl. 150-153 and 020 | `pnpm supabase test db` | Files=21, Tests=731, PASS | ✓ PASS |
| Phase 7 integration | `vitest run` realtime, chat, notifications, push, events-reminders, notifications-prune, isolation, bootstrap | 8 files, 126/126 | ✓ PASS |
| Workspace unit | `TURBO_CACHE=local:r pnpm test` | 12/12 tasks (web 1178, core 265, notifications 107, chat 44, …) | ✓ PASS |
| Phase witness | `playwright test e2e/phase7-smoke.spec.ts` mobile + desktop | 8/8 | ✓ PASS |
| Phase 7 e2e | `playwright test chat, notifications, push` mobile + desktop | 101 passed, 5 skipped (cases scoped to the other project), 0 failed | ✓ PASS |
| Exit-gate residual | `playwright test feed.spec.ts -g "double tap on the gallery" --project=desktop-chromium --repeat-each=4` | 3 passed, 1 failed (no "Descurtir" after `dblclick`) | ✗ FAIL |

Each Playwright run started and then stopped its own API and web servers. Nothing was left listening on :3000, :8787 or :8788. No `.env*` file was read or modified.

### Probe Execution

No `scripts/*/tests/probe-*.sh` is declared or present for this phase. Step 7c does not apply.

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| NOTIF-01 | 07-01, 07-04, 07-05, 07-08, 07-11 | ✓ SATISFIED | Truth 1. Support replies are push plus the dot (D-228, user-chosen). |
| NOTIF-02 | 07-01, 07-02, 07-03, 07-04, 07-11 | ✓ SATISFIED | Truth 1 and the live bell (smoke case 1). |
| NOTIF-03 | 07-02, 07-06, 07-07, 07-11 | ✓ SATISFIED (automated) / ? NEEDS HUMAN (real device) | Truths 2 and 13. |
| NOTIF-04 | 07-01, 07-06, 07-11 | ✓ SATISFIED | Truth 5. |
| EVENT-07 | 07-05, 07-11 | ✓ SATISFIED | Truth 6. |
| PWA-02 | 07-02, 07-07, 07-11 | ✓ SATISFIED (iPhone UA outside standalone, e2e) / ? NEEDS HUMAN (standalone on a device) | `isIosLike`, the `InstallHint` push variant, smoke case 2. |
| CHAT-01 | 07-08, 07-11 | ✓ SATISFIED | Truth 7. |
| CHAT-02 | 07-02, 07-08, 07-09, 07-11 | ✓ SATISFIED | Truth 3. |
| CHAT-03 | 07-02, 07-08, 07-10, 07-11 | ✓ SATISFIED | chat.test ordering/adjacency/D-225, chat e2e "equipe" 1-7. |
| CHAT-04 | 07-08, 07-09, 07-10, 07-11 | ✓ SATISFIED | Truths 3 and 8. |
| CHAT-05 | 07-02, 07-08, 07-09, 07-11 | ✓ SATISFIED | chat.test D-237, chat e2e member case 3. |

All 11 phase IDs are claimed by at least one plan. REQUIREMENTS.md maps no other ID to Phase 7 (CHAT-06 is Phase 11), so no requirement is orphaned.

### Prohibitions (flagged; non-authoritative LLM verdicts, human review recommended)

| Plan | Prohibition | LLM verdict | Basis |
|------|-------------|-------------|-------|
| 07-01 | Signals and logs never carry content | holds | Every `realtime_signal` / `realtime.send` call site sends `{kind}` or `{conversationId, seq}`. Log calls in chat/notifications/push carry shapes and counts only. |
| 07-02 | No prototype-less surface coded before its drawing is reviewed | holds | The approval commit (13:49) precedes the first gated UI commit (14:18). |
| 07-04 | No excerpt of deleted content is kept, shown or pushed | holds, with a recorded partial | `notifications_retract` blanks the payload. `notifications_withdrawn` stops queued pushes (push.test 1b). Chat pushes are not re-checked because chat has no delete path in V1; Phase 8 moderation must add one. |
| 07-06 | Push copy never invents urgency or counts | holds | The copy templates are factual ("Novo post: …", "Em 1 hora: … começa às …"). A grep for urgency phrasing found nothing. |
| 07-07 | No permission prompt without a tap; no re-ask | holds | One `requestPermission` call site, inside `enablePush`, reached only from the tap handler. push e2e asserts no prompt on load. The dismissal is stored. |
| 07-07 | No pushes after logout or block | holds, with a residual | `BeforeLogout` unsubscribes and DELETEs. `ForgetSignedOutDevice` covers other sign-outs (C-WR-06). Blocked users' devices are deleted before any send. Not covered: the `?erro=sair` case, where push is off but the member is not told. |
| 07-09 | Staff identity beyond the first name is never shown to a member | holds | chat.test "D-222: … first name and nothing else". |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (283 Phase 7 files) | - | TBD/FIXME/XXX/TODO/HACK | none found | - |
| `.planning/sketches/MANIFEST.md` | 49 | Sketch 007 row still reads `pending` while its README is `approved` | ℹ️ Info | Stale index only |
| `apps/web/e2e/feed.spec.ts` | 321 | Flaky timing gesture case (desktop) | ⚠️ Warning | Keeps the exit gate red (gap) |

### Human Verification Required

#### 1. Real-device push and PWA rows

**Test:** After the DEPLOY.md "Phase 7 release" steps, run rows 1-17 of `docs/phase-07-device-test-plan.md` on a real iPhone (Safari and the Home Screen app), an iPad and an Android phone.
**Expected:** Every row passes as written.
**Why human:** Phones cannot reach `*.localhost`, Phase 7 is not deployed, and Playwright cannot emulate iOS standalone or real push services.

#### 2. Blocked member with an open socket

**Test:** Block a member by SQL (row 14) while their app is open.
**Expected:** New joins are refused. The open socket goes quiet no later than its next token push (≤ 3600 s). API reads are refused. Devices are deleted at the next send.
**Why human:** The already-joined-socket window is documented, not tested.

#### 3. C-WR-02 token-gate policy

**Test:** Decide whether a GET with neither `Sec-Fetch-Site` nor `Origin` may proceed to the session check on the four BFF GET routes.
**Expected:** Accepted, or reverted to 403.
**Why human:** The fixer flagged this security posture change as needing the developer's judgement.

#### 4. NotificationsSurface races (C-WR-03)

**Test:** Run a load-more racing a refresh, and a failed mark-all with a row tapped mid-flight.
**Expected:** No stale page is appended, and the rollback keeps the tapped row read.
**Why human:** No automated test triggers either race.

#### 5. Flagged prohibitions

**Test:** Review the seven verdicts in the Prohibitions table.
**Expected:** Confirmed, or a reason recorded.
**Why human:** Judgment-tier items need a human sign-off.

### Gaps Summary

The phase goal is achieved in code. Everything below was re-run by the verifier at HEAD 624f0c0.

- **Bell:** live through `tenant:<t>:all` / `user:` signals and a counters refetch.
- **Lists and reminders:** the list and its deep links work, and reminders reach only `going` members.
- **Web Push:** subscribe, tenant-branded payload, 404/410 cleanup and the channel registry are all proven against the fake transport and a mocked `PushManager`.
- **Support chat:** live in both directions with lossless seq catch-up.
- **Realtime authorisation:** cross-tenant, cross-user and role negatives run live against Realtime and in pgTAP.
- **Review criticals:** A-CR-01 and C-CR-01 hold.

The one failed must-have is 07-11's own exit-gate truth: `pnpm verify` has never exited 0. It shares one root concern, local gate hygiene, and nothing in it touches a Phase 7 surface. It has four parts:

- **Developer env file.** `apps/web/.env.local` `PLATFORM_HOST` breaks 34 platform-host cases.
- **Double-tap flake.** The desktop `feed.spec.ts` double-tap case is a Phase 4/5 spec. The verifier reproduced it once in four runs. It is plausibly worsened by LiveShell's load-time work, which is not yet proven.
- **Feed-comments flake.** A cold-run race in `feed-comments.spec.ts` `failNextActions`.
- **Turbo race.** `next typegen` and `next build` write `.next/types` in parallel.

These can be closed by a small gap plan, or by accepting the suggested override. With the override, the phase moves to `human_needed`, pending the real-device plan (Phase 8 go-live), the open-socket block residual, the C-WR-02 policy call, the unexercised C-WR-03 races and the prohibition sign-off.

---

_Verified: 2026-10-01T02:03:42Z_
_Verifier: Claude (gsd-verifier)_
