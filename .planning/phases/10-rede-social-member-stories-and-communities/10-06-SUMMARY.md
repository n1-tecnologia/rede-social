---
phase: 10-rede-social-member-stories-and-communities
plan: 06
subsystem: api
tags: [member-communities, reads, projection, viewer-flags, escopo-seam, reorder, visibility, reels, moderation, D-701, D-702, D-703, D-708, D-712, D-616]

requires:
  - phase: 10-03
    provides: "communities.kind, the sentinel position 1000000, communities_member_hidden_gate, the 'community' post audience"
  - phase: 10-05
    provides: "the member creator rule (owner seam, kind stamp, limit policy), memberPostVisible with includeCommunity, withCommunitiesEnabled and withStoriesEnabled test helpers"
provides:
  - "communitySummarySchema carries kind, createdBy (exactly membershipId, displayName, avatarAssetId, or null) and viewer { isOwner, canPublish, canEdit, canCurate, actions { like, comment, share, post, story } }; the list page carries memberQuota { ownedActive, limit } | null"
  - "one projection (two LEFT JOINs, member rows only, live creator) shared by list, detail, create and update; the creator's user id is never selected (is_owner is a boolean computed in the statement)"
  - "communityViewerFlags(granted): the route reads the permission set once and hands the service booleans; viewer flags and the Escopo actions object are computed at one site (viewerOf)"
  - "reorderCommunities scoped to kind = 'organization' in the lock, the comparison and the renumber; a member id in the body is order_stale"
  - "explicit liveness and viewer-block predicates on the community list, detail, community feed and Reels lanes (blocked or departed creator: bare 404 for everyone; viewer-blocked creator: absent for that viewer only)"
  - "a holder of moderation.manage removes ONE post inside a member community (post_removed row in the same transaction, creator not told, works with social off)"
  - "A4: no notification for a community post, a comment, a reply or a like on one (explicit early returns in the like and reply resolvers)"
affects: [10-07, 10-08, 10-09, 10-11, 10-12, 10-13, 10-14, escopo phase (after Phase 11), phase 11 (notifications decision)]

actuals:
  tokens: 32600
  tasks: 3
  commits: 7

tech-stack:
  added: []
  patterns:
    - "The viewer's flags are computed on the server from booleans the route derives from the composed permission set; the host never compares a role or an id"
    - "Ownership as a boolean in the statement (is_owner) so a user id never has to be selected to answer it"
    - "A scalar InitPlan column (quota_owned_active) carries a per-caller count with the page, keeping the list one statement"
    - "A visibility fragment written twice, side by side, because modules may not import each other (communities MEMBER_COMMUNITY_VISIBLE, feed MEMBER_COMMUNITY_VISIBLE)"

key-files:
  created: []
  modified:
    - packages/modules/communities/contracts/index.ts
    - packages/modules/communities/server/service.ts
    - packages/modules/communities/server/routes.ts
    - packages/modules/communities/tests/contracts.test.ts
    - packages/modules/communities/tests/events.test.ts
    - packages/modules/communities/tests/order.test.ts
    - packages/modules/feed/server/service.ts
    - packages/modules/feed/server/notifications.ts
    - packages/modules/feed/tests/notification-sources.test.ts
    - apps/api/tests/integration/member-communities.test.ts
    - apps/api/tests/integration/reels.test.ts
    - apps/api/tests/integration/moderation-member-content.test.ts
    - apps/api/tests/integration/reports-blocks.test.ts
    - apps/api/tests/integration/communities.test.ts
    - apps/web/app/(app)/comunidades/CommunitiesList.test.tsx
    - apps/web/app/(app)/comunidades/actions.test.ts
    - apps/web/lib/communities.test.ts
    - apps/web/lib/feed-suggestions-view.test.ts
    - apps/web/lib/profile-activity.test.ts

key-decisions:
  - "A3 embodied (separable, Task 3): softDeletePostInTx's moderator branch takes visibility in ('followers','community') with a live author; the post_removed row, the silence and the social-off behaviour are the Phase 9 path unchanged; an organization post stays author-only. Dropping it is the one commit 4f8f57c1 and MCOMM-11"
  - "A4 embodied: a 'community' post, and a comment, a reply or a like on one, produce no notification, push or in-app row. The plan said the resolvers already returned [] for every audience but 'tenant' and 'followers'; that was true for the post and root-comment resolvers only, so the like resolver and the reply branch got explicit early returns (see deviations)"
  - "A12 embodied: a community whose creator the viewer blocked is absent from the viewer's list and answers the bare 404 by id and on its feed, mirroring getPost; it is unchanged for every other viewer and for the blocked creator"
  - "viewer.actions (Escopo seam): five booleans, .strict(), required inside viewer, computed in viewerOf from the same locals as the four flags; post and story equal canPublish, like, comment and share are true; no per-row grant lookup, no extra statement"
  - "isOwner is true only for the creator of a MEMBER community (kind = 'member' and created_by_user_id = the caller): an admin who created an organization community is not its 'owner', consistent with plan 05's ownership rule"
  - "canEdit and canCurate on a member community require the member KEY as well as ownership (isOwner and manage_own, isOwner and stories.story.publish), and canEdit is also true for a holder of manage; stricter than the plan's 'isOwner or canManage' so a flag never promises a write the route refuses"
  - "the new wire keys are REQUIRED (kind, createdBy, viewer, memberQuota), not optional: the contract file carries no older-web note, and a .strict() schema in an older web rejects any new key whether or not the new schema marks it optional. The API and the web must therefore deploy together for the communities screens"

patterns-established:
  - "Plan-text claims about 'already returns []' are verified against the statement, not the docblock: the like resolver had no visibility term at all"

requirements-completed: [MCOMM-02, MCOMM-03, MCOMM-04, MCOMM-07, MCOMM-08, MCOMM-09, MCOMM-11]

coverage:
  - id: D1
    description: "Tracer: the whole tenant lists a member community after the organization's (admin order, then activity), labelled with the creator's three safe fields; no user id in any response; every live member opens it; its posts and its videos live on its page only (a follower of the creator, the creator and the moderator on Inicio, Explorar and Reels Todos)"
    requirement: MCOMM-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/member-communities.test.ts#10 reads (cases 1-3, EP-05..09, EP-12, EP-13, EP-29..31)"
        status: pass
      - kind: unit
        ref: "packages/modules/communities/tests/contracts.test.ts#10-06 (createdBy exactly three keys, kind, memberQuota)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Escopo seam viewer.actions: five booleans on the list item and the detail for the creator, another member, the lab admin on an organization and on a member community, and a real support session; post and story equal canPublish, like, comment and share true; contract rejects a missing or sixth key"
    requirement: MCOMM-04
    verification:
      - kind: integration
        ref: "member-communities.test.ts#10 reads case 3"
        status: pass
      - kind: unit
        ref: "packages/modules/communities/tests/contracts.test.ts#Escopo seam"
        status: pass
    human_judgment: false
  - id: D3
    description: "Reorder scoped to organization communities: a member community keeps position 1000000 after an admin reorder, a body naming one is order_stale, with zero organization communities a reorder naming a member one is order_stale and an empty body stays 400"
    requirement: MCOMM-03
    verification:
      - kind: integration
        ref: "member-communities.test.ts#10 visibility (D-712, EP-11)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A blocked or departed creator hides the community on the list, the detail, its feed and a like for a member and the moderator, the remaining items keep their order and the cursor pages without skipping, unblocking restores every byte; a viewer-blocked creator's community is absent for that viewer only and 404 by id"
    requirement: MCOMM-07
    verification:
      - kind: integration
        ref: "member-communities.test.ts#10 visibility (EP-28, A12); reports-blocks.test.ts#10-06 (A12)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Reels lanes: member lanes after organization lanes, a member community with exactly one ready video has one lane with one item, pending or failed only has none, Todos never lists a member-community video for a follower of the creator"
    requirement: MCOMM-09
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/reels.test.ts#10 Reels lanes of member communities (EP-32..34)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A moderator removes one post inside a member community with one post_removed row, the community and its other posts intact, post_count reconciled, the creator told nothing; own delete writes no row; repeat is the bare 404; works with social off; a blocked creator's post is 404 even for the moderator; an organization post stays author-only; a report resolved as remove_content removes it with the same row"
    requirement: MCOMM-11
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/moderation-member-content.test.ts#10 community post removal (7 cases)"
        status: pass
    human_judgment: false
  - id: D7
    description: "A4: no notification for a community post, a comment, a reply or a like on one"
    requirement: MCOMM-08
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/notification-sources.test.ts#10-06 A4 (4 cases)"
        status: pass
    human_judgment: false

duration: 70min
completed: 2026-11-11
status: complete
plan_head_before: c77085dd0a75c5bd87b2adaecd7906ab77fb1366
commits: 7
---

# Phase 10 Plan 06: The Read Side of the Creator Rule Summary

**Every community read now says whose community it is and what this viewer may do there (creator projected as three safe fields, the four flags plus the five-action `viewer.actions` object, the caller's `memberQuota`), the admin reorder never touches a member community, a blocked or departed creator hides the community while a viewer's own block hides it for that viewer only, and a moderator can remove one post inside a member community with its log row.**

## Performance

- **Duration:** about 70 min
- **Completed:** 2026-11-11
- **Tasks:** 3 of 3, each with its red commit first; the tracer's automated verify ran green before the expansion tasks
- **Files:** 0 created, 19 modified (9 under `packages/`, 5 API integration files, 5 web test fixtures)

## Accomplishments

- **Tracer (Task 1):** one projection (`communityProjection(ctx, extra)`) with two LEFT JOINs that match MEMBER rows only and a live creator; `is_owner` is a boolean in the statement, so the creator's user id is never selected. `viewerOf` computes the four flags and the Escopo `actions` object from `communityViewerFlags(granted)`, which the route builds from one `permissionsForRequest` call. `memberQuota` rides the first row as an uncorrelated scalar InitPlan, so the list stays ONE statement against the community tables (the query-budget test still passes); only an empty page asks a second, cheap count.
- **Visibility and order (Task 2):** `c.kind = 'organization'` in the reorder lock, comparison and renumber; `MEMBER_COMMUNITY_VISIBLE` on the list, the detail, the community feed and the Reels lanes.
- **Moderator removal (Task 3):** one literal widened in the moderator branch of `softDeletePostInTx`, which `removeReportedContentInTx` shares, so a report resolved as `remove_content` takes a community post too.
- **Notifications (A4):** unit cases pin that nothing is produced for the community audience.

## Task Commits

1. **Task 1 RED:** `708b1e2f` (test): contract, unit and integration cases (8 integration cases and 3 contract cases failing; the guards that already held are noted below).
2. **Task 1 GREEN:** `d99a38ac` (feat): projection, flags, quota, route, A4 early returns, unit and web fixture follow-through.
3. **Task 2 RED:** `2f248690` (test): reorder (500 where `409 order_stale` is due) and the viewer-block hide.
4. **Task 2 GREEN:** `693d6768` (feat): org-only reorder and the explicit predicates.
5. **Task 3 RED:** `6f2a3208` (test): the moderator's removal (404 where 200 is due).
6. **Task 3 GREEN:** `4f8f57c1` (feat): the `'community'` audience in the moderator branch.
7. **Refactor:** the last commit rewords one docblock so the contract file never names the forbidden field (acceptance grep).

**Plan metadata:** this SUMMARY is committed separately. STATE.md and ROADMAP.md were not touched. Nothing was pushed and no hosted project was touched.

## Verification

- Module tests: communities 73, feed 337, api unit 134; `tsc --noEmit` through turbo for module-communities, module-feed and api; `pnpm boundaries` clean; Biome clean on every touched package and on `apps/api`.
- Integration, one invocation, 182 tests in 7 files: `member-communities`, `reels`, `communities`, `reports-blocks`, `moderation-member-content`, `moderation-posts`, `feed-query-budget`; `communities-delete` and `feed-community-delete` also pass (55 with reels and the budget file).
- `apps/web` typecheck is back to exactly the two known errors (`ModerationLogRow.tsx`, `moderation-view.ts`, plan 10-11); the affected web unit tests pass (83).
- No migration in this plan, so pgTAP and `db:reset` were not needed. The local database holds no residue of these suites (only the two seeded `tereza...removida` memberships, which are seed data).
- Acceptance greps: `createdBy`, `memberQuota`, `actions` in the contract, `createdByUserId` count 0, `left join memberships`, `created_by_user_id` 22 times in the service, `c.kind = 'organization'`, `is_blocked_by_viewer`, `10 reads`, `10 visibility`, `10 community post removal`, the `'community'` literal inside `softDeletePostInTx`'s moderator branch.

## TDD Gate Compliance

Each task has its `test(10-06)` commit before its `feat(10-06)` commit. Some cases written in a red commit passed at once, and are invariants of earlier plans kept as guards rather than new behaviour: EP-05, EP-09, EP-29, EP-30, EP-31, the three Reels lane cases (EP-32..34 and "Todos"), the blocked and departed creator cases (RLS already hides them) and the notification unit cases for the post and root-comment resolvers. The real red cases failed on the planned assertion: missing `kind`, `createdBy`, `viewer`, `memberQuota` (Task 1); a 500 where `order_stale` is due and a missing hide for the viewer's block (Task 2); a 404 where the moderator's removal is due (Task 3). `gsd_run check tdd-red-evidence` was not used (Vitest emits no TAP), as in plan 05.

## Decisions Made

A3, A4 and A12 as listed under `key-decisions`, plus the five decisions beyond the plan's text (isOwner scope, the stricter canEdit and canCurate, required wire keys, the in-statement quota, `am.id is not null` as the communities form of the liveness term).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan text inaccurate] A4: the like resolver and the reply branch did not return [] for 'community'**
- **Found during:** Task 1 RED (unit cases failed)
- **Issue:** the plan says the resolvers "already return [] unless visibility is 'tenant' or 'followers'". `resolveCommentLiked` selected no visibility at all (any like on a comment under a community post would notify the comment's author), and the reply branch treated every audience other than `'tenant'` as a followers post, so a root author who follows the post's creator would have been told.
- **Fix:** `p.visibility` selected in the like resolver and an explicit early return for `'community'`; an explicit early return in the reply branch before the followers check; types widened; unit cases for post.published, root comment, reply and like.
- **Files:** `packages/modules/feed/server/notifications.ts`
- **Commit:** `d99a38ac`

**2. [Rule 3 - Blocking] The contract change broke tests outside the plan's file list**
- **Found during:** Task 1 verify
- **Issue:** `communities.test.ts` (integration) pinned the empty page as exactly `{ items, nextCursor }`; the module's `events.test.ts` and `order.test.ts` call the service with the old signatures and index the bound parameters (the projection now binds the viewer first); five web test files build `CommunitySummary` and page fixtures.
- **Fix:** `memberQuota: null` in the integration pin, `NO_FLAGS` and the parameter offset in the two unit files, the new keys in the five web fixtures (no web production code changed).
- **Commit:** `d99a38ac`

**3. [Rule 1 - Stricter than the plan] viewer flags and isOwner**
- **Issue:** the plan's `isOwner = created_by_user_id = ctx.userId` would make an admin the "owner" of an organization community they created, and `canEdit = isOwner or canManage` would promise an edit a creator whose key left the set (social switched off) is refused.
- **Fix:** `isOwner` requires `kind = 'member'`; `canEdit` is `manage` or (owner and `manage_own`); `canCurate` is owner and `stories.story.publish` (member communities). The organization rules are the plan's.
- **Commit:** `d99a38ac`

**4. [Rule 1 - Plan option not taken] The new wire keys are required, not optional**
- **Issue:** the plan allowed optional keys "where the file's own note requires it". The file carries no such note, and a `.strict()` schema in the older web rejects an unknown key regardless of how the new schema marks it, so optionality would buy nothing.
- **Consequence for release:** the API and the web must deploy together for the communities screens (an older web would fail to parse `GET /v1/communities`). Plan 05 noted the same ordering for the settings sheet.

**5. [Rule 2 - Missing] The community feed and the Reels lanes carry the predicates**
- **Issue:** the plan's Task 2 names "the community's feed read" in prose but lists no feed file; the lanes statement had the same gap (a viewer-blocked creator's lane would open on a 404). Both got the feed module's own `MEMBER_COMMUNITY_VISIBLE` (the two modules cannot share it).
- **Commit:** `693d6768`

**6. [Plan text vs code] The liveness term is `am.id is not null` in the communities module**
- The projection's creator join already carries the live-membership conditions, so the explicit term reads that join instead of a second `exists`. Same rule, one place, one fewer lookup per member row. The feed module, which has no such join, uses the `exists` form.

**7. [Not done as written] EP-30, second clause**
- "A tenant whose only posts are community posts returns an empty Início page" cannot be staged on the seeded tenants without deleting their posts. The first clause (a community of only community posts leaves Início and Explorar empty of them, for four viewers, with no `audience === 'community'` item in any walk) is tested; the second is the same predicate and is not proved on an emptied tenant.

**Total deviations:** 7 (Rule 1 x3, Rule 2 x1, Rule 3 x1, plan option and scope notes x2). **Impact:** no scope change; item 1 closes a real notification hole, items 3 and 6 tighten and simplify the plan's rules, item 4 is a release-order fact.

## Issues Encountered

- The flaky pin in `232-feed-community-audience.sql` test 56 and the `LegacyDbSetupError` on reset did not come up (no pgTAP run and no reset: no migration).
- `grep -c createdByUserId` printed 1 because a docblock named the field; reworded in the last commit.

## User Setup Required

None. Nothing was reset, seeded, pushed or deployed.

## Next Phase Readiness

Notes for the plans after this one:

- **Plans 12 to 14 (web):** read `viewer.actions.post` and `viewer.actions.story` instead of the owner booleans; `createdBy.membershipId` is what the profile route takes; `memberQuota` is null for an admin, a support session and any caller who cannot create, and its `limit` is the tenant's `communities.maxPerMember`. The web needs the new fixtures' shape wherever it builds a `CommunitySummary` or a page.
- **Release:** API and web together (item 4 above); no migration here.
- **`toPost` still emits `removal: 'moderation'` for `'followers'` posts only** (plan 05's note stands): the moderator's removal of a community post works at the API, but the post label the host reads carries no `removal` flag for a community post, so a moderator's delete affordance on a community page needs that flag from a later plan (one literal, outside this plan's seams).
- **Reels lanes:** the `listVideoCommunities` order (`position asc`, then activity) needed no change for member lanes; it only gained the visibility predicate.
- **Phase 11:** whether the creator is told about a comment, a reply or a like on a community post is open (A4 keeps all of them silent).
- **EP-14 and EP-38 (unclassified in the plan):** the `.strict()` key-set contract tests stand as the only verification of the `createdBy` and `viewer` shapes; Task 3's edges are the planner's choice, not probe-verified.

## Known Stubs

None added.

## Threat Flags

None beyond the plan's register. Mitigations in place: T-10-20 (three-field `.strict()` creator, user id never selected, uuid scan over the list and every detail), T-10-21 (the literal predicates were already on the three merged reads; negatives for a follower of the creator, the creator and the moderator, with a seeded ready video), T-10-22 (`c.kind = 'organization'` in lock, comparison and update, position-after-reorder assertion), T-10-23 (RLS plus explicit predicates; bare 404 with no details, for the moderator too), T-10-24 (`post_removed` row in the same transaction; the Phase 9 path).

## Self-Check: PASSED

- FOUND: `packages/modules/communities/contracts/index.ts` (`createdBy`, `memberQuota`, `actions`), `packages/modules/communities/server/service.ts` (`communityViewerFlags`, `MEMBER_COMMUNITY_VISIBLE`, `is_blocked_by_viewer`, `c.kind = 'organization'`), `packages/modules/feed/server/service.ts` (`visibility in ('followers', 'community')` in `softDeletePostInTx`)
- FOUND test describes: `10 reads`, `10 visibility` (member-communities), `10 community post removal` (moderation-member-content), `10 — Reels lanes of member communities` (reels)
- FOUND commits: `708b1e2f`, `d99a38ac`, `2f248690`, `693d6768`, `6f2a3208`, `4f8f57c1`, and the docblock refactor
- `commits: 7` measured with `git rev-list --count c77085dd..HEAD` before this SUMMARY commit; no `Co-Authored-By` trailer and no tool attribution in any commit of the plan
