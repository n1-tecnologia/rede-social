---
phase: quick-261117-jke
plan: 01
subsystem: web / support inbox
tags: [bugfix, support-inbox, phase-12.4, WR-06, quick]
status: complete
completed: 2026-11-17
plan_head_before: 4849a4008bf00f6610e59f1ac86690718d4876d0
commits: 3
key-files:
  modified:
    - apps/web/app/(app)/suporte/SupportInbox.tsx
    - apps/web/app/(app)/suporte/SupportInbox.test.tsx
requirements-completed: []
---

# Quick 261117-jke: WR-06, a page-1 refetch during a load-more no longer hides a listed row

A `loadingMoreRef` boolean (set before the load-more server action is awaited, cleared in a `finally`) makes `refreshPage1` pass `holdsOnlyPage1: pagesRef.current <= 1 && !loadingMoreRef.current`, so a refetch landing mid load-more takes the not-whole path of `reconcileInboxPage`.

## Commits

BASE: `4849a4008bf00f6610e59f1ac86690718d4876d0`

| Task | SHA | Message | Files |
| ---- | --- | ------- | ----- |
| 1 | 74ca283e | test(quick-261117-jke): WR-06 repro ... (red) | SupportInbox.test.tsx |
| 2 | 7c38e3b3 | fix(quick-261117-jke): a page-1 refetch during a load-more keeps every loaded row (WR-06) | SupportInbox.tsx |
| 3 | 2cbf0c75 | test(quick-261117-jke): WR-06 pins ... | SupportInbox.test.tsx |

No Claude trailer in any commit; each `git show --stat HEAD` listed one file.

## RED (Task 1, component unchanged, run twice, same result both times)

```
× a refetch during a load-more keeps the row between the fresh tail and the old cursor (WR-06)
AssertionError: expected [ 'NEW', 'R1', 'R2', 'R4', 'R5' ] to deeply equal [ 'NEW', 'R1', 'R2', 'R3', 'R4', 'R5' ]
-   "R3",
 Tests  1 failed | 35 skipped (36)
```

Failure is on the row-list assertion, R3 missing, as the verifier reproduced.

## GREEN

- After Task 2: `SupportInbox.test.tsx` 36 passed (36), run twice.
- After Task 3: 39 passed (39), run twice (3 new: second-refetch pin, two it.each cases). The pins are non-regression, green on arrival, never red before the fix.

## Mutation check (working tree only, restored with Edit)

Commented out `loadingMoreRef.current = false;` in the `finally`; `-t "WR-06"`: 2 failed, 2 passed. Both test-3 cases failed with `expected [ 'R1', 'R2', 'R3' ] to deeply equal [ 'R1', 'R2' ]`; the repro and test 2 stayed green. Line restored; `git diff --stat` on SupportInbox.tsx printed nothing afterward.

## Gates

| Command | Result |
| ------- | ------ |
| vitest SupportInbox.test.tsx (x2) | 39/39 passed both runs |
| `pnpm exec biome check` on the two files | exit 0, no fixes (formatting applied with --write on the test file beforehand) |
| `pnpm --filter @rede-social/web typecheck` | exit 0 (`next typegen && tsc --noEmit`) |
| `bash scripts/check-ui-literals.sh` | OK (both lines) |
| `TURBO_CACHE=local:r pnpm boundaries` | exit 0, "Checked 2583 files in 20 packages, no issues found" |
| `git diff --quiet BASE HEAD -- apps/web/lib/chat-view.ts` | exit 0 |

## Stuck-mark verification

a. Every path out of the `try` body (changed-view return, refused-page return, normal end) and the catch runs the `finally`.
b. The awaited server action always settles (resolve or reject), so the `finally` always runs.
c. A view switch needs no reset: the old call's `finally` clears the mark when it settles; until then a refetch on the new view only takes the conservative not-whole path (keeps deeper rows, leaves the cursor, never drops a listed row), and the next refetch after settling is exact again.
d. The server re-seed block and the view effect deliberately do not touch the mark (resetting there could clear the mark of a newer call while the old one still pends).

## Deviations from Plan

None. The plan was executed as written. Biome formatting was applied with `--write` to the test file only.

## Observations (not fixes)

1. Known whole-answer edge: `reconcileInboxPage` still returns `whole: true` when the fresh answer has `hasMore` false or is empty, even with `holdsOnlyPage1` false. Landing during a load-more, it makes the list the fresh page and the cursor null, and the late page is then appended, possibly resurrecting rows that left the view until the next refetch. It does not drop a listed row; out of scope, no guard added (the pure function must not change).
2. The cursor assertion in the repro and in test 2 also holds before the fix (the late page always sets its own cursor); the discriminating assertion is the row list.
3. Test 2 cannot prove the mark is cleared, because `pagesRef` is 2 after a successful append; the refused and rejected cases of test 3 do (verified by the mutation check).
4. Possible, UNVERIFIED, pre-existing, a different trigger than WR-06: a server re-seed (`router.refresh()` changing `initialItems`) while a load-more is pending on the default view looks like it would append the late page, read from the pre-seed cursor, to the re-seeded list and replace the cursor, because the view guards in `loadMore` pass on the default view. Not touched; offer to the developer as a separate item.
5. The orchestrator should report CASE-16 as ready to flip to complete; no REQUIREMENTS.md, ROADMAP.md, VERIFICATION.md or STATE.md edit was made.

## Known Stubs

None. No threat flags (no new surface).

## Self-Check: PASSED

Three commits exist (74ca283e, 7c38e3b3, 2cbf0c75); `git status --short -- "apps/web/app/(app)/suporte/"` is empty.
