---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 16
subsystem: api
tags: [reports, resolve, dispatcher, api-tier, removal, archive, block-author, moderation-log, D-616, D-732]

requires:
  - phase: 11-rede-social-direct-messages-member-blocking-and-reports
    provides: "11-05 in-transaction removers (story, story comment, community), 11-09 widened subjects and definers, 11-14 filing and queue projection"
provides:
  - "buildReportRemover(flags): the per-request dispatcher over the six report subjects, handed to the kernel as deps.removeContent"
  - "POST /v1/admin/reports/{id}/resolve wired to it, permission flags read before the transaction opens"
  - "Resolve tests for removal, archive, message refusal, block author, the race, idempotency and tenant isolation"
affects: [11-25 queue screens, 11-17 role-list drift test]

actuals:
  tokens: 13300
  tasks: 3
  commits: 3
plan_head_before: 81c3252f29bb4f48189ba2e81907ccdd75c1b2a3
commits: 3

tech-stack:
  added: []
  patterns:
    - "API-tier dispatcher over a closed subject union with a `never` guard, so a future subject is a compile error and the kernel never imports a module"
    - "Permission flags read once in the route before the transaction opens (pool is max 5)"

key-files:
  created:
    - apps/api/src/routes/admin/report-removal.ts
    - apps/api/tests/unit/report-removal.test.ts
  modified:
    - apps/api/src/routes/admin/reports.ts
    - apps/api/tests/integration/reports-new-subjects.test.ts

key-decisions:
  - "The dispatcher takes flags canManageStories, canManageCommunities and canModerate:true (the route is guarded by moderation.manage) and passes them straight to the module removers, which never read a permission themselves"
  - "A direct_message answers not_removable without touching anything; the kernel's existing refusal turns that into 409 CONFLICT { report: 'not_removable' } and the report stays open (D-859, T-11-30)"
  - "Resolve tests run on rede-demo with throwaway members (a member story is a `followers` story, the only kind the moderation path logs), so no seeded person is ever blocked; the append-only log is asserted by item id or blocked user id, relative where an older row exists"

patterns-established:
  - "A resolve fixture follows the author first when the item is a followers item, then files the report as that follower"

requirements-completed: [MODER-04, MODER-05]

coverage:
  - id: D1
    description: "The administrator removes a reported story with its story_removed row in the same transaction as the report's new state; the shipped post and comment resolution is unchanged"
    requirement: MODER-04
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/reports-new-subjects.test.ts#report resolve tracer"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/reports-blocks.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "The dispatcher routes each subject to its remover with the right flags, refuses a direct message as not_removable and fails closed on an unknown type"
    requirement: MODER-04
    verification:
      - kind: unit
        ref: "apps/api/tests/unit/report-removal.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "A story comment, a community (archive, no removal) and a message resolve as D-732 says, with the exact moderation_log rows"
    requirement: MODER-04
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/reports-new-subjects.test.ts#resolve story comment, resolve community, resolve message"
        status: pass
    human_judgment: false
  - id: D4
    description: "Block author works for a story, a story comment, a community and a message, and refuses staff, removed and the administrator's own content with the report left open"
    requirement: MODER-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/reports-new-subjects.test.ts#resolve block author"
        status: pass
    human_judgment: false
  - id: D5
    description: "The resolve is atomic under a race of two administrators, idempotent, and tenant-safe (bare 404 both ways beside positive controls)"
    requirement: MODER-04
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/reports-new-subjects.test.ts#resolve race, resolve idempotent, resolve tenant"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-11-19
status: complete
---

# Phase 11 Plan 16: Resolve a report of any subject Summary

**The administrator resolves a report of a post, comment, story, story comment, community or direct message through a per-request dispatcher: remove or archive through the owning module with the log row in the same transaction, block the author, or ignore; a message offers only ignore and block.**

## Performance

- **Duration:** about 25 min
- **Started:** 2026-11-19T21:30:00Z (approx)
- **Completed:** 2026-11-19T21:58:00Z
- **Tasks:** 3 (one tracer, two auto)
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `buildReportRemover(flags)` in `apps/api/src/routes/admin/report-removal.ts` is the `ReportContentRemover` the kernel's `resolveReport` receives: feed posts and comments go to the feed remover unchanged, a story to `removeReportedStoryInTx`, a story comment to `removeReportedStoryCommentInTx`, a community to `archiveReportedCommunityInTx` (archive, reversible), a direct message to `not_removable`. A `never` guard makes a seventh subject a compile error; an unknown value at runtime throws instead of removing.
- The resolve route reads `permissionsForRequest` once, before the transaction, and maps `stories.story.manage` and `communities.community.manage` to booleans. No new admin-lane transaction (the admin-lane inventory is unchanged and green).
- 19 new integration cases and 4 unit cases prove: the tracer, the shipped subjects unchanged, 403 for member and support, every subject's removal with exact log-row counts, the message refusal with the report left open, block author for story, comment, community and message (the blocked sender leaves the other participant's list), the three block refusals, two-administrator races for a removal and a block (one 200, one 409, one row), a resolve racing the author's own delete, idempotency, and the cross-tenant bare 404 in both directions with positive controls.

## Task Commits

1. **Task 1: dispatcher and resolve route (tracer)** - `6325aa87` (feat)
2. **Task 2: comment, community, message and author block** - `7e6a2630` (test)
3. **Task 3: race, idempotency, cross-tenant** - `fa28fb07` (test)

**Plan metadata:** the commit that adds this file (docs).

## Files Created/Modified

- `apps/api/src/routes/admin/report-removal.ts` - the dispatcher and its flags type
- `apps/api/src/routes/admin/reports.ts` - resolve wired to the dispatcher, flags read first, description and docblock updated for the new subjects
- `apps/api/tests/unit/report-removal.test.ts` - stubbed removers: routing, flags, message refusal, fail-closed on an unknown type
- `apps/api/tests/integration/reports-new-subjects.test.ts` - helpers generalised to take a tenant, demo stories and communities turned on for the span, eight new describes

## Decisions Made

See key-decisions. No migration, no new route, no new dependency.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - test fixture] A member story and a member post must be `followers` items**
- **Found during:** Task 1 (first green run wrote zero log rows)
- **Issue:** the plan text says a member story's removal writes `story_removed`; in the shipped model the moderation path logs only `followers` stories (D-711) and a moderator takes only `followers` posts. A hand-inserted `tenant` story is an organization story and writes no row.
- **Fix:** the resolve fixtures insert `followers` items and make the reporter follow the author first (follows are swept). The `tenant` visibility is used on purpose for the organization-story and staff-author cases.
- **Files modified:** apps/api/tests/integration/reports-new-subjects.test.ts
- **Committed in:** 6325aa87

**2. [Plan wording, not a code change] "Bloquear autor" on the administrator's own content is `author_not_member`, not `self`**
- **Found during:** Task 2
- **Issue:** the plan expects the shipped `self` refusal. `resolveReport` checks the author's role first (`role !== 'member'` is `author_not_member`), so an administrator author never reaches `changeAccessInTx`; `self` is unreachable through the resolve.
- **Fix:** none needed in code; the test asserts the real answer (409 CONFLICT, `details.report = author_not_member`, report open, administrator still active, no block row). The intent (the resolution never blocks anyone but a stored member author, and never the administrator) holds.

---

**Total deviations:** 1 fixture correction, 1 plan-wording note. **Impact:** no production code beyond the plan; no scope creep.

## Issues Encountered

- `isolation.test.ts` still has its 4 known red cases (stories b3/b8, two events); the rest of the 97 pass, including the report-resolve isolation rows. Not caused by this plan.
- Tests that need the route's flag read to happen exactly once per request could not be asserted at HTTP level without spying an ESM export; the single read is by construction (one `permissionsForRequest` call in the resolve handler, before `resolveReport`; the guard's own read is the shipped one).

## Verification run

- Unit: `report-removal.test.ts` and the whole `apps/api` unit suite (12 files, 142 tests, includes admin-lane-inventory, isolation-inventory, module-readmes, registry): pass.
- Integration, one by one (pgTAP not touched: no SQL changed): `reports-new-subjects` 28/28 (three runs, stable), `reports-blocks` 22, `moderation-posts` 22, `moderation-comments` 20, `moderation-log` 13, `moderation-member-content` 22, `report-removers` 12, `chat-voice-gate` 9: pass. `isolation.test.ts` 93 of 97, the 4 known pre-existing reds.
- `pnpm turbo typecheck` for api and web: clean. `pnpm turbo test --filter=@rede-social/web`: 416 files, 10068 tests pass (no `EventsSections` flake this run).
- `pnpm boundaries`, `scripts/check-ui-literals.sh`, `pnpm guard:lanes`: OK. Biome clean on the touched files.
- `apps/web/.next/cache` removed after the web build to keep free disk at 11 GiB.

## Threat Flags

None. No new endpoint, auth path or schema; the route and its guard are unchanged.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 25 (queue screens) can offer exactly: ignore, remove or archive, block author for a post, comment, story, story comment and community, and only ignore and block author for a message; `remove_content` on a message answers 409 `not_removable` and leaves the report open.

---
*Phase: 11-rede-social-direct-messages-member-blocking-and-reports*
*Completed: 2026-11-19*

## Self-Check: PASSED

- report-removal.ts, report-removal.test.ts: found. Commits 6325aa87, 7e6a2630, fa28fb07: found. `git rev-list --count 81c3252f..HEAD` = 3 before this commit.
- Acceptance: `grep buildReportRemover apps/api/src/routes/admin/reports.ts` matches and the file no longer passes `removeReportedContentInTx`; `reports-blocks` and `admin-lane-inventory` pass unchanged; the message `remove_content` case asserts the report is still `open`; the race cases assert one 200, one 409 and one log row.
