---
phase: quick-260927-ebk
plan: 01
subsystem: ui
tags: [nextjs, react, pointer-events, tailwind, vitest, testing-library, happy-dom, reels, a11y]

requires:
  - phase: 05.3-reels
    provides: ReelsHost CR-01 interaction map, ReelsPager capture-phase release (WR-01), ReelCaption, ReelsLanes, 05.3-VALIDATION/UI-REVIEW
provides:
  - "WR-04: ReelsHost keeps the last server-confirmed like pair per post (seq-tagged `confirmed` ref) and publishes it when the post's latest request settles, whatever the outcome"
  - "WR-05: ReelsPager ties a gesture to the primary pointer that started it (`origin.pointerId`, `isPrimary`)"
  - "UI-REVIEW fixes 1-3: 44 px caption toggle hit areas, lane underline on the label span, empty-state CTA through LinkButton"
  - "05.3-VALIDATION.md Nyquist-compliant; 05.3-UI-REVIEW.md Applied section"
affects: [05.3-reels, phase-01.1-phone-uat]

actuals:
  tokens: 9315
  tasks: 3
  commits: 5
plan_head_before: e9afe9e

tech-stack:
  added: []
  patterns:
    - "Visit-scoped confirmed pair per post, tagged with the request seq, published only when the latest request settles"
    - "Pointer gestures owned by the primary pointer that started them (pointerId compared on move/up/cancel/leave)"
    - "44 px hit areas without layout change: pseudo-element (after:-inset-y-3) on an absolute button; upward pad + equal negative margin on an inline button"

key-files:
  created: []
  modified:
    - apps/web/components/reels/ReelsHost.tsx
    - apps/web/components/reels/ReelsHost.test.tsx
    - packages/modules/reels/ui/ReelsPager.tsx
    - packages/modules/reels/tests/reels-pager.test.tsx
    - packages/modules/reels/ui/ReelCaption.tsx
    - packages/modules/reels/tests/reel-caption.test.tsx
    - packages/modules/reels/ui/ReelsLanes.tsx
    - packages/modules/reels/tests/reels-lanes.test.tsx
    - .planning/phases/05.3-reels/05.3-VALIDATION.md
    - .planning/phases/05.3-reels/05.3-UI-REVIEW.md

key-decisions:
  - "WR-04: `confirmed` holds `{ seq, like }`; an ok answer replaces it only if no pair is held or the held seq is lower, so an out-of-order older answer can never replace a newer confirmed pair (hardening beyond the review's snippet)"
  - "WR-05: a PRIMARY pointerdown always (re)starts the gesture instead of being refused while an origin is held (differs from the review's `|| origin.current` guard): a stale origin self-heals instead of locking the pager"
  - "UI fix 1: pseudo-element hit area on '… mais' and an upward 24 px pad on 'menos' instead of the review's `min-h-11 inline-flex` / `py-3 -my-3`, so the label, gradient and the expanded caption's scroll range do not move"

patterns-established:
  - "happy-dom PointerEvent defaults isPrimary to false: pointer-init fixtures that simulate a lone real pointer must carry isPrimary: true"

requirements-completed: [REELS-04, REELS-05, REELS-07, REELS-08]

coverage:
  - id: D1
    description: "WR-04: a like confirmed before a refused or rejected latest unlike survives a remount (confirmed pair published when the latest request settles)"
    requirement: REELS-07
    verification:
      - kind: unit
        ref: "apps/web/components/reels/ReelsHost.test.tsx#CR-01 (h): a like confirmed before a refused unlike is what a remounted page shows (WR-04)"
        status: pass
      - kind: unit
        ref: "apps/web/components/reels/ReelsHost.test.tsx#CR-01 (i): a rejected latest request still leaves the confirmed like for a remounted page (WR-04)"
        status: pass
      - kind: unit
        ref: "apps/web/components/reels/ReelsHost.test.tsx#CR-01 (e)/(f)/(g) regression guards"
        status: pass
    human_judgment: false
  - id: D2
    description: "WR-05: only the primary pointer that started a gesture can end, cancel or steer it"
    requirement: REELS-05
    verification:
      - kind: unit
        ref: "packages/modules/reels/tests/reels-pager.test.tsx#WR-05: a second finger tapping the rail while the first rests on the video moves neither the lane nor the video"
        status: pass
      - kind: unit
        ref: "packages/modules/reels/tests/reels-pager.test.tsx#WR-05: a second pointer's cancel on the rail leaves the first pointer's drag running"
        status: pass
      - kind: unit
        ref: "packages/modules/reels/tests/reels-pager.test.tsx#WR-05: a non-primary pointerdown on the video never takes over the first pointer's gesture"
        status: pass
      - kind: e2e
        ref: "VIDEO_PROVIDER=fake pnpm --filter @tria/web exec playwright test reels.spec.ts (28 passed, 6 skipped)"
        status: pass
    human_judgment: false
  - id: D3
    description: "UI-REVIEW fix 1: '… mais' and 'menos' reach a 44 px hit area with no visual change"
    requirement: REELS-07
    verification:
      - kind: unit
        ref: "packages/modules/reels/tests/reel-caption.test.tsx#\"… mais\" and \"menos\" reach a 44 px hit area without moving their label (UI-REVIEW fix 1)"
        status: pass
    human_judgment: true
    rationale: "The test pins the classes; that the label, gradient and scroll range are visually unchanged on a real phone is a visual judgment (real-device UAT waits for Phase 01.1)"
  - id: D4
    description: "UI-REVIEW fix 2: the active-lane underline is drawn by the inner label span; the tab keeps h-11 and its semantics"
    requirement: REELS-04
    verification:
      - kind: unit
        ref: "packages/modules/reels/tests/reels-lanes.test.tsx#the active tab is white 700 with the underline on its label span; an idle tab is white/70 with a transparent one (UI-REVIEW fix 2)"
        status: pass
      - kind: unit
        ref: "packages/modules/reels/tests/reels-lanes.test.tsx#a 60-character label is the full accessible name and truncates at max-w-40"
        status: pass
    human_judgment: true
    rationale: "Matching the tight underline to reels-design.png is a visual comparison no test asserts"
  - id: D5
    description: "UI-REVIEW fix 3: empty-state 'Criar publicação' CTA is LinkButton (brand, md) to /criar, authors only, white ring with no offset"
    requirement: REELS-08
    verification:
      - kind: unit
        ref: "apps/web/components/reels/ReelsHost.test.tsx#an author gets \"Criar publicação\" to /criar in the empty state"
        status: pass
    human_judgment: false
  - id: D6
    description: "05.3-VALIDATION.md Nyquist-compliant with WR-04/WR-05 rows resolved by test name; 05.3-UI-REVIEW.md Applied section, scores unchanged"
    verification:
      - kind: other
        ref: "Task 3 <verify> grep checks (V2/V3/V4) all passed"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-09-27
status: complete
---

# Quick 260927-ebk: 05.3 follow-ups (WR-04, WR-05, UI-REVIEW top 3) Summary

**A seq-tagged confirmed like pair in ReelsHost that survives a refused or rejected latest toggle, Reels gestures bound to their starting primary pointer, and the three UI-review fixes (44 px caption toggles, lane underline on the label, LinkButton CTA), each proven by a test.**

## Performance

- **Duration:** about 8 min
- **Started:** 2026-09-27T13:35:14Z
- **Completed:** 2026-09-27T13:43:00Z
- **Tasks:** 3
- **Files modified:** 10 (8 code/test, 2 phase docs)

## Accomplishments

- **WR-04 closed.** `trackLike` records every `ok` answer as the post's confirmed pair (`confirmed` ref, tagged with its seq, never replaced by an older seq) and publishes it into `interactions` when the post's latest request settles, whether it was ok, refused or rejected. Latest-wins, the single generic toast and the visit scope are unchanged.
- **WR-05 closed.** `origin` carries `pointerId`. `onPointerDown` ignores non-primary pointers, and `onPointerMove`, `onPointerUp` (capture), `onPointerCancel` (capture) and `onPointerLeave` ignore every pointer except the gesture's own. Another pointer's release now returns without `setDrag(IDLE)`, which also drops the re-render each rail tap caused.
- **UI-REVIEW fixes 1-3 applied.** No new strings, no new packages.
- **05.3-VALIDATION.md is Nyquist-compliant.** It has `nyquist_compliant: true`, the escalated rows are resolved by test name, and a follow-up audit records the real counts. **05.3-UI-REVIEW.md** has an Applied section, and its scores are unchanged.

## Task Commits

1. **Task 1 RED: WR-04 + WR-05 failing tests.** `5024091` (test)
2. **Task 1 GREEN: confirmed like pair + pointer ownership.** `9ea9f52` (fix)
3. **Task 2: caption toggle hit areas + lane underline span.** `dd01381` (fix)
4. **Task 3 code: empty-state CTA through LinkButton.** `e767ced` (fix)
5. **Task 3 docs: VALIDATION resolved + UI-REVIEW Applied.** `71a603e` (docs)

Measured: `git rev-list --count e9afe9e..HEAD` = 5.

## TDD Evidence (Task 1)

**RED** was observed before any fix and committed in `5024091`:

- `pnpm --filter @tria/web exec vitest run components/reels/ReelsHost.test.tsx -t "WR-04"` exited 1: 2 failed, 37 skipped.
  - CR-01 (h) failed at `ReelsHost.test.tsx:1274` (after the ±2 round trip) with `expected 'unliked' to be 'liked'`.
  - CR-01 (i) failed at `:1313` with `expected 'unliked' to be 'liked'`.
  - Every assertion before the round trip passed. The mounted page was already right, and only the remounted page read the stale server view.
- `pnpm --filter @tria/module-reels exec vitest run tests/reels-pager.test.tsx -t "WR-05"` exited 1: 3 failed, 46 skipped.
  - Case 1: `expected [ [ 'lane', -1 ] ] to deeply equal []` after finger 2's release (the verifier's reproduction).
  - Case 2: `expected 'translateY(calc(0% + 0px))' to contain '-35px'`, because the second pointer's cancel reset the drag.
  - Case 3: `expected 'translateY(calc(0% + 70px))' to contain '-35px'`, because the non-primary press replaced the origin.
- The whole module suite with only the `isPrimary: true` fixture edit gave 122 passed and 3 failed (the 3 new cases). The fixture edit alone changed nothing.
- `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` (`target_test_failed`) for all 5 records. The records came from the real Vitest JSON reports through a throwaway scratchpad normalizer, which was not committed.

**GREEN** (`9ea9f52`):

- CR-01 run: 10 passed (CR-01, (a) through (i)).
- `reels-pager.test.tsx`: 49 passed.
- Module suite: 125 passed.
- Web `components/reels`: 68 passed.

**REFACTOR:** none needed.

Commit types follow the plan's quick precedent (`test(...)` then `fix(...)`), not `feat(...)`.

## Final Gate Results (HEAD 71a603e)

| Gate | Result |
|------|--------|
| `pnpm --filter @tria/module-reels test` | 7 files, 126 passed |
| `pnpm --filter @tria/module-reels typecheck` / `lint` | exit 0 / exit 0 (22 files) |
| `pnpm --filter @tria/web exec vitest run components/reels` | 2 files, 68 passed |
| `pnpm --filter @tria/web typecheck` / `lint` | exit 0 / exit 0 (295 files) |
| `bash scripts/check-ui-literals.sh` | OK |
| `VIDEO_PROVIDER=fake pnpm --filter @tria/web exec playwright test reels.spec.ts` | 28 passed, 6 skipped (1.4 min; about 11 GiB free before the run) |
| `git diff --stat e9afe9e..HEAD -- apps packages .planning/phases` | exactly the 10 `files_modified` |
| 05.3-VERIFICATION.md, 05.3-UAT.md, package.json files, pnpm-lock.yaml, supabase/ | unchanged since e9afe9e |

## Files Created/Modified

- `apps/web/components/reels/ReelsHost.tsx`: adds the `confirmed` ref, the rewritten `trackLike` (publish on ok, refusal and rejection; rethrow), and the updated header, `likeSeq` and `trackLike` docblocks. The empty-state CTA is now `LinkButton`, and the `next/link` import is removed.
- `apps/web/components/reels/ReelsHost.test.tsx`: `deferred()` also returns `reject`. Adds CR-01 (h) and (i). The CTA test now asserts the shared Button geometry and the white ring.
- `packages/modules/reels/ui/ReelsPager.tsx`: adds `origin.pointerId`, the `isPrimary` guard, the pointerId checks on move/up/cancel/leave, and a docblock point 3 extension.
- `packages/modules/reels/tests/reels-pager.test.tsx`: adds `isPrimary: true` on the four existing pointer inits and a new WR-05 describe with three cases.
- `packages/modules/reels/ui/ReelCaption.tsx`: adds the "… mais" pseudo-element hit area and the "menos" `pt-6 -mt-6`, with a comment on each.
- `packages/modules/reels/tests/reel-caption.test.tsx`: adds the UI-REVIEW fix 1 case.
- `packages/modules/reels/ui/ReelsLanes.tsx`: the tab is `inline-flex h-11 … items-center`, and an inner span carries `min-w-0 truncate border-b-2 pb-1` and the border colour.
- `packages/modules/reels/tests/reels-lanes.test.tsx`: updates the two lane cases.
- `.planning/phases/05.3-reels/05.3-VALIDATION.md` and `05.3-UI-REVIEW.md`: the doc updates.

## Decisions Made

These are deliberate differences from the review's snippets:

1. **WR-04:** the confirmed pair is **seq-tagged**, and an ok answer replaces the held pair only when its seq is higher. This way an out-of-order older answer cannot overwrite a newer confirmed state.
2. **WR-05:** a **primary pointerdown always restarts the gesture** instead of being refused while an origin is held. A new primary pointer exists only when no other pointer of its type is active, so an origin held at that moment is stale, and overwriting it self-heals instead of locking the pager.

These are deliberate differences from the UI review's example classes:

3. **Fix 1, "… mais":** the hit area comes from a pseudo-element (`after:absolute after:inset-x-0 after:-inset-y-3 after:content-[""]`), not `min-h-11 inline-flex items-center`. On a `bottom-0` absolute button, a 44 px box would lift the label or stretch the gradient.
4. **Fix 1, "menos":** it gets an upward pad (`pt-6 -mt-6`), not `py-3 -my-3`. "menos" sits on the last line of the `overflow-y-auto` paragraph, so a pad below it would add scroll overflow.

## Deviations from Plan

None. The plan was executed as written.

## Issues Encountered

None.

## Notes

- **05.3-VERIFICATION.md's `covered_digest` is now stale by design**, because covered Reels code changed. It was not edited or re-attested. Re-verify after the Phase 01.1 phone UAT.
- No `db:reset` or `db:seed` was run. The Playwright run used the existing local data.

## User Setup Required

None.

## Next Phase Readiness

- The 05.3 follow-ups are closed. 05.3-VERIFICATION.md stays `human_needed` until the phone UAT after Phase 01.1.

## Self-Check: PASSED

- All 10 modified files exist on disk.
- Commits 5024091, 9ea9f52, dd01381, e767ced and 71a603e are present in `git log`.
- The Task 1 to 3 `<verify>` commands were re-run on HEAD and passed.
