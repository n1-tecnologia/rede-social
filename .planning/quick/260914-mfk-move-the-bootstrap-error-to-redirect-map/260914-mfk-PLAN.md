---
phase: quick-260914-mfk
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/lib/bootstrap.ts
  - apps/web/lib/platform.ts
  - apps/web/app/(app)/layout.tsx
  - apps/web/app/(app)/inicio/page.tsx
autonomous: true
requirements: [AUTH-06, TENANT-01]
tags: [nextjs, app-router, redirect, error-handling, web]

estimate:
  tokens: 45000
  raw_tokens: 45000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A blocked member reloading /inicio is redirected to /acesso-suspenso?t=<tenant> and the Next dev/prod log contains NO ApiClientError render error for that request (AUTH-06, D-09)"
    - "A member on another tenant's host (or on the platform host) is redirected to /endereco-invalido with no ApiClientError render error (TENANT-01, D-23)"
    - "A session with no membership is redirected to /sem-comunidade with no ApiClientError render error"
    - "An expired session between proxy.ts and the API (401) still lands on /entrar"
    - "The 401/403 -> redirect mapping for bootstrap exists in exactly one place: requireBootstrap() in apps/web/lib/bootstrap.ts"
    - "GET /v1/me/bootstrap is still called once per render (React cache dedupe between layout and page preserved)"
  artifacts:
    - "apps/web/lib/bootstrap.ts exports requireBootstrap() (and keeps the cache()d getBootstrap())"
    - "apps/web/lib/platform.ts exports requirePlatformTenants() (and keeps the cache()d getPlatformTenants())"
    - "apps/web/app/(app)/layout.tsx and apps/web/app/(app)/inicio/page.tsx call the require* helpers and contain no try/catch redirect mapping"
  key_links:
    - "requireBootstrap() -> getBootstrap() (cached) -> redirect(): both segments throw NEXT_REDIRECT, so Next treats the concurrent layout+page rejection as a redirect, not an error"
    - "requirePlatformTenants() -> getPlatformTenants() (cached) -> redirect(): same shape for the platform host branch"
---

<objective>
Move the bootstrap error-to-redirect mapping (401 -> /entrar, MEMBERSHIP_BLOCKED -> /auth/blocked?t=<tenantName>, TENANT_HOST_MISMATCH -> /auth/host-mismatch, NO_MEMBERSHIP -> /sem-comunidade, anything else rethrown) out of `apps/web/app/(app)/layout.tsx` into a single `requireBootstrap()` helper in `apps/web/lib/bootstrap.ts`, and call it from BOTH the layout and `apps/web/app/(app)/inicio/page.tsx`. Apply the identical fix to the platform-host branch with a `requirePlatformTenants()` twin in `apps/web/lib/platform.ts` (401 -> /entrar; FORBIDDEN or TENANT_HOST_MISMATCH -> /auth/host-mismatch; anything else rethrown), because `inicio/page.tsx:40` has the same uncaught call and `e2e/platform.spec.ts` test 2 exercises it.

Purpose: the App Router renders layout and page concurrently; both await the same React-`cache`d promise. Today the layout catches the `ApiClientError` and calls `redirect()` (which wins), while the page's copy of the rejection is unhandled and Next logs `⨯ Error [ApiClientError]: API 403 MEMBERSHIP_BLOCKED` with a `digest`. Harmless to the user, but every legitimate 401/403 redirect would reach Sentry/Cloud Logging as a false error in production. Once both segments go through the helper, both end with NEXT_REDIRECT and nothing is logged as an error.

Output: `requireBootstrap()` + `requirePlatformTenants()`; layout and page with no redirect mapping of their own; a captured dev-server log proving the error line is gone; e2e still 34/34 on `mobile-chromium`; typecheck and lint clean.
</objective>

<execution_context>
@./.claude/gsd-core/workflows/execute-plan.md
@./.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@apps/web/lib/bootstrap.ts
@apps/web/lib/platform.ts
@apps/web/app/(app)/layout.tsx
@apps/web/app/(app)/inicio/page.tsx
@apps/web/playwright.config.ts
@apps/web/e2e/blocked.spec.ts
@apps/web/e2e/platform.spec.ts
@apps/web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md

Facts the executor must not rediscover:
- `getBootstrap` and `getPlatformTenants` are React `cache()` wrappers; keep them exported and cached. The new helpers wrap them; they must NOT add a second API call.
- Next 16 rule (redirect.md, "Behavior"): `redirect()` throws NEXT_REDIRECT, so it must be called OUTSIDE the `try` block. Compute the target path in the `catch`, then call `redirect(path)` after the try/catch. Do not use `unstable_rethrow` (the try only wraps the fetch, never a Next API).
- The four redirect targets are Route Handlers / pages that already exist: `app/auth/blocked/route.ts`, `app/auth/host-mismatch/route.ts`, `app/(auth)/sem-comunidade/page.tsx`, `app/(auth)/entrar/page.tsx`. Nothing under `app/auth/*` changes.
- Playwright (`apps/web/playwright.config.ts`) has `reuseExistingServer: true` for both the API (`http://localhost:8787/v1/health`) and the web app (`http://localhost:3000/entrar`), so servers the executor starts by hand are reused, and their stdout/stderr can be redirected to a file. `apps/web/.env.local` already exists (SEED_PASSWORD, SUPER_ADMIN_*). The local Supabase stack is already running; use `pnpm supabase` if you ever need the CLI, never the global binary.
- The full `mobile-chromium` project is 34 tests in 9 files (`playwright test --project=mobile-chromium --list`).
- The Bash tool blocks foreground `sleep`; wait for readiness with curl's own retry loop: `curl -sf --retry 60 --retry-delay 2 --retry-all-errors --retry-connrefused -o /dev/null <url>`.
- Quick-task commit convention: the commit subject must contain `quick-260914-mfk` (the orchestrator scopes review by `git log --grep=260914-mfk`) and every commit ends with the trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. Do not commit `.planning/` artifacts or log files.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Reproduce the false render error with a captured dev-server log (proves the detector before the fix)</name>
  <files>(none — read-only reproduction; creates log files in the session scratchpad only)</files>
  <action>
Set `LOGDIR` to a fresh directory inside the session scratchpad (e.g. `$SCRATCHPAD/quick-260914-mfk`) and create it. From the repo root start the two dev servers as detached background commands (the Bash tool's `run_in_background`), appending stdout+stderr to files:
- API: `pnpm --filter @rede-social/api dev >> "$LOGDIR/api.log" 2>&1`
- Web: `pnpm --filter @rede-social/web dev >> "$LOGDIR/web-before.log" 2>&1`

Wait for readiness with curl retry loops on `http://localhost:8787/v1/health` and `http://localhost:3000/entrar` (see context; no `sleep`).

Run only the two specs that exercise the 403 paths, on the phone project:
`pnpm --filter @rede-social/web exec playwright test --project=mobile-chromium e2e/blocked.spec.ts e2e/platform.spec.ts`
They are expected to PASS (the bug is log-only). Then inspect `$LOGDIR/web-before.log`:
- sanity: it must contain Next request lines for the redirect (`GET /inicio 307`); if it does not, the log capture is wrong — fix the capture (not the code) before continuing;
- reproduction: it must contain the unhandled render error for the page (`ApiClientError` with `MEMBERSHIP_BLOCKED`, and normally also `NO_MEMBERSHIP` from the orphan test and `FORBIDDEN` from platform test 2).
Record the matched lines (a `grep -n 'ApiClientError'` excerpt) for the SUMMARY. Leave both servers running for Task 3.
  </action>
  <verify>
    <automated>test "$(grep -c 'ApiClientError' "$LOGDIR/web-before.log")" -ge 1 && grep -q 'MEMBERSHIP_BLOCKED' "$LOGDIR/web-before.log" && grep -q 'GET /inicio 307' "$LOGDIR/web-before.log"</automated>
  </verify>
  <done>Both spec files pass and `$LOGDIR/web-before.log` contains at least one `ApiClientError` render-error line for a 403 that the user never saw as an error — the capture method demonstrably detects the bug.</done>
</task>

<task type="auto">
  <name>Task 2: requireBootstrap() and requirePlatformTenants() helpers; layout and page switch to them</name>
  <files>apps/web/lib/bootstrap.ts, apps/web/lib/platform.ts, apps/web/app/(app)/layout.tsx, apps/web/app/(app)/inicio/page.tsx</files>
  <!-- planner-discipline-allow: ApiClientError -->
  <!-- planner-discipline-allow: next/navigation -->
  <!-- planner-discipline-allow: getBootstrap() -->
  <!-- planner-discipline-allow: getPlatformTenants() -->
  <!-- planner-discipline-allow: auth/blocked -->
  <action>
**apps/web/lib/bootstrap.ts** — keep `ApiClientError`, `readEnvelope` and the `cache()`d `getBootstrap` exactly as they are (React dedupe is the point: one `GET /v1/me/bootstrap` per render). Add, importing `redirect` from `next/navigation`:
1. `export async function loadOrRedirect<T>(load: () => Promise<T>, redirectPathFor: (error: ApiClientError) => string | null): Promise<T>` — the ONE mechanism that turns an API refusal into a navigation. Inside a `try` it returns `await load()`. In the `catch`: if the error is not an `ApiClientError`, rethrow; compute `redirectPathFor(error)`; if `null`, rethrow the original error (unknown codes and 5xx must still surface as real errors); otherwise remember the path. AFTER the try/catch call `redirect(path)` (Next 16 rule: `redirect()` throws NEXT_REDIRECT and must not be inside the `try`). `redirect` returns `never`, so the `Promise<T>` signature type-checks.
2. `export function bootstrapRedirectPath(error: ApiClientError): string | null` — the mapping moved verbatim from the layout: `status === 401` -> `/entrar`; code `MEMBERSHIP_BLOCKED` -> `/auth/blocked?t=` + `encodeURIComponent(String(error.details?.tenantName ?? ''))` (AUTH-06 / D-09: the tenant display name is the only detail carried); `TENANT_HOST_MISMATCH` -> `/auth/host-mismatch` (TENANT-01 / D-23: no query string, the screen must not name either tenant); `NO_MEMBERSHIP` -> `/sem-comunidade`; anything else -> `null`.
3. `export async function requireBootstrap(): Promise<Bootstrap>` = `loadOrRedirect(getBootstrap, bootstrapRedirectPath)`.
Move the explanatory comments from the layout (why each 403 goes to a Route Handler under `/auth/*` that clears cookies; D-09; D-23; orphan identity) onto these functions so the rationale survives, and update the `getBootstrap` JSDoc so it no longer claims the layout does the 401 redirect / "403 codes are handled by plan 01-05" — point to `requireBootstrap` instead, and state explicitly that screens rendered concurrently with the layout must use `requireBootstrap()` so no segment is left with an unhandled rejection.

**apps/web/lib/platform.ts** — keep the `cache()`d `getPlatformTenants` and its envelope parsing untouched (do not refactor it to share `readEnvelope`; out of scope). Add `export function platformRedirectPath(error: ApiClientError): string | null` — `status === 401` -> `/entrar`; code `FORBIDDEN` or `TENANT_HOST_MISMATCH` -> `/auth/host-mismatch`; else `null` — and `export async function requirePlatformTenants(): Promise<PlatformTenants>` = `loadOrRedirect(getPlatformTenants, platformRedirectPath)` (import `loadOrRedirect` from `@/lib/bootstrap`, next to the existing `ApiClientError` import). Carry the D-21/D-23 comment from the layout ("a 200 from /v1/platform/tenants IS the proof this session is a platform_admin on the right host...") onto `requirePlatformTenants`.

**apps/web/app/(app)/layout.tsx** — delete both try/catch blocks. Platform branch: `await requirePlatformTenants();` then render the platform `TopBar` as today. Tenant branch: `const { tenant } = await requireBootstrap();` and render `TopBar` with `tenant.displayName`. Remove the now-unused imports (`redirect` from `next/navigation`, `ApiClientError`/`getBootstrap` from `@/lib/bootstrap`, `getPlatformTenants` from `@/lib/platform`) and import the two `require*` helpers instead. Keep `getHostTenant`, `getTranslations`, `TopBar`, the `logout` form and the D-08 JSDoc unchanged; shorten the moved comments to one line pointing at the helper.

**apps/web/app/(app)/inicio/page.tsx** — line 40: `getPlatformTenants()` -> `requirePlatformTenants()`; line 64: `getBootstrap()` -> `requireBootstrap()`; adjust the two imports accordingly. Everything else on the page (example module widget, translations, claims read) stays as is. The "deduped with the layout by React cache" comments remain true — keep them.

Do not touch `apps/web/app/auth/*` route handlers, `proxy.ts`, or any e2e spec.
  </action>
  <verify>
    <automated>cd . && pnpm --filter @rede-social/web typecheck && pnpm --filter @rede-social/web lint && grep -q 'export async function requireBootstrap' apps/web/lib/bootstrap.ts && grep -qF 'export const getBootstrap = cache(' apps/web/lib/bootstrap.ts && grep -q 'export async function requirePlatformTenants' apps/web/lib/platform.ts && grep -qF 'export const getPlatformTenants = cache(' apps/web/lib/platform.ts && grep -v '^\s*[/*]' apps/web/lib/bootstrap.ts | grep -q 'auth/blocked' && ! grep -rq 'auth/blocked' 'apps/web/app/(app)' && ! grep -q 'ApiClientError' 'apps/web/app/(app)/layout.tsx' && ! grep -q 'next/navigation' 'apps/web/app/(app)/layout.tsx' && ! grep -qF 'getBootstrap()' 'apps/web/app/(app)/layout.tsx' 'apps/web/app/(app)/inicio/page.tsx' && ! grep -qF 'getPlatformTenants()' 'apps/web/app/(app)/layout.tsx' 'apps/web/app/(app)/inicio/page.tsx' && grep -qF 'requireBootstrap()' 'apps/web/app/(app)/inicio/page.tsx' && grep -qF 'requirePlatformTenants()' 'apps/web/app/(app)/inicio/page.tsx'</automated>
  </verify>
  <done>Typecheck and Biome are clean; `requireBootstrap`/`requirePlatformTenants` exist next to their still-`cache()`d loaders; the `/auth/blocked` mapping appears once in `lib/bootstrap.ts` and nowhere under `app/(app)`; the layout imports neither `redirect` nor `ApiClientError`; both call sites in `inicio/page.tsx` use the `require*` helpers.</done>
</task>

<task type="auto">
  <name>Task 3: Prove the error line is gone, keep e2e at 34/34, commit</name>
  <files>(commit of the four files from Task 2; log files in the scratchpad only)</files>
  <action>
Restart the web dev server so the after-fix log is unambiguous: stop whatever listens on :3000 (`lsof -ti:3000 | xargs -r kill`, verify with a second `lsof -ti:3000` that it is gone; escalate to `kill -9` only if it survived), then start it again as a detached background command appending to a NEW file: `pnpm --filter @rede-social/web dev >> "$LOGDIR/web-after.log" 2>&1`, and wait for `http://localhost:3000/entrar` with the curl retry loop. Leave the API from Task 1 running (`api.log`).

1. Targeted re-run of the same two specs: `pnpm --filter @rede-social/web exec playwright test --project=mobile-chromium e2e/blocked.spec.ts e2e/platform.spec.ts` — must pass, and `web-after.log` must contain the `GET /inicio 307` redirect lines (proof the log is live) but ZERO `ApiClientError` lines.
2. Full suite, with the runner output kept for the verify step: `pnpm --filter @rede-social/web exec playwright test --project=mobile-chromium 2>&1 | tee "$LOGDIR/e2e-full.log"` — must report `34 passed` (check `${PIPESTATUS[0]}`/`$pipestatus[1]` is 0, not just the tee). Re-check `web-after.log` afterwards: still zero `ApiClientError` lines across the whole suite.
3. Commit ONLY the four source files (`git add apps/web/lib/bootstrap.ts apps/web/lib/platform.ts "apps/web/app/(app)/layout.tsx" "apps/web/app/(app)/inicio/page.tsx"`) with an English message whose subject contains the quick id, e.g. `fix(quick-260914-mfk): route bootstrap 401/403 to redirects through one requireBootstrap() helper`, a short body explaining the concurrent layout+page render and the false `⨯ ApiClientError` log, and the mandatory trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. Do not stage `.planning/`, `apps/web/AGENTS.md` (if `next dev` re-touched it) or any log.
4. Cleanup: stop both dev servers (`lsof -ti:3000,8787 | xargs -r kill`) so the environment is left as it was found (nothing running). Put the before/after grep counts in the SUMMARY.
  </action>
  <verify>
    <automated>cd . && grep -q 'GET /inicio 307' "$LOGDIR/web-after.log" && test "$(grep -c 'ApiClientError' "$LOGDIR/web-after.log")" -eq 0 && test "$(grep -c 'ApiClientError' "$LOGDIR/web-before.log")" -ge 1 && grep -q '34 passed' "$LOGDIR/e2e-full.log" && MSG=$(git log -1 --format=%B) && printf '%s\n' "$MSG" | grep -q 'quick-260914-mfk' && printf '%s\n' "$MSG" | grep -qF 'Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>' && RAW=$(git diff-tree --no-commit-id --name-only -r HEAD) && FILES=$(printf '%s\n' "$RAW" | LC_ALL=C sort | tr '\n' ' ') && test "$FILES" = "apps/web/app/(app)/inicio/page.tsx apps/web/app/(app)/layout.tsx apps/web/lib/bootstrap.ts apps/web/lib/platform.ts "</automated>
  </verify>
  <done>`web-before.log` shows the ApiClientError render error and `web-after.log` (same specs, then the full suite) shows the 307 redirects with zero ApiClientError lines; `mobile-chromium` is 34/34; one commit containing `quick-260914-mfk` and the required trailer holds exactly the four source files; no dev servers left running.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Next.js server -> API (`/v1/me/bootstrap`, `/v1/platform/tenants`) | The API's error envelope (status + code + details) is untrusted input that now drives a redirect target computed in `lib/` instead of the layout |
| Next.js server -> browser (redirect `Location`) | Redirect URLs may carry a query string (`?t=<tenantName>`) |
| Server logs -> Sentry / Cloud Logging | What is logged as an error is what on-call people act on |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-q260914-01 | Information disclosure | `bootstrapRedirectPath` / `platformRedirectPath` | medium | mitigate | Mapping moved verbatim: only `MEMBERSHIP_BLOCKED` carries `tenantName` (D-09), still `encodeURIComponent`-encoded; `TENANT_HOST_MISMATCH` and the platform `FORBIDDEN` case redirect with no query string (D-23). Gated by `host-mismatch.spec.ts` and `platform.spec.ts`, which assert the page text names no tenant and the URL has no search part |
| T-q260914-02 | Tampering (open redirect) | `loadOrRedirect` | low | mitigate | Redirect targets are hard-coded relative paths chosen by code; nothing from the envelope is interpolated except the encoded `tenantName` value inside a fixed path |
| T-q260914-03 | Elevation of privilege | unknown envelope codes / 5xx | medium | mitigate | `redirectPathFor` returning `null` rethrows the original `ApiClientError`: a refusal the mapping does not know is still a hard render error, never a silent render of the private shell |
| T-q260914-04 | Repudiation / alert fatigue | Next error log -> Sentry | medium | mitigate | This change: legitimate 401/403 redirects no longer emit `⨯ ApiClientError` with a digest, so real render errors stay distinguishable in production logs (verified by the captured before/after logs in Tasks 1 and 3) |
| T-q260914-SC | Tampering | npm installs | low | accept | No packages are added or upgraded by this task; `pnpm install` is not run |
</threat_model>

<verification>
- `pnpm --filter @rede-social/web typecheck` and `pnpm --filter @rede-social/web lint` clean.
- `pnpm --filter @rede-social/web exec playwright test --project=mobile-chromium` -> 34 passed.
- Captured dev-server log: `ApiClientError` count >= 1 before the change (Task 1), == 0 after (Task 3), with `GET /inicio 307` present in both (the log is live).
- Grep gates: the four redirect targets live once in `lib/bootstrap.ts` (plus the platform pair in `lib/platform.ts`) and nowhere under `app/(app)`.
</verification>

<success_criteria>
- Blocked member, host mismatch, no-membership and expired-session flows behave exactly as before for the user (same URLs, same cleared cookies) — the existing e2e proves it.
- Next no longer logs an unhandled `ApiClientError` render error for those redirects: both the layout and `/inicio` end with NEXT_REDIRECT.
- The error-to-redirect mapping exists in exactly one place per loader (`requireBootstrap`, `requirePlatformTenants`), sharing one `loadOrRedirect` mechanism; React `cache` dedupe is preserved.
- One code commit tagged `quick-260914-mfk` with the required co-author trailer.
</success_criteria>

<output>
Create `.planning/quick/260914-mfk-move-the-bootstrap-error-to-redirect-map/260914-mfk-SUMMARY.md` when done (with `status: complete` in the frontmatter), including the before/after `grep -c 'ApiClientError'` counts and the e2e result line.
</output>
