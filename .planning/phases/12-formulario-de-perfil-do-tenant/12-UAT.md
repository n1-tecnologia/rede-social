---
status: testing
phase: 12-formulario-de-perfil-do-tenant
source: [12-VERIFICATION.md]
started: 2026-10-30T09:40:00Z
updated: 2026-10-30T09:40:00Z
---

## Current Test

number: 1
name: M1: the member path on a real phone (deep link to completion screen to the same post; Minhas respostas with 'Visível no seu perfil' and 'Editar'; the 'Há perguntas novas' notice and 'Agora não' surviving a reopen)
expected: |
  Each step works as described in 12-MANUAL-PROOFS.md M1
awaiting: user response

## Tests

### 1. M1: the member path on a real phone (deep link to completion screen to the same post; Minhas respostas with 'Visível no seu perfil' and 'Editar'; the 'Há perguntas novas' notice and 'Agora não' surviving a reopen)
expected: Each step works as described in 12-MANUAL-PROOFS.md M1
note: Phones cannot reach *.localhost; needs the homolog deploy and a phone (default blocked until then).
result: [pending]

### 2. M2: run migrateAll on one hosted tenant project and re-run it (four versions 20261029230924, 20261029232606, 20261029233037, 20261029234918)
expected: Exit 0, project current, smoke SQL answers, second run applies nothing
note: The local second database is proved (migrate-all 18 passed); a hosted project is the owner's.
result: [pending]

### 3. M3: open the exported CSV in a pt-BR Excel and import it in Google Sheets
expected: Columns split on ';', accents read right (BOM), a decimal number keeps its comma
note: The bytes (EF BB BF, ';', CRLF, comma decimals) are pinned by tests; what real spreadsheet programs do with them is not.
result: [pending]

### 4. M4: export a tenant with thousands of members through the hosted Cloud Run API
expected: A complete file larger than 32 MiB if the tenant is large enough; the last row is a member and the file ends with a line break
note: Assumption A2 (no body cap on a streamed response) cannot be tested locally.
result: [pending]

### 5. M5: confirm the export row set (one row per active and blocked member; invited, staff and deleted left out)
expected: Igor says keep, or asks for a filter
note: Planner decision A-12-02 awaiting the owner.
result: [pending]

### 6. M6: read the Moderação copy for the export (row 'exportou as respostas do formulário de perfil', chip 'Exportações', download icon)
expected: Keep, or the wording wanted
note: Copy outside the approved design (A-12-MOD, the one exemption of PFORM-26).
result: [pending]

### 7. M7: follow the production release order of docs/DEPLOY.md 'Phase 12 release (tenant profile form)'
expected: Migrations on every project, then API and worker together, then web, then the module switched on per tenant; the old _gated pair is not dropped
note: Nothing was pushed or deployed; a release procedure is proved only by being followed.
result: [pending]

### 8. M8: run the three Playwright specs (profile-form-gate, profile-form-member, profile-form-admin; 20 tests) with more than 10 GiB free
expected: 20 passed on mobile-chromium, and each afterAll finds the module row and the run-prefixed rows put back
note: Written, type-checked, linted and listed, never executed (disk 3.9 GiB on 2026-10-30, Igor's decision). A first failure may be the spec as much as the product.
result: [pending]

### 9. M9: read the pt-BR copy that was not in the approved design (editor notes for short and long text, 'Informe um número.', the archive and delete failure toasts, 'Fechar')
expected: Keep per item, or the wording wanted
note: Copy written by the planner and executor, not by the design team.
result: [pending]

### 10. Visual fidelity of every Phase 12 screen against sketch 016 at 320 and 390 px, with the tenant brand colours, on a real device (mask, autofill and date picker behaviour of the phone, date and number controls)
expected: Matches the approved sketch; no overflow; native pickers behave
note: Visual and device behaviour cannot be checked by grep or jsdom.
result: [pending]

### 11. Confirm sketch 016 (the design gate) in your own hand
expected: Igor pastes or confirms approved: true; Igor's answers to the README design questions (a) to (f) are recorded or waived
note: The approval in .planning/sketches/016-phase-12-designed-screens/README.md was recorded by the orchestrator on Igor's chat instruction (approval_kind: provisional); PFORM-26 / UI-04 ask for the approval pasted by the user. Design questions (a) to (f) were never answered.
result: [pending]

## Summary

total: 11
passed: 0
issues: 0
pending: 11
skipped: 0
blocked: 0

## Gaps
