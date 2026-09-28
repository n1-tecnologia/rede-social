# Walking Skeleton — Rede Social

**Phase:** 1
**Generated:** 2026-09-11

## Capability Proven End-to-End

> A person who was invited by an organisation opens that organisation's own domain (`https://rede-demo.localhost:3000` locally, `https://demo.<platform-domain>` in production), signs up through its public link (`/cadastro` on the tenant domain; `/cadastro/rede-demo` on generic hosts such as localhost and Vercel Preview URLs), logs in at `/entrar`, and sees their organisation's name, their role and their enabled modules on `/inicio`, served by `GET /v1/me/bootstrap` on Cloud Run, which verified the Supabase JWT against JWKS, read the membership through an RLS-protected transaction lane on Postgres and confirmed the membership belongs to the host's tenant — first on the local Supabase stack, then on a Vercel Preview + Cloud Run staging + Supabase staging stack, then on the real domains in production. the platform's `super_admin` uses the platform domain.

The skeleton is delivered by plans `01-01` (tracer: JWT → API → RLS lane → bootstrap, verified by an integration test that mints a real GoTrue token) and `01-02` (the first expansion slice: the browser login/logout path on the same bootstrap). The two are split only because a single task wiring ~30 greenfield files exceeds the per-task context budget (context-cost constraint, not difficulty).

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Repository shape | pnpm 12 workspaces + Turborepo 2.10; scope `@rede-social/*`; `apps/{web,api}`, `packages/{core,contracts,ui,config,modules/*}`; no `apps/worker` (worker = same API image with `ROLE=worker`) | D-18; each feature module is a self-contained package (MOD-01); one Docker image for API + worker keeps CI simple |
| Web framework | Next.js 16.3 App Router (Turbopack), `proxy.ts` (not `middleware.ts`), server components + server actions, plain forms | Locked stack; `@supabase/ssr` in the Next server is one of the two allowed frontend→Supabase exceptions |
| API framework | Hono 4.13 on `@hono/node-server`, `@hono/zod-openapi` routes, `AppType` exported for `hc<AppType>()` | Locked stack; Zod 4 schemas shared through `@rede-social/contracts` |
| Data layer | Supabase Postgres; Drizzle ORM 0.45.2 schema with `pgPolicy(...)` + `.enableRLS()`; `drizzle-kit generate` (prefix `supabase`) → `supabase/migrations`; **only the Supabase CLI applies migrations** (`supabase db reset`/`migration up` locally, `supabase db push` in CI) | Single migration history table; RLS lives next to tables; `enableRLS()` is the 0.45.2 API (research correction) |
| Tenant lane | `api_user` (LOGIN, NOBYPASSRLS, NOINHERIT) through the Supavisor **transaction** pooler (port 6543, `prepare: false`); every tenant request runs inside `withTenantTx`: `set_config('request.jwt.claims', …, true)` + `SET LOCAL ROLE authenticated`; admin lane `withAdminTx` = `SET LOCAL ROLE service_role` (kernel-only import) | TENANT-03 defense in depth; Supavisor discards session state per transaction; fallback is a **config switch** to the session pooler (port 5432) with identical code |
| Identity vs membership | `public.users` mirrors `auth.users`; `memberships (tenant_id, user_id, role, status)` is the tenant-scoping noun; V1 one-membership-per-user via droppable unique index `memberships_one_tenant_per_user_v1`; `platform_admins` separate | ROLE-01/02; V2 multi-tenancy = drop one index |
| Tenant addressing (custom domains, added 2026-09-11) | Every tenant is served on its own domain: `tenant_domains (tenant_id, host citext unique, is_primary, verified_at)`; `apps/web/proxy.ts` classifies the host as `tenant` / `platform` (`PLATFORM_HOST`) / `generic` (localhost, `*.vercel.app`, unregistered) through a cached `GET /v1/public/tenants/by-host`; the host only selects the public shell and the sign-up slug; the BFF forwards `x-tenant-host` and the API re-resolves it — membership tenant ≠ host tenant → `403 TENANT_HOST_MISMATCH` (web: sign out + "Este endereço não pertence à sua comunidade."); the platform domain serves `super_admin` only; generic hosts keep the `/cadastro/{slug}` + `tenant_slug` cookie fallback; seed tenants get platform-owned hosts from env; customer domains are attached from the platform panel in Phase 2 | TENANT-01 (reworded), D-20..D-24; membership stays the authority — the host can deny, never select data |
| Auth verification | `jose` `createRemoteJWKSet` against Supabase JWKS (ES256 signing keys; local stack uses `supabase gen signing-key`); membership row read **per request** via `app.membership_for_user()` (security definer), never cached; blocked → `403 MEMBERSHIP_BLOCKED` | AUTH-06, D-09; no Custom Access Token Hook in V1 |
| Session | `@supabase/ssr` HttpOnly cookies written by `proxy.ts` (`getClaims()`), 1 h access token + rotating refresh token, `signOut({ scope: 'local' })` | AUTH-02/05, D-05, D-08 |
| Sign-up | `POST /v1/public/signup/:slug` (API admin lane: `auth.admin.createUser` autoconfirmed → membership + 2 consent rows in one transaction, compensation on failure) then `signInWithPassword` in the web server | AUTH-01/04, D-02/03/04 |
| Module registry | `tenant_modules` rows (never booleans) + `MODULE_REGISTRY` manifests; `requireModule(key)` → `404 MODULE_DISABLED`; `/me/bootstrap` returns enabled modules in nav order | ROLE-06, D-16/17/19 |
| Jobs / events | pg-boss 12 in the `pgboss` schema (schema via custom migration, `migrate: false`), transactional enqueue with `fromDrizzle(tx, sql)`; typed in-process event bus dispatched after commit | Discretion; no Redis in V1 |
| Error envelope | `{ error: { code, message, details?, requestId } }`, `code ∈ ERROR_CODES` in `@rede-social/contracts` | D-09 contract for every later client screen |
| Deployment target | Web → Vercel Git integration (Preview per PR, Production on `main`); API + worker → Cloud Run `southamerica-east1` via GitHub Actions + WIF; Supabase `rede-social-staging` / `rede-social-prod` (`sa-east-1`) | PWA-04, D-11/12/15 |
| Lint / boundaries | Biome 2.5 (+ `noRestrictedImports` patterns) + `turbo boundaries` tags (`kernel`, `contracts`, `module`, `app`, `tooling`); package `exports` expose only published entry points | MOD-02; TS 7 has no JS compiler API, so no typescript-eslint |
| Tests | Vitest 5 (unit + in-process API integration against the local stack), pgTAP via `supabase test db`, Playwright 1.63 on `devices['iPhone 14']` | TENANT-05 exit gate re-run by every later phase |
| UI in this phase | Plain accessible forms, pt-BR copy from a `next-intl` catalog; no design-system work (visual port is Phase 2) | ROADMAP note; UI gate treated as false positive |

## Stack Touched in Phase 1

- [x] Project scaffold (pnpm/Turborepo/Biome/TS 7/Vitest 5, Supabase local stack) — plan 01-01; the `apps/web` Next.js package is scaffolded in plan 01-02 (moved for context budget, same tags/rules)
- [x] Routing — `/v1/health`, `/v1/me/bootstrap`, `/v1/public/*` (incl. `tenants/by-host`), `/v1/example/*`, `/v1/platform/*`; web `/entrar`, `/cadastro` (tenant hosts) + `/cadastro/[slug]` (generic hosts), `/esqueci-senha`, `/redefinir-senha`, `/acesso-suspenso`, `/endereco-invalido`, `/inicio` (tenant view on tenant/generic hosts; platform placeholder on `PLATFORM_HOST`)
- [x] Database — real read (bootstrap through the RLS lane) AND real write (sign-up membership + consents; example item POST; pg-boss job row)
- [x] UI — login form, sign-up form with two consent checkboxes, "Sair" button, example widget form on `/inicio`
- [x] Deployment — Vercel Preview + Cloud Run `api-staging`/`worker-staging` on every PR; `main` → production behind the `production` approval gate; production domains on Vercel: platform host + two seed tenant hosts (CNAMEs added at the 01-11 checkpoint); local full-stack command: `pnpm supabase start && pnpm db:reset && pnpm db:seed && pnpm --filter @rede-social/api dev & pnpm --filter @rede-social/web dev`, then open `http://rede-demo.localhost:3000` (tenant), `http://rede-social.localhost:3000` (platform) or `http://localhost:3000` (generic fallback)

## Out of Scope (Deferred to Later Slices)

- Attaching a customer's own domain from the platform panel — Vercel Domains REST API, allow-list update, CNAME instructions, verification polling (Phase 2, TENANT-07; runbook documented in `docs/DEPLOY.md` by 01-11); `super_admin` access on tenant domains (Phase 2)
- Branded shell, theme variables, per-tenant manifest/icons, prototype component port, platform panel (Phase 2)
- Media uploads, profiles, member directory (Phase 3); feed/communities/stories/events (Phases 4–6)
- Realtime, notifications, Web Push, support chat (Phase 7) — only table stubs exist
- Moderation UI, branding editor, member/role management (Phase 8)
- E-mail confirmation toggle, phone field, OTP recovery, module generator, login rate limiting beyond Supabase defaults, tenant-branded e-mails, "Sair de todos os aparelhos" (CONTEXT.md Deferred Ideas)
- Browser→API direct calls and CORS policy (all API calls are server-side in Phase 1)

## Subsequent Slice Plan

- Phase 2: member sees their tenant's brand server-rendered in an installable shell; super_admin provisions a tenant from the platform panel
- Phase 3: member uploads a profile photo through the signed-upload broker and finds other members
- Phase 4: admin publishes rich posts; members like/comment/share (replaces `@rede-social/module-example`)
- Phase 5: communities and 24 h stories
- Phase 6: events with RSVP/check-in
- Phase 7: notifications, Web Push, support chat over Supabase Broadcast
- Phase 8: moderation, tenant admin panel, pilot go-live gate
