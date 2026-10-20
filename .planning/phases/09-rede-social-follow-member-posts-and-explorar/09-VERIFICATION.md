---
phase: 09-rede-social-follow-member-posts-and-explorar
verified: 2026-10-20T16:00:00Z
status: passed
score: 7/7 roadmap success criteria verified in code (both round-1 gaps closed with direct evidence); 5 human-only items open
covered_files:

  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-01-PLAN.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-01-SUMMARY.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-02-PLAN.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-02-SUMMARY.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-03-PLAN.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-03-SUMMARY.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-04-PLAN.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-04-SUMMARY.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-05-PLAN.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-05-SUMMARY.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-06-PLAN.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-06-SUMMARY.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-07-PLAN.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-07-SUMMARY.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-08-PLAN.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-08-SUMMARY.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-09-PLAN.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-09-SUMMARY.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-10-PLAN.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-10-SUMMARY.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-11-PLAN.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-11-SUMMARY.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-12-PLAN.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-12-SUMMARY.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-13-PLAN.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-13-SUMMARY.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-14-PLAN.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-14-SUMMARY.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-15-PLAN.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-15-SUMMARY.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-16-PLAN.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-16-SUMMARY.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-17-PLAN.md"
  - ".planning/phases/09-rede-social-follow-member-posts-and-explorar/09-17-SUMMARY.md"
  - "apps/api/src/app.ts"
  - "apps/api/src/modules/registry.ts"
  - "apps/api/src/routes/media.ts"
  - "apps/api/src/routes/members.ts"
  - "apps/api/src/routes/platform/tenants.ts"
  - "apps/api/tests/integration/media-playback.test.ts"
  - "apps/api/tests/integration/moderation-posts.test.ts"
  - "apps/api/tests/integration/social-media.test.ts"
  - "apps/web/app/(app)/comunidades/[communityId]/page.tsx"
  - "apps/web/app/(app)/comunidades/actions.ts"
  - "apps/web/app/(app)/criar/ComposerForm.tsx"
  - "apps/web/app/(app)/criar/page.tsx"
  - "apps/web/app/(app)/inicio/ExplorarBody.tsx"
  - "apps/web/app/(app)/inicio/ExplorarSkeleton.tsx"
  - "apps/web/app/(app)/inicio/InicioTabs.tsx"
  - "apps/web/app/(app)/inicio/feed-actions.ts"
  - "apps/web/app/(app)/inicio/page.tsx"
  - "apps/web/app/(app)/inicio/tabs.ts"
  - "apps/web/app/(app)/membros/MembersList.tsx"
  - "apps/web/app/(app)/membros/[membershipId]/not-found.tsx"
  - "apps/web/app/(app)/membros/[membershipId]/page.tsx"
  - "apps/web/app/(app)/membros/actions.ts"
  - "apps/web/app/(app)/membros/page.tsx"
  - "apps/web/app/(app)/perfil/SocialList.tsx"
  - "apps/web/app/(app)/perfil/page.tsx"
  - "apps/web/app/(app)/perfil/seguidores/loading.tsx"
  - "apps/web/app/(app)/perfil/seguidores/page.tsx"
  - "apps/web/app/(app)/perfil/seguindo/loading.tsx"
  - "apps/web/app/(app)/perfil/seguindo/page.tsx"
  - "apps/web/app/(app)/perfil/social-list-actions.ts"
  - "apps/web/app/(app)/post/[postId]/editar/page.tsx"
  - "apps/web/app/(app)/post/[postId]/page.tsx"
  - "apps/web/app/(platform)/plataforma/tenants/[id]/modulos/actions.ts"
  - "apps/web/app/(platform)/plataforma/tenants/[id]/modulos/page.tsx"
  - "apps/web/components/admin/ModerationLogRow.tsx"
  - "apps/web/components/feed/FeedSurface.tsx"
  - "apps/web/components/feed/PostDetail.tsx"
  - "apps/web/components/feed/community-locked.ts"
  - "apps/web/components/feed/useDeletePost.ts"
  - "apps/web/components/media/useSignedUpload.ts"
  - "apps/web/components/platform/ModuleToggles.tsx"
  - "apps/web/components/platform/SocialLimitsSheet.tsx"
  - "apps/web/components/profile/MemberRow.tsx"
  - "apps/web/components/profile/MembersSkeleton.tsx"
  - "apps/web/components/reels/ReelsHost.tsx"
  - "apps/web/components/social/FollowControl.tsx"
  - "apps/web/components/social/LockedPostScreen.tsx"
  - "apps/web/components/social/MemberFollowRow.tsx"
  - "apps/web/components/social/SocialCountsBlock.tsx"
  - "apps/web/components/social/SocialProfileBlock.tsx"
  - "apps/web/components/social/follow-actions.ts"
  - "apps/web/components/social/post-focus.ts"
  - "apps/web/lib/feed-view.tsx"
  - "apps/web/lib/feed-write.ts"
  - "apps/web/lib/feed.ts"
  - "apps/web/lib/member-directory.ts"
  - "apps/web/lib/moderation-view.ts"
  - "apps/web/lib/notification-renderers.tsx"
  - "apps/web/lib/platform.ts"
  - "apps/web/lib/registry.tsx"
  - "apps/web/lib/social-limits.ts"
  - "apps/web/lib/social-settings.ts"
  - "apps/web/lib/social.ts"
  - "docs/DEPLOY.md"
  - "packages/contracts/src/access.ts"
  - "packages/contracts/src/moderation.ts"
  - "packages/contracts/src/modules.ts"
  - "packages/core/db/schema/media-assets.ts"
  - "packages/core/db/schema/moderation-log.ts"
  - "packages/core/db/social-gate.ts"
  - "packages/core/server/media/limits.ts"
  - "packages/core/server/media/member-policy.ts"
  - "packages/core/server/media/member-share.ts"
  - "packages/core/server/media/service.ts"
  - "packages/core/server/media/video/duration-verdict.ts"
  - "packages/core/server/media/video/event-job.ts"
  - "packages/core/server/moderation/log.ts"
  - "packages/core/server/platform/modules.ts"
  - "packages/core/server/profiles/service.ts"
  - "packages/core/tests/media-duration-verdict.test.ts"
  - "packages/modules/feed/contracts/index.ts"
  - "packages/modules/feed/db/schema.ts"
  - "packages/modules/feed/module.ts"
  - "packages/modules/feed/server/notification-copy.ts"
  - "packages/modules/feed/server/notifications.ts"
  - "packages/modules/feed/server/routes.ts"
  - "packages/modules/feed/server/service.ts"
  - "packages/modules/feed/tests/notification-sources.test.ts"
  - "packages/modules/feed/ui/CommentsList.tsx"
  - "packages/modules/feed/ui/FeedList.tsx"
  - "packages/modules/feed/ui/PostCard.tsx"
  - "packages/modules/feed/ui/PostMenu.tsx"
  - "packages/modules/feed/ui/index.ts"
  - "packages/modules/social/README.md"
  - "packages/modules/social/contracts/index.ts"
  - "packages/modules/social/db/schema.ts"
  - "packages/modules/social/module.ts"
  - "packages/modules/social/server/index.ts"
  - "packages/modules/social/server/routes.ts"
  - "packages/modules/social/server/service.ts"
  - "packages/modules/social/ui/FollowButton.tsx"
  - "packages/modules/social/ui/FollowCounts.tsx"
  - "packages/modules/social/ui/FollowListRow.tsx"
  - "packages/modules/social/ui/LockedPost.tsx"
  - "packages/modules/social/ui/index.ts"
  - "packages/modules/social/vitest.config.ts"
  - "scripts/seed.ts"
  - "supabase/migrations/20261019202758_social_module_key.sql"
  - "supabase/migrations/20261019204645_social_gate_seam.sql"
  - "supabase/migrations/20261019204728_social_follows.sql"
  - "supabase/migrations/20261019204737_social_functions.sql"
  - "supabase/migrations/20261019211658_feed_social_visibility.sql"
  - "supabase/migrations/20261019214205_feed_social_indexes.sql"
  - "supabase/migrations/20261019220306_feed_social_locked.sql"
  - "supabase/migrations/20261019221240_feed_social_media_gate.sql"
  - "supabase/migrations/20261019223247_media_duration_cap.sql"
  - "supabase/migrations/20261019225153_moderation_post_removed.sql"
  - "supabase/migrations/20261020123217_social_audience_revocation.sql"
  - "supabase/migrations/20261020123622_feed_social_member_write_gate.sql"
  - "supabase/migrations/20261020123631_feed_member_update_guard.sql"
  - "supabase/migrations/20261020123859_social_can_read_for.sql"
  - "supabase/tests/200-social.sql"
  - "supabase/tests/201-feed-social-gate.sql"
  - "supabase/tests/202-feed-member-write-gate.sql"
  - "supabase/tests/203-social-can-read-for.sql"

covered_digest: "v1:sha256:1dc729edd5e19c296ea4eb44d5cf340debe827701f63dcc008ea252c9f863cc7"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: "6/7 roadmap success criteria verified (two audience-revocation gaps)"
  gaps_closed:
    - "WR-02 (round 1): the reply notification no longer delivers follower-only comment text to a commenter who lost access (SOCIAL-06)"
    - "WR-01 (round 1): app.media_asset_hidden keeps a soft-deleted followers-only video closed, so a moderator takedown revokes playback (SOCIAL-06, SOCIAL-07, EXPL-06)"
  gaps_remaining: []
  regressions: []
gaps: []
deferred: []
advisory:

  - finding: "resolveCommentLiked (comment.liked) has no audience probe: a commenter who lost access to a followers-only post still gets an in-app-only bell row when a follower likes their comment (actor name, their own excerpt, link to a post that answers 403). No foreign text, no push."
    category: security
    reason: "Judged a non-blocking residual (no follower-only text or content is delivered; D-235 keeps likes out of push). Same class as the closed reply leak, so a quick task with the same socialCanReadFor probe is recommended before `social` is enabled on a real tenant."
    evidence_status: "code read (notifications.ts:212-256); not reproduced by a test"
  - finding: "feed_posts_member_update_guard is a four-column deny-list for the author's own row: an author could in principle clear deleted_at / deleted_by_user_id (undo a moderator takedown) or rewrite the counters through a direct member-lane statement."
    category: security
    reason: "Judged a non-blocking residual: deleted_at is deliberately outside RLS, but no service statement, route or job in the repository can clear it (every UPDATE of feed_posts at service.ts:1459, 1573, 2529 either sets it or filters `deleted_at is null`). The SQL guard is a defense-in-depth ride-along (WR-07), not a roadmap criterion."
    evidence_status: "code read of the guard and of all three feed_posts UPDATE statements"
  - finding: "Widening the member byte share to every purpose lets one member hold up to half of the 800 MiB ceiling with declared-size starts (no byte is ever uploaded) and lock other members out of photo / avatar starts until the 24 h pending sweeper runs."
    category: other
    reason: "Judged a non-blocking residual: SOCIAL-05 asks that a member flood cannot starve the ORGANIZATION, and the admin lane is untouched. Member-versus-member lockout needs a rate limit / per-member pending cap, an already-open decision."
    evidence_status: "code read (member-share.ts:35-50, service.ts:478-489)"
  - finding: "applyReady deletes the provider asset before the conditional status update in the new `unmeasurable` branch (and in the pre-existing `too_long` branch), so a late ready event with a null duration for an already-ready member video would leave a ready row whose Mux asset is gone."
    category: other
    reason: "Judged a non-blocking residual: it needs a ready event with a null duration after the row went ready; Mux always reports a duration on ready. Fix is a two-line reorder."
    evidence_status: "code read (event-job.ts:134-176)"
  - finding: "docs/DEPLOY.md:2143-2148 states that the Phase 8 step-1 grep printed nothing for the four new migrations; it prints two hits (the word `renamed` in comments of 20261020123622 line 10 and 20261020123631 line 39)."
    category: other
    reason: "Judged a non-blocking residual: both hits are comment text and the migrations are expand-only, but the documented claim is false as written and the step's rule is `anything else means stop and ask`."
    evidence_status: "I ran the exact grep -inE over every Phase 09 migration and got exactly those two lines"
human_verification:

  - test: "Real-device PWA walk on the hosted stack: Explorar chips, the member composer (photo and video), the Siga para ver screen, Reels from Explorar and back, push for the comment and reply notices"
    expected: "Everything works in an installed PWA on an iPhone (Safari) and an Android (Chrome); the push arrives and opens the post with the comment focused"
    why_human: "Phones cannot reach *.localhost; push and HLS need the hosted stack (09-VALIDATION Manual-Only; WINDOWS 116/118 family). Never run."
  - test: "Run the Playwright specs of the phase (social.spec.ts, social-platform.spec.ts, phase9-smoke.spec.ts), in particular the Seguir control and the counts block after plan 09-17 changed FollowControl and SocialCountsBlock"
    expected: "Green against a freshly seeded database"
    why_human: "Playwright was not run anywhere in the gap round (09-VALIDATION says `unrun-verify`), and I was not allowed to start servers. The component unit tests pass (web components/social, 64 tests per the gate record), but the render-phase resync is a UI behavior that only an e2e proves in a real browser."
  - test: "Visual fidelity of the designed screens against sketch 012 at 320 and 390 px in light and dark under a tenant brand"
    expected: "Matches the approved sketch; designer review (D-33) is a follow-up"
    why_human: "Sketch 012 was approved PROVISIONALLY by the product owner in chat on 2026-10-19; the designer has not reviewed it; no pixel check exists."
  - test: "A real Mux upload of a member video (a) over the tenant duration cap and (b) with no reported duration"
    expected: "(a) ends `rejected` with the duration reason, (b) ends `failed` with the unmeasurable reason, the provider asset deleted in both"
    why_human: "Local runs use the fake provider (same applyReady path); the Mux adapter has never run against a real account. This is also where the event-job ordering residual would show."
  - test: "Legal wording of the terms of use, community rules and privacy policy for third-party content (D-478), the IN-01 check of tenants that had settings.postingPolicy = 'members', and one uninterrupted `TURBO_CACHE=local:r VIDEO_PROVIDER=fake pnpm verify` on a freshly seeded database (WINDOWS 123)"
    expected: "Legal text settled with the operator before the super_admin turns `social` on for any tenant (docs/DEPLOY.md item `Ativar a Rede social`); a single green verify exit including e2e"
    why_human: "Legal text is the operator's. The exit gate has only ever run in parts."
---

# Phase 9: Rede Social - Follow, Member Posts and Explorar Verification Report (re-verification)

**Phase Goal:** A tenant can open up member authoring. With the new "Rede social" module on, members follow each other and publish feed posts, and the new "Explorar" tab shows only posts from people they follow, while Início stays the organization's voice (admin posts only).
**Verified:** 2026-10-20
**Status:** human_needed
**Re-verification:** Yes, after the gap round 09-14..09-17 (round 1 was `gaps_found`, commit b22d6e58)

## Verdict in one paragraph

Both round-1 gaps are closed in the code and in the running database, with behavior evidence rather than presence evidence: pgTAP 201 / 202 / 203 pass on the local stack (112, 61 and 38 assertions, no `not ok`), and the two integration files that drive the real API plus the real worker (`moderation-posts`, `media-playback`) pass (61 tests). A regression sweep of the other criteria (feed, interactions, edit/delete, Reels, comment moderation, social, social-module, social-media, feed-social: 196 integration tests; module-feed 327, module-social 63, core duration verdict 6) is green, and the gap-round diff never touched the Início / Explorar / Reels predicates in `feed/server/service.ts`. No automated-checkable gap remains. The status is `human_needed` and not `passed` because five human-only items stay open (real device, Playwright e2e never run in the gap round, designer review of sketch 012, a real Mux asset, legal wording plus one clean `pnpm verify`). Five advisory residuals from the gap-round review are recorded below with reasoning; none contradicts a roadmap criterion or a requirement text as written, though the `comment.liked` one (WR-03 of the review) is the closest call and is worth a quick task before `social` goes live on a real tenant.

## Round-1 gaps: re-verification with direct evidence

### G2 / WR-01: followers-only video stays closed after the post is soft-deleted: CLOSED

- Code: `supabase/migrations/20261020123217_social_audience_revocation.sql` re-creates `app.media_asset_hidden(uuid)` as `(A or B) and not C`. B (lines 54-62) is a SOFT-DELETED post of audience `followers` carrying the asset, active unless the caller is inside the staff exemption (`admin_tenant` or the zero user) while `social` is enabled. C is the unchanged "a live visible carrier wins" clause. Same signature and OID, `SECURITY DEFINER`, `search_path = ''`, every statement pinned to `app.tenant_id()`, EXECUTE revoked from PUBLIC and granted to `authenticated`. The migration is applied locally (`schema_migrations` head is `20261020123859`).
- Behavior, pgTAP 201 (run by me, rolled back): case 83 stranger still hidden after the only followers post is soft-deleted, 84 follower hidden (the takedown closes it), 85 author hidden, 88 a real `support_tenant` is not exempt, 89 tenant pin, 90 live organization carrier wins (EP-61), 91 soft-deleted ORGANIZATION post stays false (EP-62), 92 live followers carrier of a followee opens it, 102 with `social` off even the admin is refused (D-483). 112 of 112 `ok`.
- Behavior, API: `media-playback.test.ts` passes (the run logs show `GET /v1/media/:id/playback` answering 404 for the follower and the author after the delete and 200 for the admin).
- Accepted residuals, not gaps (user decision 2026-10-20), recorded in `docs/DEPLOY.md` item `Ativar a Rede social` (line 2432 and 2441) and `packages/modules/social/README.md` (`## Known limits`, line 126): member photo variants and `original` are id capabilities (A6); a playback token minted before a takedown lives to its expiry (EP-60); notice rows written before a revocation are not retracted (A5).

### G1 / WR-02: reply notification no longer leaks follower-only comment text: CLOSED

- Code: `packages/modules/feed/server/notifications.ts:403-456`. The reply branch now selects `p.visibility`, `p.author_user_id`, `author_live` and `social_on` in the same statement; for `visibility !== 'tenant'` (so an unexpected value fails closed) it returns `[]` when `social` is off or the post author is not live, then asks ONE more question, `app.social_can_read_for(root_author, post_author)` through the kernel seam `socialCanReadFor` (`packages/core/db/social-gate.ts`), and requires exactly `true` (null or no row is a no). The community lock check runs afterwards, unchanged. The feed module names no social table (MOD-02).
- The function: `supabase/migrations/20261020123859_social_can_read_for.sql`. `SECURITY DEFINER`, `search_path = ''`, tenant pinned on every statement, whole body in `coalesce(..., false)`, and it answers about another user only to the system lane (zero user), so it is not a follow-graph oracle (D-468). pgTAP 203: 38 of 38 `ok` in my run, including the truth table, the no-oracle block and the posture block.
- Behavior, worker end to end: `apps/api/tests/integration/moderation-posts.test.ts` case 7 (line 692) unfollows, has the author reply, runs the notification jobs and asserts no bell row AND no queued push for the ex-follower, then re-follows and asserts both return; case 8 (line 738) does the same for a blocked post author and for `social` switched off before the worker runs, with a live control. Passed in my run (file: 61 tests with `media-playback`). Unit matrix in `notification-sources.test.ts` (lines 459-580): readable true / false / null, organization post keeps one statement, social off, author gone, own reply, author-as-root, 80-grapheme excerpt, community lock last.

## Goal Achievement: ROADMAP success criteria (regression check with the code as it is now)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `social` module switch, off by default, supersedes `postingPolicy`, off hides Explorar / controls and routes 404 | VERIFIED | Unchanged since round 1 (`modules.ts:18`, `social/module.ts`, registry); `social-module.test.ts` green in my run |
| 2 | Follow / unfollow in the same tenant, counts, no cross-tenant following | VERIFIED | `social.test.ts` green; module-social 7 files / 63 tests green; pgTAP 200 exists (not re-run, see below) |
| 3 | Início shows only admin posts; a member post appears only in followers' Explorar; likes, comments and playback follow the same audience | VERIFIED | Literal `p.visibility = 'tenant'` for Início (`feed/server/service.ts:527-539`), `memberPostVisible` for Reels and Explorar; the gap round did not touch `service.ts`; `feed-social`, `feed`, `feed-interactions`, `feed-edit-delete`, `moderation-comments` green. The two side channels of round 1 are closed (above) |
| 4 | Explorar keyset-paginated, likes / comments, empty state to `/membros`; directory reopened to members only while `social` is on | VERIFIED | Unchanged; `feed-social`, `social-module` green |
| 5 | Member profile follow button and counts, conditionally reversing D-45 | VERIFIED | Unchanged server side; the web `FollowControl` / `SocialCountsBlock` now resync from the server value (09-17, WR-04). Component tests exist and pass per the gate record; e2e not run (human item 2) |
| 6 | Member uploads bounded, set per tenant by super_admin | VERIFIED | `social-media.test.ts` green (117 tests across the four social files); the 09-16 hardening is present: share covers every purpose (`member-share.ts:36-50`), pending member video charged at its snapshotted cap (`:65-85`), unmeasured member video fails closed (`duration-verdict.ts`, `event-job.ts:157-176`), photo judged at complete by the size declared at start. Residuals in the advisory block |
| 7 | Reels follows the same visibility; like / comment on the same post | VERIFIED | `reels.test.ts` green; playback gate now also covers deleted posts (G2) |

**Score:** 7/7 roadmap criteria verified in code.

## Decision on the five gap-round review warnings

| Review item | My verdict | Reasoning |
|-------------|-----------|-----------|
| WR-01 DEPLOY.md says the step-1 grep "printed nothing" for files 11-14 | Non-blocking residual, fix before the deploy | I re-ran the exact `grep -inE` over all Phase 09 migrations: exactly two hits, both the word `renamed` in comments (`...123622_...write_gate.sql:10`, `...123631_...update_guard.sql:39`). The migrations are expand-only, so no requirement is contradicted, but the release doc states something false and its rule is "anything else means stop and ask". Reword the doc (or the two comments) and re-run the grep before recording the claim. |
| WR-02 update guard pins four columns; the author could clear `deleted_at` and rewrite counters | Non-blocking residual | True at the SQL level: `deleted_at` is deliberately outside RLS and the author branch is a deny-list. Not reachable today: the three `UPDATE feed_posts` statements in the feed service either set `deleted_at` or filter `deleted_at is null`, and no code anywhere sets it back to null for posts. SOCIAL-06/07 are satisfied by the service and the RLS read gate; the guard is the WR-07 defense-in-depth ride-along. Recommended hardening (allow-list of the author's editable columns, forbid undelete), together with a pgTAP case. |
| WR-03 `resolveCommentLiked` lacks the audience probe | Non-blocking residual, closest call, quick task recommended | It delivers no follower-only text: the excerpt is the recipient's own comment, the row is in-app only (D-235), and the link lands on a 403. What it does reveal to a former reader is that a named person interacted with a thread they can no longer open. I read SOCIAL-06 as protecting the post, its thread content and its video; if the product owner reads "its likes ... readable only by" strictly for notices, this becomes a gap and the fix is the same `socialCanReadFor` probe plus one shared helper. I did not downgrade it silently: it is in the `advisory` block. |
| WR-04 byte share widening lets one member exhaust it with declared-size starts | Non-blocking residual | SOCIAL-05 asks that a member flood cannot starve the organization, and the admin lane never reaches the sub-budget. The member-versus-member lockout is bounded to half the ceiling and to the 24 h pending sweep, and the same shape existed for purpose `post` before the widening. It needs a per-member pending cap or a rate limit (an already-open decision); state the price in DEPLOY.md. |
| WR-05 `unmeasurable` branch deletes the provider asset before the conditional update | Non-blocking residual | Confirmed by reading `event-job.ts:134-176` (same ordering in the older `too_long` branch). It needs a ready event with a null duration after the row already went ready; the provider adapters report a duration on ready. No criterion is contradicted; the fix is to reorder, and a real-Mux check is in the human list. |

## Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `supabase/migrations/20261020123217..123859` (4 files) | VERIFIED | Present, applied locally, expand-only (no table, column or constraint change), hardened definers |
| `supabase/tests/201 / 202 / 203` | VERIFIED | Run by me inside a rolled-back transaction: 112 / 61 / 38 `ok`, zero `not ok`; plan counts equal |
| `packages/core/db/social-gate.ts` `socialCanReadFor` | VERIFIED | Wired into the feed reply resolver; kernel names the seam, social owns the table |
| `packages/modules/feed/server/notifications.ts` reply branch | VERIFIED | Wired and exercised through the real worker |
| `apps/api/tests/integration/moderation-posts.test.ts` cases 7-8, `media-playback.test.ts` | VERIFIED | Pass |
| `docs/DEPLOY.md` fourteen-migration release order and accepted residuals | VERIFIED with one false sentence | See review WR-01 |

## Key Links

| From | To | Status |
|------|----|--------|
| `resolveCommentCreated` reply branch | `app.social_can_read_for` via `socialCanReadFor` | WIRED (was NOT_WIRED in round 1) |
| `playbackTokens` | `app.media_asset_hidden` (deleted-post branch) | WIRED (was a hole in round 1) |
| `resolveCommentLiked` | social gate | NOT WIRED, recorded as an advisory residual |
| `feed_posts` BEFORE UPDATE guard | counters, soft delete, moderator, worker | WIRED; counter triggers and the moderator path keep working (feed-interactions, feed-edit-delete, moderation-posts green) |

## Requirements Coverage

All 22 IDs are declared in the `requirements:` frontmatter of at least one plan (union checked plan by plan: SOCIAL-01..10 in plans 01, 03-07, 09, 12-17; FOLLOW-01..06 in plans 02, 10, 11, 17; EXPL-01..06 in plans 03-05, 08, 09, 14) and each has a traceability row `Phase 09` in REQUIREMENTS.md. No orphaned ID.

| Requirement | Status | Note |
|-------------|--------|------|
| SOCIAL-01..05, 07..10 | SATISFIED | SOCIAL-05 with the byte-share residual |
| SOCIAL-06 | SATISFIED in code | Round-1 gaps closed; photo variants and pre-takedown tokens are the accepted residuals (A6, EP-60); `comment.liked` notice is the advisory closest call |
| FOLLOW-01..06 | SATISFIED | FOLLOW-05 UI resync (09-17) covered by component tests; e2e open |
| EXPL-01..06 | SATISFIED | EXPL-06 inherits the closed G2 |

REQUIREMENTS.md state (orchestrator-owned, I did not edit it): only SOCIAL-07 and EXPL-06 are `Complete` there; the other twenty rows still read `Gaps Found` / unchecked and should move at phase close, once the human items are settled or deferred. PROF-03 (reworded in this phase) is still Pending in the file.

## Behavioral Spot-Checks (run by me against the local stack, read-only or rolled back)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| pgTAP 201 / 202 / 203 (gate, member write gate, can_read_for) | each file wrapped as `begin; create extension pgtap; ...` through psql, ends in rollback | 112 / 61 / 38 `ok`, no `not ok` | PASS |
| Reply notice and playback end to end | `vitest run tests/integration/moderation-posts.test.ts tests/integration/media-playback.test.ts` | 2 files, 61 tests | PASS |
| Social integration | `vitest run feed-social social social-module social-media` | 4 files, 117 tests | PASS |
| Feed integration regression | `vitest run feed-interactions feed-edit-delete reels feed moderation-comments` | 5 files, 79 tests | PASS |
| Module and core unit suites | `vitest run` in `packages/modules/feed`, `packages/modules/social`, `packages/core/tests/media-duration-verdict.test.ts` | 327, 63, 6 tests | PASS |
| pgTAP 200 and the full suite (2167 on a fresh DB) | not re-run: the pgTAP extension is not installed in the shared database and the residue would trip 154 | relied on the 09-14 gate record | SKIPPED |
| Workspace `turbo typecheck test` (37/37), full API integration (76 files / 1551 tests) | orchestrator's run | not re-run by me | reported |
| Playwright e2e, `pnpm verify`, real device, real Mux | not runnable here | open in `human_verification` | SKIPPED |

The two pgTAP-adjacent facts to know: the three files were run in a transaction in which I created the extension, so nothing persisted (`pg_extension` has no `pgtap` row afterwards); the integration files restore what they change.

## Anti-Patterns Found

No TBD / FIXME / XXX introduced by the gap round in the files I opened. The only anti-pattern class that surfaced is the doc defect above and the advisory residuals.

## Gaps Summary

None. No success criterion, requirement text or must-have is unmet in code, and the round-1 gaps are closed with behavior evidence. The phase stays `human_needed` because the items in the frontmatter cannot be proven from here. Recommended before `social` is enabled on a real tenant (and before the production deploy): correct the DEPLOY.md grep sentence, add the audience probe to `resolveCommentLiked`, and decide whether to harden the update guard with an allow-list.

## Acknowledged Gaps

Status set to `passed` on 2026-10-20 at the user's direction after `/gsd-verify-work 9` (09-UAT.md: 5 of 5 recorded as pass). What was acknowledged, not proven:

- UAT tests 1, 2, 4 and 5 were recorded as pass on the user's word. Claude did not observe a real-device walk, a Playwright run after plan 09-17, a real Mux upload of the duration-cap paths, or a green `pnpm verify`. Each reason is written in 09-UAT.md.
- `/gsd-secure-phase 9` was not run (no 09-SECURITY.md). The user will review security later; it is still owed before `social` is enabled on a real tenant.
- The nyquist validate-phase and ui-review verify:post steps were not dispatched.
- Still recommended before `social` is enabled (see Gaps Summary): correct the DEPLOY.md grep sentence, add the audience probe to `resolveCommentLiked`, decide on the update-guard allow-list.
- Phase 9 is not deployed: HEAD is 137 commits ahead of origin/master.

---

_Verified: 2026-10-20_
_Verifier: Claude (gsd-verifier)_
