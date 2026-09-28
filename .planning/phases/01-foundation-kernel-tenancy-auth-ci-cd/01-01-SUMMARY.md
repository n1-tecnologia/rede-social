---
phase: 01-foundation-kernel-tenancy-auth-ci-cd
plan: 01
subsystem: infra
tags: [pnpm, turborepo, biome, typescript-7, hono, zod-openapi, drizzle, postgres, supabase, jose, jwks, rls, vitest, tsup]

# Dependency graph
requires: []
provides:
  - "@rede-social/* pnpm 12 + Turborepo 2.10 monorepo (config, contracts, core, ui, api) with boundary tags and Biome noRestrictedImports lanes"
  - "Local Supabase stack config (ES256 signing keys, transaction pooler, pt-BR recovery template, localhost redirect globs)"
  - "Kernel: env, postgres.js client (prepare:false), withTenantTx / withAdminTx lanes, tenantIsolationPolicy, schema tenants/users/memberships/tenant_domains with RLS"
  - "Auth: jose JWKS verification (ES256, issuer + audience), requireAuth with per-request membership lookup, blocked check and host/membership match (403 TENANT_HOST_MISMATCH)"
  - "API: GET /v1/health, GET /v1/public/tenants/by-host, GET /v1/me/bootstrap, stable error envelope, VALIDATION_FAILED default hook"
  - "SQL: api_user role, app schema helpers, app.membership_for_user (security definer), lane grants + anon revoke, auth.users -> public.users mirror; four migrations applied only by the Supabase CLI"
  - "Idempotent seed (rede-demo / rede-lab, admin + member each, primary verified tenant_domains from TENANT_*_HOST) and eleven in-process integration cases"
affects: [01-02, 01-03, 01-04, 01-05, 01-06, 01-07, 01-08, 01-09, 01-12, phase-2-domains]

# Actuals (#2632) — same estimateTokens scale as the plan's estimate (chars/4 over the realized diff)
actuals:
  tokens: 65600      # 262,534 chars / 4 over `git diff 6c264e2..HEAD` (28,400 without pnpm-lock.yaml + drizzle snapshots); estimate was 85,000
  tasks: 2
  commits: 2         # MEASURED: git rev-list --count 6c264e2..HEAD before the docs commit (#3968)
plan_head_before: 6c264e27b2930bc3b25beb40bb016a1e89399025

# Tech tracking
tech-stack:
  added: [pnpm 12.4.1, turbo 2.10.12, "@biomejs/biome 2.5.13", typescript 7.0.2, vitest 5.0.0, tsx 4.23.13, supabase CLI 2.117.0, hono 4.13.7, "@hono/node-server 2.1.1", "@hono/zod-openapi 1.6.3", zod 4.6.2, drizzle-orm 0.45.2, drizzle-kit 0.31.10, postgres 3.4.9, jose 6.2.12, "@supabase/supabase-js 2.116.0", pino 10.3.1, "@t3-oss/env-core 0.13.11", tsup 8.5.1]
  patterns:
    - "Tenant lane: withTenantTx = one transaction with bound set_config('request.jwt.claims', $1, true) + SET LOCAL ROLE authenticated; admin lane = SET LOCAL ROLE service_role, importable only from packages/core/server/{tenancy,platform} and scripts/ (Biome)"
    - "requireAuth order is fixed: JWKS verify -> membership per request (never cached) -> blocked -> x-tenant-host re-resolution; the host can only DENY (403 TENANT_HOST_MISMATCH), ctx.tenantId always comes from the membership"
    - "Every route group is an OpenAPIHono built by createOpenApiApp(): zod validation failures become 400 VALIDATION_FAILED; app.onError serialises ApiError through errorEnvelope"
    - "Schema in Drizzle TS with pgPolicy + .enableRLS(); drizzle-kit generate (prefix supabase) -> supabase/migrations; only the Supabase CLI applies (db reset locally, db push in CI)"
    - "Public host lookup runs through the admin lane in packages/core/server/tenancy/tenant-host.ts with a 60 s positive + negative in-process cache; the API answers slug + displayName only"
    - "Secrets never in git: supabase/signing_keys.json and apps/*/.env.local are git-ignored; scripts/local-env.sh regenerates .env.local from `supabase status -o env`"

key-files:
  created:
    - package.json
    - pnpm-workspace.yaml
    - turbo.json
    - biome.json
    - packages/config/tsconfig.base.json
    - packages/contracts/src/errors.ts
    - packages/contracts/src/hosts.ts
    - packages/contracts/src/bootstrap.ts
    - packages/contracts/src/modules.ts
    - packages/core/db/client.ts
    - packages/core/db/tenant-tx.ts
    - packages/core/db/admin-tx.ts
    - packages/core/db/rls.ts
    - packages/core/db/schema/memberships.ts
    - packages/core/db/schema/tenant-domains.ts
    - packages/core/server/auth/jwks.ts
    - packages/core/server/auth/require-auth.ts
    - packages/core/server/tenancy/membership.ts
    - packages/core/server/tenancy/tenant-host.ts
    - packages/core/server/http/api-error.ts
    - packages/core/server/supabase-admin.ts
    - apps/api/src/app.ts
    - apps/api/src/http/openapi.ts
    - apps/api/src/routes/public.ts
    - apps/api/src/routes/me.ts
    - apps/api/tests/integration/bootstrap.test.ts
    - apps/api/drizzle.config.ts
    - supabase/config.toml
    - supabase/roles.sql
    - supabase/migrations/20260912030541_app_helpers.sql
    - supabase/migrations/20260912031019_core.sql
    - supabase/migrations/20260912031029_app_membership_lookup_and_grants.sql
    - supabase/migrations/20260912031030_auth_user_mirror.sql
    - scripts/seed.ts
    - scripts/local-env.sh
    - scripts/db-local-role.sh
  modified:
    - .gitignore
    - .planning/config.json

key-decisions:
  - "Local DATABASE_URL uses the direct port 54322: the local Supavisor (54329) answers ENOIDENTIFIER for api_user and ENOTFOUND for api_user.rede-social; the plan-sanctioned development fallback keeps the lane code identical, and the hosted transaction-pooler proof stays with 01-03 (spike) and 01-12"
  - "Root package.json declares type: module so tsx runs scripts/seed.ts (top-level await) as ESM, matching every workspace package"
  - "audience: 'authenticated' held on the local GoTrue token (A1) — kept in jwtVerify; the TS 6 alias was not needed (A5): TypeScript 7.0.2 native tsc, Biome and tsup (dts: false) all ran green"
  - "Public by-host lookup goes through the admin lane in tenant-host.ts (kernel-only path) instead of a security-definer SQL function; the TypeScript mapping limits the answer to slug + displayName"
  - "supabase/config.toml disables [analytics] and [edge_runtime] (unused locally; fewer images and less RAM on the pilot laptop); imgproxy/vector stay off by default"
  - "git.allow_default_branch_commits: true added to .planning/config.json because this phase is dispatched sequentially on master with branching_strategy: none (D-11 renames the branch in 01-10)"

patterns-established:
  - "Lane discipline: request handlers reach the database only through withTenantTx/withAdminTx; api_user is NOINHERIT so a bare query fails with SQLSTATE 42501 (integration case 6)"
  - "Envelope discipline: every error is { error: { code, message, details?, requestId } } with code in ERROR_CODES; TENANT_HOST_MISMATCH is thrown with two arguments so the body never names a tenant"
  - "Route registration order matters: literal /tenants/by-host is registered before any /tenants/{slug} route (01-04 appends after it); /v1/public is mounted above /v1/me in app.ts"
  - "Seed idempotency: onConflictDoUpdate on tenants.slug and tenant_domains.host, onConflictDoNothing on memberships, demotion of a previous primary host inside the same withAdminTx before the upsert"

requirements-completed: [TENANT-01, TENANT-03, ROLE-01, ROLE-02, AUTH-06, MOD-01]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "Monorepo toolchain: pnpm turbo typecheck lint build exits 0 with TypeScript 7.0.2, Biome 2.5.13 and tsup (dts off); /v1/health answers in-process"
    requirement: MOD-01
    verification:
      - kind: other
        ref: "pnpm turbo typecheck lint build (11 tasks successful)"
        status: pass
      - kind: unit
        ref: "apps/api/tests/unit/health.test.ts#GET /v1/health"
        status: pass
    human_judgment: false
  - id: D2
    description: "Local Supabase stack with ES256 signing keys: JWKS endpoint returns one EC/P-256 key"
    verification:
      - kind: other
        ref: "curl http://127.0.0.1:54321/auth/v1/.well-known/jwks.json -> {n:1, kty:EC, alg:ES256, crv:P-256}"
        status: pass
    human_judgment: false
  - id: D3
    description: "A seeded member's real GoTrue token reaches GET /v1/me/bootstrap through JWKS verification, app.membership_for_user() and withTenantTx as role authenticated; missing/forged tokens get 401 with the envelope"
    requirement: AUTH-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/bootstrap.test.ts#1. seeded member gets their tenant and role through the tenant lane"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/bootstrap.test.ts#2. no token -> 401 UNAUTHENTICATED with the envelope"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/bootstrap.test.ts#3. token signed by another ES256 key -> 401 INVALID_TOKEN"
        status: pass
    human_judgment: false
  - id: D4
    description: "TENANT-03 lane isolation: adjacency (identical display_name in another tenant never merges rows), empty claims see zero rows, api_user outside a lane fails with 42501"
    requirement: TENANT-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/bootstrap.test.ts#4. TENANT-03 adjacency"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/bootstrap.test.ts#5. TENANT-03 empty"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/bootstrap.test.ts#6. NOINHERIT"
        status: pass
    human_judgment: false
  - id: D5
    description: "TENANT-01 / D-23: x-tenant-host of another tenant -> 403 TENANT_HOST_MISMATCH naming no tenant; own host (any case, with port) and unregistered hosts -> 200 with the membership tenant"
    requirement: TENANT-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/bootstrap.test.ts#7. D-23 mismatch"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/bootstrap.test.ts#8. D-23 match"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/bootstrap.test.ts#9. D-21 generic host"
        status: pass
    human_judgment: false
  - id: D6
    description: "D-20 public lookup GET /v1/public/tenants/by-host: normalised host -> {slug, displayName} only with no-store; unknown -> 404 TENANT_NOT_FOUND; missing host -> 400 VALIDATION_FAILED"
    requirement: TENANT-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/bootstrap.test.ts#10. resolves the seeded host (normalised), 404 for unknown, 400 without host"
        status: pass
    human_judgment: false
  - id: D7
    description: "ROLE-01 / ROLE-02 shapes: memberships carries role/status CHECKs, unique (tenant_id, user_id) and the droppable memberships_one_tenant_per_user_v1 index; users has no tenant_id/role; tenant_domains has RLS, one primary per tenant"
    requirement: ROLE-02
    verification:
      - kind: other
        ref: "supabase/migrations/20260912031019_core.sql (CHECKs, unique indexes, policies) applied by pnpm db:reset; psql relrowsecurity for tenant_domains = 1"
        status: pass
    human_judgment: false
  - id: D8
    description: "D-14 / D-24 seed: rede-demo and rede-lab with admin + member each, primary verified hosts from TENANT_*_HOST, idempotent second run, PLATFORM_HOST guard"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/bootstrap.test.ts#11. a second run exits 0 and leaves tenant_domains unchanged with one primary per tenant"
        status: pass
    human_judgment: false

# Metrics
duration: 7min
completed: 2026-09-12
status: complete
---

# Phase 01 Plan 01: Toolchain bring-up and tracer (JWT -> JWKS -> membership -> RLS lane -> bootstrap) Summary

**@rede-social/* monorepo on pnpm 12 / Turborepo / Biome / TS 7 plus the Walking Skeleton spine: a real GoTrue ES256 token for a seeded `rede-demo` member reaches `GET /v1/me/bootstrap` through jose JWKS verification, `app.membership_for_user()` and `withTenantTx` (bound `set_config` + `SET LOCAL ROLE authenticated` as `api_user`), with `tenant_domains` + `x-tenant-host` re-resolution (403 `TENANT_HOST_MISMATCH`) and the public `by-host` lookup, proven by eleven in-process integration cases.**

## Performance

- **Duration:** 7 min (this continuation session; the code was written by the previous executor session, which paused at a `human-action` checkpoint because the host disk was full and Docker's image store was corrupted)
- **Started:** 2026-09-12T11:34:53Z (continuation)
- **Completed:** 2026-09-12T11:42:23Z
- **Tasks:** 2
- **Files modified:** 84 (2 task commits)

## Accomplishments

- Runnable monorepo: `pnpm turbo typecheck lint build` exits 0 (11 tasks) with TypeScript 7.0.2 native `tsc`, Biome 2.5.13, tsup 8.5.1 (`dts: false`); Turborepo `boundaries.tags` (`module`, `kernel`, `contracts`, `app`, `tooling`) and Biome `noRestrictedImports` overrides (published entry points only, admin lane kernel-only, web import rules) are in place.
- Local Supabase stack (CLI 2.117.0, Postgres 17.6) with ES256 signing keys: the JWKS endpoint returns one `EC`/`P-256`/`ES256` key; transaction pooler enabled; pt-BR recovery template; `http://*.localhost:3000/**` redirect glob; minimum password 8; autoconfirm on.
- Kernel (`@rede-social/core`): `withTenantTx` / `withAdminTx` lanes, `tenantIsolationPolicy`, schema `tenants` / `users` / `memberships` / `tenant_domains` with `pgPolicy` + `.enableRLS()`, `JWKS`, `requireAuth`, `membershipForUser`, `resolveTenantHost` (60 s positive + negative cache), `ApiError` + `errorEnvelope` (pt-BR), `supabaseAdmin`.
- SQL applied only by the Supabase CLI: `api_user` (`nologin nobypassrls noinherit`, granted `authenticated` + `service_role`), `citext`, `app.tenant_id()/user_id()/tenant_role()`, `app.membership_for_user()` (security definer, `order by joined_at limit 1`), lane grants + `anon` revoke, `auth.users -> public.users` mirror trigger.
- API: `GET /v1/health` (no DB), `GET /v1/public/tenants/by-host` (registered first, `Cache-Control: no-store`, `slug` + `displayName` only), `GET /v1/me/bootstrap` inside the tenant lane, `app.onError` envelope, zod validation failures -> 400 `VALIDATION_FAILED`.
- Seed (`pnpm db:seed`): `rede-demo` / `rede-lab`, admin + member each (`SEED_PASSWORD` from env), primary verified `tenant_domains` rows from `TENANT_DEMO_HOST` / `TENANT_LAB_HOST` with demotion of a renamed primary, `PLATFORM_HOST` guard; second run is a no-op.
- Eleven integration cases pass from a clean database (`pnpm db:reset && pnpm db:seed && vitest run tests/integration`): JWKS + envelope (1-3), TENANT-03 adjacency / empty / NOINHERIT (4-6), D-23 host match (7-9), D-20 public lookup (10), D-24 idempotency (11).

## Task Commits

Each task was committed atomically:

1. **Task 1: Toolchain bring-up and @rede-social monorepo scaffold** - `e2cb59f` (chore)
2. **Task 2: Tracer - seeded member's Supabase JWT reaches GET /v1/me/bootstrap** - `2b2991e` (feat)

**Plan metadata:** see the `docs(01-01)` commit that follows this SUMMARY.

## Files Created/Modified

- `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `.nvmrc`, `turbo.json`, `biome.json` - root toolchain (pnpm 12.4.1 via `packageManager` + `manage-package-manager-versions`, Node 24, boundary tags, lint lanes); root scripts `build`/`lint`/`typecheck`/`test`/`boundaries`/`boundaries:negative`/`guard:lanes`/`db:generate`/`db:reset`/`db:seed`/`spike:supavisor`/`test:integration`/`e2e`/`supabase`
- `packages/config/*` - shared `tsconfig.base.json` (strict, Bundler resolution, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`), `vitest.base.ts`, `biome.base.json`
- `packages/contracts/src/{index,errors,hosts,bootstrap,modules}.ts` - `ERROR_CODES` (incl. `TENANT_HOST_MISMATCH`), `ApiErrorEnvelope` + `apiErrorEnvelopeSchema`, `TENANT_HOST_HEADER`, `normalizeHost`, `hostTenantSchema`, `bootstrapSchema`, `TOGGLEABLE_MODULES`, `TENANT_ROLES`, `CONTRACTS_VERSION`
- `packages/core/db/{client,tenant-tx,admin-tx,rls}.ts`, `packages/core/db/schema/*.ts` - postgres.js client (`prepare: false`, `max: 5`), lanes, isolation policy helper, four core tables
- `packages/core/server/{env,supabase-admin}.ts`, `server/auth/{jwks,require-auth,context}.ts`, `server/tenancy/{membership,tenant-host}.ts`, `server/http/api-error.ts` - kernel auth/tenancy/error code
- `apps/api/src/{app,app-type,env,main}.ts`, `src/http/{request-id,logger,openapi}.ts`, `src/routes/{health,public,me}.ts`, `tsup.config.ts`, `vitest.config.ts`, `drizzle.config.ts` - Hono API, OpenAPI doc at `/v1/openapi.json`, `.env.local` loader for tests
- `apps/api/tests/unit/health.test.ts`, `apps/api/tests/integration/{setup,bootstrap.test}.ts` - unit + eleven integration cases
- `supabase/config.toml`, `supabase/templates/recovery.html`, `supabase/roles.sql`, `supabase/seed.sql`, `supabase/migrations/*.sql` (+ `meta/` drizzle snapshots/journal) - local stack, role bootstrap, four migrations in order `app_helpers` -> `core` -> `app_membership_lookup_and_grants` -> `auth_user_mirror`
- `scripts/seed.ts`, `scripts/local-env.sh`, `scripts/db-local-role.sh` - seed, env generator, local `api_user` password
- `.gitignore`, `.env.example` - secrets excluded (`supabase/signing_keys.json`, `.env.*`), every variable documented
- `.planning/config.json` - `git.allow_default_branch_commits: true`

## Decisions Made

- **Local pooler fallback (plan-sanctioned):** the local Supavisor on 54329 rejected `api_user` (`FATAL: (ENOIDENTIFIER) no tenant identifier provided (external_id or sni_hostname required)`) and the Supavisor username form `api_user.rede-social` (`FATAL: (ENOTFOUND) tenant/user api_user.rede-social not found`; `postgres.rede-social` fails the same way, so the local tenant is not addressable by `project_id`). Per the plan's development-only fallback, `scripts/local-env.sh` and the vitest defaults point `DATABASE_URL` at the direct port `postgres://api_user:postgres@127.0.0.1:54322/postgres`. Lane code is unchanged (`set_config(..., true)` + `SET LOCAL ROLE` are transaction-local either way); 01-03's spike retries the pooler and 01-12's hosted run is the authoritative transaction-mode proof for TENANT-03.
- **A1 held:** `jwtVerify(..., { issuer: `${SUPABASE_URL}/auth/v1`, audience: 'authenticated' })` verifies the local GoTrue token as-is; `audience` stays.
- **A5 not needed:** TypeScript 7.0.2 works for `tsc --noEmit` (all packages), Biome and tsup; no `@typescript/typescript6` alias.
- **`supabase status -o env` key names mapped by `scripts/local-env.sh`:** `API_URL` -> `SUPABASE_URL`; `SERVICE_ROLE_KEY` (JWT form, preferred) or `SECRET_KEY` (`sb_secret_...`) -> `SUPABASE_SERVICE_KEY`; `ANON_KEY` (JWT form, preferred) or `PUBLISHABLE_KEY` (`sb_publishable_...`) -> `SUPABASE_PUBLISHABLE_KEY` plus the `NEXT_PUBLIC_*` twins. CLI 2.117.0 emits all four names, so the first choice wins on both.
- **`type: module` at the root** so `tsx scripts/seed.ts` runs as ESM (top-level await).
- **Public host lookup via the admin lane** in `tenant-host.ts` rather than a security-definer SQL function (plan discretion, recorded).
- **`[analytics]` / `[edge_runtime]` disabled** in `supabase/config.toml` (not used by the product; saves two images and RAM on the pilot laptop).
- **`git.allow_default_branch_commits: true`** in `.planning/config.json`: sequential dispatch on `master` with `branching_strategy: none`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Root `package.json` declared as ESM**
- **Found during:** Task 2 (first `pnpm db:seed`)
- **Issue:** `tsx scripts/seed.ts` failed with `Transform failed with 11 errors: Top-level await is currently not supported with the "cjs" output format` because the root package had no `"type": "module"`
- **Fix:** added `"type": "module"` to the root `package.json` (every workspace package already is ESM)
- **Files modified:** `package.json`
- **Verification:** `pnpm db:seed` runs; `pnpm turbo typecheck lint build` still green
- **Committed in:** `2b2991e`

**2. [Rule 3 - Blocking] Local `DATABASE_URL` on the direct port (plan-sanctioned fallback)**
- **Found during:** Task 2 (seed and integration tests through the pooler)
- **Issue:** exact errors above (`ENOIDENTIFIER` for `api_user`, `ENOTFOUND` for `api_user.rede-social`)
- **Fix:** `scripts/local-env.sh` prints `DATABASE_URL=postgres://api_user:postgres@127.0.0.1:54322/postgres` with the explanation; `apps/api/vitest.config.ts` default matches; `.env.example` already documented this fallback
- **Files modified:** `scripts/local-env.sh`, `apps/api/vitest.config.ts`
- **Verification:** eleven integration cases pass from a clean database
- **Committed in:** `2b2991e`

**3. [Rule 1 - Bug] Integration case 6 read the SQLSTATE from the wrong object**
- **Found during:** Task 2 (first test run: 10/11)
- **Issue:** drizzle-orm 0.45 wraps driver errors in `DrizzleQueryError`; the `42501` lives on `cause.code`, so `toMatchObject({ code: '42501' })` failed although `api_user` was correctly denied (`permission denied for table memberships`)
- **Fix:** assertion now matches `{ cause: { code: '42501' } }`
- **Files modified:** `apps/api/tests/integration/bootstrap.test.ts`
- **Verification:** 11/11 pass, twice (second run from `pnpm db:reset`)
- **Committed in:** `2b2991e`

**4. [Rule 2 - Missing critical] Validation failures use the envelope**
- **Found during:** Task 2 (route scaffolding by the previous session)
- **Issue:** `@hono/zod-openapi` answers schema failures with its own 400 body unless a `defaultHook` is set; case 10 requires 400 `VALIDATION_FAILED` in the stable envelope
- **Fix:** `apps/api/src/http/openapi.ts` exports `createOpenApiApp()` whose `defaultHook` throws `ApiError(400, 'VALIDATION_FAILED', { issues })`; `public.ts` / `me.ts` are built with it
- **Files modified:** `apps/api/src/http/openapi.ts`, `apps/api/src/routes/{public,me}.ts`
- **Verification:** integration case 10 (`?host` missing -> 400 `VALIDATION_FAILED`)
- **Committed in:** `2b2991e`

**5. [Rule 3 - Blocking] Toolchain / environment adjustments (Task 1)**
- `corepack enable` lacked permission on `/usr/local/bin`; pnpm 12's own version management (`.npmrc` `manage-package-manager-versions=true` + `packageManager`) pins 12.4.1 without corepack.
- `supabase/config.toml`: `[analytics]` and `[edge_runtime]` disabled (see Decisions).
- `.planning/config.json`: `git.allow_default_branch_commits: true` (see Decisions).
- Docker Desktop's `credsStore: "desktop"` hangs image pulls in headless sessions; every `supabase`/`docker` call ran with `DOCKER_CONFIG=/tmp/dockercfg` (an empty `config.json`). Environment-only, nothing committed.
- An early `biome check --write .` (before `files.includes` excluded `.claude/`) reformatted 22 installer-generated `.claude/hooks/*.js` files (whitespace/import order only; all still parse; they are untracked, nothing to commit).
- **Committed in:** `e2cb59f` (config changes only)

---

**Total deviations:** 5 auto-fixed (3 blocking, 1 bug, 1 missing critical)
**Impact on plan:** all fixes were required to run the tracer against the live stack; the pooler fallback is the path the plan itself prescribes for the local stack and does not weaken the TENANT-03 evidence chain (01-03 spike + 01-12 hosted run). No scope creep.

## Issues Encountered

- **Checkpoint (human-action, resolved):** the previous executor session could not start the local stack — the host disk had 1.3 GiB free and Docker Desktop's containerd returned `input/output error` on image pulls. The user freed space (`npm cache clean --force`, 11 GB) and reset Docker Desktop's data (`Docker.raw`). This session pulled the ten Supabase images (~7.6 GB) with `DOCKER_CONFIG=/tmp/dockercfg pnpm supabase start` (exit 0) and continued from Task 1's last criterion.
- Task 1's toolchain smoke (`pnpm turbo typecheck lint build`) was verified green on the complete tree after the Task 2 extensions (the previous session had also verified it before the Task 2 files existed); the Task 1 commit `e2cb59f` contains the pre-extension `app.ts` / `contracts/src/index.ts`.

## Known Stubs

| File | Line(s) | Stub | Reason / resolved by |
|------|---------|------|----------------------|
| `apps/api/src/routes/me.ts` | `modules: []`, `permissions: []` | bootstrap returns no modules/permissions | plan 01-06 fills them from `tenant_modules` + the module registry (D-16/D-17) |
| `apps/api/src/routes/me.ts` | `counters: { unreadNotifications: 0, unreadConversations: 0 }` | zero counters | Phase 7 (notifications / chat) |
| `packages/ui/src/index.ts` | `UI_PACKAGE = '@rede-social/ui'` | placeholder export | Phase 2 ports the prototype components |

These stubs are specified by the plan and do not block this plan's goal (the tracer never reads them).

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: information-disclosure (low) | `apps/api/src/app.ts` | `GET /v1/openapi.json` is served unauthenticated in every environment (plan-specified). CLAUDE.md wants API docs dev/staging only; 01-09/01-11 should gate it by environment or leave it (the document lists public routes only, no secrets). |

## Authentication Gates

None.

## User Setup Required

None - no external service configuration required (local stack only; `SEED_PASSWORD` is passed on the command line and never stored).

## Next Phase Readiness

- The spine is proven end-to-end; plan 01-02 can scaffold `@rede-social/web` and put the browser login slice on `GET /v1/me/bootstrap`, forwarding `x-tenant-host` from `proxy.ts`.
- Plan 01-03's Supavisor spike must retry the local pooler (`SPIKE_DATABASE_URL`) and record the same errors if the local tenant stays unaddressable; the hosted pooler run in 01-12 is the authoritative TENANT-03 proof.
- Local developer loop: `pnpm supabase start`, `bash scripts/local-env.sh > apps/api/.env.local`, `pnpm db:reset`, `SEED_PASSWORD=... pnpm db:seed`, `SEED_PASSWORD=... pnpm test:integration`. On this machine prefix Docker/Supabase commands with `DOCKER_CONFIG=/tmp/dockercfg` while the Desktop credential helper misbehaves.

---
*Phase: 01-foundation-kernel-tenancy-auth-ci-cd*
*Completed: 2026-09-12*

## Self-Check: PASSED

All key files exist on disk; task commits e2cb59f and 2b2991e are in `git log`; `pnpm turbo typecheck lint build`, the health unit test and the eleven integration cases were re-run green from a clean `pnpm db:reset` before this SUMMARY was written.
