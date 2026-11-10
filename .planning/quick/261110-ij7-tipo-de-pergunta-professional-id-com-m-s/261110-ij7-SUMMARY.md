---
phase: quick-261110-ij7
plan: 01
subsystem: profile-form
tags: [profile-form, question-type, mask, cnpj, professional-id, quick]
requires: [D-587, D-590, D-591]
provides:
  - "professional_id, the 14th profile-form question type (8 mask formats in limits.format)"
  - "packages/contracts/src/professional-id.ts: one engine for the mask while typing and the judge"
affects: [packages/contracts, packages/core, supabase/migrations, apps/web]
key-files:
  created:
    - packages/contracts/src/professional-id.ts
    - packages/contracts/tests/professional-id.test.ts
    - supabase/migrations/20261110163931_profile_form_professional_id.sql
    - supabase/migrations/20261110163941_profile_form_professional_id_guard.sql
    - supabase/tests/229-profile-form-professional-id.sql
  modified:
    - packages/contracts/src/profile-form.ts
    - packages/core/server/profile-form/lock-rules.ts
    - apps/web/components/profile-form/fields.tsx
    - apps/web/app/(app)/configuracoes/formulario-de-perfil/editor-state.ts
decisions:
  - "The mask is stored in the existing limits jsonb as limits.format: no new column, no database CHECK on its value."
  - "The stored answer is the canonical masked text, upper case, at most 25 characters."
  - "The format lock reuses limits_locked and PF005, through a separate additive trigger that sorts after the existing guard."
status: complete
completed: 2026-11-10
plan_head_before: 5eacbeef522d3554cd869bc7f5141852c12b9838
commits: 4
actuals:
  tokens: 120000
  tasks: 3
  commits: 4
---

# Quick 261110-ij7: question type "Registro profissional / CNPJ" (professional_id) Summary

A 14th profile-form question type. The admin picks one of 8 masks in the builder (CRO, CRM, CRBM, CRF, COREN, CREFITO, CRBio, CNPJ); the member sees the mask applied while typing and the contract judge stores the canonical text only when it is valid (real UF, region and number ranges, CNPJ check digits for the traditional and the alphanumeric form). The format locks once the question has answers.

## What Igor needs to know (planner decisions, restated)

1. **The CNPJ example in the request has wrong check digits.** `12.345.678/0001-90` fails the check-digit rule; the correct digits for base `12.345.678/0001` are `-95` (the orchestrator verified it too). The example constant, the placeholder, the tests, the catalog sentence and the pgTAP/Vitest vectors use `12.345.678/0001-95`. A test pins that the `-90` version is refused and that every example passes its own judge.
2. **CREFITO accepts only the `-F` suffix, as specified.** A registry that ends in another letter code (for example `-TO`, occupational therapists) cannot be answered yet: `CREFITO-3/12-TO` and `CREFITO-3/12-T` are refused. Opening it to other letter codes is a change to the contract engine and its tests, not to the database.
3. **The format lives in `limits.format`** (the existing `limits` jsonb). No new column and no database CHECK on the value: the contract and the service judge it. The database change is the type CHECK only.
4. **Ranges chosen:** CRBM region is one digit 1 to 9; CREFITO region is 1 to 19 with no leading zero; every number is 1 to 9 digits (leading zeros kept); CRBio is exactly 6 digits, "/", 2 digits, "-", one letter A to Z; UF councils need one of the 27 real UF codes. Format only, never a registry lookup.
5. **The format lock reuses `limits_locked` and `PF005`**, through a separate additive trigger (`profile_form_questions_guard_format`, `BEFORE UPDATE OF limits`). The long 12.2 guard function is not restated. The trigger sorts after `profile_form_questions_guard`, so when one update breaks both (type and format) PF001 still speaks first, the same order as the service.

## Commits (4, all code, no trailer)

| Task | SHA | Message |
|---|---|---|
| 1 | `7b73d55e` | feat(quick-261110-ij7): add the professional_id question type and its mask engine to the contract |
| 2 | `bfd2083e` | feat(quick-261110-ij7): widen the type CHECK, lock the format once answered, export it as text |
| 3a | `50959657` | feat(quick-261110-ij7): masked member field, display and catalog for professional_id |
| 3b | `e35bf3aa` | feat(quick-261110-ij7): builder format list and format lock for professional_id |

`git rev-list --count 5eacbeef..HEAD` is 4. `git log 5eacbeef..HEAD --format=%B` has no Claude, Anthropic or Co-Authored-By line. Every `git show --stat HEAD` listed only the intended paths. The PLAN and this SUMMARY are not committed by me. Nothing pushed, deployed or reset.

## What changed

- **Contract (Task 1).** `professional-id.ts` is a pure, linear-time module: `layoutProfessionalId` (the text, `consumed`, `total` and the caret map `ends`), `canonicalizeProfessionalId` (the judge), `cnpjCheckDigits`, `isProfessionalIdText`, the format list, the 27 UF codes and the examples record. `profile-form.ts` appends `professional_id` last to `PROFILE_FORM_TYPES`, adds the `parseAnswer` case (non-string `invalid`, over 64 units `too_long`, no format `invalid`, null from the judge `invalid`), the `answerValueSchema` variant, `limits.format` (strict schema) and the definition rules (a professional_id needs a format, takes no min or max; any other type refuses a format). Only the first 64 UTF-16 units are read.
- **Database and server (Task 2).** One generated expand-only migration widens `profile_form_questions_type_chk` to 14 names; one hand migration adds `app.profile_form_format_guard()` (security definer, empty search_path, revoked from public) and the trigger. `checkLocks` answers `limits_locked` for a format change on an answered question (after the narrowing check, the order is kept). `admin.ts` copies and compares `format`; `csv.ts` exports the stored text.
- **Web (Task 3).** `ProfessionalIdField` runs the same `layoutProfessionalId` on every change, never keeps a character that does not fit, and keeps the caret next to the edited character (after a "/" typed in a CREFITO the caret stays after it). The field is judged on blur by `parseAnswer`. The builder has the 14th tile, a "Formato do registro" select with the 8 formats, the example line, the format-required error, and a read-only select with a note when the question has answers. All strings are in the pt-BR catalog (nothing hard-coded; the mask examples are contract data).

## Verification (real output)

### Tests-first, the red steps (before the implementation)

- Task 1: `tests/professional-id.test.ts` failed to load (`Cannot find module '../src/professional-id'`); `tests/profile-form.test.ts` had 12 failed / 129 passed (the 14-entry type pin, the new schema and `parseAnswer` cases).
- Task 2: Vitest `profile-form-lock-rules` and `profile-form-csv`: 3 failed / 90 passed (93). pgTAP: `229` failed test 1 (the CHECK refused `professional_id`, `23514`) and test 3, and `220` failed tests 21 and 22 (the two 14-name pins).
- Task 3: the web files: 8 test files failed, 51 failed / 933 passed (984).

### Green, after the implementation

| Check | Result |
|---|---|
| `contracts` Vitest `professional-id.test.ts` + `profile-form.test.ts` | 2 files, 195 passed (54 of them are the new engine file). The whole contracts suite earlier: 20 files, 604 passed |
| `core` Vitest `profile-form-lock-rules` + `profile-form-csv` | 2 files, 93 passed |
| `web` Vitest `lib/profile-form`, `components/profile-form`, `i18n/profile-form-messages`, `formulario-de-perfil` | 43 files, 1662 passed (final run after the last commit). A wider run including `app/(app)/configuracoes` gave 70 files, 3671 passed; `app/(app)/perfil`, `app/(auth)/completar-perfil`, `app/api/profile-form`, `i18n/messages` gave 8 files, 1672 passed |
| typecheck | contracts, core and web exit 0 (web is `next typegen && tsc --noEmit`, no build). Also exit 0: `@rede-social/api` and `@rede-social/module-profile-form` |
| `pnpm exec biome check` on the 31 touched TS, TSX and JSON files | exit 0 (import order and one format wrap were fixed with `--write`) |
| `bash scripts/check-ui-literals.sh` | exit 0 |
| pgTAP (local stack was up) | `pnpm supabase migration up` applied ONLY the two new migrations (no reset). `220-profile-form.sql` 205 tests + `229-profile-form-professional-id.sql` 15 tests: all passed (220 tests, Result PASS). Extra regression: `225-profile-form-steps-conditions.sql` + `226-profile-form-branches.sql`, 399 tests, PASS |

### Not run, on purpose

- The integration suites (the runner does not filter by file, so no integration test was added or run), the Playwright e2e, `next build` and `turbo build`, the full turbo gate and the full web Vitest suite. `db:reset`, push and deploy were not run.
- The local database now has the two new migrations applied (nothing else was changed). The e2e and API-integration helper types in `apps/web/e2e/profile-form.ts` and `apps/api/tests/integration/*` still say `{ min?, max? }`; they compile (web and api typecheck exit 0) and were left alone.

## Deviations from Plan

None that change the plan. Small notes:

- **[Rule 3 - test harness] ** The existing test "required and showOnProfile are free on every type" now sends `limits: { format: 'cro' }` for `professional_id`, because the new rule (a professional_id needs a format) is exactly what the plan asks for.
- **[Rule 1 - own test bug]** One of my format-field tests typed the same text twice (React fires no change event for an identical value); it now types a different value. The component was right.
- The generated migration got the module_key-style header comment; drizzle-kit also wrote two meta snapshots and the journal line, all committed with the migrations as the plan says.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat register. T-ij7-01..07 are covered: the validator is built from the stored question only and fails closed; the format locks in the service, the web mirror and the trigger; the create schema rejects a malformed definition as a 400; the engine is linear and reads 64 units (a 100000-character paste test pins it); both migrations are expand-only.

## Self-Check: PASSED

- Created files exist: `packages/contracts/src/professional-id.ts`, `packages/contracts/tests/professional-id.test.ts`, the two migrations, `supabase/tests/229-profile-form-professional-id.sql`.
- Commits exist: `7b73d55e`, `bfd2083e`, `50959657`, `e35bf3aa` (all four in `git log 5eacbeef..HEAD`).
- Tracked tree clean after the last commit; no `.claude/*`, `.planning/research/.cache/*` or `.planning/debug/*` file staged.
