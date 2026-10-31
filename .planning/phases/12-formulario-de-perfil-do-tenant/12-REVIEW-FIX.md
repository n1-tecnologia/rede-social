---
phase: 12-formulario-de-perfil-do-tenant
fixed_at: 2026-10-31T01:10:00Z
review_path: .planning/phases/12-formulario-de-perfil-do-tenant/12-REVIEW.md
iteration: 2
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 12: Code Review Fix Report

**Fixed at:** 2026-10-31
**Source review:** .planning/phases/12-formulario-de-perfil-do-tenant/12-REVIEW.md
**Iteration:** 2

**Summary:**
- Findings in scope: 6 (fix_scope: all)
- Fixed: 6
- Skipped: 0

Iteration 1 fixed WR-01 and WR-02. Iteration 2 fixed IN-01 to IN-04. At the start of iteration 2 the WR-01 and WR-02 fixes were confirmed still in place (the 403 role check in `exportAnswers`, and `hasUnsafeChars` used across the contracts); both commits are on `master`.

## Fixed Issues

### WR-01: `exportAnswers` has no role check of its own (iteration 1)

**Files modified:** `packages/core/server/profile-form/export.ts`, `packages/core/tests/profile-form-export-guard.test.ts` (new)
**Commit:** d6a0ae8b
**Applied fix:** `exportAnswers` now throws `ApiError(403, 'FORBIDDEN')` as its first statement when `ctx.role !== 'admin_tenant'`. That is the same idiom `member.ts` uses for its role refusals, and it runs before `recordAndReadHeader`, so nothing is read or logged for a refused caller. The doc comment of the function names the new 403. The new unit test mocks `withTenantTx` and `withAdminTx` and checks that `support_tenant` and `member` contexts get a 403 `FORBIDDEN` with neither helper entered, and that `admin_tenant` reaches the first transaction.

### WR-02: A NUL character or lone surrogate in free text becomes a 500, not a 400 (iteration 1)

**Files modified:** `packages/contracts/src/profile-form.ts`, `packages/contracts/tests/profile-form.test.ts`
**Commit:** a2b15911
**Applied fix:** A shared, exported helper `hasUnsafeChars` (NUL or an unpaired surrogate) is used in:
- `parseText`, which covers short and long text answers, and the "Outro" text in `parseChoice`. Both return the keyed `invalid` issue.
- `requiredText` (question title) and `helpTextField`, both as a `.refine(..., 'invalid')`.
- `checkOptionList` (option labels), which adds an `invalid` issue on `options.N.label`.

These are the same schemas the create, update and replace bodies use, so the admin question writes are covered too.

Deviation from the review: the surrogate check is a regex (`/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/`), not `String.prototype.isWellFormed`. `tsc` rejected `isWellFormed` because the shared contracts `lib` target does not include ES2024 (TS2550). The regex avoids changing the lib of a package that the web bundle also imports.

New tests cover `\u0000` and unpaired high and low surrogates for short and long text answers, "Outro" text on single and multiple choice, and title, help text and option labels on create, update and replace. Each returns the keyed `invalid` issue and none throws. Well-formed text with accents and emoji is still accepted.

### IN-01: The BOM constant is a literal invisible U+FEFF

**Files modified:** `packages/core/server/profile-form/csv.ts`, `packages/core/tests/profile-form-csv.test.ts`
**Commit:** 4c6dcb7a
**Applied fix:** Confirmed by bytes (`357 273 277`) that `CSV_BOM` held the literal character. It is now `'\uFEFF'`, so the source holds no invisible character and the comment is true. The same literal appeared twice in `profile-form-csv.test.ts` (the `toBe('...')` pin and a header-only file expectation); both are now `\uFEFF` escapes too, so the test file has no invisible character either. The byte pin that matters is unchanged: `new TextEncoder().encode(CSV_BOM)` must equal `[0xef, 0xbb, 0xbf]`, and it passes. A `grep` for the raw bytes in both files returns 0. `export.ts` only imports the constant, so nothing else changed.

### IN-02: The export is a state-changing GET and `sameOriginGet` accepts requests with neither header

**Files modified:** `apps/web/app/api/profile-form/export/route.ts`, `apps/web/app/api/profile-form/export/route.test.ts`
**Commit:** f7ed3f50
**Applied fix:** The route no longer calls `sameOriginGet`. A local `isStrictSameOrigin` requires `Sec-Fetch-Site` to equal `same-origin`; anything else gets the route's existing empty `403` with `no-store`, before the session check and before any forward. `sameOriginGet` in `notifications-bff.ts` is untouched, so its other callers (`/api/me/counters`, `/api/realtime/token`, `/api/chat/*`, `/api/cep`) behave as before.

Decision on `none`: it is refused. The only caller is `startCsvDownload` (`apps/web/lib/profile-form/download.ts`), which uses `fetch(url, { credentials: 'same-origin' })`. A same-origin `fetch()` always sends `Sec-Fetch-Site: same-origin`, so the real click works. `none` is what a typed URL or bookmark sends; nothing links to this URL and the export starts from the dialog, never by navigation, so allowing `none` would buy nothing. Consequence to know: a browser that sends no fetch metadata at all (Safari before 16.4) now gets a 403 on the export, where the other BFF routes keep working. That was the chosen trade for a state-changing GET; the alternative is a POST with a same-origin check.

Tests: the mock of `sameOriginGet` was removed and the helper `request(site)` now sends the header (default `same-origin`). New cases refuse `cross-site`, `same-site`, `none` and a missing header with an empty 403 and no API call, and a header-less request that carries a same-host `Origin`. 13 tests pass.

### IN-03: `safeNextPath` accepts `/api/*` and `/_next/*` destinations

**Files modified:** `apps/web/lib/safe-next-path.ts`, `apps/web/lib/safe-next-path.test.ts`
**Commit:** 80abc5a2
**Applied fix:** A new exported `NON_PAGE_PATH_PREFIXES = ['/api', '/_next']` is checked in `isExcluded`, with the same `isUnder` rule as the other exclusions (the path itself or anything under `/prefix/`, query and hash cut first, and applied to both the raw and the once-decoded value). It is a separate list from `AUTH_PATH_PREFIXES` because a test pins that list to the `(auth)` folders. Doc comment updated.

Tests: refused are `/api`, `/api/`, `/api/me/counters`, `/api?x=1`, `/api#a`, `/%61pi/me/counters` (caught after the one decode), `/_next`, `/_next/static/x` and `/_next/image?url=%2Fa`. Still allowed are `/apix`, `/api-docs` and `/_nextx/a`. 68 tests pass, and the 62 tests of `completar-perfil` and `bootstrap` also pass.

### IN-04: `reorderBodySchema` lets more than 30 ids through as a generic 400

**Files modified:** `packages/contracts/src/profile-form.ts`, `packages/contracts/tests/profile-form.test.ts`
**Commit:** 861f90cb
**Applied fix:** `.max(PROFILE_FORM_LIMITS.activeQuestions, 'order_mismatch')`. `order_mismatch` is in `PROFILE_FORM_ISSUE_SET`, and `defaultHook` in `packages/modules/profile-form/server/routes.ts` already lifts it to `ApiError(409, 'CONFLICT', { profileForm: 'order_mismatch' })`, so 31 ids now takes the documented keyed 409 path with no route change. The existing reorder test gained an assertion that 31 ids yields the `order_mismatch` issue.

## Verification

Ran in the main checkout, not in an isolated worktree, as instructed. Every commit was path-scoped, so the untracked `.claude/` and `.planning/` files were not swept in. No commit has a Co-Authored-By trailer or any tool attribution (grep after each commit returned clean).
- Vitest: `packages/core` `profile-form-csv` and `profile-form-export-guard`, 48 passed. `apps/web` export route, 13 passed. `apps/web` `safe-next-path`, 68 passed; `completar-perfil` plus `lib/bootstrap`, 62 passed; `lib/profile-form`, 171 passed. `packages/contracts` full run, 347 passed. `packages/modules/profile-form`, 3 passed.
- `tsc --noEmit --incremental false`: clean in `packages/contracts`, `packages/core` and `apps/web`.
- Biome check: clean on all touched files (one formatting fix applied to the export route test before its commit).
- Not run, per the constraints: db reset or seed, next build, `pnpm verify`, the integration suite, pgTAP, Playwright, Docker or Supabase restarts. The orchestrator's browser specs should include the export download (the `fetch` path must still return the CSV) and a 31-id reorder (expect 409).

---

_Fixed: 2026-10-31_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
