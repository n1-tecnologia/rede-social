---
phase: quick-261023-sfy
plan: 01
subsystem: testing
tags: [ci, unit-tests, hermetic, vitest, lane-rule, quick]
requires: []
provides:
  - boss-scope kernel-import test with an explicit 30_000 ms timeout
  - project-database-state test that proves isTenantMoving without a database
affects: [packages/core unit lane]
key-files:
  modified:
    - packages/core/tests/boss-scope.test.ts
    - packages/core/tests/project-database-state.test.ts
decisions:
  - "Mock only openMoveOf (importOriginal keeps every other export real); the default resolves null so isTenantMoving reads it as free"
requirements: [DBT-48]
status: complete
commits: 1
plan_head_before: 073a9af695785b46b4792e2fa16ccfea2688cb48
actuals:
  tokens: 3000
  tasks: 2
  commits: 1
---

# Quick 261023-sfy: Make the two CI-failing core unit tests pass without a database or a warm runner

Test-only fix for the two `@rede-social/core#test` failures of GitHub Actions run 40039284864: an explicit 30_000 ms timeout on the kernel-import test, and a hermetic `isTenantMoving` test driven by a mocked `openMoveOf` in both directions.

## What changed

1. `packages/core/tests/boss-scope.test.ts`: the test "the kernel registers its platform queues at import" now ends with `}, 30_000);` plus a one-line comment. No assertion or import line changed.
2. `packages/core/tests/project-database-state.test.ts`:
   - `vi.hoisted` holder for `openMoveOf` and `vi.mock('../server/projects/move/state')` with `importOriginal`, replacing only `openMoveOf`.
   - `openMove()` fixture with all seventeen fields of `MoveRow`, state `copied`.
   - The old describe was replaced by "the moving flag follows the move table (09.2-23, D-535)" with a `beforeEach` that resolves `null`, a "no open move" test (false) and an "open move row" test (true), each also asserting the call was made with the tenant id. The "overview schema has a moving flag" test is unchanged. File: 16 tests to 17.

## Verification (observed)

- Red evidence, before the edit, with the throwaway preload (`block-db.cjs`, in the session scratchpad, never committed) refusing connects to port 54322: `tests/project-database-state.test.ts (16 tests | 1 failed)`, failure `Error: connect ECONNREFUSED 127.0.0.1:54322 (block-db.cjs)` on "no tenant is moving until plan 23 reads the move table"; 15 passed.
- After the edit, stack up: `vitest run tests/boss-scope.test.ts tests/project-database-state.test.ts`: 2 files passed, 31 tests passed. `project-database-state` alone: 17 passed.
- After the edit, database refused (preload): 2 files passed, 31 tests passed.
- `pnpm --filter @rede-social/core run typecheck`: clean.
- `pnpm exec biome check` on the two files: clean, no fixes applied.
- `pnpm guard:lanes`: OK.
- Title gate grep for the placeholder word and "until plan 23": no match (exit 1).
- Commit `7a12ce39` touches exactly the two test files; message has no Co-Authored-By or tool attribution; not pushed.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

- packages/core/tests/boss-scope.test.ts: FOUND
- packages/core/tests/project-database-state.test.ts: FOUND
- commit 7a12ce39: FOUND
