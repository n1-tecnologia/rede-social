---
phase: 13-app-nativo-ios-e-android-por-tenant-white-label
plan: 14
subsystem: api
tags: [native-app, moderation, reports, member-block, store-policy, apple-1.2, api, read-filter, D-616, tracer, tdd]

requires:
  - phase: 13-app-nativo-ios-e-android-por-tenant-white-label
    provides: "13-08 content_reports / member_blocks and the five definers (app.content_report_create / _resolve, app.member_block_create / _delete, app.is_blocked_by_viewer) with SQLSTATEs RP001, RP002, RP004, BL001; 13-13 the attempt limiter, the ErrorCode additions and the inventory conventions"
provides:
  - "POST /v1/reports, GET /v1/blocks, POST /v1/blocks, DELETE /v1/blocks/{userId} (member lane) and GET /v1/admin/reports, POST /v1/admin/reports/{id}/resolve (admin lane, moderation.manage)"
  - "Error codes CANNOT_REPORT_OWN (403), ALREADY_REPORTED (409), CANNOT_BLOCK (400), REPORT_ALREADY_RESOLVED (409)"
  - "A resolve that removes content or blocks the author through the shipped paths in ONE transaction, with the moderation_log row of the removal or block"
  - "app.is_blocked_by_viewer on the feed list (main, Explorar, community), the post detail, the comment roots, the replies and the thread"
  - "Optional canReport and canBlock booleans on the post and comment answers"
affects: [13-20]

plan_head_before: 98d98bd1af8387be4299d058e97a90834fce14fa
actuals:
  tokens: 30700
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "a module's removal body exported as an in-transaction function plus an after-commit half; the public function wraps both, so a kernel resolution can run the SAME removal in its own transaction"
    - "the kernel never imports a module: the module's remover is injected by the API tier (ReportContentRemover)"
    - "an admin-lane transaction that runs a SQL definer under the caller's claims (set_config is_local plus set local role authenticated, then back to service_role), so one transaction carries both a tenant-lane rule and an admin-lane write"
    - "a viewer-only read predicate (NOT_BLOCKED_AUTHOR) next to deleted_at is null, no join and no new statement"

key-files:
  created:
    - packages/core/server/safety/reports.ts
    - packages/core/server/safety/blocks.ts
    - packages/core/server/safety/limits.ts
    - packages/core/server/safety/sqlstate.ts
    - packages/core/server/safety/index.ts
    - apps/api/src/routes/safety.ts
    - apps/api/src/routes/admin/reports.ts
    - apps/api/tests/admin-lane-inventory/safety.ts
    - apps/api/tests/integration/reports-blocks.test.ts
  modified:
    - packages/contracts/src/moderation.ts
    - packages/contracts/src/errors.ts
    - packages/core/server/http/api-error.ts
    - packages/core/server/tenancy/member-admin.ts
    - packages/modules/feed/server/service.ts
    - packages/modules/feed/server/index.ts
    - packages/modules/feed/contracts/index.ts
    - apps/api/src/app.ts
    - apps/api/src/routes/admin/index.ts
    - apps/api/tests/isolation-inventory.ts
    - apps/api/tests/admin-lane-inventory/index.ts
    - apps/api/tests/integration/isolation.test.ts
    - biome.json

key-decisions:
  - "block_author runs in withAdminTx, not withTenantTx: the shipped admin block writes memberships, which the tenant lane refuses by design. The report's SQL definer needs the caller's claims and the authenticated role, so asTenantLane() sets them for the transaction, calls the definer, and returns to service_role for changeAccessInTx. dismiss and remove_content stay in withTenantTx. One admin-lane site is inventoried (apps/api/tests/admin-lane-inventory/safety.ts) and packages/core/server/safety joins the biome admin-tx exemption."
  - "The feed module's removal (softDeletePost, deleteComment) and the Phase 8 block (changeAccess) opened their own transactions, so each body was extracted as an exported in-transaction function (softDeletePostInTx, deleteCommentInTx, changeAccessInTx) with an after-commit half (announcePostRemoved, announceCommentRemoved); the originals call them unchanged. The kernel gets the feed remover injected by apps/api/src/routes/admin/reports.ts (removeReportedContentInTx), because the kernel never imports a module."
  - "remove_content outcomes: removed (log row in the transaction), already_gone (the item was removed since: content_removed, no second log row), not_removable (live but the moderation path refuses it, for example a staff post: 409 CONFLICT details.report = not_removable, the report stays open). block_author refuses a staff, departed or invited author with 409 CONFLICT details.report = author_not_member / author_unavailable."
  - "13-08's open design note is TIGHTENED: createReport reads the subject through the reporter's own lane first, so a followers-only post the reporter cannot read, or an item of a locked community, is the same 404 as a missing id instead of a 201 that confirms the uuid."
  - "The five read paths are the feed list (one shared feedPage, so main, Explorar scope, community and Reels all get the predicate), the post detail (and, on a miss, a check so a blocked author's post is 404 rather than a 403 follow_required or community_locked that names it), the comment roots, the replies and the comment thread. The social service has no content read (its lists are people, and the block's effect on follow lists is Phase 11), so it is untouched."
  - "The resolve body's reason is the internal reason of the author's block (D-331). It is accepted and ignored by dismiss and remove_content (a removal's log row carries no reason by design)."
  - "Admin guard is requirePermission('moderation.manage'), exactly the moderation log's: a member or support is 403 FORBIDDEN. The plan text said 'notFound behaviour' but the log page answers 403, and the plan says to copy it."

patterns-established:
  - "a tenant-lane SQL definer can be called from an admin-lane transaction with asTenantLane(tx, ctx, fn)"
  - "an inventoried admin-lane area per kernel directory (apps/api/tests/admin-lane-inventory/<area>.ts)"

requirements-completed: []

coverage:
  - id: D1
    description: "Tracer: a member reports a comment, the admin lists and resolves it with remove_content in one transaction through the comment removal (comment_removed log row), the comment leaves the feed read, the report reads content_removed, a second resolve is REPORT_ALREADY_RESOLVED, a failing removal rolls the resolution back, and the other tenant sees and changes nothing"
    requirement: "NATIVE-31"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/reports-blocks.test.ts#reports tracer"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#phase 13 sweep: reports and blocks"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every resolution: dismiss, remove_content (post with post_removed row, already removed, not_removable refusal), block_author (member_blocked row with the trimmed reason, session cut, content untouched, staff author refused), unknown resolution 400, missing report 404"
    requirement: "NATIVE-31"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/reports-blocks.test.ts#every resolution through the existing paths"
        status: pass
    human_judgment: false
  - id: D3
    description: "NATIVE-31 edges: missing or unknown reason or subject type 400, note trimmed / whitespace null / 500 characters whole / 501 refused, own 403, duplicate 409, unknown, removed, foreign and unreadable subjects one 404 body, five identical-created_at reports paged across the tie with no repeat or skip, nextCursor exact, empty page for every filter, Phase 11 subject types refused"
    requirement: "NATIVE-31"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/reports-blocks.test.ts#what a report accepts and refuses; #the admin queue: ordering, paging and the empty answers"
        status: pass
    human_judgment: false
  - id: D4
    description: "NATIVE-33: block and unblock idempotent (200 both times), staff / foreign / self / unknown target one CANNOT_BLOCK body, the list is the caller's own, the author's posts and comments vanish from the feed list, Explorar, community list, post detail, comment roots and replies for the blocker only and return after the unblock, riders by the rule, 20 and 60 per hour limits, no identity in any answer, no notification row"
    requirement: "NATIVE-33"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/reports-blocks.test.ts#member blocks and the blocker's reads"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#phase 13 sweep: reports and blocks (block routes)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Shipped suites unchanged: module-feed 327, module-social 63, core 1487, contracts 451, api unit 131 (isolation and admin-lane inventories included), moderation / member-admin / feed / social / reels / communities integration files 366 with reports-blocks"
    verification:
      - kind: other
        ref: "pnpm boundaries; pnpm guard:lanes; web route-handlers.inventory.test.ts (4); turbo typecheck core, api, contracts, module-feed, module-social; web tsc --noEmit"
        status: pass
    human_judgment: false

duration: 24min
completed: 2026-11-05
status: complete
---

# Phase 13 Plan 14: Reports and member blocks API Summary

**A member files a report of a post or comment and blocks another member; the tenant admin works the queue and resolves a report by dismissing it, removing the content through the moderation path or blocking the member author, all in one transaction with the log row the shipped path writes; the blocker stops seeing the blocked member's posts and comments on every read path while nobody else notices anything.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-11-05T16:32:40Z
- **Completed:** 2026-11-05T16:56:00Z
- **Tasks:** 3 (tracer, TDD, gate)
- **Files modified:** 22 (9 created, 13 modified)

## Accomplishments

- `POST /v1/reports` (201 with the id only), `GET /v1/admin/reports` (keyset on `(created_at desc, id desc)`, `estado` closed list, 20 per page) and `POST /v1/admin/reports/{id}/resolve` (`dismiss`, `remove_content`, `block_author`). The resolve calls `app.content_report_resolve` and then the feed module's own removal (or the Phase 8 admin block) in one transaction, so a removal without its `moderation_log` row, or a block without the report's new state, cannot commit. `RP004` is 409 `REPORT_ALREADY_RESOLVED`.
- `GET /v1/blocks`, `POST /v1/blocks`, `DELETE /v1/blocks/{userId}` over the plan 08 definers: idempotent, one `CANNOT_BLOCK` body for a staff, foreign, unknown or own id, the list is the caller's own with name and avatar.
- `app.is_blocked_by_viewer` added beside `deleted_at is null` in the feed list (the one shared `feedPage`, so main, Explorar, community and Reels), the post detail (a blocked author's post is 404 even where a lock would have answered 403), the comment roots, the replies and the thread. No join, no new statement (`feed-query-budget` unchanged), no placeholder, no recomputed counter.
- `canReport` and `canBlock` on every post and comment answer, computed on the server like `canManage` (`canBlock` only for a `member` author who is not the viewer), optional in the contracts.
- Limits: 20 reports and 60 blocks per member per hour (429 `RATE_LIMITED`), a note trimmed and bounded to 500 characters, no notification type created.

## Task Commits

1. **Task 1: [tracer] a member reports a comment and the admin removes it through the existing paths in one transaction** - `51a42525` (feat)
2. **Task 2 RED: failing proofs of blocks, the blocker's filter and the riders** - `f6112aa1` (test)
3. **Task 2 GREEN: block and unblock, the filter on the read paths, the riders** - `f80498c2` (feat)
4. **Task 3: a report needs a subject the reporter can read** - `eaa70f3e` (feat)
5. **Task 3: [GATE] edges, ordering, every resolution, unreadable subject, cross-tenant block routes** - `7cfc49ba` (test)

**Plan metadata:** the docs commit that carries this summary.

## TDD Gate Compliance

- RED `f6112aa1` (`test(13-14)`) precedes GREEN `f80498c2` (`feat(13-14)`). No refactor commit. Task 1 is the tracer (its own test, not RED/GREEN).
- RED evidence: `pnpm --filter @rede-social/api exec vitest run tests/integration/reports-blocks.test.ts` exited 1 with 8 tests, 3 passed (the tracer's, which already worked) and 5 failed on their assertions (`expected 404 to be 200` at the first `POST /v1/blocks`, after the positive-control reads that show the fixtures are valid; `expected { …(14) } to match object { canReport: true, canBlock: true }`; `expected false to be true` on the 60 block statuses; a `SyntaxError` parsing the 404 body of a route that did not exist yet). The REAL Vitest JSON report was converted to TAP by a throwaway script kept in the scratchpad, outside the repo, and `gsd check tdd-red-evidence` returned `RED_EVIDENCE_OK` (`target_test_failed`). An earlier draft failed with `400` because of a limit above the feed's maximum of 25; that was a test-authoring error fixed before the RED commit and is not RED evidence.
- GREEN: the same file passed 8 of 8 on the first run after the implementation; the finished file passes 21 of 21.

## Gate results (Task 3)

- `pnpm boundaries`: 2248 files, no issues. `pnpm guard:lanes`: OK (the new `set local role` is `is_local`). `apps/web/lib/route-handlers.inventory.test.ts`: 4 passed.
- `TURBO_CACHE=local:r pnpm turbo typecheck --concurrency=4` for core, api, contracts, module-feed, module-social: 5 successful; `apps/web` `tsc --noEmit` clean (run directly to avoid a Next build). No `.turbo` or `.next` artefact created.
- Vitest: core 101 files / 1487 tests, contracts 18 / 451, module-feed 24 / 327, module-social 7 / 63, api unit 11 / 131 (both inventories).
- Integration (15 files, 366 tests, all passed): reports-blocks (21), moderation-comments, moderation-posts, moderation-log, member-admin, feed, feed-interactions, feed-social, feed-query-budget, feed-edit-delete, social, social-module, social-media, reels, communities. `isolation.test.ts -t "phase 13 sweep"`: 2 passed.
- Whole `pnpm supabase test db`: 57 files, 3548 tests, **one failure: `154-moderation-log` test 48** ("every log row is anchored to two memberships of its own tenant"). It is the known residue: 16 append-only log rows whose throwaway members were deleted by the existing suites (`member-admin`, `moderation-posts` and others, which this plan's gate runs, plus 6 left by 13-13's gate at 16:29). None of this plan's rows is among them (its suite uses seeded members and unblocks the one it blocks). Clearing it needs `pnpm db:reset` then `pnpm db:seed`; the auto-mode classifier denied the reset when I attempted it, so it was not retried. `223-reports-blocks` and every other file pass.
- Disk: 7.5 GiB free at the start, 8.4 GiB after.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The shipped removal and block services open their own transactions**
- **Found during:** Task 1
- **Issue:** The plan says the resolve calls "the existing comment-removal service" and "the shipped admin block service" in one `withTenantTx`. `softDeletePost`, `deleteComment` and `changeAccess` each open their own transaction, and the block is an ADMIN-lane write (the tenant lane refuses `memberships` writes by design).
- **Fix:** each body extracted as an exported in-transaction function (`softDeletePostInTx`, `deleteCommentInTx`, `changeAccessInTx`) with an after-commit half; the originals are thin wrappers (the 24 feed files and the moderation and member-admin suites pass unchanged). `remove_content` and `dismiss` run in `withTenantTx`; `block_author` runs in `withAdminTx` with `asTenantLane` for the definer.
- **Files modified:** `packages/modules/feed/server/service.ts`, `packages/modules/feed/server/index.ts`, `packages/core/server/tenancy/member-admin.ts`, `packages/core/server/safety/reports.ts`, `apps/api/tests/admin-lane-inventory/safety.ts` (+ `index.ts`), `biome.json`
- **Commit:** `51a42525`

**2. [Rule 3 - Plan inaccuracy] The social service has no content read**
- **Found during:** Task 2
- **Issue:** the plan lists `packages/modules/social/server/service.ts` for "the Explorar list" and requires `grep -c is_blocked_by_viewer` there to be at least 1. Explorar is `listFeed` with `scope=explorar` in the FEED service, over the shared `feedPage`; the social service only lists people (followers, following, counts), and the block's effect on follow lists is Phase 11.
- **Fix:** the predicate went into `feedPage` once (so Explorar, community and the main list), and the social service is untouched. The social grep is 0 by design; the feed grep is 4 (at least 3). `module-social` passes unchanged (63).
- **Files modified:** none in social
- **Commit:** `f80498c2`

**3. [Rule 1 - Plan wording] The admin guard answers 403, not a bare 404**
- **Found during:** Task 1
- **Issue:** the plan says a caller without the permission gets "the moderation log's `notFound` behaviour, not 403". The log route uses `requirePermission('moderation.manage')`, which answers 403 `FORBIDDEN`.
- **Fix:** the new routes use the same guard, as the plan's "exactly as the log page" says. Both new routes are listed in the admin-lane and isolation inventories.
- **Commit:** `51a42525`

**4. [Rule 2 - Missing critical] The reporter could confirm a uuid they cannot read**
- **Found during:** Task 3 (13-08's open design note)
- **Issue:** the definer resolves the subject with the live predicate only, so a followers-only post of someone the reporter does not follow, or an item of a locked community, answered 201 and so confirmed the uuid.
- **Fix:** `createReport` reads the subject through the reporter's own lane first (the plan allows tightening); a miss is the same 404 as a missing id. Tested with a stranger and a follower.
- **Files modified:** `packages/core/server/safety/reports.ts`
- **Commit:** `eaa70f3e`

**5. [Rule 3 - Blocking] There is no request limiter beyond 13-13's**
- **Found during:** Task 1
- **Issue:** "the repository's limiter" is the in-process `createAttemptLimiter` that 13-13 added.
- **Fix:** `packages/core/server/safety/limits.ts` builds two instances (20 per hour, 60 per hour) on it. Per process, like 13-13's: the effective ceiling is the number times the Cloud Run instance count.
- **Commit:** `51a42525`

**6. [Rule 2 - Missing critical] Files outside the plan's list**
- `packages/core/server/http/api-error.ts` (`ERROR_MESSAGES` is a `Record<ErrorCode, string>`, so the four codes need messages, as 13-13 found), `packages/core/server/safety/{blocks,limits,sqlstate}.ts`, `apps/api/tests/admin-lane-inventory/{safety,index}.ts`, `apps/api/tests/integration/isolation.test.ts` (the isolation inventory forbids exempting a tenant-lane route, so a `phase 13 sweep: reports and blocks` case was added) and the feed contracts. `apps/api/src/routes/admin/index.ts` and `app.ts` mount the groups.

**7. [Scope addition] Two more read paths than the five**
- The replies and the comment thread also carry the predicate (a blocked member's reply must not show under someone else's root). Counters are not recomputed (AD-3).

**8. [Verify command] No `pnpm db:reset`**
- The local database already carried every migration and the seed; the gate ran against it. A reset was attempted at the end to clear the 154 residue and denied (see Gate results).

**Total deviations:** 8 (3 blocking, 2 missing-critical, 1 plan-wording, 1 scope addition, 1 verify-command). **Impact:** none on behaviour; every plan truth is covered and proven.

## Issues Encountered

- `GET /v1/openapi.json` still returns 500 (pre-existing, not touched).
- `.planning/ROADMAP.md` and `.planning/STATE.md` carried an uncommitted insertion of "Phase 12.1" (and `total_phases: 29`) that is not this plan's: it appeared while the plan ran. It is committed together with this plan's own state edits because the files are committed whole; if it was meant to be committed separately, that is the only thing in the docs commit that is not 13-14.

## Known Stubs

None.

## Threat Flags

None beyond the register. T-13-32 (disclosure) is mitigated and proven: `POST /v1/reports` answers the id only, the block answers carry no identity, the author's own `GET /v1/blocks` is empty, no notification row is created (count before and after), the filter is a viewer predicate (the bystander and the blocked member read exactly what they read before) and a blocked author's post is 404 even under a lock. T-13-33 (removal or block without an admin or without its log row) is mitigated and proven: only `resolve` under `moderation.manage` removes or blocks, a failing removal rolls the resolution back (report open, comment live, no log row), a second resolve is 409, and `grep -c "insert into.*moderation_log"` in the safety directory is 0. T-13-34 (abuse) is mitigated and proven: 429 on the 21st report and the 61st block, one report per reporter and item (409), a note bounded at 500 characters, pages of 20. The new `withAdminTx` site is inventoried.

## User Setup Required

None. Deploy order for hosted environments stays migration (13-08), web, then API (a new API sends `canReport` and `canBlock`, which an older strict web would refuse; the contracts ship them as optional). Nothing was pushed or applied to a hosted project.

## Next Phase Readiness

- **Plan 20 (screens), the one real gap:** a post or comment answer carries the author as `{ membershipId, displayName, avatarAssetId }` only, but `POST /v1/blocks` and `DELETE /v1/blocks/{userId}` take a USER id. The web has no user id to send. Decide there between an additive optional `author.userId` on the feed author objects (the strict schemas allow an optional key) and accepting a `membershipId` in the block body. Nothing here exposes a user id today.
- Plan 20, the rest: `reason` values are the five of `REPORT_REASONS`; the admin item carries `status`, `contentAvailable`, `excerpt`, `reporter.displayName`, `author.isMember` (offer "Bloquear autor" only when true) and `note`; the resolve verbs are `dismiss | remove_content | block_author`; refusals are `REPORT_ALREADY_RESOLVED` (toast "Esta denúncia já foi resolvida."), `ALREADY_REPORTED` (toast "Você já denunciou isto."), `CANNOT_REPORT_OWN`, `CANNOT_BLOCK`, `RATE_LIMITED`, and 409 `CONFLICT` with `details.report` (`not_removable`, `author_not_member`, `author_unavailable`) or `details.member` (the Phase 8 block refusals). A report of a followers-only post the viewer cannot read is a plain 404.
- NATIVE-31 and NATIVE-33 stay Pending in REQUIREMENTS.md: plan 20 also declares them.
- The limiters are per process; a shared store is a later item if the instance count grows. Run `pnpm db:reset` and `pnpm db:seed` before the next whole pgTAP (154 residue).

## Self-Check: PASSED

- Files exist (checked with `ls`): the five files of `packages/core/server/safety/`, `apps/api/src/routes/safety.ts`, `apps/api/src/routes/admin/reports.ts`, `apps/api/tests/admin-lane-inventory/safety.ts`, `apps/api/tests/integration/reports-blocks.test.ts`.
- Commits found: `51a42525`, `f6112aa1`, `f80498c2`, `eaa70f3e`, `7cfc49ba`; `git rev-list --count 98d98bd1..HEAD` is 5.
- Acceptance: `grep -c "insert into.*moderation_log" packages/core/server/safety/reports.ts` prints 0 and the removal is delegated (`removeContent`, `changeAccessInTx`); `CANNOT_REPORT_OWN` and `ALREADY_REPORTED` are in `errors.ts`; the tracer test asserts the `comment_removed` row; `grep -c is_blocked_by_viewer` is 4 in the feed service (social: 0, see deviation 2); the removed lines of `git diff -U0` on the feed service are only lines re-written to add a column or a predicate, no column dropped and no join added; `grep -c "reports" apps/api/tests/isolation-inventory.ts` is 10 and the three block routes are listed.
- Plan verification re-run: `pnpm boundaries`, `pnpm guard:lanes`, the web inventory test, the typecheck, the shipped suites and the new suite, all green as listed above (whole pgTAP green except the `154` residue).

---
*Phase: 13-app-nativo-ios-e-android-por-tenant-white-label*
*Completed: 2026-11-05*
