---
phase: quick-260914-mfk
plan: 01
subsystem: web
tags: [nextjs, app-router, redirect, error-handling, web, observability]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "(app) layout + /inicio, getBootstrap()/getPlatformTenants() cache()d loaders, /auth/* sign-out Route Handlers, e2e blocked/platform/host-mismatch specs"
provides:
  - "loadOrRedirect<T>() — the single mechanism turning an ApiClientError into a Next redirect (redirect() called outside the try)"
  - "bootstrapRedirectPath() + requireBootstrap() in apps/web/lib/bootstrap.ts"
  - "platformRedirectPath() + requirePlatformTenants() in apps/web/lib/platform.ts"
  - "(app) layout and /inicio with no try/catch redirect mapping of their own"
affects: [web-screens-inside-app-layout, phase-02-feed, observability, sentry]

# Actuals (#2632) — same estimateTokens scale as the plan's estimate (chars/4 over the realized diff)
actuals:
  tokens: 3329
  tasks: 3
  commits: 1
plan_head_before: c94df877341271e88af51e08e1c300e50c64fa00

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "require*() helpers: every segment rendered concurrently with the (app) layout calls requireBootstrap()/requirePlatformTenants(), never the raw cache()d loader, so every segment ends with NEXT_REDIRECT"
    - "loadOrRedirect(load, redirectPathFor): compute the path in the catch, call redirect() after the try/catch (Next 16 rule); unknown codes / 5xx / non-API errors are rethrown"

key-files:
  created: []
  modified:
    - apps/web/lib/bootstrap.ts
    - apps/web/lib/platform.ts
    - apps/web/app/(app)/layout.tsx
    - apps/web/app/(app)/inicio/page.tsx

key-decisions:
  - "Redirect mapping lives once per loader (bootstrapRedirectPath, platformRedirectPath) on top of one shared loadOrRedirect(); the layout and pages own no try/catch"
  - "Unknown envelope codes and 5xx still rethrow the original ApiClientError (never a silent render of the private shell)"
  - "Seeded member@tria-demo.local was found `blocked` in the local DB before this task; restored to `active` (seed default) as an environment fix, not a code change"

patterns-established:
  - "Pattern: screens under app/(app) call requireBootstrap() / requirePlatformTenants(); getBootstrap()/getPlatformTenants() stay cache()d and are not called from screens"

requirements-completed: [AUTH-06, TENANT-01]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "Blocked member reload of /inicio redirects to /acesso-suspenso?t=<tenant> with NO ApiClientError render error in the Next log"
    requirement: AUTH-06
    verification:
      - kind: e2e
        ref: "apps/web/e2e/blocked.spec.ts#AUTH-06/D-09 — blocked on the next request, session cleared, same screen on re-login"
        status: pass
      - kind: other
        ref: "grep -c 'ApiClientError' web-after.log == 0 (was 12 in web-before.log) with 'GET /inicio 307' present in both"
        status: pass
    human_judgment: false
  - id: D2
    description: "Member on another tenant's host / on the platform host redirects to /endereco-invalido (no query string) with no ApiClientError render error"
    requirement: TENANT-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/host-mismatch.spec.ts (3 tests) + apps/web/e2e/platform.spec.ts#2,#3"
        status: pass
      - kind: other
        ref: "grep -c 'ApiClientError' web-after.log == 0 across the full 34-test suite"
        status: pass
    human_judgment: false
  - id: D3
    description: "Session with no membership redirects to /sem-comunidade; expired session (401) still lands on /entrar"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/blocked.spec.ts#orphan identity — a session with no membership lands on /sem-comunidade; apps/web/e2e/login.spec.ts#a logged-out visit to /inicio redirects to /entrar"
        status: pass
    human_judgment: false
  - id: D4
    description: "401/403 -> redirect mapping exists in exactly one place per loader; GET /v1/me/bootstrap still called once per render (React cache kept)"
    verification:
      - kind: other
        ref: "Task 2 grep gates: 'auth/blocked' once in lib/bootstrap.ts (non-comment) and nowhere under app/(app); layout imports neither redirect nor ApiClientError; getBootstrap/getPlatformTenants still `= cache(`"
        status: pass
      - kind: other
        ref: "pnpm --filter @tria/web typecheck && pnpm --filter @tria/web lint"
        status: pass
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-09-14
status: complete
---

# Quick Task 260914-mfk: Move the bootstrap error-to-redirect map into requireBootstrap() Summary

**One `loadOrRedirect()` mechanism with `requireBootstrap()` / `requirePlatformTenants()` twins, called by both the `(app)` layout and `/inicio`, so every legitimate 401/403 redirect ends in NEXT_REDIRECT on every concurrently rendered segment — the false `⨯ Error [ApiClientError]` render log is gone (12 lines before, 0 after) and e2e stays 34/34.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-09-14T20:22:46Z
- **Completed:** 2026-09-14T20:43:29Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Reproduced the bug with a captured dev-server log before touching code: 6 `⨯ Error [ApiClientError]` render errors (12 matching lines counting stack frames) for `MEMBERSHIP_BLOCKED` x2, `NO_MEMBERSHIP` x2, `FORBIDDEN`, `TENANT_HOST_MISMATCH`, while the users only ever saw `GET /inicio 307` redirects.
- `apps/web/lib/bootstrap.ts`: added `loadOrRedirect<T>(load, redirectPathFor)` (redirect target computed in the `catch`, `redirect()` called after the try/catch per the Next 16 rule; non-`ApiClientError`, unknown codes and 5xx rethrown), `bootstrapRedirectPath()` (401 -> `/entrar`, `MEMBERSHIP_BLOCKED` -> `/auth/blocked?t=<encoded tenantName>`, `TENANT_HOST_MISMATCH` -> `/auth/host-mismatch`, `NO_MEMBERSHIP` -> `/sem-comunidade`, else `null`) and `requireBootstrap()`. `getBootstrap` stays `cache()`d and its JSDoc now explains the concurrent layout+page rule.
- `apps/web/lib/platform.ts`: added `platformRedirectPath()` (401 -> `/entrar`; `FORBIDDEN` or `TENANT_HOST_MISMATCH` -> `/auth/host-mismatch`; else `null`) and `requirePlatformTenants()`; `getPlatformTenants` untouched and still `cache()`d.
- `(app)/layout.tsx`: both try/catch blocks deleted; `redirect`, `ApiClientError`, `getBootstrap`, `getPlatformTenants` imports removed; calls the two `require*` helpers with one-line comments pointing at them.
- `(app)/inicio/page.tsx`: the two loader calls swapped for the `require*` helpers; everything else unchanged.
- After-fix log (same two specs, then the full suite): `GET /inicio 307` x6 present, `ApiClientError` count 0, `⨯` count 0.
- Full `mobile-chromium` suite: **34 passed (27.7s)**, exit 0. Typecheck and Biome clean.

## Task Commits

1. **Task 1: Reproduce the false render error** — no commit (read-only; logs in the scratchpad only)
2. **Task 2: requireBootstrap() and requirePlatformTenants(); layout and page switch to them** — `43db3cd` (fix)
3. **Task 3: Prove the error line is gone, keep e2e at 34/34, commit** — no new commit (the fix commit above already held exactly the four files; Task 3 only proved it and cleaned up)

**Plan metadata:** committed by the orchestrator (quick-task docs commit), not by this executor.

## Files Created/Modified

- `apps/web/lib/bootstrap.ts` — `ApiClientError`, `readEnvelope`, `cache()`d `getBootstrap` kept; new `loadOrRedirect`, `bootstrapRedirectPath`, `requireBootstrap`
- `apps/web/lib/platform.ts` — `cache()`d `getPlatformTenants` kept; new `platformRedirectPath`, `requirePlatformTenants`
- `apps/web/app/(app)/layout.tsx` — no try/catch, no `next/navigation`, no `ApiClientError`; calls the helpers
- `apps/web/app/(app)/inicio/page.tsx` — calls `requirePlatformTenants()` / `requireBootstrap()`

## Evidence: before/after dev-server log

| Log | `grep -c 'ApiClientError'` | `grep -c '⨯'` | `GET /inicio 307` present |
|-----|---------------------------|---------------|---------------------------|
| `web-before.log` (Task 1, blocked + platform specs, before the fix) | **12** | 6 | yes (2 lines) |
| `web-after.log` (Task 3, same two specs then the full 34-test suite, after the fix) | **0** | 0 | yes (6 lines) |

`web-before.log` excerpt (`grep -n '⨯'`):

```
16:⨯ Error [ApiClientError]: API 403 MEMBERSHIP_BLOCKED
35:⨯ Error [ApiClientError]: API 403 MEMBERSHIP_BLOCKED
67:⨯ Error [ApiClientError]: API 403 NO_MEMBERSHIP
93:⨯ Error [ApiClientError]: API 403 FORBIDDEN
118:⨯ Error [ApiClientError]: API 403 TENANT_HOST_MISMATCH
143:⨯ Error [ApiClientError]: API 403 NO_MEMBERSHIP
```

e2e result line (`e2e-full.log`): `34 passed (27.7s)`, Playwright exit code 0.

## Decisions Made

- Kept the redirect mapping verbatim (same paths, same `encodeURIComponent` on `tenantName`, no query string for host mismatch) — the change is purely where it lives, so the existing e2e is the behavioural proof.
- `loadOrRedirect` rethrows the original `ApiClientError` when the mapping returns `null` (T-q260914-03): an unknown refusal is still a hard render error, never a silent render of the private shell.
- Did not refactor `getPlatformTenants` to share `readEnvelope` (explicitly out of scope in the plan).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Seeded `member@tria-demo.local` was `blocked` in the local DB before this task**
- **Found during:** Task 3 (first full-suite run: 26 passed, 8 failed — `example.spec` #2, `host-mismatch.spec` #1-3, `login.spec` #3 and #5, `logout.spec`, `session.spec` — every one of them a login as the seeded demo member that landed on `/acesso-suspenso?t=TRIA+Demo`)
- **Issue:** `public.memberships` had `status = 'blocked'`, `blocked_at = null` for `member@tria-demo.local`. Not caused by this task: `blocked.spec.ts` only mutates the throwaway member it creates and always writes `blocked_at = now()`; the null `blocked_at` points at an earlier manual/UAT session. `scripts/seed.ts` inserts memberships with `onConflictDoNothing()`, so re-seeding would not have repaired it either.
- **Fix:** `update public.memberships set status='active', blocked_at=null` for that one user (restores the seed default). Environment/test-data fix only; no source file changed.
- **Files modified:** none
- **Verification:** second full run `34 passed`, exit 0; `web-after.log` still 0 `ApiClientError` lines across both runs. The first run's output is kept as `e2e-full-run1-seed-member-blocked.log` in the scratchpad.
- **Committed in:** n/a (no code change)

---

**Total deviations:** 1 auto-fixed (1 blocking, environment only)
**Impact on plan:** None on the code. The 8 first-run failures were unrelated to the change (they never reached the code paths this task touched differently — they failed at login on a blocked seed account) and disappeared once the seed row was restored.

## Issues Encountered

- The `run_in_background` dev-server tasks report "failed with exit code 1" when they are killed at cleanup — expected (SIGTERM on `next dev` / `tsx watch`), not a failure of the servers while they were in use.
- `apps/web/AGENTS.md` was not re-touched by `next dev` this time; working tree is clean after the single commit.

## Known Stubs

None — no placeholder values or unwired data introduced.

## Threat Flags

None — no new network endpoint, auth path, file access or schema change. The redirect targets remain hard-coded relative paths; only the already-encoded `tenantName` is interpolated (T-q260914-01/02 unchanged).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Any new screen rendered inside `app/(app)` must call `requireBootstrap()` (or `requirePlatformTenants()` on the platform branch) rather than the raw `cache()`d loader — otherwise the false render error returns for that segment. Phase 2 (`/feed`) should follow this pattern.
- Environment left as found: nothing listening on :3000 / :8787; local Supabase stack still running and seeded (demo member back to `active`).

---
*Phase: quick-260914-mfk*
*Completed: 2026-09-14*

## Self-Check: PASSED
