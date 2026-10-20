---
phase: 09-rede-social-follow-member-posts-and-explorar
verified: 2026-10-20T15:00:00Z
status: gaps_found
score: 6/7 roadmap success criteria verified (criterion 7 and the SOCIAL-06 audience requirement carry two confirmed audience-revocation gaps)
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/ROADMAP.md"
  - "apps/api/src/app.ts"
  - "apps/api/src/modules/registry.ts"
  - "apps/api/src/routes/members.ts"
  - "apps/api/src/routes/platform/tenants.ts"
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
  - "packages/core/server/media/video/event-job.ts"
  - "packages/core/server/moderation/log.ts"
  - "packages/core/server/platform/modules.ts"
  - "packages/core/server/profiles/service.ts"
  - "packages/modules/feed/contracts/index.ts"
  - "packages/modules/feed/db/schema.ts"
  - "packages/modules/feed/module.ts"
  - "packages/modules/feed/server/notification-copy.ts"
  - "packages/modules/feed/server/notifications.ts"
  - "packages/modules/feed/server/routes.ts"
  - "packages/modules/feed/server/service.ts"
  - "packages/modules/feed/ui/CommentsList.tsx"
  - "packages/modules/feed/ui/FeedList.tsx"
  - "packages/modules/feed/ui/PostCard.tsx"
  - "packages/modules/feed/ui/PostMenu.tsx"
  - "packages/modules/feed/ui/index.ts"
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
covered_digest: "v1:sha256:f8ac833a029719302b901ca64610366aebf634941c72a426b8729cf035d0f3c3"
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "SOCIAL-06 / criterion 3: a member post, its likes, its comment reads and writes are readable only by its author, the author's followers and the admin moderator; a comment thread of a followers-only post leaks to nobody else"
    status: failed
    reason: "WR-02 (confirmed in the code). The reply branch of resolveCommentCreated (packages/modules/feed/server/notifications.ts, the part after `if (payload.parentCommentId === null) return resolvePostCommented`) carries no audience test. Its only recipient guard is lockedForRecipient(community). The social gate (visibility, social_on, author_live) was added to resolvePostCommented only. A follower who commented on a followers-only post and then unfollowed (or was blocked, or whose author was blocked, or whose tenant turned social off) still receives an in-app bell row AND a push whose body is the reply excerpt (feedReplyPushCopy(actor, excerpt)) when a follower replies to their comment. That is follower-only comment text delivered to someone the gate refuses everywhere else (the post, the thread and the like routes answer 403 follow_required / 404)."
    artifacts:
      - path: "packages/modules/feed/server/notifications.ts"
        issue: "reply branch selects neither p.visibility nor the social_on / author_live columns; the recipient (root comment author) is never checked against the author's followers"
    missing:
      - "In the reply branch select p.visibility, p.author_user_id, social_on and author_live and return [] when visibility = 'followers' and (not social_on, not author_live, or the recipient is neither the post author nor a live follower of the author)"
      - "A unit case in packages/modules/feed/tests/notification-sources.test.ts and an integration case (reply to an ex-follower's comment yields no intent / no push)"
  - truth: "SOCIAL-06 / criteria 3 and 7: a followers-only member video is playable only by those who may see the post (the playback gate `app.media_asset_hidden` is the stated capability guard)"
    status: partial
    reason: "WR-01 (confirmed in supabase/migrations/20261019221240_feed_social_media_gate.sql). Both halves of app.media_asset_hidden test only LIVE posts (`p.deleted_at is null`). Once the only post carrying a followers-only video is soft-deleted (by the author or by a moderator through SOCIAL-07) the function answers false and playbackTokens mints a token for any tenant member who still holds the asset id; pgTAP 201 line 533 pins that false as the expected answer. The unfollow case on a LIVE post is covered correctly (the function re-checks the viewer's followees). Image width variants and `original` of a member photo are zero-read id capabilities by design (serveVariant asks only the course gate, Assumption A6) and are not re-evaluated for audience-restricted content. A never-authorised non-follower cannot learn an asset id (post, thread and Reels reads are gated), so this is a revocation gap for people who once saw the post, not an open door; but it defeats the moderator takedown (D-475) for video and it contradicts the migration's own stated purpose."
    artifacts:
      - path: "supabase/migrations/20261019221240_feed_social_media_gate.sql"
        issue: "deleted-post video is treated as `no carrier` and therefore not hidden"
      - path: "packages/core/server/media/service.ts"
        issue: "serveVariant (variants and original of post images) asks no audience gate"
    missing:
      - "Treat an asset whose only carriers are soft-deleted followers posts as hidden for every caller except admin_tenant and the system lane (new expand-only migration re-creating the function)"
      - "Decide and record whether member photo variants stay an accepted id-capability residual (A6) or ask the same gate"
      - "Flip pgTAP 201 case 'false once the only post carrying it is soft-deleted' to true for a non-admin caller and add the admin and system-lane cases"
deferred: []
advisory: []
human_verification:
  - test: "Real-device PWA walk on the hosted stack: Explorar chips, the member composer (photo and video), the Siga para ver screen, Reels from Explorar and back, push for the comment notice"
    expected: "Everything works in an installed PWA on an iPhone (Safari) and an Android (Chrome); the push arrives and opens the post with the comment focused"
    why_human: "Phones cannot reach *.localhost; push and HLS need the hosted stack (09-VALIDATION Manual-Only; WINDOWS 116/118 family). Never run."
  - test: "Visual fidelity of the designed screens against sketch 012 at 320 and 390 px in light and dark under a tenant brand (chip row, three empty states, locked post, counts block, lists, directory row, member composer, platform row and limits sheet, moderation sentence, Administrador badge by audience)"
    expected: "Matches the approved sketch; designer review (D-33) is a follow-up"
    why_human: "Sketch 012 was approved PROVISIONALLY by the product owner in chat on 2026-10-19 (the orchestrator wrote the approval keys on his instruction); the designer has not reviewed it; no pixel check exists."
  - test: "A real Mux upload of a member video over the tenant duration cap"
    expected: "The asset ends `rejected` with the duration reason and the provider asset is deleted"
    why_human: "Local runs use the fake provider (same applyReady path); the Mux adapter has never run against a real account."
  - test: "Legal wording of the terms of use, community rules and privacy policy for third-party content (D-478), plus the IN-01 check of tenants that had settings.postingPolicy = 'members'"
    expected: "Settled with the operator before the super_admin turns `social` on for any tenant; recorded in docs/DEPLOY.md item `Ativar a Rede social` (present at line 2384)"
    why_human: "Legal text is the operator's, not code."
  - test: "One uninterrupted `TURBO_CACHE=local:r VIDEO_PROVIDER=fake pnpm verify` on a freshly seeded database (WINDOWS 123)"
    expected: "A single green exit including e2e"
    why_human: "The exit gate ran in parts (e2e hit ENOSPC at test 244 and was finished in chunks on the same database). The orchestrator re-ran `turbo typecheck test` at HEAD: 37/37. I did not rerun pgTAP, integration or e2e (not allowed to reset the database or start servers)."
---

# Phase 9: Rede Social - Follow, Member Posts and Explorar Verification Report

**Phase Goal:** A tenant can open up member authoring. With the new "Rede social" module on, members follow each other and publish feed posts, and the new "Explorar" tab shows only posts from people they follow, while Início stays the organization's voice (admin posts only).
**Verified:** 2026-10-20
**Status:** gaps_found
**Re-verification:** No, initial verification

## Verdict in one paragraph

The feature is built, wired and unusually well covered: the module, the follow graph, the stamped audience with two restrictive RLS policies, the Início / Explorar / Reels predicates, the member media limits, the platform switch and the web surfaces all exist and agree with each other. I found no cross-tenant read and no route that trusts a UI-only check. Two side channels around the audience gate are real and confirmed in the code, so the phase does not close cleanly: the reply notification (WR-02) delivers follower-only comment text to a user who lost access, and the playback gate (WR-01) stops covering a followers-only video once its post is soft-deleted. WR-02 is a failed requirement (SOCIAL-06); WR-01 is partial. Both are small, local fixes. None of the 22 requirement IDs is unaccounted for.

## Goal Achievement: ROADMAP success criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `social` module switch, off by default, supersedes `postingPolicy`, off hides Explorar / controls and routes 404 | VERIFIED | `social` is in `TOGGLEABLE_MODULES` (`packages/contracts/src/modules.ts:18`); `packages/modules/social/module.ts` declares `requires: ['feed']`, member-only `social.participate`; the router chains `requireModule('feed')` + `requireModule('social')`; `postingPolicy` is no longer read in the registry (only comments and legacy schema mention it); explorar scope answers 404 `MODULE_DISABLED` when off (`feed/server/service.ts` listFeed). Seed puts `social` on rede-lab only; not in `REAL_TENANT_DEFAULT_MODULES`. Platform toggle + confirmation + requires-Feed note: `ModuleToggles.tsx`, `social-platform.spec.ts`. |
| 2 | Follow / unfollow same tenant, counts, no cross-tenant following | VERIFIED | `social_follows` migration: unique `(tenant, follower, followee)`, no-self CHECK, `social_follows_select_own`, `insert_member` (member role, `social_enabled()`, live-member followee, tenant pin), `delete_own`. Service: PUT idempotent via `on conflict do nothing`, self-follow `400 self_follow`, non-live target bare 404, unfollow never 404. 63 module unit tests pass (run by me). pgTAP `200-social.sql` and the isolation sweep exist; I did not re-run them (see Behavioral Spot-Checks). |
| 3 | Início shows only admin posts; a member post appears only in followers' Explorar | VERIFIED for posts and reads, with the WR-02 / WR-01 side channels as gaps | Início and communities use the literal `p.visibility = 'tenant'`; Reels 'Todos' swaps in `memberPostVisible(false)`; Explorar uses `visibility='followers' and community_id is null and memberPostVisible(canModerate)`. The restrictive `feed_posts_social_gate` (SELECT) and `feed_posts_social_insert_gate` (INSERT, stamps member = followers / staff = tenant) back it in the database; comments inherit it through the `feed_posts` sub-select of `feed_comments_community_gate`. No personal feed route exists. The side channels are in the gaps block. |
| 4 | Explorar keyset-paginated, likes / comments, empty state to `/membros`; directory reopened to member only while `social` on | VERIFIED | `listFeed(scope=explorar)` on the `(created_at,id)` keyset in one statement; named partial index migration `20261019214205`; `followsAnyone` decided server-side; `ExplorarBody.tsx`; `GET /v1/members` gate by `social.participate` in `apps/api/src/routes/members.ts`; `listMembers` carries `blocked_at is null`. PROF-03 reworded in REQUIREMENTS (marked Pending until delivery: update the row at close). |
| 5 | Member profile follow button and counts, conditionally reversing D-45 | VERIFIED | `memberProfileSchema` untouched (`git diff` on `profiles.ts` since the last pre-phase commit is empty; still `.strict()`); the social variant is a separate `.strict()` schema served by `GET /v1/social/members/{membershipId}`; `SocialProfileBlock.tsx` renders it only when social is on; counts via the `app.social_counts` definer; lists private (`/me/followers`, `/me/following`, no id parameter). |
| 6 | Member uploads bounded, set per tenant by super_admin | VERIFIED with hardening warnings | Limits live in `tenant_modules['social'].settings` (defaults 5 MiB, 4 photos, video off, 60 s, 100 MiB), edited from the platform `SocialLimitsSheet`, resolved by the kernel seam `memberMediaPolicyFor`, enforced at start, complete, ready job (cap snapshotted in `duration_cap_seconds`) and publish. Gaps in the hardening, not in the criterion: WR-03 (sub-budget skipped by choosing another purpose; pending member videos uncounted; the rate limiter is a known open decision), WR-06 (ready job fails open on a null duration; Mux always reports one), WR-08 (photo cap re-judged at complete). |
| 7 | Reels follows the same visibility; like / comment on the same post | VERIFIED for lanes and playback of live posts; WR-01 applies | Admin videos for everyone; a member video only for the author's live followers and the author (`memberPostVisible(false)`, partial video index), moderator sees member videos in Explorar and not in Reels; `playbackTokens` asks `media_asset_hidden` and re-checks the viewer's followees on live posts, so an unfollow revokes playback of a live post. Not covered: a deleted post (WR-01). |

**Score:** 6 of 7 criteria are fully verified; criterion 7 and the SOCIAL-06 requirement carry the two audience-revocation gaps above.

## Decision on the review findings that touch criteria 3 and 7

- **WR-02: BLOCKER for SOCIAL-06.** Confirmed by reading the reply branch: it joins `feed_posts` but never reads `visibility`. The leaked content is another member's comment text (up to the excerpt cap), pushed and stored in the bell row of a user the gate refuses everywhere else. It needs a precondition (a follower who commented, then lost access, then got a reply), which makes it narrow, not hypothetical. It is a gap against criterion 3's intent and against the SOCIAL-06 sentence "its comment reads ... are readable only by its author, its followers and the moderator".
- **WR-01: gap (partial), not a hole for strangers.** The unfollow-on-live-post case is handled; the deleted-post video and the photo variants are not. It does not let a never-authorised non-follower play or fetch anything, because the asset id appears only in gated payloads. It does break "the moderator takedown stops distribution" for video and the migration's own header. I would not enable `social` on a real tenant before it is fixed or an explicit residual-risk record is written.
- **WR-03, WR-06, WR-08: warnings against criterion 6 hardening**, not against the criterion text.
- **WR-04 (FollowControl stale prop), WR-05 (single profile read ignores `blocked_at`): warnings.** For WR-05 I checked `member-admin.ts`: a block always sets BOTH `status = 'blocked'` and `blocked_at`, and `getMemberProfile` filters `status = 'active'`, so it is not reachable through the current code paths. Info only.
- **WR-07 (no DB backstop on member UPDATE / DELETE of `feed_posts`):** the service WHERE carries `author_user_id = ctx.userId` (checked at `updatePost`), so no exploit today; defense in depth is missing for the one column the feature protects. Warning, worth a restrictive policy.
- **IN-01 (tenants with `postingPolicy: 'members'`)** belongs in the go-live check.

## Required Artifacts (spot level)

| Artifact | Status | Details |
|----------|--------|---------|
| `packages/modules/social/{module,contracts,db,server,ui}` | VERIFIED | Substantive; mounted by the registry; 7 test files, 63 tests pass |
| 10 expand-only migrations `20261019202758..225153` | VERIFIED (exist) | Applied order matches the release order in `docs/DEPLOY.md` |
| `supabase/tests/200-social.sql`, `201-feed-social-gate.sql` | EXIST | Not re-run by me |
| `apps/api/tests/integration/{social,social-module,feed-social,social-media,moderation-posts}.test.ts`, `apps/web/e2e/{social,social-platform,phase9-smoke}.spec.ts` | EXIST | Results taken from the gate record, not re-run |
| `docs/DEPLOY.md` "Ativar a Rede social" go-live item | VERIFIED | line 2384 |
| Module README with MOD-05 headings | VERIFIED | enforced by `module-readmes.test.ts` |

## Key Links

| From | To | Status |
|------|----|--------|
| `registry.ts` effective keys | `social` composes `feed.post.create/manage` for member | WIRED |
| route `scope=explorar` | `listFeed(canModerate from permissionsForRequest)` | WIRED |
| `feed_posts` RLS gate | `app.social_visible_author_ids()` seam | WIRED |
| kernel media broker | `memberMediaPolicyFor` filled by the registry | WIRED |
| `playbackTokens` | `app.media_asset_hidden` | WIRED (deleted-post hole, WR-01) |
| `resolveCommentCreated` reply branch | social gate | NOT_WIRED (WR-02) |
| `InicioTabs` | `HubTabs` from the courses route folder | WIRED (IN-04 coupling, info) |

## Requirements Coverage

All 22 IDs (SOCIAL-01..10, FOLLOW-01..06, EXPL-01..06) are declared in the `requirements:` frontmatter of at least one of the 13 plans (union checked plan by plan) and are present in REQUIREMENTS.md with a traceability row `Phase 09 ... Complete`. No orphaned ID. V2-CONT-01 is annotated as promoted; MODER-04 is split (posts moved to SOCIAL-07; the rest still Phase 11); PROF-03 is reworded and still marked Pending: set it to Complete at close.

| Requirement | Status | Note |
|-------------|--------|------|
| SOCIAL-01, 02, 03, 04, 05, 07, 08, 09, 10 | SATISFIED | 05 with the WR-03 / 06 / 08 hardening warnings |
| SOCIAL-06 | PARTIAL | WR-02 (reply notification) and WR-01 (deleted-post video) |
| FOLLOW-01..06 | SATISFIED | WR-04 is a UI staleness, FOLLOW-05 placement matches the review's file list |
| EXPL-01..06 | SATISFIED | EXPL-06 inherits the WR-01 note |

## Anti-Patterns Found

No TBD / FIXME / XXX introduced in the reviewed list that I checked by name; no stub components. Deferred (not Phase 09 defects, recorded in `deferred-items.md`): the four comment-id routes let an admin holding a blocked author's comment id read replies (no member can reach it), and a blank `display_name` renders "Siga  para ver".

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| social module unit suite | `pnpm --filter @rede-social/module-social test` | 7 files, 63 tests pass | PASS |
| workspace typecheck + unit at HEAD | run by the orchestrator (`turbo typecheck test`) | 37/37, exit 0 | reported, not re-run |
| pgTAP 2057, integration 1538, e2e | gate record in 09-VALIDATION / 09-13-SUMMARY | not re-run: forbidden to reset the DB or start servers | SKIPPED, relied on the record |

## The e2e failures recorded as out of phase

Judged against `git diff 0c771a8d..HEAD`: Phase 09 touched none of `/configuracoes`, `admin-members.spec.ts`, `signup.spec.ts`, `admin-branding.spec.ts`, `platform-branding.spec.ts`.

| Failure | Out of Phase 09? | Reason |
|---------|------------------|--------|
| `admin-branding.spec.ts:303`, `platform-branding.spec.ts:223` | Yes | already recorded by 08.6, branding look storage / icon editor |
| `signup.spec.ts:331` | Yes | re-homed link from quick 261012-s0v, recorded by 08.3 |
| `admin-members.spec.ts` role tracer | Yes | substring locator vs the "Área de membros" row of quick 261019-k7x; page not touched here |
| `profile.spec.ts` x5 | Yes, with a caveat | same-day-seed artifact; 4 of 5 passed after moving `joined_at`; the fifth ("Conteúdo on real data") is the same cause by reading, not by run |
| `platform-domains.spec.ts` case 6 | Was a Phase 09 regression, fixed in 09-13 | switch counts; passes |

Open ledger items worth closing: WINDOWS 116 (09-10 unrun-verify) is still `open` although 09-13 reset the DB afterwards; WINDOWS 123 (gate ran in parts) is open by design.

## Gaps Summary

Two audience-revocation gaps remain, both fixable in one small plan (`/gsd-plan-phase 09 --gaps`, or a quick task, since a third gap round is not wanted):

1. Reply notification audience test (WR-02).
2. `media_asset_hidden` for soft-deleted followers-post videos, plus a recorded decision on member photo variants (WR-01).

Recommended to ride along in the same pass: WR-07 (restrictive UPDATE / DELETE policy for the member lane), WR-03 (apply the member share to every member purpose and cap pending member videos), WR-06 (reject a member video with no measured duration), WR-08 (snapshot the photo cap), and the cheap items WR-04, IN-02.

The human items (real device, sketch 012 designer review, Mux, D-478 legal text, one clean `pnpm verify`) are listed in the frontmatter and are not marked verified.

---

_Verified: 2026-10-20_
_Verifier: Claude (gsd-verifier)_
