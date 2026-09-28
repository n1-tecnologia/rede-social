---
phase: 01-foundation-kernel-tenancy-auth-ci-cd
plan: 05
subsystem: auth
tags: [supabase-auth, recovery, verify-otp, open-redirect, membership-blocked, tenant-host, playwright, mailpit, jose]

# Dependency graph
requires:
  - phase: 01-01
    provides: "requireAuth (verify -> membership -> blocked -> host) throwing 403 MEMBERSHIP_BLOCKED { tenantName } / NO_MEMBERSHIP / TENANT_HOST_MISMATCH; error envelope; supabase/templates/recovery.html + [auth.email.template.recovery]; ES256 signing keys; integration setup helpers (signInAs, authAdmin, adminSql, HOSTS)"
  - phase: 01-02
    provides: "@rede-social/web scaffold, proxy.ts public allow-list (/auth/*, /esqueci-senha, /redefinir-senha, /acesso-suspenso, /endereco-invalido, /sem-comunidade), lib/supabase/server.ts (HttpOnly cookies), lib/bootstrap.ts (ApiClientError), lib/tenant-host.ts (getHostTenant, signupPath), pt-BR catalog, SubmitButton, Playwright mobile-chromium + e2e/fixtures.ts"
  - phase: 01-04
    provides: "PasswordField (show/hide toggle + strength hint, D-10), the x-forwarded-host-before-host precedence in proxy.ts, e2e admin-env file-fallback pattern"
provides:
  - "Password recovery slice (AUTH-03/D-10): /esqueci-senha page + `forgot` action (one constant answer), /auth/confirm GET route (verifyOtp + `^/(?!/)` open-redirect guard), /redefinir-senha page + `reset` action (updateUser -> /inicio)"
  - "Recovery `redirectTo` derived ONLY from the request origin (x-forwarded-host before host, x-forwarded-proto defaulting to http) — no SITE_URL, no env fallback (D-22)"
  - "403 routing in apps/web/app/(app)/layout.tsx: MEMBERSHIP_BLOCKED -> /auth/blocked?t= -> /acesso-suspenso; TENANT_HOST_MISMATCH -> /auth/host-mismatch -> /endereco-invalido; NO_MEMBERSHIP -> /sem-comunidade; 401 still -> /entrar"
  - "Session-clearing Route Handlers /auth/blocked and /auth/host-mismatch (signOut scope local) — a Server Component cannot write cookies"
  - "Public screens /acesso-suspenso (tenant display name only), /endereco-invalido (no props, no cookie/header/searchParam), /sem-comunidade (host-aware sign-up CTA)"
  - "e2e helpers apps/web/e2e/mail.ts (Mailpit/Inbucket auto-probe) and apps/web/e2e/admin.ts (createMember, setMembershipStatus, removeMembership, deleteUserByEmail, closeAdmin)"
  - "Suites: e2e/recovery.spec.ts (5), e2e/blocked.spec.ts (2), e2e/host-mismatch.spec.ts (3), apps/api/tests/integration/auth-middleware.test.ts (10)"
affects: [01-06, 01-07, 01-11, 01-12, phase-2-shell]

# Actuals (#2632) — same estimateTokens scale as the plan's estimate (chars/4 over the realized diff)
actuals:
  tokens: 12900      # 51,468 chars / 4 over `git diff 671a29b..HEAD` excluding pnpm-lock.yaml; estimate was 55,000
  tasks: 2
  commits: 2         # MEASURED: git rev-list --count 671a29b..HEAD before the docs commit (#3968)
plan_head_before: 671a29bd7342b5286f465fc1991857bf2820bb2d

# Tech tracking
tech-stack:
  added: ["postgres 3.4.9 (devDependency of @rede-social/web, e2e fixtures only)"]
  patterns:
    - "Absolute URLs in the web tier come from the REQUEST: `x-forwarded-host` first, `host` as fallback, `x-forwarded-proto` defaulting to http — the same precedence proxy.ts uses, because a Server Action redirect re-enters the server on its own origin (D-22)"
    - "Constant-answer actions: `forgot` validates, optionally calls Supabase, and has exactly ONE redirect target — enumeration-safety is a structural property of the function, not a branch that happens to agree"
    - "Cookie-clearing is a Route Handler concern: the `(app)` layout (a Server Component) redirects each 403 code to /auth/{blocked,host-mismatch}, which sign out `scope: 'local'` and then land on the public screen"
    - "Privacy by construction: /endereco-invalido takes no props and reads no cookie, header or search param, so there is nothing tenant-specific for a future edit to leak (D-23)"
    - "e2e fixtures that send e-mail use ONE throwaway user per send: GoTrue throttles recovery mail PER USER (`[auth.email] max_frequency`), so a shared fixture user makes the suite flaky, not the product"
    - "Importing a private EC JWK with `jose.importJWK` requires overriding Supabase's `key_ops: ['sign','verify']` to `['sign']` — WebCrypto rejects the pair for ECDSA"

key-files:
  created:
    - apps/web/app/(auth)/esqueci-senha/page.tsx
    - apps/web/app/(auth)/esqueci-senha/actions.ts
    - apps/web/app/(auth)/redefinir-senha/page.tsx
    - apps/web/app/(auth)/redefinir-senha/actions.ts
    - apps/web/app/auth/confirm/route.ts
    - apps/web/app/auth/blocked/route.ts
    - apps/web/app/auth/host-mismatch/route.ts
    - apps/web/app/(auth)/acesso-suspenso/page.tsx
    - apps/web/app/(auth)/endereco-invalido/page.tsx
    - apps/web/app/(auth)/sem-comunidade/page.tsx
    - apps/web/e2e/mail.ts
    - apps/web/e2e/admin.ts
    - apps/web/e2e/recovery.spec.ts
    - apps/web/e2e/blocked.spec.ts
    - apps/web/e2e/host-mismatch.spec.ts
    - apps/api/tests/integration/auth-middleware.test.ts
  modified:
    - apps/web/app/(app)/layout.tsx
    - apps/web/messages/pt-BR.json
    - apps/web/package.json
    - pnpm-lock.yaml

key-decisions:
  - "`supabase/config.toml` and `supabase/templates/recovery.html` were left untouched and the local stack was NOT restarted: the `[auth.email.template.recovery]` block already existed at the END of config.toml (lines 417-420, written by 01-01) and the running GoTrue already serves it — the e2e reads a `{{ .RedirectTo }}`-shaped link out of Mailpit"
  - "`/redefinir-senha` reuses 01-04's `PasswordField` (imported as `../cadastro/[slug]/PasswordField`) instead of a plain input, so the reset screen has the same show/hide toggle and strength hint as sign-up (D-10); its show/hide/min/strength labels come from the `signup` catalog namespace rather than duplicating five keys under `reset`"
  - "`forgot.pending` (\"Enviando...\") added to messages/pt-BR.json — the catalog had `forgot.submit` but no pending label, and `SubmitButton` requires both"
  - "`postgres@3.4.9` added as a devDependency of `@rede-social/web` so `e2e/admin.ts` can write membership rows directly; the GoTrue admin API cannot create a membership and PostgREST would have meant depending on the Data API for fixtures"
  - "e2e/mail.ts probes `GET /api/v1/info` to tell Mailpit from Inbucket and implements both readers, so the suite survives a Supabase CLI upgrade that swaps the catcher again"
  - "Added an orphan-identity e2e case (`blocked.spec.ts`) plus `removeMembership()` — the plan listed the `/sem-comunidade` behaviour as a truth but specified no test for it; it is now proven rather than asserted"
  - "auth-middleware case `d2` (same claims, future `exp`, expected 200) was added next to the expired-token case so `d` cannot silently pass for the wrong reason (a typo'd issuer would also produce 401)"

patterns-established:
  - "One throwaway user per e-mail-sending e2e case; `e2e/admin.ts` owns creation/mutation/cleanup and `closeAdmin()` releases the fixture connection so Playwright can exit"
  - "403-code routing table lives in one `switch` in the `(app)` layout; every new envelope code that needs a screen is added there, never in individual pages"
  - "Integration tests that need a tenant-status flip create their OWN tenant (`e2e-susp-<ts>`) so the seeded tenants are never mutated"

requirements-completed: [AUTH-03, AUTH-06, TENANT-01]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "AUTH-03/D-10: /esqueci-senha answers \"Se existir uma conta com este e-mail, enviamos um link.\" identically for a known and an unknown address"
    requirement: AUTH-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/recovery.spec.ts#1. a known address gets the constant D-10 answer"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/recovery.spec.ts#2. an unknown address gets exactly the same answer (no enumeration, T-05-02)"
        status: pass
    human_judgment: false
  - id: D2
    description: "AUTH-03/D-22: the recovery e-mail links back to the host the member used (http://rede-demo.localhost:3000/auth/confirm...), the OTP creates a session, /redefinir-senha sets a new password (min 8) and signs the person in; the new password is the one that works afterwards"
    requirement: AUTH-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/recovery.spec.ts#3. D-22: the e-mail link returns to the host used, sets a new password and signs in"
        status: pass
    human_judgment: false
  - id: D3
    description: "T-05-01: `next` is honoured only as a relative path — an external target with a bad token lands on /esqueci-senha?erro=link-invalido on the same origin, and `//evil.example` on a VALID link falls back to /inicio"
    requirement: AUTH-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/recovery.spec.ts#4. T-05-01: an external `next` never leaves the app, even with a bad token"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/recovery.spec.ts#5. T-05-01: a protocol-relative `next` on a VALID link falls back to /inicio"
        status: pass
    human_judgment: false
  - id: D4
    description: "AUTH-06/D-09: blocking a membership takes effect on the VERY NEXT request with the same still-valid token; the web app clears the sb-* cookies and shows only \"Seu acesso a Rede Demo foi suspenso. Fale com a equipe.\"; a later login lands on the same screen; unblocking restores access"
    requirement: AUTH-06
    verification:
      - kind: e2e
        ref: "apps/web/e2e/blocked.spec.ts#AUTH-06/D-09 — blocked on the next request, session cleared, same screen on re-login"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/auth-middleware.test.ts#a. the same still-valid token is refused on the request right after the block"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/auth-middleware.test.ts#g. unblocking is equally immediate: the next request is 200 again"
        status: pass
    human_judgment: false
  - id: D5
    description: "AUTH-06 concurrency: a request in flight when the block is written may finish either way (recorded: 200 in this run); the request issued right after it is always 403 — there is no membership cache at any layer"
    requirement: AUTH-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/auth-middleware.test.ts#b. a request already in flight may finish either way; the NEXT one is always refused"
        status: pass
      - kind: other
        ref: "git diff --quiet -- packages/core/server/auth/require-auth.ts (exit 0: the middleware was not touched, so the per-request membership read stands)"
        status: pass
    human_judgment: false
  - id: D6
    description: "AUTH-06: a suspended TENANT blocks its members the same way (403 MEMBERSHIP_BLOCKED naming that tenant), and restoring the tenant restores access"
    requirement: AUTH-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/auth-middleware.test.ts#c. a member of a SUSPENDED tenant gets MEMBERSHIP_BLOCKED too"
        status: pass
    human_judgment: false
  - id: D7
    description: "AUTH-06: expired (real local ES256 key, exp in the past), forged (freshly generated key) and HS256 tokens are all 401 INVALID_TOKEN; the same claims with a future exp are 200, so the expiry case cannot pass for the wrong reason"
    requirement: AUTH-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/auth-middleware.test.ts#d. an EXPIRED token signed by the real local key -> 401 INVALID_TOKEN"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/auth-middleware.test.ts#d2. the SAME claims with a future `exp` are accepted — so (d) really tested expiry"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/auth-middleware.test.ts#e. a token signed by a FORGED ES256 key -> 401 INVALID_TOKEN"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/auth-middleware.test.ts#f. an HS256 token is refused against the EC JWKS -> 401 INVALID_TOKEN"
        status: pass
    human_judgment: false
  - id: D8
    description: "TENANT-01/D-23: a rede-demo member logging in on the rede-lab host is signed out and sees only \"Este endereço não pertence à sua comunidade.\" — no query string, no sb-* cookies, and neither \"Rede Demo\"/\"Rede Lab\"/\"rede-demo\"/\"rede-lab\" anywhere on the page; the same member works normally on a generic host (D-21) and on their own host"
    requirement: TENANT-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/host-mismatch.spec.ts#1. rede-demo member on the rede-lab host: signed out, no tenant named"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/host-mismatch.spec.ts#2. D-21: the same member on a generic host logs in normally"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/host-mismatch.spec.ts#3. the same member on their own host logs in normally"
        status: pass
    human_judgment: false
  - id: D9
    description: "AUTH-06 ordering with D-23: while blocked, the same token plus another tenant's x-tenant-host still yields MEMBERSHIP_BLOCKED; once unblocked the same header yields TENANT_HOST_MISMATCH with no `details` key and no tenant name in the body"
    requirement: TENANT-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/auth-middleware.test.ts#h. while blocked, another tenant’s host still yields MEMBERSHIP_BLOCKED (order: blocked before host)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/auth-middleware.test.ts#h2. once unblocked, the same host header yields TENANT_HOST_MISMATCH with no details (D-23)"
        status: pass
    human_judgment: false
  - id: D10
    description: "Orphan identity: a live session whose membership row disappears is sent to /sem-comunidade, which offers \"Cadastrar em Rede Demo\" at /cadastro on a tenant host (D-22)"
    requirement: TENANT-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/blocked.spec.ts#orphan identity — a session with no membership lands on /sem-comunidade"
        status: pass
    human_judgment: false

# Metrics
duration: 17min
completed: 2026-09-13
status: complete
---

# Phase 01 Plan 05: Password recovery, blocked-member and host-mismatch contracts Summary

**The two open ends of the auth story are closed: a member recovers a forgotten password through an e-mail link that comes back to the host they actually used (D-22) and ends signed in, and a member whose access is revoked — by a block, by a suspended tenant, or by arriving on another tenant's address — is cut off on the very next request, signed out, and shown exactly one sentence that names nothing it should not, proven by 10 mobile-chromium e2e cases and 10 in-process API cases against the live local stack.**

## Performance

- **Duration:** 17 min
- **Started:** 2026-09-13T14:08:25Z
- **Completed:** 2026-09-13T14:25:00Z
- **Tasks:** 2
- **Files modified:** 20 (2 task commits)

## Accomplishments

- **Password recovery (AUTH-03, D-10, D-22).** `/esqueci-senha` renders the prototype's forgot screen and its `forgot` action has exactly one redirect target, so the answer is constant whether the address exists, is malformed, or the mailer 429s. `redirectTo` is assembled from the request alone (`x-forwarded-host` before `host`, `x-forwarded-proto` defaulting to `http`) — the action imports nothing from `@/lib/env`, so there is no code path that could send a tenant's member back to the platform domain. `/auth/confirm` exchanges the one-time hash for a session (a Route Handler, so it may write the HttpOnly cookies) and honours `next` only when it matches `^/(?!/)`. `/redefinir-senha` reuses 01-04's `PasswordField` and its `reset` action calls `updateUser`, which both sets the password and leaves the person signed in.
- **Blocked member (AUTH-06, D-09).** The `(app)` layout now switches on the envelope code and hands each 403 to a Route Handler that can clear cookies. A block written to `memberships.status` while the member's token is still valid is refused on the next request, the device is signed out, and `/acesso-suspenso` shows the tenant display name and nothing else. Logging in again succeeds at Supabase level and returns to the same screen with no extra code, exactly as D-09 describes.
- **Host mismatch (TENANT-01, D-23).** `/auth/host-mismatch` takes no input and passes none along; `/endereco-invalido` takes no props and reads no cookie, header or search param. The e2e asserts the URL has no query string and that neither tenant's name or slug appears anywhere in the rendered text — the privacy property is structural, not a review note.
- **Orphan identity.** `NO_MEMBERSHIP` lands on `/sem-comunidade`, whose sign-up CTA follows the same host rules as `/entrar`: `/cadastro` on a tenant domain, `/cadastro/{cookie slug}` on a generic host, back to `/entrar` otherwise.
- **Token rejection.** `auth-middleware.test.ts` mints an expired token with the *real* local ES256 key (so `exp`, not the signature, is what rejects it), a forged one with a fresh key, and an `HS256` one against the EC JWKS — all 401 `INVALID_TOKEN`; the paired `d2` case proves the expired case is not passing for an unrelated reason.
- **Regression:** the whole web e2e suite (25 cases) and the whole API integration suite (38 cases) are green, and `pnpm turbo typecheck lint build` reports 14/14.

## Task Commits

Each task was committed atomically:

1. **Task 1: Password recovery — forgot/reset pages, confirm route with redirect guard, Mailpit e2e** — `889ac29` (feat)
2. **Task 2: Blocked member, host-mismatch and orphan-identity contracts; forged/expired token tests** — `b9e4c5c` (feat)

**Plan metadata:** see the `docs(01-05)` commit that follows this SUMMARY.

## Files Created/Modified

- `apps/web/app/(auth)/esqueci-senha/{page,actions}.tsx|ts` — forgot screen (`role="status"` live region for the D-10 sentence, `role="alert"` for an invalid link) and the constant-answer action with `requestOrigin()`
- `apps/web/app/auth/confirm/route.ts` — `verifyOtp` + the `^/(?!/)` guard + the accepted OTP-type allow-list
- `apps/web/app/(auth)/redefinir-senha/{page,actions}.tsx|ts` — `PasswordField` (min 8, show/hide, strength) and `updateUser` -> `/inicio`
- `apps/web/app/auth/blocked/route.ts`, `apps/web/app/auth/host-mismatch/route.ts` — `signOut({ scope: 'local' })` then the public screen; `blocked` truncates the echoed tenant label to 80 chars, `host-mismatch` carries nothing at all
- `apps/web/app/(auth)/{acesso-suspenso,endereco-invalido,sem-comunidade}/page.tsx` — the three public outcome screens
- `apps/web/app/(app)/layout.tsx` — the 403 routing `switch` (401 branch unchanged; the `platform`-mode branch untouched)
- `apps/web/messages/pt-BR.json` — `forgot.pending`
- `apps/web/e2e/mail.ts` — `waitForRecoveryMail` / `clearMailbox` with the Mailpit-vs-Inbucket probe
- `apps/web/e2e/admin.ts` — `createMember`, `setMembershipStatus`, `removeMembership`, `deleteUserByEmail`, `closeAdmin`; reads `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` from the process env or `apps/api/.env.local`, `PLAYWRIGHT_DB_URL` with the local default
- `apps/web/e2e/{recovery,blocked,host-mismatch}.spec.ts` — 10 cases on `mobile-chromium`
- `apps/api/tests/integration/auth-middleware.test.ts` — 10 in-process cases
- `apps/web/package.json`, `pnpm-lock.yaml` — `postgres@3.4.9` as a web devDependency (e2e fixtures only)

## Decisions Made

- **No `supabase/config.toml` change and no stack restart.** The plan warned that the `[auth.email.template.recovery]` block "already exists from plan 01-01" and to stop rather than restart. It does exist — at the very end of `config.toml` (lines 417-420), which an initial partial read of the file missed. A briefly-added duplicate block was reverted (`git checkout --`) the moment the CLI reported `trying to redefine an already defined table or value`; the committed `config.toml` is byte-identical to `HEAD`, the running GoTrue already serves the custom template, and the e2e reads a `{{ .RedirectTo }}`-shaped link straight out of Mailpit. Recorded because the diagnosis path (a `CliConfigParseError` with no detail from `supabase status`; `supabase config diff --log-level all` is the command that prints the cause) is worth reusing.
- **`PasswordField` over a plain input.** The plan allowed a plain `minLength=8` input if 01-04 had not landed. It had, so `/redefinir-senha` imports `../cadastro/[slug]/PasswordField` and the reset screen behaves exactly like sign-up. Its five label strings come from the `signup` namespace instead of being duplicated under `reset`.
- **`postgres` as a web devDependency.** `e2e/admin.ts` must insert/update/delete `memberships` rows; the GoTrue admin API cannot, and routing fixtures through PostgREST would make the test harness depend on the Data API. The dependency is dev-only and never imported by application code (Biome's `apps/web` import lane only restricts `@rede-social/core/*` and `@rede-social/api/*`).
- **One throwaway user per e-mail-sending case.** See the deviation below — this is now a stated pattern, not an accident.
- **An extra orphan-identity e2e case and an extra `d2` API case.** Both close a gap between what the plan asserted as a truth and what the specified tests actually proved.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The recovery e2e was flaky by construction: GoTrue throttles recovery mail per user**

- **Found during:** Task 1 (first full run of `recovery.spec.ts`)
- **Issue:** cases 1, 3 and 5 all requested a link for the same fixture address. GoTrue answered the second request `429 over_email_send_rate_limit` ("For security purposes, you can only request this after 0 seconds", `[auth.email] max_frequency = "1s"`) and — correctly, per D-10 — the action swallowed it, so case 3 simply waited 20 s for an e-mail that was never sent. The product behaved exactly as designed; the test shared state it should not have.
- **Fix:** each case that triggers a send now creates its own throwaway member (`newMember(tag)`), and the two cases that read a link call `clearMailbox()` first so they can never pick up an already-consumed one. The reason is documented at the top of the spec so the next person does not "simplify" it back.
- **Files modified:** `apps/web/e2e/recovery.spec.ts`
- **Verification:** 5/5 green, twice
- **Committed in:** `889ac29`

**2. [Rule 3 - Blocking] `jose.importJWK` rejects Supabase's private EC key as written**

- **Found during:** Task 2 (first run of `auth-middleware.test.ts`: 7 passed, 3 failed)
- **Issue:** `supabase/signing_keys.json` stores `key_ops: ["sign","verify"]`; WebCrypto refuses that pair for an ECDSA **private** key (`SyntaxError: Unsupported key usage for a ECDSA key`), so every case that needed the real signing key failed before reaching the API.
- **Fix:** `localSigningKey()` imports `{ ...jwk, key_ops: ['sign'] }`, with the reason in a comment.
- **Files modified:** `apps/api/tests/integration/auth-middleware.test.ts`
- **Verification:** 10/10 green
- **Committed in:** `b9e4c5c`

**3. [Rule 2 - Missing critical] `/sem-comunidade` was a stated truth with no test**

- **Found during:** Task 2 (checking the plan's `must_haves.truths` against the specified specs)
- **Issue:** the plan lists "a signed-in user with no membership is sent to `/sem-comunidade`" as a truth and ships the screen, but none of the three specified specs exercises it — the screen would have been asserted, not proven.
- **Fix:** added `removeMembership(email)` to `e2e/admin.ts` and an orphan-identity case to `blocked.spec.ts` (log in, delete the membership under the live session, next request lands on `/sem-comunidade` with the `/cadastro` CTA).
- **Files modified:** `apps/web/e2e/admin.ts`, `apps/web/e2e/blocked.spec.ts`
- **Verification:** green in the full suite
- **Committed in:** `b9e4c5c`

**4. [Rule 2 - Missing critical] The expired-token case could have passed for the wrong reason**

- **Found during:** Task 2 (writing case `d`)
- **Issue:** a 401 `INVALID_TOKEN` for a hand-minted token proves nothing on its own — a wrong issuer, audience or `kid` produces the identical answer, so `d` would "pass" even if `exp` were never checked.
- **Fix:** added `d2`, the same claims with a future `exp`, expected 200. `d` now means what it says.
- **Files modified:** `apps/api/tests/integration/auth-middleware.test.ts`
- **Verification:** both green
- **Committed in:** `b9e4c5c`

**5. [Rule 3 - Blocking] `forgot.pending` was missing from the catalog**

- **Found during:** Task 1
- **Issue:** `SubmitButton` requires a pending label and the `forgot` namespace had none; borrowing `login.pending` ("Entrando...") would have been wrong copy.
- **Fix:** added `forgot.pending = "Enviando..."`.
- **Files modified:** `apps/web/messages/pt-BR.json`
- **Committed in:** `889ac29`

---

**Total deviations:** 5 auto-fixed (2 blocking, 1 bug, 2 missing critical)
**Impact on plan:** none on scope. Two of the five strengthened evidence the plan already claimed; the other three were required to make the specified tests run at all.

## Issues Encountered

- **`CliConfigParseError` with no detail.** `supabase status` / `supabase stop` report only `failed to read config: CliConfigParseError`, which is useless for locating the offending line. `pnpm supabase config diff --log-level all` prints the real message with line numbers (`Invalid TOML document: trying to redefine an already defined table or value`, line 427). Worth knowing before 01-11 edits `config.toml` for Resend.
- **`supabase stop` was attempted once** while the duplicate config block was present and failed on the same parse error, so the stack was never actually stopped; all 10 containers stayed up for the whole plan.
- **Full-file reads matter.** The duplicate-block detour came from reading `config.toml` in two 200-line slices and stopping at 400 of 420 lines.

## Known Stubs

None. Every screen, route and action this plan specifies is wired to real data and covered by a passing test.

The broken-window this plan was supposed to close, `.planning/WINDOWS.md` entry 4 ("Only 401 handled in the bootstrap catch; 403 codes rethrow until plan 01-05"), is now marked **fixed**.

## Threat Flags

None. The three surfaces this plan adds (`/auth/confirm`, `/auth/blocked`, `/auth/host-mismatch`) are the ones the plan's threat register already covers; no new endpoint, schema change or trust boundary appeared.

## Authentication Gates

None.

## User Setup Required

None for the local stack. Real e-mail delivery (Resend as Supabase Custom SMTP, D-13) is plan 01-11's job and is verified manually per VALIDATION.md — until then recovery mail exists only in Mailpit at `http://127.0.0.1:54324`.

## Flagged assumptions — resolved

The plan flagged three unclassified AUTH-03 assumptions. Two are now answered by the run:

- **Different-browser recovery:** the token-hash flow has no PKCE cookie dependency, as assumed. Case 5 opens a link whose query string was rewritten outside the browser that requested it and still lands signed in, and the whole flow works from a fresh Playwright context. No switch to the `code` exchange is needed.
- **Which mail API the local stack exposes:** Mailpit v1.30.2 (`/api/v1/info`, `/api/v1/search`, `/api/v1/message/{id}`) behind the container still named `supabase_inbucket_rede-social`; `supabase status` reports both `MAILPIT_URL` and `INBUCKET_URL` on port 54324. `e2e/mail.ts` probes and supports both shapes.
- **Token TTL / single use:** accepted as-is (GoTrue default 1 h, `otp_expiry = 3600`); not exercised.

**In-flight request outcome (test `b`):** the request already in flight when the block was written returned **200** in this run — it had read the membership before the `UPDATE` committed. The request issued immediately afterwards returned 403, which is the property AUTH-06 actually requires. The test accepts either outcome for the in-flight request and asserts 403 unconditionally for the next one.

## Next Phase Readiness

- Every public auth path in `proxy.ts`'s allow-list now has a real page behind it; 01-06 can extend `/inicio` and the bootstrap payload without touching the auth screens.
- 01-11 must add the production and preview origins to Supabase's `additional_redirect_urls` for **both** hosted projects: the recovery link is built from the request origin, so an unlisted tenant domain silently degrades to `site_url` (GoTrue's own fallback — the T-05-08 mitigation, but a broken experience). The local globs `http://localhost:3000/**` and `http://*.localhost:3000/**` already cover development.
- 01-11 also owns the Resend SMTP block; note that `[auth.rate_limit] email_sent = 2` in `config.toml` is the built-in-provider default and needs raising once custom SMTP is on (custom SMTP starts at 30/h).
- `e2e/admin.ts` is the place to add fixtures for later phases; it already owns identity + membership + cleanup and releases its connection through `closeAdmin()`.

---
*Phase: 01-foundation-kernel-tenancy-auth-ci-cd*
*Completed: 2026-09-13*

## Self-Check: PASSED

All 17 code/test files listed above exist on disk; both task commits (`889ac29`, `b9e4c5c`) are in `git log`; `pnpm turbo typecheck lint build` (14/14), the API integration suite (38/38) and the web e2e suite (25/25 on `mobile-chromium`) were all re-run green before this SUMMARY was written.
