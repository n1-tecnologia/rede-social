---
phase: 12-formulario-de-perfil-do-tenant
plan: 06
subsystem: api
tags: [profile-form, member-api, answers, validation, rls, row-locks, D-580, D-582, D-585, D-586, tracer]

requires:
  - phase: 12-formulario-de-perfil-do-tenant
    provides: "plan 03 parseAnswer / missingIssue / answerEtag and the wire schemas, plan 04 tables and app.profile_form_missing_self, plan 05 the gate, PROFILE_FORM_ALLOWED_PATHS, liveModuleOn and the test helpers"
provides:
  - "GET /v1/me/profile-form: every active question in the admin's order, pre-filled, with mode (none, first, returning, edit), missingRequired and formEtag decided by the server"
  - "PUT /v1/me/profile-form/answers: the single save for the whole screen, validated by parseAnswer from the stored question in one transaction, keyed 400 answers_invalid, 409 form_changed with the fresh form"
  - "POST /v1/me/profile-form/dismiss-notice: server-side 'Agora não' (batch instant, moves forward on a later dismissal)"
  - "app.profile_form_lock_active(): definer function that locks the caller's active questions FOR SHARE in position, created_at, id order"
  - "kernel getMemberForm, saveAnswers, dismissNotice, formEtagOf in packages/core/server/profile-form/member.ts"
  - "answers added to the root logger redaction list"
affects: [12-07, 12-08, 12-09, 12-11, 12-12, 12-14, 12-18, profile-form]

actuals:
  tokens: 22100
  tasks: 3
  commits: 3
plan_head_before: 0597a8a8920ceffc85d1711866330c3a472c65f9

tech-stack:
  added: []
  patterns:
    - "A row lock the tenant lane cannot take under RLS goes through a SECURITY DEFINER function that reads the tenant from the session claims, never from an argument"
    - "Writes inside one transaction go in the canonical question order (position, created_at, id) so two saves of one member and an admin's multi-row write cannot deadlock"
    - "The keyed refusal lists errors in the admin's order, unknown ids last and sorted, so the same bad body always yields the same sequence"
    - "A save recounts with the gate's own SQL rule in the same transaction instead of storing completeness"

key-files:
  created:
    - supabase/migrations/20261029234918_profile_form_lock_active.sql
    - supabase/migrations/meta/20261029234918_snapshot.json
    - apps/api/tests/integration/profile-form-member.test.ts
    - apps/api/tests/integration/profile-form-concurrency.test.ts
  modified:
    - packages/core/server/profile-form/member.ts
    - apps/api/src/routes/me.ts
    - apps/api/tests/integration/setup.ts
    - apps/api/tests/integration/isolation.test.ts
    - apps/api/tests/isolation-inventory.ts
    - packages/core/server/logging.ts
    - packages/core/tests/logging-redact.test.ts
    - supabase/migrations/meta/_journal.json

key-decisions:
  - "A member cannot lock question rows under RLS: SELECT FOR SHARE applies the UPDATE policy, which only admin_tenant passes, so from her session it locks and returns zero rows (verified on the local stack). The lock goes through app.profile_form_lock_active(), a definer function that takes the tenant from app.tenant_id()."
  - "answers: {} is a valid no-op that answers the CURRENT missingRequired with 200 (the plan truth), while any non-empty save that leaves a required question unanswered is refused after the recount (D-585); the two truths are reconciled by treating an empty body as submitting nothing."
  - "A recount that finds more missing required questions than the locked set explains (a question inserted after the lock) answers 409 form_changed with the fresh form, not a 400 with no key to point at."
  - "A value whose JSON is over 4096 bytes is refused too_long before the insert, because the table CHECK would otherwise surface as a 500 (control characters escape to six bytes)."
  - "other_required exists in the contract vocabulary but parseAnswer cannot produce it ('Outro' is modelled as otherText), so no API case can assert it; the issue codes asserted are required, not_ticked, too_long, invalid, out_of_range, unknown_option, other_not_allowed and unknown_question."

patterns-established:
  - "Routes under /v1/me that must stay reachable for a gated member are exact paths in PROFILE_FORM_ALLOWED_PATHS; dismiss-notice is deliberately not one of them"
  - "Concurrency proofs hold a real transaction open on a second postgres client and assert the other statement is still pending after 500 ms before releasing"

requirements-completed: [PFORM-06, PFORM-07, PFORM-09, PFORM-13, PFORM-14, PFORM-16, PFORM-24]

coverage:
  - id: D1
    description: "A member reads the whole form pre-filled with mode (none, first, returning, edit), missingRequired and formEtag decided from the data; staff and a module that is off read mode none"
    requirement: PFORM-13
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-member.test.ts#12-06 tracer (first, returning, edit), staff and module-off cases"
        status: pass
    human_judgment: false
  - id: D2
    description: "All thirteen types round-trip in their canonical stored shape and every reachable refusal is keyed by question id, in the admin's order, with no partial write"
    requirement: PFORM-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-member.test.ts#every type round-trips, every refusal is keyed and writes nothing"
        status: pass
    human_judgment: false
  - id: D3
    description: "Choice answers: an unknown option is unknown_option, an Outro text on a question that does not allow it is other_not_allowed, and the Outro text is stored inside the answer value"
    requirement: PFORM-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-member.test.ts#multiple choice with Outro, single choice with Outro, dropdown and multiple_choice refusals"
        status: pass
    human_judgment: false
  - id: D4
    description: "An archive or a make-optional reduces missingRequired on the next read and releases the gate; a new required question asks only the missing answer and returns every kept answer"
    requirement: PFORM-09
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-member.test.ts#after a make-optional or an archive, an existing member who answered some questions is returning"
        status: pass
    human_judgment: false
  - id: D5
    description: "The save and an admin edit never interleave: member holds and admin waits then PF001, admin holds and member waits then 409, two racing saves leave one consistent set, canonical lock order shows no deadlock"
    requirement: PFORM-24
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-concurrency.test.ts#1, 2, 3, 4"
        status: pass
    human_judgment: false
  - id: D6
    description: "The notice dismissal is stored on the server, survives a fresh login, a later question brings it back, required and answered questions never count"
    requirement: PFORM-16
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-member.test.ts#Agora não cases"
        status: pass
    human_judgment: false
  - id: D7
    description: "The three routes carry a cross-tenant case (wrong host 403, foreign question id unknown_question writing nothing, positive control) and are in the isolation inventory; answers are in the logger redaction list and member.ts logs nothing"
    requirement: PFORM-14
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#phase 12 sweep: profile form member; apps/api/tests/unit/isolation-inventory.test.ts"
        status: pass
      - kind: unit
        ref: "packages/core/tests/logging-redact.test.ts#12-06 (T-12-15)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The web half of the member screen (the pt-BR strings for each issue code, the redirect and the notice) is not built in this plan"
    requirement: PFORM-14
    verification: []
    human_judgment: true
    rationale: "Plans 11 and 12 own the screen; the API half is proven here, the rendering is not"

duration: 14min
completed: 2026-10-29
status: complete
---

# Phase 12 Plan 06: The member's profile form API Summary

**A member reads the whole profile form pre-filled, saves the whole screen in one transaction validated against the stored question, and waves the new-questions notice away for good, with the question rows locked FOR SHARE through a definer function because RLS makes a member's own FOR SHARE lock nothing.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-10-29T23:47:00Z
- **Completed:** 2026-10-30T00:01:00Z
- **Tasks:** 3 (1 tracer, 2 auto)
- **Files modified:** 12 (4 created, 8 modified)

## Accomplishments

- Tracer through every layer: a member of a tenant with the module on and one required short-text question reads the form (`mode: first`, `missingRequired: 1`), saves an answer stored trimmed, passes the gate on the next `/v1/me/profile`, and reads the answer back pre-filled (`mode: edit`) with the bootstrap block at 0.
- All thirteen types round-trip in their canonical stored shape, "Outro" text is stored inside the value, and every reachable refusal is keyed by question id, ordered as the admin ordered the form, with a valid sibling answer in the same body proven not to be written.
- The save locks the active questions `FOR SHARE` before it validates, so a type, option or visibility edit and an answer never interleave. Four two-connection tests prove it in both orders, with racing saves and a canonical lock order.
- The dismissal is server state: it survives a fresh login, a later question brings the notice back, a later dismissal moves the instant forward.
- The three routes are in the isolation inventory with a real cross-tenant case; `answers` is in the logger redaction list and `member.ts` is shown to log nothing.

## Task Commits

1. **Task 1: [tracer] read, save, gate release, lock function** - `bb31517f` (feat)
2. **Task 2: all thirteen types and every refusal** - `cfa26fc5` (test)
3. **Task 3: dismissal, isolation entries, redaction, concurrency** - `00e2a85f` (test)

**Plan metadata:** committed after this file (docs: complete plan).

## Files Created/Modified

- `packages/core/server/profile-form/member.ts` - `getMemberForm`, `saveAnswers`, `dismissNotice`, `formEtagOf`, plus a shared `newOptionalCount` for the bootstrap block and the dismissal
- `apps/api/src/routes/me.ts` - the three routes, `Cache-Control: no-store`, ids and a count in the log line
- `supabase/migrations/20261029234918_profile_form_lock_active.sql` (+ snapshot, journal) - `app.profile_form_lock_active()`
- `apps/api/tests/integration/profile-form-member.test.ts` - 48 cases against the live stack
- `apps/api/tests/integration/profile-form-concurrency.test.ts` - the four two-connection cases
- `apps/api/tests/integration/setup.ts` - `seedProfileFormQuestion` takes options (ids generated), limits, allowOther, showOnProfile and an archive instant
- `apps/api/tests/integration/isolation.test.ts`, `apps/api/tests/isolation-inventory.ts` - the `phase 12 sweep: profile form member` case and its three entries
- `packages/core/server/logging.ts`, `packages/core/tests/logging-redact.test.ts` - `answers` redacted and pinned

## Decisions Made

See `key-decisions`. In short: the lock is a definer function, an empty body is a no-op that reports the current count, a form that grew under the save is a 409, and an oversized value is `too_long` rather than a 500.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] A member's `SELECT ... FOR SHARE` locks nothing under RLS**
- **Found during:** Task 1 (checking the plan's `select ... for share` before writing the service)
- **Issue:** `FOR SHARE` applies the UPDATE policy's USING clause to the rows it would lock, and only `admin_tenant` passes it, so from a member's session the statement returned zero rows on the local stack. The member half of PFORM-24 and T-12-16 could not work as written.
- **Fix:** a new expand-only migration adds `app.profile_form_lock_active()` (SECURITY DEFINER, `search_path = ''`, tenant from `app.tenant_id()`, role claim must be one of the three real roles, ordered `position, created_at, id`, `FOR SHARE OF q`), granted to `authenticated`, `api_user`, `service_role`. `saveAnswers` calls it as its first read after the module check. The migration is not in the plan's `files_modified`.
- **Files modified:** `supabase/migrations/20261029234918_profile_form_lock_active.sql`, its snapshot and `_journal.json`, `member.ts`
- **Verification:** the function returns the question for a member claim where the plain statement returned none; concurrency cases 1 and 2
- **Committed in:** `bb31517f`

**2. [Rule 2 - Missing critical] An oversized value would be a 500, not a refusal**
- **Found during:** Task 1 (reading the `profile_form_answers_value_chk` CHECK against `parseAnswer`)
- **Issue:** the CHECK caps `octet_length(value::text)` at 4096; a 1000-character text of control characters escapes to six bytes each and passes `parseAnswer` but fails the CHECK as an unhandled database error.
- **Fix:** the byte length of `JSON.stringify(value)` over `PROFILE_FORM_LIMITS.valueBytes` is keyed `too_long` before any write.
- **Files modified:** `packages/core/server/profile-form/member.ts`
- **Committed in:** `bb31517f`

**3. [Rule 2 - Missing critical] A required question inserted after the lock**
- **Found during:** Task 1 (designing the recount)
- **Issue:** `FOR SHARE` does not block an INSERT, so the recount can find a required question the locked set never contained, leaving a 400 with no key to point at.
- **Fix:** when the missing count exceeds the keyed errors, the save answers 409 `form_changed` with the fresh form.
- **Files modified:** `packages/core/server/profile-form/member.ts`
- **Committed in:** `bb31517f`

**4. [Plan wording] The redaction list lives in `logging.ts`, not in the test**
- **Found during:** Task 3
- **Fix:** `answers` was added to `CREDENTIAL_KEYS` in `packages/core/server/logging.ts` (not in the plan's file list) and pinned by two new cases in `logging-redact.test.ts`.
- **Committed in:** `00e2a85f`

### Judgement calls

- `dismissNotice` and its route were committed with Task 1, because they share `member.ts` and `me.ts` with the read and the save; Task 3 added their tests.
- `answers: {}` returns the current `missingRequired` with 200 (the plan's empty-body truth) even when it is above zero; every non-empty save that leaves a required question unanswered is refused. The plan text states both rules without saying which wins for an empty body.
- `other_required` cannot be asserted: it exists only in the contract vocabulary and `parseAnswer` never returns it. Eight other codes are asserted.
- Concurrency case 4 simulates the admin side (lock every active row in canonical order, then write the second and the first question) because the admin write paths of plans 08 and 09 do not exist yet. Their services must lock in that same order, and plan 08 or 09 should re-run this case against the real route.

---

**Total deviations:** 3 auto-fixed (1 Rule 3, 2 Rule 2), 1 plan-wording correction.
**Impact on plan:** all fixes are needed for correctness; the one structural addition is a single expand-only function.

## Issues Encountered

- `supabase test db` failed one assertion in `090-feed.sql` (test 39) on its first run after the new migration and passed on an immediate rerun with no change; not touched by this plan.
- `bash scripts/db-two-databases.sh --reset` was denied by the environment's permission check (it drops and recreates the local `rede_tenant_b`), so the two-database lane was not re-run. The migration was applied with `supabase migration up`, is a single `create function` plus grants, and the whole pgTAP suite and the workspace gate pass.
- Free disk stayed above 4.7 GB throughout; no build or Playwright was run.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: definer-function | supabase/migrations/20261029234918_profile_form_lock_active.sql | New SECURITY DEFINER function executable by `authenticated`: it takes the tenant only from the session claims and returns the caller's own tenant's active questions, which the member read policy already allows; it takes no argument, so it cannot name another tenant. T-12-14 and T-12-16 mitigated; flagged only because the plan's threat register did not list a new definer surface. |

T-12-14 (question ids resolve only in the caller's lane, `parseAnswer` built from the stored row, cross-tenant id case), T-12-15 (ids and counts only, `answers` redacted, source check) and T-12-16 (`FOR SHARE` before validating, stale-etag 409, PF00x backstop, two-connection tests in both orders) each have an automated test.

## User Setup Required

None - no external service configuration required. Nothing was pushed and no hosted project was touched. Release note for plan 18: the API revision that serves these routes calls `app.profile_form_lock_active()`, so the tenant migrations (this one included) must be applied before that revision serves.

## Next Phase Readiness

- Plan 11 (web gate and bootstrap consumer) and plan 12 (the member screen) can call the three routes; the 400 and 409 shapes are `details.profileForm` plus `details.errors` keyed by question id, and `details.form` on `form_changed`.
- Plans 08 and 09 (admin writes) must take multi-row locks in `position, created_at, id` order and should re-run concurrency case 4 against the real route.
- Plan 12-01 (sketch 016, Igor's design-gate review) still has no SUMMARY and was not touched; the plan pointer was not advanced.

---
*Phase: 12-formulario-de-perfil-do-tenant*
*Completed: 2026-10-29*

## Self-Check: PASSED

- Created files exist: the migration, its snapshot, `profile-form-member.test.ts`, `profile-form-concurrency.test.ts`.
- Commits `bb31517f`, `cfa26fc5` and `00e2a85f` exist; `git rev-list --count 0597a8a8..HEAD` is 3 before this commit.
- Acceptance re-run: `for share` appears in `member.ts` and the lock function; `parseAnswer` is imported from `@rede-social/contracts/profile-form`; `profile-form` appears in `me.ts` (3 routes); `isolation-inventory.ts` has 3 `profile-form` entries and `isolation.test.ts` has the `phase 12 sweep: profile form member` title.
- Plan verification: pgTAP 53 files, 3125 tests PASS (220 included); `profile-form-member.test.ts` 48 passed; `profile-form-concurrency.test.ts` 4 passed; `profile-form-gate.test.ts` 13 passed; `isolation.test.ts -t "phase 12 sweep"` 1 passed; `isolation-inventory.test.ts` 9 passed; `logging-redact.test.ts` 10 passed; `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4` 41 of 41 tasks successful; no web file changed.
