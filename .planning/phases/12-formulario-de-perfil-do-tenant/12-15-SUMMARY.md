---
phase: 12-formulario-de-perfil-do-tenant
plan: 15
subsystem: web
tags: [profile-form, web, builder, settings-row, list, reorder, archived, reactivate, impact, D-582, D-585, D-588, D-589, D-596, UI-D-564, UI-D-565, UI-D-566, UI-D-567, UI-D-568, UI-D-576, UI-D-578, T-12-33, T-12-34, tracer]

requires:
  - phase: 12-formulario-de-perfil-do-tenant
    provides: "plan 01 the approved sketch gate, plan 08 GET/POST /questions, PATCH, PUT /order behind profile_form.manage, plan 09 GET /archived, POST /questions/{id}/reactivate, GET /summary, GET /impact, plan 11 iconFor('clipboard-list') and the proxy plumbing, plan 14 the web conventions (loaders that never throw, streamed page tests)"
provides:
  - "The Formulario de perfil row in Configuracoes (flag canManageProfileForm, permission profile_form.manage), between Regras da comunidade and Moderacao, absent from the DOM without the permission"
  - "Route /configuracoes/formulario-de-perfil: notFound() without the permission or when a read says 403/404, the Regras frame, the underline tabs Perguntas and Arquivadas as href items, a loading skeleton per tab"
  - "FormSummaryCard (shipped ProgressRing 64, three title cases) and QuestionList (rows with type badge, required state, answer count, lock, limit line)"
  - "Reorder mode: Subir and Descer buttons, one write of the whole ordered id list per move, focus kept, aria-live announcement, revert and toast on failure"
  - "ArchivedList with Reativar, readImpactAction before any reopening write, ImpactDialog (kind add, make, reactivate, replace) that plan 16 reuses"
  - "admin-reads: loadAdminForm and loadArchived (ok, forbidden, moduleOff, error; never throw)"
  - "Catalog profileForm.admin.json (admin and types branches) and app.settings.rows.profileForm"
affects: [12-16, 12-17, 12-18, profile-form]

actuals:
  tokens: 36500
  tasks: 3
  commits: 3
plan_head_before: 15355692ad9572940dd1f021682fc7a5627b8555

tech-stack:
  added: []
  patterns:
    - "A builder loader reads on the server once per request and returns a status (ok, forbidden, moduleOff, error); the page turns forbidden and moduleOff into notFound() outside any try/catch"
    - "A reopening write is preceded by a server-action impact read; ok:false means the screen writes nothing (T-12-34)"
    - "Reorder keeps focus by re-applying it in a layout effect after React moves the row; at an edge the sibling button takes the focus; the pressed buttons are aria-busy instead of disabled while a write runs"
    - "A client list resets its optimistic copy during render when the server list prop changes identity, so a refresh wins"

key-files:
  created:
    - "apps/web/app/(app)/configuracoes/page.test.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/page.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/page.test.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/loading.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/actions.ts"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/actions.test.ts"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/ProfileFormTabs.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/tabs.ts"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/tabs.test.ts"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/FormSummaryCard.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/QuestionList.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/ArchivedList.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/ImpactDialog.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/builder.test.tsx"
    - apps/web/lib/profile-form/admin-reads.ts
    - apps/web/lib/profile-form/admin-reads.test.ts
    - apps/web/lib/profile-form/type-key.ts
    - apps/web/lib/profile-form/type-key.test.ts
    - apps/web/messages/pt-BR/profileForm.admin.json
  modified:
    - "apps/web/app/(app)/configuracoes/page.tsx"
    - apps/web/messages/pt-BR/app.json
    - apps/web/lib/profile-form/test-fixtures.ts
    - apps/web/i18n/profile-form-messages.test.ts

key-decisions:
  - "The permission is the literal 'profile_form.manage' in both pages, not an import of PROFILE_FORM_PERMISSIONS: apps/web does not depend on @rede-social/module-profile-form and adding the dependency would touch package.json and the lockfile. A test reads the module's contracts file and pins the literal to the published value"
  - "loadAdminForm reads the archived list only when no question is active (it decides between the empty state and 'only archived', which keeps the summary card); loadArchived also reads the active list for its count and limit, so Reativar refuses at the limit with no request"
  - "'Ainda nao ha membros' wins over 'Nenhuma pergunta obrigatoria' in the summary card when both are true: with no member the percentage means nothing"
  - "readImpactAction returns a code (forbidden, moduleOff, failed) beyond the plan's bare ok:false, so a lost permission or a module turned off ends in the not-found refresh instead of an 'impact failed' toast; the caller still writes nothing in every ok:false case"
  - "Leaving reorder mode ('Concluir') refreshes the page; single moves do not, because a refresh in flight could overwrite the optimistic order of the next move with a stale list"
  - "Reorder buttons are aria-busy and ignore presses during a write instead of becoming disabled, so the focused control does not lose focus; at an edge the sibling button takes the focus"
  - "The type names (profileForm.types, 13 types with hints) were added now, as the badges need them; plan 16 reuses them and must not redeclare the branch"

patterns-established:
  - "The Arquivadas date is the tenant's calendar day (Intl.DateTimeFormat pt-BR with the tenant time zone): 02:30 UTC on the 21st reads 20/10 in Sao Paulo"
  - "ImpactDialog(kind) is the one confirmation in front of every reopening write; the screen reads the impact, opens it only above zero, and writes only after a successful read"

requirements-completed: [PFORM-03]

coverage:
  - id: D1
    description: "The Formulario de perfil row exists only with the composed permission profile_form.manage (absent from the DOM, not disabled, for a support user and a member), sits between Regras da comunidade and Moderacao, and opens the Administracao group on its own"
    requirement: PFORM-02
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/page.test.tsx"
        status: pass
    human_judgment: false
  - id: D2
    description: "The builder route answers notFound() without the permission and when a read says 403 or 404, renders the frame and both tabs, and reads an unknown or repeated ?aba= as Perguntas"
    requirement: PFORM-02
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/page.test.tsx#the gate (T-12-33, UI-D-564)"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/tabs.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "The summary card shows the ring and '{done} de {total} membros completos' with its pending line, and the two degenerate titles; the rows show type badge, required state, answer count, the 'No perfil' pill only when public and the lock only with answers; the limit line appears at 30 and not at 29; the empty, only-archived and read-failed states"
    requirement: PFORM-23
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/page.test.tsx#the summary card, #the question rows, #the states"
        status: pass
      - kind: unit
        ref: "apps/web/lib/profile-form/admin-reads.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Reorder mode: rows stop opening the editor, Subir and Descer are disabled at the edges and for a list of one, each press sends ALL active ids in one write, focus stays on the pressed control (sibling at an edge), the live-region sentence is announced, a failed write puts the row back with the toast, module off and lost permission refresh into not-found"
    requirement: PFORM-03
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/builder.test.tsx#reorder mode"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/actions.test.ts#reorderQuestionsAction"
        status: pass
    human_judgment: false
  - id: D5
    description: "The Arquivadas tab lists archived questions with the tenant-zone date, answers kept and state; Reativar of an optional question confirms and writes, of a required one reads the impact first (dialog above zero, direct at zero, NO write when the read fails), and the active limit opens no dialog and writes nothing"
    requirement: PFORM-03
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/builder.test.tsx#ArchivedList"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/actions.test.ts#readImpactAction (T-12-34), #reactivateQuestionAction"
        status: pass
    human_judgment: false
  - id: D6
    description: "The builder catalog is pinned verbatim to the approved Copywriting Contract (page, summary, list, reorder, archived, impact, the 13 type names, the settings row label) with working plurals"
    requirement: PFORM-26
    verification:
      - kind: unit
        ref: "apps/web/i18n/profile-form-messages.test.ts#profileForm.admin.json (12-15)"
        status: pass
      - kind: other
        ref: "bash scripts/check-ui-literals.sh"
        status: pass
    human_judgment: false
  - id: D7
    description: "The builder reads right at 320px and 390px under a tenant brand, a 120-character title with no spaces clamps at three lines, the reorder buttons are comfortable on a phone, and the screens match sketch 016 (frames construtor-* and arquivadas-*)"
    requirement: PFORM-02
    verification: []
    human_judgment: true
    rationale: "Layout, clamping and brand fidelity are the 320px Playwright run and the manual rows of plan 18; no screenshot was taken here (no dev server and no Playwright on this disk). The wrap classes (break-words, line-clamp-3, min-w-0) are asserted, not rendered."

duration: 14min
completed: 2026-10-30
status: complete
---

# Phase 12 Plan 15: The admin's door and the first half of the builder Summary

**The admin finds "Formulario de perfil" in Configuracoes (permission-gated, absent without it), reads the summary and the ordered question list, reorders with buttons that save at once and keep focus, and brings archived questions back from the Arquivadas tab, with the number of members a required question will hold out read before any write and no write at all when that read fails.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-10-30T02:14:42Z
- **Completed:** 2026-10-30T02:29:00Z
- **Tasks:** 3 (1 tracer, 2 auto)
- **Files modified:** 23 (19 created, 4 modified, counting the plan's own commits)

## Accomplishments

- Tracer (Task 1): the settings row, the page and its tabs, `loadAdminForm` and the summary card, the question rows, the limit line and the empty, only-archived and read-failed states, all from the API's aggregates. The tracer's `<verify>` was re-run end to end before expansion and passed.
- Task 2: reorder mode. One write per move carrying the whole ordered id list, focus re-applied after the row moves, an `aria-live="polite"` sentence, a revert with the toast on failure, and the module-off and lost-permission paths ending in a refresh into `notFound()`. No drag and no new dependency.
- Task 3: the Arquivadas tab and Reativar. An optional question confirms; a required one reads the impact first and a failed read writes nothing (T-12-34); zero members reactivates directly; the active limit opens no dialog. `ImpactDialog` is the shared confirmation plan 16 will reuse for the other three kinds.
- T-12-33: the row is absent from the DOM without the composed permission, the page answers `notFound()`, and every action goes through the API's guard chain, which is the real control.
- PFORM-23: no screen of this plan fetches or shows an individual answer. A test asserts that only `questions`, `summary` and `archived` are ever read.

## Task Commits

1. **Task 1: [tracer] The settings row and the builder page read the list and the summary** - `24f8bce7` (feat)
2. **Task 2: Reorder mode with one write per move, focus kept and announced** - `0024c49f` (feat)
3. **Task 3: The archived tab, Reativar and the impact confirmation** - `5de93605` (feat)

**Plan metadata:** the docs commit that carries this SUMMARY.

## Files Created/Modified

- `apps/web/app/(app)/configuracoes/page.tsx` - the row, its flag and the group visibility
- `apps/web/app/(app)/configuracoes/formulario-de-perfil/page.tsx`, `loading.tsx`, `tabs.ts`, `ProfileFormTabs.tsx` - the route, its skeleton and the tabs
- `.../FormSummaryCard.tsx`, `QuestionList.tsx` - the card and the list with the reorder mode
- `.../ArchivedList.tsx`, `ImpactDialog.tsx`, `actions.ts` - the archived tab, the confirmation and the three actions
- `apps/web/lib/profile-form/admin-reads.ts`, `type-key.ts` - the loaders and the type-name keys
- `apps/web/messages/pt-BR/profileForm.admin.json`, `app.json` - the catalog
- Tests: one beside each module, `page.test.tsx` for the settings page (it had none), and a `profileForm.admin.json` block in the catalog test

## Decisions Made

See `key-decisions`. In short: the permission literal is pinned by a test instead of imported, the loaders read what the state needs and nothing more, the impact action carries codes so a lost permission still ends in not-found, and reorder keeps focus by design rather than by luck.

## Deviations from Plan

### Plan-sanctioned variations

- **Files the plan does not list:** `apps/web/messages/pt-BR/app.json` (the UI-SPEC key `app.settings.rows.profileForm` for the row label), `apps/web/lib/profile-form/type-key.ts` and `type-key.test.ts` (the 13 type badges need names, and one table keyed by `ProfileFormType` makes a missing name a compile error), and additive builders in `lib/profile-form/test-fixtures.ts`.
- **The `profileForm.types` branch is in this plan's catalog file.** The row badges need the names now. Plan 16 also lists `profileForm.types.*`; it must reuse these keys (the loader rejects two files declaring the same leaf), not redeclare them.
- **The catalog key for the buttons is `profileForm.admin.actions.{reorder,reorderDone}`.** The UI-SPEC lists `admin.reorder` both as the button label and as the branch of the move sentences; a key cannot be both, so the sentences keep `admin.reorder.*` and the labels moved under `admin.actions`.
- **`loadArchived` also reads the active list, and `loadAdminForm` also reads the archive when no question is active.** Both reads are what a state needs (the limit check without a request; the empty state versus "only archived").
- **The limit line and the actions row live inside `QuestionList`.** Plan 16 adds "Adicionar pergunta" to that row. The page passes no `onOpen`, as the plan says; the row button has no handler until plan 16.
- **`readImpactAction` returns `{ ok: false, code }`** (the plan names a bare `{ ok: false }`).
- **The `<verify>` of Task 3 names `turbo typecheck --filter=@rede-social/web`;** it ran inside the repo gate at the end (41 of 41 tasks) instead of per task, because it pulls a web build in on a tight disk. `tsc --noEmit` ran clean after every task.

### Auto-fixed Issues

None. Two test mistakes were fixed in my own tests before the first commit of the file (a time-zone expectation and an edge-focus expectation); no production code changed because of them.

---

**Total deviations:** 0 auto-fixed, 7 plan-sanctioned variations
**Impact on plan:** none on scope; no new token, type, route, table, dependency or wire shape.

## Issues Encountered

- Free disk stayed near 4.6 GB; the repo gate triggered one `next build`, and `apps/web/.next/cache` was removed afterwards.
- The shared Biome rule `noJsxLiterals` flagged a template-literal sentence inside JSX; the description string is now built before the markup.

## Known Stubs

| File | Reason |
|------|--------|
| `apps/web/app/(app)/configuracoes/formulario-de-perfil/QuestionList.tsx` | A question row is a button with no click handler until plan 12-16 supplies `onOpen` (the editor sheet); the builder's empty state has no "Adicionar pergunta" action until the same plan. Intentional per the plan; recorded in `.planning/WINDOWS.md`. |

## Threat Flags

None. T-12-33 (the row absent from the DOM without the permission, the page answering `notFound()`, a case each for support and member, and the real control in the API's guard chain) and T-12-34 (the screen never calls `reactivateQuestionAction` after a failed or thrown impact read, asserted with zero calls) are mitigated and each has an automated test. Both flagged prohibitions hold: no individual answer is fetched, shown or logged by the builder, and no reopening write follows a failed impact read.

## User Setup Required

None - no external service configuration required. Nothing was pushed and no hosted project was touched.

## Next Phase Readiness

- Plan 16 (the editor sheet) can pass `onOpen` into `QuestionList` through a client wrapper, add "Adicionar pergunta" to the actions row and to the empty state, and reuse `ImpactDialog` (the `add`, `make` and `replace` titles and confirms are in the catalog; the `replace` body text is plan 16's), the `profileForm.types` names and `typeNameKey`.
- Plan 17 adds the export button to `FormSummaryCard` and the "Ver como o membro vê" action to the actions row.
- Plan 18 should add the 320px rows: a 120-character title with no spaces (three-line clamp), the card's text and the Reativar button at 320px, and the reorder buttons on a phone; sketch frames `construtor-*` and `arquivadas-*` are the visual reference.
- PFORM-02, PFORM-23 and PFORM-26 stay open: later plans of the phase still declare them. PFORM-03 is marked complete.

## Self-Check: PASSED

- Created files exist (the 19 listed above); commits `24f8bce7`, `0024c49f` and `5de93605` exist; `git rev-list --count 15355692..HEAD` is 3 before this commit; no commit message carries a trailer or tool attribution.
- Acceptance re-run: `grep -c "profile_form.manage"` is 3 in the settings page and 2 in the builder page; the settings test asserts the row is absent (no link, no `aria-disabled`) for a `support_tenant`; `grep -c "fetch("` in `QuestionList.tsx` is 0; `aria-live` appears twice in `QuestionList.tsx`; `git diff --stat -- apps/web/package.json` is empty; the reorder test asserts the action receives all three ids; the builder test has the case where `readImpactAction` fails and `reactivateQuestionAction` is called zero times; `ImpactDialog` appears in `ArchivedList.tsx`.
- Plan verification: vitest over the settings page, the builder folder, `lib/profile-form` and the catalog test, 264 passed in 15 files; `bash scripts/check-ui-literals.sh` clean; `tsc --noEmit` clean; Biome clean on the touched folders; `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4`: 41 of 41 tasks successful; `.planning/sketches` untouched; no file was deleted.
- Free space on `/System/Volumes/Data` at the end: 4.6 GB.

---
*Phase: 12-formulario-de-perfil-do-tenant*
*Completed: 2026-10-30*
