---
phase: 12-formulario-de-perfil-do-tenant
plan: 09
subsystem: api
tags: [profile-form, admin-api, archive, reactivate, replace, impact, summary, D-585, D-588, D-589, tracer]

requires:
  - phase: 12-formulario-de-perfil-do-tenant
    provides: "plan 04 the tables, the RESTRICT foreign key and the guard trigger, plan 05 the gate, plan 06 the member save and app.profile_form_lock_active(), plan 08 adminLock, requireModuleOn, readOne, listInTx, adminQuestionOf and the four builder routes"
provides:
  - "POST /v1/profile_form/questions/{id}/archive and /reactivate: idempotent, answers never touched, reactivation at the end of the active list, 409 limit_reached at 30"
  - "GET /v1/profile_form/archived: archivedAt, required and exact answerCount (also per option), newest archive first then id"
  - "DELETE /v1/profile_form/questions/{id}: only a never-answered question, 409 has_answers otherwise, SQLSTATE 23503 mapped to the same code"
  - "POST /v1/profile_form/questions/replace: new question plus archive of the old one in one transaction, new question takes the old position, allowed at 30"
  - "GET /v1/profile_form/summary ({ total, complete, hasRequired }) and GET /v1/profile_form/impact ({ members }): counts only, staff excluded"
  - "kernel archiveQuestion, reactivateQuestion, listArchived, deleteQuestion, replaceQuestion, getSummary, getImpact in packages/core/server/profile-form/admin.ts"
  - "the admin half of the two-connection suite and seven isolation inventory entries with a cross-tenant case"
affects: [12-10, 12-15, 12-16, 12-17, profile-form]

actuals:
  tokens: 25400
  tasks: 3
  commits: 3
plan_head_before: 700f03811bf73cb31229fa6b7aecc1967e8fd29d

tech-stack:
  added: []
  patterns:
    - "Every lifecycle write: advisory lock, live module check, then the one row FOR UPDATE; no statement of the lifecycle touches the answers table except a count or an existence probe"
    - "The builder's numbers are one set-based statement over live active member memberships; completeness is recomputed from the SQL rule's shape, never stored"
    - "A database failure injected through a temporary trigger proves a multi-statement service rolls back as a whole"

key-files:
  created:
    - apps/api/tests/integration/profile-form-lifecycle.test.ts
  modified:
    - packages/core/server/profile-form/admin.ts
    - packages/modules/profile-form/server/routes.ts
    - packages/modules/profile-form/contracts/index.ts
    - packages/modules/profile-form/README.md
    - packages/contracts/src/profile-form.ts
    - apps/api/tests/integration/profile-form-concurrency.test.ts
    - apps/api/tests/integration/isolation.test.ts
    - apps/api/tests/isolation-inventory.ts

key-decisions:
  - "Archive, reactivate and replace never write an answer row; the integration file counts answer rows before and after every lifecycle call and asserts equality (D-588, T-12-22)"
  - "Impact answers 0 for a make_required of a question that is already required or archived and for a reactivate of an optional or active one, because nobody would be asked anything new; create_required and replace answer the member total"
  - "The summary counts members with status active, blocked_at null, deleted_at null and role member, the fold the members list already uses, so a blocked or invited member is in no number"
  - "A member's save locks EVERY active question FOR SHARE (plan 06 design), so the adjacency truth is proven as: create, reactivate and reads never wait for a save, an edit of an active question does"

patterns-established:
  - "createQuestion and replaceQuestion share one insertQuestion helper (position given or last + 1)"
  - "A lifecycle route returns the same bare NOT_FOUND for an unknown and a foreign id, and the isolation case asserts the foreign id is never echoed"

requirements-completed: [PFORM-03, PFORM-08, PFORM-17, PFORM-23, PFORM-24]

coverage:
  - id: D1
    description: "Tracer: archiving a required question releases the held member and keeps every answer; reactivating holds her again while a member who had answered stays complete; archiving the last required question releases everyone with all answer rows still there"
    requirement: PFORM-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-lifecycle.test.ts#12-09 tracer: archive and reactivate a required question and the gate follows, answers kept (D-585, D-588, D-589)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Idempotency, ordering, boundary, adjacency and precision of archive and reactivate: twice is a 200 no-op, reactivation lands at max(position)+1, the archived list is ordered by archived_at desc then id, answerCount is exact, same-title questions coexist, reactivation at 30 is 409 limit_reached, a foreign id is the bare 404"
    requirement: PFORM-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-lifecycle.test.ts#12-09 archive and reactivate: idempotency, ordering, boundary and adjacency (PFORM-03)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Delete only a never-answered question (has_answers through HTTP, the foreign key refusal through SQL, second delete 404) and replace atomically (position taken, answers kept, injected failure rolls both halves back, allowed at 30)"
    requirement: PFORM-17
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-lifecycle.test.ts#12-09 delete a question nobody answered (PFORM-03, D-588, T-12-22); #12-09 replace: the new question and the archive of the old one in ONE transaction (PFORM-17)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Summary and impact are exact counts against hand counts, exclude staff, blocked and invited members and other tenants, carry no answer key, are 403 for member and support, and 404 MODULE_DISABLED with the module off"
    requirement: PFORM-23
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-lifecycle.test.ts#12-09 the summary and the impact: counts only, staff excluded (PFORM-23, D-584, D-585)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The admin side of the two-connection suite: admin against admin on revision, type change against a save, reorder against a create at 29, archive against a save in both orders, lock order with edits and a reorder, retry after form_changed, adjacency and empty form"
    requirement: PFORM-24
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-concurrency.test.ts#12-09 the admin side of the two-connection suite (PFORM-24, PFORM-03)"
        status: pass
    human_judgment: false
  - id: D6
    description: "All seven lifecycle routes are in the isolation inventory with a real cross-tenant case and same-tenant positive controls; the README matches the manifest"
    requirement: PFORM-08
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#phase 12 sweep: profile form lifecycle"
        status: pass
      - kind: unit
        ref: "apps/api/tests/unit/isolation-inventory.test.ts; apps/api/tests/unit/module-readmes.test.ts"
        status: pass
    human_judgment: false
  - id: D7
    description: "The builder screens that show the archived list, the summary and the impact warning (UI) are not built in this plan"
    requirement: PFORM-23
    verification: []
    human_judgment: true
    rationale: "Plans 15 to 17 own the screens and the rule that a failing impact read blocks the write; the API half is proven here, the rendering is not"

duration: 13min
completed: 2026-10-30
status: complete
---

# Phase 12 Plan 09: Question lifecycle and the builder's numbers Summary

**Archive, reactivate, delete (never answered only), atomic replace, the archived list, the summary and the impact read under /v1/profile_form: the gate follows each transition through the SQL rule, no answer is ever written or removed, and the whole admin side is proven race-safe on separate connections.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-10-30T00:24:00Z
- **Completed:** 2026-10-30T00:37:00Z
- **Tasks:** 3 (1 tracer, 2 auto)
- **Files modified:** 9 (1 created, 8 modified)

## Accomplishments

- Tracer: a held member is released the moment the admin archives her required question, held again on reactivation, and a member who had answered it before the archive stays complete; archiving the last required question releases everyone with all answer rows untouched (D-585, D-588, D-589). The integration file counts answer rows before and after every call.
- Delete refuses any question with an answer (`has_answers`, active or archived), the RESTRICT foreign key refuses the same delete in SQL, and a second delete is the bare 404.
- Replace inserts the new question at the old position and archives the old one in one transaction; a trigger injected into the archive half proves both roll back (old question active, nothing created); it is allowed at 30 active questions.
- Summary (`{ total, complete, hasRequired }`) and impact (`{ members }`) are exact counts matching hand counts, with no answer key in any response. `EXPLAIN (ANALYZE)` of the summary statement on a rolled-back fixture of 20,004 active members, 5 required questions and 70,069 answers: **17.1 ms** execution (limit 500 ms); the fixture was rolled back (0 residue rows).
- The two-connection suite gains its admin half (six numbered cases plus adjacency and empty), and the seven routes join the isolation inventory with a cross-tenant case and positive controls.

## Task Commits

1. **Task 1: [tracer] archive and reactivate, the gate follows, answers kept** - `f64a18f2` (feat)
2. **Task 2: delete, atomic replace, summary and impact** - `351b8b93` (feat)
3. **Task 3: admin side of the two-connection suite, isolation entries, README** - `742d7b02` (feat)

**Plan metadata:** committed after this file (docs: record plan in state and roadmap).

## Files Created/Modified

- `packages/core/server/profile-form/admin.ts` - `archiveQuestion`, `reactivateQuestion`, `listArchived`, `deleteQuestion`, `replaceQuestion`, `getSummary`, `getImpact` and the shared `insertQuestion`
- `packages/modules/profile-form/server/routes.ts` - the seven routes behind `requireModule` and `profile_form.manage`
- `packages/modules/profile-form/contracts/index.ts`, `packages/contracts/src/profile-form.ts` - re-exports and `archivedQuestionListSchema` (additive)
- `packages/modules/profile-form/README.md` - routes, replace semantics, the aggregate-only rule
- `apps/api/tests/integration/profile-form-lifecycle.test.ts` - 23 cases against the live stack
- `apps/api/tests/integration/profile-form-concurrency.test.ts` - 6 numbered admin cases plus adjacency and empty (12 total in the file)
- `apps/api/tests/integration/isolation.test.ts`, `apps/api/tests/isolation-inventory.ts` - `phase 12 sweep: profile form lifecycle` and seven entries

## Decisions Made

See `key-decisions`. In short: the lifecycle never writes answers, impact reports 0 where nobody would be asked, and the adjacency truth is read through plan 06's design in which a save locks every active question.

## Deviations from Plan

### Auto-fixed Issues

**1. [Plan wording] The Task 1 commit carries the Task 2 service and route code**
- **Found during:** Task 1 (the service file and the route file were written in one pass)
- **Issue:** `admin.ts`, `routes.ts` and the contract re-exports were complete for all seven routes when the tracer test first passed, so splitting them across two commits would have needed an artificial cut.
- **Fix:** committed together in `f64a18f2`; the Task 2 commit (`351b8b93`) is the delete, replace, summary and impact integration cases that prove that code.
- **Files modified:** `packages/core/server/profile-form/admin.ts`, `packages/modules/profile-form/server/routes.ts`
- **Committed in:** `f64a18f2`

**2. [Rule 2 - Missing critical] An archived-list response schema and module contract re-exports**
- **Found during:** Task 1
- **Issue:** `archivedQuestionSchema` existed but no schema for the list response, so the route could not be typed; `contracts/index.ts` did not re-export the new schemas.
- **Fix:** added `archivedQuestionListSchema` (additive) to `packages/contracts/src/profile-form.ts` and re-exports to the module contracts. Neither file is in the plan's `files_modified`; no existing export changed.
- **Files modified:** `packages/contracts/src/profile-form.ts`, `packages/modules/profile-form/contracts/index.ts`
- **Committed in:** `f64a18f2`

### Judgement calls

- Impact returns 0 for `make_required` of a question that is already required or archived (nobody would be asked anything new), in addition to the plan's cases; `reactivate` of an optional or active question is 0 as written. A missing `questionId` for `make_required` or `reactivate` is 400 `invalid`.
- "Replace failing in its second half" is forced with a temporary `BEFORE UPDATE` trigger that raises when a title starting `pfl fail` is archived (created and dropped inside the test), because no unique constraint makes the insert half refuse a schema-valid body. The route answers 500 and the test shows the old question active at revision 1 and zero new rows.
- PFORM-24 adjacency: a member's save locks every active question `FOR SHARE` (plan 06), so an edit of ANY active question waits for a save in flight, not only the question the member answers. The case therefore proves what does not wait (create, reactivate of an archived question, the reads) and that the edit of an active row does.
- The archive-before-save race: the save skips the archived row when it re-evaluates its lock, the etag no longer matches and the answer is `form_changed` (409) rather than `unknown_question`; either way no answer row exists, which is what the truth requires.

---

**Total deviations:** 1 Rule 2 auto-fix, 1 plan-wording correction, 4 judgement calls.
**Impact on plan:** no scope creep, no migration, no new table or function.

## Issues Encountered

- `pnpm supabase test db` failed one assertion (`180-store.sql` test 121) on its first run and passed in full (53 files, 3125 tests, `220-profile-form.sql` included) on an immediate rerun with no change; the known flake.
- Free disk 3.3 GB at the end (4.0 GB at the start); no build, no Playwright. The EXPLAIN fixture lived in a rolled-back transaction.

## Known Stubs

None.

## Threat Flags

None. No new surface beyond the seven planned routes. T-12-22 (`has_answers` refusal, the RESTRICT foreign key proven by a forced SQL delete, replace as one transaction proven by an injected failure, answer rows counted before and after every lifecycle call) and T-12-23 (summary, impact and archived list typed with no answer key and compared in the tests, every query carries `tenant_id`, foreign ids are the bare 404) are mitigated and each has an automated test. The flagged prohibition holds: there is no route that deletes a question with answers and no lifecycle path removes or hides stored answers.

## User Setup Required

None - no external service configuration required. Nothing was pushed and no hosted project was touched.

## Next Phase Readiness

- Plans 15 to 17 (builder screens) can call the seven routes; the 409 shapes are `details.profileForm` in `has_answers`, `limit_reached`, `already_archived`, and the impact read must block the write on failure (plan 17).
- Plan 12-01 (sketch 016, Igor's design-gate review) still has no SUMMARY and was not touched; the plan pointer was not advanced.

---
*Phase: 12-formulario-de-perfil-do-tenant*
*Completed: 2026-10-30*

## Self-Check: PASSED

- Created file exists: `apps/api/tests/integration/profile-form-lifecycle.test.ts`.
- Commits `f64a18f2`, `351b8b93` and `742d7b02` exist; `git rev-list --count 700f0381..HEAD` is 3 before this commit.
- Acceptance re-run: the lifecycle file counts answer rows before and after archive (`answerRows`, equality asserted) and asserts `has_answers` over HTTP, `23503` over SQL, the atomic replace rollback and one impact assertion per `change`; the summary, impact and archived responses are compared against `value`, `answer`, `answers`, `otherText` keys; `grep -c "phase 12 sweep: profile form lifecycle" apps/api/tests/isolation-inventory.ts` is 7 (at least 7); the concurrency file has the six numbered cases.
- Plan verification: `profile-form-lifecycle` 23 passed; `profile-form-concurrency` 12 passed; with `-admin` (36), `-gate` (13), `-member` (48) and `-answers` (11) all green; `isolation.test.ts -t "phase 12 sweep"` 4 passed; `isolation-inventory` and `module-readmes` unit tests 28 passed; pgTAP 53 files, 3125 tests PASS (220 untouched); `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4` 41 of 41 tasks successful.
