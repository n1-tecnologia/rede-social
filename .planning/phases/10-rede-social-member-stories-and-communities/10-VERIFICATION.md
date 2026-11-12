---
phase: 10-rede-social-member-stories-and-communities
verified: 2026-11-12T18:00:00Z
status: gaps_found
score: 4/4 roadmap criteria verified; 27/28 requirement ids satisfied (MPUB-04 partial)
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-01-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-01-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-02-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-02-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-03-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-03-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-04-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-04-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-05-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-05-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-06-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-06-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-07-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-07-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-08-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-08-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-09-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-09-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-10-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-10-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-11-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-11-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-12-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-12-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-13-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-13-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-14-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-14-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-15-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-15-SUMMARY.md
  - apps/api/src/modules/registry.ts
  - apps/web/app/(app)/comunidades/CommunitiesList.tsx
  - apps/web/app/(app)/comunidades/CommunityForm.tsx
  - apps/web/app/(app)/comunidades/CommunityLimitNotice.tsx
  - apps/web/app/(app)/comunidades/[communityId]/CommunityPosts.tsx
  - apps/web/app/(app)/comunidades/[communityId]/DeleteCommunityControl.tsx
  - apps/web/app/(app)/comunidades/[communityId]/destaques/page.tsx
  - apps/web/app/(app)/comunidades/[communityId]/editar/page.tsx
  - apps/web/app/(app)/comunidades/[communityId]/page.tsx
  - apps/web/app/(app)/comunidades/actions.ts
  - apps/web/app/(app)/comunidades/nova/page.tsx
  - apps/web/app/(app)/comunidades/page.tsx
  - apps/web/app/(app)/criar/ComposerForm.tsx
  - apps/web/app/(app)/criar/actions.ts
  - apps/web/app/(app)/criar/page.tsx
  - apps/web/app/(app)/inicio/ExplorarBody.tsx
  - apps/web/app/(app)/inicio/ExplorarSkeleton.tsx
  - apps/web/app/(app)/inicio/ExplorarStoriesRow.tsx
  - apps/web/app/(app)/inicio/page.tsx
  - apps/web/app/(app)/stories/highlight-actions.ts
  - apps/web/app/(app)/stories/meus/StoryHistoryList.tsx
  - apps/web/app/(app)/stories/meus/page.tsx
  - apps/web/app/(app)/stories/publicar/StoryComposer.tsx
  - apps/web/app/(app)/stories/publicar/page.tsx
  - apps/web/app/(app)/stories/story-actions.ts
  - apps/web/app/(platform)/plataforma/tenants/[id]/modulos/page.tsx
  - apps/web/components/admin/ModerationLogRow.tsx
  - apps/web/components/feed/PostDetail.tsx
  - apps/web/components/platform/SocialLimitsSheet.tsx
  - apps/web/components/stories/HighlightManager.tsx
  - apps/web/components/stories/StoriesSurface.tsx
  - apps/web/components/stories/StoryViewerHost.tsx
  - apps/web/components/stories/StoryVisibilityNotice.tsx
  - apps/web/e2e/comunidades.spec.ts
  - apps/web/e2e/member-journey.ts
  - apps/web/e2e/social-platform.spec.ts
  - apps/web/e2e/social.spec.ts
  - apps/web/e2e/stories.spec.ts
  - apps/web/lib/communities.ts
  - apps/web/lib/feed-view.tsx
  - apps/web/lib/moderation-view.ts
  - apps/web/lib/platform.ts
  - apps/web/lib/registry.tsx
  - apps/web/lib/social-limits.ts
  - apps/web/lib/stories.ts
  - apps/web/lib/story-view.ts
  - packages/contracts/src/moderation.ts
  - packages/core/db/schema/moderation-log.ts
  - packages/core/server/communities/action-gate.ts
  - packages/core/server/communities/member-policy.ts
  - packages/core/server/media/member-policy.ts
  - packages/core/server/media/member-share.ts
  - packages/core/server/media/service.ts
  - packages/core/server/moderation/log.ts
  - packages/core/server/safety/index.ts
  - packages/core/server/safety/limits.ts
  - packages/modules/communities/contracts/index.ts
  - packages/modules/communities/db/schema.ts
  - packages/modules/communities/module.ts
  - packages/modules/communities/server/routes.ts
  - packages/modules/communities/server/service.ts
  - packages/modules/communities/ui/CommunityCard.tsx
  - packages/modules/communities/ui/CommunityHeader.tsx
  - packages/modules/feed/contracts/index.ts
  - packages/modules/feed/db/schema.ts
  - packages/modules/feed/server/notifications.ts
  - packages/modules/feed/server/routes.ts
  - packages/modules/feed/server/service.ts
  - packages/modules/feed/ui/FeedList.tsx
  - packages/modules/feed/ui/PostCard.tsx
  - packages/modules/feed/ui/PostMenu.tsx
  - packages/modules/social/contracts/index.ts
  - packages/modules/stories/contracts/index.ts
  - packages/modules/stories/db/schema.ts
  - packages/modules/stories/server/notifications.ts
  - packages/modules/stories/server/routes.ts
  - packages/modules/stories/server/service.ts
  - packages/modules/stories/ui/HighlightSheet.tsx
  - packages/modules/stories/ui/StoriesStrip.tsx
  - packages/modules/stories/ui/StoryCircle.tsx
  - packages/modules/stories/ui/index.ts
  - scripts/seed.ts
  - supabase/migrations/20261111143858_member_communities_functions.sql
  - supabase/migrations/20261111143948_member_communities.sql
  - supabase/migrations/20261111144148_feed_community_audience.sql
  - supabase/migrations/20261111144205_feed_member_update_allowlist.sql
  - supabase/migrations/20261111145716_member_stories.sql
  - supabase/migrations/20261111150352_story_media_gate.sql
  - supabase/migrations/20261111151218_moderation_member_content.sql
  - supabase/migrations/20261111163020_member_stories_authors.sql
covered_digest: "v1:sha256:ae3a91269a4f77ada0c105ed5d330d674224bbf8a82863a3f563d8098d4c48f3"
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "MPUB-04: the member lane is bounded by RESTRICTIVE RLS gates on communities, stories, story_highlights, story_highlight_items and feed_posts that refuse (42501) a forged kind, owner, audience or non-owner write"
    status: partial
    reason: "Gates exist and are proven by pgTAP 230/231/232 for communities (kind insert, member update, delete, hidden creator), stories (insert audience gate, select audience gate), story likes/comments, and feed_posts (member insert gate, update allow-list). They do NOT exist for story_highlights, story_highlight_items, nor for UPDATE/DELETE on stories (only stories_tenant_isolation, tenant predicate only), and the staff branch of feed_posts_social_insert_gate has no community-kind term. The owner rule on those paths is enforced only by the API service layer. This is within one tenant (not a cross-tenant leak) and only reachable by a lane that already holds an authenticated-role database connection; the API is the sole writer today."
    artifacts:
      - path: "packages/modules/stories/db/schema.ts"
        issue: "only stories_audience_gate (select) and stories_social_insert_gate (insert) added; no UPDATE/DELETE gate; story_highlights and story_highlight_items have no Phase 10 policy (review WR-03)"
      - path: "supabase/migrations/20261111144148_feed_community_audience.sql"
        issue: "staff branch `app.tenant_role() <> 'member' and visibility = 'tenant'` accepts any community_id, so an admin lane could insert a 'tenant' post into a member community at the database; service docblock at packages/modules/feed/server/service.ts:1212 says RLS says the same, which is false (review WR-04)"
    missing:
      - "Restrictive UPDATE/DELETE gates (or an invoker guard trigger) on stories, story_highlights, story_highlight_items for the member claim (author or owned member community only), with pgTAP negatives (WR-03)"
      - "A community-kind term on the staff branch of feed_posts_social_insert_gate, or correct the docblock if Igor decides not to add it (WR-04)"
      - "Or: Igor accepts the deviation by override (see Gaps Summary) and the requirement text is narrowed to the gates actually shipped"
advisory: []
human_verification:
  - test: "P1: member story composer, create-community entry and Explorar story row on a real phone with the installed PWA"
    expected: "Own circle 'Seu story' with the + badge publishes; follower sees the unseen circle and opens the grouped viewer; new community listed after organization cards with 'Criada por'; stranger sees no publish control"
    why_human: "A phone cannot reach *.localhost; needs a homolog or production host and Igor's hand"
  - test: "P2: social switched off then on in a live per-tenant project"
    expected: "Writes stop, member communities/posts/highlight story stay readable, moderator keeps removing, on restores everything with no row changed"
    why_human: "Needs a hosted tenant project with the eight Phase 10 migrations applied"
  - test: "P3: viewer menus and destination sheet at 320px on a real device"
    expected: "Reachable with a thumb, not clipped, delete dialogs read right in both copy variants"
    why_human: "Real-device layout"
  - test: "P4: held-out backstops E02, E04, E06, E08, E09"
    expected: "No clipping or horizontal scroll at 320px, screen reader names read well"
    why_human: "Visual and accessibility, no automated assertion"
  - test: "P5-P9: planner assumptions A1..A12, UI-SPEC defaults OQ-1..OQ-7, D-478 legal wording, owner-dashboard counts decision, release order"
    expected: "Igor confirms or overturns each in 10-MANUAL-PROOFS.md"
    why_human: "Owner decisions and deploys; an agent never records these as passed"
---

# Phase 10: Rede Social - Member Stories and Communities Verification Report

**Phase Goal:** With "Rede social" on, members also publish stories and create their own communities, and a community only accepts publications from its owner: the creator for a member-created community, any `admin_tenant` for an organization community (D-706).
**Verified:** 2026-11-12
**Status:** gaps_found (one partial requirement, MPUB-04, database defense-in-depth; all four roadmap criteria hold)
**Re-verification:** No, initial verification

## Goal Achievement

The goal and the four roadmap criteria are delivered and proven in code, by pgTAP, by API integration tests and by component tests. What fails is a literal clause of one requirement (MPUB-04: database gates on highlight tables and on stories UPDATE/DELETE), which is a within-tenant defense-in-depth gap that the code review already recorded as WR-03/WR-04 and left for Igor to decide. Because "absence of implementation is observable" for those gates, it is recorded as a gap rather than waved through, but it does not break any of the four roadmap truths.

### Observable Truths (ROADMAP success criteria + amendments)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | With social on a member publishes stories; Início's grouped circle stays admin-only; a member's active stories show in Explorar for followers, one circle per author | VERIFIED | `supabase/migrations/20261111145716_member_stories.sql:20-43` (`stories.visibility`, insert gate `member -> 'followers'` and `social_enabled()`, audience gate); `apps/api/tests/integration/member-stories.test.ts:274` (publish 201, stored `followers`), `:303` (Início strip holds the admin's story not Helena's), `:473/:532` (Início strip and highlight organization only), `:725` (Alvaro reads Helena's circle, not Marcos's, seven keys); `apps/web/lib/registry.tsx` `storyPublishDoorFor('inicio', ...)` requires `content.publish` so members get no Início circle; `ExplorarBody.tsx:129,178` wires `ExplorarStoriesRow` to `GET /v1/stories/authors` (`stories/server/routes.ts:184`). pgTAP 231 passed (see spot-checks) |
| 2 | With social on a member creates a community (and its highlights) | VERIFIED | `packages/modules/communities/server/service.ts` (create stamps `kind='member'`, creator from ctx, sentinel position 1000000, advisory-locked limit); migration `20261111143948_member_communities.sql:15` (`communities_kind_insert_gate`); integration `member-communities.test.ts:221` (create 201, stored kind member), `:235` (strict body: no kind/creator/position), `:511/:603` (limit, N+1 parallel creates leave N); highlights `member-stories.test.ts:1496` (creator creates/renames/reorders/deletes highlights of her community) |
| 3 | Only a community's owner publishes in it (posts, stories, highlights): creator alone for a member community, any admin_tenant for an organization community; others and an admin on a member community get no publish control and a 403 | VERIFIED | Posts: `packages/modules/feed/server/service.ts:1230-1268` `resolveCommunityTarget` (404 → owner decision by kind → 403 → 400 archived); `member-communities.test.ts:265` (Marcos and the lab admin get 403, nothing stored, Helena's post is the positive control), `:332` (Marcos on an organization community 403, admin posts 201). Stories/highlights: `member-stories.test.ts:1283` (Marcos 403 and the lab admin 403 on Helena's community; admin's organization highlight works), `:1351` (IDOR: cannot add another's story, bare 404), `:1407` (non-owner curation 403 on every write), `:1540` (curator is place-dependent). Web: `viewer.actions` / `viewer.canCurate` from `communities/server/service.ts:293-301`; `comunidades/[communityId]/page.tsx:287,351,407` read only the API flags; page tests 22-24 assert admin on member community gets no curator menu, creator gets it. Admin pickers list organization communities only: `member-stories.test.ts:1681` (EP-51/MPUB-06) |
| 4 | Turning social off stops new member stories and communities; existing member communities stay readable | VERIFIED | Insert gates read `app.social_enabled()` from SQL (`communities_kind_insert_gate`, `stories_social_insert_gate`, `feed_posts_social_insert_gate`); `social-module.test.ts:511` (warm flags cache: every member write 403, never 500), `:575` (cache expired: writes 403, community/post/highlight/saved story stay readable with like and comment, moderator works), `:715` (on again restores, no row rewritten); `member-stories.test.ts:387/:1697`; `moderation-member-content.test.ts:301/:464/:659` (moderator keeps working off). Accepted, documented residual: a loose member story cannot be read by a moderator with social off (pgTAP 231 section 3, `docs/DEPLOY.md`) |
| 5 | Moderation (D-711): holder of `moderation.manage` soft-deletes any member story and archives/removes any member community (and a single community post), each with a `moderation_log` row in the same transaction | VERIFIED | migration `20261111151218_moderation_member_content.sql`; `moderation-member-content.test.ts:179` (archive then delete write two rows in order), `:274` and `:638` (forced log failure rolls the write back), `:592` (story_removed row), `:402` (post_removed in a member community, count reconciled); `packages/core/server/moderation/log.ts` refuses subject/action pairs the CHECK would refuse; web `ModerationLogRow.tsx`/`moderation-view.ts` |

**Score:** 5/5 truths verified (4 roadmap criteria plus the D-711 amendment). Real-device behaviour is not part of this score (see Human Verification).

### Requirement Coverage (all 28 phase ids; every id appears in a PLAN frontmatter and in REQUIREMENTS.md)

| Requirement | Plans | Verdict | Key evidence |
|-------------|-------|---------|--------------|
| MCOMM-01 stamp kind/creator, strict body | 03,05,13,15 | SATISFIED | `member-communities.test.ts:221,:235`; pgTAP 230 |
| MCOMM-02 whole-tenant list/open, no lock | 06,13 | SATISFIED | `member-communities.test.ts:955` (every live member opens it) |
| MCOMM-03 org first then member, sentinel, reorder org-only | 06,13 | SATISFIED | `:955,:1369,:1412`; CHECK `communities_member_position_chk` |
| MCOMM-04 `createdBy` safe fields, `viewer`, `memberQuota`, no user id | 06,13 | SATISFIED | `:955` (uuid scan), `:1045`; `communities/server/service.ts:215-340` |
| MCOMM-05 per-member limit, lock, platform edit | 05,11,13 | SATISFIED | `:511,:528,:579,:603`; `SocialLimitsSheet.tsx`; core `member-community-policy.test.ts` (run green) |
| MCOMM-06 creator edit/archive/reactivate/delete/curate, no products, no reorder | 05,09,13,14 | SATISFIED | `:663,:704,:745,:776`; `member-stories.test.ts:1496` |
| MCOMM-07 blocked/departed creator hides everything | 03,06,14 | SATISFIED (with WR-05 residual for video tokens) | `:1437,:1510`; `member-stories.test.ts:1729`; policy `communities_member_hidden_gate` |
| MCOMM-08 community post only on its page | 03,06,11,15 | SATISFIED | `:282,:295,:1237,:1259`; Início predicate is the literal `p.visibility = 'tenant'`, Explorar `'followers' and community_id is null` (`feed/server/service.ts:538-567`); pgTAP 232 |
| MCOMM-09 Reels lanes after organization, Todos excludes | 06 | SATISFIED | `reels.test.ts` 10-06 block (EP-32..34), `member-communities.test.ts:295` |
| MCOMM-10 moderator archive/remove with log | 04,05,11,14 | SATISFIED | `moderation-member-content.test.ts:179,:301` |
| MCOMM-11 moderator removes one community post | 06 | SATISFIED | `moderation-member-content.test.ts:402`; WR-01 fixed (flag reaches the menu), `community-removal-flag.test.ts` 5/5 re-run green |
| MPUB-01 owner rule, 403, no control | 05,09,14,15 | SATISFIED | see truth 3 |
| MPUB-02 composed member permissions, ownership in the statement | 05,12 | SATISFIED | `apps/api/src/modules/registry.ts` (`permissionsFor`), `social-module.test.ts:119,:196` |
| MPUB-03 creator publishes member post in own community, audience 'community' | 05,14 | SATISFIED | `member-communities.test.ts:250,:471` |
| MPUB-04 RESTRICTIVE RLS gates on the five tables | 03,04 | **PARTIAL** | see Gaps: `communities`, `stories` insert/select, likes/comments, `feed_posts` insert + update allow-list shipped and proven (pgTAP 230/231/232 re-run, 237 assertions ok); `story_highlights`, `story_highlight_items`, stories UPDATE/DELETE and the staff-lane community term not shipped (WR-03, WR-04) |
| MPUB-05 social off semantics | 05,08,10,13,14,15 | SATISFIED | see truth 4 |
| MPUB-06 admin pickers organization only | 09,14 | SATISFIED | `member-stories.test.ts:1681` |
| MPUB-07 isolation + pgTAP + expand-only + DEPLOY.md + seed | 03,04,08,10,15 | SATISFIED | `pnpm db:generate` printed "No schema changes"; `docs/DEPLOY.md:4454` "Phase 10 release"; `scripts/seed.ts:788-798` seeds a member community and story; eight migrations are additive (reviewed headers); isolation sweep in plan 10-10 |
| MSTORY-01 member story stamp, 24h, limits | 07,12,15 | SATISFIED | `member-stories.test.ts:274,:317` |
| MSTORY-02 Início org-only | 07 | SATISFIED | `:303,:473,:497,:532` |
| MSTORY-03 Explorar one circle per author, order, moderator cursor | 08,12,15 | SATISFIED | `:725,:977,:1023` |
| MSTORY-04 member story audience in RLS and statement, safe author wire | 04,08,11 | SATISFIED | pgTAP 231; `:783` (Marcos bare 404 on group read, story id, like, comment), `:642` (uuid scan) |
| MSTORY-05 likes/comments, no publish notification | 07 | SATISFIED | `:340` |
| MSTORY-06 creator saves own story in own community highlight, readable by all incl. after 24h and with social off | 09,12 | SATISFIED | `:1212,:1238,:1259,:1351` |
| MSTORY-07 member media seam story + cover purposes | 07 | SATISFIED | core `member-media-policy.test.ts`; `social-media.test.ts` |
| MSTORY-08 blocked/removed author's stories leave Explorar and 404 | 04,08 | SATISFIED | `:1077,:1113` |
| MSTORY-09 author deletes own, moderator deletes with log | 04,07,11,12 | SATISFIED | `:594`; `moderation-member-content.test.ts:592` |
| UI-04 (gate reference only; stays owned by Phase 2) | 01,02,11-15 | SATISFIED as a gate reference | sketch 020 `approved: true`, provisional by Igor 2026-11-11 (commit 30ce8537); still provisional, P3/P4/P6 pending |

No orphaned requirement ids: REQUIREMENTS.md maps MCOMM-01..11, MPUB-01..07, MSTORY-01..09 to Phase 10 and each appears in at least one PLAN `requirements` field.

### Required Artifacts / Key Links

| Artifact | Status | Details |
|----------|--------|---------|
| 8 migrations `20261111143858`..`20261111163020` | VERIFIED | exist, additive, drizzle snapshot in sync (`pnpm db:generate` -> "No schema changes") |
| `resolveCommunityTarget` (feed) | VERIFIED | owner seam in the post's own transaction; wired from `createPost` at `service.ts:1331` before asset validation |
| `viewerOf` / `communityViewerFlags` (communities) | VERIFIED | WR-02 fix present at `service.ts:293-301`; consumed by `[communityId]/page.tsx` |
| `ExplorarStoriesRow` + `loadStoryAuthors` | VERIFIED | wired in `ExplorarBody.tsx`; data from a real `/v1/stories/authors` read (FLOWING) |
| `app.community_action_allowed` stub + `communityActionAllowed` | VERIFIED neutral | see Escopo hook check |
| `docs/DEPLOY.md` "Phase 10 release" | VERIFIED | line 4454 |
| `10-MANUAL-PROOFS.md` | VERIFIED | exists, P1..P9 all `pending` |

### Escopo hooks are behaviour-neutral (checked)

- `app.community_action_allowed`: `select false`, security definer, `search_path = ''`, executes granted to `authenticated` only (`20261111143858_member_communities_functions.sql:69-73`). The only caller is branch 3 of `resolveCommunityTarget` (`feed/server/service.ts:1257-1259`), reached only when the caller is a member, the community is `organization` kind and branch 2 (`!isMember`) did not apply; with the stub `false` the code falls to the 403 that existed before. The TS wrapper requires a strict `=== true`, so a null never grants.
- Owner branch 3: it is evaluated last and never taken; pgTAP 230/232 and `member-communities.test.ts:332,:354` pin the stub false for the five actions and the 403 on an organization community for a member.
- `viewer.actions`: `like/comment/share` constant true, `post = canPublish`, `story = canStory`. After the WR-02 fix `story` reproduces the pre-Phase-10 gate for organization communities (`stories.story.publish` and `stories.story.manage`). The web reads it in exactly two places (`[communityId]/page.tsx:351`, `stories/publicar/page.tsx`), both as a show/hide of a door whose route re-checks the permission. No server decision uses `actions`. Neutral.

### Review findings re-checked against the code

| Finding | State | Evidence |
|---------|-------|----------|
| WR-01 moderator removal flag | FIXED, asserted | `feed/server/service.ts:317-322` emits `removal: 'moderation'` for followers and community; `listCommunityFeed` takes `canModerate` and the route passes it (`routes.ts:457`); `community-removal-flag.test.ts` 5 cases, re-run green |
| WR-02 story door on the post rule | FIXED, asserted | `communities/server/service.ts:293-301`; `viewer-story-action.test.ts` 8 cases, re-run green. The integration matrix in `member-communities.test.ts:1065` still asserts `story == canPublish` per viewer (valid only while the `stories` module is on; wording looser than the rule, not a failure) |
| WR-06 curator menu keyed on permission | FIXED, asserted | `[communityId]/page.tsx:407` `canCurate: viewer.canCurate`; `page.test.tsx` cases 22-24, file re-run 24/24 green. `/stories/[storyId]/page.tsx` deliberately left alone (no per-community flag exists on a deep link) |
| WR-03 no UPDATE/DELETE gate on stories, story_highlights, story_highlight_items | OPEN | confirmed by grep: the only Phase 10 story policies are `stories_audience_gate` and `stories_social_insert_gate` |
| WR-04 staff branch lacks a community-kind term; docblock claim false | OPEN | confirmed at `20261111144148_feed_community_audience.sql` (`app.tenant_role() <> 'member' and visibility = 'tenant'`) |
| WR-05 video of a hidden member community's post still gets a playback token | OPEN | review-confirmed; story legs apply the hidden-community term, the post leg does not |

Impact of the three open ones: all are within one tenant, none lets a member of tenant A reach tenant B, and none is reachable through any route (every write goes through the API service, which carries the owner checks and has tests). They matter for the project rule "RLS defense-in-depth on every table" and for the literal text of MPUB-04. WR-04 would put member-community content under the Administrador mark in Início only if an admin-claim database lane were driven directly. WR-05 is the same id-capability class as the accepted photo residual but applies to video. None breaks a roadmap success criterion or the zero-leakage-between-tenants core value, so they gate nothing except MPUB-04's literal wording.

### Behavioral Spot-Checks (run by this verifier)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Member communities, member stories, community audience RLS | `pnpm supabase test db supabase/tests/000-helpers.sql 230-member-communities.sql 231-member-stories.sql 232-feed-community-audience.sql` | 4 files ok, 237 tests, PASS | PASS |
| WR-01 flag | vitest `packages/modules/feed` `tests/community-removal-flag.test.ts` | 5/5 | PASS |
| WR-02 story door | vitest `packages/modules/communities` `tests/viewer-story-action.test.ts` | 8/8 | PASS |
| WR-06 curator menu + community page | vitest `apps/web` `[communityId]/page.test.tsx` | 24/24 | PASS |
| Explorar row + story publish screen | vitest `apps/web` `ExplorarStoriesRow.test.tsx`, `stories/publicar` | 57/57 (3 files) | PASS |
| Kernel seams | vitest `packages/core` `member-community-policy`, `community-action-gate`, `moderation-log` | 27/27 (3 files) | PASS |
| Schema drift | `pnpm db:generate` | "No schema changes" | PASS |
| Debt markers (TBD/FIXME/XXX) in 90 files changed by the phase | grep | none | PASS |
| Attribution | `git log` over the phase commits | 0 Co-Authored-By trailers | PASS |

Not re-run by this verifier (taken from the orchestrator's evidence, not independently confirmed): the 141-file API integration suite (2956 tests), the 65-file pgTAP suite, the 8429 web tests, lint/typecheck/build and the Playwright journeys.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `packages/modules/feed/server/service.ts:1212` | comment asserts RLS enforces the creator rule on staff lanes; it does not (WR-04) | Warning | will mislead the next reviewer |
| `apps/web/app/(app)/comunidades/actions.ts:303` | stale "409" for `limit_reached` (it is 400) (IN-01) | Info | comment only |
| `apps/api/src/routes/media.ts:129` | OpenAPI text still says member video only for `post` (IN-02) | Info | published description drift |
| `packages/modules/stories/server/service.ts:526` | `scope.isMember` accepted, never read (IN-03) | Info | dead input |
| `communities_member_update_gate` | staff UPDATE may change `kind` (IN-04) | Info | no API path does it |
| `safety/limits.ts` | per-instance limiters (IN-05) | Info | soft ceiling on Cloud Run |

### The red full `pnpm e2e` stage (weighed, stated as inference)

118 failures, none in a Phase 10 spec; `e2e:pwa` never reached. No baseline at the pre-phase commit exists, so "pre-existing" cannot be proved. The inference holds on code evidence: `git diff` over the 122 phase commits shows no change to the API tenant-create route (the `POST /v1/platform/tenants` 400 group), no change to the navigation or shell, and no change to the web Reels pages (desktop Reels group). The only Reels-related change is an additive integration test and the feed service's lane query for member communities (backend). The nav-tab and `/area-membros` groups are specs not updated for the November front rework. The one cross-cutting change that could reach those specs is `permissionsFor` in `apps/api/src/modules/registry.ts` (members now hold `stories.story.publish`, `communities.community.create/manage_own` with `social` on); a rerun of the red groups at the commit before 5658ff1c would turn the inference into proof. This does not block the verdict but it is an unproved assumption.

### Human Verification Required

P1 to P9 in `10-MANUAL-PROOFS.md` all ship `pending`; only Igor can pass them (real phone on a homolog or production host, a live per-tenant project for the `social` switch, 320px viewer menus, five held-out visual/accessibility backstops, twelve planner assumptions, UI-SPEC defaults OQ-1..OQ-7, the D-478 wording, the owner-dashboard counts decision and the release order with the A7 web-first exception). Sketch 020's approval is provisional.

### Gaps Summary

One gap: MPUB-04 is partial. Phase 10 shipped the restrictive database gates for `communities`, `stories` (insert and select), story likes/comments and `feed_posts` (insert and update allow-list), but not for `story_highlights`, `story_highlight_items`, stories UPDATE/DELETE, nor the community-kind term on the staff insert branch (WR-03, WR-04). The API enforces the owner rule on those paths and the tests prove it, so the four roadmap criteria hold; only the database second layer named in the requirement text is missing. Two ways to close it: (a) one small expand-only migration plus pgTAP negatives (restrictive UPDATE/DELETE gates for the member claim on stories and highlight tables, a community-kind term on the staff branch) and, with it, WR-05's third `media_asset_hidden` leg; or (b) accept by override and narrow MPUB-04's wording. If Igor chooses (b), add:

```yaml
overrides:
  - must_have: "MPUB-04: the member lane is bounded by RESTRICTIVE RLS gates on communities, stories, story_highlights, story_highlight_items and feed_posts"
    reason: "Highlight/item and stories UPDATE/DELETE gates and the staff community-kind term are within-tenant defense in depth; the API is the only writer and is tested; closed later by a hardening migration"
    accepted_by: "Igor"
    accepted_at: "<ISO timestamp>"
```

Status would then move to `human_needed` (the P1..P9 ledger).

### Open items (not gaps)

- Accepted/known: a loose member story is unreadable to a moderator with `social` off (pgTAP 231 section 3, `docs/DEPLOY.md`); A7 web-first release order; `/stories/[storyId]` deep link still headed by the tenant name; store product pickers still list member communities; `/post/[postId]` "sai de Explorar" wording for community posts, and the new `feed.deleteCommunity.body` / `feed.removeCommunity.body` keys await Igor; the EP-53 empty-database literal was never run; sketch 020 approval is provisional.
- Docs drift to fix when touched: `member-communities.test.ts:1065` asserts `story == canPublish`; IN-01..IN-05.
- Not re-verified here: the full e2e stage (red, not Phase 10, inference above), `e2e:pwa` (never reached).

---

_Verified: 2026-11-12_
_Verifier: Claude (gsd-verifier)_
