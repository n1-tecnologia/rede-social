---
phase: quick-261106-ei5
plan: 01
subsystem: profile-form
tags: [profile-form, conditions, layout, ordering]
status: complete
requirements: [PFORM-28, PFORM-29]
plan_head_before: d1b1e272e0814c0d4f5bcdfeb62a61d40ab3b0ae
commits: 4
actuals:
  tasks: 2
  commits: 4
key-files:
  modified:
    - packages/core/server/profile-form/layout.ts
    - packages/core/server/profile-form/admin.ts
    - packages/core/tests/profile-form-layout.test.ts
    - apps/api/tests/integration/profile-form-conditions.test.ts
completed: 2026-11-06
---

# Quick 261106-ei5: a conditional question lands right after its opener

A new conditional profile-form question (create) and a reactivated one are now stored right after their opener, or after the opener's last active dependent, when the opener is in the same step. Before, both went to the end of the step. The member form and the builder render stored order, so no other change was needed.

## What changed

- `layout.ts`: new pure `addQuestionAfterOpener(layout, stepId, questionId, openerId, facts)`. It delegates validation to `addQuestion` first (same `unknown_step` / `order_mismatch` refusals). With no opener, or an opener not in the named step, it appends to the end of the step as before. With the opener in the step it inserts after the last active dependent of that opener found after it, or right after the opener when there is none. It never mutates its input.
- `admin.ts` `createQuestion`: one local function `layoutWith(id)` builds both the probe layout given to `checkCondition` and the real layout that is written, so the layout that is checked is the layout that is stored. `adminLock`, `requireModuleOn`, the limit check, `readLayout` without row locks, `checkCondition` before the insert, `insertQuestion`, and the single `writeLayout` guarded by `endsWith` are unchanged.
- `admin.ts` `reactivateQuestion`: `next` comes from `addQuestionAfterOpener(read.layout, row.step_id, row.id, row.condition_question_id, read.facts)`. `checkReactivation`, `assertLayoutOrder`, the UPDATE and the `endsWith` shortcut are unchanged. The now-unused `addQuestion` import was removed from `admin.ts`.
- Comments and doc comments updated in both functions. `updateQuestion`, replace, move, reorder, steps, `insertQuestion`, `layout-store.ts` and `condition-rules.ts` are untouched. Nothing under the web app, contracts, catalogs, SQL or migrations changed.

## Commits (no trailer, path-scoped, nothing pushed)

| SHA | Message |
|---|---|
| 42882293 | test(261106-ei5): place a conditional question right after its opener (red) |
| 5574f4a2 | feat(261106-ei5): create a conditional question right after its opener |
| 5c46f05a | test(261106-ei5): reactivated conditional question lands right after its opener (red) |
| 69620c4e | feat(261106-ei5): reactivate a conditional question right after its opener |

Base `d1b1e272`. `git diff --name-only d1b1e272 HEAD` lists exactly the four files above.

## Test evidence (real output)

The red-evidence TAP gate (`gsd_run check tdd-red-evidence`) reads TAP, which Vitest does not emit. It was not applicable to a quick task and was not run. Counts below are the real Vitest summaries.

### Task 1 RED (the helper body was a temporary pass-through to `addQuestion`)

- Unit, `pnpm --filter @rede-social/core exec vitest run tests/profile-form-layout.test.ts`: `4 failed | 46 passed (50)`.
  - Genuine REDs (4): "puts the new id right after the opener...", "puts the new id after the LAST dependent...", "ignores a dependent of the opener in another step and one sitting before the opener", "does not mutate frozen inputs and returns a fresh layout" (its last assertion pins the new placement).
  - Passed at RED by design (characterization of unchanged behavior, 4 new cases): opener in another step goes to the end, opener not in the layout goes to the end, null opener equals `addQuestion`, `unknown_step` / `order_mismatch`.
- Integration, `pnpm --filter @rede-social/api exec vitest run tests/integration/profile-form-conditions.test.ts -t "261106-ei5 create"`: `3 failed | 1 passed | 39 skipped (43)`.
  - Genuine REDs: Test A, Test B, and Test C. Test C was planned as a characterization, but it also asserts the same-step half (a dependent created in the opener's step follows the opener), and that half failed at RED. Its other-step half (the dependent stays at the end of its own step) holds before and after.
  - Passed at RED by design: Test D (a dependent of the very last question ends the form and touches no other row).

### Task 1 GREEN

- Unit file: `50 passed (50)`.
- `-t "261106-ei5 create"`: `4 passed | 39 skipped (43)`.
- `-t "12.1-10 tracer"`: `2 passed | 41 skipped`. `-t "D-620..D-623"`: `7 passed | 36 skipped`.

### Task 2 RED (before the `reactivateQuestion` change)

- `-t "261106-ei5 reactivate"`: `1 failed | 2 passed | 43 skipped (46)`. Genuine RED: Test E. Passed at RED by design: Test F (opener in another step, back to the end of its own step) and Test G (unconditional, back to the end of the step).

### Task 2 GREEN and final verification

| Command | Result |
|---|---|
| `pnpm --filter @rede-social/core exec vitest run tests/profile-form-layout.test.ts tests/profile-form-condition-rules.test.ts tests/profile-form-lock-rules.test.ts` | 3 files, 146 passed (146) |
| `pnpm --filter @rede-social/api exec vitest run tests/integration/profile-form-conditions.test.ts -t "261106-ei5"` | 7 passed, 39 skipped (46) |
| `pnpm --filter @rede-social/api exec vitest run tests/integration/profile-form-conditions.test.ts` (whole file, 12.74 s) | 46 passed (46), including T-12.1-01, D-623, D-632 and the PF007 race case |
| `pnpm --filter @rede-social/core exec tsc --noEmit` / `pnpm --filter @rede-social/api exec tsc --noEmit` | both exit 0 |
| `pnpm exec biome check` on the four touched files | clean, no fixes applied |

Not run, per constraints: `pnpm db:reset`, `pnpm db:seed`, the full integration suite, a Next build, Playwright.

## Deviations from Plan

None in code or scope. Two notes on the process:

- The plan classed Test C as a pure characterization; its same-step half is a genuine RED (see above), recorded honestly.
- The first attempt at the full conditions file used `timeout`, which does not exist on this macOS shell, so no output was produced. It was rerun without it and passed.

## Side effect to know (accepted, threat T-12.1-13)

A conditional create or reactivation that lands in the middle of the form shifts the later rows. It therefore takes the row locks of the shifted rows in the canonical `position, created_at, id` order (the same order a member's save uses, so no cycle) and can wait for a member's save in flight. An unconditional create, an unconditional reactivation and an append to the very end of the form (including a conditional one whose computed place is the very end, Test D) still wait for nobody: the `endsWith` shortcut writes no other row.

## Other facts for the orchestrator

- The web builder's opener picker needed no change: every opener of the same or an earlier step stays eligible.
- An opener from another tenant or a missing one is not found by the helper (it only searches the tenant-scoped layout), falls back to the end of the step, and `checkCondition` / `checkReactivation` refuse it exactly as before (T-12.1-01 case green in the full-file run).
- No existing question is reordered by this change; D-623 holds by construction (new id strictly after its opener) and is still checked over the stored layout.
- Nothing is pushed. The Phase 12.1 production deploy (GitHub run 42220938769) was not touched. STATE.md, ROADMAP.md and REQUIREMENTS.md were not touched. This SUMMARY is not committed (the orchestrator handles the docs commit).

## Known Stubs

None.

## Self-Check: PASSED

- Files exist: layout.ts, admin.ts, profile-form-layout.test.ts, profile-form-conditions.test.ts (all modified and committed).
- Commits exist: 42882293, 5574f4a2, 5c46f05a, 69620c4e (`git rev-list --count d1b1e272..HEAD` = 4, none with a Co-Authored-By line).
