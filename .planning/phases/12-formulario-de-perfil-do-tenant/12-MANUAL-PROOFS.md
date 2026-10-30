---
phase: "12"
status: pending
---

# Phase 12 manual proofs (M1 to M9)

This file is the ledger of the proofs only the owner can run: a real phone, a hosted tenant project, a
spreadsheet program, a large export through Cloud Run, a browser run that needs more disk than the build
machine had, and the reading of the Portuguese copy that was not in the approved design. Everything an agent
could build is built and proved on the local stack (plans 01 to 17, and the fan-out case of plan 18); what is
left here cannot be faked, so nothing in this file is ever recorded as done by an agent.

**The rule.** Every row ships `pending`. A row becomes `passed` only when Igor pastes the evidence of its
steps and the date, in the row, himself. An agent never edits a Status line and never writes evidence it did
not see. A phase whose ledger has a `pending` row closes `human_needed`, never green.

**The evidence rule.** Paste shapes, counts, statuses, HTTP codes, exit codes and the words the screens show.
**Never** a key, a password, a token, a connection string, an e-mail address of a member, a CSV cell or a
project ref. Replace a ref by `<ref>` and a host by `<host>` in what you paste.

**The procedures** are in `docs/DEPLOY.md`, "Phase 12 release (tenant profile form)" (written by plan 18).

## The rows

| Row | Proof | Requirement | Needs | Status |
|-----|-------|-------------|-------|--------|
| M1 | The member path on a real phone: the gate, the completion screen, "Minhas respostas" | PFORM-12, 14, 20, 26 | a phone and the homolog deploy | pending |
| M2 | The migrations on one hosted tenant project (the fan-out against a real project) | PFORM-25 | one hosted tenant project | pending |
| M3 | The exported CSV opened in Excel and in Google Sheets, with accents | PFORM-21 | Excel and Google Sheets | pending |
| M4 | A large export streamed through Cloud Run (assumption A2: no 32 MiB cap on a streamed response) | PFORM-21 | the hosted API and a tenant with thousands of members | pending |
| M5 | Igor's confirmation of the export row set (A-12-02: active and blocked members) | PFORM-21 | Igor's decision | pending |
| M6 | Igor's review of the Moderação copy for the export row and chip (A-12-MOD) | PFORM-21, PFORM-26 | the Moderação list after one export | pending |
| M7 | The production release order | PFORM-25 | the production deploy | pending |
| M8 | The three Playwright specs, written and not yet run: gate, member, admin | PFORM-12, 13, 14, 20, 25, 26 | more than 10 GiB of free disk and the local stack | pending |
| M9 | Igor's confirmation of the pt-BR copy that was not in the approved design | PFORM-26 | Igor's reading | pending |

Sketch `016` (the design gate) is recorded as approved by Igor, provisionally; this ledger does not repeat it.

## M1 — The member path on a real phone

- **Proves:** that the gate, the completion screen and "Minhas respostas" work on a real device against the
  deployed app. Phones cannot reach `*.localhost`, so no local run stands in for it.
- **Needs:** the homolog deploy of the release below, the module switched on for one homolog tenant, one
  required question, a member account and a phone (a home-screen install is welcome, not required).
- **Steps:**
  1. As the tenant admin, build one required question and one optional public question.
  2. As a member who has not answered, open a deep link to a post on the phone: you land on the completion
     screen. Answer and save: you land on that same post.
  3. Open your profile: "Minhas respostas" lists both answers, "Visível no seu perfil" sits on the public one;
     "Editar" opens the same screen with "Cancelar" and a save returns to the profile.
  4. As the admin add an optional question: the member sees "Há perguntas novas no seu perfil"; "Agora não"
     hides it and it stays hidden after reopening the app.
- **Evidence to paste:** one line per step ("worked" or what happened), the device and browser, the date.
- **Status:** pending
- **Recorded by:**
- **Date:**

## M2 — The migrations on one hosted tenant project

- **Proves:** that `migrateAll` applies the four Phase 12 migrations to a real hosted tenant project, and that
  a second run applies nothing (the local second database is proved by `migrate-all.test.ts`).
- **Needs:** one hosted tenant project and the production or homolog `migrate` Job (Phase 09.2 section of
  `docs/DEPLOY.md`).
- **Steps:**
  1. Run `pnpm db:migrate-all -- --dry-run` (or the Job with the dry-run flag): the four versions
     `20261029230924`, `20261029232606`, `20261029233037`, `20261029234918` are pending on the project.
  2. Run the Job for real: exit code `0`, the project `current`.
  3. Run the smoke SQL of the Phase 12 section on that project.
  4. Run the Job again: nothing applied.
- **Evidence to paste:** the exit codes, the `applied` count per run, the smoke query row counts.
- **Status:** pending
- **Recorded by:**
- **Date:**

## M3 — The CSV in Excel and in Google Sheets

- **Proves:** assumption A1: the file is `;` separated, starts with a UTF-8 byte-order mark and writes
  numbers with a decimal comma, so a pt-BR Excel and Google Sheets open it in columns with accents intact.
- **Needs:** an export of a tenant with a question that has accents ("Área de atuação") and a number answer
  with a decimal comma, Excel in a pt-BR locale, and Google Sheets.
- **Steps:** export from the builder ("Exportar respostas (CSV)"), open the file in Excel (double click) and
  import it into Google Sheets; look at the header row, an accented answer and a decimal number.
- **Evidence to paste:** for each program, whether the columns split, whether the accents read right and
  whether the number kept its decimal (words only; do not paste cells).
- **Status:** pending
- **Recorded by:**
- **Date:**

## M4 — A large export through Cloud Run

- **Proves:** assumption A2: a streamed response on Cloud Run is not subject to the 32 MiB body cap.
- **Needs:** the hosted API and a tenant with thousands of members and answers (or a rehearsal tenant filled
  for the purpose).
- **Steps:** export from the builder and note the size of the downloaded file and whether it is complete (the
  last row is a member and the file ends with a line break).
- **Evidence to paste:** the file size, the number of rows and the outcome. If it fails, say at which size.
- **Status:** pending
- **Recorded by:**
- **Date:**

## M5 — The export row set (A-12-02)

- **Decision to confirm:** the file holds one row per **active and blocked** member; it leaves out invited
  members, staff and deleted members (the planner's decision (b), to confirm).
- **Steps:** read the sentence above and answer: keep it, or ask for a filter.
- **Evidence to paste:** "keep" or the change you want, and the date.
- **Status:** pending
- **Recorded by:**
- **Date:**

## M6 — The Moderação copy for the export (A-12-MOD)

- **Proves:** that the wording and the icon read well in the real Moderação list. They were written by the
  planner and are not in the approved design.
- **Copy to read:** the row "{name} exportou as respostas do formulário de perfil", the filter chip
  "Exportações", and the file-download icon on the row.
- **Steps:** export once as the tenant admin, open Configurações, Moderação, and read the row and the chip.
- **Evidence to paste:** "keep" or the wording you want instead.
- **Status:** pending
- **Recorded by:**
- **Date:**

## M7 — The production release order

- **Proves:** that the release order of `docs/DEPLOY.md` "Phase 12 release (tenant profile form)" is the one
  that was followed.
- **Order:** the four tenant migrations through `migrateAll` on every project; then the API and the worker
  together; then the web; then, per tenant, the `super_admin` switches the module on. The old
  `app.membership_in_tenant_gated` / `app.memberships_of_user_gated` pair is NOT dropped in this release.
- **Evidence to paste:** the date of each step and the result of the smoke SQL on one production project.
- **Status:** pending
- **Recorded by:**
- **Date:**

## M8 — The Playwright specs that were written and not run

- **Why this row exists.** On 2026-10-30 the disk had 3.9 GiB free and the plan's guard needs more than 10
  GiB (a Next server and three browsers drop about 9 GB). Igor decided to run plan 18 without Playwright. The
  three specs, the helper and the affected-map entry are written, pass the type check and the linter, and are
  listed by `playwright test --list` (20 tests); **none of them has been executed**, so the browser proof of
  the gate, the member stories, the builder, the export and the 320px and 390px backstops is not recorded.
- **Needs:** more than 10 GiB of free disk, no `next dev` running, and the local stack up.
- **Precondition check:** `test $(df -k . | awk 'NR==2{print $4}') -gt 10485760 && echo enough`.
- **Command (from the repository root):**

  ```bash
  rm -rf apps/web/.next/cache apps/web/.next/dev
  pnpm --filter @rede-social/web exec playwright test --project=mobile-chromium \
    profile-form-gate.spec.ts profile-form-member.spec.ts profile-form-admin.spec.ts
  ```

  Playwright starts the API and the web itself (`playwright.config.ts`); `SEED_PASSWORD` comes from
  `apps/web/.env.local`. The specs run on the phone project only (they skip the other two). Expect about 20
  tests; the module row and every run-prefixed row are put back by the specs themselves, and each spec asserts
  that in its `afterAll`.
- **Evidence to paste:** the final line of the run ("N passed"), and for each failure the test name and the
  first error line. A failure in a spec that was never run is as likely to be the spec as the product: say
  which, and open it.
- **Status:** pending
- **Recorded by:**
- **Date:**

## M9 — The pt-BR copy that was not in the approved design

Read these in the real screens and answer "keep" or the wording you want.

- **The editor notes (plan 16).** For "Texto curto": "O membro escreve uma linha, com até {max} caracteres."
  and for "Texto longo": "O membro escreve um texto, com até {max} caracteres." The design has no copy for
  these two types; the caps are the contract's (120 and 1000).
- **"Informe um número."** The message under a minimum or maximum that is not a number, in the editor.
- **The archive and delete failure toasts:** "Não foi possível arquivar agora. Tente de novo." and "Não foi
  possível excluir agora. Tente de novo." (modelled on the reactivation failure).
- **"Fechar"**, the name a screen reader gives the handle of the editor sheet.
- **The Moderação export copy** is row M6, not repeated here.
- **Evidence to paste:** "keep" per item, or the wording you want.
- **Status:** pending
- **Recorded by:**
- **Date:**

## Deferred follow-up (recorded, not part of this phase)

- **Drop the old lookup pair.** A later cleanup migration drops `app.membership_in_tenant_gated` and
  `app.memberships_of_user_gated`, once the API that calls the `_gate` twins has been live for one release on
  every project. No plan of Phase 12 writes it (planner decision (d); the 08.1-05 `membership_for_user`
  precedent).
