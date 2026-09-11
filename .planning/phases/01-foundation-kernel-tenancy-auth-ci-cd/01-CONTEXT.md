# Phase 1: Foundation - Kernel, Tenancy, Auth & CI/CD - Context

**Gathered:** 2026-09-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 delivers the platform foundation and ends with a real login against a real tenant on deployed staging and production stacks:

- Monorepo (pnpm + Turborepo) with a kernel package, a real throwaway example module, and lint/dependency rules that fail the build when a module imports another module's internals (MOD-01, MOD-02).
- Core schema with `tenant_id` on every tenant-owned row, RLS on every table, `memberships` (identity != membership), `platform_admins`, `tenant_modules`, `consent_records`, chat + notification table stubs, and a "schema conventions" doc (TENANT-03, ROLE-01, ROLE-02).
- API tenant lane: per-request transaction under a non-service role with `set_config` + `SET LOCAL ROLE authenticated`; separate admin lane; JWKS (ES256) verification with per-request membership/status check so a blocked member is cut off on the next request (AUTH-06, TENANT-01).
- Module registry + `requireModule` guard (404 when disabled) and `GET /me/bootstrap` (ROLE-06).
- Auth flows: public sign-up link per tenant with rules + terms acceptance, login, persistent session, password recovery, logout (AUTH-01..05).
- Two-tenant isolation suite (pgTAP + API integration tests) as the exit gate (TENANT-05).
- GitHub -> Vercel (web) and GitHub Actions -> Cloud Run (API + worker) with preview/staging and production, two Supabase projects, migrations applied only by CI (PWA-04).

Out of this phase: branded shell/theme, platform panel, media, profiles UI, any content module. Auth screens are functional-minimal (plain forms); their visual port lands in Phase 2.

</domain>

<decisions>
## Implementation Decisions

### Sign-up link and consent
- **D-01:** Public sign-up link is `/cadastro/{slug}` (e.g. `app.seusistema.com/cadastro/igor-alves`). Login lives at `/entrar` with no slug. All public auth routes use pt-BR paths (`/entrar`, `/cadastro/{slug}`, `/esqueci-senha`, `/redefinir-senha`). — **Reversibility:** costly — once the pilot tenant shares its link on WhatsApp, changing the URL shape requires permanent redirects.
- **D-02:** Sign-up form collects **name, e-mail, password** only. No username (not in the data model), no confirm-password field (use a show-password toggle instead). Photo and bio are collected in the Phase 3 first-access nudge, not here.
- **D-03:** Consent is **two separate checkboxes**: (a) "Li e aceito as regras da comunidade {tenant}" opening a bottom sheet with the tenant's rules text; (b) "Aceito os Termos de Uso e a Política de Privacidade da TRIA". Each acceptance is recorded in a `consent_records` table with `tenant_id`, `user_id`, `kind` (`tenant_rules` | `tria_terms`), `text_version`, `accepted_at`, `ip`. TRIA terms/privacy text lives as versioned markdown in the repo; tenant rules live in a column on `tenants` (`rules_text`, `rules_version`), editable by `admin_tenant` in Phase 8. — **Reversibility:** one-way — consent records are LGPD evidence; the table shape and versioning must be right from the first real sign-up.
- **D-04:** **No e-mail confirmation** in the pilot: Supabase autoconfirm on, the user is signed in immediately after sign-up. E-mail confirmation becomes a per-tenant toggle later (deferred). If the e-mail already exists in `auth.users` (same or other tenant), the API answers with a generic pt-BR message "Este e-mail já está cadastrado. Entre com sua senha." plus a link to `/entrar`; a cross-tenant duplicate is logged internally as a V2 multi-tenant signal. V1 keeps one membership per user (ROLE-02).

### Session, login, logout and blocking
- **D-05:** Session is **indefinite while the app is used**: 1 h access token refreshed by a non-expiring refresh token (Supabase defaults, no inactivity time-box). Blocking still takes effect immediately because the API checks membership status on every request.
- **D-06:** Tenant memory across the register -> login round-trip uses a **`tenant_slug` cookie** (1 year) set when `/cadastro/{slug}` is visited. `/entrar` reads it only to show the tenant's display name and to point "Criar conta" back to the correct slug. The real tenant is always resolved from the membership after login, never from the cookie or hostname.
- **D-07:** After login the user lands on **`/inicio`**, a placeholder page that renders `/me/bootstrap` (tenant name, role, enabled modules) and a "Sair" button. Phase 2 replaces it with `/feed` inside the branded shell.
- **D-08:** "Sair" signs out **this device only** (Supabase `signOut({ scope: 'local' })`); phone and desktop sessions are independent.
- **D-09:** A blocked member receives **HTTP 403 with error code `MEMBERSHIP_BLOCKED`** on the next API request; the web app clears the session and shows a pt-BR "acesso suspenso" screen naming the tenant ("Seu acesso a {tenant} foi suspenso. Fale com a equipe.") with no reason details. A later login attempt lands on the same screen. — **Reversibility:** costly — the error code is part of the API contract consumed by every client screen from Phase 2 on.
- **D-10:** Password recovery: `/esqueci-senha` always answers "Se existir uma conta com este e-mail, enviamos um link" (no account enumeration). The e-mail link opens `/redefinir-senha`, which sets the new password and signs the user in. Password policy: **minimum 8 characters**, no symbol/case rules, simple strength indicator; same rule at sign-up.

### Environments, branches, seed and e-mail
- **D-11:** Branch model: rename `master` -> **`main`** and create the repository under the `tria-company` GitHub organisation. **`main` = production**; **every PR = Vercel Preview + Cloud Run `api-staging` / `worker-staging`** pointing at the staging Supabase project. Only `main` and PR branches exist.
- **D-12:** Production deploy after merge to `main`: Vercel publishes the web app automatically; the GCP workflow runs lint/typecheck/tests/pgTAP, then pauses at a `migrate-and-deploy-prod` job behind a GitHub Environment named `production` requiring **one manual approval**. Order inside the job: Supabase migrations -> API -> worker.
- **D-13:** Outbound auth e-mails (recovery, and confirmation once enabled) go through **Resend configured as Supabase Custom SMTP** on both projects (free tier, verified sending subdomain such as `mail.seusistema.com`, credentials in secrets / `config.toml`). Templates are neutral TRIA in this phase; tenant-branded e-mails are Phase 2. Rationale: Supabase's built-in SMTP only delivers to project team members and is rate-limited, so recovery would not work for real members.
- **D-14:** Tenants and the platform admin are created by an **idempotent TypeScript seed script** (`pnpm db:seed`): tenant `tria-demo` (pilot stand-in) and tenant `tria-lab` (isolation counterpart), one `admin_tenant` and one `member` in each, plus the `super_admin` from `SUPER_ADMIN_EMAIL` (ferramentas@triacompany.com.br) with an initial password from env. Runs automatically for local and staging; for production it is run once through a manual `workflow_dispatch`. Passwords and e-mails never live in migrations or git.
- **D-15:** Regions and naming (accepted defaults): GCP `southamerica-east1`, Supabase `sa-east-1`; projects named `rede-social-staging` and `rede-social-prod`; staging web URL is the Vercel Preview URL. Secrets in GCP Secret Manager (API/worker) and Vercel env (web, publishable keys only); WIF, no JSON keys.

### Module registry and kernel
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` §"Phase 1: Foundation - Kernel, Tenancy, Auth & CI/CD" — goal, success criteria, research-needed list, notes (auth UI functional-minimal, stubs, seed by script)
- `.planning/REQUIREMENTS.md` — TENANT-01, TENANT-03, TENANT-05, MOD-01, MOD-02, ROLE-01, ROLE-02, ROLE-06, AUTH-01..AUTH-06, PWA-04 (exact wording)
- `.planning/PROJECT.md` §Constraints and §Key Decisions — locked stack, the two Supabase-direct exceptions, identity != membership, Free plan

### Architecture and schema
- `.planning/research/ARCHITECTURE.md` §Pattern 1 (RLS through the API's own connection, two lanes), §Pattern 2 (identity global, membership per tenant, SQL sketch), §Pattern 3 (module registry + `tenant_modules` + bootstrap shape), §Pattern 4 (login -> tenant -> theme flow), §Recommended Project Structure, §Suggested Build Order
- `.planning/research/PITFALLS.md` §Pitfall 1 (service role kills RLS), §3 (global `auth.users`, duplicate e-mail), §4 (JWT verification), §9 (V2-safe schema conventions), §12 (over/under-modularisation), §13 (CI/CD + environments), §15 (blocking must take effect per request)
- `.planning/research/SUMMARY.md` §"Decisions Requiring User Confirmation" and the secondary resolved points (Hono over Nest/Fastify; skip Custom Access Token Hook in V1; pg-boss worker)

### Stack and tooling
- `.planning/research/STACK.md` — pinned versions, Supavisor `prepare: false`, drizzle-kit -> `supabase/migrations` -> Supabase CLI applies, `api_user` role, WIF deploy, Biome, Vitest 5, pgTAP via `supabase test db`
- `.claude/CLAUDE.md` §Technology Stack — same stack table, "What NOT to Use" list

### Design prototype (visual reference only in this phase)
- `.planning/research/PROTOTYPE.md` §3 Route map and §4 Screen inventory (rows Login / Register / Forgot password / Settings) — what the prototype auth screens contain and lack
- `reference/frontend-design/app/(auth)/login/page.tsx`, `.../register/page.tsx`, `.../forgot-password/page.tsx` — prototype auth screens; Phase 1 ships plain forms, Phase 2 ports the visuals

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- The application repository is empty (only `.planning/`, `.claude/` and the git-ignored prototype clone in `reference/`). Nothing to reuse yet; everything in this phase is greenfield.
- Prototype `components/ui/Input.tsx`, `Button.tsx`, `Toast.tsx` are the primitives the auth screens use. They are **not** ported in Phase 1 (plain forms); Phase 2 ports them into `@tria/ui`.
- Prototype `contexts/AuthContext.tsx` is a `localStorage` mock. Do not port; the real session lives in HttpOnly cookies via `@supabase/ssr`.

### Established Patterns
- Prototype auth routes are `/login`, `/register`, `/forgot-password`; this phase uses pt-BR paths instead (D-01, D-10). Keep the prototype's field order and copy tone ("Entrar", "Esqueceu a senha?", "Criar nova conta") for continuity.
- Prototype register asks for `username`; the model has none (D-02).
- Prototype has no consent UI; D-03 defines it.

### Integration Points
- `apps/web/app/(auth)/*` for public routes, `apps/web/app/(app)/inicio` for the post-login placeholder, `apps/web/proxy.ts` for session refresh + auth gating.
- `apps/api` mounts kernel routes (`/auth/signup` public, `/me/bootstrap`) and `@tria/module-example` routes behind `requireModule`.
- `supabase/migrations` generated from `packages/core/db` and `packages/modules/*/db`; `supabase/config.toml` carries auth settings (autoconfirm on, custom SMTP), local stack config.
- `.github/workflows/`: `ci.yml` (lint, typecheck, test, `supabase test db`), `deploy-api.yml` (WIF -> Artifact Registry -> Cloud Run staging on PR, `production` environment gate on `main`), Vercel Git integration with `turbo-ignore`.

</code_context>

<specifics>
## Specific Ideas

- Sign-up link example the user will share: `app.seusistema.com/cadastro/igor-alves`.
- "Acesso suspenso" screen copy: "Seu acesso a {tenant} foi suspenso. Fale com a equipe." No reason shown.
- Recovery response copy: "Se existir uma conta com este e-mail, enviamos um link."
- Duplicate e-mail copy: "Este e-mail já está cadastrado. Entre com sua senha."
- Seed tenants: `tria-demo` (all modules) and `tria-lab` (feed + events only). Super admin e-mail: ferramentas@triacompany.com.br.
- Two-tenant isolation suite must include: cross-tenant list/detail on the example module, disabled-module 404 on `tria-lab`, blocked member 403 on the very next request, pgTAP checks that every tenant-owned table has `tenant_id` + RLS enabled.

</specifics>

<deferred>
## Deferred Ideas

- Per-tenant toggle for mandatory e-mail confirmation at sign-up — Phase 8 admin panel or V2.
- Phone number field on the profile (WhatsApp contact for admins) — Phase 3 profiles, if the pilot asks.
- 6-digit OTP recovery instead of e-mail link (better inside an installed iOS PWA) — revisit in Phase 7 with the iOS install flow.
- Module generator script (`pnpm gen:module <name>`) — Phase 4 when the second real module is created, if the example module proves insufficient as a template.
- Login rate limiting / brute-force protection beyond Supabase defaults — Phase 8 hardening.
- Tenant-branded auth e-mails (Send Email Hook vs templates) — already scheduled in Phase 2.
- "Sair de todos os aparelhos" option in settings — Phase 8 admin/settings.

</deferred>

---

*Phase: 01-foundation-kernel-tenancy-auth-ci-cd*
*Context gathered: 2026-09-11*
