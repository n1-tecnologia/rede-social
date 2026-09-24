---
phase: 05-communities-stories
plan: 12
subsystem: testing
tags: [verification-debt, traceability, prohibitions, backstop, human-verification, roadmap, mvp-mode, gap-closure]

# Dependency graph
requires:
  - phase: 05-communities-stories
    provides: "05-VERIFICATION.md's 23 fail-closed items (14 flagged prohibitions, 5 backstop visual claims, 4 device checks) and the three gap-closure plans 05-09/05-10/05-11 whose tests convert three of them"
provides:
  - "`.planning/phases/05-communities-stories/05-VERIFICATION-DEBT.md` — all 23 unresolved verification items on one page, each with a file-and-line reading of the shipped code beside it, 3 marked converted with the test file AND case that converts them, 1 marked explicitly open and not closable locally, 18 carried to a human unchanged"
  - "a confirmed (not edited) traceability record: `.planning/REQUIREMENTS.md` was read at lines 63-73 and 245-253 and found already correct, so the diff for it is empty"
  - "section 4 of the dossier: the 8 NEW flagged prohibitions that 05-09/05-10/05-11 themselves author, named up front so the next verifier does not discover a second set the way this one was discovered"
  - "Phase 5's mode decision, made by the developer and applied: `**Mode:** mvp` removed from the ROADMAP Phase 5 block"
  - "`.planning/WINDOWS.md` entry 43 — the 22 still-unresolved items visible to the ship gate after this SUMMARY scrolls out of context"
affects: [06-events, 05-UAT, gsd-verify-work, gsd-ship]

# Actuals (#2632) — chars/4 over the realized diff of the two task commits
# (05-VERIFICATION-DEBT.md 30,047 chars + the 1-line ROADMAP deletion).
# This SUMMARY and the WINDOWS.md entry add roughly another 2.5k on the same scale.
actuals:
  tokens: 7515
  tasks: 2
  commits: 2
plan_head_before: 350f88f88211526b147378a061eee6a59f27d864

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Verification-debt dossier: a single page that assembles every fail-closed item with its evidence and marks a verdict column explicitly as a PROPOSAL, so a flagged item cannot be laundered into a passing verdict by being written down more confidently"
    - "Confirm-before-edit on planning records: read the file from disk first and edit only on a real disagreement — the verifier's note about COMM-01/STORY-02 was already stale, and acting on it would have been the exact mistake it warned about"

key-files:
  created:
    - .planning/phases/05-communities-stories/05-VERIFICATION-DEBT.md
  modified:
    - .planning/ROADMAP.md
    - .planning/WINDOWS.md

key-decisions:
  - "Phase 5 drops `mode: mvp` rather than acquire a User Story goal after the fact (developer's answer to Task 2, option 2). `user-story.validate` returned `valid: false` on all three slots for the Phase 5 goal, which is why 05-VERIFICATION.md could not emit the MVP 'User Flow Coverage' section and fell back to goal-backward verification against the five Success Criteria. Rationale as accepted: the phase is already executed, verified once and gap-closed, so a user story written now would be written backwards from the code — the one direction a user story is worthless in. Option 1 (`/gsd mvp-phase`) is for a phase not yet planned. The goal on ROADMAP.md:289 was left exactly as written; the edit is one deleted line and nothing else."
  - "`.planning/REQUIREMENTS.md` was NOT edited. The verifier's closing note said COMM-01 and STORY-02 were wrongly marked `[x]`/`Complete`; commit 99782b6 had already reverted that, so disk reads `Gaps Found` and unchecked boxes. Confirming and recording was the correct action; an edit here would have been a change made against a stale reading."
  - "This plan's `requirements: [COMM-01, STORY-02]` are deliberately NOT marked complete and `requirements-completed` is empty. The plan's purpose is to keep those two requirements visibly incomplete while their gaps are open; marking them would contradict the artifact it just produced."
  - "One WINDOWS.md entry (43) covers the 22 still-unresolved items and points at the dossier, rather than 22 duplicate rows. H-05-02 keeps its own pre-existing entry 42."

patterns-established:
  - "A conversion claim cites a test FILE and a CASE NAME that exist on disk, never a plan's intention — checked for all three conversions in this dossier"
  - "A partial conversion is recorded as partial: H-05-01 states which half is automated (the render-count ceiling) and which half is not (the 30 s device profile), rather than reading as closed"

requirements-completed: []  # intentionally empty — see key-decisions; COMM-01 and STORY-02 stay open until re-verification

coverage:
  - id: D1
    description: "The verification-debt dossier exists with exactly 14 prohibition rows, 5 backstop rows and 4 device-check rows, and the eight executed plans still carry exactly 14 flagged prohibitions between them (proving 05-01…05-08 were not edited)"
    verification:
      - kind: other
        ref: "test \"$(for f in .planning/phases/05-communities-stories/05-0{1..8}-PLAN.md; do grep -c 'verification: flagged' \"$f\"; done | paste -sd+ - | bc)\" = \"14\" → PROHIBITION_SOURCE_COUNT_OK"
        status: pass
      - kind: other
        ref: "grep -c '^| P-05-' = 14 && grep -c '^| B-05-' = 5 && grep -c '^| H-05-' = 4 on 05-VERIFICATION-DEBT.md → DOSSIER_ROW_COUNTS_OK"
        status: pass
      - kind: other
        ref: "git status --porcelain | grep -E '05-0[1-8]-' → NONE_MODIFIED"
        status: pass
    human_judgment: false
  - id: D2
    description: "The traceability record was confirmed against disk, not edited: the nine Phase 5 requirement rows all still read as not-yet-complete"
    verification:
      - kind: other
        ref: "grep -c 'Gaps Found' .planning/REQUIREMENTS.md → 14 (gate threshold ≥ 9)"
        status: pass
      - kind: other
        ref: "git diff HEAD~2 -- .planning/REQUIREMENTS.md → empty"
        status: pass
    human_judgment: false
  - id: D3
    description: "The developer's mode decision is applied: the Phase 5 ROADMAP block carries no `Mode:` line, the goal line is untouched, and the other eight phases keep theirs"
    verification:
      - kind: other
        ref: "sed -n '/^### Phase 5:/,/^### Phase 6:/p' .planning/ROADMAP.md | grep -c 'Mode:' → 0; grep -c '^**Mode:** mvp' .planning/ROADMAP.md → 8; git diff --stat 6198fd3^ 6198fd3 → 1 file changed, 1 deletion(-)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The 13 CARRIED flagged prohibitions (P-05-01…P-05-14 except the converted P-05-10) — each must be judged still honoured by the shipped code, or named as a defect"
    verification: []
    human_judgment: true
    rationale: "All carry `status: unverified` with `verification: flagged` in their source plans. They fail closed by construction; the dossier's verdict column is a stated PROPOSAL and a verifier's reading is not a resolution. The strongest of them guard tenant isolation and member consent."
  - id: D5
    description: "The 5 backstop visual claims (B-05-01…B-05-05) at a 320px viewport: a 60-char community name at 24/700; a 40-char tenant display name above the `/inicio` strip; a 25-story progress bar; a 90-char caption plus a 40-char community name in one history row; twelve 40-char community names in the pin sheet"
    verification: []
    human_judgment: true
    rationale: "All five are declared `verification: backstop` in their source plans with no automated evidence anywhere in the phase; per the abstain rule they are `insufficient_spec`. Gap closure converted none of them — 05-09/05-10/05-11 touched no layout, no type scale and no truncation rule."
  - id: D6
    description: "H-05-01, open half: a 30 s CPU/memory profile of the story viewer on a real phone (or mobile emulation) with a cached, decoded image story"
    verification:
      - kind: unit
        ref: "packages/modules/stories/tests/story-viewer-media.test.tsx#1. a decoded story image renders the real component, reports once, and lets the clock start"
        status: pass
    human_judgment: true
    rationale: "PARTIAL. 05-10 Task 1 bounds the render count (wrapper throws at 400; settled ≈8) with the real MediaImage under the real StoryViewer, which closes the unbounded-loop half. A ceiling is a bound, not a profile — a render-RATE under a real decoder on real hardware cannot be asserted by any check in this repo, so the device half stays open."
  - id: D7
    description: "H-05-02, OPEN and not discharged: publish a VIDEO story as `admin_tenant`, wait for it to become ready, open it from the `/inicio` strip, and watch the segment fill from the video's own time and auto-advance (or close) when the video ends"
    verification: []
    human_judgment: true
    rationale: "Not closable locally and not softened. The local video provider is `fake` with no real HLS stream and the seed fixture is image-only, so an e2e would assert over a player that cannot play. 05-11 proved the component chain only (StoryVideo.test.tsx, six cases, and StoryViewerHost.test.tsx case 13 — a video segment filling to 50% off a forwarded `timeupdate`, with `./StoryVideo` un-stubbed). `.planning/WINDOWS.md` entry 42 is `open` for exactly this."
  - id: D8
    description: "P-05-10 / H-05-04, the named hole inside a conversion: in a REAL browser, tap the media-error COPY (not the retry) and confirm the story still advances through it"
    verification:
      - kind: unit
        ref: "packages/modules/stories/tests/story-viewer.test.tsx#12a. CR-04: tapping the play badge starts playback and does NOT advance the story"
        status: pass
      - kind: unit
        ref: "packages/modules/stories/tests/story-viewer.test.tsx#12b. CR-04: tapping the media-error retry re-mounts the media and does NOT advance"
        status: pass
      - kind: unit
        ref: "packages/modules/stories/tests/story-viewer.test.tsx#12c. CR-04: the stage is still LIVE — a tap on the media area advances as before"
        status: pass
    human_judgment: true
    rationale: "The two CONTROL taps are asserted (12a/12b, with 12c preventing a trivial pass over a broken pipeline). A tap on the error COPY is not: happy-dom does not hit-test, so `pointer-events-none` has no effect on synthetic dispatch. 05-10 deviation 3 records this as coverage D6 `deferred`; it is real-browser-only."
  - id: D9
    description: "The pt-BR cover-image failure sentence left open by 05-09 — 'Não foi possível usar esta imagem de capa. Escolha outra.' — read in the alert card on a phone"
    verification: []
    human_judgment: true
    rationale: "Copy fit and tone in a real alert card at phone width is a reading judgment; 05-09 carried it forward as a human item and nothing in this plan changes it."

# Metrics
duration: 15min
completed: 2026-09-24
status: complete
---

# Phase 5 Plan 12: Verification Debt & Mode Decision Summary

**All 23 of Phase 5's fail-closed verification items assembled on one page with a file-and-line reading beside each — 3 converted by gap-closure tests, 1 named as not closable locally, 18 carried to a human unchanged — plus a traceability record confirmed rather than edited and `mode: mvp` dropped from Phase 5 by the developer's decision.**

## Performance

- **Duration:** ~15 min for this continuation session (12:36:50Z → 12:51:29Z). Task 1 ran in an earlier executor session whose start time is not recorded here, so this is not the plan's total wall clock.
- **Started (this session):** 2026-09-24T12:36:50Z
- **Completed:** 2026-09-24T12:51:29Z
- **Tasks:** 2 of 2
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments

- **The 23 unresolved items are on one page and none of them was absorbed.** `05-VERIFICATION-DEBT.md` (194 lines) carries exactly 14 prohibition rows, 5 backstop rows and 4 device-check rows, each citing the shipped code by file and line rather than restating the plan that promised it. A sentence above the prohibition table states outright that the verdict column is a proposal for a human and not a resolution — the mitigation for T-05-53, the one real harm a planning artifact can do.
- **Three items are converted, and each conversion names a test that exists.** P-05-10 (05-06's "two meanings on one tap") and H-05-04 (the verifier's badge/retry check) are the same claim seen from two sides and are discharged by the same three cases — `story-viewer.test.tsx` 12a/12b/12c. H-05-03 (a pinned, still-transcoding story must not sit in a permanent loading state) is discharged by `story-viewer-media.test.tsx` case 4's empty-variant-ladder assertion, which is the exact shape a still-transcoding pinned asset takes because `listCommunityHighlights` omits the `status = 'ready'` filter.
- **Two partials are recorded as partial, not as closed.** H-05-01's unbounded-render half now has an automated ceiling; its 30 s device profile does not. P-05-10/H-05-04's control taps are asserted; a tap on the error *copy* is not.
- **One item is open and is not softened anywhere in the file.** H-05-02, a VIDEO story watched end to end.
- **The traceability record was confirmed against disk and left alone.** `git diff` for `.planning/REQUIREMENTS.md` is empty across both task commits.
- **Section 4 names the 8 NEW flagged prohibitions that gap closure itself authored** (N-05-01…N-05-08 from 05-09/05-10/05-11), so the next verifier does not have to discover a second set the way this one was discovered.
- **The mode mismatch was decided by the developer, not by the planner or the executor.** One line removed; nothing else touched.

## Task Commits

1. **Task 1: The honest record — confirm the traceability table against disk, then assemble the verification-debt dossier** — `a3d30ce` (docs). *Executed by a previous executor session; verified intact by this one before resuming.*
2. **Task 2: Decide this phase's mode — a real User Story goal, or drop `mode: mvp`** — `6198fd3` (docs). Developer answered option 2 at the `gate="blocking-human"` checkpoint; the executor applied the one-line ROADMAP edit and nothing else.

**Plan metadata:** see the `docs(5-12): complete` commit.

## Files Created/Modified

- `.planning/phases/05-communities-stories/05-VERIFICATION-DEBT.md` (created, 194 lines) — the dossier: frontmatter counts, section 1 the traceability finding, section 2 the 14 prohibitions, section 3a/3b the 5 backstop claims and 4 device checks, section 4 the 8 prohibitions gap closure added, then the arithmetic table restating 14 + 5 + 4 = 23.
- `.planning/ROADMAP.md` (modified, −1 line) — `**Mode:** mvp` removed from the Phase 5 block at line 290. The goal on line 289 and every other line are untouched; the other eight phases keep their `Mode:` lines.
- `.planning/WINDOWS.md` (modified, +1 entry) — entry 43, `unrun-verify`, `open`, pointing at the dossier for the 22 items that remain unresolved.
- `.planning/REQUIREMENTS.md` — **read, deliberately not modified.** Recorded here because the non-edit is the deliverable.

## Decisions Made

1. **Drop `mode: mvp` from Phase 5 (developer's answer, option 2).** `gsd_run query user-story.validate` returns `valid: false` on all three slots for the Phase 5 goal, so `05-VERIFICATION.md` could not honestly produce the MVP "User Flow Coverage" section and fell back to goal-backward verification against the five roadmap Success Criteria — a fallback that worked and that found both gaps. Rather than keep a flag whose contract the goal cannot meet, the flag goes. Rationale as the developer accepted it: **the phase is already executed, verified once and gap-closed, so a user story written now would be written backwards from the code — the one direction a user story is worthless in.** Option 1 (`/gsd mvp-phase 05`) is reserved for a phase that has not been planned yet. The next verifier now runs standard goal-backward verification against the five Success Criteria with no fallback note.
2. **Confirm, do not edit, the traceability record.** The verifier's closing note asserted COMM-01 and STORY-02 were wrongly marked done; commit `99782b6` had already reverted that. Acting on the note would have been the precise mistake the plan's own T-05-54 warns about — an edit made from a stale reading, which is a false statement with a long half-life.
3. **Leave `requirements-completed` empty.** The template says to copy this plan's `requirements:` IDs, but doing so would assert COMM-01 and STORY-02 are complete while this very plan's output documents their gaps as open. `gsd_run query requirements.mark-complete` was therefore NOT run. Documented as a deviation below.
4. **One WINDOWS.md entry, not 22.** Entry 43 covers the carried set and points at the dossier; H-05-02 keeps its own entry 42. Twenty-two near-duplicate rows would make the ledger less readable, not more honest.

## Deviations from Plan

### 1. [Rule 2 — Missing critical correctness] `requirements-completed` left empty and `requirements.mark-complete` not run

- **Found during:** Task 2 / SUMMARY authoring.
- **Issue:** The executor's standard state-update step marks every ID in the plan's `requirements:` frontmatter complete. This plan declares `requirements: [COMM-01, STORY-02]` — the two requirements whose premature `Complete` marks commit `99782b6` had just reverted, and whose gaps are still open. Running the step would have re-created the exact defect the plan exists to prevent, and would have contradicted the dossier committed minutes earlier.
- **Fix:** `requirements.mark-complete` was not invoked. `requirements-completed: []` with an inline comment. `.planning/REQUIREMENTS.md` still shows 14 `Gaps Found` occurrences and unchecked COMM-01/STORY-02 boxes.
- **Files modified:** none (the fix is a non-action).
- **Verification:** `grep -c 'Gaps Found' .planning/REQUIREMENTS.md` → 14 (the plan's gate requires ≥ 9); `git diff` for the file across both task commits is empty.

### 2. [Scope] One WINDOWS.md ledger entry instead of one per carried item

- **Found during:** SUMMARY authoring.
- **Issue:** The executor protocol appends one ledger row per unrun-verify item. Twenty-two rows would each restate a row already in the dossier.
- **Fix:** A single entry (43) describing the carried set and naming the dossier as its register. Entry 42 (H-05-02) predates this plan and is untouched.
- **Verification:** `grep -n '^| 43 |' .planning/WINDOWS.md` → present, status `open`.

---

**Total deviations:** 2 (1 missing-critical correctness, 1 scope). Neither changes runtime behaviour; deviation 1 prevents a false record.
**Impact on plan:** None on scope. Deviation 1 is the plan's own truth 5 applied to the executor's own bookkeeping.

## Issues Encountered

**The checkpoint did what it was for.** Task 2 is `checkpoint:decision` with `gate="blocking-human"`, so it was never eligible for auto-selection (`auto_advance: false` here regardless). The previous executor stopped at it and handed back; this session resumed as a fresh agent, verified `a3d30ce` as HEAD and the dossier's 14/5/4 row counts on disk before continuing, and did not redo Task 1.

No other issues. This plan touched no source file, no Drizzle schema, no migration and no runtime behaviour, exactly as its `<gap_closure_scope>` states.

## What is still open after this plan

This is the point of the plan, so it is restated here rather than left to the dossier alone. **22 of the 23 items are unresolved** (entry 43 in `.planning/WINDOWS.md`), plus the 8 new prohibitions gap closure authored. The five a human has to act on first:

| Item | State | Why it is not closed |
|---|---|---|
| **H-05-02** — a VIDEO story watched end to end on a device | **OPEN, not converted** | The local video provider is `fake` with no HLS stream and the seed fixture is image-only, so no e2e can assert it. `.planning/WINDOWS.md` entry 42 is `open`. |
| **H-05-01** — the viewer's 30 s device render profile | **Partially covered only** | 05-10 Task 1's render-count ceiling is an automated BOUND, not the render-rate profile on real hardware the verifier asked for. The device half stays open. |
| **P-05-10 / H-05-04** — the viewer must not mount two meanings on one tap | **Converted PARTIAL** | The two control taps are asserted (`story-viewer.test.tsx` 12a/12b/12c). A tap on the error COPY is not: happy-dom does not hit-test, so `pointer-events-none` has no effect on synthetic dispatch (05-10 deviation 3, coverage D6 `deferred`). |
| **05-09's pt-BR copy** — "Não foi possível usar esta imagem de capa. Escolha outra." | Open human item | Whether it reads well in the alert card on a phone. |
| **P-05-03** | **The weakest carried row, and flagged as such** | Three literals were spot-checked and cleared; the claim was not exhaustively traced. |

## User Setup Required

None — no external service configuration.

## Next Phase Readiness

- Phase 5's twelve plans are executed and its verification debt is assembled, but **the phase is not verified complete.** Re-running `/gsd-verify-work` for Phase 5 is the next step, and it now runs standard goal-backward verification against the five Success Criteria with no mode fallback.
- The four `<verify><human-check>` blocks in `05-12-PLAN.md` are harvested into `05-UAT.md` at end-of-phase per `human_verify_mode: end-of-phase`; coverage entries D4–D9 above route them deterministically.
- COMM-01 and STORY-02 remain open in `.planning/REQUIREMENTS.md` and must not be marked complete until the re-verification says so.
- Phase 6 (Events) depends on Phase 5. Nothing in the carried debt blocks it structurally — all 23 items concern the stories viewer, community layout and record-keeping, none of them a contract Phase 6 consumes — but shipping the milestone is gated on WINDOWS entries 40, 42 and 43 being resolved.

---
*Phase: 05-communities-stories*
*Completed: 2026-09-24*

## Self-Check: PASSED

- `05-VERIFICATION-DEBT.md`, `05-12-SUMMARY.md`, `ROADMAP.md`, `WINDOWS.md` — all present on disk.
- Commits `a3d30ce` (Task 1) and `6198fd3` (Task 2) — both found in `git log`.
- `git diff a3d30ce~1 HEAD -- .planning/REQUIREMENTS.md` — empty, as the plan requires.
