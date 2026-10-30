---
phase: 12-formulario-de-perfil-do-tenant
fixed_at: 2026-10-30T08:14:00Z
review_path: .planning/phases/12-formulario-de-perfil-do-tenant/12-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 12: Code Review Fix Report

**Fixed at:** 2026-10-30
**Source review:** .planning/phases/12-formulario-de-perfil-do-tenant/12-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 2
- Fixed: 2
- Skipped: 0

## Fixed Issues

### WR-01: `exportAnswers` has no role check of its own

**Files modified:** `packages/core/server/profile-form/export.ts`, `packages/core/tests/profile-form-export-guard.test.ts` (new)
**Commit:** d6a0ae8b
**Applied fix:** `exportAnswers` now throws `ApiError(403, 'FORBIDDEN')` as its first statement when `ctx.role !== 'admin_tenant'`. That is the same idiom `member.ts` uses for its role refusals, and it runs before `recordAndReadHeader`, so nothing is read or logged for a refused caller. The doc comment of the function names the new 403. The new unit test mocks `withTenantTx` and `withAdminTx` and checks that `support_tenant` and `member` contexts get a 403 `FORBIDDEN` with neither helper entered, and that `admin_tenant` reaches the first transaction.

### WR-02: A NUL character or lone surrogate in free text becomes a 500, not a 400

**Files modified:** `packages/contracts/src/profile-form.ts`, `packages/contracts/tests/profile-form.test.ts`
**Commit:** a2b15911
**Applied fix:** A shared, exported helper `hasUnsafeChars` (NUL or an unpaired surrogate) is used in:
- `parseText`, which covers short and long text answers, and the "Outro" text in `parseChoice`. Both return the keyed `invalid` issue.
- `requiredText` (question title) and `helpTextField`, both as a `.refine(..., 'invalid')`.
- `checkOptionList` (option labels), which adds an `invalid` issue on `options.N.label`.

These are the same schemas the create, update and replace bodies use, so the admin question writes are covered too.

Deviation from the review: the surrogate check is a regex (`/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/`), not `String.prototype.isWellFormed`. `tsc` rejected `isWellFormed` because the shared contracts `lib` target does not include ES2024 (TS2550). The regex avoids changing the lib of a package that the web bundle also imports.

New tests cover `\u0000` and unpaired high and low surrogates for the following. Each returns the keyed `invalid` issue and none throws:
- short and long text answers
- "Outro" text on single and multiple choice
- title, help text and option labels on create, update and replace

Well-formed text with accents and emoji is still accepted.

Consumers were confirmed by running `tsc --noEmit` directly in `packages/contracts`, `packages/core`, `packages/modules/profile-form`, `apps/api` and `apps/web`. All were clean. `member.ts` `saveAnswers`, `admin.ts` question writes and the web `form-state` and `editor-state` use only the existing exported schemas and `parseAnswer`, so no signature changed. The `hasUnsafeChars` export is additive.

## Verification

Ran in the main checkout, not in an isolated worktree. A hand-rolled worktree has no `node_modules`, so it cannot run the gates. Every commit was path-scoped, so the untracked `.claude/` and `.planning/` files were not swept in.
- Vitest: `packages/contracts` full run, 347 tests passed. `packages/core` `profile-form-csv`, `profile-form-lock-rules` and the new guard test, 85 passed. `packages/modules/profile-form`, 3 passed. `apps/web` `lib/profile-form`, 171 passed. `apps/api` `tests/unit/registry.test.ts`, 23 passed.
- `tsc --noEmit` (no incremental, no tsbuildinfo): clean in the five packages listed above.
- Biome check: clean on the four touched source and test files.
- Free disk was 3.6 GiB throughout, above the relaxed 2 GiB floor. No Turbo, build, e2e, Docker, Supabase, integration or pgTAP run.

## Out of Scope (fix_scope: critical_warning)

These stay open and untouched:
- IN-01: the BOM constant in `csv.ts` is a literal invisible U+FEFF although the comment says it is an escape.
- IN-02: the export is a state-changing GET, and `sameOriginGet` accepts requests with neither `Sec-Fetch-Site` nor `Origin`.
- IN-03: `safeNextPath` accepts `/api/*` and `/_next/*` destinations.
- IN-04: `reorderBodySchema` lets more than 30 ids through as a generic 400, not the documented `order_mismatch` 409.

---

_Fixed: 2026-10-30_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
