---
phase: 06-events
plan: 02
subsystem: ui
tags: [design-gate, D-33, UI-04, sketch, events, mockup]

requires:
  - phase: 05.3-reels
    provides: sketch package shape (005) and the MANIFEST layout this plan extends
provides:
  - ".planning/sketches/006-phase-06-designed-screens/index.html: static D-33 mockup of the six prototype-less Events surfaces and the three proto deltas (light/dark, brand picker, 390/320/680 frames, zero network)"
  - ".planning/sketches/006-phase-06-designed-screens/README.md: review README with the gate armed (status: pending, approved: false)"
  - ".planning/sketches/MANIFEST.md: row 006 (pending) and 06-UI-SPEC.md under Reference Points"
affects: [06-03, 06-04, 06-05, 06-06, 06-07, 06-08, 06-09]

actuals:
  tokens: 49500
  tasks: 2
  commits: 2
plan_head_before: 6c1c850e5840f2183923cd159a5964c3589f05f6

tech-stack:
  added: []
  patterns:
    - "Sketch README lists the approval values as `- ` list items so only the frontmatter line can satisfy the `^approved: true` precondition grep"

key-files:
  created:
    - .planning/sketches/006-phase-06-designed-screens/index.html
    - .planning/sketches/006-phase-06-designed-screens/README.md
  modified:
    - .planning/sketches/MANIFEST.md

key-decisions:
  - "Phase 6 sketch is number 006, not 005: 004 (05.2) and 005 (05.3) already exist. The downstream precondition glob *-phase-06-designed-screens resolves to exactly this one directory"
  - "The D-33 gate ships armed (status: pending, approved: false); only the user records approval in the README frontmatter"
  - "Two layout findings from drawing at 320/390px are flagged for the review instead of being silently fixed: the calendar pair does not fit half-width at 320px (UI-SPEC E06 says it does), and the ticket's Data cell truncates 'sáb., 12 de out.' at 390px"

patterns-established:
  - "Sketch mockups simulate cover photos with labelled content gradients (.ph-*), never network images, as 005 did for video frames"

requirements-completed: []

coverage:
  - id: D1
    description: "Static mockup of the six [designed] Events surfaces (form, RSVP pair + every action-zone row, code entry in the ported ticket, online Entrar + refusal screens, Início card, Participantes) and the three proto deltas (chips + grid, pill rule, cancelled treatment), in light/dark under switchable tenant brands"
    requirement: "EVENT-01"
    verification:
      - kind: other
        ref: "Task 1 <verify> grep chain (Copywriting strings, brand-gradient, no apps/packages reference) + acceptance greps (0 external src/href/stylesheet, 0 <iframe, 0 pseudoqr/qrscanner, all seven route labels, #f5f7fb present)"
        status: pass
      - kind: automated_ui
        ref: "playwright headless screenshots of all nine sections, light and dark+purple, 0 page errors, 0 non-file requests (scratchpad, not committed)"
        status: pass
    human_judgment: true
    rationale: "D-33 / UI-04: whether the drawing reads as the prototype's language and answers the design-team messages is the human design review the gate exists for"
  - id: D2
    description: "Review README carrying the pt-BR design question, the messages owed to the design team and the fixed upstream decisions, with the gate armed; MANIFEST row 006 and the UI-SPEC reference point"
    requirement: "EVENT-01"
    verification:
      - kind: other
        ref: "Task 2 <verify> grep chain (approved: false, phase: 6, D-33, Garantir minha vaga, Horário Padrão de Brasília, MANIFEST row + 06-UI-SPEC.md) + acceptance greps (status: pending, approval_kind: null, changes_requested: [], D-205/D-208/D-203/Descartar present, 0 lines starting 'approved: true', 0 removed MANIFEST lines)"
        status: pass
    human_judgment: false

duration: 18min
completed: 2026-09-27
status: complete
---

# Phase 6 Plan 02: D-33 design gate for the Events surfaces Summary

**Sketch 006 is a single offline HTML mockup of the six prototype-less Events surfaces and the three proto deltas, drawn with real tokens.css values. It has a light/dark toggle, four tenant-brand presets and 390/320/680 frames. It is registered in MANIFEST, and its README ships the gate armed (`approved: false`).**

## Performance

- **Duration:** 18 min
- **Started:** 2026-09-27T14:24:36Z
- **Completed:** 2026-09-27T14:42:23Z
- **Tasks:** 2
- **Files modified:** 3

## Sketch number used

**006**: `.planning/sketches/006-phase-06-designed-screens/`. `ls -d .planning/sketches/*-phase-06-designed-screens` resolves to exactly one directory, so the six downstream preconditions glob correctly.

## Accomplishments

- **Delta (a), `/eventos`**:
  - member (390) and manager (390, icon-only `+`) frames;
  - a 320 frame with the 120-character title and the 60-character venue;
  - `loading.tsx` skeletons and the load-more error;
  - the three empty states (Próximos for member and manager, Passados);
  - a 680px desktop column with "+ Criar evento" and the 2-column grid.
- **Delta (b), the pill rule**: nine posters at the real 318px width, one per pill state (`Você vai`, `Presente`, `Cancelado`, Hoje, Amanhã, Em 3 dias, Agora, Encerrado), plus one on the cover-less gradient. The absolute date always sits in the overline.
- **Delta (c), cancelled**:
  - the grayscale poster beside a colour poster;
  - the member detail, with the danger banner and the RSVP disabled but showing the stored answer;
  - the manager detail, with "Reativar evento" and the "Gerenciar evento" card.
- **Surface 1, the form**:
  - create, empty and filled (online, "Criando…", end prefilled at start + 2 h);
  - the errors shown after a first submit, and a counter at its cap;
  - edit mode with the edit note and "Cancelar evento", and the reactivate and locked variants;
  - the four confirm dialogs;
  - the desktop FileDropZone;
  - the zone helper reading "Horário Padrão de Brasília".
- **Surface 2, RSVP and the action zone**:
  - six `SegmentedControl` states: unanswered, Vou, Não vou, busy, disabled, and 320 with keyboard focus;
  - all 14 action-zone contract rows (in person, online, cancelled), each with at most one brand fill;
  - the full P0 detail page and a 320px P1 detail.
- **Surface 3, the ticket** (no QR, no pseudo-QR, no scanner):
  - full phone frames for open-empty, wrong code, done and 320 (60-character venue);
  - bottom-section cards for Confirmando…, the guess bound, not open yet, closed and cancelled.
- **Surface 4, online**:
  - the online detail in P1;
  - `Entrar` as outline and as brand, with the three hints;
  - the refusal screens: ended, cancelled, confirm first, and not found.
- **Surface 5, the Início card**: P0 with `Você vai`, in-person check-in mode, online check-in mode (`Presente` + Entrar), a 320 frame with the long title, and `/inicio` with no card.
- **Surface 6, Participantes**:
  - Confirmados with the K7QM code card and "Gerar novo código";
  - Presentes with walk-ins ("Sem confirmação") and "Membro removido";
  - 320 with four-digit chip counts;
  - the online card variant (Não vão);
  - the three chip empties, six row skeletons and the load-more error;
  - the regenerate confirm dialog.

## Task Commits

1. **Task 1: Draw the six surfaces and three deltas** - `66800b2` (docs)
2. **Task 2: Register the sketch, write the README, arm the gate** - `c3c2725` (docs)

## Files Created/Modified

- `.planning/sketches/006-phase-06-designed-screens/index.html`: the D-33 review mockup (~174 KB, one file, no network).
- `.planning/sketches/006-phase-06-designed-screens/README.md`: frontmatter gate (`status: pending`, `approved: false`, `approval_kind: null`, `changes_requested: []`) and the review body.
- `.planning/sketches/MANIFEST.md`: row 006 plus the `06-UI-SPEC.md` reference point. Rows 001–005 are unchanged.

## Decisions Made

- The sketch number is 006 (see above).
- The README lists the approval values as list items, following 005, so only the frontmatter line can satisfy `^approved: true`.
- Two layout findings are surfaced for the review rather than fixed by inventing values. They appear in the mockup captions and in the README section "Dois achados do próprio desenho":
  1. The calendar pair's two `Button outline md` do not fit half-width at 320px.
  2. The ticket's Data cell truncates the contract date format at 390px.

## Deviations from Plan

### Orchestrator-directed drift

**1. Sketch renumbered from 005 to 006**
- **Found during:** Task 1.
- **Issue:** The plan expected `005`, but `004-phase-05.2-designed-screens` and `005-phase-05.3-designed-screens` both exist, because 05.2 and 05.3 executed after Phase 6 was planned.
- **Fix:** Used `006-phase-06-designed-screens`. MANIFEST rows 001–005 were left untouched (the plan named only 001–003; 004 and 005 get the same treatment).
- **Verification:** exactly one directory matches the glob, and the MANIFEST diff has 0 removed lines.
- **Committed in:** `66800b2`, `c3c2725`.

**2. README shape follows the current tree (005) as well as 003**
- **Found during:** Task 2.
- **Issue:** 005's README evolved beyond 003's: it adds "How to View", "Decisions already fixed upstream", and a "Recording the outcome" section that lists the approval values as list items.
- **Fix:** Kept 003's frontmatter keys and adopted 005's section set and list-item approval block.
- **Committed in:** `c3c2725`.

**3. The brand picker's fourth preset is a yellow brand with dark derived ink**
- **Found during:** Task 1.
- **Issue:** The earlier sketches' fourth preset is red.
- **Fix:** Replaced it with a yellow brand, so the review can see `--brand-on-primary` flip to dark ink on the gradient cover fallback and on brand fills. This is mockup chrome only; no token was added.

---

**Total deviations:** 3 (renumbering and README shape directed by the orchestrator's drift notes; one mockup-chrome choice).
**Impact on plan:** None on scope. Every acceptance criterion passes.

## Issues Encountered

None.

## D-33 Review: pending the developer

Task 2's `<human-check>` is an end-of-phase review (`workflow.human_verify_mode` = `end-of-phase`). The README ships with `approved: false`, so these six tasks halt on their precondition until the user records the outcome in the README frontmatter:

- 06-03 Task 3
- 06-04 Task 2
- 06-05 Task 2
- 06-06 Task 2
- 06-07 Task 2
- 06-08 Task 2

The orchestrator presents the sketch for review. Per the 02-04 / 04-02 / 05-02 precedent, a provisional product-owner approval unblocks coding.

## User Setup Required

None.

## Next Phase Readiness

- 06-01 (schema) and the ungated tasks of 06-03..06-08 can proceed.
- Every surface-coding task waits on the D-33 approval of sketch 006.

## Self-Check: PASSED

- FOUND: .planning/sketches/006-phase-06-designed-screens/index.html
- FOUND: .planning/sketches/006-phase-06-designed-screens/README.md
- FOUND: commit 66800b2
- FOUND: commit c3c2725
- `grep -rl phase-06-designed-screens apps packages` → nothing

---
*Phase: 06-events*
*Completed: 2026-09-27*
