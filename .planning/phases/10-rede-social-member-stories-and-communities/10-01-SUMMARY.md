---
phase: 10-rede-social-member-stories-and-communities
plan: 01
subsystem: ui
tags: [member-stories-communities, design-gate, UI-04, D-33, D-365, D-417, sketch-020]

requires:
  - phase: 10-rede-social-member-stories-and-communities
    provides: 10-UI-SPEC.md (UI-D-697..UI-D-720, OQ-1..OQ-7 accepted 2026-11-11) as the contract drawn here
provides:
  - "Sketch 020: one self-contained review mockup with 55 data-frame sections for every prototype-less Phase 10 surface"
affects: [10-02 (README, manifest row, Igor's approval), 10-11, 10-12, 10-13, 10-14, 10-15 (web plans wait on the approval)]

actuals:
  tokens: 34500
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Sketch skeleton: tokens.css values inline, light/dark toggle, three tenant brands (hsl, not tokens), 390/320 width switch, TOC of anchors, section[data-frame] with a visible caption equal to its name"

key-files:
  created:
    - .planning/sketches/020-phase-10-designed-screens/index.html
  modified: []

key-decisions:
  - "OQ-1..OQ-7 drawn as the UI-SPEC defaults: OQ-1 community + circle opens the same publish screen with the community pre-selected, OQ-2 card name plain text and header name a link, OQ-3 creator sees Reativar comunidade on a moderator-archived community and removal stays archive then delete, OQ-5 range 0 to 20 default 3, OQ-6 notice always visible plus one confirm per opening, OQ-7 like and comment drawn on a highlight story"
  - "320px variants are drawn beside the 390px ones inside the same frame (explorar-fila-320, publicar-membro-320, cabecalho-criada-por-320, plataforma-limites-320), as the plan's edge truth asks"

patterns-established:
  - "Brand presets other than the neutral tenant are written as hsl() so the file holds no hex outside the tokens.css values"

requirements-completed: [UI-04]

coverage:
  - id: D1
    description: "Groups 1 to 5 drawn: Explorar row, viewer menus and delete dialogs, member publish screen, destination and highlight sheets, create-community entry states (32 frames)"
    requirement: UI-04
    verification:
      - kind: other
        ref: "task 1 automated verify loop over the 32 names + the visibility notice grep (VERIFY_OK)"
        status: pass
    human_judgment: true
    rationale: "A drawing is only complete when Igor reviews it (plan 10-02 approval, D-33 / D-365); no test can judge visual adequacy"
  - id: D2
    description: "Groups 6 to 10 drawn: Criada por, owner-only control matrix, owner and moderator confirmations with the three moderation-log rows, platform limits sheet, module-off and blocked-creator states (23 frames, 55 in total)"
    requirement: UI-04
    verification:
      - kind: other
        ref: "task 2 automated verify (24 names + exactly 55 distinct data-frame names), self-contained grep, Comunidades por membro and Limites dos membros greps"
        status: pass
    human_judgment: true
    rationale: "Same: the review and the pasted approval are Igor's, in plan 10-02"

duration: 55min
completed: 2026-11-11
status: complete
plan_head_before: 089f03feb7db652d10a55c2e20d2b74740bbdb35
commits: 2
---

# Phase 10 Plan 01: Sketch 020 Drawing Summary

**A single self-contained HTML review mockup, `.planning/sketches/020-phase-10-designed-screens/index.html`, draws all 55 prototype-less Phase 10 frames at the real tokens.css values (light and dark, three tenant brands, 390 and 320 widths) from the UI-SPEC copy, with OQ-1..OQ-7 drawn as the accepted defaults.**

## Performance

- **Duration:** 55 min
- **Tasks:** 2 of 2
- **Files:** 1 created (137 KB of static HTML, no script or stylesheet from the network)

## Accomplishments

- Task 1 (commit `5658ff1c`): groups 1 to 5, 32 frames. The Explorar row in every state (own circle with the 24px "+" badge, own circle with a story, unseen and seen rings, glyph fallback, moderator row with the trailing skeleton and "Recarregar" circles, loading, empty), the viewer menus for author and moderator, both delete dialogs, the member publish screen (before a pick, video off, after a pick, video processing, video too long), the destination row and sheet, the visibility notice, the highlight checklist with its once-per-opening confirm, "Seus stories" empty, and the create-community entry states (control, limit notice, chips, limit screen, form audience line, limit alert).
- Task 2 (commit `9ba8d770`): groups 6 to 10, 23 frames, 55 in total, plus the table of contents at the top. "Criada por" on card and header (member link, "você", plain text), the owner-only control matrix on the community page (creator, other member, admin on a member community, admin on an organization community, owner's empty list, composer destination line), the three archive and delete confirmations and the three moderation-log rows (80-character excerpt on the story row), the platform sheet with "Comunidades por membro" last under `border-t border-divider pt-4`, the reworded title and footer, the range error and the keyboard-open 320 view, and the module-off and blocked-creator states using the shipped not-found screens.
- The four adjacency frames (`explorar-fila-320`, `publicar-membro-320`, `cabecalho-criada-por-320`, `plataforma-limites-320`) hold the 390 and 320 renderings side by side.
- D-704 respected: no story ring on any avatar outside the Explorar circles (the byline avatars, card and every post header are plain).
- Every dialog carries the single-verb confirm label and a specific cancel label ("Excluir story" / "Manter story", "Arquivar" / "Manter comunidade", "Excluir" / "Manter comunidade").

## Task Commits

1. **Task 1: groups 1 to 5** - `5658ff1c` (feat)
2. **Task 2: groups 6 to 10** - `9ba8d770` (feat)

Plan metadata (this SUMMARY) is committed separately. STATE.md and ROADMAP.md were not touched (the orchestrator owns them in this run).

## Verification

- Task 1 verify loop (32 names + notice sentence): pass after Task 1; 32 distinct names.
- Task 2 verify (24 names, exactly 55 distinct `data-frame` names): pass. `grep -o 'data-frame="[^"]*"' ... | sort -u | wc -l` prints 55, and the total number of `data-frame=` attributes is also 55 (the table of contents uses anchors only).
- Self-contained: `grep -E "<script src|<link [^>]*href=\"http"` finds nothing; no `http(s)://` string in the file.
- `Comunidades por membro` and `Limites dos membros` present.
- Hex scan: every hex in the file is a `tokens.css` value (checked `#16a34a`, `#2563eb`, `#d97706`, `#ef4444` against the file); the two extra tenant brands are `hsl()`.
- Headless render (Playwright, Chromium): the page loads with no console or page error, the 55 sections exist, every caption equals its `data-frame` name, and the theme, brand and width toggles work. Frames were inspected visually in light and dark.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Layout defects found after the Task 1 commit were fixed inside the Task 2 commit**
- **Found during:** Task 2 visual check
- **Issue:** the square "Criar comunidade" button of `comunidades-chips-membro` (a group 5 frame) squeezed its text, and a shared CSS rule for the highlight row let it collapse in a flex column
- **Fix:** proper 44px square button with `aria-label`, `flex: none` on the highlight row, higher contrast on the "Arquivada" pill ground, taller device frame for the long platform sheet
- **Files modified:** `.planning/sketches/020-phase-10-designed-screens/index.html`
- **Commit:** `9ba8d770`

**2. [Rule 1 - Bug] Tenant brand presets were hex, against the "no hex outside tokens.css" criterion**
- **Fix:** the Verde and Coral presets are `hsl()`; Azul uses the token values
- **Commit:** `9ba8d770`

**Total deviations:** 2 auto-fixed (both Rule 1, both in the one deliverable). **Impact:** none on scope; the 55 names and the copy are as planned.

## Notes for plan 10-02 and the review

- Copy is verbatim from the UI-SPEC Copywriting Contract where it exists. Strings the UI-SPEC does not give, because they belong to shipped screens drawn only as context, are labelled examples: the form's submit text "Criar" and the composer's "Nova publicação", "Escreva algo para a comunidade…", "Adicionar foto", "Adicionar vídeo" (the Início feed context, the moderation page title "Moderação"), the platform sheet numbers (4 photos, 5 MB, 30 s, 50 MB and the ranges), and the demo names (Helena, Marcos, Tânia, Beto, Lia, Rafael, Bruna) and community names ("Horta em casa", "Receitas da vizinhança", "Troca de sementes", "Clube do livro de domingo").
- The two platform-limit frames hold the shipped field labels from `platformModules.social.json` for the other five fields; only "Comunidades por membro", its helper, the title and the footer are new.
- No sketch README, manifest row or `approved` key was written: that is plan 10-02 and the approval is Igor's own.

## Known Stubs

None. The mockup is static by design and nothing in it feeds application code.

## Threat Flags

None. The file is a static review artifact under `.planning/`, with no script or resource from the network and no real member data (T-10-01 mitigated; T-10-02 is enforced by plan 10-02 and the web plans' preconditions).

## Self-Check: PASSED

- FOUND: `.planning/sketches/020-phase-10-designed-screens/index.html` (55 distinct `data-frame` names)
- FOUND commits: `5658ff1c`, `9ba8d770` (`git log --oneline --all --grep="10-01"` returns both)
- `commits: 2` measured with `git rev-list --count 089f03fe..HEAD` before this SUMMARY commit
