---
phase: quick-261116-hj0
plan: 01
subsystem: tests
tags: [tests-only, ci, phase-10-2, integration, unit, quick]
status: complete
commits: 2
plan_head_before: 24fffe31ba250649c18ebead06ae58d051eb21bd
key-files:
  modified:
    - apps/api/tests/integration/payments-event-mapping.test.ts
    - packages/modules/events/tests/events-payload.test.ts
metrics:
  completed: 2026-11-16
---

# Quick 261116-hj0: fix the two Phase 10.2 tests that failed in CI run 43866055430

Tests only: the event-mapping integration test now enables the payments module for the demo tenant (and restores it) so it reaches the ownership check on a fresh database, and unit test 9v carries a 30_000 per-test timeout.

## Commits (nothing pushed)

| Task | Commit | Message |
|------|--------|---------|
| 1 | ad64d8c1 | fix(quick-261116-hj0): enable payments for the demo tenant in the event-mapping integration test |
| 2 | 2bf58b9c | fix(quick-261116-hj0): give the events-payload 9v edit-read test a 30s timeout |

Both authored by igor.vboas, no trailers. `git diff --name-only HEAD~2 HEAD` lists exactly the two test files. Branch is `master` ahead of origin by 2.

## Task 1: payments-event-mapping.test.ts

Change: the lab block of `beforeAll` became a local helper `enablePayments(tenantId)` returning a restore closure (same statements as before, parameterised by tenant id). `beforeAll` calls it for lab (and assigns `restorePayments` straight away), then looks up `rede-demo` by slug (same `'rede-demo is not seeded'` error style), calls it for demo and reassigns `restorePayments` to restore demo then lab. A comment cites CI run 43866055430. `afterAll`/`afterEach`, every test body and the NOT_FOUND/404 assertions are untouched (NOT_FOUND still appears twice in the file, as before).

Local payments rows (`public.tenant_modules`, module_key payments):

| | demo (rede-demo) | lab (rede-lab) |
|---|---|---|
| BEFORE | enabled true, settings {} (updated_at 2026-11-14 12:44:29.650086+00) | no row |
| AFTER | enabled true, settings {} (updated_at re-set to the original value) | no row |

Runs (`pnpm --filter ./apps/api exec vitest run tests/integration/payments-event-mapping.test.ts`):
- As found (demo row present): Test Files 1 passed, Tests 16 passed (16), Duration 9.84s.
- Fresh-database simulation: deleted only the demo row (DELETE 1, count of payments rows 0), ran the file: Test Files 1 passed, Tests 16 passed (16), Duration 8.64s; afterwards the table held 0 payments rows (the test restored "no row" for demo). Then re-inserted the captured demo row with the exact values (enabled true, settings {}, original updated_at) and confirmed it.
- Note: my first simulation attempt did not delete the row because of a shell quoting mistake (the delete command never ran, `command not found`); that run was therefore an as-found run (16/16) and is not counted as the simulation. The simulation above was re-done correctly and verified by a row count of 0 before the run.

`pnpm biome check` on the file: exit 0. No `db:reset` was run; `.env.local` was not opened.

## Task 2: events-payload.test.ts

Change: closing of test 9v became `}, 30_000);` plus a one-line comment above the `it(`. No assertion or body line changed (diff is 2 lines: 1 comment added, 1 closing changed).

- `pnpm --filter @rede-social/module-events exec vitest run tests/events-payload.test.ts`: Test Files 1 passed, Tests 56 passed (56), Duration 667ms.
- `--reporter=verbose`: 9v listed as passed (285ms).
- `pnpm biome check` on the file: exit 0.

## Deviations from Plan

None. The only incident was the failed first simulation attempt described above (a command typo, corrected and re-run; no data was altered by it).

## Known Stubs

None.

## Self-Check: PASSED

- Both test files modified and committed (ad64d8c1, 2bf58b9c exist in `git log`).
- Both Vitest runs green with the real counts above; Biome exit 0 on both; demo/lab payments rows match the BEFORE state.
