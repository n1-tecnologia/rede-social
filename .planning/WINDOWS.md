---
schema_version: 1
open_count: 36
waived_count: 0
fixed_count: 40
total_count: 76
last_updated: 2026-10-07T00:10:14.850Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | stub | apps/api/src/routes/me.ts |  | bootstrap returns modules: [] and permissions: [] until plan 01-06 fills them from tenant_modules | fixed |  | 2026-09-12T11:47:31.307Z | 2026-09-13T14:52:43.788Z |
| 2 | 01 | stub | apps/api/src/routes/me.ts |  | bootstrap counters are zero until Phase 7 (notifications/chat) | fixed |  | 2026-09-12T11:47:31.375Z | 2026-09-30T22:18:12.756Z |
| 3 | 01 | stub | apps/web/app/(auth)/entrar/page.tsx |  | Generic-host tenant hint waits for GET /v1/public/tenants/{slug} (plan 01-04); link shown, hint absent until then | fixed |  | 2026-09-12T13:28:27.502Z | 2026-09-13T14:03:19.772Z |
| 4 | 01 | stub | apps/web/app/(app)/layout.tsx |  | Only 401 handled in the bootstrap catch; 403 codes (MEMBERSHIP_BLOCKED/NO_MEMBERSHIP/TENANT_HOST_MISMATCH) rethrow until plan 01-05 | fixed |  | 2026-09-12T13:28:27.571Z | 2026-09-13T14:24:42.696Z |
| 5 | 01 | stub | packages/core/db/schema/chat-stubs.ts |  | Chat stub tables have no triggers, Realtime wiring or routes — intentional shape-only Foundation deliverable, resolved by Phase 7 | fixed |  | 2026-09-12T21:16:10.084Z | 2026-09-30T22:18:14.376Z |
| 6 | 01 | stub | packages/core/db/schema/notification-stubs.ts |  | notifications stub has no producer or fan-out worker — resolved by Phase 7 | fixed |  | 2026-09-12T21:16:10.151Z | 2026-09-30T22:18:15.848Z |
| 7 | 01 | unrun-verify | .github/workflows/ci.yml |  | ci.yml runs pnpm boundaries:negative (scripts/check-boundaries.sh) and supabase test db (supabase/tests/) which do not exist yet; both are owed by sibling plans in phase 01 | fixed |  | 2026-09-12T21:34:49.618Z | 2026-09-13T16:00:54.291Z |
| 8 | 01 | stub | apps/api/src/modules/registry.ts |  | MODULE_REGISTRY is empty until 01-07 registers @rede-social/module-example: bootstrap entries carry no nav, so /inicio lists raw module keys instead of labels | fixed |  | 2026-09-13T14:52:56.229Z | 2026-09-13T16:00:54.360Z |
| 9 | 01 | stub | packages/modules/example/module.ts |  | throwaway reference module @rede-social/module-example (D-19) — must be deleted with its table and registry entry in Phase 4 | fixed | removed in 04-10 (6f7631c refactor + 5e74cac drop migration); to_regclass('public.example_items') is NULL and tenant_modules has 0 'example' rows | 2026-09-13T15:21:32.750Z | 2026-09-23T06:10:00.000Z |
| 10 | 02 | stub | apps/web/app/(app)/configuracoes/page.tsx |  | Settings rows 'Editar perfil' and 'Notificações' are static placeholders with an 'Em breve' pill (D-42); Phase 3 wires profile edit, Phase 7 wires push | fixed |  | 2026-09-16T23:53:19.085Z | 2026-09-30T22:18:17.676Z |
| 11 | 03 | deviation | apps/web/app/(app)/perfil/page.tsx |  | The /perfil 'Membros' row points at /membros, which 03-05 lands in the next wave — a known one-wave dead link | fixed |  | 2026-09-22T00:37:02.401Z | 2026-09-22T01:40:51.643Z |
| 12 | 03 | unrun-verify | packages/core/server/media/video/mux.ts |  | The Mux adapter (createDirectUpload, webhooks.unwrap, signPlaybackId, assets.delete) is written and typed but has NEVER run against a real Mux account — no account exists and Phase 01.1 is deferred. Every proof in 03-06 runs against VIDEO_PROVIDER=fake. Closed by the docs/DEPLOY.md Phase 01.1 Mux runbook. | open |  | 2026-09-22T02:20:03.090Z |  |
| 13 | 03 | stub | packages/core/server/media/video/index.ts |  | videoProvider.signPlayback and getAsset are implemented on both adapters but wired to no route yet: 03-07 adds GET /v1/media/{assetId}/playback, and getAsset waits for a future reconciliation job (declared so that job needs no adapter change). | open |  | 2026-09-22T02:20:08.948Z |  |
| 14 | 03 | unrun-verify | apps/web/components/media/VideoPlayer.tsx |  | The poster/still half of the ready player has never rendered a real image. @mux/mux-player@3.13.4 only derives a thumbnail URL when the thumbnail token's decoded aud claim is 't'; the fake provider mints deterministic NON-JWT tokens, so every local and CI run exercises the 'no poster' branch and the frame's bg-bg-tertiary fallback. That a signed Mux thumbnail token really produces a still is only observable against a real account — closed by the docs/DEPLOY.md Phase 01.1 Mux runbook, alongside window 12. | open |  | 2026-09-22T03:32:56.929Z |  |
| 15 | 03 | unrun-verify | apps/web/e2e/phase3-smoke.spec.ts |  | Real-device HLS playback was never observed: the phase smoke proves the row reaches 'Pronto' and the player mounts with a credential under Playwright's bundled Chromium, which cannot stand in for iOS Safari's HLS stack. That a ready video actually plays, with a thumbnail, on a real iPhone (Safari) and a real Android device (Chrome) is annotated in the spec and recorded in docs/DEPLOY.md as blocked on Phase 01.1, alongside windows 12 and 14. | open |  | 2026-09-22T04:01:20.180Z |  |
| 16 | 04 | stub | packages/modules/feed/server/service.ts | 98 | viewerLiked is hard-false for every post; 04-03 adds the feed_likes join to the SAME statement | fixed |  | 2026-09-22T15:43:33.315Z | 2026-09-22T16:39:11.724Z |
| 17 | 04 | stub | packages/modules/feed/server/service.ts | 221 | post.published carries hasMedia: false; 04-04 sets it from media_kind once feed_post_media exists | fixed |  | 2026-09-22T15:43:33.390Z | 2026-09-22T19:22:02.240Z |
| 18 | 04 | stub | packages/modules/feed/ui/FeedList.tsx |  | The admin empty-state CTA renders only when the host passes createHref; 04-05 supplies it with /criar | fixed |  | 2026-09-22T15:43:33.463Z | 2026-09-23T03:43:30.108Z |
| 19 | 04 | unrun-verify | .planning/sketches/002-phase-04-designed-screens/index.html |  | D-33 / UI-04 design review of the six [designed] Phase 4 surfaces is unrun: the sketch README frontmatter is still status: pending / approved: false. 04-04, 04-05 and 04-09 code against it. | open |  | 2026-09-22T16:05:15.396Z |  |
| 20 | 04 | deviation | apps/api/tests/integration/media.test.ts |  | media.test.ts still sweeps EVERY Storage object under <tenant>/media/, so running the API suite leaves the seeded gallery posts with rows but no bytes — the cards then render MediaImage's neutral box. The DB rows are preserved (04-04 narrowed those deletes); the object sweep is not. | open |  | 2026-09-22T19:22:13.680Z |  |
| 21 | 04 | deviation | apps/web/e2e/admin.ts |  | deleteTenantVideoAssets is a TOTAL reset, so after media-video.spec.ts runs the rede-demo seeded video post keeps media_kind='video' with zero media rows until the next db:seed. feed-media.spec.ts reads the video case from rede-lab because of it. | open |  | 2026-09-22T19:22:13.761Z |  |
| 22 | 04 | deviation | apps/web/e2e/shell.spec.ts | 111 | PRE-EXISTING (04-01, not 04-04): shell.spec still expects the 'Em breve' card on rede-lab /inicio, but rede-lab has the feed module enabled since 04-01, so the feed home slot renders and HomeSlots never shows 'Em breve'. Fails deterministically on a fresh seed; feed.spec asserts the contradicting truth. | fixed |  | 2026-09-22T19:58:25.383Z | 2026-09-23T01:46:14.345Z |
| 23 | 04 | stub | packages/modules/feed/db/schema.ts |  | feed_link_previews.image_asset_id is null in V1 by decision — the preview card renders body-only; the image branch is grep-pinned but unexercised by any seeded or runtime row | open |  | 2026-09-23T01:14:50.647Z |  |
| 24 | 04 | unrun-verify | apps/web/e2e/feed.spec.ts |  | The >999 meta-row backstop (UI-SPEC E02 overflow/long-text) is pinned only as a STRING by packages/modules/feed/tests/meta.test.ts, never as pixels: supabase/tests/090-feed.sql reconciles every post's like_count against its live feed_likes rows, so a four-digit seeded count would need 1000+ auth users and a hand-written counter would turn that assertion red. The abbreviated row has never been rendered at 320px. | open |  | 2026-09-23T01:46:35.102Z |  |
| 25 | 04 | stub | apps/web/lib/registry.tsx | 162 | Viewer's optimistic comment row carries profileHref: null — the bootstrap has no membershipId; bounded to a pending row's lifetime, intentional | open |  | 2026-09-23T02:30:01.337Z |  |
| 26 | 04 | unrun-verify | apps/web/e2e/feed-share.spec.ts |  | Native OS share sheet on a real iPhone/Android is manual-only (outside the browser-automation boundary); carried as phase UAT coverage entry D6 | open |  | 2026-09-23T02:59:24.075Z |  |
| 27 | 04 | deviation | apps/web/app/(app)/criar/ComposerForm.tsx |  | Publishing within ~2s of the last photo upload can answer asset_not_usable: variant derivation runs in the worker and createPost requires an image to be 'ready' (04-04). The composer surfaces the refusal with copy but does not wait for readiness; the e2e waits explicitly. Close by either polling readiness in the composer or relaxing the image status rule (a 04-04 contract change). | open |  | 2026-09-23T03:43:45.531Z |  |
| 28 | 04 | deviation | .planning/sketches/002-phase-04-designed-screens/README.md |  | Sketch 002 (the D-33 gate for the composer, the edit screen, the FAB and the post menu) is still status: pending / approved: false. 04-09 coded against the drawing on the orchestrator's explicit instruction, with approval carried to phase UAT. | open |  | 2026-09-23T03:43:45.600Z |  |
| 29 | 04 | deviation | apps/web/app/(app)/criar/ComposerForm.tsx |  | Image reorder ships as two 44x44 move controls per tile instead of the mockup's drag grip: a pointer-only drag is unreachable by keyboard and unassertable in a spec. Same effect on the asset-id array. | open |  | 2026-09-23T03:43:45.669Z |  |
| 30 | 04 | deviation | apps/web/e2e/feed-composer.spec.ts | 125 | Times out inside a full pnpm verify (worker not draining kernel.media-derive-variants, processing=2); green alone in 6.4s and green on the second full gate run. Cross-spec ensureWorker interaction, same class as the platform-branding and feed.spec order-dependence already logged. | open |  | 2026-09-23T05:15:02.900Z |  |
| 31 | 05 | unrun-verify | .planning/phases/05-communities-stories/05-01-SUMMARY.md |  | 05-01 D12: the /comunidades empty, first-load-error and load-more-error states are implemented and typechecked but have no automated observation; 05-04 owns the same states | open |  | 2026-09-23T17:36:06.052Z |  |
| 32 | 05 | deviation | packages/modules/feed/db/schema.ts |  | feed_posts_community_fk is hand-written SQL in the migration, not a drizzle .references(): a module->module package dependency is denied by turbo.json's boundary allowlist (MOD-02). Two 05-03 acceptance greps are therefore unmet by design. | open |  | 2026-09-23T20:12:34.999Z |  |
| 33 | 05 | deviation | apps/web/e2e/media-video.spec.ts | 491 | Flaky under full-suite Playwright parallelism: the Next.js dev Console Error overlay is a second [role=dialog]. Root cause is an unhandledRejection in the SW registration path when Playwright blocks registration. Passes in isolation. | open |  | 2026-09-23T20:12:35.075Z |  |
| 34 | 05 | stub | apps/web/app/(app)/comunidades/[communityId]/page.tsx | 128 | The Destaques (pinned-story) slot on the community page is a null placeholder; 05-08 (STORY-04/D-68) fills it. The section and its SectionTitle are both absent while it is null, which is the correct empty rendering, so no member sees a broken surface. | open |  | 2026-09-23T21:21:16.622Z |  |
| 35 | 05 | stub | apps/web/components/stories/StoriesSurface.tsx |  | StoriesSurface binds no onOpen, so strip circles render as inert spans rather than buttons until 05-06 ships /stories/[storyId] | open |  | 2026-09-23T23:02:18.301Z |  |
| 36 | 05 | stub | apps/web/app/(app)/stories/publicar/page.tsx |  | The publish header's 'Seus stories' action points at /stories/meus, a route 05-08 creates; the link is inert until then | open |  | 2026-09-23T23:02:18.390Z |  |
| 37 | 05 | stub | apps/web/components/stories/StoryViewerHost.tsx |  | The viewer's Comentar control is rendered disabled: 05-07 binds CommentSheet to it and feeds the open sheet into StoryViewer's externallyPaused, which is wired and currently fed by nothing | fixed |  | 2026-09-24T00:38:56.005Z | 2026-09-24T01:55:05.376Z |
| 38 | 05 | deviation | apps/web/e2e/stories.spec.ts |  | The UI-SPEC overflow backstop states 25 progress segments at 320px; the strip is ONE page and STORY_PAGE_SIZE=10 caps it, so the e2e measures the real ceiling and the 25-segment DOM shape is pinned in story-viewer.test.tsx instead | open |  | 2026-09-24T00:38:56.078Z |  |
| 39 | 05 | deviation | package.json |  | pnpm verify had to re-seed between test:integration and e2e — the integration suite wipes storage.objects for the demo tenant's fixed-id assets | open |  | 2026-09-24T04:01:21.422Z |  |
| 40 | 05 | unrun-verify | apps/web/e2e/feed.spec.ts | 321 | the double-tap like is flaky under full-suite parallelism; passes in isolation (deferred-items.md #4) | open |  | 2026-09-24T04:01:21.500Z |  |
| 41 | 05 | unrun-verify | apps/web/e2e/stories.spec.ts |  | Browser-level gesture gate over the restructured story stage (CR-04 DOM move) is deferred to 05-11 Task 3; happy-dom cannot hit-test pointer-events-none | fixed |  | 2026-09-24T12:11:05.270Z | 2026-09-24T12:27:12.354Z |
| 42 | 05 | unrun-verify | apps/web/e2e/stories.spec.ts |  | No end-to-end case for VIDEO playback: the local provider is 'fake' with no HLS stream and the seed fixture is image-only, so an e2e would assert over a player that cannot play. 05-VERIFICATION human check 2 stays OPEN and is carried into 05-12's human-verification pack. | open |  | 2026-09-24T12:27:19.076Z |  |
| 43 | 05 | unrun-verify | .planning/phases/05-communities-stories/05-VERIFICATION-DEBT.md |  | 22 of Phase 5's 23 fail-closed verification items are still unresolved and now assembled in one dossier: 13 carried prohibitions (P-05-01..P-05-14 minus the converted P-05-10), 5 backstop visual claims needing a 320px viewport (B-05-01..B-05-05), the device half of H-05-01, and the error-copy tap hole under P-05-10/H-05-04. H-05-02 is tracked separately as entry 42. None may be folded into a passing verdict. | open |  | 2026-09-24T12:52:00.328Z |  |
| 44 | 05.2 | stub | apps/web/lib/story-view.ts | 346 | Inicio highlight circles are inert static spans (no accessible name, no onOpen) until plan 05.2-05 makes the viewer group-aware | fixed |  | 2026-09-25T21:56:21.623Z | 2026-09-25T22:30:47.123Z |
| 45 | 05.2 | stub | apps/web/components/stories/StoryViewerHost.tsx | 514 | The Destacar sheet's empty-state CTA links to /stories/destaques, which plan 05.2-09 creates; until then it resolves to the story deep link's not-found screen | fixed |  | 2026-09-25T22:53:35.615Z | 2026-09-26T00:20:16.618Z |
| 46 | 05.2 | stub | apps/web/app/(app)/stories/meus/StoryHistoryList.tsx | 450 | Highlight sheet empty-state CTA links to /stories/destaques, which plan 05.2-09 creates; until then it resolves to the not-found screen | fixed |  | 2026-09-25T23:10:22.646Z | 2026-09-26T00:20:16.686Z |
| 47 | 05.3 | stub | packages/modules/reels/package.json |  | @rede-social/module-reels exports ./ui -> ./ui/index.ts, which plan 05.3-05 creates; nothing imports it yet | fixed |  | 2026-09-26T19:02:52.627Z | 2026-09-26T20:36:02.619Z |
| 48 | 05.3 | unrun-verify | apps/web/e2e/reels.spec.ts |  | UI E04 populated (phone UAT, blocked until Phase 01.1): on an iPhone standalone PWA and Android Chrome the first video autoplays muted, sound stays on across swipes after 'Ativar som', a refused unmuted play falls back to muted with the icon flipped | open |  | 2026-09-26T22:42:29.269Z |  |
| 49 | 05.3 | unrun-verify | apps/web/e2e/reels.spec.ts |  | UI E03 populated (phone UAT, blocked until Phase 01.1): a diagonal swipe changes video or lane never both, two quick swipes never read as a double-tap like, a tap pauses after ~300 ms and a double tap likes without pausing | open |  | 2026-09-26T22:42:29.338Z |  |
| 50 | 05.3 | unrun-verify | apps/web/components/reels/ReelVideo.tsx |  | UI E04 loading (real Mux + phone UAT, blocked until Phase 01.1): swiping to a loaded video shows its first frame or poster with no black flash (neighbour pre-mount, token pre-mint); the fake provider cannot stream | open |  | 2026-09-26T22:42:29.407Z |  |
| 51 | 05.3 | unrun-verify | packages/modules/reels/ui/ReelRail.tsx |  | UI E06 populated (plan 04 lift, phone UAT, blocked until Phase 01.1): rail, caption and lane labels stay legible over a bright video frame, judged against sketch 005 | open |  | 2026-09-26T22:42:29.475Z |  |
| 52 | 6 | stub | apps/web/lib/events-view.ts |  | Poster href /eventos/{id} resolves to not-found until 06-03 adds the detail route | fixed |  | 2026-09-27T15:36:43.923Z | 2026-09-27T16:04:42.800Z |
| 53 | 6 | stub | apps/web/app/(app)/eventos/EventsList.tsx |  | Empty Próximos renders only the member body; manager body and Criar evento CTA arrive with 06-04 | fixed |  | 2026-09-27T15:36:43.992Z | 2026-09-27T18:46:11.297Z |
| 54 | quick-260929-g0s | unrun-verify | apps/web/e2e/invite.spec.ts |  | e2e not run (invite.spec, platform-tenants.spec, phase2-smoke, platform-domains.spec): local DB predates the 2026-09-28 rename (<old-brand>-* seed, <old-brand>_terms consent check) and no dev servers were up; needs pnpm db:reset + db:seed first | open |  | 2026-09-29T15:08:34.622Z |  |
| 55 | quick-260929-g0s | unrun-verify | apps/api/tests/integration/platform-domains.test.ts |  | platform-domains.test.ts and send-email-hook.test.ts (as committed) fail in beforeAll on the stale local seed; proven only through uncommitted copies pointed at <old-brand>-demo; re-run after pnpm db:reset + db:seed | open |  | 2026-09-29T15:08:34.703Z |  |
| 56 | 7 | stub | apps/web/lib/notifications-view.ts | 61 | Unknown notification kinds are filtered out instead of the generic row (07-04 replaces) | fixed |  | 2026-09-30T13:22:38.605Z | 2026-09-30T22:18:19.470Z |
| 57 | 7 | stub | apps/web/messages/pt-BR/notifications.json |  | notifications.navBadge ICU label not yet consumed by the shell bell (07-03 live counters) | fixed |  | 2026-09-30T13:22:38.678Z | 2026-09-30T14:07:37.060Z |
| 58 | 7 | stub | packages/modules/notifications/server/channels/registry.ts |  | push channel unregistered; intents log notifications.channel_unavailable (07-06 registers it) | fixed |  | 2026-09-30T13:22:38.756Z | 2026-09-30T22:18:21.624Z |
| 59 | 7 | unrun-verify | apps/web/e2e/phase2-smoke.spec.ts | 378 | 07-01 Task 3 verify: phase2-smoke case 1 fails on the platform host (env hosts still <old-brand>-*), cases 2-5 did not run | open |  | 2026-09-30T13:22:38.830Z |  |
| 60 | 7 | unrun-verify | apps/api/tests/integration/signup.test.ts | 142 | signup case 2 hardcodes rede-demo.localhost; 404 against the env's <old-brand>-demo host (pre-existing, recorded by 07-01) | fixed |  | 2026-09-30T13:22:38.902Z | 2026-09-30T23:28:25.028Z |
| 61 | 7 | unrun-verify | apps/web/e2e/events.spec.ts | 422 | 07-05 plan verification: events.spec 'events detalhe > ONE not-found screen' fails on both projects; the body names rede-demo.localhost instead of Rede Demo because env hosts are still <old-brand>-* (pre-existing, same cause as #59/#60) | fixed |  | 2026-09-30T17:54:09.150Z | 2026-09-30T23:28:25.108Z |
| 62 | 07 | stub | packages/modules/chat/module.ts |  | 07-08: the chat TopBar slot links to /suporte, which has no page until 07-09, and the member's unreadConversations still renders as a count badge (the dot for conversationsBadge='dot' is 07-09's UI) | fixed |  | 2026-09-30T19:34:23.332Z | 2026-09-30T20:21:31.863Z |
| 63 | 07 | stub | apps/web/app/(app)/suporte/page.tsx |  | 07-09: a holder of chat.support (staff) reaching /suporte gets the not-found screen until 07-10 swaps that branch for the staff inbox (UI-D-262/264) | fixed |  | 2026-09-30T20:21:31.933Z | 2026-09-30T21:03:55.638Z |
| 64 | 7 | unrun-verify | apps/web/e2e/feed.spec.ts | 321 | 07-11 exit gate: desktop 'a double tap on the gallery likes exactly ONCE' fails in both full pnpm verify runs (1/3 alone); the gesture fires unlikePostAction only; see deferred-items.md | fixed |  | 2026-10-01T00:21:23.999Z | 2026-10-02T13:24:54.833Z |
| 65 | 7 | unrun-verify | turbo.json |  | 07-11 exit gate: web typecheck (next typegen) races web build on apps/web/.next/types (ENOTEMPTY once); pre-existing pipeline race; see deferred-items.md | fixed |  | 2026-10-01T00:21:24.073Z | 2026-10-02T13:25:40.932Z |
| 66 | 07 | unmet-truth | apps/web/app/(app)/notificacoes/NotificationsSurface.tsx | 375 | UI E04 loading unreachable: mark-all clears every loaded row, so the anyUnread-gated button unmounts during its POST and is never aria-busy/disabled (UI-D-252 contradicts itself); pinned by it.fails 'gap E04 loading' in NotificationsSurface.test.tsx (07-14) | fixed |  | 2026-10-01T11:59:29.919Z | 2026-10-01T13:55:16.472Z |
| 67 | 07 | unmet-truth | apps/web/app/(app)/notificacoes/NotificationsSurface.tsx | 208 | A row tapped while mark-all is in flight sends no read POST (activate posts only while isUnread, and mark-all already cleared it), yet a failed mark-all keeps it read: UI read, server unread until next load; pinned by it.fails 'gap own read POST' (07-14) | fixed |  | 2026-10-01T11:59:29.990Z | 2026-10-01T13:55:16.546Z |
| 68 | 7 | unrun-verify | apps/web/e2e/notifications.spec.ts | 228 | 07-15 exit gate: mobile 'mark-all clears every tint' failed; reload 44 ms after the click aborted POST /api/notifications/read-all (no keepalive), Novas still shown; see deferred-items.md | fixed |  | 2026-10-01T13:15:19.797Z | 2026-10-01T13:55:16.627Z |
| 69 | 7 | unrun-verify | apps/web/e2e/phase52-smoke.spec.ts | 294 | 07-15 exit gate: mobile case 1 failed at line 255, the Novo destaque create sheet never opened after the click; cases 2-6 did not run; passed on desktop in the same run; see deferred-items.md | fixed |  | 2026-10-01T13:15:19.871Z | 2026-10-02T13:23:31.763Z |
| 70 | 7 | unrun-verify | apps/web/e2e/stories.spec.ts | 1636 | 07-15 exit gate: mobile Inicio manage case failed at line 1707, Escape did not close the Editar destaque sheet; see deferred-items.md | fixed |  | 2026-10-01T13:15:19.946Z | 2026-10-02T13:23:31.837Z |
| 71 | 7 | unrun-verify | apps/web/e2e/phase2-smoke.spec.ts | 532 | 07-15 exit gate: desktop case 1 timed out (300 s), Salvar alteracoes re-rendered disabled after #primary was filled (Marca rebrand); platform-host steps passed; desktop cases 2-5 did not run; see deferred-items.md | fixed |  | 2026-10-01T13:15:20.020Z | 2026-10-02T13:07:44.600Z |
| 72 | 8 | unrun-verify | apps/web/e2e/media-video.spec.ts | 461 | 08-12 exit gate: pnpm verify red at e2e: 'the list polls while a row is processing and, after five minutes, stops and offers Atualizar' failed on mobile and desktop (Atualizar never visible); reproduces with the whole file (2/2), green alone (2/2); e2e:pwa did not run; see 08 deferred-items.md | open |  | 2026-10-02T20:40:39.988Z |  |
| 73 | 08.1 | deviation | apps/web/e2e/blocked.spec.ts | 51 | AUTH-06 blocked spec step 3 page.goto aborts intermittently (ERR_ABORTED): the open Inicio page's playback-token action redirects on the 403 at the same moment; pre-08.1 race, see 08.1 deferred-items.md | open |  | 2026-10-06T20:35:04.152Z |  |
| 74 | 08.1 | deviation | apps/web/components/admin/DisplayNameCard.test.tsx | 55 | web typecheck red on DisplayNameCard.test.tsx and BrandingForm.test.tsx (BrandingView.look missing since b357507); 08.1-02 Task 1 verify could not exit 0 on tsc | fixed |  | 2026-10-06T20:56:02.275Z | 2026-10-06T20:59:39.258Z |
| 75 | 08.1 | deviation | apps/web/app/(auth)/participar/actions.ts |  | participar join redirects to /auth/blocked and /auth/suspended from a server action; the handler's sign-out does not stick, so the B-origin session survives (fixed for joinFromSignup in 08.1-02) | fixed |  | 2026-10-06T20:56:02.347Z | 2026-10-06T21:26:34.387Z |
| 76 | 08.1 | unrun-verify | apps/web/e2e/csp.spec.ts | 114 | 08.1-07 release-1 gate: pnpm verify stops at e2e; csp.spec (tracer, refreshed session), admin-branding E12 and platform-wizard:164 fail on FRONT-PENDENCIAS copy and markup drift (f18d1af); e2e 797/805, e2e:pwa 58/64 | open |  | 2026-10-07T00:10:14.850Z |  |

````json
[
  {
    "id": 1,
    "kind": "stub",
    "phase": "01",
    "file": "apps/api/src/routes/me.ts",
    "line": null,
    "description": "bootstrap returns modules: [] and permissions: [] until plan 01-06 fills them from tenant_modules",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-12T11:47:31.307Z",
    "resolved_at": "2026-09-13T14:52:43.788Z"
  },
  {
    "id": 2,
    "kind": "stub",
    "phase": "01",
    "file": "apps/api/src/routes/me.ts",
    "line": null,
    "description": "bootstrap counters are zero until Phase 7 (notifications/chat)",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-12T11:47:31.375Z",
    "resolved_at": "2026-09-30T22:18:12.756Z"
  },
  {
    "id": 3,
    "kind": "stub",
    "phase": "01",
    "file": "apps/web/app/(auth)/entrar/page.tsx",
    "line": null,
    "description": "Generic-host tenant hint waits for GET /v1/public/tenants/{slug} (plan 01-04); link shown, hint absent until then",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-12T13:28:27.502Z",
    "resolved_at": "2026-09-13T14:03:19.772Z"
  },
  {
    "id": 4,
    "kind": "stub",
    "phase": "01",
    "file": "apps/web/app/(app)/layout.tsx",
    "line": null,
    "description": "Only 401 handled in the bootstrap catch; 403 codes (MEMBERSHIP_BLOCKED/NO_MEMBERSHIP/TENANT_HOST_MISMATCH) rethrow until plan 01-05",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-12T13:28:27.571Z",
    "resolved_at": "2026-09-13T14:24:42.696Z"
  },
  {
    "id": 5,
    "kind": "stub",
    "phase": "01",
    "file": "packages/core/db/schema/chat-stubs.ts",
    "line": null,
    "description": "Chat stub tables have no triggers, Realtime wiring or routes — intentional shape-only Foundation deliverable, resolved by Phase 7",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-12T21:16:10.084Z",
    "resolved_at": "2026-09-30T22:18:14.376Z"
  },
  {
    "id": 6,
    "kind": "stub",
    "phase": "01",
    "file": "packages/core/db/schema/notification-stubs.ts",
    "line": null,
    "description": "notifications stub has no producer or fan-out worker — resolved by Phase 7",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-12T21:16:10.151Z",
    "resolved_at": "2026-09-30T22:18:15.848Z"
  },
  {
    "id": 7,
    "kind": "unrun-verify",
    "phase": "01",
    "file": ".github/workflows/ci.yml",
    "line": null,
    "description": "ci.yml runs pnpm boundaries:negative (scripts/check-boundaries.sh) and supabase test db (supabase/tests/) which do not exist yet; both are owed by sibling plans in phase 01",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-12T21:34:49.618Z",
    "resolved_at": "2026-09-13T16:00:54.291Z"
  },
  {
    "id": 8,
    "kind": "stub",
    "phase": "01",
    "file": "apps/api/src/modules/registry.ts",
    "line": null,
    "description": "MODULE_REGISTRY is empty until 01-07 registers @rede-social/module-example: bootstrap entries carry no nav, so /inicio lists raw module keys instead of labels",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-13T14:52:56.229Z",
    "resolved_at": "2026-09-13T16:00:54.360Z"
  },
  {
    "id": 9,
    "kind": "stub",
    "phase": "01",
    "file": "packages/modules/example/module.ts",
    "line": null,
    "description": "throwaway reference module @rede-social/module-example (D-19) — must be deleted with its table and registry entry in Phase 4",
    "status": "fixed",
    "reason": "removed in 04-10 (6f7631c refactor + 5e74cac drop migration); to_regclass('public.example_items') is NULL and tenant_modules has 0 'example' rows",
    "recorded_at": "2026-09-13T15:21:32.750Z",
    "resolved_at": "2026-09-23T06:10:00.000Z"
  },
  {
    "id": 10,
    "kind": "stub",
    "phase": "02",
    "file": "apps/web/app/(app)/configuracoes/page.tsx",
    "line": null,
    "description": "Settings rows 'Editar perfil' and 'Notificações' are static placeholders with an 'Em breve' pill (D-42); Phase 3 wires profile edit, Phase 7 wires push",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-16T23:53:19.085Z",
    "resolved_at": "2026-09-30T22:18:17.676Z"
  },
  {
    "id": 11,
    "kind": "deviation",
    "phase": "03",
    "file": "apps/web/app/(app)/perfil/page.tsx",
    "line": null,
    "description": "The /perfil 'Membros' row points at /membros, which 03-05 lands in the next wave — a known one-wave dead link",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-22T00:37:02.401Z",
    "resolved_at": "2026-09-22T01:40:51.643Z"
  },
  {
    "id": 12,
    "kind": "unrun-verify",
    "phase": "03",
    "file": "packages/core/server/media/video/mux.ts",
    "line": null,
    "description": "The Mux adapter (createDirectUpload, webhooks.unwrap, signPlaybackId, assets.delete) is written and typed but has NEVER run against a real Mux account — no account exists and Phase 01.1 is deferred. Every proof in 03-06 runs against VIDEO_PROVIDER=fake. Closed by the docs/DEPLOY.md Phase 01.1 Mux runbook.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-22T02:20:03.090Z",
    "resolved_at": null
  },
  {
    "id": 13,
    "kind": "stub",
    "phase": "03",
    "file": "packages/core/server/media/video/index.ts",
    "line": null,
    "description": "videoProvider.signPlayback and getAsset are implemented on both adapters but wired to no route yet: 03-07 adds GET /v1/media/{assetId}/playback, and getAsset waits for a future reconciliation job (declared so that job needs no adapter change).",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-22T02:20:08.948Z",
    "resolved_at": null
  },
  {
    "id": 14,
    "kind": "unrun-verify",
    "phase": "03",
    "file": "apps/web/components/media/VideoPlayer.tsx",
    "line": null,
    "description": "The poster/still half of the ready player has never rendered a real image. @mux/mux-player@3.13.4 only derives a thumbnail URL when the thumbnail token's decoded aud claim is 't'; the fake provider mints deterministic NON-JWT tokens, so every local and CI run exercises the 'no poster' branch and the frame's bg-bg-tertiary fallback. That a signed Mux thumbnail token really produces a still is only observable against a real account — closed by the docs/DEPLOY.md Phase 01.1 Mux runbook, alongside window 12.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-22T03:32:56.929Z",
    "resolved_at": null
  },
  {
    "id": 15,
    "kind": "unrun-verify",
    "phase": "03",
    "file": "apps/web/e2e/phase3-smoke.spec.ts",
    "line": null,
    "description": "Real-device HLS playback was never observed: the phase smoke proves the row reaches 'Pronto' and the player mounts with a credential under Playwright's bundled Chromium, which cannot stand in for iOS Safari's HLS stack. That a ready video actually plays, with a thumbnail, on a real iPhone (Safari) and a real Android device (Chrome) is annotated in the spec and recorded in docs/DEPLOY.md as blocked on Phase 01.1, alongside windows 12 and 14.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-22T04:01:20.180Z",
    "resolved_at": null
  },
  {
    "id": 16,
    "kind": "stub",
    "phase": "04",
    "file": "packages/modules/feed/server/service.ts",
    "line": 98,
    "description": "viewerLiked is hard-false for every post; 04-03 adds the feed_likes join to the SAME statement",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-22T15:43:33.315Z",
    "resolved_at": "2026-09-22T16:39:11.724Z"
  },
  {
    "id": 17,
    "kind": "stub",
    "phase": "04",
    "file": "packages/modules/feed/server/service.ts",
    "line": 221,
    "description": "post.published carries hasMedia: false; 04-04 sets it from media_kind once feed_post_media exists",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-22T15:43:33.390Z",
    "resolved_at": "2026-09-22T19:22:02.240Z"
  },
  {
    "id": 18,
    "kind": "stub",
    "phase": "04",
    "file": "packages/modules/feed/ui/FeedList.tsx",
    "line": null,
    "description": "The admin empty-state CTA renders only when the host passes createHref; 04-05 supplies it with /criar",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-22T15:43:33.463Z",
    "resolved_at": "2026-09-23T03:43:30.108Z"
  },
  {
    "id": 19,
    "kind": "unrun-verify",
    "phase": "04",
    "file": ".planning/sketches/002-phase-04-designed-screens/index.html",
    "line": null,
    "description": "D-33 / UI-04 design review of the six [designed] Phase 4 surfaces is unrun: the sketch README frontmatter is still status: pending / approved: false. 04-04, 04-05 and 04-09 code against it.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-22T16:05:15.396Z",
    "resolved_at": null
  },
  {
    "id": 20,
    "kind": "deviation",
    "phase": "04",
    "file": "apps/api/tests/integration/media.test.ts",
    "line": null,
    "description": "media.test.ts still sweeps EVERY Storage object under <tenant>/media/, so running the API suite leaves the seeded gallery posts with rows but no bytes — the cards then render MediaImage's neutral box. The DB rows are preserved (04-04 narrowed those deletes); the object sweep is not.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-22T19:22:13.680Z",
    "resolved_at": null
  },
  {
    "id": 21,
    "kind": "deviation",
    "phase": "04",
    "file": "apps/web/e2e/admin.ts",
    "line": null,
    "description": "deleteTenantVideoAssets is a TOTAL reset, so after media-video.spec.ts runs the rede-demo seeded video post keeps media_kind='video' with zero media rows until the next db:seed. feed-media.spec.ts reads the video case from rede-lab because of it.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-22T19:22:13.761Z",
    "resolved_at": null
  },
  {
    "id": 22,
    "kind": "deviation",
    "phase": "04",
    "file": "apps/web/e2e/shell.spec.ts",
    "line": 111,
    "description": "PRE-EXISTING (04-01, not 04-04): shell.spec still expects the 'Em breve' card on rede-lab /inicio, but rede-lab has the feed module enabled since 04-01, so the feed home slot renders and HomeSlots never shows 'Em breve'. Fails deterministically on a fresh seed; feed.spec asserts the contradicting truth.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-22T19:58:25.383Z",
    "resolved_at": "2026-09-23T01:46:14.345Z"
  },
  {
    "id": 23,
    "kind": "stub",
    "phase": "04",
    "file": "packages/modules/feed/db/schema.ts",
    "line": null,
    "description": "feed_link_previews.image_asset_id is null in V1 by decision — the preview card renders body-only; the image branch is grep-pinned but unexercised by any seeded or runtime row",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-23T01:14:50.647Z",
    "resolved_at": null
  },
  {
    "id": 24,
    "kind": "unrun-verify",
    "phase": "04",
    "file": "apps/web/e2e/feed.spec.ts",
    "line": null,
    "description": "The >999 meta-row backstop (UI-SPEC E02 overflow/long-text) is pinned only as a STRING by packages/modules/feed/tests/meta.test.ts, never as pixels: supabase/tests/090-feed.sql reconciles every post's like_count against its live feed_likes rows, so a four-digit seeded count would need 1000+ auth users and a hand-written counter would turn that assertion red. The abbreviated row has never been rendered at 320px.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-23T01:46:35.102Z",
    "resolved_at": null
  },
  {
    "id": 25,
    "kind": "stub",
    "phase": "04",
    "file": "apps/web/lib/registry.tsx",
    "line": 162,
    "description": "Viewer's optimistic comment row carries profileHref: null — the bootstrap has no membershipId; bounded to a pending row's lifetime, intentional",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-23T02:30:01.337Z",
    "resolved_at": null
  },
  {
    "id": 26,
    "kind": "unrun-verify",
    "phase": "04",
    "file": "apps/web/e2e/feed-share.spec.ts",
    "line": null,
    "description": "Native OS share sheet on a real iPhone/Android is manual-only (outside the browser-automation boundary); carried as phase UAT coverage entry D6",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-23T02:59:24.075Z",
    "resolved_at": null
  },
  {
    "id": 27,
    "kind": "deviation",
    "phase": "04",
    "file": "apps/web/app/(app)/criar/ComposerForm.tsx",
    "line": null,
    "description": "Publishing within ~2s of the last photo upload can answer asset_not_usable: variant derivation runs in the worker and createPost requires an image to be 'ready' (04-04). The composer surfaces the refusal with copy but does not wait for readiness; the e2e waits explicitly. Close by either polling readiness in the composer or relaxing the image status rule (a 04-04 contract change).",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-23T03:43:45.531Z",
    "resolved_at": null
  },
  {
    "id": 28,
    "kind": "deviation",
    "phase": "04",
    "file": ".planning/sketches/002-phase-04-designed-screens/README.md",
    "line": null,
    "description": "Sketch 002 (the D-33 gate for the composer, the edit screen, the FAB and the post menu) is still status: pending / approved: false. 04-09 coded against the drawing on the orchestrator's explicit instruction, with approval carried to phase UAT.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-23T03:43:45.600Z",
    "resolved_at": null
  },
  {
    "id": 29,
    "kind": "deviation",
    "phase": "04",
    "file": "apps/web/app/(app)/criar/ComposerForm.tsx",
    "line": null,
    "description": "Image reorder ships as two 44x44 move controls per tile instead of the mockup's drag grip: a pointer-only drag is unreachable by keyboard and unassertable in a spec. Same effect on the asset-id array.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-23T03:43:45.669Z",
    "resolved_at": null
  },
  {
    "id": 30,
    "kind": "deviation",
    "phase": "04",
    "file": "apps/web/e2e/feed-composer.spec.ts",
    "line": 125,
    "description": "Times out inside a full pnpm verify (worker not draining kernel.media-derive-variants, processing=2); green alone in 6.4s and green on the second full gate run. Cross-spec ensureWorker interaction, same class as the platform-branding and feed.spec order-dependence already logged.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-23T05:15:02.900Z",
    "resolved_at": null
  },
  {
    "id": 31,
    "kind": "unrun-verify",
    "phase": "05",
    "file": ".planning/phases/05-communities-stories/05-01-SUMMARY.md",
    "line": null,
    "description": "05-01 D12: the /comunidades empty, first-load-error and load-more-error states are implemented and typechecked but have no automated observation; 05-04 owns the same states",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-23T17:36:06.052Z",
    "resolved_at": null
  },
  {
    "id": 32,
    "kind": "deviation",
    "phase": "05",
    "file": "packages/modules/feed/db/schema.ts",
    "line": null,
    "description": "feed_posts_community_fk is hand-written SQL in the migration, not a drizzle .references(): a module->module package dependency is denied by turbo.json's boundary allowlist (MOD-02). Two 05-03 acceptance greps are therefore unmet by design.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-23T20:12:34.999Z",
    "resolved_at": null
  },
  {
    "id": 33,
    "kind": "deviation",
    "phase": "05",
    "file": "apps/web/e2e/media-video.spec.ts",
    "line": 491,
    "description": "Flaky under full-suite Playwright parallelism: the Next.js dev Console Error overlay is a second [role=dialog]. Root cause is an unhandledRejection in the SW registration path when Playwright blocks registration. Passes in isolation.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-23T20:12:35.075Z",
    "resolved_at": null
  },
  {
    "id": 34,
    "kind": "stub",
    "phase": "05",
    "file": "apps/web/app/(app)/comunidades/[communityId]/page.tsx",
    "line": 128,
    "description": "The Destaques (pinned-story) slot on the community page is a null placeholder; 05-08 (STORY-04/D-68) fills it. The section and its SectionTitle are both absent while it is null, which is the correct empty rendering, so no member sees a broken surface.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-23T21:21:16.622Z",
    "resolved_at": null
  },
  {
    "id": 35,
    "kind": "stub",
    "phase": "05",
    "file": "apps/web/components/stories/StoriesSurface.tsx",
    "line": null,
    "description": "StoriesSurface binds no onOpen, so strip circles render as inert spans rather than buttons until 05-06 ships /stories/[storyId]",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-23T23:02:18.301Z",
    "resolved_at": null
  },
  {
    "id": 36,
    "kind": "stub",
    "phase": "05",
    "file": "apps/web/app/(app)/stories/publicar/page.tsx",
    "line": null,
    "description": "The publish header's 'Seus stories' action points at /stories/meus, a route 05-08 creates; the link is inert until then",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-23T23:02:18.390Z",
    "resolved_at": null
  },
  {
    "id": 37,
    "kind": "stub",
    "phase": "05",
    "file": "apps/web/components/stories/StoryViewerHost.tsx",
    "line": null,
    "description": "The viewer's Comentar control is rendered disabled: 05-07 binds CommentSheet to it and feeds the open sheet into StoryViewer's externallyPaused, which is wired and currently fed by nothing",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-24T00:38:56.005Z",
    "resolved_at": "2026-09-24T01:55:05.376Z"
  },
  {
    "id": 38,
    "kind": "deviation",
    "phase": "05",
    "file": "apps/web/e2e/stories.spec.ts",
    "line": null,
    "description": "The UI-SPEC overflow backstop states 25 progress segments at 320px; the strip is ONE page and STORY_PAGE_SIZE=10 caps it, so the e2e measures the real ceiling and the 25-segment DOM shape is pinned in story-viewer.test.tsx instead",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-24T00:38:56.078Z",
    "resolved_at": null
  },
  {
    "id": 39,
    "kind": "deviation",
    "phase": "05",
    "file": "package.json",
    "line": null,
    "description": "pnpm verify had to re-seed between test:integration and e2e — the integration suite wipes storage.objects for the demo tenant's fixed-id assets",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-24T04:01:21.422Z",
    "resolved_at": null
  },
  {
    "id": 40,
    "kind": "unrun-verify",
    "phase": "05",
    "file": "apps/web/e2e/feed.spec.ts",
    "line": 321,
    "description": "the double-tap like is flaky under full-suite parallelism; passes in isolation (deferred-items.md #4)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-24T04:01:21.500Z",
    "resolved_at": null
  },
  {
    "id": 41,
    "kind": "unrun-verify",
    "phase": "05",
    "file": "apps/web/e2e/stories.spec.ts",
    "line": null,
    "description": "Browser-level gesture gate over the restructured story stage (CR-04 DOM move) is deferred to 05-11 Task 3; happy-dom cannot hit-test pointer-events-none",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-24T12:11:05.270Z",
    "resolved_at": "2026-09-24T12:27:12.354Z"
  },
  {
    "id": 42,
    "kind": "unrun-verify",
    "phase": "05",
    "file": "apps/web/e2e/stories.spec.ts",
    "line": null,
    "description": "No end-to-end case for VIDEO playback: the local provider is 'fake' with no HLS stream and the seed fixture is image-only, so an e2e would assert over a player that cannot play. 05-VERIFICATION human check 2 stays OPEN and is carried into 05-12's human-verification pack.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-24T12:27:19.076Z",
    "resolved_at": null
  },
  {
    "id": 43,
    "kind": "unrun-verify",
    "phase": "05",
    "file": ".planning/phases/05-communities-stories/05-VERIFICATION-DEBT.md",
    "line": null,
    "description": "22 of Phase 5's 23 fail-closed verification items are still unresolved and now assembled in one dossier: 13 carried prohibitions (P-05-01..P-05-14 minus the converted P-05-10), 5 backstop visual claims needing a 320px viewport (B-05-01..B-05-05), the device half of H-05-01, and the error-copy tap hole under P-05-10/H-05-04. H-05-02 is tracked separately as entry 42. None may be folded into a passing verdict.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-24T12:52:00.328Z",
    "resolved_at": null
  },
  {
    "id": 44,
    "kind": "stub",
    "phase": "05.2",
    "file": "apps/web/lib/story-view.ts",
    "line": 346,
    "description": "Inicio highlight circles are inert static spans (no accessible name, no onOpen) until plan 05.2-05 makes the viewer group-aware",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-25T21:56:21.623Z",
    "resolved_at": "2026-09-25T22:30:47.123Z"
  },
  {
    "id": 45,
    "kind": "stub",
    "phase": "05.2",
    "file": "apps/web/components/stories/StoryViewerHost.tsx",
    "line": 514,
    "description": "The Destacar sheet's empty-state CTA links to /stories/destaques, which plan 05.2-09 creates; until then it resolves to the story deep link's not-found screen",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-25T22:53:35.615Z",
    "resolved_at": "2026-09-26T00:20:16.618Z"
  },
  {
    "id": 46,
    "kind": "stub",
    "phase": "05.2",
    "file": "apps/web/app/(app)/stories/meus/StoryHistoryList.tsx",
    "line": 450,
    "description": "Highlight sheet empty-state CTA links to /stories/destaques, which plan 05.2-09 creates; until then it resolves to the not-found screen",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-25T23:10:22.646Z",
    "resolved_at": "2026-09-26T00:20:16.686Z"
  },
  {
    "id": 47,
    "kind": "stub",
    "phase": "05.3",
    "file": "packages/modules/reels/package.json",
    "line": null,
    "description": "@rede-social/module-reels exports ./ui -> ./ui/index.ts, which plan 05.3-05 creates; nothing imports it yet",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-26T19:02:52.627Z",
    "resolved_at": "2026-09-26T20:36:02.619Z"
  },
  {
    "id": 48,
    "kind": "unrun-verify",
    "phase": "05.3",
    "file": "apps/web/e2e/reels.spec.ts",
    "line": null,
    "description": "UI E04 populated (phone UAT, blocked until Phase 01.1): on an iPhone standalone PWA and Android Chrome the first video autoplays muted, sound stays on across swipes after 'Ativar som', a refused unmuted play falls back to muted with the icon flipped",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-26T22:42:29.269Z",
    "resolved_at": null
  },
  {
    "id": 49,
    "kind": "unrun-verify",
    "phase": "05.3",
    "file": "apps/web/e2e/reels.spec.ts",
    "line": null,
    "description": "UI E03 populated (phone UAT, blocked until Phase 01.1): a diagonal swipe changes video or lane never both, two quick swipes never read as a double-tap like, a tap pauses after ~300 ms and a double tap likes without pausing",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-26T22:42:29.338Z",
    "resolved_at": null
  },
  {
    "id": 50,
    "kind": "unrun-verify",
    "phase": "05.3",
    "file": "apps/web/components/reels/ReelVideo.tsx",
    "line": null,
    "description": "UI E04 loading (real Mux + phone UAT, blocked until Phase 01.1): swiping to a loaded video shows its first frame or poster with no black flash (neighbour pre-mount, token pre-mint); the fake provider cannot stream",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-26T22:42:29.407Z",
    "resolved_at": null
  },
  {
    "id": 51,
    "kind": "unrun-verify",
    "phase": "05.3",
    "file": "packages/modules/reels/ui/ReelRail.tsx",
    "line": null,
    "description": "UI E06 populated (plan 04 lift, phone UAT, blocked until Phase 01.1): rail, caption and lane labels stay legible over a bright video frame, judged against sketch 005",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-26T22:42:29.475Z",
    "resolved_at": null
  },
  {
    "id": 52,
    "kind": "stub",
    "phase": "6",
    "file": "apps/web/lib/events-view.ts",
    "line": null,
    "description": "Poster href /eventos/{id} resolves to not-found until 06-03 adds the detail route",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-27T15:36:43.923Z",
    "resolved_at": "2026-09-27T16:04:42.800Z"
  },
  {
    "id": 53,
    "kind": "stub",
    "phase": "6",
    "file": "apps/web/app/(app)/eventos/EventsList.tsx",
    "line": null,
    "description": "Empty Próximos renders only the member body; manager body and Criar evento CTA arrive with 06-04",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-27T15:36:43.992Z",
    "resolved_at": "2026-09-27T18:46:11.297Z"
  },
  {
    "id": 54,
    "kind": "unrun-verify",
    "phase": "quick-260929-g0s",
    "file": "apps/web/e2e/invite.spec.ts",
    "line": null,
    "description": "e2e not run (invite.spec, platform-tenants.spec, phase2-smoke, platform-domains.spec): local DB predates the 2026-09-28 rename (<old-brand>-* seed, <old-brand>_terms consent check) and no dev servers were up; needs pnpm db:reset + db:seed first",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-29T15:08:34.622Z",
    "resolved_at": null
  },
  {
    "id": 55,
    "kind": "unrun-verify",
    "phase": "quick-260929-g0s",
    "file": "apps/api/tests/integration/platform-domains.test.ts",
    "line": null,
    "description": "platform-domains.test.ts and send-email-hook.test.ts (as committed) fail in beforeAll on the stale local seed; proven only through uncommitted copies pointed at <old-brand>-demo; re-run after pnpm db:reset + db:seed",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-29T15:08:34.703Z",
    "resolved_at": null
  },
  {
    "id": 56,
    "kind": "stub",
    "phase": "7",
    "file": "apps/web/lib/notifications-view.ts",
    "line": 61,
    "description": "Unknown notification kinds are filtered out instead of the generic row (07-04 replaces)",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-30T13:22:38.605Z",
    "resolved_at": "2026-09-30T22:18:19.470Z"
  },
  {
    "id": 57,
    "kind": "stub",
    "phase": "7",
    "file": "apps/web/messages/pt-BR/notifications.json",
    "line": null,
    "description": "notifications.navBadge ICU label not yet consumed by the shell bell (07-03 live counters)",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-30T13:22:38.678Z",
    "resolved_at": "2026-09-30T14:07:37.060Z"
  },
  {
    "id": 58,
    "kind": "stub",
    "phase": "7",
    "file": "packages/modules/notifications/server/channels/registry.ts",
    "line": null,
    "description": "push channel unregistered; intents log notifications.channel_unavailable (07-06 registers it)",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-30T13:22:38.756Z",
    "resolved_at": "2026-09-30T22:18:21.624Z"
  },
  {
    "id": 59,
    "kind": "unrun-verify",
    "phase": "7",
    "file": "apps/web/e2e/phase2-smoke.spec.ts",
    "line": 378,
    "description": "07-01 Task 3 verify: phase2-smoke case 1 fails on the platform host (env hosts still <old-brand>-*), cases 2-5 did not run",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-30T13:22:38.830Z",
    "resolved_at": null
  },
  {
    "id": 60,
    "kind": "unrun-verify",
    "phase": "7",
    "file": "apps/api/tests/integration/signup.test.ts",
    "line": 142,
    "description": "signup case 2 hardcodes rede-demo.localhost; 404 against the env's <old-brand>-demo host (pre-existing, recorded by 07-01)",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-30T13:22:38.902Z",
    "resolved_at": "2026-09-30T23:28:25.028Z"
  },
  {
    "id": 61,
    "kind": "unrun-verify",
    "phase": "7",
    "file": "apps/web/e2e/events.spec.ts",
    "line": 422,
    "description": "07-05 plan verification: events.spec 'events detalhe > ONE not-found screen' fails on both projects; the body names rede-demo.localhost instead of Rede Demo because env hosts are still <old-brand>-* (pre-existing, same cause as #59/#60)",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-30T17:54:09.150Z",
    "resolved_at": "2026-09-30T23:28:25.108Z"
  },
  {
    "id": 62,
    "kind": "stub",
    "phase": "07",
    "file": "packages/modules/chat/module.ts",
    "line": null,
    "description": "07-08: the chat TopBar slot links to /suporte, which has no page until 07-09, and the member's unreadConversations still renders as a count badge (the dot for conversationsBadge='dot' is 07-09's UI)",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-30T19:34:23.332Z",
    "resolved_at": "2026-09-30T20:21:31.863Z"
  },
  {
    "id": 63,
    "kind": "stub",
    "phase": "07",
    "file": "apps/web/app/(app)/suporte/page.tsx",
    "line": null,
    "description": "07-09: a holder of chat.support (staff) reaching /suporte gets the not-found screen until 07-10 swaps that branch for the staff inbox (UI-D-262/264)",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-30T20:21:31.933Z",
    "resolved_at": "2026-09-30T21:03:55.638Z"
  },
  {
    "id": 64,
    "kind": "unrun-verify",
    "phase": "7",
    "file": "apps/web/e2e/feed.spec.ts",
    "line": 321,
    "description": "07-11 exit gate: desktop 'a double tap on the gallery likes exactly ONCE' fails in both full pnpm verify runs (1/3 alone); the gesture fires unlikePostAction only; see deferred-items.md",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-01T00:21:23.999Z",
    "resolved_at": "2026-10-02T13:24:54.833Z"
  },
  {
    "id": 65,
    "kind": "unrun-verify",
    "phase": "7",
    "file": "turbo.json",
    "line": null,
    "description": "07-11 exit gate: web typecheck (next typegen) races web build on apps/web/.next/types (ENOTEMPTY once); pre-existing pipeline race; see deferred-items.md",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-01T00:21:24.073Z",
    "resolved_at": "2026-10-02T13:25:40.932Z"
  },
  {
    "id": 66,
    "kind": "unmet-truth",
    "phase": "07",
    "file": "apps/web/app/(app)/notificacoes/NotificationsSurface.tsx",
    "line": 375,
    "description": "UI E04 loading unreachable: mark-all clears every loaded row, so the anyUnread-gated button unmounts during its POST and is never aria-busy/disabled (UI-D-252 contradicts itself); pinned by it.fails 'gap E04 loading' in NotificationsSurface.test.tsx (07-14)",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-01T11:59:29.919Z",
    "resolved_at": "2026-10-01T13:55:16.472Z"
  },
  {
    "id": 67,
    "kind": "unmet-truth",
    "phase": "07",
    "file": "apps/web/app/(app)/notificacoes/NotificationsSurface.tsx",
    "line": 208,
    "description": "A row tapped while mark-all is in flight sends no read POST (activate posts only while isUnread, and mark-all already cleared it), yet a failed mark-all keeps it read: UI read, server unread until next load; pinned by it.fails 'gap own read POST' (07-14)",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-01T11:59:29.990Z",
    "resolved_at": "2026-10-01T13:55:16.546Z"
  },
  {
    "id": 68,
    "kind": "unrun-verify",
    "phase": "7",
    "file": "apps/web/e2e/notifications.spec.ts",
    "line": 228,
    "description": "07-15 exit gate: mobile 'mark-all clears every tint' failed; reload 44 ms after the click aborted POST /api/notifications/read-all (no keepalive), Novas still shown; see deferred-items.md",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-01T13:15:19.797Z",
    "resolved_at": "2026-10-01T13:55:16.627Z"
  },
  {
    "id": 69,
    "kind": "unrun-verify",
    "phase": "7",
    "file": "apps/web/e2e/phase52-smoke.spec.ts",
    "line": 294,
    "description": "07-15 exit gate: mobile case 1 failed at line 255, the Novo destaque create sheet never opened after the click; cases 2-6 did not run; passed on desktop in the same run; see deferred-items.md",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-01T13:15:19.871Z",
    "resolved_at": "2026-10-02T13:23:31.763Z"
  },
  {
    "id": 70,
    "kind": "unrun-verify",
    "phase": "7",
    "file": "apps/web/e2e/stories.spec.ts",
    "line": 1636,
    "description": "07-15 exit gate: mobile Inicio manage case failed at line 1707, Escape did not close the Editar destaque sheet; see deferred-items.md",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-01T13:15:19.946Z",
    "resolved_at": "2026-10-02T13:23:31.837Z"
  },
  {
    "id": 71,
    "kind": "unrun-verify",
    "phase": "7",
    "file": "apps/web/e2e/phase2-smoke.spec.ts",
    "line": 532,
    "description": "07-15 exit gate: desktop case 1 timed out (300 s), Salvar alteracoes re-rendered disabled after #primary was filled (Marca rebrand); platform-host steps passed; desktop cases 2-5 did not run; see deferred-items.md",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-01T13:15:20.020Z",
    "resolved_at": "2026-10-02T13:07:44.600Z"
  },
  {
    "id": 72,
    "kind": "unrun-verify",
    "phase": "8",
    "file": "apps/web/e2e/media-video.spec.ts",
    "line": 461,
    "description": "08-12 exit gate: pnpm verify red at e2e: 'the list polls while a row is processing and, after five minutes, stops and offers Atualizar' failed on mobile and desktop (Atualizar never visible); reproduces with the whole file (2/2), green alone (2/2); e2e:pwa did not run; see 08 deferred-items.md",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-02T20:40:39.988Z",
    "resolved_at": null
  },
  {
    "id": 73,
    "kind": "deviation",
    "phase": "08.1",
    "file": "apps/web/e2e/blocked.spec.ts",
    "line": 51,
    "description": "AUTH-06 blocked spec step 3 page.goto aborts intermittently (ERR_ABORTED): the open Inicio page's playback-token action redirects on the 403 at the same moment; pre-08.1 race, see 08.1 deferred-items.md",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-06T20:35:04.152Z",
    "resolved_at": null
  },
  {
    "id": 74,
    "kind": "deviation",
    "phase": "08.1",
    "file": "apps/web/components/admin/DisplayNameCard.test.tsx",
    "line": 55,
    "description": "web typecheck red on DisplayNameCard.test.tsx and BrandingForm.test.tsx (BrandingView.look missing since b357507); 08.1-02 Task 1 verify could not exit 0 on tsc",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-06T20:56:02.275Z",
    "resolved_at": "2026-10-06T20:59:39.258Z"
  },
  {
    "id": 75,
    "kind": "deviation",
    "phase": "08.1",
    "file": "apps/web/app/(auth)/participar/actions.ts",
    "line": null,
    "description": "participar join redirects to /auth/blocked and /auth/suspended from a server action; the handler's sign-out does not stick, so the B-origin session survives (fixed for joinFromSignup in 08.1-02)",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-06T20:56:02.347Z",
    "resolved_at": "2026-10-06T21:26:34.387Z"
  },
  {
    "id": 76,
    "kind": "unrun-verify",
    "phase": "08.1",
    "file": "apps/web/e2e/csp.spec.ts",
    "line": 114,
    "description": "08.1-07 release-1 gate: pnpm verify stops at e2e; csp.spec (tracer, refreshed session), admin-branding E12 and platform-wizard:164 fail on FRONT-PENDENCIAS copy and markup drift (f18d1af); e2e 797/805, e2e:pwa 58/64",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-07T00:10:14.850Z",
    "resolved_at": null
  }
]
````
