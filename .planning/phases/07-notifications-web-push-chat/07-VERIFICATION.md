---
phase: 07-notifications-web-push-chat
verified: 2026-10-01T14:28:09Z
status: passed
score: 21/22 must-haves verified
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
  - ".planning/phases/07-notifications-web-push-chat/07-12-PLAN.md"
  - ".planning/phases/07-notifications-web-push-chat/07-12-SUMMARY.md"
  - ".planning/phases/07-notifications-web-push-chat/07-13-PLAN.md"
  - ".planning/phases/07-notifications-web-push-chat/07-13-SUMMARY.md"
  - ".planning/phases/07-notifications-web-push-chat/07-14-PLAN.md"
  - ".planning/phases/07-notifications-web-push-chat/07-14-SUMMARY.md"
  - ".planning/phases/07-notifications-web-push-chat/07-15-PLAN.md"
  - ".planning/phases/07-notifications-web-push-chat/07-15-SUMMARY.md"
  - ".planning/phases/07-notifications-web-push-chat/deferred-items.md"
  - ".planning/quick/261001-ere-phase-7-leftovers-mark-all-busy-and-tapp/261001-ere-PLAN.md"
  - ".planning/quick/261001-ere-phase-7-leftovers-mark-all-busy-and-tapp/261001-ere-SUMMARY.md"
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
  - "apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx"
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
  - "apps/web/e2e/admin.ts"
  - "apps/web/e2e/blocked.spec.ts"
  - "apps/web/e2e/chat-admin.ts"
  - "apps/web/e2e/chat.spec.ts"
  - "apps/web/e2e/feed-admin.ts"
  - "apps/web/e2e/feed-comments.spec.ts"
  - "apps/web/e2e/feed.spec.ts"
  - "apps/web/e2e/fixtures.ts"
  - "apps/web/e2e/hosts.ts"
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
  - "apps/web/playwright.config.ts"
  - "apps/web/turbo.json"
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
covered_digest: v1:sha256:7da44485b881db9223af53e4e96ec5b3a9b48a79dc9c0f8cabed0f5b342ab747
behavior_unverified: 0
overrides_applied: 1
overrides:
  - must_have: "The local exit gate is green: TURBO_CACHE=local:r pnpm verify passes with every Phase 7 spec, pgTAP file and integration file included"
    reason: "07-15 run: pgTAP 731/731, integration 708/708, compile 27/27, all four truth-15 gap items green, every Phase 7 e2e spec green except notifications.spec.ts:228, which quick 261001-ere fixed (notifications.spec.ts 45 passed / 1 skipped on both projects; WINDOWS 68 fixed). The three remaining reds are outside Phase 7 (05.2 highlight sheets phase52-smoke:294 and stories:1636 on mobile, Phase 2 Marca save phase2-smoke:378 on desktop; WINDOWS 69-71) and are deferred, tracked in deferred-items.md. e2e:pwa was not run in that gate run. Developer chose to close the phase without another full gate run."
    accepted_by: "igor.vboas"
    accepted_at: "2026-10-01T14:20:52Z"
re_verification:
  previous_status: gaps_found
  previous_score: 17/22
  gaps_closed:
    - "Truth 12 (UI E04 loading, UI-D-252): the mark-all control now stays mounted, aria-busy and disabled for its whole POST (render condition `anyUnread || markingAll`, a5d5d6b). The verifier ran NotificationsSurface.test.tsx at HEAD: 5/5 passed, with no it.fails left. Against the pre-fix component (81e1c5e) the cases fail: 3 failed, 2 passed"
    - "Truth 17 (own read POST during a mark-all): `activate` now posts a keepalive /read for a server-unread row that only the in-flight mark-all cleared, once per mark-all. Proven by the 'own read POST' case and the tightened case 2, both green at HEAD and red on the pre-fix component"
    - "Truth 20 (feed.spec.ts --repeat-each=3): the UI-D-20 slug is now unique per project, run and repeat (c46b454). Verifier run on both projects: exit 0, 69 passed, 9 skipped, 0 failed. UI-D-20 passed 12/12. No feed-empty tenant was left afterwards"
    - "Truth 15 (local exit gate): PASSED (override) under the developer-accepted override. Its only Phase 7 red, notifications.spec.ts:228, is fixed. The verifier's run of notifications.spec.ts on both projects exited 0 with 45 passed and 1 skipped; :228 passed on mobile and on desktop"
  gaps_remaining: []
  regressions: []
deferred:
  - truth: "Real-device push and PWA behaviour (installed iPhone/Android/iPad: prompt from the Home Screen app, tenant name and icon in the OS banner, tag replacement, foreground suppression, app-icon badge, composer above the keyboard)"
    addressed_in: "Phase 8"
    evidence: "Phase 8 success criterion 4: 'the pilot go-live gate passes: ... PWA install + push smoke tests on a real iPhone and Android'. The rows are in docs/phase-07-device-test-plan.md and stay under human verification."
  - truth: "phase52-smoke.spec.ts:294 mobile (05.2 'Novo destaque' create sheet never opened) red in the 07-15 gate (WINDOWS 69)"
    addressed_in: "Developer deferral under the truth 15 override (no later roadmap phase names it)"
    evidence: "Override accepted by igor.vboas 2026-10-01T14:20:52Z: 'The three remaining reds are outside Phase 7 ... (WINDOWS 69-71) and are deferred, tracked in deferred-items.md'. WINDOWS 69 open; deferred-items.md entry open."
  - truth: "stories.spec.ts:1636 mobile (05.2 Escape did not close the 'Editar destaque' sheet) red in the 07-15 gate (WINDOWS 70)"
    addressed_in: "Developer deferral under the truth 15 override (no later roadmap phase names it)"
    evidence: "Same override. WINDOWS 70 open; deferred-items.md entry open."
  - truth: "phase2-smoke.spec.ts:378 desktop (Phase 2 Marca 'Salvar alterações' stayed disabled) red in the 07-15 gate (WINDOWS 71); e2e:pwa not run in that gate"
    addressed_in: "Developer deferral under the truth 15 override (no later roadmap phase names it)"
    evidence: "Same override. WINDOWS 71 open; deferred-items.md entry open."
human_verification:
  - test: "Real-device rows 1-17 of docs/phase-07-device-test-plan.md against production after the 'Phase 7 release' steps of docs/DEPLOY.md (VAPID secrets, Realtime private-only, JWT expiry, API before web)"
    expected: "Every row passes as written"
    why_human: "Phones cannot reach the *.localhost stack and Phase 7 is not deployed; Playwright cannot emulate iOS standalone, real push services or OS banners (all 17 rows are 'Status: blocked — not run')"
  - test: "Blocked member with an open app: block a member by SQL (device plan row 14) while their app is open on Início and on /suporte"
    expected: "No new join succeeds; the open socket goes quiet no later than its next token push or re-join (≤ 3600 s); API reads are refused and the web moves to /acesso-suspenso; subscriptions are gone at the next send"
    why_human: "The already-joined-socket residual is documented, not tested; decide whether it is acceptable until Phase 8's block action revokes eagerly"
  - test: "Decide on the C-WR-02 change to the documented token-route gate (T-07-12): the four BFF GET routes accept a request with NO Sec-Fetch-Site and NO Origin and move on to the session check"
    expected: "The developer accepts the fallback or asks for the stricter 403 back"
    why_human: "A security posture change the fixer flagged as needing the developer's judgement"
  - test: "Review the non-authoritative verdicts on the eleven flagged prohibitions (seven from 07-01..07-09, four from 07-12..07-15; table 'Prohibitions')"
    expected: "Each holds as described, or the developer records a reason it does not"
    why_human: "Judgment-tier prohibitions need explicit human resolution; the verifier's verdict is an LLM judgement, not proof"
---

# Phase 7: Notifications, Web Push & Chat Verification Report

**Phase Goal:** Members are reached in real time - a notification bell with live unread count, Web Push in the installed PWA and a live 1:1 support conversation - all fed by domain events over one shared realtime infrastructure (Supabase Broadcast on private topics, ids only, data always through the API).
**Verified:** 2026-10-01T14:28:09Z (HEAD 42a025f)
**Status:** human_needed
**Re-verification:** Yes, after quick task 261001-ere (commits a5d5d6b, c46b454, 42a025f) and the developer's truth 15 override.

## What changed since the previous report

`git diff --stat 81e1c5e..HEAD -- apps` touches 5 files. One of them is a product file:
- `apps/web/app/(app)/notificacoes/NotificationsSurface.tsx` (product)
- `NotificationsSurface.test.tsx`
- `e2e/notifications.spec.ts`, `e2e/feed-admin.ts` and `e2e/feed.spec.ts`

Nothing under `packages/`, `supabase/` or `scripts/` changed. Every other product surface behind truths 1-11, 13, 14, 16, 18, 19, 21 and 22 is byte-identical to the previous verification, so those truths get a regression check only. The notifications surface is re-proven below by the unit file and the full `notifications.spec.ts`. The uncommitted change to this report before re-verification was only the developer's `overrides:` block, which was checked with `git diff`.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC 1: in-app notifications from domain events, live bell, tap opens target, mark-as-read | ✓ VERIFIED | Regression check. The verifier ran `notifications.spec.ts` on both projects: exit 0, 45 passed, 1 skipped (mobile-only 320px case). Earlier 07-15 gate evidence: integration 708/708 and phase7-smoke 8/8 still stand, since no server file changed. |
| 2 | SC 2 (automated half): Web Push, tap-only prompt, tenant name/icon/url, 404/410 cleanup, channel abstraction | ✓ VERIFIED | Regression only: push files are unchanged. Gate run: push.spec 25/0, push.test in 708/708. |
| 3 | SC 3: single support thread, staff inbox, live both sides, seq catch-up, member dot | ✓ VERIFIED | Regression only: chat files are unchanged. Gate run: chat.spec 31/0, chat.test and realtime.test in 708/708. |
| 4 | SC 4: signals reach only their audience; ids-only payloads; blocking drops access | ✓ VERIFIED | Regression only. pgTAP 150-153 in 731/731. |
| 5 | NOTIF-04 channel registry | ✓ VERIFIED | Unchanged. |
| 6 | EVENT-07 reminders | ✓ VERIFIED | Unchanged. The `notifications eventos` cases passed in the verifier's e2e run. |
| 7 | CHAT-01 generic schema, one support conversation | ✓ VERIFIED | Unchanged; pgTAP 152. |
| 8 | Review criticals A-CR-01 and C-CR-01 hold | ✓ VERIFIED | Unchanged. |
| 9 | D-33 sketch gate | ✓ VERIFIED | Unchanged. |
| 10 | Release steps and deploy wiring | ✓ VERIFIED | Unchanged. |
| 11 | Real-device plan exists, all rows blocked | ✓ VERIFIED | Unchanged. |
| 12 | UI state contracts E01-E14 hold in automated form (incl. E04 loading, UI-D-252) | ✓ VERIFIED | **Fixed.** `NotificationsSurface.tsx:393` renders the control while `anyUnread \|\| markingAll`, with `loading={markingAll}`. The real `@rede-social/ui` Button (not mocked) sets `disabled` and `aria-busy` (`Button.tsx:52-53`). Verifier run at HEAD: 5/5 passed, no `it.fails`. The case "E04 loading" asserts the control is busy and disabled during the POST and gone after a 204 with no toast. Case 2 asserts busy and disabled during the POST, that a click on it starts no second POST, and that the control is idle again after a failure. Against the pre-fix component: 3 failed, 2 passed. |
| 13 | SC 2 (real-device half) | ? UNCERTAIN (backstop) | Unchanged. Deferred to Phase 8 SC 4 and listed for human verification. |
| 14 | C-WR-03: a stale load-more page is dropped after a refresh, and a failed mark-all rolls back only what it added, keeping tapped rows read | ✓ VERIFIED | Cases 1-3 green at HEAD. The rollback now uses `inFlight.added` minus `inFlight.tapped` (lines 259-263). The "tapped rows stay read" half is now backed on the server too (truth 17). |
| 15 | The local exit gate is green (`pnpm verify` exits 0) | ✓ PASSED (override) | Override: "07-15 run: pgTAP 731/731, integration 708/708, compile 27/27 ... Developer chose to close the phase without another full gate run". Accepted by igor.vboas on 2026-10-01T14:20:52Z. Its only Phase 7 red (`notifications.spec.ts:228`) is fixed and re-run green by the verifier. WINDOWS 69-71 and `e2e:pwa` are deferred (see Deferred Items). |
| 16 | 07-12: harness platform host rule | ✓ VERIFIED | Unchanged. The verifier's two Playwright runs started their servers with no PLATFORM_HOST problem. |
| 17 | 07-14 premise: a row tapped during a mark-all sends its own read POST | ✓ VERIFIED | **Fixed.** In `activate` (lines 213-229), `clearedOnlyByMarkAll = marking && view.unread && marking.added.has(id) && !marking.tapped.has(id)` posts a keepalive `/read`. Proven at HEAD by the case "own read POST" (b posted, c not) and by case 2 (b posted exactly once; a, tapped before, posted once and not again; c, never tapped, 0). Both are red on the pre-fix component. The misleading comment from the previous report now matches the code. |
| 18 | 07-12: targeted `failNextActions` | ✓ VERIFIED | Unchanged. |
| 19 | 07-13: double-tap explained; FEED-04 self-restoring | ✓ VERIFIED | Unchanged code. The FEED-04 cases passed 3x on both projects in the verifier's `--repeat-each=3` run. |
| 20 | 07-13: `feed.spec.ts` passes with `--repeat-each=3` on both projects | ✓ VERIFIED | **Fixed.** `emptyFeedSlug(project, RUN, repeatEachIndex)` plus `deleteStaleEmptyFeedTenants` (c46b454). Verifier run: exit 0, 69 passed, 9 skipped (mobile-only cases x3), 0 failed. UI-D-20 passed 12 times. `select count(*) ... slug like 'feed-empty%'` returned 0 afterwards. |
| 21 | 07-15: web typecheck depends on web build | ✓ VERIFIED | Unchanged `apps/web/turbo.json`. |
| 22 | 07-15: records follow evidence; no override written by an executor; 07-VERIFICATION untouched by executors | ✓ VERIFIED | The quick task did not touch this report (its 3 commits list no 07-VERIFICATION path). The only override is the developer's. WINDOWS 66/67/68 are `fixed` only with run evidence, which the verifier reproduced. 69-71 stay `open`. |

**Score:** 21/22 truths verified, including 1 by override (0 present-but-behavior-unverified, 1 uncertain/human, 0 failed)

Truths 12 and 17 are behavior-dependent (state transitions in the mark-all lifecycle). Each is VERIFIED on a passing named test, not on presence alone. Both were also shown non-vacuous against the pre-fix component.

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Real-device PWA install and push behaviour (truth 13) | Phase 8 | SC 4: "PWA install + push smoke tests on a real iPhone and Android" |
| 2 | `phase52-smoke.spec.ts:294` mobile red (WINDOWS 69) | Developer deferral (truth 15 override) | deferred-items.md entry open; outside Phase 7 (05.2) |
| 3 | `stories.spec.ts:1636` mobile red (WINDOWS 70) | Developer deferral (truth 15 override) | deferred-items.md entry open; outside Phase 7 (05.2) |
| 4 | `phase2-smoke.spec.ts:378` desktop red (WINDOWS 71); `e2e:pwa` not run in the 07-15 gate | Developer deferral (truth 15 override) | deferred-items.md entry open; outside Phase 7 (Phase 2) |

Items 2-4 are not tied to a roadmap phase. They are tracked in WINDOWS and deferred-items.md and should be classified by a `/gsd-debug` pass before the next full gate run.

### Advisory (New Scope, Unevidenced)

None.

### Required Artifacts (quick 261001-ere)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/web/app/(app)/notificacoes/NotificationsSurface.tsx` | control mounted while `markingAll`; `inFlightMarkAll` ref; tapped-row POST; keepalive read-all | ✓ VERIFIED | Lines 206-269, 393-396 |
| `apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx` | 5 plain cases, case 2 tightened | ✓ VERIFIED | No `it.fails`, no `during === null`; 5/5 green; 3 red on the pre-fix component |
| `apps/web/e2e/notifications.spec.ts` | waits for read-all 204 before reload | ✓ VERIFIED | `waitForResponse` is armed before the click, and status 204 is asserted before the reload (lines 235-244) |
| `apps/web/e2e/feed-admin.ts` | `emptyFeedSlug(project, run, repeat)`, `deleteStaleEmptyFeedTenants` | ✓ VERIFIED | Bound postgres.js parameters with `starts_with`, so no LIKE wildcard applies |
| `apps/web/e2e/feed.spec.ts` | per-run, per-repeat slug in UI-D-20 `beforeAll` | ✓ VERIFIED | `RUN = Date.now().toString(36)`, `testInfo.repeatEachIndex` |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `NotificationsSurface` `markAll` | `/api/notifications/read-all` | `fetch(..., { method: 'POST', keepalive: true })`, awaited | ✓ WIRED (unit assert + e2e 204) |
| `NotificationsSurface` `activate` | `/api/notifications/[id]/read` | keepalive POST when the row looks unread, or is server-unread and cleared only by the in-flight mark-all | ✓ WIRED (unit assert) |
| markAll JSX | `@rede-social/ui` Button `loading` | `anyUnread \|\| markingAll`, `loading={markingAll}` → `disabled` + `aria-busy` | ✓ WIRED |
| `feed.spec.ts` UI-D-20 `beforeAll` | `feed-admin.ts` | `deleteStaleEmptyFeedTenants` then `emptyFeedSlug(name, RUN, repeatEachIndex)` | ✓ WIRED (12/12 green) |

The key links for 07-12..07-15 are unchanged from the previous report.

### Data-Flow Trace (Level 4)

Unchanged. The bell badge, chat counters, `/notificacoes` rows, thread bubbles and push banner all flow from DB queries. The mark-all persistence path was exercised end to end by `notifications.spec.ts:228`: click, then the 204, then a reload with no Novas section.

### Behavioral Spot-Checks (run by the verifier)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Mark-all lifecycle and C-WR-03 at HEAD | `pnpm exec vitest run "app/(app)/notificacoes/NotificationsSurface.test.tsx"` | 5 passed (5) | ✓ PASS |
| The new assertions are non-vacuous | same file importing a temporary copy of the 81e1c5e component (deleted afterwards; `git status apps/` clean) | 3 failed (case 2, E04 loading, own read POST), 2 passed (cases 1 and 3) | ✓ PASS |
| Notifications e2e, incl. `:228` | `playwright test e2e/notifications.spec.ts --project=mobile-chromium --project=desktop-chromium` | exit 0, 45 passed, 1 skipped (2.8 min); `:228` passed on mobile (2.0 s) and desktop (1.7 s) | ✓ PASS |
| Feed e2e repeated | `playwright test e2e/feed.spec.ts --project=mobile-chromium --project=desktop-chromium --repeat-each=3` | exit 0, 69 passed, 9 skipped, 0 failed (1.7 min); UI-D-20 12/12 | ✓ PASS |
| Fixture leaves no tenant behind | `select count(*) from public.tenants where slug like 'feed-empty%'` (local DB, read-only) | 0 | ✓ PASS |
| Static checks on the 5 changed files | `biome check` on the files; `tsc --noEmit` in apps/web | no findings; exit 0 | ✓ PASS |
| Full exit gate | not re-run (developer instruction); covered by the truth 15 override | - | PASSED (override) |

Ports 3000, 3100, 8787 and 8788 were free before and after each Playwright run. The verifier did not run `db:reset`, `db:seed` or a full `pnpm verify`, and read no `.env*` file.

### Probe Execution

No `scripts/*/tests/probe-*.sh` is declared or present. Step 7c does not apply.

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| NOTIF-01 | 07-01, 07-04, 07-05, 07-08, 07-11..07-13, 07-15 | ✓ SATISFIED | Truth 1 |
| NOTIF-02 | 07-01..07-04, 07-11..07-15, quick 261001-ere | ✓ SATISFIED | Truths 1, 12, 14 and 17. Mark-as-read now holds in the UI and on the server; `notifications.spec.ts` green on both projects |
| NOTIF-03 | 07-02, 07-06, 07-07, 07-11..07-13, 07-15 | ✓ SATISFIED (automated) / ? NEEDS HUMAN (device) | Truths 2 and 13 |
| NOTIF-04 | 07-01, 07-06, 07-11..07-13, 07-15 | ✓ SATISFIED | Truth 5 |
| EVENT-07 | 07-05, 07-11..07-13, 07-15 | ✓ SATISFIED | Truth 6 |
| PWA-02 | 07-02, 07-07, 07-11..07-13, 07-15 | ✓ SATISFIED (emulated) / ? NEEDS HUMAN (device) | Truth 13 |
| CHAT-01 | 07-08, 07-11..07-13, 07-15 | ✓ SATISFIED | Truth 7 |
| CHAT-02 | 07-02, 07-08, 07-09, 07-11..07-13, 07-15 | ✓ SATISFIED | Truth 3 |
| CHAT-03 | 07-02, 07-08, 07-10, 07-11..07-13, 07-15 | ✓ SATISFIED | Truth 3 |
| CHAT-04 | 07-08..07-13, 07-15 | ✓ SATISFIED | Truths 3 and 8 |
| CHAT-05 | 07-02, 07-08, 07-09, 07-11..07-13, 07-15 | ✓ SATISFIED | Truth 3 |

All 11 IDs are claimed by plans. REQUIREMENTS.md maps exactly these 11 to Phase 7 (CHAT-06 and CHAT-07 are Phase 11), so none is orphaned. REQUIREMENTS.md still reads "Gaps Found" for all 11. The orchestrator should update those rows. Note that REQUIREMENTS.md is in `covered_files`, so committing that edit after this report makes the digest stale until it is re-attested.

### Prohibitions (flagged; non-authoritative LLM verdicts, human review recommended)

| Plan | Prohibition | LLM verdict | Basis |
|------|-------------|-------------|-------|
| 07-01 | Signals and logs never carry content | holds | Unchanged |
| 07-02 | No prototype-less surface coded before its drawing is reviewed | holds | Unchanged |
| 07-04 | No excerpt of deleted content kept, shown or pushed | holds, with a recorded partial | Unchanged |
| 07-06 | Push copy never invents urgency or counts | holds | Unchanged |
| 07-07 | No permission prompt without a tap; no re-ask | holds | Unchanged |
| 07-07 | No pushes after logout or block | holds, with a residual | Unchanged |
| 07-09 | Staff identity beyond the first name never shown | holds | Unchanged |
| 07-12 | The harness never prints, rewrites or regenerates an env-file value; an exported value wins | holds, with a caveat (WR-03) | Unchanged |
| 07-13 | A double tap on a not-liked post never sends an unlike; one double tap never sends more than one like request | holds on the evidence | Also green 3x per project in the verifier's repeat run |
| 07-14 | A failed mark-all never restores a tapped row's tint; a stale load-more never appends or adopts its cursor | holds | The tapped-row half now also holds on the server: the tap sends its own read (truth 17) |
| 07-15 | The gate is never turned green by skipping, retrying, loosening, overriding or editing env files | holds | No executor override. The truth 15 override is the developer's own, recorded with its reason. The quick task tightened assertions rather than loosening them. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| 5 quick-task files | - | TBD/FIXME/XXX/TODO/HACK | none found | - |
| `NotificationsSurface.test.tsx` | - | "a second tap on the same row during one mark-all sends nothing new" (quick must-have 3) is guarded in code (`!marking.tapped.has(id)`) but no case taps twice | ℹ️ Info | Untested guard; low risk |
| `e2e/feed.spec.ts` | 68-78 | Hydration probe on React's private `__reactProps` key (WR-01) | ⚠️ Warning | Carried from the previous report |
| `e2e/feed.spec.ts` | 446-447 | One-request count read after the first response (WR-02) | ⚠️ Warning | Carried |
| `playwright.config.ts` | 40-49 | Warning inaccurate when a server is reused (WR-03) | ⚠️ Warning | Carried |
| `apps/web/turbo.json` | 14-16 | Typecheck requires a full web build (IN-06) | ℹ️ Info | Carried |
| e2e runs (any spec) | - | `unhandledRejection: TypeError ... reading 'waiting'` after "Service Worker registration blocked by Playwright" | ℹ️ Info | Pre-existing Serwist register noise under the blocked SW (already noted in deferred-items.md); no test fails on it |

All the previous warnings tied to the mark-all lifecycle are resolved:
- the false comment at lines 222-223
- WR-04 (the green case certified UI-only state)
- IN-03 (the loose `during === null` assertion)
- the `notifications.spec.ts` reload race

### Human Verification Required

#### 1. Real-device push and PWA rows
**Test:** After the DEPLOY.md "Phase 7 release" steps, run rows 1-17 of `docs/phase-07-device-test-plan.md` on a real iPhone (Safari and the Home Screen app), an iPad and an Android phone.
**Expected:** Every row passes as written.
**Why human:** Phones cannot reach `*.localhost`, Phase 7 is not deployed, and Playwright cannot emulate iOS standalone or real push services.

#### 2. Blocked member with an open socket
**Test:** Block a member by SQL (row 14) while their app is open.
**Expected:** New joins are refused. The open socket goes quiet within ≤ 3600 s. API reads are refused. Devices are deleted at the next send.
**Why human:** The already-joined-socket window is documented, not tested.

#### 3. C-WR-02 token-gate policy
**Test:** Decide whether a GET with neither `Sec-Fetch-Site` nor `Origin` may proceed to the session check on the four BFF GET routes.
**Expected:** Accepted, or reverted to 403.
**Why human:** A security posture change flagged for the developer's judgement.

#### 4. Flagged prohibitions
**Test:** Review the eleven verdicts in the Prohibitions table.
**Expected:** Confirmed, or a reason recorded.
**Why human:** Judgment-tier items need a human sign-off.

### Gaps Summary

No gap remains. The three code-level gaps of the previous report are closed in product and test code, and the verifier reproduced the evidence itself:
- truth 12: E04 loading
- truth 17: the tapped row's own read POST
- truth 20: the UI-D-20 repeat slug

Each fix is pinned by a test that is red on the pre-fix code. Truth 15 passes by the developer's override. Its one Phase 7 red is fixed and green on both projects. The three non-Phase-7 reds (WINDOWS 69-71) and the unrun `e2e:pwa` stage are recorded as deferred, not as gaps.

The status is `human_needed`, not `passed`, because of four items:
- the real-device rows (deferred to Phase 8 SC 4 and still listed)
- the open-socket block residual
- the C-WR-02 policy decision
- the flagged-prohibition sign-off

None of the four blocks the product goal in the local stack. Each needs the developer's hand.

---

_Verified: 2026-10-01T14:28:09Z_
_Verifier: Claude (gsd-verifier)_


## Developer Closure (2026-10-01T14:33:57Z)

The developer (igor.vboas) closed Phase 7 on 2026-10-01 without another full gate run. The four human-verification items above are settled in 07-UAT.md as follows:

- **Accepted (pass):** the C-WR-02 fallback on the four BFF GET token routes, and the verdicts on the eleven flagged prohibitions, as described in this report.
- **Deferred (blocked, real-device):** the real-device rows 1-17 of docs/phase-07-device-test-plan.md and the blocked-member-with-open-socket check. They run against production after the Phase 7 release steps, in the Phase 8 real-device pass (SC 4), the same way 05.2 and 05.3 were deferred.
- **Deferred under the truth 15 override:** WINDOWS 69-71 (phase52-smoke:294, stories:1636, phase2-smoke:378). e2e:pwa was not run in the last gate run.

The status moved from human_needed to passed on that decision, not on new evidence.

### Re-attestation (2026-10-01)

`covered_digest` was recomputed with `computeCoveredDigest` after `phase.complete 07` updated `.planning/REQUIREMENTS.md` and `.planning/ROADMAP.md` (traceability and the completion checkbox). No code or test file changed since the verifier's run.
