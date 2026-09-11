# Phase 1: Foundation - Kernel, Tenancy, Auth & CI/CD - Research

**Researched:** 2026-09-11
**Domain:** Multi-tenant SaaS foundation — pnpm/Turborepo monorepo, Supabase (Postgres + RLS + Auth), Hono API on Cloud Run, Next.js 16 BFF on Vercel, GitHub Actions CI/CD
**Confidence:** MEDIUM-HIGH (stack versions and every API shape verified against the npm registry, installed package typings or official docs this session; a few Postgres/Supavisor behaviours remain `[ASSUMED]` until the Wave-0 spike runs)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Sign-up link and consent
- **D-01:** Public sign-up link is `/cadastro/{slug}` (e.g. `app.seusistema.com/cadastro/igor-alves`). Login lives at `/entrar` with no slug. All public auth routes use pt-BR paths (`/entrar`, `/cadastro/{slug}`, `/esqueci-senha`, `/redefinir-senha`). — **Reversibility:** costly — once the pilot tenant shares its link on WhatsApp, changing the URL shape requires permanent redirects.
- **D-02:** Sign-up form collects **name, e-mail, password** only. No username (not in the data model), no confirm-password field (use a show-password toggle instead). Photo and bio are collected in the Phase 3 first-access nudge, not here.
- **D-03:** Consent is **two separate checkboxes**: (a) "Li e aceito as regras da comunidade {tenant}" opening a bottom sheet with the tenant's rules text; (b) "Aceito os Termos de Uso e a Política de Privacidade da TRIA". Each acceptance is recorded in a `consent_records` table with `tenant_id`, `user_id`, `kind` (`tenant_rules` | `tria_terms`), `text_version`, `accepted_at`, `ip`. TRIA terms/privacy text lives as versioned markdown in the repo; tenant rules live in a column on `tenants` (`rules_text`, `rules_version`), editable by `admin_tenant` in Phase 8. — **Reversibility:** one-way — consent records are LGPD evidence; the table shape and versioning must be right from the first real sign-up.
- **D-04:** **No e-mail confirmation** in the pilot: Supabase autoconfirm on, the user is signed in immediately after sign-up. E-mail confirmation becomes a per-tenant toggle later (deferred). If the e-mail already exists in `auth.users` (same or other tenant), the API answers with a generic pt-BR message "Este e-mail já está cadastrado. Entre com sua senha." plus a link to `/entrar`; a cross-tenant duplicate is logged internally as a V2 multi-tenant signal. V1 keeps one membership per user (ROLE-02).

#### Session, login, logout and blocking
- **D-05:** Session is **indefinite while the app is used**: 1 h access token refreshed by a non-expiring refresh token (Supabase defaults, no inactivity time-box). Blocking still takes effect immediately because the API checks membership status on every request.
- **D-06:** Tenant memory across the register -> login round-trip uses a **`tenant_slug` cookie** (1 year) set when `/cadastro/{slug}` is visited. `/entrar` reads it only to show the tenant's display name and to point "Criar conta" back to the correct slug. The real tenant is always resolved from the membership after login, never from the cookie or hostname.
- **D-07:** After login the user lands on **`/inicio`**, a placeholder page that renders `/me/bootstrap` (tenant name, role, enabled modules) and a "Sair" button. Phase 2 replaces it with `/feed` inside the branded shell.
- **D-08:** "Sair" signs out **this device only** (Supabase `signOut({ scope: 'local' })`); phone and desktop sessions are independent.
- **D-09:** A blocked member receives **HTTP 403 with error code `MEMBERSHIP_BLOCKED`** on the next API request; the web app clears the session and shows a pt-BR "acesso suspenso" screen naming the tenant ("Seu acesso a {tenant} foi suspenso. Fale com a equipe.") with no reason details. A later login attempt lands on the same screen. — **Reversibility:** costly — the error code is part of the API contract consumed by every client screen from Phase 2 on.
- **D-10:** Password recovery: `/esqueci-senha` always answers "Se existir uma conta com este e-mail, enviamos um link" (no account enumeration). The e-mail link opens `/redefinir-senha`, which sets the new password and signs the user in. Password policy: **minimum 8 characters**, no symbol/case rules, simple strength indicator; same rule at sign-up.

#### Environments, branches, seed and e-mail
- **D-11:** Branch model: rename `master` -> **`main`** and create the repository under the `tria-company` GitHub organisation. **`main` = production**; **every PR = Vercel Preview + Cloud Run `api-staging` / `worker-staging`** pointing at the staging Supabase project. Only `main` and PR branches exist.
- **D-12:** Production deploy after merge to `main`: Vercel publishes the web app automatically; the GCP workflow runs lint/typecheck/tests/pgTAP, then pauses at a `migrate-and-deploy-prod` job behind a GitHub Environment named `production` requiring **one manual approval**. Order inside the job: Supabase migrations -> API -> worker.
- **D-13:** Outbound auth e-mails (recovery, and confirmation once enabled) go through **Resend configured as Supabase Custom SMTP** on both projects (free tier, verified sending subdomain such as `mail.seusistema.com`, credentials in secrets / `config.toml`). Templates are neutral TRIA in this phase; tenant-branded e-mails are Phase 2. Rationale: Supabase's built-in SMTP only delivers to project team members and is rate-limited, so recovery would not work for real members.
- **D-14:** Tenants and the platform admin are created by an **idempotent TypeScript seed script** (`pnpm db:seed`): tenant `tria-demo` (pilot stand-in) and tenant `tria-lab` (isolation counterpart), one `admin_tenant` and one `member` in each, plus the `super_admin` from `SUPER_ADMIN_EMAIL` (ferramentas@triacompany.com.br) with an initial password from env. Runs automatically for local and staging; for production it is run once through a manual `workflow_dispatch`. Passwords and e-mails never live in migrations or git.
- **D-15:** Regions and naming (accepted defaults): GCP `southamerica-east1`, Supabase `sa-east-1`; projects named `rede-social-staging` and `rede-social-prod`; staging web URL is the Vercel Preview URL. Secrets in GCP Secret Manager (API/worker) and Vercel env (web, publishable keys only); WIF, no JSON keys.

#### Module registry and kernel
- **D-16:** **Toggleable modules** (rows in `tenant_modules`): `feed`, `communities`, `stories`, `events`, `chat`, `notifications`. **Kernel, always on, no flag**: tenancy, auth, profiles, media, moderation, platform. The registry ships all six toggleable keys in Phase 1 (before the modules exist) so `/me/bootstrap` and `requireModule` are testable now. — **Reversibility:** costly — making a kernel capability toggleable later means a new flag row, a guard on every route and a navigation change.
- **D-17:** A newly created tenant gets **all six toggleable modules enabled by default** (super_admin disables what is not wanted). Seed: `tria-demo` all six on; `tria-lab` only `feed` + `events`, so the isolation suite exercises the disabled-module 404 from Phase 1.
- **D-18:** npm scope **`@tria/*`** with layout `apps/{web,api}` and `packages/{core,contracts,ui,config,modules/*}` (e.g. `@tria/core`, `@tria/contracts`, `@tria/ui`, `@tria/module-feed`). The worker runs from the **same `apps/api` image with `ROLE=worker`**; there is no `apps/worker`. — **Reversibility:** costly — renaming the scope or moving packages touches every import and every CI path filter.
- **D-19:** The "module template" is a **real, throwaway `@tria/module-example`**: one table with `tenant_id` + RLS, a GET/POST route behind `requireModule('example')`, one domain event, one pg-boss job and a minimal UI component mounted on `/inicio`. It proves the package layout, boundary lint, isolation suite and disabled-module 404 end to end. It is removed in Phase 4 when feed replaces it. (`example` is a seventh registry key that exists only until Phase 4; it must not be enabled for real tenants.)

### Claude's Discretion
- Exact shape of `/me/bootstrap` (follow ARCHITECTURE.md Pattern 3: user, membership, tenant + branding, enabled modules in nav order, permissions, counters; counters may be zeros in Phase 1).
- Domain event bus shape (typed in-process emitter, after-commit dispatch) and pg-boss wiring.
- API error envelope format (must carry a stable machine code such as `MEMBERSHIP_BLOCKED`, `MODULE_DISABLED`, `EMAIL_ALREADY_REGISTERED`).
- Per-tenant flag cache in the API (short TTL, tenant-prefixed key) and how the boundary lint is implemented (Biome / dependency-cruiser / tsconfig project references).
- How the Supavisor `set_config` + `SET LOCAL ROLE` spike is run and what the fallback switch looks like if it fails.
- Minimal observability in this phase (pino JSON with `tenant_id`, `user_id`, `request_id`; Sentry optional).
- Playwright smoke coverage for the auth flows on a mobile viewport.

### Deferred Ideas (OUT OF SCOPE)
- Per-tenant toggle for mandatory e-mail confirmation at sign-up — Phase 8 admin panel or V2.
- Phone number field on the profile (WhatsApp contact for admins) — Phase 3 profiles, if the pilot asks.
- 6-digit OTP recovery instead of e-mail link (better inside an installed iOS PWA) — revisit in Phase 7 with the iOS install flow.
- Module generator script (`pnpm gen:module <name>`) — Phase 4 when the second real module is created, if the example module proves insufficient as a template.
- Login rate limiting / brute-force protection beyond Supabase defaults — Phase 8 hardening.
- Tenant-branded auth e-mails (Send Email Hook vs templates) — already scheduled in Phase 2.
- "Sair de todos os aparelhos" option in settings — Phase 8 admin/settings.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description (REQUIREMENTS.md) | Research Support |
|----|-------------------------------|------------------|
| TENANT-01 | Single deployment at one URL; tenant resolved from the user's account after login, not the hostname | Pattern 2 (auth middleware resolves membership per request via `app.membership_for_user()`), Pattern 5 (`proxy.ts` never inspects hostname; `tenant_slug` cookie is display-only) |
| TENANT-03 | Every tenant-owned row has `tenant_id`; API runs tenant requests under an RLS-subject role (no service-role key for user traffic) | Pattern 1 (`withTenantTx`: `set_config(..., true)` + `SET LOCAL ROLE authenticated` on the Supavisor transaction pooler), `api_user` role design, Wave-0 spike, pgTAP "every `tenant_id` table has RLS" test |
| TENANT-05 | Automated two-tenant isolation suite | Validation Architecture: pgTAP suite in `supabase/tests/`, Vitest API integration suite seeded with `tria-demo`/`tria-lab` |
| MOD-01 | Monorepo; each feature is a self-contained package (schema, API, UI) | Recommended Project Structure (D-18), `@tria/module-example` layout, drizzle-kit multi-glob schema, migration folder convention |
| MOD-02 | Kernel package; modules depend only on kernel + published contracts, enforced by lint/dependency rules | Pattern 7 (three-layer boundary enforcement: package `exports` + `turbo boundaries` tags + Biome `noRestrictedImports` patterns) |
| ROLE-01 | Four roles; roles stored per tenant membership | Schema sketch (`memberships.role` check constraint, `platform_admins` table) |
| ROLE-02 | Identity != membership; one membership per user in V1 via a droppable constraint | Schema sketch (`memberships_one_tenant_per_user_v1` unique index), `auth.users` mirror trigger |
| ROLE-06 | Authorization enforced in the API per route by role and enabled modules; disabled module routes return 404 | Pattern 3 (`MODULE_REGISTRY`, `requireModule`, `requireRole`, flag cache) |
| AUTH-01 | Public sign-up link per tenant; user becomes `member`; link survives register/login round-trip | Pattern 4 (sign-up sequence: server action -> API admin lane -> `signInWithPassword`), `tenant_slug` cookie set in `proxy.ts` |
| AUTH-02 | E-mail + password sign-up/login via the Next.js server; stays logged in across restarts | Pattern 5 (`@supabase/ssr` server client + `proxy.ts` `updateSession` with `getClaims()`), `config.toml` `jwt_expiry`/refresh rotation |
| AUTH-03 | Password recovery via e-mail link | Pattern 6 (`resetPasswordForEmail` -> `/auth/confirm` `verifyOtp` -> `/redefinir-senha` `updateUser`), Resend custom SMTP settings |
| AUTH-04 | Accept tenant rules + TRIA terms at sign-up, recorded with timestamp | `consent_records` schema, terms markdown versioning, API inserts consents in the same transaction as the membership |
| AUTH-05 | Log out from any page | `signOut({ scope: 'local' })` in a server action; verified semantics |
| AUTH-06 | API verifies Supabase JWT via JWKS and resolves tenant/role/status per request from the DB | Pattern 2 (jose `createRemoteJWKSet`, ES256 key migration steps, no per-request cache of membership status) |
| PWA-04 | GitHub is source of truth; pushes deploy web to Vercel and API/worker to Cloud Run with preview/staging and production | Pattern 8 (Vercel Git integration + `turbo-ignore`; `ci.yml`, `deploy-api.yml` with WIF, `deploy-cloudrun@v3`, `supabase db push`); GitHub Environment plan caveat |
</phase_requirements>

## Summary

Phase 1 is the most expensive-to-change slice of the product: the tenant lane, the identity/membership split, the module registry and the CI/CD topology are all one-way doors. The good news is that every piece is now documented by its vendor in the exact shape this project needs. Supabase's own docs describe Supavisor transaction mode as "anything that depends on session state doesn't survive between transactions" and tell you to run `set`/`reset` "inside the transaction that needs them" — which is precisely the `set_config(..., true)` + `SET LOCAL ROLE authenticated` lane from ARCHITECTURE.md Pattern 1. Drizzle documents the same transaction pattern and ships `authenticatedRole`/`serviceRole`/`authUid` helpers; pg-boss 12 ships a `fromDrizzle(tx, sql)` adapter so a job can be enqueued atomically inside that same transaction; `@supabase/ssr`'s official Next.js example already uses `proxy.ts` + `getClaims()`; and `jose`'s `createRemoteJWKSet` is the pattern Supabase itself documents for backend verification.

Three things the planner must not assume from the stack table: (1) drizzle-orm **0.45.2** exposes `pgTable(...).enableRLS()`, not `.withRLS()` (that name belongs to the newer docs line) — adding a `pgPolicy` enables RLS automatically anyway; (2) the `tria-company` GitHub account is a **User**, not an Organisation, and GitHub only allows protected Environments (required reviewers, D-12) on private repos for **Team orgs or Pro users** — the approval gate needs a plan decision or a fallback; (3) the Supabase **Free plan caps active projects at 2 and pauses projects after 1 week of inactivity**, so `rede-social-staging` + `rede-social-prod` consume the whole quota and staging needs a keep-alive.

**Primary recommendation:** Bootstrap in this order — monorepo + toolchain smoke (TS 7 / Biome / Vitest 5 / `turbo boundaries`) → core schema + `api_user` role + RLS helpers → **Wave-0 Supavisor spike** (Vitest against local PgBouncer transaction mode and the staging pooler) → auth middleware + tenant lane + `requireModule` + `/me/bootstrap` → `@supabase/ssr` auth screens → example module → isolation suite → CI/CD. Keep the session-mode pooler (port 5432) as the documented fallback switch, not a rewrite to PostgREST.

## Project Constraints (from CLAUDE.md)

Directives extracted from `.claude/CLAUDE.md` that bind this phase (treated as locked decisions):

| # | Directive | Effect on Phase 1 plans |
|---|-----------|------------------------|
| C1 | Next.js on Vercel (mobile-first PWA); backend Hono/Node on Cloud Run; all business logic through the API. Exactly two frontend→Supabase exceptions: `@supabase/ssr` auth in the Next server, and read-only Realtime Broadcast | Sign-up **provisioning** goes through the API; login/refresh/recovery/logout via `@supabase/ssr`; no `supabase-js` data calls in the browser |
| C2 | Modularity: kernel + self-contained module packages, boundary rules (MOD-01..05) | `@tria/core`, `@tria/contracts`, `@tria/module-example`; boundary enforcement is a build-failing check |
| C3 | Supabase Free plan for the pilot | Two projects max, 200 Realtime connections, projects pause after inactivity |
| C4 | GitHub source of truth, automated deploys to Vercel + GCP; WIF, no JSON keys | `ci.yml`, `deploy-api.yml`; Vercel Git integration |
| C5 | Multi-tenant from day one, RLS defense in depth; schema V2-safe | `memberships`, `platform_admins`, `tenant_modules`, chat/notification stubs, conventions doc |
| C6 | Pinned stack: Node 24, TS 7.0.2, Next 16.3.x, Hono 4.13.7, `@hono/node-server` 2.1.1, `@hono/zod-openapi` 1.6.3, Zod 4.6.2, Drizzle 0.45.2 / drizzle-kit 0.31.10, postgres 3.4.9 (`prepare: false`), jose 6.2.12, pg-boss 12.31.0, pnpm 12.4.1, Turborepo 2.10.12, Biome 2.5.13, Vitest 5.0.0, Playwright 1.63.0, pgTAP via Supabase CLI 2.117.0, pino 10.3.1 | Standard Stack below uses exactly these; versions re-verified on npm today |
| C7 | "What NOT to Use": `middleware.ts`, HS256 legacy secret, service-role/`postgres` role for tenant queries, `supabase-js` in the browser for data, `localStorage` tokens, running both `drizzle-kit migrate` and `supabase db push`, `prepare: true` on the transaction pooler, typescript-eslint with TS 7, Redis in V1, hostname tenant resolution | Verified against plans in Anti-Patterns; pgTAP test asserts the tenant lane is not `service_role`/`postgres` |
| C8 | Migrations: `drizzle-kit generate` → `supabase/migrations` (`prefix: 'supabase'`) → Supabase CLI applies; hand-written SQL via `--custom` | `api_user` grants, `app.*` helpers, `auth.users` trigger, pg-boss schema go in custom migrations |
| C9 | Runtime DB role `api_user` (`LOGIN`, `NOBYPASSRLS`, `GRANT authenticated, service_role TO api_user`) | Role creation + grants pattern below; password set out of band |
| C10 | pt-BR UI; planning docs in English | All copy strings in D-01..D-10 are pt-BR |
| C11 | GSD workflow: edits only through GSD commands | n/a for research |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Sign-up (create identity + membership + consents) | API / Backend (admin lane) | Frontend Server (server action calls API, then signs in) | Only the API may bind a user to a tenant atomically; identity lives in Supabase Auth |
| Login / token refresh / logout / recovery | Frontend Server (SSR, `@supabase/ssr` in `proxy.ts` + server actions) | Supabase Auth | Confirmed exception (C1); HttpOnly cookies must be written by the Next server |
| JWT verification + tenant/role/status resolution | API / Backend | Database (`app.membership_for_user()`) | Per-request DB read is what makes blocking immediate (AUTH-06) |
| Tenant data isolation | Database (RLS policies) | API (tenant lane sets claims + role) | Defense in depth: API scopes queries, DB enforces |
| Module enable/disable gating | API (`requireModule`) | Database (`tenant_modules`) + Frontend Server (`/me/bootstrap` drives nav) | 404 for disabled routes is an API contract (ROLE-06) |
| `/me/bootstrap` | API | Frontend Server (RSC fetch with Bearer) | Single source for tenant/role/modules |
| `tenant_slug` cookie memory | Frontend Server (`proxy.ts` sets cookie on `/cadastro/:slug`) | — | Display-only convenience; never authorization |
| Background jobs (example job) | API image with `ROLE=worker` on Cloud Run | Database (pg-boss `pgboss` schema) | Same image, separate service, transactional enqueue |
| Migrations | CI (GitHub Actions, Supabase CLI) | — | Only CI applies migrations (D-12) |
| Seed tenants/admins | CI / local script (admin lane) | — | Idempotent TS script (D-14) |
| Deploy web / API+worker | CDN/Static (Vercel Git integration) / CI (WIF → Cloud Run) | — | PWA-04 |

## Standard Stack

### Core

| Library | Version (npm, 2026-09-11) | Purpose | Why Standard |
|---------|---------------------------|---------|--------------|
| `next` | 16.3.5 (published today; 16.3.4 in CLAUDE.md is the previous patch) | Web app, BFF, `proxy.ts` | Locked. `proxy.ts` is the Next 16 convention; `middleware` is deprecated and renamed `[CITED: nextjs.org/docs/app/api-reference/file-conventions/proxy]` |
| `react` / `react-dom` | 19.3.0 | UI | Ships with Next 16.3 |
| `typescript` | 7.0.2 | Typecheck (`tsc -b`) | Locked; see TS 7 tooling note in Pitfalls |
| `hono` + `@hono/node-server` | 4.13.7 / 2.1.1 | API on Cloud Run | Locked. `AppType` RPC export pattern verified `[CITED: hono.dev/docs/guides/rpc]` |
| `@hono/zod-openapi` | 1.6.3 | OpenAPI from Zod 4 schemas | Peer `zod ^4`, `hono >=4.10` (CLAUDE.md) |
| `zod` | 4.6.2 | Contracts, validation | Shared `@tria/contracts` |
| `drizzle-orm` / `drizzle-kit` | 0.45.2 / 0.31.10 | Schema, RLS policies, migrations | `pgPolicy`, `enableRLS()`, `drizzle-orm/supabase` roles verified in installed typings `[VERIFIED: drizzle-orm@0.45.2 pg-core/table.d.ts:22, supabase/rls.d.ts:1-3,151,209-210]`; `'supabase'` migration prefix present in drizzle-kit 0.31.10 bundle `[VERIFIED: drizzle-kit@0.31.10 api.js]` |
| `postgres` (postgres.js) | 3.4.9 | DB driver | `prepare?: boolean` option verified `[VERIFIED: postgres@3.4.9 types/index.d.ts:666]`; use `{ prepare: false }` on port 6543 |
| `jose` | 6.2.12 | JWKS verification | Pattern shown in Supabase docs `[CITED: supabase.com/docs/guides/auth/jwts]` |
| `@supabase/ssr` + `@supabase/supabase-js` | 0.12.7 / 2.116.0 | Cookie session in Next (web); admin API + `createUser` (API) | `@supabase/ssr` peer `@supabase/supabase-js ^2.114.0` `[VERIFIED: npm view]` |
| `pg-boss` | 12.31.0 | Job queue | `fromDrizzle` adapter exported `[VERIFIED: pg-boss@12.31.0 dist/index.d.ts:114]`; engines `node >=22.12.0` |
| `pino` / `pino-http` | 10.3.1 / 11.0.0 | JSON logs | Cloud Logging-friendly |
| `pnpm` / `turbo` | 12.4.1 / 2.10.12 | Monorepo | `corepack pnpm@12 --version` → 12.4.1 works on this machine; `turbo boundaries` available (experimental) `[CITED: turborepo.dev/docs/reference/boundaries]` |
| `@biomejs/biome` | 2.5.13 | Lint/format + `noRestrictedImports` patterns (since 2.2.0) `[CITED: biomejs.dev/linter/rules/no-restricted-imports]` | TS-7 safe |
| `vitest` / `@vitest/coverage-v8` | 5.0.0 | Unit + integration tests | engines `^22.12.0 \|\| ^24.0.0 \|\| >=26` `[VERIFIED: npm view]` |
| `@playwright/test` | 1.63.0 | Auth smoke on mobile viewport | — |
| `supabase` (CLI) | 2.117.0 (local machine has 2.90.0 — upgrade) | Local stack, `db push`, `test db`, `config push` | `supabase config push`, `db push --include-roles`, `test db` verified in installed CLI help `[VERIFIED: supabase --help output this session]` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@t3-oss/env-nextjs` / `@t3-oss/env-core` | 0.13.11 | Fail-fast env validation | Both apps, from day 1 |
| `tsx` | 4.23.13 | Run seed/spike scripts and drizzle-kit config | `pnpm db:seed`, spike |
| `tsup` | 8.5.1 | Bundle `apps/api` to `dist/` | With `dts: false` (see TS 7 note) |
| `@tanstack/react-query` | 5.102.8 | Client cache | Only if `/inicio` needs client fetching; optional in Phase 1 |
| `react-hook-form` + `@hookform/resolvers` | 7.87.0 / 5.9.1 | Auth forms with the shared Zod schemas | Plain forms in Phase 1 |
| `next-intl` | 4.14.4 | pt-BR catalog | Set up the catalog now so auth copy is centralised (PWA-03 lands in Phase 2) |
| `@testing-library/react`, `happy-dom` | 16.3.3 / 20.14.3 | Component tests | Minimal in Phase 1 |
| `msw` | 2.15.0 | API mocks in web tests | **Defer** to Phase 2; not needed for plain forms (legitimacy note below) |
| `@sentry/nextjs`, `@sentry/node` | 10.74.0 | Errors | Optional (discretion) |
| `dependency-cruiser` | 18.2.0 | Boundary rules | Only if `turbo boundaries` (experimental) proves inadequate |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `turbo boundaries` tags for MOD-02 | `dependency-cruiser` | Mature and expressive, but a second tool and config; keep as fallback since Boundaries is experimental |
| Transaction pooler (6543) tenant lane | Session pooler (5432) with the same `SET LOCAL` code | Fallback #1 if the spike fails: identical code, connection count bounded by `max` per Cloud Run instance |
| Direct Drizzle tenant lane | Per-request `supabase-js` with the user JWT (PostgREST) | Fallback #2 only; loses Drizzle typing and transactions, exposes Data API |
| Custom `app.tenant_id()` helper in policies | `auth.jwt() ->> 'tenant_id'` | `auth.jwt()` reads the same setting, but a project-owned helper is explicit and testable `[ASSUMED]` |
| GitHub Environment approval (D-12) | `workflow_dispatch` prod job / GitHub Pro-Team upgrade | Needed only if the account plan blocks protected environments (Open Question 1) |

**Installation (root):**
```bash
corepack enable && corepack use pnpm@12.4.1
pnpm add -Dw turbo@2.10.12 @biomejs/biome@2.5.13 typescript@7.0.2 vitest@5.0.0 @vitest/coverage-v8@5.0.0 tsx@4.23.13 supabase@2.117.0 @playwright/test@1.63.0
# apps/web
pnpm --filter @tria/web add next@16.3.5 react@19.3.0 react-dom@19.3.0 @supabase/ssr@0.12.7 @supabase/supabase-js@2.116.0 @t3-oss/env-nextjs@0.13.11 next-intl@4.14.4 react-hook-form@7.87.0 @hookform/resolvers@5.9.1 zod@4.6.2
# apps/api
pnpm --filter @tria/api add hono@4.13.7 @hono/node-server@2.1.1 @hono/zod-openapi@1.6.3 zod@4.6.2 jose@6.2.12 drizzle-orm@0.45.2 postgres@3.4.9 pg-boss@12.31.0 @supabase/supabase-js@2.116.0 pino@10.3.1 pino-http@11.0.0 @t3-oss/env-core@0.13.11
pnpm --filter @tria/api add -D drizzle-kit@0.31.10 tsup@8.5.1
```

**Version verification:** all versions above come from `npm view <pkg> version` run on 2026-09-11 (see Package Legitimacy Audit). `next` moved from 16.3.4 (CLAUDE.md) to 16.3.5 today; everything else matches the pinned table.

## Package Legitimacy Audit

Seam run: `gsd-tools query package-legitimacy check --ecosystem npm ...` on 2026-09-11. Every `SUS` below is the seam's "published within the last ~2 weeks" heuristic firing on packages with 1M–200M weekly downloads and long-lived GitHub repos; they are approved. `msw` was rated `SLOP` solely for having a `postinstall`; the script was extracted from the tarball and only runs `cli/index.js init` when the *parent* `package.json` declares `msw.workerDirectory` — benign, but the package is not needed in Phase 1.

| Package | Registry | Published | Downloads/wk | Source Repo | Verdict | Disposition |
|---------|----------|-----------|--------------|-------------|---------|-------------|
| next 16.3.5 | npm | 2026-09-11 | 42.8M | vercel/next.js | SUS (too-new) | Approved |
| hono 4.13.7 | npm | 2026-09-04 | 48.3M | honojs/hono | SUS (too-new) | Approved |
| @hono/node-server 2.1.1 | npm | 2026-08-14 | 44.8M | honojs/node-server | SUS (too-new) | Approved |
| @hono/zod-openapi 1.6.3 | npm | 2026-09-04 | 1.5M | honojs/middleware | SUS (too-new) | Approved |
| zod 4.6.2 | npm | 2026-09-10 | 206.9M | colinhacks/zod | SUS (too-new) | Approved |
| drizzle-orm 0.45.2 / drizzle-kit 0.31.10 | npm | 2026-03 | 16.3M / 13.5M | drizzle-team/drizzle-orm | OK | Approved |
| postgres 3.4.9 | npm | 2026-04-05 | 12.5M | porsager/postgres | OK | Approved |
| jose 6.2.12 | npm | 2026-09-05 | 97.2M | panva/jose | SUS (too-new) | Approved |
| @supabase/ssr 0.12.7 / @supabase/supabase-js 2.116.0 | npm | 2026-09-08 / 09-07 | 6.1M / 20.2M | supabase/ssr, supabase/supabase-js | SUS (too-new) | Approved |
| pg-boss 12.31.0 | npm | 2026-09-10 | 1.25M | timgit/pg-boss | SUS (too-new) | Approved |
| pino 10.3.1 / pino-http 11.0.0 | npm | 2026-02 / 2025-10 | 36.1M / 4.5M | pinojs/* | OK | Approved |
| @t3-oss/env-nextjs, env-core 0.13.11 | npm | 2026-03-22 | 2.0M / 2.9M | t3-oss/t3-env | OK | Approved |
| @biomejs/biome 2.5.13 | npm | 2026-09-10 | 10.9M | biomejs/biome | SUS (too-new) | Approved |
| vitest 5.0.0 | npm | 2026-09-03 | 76.7M | vitest-dev/vitest | SUS (too-new) | Approved |
| @playwright/test 1.63.0 | npm | 2026-09-04 | 45.3M | microsoft/playwright | SUS (too-new) | Approved |
| turbo 2.10.12 | npm | 2026-08-25 | 17.8M | vercel/turborepo | SUS (too-new) | Approved |
| tsup 8.5.1 / tsx 4.23.13 | npm | 2025-11 / 2026-08-30 | 6.3M / 64.2M | egoist/tsup, privatenumber/tsx | OK / SUS | Approved |
| dependency-cruiser 18.2.0 | npm | 2026-08-10 | 2.9M | sverweij/dependency-cruiser | OK | Approved (fallback only) |
| @tanstack/react-query 5.102.8, react-hook-form 7.87.0, @hookform/resolvers 5.9.1, next-intl 4.14.4, @testing-library/react 16.3.3 | npm | Aug–Sep 2026 | 4M–45M | official repos | SUS (too-new) | Approved |
| supabase 2.117.0 (CLI) / typescript 7.0.2 | npm | 2026-09-07 / 07-08 | 3.2M / 202.9M | supabase/cli, microsoft/TypeScript | SUS / OK | Approved |
| msw 2.15.0 | npm | 2026-07-08 | 15.2M | mswjs/msw | SLOP (postinstall) | **Deferred to Phase 2**; postinstall inspected and benign — planner adds `checkpoint:human-verify` before first install |

**Packages removed due to [SLOP] verdict:** none (msw deferred, not removed).
**Packages flagged as suspicious [SUS]:** all "too-new" flags are false positives on top-tier packages; no checkpoint required. `msw` requires a checkpoint when it is eventually installed.

No package in this list has a postinstall script other than `msw` (`npm view <pkg> scripts.postinstall` returned null for the rest — checked via the seam's `postinstall` signal).

## Architecture Patterns

### System Architecture Diagram

```
 Browser (mobile PWA / desktop)
   │ HTTPS, HttpOnly cookies (sb-<ref>-auth-token)
   ▼
 ┌──────────────────────── NEXT.JS 16 on VERCEL (apps/web) ────────────────────────┐
 │ proxy.ts ──► updateSession(): @supabase/ssr createServerClient(request cookies)  │
 │              getClaims() (JWKS verify) → refresh cookies → gate private routes    │
 │              sets tenant_slug cookie on /cadastro/:slug                           │
 │ (auth)/entrar, cadastro/[slug], esqueci-senha, redefinir-senha, auth/confirm     │
 │    server actions: signInWithPassword / resetPasswordForEmail / verifyOtp /       │
 │    updateUser / signOut({scope:'local'})  ── Supabase Auth (GoTrue) ◄────────────┼──┐
 │    signup action ──► POST api/v1/public/signup/{slug} (API creates identity)     │  │
 │ (app)/inicio: RSC → fetch API /v1/me/bootstrap with Authorization: Bearer <jwt>  │  │
 └───────────────┬──────────────────────────────────────────────────────────────────┘  │
                 │ HTTPS Bearer JWT                                                     │
                 ▼                                                                       │
 ┌──────────────────── HONO API on CLOUD RUN (apps/api, ROLE=api) ────────────────────┐ │
 │ requestId + pino ─► requireAuth: jose.jwtVerify(JWKS ES256)                        │ │
 │                     └► app.membership_for_user(sub) [security definer, no cache]   │ │
 │                        status='blocked' → 403 MEMBERSHIP_BLOCKED                   │ │
 │ requireModule(key): tenant_modules cache (30 s) → 404 MODULE_DISABLED              │ │
 │ requireRole(...)                                                                    │ │
 │ withTenantTx(ctx): BEGIN; set_config('request.jwt.claims', …, true);               │ │
 │                    SET LOCAL ROLE authenticated; …queries…; COMMIT                 │ │
 │ withAdminTx():     BEGIN; SET LOCAL ROLE service_role (signup, seed, super_admin)  │ │
 │ domain events (in-process, after-commit) ─► boss.send(…, { db: fromDrizzle(tx) })  │ │
 └───────────────┬──────────────────────────────────────────┬─────────────────────────┘ │
                 │ postgres.js, api_user.<ref>, port 6543,   │ supabase-js admin         │
                 │ prepare:false                             │ (service key, API only)   │
                 ▼                                           ▼                           │
 ┌──────────────────────────── SUPABASE (sa-east-1) ───────────────────────────────────┐ │
 │ Supavisor (transaction pooler) ─► Postgres: public.tenants, users, memberships,     │ │
 │   platform_admins, tenant_modules, consent_records, example_items, chat/notif stubs │ │
 │   RLS: tenant_id = app.tenant_id()  TO authenticated                               │ │
 │   auth.users ──trigger──► public.users mirror                                       │ │
 │ Auth (GoTrue, ES256 keys, custom SMTP=Resend) ◄─────────────────────────────────────┼─┘
 │ pgboss schema (jobs) ◄── worker service (same image, ROLE=worker, session pooler)   │
 └─────────────────────────────────────────────────────────────────────────────────────┘

 GitHub (main + PRs) ─► Vercel Git integration (Preview per PR, Production on main)
                     ─► ci.yml: turbo lint typecheck test boundaries; supabase start; supabase test db; api integration
                     ─► deploy-api.yml: WIF auth → build → Artifact Registry → (PR) api-staging/worker-staging
                        (main) [environment: production, 1 approval] supabase db push → api → worker
```

### Recommended Project Structure

Follows D-18 (`@tria/*`, no `apps/worker`) and ARCHITECTURE.md §Recommended Project Structure.

```
rede_social/
├── apps/
│   ├── web/                              # @tria/web — Next.js 16 (Vercel)
│   │   ├── app/(auth)/entrar/page.tsx    # + cadastro/[slug], esqueci-senha, redefinir-senha, acesso-suspenso
│   │   ├── app/(auth)/actions.ts         # server actions: login, signup(→API), forgot, reset, logout
│   │   ├── app/auth/confirm/route.ts     # verifyOtp(token_hash, type) → redirect next
│   │   ├── app/(app)/inicio/page.tsx     # renders /me/bootstrap + example module widget + Sair
│   │   ├── app/api/proxy/[...path]/route.ts  # optional BFF: cookie session → Bearer to Cloud Run (client fetches)
│   │   ├── lib/supabase/{server,client,proxy}.ts  # verbatim from Supabase example, env via @t3-oss/env-nextjs
│   │   ├── lib/api.ts                    # hc<AppType>(API_URL, { headers: { Authorization } })
│   │   ├── proxy.ts                      # updateSession + tenant_slug cookie + public-route allow-list
│   │   └── messages/pt-BR.json           # next-intl catalog (auth copy from D-01..D-10)
│   └── api/                              # @tria/api — Hono on Cloud Run; ROLE=api|worker
│       ├── src/main.ts                   # ROLE switch: serve() or boss.work()
│       ├── src/app.ts                    # composes core routes + enabled module routes; export type AppType
│       ├── src/http/{error,logger,request-id}.ts
│       ├── drizzle.config.ts             # schema globs from packages/core + packages/modules/*; out: ../../supabase/migrations
│       ├── Dockerfile                    # turbo prune @tria/api --docker; node:24-slim
│       └── tsup.config.ts                # dts: false
├── packages/
│   ├── core/                             # @tria/core — kernel (NOT a module)
│   │   ├── db/schema/{tenants,users,memberships,platform-admins,tenant-modules,consent-records,chat-stubs,notification-stubs}.ts
│   │   ├── db/{client.ts,tenant-tx.ts,admin-tx.ts,rls.ts}   # withTenantTx / withAdminTx / app.tenant_id() sql helper
│   │   ├── server/auth/{jwks.ts,require-auth.ts,context.ts}
│   │   ├── server/tenancy/membership.ts  # membership_for_user() call, blocked handling
│   │   ├── server/modules/{registry.ts,require-module.ts,flags-cache.ts}
│   │   ├── server/rbac/require-role.ts
│   │   ├── server/events/bus.ts          # typed emitter, after-commit dispatch
│   │   ├── server/jobs/boss.ts           # pg-boss instance, fromDrizzle helper, queue registry
│   │   ├── server/http/api-error.ts      # ApiError + envelope
│   │   └── docs/SCHEMA-CONVENTIONS.md    # Foundation deliverable (PITFALLS §9)
│   ├── contracts/                        # @tria/contracts — Zod schemas, ModuleKey, error codes, AppType re-export
│   ├── ui/                               # @tria/ui — empty shell in Phase 1 (Phase 2 ports prototype)
│   ├── config/                           # @tria/config — tsconfig bases, biome.json base, vitest base
│   └── modules/
│       └── example/                      # @tria/module-example (throwaway, D-19)
│           ├── package.json              # exports: ./contracts ./server ./ui ./db (no deep imports); turbo.json tags: ["module"]
│           ├── module.ts                 # ModuleManifest { key: 'example', nav, jobs, events }
│           ├── db/schema.ts              # example_items (tenant_id + RLS policy)
│           ├── server/{routes.ts,service.ts,jobs.ts}
│           ├── contracts/index.ts
│           └── ui/ExampleWidget.tsx
├── supabase/
│   ├── config.toml                       # local stack; [auth] settings; [auth.email.smtp] with env(); [db.pooler] enabled for the spike
│   ├── migrations/                       # GENERATED by drizzle-kit (prefix 'supabase') + --custom SQL
│   ├── roles.sql                         # api_user (no password) — applied with `db push --include-roles`
│   ├── seed.sql                          # empty on purpose; seeding is `pnpm db:seed` (TS)
│   ├── templates/recovery.html           # {{ .TokenHash }} link to /auth/confirm
│   └── tests/                            # pgTAP: 000-helpers.sql, 010-rls-coverage.sql, 020-tenant-isolation.sql, 030-lanes.sql
├── scripts/{seed.ts,spike-supavisor.test.ts}
├── .github/workflows/{ci.yml,deploy-api.yml,seed-prod.yml}
├── turbo.json                            # tasks + boundaries.tags
├── biome.json
├── pnpm-workspace.yaml
└── legal/{termos-de-uso.md,politica-de-privacidade.md}  # versioned (front-matter `version:`)
```

### Pattern 1: Tenant lane — `set_config(..., true)` + `SET LOCAL ROLE authenticated` on the transaction pooler

**What:** Every tenant-scoped request runs inside one Drizzle transaction that (1) injects the claims RLS reads and (2) switches to the `authenticated` role for the transaction only. The connection is the dedicated `api_user` role through Supavisor transaction mode.

**Why it is safe on Supavisor (docs, not folklore):** "Transaction mode returns your connection to the pool after each transaction, so anything that depends on session state doesn't survive between transactions … This covers `set` and `reset` … Run them inside the transaction that needs them." `[CITED: supabase.com/docs/guides/database/connecting-to-postgres]`. `SET LOCAL` and `set_config(name, value, is_local => true)` are by definition transaction-scoped, so they end exactly when Supavisor hands the connection back. postgres.js pins a single connection for the duration of `sql.begin()` (which Drizzle's `db.transaction` uses) `[ASSUMED: postgres.js transaction semantics]`.

**Custom role through the pooler:** username is `[ROLE].[PROJECT-REF]` `[CITED: connecting-to-postgres]`; Supavisor authenticates any LOGIN role dynamically (`pgbouncer.get_auth`), no extra grants (discussion #30107) `[CITED: github.com/orgs/supabase/discussions/30107]`. Each distinct user+database+mode gets its own pool `[CITED: supabase.com/docs/guides/troubleshooting/supavisor-faq-YyP5tI]`.

```ts
// packages/core/db/client.ts
// Source: orm.drizzle.team/docs/connect-supabase (prepare:false), postgres@3.4.9 typings
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export const sqlClient = postgres(env.DATABASE_URL, { prepare: false, max: 5 }); // api_user.<ref>@...pooler...:6543
export const db = drizzle(sqlClient);
```

```ts
// packages/core/db/tenant-tx.ts
// Source pattern: orm.drizzle.team/docs/rls (set_config + set local role inside db.transaction)
import { sql } from 'drizzle-orm';
import type { RequestContext } from '../server/auth/context';

export async function withTenantTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const claims = JSON.stringify({
      sub: ctx.userId,
      role: 'authenticated',
      tenant_id: ctx.tenantId,
      tenant_role: ctx.role, // admin_tenant | support_tenant | member
    });
    // bound parameter + is_local=true: dies with the transaction, pool-safe
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}

export async function withAdminTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  // ONLY importable from packages/core/server/{tenancy,platform,seed} — boundary-linted
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role service_role`); // bypassrls only for this transaction
    return fn(tx);
  });
}
```

```sql
-- supabase/migrations/<ts>_app_helpers.sql  (drizzle-kit generate --custom --name=app_helpers)
create schema if not exists app;
create or replace function app.tenant_id() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id', '')::uuid
$$;
create or replace function app.tenant_role() returns text language sql stable as $$
  select current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_role'
$$;
grant usage on schema app to authenticated, service_role, api_user;
grant execute on all functions in schema app to authenticated, service_role, api_user;
```

**Role bootstrap (`supabase/roles.sql`, applied with `supabase db push --include-roles` `[VERIFIED: supabase db push --help]`):**

```sql
-- No password here. CI runs: psql "$SUPABASE_DB_URL" -v pw="$API_DB_PASSWORD" -c "alter role api_user with login password :'pw'"
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'api_user') then
    create role api_user nologin nobypassrls noinherit;
  end if;
end $$;
grant authenticated to api_user;   -- allows SET LOCAL ROLE authenticated
grant service_role to api_user;    -- allows SET LOCAL ROLE service_role (admin lane)
```

`noinherit` is deliberate: `api_user` gets no table privileges on its own, so a query outside `withTenantTx`/`withAdminTx` fails with `42501` instead of silently running unscoped `[ASSUMED: Postgres NOINHERIT + SET ROLE semantics; BYPASSRLS is a role attribute and is never inherited through membership]`. The pgTAP test `030-lanes.sql` must prove both facts on the real database.

**Membership lookup before the lane exists:** `requireAuth` needs `memberships` before it knows the tenant. Use a `security definer` function owned by `postgres` that `api_user` may execute — cheaper and narrower than opening the admin lane per request:

```sql
create or replace function app.membership_for_user(p_user_id uuid)
returns table (tenant_id uuid, tenant_slug text, tenant_display_name text, role text, status text, tenant_status text)
language sql stable security definer set search_path = '' as $$
  select m.tenant_id, t.slug, t.display_name, m.role, m.status, t.status
  from public.memberships m join public.tenants t on t.id = m.tenant_id
  where m.user_id = p_user_id
  order by m.joined_at limit 1   -- V1: one membership per user (unique index)
$$;
revoke all on function app.membership_for_user(uuid) from public;
grant execute on function app.membership_for_user(uuid) to api_user;
```

**Trade-offs:** two extra statements per request (sub-millisecond); policies must stay index-friendly (`tenant_id = app.tenant_id()` with `(tenant_id, created_at desc)` indexes). Never cache membership *status* (D-09 "very next request").

### Pattern 2: JWT verification + per-request membership (AUTH-06, D-09)

Supabase: "Not recommended for production applications" for the legacy shared secret; JWKS at `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`, cached 10 min at the edge plus up to 10 min in client libraries; do not cache longer in your app `[CITED: supabase.com/docs/guides/auth/signing-keys, /jwts]`. Enabling ES256 on an existing project = "Migrate JWT secret" → "Rotate keys" in the dashboard; do it on both projects **before** the first deploy so no HS256 token is ever minted for real users.

```ts
// packages/core/server/auth/require-auth.ts
// Source: supabase.com/docs/guides/auth/jwts (jose example), hono.dev/docs/api/exception
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createMiddleware } from 'hono/factory';
import { ApiError } from '../http/api-error';

const JWKS = createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`)); // module-level: jose caches keys per kid

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = c.req.header('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED');
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `${env.SUPABASE_URL}/auth/v1`,
    audience: 'authenticated',            // [ASSUMED: Supabase access tokens carry aud='authenticated']
  }).catch(() => { throw new ApiError(401, 'INVALID_TOKEN'); });

  const m = await membershipForUser(payload.sub!); // app.membership_for_user(), no cache
  if (!m) throw new ApiError(403, 'NO_MEMBERSHIP');
  if (m.status === 'blocked' || m.tenantStatus !== 'active')
    throw new ApiError(403, 'MEMBERSHIP_BLOCKED', { tenantName: m.tenantDisplayName });

  c.set('ctx', { userId: payload.sub!, tenantId: m.tenantId, role: m.role, requestId: c.get('requestId') });
  await next();
});
```

`super_admin` is resolved separately (`platform_admins` lookup) and only for `/v1/platform/*` routes behind `requireSuperAdmin()`; a super_admin with no membership must not hit `NO_MEMBERSHIP` on platform routes.

### Pattern 3: Module registry, `requireModule`, `/me/bootstrap` (ROLE-06, D-16/17/19)

```ts
// packages/contracts/modules.ts
export const TOGGLEABLE_MODULES = ['feed', 'communities', 'stories', 'events', 'chat', 'notifications', 'example'] as const;
export type ModuleKey = (typeof TOGGLEABLE_MODULES)[number];
export const REAL_TENANT_DEFAULT_MODULES: ModuleKey[] = ['feed', 'communities', 'stories', 'events', 'chat', 'notifications']; // D-17; 'example' never on for real tenants

// packages/core/server/modules/registry.ts
export interface ModuleManifest {
  key: ModuleKey;
  nav?: { label: string; icon: string; href: string; order: number };
  server?: () => Promise<{ routes: Hono<AppEnv> }>;
  jobs?: JobDefinition[];
  events?: EventSubscription[];
}
export const MODULE_REGISTRY: Record<ModuleKey, ModuleManifest | null> = { example: exampleModule, feed: null, /* … */ };

// packages/core/server/modules/require-module.ts
export const requireModule = (key: ModuleKey) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const { tenantId } = c.get('ctx');
    if (!(await moduleFlags.isEnabled(tenantId, key))) throw new ApiError(404, 'MODULE_DISABLED');
    await next();
  });
// moduleFlags: Map<`${tenantId}`, { keys: Set<ModuleKey>, expiresAt }> with 30 s TTL (discretion); loaded via withTenantTx select on tenant_modules.
```

Mounting: `app.route('/v1/example', exampleRoutes.use(requireAuth, requireModule('example')))`. `/me/bootstrap` (`GET /v1/me/bootstrap`) returns ARCHITECTURE.md Pattern 3's `Bootstrap` type with `counters: { unreadNotifications: 0, unreadConversations: 0 }` in Phase 1 and `modules` filtered to enabled keys that have a manifest, sorted by `nav.order`. Add `permissions: string[]` from `defaultRolePermissions` in manifests (empty for the example module is fine).

### Pattern 4: Sign-up sequence (AUTH-01, AUTH-04, D-01..D-04)

1. `GET /cadastro/{slug}` (RSC): fetch `GET /v1/public/tenants/{slug}` (display name, `rules_text`, `rules_version`); `proxy.ts` already set `tenant_slug` cookie (1 year, `SameSite=Lax`). Unknown slug → 404 page.
2. Server action `signup(formData)` validates with the shared Zod schema (`name`, `email`, `password.min(8)`, `acceptRules`, `acceptTerms` both `literal(true)`), then calls `POST /v1/public/signup/{slug}` with `{ name, email, password, consents: { tenantRulesVersion, triaTermsVersion } }` and the client IP (`x-forwarded-for` first hop) — the API is the only party allowed to bind identity to tenant (C1).
3. API (`withAdminTx`): 
   - `supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } })` — server-only, service key `[CITED: supabase.com/docs/reference/javascript/auth-admin-createuser]`. Duplicate e-mail → map GoTrue's error to `409 EMAIL_ALREADY_REGISTERED` (pt-BR copy from D-04) and `logger.warn({ event: 'signup.duplicate_email', existingTenantId })` as the V2 signal.
   - `public.users` row is created by the `on_auth_user_created` trigger (Supabase's documented `handle_new_user` pattern `[CITED: supabase.com/docs/guides/auth/managing-user-data]`); then insert `memberships (tenant_id, user_id, role='member', status='active')` and two `consent_records` rows in one transaction. If the DB transaction fails after `createUser` succeeded, compensate with `auth.admin.deleteUser(id)` and return 500 (rare; log loudly).
4. Web server action then calls `supabase.auth.signInWithPassword({ email, password })` on the `@supabase/ssr` server client (sets cookies) and `redirect('/inicio')`. Autoconfirm is `enable_confirmations = false` (the CLI default) `[VERIFIED: generated config.toml line 216]`; on hosted projects set the same in Auth settings / `supabase config push`.

Because sign-in happens in the web tier with the same credentials, the API never returns tokens. The `tenant_slug` cookie is consulted only by `/entrar` (display name + "Criar conta" link) — never by the API.

### Pattern 5: Session in Next 16 with `@supabase/ssr` (AUTH-02, AUTH-05, D-05..D-09)

The official example already targets `proxy.ts` `[VERIFIED: gh api supabase/supabase examples/auth/nextjs/proxy.ts, lib/supabase/proxy.ts, lib/supabase/server.ts — fetched raw this session]`. Key rules from the docs: "Never trust `supabase.auth.getSession()` inside server code such as Proxy … Always use `supabase.auth.getClaims()`"; do not run code between `createServerClient` and `getClaims()`; return `supabaseResponse` untouched (or copy its cookies) `[CITED: supabase.com/docs/guides/auth/server-side/creating-a-client]`.

```ts
// apps/web/lib/supabase/server.ts — verbatim shape from the Supabase example (Next 16: await cookies())
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet) {
        try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); }
        catch { /* Server Component: proxy.ts refreshes cookies */ }
      },
    },
  });
}
```

```ts
// apps/web/proxy.ts — adapted from examples/auth/nextjs/proxy.ts + lib/supabase/proxy.ts
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC = [/^\/entrar/, /^\/cadastro\//, /^\/esqueci-senha/, /^\/redefinir-senha/, /^\/auth\//, /^\/acesso-suspenso/];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v)); // Cache-Control: private etc.
      },
    },
  });
  const { data } = await supabase.auth.getClaims();   // refreshes if needed; validates signature (ES256 → local)
  const path = request.nextUrl.pathname;

  const slug = path.match(/^\/cadastro\/([a-z0-9-]+)/)?.[1];
  if (slug) response.cookies.set('tenant_slug', slug, { maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', path: '/' }); // D-06

  if (!data?.claims && !PUBLIC.some((re) => re.test(path))) {
    const url = request.nextUrl.clone(); url.pathname = '/entrar'; return NextResponse.redirect(url);
  }
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'] };
```

- Calling the API from RSC/server actions: after `getClaims()` succeeds, read `(await supabase.auth.getSession()).data.session?.access_token` **only to forward it** as `Authorization: Bearer` — the API re-verifies it, so the "never trust getSession" warning is satisfied. Client-side fetching (if any) goes through `app/api/proxy/[...path]/route.ts` which does the same, keeping tokens out of JS.
- Logout: server action `await supabase.auth.signOut({ scope: 'local' })` — "If you only want to sign the user out of the current session … pass `{ scope: 'local' }`"; default is `global` `[CITED: supabase.com/docs/reference/javascript/auth-signout]`. Then `redirect('/entrar')`.
- Blocked member: the `(app)` layout's bootstrap fetch receives `403 { error: { code: 'MEMBERSHIP_BLOCKED', details: { tenantName } } }` → server action `signOut({ scope: 'local' })` → `redirect('/acesso-suspenso?t=<tenantName>')`. A later login succeeds at Supabase level, lands on `/inicio`, gets the same 403 and the same screen (D-09).
- Session lifetime: `jwt_expiry = 3600`, `enable_refresh_token_rotation = true`, `refresh_token_reuse_interval = 10` are CLI defaults `[VERIFIED: generated config.toml lines 158-167]`; refresh tokens do not time out by inactivity by default, so D-05 needs no config change.

### Pattern 6: Password recovery (AUTH-03, D-10)

Flow from Supabase docs `[CITED: supabase.com/docs/guides/auth/passwords]`:
1. `/esqueci-senha` server action: `await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${SITE_URL}/auth/confirm?next=/redefinir-senha` })`; always render "Se existir uma conta com este e-mail, enviamos um link" — the docs confirm the call "doesn't reveal whether an account exists".
2. Recovery e-mail template (`supabase/templates/recovery.html`, `[auth.email.template.recovery] content_path`) links to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/redefinir-senha`.
3. `app/auth/confirm/route.ts`: `const { error } = await supabase.auth.verifyOtp({ type, token_hash })`; on success redirect to `next` **only if it is a relative path starting with `/`** (open-redirect guard); on error redirect to `/esqueci-senha?erro=link-invalido`.
4. `/redefinir-senha` (now authenticated): server action `await supabase.auth.updateUser({ password })` → the session created by `verifyOtp` remains → `redirect('/inicio')`. This satisfies "sets the new password and signs the user in".
5. Password policy: `minimum_password_length = 8` in `config.toml` (default is 6 `[VERIFIED: config.toml line 175]`) and Zod `min(8)` on both forms; keep `password_requirements = ""`.

E-mail delivery: built-in provider "will refuse to deliver messages to addresses that are not part of the project's team" and is limited to 2/hour; custom SMTP starts at 30/hour, adjustable `[CITED: supabase.com/docs/guides/auth/auth-smtp]`. Resend settings: host `smtp.resend.com`, port `465`, user `resend`, password = API key, verified domain required `[CITED: resend.com/docs/send-with-supabase-smtp]`. In `config.toml`: `[auth.email.smtp] enabled = true, host = "smtp.resend.com", port = 465, user = "resend", pass = "env(RESEND_API_KEY)", admin_email = "no-reply@mail.seusistema.com", sender_name = "TRIA"`; apply to hosted projects with `supabase config push` (command exists: "Pushes local config.toml to the linked project" `[VERIFIED: supabase config push --help]`; that it applies SMTP + templates is `[ASSUMED]` — verify on staging). Redirect allow-list: add `https://*-<vercel-team-slug>.vercel.app/**` for previews and the exact production URL `[CITED: supabase.com/docs/guides/auth/redirect-urls]`.

### Pattern 7: Module boundary enforcement (MOD-02) — three layers, build-failing

1. **Package `exports` + pnpm strictness.** Each `@tria/module-*` package.json exports only `./contracts`, `./server`, `./ui`, `./db`, `./module`; no `./src/*` deep paths. A module cannot import a sibling unless it is a declared dependency (pnpm's isolated `node_modules`).
2. **`turbo boundaries` tags** (locked stack; experimental). Root `turbo.json`:
   ```json
   { "boundaries": { "tags": {
       "module": { "dependencies": { "allow": ["kernel", "contracts"] }, "dependents": { "deny": ["module"] } },
       "kernel": { "dependencies": { "deny": ["module", "app"] } },
       "app":    { "dependencies": { "allow": ["kernel", "contracts", "module"] } } } } }
   ```
   with per-package `turbo.json` `{ "tags": ["module"] }` etc. Boundaries also flags "importing a file outside of the package's directory" and undeclared dependencies, applied transitively `[CITED: turborepo.dev/docs/reference/boundaries]`. Wire `turbo boundaries` into `ci.yml` and the `lint` pipeline. Because a module may consume another module's **contracts** (MOD-02), publish those as a separate tiny package tag `contracts` (e.g. `@tria/module-feed-contracts`) when the need first arises (Phase 4); in Phase 1 the only cross-module contract surface is `@tria/contracts`.
3. **Biome `noRestrictedImports` patterns** as a second net inside `packages/modules/*` via `overrides`: `"patterns": [{ "group": ["@tria/module-*/src/**", "@tria/core/src/**", "../../../core/**"], "message": "Import published entry points only" }]` and, everywhere except `packages/core/server/{tenancy,platform,seed}`, `{ "group": ["@tria/core/db/admin-tx", "@tria/core/server/supabase-admin"], "message": "Admin lane is kernel-only" }` `[CITED: biomejs.dev/linter/rules/no-restricted-imports — patterns since v2.2.0]`.

Also enforce `apps/web` never depends on `@tria/core` server/db entry points (only `@tria/contracts` and module `ui` exports) — a `web` tag with `dependencies.deny: ["kernel-server"]` if core is split into `@tria/core` (server) and `@tria/core-ui`; simplest is to make `@tria/core` export `./ui` separately and deny `./server`/`./db` via the Biome pattern in `apps/web`.

### Pattern 8: CI/CD topology (PWA-04, D-11, D-12, D-15)

- **Web:** Vercel Git integration, Root Directory `apps/web`, Ignored Build Step `npx turbo-ignore --fallback=HEAD^1`, Preview per PR, Production on `main` (CLAUDE.md §8, sources verified there). Preview env vars: `NEXT_PUBLIC_API_URL=https://api-staging-…run.app`, `NEXT_PUBLIC_SUPABASE_URL/PUBLISHABLE_KEY` of **staging**; Production env vars point at prod. `NEXT_PUBLIC_*` is inlined at build time — never "promote" a preview build to production (PITFALLS §13).
- **API/worker:** `deploy-api.yml` with `paths: [apps/api/**, packages/**, supabase/**, pnpm-lock.yaml]`. Latest tags (checked via `gh api …/releases/latest` today): `google-github-actions/auth@v3`, `google-github-actions/deploy-cloudrun@v3`, `supabase/setup-cli@v3` (v3.0.0), `docker/build-push-action@v7`, `docker/login-action@v4`, `docker/setup-buildx-action@v4`, `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6` `[VERIFIED: GitHub releases API]`. WIF needs `permissions: { id-token: write, contents: read }`; `deploy-cloudrun` needs the SA to hold Cloud Run Admin (+ Service Account User) `[CITED: github.com/google-github-actions/deploy-cloudrun]`.
- **Migrations:** Supabase's own guide uses `supabase link --project-ref $SUPABASE_PROJECT_ID` + `supabase db push` per environment with `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID` secrets and states distinct staging/production projects `[CITED: supabase.com/docs/guides/deployment/managing-environments]`. Add `--include-roles` for `roles.sql`, then the `alter role api_user … password` psql step, then `supabase config push`.
- **Approval gate:** GitHub Environments — "Only one of the required reviewers needs to approve", "Prevent self-review" optional, environment secrets are "only available to workflow jobs that use the environment". **Plan caveat:** "Users with GitHub Free plans can only configure environments for public repositories … Creation of an environment in a private repository is available to organizations with GitHub Team and users with GitHub Pro" `[CITED: docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments]`. See Open Question 1.
- **Worker:** second `deploy-cloudrun` step, same image, `env_vars: ROLE=worker`, `flags: --min-instances=1 --no-cpu-throttling`; API: `--min-instances=1` in prod, `0` in staging (cost).
- **Seed:** `seed-prod.yml` on `workflow_dispatch` only, `environment: production`, runs `pnpm db:seed` with `SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_PASSWORD` from environment secrets (D-14). Local/staging seed runs from `ci.yml`/`deploy-api.yml` after migrations.

### Pattern 9: pg-boss wiring + domain events (discretion)

- pg-boss creates the `pgboss` schema on `start()` and needs `CREATE` on the database; alternatively run migrations via its CLI (`pg-boss migrate`, `pg-boss plans migrate --dry-run`) and manage the schema yourself `[CITED: pgboss.io/install]` `[VERIFIED: pg-boss@12.31.0 dist/cli.js usage text; `migrate?: boolean`, `schema?: string`, `max?: number` in dist/types.d.ts]`. **Do:** generate the SQL with `pnpm pg-boss plans migrate --dry-run` into a `--custom` Supabase migration (applied by CI as `postgres`), add `grant usage on schema pgboss to api_user; grant all on all tables/sequences in schema pgboss to api_user; alter default privileges …`, and construct `new PgBoss({ connectionString, schema: 'pgboss', migrate: false, max: 2 })`. Bump the migration when pg-boss's schema version changes ("you will need to monitor future releases for schema changes").
- Transactional enqueue: `boss.send('example.process', payload, { db: fromDrizzle(tx, sql) })` inside `withTenantTx`; "When the ORM transaction is rolled back … all pg-boss operations executed through the adapter are rolled back as well"; the Drizzle adapter needs drizzle's `sql` tag and supports postgres-js `[CITED: pgboss.io/api/adapters]`. Queues must be created (`boss.createQueue`) at worker/API start for each `JobDefinition` in the registry.
- Worker connection: the worker polls continuously; use the **session** pooler (port 5432, `api_user.<ref>`) with `max: 2` for the pg-boss pool `[ASSUMED: pg-boss polling is safe on transaction mode too, but session mode avoids any pooler edge case]`. Jobs that touch tenant data call `withTenantTx` with a synthetic ctx built from the job payload's `tenantId` (RLS still applies).
- Domain event bus: `packages/core/server/events/bus.ts` — typed `EventMap` in `@tria/contracts`, handlers registered by module manifests, dispatched **after commit** (collect events on `ctx.events`, flush after `withTenantTx` resolves). The example module emits `example.item.created` and a handler enqueues the job; this proves MOD-03's shape without building the notifications consumer.

### Pattern 10: Error envelope (discretion) and Hono wiring

```ts
// packages/core/server/http/api-error.ts — Source: hono.dev/docs/api/exception (HTTPException, app.onError)
import { HTTPException } from 'hono/http-exception';
export const ERROR_CODES = ['UNAUTHENTICATED','INVALID_TOKEN','NO_MEMBERSHIP','MEMBERSHIP_BLOCKED','MODULE_DISABLED','FORBIDDEN','EMAIL_ALREADY_REGISTERED','TENANT_NOT_FOUND','VALIDATION_FAILED','NOT_FOUND','INTERNAL'] as const;
export class ApiError extends HTTPException {
  constructor(status: ContentfulStatusCode, public code: (typeof ERROR_CODES)[number], public details?: Record<string, unknown>) {
    super(status, { message: code });
  }
}
// apps/api/src/app.ts
app.onError((err, c) => {
  const requestId = c.get('requestId');
  if (err instanceof ApiError) return c.json({ error: { code: err.code, message: ptBR[err.code], details: err.details, requestId } }, err.status);
  if (err instanceof HTTPException) return c.json({ error: { code: 'HTTP_ERROR', message: err.message, requestId } }, err.status);
  c.get('logger').error({ err, requestId }, 'unhandled');
  return c.json({ error: { code: 'INTERNAL', message: 'Erro interno', requestId } }, 500);
});
```

Envelope: `{ error: { code, message, details?, requestId } }` with the HTTP status; `code` is the stable contract (D-09). Put `ERROR_CODES` in `@tria/contracts` so the web app switches on it.

### Anti-Patterns to Avoid
- **Service role / `postgres` role for tenant traffic** (PITFALLS §1): the tenant lane uses `api_user` + `SET LOCAL ROLE authenticated`; pgTAP `030-lanes.sql` asserts `current_user = 'authenticated'` inside the lane and that `api_user` alone sees zero rows.
- **`set_config(..., false)` or `SET ROLE` without `LOCAL`** on the pooler: leaks one request's tenant into the next connection user. Wrap in a helper; grep-guard in CI (`rg "set_config\('request\.jwt\.claims'.*false\)|^\s*set role" packages apps` must be empty).
- **Trusting JWT custom claims for tenant/role** (ARCHITECTURE Anti-pattern 3): no Custom Access Token Hook in V1 (SUMMARY resolved point); membership read per request.
- **`users.tenant_id` / `role` on `users`** (ARCHITECTURE Anti-pattern 1).
- **Caching membership status**: breaks D-09. Cache only `tenant_modules` (30 s) and tenant public info.
- **`middleware.ts`**: deprecated and renamed `proxy` in Next 16; `runtime` config is not allowed in proxy files `[CITED: proxy file convention]`.
- **Trusting `getSession()` for authorization in server code** — use `getClaims()`; forward the access token to the API which re-verifies it.
- **Unvalidated `next` redirect in `/auth/confirm`** — open redirect; accept only `^/[^/]` paths.
- **Data API exposure**: PostgREST is reachable with the publishable key on every Supabase project; with RLS enabled and no `anon` policies nothing leaks, but additionally `revoke all on all tables in schema public from anon` in a custom migration and (dashboard) remove `public` from exposed schemas `[ASSUMED]` — the API is the only data client.
- **Two migration appliers**: only `supabase db push`; never `drizzle-kit migrate`/`push`.
- **Hostname-based tenant hints** anywhere in Phase 1 (Anti-pattern 6).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT verification, `kid` rotation, JWKS caching | Manual `crypto.verify` + fetch cache | `jose` `createRemoteJWKSet` + `jwtVerify` | Handles rotation/standby keys, alg checks, cache TTL; Supabase-documented |
| Cookie session storage/refresh in Next | Custom cookie chunking + refresh loop | `@supabase/ssr` `createServerClient` + `proxy.ts` `getClaims()` | Chunked `sb-<ref>-auth-token` cookies, refresh race handling, cache headers |
| Password reset tokens | Own token table + mailer | Supabase `resetPasswordForEmail` + `verifyOtp` | Enumeration-safe, expiring token hashes, templates |
| Transactional job enqueue | Outbox table + poller | `pg-boss` + `fromDrizzle(tx, sql)` | Same transaction, retries, archiving, scheduling |
| Migration file naming/ordering | Hand-numbered SQL files | `drizzle-kit generate` with `migrations.prefix: 'supabase'` | Supabase-CLI-compatible timestamps, snapshots, diff |
| Module boundary lint | Regex over imports | `turbo boundaries` tags + Biome `noRestrictedImports` patterns | Transitive checks, undeclared-deps detection |
| Env var validation | `process.env.X!` sprinkled | `@t3-oss/env-nextjs` / `env-core` | Fail-fast, typed, separates server/client vars |
| Cloud Run deploy auth | Service-account JSON keys | `google-github-actions/auth@v3` WIF | No long-lived secrets (C4) |
| RLS regression tests | Ad-hoc scripts | pgTAP via `supabase test db` + `basejump-supabase_test_helpers` | Each test in a rolled-back transaction; `tests.rls_enabled()` |

**Key insight:** every "custom" version of these has a known failure mode that a tenant-isolation product cannot afford (stale keys, leaked pooled settings, enumeration, double-applied migrations).

## Runtime State Inventory

> Included because D-11 renames the default branch (`master` → `main`) and moves the repo; otherwise greenfield.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no application database exists yet (verified: repo contains only `.planning/`, `.claude/`, `reference/`) | none |
| Live service config | GitHub default branch is `master` (git status); no Vercel project, Cloud Run service or Supabase project exists yet (`vercel teams ls` → PSW only; `supabase projects list` → empty) | Rename branch before creating Vercel/GCP projects so Production branch = `main` from the start |
| OS-registered state | None | none |
| Secrets/env vars | None in repo (`.gitignore` only ignores `reference/`) | Create `.env.example`; all secrets created fresh in Secret Manager / Vercel / GitHub |
| Build artifacts | None | none |

## Common Pitfalls

### Pitfall 1: Supavisor transaction mode + non-local settings
**What goes wrong:** a `SET ROLE` or `set_config(..., false)` outside a transaction survives on the pooled server connection and the next request (possibly another tenant's) inherits it.
**Why it happens:** the pooler multiplexes server connections per transaction; docs: session state "doesn't survive between transactions".
**How to avoid:** only `withTenantTx`/`withAdminTx` may touch roles/settings; both use `LOCAL`; the spike (Wave 0) and `030-lanes.sql` prove that a bare statement after the transaction sees `current_setting('request.jwt.claims', true) = ''` and `current_user = 'api_user'`.
**Warning signs:** intermittent cross-tenant rows under concurrency; `EXPLAIN` on the pooler shows policy filters with an unexpected tenant.

### Pitfall 2: drizzle-orm 0.45.2 API is `enableRLS()`, not `withRLS()`
**What goes wrong:** copying the stack table / latest docs (`pgTable.withRLS(...)`) fails to typecheck on 0.45.2.
**How to avoid:** use `pgTable('t', {...}, (t) => [pgPolicy(...)]).enableRLS()`; policies enable RLS automatically `[VERIFIED: drizzle-orm@0.45.2 pg-core/table.d.ts:22 — "enableRLS: () => Omit<PgTableWithColumns<T>, 'enableRLS'>"]` `[CITED: orm.drizzle.team/docs/rls]`.

### Pitfall 3: TypeScript 7.0 has no JS compiler API
**What goes wrong:** `tsup --dts` (rollup-plugin-dts) and typescript-eslint need `typescript.js`; TS 7.0 ships only the native compiler until 7.1 (CLAUDE.md).
**How to avoid:** typecheck and emit declarations with `tsc -b` project references (native); `tsup` with `dts: false` for `apps/api`; Biome for lint; Vitest/tsx/Next use esbuild/SWC/Turbopack. Day-1 bootstrap smoke task: `pnpm turbo typecheck lint test build` must go green before any feature code; fallback alias to TS 6 documented in CLAUDE.md `[ASSUMED: tsup dts path breaks; everything else verified by engines/peer metadata]`.

### Pitfall 4: Free plan quotas and pausing
**What goes wrong:** "Limit of 2 active projects" and "Free projects are paused after 1 week of inactivity" `[CITED: supabase.com/pricing]` — staging goes to sleep between sprints; the local `supabase start` stack is the only third environment.
**How to avoid:** a scheduled GitHub Action (`schedule: cron '0 9 * * 1,4'`) that hits `GET /v1/health` on `api-staging` (which runs a `select 1`) keeps staging warm `[ASSUMED: any DB activity resets the inactivity timer]`; document "unpause in dashboard" in the runbook.

### Pitfall 5: GitHub plan blocks the D-12 approval gate
**What goes wrong:** `tria-company` is a **User** account (`gh api users/tria-company` → `"type": "User"` `[VERIFIED: GitHub API this session]`), not an organisation; private-repo Environments need GitHub Pro (user) or Team (org).
**How to avoid:** decide (Open Question 1) before writing `deploy-api.yml`; fallback keeps the job order but triggers `migrate-and-deploy-prod` by `workflow_dispatch` (manual = approval) instead of `environment:` rules.

### Pitfall 6: `api_user` has no table privileges / no `SET ROLE` right
**What goes wrong:** `permission denied for table tenants` in the lane, or `permission denied to set role "authenticated"`.
**Why it happens:** `GRANT authenticated TO api_user` missing, or tables in a custom schema without grants; Supabase's default privileges cover `public` only `[ASSUMED]`.
**How to avoid:** keep Phase 1 tables in `public` with module prefixes (`example_items`, `chat_conversations`) rather than per-module schemas; add explicit `grant select, insert, update, delete on all tables in schema public to authenticated, service_role` + `alter default privileges` in the helpers migration; pgTAP `030-lanes.sql` executes a read through the lane.

### Pitfall 7: Sign-up compensation and duplicate e-mail UX
**What goes wrong:** `createUser` succeeds, membership insert fails → orphan identity that can log in with no tenant (hits `NO_MEMBERSHIP`).
**How to avoid:** compensate with `auth.admin.deleteUser`; treat `NO_MEMBERSHIP` in the web app as "conta sem comunidade" screen pointing to `/cadastro/{tenant_slug cookie}`; map GoTrue's duplicate error to `409 EMAIL_ALREADY_REGISTERED` and never leak which tenant.

### Pitfall 8: Vercel preview cookies and redirect allow-list
**What goes wrong:** recovery links from a preview deploy redirect to a URL Supabase rejects; `SameSite`/`Secure` cookies on `*.vercel.app` previews.
**How to avoid:** `additional_redirect_urls` includes `https://*-<team-slug>.vercel.app/**` on **staging only**; production has the exact URL `[CITED: redirect-urls docs]`. `site_url` differs per project (`config.toml` `[remotes.<name>]` overrides or dashboard).

### Pitfall 9: Supabase CLI and pnpm drift on the dev machine
**What goes wrong:** local CLI 2.90.0 vs pinned 2.117.0 (`config.toml` keys differ); pnpm 9.15.9 vs 12.4.1 (lockfile format).
**How to avoid:** `packageManager: "pnpm@12.4.1"` in root package.json + `corepack enable`; pin `supabase@2.117.0` as a root devDependency and run it via `pnpm supabase …`; `.nvmrc` = 24.

### Pitfall 10: Docker not running
**What goes wrong:** `supabase start`, `supabase test db`, `supabase db reset` all fail ("Cannot connect to the Docker daemon" observed today).
**How to avoid:** first task of the phase: `open -a Docker` and verify `docker info`; CI uses `ubuntu-latest` which ships Docker `[ASSUMED]`.

## Code Examples

### Core schema with RLS policy (Drizzle 0.45.2)

```ts
// packages/core/db/schema/memberships.ts
// Source: orm.drizzle.team/docs/rls + drizzle-orm@0.45.2 typings; SQL shape from ARCHITECTURE.md Pattern 2
import { sql } from 'drizzle-orm';
import { index, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid, check } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
import { tenants } from './tenants';
import { users } from './users';

export const memberships = pgTable('memberships', {
  id: uuid().primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text().notNull().default('member'),
  status: text().notNull().default('active'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  blockedAt: timestamp('blocked_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('memberships_tenant_user_uq').on(t.tenantId, t.userId),
  // V1 rule: one tenant per user. Dropping this index is the V2 multi-tenancy migration (ROLE-02).
  uniqueIndex('memberships_one_tenant_per_user_v1').on(t.userId),
  index('memberships_tenant_role_idx').on(t.tenantId, t.role),
  check('memberships_role_chk', sql`${t.role} in ('admin_tenant','support_tenant','member')`),
  check('memberships_status_chk', sql`${t.status} in ('active','blocked','invited')`),
  pgPolicy('memberships_tenant_isolation', {
    for: 'all', to: authenticatedRole,
    using: sql`tenant_id = app.tenant_id()`,
    withCheck: sql`tenant_id = app.tenant_id()`,
  }),
]).enableRLS();
```

Tables in the same style: `tenants` (id, slug unique, display_name, branding jsonb, rules_text, rules_version int, plan, status, timezone, created_at — policy: `id = app.tenant_id()` for select), `users` (id references `auth.users` on delete cascade, email, name, created_at — mirrored by trigger; policy: `id = (select auth.uid())` or same-tenant via membership), `platform_admins` (user_id pk — **no** `authenticated` policy; admin lane only), `tenant_modules` (tenant_id, module_key, enabled, settings jsonb, updated_at, pk(tenant_id, module_key)), `consent_records` (id, tenant_id, user_id, kind check in ('tenant_rules','tria_terms'), text_version, accepted_at, ip inet, user_agent — insert via admin lane at sign-up; select policy same tenant + own user), stubs `chat_conversations`, `chat_participants`, `chat_messages` (with `seq bigint`), `notifications` (tenant_id, user_id, kind, payload jsonb, read_at) — all with `tenant_id` + policy so the pgTAP coverage test passes from day one.

### drizzle.config.ts

```ts
// apps/api/drizzle.config.ts — Source: orm.drizzle.team/docs/drizzle-config-file; 'supabase' prefix verified in drizzle-kit 0.31.10
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'postgresql',
  schema: ['../../packages/core/db/schema/*.ts', '../../packages/modules/*/db/schema.ts'],
  out: '../../supabase/migrations',
  migrations: { prefix: 'supabase' },              // YYYYMMDDHHmmss_name.sql
  entities: { roles: { provider: 'supabase' } },   // ignore Supabase-managed roles in diffs
  dbCredentials: { url: process.env.SUPABASE_DB_URL! }, // only for `drizzle-kit studio`/introspect; never `migrate`
});
```

### Supavisor spike (Wave 0) — `scripts/spike-supavisor.test.ts`

```ts
// Runs against (1) local PgBouncer: set [db.pooler] enabled = true in config.toml → postgres://api_user:pw@127.0.0.1:54329/postgres
//              (2) staging Supavisor: postgres://api_user.<ref>:pw@aws-…pooler.supabase.com:6543/postgres
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';

const client = postgres(process.env.SPIKE_DATABASE_URL!, { prepare: false, max: 2 }); // max 2 forces reuse
const db = drizzle(client);
const lane = (tenantId: string) => db.transaction(async (tx) => {
  await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: '00000000-0000-0000-0000-000000000001', role: 'authenticated', tenant_id: tenantId })}, true)`);
  await tx.execute(sql`set local role authenticated`);
  const [row] = await tx.execute(sql`select current_user as u, app.tenant_id() as t, (select count(*) from example_items) as n`);
  return row as { u: string; t: string; n: string };
});

describe('supavisor tenant lane', () => {
  it('keeps claims and role inside the transaction and drops them after', async () => {
    const A = process.env.TENANT_A!, B = process.env.TENANT_B!;
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => lane(i % 2 ? A : B)));
    for (const [i, r] of results.entries()) { expect(r.u).toBe('authenticated'); expect(r.t).toBe(i % 2 ? A : B); }
    const [after] = await db.execute(sql`select current_user as u, current_setting('request.jwt.claims', true) as c`);
    expect(after.u).toBe('api_user'); expect(after.c ?? '').toBe('');
    const aRows = results.filter((_, i) => i % 2).map((r) => r.n), bRows = results.filter((_, i) => !(i % 2)).map((r) => r.n);
    expect(new Set(aRows).size).toBe(1); expect(new Set(bRows).size).toBe(1); // stable counts per tenant, never mixed
  });
  it('api_user outside a lane sees nothing', async () => {
    await expect(db.execute(sql`select count(*) from example_items`)).rejects.toThrow(/permission denied|42501/); // NOINHERIT
  });
});
```

**Fallback switch if the spike fails on 6543:** change only `DATABASE_URL` to the session pooler (port 5432, same username) and keep `prepare: false` off (prepared statements are allowed in session mode but keep the code identical); size `max` ≤ 5 per instance. No code change in `withTenantTx`. Fallback #2 (PostgREST per-request client) is a rewrite and is not recommended.

### pgTAP: every `tenant_id` table has RLS + a policy

```sql
-- supabase/tests/010-rls-coverage.sql  (supabase test db; each file is its own rolled-back transaction)
begin;
select plan(2);
select is_empty($$
  select n.nspname || '.' || c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
$$, 'every public table with tenant_id has RLS enabled');
select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
  where n.nspname = 'public' and c.relkind = 'r'
    and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
$$, 'every tenant table has at least one policy');
select * from finish();
rollback;
```

```sql
-- supabase/tests/020-tenant-isolation.sql — Source pattern: supabase.com/docs/guides/database/postgres/row-level-security (set local role + claims)
begin;
select plan(3);
insert into public.tenants (id, slug, display_name) values ('11111111-…', 'a', 'A'), ('22222222-…', 'b', 'B');
insert into public.example_items (tenant_id, title) values ('11111111-…', 'a1'), ('22222222-…', 'b1');
select set_config('request.jwt.claims', '{"sub":"…","role":"authenticated","tenant_id":"11111111-…"}', true);
set local role authenticated;
select results_eq('select count(*) from public.example_items', array[1::bigint], 'tenant A sees only its row');
select throws_ok($$ insert into public.example_items (tenant_id, title) values ('22222222-…', 'x') $$, '42501', null, 'with check blocks cross-tenant insert');
select is_empty($$ select 1 from public.example_items where tenant_id = '22222222-…' $$, 'detail lookup by other tenant id is empty');
select * from finish();
rollback;
```

### Hono app composition and RPC export

```ts
// apps/api/src/app.ts — Source: hono.dev/docs/guides/rpc (chained routes → AppType)
import { Hono } from 'hono';
const app = new Hono<AppEnv>().use(requestId()).use(logger());
const routes = app
  .route('/v1/public', publicRoutes)                       // tenants/:slug, signup/:slug (no auth)
  .route('/v1/me', meRoutes.use(requireAuth))              // bootstrap
  .route('/v1/example', exampleRoutes.use(requireAuth, requireModule('example')))
  .route('/v1/platform', platformRoutes.use(requireAuth, requireSuperAdmin()));
export type AppType = typeof routes;   // re-exported by @tria/contracts for hc<AppType>()
export default app;
```

```ts
// apps/api/src/main.ts
if (env.ROLE === 'worker') { await startWorker(); } else {
  const server = serve({ fetch: app.fetch, port: env.PORT });
  process.on('SIGTERM', () => server.close(() => process.exit(0)));  // Cloud Run sends SIGTERM before shutdown
}
```

### GitHub Actions skeleton

```yaml
# .github/workflows/ci.yml
on: { pull_request: {}, push: { branches: [main] } }
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo lint typecheck boundaries test build
      - uses: supabase/setup-cli@v3
        with: { version: 2.117.0 }
      - run: supabase start && supabase db reset          # applies supabase/migrations
      - run: supabase test db                             # pgTAP in supabase/tests
      - run: pnpm db:seed && pnpm --filter @tria/api test:integration   # two-tenant API suite against local stack
        env: { DATABASE_URL: postgres://api_user:postgres@127.0.0.1:54329/postgres }   # local PgBouncer, transaction mode
```

```yaml
# .github/workflows/deploy-api.yml (excerpt)
on:
  pull_request: { paths: [apps/api/**, packages/**, supabase/**, pnpm-lock.yaml] }
  push: { branches: [main], paths: [apps/api/**, packages/**, supabase/**, pnpm-lock.yaml] }
permissions: { contents: read, id-token: write }
jobs:
  build:      # docker/setup-buildx-action@v4 → google-github-actions/auth@v3 (WIF) → docker/login-action@v4 (Artifact Registry) → docker/build-push-action@v7
  staging:    # if: github.event_name == 'pull_request'; supabase link + db push --include-roles (staging) + config push; deploy-cloudrun@v3 api-staging, worker-staging (env_vars: ROLE=worker)
  migrate-and-deploy-prod:
    if: github.ref == 'refs/heads/main'
    needs: [build]
    environment: { name: production, url: https://app.seusistema.com }   # requires GitHub Pro/Team for a private repo
    steps:
      - uses: supabase/setup-cli@v3
      - run: supabase link --project-ref "$SUPABASE_PROJECT_ID" && supabase db push --include-roles && supabase config push
        env: { SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}, SUPABASE_DB_PASSWORD: ${{ secrets.PROD_DB_PASSWORD }}, SUPABASE_PROJECT_ID: ${{ secrets.PROD_PROJECT_ID }} }
      - uses: google-github-actions/auth@v3
        with: { workload_identity_provider: ${{ vars.WIF_PROVIDER }}, service_account: ${{ vars.DEPLOY_SA }} }
      - uses: google-github-actions/deploy-cloudrun@v3
        with: { service: api, region: southamerica-east1, image: ${{ needs.build.outputs.image }}, secrets: 'DATABASE_URL=api-database-url:latest,SUPABASE_SERVICE_KEY=supabase-service-key:latest', flags: '--min-instances=1' }
      - uses: google-github-actions/deploy-cloudrun@v3
        with: { service: worker, region: southamerica-east1, image: ${{ needs.build.outputs.image }}, env_vars: 'ROLE=worker', flags: '--min-instances=1 --no-cpu-throttling' }
```

### Idempotent seed (D-14) — `scripts/seed.ts`

```ts
// tsx scripts/seed.ts — admin lane + supabase-js admin; safe to re-run
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
async function ensureUser(email: string, password: string, name: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
  if (!error) return data.user.id;
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 }); // small pilot; fine
  const existing = list.users.find((u) => u.email === email); if (!existing) throw error; return existing.id;
}
await withAdminTx(async (tx) => {
  for (const t of [{ slug: 'tria-demo', modules: REAL_TENANT_DEFAULT_MODULES }, { slug: 'tria-lab', modules: ['feed', 'events'] }]) {
    const [tenant] = await tx.insert(tenants).values({ slug: t.slug, displayName: t.slug, rulesText: '…', rulesVersion: 1 }).onConflictDoUpdate({ target: tenants.slug, set: { displayName: t.slug } }).returning();
    for (const key of TOGGLEABLE_MODULES) await tx.insert(tenantModules).values({ tenantId: tenant.id, moduleKey: key, enabled: t.modules.includes(key) }).onConflictDoUpdate({ target: [tenantModules.tenantId, tenantModules.moduleKey], set: { enabled: t.modules.includes(key) } });
    for (const [role, suffix] of [['admin_tenant', 'admin'], ['member', 'member']] as const) {
      const userId = await ensureUser(`${suffix}@${t.slug}.local`, env.SEED_PASSWORD, `${t.slug} ${suffix}`);
      await tx.insert(memberships).values({ tenantId: tenant.id, userId, role }).onConflictDoNothing();
    }
  }
  const superId = await ensureUser(env.SUPER_ADMIN_EMAIL, env.SUPER_ADMIN_PASSWORD, 'TRIA');
  await tx.insert(platformAdmins).values({ userId: superId }).onConflictDoNothing();
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `middleware.ts` (edge) | `proxy.ts` (Node runtime, `runtime` config forbidden) | Next 16.0 | Supabase example already uses `proxy.ts`; codemod `middleware-to-proxy` exists |
| `supabase.auth.getUser()` per request in middleware | `getClaims()` (local JWKS verification for asymmetric keys) | 2025 | Faster; requires ES256 keys — enable before first deploy |
| HS256 shared JWT secret | Asymmetric signing keys + JWKS | 2025 | "Not recommended for production"; no secret in Cloud Run |
| `@supabase/auth-helpers-nextjs` | `@supabase/ssr` 0.12 | consolidated | README states all auth-helpers are deprecated |
| Supabase default e-mail provider for real users | Custom SMTP mandatory (team-only delivery, 2/h; free-tier template customisation removed 2026-06) | 2026 | D-13 is not optional |
| Outbox tables for jobs | pg-boss 12 ORM transaction adapters (`fromDrizzle`) | pg-boss 11/12 | Atomic enqueue without an outbox |
| ESLint boundary plugins | `turbo boundaries` tags (experimental) + Biome patterns | Turborepo 2.4+ / Biome 2.2 | Fits the locked toolchain; dependency-cruiser stays as fallback |
| `drizzle-kit migrate` as applier | `drizzle-kit generate` → `supabase db push` | project decision | One history table |

**Deprecated/outdated:** `next-pwa`, `middleware.ts`, `@supabase/auth-helpers-*`, `SUPABASE_JWT_SECRET` in the API, `pgTable.withRLS` naming for the 0.45 line (use `enableRLS()`).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Supabase access tokens carry `aud: 'authenticated'`; verifying with `audience: 'authenticated'` is correct | Pattern 2 | 401 for everyone — caught by the first integration test; drop `audience` if so |
| A2 | `BYPASSRLS` is a role attribute not inherited via `GRANT service_role TO api_user`; `NOINHERIT` on `api_user` blocks unscoped queries; `SET LOCAL ROLE` requires membership only | Pattern 1 | Silent RLS bypass — `030-lanes.sql` and the spike assert it |
| A3 | Supabase default privileges grant `authenticated`/`service_role` on new `public` tables created by migrations | Pitfall 6 | Permission errors — explicit grants in the helpers migration make this moot |
| A4 | The `postgres` role on hosted projects has `CREATEROLE` so `roles.sql`/migrations can create `api_user` | Pattern 1 | Role must be created via dashboard SQL editor once; document |
| A5 | `tsup --dts` breaks under TS 7.0 (needs the JS API); everything else in the toolchain does not | Pitfall 3 | Bootstrap smoke task detects; fallback TS 6 alias |
| A6 | pg-boss worker polling works through the pooler; session mode chosen to be safe | Pattern 9 | Worker connects direct/session; no data-model impact |
| A7 | `tria-company` GitHub account is on the Free plan (plan field not readable with current token scopes) | Pitfall 5 / OQ1 | If Pro, D-12 works as written |
| A8 | `supabase config push` applies `[auth.email.smtp]`, templates and `additional_redirect_urls` to the linked hosted project | Pattern 6 | Configure via dashboard once per project instead |
| A9 | Any DB activity resets the Free-plan inactivity timer (keep-alive cron) | Pitfall 4 | Staging pauses; manual unpause |
| A10 | postgres.js pins one server connection for the whole `sql.begin()`/Drizzle transaction | Pattern 1 | Spike would fail immediately — visible |
| A11 | GitHub-hosted `ubuntu-latest` runners have Docker for `supabase start` | Pattern 8 | Use `supabase/setup-cli` docs' `supabase db start` job; well established |
| A12 | Vercel Preview environment variables can be pointed at the staging API/Supabase while Production points at prod | Pattern 8 | Standard Vercel per-environment vars |
| A13 | `turbo boundaries` is available in 2.10.12 (introduced ~2.4 as experimental) | Pattern 7 | Use dependency-cruiser 18.2.0 |
| A14 | Custom SMTP is available on the Free plan (search result + Supabase changelog, MEDIUM) | Pattern 6 | Would force Pro for staging/prod |
| A15 | `auth.uid()` reads `sub` from `request.jwt.claims` when `request.jwt.claim.sub` is unset, so `authUid`-based policies also work in the lane | Pattern 1 | Use `app.tenant_id()`/`app.user_id()` helpers only (already recommended) |
| A16 | Revoking `anon` grants / hiding `public` from the Data API does not break Supabase Auth or Storage internals | Anti-patterns | Verify on staging before prod; RLS alone already prevents leakage |
| A17 | pg-boss's Drizzle adapter accepts a Drizzle `tx` from `drizzle-orm/postgres-js` with `prepare:false` (docs say postgres-js supported) | Pattern 9 | Enqueue outside the tx with an idempotency key |

## Open Questions (RESOLVED)

Every question below is answered by a planned task (planning pass of 2026-09-11); none blocks execution. The resolving plan/task is marked on each item.

1. **GitHub plan / account shape for D-11 and D-12** — **RESOLVED by 01-10 Task 1** (`checkpoint:decision`: org-team / user-pro / free-dispatch / public-repo) **and 01-10 Task 3** (repo under `tria-company`, `main`, environments; the `workflow_dispatch` fallback is recorded in `docs/DEPLOY.md` if protection rules are unavailable).
   - What we know: `tria-company` is a User account (not an org) with private repos (`Agent-post-auton`, `Agent-Roberth`); protected Environments on private repos need Pro (user) or Team (org).
   - What's unclear: current plan of `tria-company`; whether TRIA wants a real organisation.
   - Recommendation: create a GitHub **organisation** `tria-company-org` (or upgrade the user to Pro) before the CI plan; otherwise implement the prod gate as `workflow_dispatch` and record the deviation from D-12.
2. **Vercel team** — **RESOLVED by 01-10 Task 2** (human-action: team slug confirmed) **and 01-11 Task 2** (project linked, env vars, domain; the slug feeds the staging redirect allow-list in `supabase/config.toml`). Original question: CLI is logged in as `hiperautomacao` with team `PSW` only. Which Vercel team hosts `rede-social`? Team slug also defines the preview URL pattern for the Supabase redirect allow-list.
3. **GCP project** — **RESOLVED by 01-10 Task 2** (`gcloud auth login ferramentas@triacompany.com.br`, project id + billing confirmed) **and 01-11 Task 1** (APIs, Artifact Registry, service accounts, WIF, Secret Manager). Original question: `gcloud` active account belongs to an unrelated project; `ferramentas@triacompany.com.br` is credentialed but its token needs re-auth (`gcloud auth login`). Which GCP project/billing account hosts Cloud Run, Artifact Registry, Secret Manager and the WIF pool?
4. **Supabase organisation** — **RESOLVED by 01-10 Task 2** (TRIA org named/created, access token provided) **and 01-10 Task 3** (`rede-social-staging`/`rede-social-prod` created in `sa-east-1`). Original question: only "igor.vboas@gmail.com's Org" exists (0 projects). Create a TRIA org (Free) for `rede-social-staging`/`rede-social-prod` so ownership is not personal.
5. **Resend domain** — **RESOLVED by 01-10 Task 2** (DNS control for `seusistema.com` confirmed) **and 01-11 Tasks 2–3** (Resend domain + sending key created; SPF/DKIM and the `app.` CNAME added and verified at the human checkpoint). Original question: who controls DNS for `seusistema.com` (for `mail.seusistema.com` SPF/DKIM) and the `app.seusistema.com` A/CNAME for Vercel?
6. **Local pooler for the spike** — **RESOLVED as two runs: 01-03 Task 1** (local PgBouncer transaction mode, `pnpm spike:supavisor`, LOCAL-settings guard, fallback doc) **and 01-12 Task 1 step 4** (staging Supavisor `:6543`, with the `:5432` session-pooler fallback applied via Secret Manager and recorded in `docs/DEPLOY.md` if it fails). Original question: `config.toml [db.pooler]` is PgBouncer, not Supavisor; the spike must also run against the staging Supavisor URL (needs staging project first). Plan the spike as two runs.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | ✓ | v24.14.0 | — |
| pnpm | monorepo | ✓ (wrong version) | 9.15.9 global; `corepack pnpm@12` → 12.4.1 works | `corepack enable && corepack use pnpm@12.4.1` |
| npm | scripts | ✓ | 11.9.0 | — |
| Supabase CLI | local stack, migrations, pgTAP | ✓ (old) | 2.90.0 (pinned 2.117.0) | `brew upgrade supabase` or run via `pnpm supabase` |
| Docker daemon | `supabase start`, `test db` | ✗ (Docker Desktop installed, daemon not running) | Docker 29.3.1 client | `open -a Docker` first task |
| psql | role password step, ad-hoc checks | ✓ | 18.3 | — |
| gh CLI | repo/org setup, Actions | ✓ | 2.87.3; accounts igorvboas (active), tria-company | switch with `gh auth switch -u tria-company` |
| gcloud | WIF pool, Cloud Run, Secret Manager | ✓ (wrong account active; TRIA account token expired) | SDK 565.0.0 | `gcloud auth login ferramentas@triacompany.com.br` |
| Vercel CLI | project link, env | ✓ | 53.2.0 (user hiperautomacao, team PSW) | `vercel teams switch` / new team |
| turbo, biome, tsc, pg_prove | build/lint/test | ✗ global (expected) | — | installed as workspace devDependencies; `pg_prove` runs inside Supabase's container |
| Context7 / ctx7 | docs lookup | ✗ | — | WebFetch on official docs (used this session) |
| Local Postgres | — | ✗ (port 5432 free) | — | not needed; Supabase local stack uses 54322 |

**Missing dependencies with no fallback:** none that block planning; Docker daemon must be started before Wave 0 execution.
**Missing dependencies with fallback:** pnpm 12 (corepack), Supabase CLI 2.117 (upgrade), gcloud/Vercel/gh account selection (Open Questions 1-4).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.0 (unit + API integration), pgTAP via `supabase test db` (CLI 2.117.0), Playwright 1.63.0 (auth smoke), `turbo boundaries` + Biome 2.5.13 (MOD-02) |
| Config file | none yet — Wave 0 creates `packages/config/vitest.base.ts`, per-package `vitest.config.ts` (Vitest 5 no longer walks up directories), `playwright.config.ts` in `apps/web`, `supabase/tests/` |
| Quick run command | `pnpm turbo test --filter=...[HEAD^1]` (per package: `pnpm vitest run`) |
| Full suite command | `pnpm turbo lint typecheck boundaries test && supabase test db && pnpm --filter @tria/api test:integration && pnpm --filter @tria/web e2e` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TENANT-01 | Bootstrap resolves tenant from membership, ignores hostname/cookie | integration | `pnpm --filter @tria/api vitest run tests/integration/bootstrap.test.ts` | ❌ Wave 0 |
| TENANT-03 | Every `tenant_id` table has RLS + policy; lane runs as `authenticated`, not service role | pgTAP | `supabase test db supabase/tests/010-rls-coverage.sql supabase/tests/030-lanes.sql` | ❌ Wave 0 |
| TENANT-03 | Supavisor lane keeps/clears settings per transaction | integration (spike) | `pnpm vitest run scripts/spike-supavisor.test.ts` (local pooler + staging URL) | ❌ Wave 0 |
| TENANT-05 | Two-tenant isolation: list/detail on example module, disabled-module 404, blocked 403 | pgTAP + integration | `supabase test db supabase/tests/020-tenant-isolation.sql` + `vitest run tests/integration/isolation.test.ts` | ❌ Wave 0 |
| MOD-01 | Example module package has db/server/contracts/ui and mounts | build + unit | `pnpm turbo build --filter=@tria/module-example` | ❌ Wave 0 |
| MOD-02 | Cross-module internal import fails the build | lint | `pnpm turbo boundaries lint` with a fixture package that must fail (negative test in CI: `! turbo boundaries --filter=@tria/boundary-fixture`) | ❌ Wave 0 |
| ROLE-01/02 | Role check constraint, one-membership unique index, `platform_admins` separate | pgTAP | `supabase test db supabase/tests/040-schema-conventions.sql` | ❌ Wave 0 |
| ROLE-06 | `requireModule` 404 on `tria-lab` for `chat`; `requireRole` 403 | integration | `vitest run tests/integration/modules.test.ts` | ❌ Wave 0 |
| AUTH-01/04 | Sign-up via `/cadastro/tria-demo` creates member + 2 consent rows with timestamps; duplicate e-mail → 409 | integration + e2e | `vitest run tests/integration/signup.test.ts`; `playwright test auth.spec.ts --project=mobile-chromium` | ❌ Wave 0 |
| AUTH-02 | Login persists across browser restart (`storageState` reuse) | e2e | `playwright test session.spec.ts` | ❌ Wave 0 |
| AUTH-03 | Recovery link → `/auth/confirm` → `/redefinir-senha` → signed in | e2e against local stack (Inbucket/Mailpit at `supabase status` URL) | `playwright test recovery.spec.ts` | ❌ Wave 0 |
| AUTH-05 | Logout clears cookies; other device session unaffected | e2e | `playwright test logout.spec.ts` | ❌ Wave 0 |
| AUTH-06 | Expired/forged JWT → 401; blocked membership → 403 `MEMBERSHIP_BLOCKED` on next request without re-login | integration | `vitest run tests/integration/auth-middleware.test.ts` | ❌ Wave 0 |
| PWA-04 | PR → preview + staging deploy; main → prod after approval | manual-only (CI observation) + smoke `curl /v1/health` in workflow | `deploy-api.yml` post-deploy step | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm turbo lint typecheck test --filter=...[HEAD^1]`
- **Per wave merge:** full suite command above (requires `supabase start`)
- **Phase gate:** full suite green + staging spike green + a manual PR → preview → merge → approval → prod run before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `packages/config/vitest.base.ts`, per-package `vitest.config.ts` — framework install `pnpm add -Dw vitest@5.0.0 @vitest/coverage-v8@5.0.0`
- [ ] `apps/api/tests/integration/{setup.ts,bootstrap,isolation,modules,signup,auth-middleware}.test.ts` — needs local stack + seed
- [ ] `supabase/tests/{000-helpers,010-rls-coverage,020-tenant-isolation,030-lanes,040-schema-conventions}.sql` — helpers via `dbdev.install('basejump-supabase_test_helpers')` or inline SQL
- [ ] `scripts/spike-supavisor.test.ts` — spike before schema freeze
- [ ] `apps/web/playwright.config.ts` with `devices['iPhone 14']` project; `e2e/{auth,session,recovery,logout}.spec.ts`
- [ ] `packages/boundary-fixture` negative package for MOD-02 CI check
- [ ] `docker info` green; `supabase start` once to pull images

## Security Domain

### Applicable ASVS Categories (level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth (bcrypt, rate limits: sign-in 30/5 min per IP, token 150/5 min) `[CITED: supabase.com/docs/guides/auth/rate-limits]`; min length 8; enumeration-safe recovery |
| V3 Session Management | yes | `@supabase/ssr` HttpOnly cookies; `getClaims()` in `proxy.ts`; refresh rotation on; `signOut({ scope: 'local' })`; Cache-Control headers from `setAll` applied to responses |
| V4 Access Control | yes | Per-request membership status; `requireRole`; `requireModule`; RLS `tenant_id = app.tenant_id()`; `api_user` NOINHERIT; admin lane import-restricted |
| V5 Input Validation | yes | Zod 4 shared schemas (`@hono/zod-openapi` validators, `@hookform/resolvers`); slug regex `^[a-z0-9-]{3,40}$`; `next` redirect validation |
| V6 Cryptography | yes | ES256 JWT via Supabase + `jose`; never hand-roll; no HS256 secret |
| V8 Data Protection | yes | consent records with `ip`/`user_agent` (LGPD evidence); `Cache-Control: private, no-store` on API |
| V9 Communications | yes | HTTPS everywhere (Vercel, Cloud Run, Supabase); SMTP 465 TLS |
| V14 Configuration | yes | Secret Manager + Vercel env; `@t3-oss/env`; no secrets in `config.toml` (`env()` substitution); WIF |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant read via missing `where` | Information disclosure | RLS lane + `tenant_id` in every policy; isolation suite |
| Pooled-connection setting leak | Information disclosure | `LOCAL` settings only; spike + pgTAP; grep guard |
| Service-role key reach | Elevation of privilege | Key only in API Secret Manager; `supabase-admin.ts` importable from kernel `tenancy`/`platform`/`seed` only (Biome pattern) |
| Forged/expired JWT | Spoofing | `jose` JWKS verify with issuer (+audience); 401 |
| Blocked member keeps token | Elevation of privilege | Per-request membership status → 403 `MEMBERSHIP_BLOCKED` |
| Account enumeration on recovery/sign-up | Information disclosure | Constant response copy (D-10); duplicate e-mail copy generic (D-04) |
| Open redirect via `next` on `/auth/confirm` | Tampering | Accept only relative paths |
| CSRF on server actions | Tampering | Next.js Server Actions origin check (built-in) + `SameSite=Lax` cookies |
| Sign-up spam | Denial of service | Supabase sign-up rate limit (30/5 min/IP); further limits deferred (Phase 8) |
| PostgREST reachable with publishable key | Information disclosure | RLS everywhere; revoke `anon`; hide `public` from Data API `[ASSUMED]` |
| Secrets in build logs / `NEXT_PUBLIC_` | Information disclosure | Only URL + publishable key are public; service key never in web env |
| Consent tampering / repudiation | Repudiation | Append-only `consent_records` (no update/delete policy), `text_version` from versioned markdown front-matter |

## Sources

### Primary (HIGH confidence — official docs or installed artifacts read this session)
- npm registry (`npm view … version/time/engines/peerDependencies`), 2026-09-11 — every version in Standard Stack
- Installed typings: `drizzle-orm@0.45.2` (`pg-core/table.d.ts:22` `enableRLS`, `pg-core/policies.d.ts:6-11` `PgPolicyConfig`, `supabase/rls.d.ts` exports), `drizzle-kit@0.31.10` (`'supabase'` prefix), `pg-boss@12.31.0` (`dist/index.d.ts:114` adapters, `dist/types.d.ts` options, `dist/cli.js` usage), `postgres@3.4.9` (`types/index.d.ts:666` `prepare`), `msw@2.15.0` postinstall script
- `supabase init` generated `config.toml` (CLI 2.90.0): `[auth]` lines 150-224, `[db.pooler]` lines 38-48; `supabase config push --help`, `supabase db push --help`, `supabase test db --help`
- GitHub API: `examples/auth/nextjs/{proxy.ts,lib/supabase/proxy.ts,lib/supabase/server.ts,lib/supabase/client.ts}` (raw), `apps/docs/content/guides/auth/server-side/creating-a-client.mdx` (raw), latest release tags for all Actions, `users/tria-company` type
- https://supabase.com/docs/guides/database/connecting-to-postgres — Supavisor modes, unsupported features, custom role username
- https://supabase.com/docs/guides/database/postgres/row-level-security — testing with `set local role`, performance, bypassrls
- https://supabase.com/docs/guides/auth/signing-keys and /jwts — ES256 migration, JWKS caching, jose example
- https://supabase.com/docs/guides/auth/passwords, /auth-smtp, /rate-limits, /redirect-urls, /managing-user-data, /server-side/creating-a-client
- https://supabase.com/docs/reference/javascript/{auth-signout,auth-getclaims,auth-admin-createuser}; /reference/cli/{supabase-db-push,supabase-test-db}
- https://supabase.com/docs/guides/local-development/cli/config, /testing/pgtap-extended, /deployment/managing-environments
- https://supabase.com/pricing — Free plan limits
- https://orm.drizzle.team/docs/rls, /drizzle-config-file, /drizzle-kit-generate
- https://hono.dev/docs/guides/rpc, /api/exception
- https://nextjs.org/docs/app/api-reference/file-conventions/proxy (v16.3.4, updated 2026-09-07)
- https://pgboss.io/api/adapters, https://pgboss.io/install
- https://biomejs.dev/linter/rules/no-restricted-imports/
- https://turborepo.dev/docs/reference/boundaries
- https://github.com/google-github-actions/deploy-cloudrun (README)
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
- https://resend.com/docs/send-with-supabase-smtp

### Secondary (MEDIUM confidence — WebSearch cross-checked with a primary source)
- https://github.com/orgs/supabase/discussions/30107 — custom role via pooler = `role.projectref`, no extra grants
- https://github.com/orgs/supabase/discussions/25904 — related report (points to #30107)
- Supabase changelog 2026-06 (free-tier e-mail template customisation) via search; Resend/Supabase integration pages — custom SMTP on Free plan

### Tertiary (LOW confidence — training knowledge, flagged in Assumptions Log)
- Postgres role-attribute inheritance semantics (A2), Supabase default privileges (A3), `auth.uid()` internals (A15), `tsup` dts under TS 7 (A5), pg-boss on the transaction pooler (A6)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version and peer/engine range verified on npm today; two corrections recorded (next 16.3.5, drizzle `enableRLS`)
- Architecture: MEDIUM-HIGH — tenant lane, auth, session, recovery, jobs and CI patterns are all backed by vendor docs or vendor example code; Supavisor behaviour under load still needs the Wave-0 spike, and the GitHub Environment gate depends on a plan decision
- Pitfalls: MEDIUM — environment/plan pitfalls verified live (Docker down, account types, Free-plan limits); Postgres privilege details are assumed until pgTAP proves them

**Research date:** 2026-09-11
**Valid until:** 2026-10-11 for stack versions (fast-moving: next/zod/hono publish weekly); Supabase/GitHub plan facts should be re-checked when the projects are actually created.
