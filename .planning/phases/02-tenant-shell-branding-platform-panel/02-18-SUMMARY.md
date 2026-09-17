---
phase: 02-tenant-shell-branding-platform-panel
plan: 18
subsystem: hardening (bootstrap tenant scoping, web host lookup, platform upload hook)
tags: [bootstrap, tenant-scoping, drizzle, proxy, abort-signal, branding-upload, happy-dom, testing-library, gap-closure, tdd]

# Dependency graph
requires:
  - phase: 02-07
    provides: GET /v1/me/bootstrap tenant-lane reads (withTenantTx + the three selects) and RequestContext { tenantId, userId }
  - phase: 02-01
    provides: apps/web/lib/tenant-host.ts resolveHostTenant with the bounded cache (TTL_HIT/MISS/ERROR) and the fail-open-to-generic decision
  - phase: 02-08
    provides: proxy.ts host routing that consumes resolveHostTenant on every request (proxy.test.ts mocks it)
  - phase: 02-14
    provides: useSignedUpload hook in apps/web/components/platform/LogoUpload.tsx, apps/web/lib/upload.ts helpers, the platformBranding catalog
provides:
  - "packages/core/server/tenancy/membership-scope.ts: membershipOfRecord(ctx) — the ONE where-clause for the caller's membership in the tenant of record (tenant_id + user_id + deleted_at is null), layer 2 of CLAUDE.md's three-layer tenant scoping"
  - "GET /v1/me/bootstrap membership select scoped by membershipOfRecord(ctx) instead of user_id alone (WR-05)"
  - "apps/web/lib/tenant-host.ts: HOST_LOOKUP_TIMEOUT_MS = 2_000 + signal: AbortSignal.timeout(...) on the by-host fetch; a hanging API fails open to { mode: 'generic' } within ~2 s and the answer is cached for TTL_ERROR_MS (WR-06)"
  - "useSignedUpload.onFile try/catch: a rejected start / complete / thrown transfer logs platform.branding.upload_failed and ends in fail(t('errors.generic')) — busy reset, idle, progress 0, next drop accepted (WR-07)"
  - "apps/web can host hook/component tests: happy-dom@20.14.5 + @testing-library/react@16.3.3 devDependencies (first happy-dom test: LogoUpload.test.ts)"
affects: [02-19, 02-20 (phase exit gate pnpm verify), phase-08-hardening, any tenant-lane read of memberships (profile, members directory), Phase 3 media pipeline (reuses the signed-upload hook shape)]

# Actuals (#2632) — same estimateTokens scale as the plan's estimate (chars/4 over the realized diff 0f3f84b..b452118; 5 725 including the 6-line pnpm-lock.yaml importers change)
actuals:
  tokens: 5531
  tasks: 3
  commits: 5
plan_head_before: 0f3f84bef76e2e95ec90261baacce00af0189889

# Tech tracking
tech-stack:
  added: [happy-dom@20.14.5 (apps/web devDependency), "@testing-library/react@16.3.3 (apps/web devDependency)"]
  patterns:
    - "Tenant-lane reads of memberships go through membershipOfRecord(ctx) — the predicate is greppable and never user_id alone"
    - "Request-path fetches to the API carry AbortSignal.timeout with a tight budget (2 s on the interactive path vs 10 s in the API-side adapters); a timeout is a lookup failure, cached for the error TTL, never a different answer"
    - "Client hooks that await server actions wrap the whole body in try + catch (no finally) and route every rejection through the existing fail() reset with a catalog key; the raw error goes to console.error only"
    - "apps/web hook tests: `// @vitest-environment happy-dom` + renderHook, with next-intl's useTranslations mocked to return the key and @tria/ui's useToast mocked through a vi.hoisted spy; partial vi.mock keeps real helpers (classifyFile/resolveMime) and stubs only the XHR PUT"
    - "RED evidence for vitest: run with --reporter=tap-flat and append the node:test trailer (# tests/# pass/# fail) computed from the ok/not ok lines so `gsd_run check tdd-red-evidence` can classify the run"

key-files:
  created:
    - packages/core/server/tenancy/membership-scope.ts
    - packages/core/tests/membership-scope.test.ts
    - apps/web/lib/tenant-host.test.ts
    - apps/web/components/platform/LogoUpload.test.ts
  modified:
    - apps/api/src/routes/me.ts
    - apps/web/lib/tenant-host.ts
    - apps/web/components/platform/LogoUpload.tsx
    - apps/web/package.json
    - pnpm-lock.yaml

key-decisions:
  - "02-18: membershipOfRecord(ctx) lives in packages/core/server/tenancy (next to tenant-host.ts / membership.ts) and returns SQL with an explicit empty-clause guard (no non-null assertion) — the bootstrap's membership read is scoped tenant_id + user_id + deleted_at is null and the same helper is the pattern for every later tenant-lane read of memberships"
  - "02-18: the web by-host lookup budget is 2 s (HOST_LOOKUP_TIMEOUT_MS), deliberately tighter than the API-side adapters' 10 s because it sits on proxy.ts and every layout; the timeout reuses the existing catch → generic + TTL_ERROR_MS path (no new branch), so it can never fail open to a tenant brand"
  - "02-18: useSignedUpload keeps try + catch only (no finally) — the success path must not re-run fail() after onCompleted; the catch logs { kind, error: String(error) } and renders t('errors.generic') only (T-02-147)"
  - "02-18: happy-dom + @testing-library/react added to apps/web at the exact versions packages/core and packages/ui already pin — the lockfile change is 6 importer lines, no new resolved package version (T-02-SC gate held); LogoUpload.test.ts is the first happy-dom test in apps/web"

patterns-established:
  - "Layer-2 predicate helper: `export function membershipOfRecord(ctx): SQL` rendered and pinned by `new PgDialect().sqlToQuery(...)` in a no-database kernel unit test"
  - "Hanging-fetch stub for timeout tests: a fetch mock whose promise settles ONLY on `init.signal` abort (rejecting with `signal.reason`) — proves the AbortSignal is wired without fake timers"

requirements-completed: [TENANT-02, MOD-04, ROLE-03]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "WR-05: GET /v1/me/bootstrap selects the membership with tenant_id = ctx.tenantId AND user_id = ctx.userId AND deleted_at IS NULL through membershipOfRecord(ctx); the rendered clause names all three predicates and both params; seeded-member, invited-admin bootstrap and accept flows unchanged"
    requirement: MOD-04
    verification:
      - kind: unit
        ref: "packages/core/tests/membership-scope.test.ts#1. renders tenant_id, user_id AND deleted_at is null, with both ids as params"
        status: pass
      - kind: unit
        ref: "packages/core/tests/membership-scope.test.ts#2. never degrades to user-only scoping"
        status: pass
      - kind: integration
        ref: "pnpm test:integration -- bootstrap invites (whole suite: 16 files / 180 tests, bootstrap.test.ts + invites.test.ts green after the predicate change)"
        status: pass
    human_judgment: false
  - id: D2
    description: "WR-06: resolveHostTenant bounds the by-host fetch with AbortSignal.timeout(2 000 ms); a hanging API resolves { mode: 'generic', host } in ~2 s (measured 2007 ms), logs tenant-host.lookup_failed with TimeoutError, the generic answer is served from the 10 s error TTL without a second fetch, and a healthy 200 body still classifies as tenant"
    requirement: TENANT-02
    verification:
      - kind: unit
        ref: "apps/web/lib/tenant-host.test.ts#1. a hanging API resolves to generic within the 2 s budget, logs the timeout"
        status: pass
      - kind: unit
        ref: "apps/web/lib/tenant-host.test.ts#2. the generic answer is served from the error TTL — no second fetch for the same host"
        status: pass
      - kind: unit
        ref: "apps/web/lib/tenant-host.test.ts#3. a healthy 200 body still classifies as tenant — and the call carried a signal too"
        status: pass
      - kind: unit
        ref: "apps/web/proxy.test.ts (11 tests unchanged and green — resolveHostTenant mocked there)"
        status: pass
    human_judgment: false
  - id: D3
    description: "WR-07 / UI-SPEC E14 error: a rejected actions.start, a rejected actions.complete or a thrown uploadToSignedUrl returns the zone to idle (state 'idle', progress 0) with errors.generic, logs platform.branding.upload_failed { kind, error }, calls neither onCompleted nor the toast; the same hook instance accepts a second drop which completes (onCompleted once, success toast)"
    requirement: ROLE-03
    verification:
      - kind: unit
        ref: "apps/web/components/platform/LogoUpload.test.ts#1. actions.start rejects → idle, progress 0, errors.generic, logged; nothing completed"
        status: pass
      - kind: unit
        ref: "apps/web/components/platform/LogoUpload.test.ts#2. the second drop after a rejected start is accepted and completes"
        status: pass
      - kind: unit
        ref: "apps/web/components/platform/LogoUpload.test.ts#3a. actions.complete rejects → idle + errors.generic"
        status: pass
      - kind: unit
        ref: "apps/web/components/platform/LogoUpload.test.ts#3b. a thrown transfer → idle + errors.generic"
        status: pass
    human_judgment: false
  - id: D4
    description: "apps/web can host hook/component tests: happy-dom@20.14.5 and @testing-library/react@16.3.3 as devDependencies, no new package version in pnpm-lock.yaml"
    verification:
      - kind: other
        ref: "node -e \"const p=require('./apps/web/package.json').devDependencies; …\" (both versions pinned) + git diff --stat pnpm-lock.yaml = 1 file changed, 6 insertions(+) (importers only)"
        status: pass
    human_judgment: false

# Metrics
duration: 10 min
completed: 2026-09-17
status: complete
---

# Phase 02 Plan 18: WR-05 membershipOfRecord + WR-06 host-lookup timeout + WR-07 upload error boundary Summary

**Three review warnings closed with one failing-first test each: the bootstrap's membership read now carries the explicit tenant + lifecycle predicate through a reusable kernel helper, the web tier's by-host lookup is bounded to 2 s and fails open to the generic shell, and a rejected signed-upload step returns the Marca zone to idle instead of stranding it in `progress`.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-09-17T13:27:07Z
- **Completed:** 2026-09-17T13:37:19Z
- **Tasks:** 3 (Tasks 2 and 3 TDD: RED → GREEN, no refactor commit needed)
- **Files modified:** 9 (4 created, 5 modified)

## Accomplishments

- **WR-05** — `packages/core/server/tenancy/membership-scope.ts` exports `membershipOfRecord(ctx)`; `GET /v1/me/bootstrap` selects the membership with it. Rendered SQL (PgDialect): `("memberships"."tenant_id" = $1 and "memberships"."user_id" = $2 and "memberships"."deleted_at" is null)`, params `[tenantId, userId]`. Layer 2 of the CLAUDE.md three-layer scoping no longer depends on the V1 `memberships_one_tenant_per_user_v1` index.
- **WR-06** — `apps/web/lib/tenant-host.ts` passes `signal: AbortSignal.timeout(HOST_LOOKUP_TIMEOUT_MS)` (2 000 ms) on the by-host fetch. Measured wall clock of the hanging-API test: **2007 ms** to `{ mode: 'generic', host }`; the generic answer is then served from the 10 s error TTL (fetch count stays 1); a 200 body still classifies as `tenant`.
- **WR-07** — `useSignedUpload.onFile` is wrapped in `try { … } catch (error) { console.error('platform.branding.upload_failed', { kind, error: String(error) }); fail(t('errors.generic')); }`. A rejected `start`, rejected `complete` or thrown transfer ends idle with the generic pt-BR message and the second drop completes with `onCompleted` + success toast.
- `apps/web` gained `happy-dom@20.14.5` and `@testing-library/react@16.3.3` (same pins as `packages/core` / `packages/ui`); `git diff --stat pnpm-lock.yaml` → ` pnpm-lock.yaml | 6 ++++++` (importers section only, no new resolved package version).

## Task Commits

Each task was committed atomically:

1. **Task 1: WR-05 membershipOfRecord + scoped bootstrap select** - `6c7db26` (fix)
2. **Task 2: WR-06 by-host lookup timeout** - RED `7890d2f` (test) → GREEN `da1b83d` (feat)
3. **Task 3: WR-07 upload hook error boundary** - RED `f01b0fd` (test, includes the two devDependencies + lockfile) → GREEN `b452118` (feat)

**Plan metadata:** see the final `docs(02-18)` commit.

## Verification results

Every `<verify>` command of the plan was run and was green:

| Command | Result |
|---|---|
| `pnpm --filter @tria/core test -- membership-scope` | 16 files / 119 tests passed (whole core suite) |
| `pnpm --filter @tria/core typecheck && lint` | green (94 files) |
| `pnpm --filter @tria/api typecheck && lint && test` | green (45 files; 3 files / 15 tests) |
| `pnpm test:integration -- bootstrap invites` | 16 files / 180 tests passed (whole integration suite, twice: after Task 1 and at plan end) |
| `pnpm --filter @tria/web test -- tenant-host proxy` / `pnpm --filter @tria/web test` | 9 files / 63 tests passed (tenant-host 3, LogoUpload 4, proxy 11 unchanged) |
| `pnpm --filter @tria/web typecheck && lint` | green (`next typegen` + tsc; Biome 170 files) |
| `bash scripts/check-ui-literals.sh` | OK — no pt-BR/hex literal added to a `.tsx` |
| devDependency check (`node -e …`) | both versions pinned |

## Files Created/Modified

- `packages/core/server/tenancy/membership-scope.ts` - `membershipOfRecord(ctx): SQL` with the three predicates and an explicit empty-clause guard
- `packages/core/tests/membership-scope.test.ts` - PgDialect rendering: all three column predicates, `params === [tenantId, userId]`, never user-only
- `apps/api/src/routes/me.ts` - bootstrap membership select `.where(membershipOfRecord(ctx))` + the WR-05 comment; `eq` still used by the tenants/users selects
- `apps/web/lib/tenant-host.ts` - `HOST_LOOKUP_TIMEOUT_MS = 2_000`, `signal: AbortSignal.timeout(...)`, docblock sentence
- `apps/web/lib/tenant-host.test.ts` - hanging fetch (settles only on abort) → generic within budget; error TTL; healthy 200 → tenant with a signal
- `apps/web/components/platform/LogoUpload.tsx` - try/catch around `onFile`, `platform.branding.upload_failed` log, hook docblock
- `apps/web/components/platform/LogoUpload.test.ts` - first happy-dom hook test in apps/web (rejected start / complete / transfer, second drop accepted)
- `apps/web/package.json`, `pnpm-lock.yaml` - the two devDependencies (importers-only lockfile change)

## Decisions Made

- `membershipOfRecord` throws on an (impossible) empty `and()` instead of using a non-null assertion — Biome-friendly and honest about the `SQL | undefined` typing.
- The 2 s budget reuses the existing `catch` path unchanged (log + `TTL_ERROR_MS`), so the timeout cannot introduce a new answer shape — only `generic`.
- `try` + `catch` only in the hook (no `finally`): the success path already resets state before `onCompleted`, and a `finally` calling `fail` would wipe the completed view's toast.
- RED evidence for vitest-based TDD tasks: `--reporter=tap-flat` with the node:test trailer appended from the `ok`/`not ok` lines — the gsd checker parses only node:test TAP. Both RED runs classified `RED_EVIDENCE_OK`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Typed the `onCompleted` mock so `tsc` accepts the hook props**
- **Found during:** Task 3 (GREEN gate `pnpm --filter @tria/web typecheck`)
- **Issue:** `vi.fn()` without a signature is `Mock<Procedure | Constructable>`, not assignable to `(view: BrandingView) => void`
- **Fix:** `vi.fn<(view: BrandingView) => void>()` (test file only)
- **Files modified:** apps/web/components/platform/LogoUpload.test.ts
- **Verification:** `pnpm --filter @tria/web typecheck` green
- **Committed in:** b452118

**2. [Rule 1 - Bug] Reworded the catch comment that contained the word "finally"**
- **Found during:** Task 3 acceptance criteria (`grep -c "finally" … == 0`)
- **Issue:** the explanatory comment said "No `finally`", which the acceptance grep counts
- **Fix:** comment now reads "Kept as try + catch only"
- **Files modified:** apps/web/components/platform/LogoUpload.tsx
- **Verification:** grep count 0; behaviour unchanged
- **Committed in:** b452118

**3. [Rule 3 - Blocking] Biome formatting of the two new test files / the re-indented hook**
- **Found during:** Tasks 2 and 3 (`pnpm --filter @tria/web lint`)
- **Issue:** the formatter wanted the `it(…, 10_000)` call and the try-block re-indentation on its own lines
- **Fix:** `biome format --write`; whitespace only
- **Files modified:** apps/web/lib/tenant-host.test.ts (in da1b83d), apps/web/components/platform/LogoUpload.tsx + LogoUpload.test.ts (in b452118)
- **Verification:** Biome check green, tests green

---

**Total deviations:** 3 auto-fixed (2 blocking tooling fixes, 1 wording fix). **Impact on plan:** none on behaviour or scope — all inside the task's own files.

## Issues Encountered

- The `-- membership-scope` / `-- bootstrap invites` / `-- tenant-host proxy` filters run their whole suites (as the plan and 02-05/02-08 SUMMARY note); single-file iteration used `pnpm --filter … exec vitest run <file>`.
- `gsd_run check tdd-red-evidence` reports `zero_tests_discovered` for vitest's nested TAP; the flat reporter plus the computed trailer resolves it (documented under Decisions).

## TDD Gate Compliance

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 2 (WR-06) | `7890d2f` test(02-18) — RED_EVIDENCE_OK | `da1b83d` feat(02-18) | not needed |
| 3 (WR-07) | `f01b0fd` test(02-18) — RED_EVIDENCE_OK | `b452118` feat(02-18) | not needed |

## Known Stubs

None — no placeholder values, TODOs or unwired data sources were introduced.

## Threat Flags

None beyond the plan's register: T-02-145..148 and T-02-SC are mitigated as planned (no new endpoint, auth path, file access pattern or schema change).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- WR-05, WR-06 and WR-07 are closed and pinned; 02-19 (remaining review items) and 02-20 (final gate / `pnpm verify`) can proceed. Nothing in this plan touches 02-17's or 02-19's files.
- `apps/web` now supports hook/component tests under happy-dom — later panel/UI plans can add component-level tests without new dependencies.

---
*Phase: 02-tenant-shell-branding-platform-panel*
*Completed: 2026-09-17*

## Self-Check: PASSED

All 4 created files exist on disk and all 5 task commits (6c7db26, 7890d2f, da1b83d, f01b0fd, b452118) are in the git log.
