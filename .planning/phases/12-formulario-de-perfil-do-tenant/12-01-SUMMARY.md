---
phase: 12-formulario-de-perfil-do-tenant
plan: 01
subsystem: ui
tags: [profile-form, design-gate, UI-04, D-417, sketch-016, UI-D-564, UI-D-569, UI-D-581, UI-D-594]

requires:
  - phase: 12-formulario-de-perfil-do-tenant
    provides: 12-UI-SPEC.md (UI-D-564..UI-D-599, the 51-frame Sketch gate table) and 12-CONTEXT.md D-580..D-596
provides:
  - "Sketch 016: one self-contained index.html drawing all 51 prototype-less Phase 12 frames"
  - "Sketch 016 README with questions (a)-(f), findings F-1..F-8 and a provisional approval (approved: true)"
  - "MANIFEST row 016 and the 12-UI-SPEC.md reference point"
  - "The approval that releases the web plans 11-18 past their ^approved: true guard"
affects: [12-11, 12-12, 12-13, 12-14, 12-15, 12-16, 12-17, 12-18]

actuals:
  tokens: 88000
  tasks: 3
  commits: 3
plan_head_before: cbfc2cd790246f1ef206b5da71ce0949986cd20d

tech-stack:
  added: []
  patterns:
    - "Design gate as a sketch README whose frontmatter approved: true is grepped by every web task precondition"

key-files:
  created:
    - .planning/sketches/016-phase-12-designed-screens/index.html
    - .planning/sketches/016-phase-12-designed-screens/README.md
  modified:
    - .planning/sketches/MANIFEST.md

key-decisions:
  - "The gate is recorded as a provisional approval of the drawing as shipped; Igor gave no written answers to design questions (a)-(f), so none are recorded."
  - "The MANIFEST Winner column for row 016 stays pending: Igor did not ask for it to change and it is record-keeping only."

patterns-established:
  - "Prototype-less surfaces are drawn as one self-contained file with every frame named exactly as in the UI-SPEC table, so a grep proves coverage."

requirements-completed: [PFORM-26, UI-04]

coverage:
  - id: D1
    description: "Sketch 016 index.html draws all 51 UI-SPEC frames, self-contained, light and dark, two brands, 390px and 320px"
    requirement: UI-04
    verification: []
    human_judgment: true
    rationale: "Whether the drawing reads well is a design judgment; the file-level checks (51 frames present, no network references, no half-step spacing) were re-run and pass, but Igor's review is the proof."
  - id: D2
    description: "README with the six design questions, findings F-1..F-8 and row 016 registered in the MANIFEST"
    requirement: UI-04
    verification: []
    human_judgment: false
    rationale: "Registration is mechanical; checked by grep and a diff of the MANIFEST that shows added lines only."
  - id: D3
    description: "Igor's provisional approval of sketch 016 recorded in the README frontmatter and committed"
    requirement: UI-04
    verification: []
    human_judgment: true
    rationale: "The approval was written by the orchestrator on Igor's chat instruction, not by Igor's hand, and is provisional; /gsd-verify-work should confirm it with Igor."

duration: ~2h20m wall clock (start not recorded; includes the wait for Igor's review)
completed: 2026-10-30
status: complete
---

# Phase 12 Plan 01: Sketch gate for the prototype-less profile form surfaces Summary

**One 338 KB self-contained mockup draws all 51 prototype-less Phase 12 frames (builder, 13-type editor sheet, member form with 13 controls, profile blocks, platform row) and Igor's provisional approval is recorded, so the web plans 11-18 are unblocked.**

## Performance

- **Duration:** about 2h20m wall clock between the first task commit (2026-10-29 20:07 -03) and the approval commit (22:27 -03), most of it the review wait. The start time was not recorded by the first executor.
- **Tasks:** 3 (two auto, one blocking-human checkpoint)
- **Files modified:** 3 (index.html and README created, MANIFEST.md extended)

## Accomplishments

- `index.html` (1198 lines) draws the 51 frames of the UI-SPEC Sketch gate table, in table order: builder, editor sheet, confirmations and archive, member form, profile blocks, platform row. It has no network reference, inlines the real token values (`#f5f7fb` appears twice), has no half-step spacing class, labels all nine components and five routes the plan names, and nothing under `apps/` or `packages/` references it.
- The README carries the design question, the six questions (a)-(f) for the design team, the statement that PU-1..PU-14 are the researcher's defaults (PU-14 confirmed 2026-10-29), the decisions fixed upstream, the review instructions and eight findings from the drawing itself (F-1..F-8, open questions for the design team below).
- MANIFEST row 016 and the `12-UI-SPEC.md` reference point were added; rows 001-015 are untouched (the diff removes no lines).
- The approval is recorded and committed; web plans 11-18 each carry a `^approved: true` guard that now passes.

## Task Commits

1. **Task 1: Draw the Phase 12 surfaces (UI-04)** - `448522da` (feat)
2. **Task 2: Register sketch 016, write the README** - `fc8d8b95` (docs)
3. **Task 3: D-417 review gate, Igor's provisional approval** - `e1dc26c2` (docs, README frontmatter only: 5 lines changed)

**Plan metadata:** the commit that carries this SUMMARY, STATE.md, ROADMAP.md and REQUIREMENTS.md.

## Files Created/Modified

- `.planning/sketches/016-phase-12-designed-screens/index.html` - the D-417 review mockup, 51 frames.
- `.planning/sketches/016-phase-12-designed-screens/README.md` - frontmatter (`status: approved`, `approved: true`, `approval_kind: provisional`), questions, findings.
- `.planning/sketches/MANIFEST.md` - row 016 (Winner column left `pending`) and the UI-SPEC reference point.

## Decisions Made

- The approval covers the drawing as shipped and is provisional (`approval_kind: provisional`). Igor gave no written answers to questions (a)-(f); none were invented.
- The MANIFEST Winner column was not edited: Igor did not ask, and it is record-keeping only.

## Deviations from Plan

### Gate process deviation (for /gsd-verify-work)

**1. [Process - approval write not by Igor's hand] The approval lines were written by the orchestrator on Igor's instruction**
- **Found during:** Task 3 (D-417 review gate)
- **Plan said:** Igor pastes the approval lines himself; the executor never writes `approved: true` (T-12-02 mitigation). The plan did allow one exception: if Igor answers "faz você", the lines may be edited directly.
- **What happened:** Igor reviewed the sketch and approved it in chat on 2026-10-30 ("eu aprovo"). The orchestrator first offered him the paste-in; Igor then said explicitly "pode fazer voce mesmo", and the orchestrator (not the executor, not a subagent) edited the README frontmatter with a plain Edit. The five changed keys are `status: approved`, `approved: true`, `approved_by: "Igor (recorded by Claude on Igor's instruction)"`, `approved_at: 2026-10-30`, `approval_kind: provisional`. `changes_requested` stays `[]`.
- **Executor's part:** verified with `grep -c '^approved: true'` (1) and `git diff` (only those five keys changed), then committed the edit as-is in `e1dc26c2`, path-scoped, with no trailer. The executor did not write or alter any approval line.
- **Why it matters:** the approval was not written by Igor's hand and is provisional. /gsd-verify-work should confirm it with Igor before treating T-12-02 as fully closed.
- **Files modified:** `.planning/sketches/016-phase-12-designed-screens/README.md`
- **Committed in:** `e1dc26c2`

---

**Total deviations:** 1 (a process deviation in the gate, no code fixes, no Rule 1-3 auto-fixes)
**Impact on plan:** none on scope. The gate is released, with the caveat above recorded for verification.

## Open questions for the design team (README findings F-1..F-8)

These come from the drawing and are still open for the design team to close:

1. **F-1** - The UI-SPEC names `perfil-minhas-respostas` and `perfil-minhas-respostas-colapsado` without saying what each shows. The drawing uses the first for up to four rows (plus the 320px long answer) and the second for more than four rows, `details` closed and open.
2. **F-2** - `membro-primeira` shows some fields filled and marked only to display the selected states of the 13 controls; a real first visit is blank and flags nothing until "Salvar".
3. **F-3** - The reorder `aria-live` sentence is invisible in the product; the drawing shows it as an annotation.
4. **F-4** - Sheets are drawn at full height; in the product they have a maximum height and scroll.
5. **F-5** - The brand picker recolors things that are neutral in the product; it exists to check the reserved brand-ink list.
6. **F-6** - Icons are faithful redraws of the `lucide-react` set, not the real files.
7. **F-7** - Manrope is used only if installed where the file is opened; without it the 320px line breaks may differ slightly.
8. **F-8** - The contract changes nothing on desktop for the member form (384px column of the `(auth)` group); the desktop frame of `membro-primeira` shows that.

## Issues Encountered

None.

## Threat Flags

None. Mitigations: T-12-01 (no application code references the sketch; `git grep` over `apps` and `packages` finds nothing, and the file has no network fetch) holds. T-12-02 (agent-written approval) was handled by the process deviation above.

## Known Stubs

None. This plan produced documentation and a mockup only.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Web plans 11-18 are unblocked by their `^approved: true` guard (the guard appears in each of the eight plans). The API plans 04-10 never depended on this gate.
- Caveat: the approval is provisional and was recorded on Igor's instruction (see the deviation). If the product owner overrules any PU default in a later review, the affected frames are named in the README.

## Self-Check: PASSED

- index.html and README exist; 51 entries in the README `screens:` list; MANIFEST holds row 016 and the UI-SPEC reference point with no removed lines.
- Commits `448522da`, `fc8d8b95`, `e1dc26c2` exist.
- Task 1 acceptance: 0 network references, `#f5f7fb` present (2), 0 half-step spacing matches, all nine components and five routes found, `git grep` of the sketch path in `apps`/`packages` finds nothing.
- Task 3 acceptance: `^approved: true` present once; the approval commit changes only the five frontmatter keys.

---
*Phase: 12-formulario-de-perfil-do-tenant*
*Completed: 2026-10-30*
