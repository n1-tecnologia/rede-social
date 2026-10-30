---
phase: 12-formulario-de-perfil-do-tenant
plan: 10
subsystem: api
tags: [profile-form, csv-export, moderation-log, formula-injection, admin-lane, D-595, tracer]

requires:
  - phase: 12-formulario-de-perfil-do-tenant
    provides: "plan 02 the module key and names, plan 04 the tables and the widened moderation_log CHECK, plan 08 and 09 the admin routes, requireModule and the live module re-check"
provides:
  - "GET /v1/profile_form/export: a streamed CSV attachment of every member's answers, admin_tenant only, no-store"
  - "moderation action profile_form_exported (appended last), writer variant with the admin as actor and target, rendered in the Moderacao list"
  - "csv.ts: csvCell, csvRow, answerText, CSV_BOM, CSV_DELIMITER, CSV_EOL"
  - "export.ts: exportAnswers(ctx, { pageSize }) committing the audit row before building the stream"
  - "admin-lane inventory file profile-form.ts and the Biome allow-list entry for packages/core/server/profile-form"
affects: [12-15, 12-16, 12-17, profile-form]

actuals:
  tokens: 69000
  tasks: 3
  commits: 3
plan_head_before: 99160e0c3584b20d3e82f12b34b26a7eda907468

tech-stack:
  added: []
  patterns:
    - "A personal-data download commits its append-only audit row in its own tenant transaction BEFORE any byte exists; the integration test reads the row between the response headers and the body"
    - "A pull-based ReadableStream pages the admin-lane read by keyset, so memory is one page and the client applies backpressure"
    - "Integration cases whose success writes an immutable log row use SEEDED admins as the actor, so the row never orphans (pgTAP 154 test 41 stays green after the suite)"

key-files:
  created:
    - packages/core/server/profile-form/csv.ts
    - packages/core/server/profile-form/export.ts
    - packages/core/tests/profile-form-csv.test.ts
    - apps/api/tests/admin-lane-inventory/profile-form.ts
    - apps/api/tests/integration/profile-form-export.test.ts
  modified:
    - packages/contracts/src/moderation.ts
    - packages/contracts/tests/moderation.test.ts
    - packages/core/server/moderation/log.ts
    - packages/core/tests/moderation-log.test.ts
    - supabase/tests/154-moderation-log.sql
    - apps/web/components/admin/ModerationLogRow.tsx
    - apps/web/lib/moderation-view.ts
    - apps/web/lib/moderation-view.test.ts
    - apps/web/messages/pt-BR/moderation.json
    - packages/modules/profile-form/server/routes.ts
    - packages/modules/profile-form/README.md
    - apps/api/tests/admin-lane-inventory/index.ts
    - biome.json
    - apps/api/tests/integration/isolation.test.ts
    - apps/api/tests/isolation-inventory.ts

key-decisions:
  - "The audit row, the live module re-check, the file date and the header questions share ONE tenant transaction that ends before the stream is built: the row is committed before the first byte, and a failure reading the questions rolls the row back along with the file that never existed"
  - "A cell flagged numeric is only left alone when its text is a plain pt-BR number (-?digits with an optional comma decimal); anything else that claims to be numeric is neutralised like text, so the flag is not a bypass"
  - "The writer's variant takes actorMembershipId and the kernel verifies it is the caller's own membership of this tenant, throwing (and rolling back) otherwise"
  - "Exporters in the integration suite are the seeded admins; throwaway identities are only the exported members and the refused sessions"

patterns-established:
  - "Tenant-level moderation rows: actor = target, null subject, excerpt, reason and details; the web sentence template uses {actor} only"

requirements-completed: [PFORM-08, PFORM-21]

coverage:
  - id: D1
    description: "Tracer: the moderation log accepts, stores and renders profile_form_exported (actor = target, no subject or details), stays immutable, and every exhaustive map knows the new action"
    requirement: PFORM-21
    verification:
      - kind: other
        ref: "pnpm supabase test db supabase/tests/000-helpers.sql supabase/tests/154-moderation-log.sql (48 planned, 49 with helpers, PASS)"
        status: pass
      - kind: unit
        ref: "packages/contracts/tests/moderation.test.ts; packages/core/tests/moderation-log.test.ts; apps/web/lib/moderation-view.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "The Moderacao row sentence, the Exportacoes chip and the FileDown glyph for profile_form_exported (assumption A-12-MOD) read well in the real list"
    requirement: PFORM-21
    verification: []
    human_judgment: true
    rationale: "Copy and glyph are new and not in the UI-SPEC; Igor reviews them as manual row M6 before the phase closes"
  - id: D3
    description: "The CSV writer neutralises every formula trigger on every cell including headers, quotes correctly, renders all thirteen answer types, and is deterministic"
    requirement: PFORM-21
    verification:
      - kind: unit
        ref: "packages/core/tests/profile-form-csv.test.ts (45 passed, OWASP payload list of 12)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The route streams the file after the audit row is committed: headers, BOM, row set (active and blocked members only), thirteen types, injection payloads in a title, a name and an answer, archived columns, paging and byte-identical repeats"
    requirement: PFORM-21
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-export.test.ts (10 passed)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Only admin_tenant exports (support and member 403, no row; unauthenticated 401; module off 404, no row) and the route has a real cross-tenant isolation case with positive controls"
    requirement: PFORM-08
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-export.test.ts#12-10 who may export; apps/api/tests/integration/isolation.test.ts#phase 12 sweep: profile form export"
        status: pass
      - kind: unit
        ref: "apps/api/tests/unit/isolation-inventory.test.ts; apps/api/tests/unit/admin-lane-inventory.test.ts; apps/api/tests/unit/module-readmes.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "Excel and Google Sheets open the file cleanly with the semicolon delimiter, the byte-order mark and the comma decimal (assumption A1, PU-9 default)"
    requirement: PFORM-21
    verification: []
    human_judgment: true
    rationale: "Only a real spreadsheet application in a pt-BR locale can show it; the automated tests pin the bytes"
  - id: D7
    description: "A-12-02: the row set is every live member-role membership, active and blocked, excluding invited, staff and soft-deleted"
    requirement: PFORM-21
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-export.test.ts#one row per member, active and blocked; none for invited, staff or soft-deleted"
        status: pass
    human_judgment: true
    rationale: "Planner decision (b), not a stated requirement; the product owner confirms at UAT that blocked members belong in the file"

duration: 12min
completed: 2026-10-30
status: complete
---

# Phase 12 Plan 10: The answers export Summary

**The admin downloads every member's profile-form answers as a no-store, streamed, injection-safe CSV attachment, with its `profile_form_exported` audit row committed before the first byte and rendered in the Moderacao list.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-10-30T00:39:30Z
- **Completed:** 2026-10-30T00:51:30Z
- **Tasks:** 3 (1 tracer, 2 auto)
- **Files modified:** 20 (5 created, 15 modified)

## Accomplishments

- Tracer: `profile_form_exported` is appended last to `MODERATION_ACTIONS`; the writer records it with the exporting admin as actor and target and nothing else; pgTAP 154 proves the tenant lane inserts it, a subject or details are refused (23514), and update, delete and truncate stay refused in every lane; the Moderacao list renders it (FileDown glyph, "{actor} exportou as respostas do formulário de perfil", "Exportações" chip, `?acao=profile_form_exported` parses).
- `csvCell` prefixes a quote inside the quoted field for `= + - @`, TAB, CR, LF and the full-width forms on every cell, headers included; the only exception is the stored JSON number of a `number` question, and only when its text is a plain pt-BR number. 45 unit tests, the OWASP list among them; `answerText` renders all thirteen types (labels with `Outro:`, `dd/MM/yyyy`, Sim/Não, Aceito, comma decimal, formatted phone).
- `GET /v1/profile_form/export` (admin_tenant only): the audit row and header questions are read in one tenant transaction that commits before the stream exists; members are then read in the admin lane in keyset pages of 500 by membership id, with `m.tenant_id` and `a.tenant_id` predicates on the statement. The integration file reads the `moderation_log` row between receiving the headers and consuming the body.
- Repeat exports are byte-identical, a page of 2 and the default page yield the same file, support/member are 403 with no row, the module off is 404 with no row, and tenant B never appears in tenant A's file (and B's admin on A's host is `TENANT_HOST_MISMATCH` with no row).

## Task Commits

1. **Task 1: [tracer] the moderation log records and shows profile_form_exported** - `0512889d` (feat)
2. **Task 2: the CSV writer and its OWASP payload suite** - `0d0f8154` (feat)
3. **Task 3: the streamed export route, roles and tenant isolation** - `02bb7a1f` (feat)

**Plan metadata:** committed after this file (docs: record plan in state and roadmap).

## Files Created/Modified

- `packages/core/server/profile-form/csv.ts` - pure writer: neutraliser, RFC 4180 quoting, per-type answer text
- `packages/core/server/profile-form/export.ts` - `exportAnswers`: audit row first, then the paged admin-lane stream
- `packages/modules/profile-form/server/routes.ts` - `GET /export` behind `requireModule` and `profile_form.manage`
- `packages/core/server/moderation/log.ts`, `packages/contracts/src/moderation.ts` - the new action and writer variant
- `apps/web/lib/moderation-view.ts`, `components/admin/ModerationLogRow.tsx`, `messages/pt-BR/moderation.json` - the three exhaustive-map entries and two catalog lines
- `supabase/tests/154-moderation-log.sql` - 7 new assertions (plan 48)
- `apps/api/tests/integration/profile-form-export.test.ts` - 10 cases against the live stack
- `apps/api/tests/admin-lane-inventory/profile-form.ts`, `index.ts`, `biome.json` - the admin-lane site and allow-list entry
- `apps/api/tests/isolation-inventory.ts`, `integration/isolation.test.ts` - the `phase 12 sweep: profile form export` case

## Decisions Made

See `key-decisions`. For Igor: **A-12-MOD** (the Moderacao list copy: sentence, "Exportações" chip, icon) is new and not in the UI-SPEC, manual row M6; **A-12-02** (the file includes blocked members, excludes invited, staff and deleted ones) is the planner's decision (b) to confirm at UAT; and whether Excel and Google Sheets open the `;` + BOM + comma-decimal file cleanly is a manual row.

## Deviations from Plan

### Auto-fixed Issues

**1. [Plan wording] Two acceptance greps cannot match the literal text**
- **Found during:** Task 1 and Task 3 acceptance checks
- **Issue:** `grep -c "exported" apps/web/messages/pt-BR/moderation.json` is at least 2 expects the row and the chip, but the chip key is `exports`, so the literal count is 1 (`grep -c "export"` is 2). `grep -c "profile_form" biome.json` is at least 1 expects the allow-list entry, but the directory is the kebab-case `packages/core/server/profile-form`, so only `grep -c "profile-form" biome.json` (1) matches.
- **Fix:** none needed; both entries exist as the plan describes. Recorded here so the literal counts are not read as failures.

**2. [Rule 2 - Missing critical] The writer verifies the actor membership**
- **Found during:** Task 1
- **Issue:** the plan gives the variant an `actorMembershipId` but does not say what happens if it is not the caller's. An unchecked id could anchor a row to someone else's membership, which pgTAP 154's anchor invariant forbids.
- **Fix:** `recordModerationAction` resolves the caller's own membership of `ctx.tenantId` and throws (rolling the caller back) when the supplied id differs; a core unit test covers it.
- **Files modified:** `packages/core/server/moderation/log.ts`, `packages/core/tests/moderation-log.test.ts`
- **Committed in:** `0512889d`

### Judgement calls

- **Seeded admins as exporters.** An export's audit row is immutable; a throwaway admin deleted at teardown would orphan it and trip pgTAP 154 test 41. Successful exports in the integration file and the isolation case therefore use `admin@rede-lab.local` and `admin@rede-demo.local`. pgTAP passed in full after the integration suites ran (one first-run failure in an unrelated feed-index assertion, the known flake, passed on immediate rerun).
- **Zero-member tenant.** The "header-only file" edge is proven on the writer (BOM plus one header record, unit test) and by the stream closing on an empty page, but not against a dedicated empty tenant: a throwaway tenant could not be deleted after its first export wrote an immutable log row that references it.
- **`Response.text()` strips a BOM**, so the integration helper decodes the bytes by hand and pins `EF BB BF` separately.
- **Question titles that are payloads** cannot carry the `pfx ` prefix (the trigger must lead), so that one title ends in a `pfx-trap` marker the sweep also removes.
- **Admin-lane inventory plan number** is `10` (the field is the 09.2 plan that migrates the site; this site is born migrated and the note says Phase 12-10).

---

**Total deviations:** 1 Rule 2 auto-fix, 1 plan-wording note, 5 judgement calls.
**Impact on plan:** no scope creep, no migration, no new table; the only web files touched are the four the PFORM-26 exemption names.

## Issues Encountered

- `turbo typecheck` depends on the web build and ran `next build` once per gate (about 20 s); disk stayed at 3.5 GB free, no Playwright. The first integration run failed two cases that were test bugs (members leaking between cases, and a payload-titled question the sweep could not match); both fixed in the test file, and the leftover rows removed.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-12-24 (formula injection: every cell neutralised, OWASP suite, numeric exception narrowed to plain numbers), T-12-25 (admin only, module guard, no-store, attachment, explicit tenant predicates, a case per role, the module off and the other tenant) and T-12-26 (audit row committed before the first byte, `moderation_log` still append-only per pgTAP 154, the test reads the row before the body) are mitigated and each has an automated test. The two flagged prohibitions hold: no one but `admin_tenant` can produce the file, no export exists without its row, and the row carries no answer, e-mail or member list (a test serialises every row and searches for the secret answer, the e-mail and the name).

## User Setup Required

None - no external service configuration required. Nothing was pushed and no hosted project was touched.

## Next Phase Readiness

- Plan 17 (the export dialog) can call `GET /v1/profile_form/export` through the web's Route Handler proxy and stream the attachment; the dialog's "fica registrado" is true by construction.
- Plan 12-01 (sketch 016, Igor's design-gate review) still has no SUMMARY and was not touched; the plan pointer was not advanced. Plan 12-15 was not run.

---
*Phase: 12-formulario-de-perfil-do-tenant*
*Completed: 2026-10-30*

## Self-Check: PASSED

- Created files exist: csv.ts, export.ts, profile-form-csv.test.ts, admin-lane-inventory/profile-form.ts, profile-form-export.test.ts.
- Commits `0512889d`, `0d0f8154` and `02bb7a1f` exist; `git rev-list --count 99160e0c..HEAD` is 3 before this commit.
- Acceptance re-run: `profile_form_exported` is last in `MODERATION_ACTIONS` (contract test asserts `.at(-1)`); the PFORM-26 exemption stays narrow (only the four named web files changed, nothing else under `apps/web/`); `csv.ts` imports nothing from drizzle or the database layer; `export.ts` has 6 `tenant_id = ` predicates and calls `recordModerationAction` before it builds the stream; `index.ts` imports `./profile-form`; `biome.json` lists `!packages/core/server/profile-form/**`; the integration file reads the log row between headers and body.
- Plan verification: pgTAP 154 plus helpers PASS; full `pnpm supabase test db` 53 files, 3132 tests PASS on rerun; contracts moderation 27, core moderation-log 7, core csv 45, web moderation-view and catalog 1500 passed; `profile-form-export.test.ts` 10 passed; `isolation.test.ts -t "phase 12 sweep"` 5 passed; unit isolation-inventory, module-readmes and admin-lane-inventory 49 passed; Biome clean on the touched folders; `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4` 41 of 41 tasks successful.
