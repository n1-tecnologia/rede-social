---
phase: 12-formulario-de-perfil-do-tenant
plan: 17
subsystem: web
tags: [profile-form, web, builder, export, csv-download, preview, accessibility, D-595, UI-D-579, UI-D-580, UI-D-596, T-12-37, T-12-38, tracer]

requires:
  - phase: 12-formulario-de-perfil-do-tenant
    provides: "plan 10 GET /v1/profile_form/export (admin_tenant only, streamed text/csv attachment, no-store, the audit row committed before the first byte), plan 12 ProfileForm with the preview mode and the member question shapes, plan 15 the builder shell (FormSummaryCard, QuestionList, ImpactDialog, the profileForm.admin catalog), plan 16 QuestionBuilder, the editor sheet and ArchiveDialog"
provides:
  - "GET /api/profile-form/export: a BFF relay that checks same origin and a session, forwards once, and passes the API's attachment through UNREAD (no-store, the API's Content-Disposition verbatim, status-only logs)"
  - "startCsvDownload(url): fetch, object URL, temporary anchor named from Content-Disposition, revoke after the click, a typed { ok } | { ok: false, status } result, no storage"
  - "ExportDialog and ExportAction: the 'Exportar respostas (CSV)' button on the summary card (disabled with a helper when no member exists) and the brand confirmation with 'Preparando…', the 6 s success toast, the honest failure toast and the forbidden refresh"
  - "PreviewSheet and previewForm: 'Ver como o membro vê' opens the REAL ProfileForm in preview mode over the live active questions as a first-time member, nothing saved, nothing sent"
  - "The pending, failure, focus and wrap tests for every builder dialog and sheet, the real-host failure cases, the list accessibility checks and 32 dialog strings pinned in the catalog test"
affects: [12-18, profile-form]

actuals:
  tokens: 31000
  tasks: 3
  commits: 4
plan_head_before: 126f5260112ffb327332773123ec545c74b3c6b6

tech-stack:
  added: []
  patterns:
    - "A personal-data relay is a pipe: the response body of the API is handed to the new Response untouched, and a test proves it with a stream that counts pulls (highWaterMark 0) and spies on text(), json() and arrayBuffer()"
    - "A fetch-then-object-URL download makes a failure detectable where a plain navigation hides it; the blob lives only until the click"
    - "A preview is the real component fed by a pure builder (previewForm) that copies definitions, nulls the answers and strips every admin-side count"
    - "A dialog test suite loops over a case table (name, title, confirm, cancel, node) so each dialog gets the same pending, failure, focus and wrap tests"

key-files:
  created:
    - "apps/web/app/api/profile-form/export/route.ts"
    - "apps/web/app/api/profile-form/export/route.test.ts"
    - "apps/web/lib/profile-form/download.ts"
    - "apps/web/lib/profile-form/download.test.ts"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/ExportDialog.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/PreviewSheet.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/dialogs.test.tsx"
  modified:
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/FormSummaryCard.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/QuestionBuilder.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/QuestionList.tsx"
    - "apps/web/app/(app)/configuracoes/formulario-de-perfil/builder.test.tsx"
    - "apps/web/messages/pt-BR/profileForm.admin.json"
    - "apps/web/i18n/profile-form-messages.test.ts"
    - "apps/web/lib/route-handlers.inventory.ts"

key-decisions:
  - "The preview sheet is hosted by QuestionBuilder (which already owns the list and the editor sheet) and the button lives in QuestionList's actions row through an optional onPreview prop; page.tsx needed no change"
  - "The export button sits UNDER the summary text on a phone and moves to the right edge from md (UI-SPEC UI-D-566); the card became a column on mobile and a row from md, with the ring and text in an inner row"
  - "The preview sheet uses dismiss='handle' without a handle label, so the screen reader meets exactly one 'Fechar' (the form's) while Escape and the backdrop still close it at once; a preview holds no work, so there is no dirty guard"
  - "previewForm strips even the option answerCount, so no admin-side aggregate reaches the member screen"
  - "The success toast lasts 6000 ms through the toast's durationMs; the pending label 'Preparando…' is swapped into the confirm button by the dialog because ConfirmDialog only spins"

patterns-established:
  - "The web route-handler inventory (TENANT-05) must list every new route.ts with the API route it proxies"

requirements-completed: [PFORM-21, PFORM-23]

coverage:
  - id: D1
    description: "The export relay: same origin and session first, one forward, the attachment passed through unread with the CSV headers, the API's Content-Disposition and no-store; a 403 from the API stays 403 with an empty body, a 404 stays 404, a 5xx or a throw is 502, and nothing is logged on success"
    requirement: PFORM-21
    verification:
      - kind: unit
        ref: "apps/web/app/api/profile-form/export/route.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "The client download: fetch of the handler, an object URL on a temporary anchor named from Content-Disposition (fallback respostas-perfil.csv, only a plain .csv base name accepted), revoked after the click; a 403, a 502 and a network error return { ok: false } and save nothing; no storage API is touched"
    requirement: PFORM-21
    verification:
      - kind: unit
        ref: "apps/web/lib/profile-form/download.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "The export dialog and button: the exact title and body ('fica registrado'), the pending label and lock, the 6 s success toast, the honest failure toast with a closed dialog, the forbidden toast plus a refresh, the button disabled with its helper when the member total is 0"
    requirement: PFORM-21
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/dialogs.test.tsx#ExportDialog: the button on the summary card, #ExportDialog: the confirmation, #ExportDialog pending, failure and focus"
        status: pass
    human_judgment: false
  - id: D4
    description: "'Ver como o membro vê': the ghost button (disabled with no active question), the sheet 'Como o membro vê' with the real form in preview mode, every active question in the admin's order with the required markers and the public notice, no Salvar and no Sair, nothing pre-filled or flagged, no member answer or admin count, and zero fetch and zero server action after touching all 13 control kinds"
    requirement: PFORM-23
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/builder.test.tsx#Ver como o membro vê: the real form in a preview sheet, #previewForm"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every builder dialog under load, failure and keyboard use: the four impact kinds, archive, delete, export and discard each have pending, failure, focus and wrap tests; the real hosts show a failed write closing the confirmation, toasting and keeping the draft; the sheets trap focus and restore it to the opener, the editor obeys the dirty guard and the preview closes at once"
    requirement: PFORM-26
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/dialogs.test.tsx#the confirm dialogs: pending, failure and focus, #the real hosts, #the discard dialog, #the sheets"
        status: pass
    human_judgment: false
  - id: D6
    description: "The list accessibility floor: reorder names include the title, the live region is polite, the 44px classes, no raw-HTML injection in the builder folder or the relay, and 32 dialog strings of UI-D-576..UI-D-579 pinned verbatim in the catalog test"
    requirement: PFORM-26
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/formulario-de-perfil/dialogs.test.tsx#the list: names, live region, 44px targets and no raw HTML"
        status: pass
      - kind: unit
        ref: "apps/web/i18n/profile-form-messages.test.ts#profileForm.admin.export, #profileForm.admin.preview, #the builder dialog strings of UI-D-576..UI-D-579"
        status: pass
      - kind: other
        ref: "bash scripts/check-ui-literals.sh"
        status: pass
    human_judgment: false
  - id: D7
    description: "The export dialog, the summary card with its button, the preview sheet and a 120-character title inside a dialog read right at 320px and 390px under a tenant brand, and the downloaded CSV opens correctly in a spreadsheet on a real device"
    requirement: PFORM-26
    verification: []
    human_judgment: true
    rationale: "Layout, wrapping and brand fidelity are the 320px Playwright run and the manual rows of plan 18; no screenshot was taken here (no dev server and no Playwright on this disk), and the browser download itself (object URL, anchor click) is only simulated under happy-dom. The wrap classes (break-words, max-w-full) are asserted by construction, not rendered."

duration: 11min
completed: 2026-10-30
status: complete
---

# Phase 12 Plan 17: Export and preview Summary

**An admin confirms one dialog that says personal data leaves and that the export is logged, the web tier relays the API's CSV attachment without ever reading it, the browser saves it and a failure is told honestly; the same builder previews the real member form with nothing saved, and every dialog and sheet of the builder is tested for pending, failure, focus and wrapping.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-10-30T02:54:21Z
- **Completed:** 2026-10-30T03:05:18Z
- **Tasks:** 3 (1 tracer, 2 auto) plus 1 inventory fix
- **Files modified:** 14 (7 created, 7 modified)

## Accomplishments

- Tracer (Task 1): the summary card's "Exportar respostas (CSV)" opens the confirmation, the BFF relays the logged attachment untouched (`no-store`, the API's `Content-Disposition`), the browser saves `respostas-perfil-AAAA-MM-DD.csv`, and a 403, a relay failure or a network error is reported with the documented toast. The tracer's `<verify>` was re-run end to end before expansion and passed.
- Task 2: "Ver como o membro vê" opens the real `ProfileForm` in preview mode over the live active questions as a first-time member (answers null, nothing flagged, no admin counts), with the banner, "Fechar" and neither "Salvar" nor "Sair". After touching all 13 control kinds, no `fetch` and no server action ran.
- Task 3: a table-driven suite gives the four impact kinds, archive, delete, export and discard the same pending, failure, focus and wrap tests; the real hosts prove a failed write closes the confirmation, toasts and keeps the draft; the sheets trap focus and restore it; the list names, live region, 44px classes and a raw-HTML source scan are asserted; 32 dialog strings are pinned. No production defect was exposed.
- T-12-37: the relay never calls `.text()`, `.json()` or `.arrayBuffer()` on the API body (a `highWaterMark: 0` spy stream proves nobody pulls before the consumer), logs a status only on failure and nothing on success, and the client keeps the blob only until the click.
- T-12-38: the relay only forwards the session; the API's guard chain refuses everyone but `admin_tenant`, and the relay test asserts a 403 from the API is returned as 403 with an empty body.

## Task Commits

1. **Task 1: [tracer] Confirm, relay and save the CSV, and report a failure** - `6599a4e9` (feat)
2. **Task 2: "Ver como o membro vê": the real form in a preview sheet** - `fe450368` (feat)
3. **Task 3: The dialog states and the accessibility floor across the builder** - `4446c718` (test)
4. **Fix: classify the export relay in the web route-handler inventory** - `f9973f38` (fix)

**Plan metadata:** the docs commit that carries this SUMMARY.

## Files Created/Modified

- `apps/web/app/api/profile-form/export/route.ts` - the BFF relay (same origin, session, one forward, body untouched)
- `apps/web/lib/profile-form/download.ts` - `startCsvDownload` and `filenameFromDisposition`
- `.../formulario-de-perfil/ExportDialog.tsx` - `ExportDialog` (ConfirmDialog, brand, `FileDown`) and `ExportAction` (the button and its helper)
- `.../PreviewSheet.tsx` - `PreviewSheet` and the pure `previewForm`
- `.../FormSummaryCard.tsx`, `QuestionList.tsx`, `QuestionBuilder.tsx` - the export action in the card, the preview button in the actions row, the preview sheet in the host
- `apps/web/messages/pt-BR/profileForm.admin.json` - `admin.export.*` and `admin.preview.*`
- `apps/web/lib/route-handlers.inventory.ts` - the new handler classified
- Tests: one beside the relay and the download, `dialogs.test.tsx` (new), `builder.test.tsx` and `profile-form-messages.test.ts` extended

## Decisions Made

See `key-decisions`. In short: the host component mounts the preview, the export button stacks under the text on a phone, the preview closes through the form's single "Fechar", and the preview strips every admin-side count.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The web route-handler inventory did not list the new route**
- **Found during:** the repo gate after Task 3 (`@rede-social/web#test`: `lib/route-handlers.inventory.test.ts`, "every route.ts on disk is classified")
- **Issue:** the TENANT-05 gate fails any `route.ts` with no entry in `ROUTE_HANDLER_INVENTORY`; the plan's file list did not include the inventory.
- **Fix:** added `'api/profile-form/export/route.ts': { proxies: 'GET /v1/profile_form/export' }` (the API isolation inventory already classifies that route). A narrow adjustment of a pin for a legitimate new file.
- **Files modified:** `apps/web/lib/route-handlers.inventory.ts`
- **Verification:** the inventory test passes (4 of 4) and the full web suite passes (298 files, 6666 tests).
- **Committed in:** `f9973f38`

### Plan-sanctioned variations

- **`page.tsx` is unchanged.** The plan lists it, but the export button lives inside `FormSummaryCard` (rendered by the page already) and the preview button in `QuestionList`'s actions row, mounted by `QuestionBuilder`, so nothing in the page needed wiring.
- **The preview sheet is mounted in `QuestionBuilder`**, as 12-16's note suggested, and the button reaches `QuestionList` through an optional `onPreview` prop (absent: no button). The empty state shows no actions row, so no preview button either (sketch frame `construtor-vazio`); "disabled with no active question" is asserted on a `QuestionList` rendered with an empty list.
- **Layout of the summary card.** The card is a column on a phone (the button under the text) and a row from `md` with the button on the right edge, as UI-D-566 says; the ring and text moved into an inner row.
- **The 44px target of the small export button** uses the shipped `hitArea` prop (a transparent 44px area, the 36px look unchanged).
- **`<verify>` of Task 3** names `turbo typecheck --filter=@rede-social/web`; it ran inside the repo gate (typecheck passed in all packages) instead of per task, because it pulls a web build in on a tight disk. `tsc --noEmit` ran clean after every task.
- **The "failure" test of the standalone confirm dialogs** exercises the dialog's contract (it closes when the host's action settles with a failure and nothing else changes); the documented toasts are proved through the real hosts (sheet add, make and replace; the archived list; archive and delete), so no failure path rests on the table-driven harness alone.
- **New copy beyond the approved contract:** none. `admin.preview.open` and `admin.preview.title` are the contract's "Ver como o membro vê" and "Como o membro vê"; the banner and "Fechar" are reused from `profileForm.member.preview`.

---

**Total deviations:** 1 auto-fixed (1 blocking), 6 plan-sanctioned variations
**Impact on plan:** none on scope; no new token, dependency, route beyond the planned relay, table or wire shape.

## Issues Encountered

- A `ReadableStream` with the default strategy pre-pulls one chunk, so the first version of the pass-through spy saw a pull before any consumer; `highWaterMark: 0` makes the spy honest.
- A `sed` edit failed on the path with parentheses and its `&&` chain skipped the catalog test append; redone with Python, nothing was committed in between.
- Free disk stayed at 3.4 to 3.9 GB; the repo gate triggered a web build and `apps/web/.next/cache` was removed afterwards.

## Known Stubs

None. No stub, placeholder text or unwired data source was added.

## Threat Flags

None. T-12-37 (the export relay caching, logging or parsing the file, or serving it cross-origin) and T-12-38 (a non-admin reaching the relay) are mitigated and each has an automated test. The prohibition holds: the web tier does not read, parse, log, cache or persist the file; no personal datum reaches a URL, a toast, storage or analytics (the dialog test asserts no toast message carries a CSV character; the download test asserts no storage call).

## User Setup Required

None - no external service configuration required. Nothing was pushed and no hosted project was touched.

## Next Phase Readiness

- Plan 18 (proofs and phase close) can use the manual rows below. The web surface of the phase is complete: member form, completion screen, profile blocks, builder, editor, export and preview.
- Rows for plan 18 (visual and device, not provable here): the export dialog and the summary card at 320px and 390px under a tenant brand (button under the text, helper line when there is no member); a real download on a phone and a desktop browser opened in a spreadsheet (BOM, `;` delimiter, accented names); the preview sheet at 320px with all 13 control kinds; a 120-character question title inside the impact and replace dialogs; sketch 016 frames `exportar-dialogo`, `exportar-preparando`, `exportar-sem-membros` and `previa-membro` are the visual reference.
- PFORM-21 and PFORM-23 are marked complete. PFORM-26 stays open: plan 18 still declares it.

## Self-Check: PASSED

- Created files exist (the 7 listed above); commits `6599a4e9`, `fe450368`, `4446c718` and `f9973f38` exist; `git rev-list --count 126f5260..HEAD` is 4 before this commit; no commit message carries a trailer or tool attribution.
- Acceptance re-run: `grep -c "no-store"` on the relay is 3; the pass-through spy test asserts zero pulls and no `.text()`, `.json()` or `.arrayBuffer()` call; `grep -c "localStorage\|sessionStorage\|caches"` on `download.ts` prints 0; the preview test spies `fetch` and every server action mock and asserts zero calls after interacting with all 13 control kinds; `grep -c "Ver como o membro vê"` on the catalog is 1; each of the four impact kinds, the archive and delete variants, export and discard has tests whose titles carry pending, failure and focus; the catalog test pins 32 dialog strings.
- Plan verification: vitest over the builder folder, `app/api/profile-form`, `lib/profile-form`, `components/profile-form`, `app/(auth)/completar-perfil` and the catalog test, 736 passed in 29 files; the full web suite, 6666 passed in 298 files; `bash scripts/check-ui-literals.sh` clean; `tsc --noEmit` clean; Biome clean on the touched files; `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4`: typecheck passed everywhere and the single failure (the route inventory) was fixed and re-run green; `.planning/sketches` untouched; no file was deleted.
- Free space on `/System/Volumes/Data` at the end: 3.8 GB.

---
*Phase: 12-formulario-de-perfil-do-tenant*
*Completed: 2026-10-30*
