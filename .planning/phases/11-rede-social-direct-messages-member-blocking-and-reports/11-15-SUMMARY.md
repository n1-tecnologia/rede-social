---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 15
subsystem: moderation
tags: [reports, riders, canReport, canBlock, stories, story-comments, communities, feed, A-11-ROLE, D-733, AD-1, AD-7]

requires:
  - phase: 13
    provides: "the reportRiders pattern on posts and comments"
  - phase: 11-05
    provides: "the story and community services this plan edits"
provides:
  - "optional canReport and canBlock on storySummarySchema, storyCommentSchema and the strict communityViewerSchema"
  - "the viewer-role correction of the feed's reportRiders: staff never get canBlock on posts and comments either"
affects: [11-18, 11-20, 11-24]

plan_head_before: 7ddaa8593a8ddbecfc149b87904b2cd485cd62ac
actuals:
  tokens: 13500
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "The rider rule (not own, author is a live member, viewer is a member) is stated once per module in the same words and fails closed: a caller that forgets the viewer's role hides Bloquear"
    - "The rider reads a column the projection's existing join already carries (author role, creator role); no list or detail gained a statement"

key-files:
  created:
    - apps/api/tests/integration/report-riders.test.ts
  modified:
    - packages/modules/stories/contracts/index.ts
    - packages/modules/stories/server/service.ts
    - packages/modules/stories/tests/contracts.test.ts
    - packages/modules/stories/tests/story-comments-contract.test.ts
    - packages/modules/communities/contracts/index.ts
    - packages/modules/communities/server/service.ts
    - packages/modules/communities/server/routes.ts
    - packages/modules/communities/tests/contracts.test.ts
    - packages/modules/communities/tests/order.test.ts
    - packages/modules/feed/server/service.ts
    - packages/modules/feed/contracts/index.ts

key-decisions:
  - "A-11-ROLE is data: the viewer's own role of record comes from ctx.role on the request (never from the permission set) and canBlock is false unless it is member; the SQL definer app.member_block_create is not narrowed, so the rider and the screen are the enforcement (recorded residual: a staff caller who forges the call only blocks their own view)"
  - "The community rider needs 'the viewer created it' for EITHER kind (the existing is_owner is member-kind only), so the projection selects a boolean is_creator computed in the statement; the creator's user id is still never selected"
  - "communityViewerFlags gains an optional second argument (the role) and an optional isMember flag that reads false when absent, so a missed caller hides Bloquear rather than showing it"

patterns-established:
  - "Riders ride existing joins: am.role in the story projection, ms.role in the story comment projection, am.role as creator_role in the community projection"

requirements-completed: [MODER-05, CHAT-07]

coverage:
  - id: D1
    description: "A member sees Denunciar and Bloquear on a followed member's story (detail and strip); the author sees neither; the administrator and a support member never see Bloquear; an organization story is reportable and never blockable; another tenant's story is the bare 404 with no rider"
    requirement: "MODER-05"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/report-riders.test.ts#story riders"
        status: pass
      - kind: unit
        ref: "packages/modules/stories/tests/contracts.test.ts#11-15 storySummarySchema: the report riders"
        status: pass
    human_judgment: false
  - id: D2
    description: "Story comment riders: a member reads both true on another member's comment, canBlock false on the administrator's, both false on their own; staff read canReport true and canBlock false; a comment whose author left reads canReport true and canBlock false without an error; a created comment answers its own riders"
    requirement: "MODER-05"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/report-riders.test.ts#story comment riders"
        status: pass
      - kind: unit
        ref: "packages/modules/stories/tests/story-comments-contract.test.ts#storyCommentSchema: the report riders"
        status: pass
    human_judgment: false
  - id: D3
    description: "Community riders: another member's community reads both true for a member, both false for its creator, canBlock false for staff; an organization community is reportable and never blockable for a member, and both false for the administrator who created it; the list carries the same riders as the detail"
    requirement: "MODER-05"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/report-riders.test.ts#community riders"
        status: pass
      - kind: unit
        ref: "packages/modules/communities/tests/contracts.test.ts#11-15: the community viewer report riders"
        status: pass
    human_judgment: false
  - id: D4
    description: "A-11-ROLE for posts and comments: a staff viewer (administrator, support) reads canReport true and canBlock false on a member's post and comment; a member viewer reads both true; own content reads both false for everybody"
    requirement: "CHAT-07"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/report-riders.test.ts#post and comment riders"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/reports-blocks.test.ts (shipped rider assertions unchanged)"
        status: pass
    human_judgment: false
  - id: D5
    description: "No list or detail gained a statement (the riders reuse the projections' existing joins)"
    requirement: "MODER-05"
    verification:
      - kind: other
        ref: "by construction: one selected column per projection, no new join or statement; the statement-count tests of feed-query-budget.test.ts could not reach their count assertion for the stories strip (seed stale, see Issues)"
        status: unknown
    human_judgment: true
    rationale: "The shipped query-budget assertion for the story strip is blocked by the stale seed (its non-vacuous guard fails before the count); the count is unchanged by construction but not re-measured by that test"
  - id: D6
    description: "A-11-ROLE as written (staff see Denunciar and never Bloquear, enforced by the rider and the screen, not by the SQL definer) is a planner assumption flagged for Igor"
    requirement: "CHAT-07"
    verification: []
    human_judgment: true
    rationale: "A product decision (UI-D-869): whether the staff rule should also be enforced in app.member_block_create; no test can decide it"

duration: 25min
completed: 2026-11-19
status: complete
---

# Phase 11 Plan 15: Report and block riders on stories, story comments and communities Summary

**`canReport` and `canBlock` now ride the story, the story comment and the community viewer object, and the feed's post and comment riders read the viewer's own role, so a staff account is offered Denunciar and never Bloquear on any subject.**

## Performance

- **Duration:** about 25 min
- **Started:** 2026-11-19T16:15:00Z
- **Completed:** 2026-11-19T16:42:00Z
- **Tasks:** 3
- **Files modified:** 12 (11 source/test modified, 1 test created)

## Accomplishments
- Stories: optional `canReport` and `canBlock` on `storySummarySchema`, computed in `toStory` from the author's role of record (`am.role`, a column of the join the projection already makes) and `ctx.role`; every story read (strip, mine, detail, author group, highlight, publish read-back) carries them through the one projection.
- Story comments: the same two keys on `storyCommentSchema` from `ms.role` of the existing left join; a removed author (no live membership) reads `canReport` true and `canBlock` false.
- Communities: optional keys inside the strict `communityViewerSchema`; the projection selects `is_creator` (either kind, computed in the statement) and `creator_role`; `canReport` is false for the creator including the administrator of an organization community, `canBlock` only for another member's member community whose live creator is a member, viewed by a member.
- Feed: `reportRiders` takes `viewerIsMember` (`ctx.role === 'member'`) so the posts and comments Phase 13 already serves stop offering Bloquear to staff.
- `report-riders.test.ts` (19 tests) proves every subject for the member viewer, the author, the administrator, support and a removed author.

## Task Commits

1. **Task 1: story riders (tracer)** - `9fbff6ac` (feat)
2. **Task 2: story comment and community riders** - `470caf26` (feat)
3. **Task 3: viewer-role correction of post and comment riders** - `ed8f4b97` (fix)

**Plan metadata:** the commit that adds this SUMMARY (docs).

## Files Created/Modified
- `packages/modules/stories/contracts/index.ts` - riders on the story summary and the story comment
- `packages/modules/stories/server/service.ts` - `reportRiders`, `author_role` in both projections, the viewer passed to `toStory`, `toPage` and `toStoryComment`
- `packages/modules/communities/contracts/index.ts` - riders inside the strict viewer object
- `packages/modules/communities/server/service.ts` - `is_creator`, `creator_role`, `isMember` flag and the rider computation in `viewerOf`
- `packages/modules/communities/server/routes.ts` - the five `communityViewerFlags` calls hand `ctx.role`
- `packages/modules/feed/server/service.ts`, `packages/modules/feed/contracts/index.ts` - the viewer-role input and the doc comments
- `apps/api/tests/integration/report-riders.test.ts` - the proof (new)
- `packages/modules/*/tests/*.test.ts` - shape cases; `communities/tests/order.test.ts` parameter slices

## Decisions Made
See `key-decisions`. The role of record is read from `ctx.role` (the way `publishStory` already stamps the audience from it), not from permissions, because a member who holds a staff key is still a member.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `communities/server/routes.ts` edited although not in `files_modified`**
- **Found during:** Task 2
- **Issue:** the viewer flags are built by the route from the permission set only, and the community service has no `ctx` at `toCommunity`; the viewer's role had to enter somewhere.
- **Fix:** `communityViewerFlags(granted, role?)` with an optional `isMember` flag (absent reads false), and the route's five calls pass `ctx.role`.
- **Files modified:** `packages/modules/communities/server/routes.ts`, `packages/modules/communities/server/service.ts`
- **Verification:** `member-communities` 48/48, `communities` 49/49, `report-riders` 19/19, module-communities 91/91.
- **Committed in:** `470caf26`

**2. [Rule 1 - Test pinned a parameter position] `communities/tests/order.test.ts` slices shifted by one**
- **Found during:** Task 2
- **Issue:** the new `is_creator` column binds the viewer a second time, so the cursor parameters moved from indexes 2..6 to 3..7 (and 2..4 to 3..5 for the archived list); 3 tests failed.
- **Fix:** the slices and their comments follow the projection (viewer twice, then the tenant, then the cursor keys).
- **Files modified:** `packages/modules/communities/tests/order.test.ts`
- **Committed in:** `470caf26`

**3. [Plan assumption] No shipped assertion needed changing**
- `reports-blocks.test.ts` only pinned member viewers, so the staff correction changed none of its assertions (22/22 unchanged).

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 test pinned to a parameter position). **Impact:** no scope creep; both are the minimal path for the rider to see the viewer's role.

## Issues Encountered

- **Pre-existing red, not mine:** `apps/api/tests/integration/stories.test.ts` fails the same 8 tests (the seeded demo stories passed their 24 h window). The strip's riders are proven with fixtures this plan creates (`report-riders.test.ts`, `member-stories.test.ts` 46/46).
- **Pre-existing red, same cause:** `feed-query-budget.test.ts` fails 2 of 18, both on their "not vacuous" guard before any statement count (`GET /v1/events` with no upcoming seeded event, `GET /v1/stories` with an empty strip). The other 16 pass, including the feed's. The story strip's count is unchanged by construction (one selected column on a join the projection already makes) but was not re-measured by that suite; a reseed would let it run.
- `support@` reading a member story is the bare 404 (it holds no story read key); the case asserts the rider is absent there and the staff rule where a 200 is returned.

## Gates run

- New: `report-riders.test.ts` 19/19; shape cases in `stories/tests/contracts.test.ts`, `story-comments-contract.test.ts`, `communities/tests/contracts.test.ts`.
- Shipped, green: `member-stories` 46, `member-communities` 48, `communities` 49, `reports-blocks` 22, `feed` 19, `story-comment-block` 4, `report-removers` 12.
- Whole packages: `module-stories` 224/224, `module-communities` 91/91, `module-feed` 345/345, `@rede-social/api` unit 136/136 (includes `module-readmes`).
- `turbo typecheck` (feed, stories, communities, api) clean; `biome check` on the three modules and the new test clean; `pnpm boundaries`, `bash scripts/check-ui-literals.sh` and `pnpm guard:lanes` OK.
- Not run (not reachable from this plan): `apps/web`, the chat/notification catalog tests, `notifications-prune`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plans 18, 20 and 24 can build the story, story comment, community and post menus from `canReport` and `canBlock` alone. Release order: the keys are optional on strict schemas, so the API can ship before or after the web (a web that predates them ignores nothing it parses because `.strict()` refuses unknown keys: deploy the web first, as the phase's release plan states).

## Known Stubs

None.

## Threat Flags

None - no new endpoint, auth path or schema surface. T-11-29 (a rider is not enforcement: the report definer still refuses own content, the block definer refuses staff targets, the staff-as-blocker case is the recorded residual of A-11-ROLE), T-11-03 (the riders read the viewer's role and the item's author only; no block or report state), T-11-01 (the cross-tenant 404 carries no rider, asserted) are mitigated and asserted.

## Self-Check: PASSED

- `report-riders.test.ts` exists; commits `9fbff6ac`, `470caf26`, `ed8f4b97` exist; `commits: 3` measured from `plan_head_before`.
- Acceptance greps: `canBlock` in the stories and communities contracts.

---
*Phase: 11-rede-social-direct-messages-member-blocking-and-reports*
*Completed: 2026-11-19*
