---
phase: 12-formulario-de-perfil-do-tenant
plan: 07
subsystem: api
tags: [profile-form, answers-read, privacy, rls, D-593, T-12-17, T-12-18, tracer]

requires:
  - phase: 12-formulario-de-perfil-do-tenant
    provides: "plan 03 publicAnswersSchema / staffAnswersSchema, plan 04 tables and the answers RLS policies, plan 05 liveModuleOn and the test helpers, plan 06 the member save that fills the answers"
provides:
  - "GET /v1/members/{membershipId}/profile-answers: a member viewer receives { kind: 'member', answers } with only the answered, public, non-archived rows; admin_tenant and support_tenant receive { kind: 'staff', answers } with every active question and every answered archived one"
  - "publicAnswersOf and staffAnswersOf in packages/core/server/profile-form/answers.ts, each returning null for every 404 condition"
  - "One identical bare 404 NOT_FOUND for unknown, other-tenant, blocked, invited, removed, staff target, own membership and module off"
  - "Isolation inventory entry and the 'phase 12 sweep: profile form answers' case"
affects: [12-14, 12-15, 12-16, profile-form]

actuals:
  tokens: 21300
  tasks: 2
  commits: 2
plan_head_before: 0258cf1ed2b34c3b11dd992833629ada588ff950

tech-stack:
  added: []
  patterns:
    - "A route that must be indistinguishable from a miss is NOT behind requireModule: the module off is checked inside the service and returns the same null as every other miss"
    - "The viewer's role picks the payload and a mix-up never falls through to the other: staff take the staff path only while the composed permission profile_form.read is held, a member the public path, any other role the 404"
    - "Layer 2 beside RLS: tenant_id, the target membership and 'show_on_profile and archived_at is null' are spelled out in the member query even though the public policy states the same"

key-files:
  created:
    - packages/core/server/profile-form/answers.ts
    - apps/api/tests/integration/profile-form-answers.test.ts
  modified:
    - apps/api/src/routes/members.ts
    - apps/api/tests/integration/isolation.test.ts
    - apps/api/tests/isolation-inventory.ts

key-decisions:
  - "The route has no requireModule: the module off is a 404 like every other miss, so 'module off' cannot be told apart from 'no such member' (answers are kept, not shown)."
  - "The staff read is gated by the composed permission profile_form.read (a literal string, the kernel never imports a module package); the module off removes the permission, and staffAnswersOf also re-reads the module row live."
  - "A staff target and the caller's own membership are 404 on the member path; the staff path needs a member-role target, so a staff viewer asking about an admin or support target gets the same 404, not an empty payload."
  - "The integration comparison of the miss bodies strips the per-request requestId and compares the rest byte for byte; the requestId is the only field that may differ."

patterns-established:
  - "Active questions first in the admin's order (position, created_at, id), then archived by archived_at descending then id, in one ORDER BY with CASE guards, so two requests return the same sequence"

requirements-completed: [PFORM-08, PFORM-18, PFORM-19]

coverage:
  - id: D1
    description: "A member viewer reads another member's answers to public, non-archived, answered questions in the admin's order inside a strict { kind: 'member', answers } payload with no e-mail, no flags and no private or archived row"
    requirement: PFORM-18
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-answers.test.ts#12-07 tracer (returns the public, answered, active rows; empty public list; never gives a member viewer the staff shape)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Unknown id, blocked, invited, soft-deleted, staff target, own membership and the module off all answer one byte-identical bare 404 NOT_FOUND without details"
    requirement: PFORM-18
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-answers.test.ts#answers ONE byte-identical bare 404 for every miss"
        status: pass
    human_judgment: false
  - id: D3
    description: "Staff read every answer of a member target, archived and private included, with showOnProfile, required, position, archivedAt and answered; active-first ordering; a member with no answers lists every active question as answered false; a staff target is a 404"
    requirement: PFORM-19
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-answers.test.ts#12-07 staff: PFORM-19 (five cases)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The route is in the isolation inventory with a real cross-tenant case: wrong host 403, foreign id the same 404 for member and staff, each beside a same-tenant positive control; tenant B staff cannot read tenant A's member"
    requirement: PFORM-08
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#phase 12 sweep: profile form answers"
        status: pass
      - kind: unit
        ref: "apps/api/tests/unit/isolation-inventory.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "No private answer is reachable by another member of the same tenant by any path (a guessed membership id plus question id, a query string); only the owner, admin and support can read it"
    requirement: PFORM-08
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-answers.test.ts#never reaches a private answer with a guessed membership id and question id"
        status: pass
    human_judgment: false

duration: 13min
completed: 2026-10-30
status: complete
---

# Phase 12 Plan 07: The answers read Summary

**GET /v1/members/{membershipId}/profile-answers: another member sees only the admin-flagged public answers in a strict payload, the staff see every answer with the flags, and every miss is one byte-identical bare 404, with an isolation case beside it.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-10-29T23:55:00Z
- **Completed:** 2026-10-30T00:08:00Z
- **Tasks:** 2 (1 tracer, 1 auto)
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments

- Tracer: a member viewer opens a fellow member's answers and gets `{ kind: 'member', answers }` with exactly the documented keys, public and answered and active rows only, in the admin's order; the private, archived and unanswered rows and the e-mail never appear in the body.
- One bare 404 `NOT_FOUND` with no details for unknown id, blocked, invited, soft-deleted, staff target, own membership and the module off; the integration test compares the seven bodies byte for byte (the `requestId` is the only field stripped).
- The staff variant: `admin_tenant` and `support_tenant` read every active question (`answered: false` when empty) and every answered archived one, with `showOnProfile`, `required`, `position`, `archivedAt`; active questions in the admin's order, then archived newest first.
- The route is in the isolation inventory with `phase 12 sweep: profile form answers`: the wrong host is `TENANT_HOST_MISMATCH`, a foreign id is the same 404 for member and staff, each beside its same-tenant positive control.

## Task Commits

1. **Task 1: [tracer] the public read, the staff read, the route, 11 integration cases** - `589e9722` (feat)
2. **Task 2: isolation inventory entry and the cross-tenant case** - `9ec7baa0` (test)

**Plan metadata:** committed after this file (docs: complete plan).

## Files Created/Modified

- `packages/core/server/profile-form/answers.ts` - `publicAnswersOf` and `staffAnswersOf`, null on every miss, explicit tenant, target and `show_on_profile and archived_at is null` predicates
- `apps/api/src/routes/members.ts` - `GET /{membershipId}/profile-answers`, the role picks the payload, `Cache-Control: no-store`, a log line with ids only
- `apps/api/tests/integration/profile-form-answers.test.ts` - 11 cases against the live stack
- `apps/api/tests/integration/isolation.test.ts`, `apps/api/tests/isolation-inventory.ts` - the `phase 12 sweep: profile form answers` case and its entry

## Decisions Made

See `key-decisions`. In short: no `requireModule` (module off is a 404), the staff path needs `profile_form.read`, and a staff target is a 404 for everybody.

## Deviations from Plan

### Judgement calls

- The staff variant (`staffAnswersOf`, the staff branch of the handler and the staff integration cases) was written together with the tracer because both functions share one file and one test file; Task 1's commit therefore contains the whole service, route and suite, and Task 2's commit is the isolation entry and case only. The plan's task split is by behaviour, the commit split followed the files.
- The plan says the six misses return "byte-identical bodies". Each response carries a per-request `requestId`, so the comparison strips that one field and compares the rest.

**Total deviations:** 0 auto-fixed, 2 judgement calls.
**Impact on plan:** none; every truth in the plan is asserted.

## Issues Encountered

- `pnpm supabase test db` failed one assertion (`180-store.sql` test 121) on its first run and passed in full (53 files, 3125 tests, `220-profile-form.sql` included) on an immediate rerun with no change; this plan touches no database object. The same flake pattern was recorded in 12-06 for `090-feed.sql`.
- Free disk stayed above 4.2 GB; no build or Playwright was run.

## Known Stubs

None.

## Threat Flags

None. No new network surface beyond the planned route, no new table or function; T-12-17 and T-12-18 are mitigated and each has an automated test.

## User Setup Required

None - no external service configuration required. Nothing was pushed and no hosted project was touched.

## Next Phase Readiness

- Plans 14 to 16 (the profile blocks and the staff view) can call the route: the payload is a union discriminated by `kind`, and a 404 means "show nothing".
- Plan 12-01 (sketch 016, Igor's design-gate review) still has no SUMMARY and was not touched; the plan pointer was not advanced.

---
*Phase: 12-formulario-de-perfil-do-tenant*
*Completed: 2026-10-30*

## Self-Check: PASSED

- Created files exist: `packages/core/server/profile-form/answers.ts`, `apps/api/tests/integration/profile-form-answers.test.ts`.
- Commits `589e9722` and `9ec7baa0` exist; `git rev-list --count 0258cf1e..HEAD` is 2 before this commit.
- Acceptance re-run: `grep -c "show_on_profile" answers.ts` is 7; `grep -c "profile-answers" isolation-inventory.ts` is 1; `grep -c "phase 12 sweep: profile form answers" isolation.test.ts` is 1; the integration file asserts the staff ordering and the `answered: false` rows.
- Plan verification: `profile-form-answers.test.ts` 11 passed; `isolation-inventory.test.ts` 9 passed; `isolation.test.ts -t "phase 12 sweep"` 2 passed (this plan's block and 12-06's); pgTAP 53 files, 3125 tests PASS (220 included); `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4` 41 of 41 tasks successful.
