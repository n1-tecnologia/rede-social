---
phase: 10-rede-social-member-stories-and-communities
plan: 07
subsystem: api
tags: [member-stories, tracer, media-seam, notifications, moderation, wire-change, D-704, D-711, D-714, D-715, D-717, D-718]

requires:
  - phase: 10-04
    provides: "stories.visibility, stories_audience_gate, stories_social_insert_gate, the story_removed moderation entry, A10 EXISTS_JOIN"
  - phase: 10-05
    provides: "stories.story.publish composed for members, storyPublishLimiter (declared, unused), withStoriesEnabled and withCommunitiesEnabled test helpers"
  - phase: 10-06
    provides: "the community read side and the viewer.actions seam (untouched here), the communities service whose cover lookup this plan edits"
provides:
  - "publishStory stamps visibility from the role (member followers, otherwise tenant), rate limits a member (A6), maps the RLS 42501 to 403 for members only, and raises no story.published event for a member story"
  - "the literal s.visibility = 'tenant' on GET /v1/stories and on every Inicio highlight read (count, cover, items); a community highlight keeps member stories"
  - "GET /v1/stories/mine opens to stories.story.manage OR stories.story.publish: a manager lists the ORGANIZATION stories, any other holder lists their OWN (expired included)"
  - "the story.published source returns [] unless the story is stamped tenant (second wall, fail closed)"
  - "kernel member media seam over story and cover: member photo cap on post, story and cover; member video on post and story only; story video cap = lower of the member seconds and 60 (A9); the minutes share counts story videos; pure rules in member-policy.ts"
  - "owner_user_id = ctx.userId in the asset lookup of publishStory and of the community cover (member callers only); a member story video must be ready at publish"
  - "deleteStory in one transaction under the row lock: author, moderator (member stories, story_removed row in the same transaction) or manager (organization stories, no row); 403 for a visible row, bare 404 for a hidden one"
  - "A7 wire: authorUserId null unless the caller is the author, author { membershipId, displayName, avatarUrl } on member stories (null on organization stories), web deploys first"
affects: [10-08, 10-09, 10-11, 10-12, 10-14, 10-15, phase 11 (notifications decision)]

actuals:
  tokens: 32000
  tasks: 3
  commits: 8

tech-stack:
  added: []
  patterns:
    - "Stamp backed by an RLS insert gate: the one role read of publishStory is the audience stamp, every other decision is a permission flag computed by the route plus a predicate in the statement"
    - "The owner is a term of the SAME asset lookup (never a second read), so another user's asset id is the same bare 404 as an unknown id"
    - "Pure per-purpose member media rules in the kernel seam file so the broker, the complete step and the minutes share cannot disagree"
    - "Wire privacy by projection: the row carries the author id internally, the mapper nulls it unless viewer === author"

key-files:
  created:
    - apps/api/tests/integration/member-stories.test.ts
    - packages/modules/stories/tests/contracts.test.ts
  modified:
    - packages/modules/stories/server/service.ts
    - packages/modules/stories/server/routes.ts
    - packages/modules/stories/server/notifications.ts
    - packages/modules/stories/contracts/index.ts
    - packages/modules/stories/README.md
    - packages/modules/stories/tests/notification-sources.test.ts
    - packages/modules/stories/tests/events.test.ts
    - packages/modules/stories/tests/story-summary-contract.test.ts
    - packages/core/server/media/service.ts
    - packages/core/server/media/member-share.ts
    - packages/core/server/media/member-policy.ts
    - packages/core/tests/member-media-policy.test.ts
    - packages/modules/communities/server/service.ts
    - apps/api/tests/integration/social-media.test.ts
    - apps/api/tests/integration/member-communities.test.ts
    - apps/api/tests/integration/moderation-member-content.test.ts
    - apps/api/tests/integration/stories.test.ts
    - apps/api/tests/integration/stories-author-photo.test.ts
    - apps/web/lib/story-view.test.ts

key-decisions:
  - "A6 embodied: storyPublishLimiter (30 per member per hour, per process) is consumed before anything is read or written on every member publish attempt; the 31st is 429 RATE_LIMITED. The number is the planner's, not Igor's"
  - "A7 embodied (the ONE release-order exception of Phase 10): another member's user id never reaches a member. authorUserId is nullable and null unless the caller is the author, for every story; a member story names its author as author { membershipId, displayName, avatarUrl } (organization stories name no person, D-104); author defaults to null. WEB-FIRST ROLLOUT NOTE for plan 15: the previous web's .strict() refuses the new author key and its required authorUserId refuses null, so the web must deploy BEFORE the API starts sending either; the new web already parses an API that predates both. The grep of apps/web found no read of authorUserId; plan 11 removes the last parse"
  - "A9 embodied: a member story video's duration cap is min(member seconds, MEDIA_LIMITS.video.story.maxDurationSeconds = 60), snapshotted at start; a post video keeps the member seconds. To take the literal 'same as a post' reading, return memberSeconds for every purpose in memberVideoDurationCap (one line in member-policy.ts)"
  - "A member story raises NO story.published event (beyond the plan's source guard): the event is the only way a story reaches the notification fan-out, so a member story enqueues no job at all, which is what the plan's 'zero enqueued jobs' truth needs; the source still returns [] unless visibility is tenant (fail closed on a missing value)"
  - "Início highlights are guarded by place, not blanket: (h.community_id is not null or s.visibility = 'tenant') in the highlight projection (count, cover, items) so a member story never reaches Início through a highlight while a community highlight keeps the member stories plan 09 will put there"
  - "A member's story video must be ready at publish and answers { story: 'media_invalid' } otherwise (the closed STORY_ISSUES vocabulary has no other word); the organization keeps D-53's publish-while-processing"
  - "Cover owner check is skipped when a member re-sends the STORED cover reference (an admin may have set it, A8): it is not a new claim, and coverIsUsable (the self-heal) never takes the owner term"
  - "With social off a moderator's delete of a member story is the bare 404, not a 204: plan 04's locked pgTAP 231 (section 3, 'the admin reads zero member stories, off hides everything') hides every member story from every lane, so the row is unreachable. The moderator's PERMISSION does not depend on social and the delete commits with its row once social is on again (see deviations)"

patterns-established:
  - "The strip statement keeps naming visibility = 'tenant' (Inicio): it is what keeps branch 3 of the audience gate off the walked rows (plan 08 inherits it for Explorar with 'followers')"
  - "An asset or reference id owned by someone else is a bare 404 by putting the owner in the lookup, never a 403 or a second read"

requirements-completed: [MSTORY-01, MSTORY-02, MSTORY-05, MSTORY-07, MSTORY-09]

coverage:
  - id: D1
    description: "Tracer: Helena publishes a photo story with a caption (201, stored followers, her id, 24 hour window); the admin's is stored tenant; the body stays strict (visibility and any unknown key answer 400); a member naming a highlight destination answers 403; the 31st attempt is 429"
    requirement: MSTORY-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/member-stories.test.ts#10 tracer (cases 1, 2, 4, 8, 9)"
        status: pass
      - kind: unit
        ref: "packages/modules/stories/tests/contracts.test.ts#10-07 publishStorySchema"
        status: pass
    human_judgment: false
  - id: D2
    description: "A member story is in none of Inicio's reads: the strip lists the admin's story and not Helena's for a member, for the admin lane and for the author; the order is unchanged (EP-59), same-second creation lists only the organization story in either insert order (EP-57), member-only stories answer an empty page (EP-58); an Inicio highlight holding both counts and shows only the organization one"
    requirement: MSTORY-02
    verification:
      - kind: integration
        ref: "member-stories.test.ts#10 tracer (cases 3, 10, 11, 12, 13)"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /v1/stories/mine: a member lists their own (expired included), a manager lists only organization stories; with social off and a warm flags cache the SQL gate gives 403 (never 500), and after the window the permission is gone"
    requirement: MSTORY-01
    verification:
      - kind: integration
        ref: "member-stories.test.ts#10 tracer (cases 6, 7)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Nobody is told of a member story: the source returns nothing for followers (and fails closed on a missing value), no fan-out job is enqueued, no notification row exists, the admin's story keeps its broadcast"
    requirement: MSTORY-05
    verification:
      - kind: unit
        ref: "packages/modules/stories/tests/notification-sources.test.ts#10-07 (3 cases)"
        status: pass
      - kind: integration
        ref: "member-stories.test.ts#10 tracer case 5"
        status: pass
    human_judgment: false
  - id: D5
    description: "Member media seam: photo cap exact on story and cover (cap accepted, cap plus one 413), member video refused for cover and for story while the tenant switch is off, story snapshot 60 s with the member limit at 300, exactly 60 ready and 61 rejected, fractional 60.4 ready and 60.5 rejected like the post path, the minutes share counts a pending story video"
    requirement: MSTORY-07
    verification:
      - kind: unit
        ref: "packages/core/tests/member-media-policy.test.ts#10-07 member media purposes"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/social-media.test.ts#10 story and cover media (cases 1-5)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Owner checks: a member publishing a story on another user's asset, or creating or editing a community with another user's cover, gets the bare 404 and nothing attaches; a member story video still processing is media_invalid; the organization path is unchanged"
    requirement: MSTORY-07
    verification:
      - kind: integration
        ref: "social-media.test.ts#10 story and cover media (cases 6-8); member-communities.test.ts#10-07 cover owner check"
        status: pass
    human_judgment: false
  - id: D7
    description: "Delete: the author deletes (no row), a moderator deletes a member story with ONE story_removed row naming the author, the story and the capped caption, a forced log failure leaves the story live, a repeat is the bare 404, a member touching another member's story is 403 for a follower and 404 for a stranger, an organization story is unchanged, the author is told nothing, the log lists the row"
    requirement: MSTORY-09
    verification:
      - kind: integration
        ref: "member-stories.test.ts#10 delete; moderation-member-content.test.ts#10 story removal"
        status: pass
    human_judgment: false
  - id: D8
    description: "A7 wire: a follower reading Helena's story finds none of her user ids (uuid scan) and an author of exactly three fields; Helena reads her own authorUserId; organization stories name no person; a page from an API that predates author still parses"
    requirement: MSTORY-09
    verification:
      - kind: integration
        ref: "member-stories.test.ts#10 delete case 5"
        status: pass
      - kind: unit
        ref: "packages/modules/stories/tests/contracts.test.ts#10-07 storySummarySchema: the author wire"
        status: pass
    human_judgment: false

duration: 100min
completed: 2026-11-11
status: complete
plan_head_before: 4d29bf33edc55ae4f2d0b0986c629f55a1a12417
commits: 8
---

# Phase 10 Plan 07: Member Stories Write Path Summary

**A member of a `social` tenant now publishes a 24-hour followers-only story under the member post limits that appears in none of Início's reads and that nobody is told about, sees their own history, and can delete it, while a moderator's delete leaves its `story_removed` row in the same transaction and no member's user id ever reaches another member.**

## Performance

- **Duration:** about 100 min
- **Completed:** 2026-11-11
- **Tasks:** 3 of 3, each with its red commit first (Task 1 is the tracer; its automated verify ran green before the expansion tasks, `⚡ Tracer verified end-to-end — expanding`)
- **Files:** 2 created, 19 modified

## Accomplishments

- **Tracer (Task 1):** the stamp from the role, the limiter, the 42501 to 403 map, no event for a member story, `s.visibility = 'tenant'` on the strip and on Início highlights, `/mine` opened to members (author-scoped) and kept organization-scoped for managers, the `story.published` source guard. Before this, a member's `POST /v1/stories` answered 500 (the RLS refusal), now 201 or 403.
- **Media seam (Task 2):** the member photo cap, member video and minutes share extended over `story` and `cover`, the 60 s story cap, and the owner term in the asset lookups.
- **Delete and wire (Task 3):** one locked transaction with the author, moderator and manager rules, the log row in the same transaction, and the A7 author projection.

## Task Commits

1. **Task 1 RED:** `565fef92` (test): failing guard cases, 500 where 201 is due, `/mine` 403, strict publish body.
2. **Task 1 GREEN:** `978d8760` (feat): stamp, limiter, org-only reads, `/mine`, notification guard, README import.
3. **Task 2 RED:** `fc441247` (test): pure policy rules, story and cover broker cases, owner and ready checks, cover owner case.
4. **Task 2 GREEN:** `773ce725` (feat): kernel seam, owner terms, ready-video rule.
5. **Fix:** `15034f46` (fix): the stories events unit test follows the asset lookup's new `status` column (my Task 2 GREEN left it red; see deviations).
6. **Task 3 RED:** `a130b98b` (test): delete and author-wire cases, contract cases.
7. **Task 3 GREEN:** `a68ddeb4` (feat): `deleteStory` transaction, A7 contract and projection, route guard, web fixtures.
8. **Test follow-through:** `11f0c181` (test): the strip and author-photo suites follow the author wire.

**Plan metadata:** this SUMMARY is committed separately. STATE.md and ROADMAP.md were not touched (the orchestrator owns them). Nothing was pushed and no hosted project was touched.

## Verification

- `pnpm db:reset && pnpm db:seed && pnpm supabase test db`: 65 files, 4463 tests, PASS (no migration in this plan; the chain was run as the success criteria ask, before the integration files).
- Integration, one invocation, 257 tests in 6 files: `member-stories`, `stories`, `social-media`, `media`, `moderation-member-content`, `member-communities`; plus `stories-author-photo`, `feed-query-budget`, `notifications`, `isolation`, `store-gate`, `communities-delete`, `moderation-comments`, `reports-blocks`, `communities` (all pass).
- Units: module-stories 197, core 1796, module-communities 73, api unit 134. Web: 350 files, 8204 tests, one failure that is not from this plan (see Deferred).
- `tsc --noEmit` through turbo for core, module-stories, module-communities and api; `pnpm boundaries` clean; Biome clean for api, core and the stories module. `apps/web` typecheck is back to exactly the two expected errors (`ModerationLogRow.tsx`, `moderation-view.ts`, plan 10-11).
- Acceptance greps of the three tasks all pass (`visibility = 'tenant'`, `requirePermission('stories.story.manage', 'stories.story.publish')`, `10 tracer`, `'story'` in member-share, `maxDurationSeconds`, `owner_user_id` in both services, `10 story and cover media`, `story_removed`, `for update`, `authorUserId: z.uuid().nullable()`, `10 story removal`, `10 delete`).

## TDD Gate Compliance

Each task has its `test(10-07)` commit before its `feat(10-07)` commit. The RED runs failed on the planned behaviour: the guard cases returned an intent for a followers story, the member publish answered 500 where 201 was due, `/mine` answered 403 to a member, `seam.memberPhotoCapApplies is not a function` for the new pure rules, a foreign asset published (201 where 404 is due), a member video story published while processing, the moderator's delete answered 403, no `story_removed` row existed, and the follower's wire carried Helena's user id. Some cases written in a red commit passed at once and are invariants kept as guards: the strict publish body, the cover and tenant-switch video refusals, the organization story with the admin's own asset, the delete of an organization story and of another tenant's story. `gsd_run check tdd-red-evidence` was not used (Vitest emits no TAP), as in plans 03 to 06.

## Decisions Made

A6, A7 and A9 as listed under `key-decisions`, plus the six decisions beyond the plan's text (no event for a member story, place-aware Início highlight predicate, `media_invalid` for a not-ready member video, the stored-cover re-send, the social-off delete, and the pure rules living in `member-policy.ts`).

**Web-first rollout note for plan 15 (A7):** deploy the web BEFORE the API for this change. The previous web parses `storySummarySchema` strictly: it refuses the new `author` key and its required `authorUserId` refuses a null, so it would fail every story page the new API sends. The new web already parses pages from an API that predates both (`author` defaults to null, `authorUserId` accepts a uuid or null).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan inconsistent with plan 04's locked gate] With social off the moderator's delete of a member story is the bare 404**
- **Found during:** Task 3 (the D-718 case of `moderation-member-content.test.ts`)
- **Issue:** the plan says the moderator's delete "keeps working with `social` off (D-718)", but plan 04's pgTAP 231 section 3 locks "social off: the admin reads zero member stories (off hides everything)": the restrictive audience gate hides every member story from every lane, the admin's included, so the `for update` read finds nothing. D-718's wording ("the admin's moderation of D-711 keeps working") cannot hold for a story the lane cannot read without a second, RLS-bypassing lane for moderation, which is an architectural change (Rule 4) outside this plan's files.
- **Fix:** kept the SQL gate. The moderator's permission (`moderation.manage`) does not depend on `social`; with `social` off the request is the bare 404 and changes nothing, and with `social` on again the delete commits with its row. The test asserts exactly that, with the publish 403 beside it.
- **Decision for Igor (open):** if "keeps working with social off" must hold literally for stories, the options are a moderator-only branch in the audience gate (a new migration widening `stories_audience_gate` for the staff lane while social is off, which also changes what pgTAP 231 section 3 pins) or an admin-lane delete. Nothing in the UI reaches a hidden story (Explorar is gone with `social` off, D-483), so the practical exposure is the by-id door only.
- **Files modified:** `apps/api/tests/integration/moderation-member-content.test.ts`
- **Commit:** `a68ddeb4`

**2. [Rule 3 - Blocking] `publishStory`'s asset lookup gained `status`, which broke a scripted unit test**
- **Found during:** Task 3 (the stories module unit run; I had run the module tests after Task 1 but not after Task 2)
- **Issue:** `tests/events.test.ts` matches the statement text `select kind, purpose from media_assets`; the member ready-video rule selects `status` too. Task 2's commit therefore left three unit cases red.
- **Fix:** the test's pattern and fixture follow the new column, committed as its own `fix(10-07)` commit.
- **Files modified:** `packages/modules/stories/tests/events.test.ts` | **Commit:** `15034f46`

**3. [Rule 3 - Blocking] The A7 contract change forced test follow-through outside the plan's file list**
- **Found during:** Task 3 verification
- **Issue:** `stories-author-photo.test.ts` picked the seeded admin's stories out of a member's page by `authorUserId`, which is null by design now; `stories.test.ts` case 1 counted distinct `authorUserId` values (a vacuous pass on all nulls); four `StorySummary` literals in `apps/web/lib/story-view.test.ts` lacked the new `author` key and broke the web typecheck.
- **Fix:** the author-photo suite identifies the admin's stories by a database lookup, `stories.test.ts` asserts every strip item has a null `authorUserId` and `author`, and the four web fixtures carry `author: null`.
- **Files modified:** `apps/api/tests/integration/stories-author-photo.test.ts`, `apps/api/tests/integration/stories.test.ts`, `apps/web/lib/story-view.test.ts` | **Commits:** `a68ddeb4`, `11f0c181`

**4. [Rule 3 - Blocking] The stories README and one kernel file outside the plan's list**
- **Issue:** `module-readmes.test.ts` requires every kernel import to be listed (`safety/limits`); and the pure member-media rules needed a home the unit test could import without the drizzle schema (`member-share.ts` imports it).
- **Fix:** README line; `packages/core/server/media/member-policy.ts` (read_first, not in `files_modified`) holds the rules and `member-share.ts` imports the purposes list from it.
- **Commits:** `978d8760`, `773ce725`

**5. [Rule 2 - Missing critical functionality] A member story raises no `story.published` event**
- **Issue:** the plan's truth says "zero enqueued `story.published` jobs", but the event itself is what enqueues the fan-out job; a source guard alone still enqueues one (which then yields nothing).
- **Fix:** `publishStory` emits the event for an organization story only; the source guard stays as the second wall. Case 5 asserts both (no job, no row, and the admin's positive control).
- **Commit:** `978d8760`

**6. [Rule 1 - Plan text vs code] Names and statuses**
- The plan calls the strip read `listStories`; it is `listActiveStories`. The delete route answers 204 (as before), not 200. `GET /v1/stories/mine` for an organization manager keeps the organization history. No behaviour change.

**Total deviations:** 6 (Rule 1 x2, Rule 2 x1, Rule 3 x3). **Impact:** no scope change; item 1 is a real open decision for Igor (a plan-text conflict with plan 04), item 5 hardens PR-4.

## Issues Encountered

- Plan 05 had warned a member's publish answered 500 until the stamp existed; that is closed (201 or 403).
- The flaky pin in `232-feed-community-audience.sql` test 56 did not recur (pgTAP passed on the fresh reset). `pnpm db:reset` did not fail with `LegacyDbSetupError` this time.
- The first `git add` with an unquoted shell variable failed under zsh (no word splitting); the commits use arrays and pathspecs.
- `pnpm db:two` and `db:migrate-all --dry-run` were not run: no migration in this plan.

## Known Stubs

None added. `app.community_action_allowed` (plan 03) remains the intentional Escopo seam.

## Threat Flags

None beyond the plan's register. Mitigations in place: T-10-25 (owner term in the asset lookups, locked delete predicate, 403 versus bare 404, negative tests with positive controls), T-10-26 (literal `'tenant'` on every Início read, source guard, no event, zero-row integration check), T-10-27 (`storyPublishLimiter`, member photo cap and minutes share over story and cover), T-10-28 (log row in the delete transaction, forced-failure rollback test), T-10-29 (`authorUserId` null unless the author, uuid-scan test, web-first rollout).

## Deferred Issues

- `apps/web/app/(app)/stories/highlight-actions.test.ts` case 6 fails (`loadHighlightSheetAction ... composed into places`): its community fixtures lack the keys plan 06 made required (`kind`, `createdBy`, `viewer`), so the communities page no longer parses. Not caused by this plan (a stories contract change cannot affect it); recorded for the web plans (11 to 14) or a quick.

## User Setup Required

None. The local database was reset and seeded (Igor's word of 2026-11-11, local only) and the integration suites left no residue.

## Next Phase Readiness

- **Plan 08 (Explorar reads):** keep the audience literal in the strip statement (`'followers'` for Explorar); `author { membershipId, displayName, avatarUrl }` is already projected for member stories, and `toStory` takes the viewer's id.
- **Plan 09 (highlight owner seam):** a member naming a destination is a 403 at the route today; the place-aware Início predicate already leaves community highlights open to member stories.
- **Plan 11 (web):** `ModerationLogRow` and `moderation-view` still need the three new actions; remove the last `authorUserId` parse; the story history for a member is `GET /v1/stories/mine`.
- **Plan 15 (rollout):** state the web-first order for A7; the open social-off moderation question above.
- **Phase 11:** whether followers are told of a member story is open (no event is raised today).

## Self-Check: PASSED

- FOUND: `apps/api/tests/integration/member-stories.test.ts` (`10 tracer`, `10 delete`), `packages/modules/stories/tests/contracts.test.ts`, `.planning/phases/10-rede-social-member-stories-and-communities/10-07-SUMMARY.md`
- FOUND commits: `565fef92`, `978d8760`, `fc441247`, `773ce725`, `15034f46`, `a130b98b`, `a68ddeb4`, `11f0c181`
- `commits: 8` measured with `git rev-list --count 4d29bf33..HEAD` before this SUMMARY commit; no `Co-Authored-By` trailer and no tool attribution in any commit of the plan; no path under `.planning/sketches/`, `STATE.md` or `ROADMAP.md` staged
