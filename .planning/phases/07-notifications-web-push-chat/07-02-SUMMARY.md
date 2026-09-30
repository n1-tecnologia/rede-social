---
phase: 07-notifications-web-push-chat
plan: 02
subsystem: ui
tags: [design-gate, D-33, UI-04, sketch, notifications, push, chat, mockup]

requires:
  - phase: 07-notifications-web-push-chat
    provides: "07-UI-SPEC.md (UI-D-250..UI-D-268, Copywriting Contract) and 07-CONTEXT.md (D-220..D-240)"
  - phase: 02-tenant-shell-branding-platform-panel
    provides: "packages/ui/src/styles/tokens.css, the shipped TopBar/DesktopRail/Badge/Switch/InstallHint geometry"
provides:
  - "Sketch 007: one self-contained static mockup of the nine prototype-less Phase 7 surfaces and the two proto deltas"
  - "The armed D-33 gate: README ships approved: false; six gated tasks wait on the user's approval edit"
  - "MANIFEST row 007 (pending) and 07-UI-SPEC.md as a reference point"
affects: [07-04, 07-05, 07-07, 07-09, 07-10]

actuals:
  tokens: 55577
  tasks: 2
  commits: 2
plan_head_before: 80ef5b875437dc1fe7b4f6726ef1f0c72b2c5d82

tech-stack:
  added: []
  patterns:
    - "Sketch shape inherited from 006: one HTML file, zero network, tokens inlined verbatim, theme toggle + brand presets, 390/320 phones + 1280 desktop"
    - "Approval keys shown inline in one README sentence so only the frontmatter line can satisfy the anchored gate grep"

key-files:
  created:
    - .planning/sketches/007-phase-07-designed-screens/index.html
    - .planning/sketches/007-phase-07-designed-screens/README.md
  modified:
    - .planning/sketches/MANIFEST.md

key-decisions:
  - "Sketch 007 ships the D-33 gate closed (approved: false); 07-04 Task 3, 07-05 Task 2, 07-07 Task 2, 07-09 Task 2, 07-10 Task 1 and 07-10 Task 2 halt on their precondition until the user pastes the approval keys"
  - "Two drawing findings handed to the review instead of being decided: the shipped InstallHint puts the inline Share icon at the end of the body (far from 'Compartilhar' in the push copy), and max-h-30 in border-box shows ~4.3 composer lines, not five"

patterns-established:
  - "Mockup-only chrome (dashed outlines, sr-only annotations, stacked toasts) is labelled in captions so reviewers never read it as product"

requirements-completed: [NOTIF-02, NOTIF-03, PWA-02, CHAT-02, CHAT-03, CHAT-05]

coverage:
  - id: D1
    description: "index.html draws the nine [designed] surfaces (UI-D-251/253/254/255/256/257/258/262/264) in every UI-SPEC state, light/dark, under brand presets, plus the two proto deltas (UI-D-259, UI-D-260)"
    verification:
      - kind: other
        ref: "Task 1 <automated> grep chain (locked strings, no apps/packages reference) — exit 0; UI-D label count 20; network-asset grep 0; Abertas/Resolvidas grep 0; 1.800/2.000 grep 10"
        status: pass
      - kind: automated_ui
        ref: "headless Chromium render of every section (light + dark/purple): 0 network requests, 0 page errors, no horizontal overflow"
        status: pass
    human_judgment: true
    rationale: "Whether the drawings read as the prototype's own language is the D-33 design review itself; only the user/designer can approve it"
  - id: D2
    description: "README ships the gate armed (approved: false), lists the six gated tasks, the design-team messages and D-220..D-240; MANIFEST registers row 007 and the 07-UI-SPEC.md reference point"
    verification:
      - kind: other
        ref: "Task 2 <automated> grep chain — exit 0; grep -c '^approved: true' = 0; gated-task grep = 13; grep -c '| 007 |' MANIFEST = 1"
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-09-30
status: complete
---

# Phase 7 Plan 02: D-33 design gate for the prototype-less Phase 7 surfaces Summary

**Sketch 007: one offline HTML mockup of the staff inbox, desktop split, soft-ask card, six-state push row, InstallHint push sheet, member thread header and greeting, actor-less/removed notification rows, comment highlight and chat dot badge, plus the two chat deltas, with the D-33 gate armed at `approved: false`.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-09-30T11:20:32Z
- **Completed:** 2026-09-30T11:42:29Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

The mockup uses the real `tokens.css` values, a theme toggle, four brand presets, and 390/320px phones plus a 1,280px desktop. It adds no new token, size, weight or spacing value. Everything is copied from the UI-SPEC Copywriting Contract.

The drawn surfaces and their states:

- **Surface 1, staff inbox (UI-D-262).** Awaiting rows with the 8px brand dot. Team preview with the "Carla: " prefix. Times "14:02", "Ontem", "12/10". Blocked row with the neutral "Bloqueado" pill. Departed row. Also empty, skeleton, load-more error and 320px frames. There are no status chips and no filters (D-221).
- **Staff thread (UI-D-263).** Profile link header with no side panel, blocked read-only notice, departed read-only notice, and the one not-found screen.
- **Surface 2, desktop split (UI-D-264).** The 1,280px `288px | 1fr` card with the active row in `bg-bg-active`, the idle pane "Escolha uma conversa", and a 900px note frame showing separate routes between `md` and `lg`.
- **Surface 3, soft-ask card (UI-D-255).** Member and staff bodies, busy, 320px, dismissed, and the three flow toasts.
- **Surface 4, push row (UI-D-256).** Checking, unsupported, iOS not installed, off, on, denied (with a 30-character tenant name at 320px), and busy.
- **Surface 5, InstallHint push variant (UI-D-257).** 390px and 320px sheets with one "Entendi". The shipped install variant is drawn beside it for comparison.
- **Surface 6, member thread (UI-D-258).** Header with a wide wordmark and with no logo. Empty greeting above the enabled composer. Populated thread showing:
  - "Hoje", "Ontem" and date separators, runs, and the time under the last bubble of a run;
  - "Enviando…", links in both bubble inks, the new-messages pill, and "Carregar mensagens anteriores" with its error;
  - a 2,000-character message with 36 line breaks and a 300-character unbroken URL.
- **Surface 7, notification rows (UI-D-251).** Actor-less 1 h and 24 h reminders, the generic unknown kind, the removed target drawn as a button, the departed actor, and the coloured like heart. Each is shown unread and read, with the "Não lida." screen-reader note. Also a 320px long row, and empty, loading and error states.
- **Surface 8, comment highlight (UI-D-254).** The root thread first with its replies expanded, the target tinted, and a frame after the fade. Also the toasts "Este comentário não está mais disponível.", "Este story expirou." and "Este conteúdo não está mais disponível.".
- **Surface 9, badges (UI-D-253).** Member TopBar (bell 3 plus the dot) and staff TopBar (bell plus chat 2). Also "99+", zero, 320px, and desktop rails for both roles. Captions give the accessible names.
- **Delta (a), sender label (UI-D-259).** Before and after, and the same conversation in the member view and the staff view.
- **Delta (b), composer (UI-D-260).** The prototype with the removed parts struck through. Then empty, one line, five lines, scrolling, the counter at 1.800 and 2.000, and the failure state with the draft restored.

The README frontmatter carries `approved: false`. Its body holds:
- what to review, one line per surface;
- five messages for the design team: the do-not-port list (including "Marcar como resolvido"), the sender label moving outside the bubble, the composer losing attachments, why the removed-target row exists, and the open "Entendi" flag;
- D-220..D-240, one line each.

The **six gated tasks** are 07-04 Task 3, 07-05 Task 2, 07-07 Task 2, 07-09 Task 2, 07-10 Task 1 and 07-10 Task 2.

## Task Commits

1. **Task 1: Draw the nine prototype-less Phase 7 surfaces and the two proto deltas.** `a13690a` (docs)
2. **Task 2: Write the sketch README with the gate armed and register the package in the manifest.** `cf43e12` (docs)

## Files Created/Modified

- `.planning/sketches/007-phase-07-designed-screens/index.html`: the D-33 review mockup, about 199 KB, with no network assets.
- `.planning/sketches/007-phase-07-designed-screens/README.md`: the gate frontmatter, review guide, design-team messages, upstream decisions and approval instructions.
- `.planning/sketches/MANIFEST.md`: the `07-UI-SPEC.md` reference point and the 007 row (pending).

## Decisions Made

- The README approval keys appear inline in one body sentence and never at the start of a line. Only the frontmatter can therefore satisfy `grep -q '^approved: true'`.
- Two drawing findings go to the review rather than being decided here:
  - The shipped InstallHint places the inline `Share` 16 at the end of the body. In the push copy that is far from "Compartilhar".
  - `max-h-30` is measured border-box, so it shows about 4.3 lines rather than five. The mockup draws five content lines.

## Deviations from Plan

None in scope. The plan was executed as written. Two issues were found while self-reviewing the rendered mockup and fixed before the Task 1 commit:
- The bottom-sheet class `.sheet` collided with `main.sheet` and pinned the whole page to the bottom of the viewport. It was renamed to `.bsheet`.
- A note frame overflowed horizontally. It is now set to full width.

The word "abertas" had slipped into two captions and one excerpt. It was replaced so the D-221 grep prints 0.

## Issues Encountered

None.

## User Setup Required

None. The one human step is the D-33 review itself: the user pastes the approval keys into the README frontmatter. The executor never writes them.

## Next Phase Readiness

- Plans 07-01 and 07-03 do not consult the gate.
- The first gated task is 07-04 Task 3. It halts on its precondition until `approved: true` is in the README frontmatter.
- A provisional product-owner approval unblocks coding, as in 02-04, 04-02, 05-02 and 06-02.

---
*Phase: 07-notifications-web-push-chat*
*Completed: 2026-09-30*

## Self-Check: PASSED
