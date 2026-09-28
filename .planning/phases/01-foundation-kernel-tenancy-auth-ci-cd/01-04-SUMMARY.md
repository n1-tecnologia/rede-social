---
phase: 01-foundation-kernel-tenancy-auth-ci-cd
plan: 04
subsystem: auth
tags: [zod, supabase-auth, gotrue, drizzle, rls, lgpd, hono, next-app-router, playwright, server-actions]

# Dependency graph
requires:
  - phase: 01-01
    provides: kernel (withAdminTx, supabaseAdmin, ApiError/ERROR_CODES), tenants/users/memberships tables, publicRoutes with GET /v1/public/tenants/by-host, seeded rede-demo/rede-lab
  - phase: 01-02
    provides: "@rede-social/web shell — proxy.ts host resolution, getHostTenant/signupPath, HttpOnly session cookies, /entrar, SubmitButton, pt-BR catalog, e2e fixtures"
provides:
  - "@rede-social/contracts auth schemas (slug/password/login/forgot/reset/signup) shared by API, web forms and future plans"
  - versioned legal texts (packages/contracts/legal/*.md + readLegalDoc) with the one-consent-one-version invariant under test
  - consent_records table — append-only LGPD evidence, select-only RLS policy, DB-stamped accepted_at, inet ip
  - "signupMember(): autoconfirmed identity + membership + both consents in one admin-lane transaction with deleteUser compensation"
  - "public API GET /v1/public/tenants/{slug} and POST /v1/public/signup/{slug}"
  - "/cadastro sign-up page (tenant host) and /cadastro/{slug} (generic hosts) with two explicit consents, rules sheet, show-password field"
  - /termos and /privacidade legal pages rendering the versioned markdown
  - "proxy.ts host resolution now reads x-forwarded-host first — required for any Server Action redirect() to keep the tenant shell"
affects: [01-05, 01-06, 01-07, 01-08, 02, 08]

# Actuals (#2632) — same estimateTokens scale (chars/4 over changed files), not a harness token count.
actuals:
  tokens: 21000
  tasks: 3
  commits: 4
plan_head_before: c51bc0fc3c5cf9da50b043af62440e941ab96b9e

# Tech tracking
tech-stack:
  added: [vitest 5.0.0 in @rede-social/contracts]
  patterns:
    - "Shared Zod contracts: one schema object in @rede-social/contracts validates the HTTP body (API) and the form (web server action); the form schema extends the body schema with z.literal(true) consents"
    - "Append-only evidence tables: RLS enabled with a single select-only policy and no insert/update/delete policy — writes go exclusively through the admin lane"
    - "Compensating transaction: createUser (outside Postgres) then one withAdminTx for all DB rows; any failure after createUser deletes the auth identity so no orphan remains"
    - "Versioned legal texts as data: markdown front-matter version: N mirrored by a TypeScript constant, kept in sync by a unit test"
    - "Host-derived tenant on tenant domains: the server action ignores the hidden slug field and uses hostTenant.slug (D-22); generic hosts keep the D-01 path slug + tenant_slug cookie"

key-files:
  created:
    - packages/contracts/src/auth.ts
    - packages/contracts/src/legal.ts
    - packages/contracts/legal/termos-de-uso.md
    - packages/contracts/legal/politica-de-privacidade.md
    - packages/contracts/tests/legal.test.ts
    - packages/core/db/schema/consent-records.ts
    - packages/core/server/tenancy/signup.ts
    - packages/core/server/tenancy/public-tenant.ts
    - supabase/migrations/20260912214429_consent_records.sql
    - apps/api/tests/integration/signup.test.ts
    - apps/web/app/(auth)/cadastro/[slug]/page.tsx
    - apps/web/app/(auth)/cadastro/[slug]/actions.ts
    - apps/web/app/(auth)/cadastro/[slug]/RulesSheet.tsx
    - apps/web/app/(auth)/cadastro/[slug]/PasswordField.tsx
    - apps/web/app/(auth)/cadastro/[slug]/not-found.tsx
    - apps/web/app/(auth)/termos/page.tsx
    - apps/web/app/(auth)/privacidade/page.tsx
    - apps/web/e2e/signup.spec.ts
  modified:
    - apps/api/src/routes/public.ts
    - apps/web/proxy.ts
    - apps/web/next.config.ts
    - apps/web/messages/pt-BR.json
    - apps/web/app/(auth)/entrar/actions.ts
    - apps/web/app/(auth)/entrar/page.tsx
    - packages/contracts/src/index.ts
    - packages/core/db/schema/index.ts

key-decisions:
  - "GoTrue duplicate e-mail is matched on THREE shapes, not one: error.code === 'email_exists', error.code === 'user_already_exists', or a message containing 'already been registered' (422). A fourth path exists for the race: when two sign-ups collide, the loser gets an opaque 'Database error creating new user' (500) from GoTrue's own unique index, so the handler re-queries auth.users by e-mail and reclassifies a confirmed hit as 409 — a genuine outage (no such user) still answers 500."
  - "The concurrency test was KEPT, not skipped: five parallel identical sign-ups reliably produce exactly one 201 and four 409s against the local stack, with one membership and two consent rows."
  - "proxy.ts resolves the host tenant from x-forwarded-host before host. Next re-requests the destination of a Server Action redirect() on the server's own origin (host: localhost:3000) and carries the browser-facing host in x-forwarded-host; reading host first classified every post-sign-up page as a generic host and silently dropped the tenant shell."
  - "One consent, one version: the single platform_terms checkbox accepts both legal texts, so PLATFORM_PRIVACY_VERSION === PLATFORM_TERMS_VERSION is asserted by a unit test and editing either markdown must bump version: in both files and both constants."
  - "consent_records carries no insert/update/delete policy at all — inserts happen in the admin lane, so the absence of a write policy is the tamper-resistance mechanism, not an oversight."

patterns-established:
  - "Public (unauthenticated) API routes are registered literal-path-first: GET /tenants/by-host must precede GET /tenants/{slug}, because 'by-host' also matches the slug regex"
  - "Server actions redirect with an error code in the query string (?erro=email-existente) rather than returning state — never a password in a URL or a log line"
  - "Client components are minimal and leaf-level (PasswordField, RulesSheet); the page, the data fetch and the action stay on the server"

requirements-completed: [AUTH-01, AUTH-04, ROLE-02]

coverage:
  - id: D1
    description: "Shared auth Zod schemas in @rede-social/contracts (slug 3-40 lowercase, password min 8, signup body/form with literal-true consents) reused by the API and the web form"
    requirement: AUTH-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/signup.test.ts#3. boundary: a 7-character password is 400, exactly 8 is 201"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/signup.test.ts#4. boundary: slugs of 3 and 40 chars resolve; 2 and 41 are 404 TENANT_NOT_FOUND"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/signup.test.ts#5. adjacency: `Rede-Demo` is a miss, not an alias of `rede-demo`"
        status: pass
    human_judgment: false
  - id: D2
    description: "Versioned legal texts (legal/*.md front-matter + readLegalDoc) with the one-consent-one-version invariant: PLATFORM_PRIVACY_VERSION === PLATFORM_TERMS_VERSION"
    requirement: AUTH-04
    verification:
      - kind: unit
        ref: "packages/contracts/tests/legal.test.ts (4 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "consent_records: append-only LGPD evidence with a select-only RLS policy, DB-stamped accepted_at, inet ip, unique per tenant/user/kind/version"
    requirement: AUTH-04
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/signup.test.ts#1. happy path: 201, member of the tenant, two timestamped consent rows"
        status: pass
      - kind: other
        ref: "grep -c 'pgPolicy(' packages/core/db/schema/consent-records.ts == 1 (select-only; no insert/update/delete policy)"
        status: pass
    human_judgment: false
  - id: D4
    description: "signupMember: autoconfirmed createUser, then membership + both consents in ONE admin-lane transaction, with deleteUser compensation leaving no orphan identity"
    requirement: AUTH-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/signup.test.ts#9. compensation: a failing consent insert deletes the auth user, leaving no orphan identity"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/signup.test.ts#10. concurrency: five identical sign-ups yield exactly one 201 and one membership"
        status: pass
    human_judgment: false
  - id: D5
    description: "Duplicate e-mail is a 409 that never names the owning tenant, on the same tenant and across tenants (ROLE-02, T-04-01)"
    requirement: ROLE-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/signup.test.ts#7. idempotency: the same sign-up twice is 201 then 409, with one membership and two consents"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/signup.test.ts#8. ROLE-02 + T-04-01: a duplicate on another tenant is 409 and never names the first tenant"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/signup.spec.ts#3. D-04 duplicate: generic message with a link to /entrar, never naming the other tenant"
        status: pass
    human_judgment: false
  - id: D6
    description: "Public API surface: GET /v1/public/tenants/{slug} (name, rules, both versions, no-store) appended after the literal by-host route, and POST /v1/public/signup/{slug} taking X-Client-IP"
    requirement: AUTH-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/signup.test.ts#2. GET /v1/public/tenants/{slug} publishes name, rules and both versions (by-host still wins)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/signup.test.ts#6. empty/invalid: name, e-mail, missing consents and stale versions are 400 with details"
        status: pass
    human_judgment: false
  - id: D7
    description: "Sign-up page mechanics: two consent checkboxes start unchecked and are required, the rules bottom sheet shows the tenant's own rules, the show-password toggle flips the input type, 7 characters are refused, and a completed form creates a member who lands on /inicio"
    requirement: AUTH-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/signup.spec.ts#1. /cadastro (no slug, D-22) shows the D-02/D-03 form and creates a member"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/signup.spec.ts#5. D-10: the show-password toggle flips the input type and 7 characters are refused"
        status: pass
    human_judgment: false
  - id: D8
    description: "Tenant memory across the register -> logout -> login round trip: the HOST carries it on tenant domains (no cookie), the tenant_slug COOKIE carries it on generic hosts, the platform host offers no member sign-up, and unknown/mixed-case slugs are not found (D-01/D-06/D-21/D-22)"
    requirement: AUTH-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/signup.spec.ts#2. register -> Sair -> login: the tenant survives the round trip through the HOST"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/signup.spec.ts#4. D-22: the host wins — /cadastro/rede-lab on the rede-demo host lands on /cadastro"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/signup.spec.ts#6. generic host keeps /cadastro/{slug} and remembers the slug in a cookie"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/signup.spec.ts#7. generic host: an unknown slug and a mixed-case slug are both \"não encontrada\""
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/signup.spec.ts#8. D-21: the platform host offers no member sign-up"
        status: pass
    human_judgment: false
  - id: D9
    description: "/termos and /privacidade render the versioned pt-BR legal texts, and next.config.ts traces the markdown into the Vercel function bundle"
    requirement: AUTH-04
    verification:
      - kind: manual_procedural
        ref: "curl http://rede-demo.localhost:3000/termos -> 200; /privacidade renders \"Versão 1\""
        status: pass
    human_judgment: true
    rationale: "The pages render, but the CONTENT is placeholder pilot text written by the executor. A human (ideally with legal review) must sign off on the Termos de Uso and Política de Privacidade wording before a real member accepts them, since the accepted version number becomes LGPD evidence. The outputFileTracingIncludes effect is also only observable on a real Vercel build."
  - id: D10
    description: "AUTH-04 consent transparency on a real phone: two separate, visible, unchecked controls with readable copy and reachable legal links — never merged, pre-checked or collapsed"
    requirement: AUTH-04
    verification:
      - kind: e2e
        ref: "apps/web/e2e/signup.spec.ts#1 (asserts both boxes exist, start unchecked and block submission)"
        status: pass
    human_judgment: true
    rationale: "The plan's AUTH-04 prohibition is declared verification: judgment. Automation proves the boxes are separate, unchecked and required; whether the pt-BR copy and the layout are genuinely legible and non-dark-pattern on a phone is a human call."

# Metrics
duration: ~25 min (two sessions)
completed: 2026-09-13
status: complete
---

# Phase 01 Plan 04: Public sign-up (AUTH-01/AUTH-04/ROLE-02) Summary

**A person signs up at `https://{tenant-domain}/cadastro`, becomes an autoconfirmed `member` with two timestamped LGPD consent rows written in the same transaction as the membership, is signed in and lands on `/inicio` — with duplicate e-mails answered by a 409 that never names the owning tenant, and the tenant surviving the register → logout → login round trip through the host (tenant domains) or the `tenant_slug` cookie (generic hosts).**

## Performance

- **Duration:** ~25 min of execution across two sessions (session 1 — Tasks 1 and 2, ended 2026-09-12T21:53Z when the user interrupted the run; session 2 — Task 3 verification, the deviation commit and close-out, 2026-09-13T13:56Z → 14:05Z)
- **Started:** 2026-09-12T21:35Z
- **Completed:** 2026-09-13T14:05Z
- **Tasks:** 3 of 3
- **Files modified:** 32 (28 excluding `pnpm-lock.yaml` and drizzle migration metadata)

## Accomplishments

- **Sign-up API end-to-end.** `POST /v1/public/signup/{slug}` creates an autoconfirmed GoTrue identity, then writes the `member` membership and both `consent_records` rows in ONE `withAdminTx` transaction; any failure after `createUser` deletes the auth identity, so a partial sign-up can never leave an orphan login. Ten integration cases cover happy path, both password and slug boundaries, mixed-case adjacency, empty/stale input, idempotency, cross-tenant duplicates, forced-failure compensation and a five-way concurrency race.
- **LGPD evidence that cannot be rewritten.** `consent_records` has RLS enabled with exactly one policy — a `select` for the owning user in the owning tenant. There is no insert, update or delete policy: writes exist only through the admin lane, `accepted_at` comes from the DB's own `now()`, `ip` is an `inet` from the trusted `X-Client-IP` hop, and `text_version` binds each row to a versioned markdown text whose constant is kept in sync by a unit test.
- **Two explicit consents, never pre-checked.** `/cadastro` renders name, e-mail and a show/hide password field (no username, no confirm field) plus two separate unchecked required checkboxes: the tenant's rules (openable in a native `<dialog>` bottom sheet) and the platform's terms + privacy policy (links to `/termos` and `/privacidade`). `grep defaultChecked` returns zero.
- **The tenant survives the round trip both ways.** On a tenant domain the public link is `/cadastro` with no slug and the host is the sole authority — the server action ignores the hidden slug field, `/cadastro/rede-lab` on the rede-demo host lands back on `/cadastro`, and no `tenant_slug` cookie is involved. On generic hosts the D-01 `/cadastro/{slug}` path still works, sets the cookie, and `/entrar` shows "Comunidade: Rede Demo" from it. The platform host redirects both paths to `/entrar`.
- **Duplicate e-mails stay private.** A 409 `EMAIL_ALREADY_REGISTERED` carries no `details`; the page shows the generic pt-BR copy with a link to `/entrar`, and the e2e asserts the rendered body contains neither `rede-lab` nor `Rede Lab`. The cross-tenant fact is logged server-side only as `signup.duplicate_email`.

## Task Commits

1. **Task 1: Sign-up API — shared auth schemas, legal versions, consent_records, signupMember and the public routes** — `d257811` (feat)
2. **Task 2: /cadastro/[slug] sign-up page with two consents, rules bottom sheet, show-password field, legal pages** — `da24809` (feat)
3. **Task 3: Sign-up e2e on a phone viewport including the register → logout → login round trip** — `0783ca3` (test) — includes the `proxy.ts` `x-forwarded-host` fix that Task 3 uncovered
4. **Deviation follow-up (closes broken-window 3)** — `cca7d39` (docs)

**Plan metadata:** see the `docs(01-04)` commit that carries this SUMMARY.

_Tasks 1 and 2 were committed by the session-1 executor before the user interrupted it; session 2 re-verified both against their acceptance criteria and `<verify>` blocks before finishing Task 3 (all green, no rework needed)._

## Files Created/Modified

- `packages/contracts/src/auth.ts` — `slugSchema` (`^[a-z0-9-]{3,40}$`), `passwordSchema` (min 8), `loginSchema`, `forgotSchema`, `resetSchema`, `signupBodySchema`, `signupFormSchema` (adds the two `z.literal(true)` consents), `publicTenantSchema`, `signupResponseSchema`
- `packages/contracts/src/legal.ts` — `PLATFORM_TERMS_VERSION`, `PLATFORM_PRIVACY_VERSION`, `readLegalDoc()` (server-only, `node:fs`), plus the "one consent, one version" rule in the file header
- `packages/contracts/legal/{termos-de-uso,politica-de-privacidade}.md` — pt-BR pilot texts with `version: 1` front-matter
- `packages/contracts/tests/legal.test.ts` + `vitest.config.ts` — keeps constants and markdown in lockstep
- `packages/core/db/schema/consent-records.ts` — the table, its unique key and the single select-only policy
- `packages/core/server/tenancy/public-tenant.ts` — `getPublicTenant(slug)`, 404 for invalid/unknown/non-active slugs with no normalisation
- `packages/core/server/tenancy/signup.ts` — `signupMember()`, duplicate detection, compensation, `signupInternals` test seam
- `supabase/migrations/20260912214429_consent_records.sql` — generated by drizzle-kit, applied by the Supabase CLI
- `apps/api/src/routes/public.ts` — `GET /tenants/{slug}` and `POST /signup/{slug}` appended AFTER the literal `by-host` route
- `apps/api/tests/integration/signup.test.ts` — the ten cases above
- `apps/web/app/(auth)/cadastro/[slug]/{page,actions,not-found}.tsx` + `RulesSheet.tsx` + `PasswordField.tsx` — the sign-up flow
- `apps/web/app/(auth)/{termos,privacidade}/page.tsx` — versioned legal pages
- `apps/web/e2e/signup.spec.ts` — eight `mobile-chromium` cases with admin-API cleanup of every `e2e+…` user
- `apps/web/proxy.ts` — host resolution reads `x-forwarded-host` first (see deviation 1)
- `apps/web/next.config.ts` — `outputFileTracingIncludes` so the legal markdown ships in the Vercel function bundle
- `apps/web/messages/pt-BR.json` — `signup.viewRules/closeRules/termsLink/privacyLink/invalid` and the `legal` namespace
- `apps/web/app/(auth)/entrar/actions.ts` — now uses the shared `loginSchema`

## Decisions Made

- **The GoTrue duplicate error shape** (the plan asked for this explicitly): matched on `error.code === 'email_exists'`, `error.code === 'user_already_exists'`, or a message containing `already been registered` (HTTP 422). The race is a *fourth* shape — GoTrue's own unique index surfaces as an opaque `Database error creating new user` (500) — so the handler re-queries `auth.users` by e-mail and reclassifies a confirmed hit as 409 while a genuine outage (no such user) still answers 500. The log records `raced: true` for that path.
- **The concurrency test was kept, not skipped.** Five parallel identical sign-ups against the local stack reliably yield exactly one 201 and four 409s, with one membership and two consent rows for the winner. The backstop truth in the plan is therefore covered by a real test.
- **`PLATFORM_PRIVACY_VERSION === PLATFORM_TERMS_VERSION` is enforced by test**, so the single recorded `platform_terms` version number identifies both accepted texts.
- **`consent_records` intentionally has no write policy.** Tamper-resistance comes from the absence of insert/update/delete policies combined with admin-lane-only writes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `proxy.ts` resolved the host from `host` instead of `x-forwarded-host`, dropping the tenant after every Server Action redirect**

- **Found during:** Task 3 (the register → `Sair` → login round trip failed: `/entrar` after sign-up showed the generic shell instead of "Comunidade: Rede Demo")
- **Issue:** When a Server Action calls `redirect()`, Next re-requests the destination through `proxy.ts` on the *server's own* origin (`host: localhost:3000`) and carries the browser-facing host in `x-forwarded-host`. Reading `host` first classified every post-action page as a generic host, so the tenant public shell silently disappeared for exactly the flow AUTH-01 is about.
- **Fix:** `resolveHostTenant(forwardedHost || request.headers.get('host'))`, taking the first hop of `x-forwarded-host`. The comment records why trusting it is safe here: Vercel and Cloud Run overwrite a client-supplied value at the edge, and per D-20/D-23 the host only SELECTS the public shell — the API re-resolves it and can only DENY a session.
- **Files modified:** `apps/web/proxy.ts`
- **Verification:** all 15 e2e cases on `mobile-chromium` (8 new + the 7 from 01-02) pass; the 01-02 case "`/entrar` shows the host tenant from the HOST, not from a cookie" still passes, so the existing behaviour is preserved.
- **Committed in:** `0783ca3` (Task 3 commit)

**2. [Rule 2 - Missing Critical] Race-aware duplicate classification in `signupMember`**

- **Found during:** Task 1 (the concurrency case the plan allowed to be skipped)
- **Issue:** The plan's duplicate detection (422 / "already been registered") does not fire for the *losing* request of a concurrent sign-up, which GoTrue answers with an opaque 500. Those users would have seen "Erro interno" instead of "this e-mail already exists", and the plan's AUTH-01 concurrency truth would have been unverifiable.
- **Fix:** After a `createUser` failure, look the e-mail up in `auth.users`; a confirmed hit becomes the same 409 (logged with `raced: true`), everything else stays a 500.
- **Files modified:** `packages/core/server/tenancy/signup.ts`
- **Verification:** integration case 10 (five parallel sign-ups → one 201, four 409, one membership) passes.
- **Committed in:** `d257811` (Task 1 commit)

**3. [Rule 3 - Blocking] Test and catalog scaffolding the plan assumed already existed**

- **Found during:** Tasks 1 and 2
- **Issue:** `@rede-social/contracts` had no test runner (Vitest 5 no longer walks up for a config) and its `tsconfig.json` excluded `tests/`; the plan stated the `signup` pt-BR strings were "all already present", but `viewRules`, `closeRules`, `termsLink`, `privacyLink`, `invalid` and the whole `legal` namespace were missing.
- **Fix:** added `vitest` 5.0.0 + `@rede-social/config` as dev dependencies with a `test` script and a package-local `vitest.config.ts`, widened the tsconfig `include`, and added the missing catalog keys.
- **Files modified:** `packages/contracts/{package.json,tsconfig.json,vitest.config.ts}`, `pnpm-lock.yaml`, `apps/web/messages/pt-BR.json`
- **Verification:** `pnpm --filter @rede-social/contracts exec vitest run` → 4 passed; `pnpm typecheck` and `pnpm lint` green across all 7 packages.
- **Committed in:** `d257811` / `da24809`

**4. [Rule 3 - Blocking] Stale comment on `/entrar` claiming its endpoint did not exist yet**

- **Found during:** close-out (broken-window 3 review)
- **Issue:** `entrar/page.tsx` carried "Plan 01-04 defines `GET /v1/public/tenants/{slug}`; until then any non-2xx simply means no hint" — the endpoint now exists, so the comment misdescribed live behaviour and the ledger entry stayed open.
- **Fix:** rewrote the comment to state the endpoint exists and why the fetch stays deliberately loose and non-fatal; marked broken-window 3 fixed.
- **Files modified:** `apps/web/app/(auth)/entrar/page.tsx`, `.planning/WINDOWS.md`
- **Verification:** `pnpm --filter @rede-social/web lint` green; e2e case 6 proves the hint renders from the cookie on a generic host.
- **Committed in:** `cca7d39`

---

**Total deviations:** 4 auto-fixed (1 bug, 1 missing critical, 2 blocking)
**Impact on plan:** No scope creep. Deviation 1 was the difference between AUTH-01's central truth passing and failing; deviation 2 turned a "may be skipped" backstop truth into a real test; deviations 3 and 4 were scaffolding and documentation debt.

## Issues Encountered

- **The session-1 executor was interrupted by the user after Task 2**, leaving Task 3 written but uncommitted and unverified. Session 2 re-ran every acceptance criterion and `<verify>` block for Tasks 1 and 2 before touching Task 3 — all passed unchanged, so nothing was rewritten. Task 3's own verify then ran clean on the first attempt.
- **`pnpm boundaries` fails** with `No package found with name '@rede-social/boundary-fixture'`. Pre-existing and out of scope: the fixture and `scripts/check-boundaries.sh` are already recorded as broken-window 7, owed by a sibling plan in this phase.

## Known Stubs

None introduced by this plan. Broken-window 3 (the `/entrar` generic-host tenant hint waiting on `GET /v1/public/tenants/{slug}`) is **closed** by Task 1.

## Threat Flags

None. No security-relevant surface was introduced beyond the plan's `<threat_model>`: the two new public routes, the `X-Client-IP` hop (T-04-03, accepted) and the admin-lane import in `signup.ts` (T-04-04) are all registered there.

## User Setup Required

None — no external service configuration required. The suite runs against the local Supabase stack with `SEED_PASSWORD=Segredo123`.

## Next Phase Readiness

- **Ready for 01-05** (`NO_MEMBERSHIP` / blocked-access screens): `signupMember`'s compensation already guarantees no orphan identity, so 01-05's screens are a safety net rather than a routine path. `PasswordField.tsx` exists at the path 01-05 Task 1 expects, so its stated fallback is unnecessary.
- **`@rede-social/contracts` now owns `loginSchema`, `forgotSchema` and `resetSchema`** — 01-05's password-recovery pages should import them instead of writing local Zod objects.
- **Legal text is placeholder.** `termos-de-uso.md` and `politica-de-privacidade.md` are neutral pilot texts as the plan specified. Before a real member accepts them the wording needs a human (ideally legal) review; when it changes, bump `version:` in BOTH markdown files and BOTH constants together — the unit test enforces the pairing.
- **`outputFileTracingIncludes` is unproven on Vercel.** The legal pages read markdown at request time from `packages/contracts/legal/`; only a real Vercel build confirms the tracing config ships it.

## Self-Check: PASSED

- All 18 files listed in `key-files.created` exist on disk.
- All four commits (`d257811`, `da24809`, `0783ca3`, `cca7d39`) exist in `git log`.
- Re-ran every task `<verify>`: contracts unit 4/4, API integration 28/28 (10 in `signup.test.ts`), web `typecheck` + `lint` clean, Playwright `mobile-chromium` 15/15.
- Re-ran the plan-level `<verification>`: `signup.test.ts` green, legal version test green, `signup.spec.ts` green.
- `pnpm typecheck`, `pnpm lint` and `pnpm test` green across all packages; `pnpm db:generate` reports no schema drift.

---
*Phase: 01-foundation-kernel-tenancy-auth-ci-cd*
*Completed: 2026-09-13*
