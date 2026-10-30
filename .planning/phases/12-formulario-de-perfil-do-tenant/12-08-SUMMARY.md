---
phase: 12-formulario-de-perfil-do-tenant
plan: 08
subsystem: api
tags: [profile-form, admin-api, builder, lock-rules, optimistic-lock, D-587, D-596, D-582, tracer]

requires:
  - phase: 12-formulario-de-perfil-do-tenant
    provides: "plan 02 the module key, manifest and permissions, plan 03 the contract schemas, plan 04 the tables and the guard trigger PF001..PF005, plan 06 the member save and the lock function, plan 07 the answers read"
provides:
  - "GET /v1/profile_form/questions: the active questions in the admin's order with answerCount per question and per option, activeCount and limit 30 (aggregates only)"
  - "POST /v1/profile_form/questions: a question at the end of the list (position last+1, revision 1, server-made option ids, caller as author), 409 limit_reached at 30"
  - "PATCH /v1/profile_form/questions/{id}: edit under the five D-587 locks and an optimistic revision, 409 stale_revision / already_archived, an unchanged body is a 200 that does not bump the revision"
  - "PUT /v1/profile_form/order: the whole active list renumbered 1..n in one statement, 409 order_mismatch for anything that is not exactly the active set"
  - "checkLocks and guardIssueOf: the pure D-587 rules and the PF001..PF005 to code map (packages/core/server/profile-form/lock-rules.ts)"
  - "kernel adminLock, requireModuleOn, listInTx, readOne, readActive, adminQuestionOf and the four services in admin.ts, reusable by plan 09 (archive, reactivate, delete, replace)"
  - "module export ./server (profileFormRoutes), manifest routes, mount /v1/profile_form"
affects: [12-09, 12-10, 12-15, 12-16, profile-form]

actuals:
  tokens: 29700
  tasks: 3
  commits: 3
plan_head_before: 098fcfe0f7412fa87f6dfedd869ecf95758471aa

tech-stack:
  added: []
  patterns:
    - "The module owns its guard chain: router-level requireAuth, then requireModule and the literal requirePermission on every route; the service ALSO re-reads the live tenant_modules row in its own transaction"
    - "Every admin write of a tenant: per-tenant advisory lock, live module check, then the rows FOR UPDATE in position, created_at, id order, then the facts read in a SEPARATE statement so an answer committed while the edit waited is seen"
    - "The pure rules decide first (checkLocks) and the database trigger is the backstop; both answer the same coded 409 with details.profileForm"
    - "A reorder body that is not the active set is a 409 order_mismatch, mapped in the router defaultHook for every schema issue carrying that code"

key-files:
  created:
    - packages/core/server/profile-form/admin.ts
    - packages/core/server/profile-form/lock-rules.ts
    - packages/core/tests/profile-form-lock-rules.test.ts
    - packages/modules/profile-form/server/index.ts
    - packages/modules/profile-form/server/routes.ts
    - apps/api/tests/integration/profile-form-admin.test.ts
  modified:
    - packages/contracts/src/profile-form.ts
    - packages/modules/profile-form/module.ts
    - packages/modules/profile-form/package.json
    - packages/modules/profile-form/contracts/index.ts
    - packages/modules/profile-form/README.md
    - apps/api/src/app.ts
    - apps/api/tests/integration/isolation.test.ts
    - apps/api/tests/isolation-inventory.ts
    - apps/api/tests/integration/profile-form-concurrency.test.ts

key-decisions:
  - "The live module re-check in a write is a plain read of the tenant_modules row, not FOR SHARE: the table has no tenant-lane update policy, so FOR SHARE returns zero rows from the admin's session (verified on the local stack) and would read as 'module off'"
  - "The answer facts (count, answered option ids, Outro present) are read AFTER the question row is locked FOR UPDATE and in separate statements; a member's save locks the questions FOR SHARE first, so no answer can slip between the facts and the update"
  - "The lock check runs before the merged-definition validation, so an edit that breaks a D-587 lock answers the lock code even when it would also be an invalid definition"
  - "A merged edit is validated by the SAME createQuestionBodySchema a create runs, so no database CHECK can surface as a 500"
  - "Every schema issue coded order_mismatch on the reorder body (empty, a repeat, a non-uuid) is lifted to 409, not 400, so 'not exactly the active set' has one answer"
  - "The id of an option sent in a PATCH that the question does not hold, or sent twice, is a 400 unknown_option: it would otherwise be a new option wearing a client-chosen id"

patterns-established:
  - "The router defaultHook lifts a Zod issue whose message is a profile form code to details.profileForm (the payments precedent)"
  - "A two-connection test holds a member transaction open (claims, set local role, lock function, answer insert) and proves the admin edit is still pending after 600 ms before releasing it"

requirements-completed: [PFORM-01, PFORM-02, PFORM-17, PFORM-24]

coverage:
  - id: D1
    description: "The module's routes are mounted at /v1/profile_form behind requireAuth, requireModule and profile_form.manage on every route: the module off is 404 MODULE_DISABLED, a support_tenant and a member are 403, another tenant's admin is TENANT_HOST_MISMATCH on this host and sees only his own list on his"
    requirement: PFORM-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-admin.test.ts#12-08 the guard chain refuses everyone but the tenant admin (D-596, T-12-19)"
        status: pass
      - kind: unit
        ref: "apps/api/tests/unit/mounts.test.ts#1. every manifest with routes is actually mounted under /v1/<key>"
        status: pass
    human_judgment: false
  - id: D2
    description: "Tracer: an admin creates a question, lists it with answerCount 0 through the guard chain and a member of the same tenant sees it in GET /v1/me/profile-form; the list carries aggregates only and a tenant with no question answers an empty list"
    requirement: PFORM-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-admin.test.ts#12-08 tracer: an admin creates a question through the guard chain, lists it with its counts and a member sees it"
        status: pass
    human_judgment: false
  - id: D3
    description: "Create limits and encoding: the 31st active question is 409 limit_reached, two or three simultaneous creates at 29 end with exactly 30, an empty or whitespace title is 400 required, titles and help text count code points (120 emoji accepted, 121 refused), markup is stored as sent after the trim"
    requirement: PFORM-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-admin.test.ts#12-08 the limits and the encoding of a new question (PFORM-02)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The pure lock rules: with no answers everything is free, with answers each of type, option, Outro, visibility and limits has its code, the first violated rule wins, decimals compare exactly and dates as calendar days, and the trigger's PF001..PF005 map to the same codes"
    requirement: PFORM-17
    verification:
      - kind: unit
        ref: "packages/core/tests/profile-form-lock-rules.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "Each D-587 lock through HTTP with its allowed counterpart: option rename (case, whitespace) and removal refused beside an unanswered rename that works, adding and reordering options free, Outro, private-to-public, narrowed number and date limits, equal and widened limits accepted, options never below two"
    requirement: PFORM-17
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-admin.test.ts#12-08 each D-587 lock, through HTTP, with its allowed counterpart"
        status: pass
    human_judgment: false
  - id: D6
    description: "Optimistic revision: a stale revision is 409 and changes nothing, the same patch twice is 200 then 409, an unchanged body keeps the revision, two simultaneous patches leave one winner, an archived question is 409 already_archived, another tenant's id and an unknown id are the same bare 404"
    requirement: PFORM-24
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-admin.test.ts#12-08 the optimistic revision and the idempotency of an edit (PFORM-24, T-12-21)"
        status: pass
    human_judgment: false
  - id: D7
    description: "An answer racing the edit is stopped: a member transaction holding the question lock and an answer makes the admin's type change wait, then answer 409 type_locked, never a 500"
    requirement: PFORM-17
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-admin.test.ts#12-08 an answer racing the edit is stopped by the row lock taken first (PFORM-17, T-12-20)"
        status: pass
    human_judgment: false
  - id: D8
    description: "Reorder: the whole active list is renumbered 1..n with no revision bump and the member's form follows; a list that is not exactly the active set is 409 order_mismatch and changes nothing; another tenant's ids leak nothing; a reorder racing a create or another reorder ends with one consistent numbering"
    requirement: PFORM-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-admin.test.ts#12-08 reordering the form (PFORM-02, D-582)"
        status: pass
    human_judgment: false
  - id: D9
    description: "The member save racing the REAL admin reorder never deadlocks (the 12-06 simulated case 4, converted)"
    requirement: PFORM-24
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-concurrency.test.ts#4. the locks are taken in one canonical order"
        status: pass
    human_judgment: false
  - id: D10
    description: "The four builder routes are in the isolation inventory with a cross-tenant case and same-tenant positive controls; the module README matches its manifest and imports"
    requirement: PFORM-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#phase 12 sweep: profile form admin"
        status: pass
      - kind: unit
        ref: "apps/api/tests/unit/isolation-inventory.test.ts; apps/api/tests/unit/module-readmes.test.ts"
        status: pass
    human_judgment: false
  - id: D11
    description: "The builder screens that call these routes (UI) are not built in this plan"
    requirement: PFORM-02
    verification: []
    human_judgment: true
    rationale: "Plans 15 and 16 own the builder screens; the API half is proven here, the rendering is not"

duration: 15min
completed: 2026-10-30
status: complete
---

# Phase 12 Plan 08: The builder write API Summary

**Create, list, edit and reorder the profile form under /v1/profile_form: the module's own guard chain, an advisory lock plus canonical row locks on every write, the five D-587 locks decided first by a pure checkLocks and backed by the plan-04 trigger, and an optimistic revision.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-10-30T00:08:30Z
- **Completed:** 2026-10-30T00:23:50Z
- **Tasks:** 3 (1 tracer, 2 auto)
- **Files modified:** 15 (6 created, 9 modified)

## Accomplishments

- Tracer through every layer: an admin creates a required short-text question, lists it with `answerCount: 0` through `requireAuth`, `requireModule('profile_form')` and `profile_form.manage`, and a member of the tenant sees it in her own form; the module off is `404 MODULE_DISABLED`, a support and a member are 403, and another tenant's admin cannot read or write across the host.
- `checkLocks` is pure (no database, no I/O) and decides the five D-587 locks in a fixed order (type, answered option, Outro, visibility, limits); the service asks it before the update and maps the trigger's PF001..PF005 to the same coded 409s if a race gets past it. Every code is proven through HTTP with its allowed counterpart.
- Every write takes `pg_advisory_xact_lock` first, then locks rows `FOR UPDATE` in `position, created_at, id` order and reads the answer facts after that, so an answer committed while an edit waited is seen; a two-connection test shows the wait and the coded refusal.
- The reorder renumbers the whole active list 1..n in one `UPDATE ... FROM jsonb_array_elements_text ... WITH ORDINALITY`, without bumping any revision; a list that is not exactly the active set is `409 order_mismatch`.
- The 12-06 concurrency case 4, which simulated the admin side, now races the real reorder route and shows no deadlock.
- The four routes are in the isolation inventory with a real cross-tenant case; the module README documents routes, lock rules and the concurrency model.

## Task Commits

1. **Task 1: [tracer] create and list through the guard chain, the member sees it** - `87fd8985` (feat)
2. **Task 2: edit under the D-587 lock rules and an optimistic revision** - `2bc79314` (feat)
3. **Task 3: reorder, isolation entries, README, real-route concurrency case** - `0903af56` (feat)

**Plan metadata:** committed after this file (docs: record plan in state and roadmap).

## Files Created/Modified

- `packages/core/server/profile-form/admin.ts` - `adminLock`, `requireModuleOn`, `listQuestions`, `createQuestion`, `updateQuestion`, `reorderQuestions` and the shared readers
- `packages/core/server/profile-form/lock-rules.ts` - `checkLocks` and `guardIssueOf`, pure
- `packages/core/tests/profile-form-lock-rules.test.ts` - 37 table-driven cases
- `packages/modules/profile-form/server/{index,routes}.ts` - `profileFormRoutes`, four guarded routes
- `packages/modules/profile-form/{module.ts,package.json,contracts/index.ts,README.md}` - manifest `routes`, `./server` export, contract re-exports, documentation
- `packages/contracts/src/profile-form.ts` - `adminQuestionListSchema` (additive)
- `apps/api/src/app.ts` - `.route('/v1/profile_form', profileFormRoutes)` after payments
- `apps/api/tests/integration/profile-form-admin.test.ts` - 36 cases against the live stack
- `apps/api/tests/integration/{isolation.test.ts,profile-form-concurrency.test.ts}`, `apps/api/tests/isolation-inventory.ts` - the `phase 12 sweep: profile form admin` case, its four entries and the converted case 4

## Decisions Made

See `key-decisions`. In short: a plain live read replaces `FOR SHARE` for the module re-check, the lock check runs before the merged-definition validation, and every reorder body that is not the active set answers 409.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] FOR SHARE on tenant_modules returns nothing from the admin's session**
- **Found during:** Task 1 (the plan says to re-read the module row `for share`)
- **Issue:** `tenant_modules` has only a tenant-lane SELECT policy; `FOR SHARE` applies the UPDATE policy to the rows it would lock, so from an `admin_tenant` session it returned zero rows (checked on the local stack: plain select 11 rows, `for share` 0) and the module would have read as off.
- **Fix:** the write re-checks the module with the existing `liveModuleOn` (a plain read in the same transaction), still never the flags cache. The same lesson as plan 06 for question rows.
- **Files modified:** `packages/core/server/profile-form/admin.ts`
- **Committed in:** `87fd8985`

**2. [Rule 2 - Missing critical] A merged edit could break a table CHECK as a 500**
- **Found during:** Task 2 (reading `profile_form_questions_options_chk` and the update body schema)
- **Issue:** `updateQuestionBodySchema` validates fields independently; a type change to a choice type without two options, "Outro" on a non-choice type or a limit of the wrong kind would reach the CHECKs and surface as a database error.
- **Fix:** the merged definition is validated by the same `createQuestionBodySchema` a create runs (400 with `details.profileForm`), after the lock check; a type change on a never-answered question drops options, "Outro" and limits the new type cannot carry.
- **Files modified:** `packages/core/server/profile-form/admin.ts`
- **Committed in:** `2bc79314`

**3. [Rule 2 - Missing critical] An option id the question does not hold**
- **Found during:** Task 2
- **Issue:** a PATCH option carrying an unknown or repeated `id` would have become a new option with a client-chosen id.
- **Fix:** 400 `unknown_option`; options without an id get a server UUID.
- **Files modified:** `packages/core/server/profile-form/admin.ts`
- **Committed in:** `2bc79314`

**4. [Plan wording] A duplicate in the reorder list is 409, not the schema's 400**
- **Found during:** Task 3
- **Issue:** the plan says a duplicate is `409 order_mismatch`, but `reorderBodySchema` rejects a duplicate, an empty list and a non-uuid with the issue code `order_mismatch`, which the default hook turned into a 400.
- **Fix:** the router `defaultHook` lifts that one code to `409 CONFLICT` with `details.profileForm: order_mismatch`, so every list that is not exactly the active set answers the same.
- **Files modified:** `packages/modules/profile-form/server/routes.ts`
- **Committed in:** `0903af56`

### Judgement calls

- `apps/api/tests/integration/profile-form-concurrency.test.ts` and `packages/contracts/src/profile-form.ts` (`adminQuestionListSchema`) are not in the plan's `files_modified`; the first was converted at the orchestrator's direction (plan 06 asked for it), the second is the list response the plan names without a contract for it.
- The module README was brought in step in Task 1 (so `module-readmes.test.ts` never went red between commits) and completed in Task 3.
- The race test fires three simultaneous creates at 29 questions (one 201, two 409) instead of two; it proves the same serialisation.
- The "answer arriving between the service's lock check and the update" truth is proven with the member transaction holding the lock first and the admin PATCH waiting on its `FOR UPDATE`; the trigger path itself is unreachable through the service once the row is locked, so its mapping is covered by `guardIssueOf` unit cases (bare and wrapped in a cause chain).

---

**Total deviations:** 3 auto-fixed (1 Rule 3, 2 Rule 2), 1 plan-wording correction.
**Impact on plan:** all needed for correctness; no scope creep, no new migration.

## Issues Encountered

- `pnpm supabase test db` failed one assertion (`180-store.sql` test 121) on its first run and passed in full (53 files, 3125 tests, `220-profile-form.sql` included) on an immediate rerun with no change; the known flake, and this plan touches no database object.
- Free disk 4.1 GB at the end (4.2 GB at the start); no build, no Playwright.

## Known Stubs

None.

## Threat Flags

None. No new network surface beyond the planned routes, no new table or function. T-12-19 (guard chain with the literal permission on each route, live module re-check, role and tenant matrix), T-12-20 (pure rules first, trigger backstop, two-connection race) and T-12-21 (revision, advisory lock, canonical row-lock order, race tests) are mitigated and each has an automated test. The two flagged prohibitions hold: no route returns an individual answer (the list's keys are asserted to contain no `value`, `answer`, `answers` or `otherText`), and nothing filters titles or types by content.

## User Setup Required

None - no external service configuration required. Nothing was pushed and no hosted project was touched.

## Next Phase Readiness

- Plan 09 (archive, reactivate, delete, replace, summary, impact) can reuse `adminLock`, `requireModuleOn`, `readOne`, `listInTx` and `adminQuestionOf`, and must lock multiple rows in `position, created_at, id` order. Its routes join the same router and need isolation entries.
- Plans 15 and 16 (the builder screens) can call the four routes; the 409 and 400 shapes are `details.profileForm` and the list is `{ questions, activeCount, limit }`.
- Plan 12-01 (sketch 016, Igor's design-gate review) still has no SUMMARY and was not touched; the plan pointer was not advanced.

---
*Phase: 12-formulario-de-perfil-do-tenant*
*Completed: 2026-10-30*

## Self-Check: PASSED

- Created files exist: `admin.ts`, `lock-rules.ts`, `profile-form-lock-rules.test.ts`, `server/index.ts`, `server/routes.ts`, `profile-form-admin.test.ts`.
- Commits `87fd8985`, `2bc79314` and `0903af56` exist; `git rev-list --count 098fcfe0..HEAD` is 3 before this commit.
- Acceptance re-run: `profile_form.manage` appears 5 times in `routes.ts` (at least 2); `/v1/profile_form` appears once in `app.ts`; `pg_advisory_xact_lock` appears in `admin.ts`; `checkLocks` is used in `admin.ts` and `lock-rules.ts` imports neither `drizzle-orm` nor `db`; the integration file asserts all five lock codes, `already_archived`, `stale_revision` and `order_mismatch`; the list response keys contain no individual-answer field; `isolation-inventory.ts` lists the four routes and `isolation.test.ts` has the `phase 12 sweep: profile form admin` title.
- Plan verification: `profile-form-lock-rules.test.ts` 37 passed; `mounts`, `registry`, `isolation-inventory`, `module-readmes` unit tests 56 passed; `profile-form-admin.test.ts` 36 passed; with `-concurrency`, `-member`, `-answers` and `-gate` 112 passed over the five files; `isolation.test.ts -t "phase 12 sweep"` 3 passed; pgTAP 53 files, 3125 tests PASS (220 untouched); `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4` 41 of 41 tasks successful.
