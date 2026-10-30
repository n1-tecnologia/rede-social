---
phase: 12-formulario-de-perfil-do-tenant
plan: 16
subsystem: web
tags: [profile-form, web, builder, editor-sheet, type-picker, options, locks, replace, archive, delete, D-585, D-587, D-588, D-590, D-592, D-593, D-594, UI-D-569, UI-D-570, UI-D-571, UI-D-572, UI-D-573, UI-D-574, UI-D-575, UI-D-576, UI-D-577, T-12-35, T-12-36, tracer]

requires:
  - phase: 12-formulario-de-perfil-do-tenant
    provides: "plan 03 the contract schemas and limits, plan 08 POST/PATCH /questions and the five D-587 locks (checkLocks), plan 09 archive, delete, replace, summary and impact, plan 13 the pt-BR number parser, plan 15 the builder shell, ImpactDialog, readImpactAction and the profileForm.types catalog"
provides:
  - "QuestionEditorSheet: ONE BottomSheet with create, edit and replace modes (LGPD notice first, type picker, title and help text with counters, options or limits block, the two switches, Salvar pergunta, dirty guard, unclosable while saving, in-sheet 409 alert)"
  - "TypePicker: the 13-tile radiogroup (one QUESTION_TYPE_META table), the collapsed 'Tipo: {name}' row with 'Trocar tipo', the read-only locked row"
  - "OptionsEditor and LimitsFields: stable option ids, the four inline sentences, the Outro switch, number and date pairs, one-line notes for the other types"
  - "Every D-587 lock and the PU-1 ratchet as an explained UI state; replace re-opens the sheet with the old data copied and saves through one atomic action"
  - "Impact read before every reopening write (add, make required, replace); a failed read writes nothing; the toast reports the server's pending count"
  - "ArchiveDialog (archive and delete) and the server actions create, update, replace, archive and delete with typed results"
  - "QuestionBuilder (the host of list, empty state and sheet), 'Adicionar pergunta' in the actions row and as the empty state's call to action"
affects: [12-17, 12-18, profile-form]

actuals:
  tokens: 55000
  tasks: 3
  commits: 3
plan_head_before: 14572cb9d799f79ec026f6842cfeb4f51f0de929

tech-stack:
  added: []
  patterns:
    - "A client UI mirror of a server rule is a PORT with a parity table: checkDraftLocks copies checkLocks and editor-state.test.ts feeds it the cases of profile-form-lock-rules.test.ts"
    - "A sheet that must not close mid-save keeps a stable requestClose that reads the latest flags from a ref (the focus trap re-arms when onClose changes)"
    - "A host keys the sheet per opening so each opening starts from its source; the opening is kept after a close for the exit animation"
    - "A write that reopens a form asks the server for the figure it reports (GET /summary after the write), never the preview's"

key-files:
  created:
    - "apps/web/lib/profile-form/question-types.ts"
    - "apps/web/lib/profile-form/question-types.test.ts"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/QuestionEditorSheet.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/QuestionEditorSheet.test.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/QuestionBuilder.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/TypePicker.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/OptionsEditor.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/LimitsFields.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/VisibilitySwitches.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/ArchiveDialog.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/editor-state.ts"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/editor-state.test.ts"
  modified:
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/actions.ts"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/actions.test.ts"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/ImpactDialog.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/QuestionList.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/page.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/page.test.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/builder.test.tsx"
    - "apps/web/messages/pt-BR/profileForm.admin.json"
    - "apps/web/i18n/profile-form-messages.test.ts"
    - ".planning/WINDOWS.md"

key-decisions:
  - "The Outro lock is conservative: the admin read carries no 'an Outro answer exists' fact, so a question that has answers and allows Outro shows the switch locked on. The server (other_locked) would allow turning it off when no Outro answer exists; the UI never offers what the server might refuse (T-12-36). Exposing an otherAnswerCount on the admin read would remove the over-lock"
  - "The success toast of a reopening write reads the SERVER's figure after the write from GET /summary (total minus complete) inside the write action; a failed read just omits the count, the write stands"
  - "A new host component QuestionBuilder owns the sheet state so the list's rows, 'Adicionar pergunta' (actions row) and the empty state's CTA open the same sheet; QuestionList stays a presentational list with onOpen and onAdd props"
  - "The sheet uses dismiss='handle' (a tap on the handle, backdrop, Escape) instead of drag-to-dismiss, so a swipe on a long form scrolls and a guarded close can never leave the panel dragged off position"
  - "An edit that changes nothing sends no request and closes the sheet; the update body carries the revision and only the changed keys, and an option row keeps its server id"
  - "A 400 that the route lifted to details.profileForm has lost its path, so only title issues (required, too_long) are placed under the title; any other code falls back to the 'saved nothing, draft kept' toast. The contract schemas run in the server action first, so a malformed body is placed per field without a request"

patterns-established:
  - "The editor's draft is pure (editor-state.ts): blankDraft, draftFromQuestion, replaceDraftFrom, changeType, toCreateBody, toUpdateBody, isDirty, validateDraft, lockFlags, reopeningOf and the option-row moves are testable without React"

requirements-completed: [PFORM-02, PFORM-06, PFORM-17, PFORM-22]

coverage:
  - id: D1
    description: "'Adicionar pergunta' (brand button, disabled at the active limit) joins the actions row and is the empty state's call to action; a row opens the sheet in edit mode with the question's data and revision"
    requirement: PFORM-02
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/builder.test.tsx#QuestionBuilder"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/page.test.tsx#the actions row (12-16, UI-D-565)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The create sheet: nothing below the 13-tile grid until a tile is chosen, the collapse into 'Tipo: {name}' with 'Trocar tipo', counters, 'Salvar pergunta' disabled until a type and a title exist, the contract body, the invalid / failed / limit / forbidden paths, the dirty guard and no close while saving"
    requirement: PFORM-02
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/QuestionEditorSheet.test.tsx#the type picker, #the fields and their counters, #saving, #the dirty guard"
        status: pass
      - kind: unit
        ref: "apps/web/lib/profile-form/question-types.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "The LGPD warning is the first element of the create and replace sheets, is never dismissible, names the tenant, and no purpose field exists; no title or type is blocked"
    requirement: PFORM-22
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/QuestionEditorSheet.test.tsx#the LGPD warning (D-594, UI-D-573, PFORM-22)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Choice options: two empty rows to start, 44px icon buttons named by position, add moves focus into the new row, reorder keeps focus, remove disabled at two, add disabled at 20, the four inline sentences, Outro, stable ids (stored rows send an id, new rows none)"
    requirement: PFORM-06
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/QuestionEditorSheet.test.tsx#the options editor (D-592, UI-D-571, UI-D-572)"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/editor-state.test.ts#validateOptions, #the option rows as pure moves"
        status: pass
    human_judgment: false
  - id: D5
    description: "Number and date limits with the pt-BR parse and the min-above-max sentences; the one-line notes for the other types and no mask, placeholder or cap field"
    requirement: PFORM-06
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/QuestionEditorSheet.test.tsx#the number and date limits and the type notes (UI-D-572)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A reopening save (new required, optional turned required, required replacement) reads the impact first: a failed read writes nothing, zero members writes directly, above zero only the dialog's confirm writes, an optional save never reads it, and the toast reports the server's pending count"
    requirement: PFORM-17
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/QuestionEditorSheet.test.tsx#the impact before a reopening save (D-585, UI-D-576, T-12-34)"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/actions.test.ts#createQuestionAction, #updateQuestionAction"
        status: pass
    human_judgment: false
  - id: D7
    description: "Every D-587 lock and the PU-1 ratchet is a UI state with its reason and way out (read-only type row, locked options with counts and working reorder, Outro locked on, widen-only limits refused before any request, frozen private switch, public hint), mirrored from checkLocks through a parity table, and a race comes back as the in-sheet 409 alert"
    requirement: PFORM-17
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/editor-state.test.ts#checkDraftLocks mirrors checkLocks, #lockFlags"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/QuestionEditorSheet.test.tsx#a question WITH answers, #the 409 of the truth"
        status: pass
    human_judgment: false
  - id: D8
    description: "Replace re-opens the sheet in replace mode with the old title, help text, required and show-on-profile copied, the grid open, the banner and the LGPD notice, and saves through ONE atomic action call (impact first when required); archive (with answers) and delete (never answered) have their confirmations, the race 'recebeu respostas' toast, and a question with answers never shows 'Excluir pergunta'"
    requirement: PFORM-17
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/QuestionEditorSheet.test.tsx#replace (UI-D-574), #archive and delete (D-588, UI-D-577)"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/actions.test.ts#replaceQuestionAction, #archiveQuestionAction and deleteQuestionAction"
        status: pass
    human_judgment: false
  - id: D9
    description: "The editor catalog is pinned verbatim to the approved Copywriting Contract with working plurals, no literal text in any TSX file, and no raw-HTML injection in the builder"
    requirement: PFORM-26
    verification:
      - kind: unit
        ref: "apps/web/i18n/profile-form-messages.test.ts#profileForm.admin.editor (12-16)"
        status: pass
      - kind: other
        ref: "bash scripts/check-ui-literals.sh"
        status: pass
    human_judgment: false
  - id: D10
    description: "The sheet reads right at 320px and 390px under a tenant brand: a 120-character title and a long help text keep their counters visible and the footer in view, an 80-character option label wraps without clipping its three buttons, and the screens match sketch 016 (editor and confirmation frames)"
    requirement: PFORM-26
    verification: []
    human_judgment: true
    rationale: "Layout, wrapping and brand fidelity are the 320px Playwright run and the manual rows of plan 18; no screenshot was taken here (no dev server and no Playwright on this disk). The wrap classes (min-w-32 flex-1, flex-wrap, break-words, max-[359px]:grid-cols-1) are asserted by construction, not rendered."

duration: 22min
completed: 2026-10-30
status: complete
---

# Phase 12 Plan 16: The question editor Summary

**An admin adds, edits, replaces, archives and deletes profile-form questions of all 13 types in one sheet that teaches the LGPD duty, explains every lock of D-587 and the private-to-public ratchet with a reason and a way out, and reads how many members a reopening save will hold before it writes anything.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-10-30T02:31:28Z
- **Completed:** 2026-10-30T02:53:30Z
- **Tasks:** 3 (1 tracer, 2 auto)
- **Files modified:** 22 (12 created, 10 modified, counting the plan's own commits)

## Accomplishments

- Tracer (Task 1): "Adicionar pergunta" opens the create sheet; the admin picks one of 13 tiles (nothing renders below the grid until then), types a title, saves, and the question appears in the list. The tracer's `<verify>` was re-run end to end before expansion and passed.
- Task 2: choice options with stable ids and "Outro", number and date limits with the pt-BR parser, one-line notes for the other types, and the impact confirmation (T-12-34 holds: a failed read writes nothing, asserted with zero action calls).
- Task 3: edit mode with every D-587 lock (read-only type row, answered options with counts and working reorder, Outro locked on, widen-only limits, frozen private switch, public ratchet line), replace through one atomic action, archive and delete dialogs, and the coded 409 explained inside the sheet.
- T-12-35: the builder renders every admin-typed text as React text; the acceptance grep for raw-HTML injection prints zero in all builder files, and a test renders `<script>` and `<img onerror>` titles as text.
- T-12-36: `lockFlags` and `checkDraftLocks` mirror the server's `checkLocks` through a parity table of the same cases as `profile-form-lock-rules.test.ts`.

## Task Commits

1. **Task 1: [tracer] add a question: the sheet, the 13-tile picker, title, help text, switches and save** - `6c13f3cc` (feat)
2. **Task 2: choice options with Outro, number and date limits, and the impact confirmation** - `8439d9e4` (feat)
3. **Task 3: edit mode with every lock, the privacy ratchet, replace, archive and delete** - `9c87e308` (feat)

**Plan metadata:** the docs commit that carries this SUMMARY.

## Files Created/Modified

- `apps/web/lib/profile-form/question-types.ts` - QUESTION_TYPE_META (order and glyph per type), orderedTypes, typeHintKey, isChoiceType, isRangeType
- `.../formulario-de-perfil/QuestionEditorSheet.tsx` - the create, edit and replace sheet
- `.../QuestionBuilder.tsx` - the host: list or empty state plus the one sheet
- `.../TypePicker.tsx`, `OptionsEditor.tsx`, `LimitsFields.tsx`, `VisibilitySwitches.tsx`, `ArchiveDialog.tsx` - the sheet's parts
- `.../editor-state.ts` - the pure draft, body builders, validation, locks and option moves
- `.../actions.ts` - createQuestionAction, updateQuestionAction, replaceQuestionAction, archiveQuestionAction, deleteQuestionAction
- `.../ImpactDialog.tsx` (optional `note`), `QuestionList.tsx` (`onAdd`), `page.tsx` (hands the list and empty state to the host)
- `apps/web/messages/pt-BR/profileForm.admin.json` - `admin.editor`, `admin.archive`, `admin.delete`, `admin.actions.add`, `admin.impact` extras
- Tests: one beside each module, the page and builder tests extended, a block per task in the catalog test

## Decisions Made

See `key-decisions`. In short: the Outro lock errs on the safe side because the admin read does not say whether an Outro answer exists, the toast count comes from the server after the write, the host component owns the sheet so three entry points open the same one, and the sheet closes through the handle, the backdrop or Escape rather than a drag.

## Deviations from Plan

### Plan-sanctioned variations

- **Files the plan does not list:** `QuestionBuilder.tsx` (the client host; the page is a server component and the empty state needed the same sheet as the list) and the optional `note` prop on `ImpactDialog` (the replace body names the archived question). `.planning/WINDOWS.md` was updated through `gsd-tools windows fixed 144` (the 12-15 stub is closed).
- **Catalog keys:** the branches are `profileForm.admin.editor.*`, `profileForm.admin.archive.*`, `profileForm.admin.delete.*` and `profileForm.admin.impact.{added,pending,replaceBody}`, under 12-15's `admin` root, because that file is pinned to the `admin` and `types` branches; the `types` branch was reused, not redeclared. The spec's `profileForm.editor.*` names map one to one.
- **Notes for Texto curto and Texto longo:** the Copywriting Contract has no copy for them, the plan says they carry a format note. Added "O membro escreve uma linha, com até {max} caracteres." and "O membro escreve um texto, com até {max} caracteres." with the contract's fixed caps (`PROFILE_FORM_LIMITS`). Igor should confirm the wording (not in the approved contract).
- **New copy beyond the contract:** "Informe um número." (a limit text that is not a number), "Não foi possível arquivar agora. Tente de novo." and "Não foi possível excluir agora. Tente de novo." (archive and delete failure toasts; modelled on `archived.failed`), and "Fechar" (the handle's name).
- **Outro lock is conservative** (see key-decisions): the plan says it is "taken from the question's data", but `AdminQuestion` carries no Outro answer count. A question with answers and Outro on shows the switch locked on even when no Outro answer exists.
- **`<verify>` of Task 3** names `turbo typecheck --filter=@rede-social/web`; it ran once inside the repo gate (41 of 41 tasks) instead of per task, as in 12-15, because it pulls a web build in on a tight disk. `tsc --noEmit` ran clean after every task.

### Auto-fixed Issues

None. Four of my own tests failed on their first run (the desktop card has no handle under happy-dom, a default impact mock was missing for a required toggle, the nested `fieldset` is not the disabled one, and the replace note was not yet wired); each was a test or wiring slip before the commit, not a change of behaviour.

---

**Total deviations:** 0 auto-fixed, 6 plan-sanctioned variations
**Impact on plan:** none on scope; no new token, dependency, route, table or wire shape.

## Issues Encountered

- `ConfirmDialog` closes itself after `onConfirm` settles, and `BottomSheet` calls the focus trap's `onClose` on Escape and backdrop: the sheet's `requestClose` is a stable callback that reads the latest dirty and saving flags from a ref, so the dirty guard and the no-close-while-saving rule hold on every path.
- Disk fell from 4.6 GB to 3.4 GB during the repo gate (one `next build`); `apps/web/.next/cache` was removed afterwards.

## Known Stubs

None. The 12-15 stub (the row without `onOpen`, the empty state without "Adicionar pergunta") is closed and its WINDOWS.md entry (144) is marked fixed.

## Threat Flags

None. T-12-35 (stored XSS through a title, help text or option label) is mitigated by React text only, the contract's length caps repeated by the server action's schema parse, and a test that renders markup-looking titles and labels as text; the acceptance grep for raw-HTML injection is zero in every builder file. T-12-36 (the UI offering a locked change as free) is mitigated by `lockFlags` and the mirrored `checkDraftLocks`, with a parity table of the server's own cases, and by the in-sheet 409 alert for a race. The prohibitions hold: no purpose field, no blocking of titles or types, and no stored answer is read or pre-filled anywhere in the builder (the actions fetch definitions, counts, the summary and the impact only).

## User Setup Required

None - no external service configuration required. Nothing was pushed and no hosted project was touched.

## Next Phase Readiness

- Plan 17 adds the export button to `FormSummaryCard` and the "Ver como o membro vê" action to the actions row of `QuestionList`; the host `QuestionBuilder` is the place to mount the preview sheet if it shares state with the list.
- Plan 18 should add the 320px rows: a 120-character title and a long help text in the sheet (footer in view), an 80-character option label wrapping beside its three 44px buttons, the type grid at 320px, and the replace flow end to end; sketch 016 frames `editor-*` and `confirmations` are the visual reference.
- Follow-up for the admin read (outside this plan): an `otherAnswerCount` per question would let the UI lock Outro only when an Outro answer exists.
- PFORM-02, PFORM-06, PFORM-17 and PFORM-22 are marked complete. PFORM-26 stays open: plans 17 and 18 still declare it.

## Self-Check: PASSED

- Created files exist (the 12 listed above); commits `6c13f3cc`, `8439d9e4` and `9c87e308` exist; `git rev-list --count 14572cb9..HEAD` is 3 before this commit; no commit message carries a trailer or tool attribution.
- Acceptance re-run: `question-types.test.ts` asserts `Object.keys(QUESTION_TYPE_META)` equals `PROFILE_FORM_TYPES`; the sheet test asserts the LGPD warning is the first child of the form's fieldset and that no purpose field exists; `grep -c "Adicionar pergunta"` on the catalog is 2; the options test asserts 'Opção 1' and 'Remover opção 2' exist with the 44px classes; the impact test asserts zero write calls when the read fails; the editor-state test table covers the five lock codes with an allowed and a refused case each and cites `profile-form-lock-rules.test.ts`; a sheet test asserts a question with answers never renders 'Excluir pergunta'; `grep -c "dangerouslySetInnerHTML"` prints 0 for every builder TSX file.
- Plan verification: vitest over the builder folder, `lib/profile-form` and the catalog test, 482 passed in 17 files; `bash scripts/check-ui-literals.sh` clean; `tsc --noEmit` clean; Biome clean on the touched folders; `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4`: 41 of 41 tasks successful; `.planning/sketches` untouched; no file was deleted.
- Free space on `/System/Volumes/Data` at the end: 3.4 GB.

---
*Phase: 12-formulario-de-perfil-do-tenant*
*Completed: 2026-10-30*
