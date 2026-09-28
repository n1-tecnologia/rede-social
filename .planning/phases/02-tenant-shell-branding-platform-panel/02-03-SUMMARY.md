---
phase: 02-tenant-shell-branding-platform-panel
plan: 03
subsystem: kernel foundation (env, deps, client-safe UI entry), schema + migration, platform-lane contracts
tags: [schema, drizzle, supabase, pgtap, zod, contracts, env, kernel, tenant-invites, tenant-domains, tenant-suspended]

# Dependency graph
requires:
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 01
    provides: "@rede-social/contracts/branding (hexColorSchema, tenantBrandingSchema, contrastReport, deriveBrandColors), widened hostTenantSchema, normalizeHost/isRegistrableHost, verified-only resolveTenantHost, seeded brands"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 02
    provides: "@rede-social/ui (cn, primitives), happy-dom/Testing Library test shape, biome tailwind directives, the package-legitimacy approval covering sharp/resend/standardwebhooks/png-to-ico/lucide-react"
  - phase: 01-foundation-kernel-tenancy-auth-ci-cd
    provides: "kernel env (createEnv), tenant/admin lanes, tenant_domains + platform_admins schema, requireAuth order, ERROR_CODES/ERROR_MESSAGES envelope, pgTAP gate (000-040), drizzle-kit generate → Supabase CLI apply, scripts/local-env.sh, seed"
provides:
  - "Kernel env (packages/core/server/env.ts): DOMAIN_PROVIDER=fake|vercel, VERCEL_TOKEN/PROJECT_ID/TEAM_ID, AUTH_ALLOW_LIST=local|supabase, SUPABASE_PAT/PROJECT_REF, MAIL_TRANSPORT=local|resend, RESEND_API_KEY, MAIL_DOMAIN, MAILPIT_URL, SEND_EMAIL_HOOK_SECRETS, PUBLIC_WEB_SCHEME/PORT — local implementations are the defaults; assertProductionEnv() refuses a real selection without its secrets; publicWebOrigin(host) is the only origin composer (D-22)"
  - "@rede-social/core dependencies installed once: resend 6.28.0, standardwebhooks 1.1.1, sharp 0.35.4, png-to-ico 3.0.2, lucide-react 1.46.0, @rede-social/ui; peers react/react-dom ^19.3.0, next ^16.3.0; devDeps for happy-dom .tsx tests"
  - "@rede-social/core/ui (client-safe export): TenantLogo({ logoUrl, displayName, size: topbar|rail|auth|home }) — <img> as-is in a fixed box, display-name text fallback (D-26); Biome forbids packages/core/ui/** from importing ../server or ../db"
  - "Schema: tenant_invites (RLS on, ZERO policies, citext email unique per tenant, role/status CHECKs) and tenant_domains.verification_status/dns_records/last_checked_at/verify_deadline_at/last_error; migration 20260916183650 applied by the Supabase CLI; shared citext customType (schema/citext.ts)"
  - "pgTAP: 020 proves a tenant lane reads zero invites (even its own) and cannot insert one, the admin lane reads them case-insensitively; 010 exempts exactly tenant_invites from 'at least one policy'; 040 pins tenant_invites at zero policies + RLS on + citext email + tenant-first unique index, and tenant_domains' status CHECK/default"
  - "@rede-social/contracts: dnsRecordSchema/DnsRecord, domainStatusSchema, tenantDomainSchema, attachDomainBodySchema (normalizeHost + isRegistrableHost), domainCheckResultSchema, inviteStatusSchema, tenantInviteSchema, acceptInviteBodySchema, acceptInviteResponseSchema, platformTenantsQuerySchema, createTenantBodySchema, updateTenantBodySchema, setTenantStatusBodySchema, setModuleBodySchema, platformTenantDetailSchema (strict), contrastReportSchema; platformTenantsSchema items carry primaryHost and the list carries nextCursor"
  - "ERROR_CODES += TENANT_SUSPENDED ('Esta comunidade está temporariamente indisponível.'); requireAuth answers 403 TENANT_SUSPENDED before the blocked check; invited memberships pass"
  - "scripts/local-env.sh emits PUBLIC_WEB_SCHEME=http, PUBLIC_WEB_PORT=3000, DOMAIN_PROVIDER=fake, AUTH_ALLOW_LIST=local, MAIL_TRANSPORT=local, MAIL_DOMAIN, MAILPIT_URL, SEND_EMAIL_HOOK_SECRETS (32-byte throwaway, overridable)"
  - "Seeded hosts carry verification_status = 'verified'"
affects: [02-04 mockup, 02-05 provisioning routes, 02-06 mail hook + templates, 02-07 AppShell (TenantLogo), 02-08 auth pages + suspended screen, 02-09 domain provider/verify job, 02-11 manifest/icons (sharp), 02-12/02-14/02-15 platform panel, 02-13 suspended screen]

# Tech tracking
tech-stack:
  added:
    - "resend 6.28.0, standardwebhooks 1.1.1, sharp 0.35.4 (prebuilt binary, no allowBuilds entry needed), png-to-ico 3.0.2, lucide-react 1.46.0 (@rede-social/core)"
    - "react/react-dom/next/@types/react* + happy-dom/@testing-library/@vitejs/plugin-react as @rede-social/core devDependencies (ui entry + .tsx tests)"
  patterns:
    - "Adapter selection lives in the kernel env with the LOCAL implementation as the default; a real selection without its credentials fails at import (assertProductionEnv)"
    - "The public web origin is composed in exactly one function (publicWebOrigin) from PUBLIC_WEB_SCHEME/PORT — never a SITE_URL"
    - "Admin-lane-only tenant tables = RLS on with ZERO policies (platform_admins, tenant_invites); 010 carries an explicit allow-list and 040 pins the count, so a table is either isolated by a policy or pinned as invisible"
    - "Kernel client-safe code lives under packages/core/ui and is exported as @rede-social/core/ui; a Biome override makes server/db imports a lint error"
    - "Request bodies normalise before validating (adminEmail trim+lowercase → z.email(); host normalizeHost → isRegistrableHost) so two spellings are one value at the boundary"
    - "Per-file `// @vitest-environment happy-dom` for .tsx tests inside a node-environment package"

key-files:
  created:
    - packages/core/ui/TenantLogo.tsx
    - packages/core/ui/index.ts
    - packages/core/ui/tsconfig.json
    - packages/core/tests/tenant-logo.test.tsx
    - packages/core/db/schema/tenant-invites.ts
    - packages/core/db/schema/citext.ts
    - supabase/migrations/20260916183650_tenant_invites_and_domain_verification.sql
    - supabase/migrations/meta/20260916183650_snapshot.json
    - packages/contracts/src/domains.ts
    - packages/contracts/src/invites.ts
    - packages/contracts/tests/platform.test.ts
  modified:
    - packages/core/server/env.ts
    - packages/core/package.json
    - packages/core/vitest.config.ts
    - biome.json
    - scripts/local-env.sh
    - packages/core/db/schema/tenant-domains.ts
    - packages/core/db/schema/index.ts
    - supabase/migrations/meta/_journal.json
    - supabase/tests/010-rls-coverage.sql
    - supabase/tests/020-tenant-isolation.sql
    - supabase/tests/040-schema-conventions.sql
    - scripts/seed.ts
    - packages/contracts/src/platform.ts
    - packages/contracts/src/branding.ts
    - packages/contracts/src/errors.ts
    - packages/contracts/src/index.ts
    - packages/core/server/http/api-error.ts
    - packages/core/server/auth/require-auth.ts
    - packages/core/server/platform/tenants.ts
    - apps/api/src/routes/platform.ts
    - apps/api/tests/integration/auth-middleware.test.ts
    - apps/web/lib/bootstrap.ts
    - pnpm-lock.yaml

key-decisions:
  - "assertProductionEnv() runs at import time in every environment (not only NODE_ENV=production): a `vercel`/`resend`/`supabase` selection without its secrets is invalid anywhere, and failing on boot is the whole point (T-02-10); the fake/local defaults never trip it"
  - "tenant_invites is exempted BY NAME from 010's 'at least one policy' assertion and pinned at ZERO policies in 040 (mirror of platform_admins): the catalogue test contradicted the locked prohibition, and an explicit allow-list keeps the rule honest — a table is either isolated by a policy or pinned as invisible"
  - "TenantLogo renders a fixed box (span) with the <img> inside rather than sizing the <img> alone: the rail contract is 'box h-12, logo max-h 32', which one element cannot express; noImgElement is suppressed with the D-26 rationale (next/image would re-encode and constrain the customer's asset)"
  - "adminEmail is trimmed and lower-cased BEFORE z.email() (z.string().trim().toLowerCase().pipe(z.email())) — the plan's z.email().trim().toLowerCase() validates first and rejects a padded address"
  - "GET /v1/platform/tenants answers primaryHost (the is_primary row, verified or not) and nextCursor: null now — the widened contract is the route's OpenAPI response type, so the route had to comply; query/cursor handling stays with the panel plan"
  - "On the web tier TENANT_SUSPENDED is routed through the existing /auth/blocked sign-out handler until 02-08 ships /auth/suspended → /comunidade-indisponivel: an unmapped 403 code would otherwise surface as a render error, a regression from Phase 1"
  - "The Send Email Hook local secret is a fixed 32-byte base64 constant (`rede-social-local-send-email-hook-key01`), overridable via SEND_EMAIL_HOOK_SECRET_B64; hosted environments never reuse it"

patterns-established:
  - "Kernel adapters: env selector + local default + assertProductionEnv guard"
  - "Admin-lane-only tenant table: RLS on, zero policies, 010 allow-list + 040 pin + 020 negative case"
  - "@rede-social/core/ui as the kernel's client-safe surface; add exports to packages/core/ui/index.ts"

requirements-completed: [ROLE-03, TENANT-07, MOD-04]

coverage:
  - id: D1
    description: "tenant_invites exists with RLS on and ZERO policies; tenant_domains carries the five verification columns; the migration was generated by drizzle-kit and applied only by the Supabase CLI; a second generate is a no-op"
    requirement: TENANT-07
    verification:
      - kind: other
        ref: "DOCKER_CONFIG=/tmp/dockercfg pnpm db:reset (applies 20260916183650_tenant_invites_and_domain_verification.sql) → pnpm db:generate 'No schema changes'"
        status: pass
      - kind: integration
        ref: "supabase/tests/040-schema-conventions.sql#tenant_invites has ZERO policies / still has RLS enabled / email is citext / tenant_invites_tenant_email_key; tenant_domains_verification_status_chk"
        status: pass
      - kind: other
        ref: "psql: pg_policies count for tenant_invites = 0, relrowsecurity = t, verified seeded hosts = 2"
        status: pass
    human_judgment: false
  - id: D2
    description: "A tenant lane cannot read or create invites (even its own tenant's); the admin lane reads them case-insensitively; every earlier isolation case stays green"
    requirement: ROLE-03
    verification:
      - kind: integration
        ref: "supabase/tests/020-tenant-isolation.sql (31 cases, 4 new: A sees 0 invites, A cannot insert (42501), B sees 0, service lane reads CONVIDADO@A.LOCAL)"
        status: pass
      - kind: integration
        ref: "pnpm supabase test db → 87/87"
        status: pass
    human_judgment: false
  - id: D3
    description: "A member of a suspended tenant gets 403 TENANT_SUSPENDED (checked before the blocked check, details.tenantName); a blocked member on an active tenant gets MEMBERSHIP_BLOCKED; an invited membership passes"
    requirement: ROLE-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/auth-middleware.test.ts#c. / c1. / c3. (14/14; full API integration suite 86/86)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Platform-lane contracts validate and normalise as specified (createTenant, attachDomain, query defaults/caps, strict detail, TENANT_SUSPENDED envelope)"
    requirement: MOD-04
    verification:
      - kind: unit
        ref: "packages/contracts/tests/platform.test.ts (23 cases; contracts suite 57/57)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Kernel env with fail-safe defaults, dependencies installed, @rede-social/core/ui with TenantLogo, Biome lane, local-env emission"
    requirement: MOD-04
    verification:
      - kind: unit
        ref: "packages/core/tests/tenant-logo.test.tsx (4 cases; core suite 30/30 under happy-dom per file)"
        status: pass
      - kind: other
        ref: "pnpm --filter @rede-social/core typecheck && lint; bash scripts/local-env.sh | grep PUBLIC_WEB_SCHEME=http / DOMAIN_PROVIDER=fake; biome probe: ../server import under packages/core/ui is an error"
        status: pass
    human_judgment: false
  - id: D6
    description: "Visual adequacy of TenantLogo sizes in the shell/auth pages — no screen composes it yet"
    verification: []
    human_judgment: true
    rationale: "The end-of-phase verifier should eyeball the topbar/rail/auth/home boxes once 02-07/02-08 render them"

# Metrics
duration: 14min
completed: 2026-09-16
status: complete
actuals:
  tokens: 44375
  tasks: 3
  commits: 4
plan_head_before: 62d77c6bbaa910b569698c1cffa90877965e6ddd
---

# Phase 02 Plan 03: Kernel Foundation, Schema and Platform Contracts Summary

**`tenant_invites` (RLS on, zero policies) and the `tenant_domains` verification lifecycle applied by the Supabase CLI with pgTAP 87/87; the Phase 2 kernel env with local-by-default adapters, the kernel dependencies, `@rede-social/core/ui` with `TenantLogo`, the platform-lane Zod contracts and a distinct 403 `TENANT_SUSPENDED` in `requireAuth` — all wave-3 plans can start.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-09-16T18:31:02Z
- **Completed:** 2026-09-16T18:45:37Z
- **Tasks:** 3 (Task 3 TDD: RED + GREEN)
- **Files modified:** 34 (incl. pnpm-lock.yaml)

## Accomplishments

- **Kernel env:** `DOMAIN_PROVIDER`, `AUTH_ALLOW_LIST`, `MAIL_TRANSPORT` selectors default to `fake`/`local`; credentials (`VERCEL_*`, `SUPABASE_PAT`/`PROJECT_REF`, `RESEND_API_KEY`) optional; `MAIL_DOMAIN`, `MAILPIT_URL`, `SEND_EMAIL_HOOK_SECRETS`, `PUBLIC_WEB_SCHEME`/`PORT`; `assertProductionEnv()` (runs at import) and `publicWebOrigin(host)`.
- **Dependencies:** `resend`, `standardwebhooks`, `sharp`, `png-to-ico`, `lucide-react`, `@rede-social/ui` in `@rede-social/core`; react/react-dom/next peers; `sharp` installed with no build-script block (RESEARCH's expectation confirmed — no `allowBuilds` change).
- **`@rede-social/core/ui`:** `TenantLogo` (fixed box per placement, `<img alt={displayName}>` as-is, text fallback), `ui/tsconfig.json` (react-jsx + DOM libs, typechecked by the package's `typecheck`), happy-dom `.tsx` tests in the kernel, Biome override forbidding server/db imports from `packages/core/ui/**` (probed: it fires).
- **Schema/migration:** `tenant_invites` + five `tenant_domains` columns, shared `citext` type, migration `20260916183650_tenant_invites_and_domain_verification.sql` generated by drizzle-kit and applied with `supabase db reset`; `pnpm db:generate` is a no-op afterwards; seed marks hosts `verified`.
- **pgTAP:** 020 +4 cases (lane sees 0 invites, cannot insert, symmetric, admin lane reads case-insensitively), 010 explicit exemption + existence list, 040 +6 pins → 87/87.
- **Contracts:** `domains.ts`, `invites.ts`, extended `platform.ts`, `contrastReportSchema`; `TENANT_SUSPENDED` code + message; `requireAuth` split (tenant status before member status); `GET /v1/platform/tenants` answers `primaryHost` + `nextCursor`.
- **Tests:** contracts 57/57 (23 new), core 30/30 (4 new), API integration 86/86 (2 new + 1 pinned), monorepo typecheck + lint green.

## Task Commits

1. **Task 1: Kernel foundation (env, deps, @rede-social/core/ui, Biome lane, local-env)** — `79c1d4a` (feat)
2. **Task 2: Schema + migration + seed + pgTAP (BLOCKING apply)** — `0da8778` (feat)
3. **Task 3 RED: contract tests + integration expectations** — `8b08abc` (test)
4. **Task 3 GREEN: contracts, TENANT_SUSPENDED, requireAuth split** — `34e852f` (feat)

**Plan metadata:** see the final `docs(02-03)` commit.

## TDD Gate Compliance

| Task | RED | GREEN | REFACTOR | Status |
|------|-----|-------|----------|--------|
| 3 | `8b08abc` (23 contract cases failing: exports absent; 2 integration cases failing with `MEMBERSHIP_BLOCKED`) | `34e852f` (57/57, 86/86) | — (none needed) | compliant |

RED evidence was intentional: `platform.test.ts` imported 20 not-yet-existing exports (`TypeError: Cannot read properties of undefined (reading 'parse')` ×23) and `auth-middleware.test.ts` cases c/c1 received `MEMBERSHIP_BLOCKED` for a suspended tenant. Case c3 (`invited` passes) passed in RED because the behaviour already existed — it is pinned, not driven.

## Files Created/Modified

- `packages/core/server/env.ts` — Phase 2 variables, `assertProductionEnv`, `publicWebOrigin`
- `packages/core/package.json` — deps, peers, `./ui` export, two-project typecheck; `pnpm-lock.yaml`
- `packages/core/ui/{TenantLogo.tsx,index.ts,tsconfig.json}`, `packages/core/tests/tenant-logo.test.tsx`, `packages/core/vitest.config.ts` — client-safe entry + tests
- `biome.json` — `packages/core/ui/**` import lane (appended in the file's existing style)
- `scripts/local-env.sh` — Phase 2 local values + header
- `packages/core/db/schema/{citext.ts,tenant-invites.ts,tenant-domains.ts,index.ts}` — schema
- `supabase/migrations/20260916183650_*.sql`, `meta/_journal.json`, `meta/20260916183650_snapshot.json` — migration
- `supabase/tests/{010,020,040}*.sql` — coverage exemption/pin + isolation cases
- `scripts/seed.ts` — `verificationStatus: 'verified'` on insert and on conflict
- `packages/contracts/src/{domains,invites,platform,branding,errors,index}.ts`, `tests/platform.test.ts` — contracts
- `packages/core/server/{http/api-error.ts,auth/require-auth.ts,platform/tenants.ts}` — message, split, `primaryHost`
- `apps/api/src/routes/platform.ts`, `apps/api/tests/integration/auth-middleware.test.ts` — route compliance, cases
- `apps/web/lib/bootstrap.ts` — `TENANT_SUSPENDED` interim redirect

## Decisions Made

See `key-decisions` in the frontmatter. In short: adapters fail safe to local and fail loud on a half-configured real selection; `tenant_invites` is pinned invisible by name in the catalogue tests; the `TenantLogo` box is a `span` around a plain `<img>`; e-mail and host normalise before validation; the list route complies with the widened contract now; the web tier keeps Phase 1's sign-out path for a suspended tenant until 02-08.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] 010's "at least one policy" catalogue assertion contradicted the locked zero-policy prohibition**
- **Found during:** Task 2 (pgTAP run after `db reset`)
- **Issue:** `010-rls-coverage.sql` fails any `public` table with `tenant_id` and no policy; `tenant_invites` must have RLS on and NO policy (must-have + prohibition). The plan expected 010 to pass unchanged.
- **Fix:** 010 exempts exactly `tenant_invites` by name (with the rationale) and lists it in the existence guard; 040 pins the policy count at zero, RLS on, citext e-mail and the tenant-first unique index (the `platform_admins` mirror), so the exemption cannot hide a table by accident.
- **Files modified:** `supabase/tests/010-rls-coverage.sql`, `supabase/tests/040-schema-conventions.sql`
- **Verification:** `pnpm supabase test db` 87/87
- **Committed in:** `0da8778`

**2. [Rule 3 - Blocking] `GET /v1/platform/tenants` no longer typechecked against the widened `platformTenantsSchema`**
- **Found during:** Task 3 GREEN (`pnpm --filter @rede-social/api typecheck`)
- **Issue:** the route's OpenAPI 200 schema is `platformTenantsSchema`; adding `primaryHost`/`nextCursor` to the contract made the existing handler's body a type error.
- **Fix:** `listPlatformTenants` reads the `is_primary` host per tenant (one extra admin-lane query, no join so hostless tenants still list); the route answers `primaryHost` and `nextCursor: null` (query/cursor handling stays with the panel plan).
- **Files modified:** `packages/core/server/platform/tenants.ts`, `apps/api/src/routes/platform.ts`
- **Verification:** API typecheck, `modules.test.ts` (parses the list with the new schema) — integration 86/86
- **Committed in:** `34e852f`

**3. [Rule 2 - Missing critical] Web tier had no route for the new `TENANT_SUSPENDED` code**
- **Found during:** Task 3 (reading `apps/web/lib/bootstrap.ts`)
- **Issue:** `bootstrapRedirectPath` returns `null` for unknown codes and `loadOrRedirect` rethrows — a suspended tenant's member would have hit a render error instead of the Phase 1 sign-out screen.
- **Fix:** `case 'TENANT_SUSPENDED'` shares the `/auth/blocked?t=` handler with a comment pointing at 02-08's `/auth/suspended` → `/comunidade-indisponivel`.
- **Files modified:** `apps/web/lib/bootstrap.ts`
- **Verification:** web typecheck; behaviour identical to before the split
- **Committed in:** `34e852f`

**4. [Rule 1 - Bug] `z.email().trim().toLowerCase()` rejects a padded address**
- **Found during:** Task 3 (probing Zod 4 before writing the tests)
- **Issue:** Zod 4 runs the format check before the overwrite transforms, so `' Admin@Cliente.com.br '` fails; the plan's order would not deliver the "case differs never create a duplicate" truth for padded input.
- **Fix:** `z.string().trim().toLowerCase().pipe(z.email())`.
- **Files modified:** `packages/contracts/src/platform.ts`
- **Committed in:** `34e852f`

**5. [Rule 1 - Bug] pgTAP `col_default_is` literal form**
- **Found during:** Task 2 (first pgTAP run)
- **Issue:** my new 040 assertion compared against `'pending'::text`; pgTAP normalises the default to `pending`.
- **Fix:** expected value `'pending'`.
- **Committed in:** `0da8778`

### Documented, not fixed

- **Acceptance literal `pgTable('tenant_invites'`** cannot appear in Biome-formatted code: with three arguments Biome breaks every argument onto its own line (`pgTable(\n  'tenant_invites',` — the same shape as every existing table file). The substance (`pgTable`, `'tenant_invites'`, `.enableRLS()`, no `pgPolicy(`) holds.
- **Migration filename** is `20260916183650_tenant_invites_and_domain_verification.sql` (drizzle-kit's timestamp), not the plan's placeholder `20260915000000_…`, per the plan's own instruction to keep the chosen prefix.
- **`DnsRecord` type on the schema:** typed locally in Task 2, switched to the `@rede-social/contracts` import in Task 3 as the plan allowed.

---

**Total deviations:** 5 auto-fixed (3 blocking, 1 missing critical, 1 bug) + 3 documented. **Impact:** all directly caused by the planned changes (catalogue test vs. prohibition, contract widening vs. existing route, new code vs. web redirect map); no scope creep.

## Issues Encountered

- `pnpm exec biome format --write biome.json` rewrites the whole root file (it was never formatter-enforced because root `lint` runs per package); reverted and appended the override by hand in the file's expanded style to keep the diff to the 30 added lines.
- The root `biome.json` carries three pre-existing `useBiomeIgnoreFolder` warnings (`!.gsd/**`, `!.planning/**`, `!.claude/**`) — out of scope, logged in `deferred-items.md`.

## User Setup Required

None — every new variable has a local default or is emitted by `bash scripts/local-env.sh --write`. Hosted values (`DOMAIN_PROVIDER=vercel` + `VERCEL_*`, `MAIL_TRANSPORT=resend` + `RESEND_API_KEY`, `AUTH_ALLOW_LIST=supabase` + `SUPABASE_PAT`/`SUPABASE_PROJECT_REF`, `SEND_EMAIL_HOOK_SECRETS`, `PUBLIC_WEB_SCHEME=https`) are documented by 02-06/02-09 in `docs/DEPLOY.md`.

## Verification (plan-level)

- `DOCKER_CONFIG=/tmp/dockercfg pnpm db:reset && bash scripts/local-env.sh --write && pnpm db:seed && pnpm supabase test db` → migration applied, seed ok, 87/87.
- `pnpm test:integration` → 86/86 (11 files). `pnpm --filter @rede-social/contracts test` → 57/57. `pnpm --filter @rede-social/core test` → 30/30. `pnpm test` → 5 tasks green. `pnpm typecheck` → 8 tasks green. `pnpm lint` → 7 tasks green.
- `pnpm db:generate` → "No schema changes, nothing to migrate".
- `psql`: `pg_policies` for `tenant_invites` = 0, `relrowsecurity` = t, `verification_status = 'verified'` count = 2.

## Human-check notes for the end-of-phase verifier

- Nothing user-visible changed except the 403 code for a suspended tenant's members (still lands on the Phase 1 "acesso suspenso" screen until 02-08). `TenantLogo` sizes should be eyeballed once 02-07/02-08 render them.

## Known Stubs

None — `nextCursor: null` on `GET /v1/platform/tenants` is the documented single-page answer until 02-12 wires `platformTenantsQuerySchema`; every other value comes from the database.

## Next Phase Readiness

- Wave 3 can start in parallel: provisioning routes (`createTenantBodySchema`, `tenant_invites`), the mail hook (`MAIL_TRANSPORT`, `SEND_EMAIL_HOOK_SECRETS`, `standardwebhooks`, `resend`), the shell (`TenantLogo`, `lucide-react`), auth pages (`TENANT_SUSPENDED`, `publicWebOrigin`), the domain provider (`DOMAIN_PROVIDER`, `tenant_domains` columns, `dnsRecordSchema`).
- 02-08 must replace the interim `TENANT_SUSPENDED → /auth/blocked` mapping with `/auth/suspended` → `/comunidade-indisponivel`.
- 02-12 owns `platformTenantsQuerySchema` in the list route (search, status, cursor) and may decide whether `primaryHost` should be the verified primary only.

---
*Phase: 02-tenant-shell-branding-platform-panel*
*Completed: 2026-09-16*

## Self-Check: PASSED

All 10 created files exist on disk; task commits 79c1d4a, 0da8778, 8b08abc and 34e852f are in history; commits measured from plan_head_before 62d77c6 (4).
