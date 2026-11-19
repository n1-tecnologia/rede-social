---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 05
subsystem: moderation
tags: [moderation, report-removal, in-tx-removers, story, story-comment, community, block-filter, D-725, D-732, A-11-SC]

requires:
  - phase: 13
    provides: "the feed's removeReportedContentInTx pattern and the ReportedRemoval outcome shape"
  - phase: 11-01
    provides: "moderation_log CHECK lists that already carry story_removed, comment_removed with story_comment and community_archived"
provides:
  - "removeReportedStoryInTx and removeReportedStoryCommentInTx exported from @rede-social/module-stories/server"
  - "archiveReportedCommunityInTx exported from @rede-social/module-communities/server"
  - "the blocker's filter on listStoryComments"
affects: [11-15, 11-16]

plan_head_before: 66e9e017fcc9c4ba798bc7a55888871c98cb6854
actuals:
  tokens: 13800
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A route body is extracted into an in-transaction function the route and the report path both call, so the two never disagree about who may take what"
    - "A remover answers removed, already_gone or not_removable and never throws a 403; the event half is an afterCommit closure"

key-files:
  created:
    - apps/api/tests/integration/report-removers.test.ts
    - apps/api/tests/integration/story-comment-block.test.ts
    - packages/modules/stories/tests/report-removal-exports.test.ts
    - packages/modules/communities/tests/report-removal-exports.test.ts
  modified:
    - packages/modules/stories/server/service.ts
    - packages/modules/stories/server/index.ts
    - packages/modules/communities/server/service.ts
    - packages/modules/communities/server/index.ts

key-decisions:
  - "ReportedRemoval is restated structurally in each module (stories, communities), never imported from the feed, so the API tier can hand all three modules' functions to resolveReport"
  - "The community remover treats canManage as communities.community.manage, the permission the shipped updateCommunity asks of a moderator; a caller without it who is not the creator of a member community gets not_removable"
  - "updateCommunity is left untouched (the plan's Task 2 only adds archiveReportedCommunityInTx); the archive statement and the log call reuse the same predicates and the shipped logModeratorAction"
  - "A 404 raised after the live check is re-checked: a removal that landed in between is already_gone, anything else is not_removable"

patterns-established:
  - "Idempotency of a report removal: a plain live read first, a locked read second, so the repeat is already_gone with no second log row and a no-op afterCommit"

requirements-completed: [MODER-04, MODER-05, CHAT-07]

coverage:
  - id: D1
    description: "A member story is removed inside a caller's transaction with exactly one story_removed row; a repeat is already_gone; an organization story met by moderation.manage alone is not_removable; an unknown or other tenant's id is already_gone"
    requirement: "MODER-04"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/report-removers.test.ts#story remover tracer"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/moderation-member-content.test.ts (shipped delete unchanged)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A story comment is removed with exactly one comment_removed row of subject story_comment; the author's own removal writes no row; without canModerate another member's comment is not_removable; a feed post comment is already_gone"
    requirement: "MODER-04"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/report-removers.test.ts#story comment remover"
        status: pass
    human_judgment: false
  - id: D3
    description: "A member community is archived with exactly one community_archived row; creator and organization archives write none; a repeat is already_gone; a caller who may not archive gets not_removable; the archived community leaves the active list and still opens read-only"
    requirement: "MODER-04"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/report-removers.test.ts#community remover"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/member-communities.test.ts and communities.test.ts (shipped writes unchanged)"
        status: pass
    human_judgment: false
  - id: D4
    description: "listStoryComments drops the blocker's blocked members' comments in the page predicate; the blocked member, a third member and a moderator read all comments; a block held in another tenant changes nothing; the cursor keeps paging with full pages"
    requirement: "CHAT-07"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/story-comment-block.test.ts"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/reports-blocks.test.ts (shipped block suite unchanged)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A-11-SC (the story comment list gains a block filter although D-725 says the block adds no new story filter) is a planner assumption flagged for Igor"
    requirement: "CHAT-07"
    verification: []
    human_judgment: true
    rationale: "A product decision: whether 'Bloquear {nome}' should also hide the blocked member's story comments; no test can decide it"

duration: 8min
completed: 2026-11-19
status: complete
---

# Phase 11 Plan 05: Report removers for stories, story comments and member communities Summary

**Three in-transaction removers (member story, story comment, member community archive) with the feed's removed / already_gone / not_removable shape and their log rows written once, plus the blocker's `is_blocked_by_viewer` predicate on a story's comment list.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-11-19T16:08:00Z
- **Completed:** 2026-11-19T16:16:00Z
- **Tasks:** 3
- **Files modified:** 8 (4 source, 4 tests created)

## Accomplishments
- `deleteStoryInTx` and `deleteStoryCommentInTx` extracted from the public deletes, which keep the same statements, 404 and 403 answers, events after commit and log rows (the shipped suites stay green unchanged).
- `removeReportedStoryInTx`, `removeReportedStoryCommentInTx` and `archiveReportedCommunityInTx` give a report's resolution the same outcome shape as the feed's `removeReportedContentInTx`, with the moderation-log row inside the caller's transaction and the event as an `afterCommit` closure.
- `listStoryComments` carries `not app.is_blocked_by_viewer(c.author_user_id)` in the page predicate, so "Bloquear {nome}" has its effect on story comments for the blocker only.

## Task Commits

1. **Task 1: story remover (tracer)** - `7508d59c` (feat)
2. **Task 2: story comment and community removers** - `05632c49` (feat)
3. **Task 3: blocker's filter on story comments** - `386a9279` (feat)

**Plan metadata:** the commit that adds this SUMMARY (docs).

## Files Created/Modified
- `packages/modules/stories/server/service.ts` - extracted in-tx deletes, the two removers, the shared `ReportedRemoval` type, the blocker filter
- `packages/modules/stories/server/index.ts` - exports `removeReportedStoryInTx`, `removeReportedStoryCommentInTx`, `ReportedRemoval`
- `packages/modules/communities/server/service.ts` - `archiveReportedCommunityInTx` and its `ReportedRemoval` type
- `packages/modules/communities/server/index.ts` - exports the remover and the type
- `apps/api/tests/integration/report-removers.test.ts` - the proof of the three removers (12 tests)
- `apps/api/tests/integration/story-comment-block.test.ts` - the blocker-only effect with positive controls (4 tests)
- `packages/modules/stories/tests/report-removal-exports.test.ts`, `packages/modules/communities/tests/report-removal-exports.test.ts` - export pins

## Decisions Made
See `key-decisions` above. The community remover's `canManage` is `communities.community.manage`; plan 16's dispatcher must read that permission (not `moderation.manage`) for the community flag, and `canManage`/`canModerate` for stories from `stories.story.manage` and `moderation.manage`.

## Deviations from Plan

### Auto-fixed Issues

None required fixes in code outside the plan's files.

### Process notes

- **TDD order, Tasks 1 and 2:** the tests were written after the implementation, so the RED run was not observed for those two tasks (Task 3 observed RED: with the filter removed 2 of 4 tests failed). The tests assert database state (rows, `deleted_at`, `status`, log rows), not just return values.
- **Cross-tenant fixture:** the "another tenant" cases insert a story and a community in `rede-demo` through the admin connection and delete them in the suite's sweep; comments for another tenant use an unknown id only (no foreign comment fixture).
- **A-11-ORG, A-11-SC:** both planner assumptions are implemented as written and flagged for Igor (organization story or community removed from the queue writes no log row; the block filters story comments although D-725 adds no other story filter).

**Total deviations:** 0 auto-fixed. **Impact on plan:** none.

## Issues Encountered

- `apps/api/tests/integration/stories.test.ts` fails 8 tests (the seed is the fixture: it expects the seeded demo stories to be live). Cause: the seeded stories were created on 2026-11-12 and their 24 h window has long passed (`select` showed 0 live of 5 not deleted), so the strip is empty. Pre-existing and independent of this plan (this plan's `deleteStory` refactor is covered by `member-stories.test.ts` 46/46 and `moderation-member-content.test.ts` 22/22, and the story strip query is untouched). Fix is a reseed, which this plan was forbidden to run. Recorded as a pre-existing red, not a regression.

## Gates run

- New: `report-removers.test.ts` 12/12, `story-comment-block.test.ts` 4/4, both unit export pins 2/2 each.
- Shipped, unchanged and green: `moderation-member-content` 22, `member-stories` 46, `member-communities` 48, `communities` 49, `reports-blocks` 22.
- Whole packages: `@rede-social/module-stories` 219/219, `@rede-social/module-communities` 89/89, `@rede-social/api` unit 136/136 (includes `module-readmes`).
- `pnpm boundaries`, `bash scripts/check-ui-literals.sh`, `pnpm guard:lanes`: OK. `biome check` on both modules: clean. `tsc --noEmit` on both modules and `apps/api`: clean.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 15 (riders) and plan 16 (the API-tier dispatcher that passes these functions to `resolveReport` as `deps.removeContent`) can import the three removers. Plan 16 reads the permission flags through `permissionsForRequest` before opening the transaction.

## Known Stubs

None.

## Threat Flags

None - no new endpoint, auth path or schema surface; the removers run only inside a resolution transaction (T-11-11, T-11-20 mitigated and asserted; T-11-03 asserted with the blocker, the blocked member, a third member and a moderator).

## Self-Check: PASSED

- Created files exist (report-removers, story-comment-block, both export pins).
- Commits `7508d59c`, `05632c49`, `386a9279` exist; `commits: 3` measured from `plan_head_before`.
- Acceptance greps: `removeReportedStoryInTx`, `removeReportedStoryCommentInTx` in the stories index and `archiveReportedCommunityInTx` in the communities index.

---
*Phase: 11-rede-social-direct-messages-member-blocking-and-reports*
*Completed: 2026-11-19*
