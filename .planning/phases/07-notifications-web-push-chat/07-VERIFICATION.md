---
phase: 07-notifications-web-push-chat
verified: 2026-10-01T13:29:40Z
status: gaps_found
score: 17/22 must-haves verified
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
covered_digest: "v1:sha256:25088830dd71353919d42d441eca288ee97dc110d98d695e11262ba65c1958fe"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 12/15
  gaps_closed:
    - "Truth 14 (07 review C-WR-03 races in NotificationsSurface): was PRESENT_BEHAVIOR_UNVERIFIED, now VERIFIED by NotificationsSurface.test.tsx cases 1-2 (run by the verifier at HEAD: 3 passed, 2 expected fail; run against 583619c^: cases 1 and 2 fail, the control passes)"
    - "Truth 15 gap item 1 (PLATFORM_HOST from the developer's env file): closed in the harness by 07-12; the 07-15 gate run passed every platform-host spec with nothing exported"
    - "Truth 15 gap item 2 (desktop feed double tap): explained (a leftover like) and closed by 07-13's self-restoring FEED-04 cases; passed on both projects in the 07-15 gate run"
    - "Truth 15 gap item 3 (feed-comments cold-run race): closed by 07-12's targeted failNextActions; passed on the cold post-reset server in the 07-15 gate run"
    - "Truth 15 gap item 4 (turbo .next/types race): closed by 07-15's apps/web/turbo.json override; dry-run graph confirmed by the verifier, 0 ENOTEMPTY in the gate run"
  gaps_remaining:
    - "Truth 15: pnpm verify still exits 1 (4 different e2e reds; e2e:pwa did not run)"
  regressions:
    - "Truth 12 (UI state contracts E01-E14 hold in automated form) was VERIFIED in the previous report. 07-14 then proved UI E04 loading does not hold at HEAD. This is a newly evidenced failure, not a code change: NotificationsSurface.tsx is byte-identical to the previous verification"
gaps:
  - truth: "The local exit gate is green: `TURBO_CACHE=local:r pnpm verify` passes with every Phase 7 spec, pgTAP file and integration file included (07-11 must-have, 07-15 truth 2)"
    status: failed
    reason: "The single consented 07-15 run at 6dbc035 exited 1 at e2e: 651 passed, 4 failed, 124 skipped, 9 did not run. e2e:pwa never ran. All four previous gap items held. The four new reds are: notifications.spec.ts:228 mobile (a Phase 7 spec: the reload 44 ms after mark-all aborted the read-all POST, which has no keepalive); phase52-smoke.spec.ts:294 mobile (the Novo destaque sheet never opened); stories.spec.ts:1636 mobile (Escape did not close the Editar destaque sheet); phase2-smoke.spec.ts:378 desktop (Salvar alterações stayed disabled after #primary was filled). The cause of the last three is not established. No product file they exercise changed in 8b7415e..6dbc035, and the live layer issues no router.refresh, so a Phase 7 regression is not indicated. It is not excluded either."
    artifacts:
      - path: "apps/web/e2e/notifications.spec.ts"
        issue: "line 228: page.reload() runs without waiting for POST /api/notifications/read-all. The case is green only when the POST beats the reload"
      - path: "apps/web/app/(app)/notificacoes/NotificationsSurface.tsx"
        issue: "line 234: read-all is a plain fetch with no keepalive, and the button unmounts optimistically (see the E04 gap), so nothing on screen waits for the POST"
      - path: "apps/web/e2e/phase52-smoke.spec.ts"
        issue: "line 255 (case at 294), mobile: the create sheet never opened; cases 2-6 did not run"
      - path: "apps/web/e2e/stories.spec.ts"
        issue: "line 1707 (case at 1636), mobile: Escape left the Editar destaque sheet open"
      - path: "apps/web/e2e/phase2-smoke.spec.ts"
        issue: "line 532 (case at 378), desktop: the Marca Save button re-rendered disabled and stayed disabled for 300 s; cases 2-5 did not run"
    missing:
      - "Fix the NotificationsSurface mark-all lifecycle (see the next gap). Keeping the button mounted and busy until the POST answers makes notifications.spec.ts:228's `toHaveCount(0)` wait for the response. Alternatively, make the spec wait for the read-all response before reloading, and decide whether read-all needs keepalive"
      - "Run /gsd-debug on the two 05.2 highlight-sheet reds (mobile) and the desktop phase2-smoke Marca red, using the traces in apps/web/test-results/ (kept until the next Playwright run). Classify each as a regression or a flake before any fix"
      - "Re-run `pnpm db:reset && pnpm db:seed && TURBO_CACHE=local:r VIDEO_PROVIDER=fake pnpm verify` once, through e2e:pwa, after the developer consents, or accept an override (see the report body)"
  - truth: "UI E04 loading (UI-D-252, re-lifted by 07-14; part of truth 12): the 'Marcar todas como lidas' button is aria-busy and disabled while its POST runs"
    status: failed
    reason: "At HEAD the optimistic step clears every loaded row, so anyUnread turns false and the button unmounts for the whole POST (NotificationsSurface.tsx:366-379). `loading={markingAll}` is never visible. The verifier ran NotificationsSurface.test.tsx: the unchanged planned assertion lives in `it.fails('gap E04 loading')` and fails as expected. WINDOWS 66 is open. A double submit is still impossible."
    artifacts:
      - path: "apps/web/app/(app)/notificacoes/NotificationsSurface.tsx"
        issue: "lines 366-379: `anyUnread ? <Button loading={markingAll}> : null` withdraws the control instead of showing it busy"
      - path: "apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx"
        issue: "lines 287-288: case 2 accepts `during === null || during.disabled` (review IN-03); tighten it when the fix lands"
    missing:
      - "Keep the button mounted while `markingAll` (for example `anyUnread || markingAll`), or amend UI-D-252 to say the control is withdrawn during the POST"
      - "Turn `it.fails('gap E04 loading')` into a plain `it`, and tighten case 2 to `during?.disabled === true`"
  - truth: "A row tapped while a mark-all is in flight is really marked read: its own read POST leaves, which is the premise of C-WR-03's scoped rollback (07-14 truth 2)"
    status: failed
    reason: "`activate` POSTs /read only while `isUnread(view)` (NotificationsSurface.tsx:208). During a mark-all every row is already in locallyRead, so no POST leaves. After a failed mark-all the row stays read on screen while the server keeps it unread until the next refresh. The product comment at lines 222-223 ('its own keepalive POST really marked it read') is untrue. Proven by `it.fails('gap own read POST')` (run by the verifier). WINDOWS 67 is open. Review WR-04: green case 2 certifies the UI-only state."
    artifacts:
      - path: "apps/web/app/(app)/notificacoes/NotificationsSurface.tsx"
        issue: "line 208: the read POST is gated on the locally-unread view, not on the server-unread `view.unread`, while a mark-all is open"
      - path: "apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx"
        issue: "lines 290-304: asserts row b stays read without any read request for b (review WR-04)"
    missing:
      - "In `activate`, POST /read when `view.unread` is true and a mark-all is open (or roll the tapped row back with the rest)"
      - "Turn `it.fails('gap own read POST')` into a plain `it`, and make case 2 assert the POST for b (or drop its b assertions), per WR-04"
  - truth: "`feed.spec.ts` passes on mobile-chromium and desktop-chromium with `--repeat-each=3` (07-13 must-have)"
    status: failed
    reason: "07-13's own run: 64 passed, 9 skipped, 5 failed. All five are 'UI-D-20 — a community with nothing published' on iterations 2 and 3. The describe recreates its empty tenant under the same slug and host on every repeat, and the member lands on 'Endereço incorreto'. Reproduced by the executor with `-g \"UI-D-20\" --project=desktop-chromium --repeat-each=2` (2 passed, 2 failed). This is pre-existing (Phase 4 describe), and the non-repeated gate passes it. The verifier did not re-run it (e2e writes to the database)."
    artifacts:
      - path: "apps/web/e2e/feed.spec.ts"
        issue: "UI-D-20 describe: emptyFeedSlug(project) is reused across repeats, so a cached tenant_domains lookup resolves the recreated host to the deleted tenant"
    missing:
      - "Include `testInfo.repeatEachIndex` in the empty tenant's slug, or drop the host cache entry in the fixture teardown"
deferred:
  - truth: "Real-device push and PWA behaviour (installed iPhone/Android/iPad: prompt from the Home Screen app, tenant name and icon in the OS banner, tag replacement, foreground suppression, app-icon badge, composer above the keyboard)"
    addressed_in: "Phase 8"
    evidence: "Phase 8 success criterion 4: 'the pilot go-live gate passes: ... PWA install + push smoke tests on a real iPhone and Android'. The rows are written in docs/phase-07-device-test-plan.md and still listed under human verification."
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
**Verified:** 2026-10-01T13:29:40Z (HEAD 9ea8726; gate run at 6dbc035)
**Status:** gaps_found
**Re-verification:** Yes, after gap closure plans 07-12..07-15.

## What changed since the previous report

`git diff --stat c6e03b6..HEAD -- apps packages supabase scripts` touches 8 files. None is a product file:
- `NotificationsSurface.test.tsx` (new)
- `e2e/admin.ts`, `e2e/feed-comments.spec.ts`, `e2e/feed.spec.ts`, `e2e/fixtures.ts` and `e2e/hosts.ts` (new)
- `playwright.config.ts`
- `apps/web/turbo.json`

Every product surface behind truths 1-11 and 13 is byte-identical to the previous verification. Those truths get a regression check only. They are backed by the 07-15 gate stages that passed (orchestrator-confirmed):
- pgTAP: 21 files, 731/731
- integration: 42 files, 708/708
- turbo typecheck/build/test: 27/27
- e2e: phase7-smoke 8/0, chat 31/0, push 25/0, notifications 44/1

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC 1: in-app notifications from domain events, live bell, tap opens target, mark-as-read | ✓ VERIFIED | Regression only: no product change. Gate run: integration 708/708 (notifications, events-reminders, prune), phase7-smoke 8/8. |
| 2 | SC 2 (automated half): Web Push, tap-only prompt, tenant name/icon/url, 404/410 cleanup, channel abstraction | ✓ VERIFIED | Regression only. Gate run: push.spec 25/0, push.test in 708/708. |
| 3 | SC 3: single support thread, staff inbox, live both sides, seq catch-up, member dot | ✓ VERIFIED | Regression only. Gate run: chat.spec 31/0, chat.test and realtime.test in 708/708. |
| 4 | SC 4: signals reach only their audience; ids-only payloads; blocking drops access | ✓ VERIFIED | Regression only. pgTAP 150-153 in 731/731, realtime.test live. |
| 5 | NOTIF-04 channel registry | ✓ VERIFIED | Unchanged; unit tasks 27/27. |
| 6 | EVENT-07 reminders | ✓ VERIFIED | Unchanged; events-reminders in 708/708. |
| 7 | CHAT-01 generic schema, one support conversation | ✓ VERIFIED | Unchanged; pgTAP 152. |
| 8 | Review criticals A-CR-01 and C-CR-01 hold | ✓ VERIFIED | Unchanged; pgTAP 152 fact 8, chat e2e 4b in chat.spec 31/0. |
| 9 | D-33 sketch gate | ✓ VERIFIED | Unchanged. |
| 10 | Release steps and deploy wiring | ✓ VERIFIED | Unchanged. |
| 11 | Real-device plan exists, all rows blocked | ✓ VERIFIED | Unchanged. |
| 12 | UI state contracts E01-E14 hold in automated form | ✗ FAILED (partial) | Newly evidenced: **E04 loading** fails. The mark-all button is withdrawn during its POST instead of aria-busy/disabled. The verifier ran `it.fails('gap E04 loading')`, which fails as expected. WINDOWS 66. The other rows stand. |
| 13 | SC 2 (real-device half) | ? UNCERTAIN (backstop) | Unchanged. Deferred to Phase 8 SC 4 and listed for human verification. |
| 14 | C-WR-03: a stale load-more page is dropped after a refresh, and a failed mark-all rolls back only what it added, keeping tapped rows read | ✓ VERIFIED | Verifier ran `NotificationsSurface.test.tsx` at HEAD: 3 passed, 2 expected fail. Against a temporary copy of `583619c^`: case 1 fails (`['n','a','b','c','d']` vs `['n','a','b']`), case 2 fails (row b `'true'`), and control case 3 passes. The temp files were deleted and git status is clean. The "stays read" half is UI-only; truth 17 covers the server side. |
| 15 | The local exit gate is green (`pnpm verify` exits 0) | ✗ FAILED | 07-15 run exited 1 at e2e: 4 reds, `e2e:pwa` not run. See Gaps. |
| 16 | 07-12: the harness gives its servers the platform host the specs browse; an exported value wins; one host source; the warning never prints the file's value | ✓ VERIFIED | Code read: `e2e/hosts.ts`, `playwright.config.ts:17-49`, `fixtures.ts:135`. Verifier ran `playwright test --list platform.spec.ts`. With no export it printed one `[e2e]` line naming only `rede-social.localhost`. With `PLATFORM_HOST=other.localhost` exported, nothing printed. Gate run: platform 8/0, platform-tenants 15/0, platform-branding 8/0, platform-domains 12/0, invite 8/0, signup 16/0. |
| 17 | 07-14 premise: a row tapped during a mark-all sends its own read POST | ✗ FAILED | `activate` posts only while the row looks unread (line 208). Proven by `it.fails('gap own read POST')`. WINDOWS 67. |
| 18 | 07-12: `failNextActions` fails only the comment-list or replies action (`next-action` header plus the target id) and asserts one failure; green on a cold server | ✓ VERIFIED | Code: `feed-comments.spec.ts:128-151`, with asserts at 353/382. Gate run: `:327` and `:361` passed as the first feed-comments run after the reset. Caveat (IN-01): `failedCount()` cannot exceed 1, so it cannot detect over-matching. |
| 19 | 07-13: the double tap red is explained, and every FEED-04 case clears, guards and confirms its own like in the database | ✓ VERIFIED | Code: `admin.ts:567/593`, with 6 `clearFeedPostLike(` and 8 `feedPostLikeState(` calls in feed.spec.ts, plus the `double-tap-timing` annotation. Gate run: `feed.spec.ts` 23/0, including the desktop double tap. Caveat (WR-02): the one-request count is read after the first response only. |
| 20 | 07-13: `feed.spec.ts` passes with `--repeat-each=3` on both projects | ✗ FAILED | The executor's own run had 5 failures, all UI-D-20 on iterations 2-3 (pre-existing). See Gaps. |
| 21 | 07-15: web typecheck depends on web build; Vercel's build graph is unchanged | ✓ VERIFIED | Verifier dry run: `@rede-social/web#typecheck` deps include `@rede-social/web#build` (13 deps). `#build` deps are `^build` only (12), not typecheck. Gate compile stage: 27/27, 0 `ENOTEMPTY`. |
| 22 | 07-15: records follow evidence; no override written; 07-VERIFICATION untouched by executors | ✓ VERIFIED | WINDOWS 59/64/65 are still `open`. 66-71 are `open`. The STATE blocker "Phase 7 local gate" is still listed. No 07-VERIFICATION change between c6e03b6 and this re-verification. |

**Score:** 17/22 truths verified (0 present-but-behavior-unverified, 1 uncertain/human, 4 failed)

### Override suggestion for truth 15 (developer's call; not written by the verifier)

The previous suggestion rested on "every Phase 7 spec passes". That no longer holds, because `notifications.spec.ts:228` is a Phase 7 spec. Its red also traces to the real product gap in truths 12 and 17: the mark-all lifecycle. The verifier therefore recommends fixing the NotificationsSurface gap first and only then weighing an override for the three non-Phase-7 reds. If the developer wants to accept the gate now anyway:

```yaml
overrides:
  - must_have: "The local exit gate is green: TURBO_CACHE=local:r pnpm verify passes with every Phase 7 spec, pgTAP file and integration file included"
    reason: "pgTAP 731/731, integration 708/708, compile 27/27 and every Phase 7 e2e spec but notifications.spec.ts:228 passed in the 07-15 run; the remaining reds (05.2 highlight sheets x2 mobile, Phase 2 Marca save desktop, and the notifications reload race) are tracked in deferred-items.md and WINDOWS 68-71; e2e:pwa not run"
    accepted_by: "igor.vboas"
    accepted_at: "<ISO timestamp>"
```

Even with that override, the status stays `gaps_found` because of truths 12, 17 and 20. Each needs a fix or its own override.

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Real-device PWA install and push behaviour (truth 13) | Phase 8 | SC 4: "PWA install + push smoke tests on a real iPhone and Android" |

No gap was deferred: no later phase names the local gate, the mark-all lifecycle or the UI-D-20 fixture.

### Advisory (New Scope, Unevidenced)

None. The new findings that block (truths 12, 17 and 20) carry deterministic evidence:
- Truths 12 and 17: `it.fails` cases, run by the verifier.
- Truth 20: a named reproduction command in 07-13-SUMMARY and deferred-items.md.

The review warnings on test code are listed under Anti-Patterns as warnings.

### Required Artifacts (gap plans)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/web/e2e/hosts.ts` | `e2eHosts()` and `e2ePlatformHostname()` | ✓ VERIFIED | Imports nothing from e2e; read at call time |
| `apps/web/playwright.config.ts` | harness PLATFORM_HOST rule | ✓ VERIFIED | `exportedPlatformHost` captured before `loadEnvFile`; value-free warning |
| `apps/web/e2e/fixtures.ts` | `hosts = e2eHosts()` | ✓ VERIFIED | line 135 |
| `apps/web/e2e/feed-comments.spec.ts` | targeted `failNextActions` | ✓ VERIFIED | `next-action` + target id; `failedCount()` asserted twice |
| `apps/web/e2e/admin.ts` | `feedPostLikeState`, `clearFeedPostLike` | ✓ VERIFIED | Scoped to one post id and one member e-mail (review confirmed) |
| `apps/web/e2e/feed.spec.ts` | self-restoring FEED-04, `double-tap-timing` | ✓ VERIFIED | Present and wired; gate green for the file |
| `apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx` | C-WR-03 regressions | ✓ VERIFIED | 396 lines; non-vacuous (red on `583619c^`) |
| `apps/web/turbo.json` | `typecheck.dependsOn ["^build","build"]` | ✓ VERIFIED | Dry-run graph confirmed |

### Key Link Verification (gap plans)

| From | To | Via | Status |
|------|----|-----|--------|
| `playwright.config.ts` | `e2e/hosts.ts` | `e2ePlatformHostname()` sets `process.env.PLATFORM_HOST` before webServer spawn | ✓ WIRED (warning observed) |
| `e2e/fixtures.ts` | `e2e/hosts.ts` | `export const hosts = e2eHosts()` | ✓ WIRED |
| `feed-comments.spec.ts` | `inicio/feed-actions.ts` | `next-action` header + post/comment id in `postData()` | ✓ WIRED |
| `feed.spec.ts` | `e2e/admin.ts` | `clearFeedPostLike` before login and in `finally`; `feedPostLikeState` after writes | ✓ WIRED |
| `NotificationsSurface.test.tsx` | `NotificationsSurface.tsx` | deferred `loadMoreNotificationsAction` / `refreshNotificationsAction` / read-all fetch | ✓ WIRED (red on pre-fix proves the link) |
| `apps/web/turbo.json` | root `turbo.json` | `extends ["//"]` + typecheck override | ✓ WIRED |
| root `package.json` `verify` | `apps/web/turbo.json` | `pnpm turbo typecheck build test` | ✓ WIRED |

### Data-Flow Trace (Level 4)

Unchanged from the previous report: the bell badge, chat counters, `/notificacoes` rows, thread bubbles and push banner all flow from DB queries. No product file changed.

### Behavioral Spot-Checks (run by the verifier)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| C-WR-03 regressions at HEAD | `pnpm exec vitest run "app/(app)/notificacoes/NotificationsSurface.test.tsx"` | 3 passed, 2 expected fail | ✓ PASS |
| Regressions are non-vacuous | same file importing a temporary copy of `583619c^`'s component (deleted afterwards) | cases 1 and 2 fail with the documented assertions; control passes | ✓ PASS |
| E04 loading / own read POST gaps | the two `it.fails` cases in the same run | both fail as expected, so the gaps are real at HEAD | ✗ (gap evidence) |
| Turbo ordering | `TURBO_CACHE=local:r pnpm turbo run typecheck build --filter=@rede-social/web --dry=json` | typecheck deps include `@rede-social/web#build`; build does not depend on typecheck | ✓ PASS |
| Harness host rule | `playwright test --list platform.spec.ts`, without and with `PLATFORM_HOST=other.localhost` | one value-free `[e2e]` warning without the export, none with it; 8 tests listed | ✓ PASS |
| Full exit gate | not re-run, by instruction; 07-15's single run at 6dbc035 | exit 1 at e2e (651/4/124/9), `e2e:pwa` not run | ✗ FAIL |

No server was started. Ports 3000, 3100, 8787 and 8788 had no listener afterwards. No `.env*` file was read, and no reset or seed ran.

### Probe Execution

No `scripts/*/tests/probe-*.sh` is declared or present. Step 7c does not apply.

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| NOTIF-01 | 07-01, 07-04, 07-05, 07-08, 07-11..07-13, 07-15 | ✓ SATISFIED | Truth 1 |
| NOTIF-02 | 07-01..07-04, 07-11..07-15 | ✗ BLOCKED (partial) | The bell, list and live count hold (truths 1 and 14). Two mark-as-read gaps: E04 loading (truth 12) and the tapped-row server state after a failed mark-all (truth 17). Its own e2e case `notifications.spec.ts:228` was red in the gate. |
| NOTIF-03 | 07-02, 07-06, 07-07, 07-11..07-13, 07-15 | ✓ SATISFIED (automated) / ? NEEDS HUMAN (device) | Truths 2 and 13 |
| NOTIF-04 | 07-01, 07-06, 07-11..07-13, 07-15 | ✓ SATISFIED | Truth 5 |
| EVENT-07 | 07-05, 07-11..07-13, 07-15 | ✓ SATISFIED | Truth 6 |
| PWA-02 | 07-02, 07-07, 07-11..07-13, 07-15 | ✓ SATISFIED (emulated) / ? NEEDS HUMAN (device) | Truth 13 |
| CHAT-01 | 07-08, 07-11..07-13, 07-15 | ✓ SATISFIED | Truth 7 |
| CHAT-02 | 07-02, 07-08, 07-09, 07-11..07-13, 07-15 | ✓ SATISFIED | Truth 3 |
| CHAT-03 | 07-02, 07-08, 07-10, 07-11..07-13, 07-15 | ✓ SATISFIED | Truth 3 |
| CHAT-04 | 07-08..07-13, 07-15 | ✓ SATISFIED | Truths 3 and 8 |
| CHAT-05 | 07-02, 07-08, 07-09, 07-11..07-13, 07-15 | ✓ SATISFIED | Truth 3 |

All 11 IDs are claimed by plans. REQUIREMENTS.md maps no other ID to Phase 7 (CHAT-06 and CHAT-07 are Phase 11). No requirement is orphaned. REQUIREMENTS.md still reads "Gaps Found" for all 11, which is consistent with this report.

### Prohibitions (flagged; non-authoritative LLM verdicts, human review recommended)

| Plan | Prohibition | LLM verdict | Basis |
|------|-------------|-------------|-------|
| 07-01 | Signals and logs never carry content | holds | Unchanged from the previous report |
| 07-02 | No prototype-less surface coded before its drawing is reviewed | holds | Unchanged |
| 07-04 | No excerpt of deleted content kept, shown or pushed | holds, with a recorded partial | Unchanged (chat has no delete path in V1) |
| 07-06 | Push copy never invents urgency or counts | holds | Unchanged |
| 07-07 | No permission prompt without a tap; no re-ask | holds | Unchanged |
| 07-07 | No pushes after logout or block | holds, with a residual | Unchanged (`?erro=sair` case) |
| 07-09 | Staff identity beyond the first name never shown | holds | Unchanged |
| 07-12 | The harness never prints, rewrites or regenerates an env-file value; an exported value wins | holds, with a caveat | The warning names only the harness host (observed). No write path exists. Caveat (WR-03): with `reuseExistingServer`, an already-running server keeps the file value while the warning claims otherwise. |
| 07-13 | A double tap on a not-liked post never sends an unlike; one double tap never sends more than one like request | holds on the evidence | 25 clean-start repeats in 07-13, plus the gate run. Caveat (WR-02): the count is read right after the first response. Product note: the feed double tap toggles by Phase 4 design, while Reels is like-only (D-128). |
| 07-14 | A failed mark-all never restores a tapped row's tint; a stale load-more never appends or adopts its cursor | holds in the UI | Cases 1-2 were red on the pre-fix component and green at HEAD. The tapped-row half is UI-only: the server keeps the row unread (truth 17). |
| 07-15 | The gate is never turned green by skipping, retrying, loosening, overriding or editing env files | holds | One run, recorded red. No override. No env file touched. 07-14's weaker disjunction is disclosed, with the planned assertion kept in `it.fails`. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| 8 gap-closure files | - | TBD/FIXME/XXX/TODO/HACK | none found | - |
| `NotificationsSurface.tsx` | 222-223 | Comment claims "its own keepalive POST really marked it read", which is false at HEAD | ⚠️ Warning | Misleads the next reader; part of truth 17 |
| `NotificationsSurface.test.tsx` | 290-304 | Green case certifies the UI-only "stays read" state (WR-04) | ⚠️ Warning | Masks truth 17 in the green suite |
| `NotificationsSurface.test.tsx` | 287-288 | `during === null \|\| during.disabled` (IN-03) | ℹ️ Info | Tighten with the E04 fix |
| `e2e/notifications.spec.ts` | 241-242 | Reload without awaiting the read-all response | ⚠️ Warning | Red 1 of the gate |
| `e2e/feed.spec.ts` | 68-78 | Hydration probe on React's private `__reactProps` key; passive-effect reset can still land after it (WR-01) | ⚠️ Warning | Narrowed race, not closed |
| `e2e/feed.spec.ts` | 446-447 | One-request count read after the first response (WR-02) | ⚠️ Warning | A late second toggle could slip through |
| `playwright.config.ts` | 40-49 | Warning is inaccurate when a server is reused (WR-03) | ⚠️ Warning | Misdirects diagnosis on a developer machine |
| `apps/web/turbo.json` | 14-16 | Typecheck now requires a full web build, including env validation (IN-06) | ℹ️ Info | Slower root typecheck; build errors hide type errors |

Note: the developer's `apps/web/.env.local` `PLATFORM_HOST` still differs from `rede-social.localhost`. The harness warning fired in the verifier's `--list` run, without showing the value. This matters only for a hand-run `next dev`.

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

The previous item "NotificationsSurface races (C-WR-03)" is closed: it is now automated (truth 14).

### Gaps Summary

The phase goal still holds in product code. Nothing under `packages/`, `supabase/` or the product parts of `apps/` changed since the previous report. The gap closure did what it set out to do: all four 07-11 gate items held in the 07-15 run, and the C-WR-03 races are now pinned by tests proven non-vacuous.

What keeps the phase at `gaps_found`, grouped by root cause:

1. **The mark-all lifecycle in `NotificationsSurface` (truths 12 and 17, and red 1 of truth 15).** The optimistic step withdraws the button, so it never shows busy (E04 loading). A row tapped during the request sends no read of its own. Nothing on screen waits for the read-all POST, and it has no keepalive, so the e2e reload aborted it. One small product change fixes the button, the tapped-row POST and probably `notifications.spec.ts:228`: keep the button mounted while `markingAll`, post `/read` on `view.unread` during a mark-all, and decide on keepalive. That change also flips both `it.fails` cases, and per WR-04/IN-03 the two loose assertions in case 2 should be tightened with it.
2. **Three e2e reds outside Phase 7 surfaces (rest of truth 15).**
   - 05.2 highlight sheets on mobile: `phase52-smoke:294` and `stories:1636`.
   - Phase 2 Marca save on desktop: `phase2-smoke:378`.
   No product file they exercise changed since they last passed, and the live layer issues no `router.refresh`. They need a `/gsd-debug` look at the kept traces to call each one a flake or a regression. `e2e:pwa` has not run since 07-11.
3. **Test-fixture hygiene (truth 20).** The UI-D-20 describe reuses its tenant slug across `--repeat-each` iterations. It does not affect the non-repeated gate.

Suggested route: one gap plan for (1), a debug pass for (2), and a one-line slug fix for (3). Then one consented `pnpm verify` re-run through `e2e:pwa`. As an alternative to fixing, the developer can weigh the overrides above.

---

_Verified: 2026-10-01T13:29:40Z_
_Verifier: Claude (gsd-verifier)_
