# Phase 1: Foundation - Kernel, Tenancy, Auth & CI/CD - Pattern Map

**Mapped:** 2026-09-11
**Files analyzed:** 62 (all new; greenfield repo)
**Analogs found:** 0 in-repo / 62 — the application repository contains no source code (tracked files are only `.planning/**`, `.claude/CLAUDE.md`, `.gitignore`). Every file below is created from the code shapes captured in `01-RESEARCH.md` and `.planning/research/ARCHITECTURE.md`, which this document indexes by section so the planner can point each task at the exact excerpt.

**Tracked-source gate:** `reference/frontend-design/` is gitignored (`git ls-files` returns nothing for it). It is therefore NOT an analog and must never be named as one in a PLAN action. It is listed once, below, strictly as a copy/field-order reference for the auth forms. `contexts/AuthContext.tsx` in the prototype is a localStorage mock and is excluded entirely.

## How to read this map

- **Analog column** is one of: `RESEARCH §<pattern/section>` (verbatim shape exists there — copy it), `ARCHITECTURE §Pattern N` (SQL/type sketch exists there), or `none` (planner writes from the library's official docs cited in RESEARCH §Sources).
- Roles: `config`, `schema`, `migration`, `service`, `middleware`, `route`, `page`, `action`, `component`, `script`, `test`, `workflow`, `doc`.
- Data flow: `request-response`, `CRUD`, `transform`, `event-driven`, `batch`, `static`.

## File Classification

### Monorepo root and shared config

| New File | Role | Data Flow | Analog | Match |
|---|---|---|---|---|
| `package.json` (root, `packageManager: pnpm@12.4.1`, `engines.node >=24`) | config | static | RESEARCH §Standard Stack "Installation (root)", §Pitfall 9 | shape |
| `pnpm-workspace.yaml` (`apps/*`, `packages/*`, `packages/modules/*`) | config | static | RESEARCH §Recommended Project Structure | shape |
| `turbo.json` (tasks + `boundaries.tags`) | config | static | RESEARCH §Pattern 7 item 2 (JSON excerpt) | exact |
| `biome.json` (+ `overrides` with `noRestrictedImports` patterns) | config | static | RESEARCH §Pattern 7 item 3 | shape |
| `.nvmrc` / `.node-version` = `24` | config | static | RESEARCH §Pitfall 9 | exact |
| `.env.example` | config | static | RESEARCH §Runtime State Inventory | none |
| `packages/config/{tsconfig.base.json, vitest.base.ts, biome.base.json}` | config | static | RESEARCH §Validation Architecture "Config file" | none |
| `packages/boundary-fixture/package.json` (negative MOD-02 fixture) | test | static | RESEARCH §Validation Architecture MOD-02 row | shape |
| `legal/termos-de-uso.md`, `legal/politica-de-privacidade.md` (front-matter `version:`) | doc | static | CONTEXT D-03; RESEARCH §Security "Consent tampering" | none |

### `@rede-social/contracts` (`packages/contracts`)

| New File | Role | Data Flow | Analog | Match |
|---|---|---|---|---|
| `modules.ts` (`TOGGLEABLE_MODULES`, `ModuleKey`, `REAL_TENANT_DEFAULT_MODULES`) | config | static | RESEARCH §Pattern 3 lines 457-460 | exact |
| `errors.ts` (`ERROR_CODES`) | config | static | RESEARCH §Pattern 10 line 603 | exact |
| `auth.ts` (Zod: `signupSchema`, `loginSchema`, `forgotSchema`, `resetSchema`; `password.min(8)`, slug regex) | schema | transform | RESEARCH §Pattern 4 step 2; §Security V5 | shape |
| `bootstrap.ts` (`Bootstrap` type) | schema | static | ARCHITECTURE §Pattern 3 `type Bootstrap` | exact |
| `events.ts` (`EventMap`) | schema | static | RESEARCH §Pattern 9 last bullet | none |
| `index.ts` (re-exports + `export type { AppType }`) | config | static | RESEARCH §"Hono app composition" line 846 | shape |

### `@rede-social/core` (`packages/core`) — kernel

| New File | Role | Data Flow | Analog | Match |
|---|---|---|---|---|
| `db/client.ts` | config | CRUD | RESEARCH §Pattern 1 "packages/core/db/client.ts" | exact |
| `db/tenant-tx.ts` (`withTenantTx`, `withAdminTx`) | service | CRUD | RESEARCH §Pattern 1 "packages/core/db/tenant-tx.ts" | exact |
| `db/rls.ts` (`tenantIsolationPolicy(table)` helper wrapping `pgPolicy` with `app.tenant_id()`) | utility | static | RESEARCH §Code Examples "Core schema with RLS policy" lines 736-741 | shape |
| `db/schema/tenants.ts` | schema | CRUD | RESEARCH §Code Examples paragraph after `memberships` (column list); ARCHITECTURE §Pattern 2 `core.tenants` | shape |
| `db/schema/users.ts` | schema | CRUD | ARCHITECTURE §Pattern 2 `core.users`; RESEARCH §Pattern 4 step 3 (trigger mirror) | shape |
| `db/schema/memberships.ts` | schema | CRUD | RESEARCH §Code Examples "Core schema with RLS policy" (full file) | exact |
| `db/schema/platform-admins.ts` | schema | CRUD | ARCHITECTURE §Pattern 2 `core.platform_admins` (no `authenticated` policy) | shape |
| `db/schema/tenant-modules.ts` | schema | CRUD | ARCHITECTURE §Pattern 3 `core.tenant_modules` SQL | exact (SQL → Drizzle) |
| `db/schema/consent-records.ts` | schema | CRUD (append-only) | CONTEXT D-03 column list; RESEARCH §Code Examples paragraph | shape |
| `db/schema/chat-stubs.ts`, `db/schema/notification-stubs.ts` | schema | CRUD | RESEARCH §Code Examples paragraph ("stubs … with `seq bigint`") | shape |
| `db/schema/index.ts` | config | static | none | none |
| `server/auth/jwks.ts` | config | request-response | RESEARCH §Pattern 2 line 432 | exact |
| `server/auth/require-auth.ts` | middleware | request-response | RESEARCH §Pattern 2 (full excerpt) | exact |
| `server/auth/context.ts` (`RequestContext`, `AppEnv`) | schema | static | RESEARCH §Pattern 2 line 447 (`c.set('ctx', …)`) | shape |
| `server/tenancy/membership.ts` (`membershipForUser`) | service | request-response | RESEARCH §Pattern 1 `app.membership_for_user` SQL (call it via `db.execute`) | shape |
| `server/tenancy/signup.ts` (admin lane: `createUser` → membership + consents; compensation) | service | CRUD | RESEARCH §Pattern 4 step 3; §Pitfall 7 | shape |
| `server/supabase-admin.ts` | config | request-response | RESEARCH §"Idempotent seed" line 910 (`createClient(…, SERVICE_KEY, { auth: { persistSession: false } })`) | exact |
| `server/modules/registry.ts` (`ModuleManifest`, `MODULE_REGISTRY`) | config | static | RESEARCH §Pattern 3 lines 462-470 | exact |
| `server/modules/require-module.ts` | middleware | request-response | RESEARCH §Pattern 3 lines 472-479 | exact |
| `server/modules/flags-cache.ts` (30 s TTL, tenant-prefixed) | service | CRUD | RESEARCH §Pattern 3 comment line 479 | shape |
| `server/rbac/require-role.ts`, `server/platform/require-super-admin.ts` | middleware | request-response | RESEARCH §Pattern 2 last paragraph (`platform_admins` lookup) | shape (copy `requireAuth` skeleton) |
| `server/events/bus.ts` | service | event-driven | RESEARCH §Pattern 9 last bullet (after-commit flush of `ctx.events`) | none |
| `server/jobs/boss.ts` | service | event-driven | RESEARCH §Pattern 9 bullets 1-3 (`new PgBoss({... migrate:false, max:2})`, `fromDrizzle(tx, sql)`) | shape |
| `server/http/api-error.ts` | utility | request-response | RESEARCH §Pattern 10 lines 601-608 | exact |
| `server/http/{request-id,logger}.ts` (pino, `tenant_id`/`user_id`/`request_id`) | middleware | request-response | none (CONTEXT discretion) | none |
| `docs/SCHEMA-CONVENTIONS.md` | doc | static | PITFALLS §9 (referenced in RESEARCH §Recommended Project Structure) | none |

### `@rede-social/module-example` (`packages/modules/example`) — throwaway template (D-19)

| New File | Role | Data Flow | Analog | Match |
|---|---|---|---|---|
| `package.json` (`exports`: `./module ./contracts ./server ./ui ./db`; `turbo.json` `tags: ["module"]`) | config | static | RESEARCH §Pattern 7 item 1 | shape |
| `module.ts` (`ModuleManifest { key:'example', nav, jobs, events }`) | config | static | RESEARCH §Pattern 3 `ModuleManifest` | exact |
| `db/schema.ts` (`example_items`: `tenant_id` + policy + `enableRLS()`) | schema | CRUD | `packages/core/db/schema/memberships.ts` shape (RESEARCH §Code Examples) | exact |
| `server/routes.ts` (GET list / POST create) | route | request-response | RESEARCH §"Hono app composition" (mount line 844) + §Pattern 10 error usage | shape |
| `server/service.ts` (queries inside `withTenantTx`, emits `example.item.created`) | service | CRUD | RESEARCH §Pattern 1 `withTenantTx` usage | shape |
| `server/jobs.ts` (`example.process` queue, `boss.send(…, { db: fromDrizzle(tx, sql) })`) | service | event-driven | RESEARCH §Pattern 9 bullet 2 | exact |
| `contracts/index.ts` (Zod item schema) | schema | transform | none | none |
| `ui/ExampleWidget.tsx` (server component fed by RSC fetch) | component | request-response | none | none |

### `@rede-social/api` (`apps/api`)

| New File | Role | Data Flow | Analog | Match |
|---|---|---|---|---|
| `src/app.ts` | config | request-response | RESEARCH §"Hono app composition and RPC export" + §Pattern 10 `app.onError` | exact |
| `src/main.ts` (`ROLE` switch, SIGTERM) | config | request-response | RESEARCH §"apps/api/src/main.ts" | exact |
| `src/env.ts` (`@t3-oss/env-core`) | config | static | none | none |
| `src/routes/public.ts` (`GET /v1/public/tenants/:slug`, `POST /v1/public/signup/:slug`) | route | request-response | RESEARCH §Pattern 4 steps 1-3 | shape |
| `src/routes/me.ts` (`GET /v1/me/bootstrap`) | route | request-response | ARCHITECTURE §Pattern 3 `Bootstrap`; RESEARCH §Pattern 3 last paragraph (counters zero, nav order) | shape |
| `src/routes/platform.ts` (stub behind `requireSuperAdmin`) | route | request-response | RESEARCH §"Hono app composition" line 845 | shape |
| `src/routes/health.ts` (`GET /v1/health` → `select 1`) | route | request-response | RESEARCH §Pitfall 4 | none |
| `drizzle.config.ts` | config | static | RESEARCH §Code Examples "drizzle.config.ts" | exact |
| `tsup.config.ts` (`dts: false`) | config | static | RESEARCH §Pitfall 3 | shape |
| `Dockerfile` (`turbo prune @rede-social/api --docker`, `node:24-slim`) | config | static | CLAUDE.md §7 "Docker" bullet | shape |
| `tests/integration/{setup,bootstrap,isolation,modules,signup,auth-middleware}.test.ts` | test | request-response | RESEARCH §Validation Architecture "Phase Requirements → Test Map"; spike file for Vitest+postgres setup shape | shape |

### `@rede-social/web` (`apps/web`)

| New File | Role | Data Flow | Analog | Match |
|---|---|---|---|---|
| `proxy.ts` | middleware | request-response | RESEARCH §Pattern 5 "apps/web/proxy.ts" (full excerpt) | exact |
| `lib/supabase/server.ts` | config | request-response | RESEARCH §Pattern 5 "apps/web/lib/supabase/server.ts" | exact |
| `lib/supabase/client.ts` | config | request-response | Supabase example `examples/auth/nextjs/lib/supabase/client.ts` (RESEARCH §Sources) — not needed for Phase 1 forms; create only if a client component needs it | none |
| `lib/api.ts` (`hc<AppType>(API_URL, { headers: { Authorization } })`) | utility | request-response | RESEARCH §Pattern 5 bullet "Calling the API from RSC/server actions" | shape |
| `lib/env.ts` (`@t3-oss/env-nextjs`) | config | static | none | none |
| `app/(auth)/layout.tsx` | page | static | none (neutral platform chrome) | none |
| `app/(auth)/entrar/page.tsx` | page | request-response | copy tone: prototype `app/(auth)/login/page.tsx` (gitignored, see note) | reference only |
| `app/(auth)/cadastro/[slug]/page.tsx` | page | request-response | copy tone: prototype `app/(auth)/register/page.tsx` (drop `username`, drop confirm-password; add two consent checkboxes per D-03) | reference only |
| `app/(auth)/cadastro/[slug]/not-found.tsx` | page | static | none | none |
| `app/(auth)/esqueci-senha/page.tsx` | page | request-response | copy tone: prototype `app/(auth)/forgot-password/page.tsx`; response copy from D-10 | reference only |
| `app/(auth)/redefinir-senha/page.tsx` | page | request-response | RESEARCH §Pattern 6 step 4 | shape |
| `app/(auth)/acesso-suspenso/page.tsx` | page | static | CONTEXT D-09 copy | none |
| `app/(auth)/actions.ts` (`login`, `signup`, `forgot`, `reset`, `logout`) | action | request-response | RESEARCH §Pattern 4 step 2/4, §Pattern 5 bullets (logout/blocked), §Pattern 6 steps 1/4 | shape |
| `app/auth/confirm/route.ts` | route | request-response | RESEARCH §Pattern 6 step 3 (+ open-redirect guard in §Anti-Patterns) | shape |
| `app/(app)/layout.tsx` (bootstrap fetch, `MEMBERSHIP_BLOCKED` → signOut + redirect) | page | request-response | RESEARCH §Pattern 5 "Blocked member" bullet; ARCHITECTURE §Pattern 4 step 4 | shape |
| `app/(app)/inicio/page.tsx` | page | request-response | CONTEXT D-07 | none |
| `app/api/proxy/[...path]/route.ts` (optional BFF) | route | request-response | RESEARCH §Pattern 5 bullet (client-side fetching) | none |
| `messages/pt-BR.json` | config | static | CONTEXT §Specific Ideas (all copy strings) | none |
| `playwright.config.ts`, `e2e/{auth,session,recovery,logout}.spec.ts` | test | request-response | RESEARCH §Validation Architecture rows AUTH-01..05 | none |

### Supabase (`supabase/`)

| New File | Role | Data Flow | Analog | Match |
|---|---|---|---|---|
| `config.toml` (`[auth]` min length 8, autoconfirm, `[auth.email.smtp]` Resend via `env()`, `[db.pooler] enabled`, recovery template path) | config | static | RESEARCH §Pattern 6 (SMTP block), §Pattern 5 last bullet (jwt defaults) | shape |
| `roles.sql` (`api_user` NOLOGIN NOBYPASSRLS NOINHERIT + grants) | migration | static | RESEARCH §Pattern 1 "Role bootstrap" | exact |
| `migrations/<ts>_app_helpers.sql` (`app.tenant_id()`, `app.tenant_role()`, `app.membership_for_user()`, public grants, revoke `anon`) | migration | static | RESEARCH §Pattern 1 two SQL blocks; §Pitfall 6; §Anti-Patterns "Data API exposure" | exact |
| `migrations/<ts>_auth_user_mirror.sql` (`handle_new_user` trigger → `public.users`) | migration | event-driven | RESEARCH §Pattern 4 step 3 (Supabase `managing-user-data` pattern) | shape |
| `migrations/<ts>_pgboss.sql` (`pg-boss plans migrate --dry-run` output + grants) | migration | static | RESEARCH §Pattern 9 bullet 1 | shape |
| `migrations/<ts>_core.sql` etc. (GENERATED by `drizzle-kit generate`) | migration | static | generated — never hand-edit | n/a |
| `templates/recovery.html` | config | static | RESEARCH §Pattern 6 step 2 (link shape) | exact |
| `seed.sql` (empty on purpose) | config | static | RESEARCH §Recommended Project Structure | exact |
| `tests/000-helpers.sql` | test | static | none | none |
| `tests/010-rls-coverage.sql` | test | static | RESEARCH §"pgTAP: every tenant_id table has RLS" (full file) | exact |
| `tests/020-tenant-isolation.sql` | test | static | RESEARCH §"020-tenant-isolation.sql" (full file) | exact |
| `tests/030-lanes.sql`, `tests/040-schema-conventions.sql` | test | static | copy structure of `020`; assertions listed in RESEARCH §Pattern 1 last paragraphs and §Anti-Patterns bullet 1 | shape |

### Scripts and CI

| New File | Role | Data Flow | Analog | Match |
|---|---|---|---|---|
| `scripts/seed.ts` | script | batch | RESEARCH §"Idempotent seed (D-14)" (full excerpt) | exact |
| `scripts/spike-supavisor.test.ts` | test | CRUD | RESEARCH §"Supavisor spike (Wave 0)" (full file) | exact |
| `.github/workflows/ci.yml` | workflow | batch | RESEARCH §"GitHub Actions skeleton" ci.yml | exact |
| `.github/workflows/deploy-api.yml` | workflow | batch | RESEARCH §"GitHub Actions skeleton" deploy-api.yml (excerpt) + §Pattern 8 action versions | shape |
| `.github/workflows/seed-prod.yml` (`workflow_dispatch`, `environment: production`) | workflow | batch | RESEARCH §Pattern 8 "Seed" bullet | none |
| `.github/workflows/keepalive-staging.yml` (cron → `/v1/health`) | workflow | batch | RESEARCH §Pitfall 4 | none |

## Pattern Assignments (concrete excerpts worth copying)

The full excerpts already exist in `01-RESEARCH.md`; the planner should reference them by section rather than re-paste. Only the load-bearing lines are repeated here.

### `packages/core/db/tenant-tx.ts` (service, CRUD) — RESEARCH §Pattern 1

The two statements that make RLS work on the transaction pooler. Both MUST be `LOCAL`; a CI grep guard (`rg "set_config\('request\.jwt\.claims'.*false\)|^\s*set role" packages apps` must be empty) protects this.

```ts
await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
await tx.execute(sql`set local role authenticated`);
```

Admin lane is the same wrapper with `set local role service_role`; importable only from `packages/core/server/{tenancy,platform,seed}` (Biome `noRestrictedImports` pattern, RESEARCH §Pattern 7 item 3).

### Every tenant-owned table (schema, CRUD) — RESEARCH §Code Examples "Core schema with RLS policy"

Copy `memberships.ts` verbatim as the template; the load-bearing tail is:

```ts
}, (t) => [
  pgPolicy('<table>_tenant_isolation', {
    for: 'all', to: authenticatedRole,
    using: sql`tenant_id = app.tenant_id()`,
    withCheck: sql`tenant_id = app.tenant_id()`,
  }),
]).enableRLS();   // drizzle-orm 0.45.2: enableRLS(), NOT withRLS()
```

Applies to: `tenants` (policy `id = app.tenant_id()`), `memberships`, `tenant_modules`, `consent_records` (select-only policy; inserts via admin lane; no update/delete policy), `chat_*`, `notifications`, `example_items`. `platform_admins` gets `enableRLS()` with NO `authenticated` policy.

### `packages/core/server/auth/require-auth.ts` (middleware, request-response) — RESEARCH §Pattern 2

Copy the whole excerpt. Non-negotiables: JWKS created once at module level; `membershipForUser` called on every request with no cache; blocked → `new ApiError(403, 'MEMBERSHIP_BLOCKED', { tenantName })`. `requireModule`, `requireRole`, `requireSuperAdmin` reuse the same `createMiddleware<AppEnv>` skeleton and throw `ApiError`.

### `packages/core/server/http/api-error.ts` + `apps/api/src/app.ts` `onError` (utility, request-response) — RESEARCH §Pattern 10

Envelope contract every client screen depends on:

```ts
{ error: { code, message, details?, requestId } }   // code ∈ ERROR_CODES (@rede-social/contracts)
```

### `apps/api/src/app.ts` route composition (config) — RESEARCH §"Hono app composition and RPC export"

Chained `.route()` calls so `export type AppType = typeof routes` carries every route for `hc<AppType>()`; `@rede-social/contracts` re-exports the type. Mount order: `/v1/public` (no auth) → `/v1/me` (`requireAuth`) → `/v1/example` (`requireAuth, requireModule('example')`) → `/v1/platform` (`requireAuth, requireSuperAdmin()`).

### `apps/web/proxy.ts` and `lib/supabase/server.ts` (middleware/config) — RESEARCH §Pattern 5

Copy both verbatim. Rules that must survive edits: nothing runs between `createServerClient` and `getClaims()`; return the same `response` object whose cookies `setAll` populated; `tenant_slug` cookie set only on `/cadastro/:slug` (1 year, `SameSite=Lax`); `PUBLIC` allow-list = `/entrar`, `/cadastro/*`, `/esqueci-senha`, `/redefinir-senha`, `/auth/*`, `/acesso-suspenso`.

### `apps/web/app/(auth)/actions.ts` (action, request-response) — RESEARCH §Patterns 4, 5, 6

One server action per flow, each ending in `redirect()`:

| Action | Supabase / API call | Redirect |
|---|---|---|
| `login` | `supabase.auth.signInWithPassword` | `/inicio` |
| `signup` | `POST /v1/public/signup/:slug` (API admin lane) then `signInWithPassword` | `/inicio`; on `409 EMAIL_ALREADY_REGISTERED` re-render with D-04 copy + link to `/entrar` |
| `forgot` | `resetPasswordForEmail(email, { redirectTo: \`${SITE_URL}/auth/confirm?next=/redefinir-senha\` })` | same page, D-10 constant copy |
| `reset` | `supabase.auth.updateUser({ password })` | `/inicio` |
| `logout` | `supabase.auth.signOut({ scope: 'local' })` | `/entrar` |

`app/auth/confirm/route.ts`: `verifyOtp({ type, token_hash })`; accept `next` only when it matches `^/[^/]`.

### Auth pages (page, request-response) — prototype reference only (gitignored, not an analog)

Prototype `reference/frontend-design/app/(auth)/{login,register,forgot-password}/page.tsx` were read for field order and copy. Keep for continuity:

- Login: Email → Senha → primary "Entrar" ("Entrando..." while pending) → link "Esqueceu a senha?" → divider "ou" → secondary "Criar nova conta" (Phase 1: points to `/cadastro/{tenant_slug cookie}`; hidden if no cookie).
- Register: title "Criar conta"; fields Nome completo → Email → Senha (with show-password toggle, D-02; no Username, no Confirmar senha) → two consent checkboxes (D-03) → "Cadastrar" ("Criando..."); footer "Já tem conta? Entrar" → `/entrar`.
- Forgot: title "Recuperar senha"; helper "Informe seu email e enviaremos um link para redefinir sua senha."; button "Enviar link"; link "Voltar para login" → `/entrar`. Success message is the D-10 constant copy, rendered inline (no Toast component in Phase 1).

Do NOT copy: `"use client"` + `useAuth()` + `useState` submit handlers (prototype is a client-side mock). Phase 1 pages are server components rendering a `<form action={serverAction}>`; pending state via `useFormStatus` in a tiny client submit button if desired. Prototype `Input`/`Button`/`Toast` primitives are Phase 2.

### `scripts/seed.ts`, `scripts/spike-supavisor.test.ts`, `supabase/tests/0{1,2}0-*.sql`, `.github/workflows/ci.yml` — RESEARCH §Code Examples

All four exist as complete files in RESEARCH; copy verbatim and fill in the elided UUIDs / secrets names. `030-lanes.sql` copies the `020` structure and asserts: inside lane `current_user = 'authenticated'`; after lane `current_user = 'api_user'` and `current_setting('request.jwt.claims', true) = ''`; bare `api_user` select on a tenant table raises `42501`.

## Shared Patterns

### Tenant lane (apply to: every service that touches tenant tables, example module service, jobs handlers)
**Source:** RESEARCH §Pattern 1 `withTenantTx`. Handlers never import `db` directly; they receive `tx` from `withTenantTx(ctx, …)`. Jobs build a synthetic `ctx` from `payload.tenantId`.

### Admin lane (apply to: `server/tenancy/signup.ts`, `scripts/seed.ts`, `/v1/platform/*`)
**Source:** RESEARCH §Pattern 1 `withAdminTx` + `server/supabase-admin.ts`. Import-restricted by Biome pattern (RESEARCH §Pattern 7 item 3); pgTAP proves the tenant lane never runs as `service_role`.

### Error handling (apply to: all API routes/middleware and the web `(app)/layout.tsx`)
**Source:** RESEARCH §Pattern 10. Throw `ApiError(status, code, details?)`; never `c.json({ error: '…' })` ad hoc. Web switches on `error.code` from `@rede-social/contracts` (`MEMBERSHIP_BLOCKED` → signOut local + `/acesso-suspenso?t=`; `NO_MEMBERSHIP` → "conta sem comunidade" pointing to `/cadastro/{cookie}`).

### Validation (apply to: all API routes with bodies, all web forms)
**Source:** RESEARCH §Pattern 4 step 2. One Zod schema per flow in `@rede-social/contracts`, consumed by `@hono/zod-openapi` on the API and `@hookform/resolvers`/manual `safeParse` in server actions. Password `min(8)` in both places plus `minimum_password_length = 8` in `config.toml`.

### Module boundary (apply to: every `packages/modules/*`, `apps/web`, `packages/core`)
**Source:** RESEARCH §Pattern 7 (three layers). `turbo.json` tags `module` / `kernel` / `contracts` / `app`; package `exports` without `./src/*`; Biome `noRestrictedImports` patterns. `packages/boundary-fixture` is the CI negative test.

### Logging (apply to: API + worker)
**Source:** CONTEXT discretion; CLAUDE.md pino row. `requestId` middleware first, `pino` child logger with `{ requestId, tenantId, userId }` set after `requireAuth`; map `level` → `severity`.

## No Analog Found

Files the planner writes from official docs cited in RESEARCH §Sources (no code shape exists anywhere in the repo or research):

| File | Role | Data Flow | Reason / where to look |
|---|---|---|---|
| `packages/core/server/events/bus.ts` | service | event-driven | Discretion; RESEARCH §Pattern 9 describes intent only (typed `EventMap`, after-commit flush) |
| `packages/core/server/modules/flags-cache.ts` | service | CRUD | Discretion; 30 s TTL `Map` keyed by tenantId |
| `packages/core/server/http/{request-id,logger}.ts` | middleware | request-response | Discretion; hono `requestId` middleware + pino |
| `apps/api/src/env.ts`, `apps/web/lib/env.ts` | config | static | `@t3-oss/env-core` / `env-nextjs` docs |
| `apps/web/app/(app)/inicio/page.tsx`, `ExampleWidget.tsx` | page/component | request-response | Placeholder per D-07/D-19; RSC fetch via `lib/api.ts` |
| `apps/web/app/api/proxy/[...path]/route.ts` | route | request-response | Optional; only if a client component must call the API |
| `apps/web/messages/pt-BR.json` | config | static | next-intl docs; strings from CONTEXT §Specific Ideas |
| `apps/web/playwright.config.ts`, `e2e/*.spec.ts` | test | request-response | Playwright docs; `devices['iPhone 14']`; Mailpit URL from `supabase status` for recovery |
| `supabase/migrations/<ts>_auth_user_mirror.sql` | migration | event-driven | Supabase "managing-user-data" `handle_new_user` trigger |
| `supabase/tests/000-helpers.sql`, `040-schema-conventions.sql` | test | static | pgTAP docs; optional `basejump-supabase_test_helpers` |
| `packages/core/docs/SCHEMA-CONVENTIONS.md` | doc | static | PITFALLS §9 |
| `.github/workflows/{seed-prod,keepalive-staging}.yml` | workflow | batch | GitHub Actions docs; RESEARCH §Pattern 8 / §Pitfall 4 |
| `apps/api/Dockerfile`, `tsup.config.ts` | config | static | Turborepo `prune --docker` docs; tsup docs (`dts: false`) |

## Metadata

**Analog search scope:** `git ls-files` at repo root (tracked: `.planning/**`, `.claude/CLAUDE.md`, `.gitignore` only); `reference/frontend-design/app/(auth)/**` (gitignored, reference only); `.planning/research/ARCHITECTURE.md` §Patterns 2-4; `01-RESEARCH.md` §Patterns 1-10 and §Code Examples.
**Files scanned:** 3 prototype pages, 2 research documents, ARCHITECTURE.md Patterns 2-4.
**Pattern extraction date:** 2026-09-11
