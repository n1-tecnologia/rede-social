---
status: partial
phase: 12-formulario-de-perfil-do-tenant
source: [12-VERIFICATION.md]
started: 2026-10-30T09:40:00Z
updated: 2026-11-02T12:00:00Z
---

## Current Test

[testing closed by developer closure on 2026-11-02 — 5 items still blocked (a phone, a hosted project or a deploy); the 7 judgment and local items were signed off by Igor in chat]

## Tests

### 1. M1: the member path on a real phone (deep link to completion screen to the same post; Minhas respostas with 'Visível no seu perfil' and 'Editar'; the 'Há perguntas novas' notice and 'Agora não' surviving a reopen)
expected: Each step works as described in 12-MANUAL-PROOFS.md M1
note: Phones cannot reach *.localhost; needs the homolog deploy and a phone. The same path, on an emulated iPhone 14 viewport against the local stack, passes in the browser run of row 8 (gate tracer, member tests 1 to 5); that is not a phone.
result: blocked
blocked_by: physical-device
reason: a phone needs the homolog deploy; nothing was pushed or deployed

### 2. M2: run migrateAll on one hosted tenant project and re-run it (four versions 20261029230924, 20261029232606, 20261029233037, 20261029234918)
expected: Exit 0, project current, smoke SQL answers, second run applies nothing
note: The local second database is proved (migrate-all 18 passed); a hosted project is the owner's.
result: blocked
blocked_by: server
reason: needs one hosted tenant project and its credentials, which are the owner's

### 3. M3: open the exported CSV in a pt-BR Excel and import it in Google Sheets
expected: Columns split on ';', accents read right (BOM), a decimal number keeps its comma
note: The bytes (EF BB BF, ';', CRLF, comma decimals) are pinned by tests, and the browser run of row 8 downloads the file and checks the first three bytes; what real spreadsheet programs do with them is not proved. Can be done locally: export from the builder and open the file.
result: pass
signed_off: on Igor, in chat on 2026-11-02: "tudo aprovado" (his word; an agent did not see a spreadsheet program open the file, so what Excel and Sheets do with the bytes is accepted, not observed).

### 4. M4: export a tenant with thousands of members through the hosted Cloud Run API
expected: A complete file larger than 32 MiB if the tenant is large enough; the last row is a member and the file ends with a line break
note: Assumption A2 (no body cap on a streamed response) cannot be tested locally.
result: blocked
blocked_by: server
reason: needs the hosted API and a tenant with thousands of members

### 5. M5: confirm the export row set (one row per active and blocked member; invited, staff and deleted left out)
expected: Igor says keep, or asks for a filter
note: Planner decision A-12-02 awaiting the owner.
result: pass
signed_off: on Igor, in chat on 2026-11-02: "tudo aprovado" (keep the row set: one row per active and blocked member; invited, staff and deleted left out; no filter asked).

### 6. M6: read the Moderação copy for the export (row 'exportou as respostas do formulário de perfil', chip 'Exportações', download icon)
expected: Keep, or the wording wanted
note: Copy outside the approved design (A-12-MOD, the one exemption of PFORM-26).
result: pass
signed_off: on Igor, in chat on 2026-11-02: "tudo aprovado" (keep the Moderação wording as written).

### 7. M7: follow the production release order of docs/DEPLOY.md 'Phase 12 release (tenant profile form)'
expected: Migrations on every project, then API and worker together, then web, then the module switched on per tenant; the old _gated pair is not dropped
note: Nothing was pushed or deployed; a release procedure is proved only by being followed.
result: blocked
blocked_by: release-build
reason: the production deploy has not happened (the local master is 112 commits ahead of origin/master)

### 8. M8: run the three Playwright specs (profile-form-gate, profile-form-member, profile-form-admin; 20 tests) with more than 10 GiB free
expected: 20 passed on mobile-chromium, and each afterAll finds the module row and the run-prefixed rows put back
note: |
  Run by an agent (not Igor's hand) on 2026-10-30 after Igor freed disk (16 GiB free, a disk watchdog stopping the run under 3 GiB). Command: `pnpm --filter @rede-social/web exec playwright test profile-form-admin.spec.ts profile-form-gate.spec.ts profile-form-member.spec.ts --project=mobile-chromium` (order admin, gate, member, one worker). Final run: 20 passed in 1.6 min (admin 7, gate 6, member 7, including the 320 px and 390 px backstops of the admin and member specs). After the run the local database held 0 profile_form questions, 0 answers and 0 profile_form module rows, so the afterAll restores held.
  The first run (5 passed, 3 failed, 12 not run) found real problems; they were fixed in separate commits before this pass:
  - product: bordered `sm` buttons with `hitArea` had a 42 px tap target instead of 44 px (shared Button primitive, 18d9f0f8, 16 outline call sites);
  - spec: `#respostas` selector (c1f1780f), two identical replace buttons (b2f924b7), not-found status 200 under loading.tsx (131ff69c), staff block behind the API's 30 s module-flag cache after a SQL module switch (affdd3b7), a title edit past the 120-character limit (44ed96af), and the tracer's deep link cancelled by the open shell's own first-join counters refetch (68b802cc).
  Two caveats: (1) the server-side change of quick 261030-g1y (87f701d9, the deep-link destination kept when a data loader refuses first) is covered by 11 unit tests but the browser never reached that path, so it is not proved in a browser; (2) an open app whose member taps a link in the very moment the gate flips still lands on /inicio, not on the post (no destination travels in an open-app redirect, decision 12-11); not fixed, Igor's call.
  Second pass, 2026-10-31 01:09, AFTER the review fixes (IN-01 to IN-04 and the `parseLink` surrogate: 4c6dcb7a, f7ed3f50, 80abc5a2, 861f90cb, 8e4a5bae): the same command gave 20 passed in 1.6 min and the local database held 0 profile_form rows afterwards. The admin export download still works with the stricter `Sec-Fetch-Site: same-origin` check of IN-02. `payments-admin.spec.ts` (4 tests, mobile-chromium) also passed with its tap-target pin back at 44 px (e48f4e08).
  The ledger row M8 in 12-MANUAL-PROOFS.md is still `pending` on purpose: that file's rule is that only Igor flips a Status line.
result: pass

### 9. M9: read the pt-BR copy that was not in the approved design (editor notes for short and long text, 'Informe um número.', the archive and delete failure toasts, 'Fechar')
expected: Keep per item, or the wording wanted
note: Copy written by the planner and executor, not by the design team. The UI audit (12-UI-REVIEW.md, 18/24, no blocker) flagged this copy for the owner and did not rewrite it.
result: pass
signed_off: on Igor, in chat on 2026-11-02: "tudo aprovado" (keep each item of the pt-BR copy as written).

### 10. Visual fidelity of every Phase 12 screen against sketch 016 at 320 and 390 px, with the tenant brand colours, on a real device (mask, autofill and date picker behaviour of the phone, date and number controls)
expected: Matches the approved sketch; no overflow; native pickers behave
note: Visual and device behaviour cannot be checked by grep or jsdom. The browser run of row 8 proves no overflow and 44 px tap targets at 320 and 390 px on an emulated viewport; it does not compare against the sketch and it is not a device. The code-only UI audit (12-UI-REVIEW.md, 18/24) marks sketch fidelity, brand-colour contrast and native pickers as needing a human; its one concrete drift is `text-base` on the locked option label (`OptionsEditor.tsx:115`) and a brand-text check on the TypePicker link (`TypePicker.tsx:76`).
result: blocked
blocked_by: physical-device
reason: needs a real phone and the homolog deploy

### 11. Confirm sketch 016 (the design gate) in your own hand
expected: Igor pastes or confirms approved: true; Igor's answers to the README design questions (a) to (f) are recorded or waived
note: The approval in .planning/sketches/016-phase-12-designed-screens/README.md was recorded by the orchestrator on Igor's chat instruction (approval_kind: provisional); PFORM-26 / UI-04 ask for the approval pasted by the user. Design questions (a) to (f) were never answered.
result: pass
signed_off: on Igor, in chat on 2026-11-02: "tudo aprovado". Read as the confirmation of sketch 016 and as waiving the open design questions (a) to (f); correct this if that is not what was meant. The README of the sketch was NOT edited by an agent: it still says `approval_kind: provisional` and `approved_by: "Igor (recorded by Claude on Igor's instruction)"`, because PFORM-26 and threat T-12-02 ask for the approval pasted by Igor himself. Until he pastes it, T-12-02 stays open (non-blocking) and PFORM-26 stays unchecked.

### 12. Decide the supported browsers for the profile-form export (review IN-02, fixed in f7ed3f50)
expected: Igor says the strict check is fine, or asks for the fallback
note: The export route now accepts only `Sec-Fetch-Site: same-origin`, so a browser that sends no fetch metadata (Safari older than 16.4, March 2023) gets a 403 on this one export. PFORM-21 names no browser support, so the requirement is not violated; the fallback, if wanted, is to accept a same-origin `Origin` header when `Sec-Fetch-Site` is absent.
result: pass
signed_off: on Igor, in chat on 2026-11-02: "tudo aprovado" (the strict `Sec-Fetch-Site: same-origin` check stays; Safari older than 16.4 gets a 403 on this one export).

### 13. Walk the platform-panel module switch for the profile form, with its confirm dialog, as super admin in a browser
expected: Turning the `profile_form` module on and off for a tenant asks for confirmation, and the change takes effect for members (the API caches module flags for 30 s per instance; a switch through the real route invalidates it)
note: Unit-tested only. The Playwright specs switch the module by direct SQL, which is why they never exercised this dialog. Can be done locally.
result: pass
signed_off: on Igor, in chat on 2026-11-02: "tudo aprovado" (his word; an agent did not see the dialog walked in a browser, so the module switch with its confirmation is accepted, not observed).

## Summary

total: 13
passed: 8
issues: 0
pending: 0
skipped: 0
blocked: 5

## Gaps
