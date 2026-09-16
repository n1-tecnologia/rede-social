# Phase 2: Tenant Shell, Branding & Platform Panel - Research

**Researched:** 2026-09-14
**Domain:** Multi-tenant white-label shell (Next 16.3 + Tailwind v4 + serwist PWA), platform panel provisioning (Hono API, Drizzle, pg-boss), customer-owned domains (Vercel Domains REST API + Supabase Auth allow-list), branded auth e-mail (Supabase Send Email Hook → Resend)
**Confidence:** MEDIUM (in-repo facts HIGH; external APIs cited from official docs fetched this session; a few hosted-only behaviours ASSUMED because Phase 01.1 has not run)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Tenant branding model
- **D-25:** A tenant's brand is **primary color + secondary color + logo + display name** (+ an optional square app icon, D-28). Everything else is derived: `--brand-on-primary` (white/navy by contrast), hover/tint/shade steps and the CTA gradients via `color-mix`, dark-mode variants (D-41); background, text, border and surface colors stay the neutral design tokens ported from the prototype. `tenants.branding.colors` gets **fixed keys `primary` and `secondary`** (hex); derived values that non-CSS consumers need (e-mail templates, manifest `theme_color`) are persisted alongside at save time. — **Reversibility:** costly — the key names are read by the bootstrap contract, the public by-host brand answer, the manifest route, the e-mail templates and the panel form; renaming them touches every consumer and needs a jsonb backfill.
- **D-26:** The logo is rendered **as-is** (colored PNG/SVG/WebP), never as a tinted monochrome mask; the prototype's `.brand-ig-mark` technique is **not ported**. The shell constrains height (TopBar / rail) and the auth pages show it larger; when a tenant has no logo yet, the display name renders as text in its place.
- **D-27:** Logo/icon upload ships in this phase as a **kernel (platform-lane) capability, not the media module**: the panel asks the API for a signed upload URL, the browser uploads directly to the **public `branding` bucket** under `<tenant_id>/branding/<uuid>.<ext>`, then calls a `complete` endpoint that verifies the object, derives the icon set with `sharp` (D-28) and writes the URLs into `tenants.branding`. Accepted: PNG, SVG, WebP, JPEG; small size cap (order of 2 MB). Phase 3's media pipeline reuses the same signed-upload shape; Phase 8's ADMIN-01 reuses these endpoints under `admin_tenant`. — **Reversibility:** reversible — the bucket layout follows STACK.md §4 and the endpoints are additive.
- **D-28:** Favicon and PWA icons are **derived from the logo by default** — `favicon.ico`, `icon-192.png`, `icon-512.png`, a **maskable** 512 (logo centred inside the safe zone over the primary color) and `apple-touch-icon` 180 — with an **optional square-icon override** the `super_admin` can upload when the logo is horizontal or illegible in a square; the override replaces the whole derived set.
- **Locked by the roadmap (criterion 1):** on a tenant host the public auth pages render the tenant's logo, colors and display name before login. The public by-host answer therefore has to carry the brand (how: Claude's discretion below); it must stay `.strict()` and carry nothing beyond brand fields.

#### Platform panel: tenant creation and first admin
- **D-29:** The first `admin_tenant` joins through a **Supabase invite link + an "aceitar convite" screen**. The API pre-creates the membership (`role = admin_tenant`, `status = invited`) and calls `auth.admin.inviteUserByEmail` with `redirectTo` on the tenant's primary verified host. The link opens a pt-BR page on the tenant domain (path suggestion `/aceitar-convite`) that says "Você foi convidado(a) a administrar {tenant}", sets the password (D-10 policy, min 8) **and records both consents** (tenant rules + TRIA terms — same `consent_records` rows as D-03, AUTH-04 is not skipped for admins), then flips the membership to `active` and lands on `/inicio`. Reuses `/auth/confirm` (token_hash, type `invite`) and the password-setting logic of `/redefinir-senha`. — **Reversibility:** costly — once real invites are sent, the screen path and the consent-at-accept rule are part of every tenant admin's onboarding; changing them invalidates outstanding links and the LGPD evidence shape.
- **D-30:** Invite timing: the admin e-mail is collected at tenant creation and stored as a **pending invite** (suggested `tenant_invites`: `tenant_id`, `email`, `role`, `status pending|sent|accepted|expired`, `sent_at`, `accepted_at`, `created_by`). `inviteUserByEmail` is called **automatically when the tenant's primary domain becomes verified** (D-34) — immediately at creation if a verified primary host already exists (seed tenants, D-24). The panel shows "Convite pendente — aguardando domínio" / "Convite enviado em …" / "Aceito" and always offers **"Reenviar convite"**.
- **D-31:** Creation is a **single "Novo tenant" form → tenant page with tabs**. Form: display name; slug (suggested from the name, editable, **immutable after creation**); primary + secondary hex with a live swatch preview and contrast feedback; module checklist with all six real modules on by default (D-17; `example` is never listed, D-19); first admin e-mail. Submit creates `tenants` + `tenant_modules` + the pending invite and redirects to the tenant page, whose tabs are **Marca** (logo + optional icon upload, colors, live preview of TopBar/login in light and dark), **Módulos** (toggles; effect within the flags-cache TTL, no redeploy), **Domínios** (D-34/D-35), **Admins** (invite state, resend, admin_tenant memberships), **Status** (active/suspended with confirm). Logo upload lives on the tenant page because the storage key needs the `tenant_id`.
- **D-32:** `super_admin` can **suspend and reactivate** a tenant (`tenants.status` already allows `active|suspended`). A suspended tenant refuses member bootstrap/login with a 403 envelope code and a pt-BR screen in the D-09 pattern ("Esta comunidade está temporariamente indisponível."); the public shell still resolves the host so the screen is branded. Exact code and copy: Claude's discretion.
- **D-33:** **UI-04 review pattern (reused by Phases 4-8):** `/gsd-ui-phase 2` produces the UI-SPEC in the prototype's visual language for the screens the prototype lacks (tenant list, new tenant, tenant page tabs, domain attach, accept-invite, settings, desktop shell/rail); a **static HTML mockup** (`/gsd-sketch`) is shared with the design team and **approved before the panel/shell screens are coded**. The plan orders schema, API, domain-provider adapter, e-mail hook and `@tria/ui` primitives first so the approval is not on the critical path, and models the approval as a human-verify checkpoint. The platform panel is **desktop-first but responsive** (tables, forms, side navigation) and lives only on the platform host (D-21).

#### Custom domains
- **D-34:** Attach flow: `super_admin` enters a host (apex or subdomain, `tenant_domains_host_chk` shape) → API validates (registrable, unused, not the platform host) → registers it with the hosting provider (Vercel Domains REST API, project-scoped) → stores the `tenant_domains` row with `verified_at = null` → the panel shows the **DNS records to create** from the provider's answer (CNAME for a subdomain, A record for an apex, plus the TXT ownership challenge when the provider demands one) with copy buttons and status "Aguardando DNS". A **pg-boss job polls verification** (order of every 10 min, up to ~7 days, then "Expirado" with the option to restart) and the panel has **"Verificar agora"** for an on-demand check. On verified: `verified_at` set, host added to that Supabase project's Auth redirect allow-list (Management API), pending admin invite sent (D-30), status "Verificado". Removing a host removes it from the provider and the allow-list. — **Reversibility:** costly — the provider adapter contract and the `tenant_domains` lifecycle (`verified_at`, polling job) are consumed by the invite flow, `proxy.ts` and the seed.
- **D-35:** A tenant may have several verified hosts but **exactly one primary**; **non-primary hosts 308-redirect to the primary** preserving path and query (done in `proxy.ts`; the by-host answer must expose whether the host is primary and which host is). Rationale: PWA installs, session cookies and push subscriptions are per origin — one origin per tenant. The primary can be switched among verified hosts in the panel; the primary cannot be removed while other hosts exist (promote another first).
- **D-36:** **Only verified hosts resolve** in `proxy.ts` / `GET /v1/public/tenants/by-host` (`verified_at is not null`); an unverified host renders the generic shell. Local/dev/CI use a **fake domain-provider adapter** (env-selected) that returns fixed DNS instructions and verifies on the first check, so the whole flow is e2e-testable without Vercel; the seed keeps registering the TRIA-owned hosts as already verified (D-24).

#### Branded auth e-mails
- **D-37:** Auth e-mails are branded through the **Supabase Send Email Hook → API → Resend**: GoTrue calls a signed HTTPS hook on the API for every auth e-mail; the API resolves the tenant from the user's membership (recovery, invite) or, when the user has no membership yet, from the `redirect_to` host via `tenant_domains`; on the platform host / `platform_admins` it uses a neutral TRIA template. Templates (pt-BR) exist for recovery and invite, with a neutral fallback for the other GoTrue types; the API sends through the **Resend HTTP API** (a mail-transport adapter with `resend` and `local` implementations so local dev never sends real mail). Phase 1's `/esqueci-senha` (`resetPasswordForEmail` through `@supabase/ssr`) is **unchanged**. Locally the hook is enabled in `supabase/config.toml` (`[auth.hook.send_email]`). — **Reversibility:** costly — supersedes D-13's SMTP path for auth mail (Custom SMTP stays configured only as the fallback when the hook is disabled); the template engine chosen here is what Phase 7 reuses for notification mail.
- **D-38:** Sender and signature: **From `{tenant displayName} <no-reply@{TRIA sending domain}>`** (the D-13 mail subdomain), pt-BR subject naming the tenant ("Redefina sua senha — {tenant}"), body with the tenant logo (display name as text when there is no logo), a primary-colored CTA with `--brand-on-primary` text, a plain-text alternative, and a **small muted footer "Enviado pela plataforma TRIA"**. No TRIA logo in the body.

#### App shell, navigation, theme, home
- **D-39:** **Desktop = left rail + centred column; mobile = the prototype's TopBar + floating glass BottomNav.** The rail carries the tenant logo on top, the registry nav items with icon + label, and the bell/chat/theme/logout affordances; content sits in a centred column with a max width in the ~640-720 px range on a neutral ground. The iPhone `DeviceShell` mockup is **not shipped**; the shell reproduces the prototype's `--safe-*` / scroll-container contract so fixed sub-headers and composers keep working (PROTOTYPE.md §9 risk 2). Built in `packages/core/ui` as `AppShell` on top of `@tria/ui` primitives.
- **D-40:** Navigation with every module on: **tabs = Início, Comunidades, Eventos, Perfil; TopBar slots = bell (notifications, unread badge) and chat bubble (support, unread badge)**. Tabs come from the registry `nav` entries of *enabled* modules in `order` (`feed` → "Início", `communities`, `events`) plus the kernel's "Perfil" always last; `notifications` and `chat` declare a TopBar placement instead of a tab (manifest shape: Claude's discretion); `stories` has no nav entry (it is a strip on Início from Phase 5). A disabled module's tab/slot disappears. In this phase only the kernel entries render (Início, Perfil); module tabs appear as their modules ship. The notifications icon is `Bell`, not the prototype's `Heart`.
- **D-41:** **Light + dark with a user toggle.** Default light; the toggle lives on the settings page; the preference is persisted per device in a way the server can read (cookie) so `data-theme` is rendered on the first HTML with no flash; the prototype's two-layer token model (`--theme-*` raw → `--color-*` aliases re-declared under `[data-theme]`) is kept. The tenant's primary color gets an **automatically derived dark-surface variant** (`color-mix` towards white, tuned) and the branding save validates contrast **in both modes**; the panel preview shows both.
- **D-42:** **Home is a kernel page at `/inicio`** (tab "Início", first). In this phase it shows a branded welcome ("Bem-vindo(a) à {tenant}", logo) and an `EmptyState` "Em breve". The registry gains a **home-slot concept** so later modules register widgets in order (stories strip, feed list) and the home still renders the remaining widgets when `feed` is off. **Amends D-07:** the post-login path stays `/inicio` (not `/feed`); whether the feed module also owns `/feed` for deep links is the Phase 4 planner's call. A minimal **settings page** (`/configuracoes`) holds the theme toggle and "Sair" (D-08) with placeholder rows for profile edit (Phase 3) and push (Phase 7).
- **PWA (locked by the roadmap; details Claude's):** per-tenant manifest from a `no-store` route handler (name/short_name = display name, `theme_color` = primary, `background_color` = neutral bg, icons from D-28, `display: standalone`, `start_url`/`scope` = `/`, `id` per tenant), serwist service worker via `@serwist/turbopack`, pt-BR offline fallback page; the iOS "Adicionar à Tela de Início" hint component is built and left unmounted until Phase 7 (PWA-02).

### Claude's Discretion
- How the public by-host answer exposes the brand (extend `hostTenantSchema` with a `branding` object vs a sibling public route) and how `proxy.ts` / the auth layout receive it (headers are size-limited — probably a second cached fetch in the layout keyed by host); cache TTLs and a cache bust when branding changes so a new logo appears within minutes.
- Domain-provider adapter interface (`addDomain`, `getDnsRecords`, `verify`, `removeDomain`), the Supabase Management API call for the allow-list, secret placement (Vercel token, project id, Supabase PAT in Secret Manager), the TXT ownership-challenge handling, polling cadence/backoff and job idempotency. Phase 01.1 has not run: the real adapter is written now and proven only against the fake locally; the hosted proof is recorded as an item for the 01.1 runbook.
- Send-email hook path, signature verification, template engine (React Email vs plain HTML strings), the `local` mail transport (log / dev inbox), and how derived brand colors reach the templates (persisted at save time — CSS `color-mix` is unavailable in e-mail).
- Registry extensions (`nav.placement`, home slots, settings rows), `@tria/ui` layout (`tokens.css`, `@theme inline`, `cn`, hooks) and which prototype primitives beyond UI-01's list are ported now (PROTOTYPE.md §9 A2-A6): port what this phase's screens need, the rest lazily per phase.
- Contrast algorithm (WCAG 2.x vs APCA) and thresholds; on failure the panel should warn and require explicit confirmation rather than block.
- Suspended-tenant envelope code and screen copy (D-09 pattern); platform panel URL space (suggestion `/plataforma/*`), list search/filters/pagination.
- Service-worker caching strategy, offline page, update prompt; theme cookie name; invite-link expiry (Supabase default) and what an expired link shows.
- pt-BR catalog organisation: keep the single next-intl catalog, namespaced per kernel area / module.
- Test strategy: extend the two-tenant Playwright smoke to assert brand isolation (A's brand never on B's host, no default-brand flash), a build-output check that no authenticated route is static, and e2e for attach-domain (fake provider) → verified → invite → accept.

### Deferred Ideas (OUT OF SCOPE)
- `admin_tenant` editing the brand from inside the app (ADMIN-01) — Phase 8; this phase's branding endpoints and preview component are built to be reused there.
- Android install prompt (`beforeinstallprompt`) UX and iOS install-hint wiring — Phase 7 with push (PWA-02); the hint component is built here.
- E-mail notifications beyond auth (digests) — Phase 7 reuses the D-37 template engine and transport.
- Per-tenant sending domain for e-mails (tenant's own `no-reply@cliente.com.br`) — V2; needs per-tenant Resend domain verification.
- `super_admin` "view as tenant" / impersonation to preview a tenant's app — not in scope; the panel's live preview covers branding.
- Vercel domain-verified webhook instead of polling — revisit if the API exists and polling proves noisy.
- Multiple admins invited at creation, invite expiry customisation, tenant deletion/archival — Phase 8 hardening or V2.
- "Sair de todos os aparelhos", per-tenant e-mail confirmation toggle, OTP recovery — still deferred from Phase 1.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description (REQUIREMENTS.md) | Research Support |
|----|-------------|------------------|
| TENANT-02 | Each tenant has branding (logo, primary/secondary colors, favicon, display name) applied to the whole app shell after login, server-rendered so the user never sees another brand or a default brand flash | Patterns 1–3 (by-host brand contract, `@theme inline` brand vars rendered on `<html>`, theme cookie), Pitfalls 1–3, Validation (two-tenant smoke + no-static check) |
| TENANT-06 | Authentication e-mails (password recovery, confirmation) sent with the tenant's display name and logo | Pattern 6 (Send Email Hook → API → Resend), plain-HTML template decision, local transport = Mailpit HTTP API |
| TENANT-07 | `super_admin` attaches a custom domain; platform registers it with the hosting provider and the auth redirect allow-list, shows DNS records, reports verification status | Pattern 5 (Vercel Domains REST endpoints, `DomainProvider` adapter + fake, `domain-verify` kernel job, Supabase Management API `uri_allow_list`) |
| MOD-04 | Module registry declares routes, nav, flag key, events; API mounts and app renders only registered, enabled modules | Pattern 8 (registry extensions: `nav.placement`, `home` slots, `settings` rows; `modules[].nav` already in bootstrap; flags cache invalidation on toggle) |
| ROLE-03 | `super_admin` creates a tenant: name, slug, initial branding, enabled modules, first `admin_tenant` by e-mail invitation | Pattern 4 (platform routes in `apps/api/src/routes/platform.ts` + `packages/core/server/platform/*`), Pattern 7 (invite flow, `tenant_invites`) |
| ROLE-04 | `super_admin` enables/disables modules per tenant; reflected in navigation and API access without redeploy | `moduleFlags.invalidate(tenantId)` exists (`flags-cache.ts:82-84`); 30 s TTL on other instances; `requireModule` already answers 404 |
| ROLE-05 | `super_admin` lists all tenants with status and opens any tenant's settings | `platformTenantsSchema` + `listPlatformTenants()` exist; add `GET /v1/platform/tenants/{id}` detail contract |
| UI-01 | Visual language follows the prototype; shared primitives ported into the kernel shared-UI package | Pattern 2 (`@tria/ui` tokens.css + primitives), prototype inventory (PROTOTYPE.md §5), Tailwind v4 install (web has **no CSS/Tailwind today**) |
| UI-03 | Hardcoded brand replaced by tenant theme variables, display name and flag-driven navigation; real responsive shell with desktop layout | Pattern 2/3 (`--brand-*` vars, `color-mix` derivations), Pattern 8 (registry nav), `AppShell` in `packages/core/ui` |
| UI-04 | Screens the prototype lacks designed in its language and reviewed with the design team | D-33 review gate modelled as `checkpoint:human-verify`; ordering so approval is off the critical path |
| PWA-01 | Mobile-first, responsive on desktop, installable (manifest + service worker), standalone mode | Pattern 9 (`@serwist/turbopack` route + `app/sw.ts`, per-tenant `manifest.webmanifest` route handler, `sharp` icon derivation, `generateViewport` theme-color) |
| PWA-03 | All UI text pt-BR and centralised in a message catalog | next-intl single catalog (`apps/web/messages/pt-BR.json`) with new namespaces `shell`, `settings`, `home`, `invite`, `platform.*`, `offline`, `tenantSuspended` |
</phase_requirements>

## Summary

Phase 2 is mostly *integration* work on top of a Phase 1 kernel that already has the right seams: `hostTenantSchema` + the bounded host caches on both tiers, `tenants.branding` jsonb, `tenant_domains` with `is_primary`/`verified_at`, `memberships.status = 'invited'`, `moduleFlags.invalidate()`, `withAdminTx` confined to `packages/core/server/{tenancy,platform}`, the platform `OpenAPIHono<PlatformEnv>` group, `/auth/confirm` accepting `type=invite`, pg-boss with `short` queue policy, and Mailpit + two-tenant Playwright fixtures. Three facts discovered in the codebase change how the plan must be shaped: (1) **`apps/web` has no CSS at all** — no Tailwind, no `globals.css`, no `postcss.config` — so Tailwind v4 + `@tailwindcss/postcss` and the token layer are a Wave-0 prerequisite for every screen; (2) **`cacheComponents` is not enabled** in `next.config.ts` and the current build already renders every authenticated route dynamically (`.turbo/turbo-build.log`), so the STACK.md §6 `"use cache" + cacheTag` idea should **not** be adopted here — on Vercel the default in-memory `use cache` handler does not even persist across invocations, and enabling Cache Components mid-project is a rendering-model change Phase 1 did not budget for; the bounded TTL caches plus the per-request bootstrap already give the right semantics; (3) `require-auth.ts:57` folds a suspended tenant into `MEMBERSHIP_BLOCKED` and `resolveTenantHost` filters `tenants.status = 'active'`, both of which D-32 needs split so the suspended screen can be branded.

Externally, the four "research needed" items resolved cleanly against official docs: the Vercel flow is `POST /v10/projects/{idOrName}/domains` → `GET /v6/domains/{domain}/config` (the DNS instructions — CNAME targets are now **per-project** like `d1d4fc829fe7bc7c.vercel-dns-017.com`, never hardcode `cname.vercel-dns.com`) → `POST /v9/projects/{idOrName}/domains/{domain}/verify` (only needed when `verified: false`, i.e. the TXT `_vercel` ownership challenge) → `DELETE /v9/...`; "verified" for our purposes means `verified === true` **and** `misconfigured === false`. The Supabase allow-list is `PATCH /v1/projects/{ref}/config/auth` with `uri_allow_list` as a comma-separated string (read-modify-write). The Send Email Hook is a standard-webhooks-signed HTTP POST with a **5 s total budget including retries**, `{ user, email_data: { token_hash, redirect_to, email_action_type, … } }`, answered with `200 {}`; `react-email` v6 is a CLI-sized dependency (socket.io, esbuild, tailwind, babel) and `@react-email/components` is deprecated, so templates are plain, escaped HTML strings. `@serwist/turbopack` 9.5.12 is a three-file setup (`withSerwist`, `app/serwist/[path]/route.ts` with `createSerwistRoute`, `app/sw.ts`) registered through `<SerwistProvider swUrl="/serwist/sw.js">`.

**Primary recommendation:** Build bottom-up in this order — (1) Tailwind v4 + `@tria/ui` tokens/primitives + `AppShell`; (2) schema additions (`tenant_invites`, `tenant_domains` verification columns, branding jsonb keys, `branding` bucket) + `TENANT_SUSPENDED` split; (3) platform API (tenant CRUD, modules, branding upload/complete, domains with `DomainProvider` fake+vercel, invites) + `domain-verify` kernel job; (4) send-email hook route + mail transport; (5) web shell/auth pages/manifest/SW; (6) panel screens **after** the D-33 mockup approval checkpoint; (7) validation suite. Do not enable `cacheComponents`; do not use `react-email`; do not hardcode Vercel DNS values.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Brand resolution by host (public pages, manifest) | Frontend Server (Next `proxy.ts` + layouts) | API (`GET /v1/public/tenants/by-host`) | Host selects the public shell (D-20/D-23); the API is the only reader of `tenant_domains` |
| Brand inside the authenticated shell | Frontend Server (`(app)/layout.tsx` from `/me/bootstrap`) | API | Membership is the authority; bootstrap already carries `tenant.branding` |
| Brand CSS variables, dark theme, `theme-color` | Frontend Server (SSR of `<html style data-theme>`, `generateViewport`) | Browser (toggle writes cookie) | "No flash" is only achievable server-side; the browser just persists the preference |
| Contrast validation + derived colors | API (on branding save, persisted) | Browser (live preview) | Persisted derivations feed e-mail + manifest; the preview reuses the same pure function from `@tria/contracts` |
| Logo/icon upload | Browser → Supabase Storage (signed PUT) | API (issue signed URL, `complete`, `sharp` derivation) | Uploads never pass through Cloud Run (CLAUDE.md); derivation is CPU work that belongs in the API |
| Tenant CRUD, modules, invites, suspend | API (`/v1/platform/*`, `packages/core/server/platform/*`) | Database (RLS, admin lane) | Cross-tenant writes live only behind `requireSuperAdmin()` + `withAdminTx` |
| Custom-domain registration + verification polling | API (`DomainProvider` adapter) + Worker (`domain-verify` pg-boss job) | External (Vercel REST, Supabase Management API) | Secrets stay in Secret Manager on Cloud Run; polling is a background job, not a request |
| Non-primary host 308 redirect | Frontend Server (`proxy.ts`) | API (by-host answer exposes `primaryHost`) | Redirect before any render; per-origin PWA/cookies (D-35) |
| Branded auth e-mails | API (hook route, templates, transport) | External (GoTrue calls the hook; Resend sends) | GoTrue owns tokens; the API owns tenant resolution and branding |
| Accept-invite screen | Frontend Server (Route Handler `/auth/confirm` + server action) | API (`POST /v1/me/accept-invite` flips membership + consents) | Only a Route Handler may set session cookies; membership writes stay in the admin lane |
| PWA manifest, icons, service worker | Frontend Server (route handlers, `no-store`) | CDN/Storage (icons in public `branding` bucket) | Manifest must vary by host; icons are static public objects |

## Project Constraints (from CLAUDE.md)

- Next.js on Vercel (16.3.x; repo has **16.3.5** installed — plan 01-02 truth), API Hono on Cloud Run, Supabase (Free plan for the pilot: 50 MB per file, no image transforms → icon derivation happens in the API with `sharp`), GitHub → Vercel/GCP deploys.
- Frontend talks to Supabase directly only for Auth (`@supabase/ssr`) and read-only Realtime; **everything else through the API**. The browser PUT to a *signed* Storage upload URL is the same shape STACK.md §4 already blesses (signed direct-to-Storage), not a new exception — the URL is minted by the API.
- **No uploads through Cloud Run** (32 MiB body cap); **no `service_role`/`postgres` role for tenant queries**; `withAdminTx` only in `packages/core/server/{tenancy,platform}` and `scripts/` (Biome `noRestrictedImports`, `biome.json:46-47,84-85,131-132`).
- `@serwist/turbopack`, never `next-pwa`; `proxy.ts`, never `middleware.ts`; no `beforeinstallprompt`-only install UX; `images.remotePatterns` not `images.domains`.
- Modules are self-contained packages depending only on the kernel and published contracts; the kernel never imports a module (turbo boundaries `kernel: deny [module, app]`); registry composition only in `apps/api/src/modules/registry.ts` (+ a web-side composition point).
- Design follows `reference/frontend-design/` (port, never refactor in place); pt-BR UI.
- Pinned versions: Tailwind 4.3.3, shadcn 4.21.0 (optional), sharp 0.35.4, `@serwist/turbopack`/`serwist` 9.5.12, esbuild 0.28.2, TypeScript 7.0.2 (Biome, not typescript-eslint), Vitest 5, Playwright 1.63, pgTAP via `supabase test db`.
- Migrations: Drizzle schema → `pnpm db:generate` → `supabase/migrations` → Supabase CLI applies; hand-written SQL via `supabase migration new --custom`; `tenant_id` first in every index; new tables get RLS + select-only tenant policy unless admin-lane-only.
- Secrets: Vercel token/project id/team id, Supabase PAT, Resend key, hook secret → GCP Secret Manager mounted into Cloud Run (only publishable keys on Vercel).

## Standard Stack

### Core (new in this phase)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `tailwindcss` + `@tailwindcss/postcss` | 4.3.3 / 4.3.3 | Utility CSS; `@theme inline` binds `--color-brand-*` to runtime `--brand-*` vars | CLAUDE.md pin; the prototype is Tailwind v4 (`@import "tailwindcss"`, `@theme`). `[VERIFIED: npm registry]` 4.3.3 published 2026-09-08 |
| `@serwist/turbopack` + `serwist` + `esbuild` (dev) | 9.5.12 / 9.5.12 / 0.28.2 | Service worker build under Turbopack, precache + runtime caching, offline fallback | CLAUDE.md pin; peer `next >=14`, `esbuild >=0.25 <1`, `typescript >=5`. `[VERIFIED: npm registry]` |
| `sharp` | 0.35.4 | Derive favicon/192/512/maskable/apple-touch PNGs from the uploaded logo (API) | CLAUDE.md pin; `engines.node >=20.9`. `[VERIFIED: npm registry]` |
| `png-to-ico` | 3.0.2 | Wrap the 32/48 px PNGs into `favicon.ico` (sharp cannot emit ICO) | 336k downloads/wk, steambap/png-to-ico, pure JS (`pngjs`). `[VERIFIED: npm registry]` (seam verdict OK) |
| `resend` | 6.28.0 | Resend HTTP API client (`emails.send({ from, to, subject, html, text })`) | Official SDK; `@react-email/render` peer is **optional** (`peerDependenciesMeta`), so no React needed in the API. `[VERIFIED: npm registry]` |
| `standardwebhooks` | 1.1.1 | Verify the Send Email Hook signature (`new Webhook(secret).verify(rawBody, headers)`) | The exact library Supabase's hook docs use; `resend` itself depends on 1.0.0. `[VERIFIED: npm registry]` |
| `lucide-react` | 1.46.0 | Icons (prototype uses lucide; D-40 `Bell`) | CLAUDE.md lists it (1.45.0 → 1.46.0 published 2026-09-14). `[VERIFIED: npm registry]` |
| `clsx` + `tailwind-merge` | 2.1.1 / 3.7.0 | `cn()` helper (prototype `lib/utils.ts`) | CLAUDE.md lists both. `[VERIFIED: npm registry]` |
| `motion` (import `motion/react`) | 13.3.0 | `BottomSheet`/`ConfirmDialog`/`Toast` springs the prototype implements with `framer-motion` | `framer-motion` is the legacy name of the same package (both 13.3.0, same repo); prefer `motion`. `[VERIFIED: npm registry]` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `class-variance-authority` | 0.7.1 | `Button` variants (`brand`, `secondary`, `outline`, `ghost`, `danger`) | Only if the port keeps shadcn-style variant maps; otherwise a plain object map is fine |
| `@vercel/sdk` | 1.28.32 | Typed Vercel REST client | **Not recommended**: five endpoints via `fetch` + Zod keep the adapter tiny and the fake trivially symmetric; SDK is an alternative (see below) |
| `zod` (existing 4.6.2) | — | Vercel/Supabase response schemas, branding/domain/invite contracts | Always |
| `@tanstack/react-query` 5.102.8, `zustand` 5.0.15 | — | Listed in CLAUDE.md; **not needed this phase** — panel forms are server actions + `useActionState`; defer to Phase 4 | — |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Plain HTML string templates | `react-email` 6.9.5 (`@react-email/components` is **deprecated**) | react-email v6 drags `socket.io`, `esbuild`, `tailwindcss`, `@babel/*`, `prismjs` into the API's runtime deps and needs React in `apps/api` (which has none). Two templates + a fallback do not justify it. `[VERIFIED: npm registry]` deps list |
| `fetch` + Zod for Vercel | `@vercel/sdk` | SDK adds ~1 MB and its own error types; the fake adapter must mirror *our* interface anyway |
| `png-to-ico` | Serve only PNG favicons (`<link rel="icon" type="image/png">`) | D-28 names `favicon.ico`; PNG-only would satisfy modern browsers but not the locked wording |
| WCAG 2.x contrast | APCA (`apca-w3` 0.1.9, last published 2022) | APCA is not normative (WCAG 3 draft removed it in 2023); WCAG 2.2 AA is the legal benchmark |
| `@serwist/turbopack` | `@serwist/next` | webpack-only; Next 16 builds with Turbopack |
| Mailpit HTTP `local` transport | `nodemailer` → Mailpit SMTP :54325 | Extra dependency and a config.toml port; Mailpit's `POST /api/v1/send` was probed this session and answers 200 |

**Installation:**
```bash
# apps/web
pnpm --filter @tria/web add tailwindcss@4.3.3 @tailwindcss/postcss@4.3.3 @serwist/turbopack@9.5.12 serwist@9.5.12 lucide-react@1.46.0 clsx@2.1.1 tailwind-merge@3.7.0 motion@13.3.0 @tria/ui@workspace:* @tria/core@workspace:*
pnpm --filter @tria/web add -D esbuild@0.28.2
# packages/ui (peer react; tokens.css + primitives)
pnpm --filter @tria/ui add clsx@2.1.1 tailwind-merge@3.7.0 lucide-react@1.46.0 motion@13.3.0 && pnpm --filter @tria/ui add -D react@19.3.0 @types/react@19.3.0 tailwindcss@4.3.3
# apps/api + packages/core
pnpm --filter @tria/core add sharp@0.35.4 png-to-ico@3.0.2 resend@6.28.0 standardwebhooks@1.1.1
```

**Version verification:** every version above was read from `npm view <pkg> version` on 2026-09-14 (see Package Legitimacy Audit). `pnpm-workspace.yaml` already has `allowBuilds: { esbuild: true }`; `sharp` ships prebuilt binaries (no build script), so no new `allowBuilds` entry is expected — confirm on first install.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@serwist/turbopack` | npm | 9.5.12 pub 2026-07-22 | 75k/wk | github.com/serwist/serwist | OK | Approved |
| `serwist` | npm | 9.5.12 pub 2026-07-22 | 428k/wk | github.com/serwist/serwist | OK | Approved |
| `esbuild` | npm | 0.28.2 pub 2026-08-08 | 204M/wk | github.com/evanw/esbuild | OK (postinstall `node install.js` = official binary fetch) | Approved (already allowed in `pnpm-workspace.yaml`) |
| `tailwindcss` / `@tailwindcss/postcss` | npm | 4.3.3 pub 2026-09-08 | 93M / 28M /wk | github.com/tailwindlabs/tailwindcss | OK | Approved |
| `sharp` | npm | 0.35.4 pub 2026-08-26 | 75M/wk | github.com/lovell/sharp | seam `SUS: too-new` (latest release date only) | Approved — 12-year-old package, CLAUDE.md pin; the flag is the recency heuristic on the *latest* version |
| `resend` | npm | 6.28.0 pub 2026-09-11 | 8.3M/wk | github.com/resend/resend-node | seam `SUS: too-new` | Approved — official SDK, pin 6.28.0 |
| `standardwebhooks` | npm | 1.1.1 pub 2026-08-28 | 20.7M/wk | github.com/standard-webhooks/standard-webhooks | seam `SUS: too-new` | Approved — referenced by Supabase docs; deps `fast-sha256`, `@stablelib/base64` only |
| `png-to-ico` | npm | 3.0.2 pub 2026-07-06 | 336k/wk | github.com/steambap/png-to-ico | OK | Approved |
| `lucide-react` | npm | 1.46.0 pub 2026-09-14 | 74M/wk | github.com/lucide-icons/lucide | seam `SUS: too-new` | Approved (CLAUDE.md lists it) |
| `clsx` | npm | 2.1.1 pub 2024-04 | 88M/wk | github.com/lukeed/clsx | OK | Approved |
| `tailwind-merge` | npm | 3.7.0 pub 2026-09-13 | 60M/wk | github.com/dcastil/tailwind-merge | seam `SUS: too-new` | Approved (CLAUDE.md lists it) |
| `motion` | npm | 13.3.0 pub 2026-09-14 | 15M/wk | github.com/motiondivision/motion | seam `SUS: too-new` | Approved; if the planner prefers zero recency risk, pin the previous minor |
| `@react-email/components` | npm | deprecated ("Package no longer supported") | — | — | SUS: deprecated | **REMOVED** — not used |
| `react-email` | npm | 6.9.5 | — | github.com/resend/react-email | not audited (rejected on dependency weight) | **REMOVED** — not used |
| `@vercel/sdk` | npm | 1.28.32 pub 2026-09-14 | 340k/wk | github.com/vercel/sdk | seam `SUS: too-new` | Not used (fetch + Zod instead) |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** `sharp`, `resend`, `standardwebhooks`, `lucide-react`, `tailwind-merge`, `motion` — all flagged solely by the `too-new` heuristic on a release published in the last ~3 weeks; every one has ≥ 300k weekly downloads, a matching source repo and no postinstall script (`npm view <pkg> scripts.postinstall` empty). The planner may insert one `checkpoint:human-verify` before the first install wave rather than one per package.

*All packages were confirmed against the npm registry this session; none were discovered via WebSearch.*

## Architecture Patterns

### System Architecture Diagram

```
Browser (tenant host, e.g. comunidade.cliente.com.br)
   │ GET /entrar | /inicio | /manifest.webmanifest | /serwist/sw.js
   ▼
proxy.ts ──resolveHostTenant(host)──► GET /v1/public/tenants/by-host ──► tenant_domains ⋈ tenants (verified_at not null)
   │  cache 60 s/host          (API, admin lane, 60 s cache)        └─ answers { slug, displayName, status, isPrimary, primaryHost, branding }
   ├─ non-primary verified host ──► 308 to primary host (path+query kept)
   ├─ writes x-tenant-mode/host/slug/name headers
   ▼
Root layout: reads theme cookie → <html data-theme lang="pt-BR">
   ├─ (auth) layout: host brand (cached fetch keyed by host) → <div style="--brand-primary…"> + generateMetadata/generateViewport (icons, theme-color, manifest)
   └─ (app) layout: requireBootstrap() → tenant.branding → AppShell (TopBar+BottomNav | Rail+Column), registry nav from bootstrap.modules
                     │  403 TENANT_SUSPENDED / MEMBERSHIP_BLOCKED / … → /auth/* Route Handler clears cookies → branded pt-BR screen
                     ▼
/manifest.webmanifest (route handler, no-store) ← host brand (public, no cookies needed)
/serwist/sw.js (createSerwistRoute) → precache shell + /~offline; runtime defaultCache; NetworkOnly for /auth/*, /v1/*

Platform host (app.seusistema.com)
   super_admin ──► /plataforma/* pages ──(server actions, Bearer from BFF)──► /v1/platform/*
                                                                              ├─ tenants: create/list/get/update/suspend
                                                                              ├─ modules: PATCH → tenant_modules + moduleFlags.invalidate(tenantId)
                                                                              ├─ branding: POST uploads (createSignedUploadUrl) / POST complete (sharp → icons → tenants.branding)
                                                                              ├─ domains: POST attach → DomainProvider.addDomain → tenant_domains(pending, dns_records) → enqueue domain-verify
                                                                              │           POST verify-now / PATCH primary / DELETE
                                                                              └─ invites: POST resend
Worker (ROLE=worker) ── domain-verify job (every 10 min, ≤ 7 d, singletonKey=domainId)
     └─ DomainProvider.check() → verified ⇒ tenant_domains.verified_at, invalidateTenantHost(host),
        AuthAllowList.add(`https://<host>/auth/confirm**`), send pending invite (inviteUserByEmail redirectTo=https://<host>/auth/confirm?next=/aceitar-convite)

GoTrue ──(signed POST, ≤5 s)──► /v1/hooks/auth/send-email ──► verify signature → resolve tenant (membership | redirect_to host | platform) → template → MailTransport (resend | local→Mailpit) → 200 {}
```

### Recommended Project Structure

```
packages/ui/src/
├── styles/tokens.css          # neutral --theme-* (light + [data-theme=dark]), --brand-* fallbacks, @theme inline aliases, @custom-variant dark, .glass-bar, safe-area utils
├── cn.ts                      # clsx + twMerge
├── primitives/{Button,IconButton,Avatar,Badge,Input,Textarea,Skeleton,Tabs,EmptyState,Chip}.tsx
├── overlays/{BottomSheet,ConfirmDialog,Toast,ToastProvider}.tsx
├── hooks/{useMediaQuery,useDebounce,usePullToRefresh}.ts
├── layout/{PullToRefresh,SafeAreaWrapper}.tsx
└── index.ts                   # client-safe exports only (no @tria/contracts import: its index pulls legal.ts + node:fs)
packages/core/ui/               # NEW export "./ui/*" in packages/core/package.json
├── AppShell.tsx               # scroll container, --safe-* contract, mobile vs desktop
├── AppTopBar.tsx, BottomNav.tsx, DesktopRail.tsx, TenantLogo.tsx, ThemeToggle.tsx, InstallHint.tsx (unmounted)
├── nav.ts                     # bootstrap.modules + kernel entries → NavItem[] (tabs vs topbar placement)
└── theme.ts                   # THEME_COOKIE, brandStyleVars(branding)
packages/contracts/src/
├── branding.ts                # brandingSchema (colors.primary/secondary + derived), contrast helpers (pure), brandingUploadSchemas
├── domains.ts                 # tenantDomainSchema, dnsRecordSchema, domainStatus enum
├── invites.ts, platform.ts    # platformTenantDetailSchema, createTenantBodySchema, …
└── hosts.ts                   # hostTenantSchema extended (see Pattern 1)
packages/core/server/
├── platform/{tenants,modules,branding,domains,invites}.ts   # admin-lane writes behind requireSuperAdmin
├── tenancy/mail-tenant.ts     # resolves tenant for a GoTrue user / redirect_to host (admin lane → must live here)
├── domains/{provider.ts,vercel.ts,fake.ts,auth-allow-list.ts}   # DomainProvider interface + impls, Supabase Management API client
├── mail/{transport.ts,resend.ts,local.ts,templates/{layout,recovery,invite,neutral}.ts,hook.ts}
├── branding/{derive-icons.ts,contrast.ts(re-export from contracts)}
└── jobs/kernel-jobs.ts        # KERNEL_JOBS: domain-verify (worker composes KERNEL_JOBS + module jobs)
packages/core/db/schema/{tenant-invites.ts, tenant-domains.ts (+columns), tenants.ts (branding type)}
apps/api/src/routes/{platform.ts (+tenants/modules/branding/domains/invites), hooks.ts (send-email), public.ts (brand in by-host), me.ts (accept-invite)}
apps/web/
├── app/globals.css            # @import "tailwindcss"; @import "@tria/ui/styles/tokens.css"
├── app/layout.tsx             # theme cookie → data-theme; SerwistProvider; neutral metadata
├── app/(auth)/layout.tsx      # branded public chrome; generateMetadata/generateViewport from host brand
├── app/(auth)/aceitar-convite/{page.tsx,actions.ts}
├── app/(app)/layout.tsx       # AppShell; generateMetadata/generateViewport from bootstrap
├── app/(app)/{inicio,configuracoes}/page.tsx
├── app/(app)/plataforma/{page.tsx,novo/page.tsx,[id]/(marca|modulos|dominios|admins|status)/page.tsx}
├── app/(auth)/comunidade-indisponivel/page.tsx + app/auth/suspended/route.ts
├── app/manifest.webmanifest/route.ts, app/serwist/[path]/route.ts, app/sw.ts, app/~offline/page.tsx
├── lib/host-brand.ts          # getHostBrand(): headers → cached by-host fetch (60 s, bounded)
└── scripts/check-no-static-routes.mjs  # reads .next/prerender-manifest.json
```

### Pattern 1: Public by-host answer carries the brand (extend `hostTenantSchema`, keep `.strict()`)

**What:** Extend the existing `GET /v1/public/tenants/by-host` body rather than adding a sibling route: the auth pages, `proxy.ts` (needs `isPrimary`/`primaryHost` for D-35) and the manifest route all need the same host-keyed answer, and the two bounded caches (`packages/core/server/tenancy/tenant-host.ts`, `apps/web/lib/tenant-host.ts`) are already keyed by host. `[VERIFIED: packages/contracts/src/hosts.ts:84-91]` today the schema is exactly:

```ts
export const hostTenantSchema = z
  .object({
    slug: z.string(),
    displayName: z.string(),
  })
  .strict();
```

**Recommended shape** (all public, nothing beyond brand/host facts — D-20 comment "exactly these two keys" must be updated):

```ts
// packages/contracts/src/hosts.ts
export const hostBrandingSchema = z.object({
  logoUrl: z.string().nullable(),
  faviconUrl: z.string().nullable(),          // /favicon.ico derived (D-28)
  iconUrls: z.object({ i192: z.string(), i512: z.string(), maskable512: z.string(), apple180: z.string() }).nullable(),
  colors: z.object({
    primary: z.string(), secondary: z.string(),          // D-25 fixed keys (hex)
    onPrimary: z.string(), primaryDark: z.string(), onPrimaryDark: z.string(),  // persisted derivations (D-25/D-41)
  }),
}).strict();
export const hostTenantSchema = z.object({
  slug: z.string(),
  displayName: z.string(),
  status: z.enum(['active', 'suspended']),   // D-32: suspended host still resolves
  isPrimary: z.boolean(),
  primaryHost: z.string(),                    // D-35: proxy 308s non-primary → primary
  branding: hostBrandingSchema,
}).strict();
```

**Server side:** `resolveTenantHost` `[VERIFIED: packages/core/server/tenancy/tenant-host.ts:35-44]` currently filters `eq(tenants.status, 'active')` and only `verified_at`-agnostic; change to `isNotNull(tenantDomains.verifiedAt)` (D-36) and **drop** the status filter, returning `status` (D-32). A second query (or a lateral join) fetches the primary host. `invalidateTenantHost(host)` `[VERIFIED: tenant-host.ts:51-54]` is called by branding save, domain attach/verify/remove, primary switch and suspend.

**Web side:** `proxy.ts` keeps forwarding only `x-tenant-mode/host/slug/name` (headers stay small); it adds the 308 when `mode === 'tenant' && !isPrimary`. The layouts call a new `getHostBrand()` in `apps/web/lib/host-brand.ts`: `getHostTenant()` for the mode/host from headers, then `resolveHostTenant(host)` again — same module, same bounded cache, so in one instance it is free, and on Vercel (where `proxy.ts` and the page run in different functions) it is one cached fetch per host per 60 s. **Cache bust:** lower `TTL_HIT_MS` in `apps/web/lib/tenant-host.ts` from 300 s to 60 s (`[VERIFIED: apps/web/lib/tenant-host.ts:29]` `const TTL_HIT_MS = 300_000;`) so a new logo reaches the public pages within ≤ 2 min (60 s web + 60 s API); the authenticated shell reads bootstrap every render and is immediate. There is no cross-instance invalidation on Vercel, so the TTL *is* the bust — do not promise "instant".

**Decision: do not enable `cacheComponents` / `"use cache"` for branding.** `[CITED: nextjs.org/docs/app/api-reference/directives/use-cache]` — "`use cache` is a Cache Components feature. To enable it, add the `cacheComponents` option"; "Serverless: Cache entries typically don't persist across requests"; `cookies()`/`headers()` are forbidden inside a cached scope. `next.config.ts` does not set `cacheComponents` `[VERIFIED: apps/web/next.config.ts:4-13]`, and the current build output already shows every `(app)` route as `ƒ (Dynamic)` `[VERIFIED: apps/web/.turbo/turbo-build.log:19-39]`. STACK.md §6's `"use cache" + cacheTag('tenant-<id>')` is superseded for this phase.

### Pattern 2: Runtime brand tokens with Tailwind v4 `@theme inline` + `color-mix`

**What:** Keep the prototype's two-layer model (`--theme-*` raw → `--color-*` aliases) but replace the prototype's `[data-theme] { --color-*: var(--theme-*) }` re-declaration trick with `@theme inline`, which exists precisely for this: `[CITED: tailwindcss.com/docs/theme]` "Using the `inline` option, the utility class will use the theme variable *value* instead of referencing the actual theme variable" — i.e. `bg-brand` compiles to `background-color: var(--brand-primary)` and resolves on the element, so per-tenant values set on `<html style>` and per-subtree `[data-theme]` both work with no alias re-declaration. Dark variant: `[CITED: tailwindcss.com/docs/dark-mode]` `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));`.

```css
/* packages/ui/src/styles/tokens.css — Source: tailwindcss.com/docs/theme, /docs/dark-mode; values from reference/frontend-design/app/globals.css */
@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));

:root {
  /* neutral tokens ported verbatim from the prototype (light) */
  --theme-bg: #f5f7fb; --theme-bg-secondary: #ffffff; --theme-bg-tertiary: #e9eef7; --theme-bg-input: #eef2f9;
  --theme-text: #16233b; --theme-text-secondary: #51617c; --theme-text-tertiary: #8595ad; --theme-text-inverse: #ffffff;
  --theme-border: rgba(22,35,59,.10); --theme-card: #ffffff; --theme-glass-bar: rgba(255,255,255,.82); /* … */
  /* brand fallbacks: neutral TRIA, only visible on generic hosts */
  --brand-primary: #2e6fd0; --brand-secondary: #5b9cf8; --brand-on-primary: #ffffff;
  --brand-primary-dark: #5b9cf8; --brand-on-primary-dark: #0f1118;
  /* derived — never enumerate per tenant (D-25) */
  --brand-primary-hover: color-mix(in oklch, var(--brand-primary), black 12%);
  --brand-primary-soft: color-mix(in oklch, var(--brand-primary), white 88%);
  --brand-gradient: linear-gradient(135deg, color-mix(in oklch, var(--brand-primary), black 15%), var(--brand-primary), var(--brand-secondary));
  --brand-accent: var(--brand-primary); --brand-on-accent: var(--brand-on-primary);
}
[data-theme="dark"] {
  --theme-bg: #0f1118; --theme-bg-secondary: #181c26; --theme-text: #f2f5fa; /* … prototype dark values … */
  --brand-accent: var(--brand-primary-dark); --brand-on-accent: var(--brand-on-primary-dark);
  --brand-primary-soft: color-mix(in oklch, var(--brand-primary-dark), #0f1118 80%);
}
@theme inline {
  --font-sans: var(--font-manrope), system-ui, sans-serif;
  --color-bg: var(--theme-bg); --color-bg-secondary: var(--theme-bg-secondary); --color-text: var(--theme-text); /* … */
  --color-brand: var(--brand-accent); --color-on-brand: var(--brand-on-accent);
  --color-brand-soft: var(--brand-primary-soft); --color-brand-hover: var(--brand-primary-hover);
  --color-success: #16a34a; --color-danger: #ef4444; --color-warning: #d97706; --color-info: #2563eb;
}
```

**Server-side injection** (no flash): the `(auth)` and `(app)` layouts wrap their tree in `<div style={brandStyleVars(branding)} className="contents">` (or set the vars on `<body>` from the root layout when the host brand is known). `brandStyleVars` is a pure function in `packages/core/ui/theme.ts` mapping `colors.primary → --brand-primary`, `onPrimary → --brand-on-primary`, `primaryDark`, `onPrimaryDark`, `secondary`. The legacy aliases (`gold`, `emerald`, `forest`, `teal`, `sage`, `mist`) are **not** carried (PROTOTYPE.md §2 item 5); a Biome `noRestrictedImports`-style guard is not available for CSS classes, so add a grep check in `lint` (`rg "text-gold|bg-emerald|btn-gold" apps packages --glob '!reference/**'` must be empty).

**Contrast + derivations (persisted at save):** WCAG 2.x relative luminance, in `packages/contracts/src/branding.ts` (pure, shared by API validation and the panel preview). Thresholds: `onPrimary` = white or `#16233b` whichever reaches ≥ 4.5:1 against `primary` (AA normal text); warn (not block) when the best option is < 4.5:1 and when `primary` vs `--theme-bg` (light) or `primaryDark` vs `#0f1118` (dark) is < 3:1 (UI component contrast). `primaryDark` = `color-mix(in oklch, primary, white 30%)` computed server-side with a tiny OKLCH mix (or simply lighten in sRGB by 30% — ASSUMED tuning; the D-41 wording is "tuned"). Rationale for WCAG 2.x over APCA: `[CITED: adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html]` APCA "remains exploratory and is not part of the normative WCAG 3.0 draft"; WCAG 2.x AA is the legal benchmark.

### Pattern 3: Theme cookie rendered on the first HTML

- Cookie `tria_theme` = `light` | `dark`, `Path=/; SameSite=Lax; Max-Age=31536000; Secure` in production, **not** HttpOnly (the client toggle may set it), no `Domain` (per-origin, one tenant per origin). Root layout: `const theme = (await cookies()).get('tria_theme')?.value === 'dark' ? 'dark' : 'light'` → `<html lang="pt-BR" data-theme={theme}>`. Reading `cookies()` in the root layout makes **every** route dynamic — desirable here (criterion 1 build check) and consistent with the D-41 "no flash" requirement. The toggle (`ThemeToggle`, client) sets `document.documentElement.dataset.theme` and `document.cookie`, and calls a server action that also `cookies().set(...)` so SSR and the client agree; `<meta name="theme-color">` is updated client-side exactly like the prototype's `applyTheme` `[VERIFIED: reference/frontend-design/contexts/ThemeContext.tsx:22-30]`.
- `generateViewport` in the `(app)`/`(auth)` layouts returns `themeColor: colors.primary` (light) — `[CITED: nextjs.org/docs/app/api-reference/functions/generate-viewport]` supports a string or `[{ media, color }]`; since our dark mode is a `data-theme` toggle, not `prefers-color-scheme`, emit the single primary and let the client update it on toggle.

### Pattern 4: Platform panel API surface (all under `requireSuperAdmin()`, writes in `packages/core/server/platform/*`)

| Route | Body/Result | Notes |
|---|---|---|
| `GET /v1/platform/tenants` | existing thin list (`platformTenantsSchema`) + `?q=` search, `?status=` | keep shape; add optional query params |
| `POST /v1/platform/tenants` | `{ displayName, slug, colors: {primary, secondary}, modules: ModuleKey[], adminEmail }` → tenant detail | one `withAdminTx`: insert `tenants` (branding with derived colors), all `TOGGLEABLE_MODULES` rows (`enabled` per checklist, `example` forced false, D-19), `tenant_invites` pending; audit log line; if a verified primary host exists (never at creation) send invite |
| `GET /v1/platform/tenants/{id}` | `platformTenantDetailSchema`: tenant + branding + modules + domains (with `dnsRecords`, `verificationStatus`, `lastCheckedAt`) + invites + admin memberships (email, joinedAt) | the ONLY place the platform lane may read a tenant's domains/admins (T-06-07 stays true for the list) |
| `PATCH /v1/platform/tenants/{id}` | `{ displayName?, colors? }` | slug immutable (D-31); recompute derivations; `invalidateTenantHost` for every host |
| `POST /v1/platform/tenants/{id}/status` | `{ status: 'active' \| 'suspended' }` | `invalidateTenantHost` all hosts |
| `PUT /v1/platform/tenants/{id}/modules/{key}` | `{ enabled }` | update row; `moduleFlags.invalidate(tenantId)` `[VERIFIED: flags-cache.ts:82-84]`; other API instances converge within `MODULE_FLAGS_TTL_MS = 30_000` `[VERIFIED: flags-cache.ts:21]` |
| `POST /v1/platform/tenants/{id}/branding/uploads` | `{ kind: 'logo' \| 'icon', mime, size }` → `{ uploadId, signedUrl, path }` | validates mime ∈ png/svg+xml/webp/jpeg, size ≤ 2 MiB; `supabaseAdmin.storage.from('branding').createSignedUploadUrl(path)` |
| `POST /v1/platform/tenants/{id}/branding/uploads/{uploadId}/complete` | → branding | verifies object exists (`storage.from('branding').info(path)` or `list`), downloads it, `sharp` derives icons (Pattern 9), uploads them under `<tenant_id>/branding/icons/<version>/…`, writes `tenants.branding` (new `iconVersion` to bust browser caches), `invalidateTenantHost` |
| `POST /v1/platform/tenants/{id}/domains` | `{ host }` → domain row | Pattern 5 |
| `POST …/domains/{domainId}/verify` · `PATCH …/domains/{domainId}/primary` · `DELETE …/domains/{domainId}` | | verify-now runs the same check function the job runs |
| `POST /v1/platform/tenants/{id}/invites/{inviteId}/resend` | | re-calls `inviteUserByEmail` (GoTrue re-sends for an invited-but-unconfirmed user — ASSUMED A3) |

Web: server actions in `apps/web/app/(app)/plataforma/**/actions.ts` call these with `apiFetch` and `revalidatePath`; refusals map through `platformRedirectPath` `[VERIFIED: apps/web/lib/platform.ts:44-50]`.

### Pattern 5: Domain provider adapter (fake + Vercel) and the `domain-verify` kernel job

**Vercel endpoints** `[CITED: vercel.com/docs/rest-api/projects/add-a-domain-to-a-project; …/get-a-project-domain; …/verify-project-domain; vercel.com/docs/rest-api/domains/get-a-domain-s-configuration]`:

| Step | Call | Reads |
|---|---|---|
| add | `POST /v10/projects/{idOrName}/domains?teamId=…` body `{ "name": host }` | `200 { name, apexName, projectId, verified, verification?: [{ type, domain, value, reason }] }`; `409` "domain is already assigned to another Vercel project" / "owner already has domain … not verified yet"; `400` invalid domain |
| dns instructions | `GET /v6/domains/{host}/config?teamId=…` | `{ configuredBy: 'A'\|'CNAME'\|'dns-01'\|'http'\|null, misconfigured: boolean, recommendedCNAME: [{ rank, value }], recommendedIPv4: [{ rank, value: string[] }], acceptedChallenges }` |
| ownership verify | `POST /v9/projects/{idOrName}/domains/{host}/verify?teamId=…` | `200 { …, verified }`; `400` "The domain does not have a TXT record that attempts to verify the project domain" / "TXT record … does not match" |
| status | `GET /v9/projects/{idOrName}/domains/{host}?teamId=…` | same shape as add |
| remove | `DELETE /v9/projects/{idOrName}/domains/{host}?teamId=…` | (project-level detach; account-level `domainsDeleteDomain` not needed — the customer owns the domain) |

Two independent conditions, both required before `verified_at`: **ownership** (`verified === true`; when `false`, `verification[]` holds the TXT challenge — `[CITED: vercel.com/docs/domains/working-with-domains/add-a-domain]` "If the domain is in use by another Vercel account, you will need to verify access to the domain, with a TXT record" at `_vercel.<domain>`) and **configuration** (`misconfigured === false` on `/config`, i.e. DNS points at Vercel and a certificate can be issued). DNS records to show: subdomain (`name !== apexName`) → `CNAME <host> → recommendedCNAME[rank 1].value`; apex → `A <host> → recommendedIPv4[rank 1].value[0]`; plus `TXT _vercel.<apex> → verification[].value` when present. **Never hardcode** `cname.vercel-dns.com`/`76.76.21.21`: `[CITED: add-a-domain]` "Each project has a unique CNAME record e.g. `d1d4fc829fe7bc7c.vercel-dns-017.com`". Error codes `[CITED: vercel.com/docs/platforms/multi-tenant-platforms/reference]`: `domain_already_in_use`, `invalid_domain`, `forbidden`, `rate_limit_exceeded` ("Wait and retry with exponential backoff"). Token: a team-scoped Vercel access token; `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` from Secret Manager (hosted proof deferred to the 01.1 runbook — Open Question 1).

```ts
// packages/core/server/domains/provider.ts
export type DnsRecord = { type: 'CNAME' | 'A' | 'TXT'; name: string; value: string; purpose: 'routing' | 'ownership' };
export type DomainCheck = { ownershipVerified: boolean; configured: boolean; records: DnsRecord[]; providerRef?: string };
export interface DomainProvider {
  addDomain(host: string): Promise<DomainCheck>;        // idempotent: 409 "already on this project" → treated as success + check()
  check(host: string): Promise<DomainCheck>;            // GET project domain + GET config (+ POST verify when ownership pending)
  removeDomain(host: string): Promise<void>;            // 404 → success
}
export const domainProvider: DomainProvider = env.DOMAIN_PROVIDER === 'vercel' ? vercelProvider : fakeProvider;
```
The **fake** (`DOMAIN_PROVIDER=fake`, the default outside production) returns fixed records (`CNAME <host> → fake.tria-dns.test`, apex → `A 203.0.113.10`, and a TXT challenge only when the host contains `needs-txt` so the TXT UI is testable) and reports `configured: true, ownershipVerified: true` on the first `check()`. Both adapters are exercised by one contract test with the Vercel adapter driven by `msw`/`undici` mock responses copied from the docs' example bodies.

**`tenant_domains` additions:** `verification_status text not null default 'pending' check (in ('pending','verified','expired','failed'))`, `dns_records jsonb not null default '[]'`, `last_checked_at timestamptz`, `verify_deadline_at timestamptz` (attach + 7 days), `last_error text`. `verified_at` stays the resolution predicate (D-36).

**Job:** `KERNEL_JOBS` in `packages/core/server/jobs/kernel-jobs.ts` exports `{ name: 'domain-verify', handler }`; `apps/api/src/worker.ts` must merge it with module jobs (today it only flat-maps `MODULE_REGISTRY` `[VERIFIED: apps/api/src/worker.ts:27-29]`), and `registry.ts` must `registerJobQueues(['domain-verify'])`. Attach enqueues `enqueueInTx(tx, 'domain-verify', { domainId }, { singletonKey: domainId })` `[VERIFIED: packages/core/server/jobs/boss.ts:148-167]` with `startAfter` 600 s; the handler runs `check()`, updates the row, and when still pending and before the deadline re-enqueues itself with `singletonKey: domainId` (the `short` policy makes a duplicate a no-op `[VERIFIED: boss.ts:64]`); past the deadline → `expired`. "Verificar agora" and "Reiniciar verificação" call the same `checkDomain(domainId)` function synchronously. On verified: set `verified_at`, `invalidateTenantHost(host)`, `authAllowList.add(host)`, and `sendPendingInvites(tenantId)` (D-30) — all in the kernel platform lane so the job and the route share one function.

**Supabase allow-list:** `[CITED: supabase.com/docs/reference/api/v1-update-auth-service-config]` `PATCH /v1/projects/{ref}/config/auth` (`GET` to read), field `uri_allow_list: string` (OAuth scope `auth:write`); `[CITED: supabase.com/docs/guides/self-hosting/auth/config]` `GOTRUE_URI_ALLOW_LIST` — "A comma separated list of URIs … which are permitted as valid `redirect_to` destinations". Implement `AuthAllowList { add(host), remove(host) }` as read → split(',') → add/remove `https://<host>/auth/confirm**` → join(',') → PATCH, with `Authorization: Bearer <SUPABASE_PAT>` and `SUPABASE_PROJECT_REF`; the `local` implementation is a no-op because `supabase/config.toml` already has `additional_redirect_urls = ["http://localhost:3000/**", "http://*.localhost:3000/**"]` `[VERIFIED: supabase/config.toml:162]`. Keep the explicit per-domain path (never `https://**`) per `docs/DEPLOY.md` WR-09. Concurrency: the read-modify-write must be serialised (`pg_advisory_xact_lock` on a constant key inside the job's transaction) so two domains verifying at once do not clobber each other.

### Pattern 6: Send Email Hook route → templates → transport

`[CITED: supabase.com/docs/guides/auth/auth-hooks/send-email-hook; …/auth-hooks]`
- Route `POST /v1/hooks/auth/send-email` on the API (no `requireAuth`; mounted before the auth groups), body read as **raw text** for signature verification: `const raw = await c.req.text(); const wh = new Webhook(env.SEND_EMAIL_HOOK_SECRET.replace('v1,whsec_', '')); const payload = wh.verify(raw, { 'webhook-id': …, 'webhook-timestamp': …, 'webhook-signature': … })`. Secrets may be rotated as `v1,whsec_<a>|<b>` (docs: "`<standard-base-64-secret>|<another-standard-base-64-secret>`") — verify against each.
- Payload: `{ user: { id, email, … }, email_data: { token, token_hash, redirect_to, email_action_type, site_url, token_new, token_hash_new } }`; `email_action_type ∈ signup, invite, magiclink, recovery, email_change, email, reauthentication, password_changed_notification, email_changed_notification, …`.
- Link building: `const url = new URL(email_data.redirect_to); url.searchParams.set('token_hash', token_hash); url.searchParams.set('type', email_action_type)` — matches the existing `/auth/confirm` contract `[VERIFIED: apps/web/app/auth/confirm/route.ts:45-58]` (`token_hash`, `type`, optional `next`) and the current recovery template `[VERIFIED: supabase/templates/recovery.html]` which appends `&token_hash=…&type=recovery` to `RedirectTo`.
- Tenant resolution (`packages/core/server/tenancy/mail-tenant.ts`, admin lane): `memberships` for `user.id` (+ `deleted_at is null`) → tenant; else `tenant_domains` for `new URL(redirect_to).host` (normalised); else `platform_admins` → neutral TRIA template. Templates use the **persisted** `colors.primary`/`onPrimary` (CSS `color-mix` is unavailable in e-mail).
- Response: `200 {}`; on failure return `{ error: { http_code: 500, message } }` with status 500 — do **not** answer 429/503 for permanent failures (those are "retry-able"). **Budget: "HTTP Hooks should complete in 5 seconds … up to three retries with a back-off of two seconds. The total invocation budget is 5 seconds including all retries."** So the handler must complete the Resend call well under 5 s: use a 3 s `AbortSignal.timeout` on the transport, no DB writes beyond the tenant lookup, and log-and-succeed on transport timeout only if retry is impossible (see Pitfall 6).
- Transport interface `MailTransport.send({ from, to, subject, html, text, replyTo? })`: `resend` → `new Resend(key).emails.send(...)`; `local` → `POST http://127.0.0.1:54324/api/v1/send` (Mailpit v1.30.2 on the local stack answered 200 to `{ From: { Email }, To: [{ Email }], Subject, Text, HTML }` in this session — **probe output:** `curl -X POST …/api/v1/send → 200`, then `/api/v1/search?query=subject:probe` returned the message), so `apps/web/e2e/mail.ts` keeps reading invites and recoveries unchanged. `From: "{displayName} <no-reply@{MAIL_DOMAIN}>"` (D-38).
- Local config `[CITED: supabase.com/docs/guides/local-development/cli/config]`: `[auth.hook.send_email] enabled = true; uri = "http://host.docker.internal:8787/v1/hooks/auth/send-email"; secrets = "env(SEND_EMAIL_HOOK_SECRETS)"` ("For local services, use `host.docker.internal`"). Custom SMTP stays as the fallback when the hook is disabled (D-37). Hosted: same block via `supabase config push` in the 01.1 workflow with the Cloud Run URL.
- Templates: plain HTML strings in `packages/core/server/mail/templates/` — a `layout({ tenant, title, intro, cta: { label, href }, footer })` returning `{ html, text }`, table-based, inline styles, all interpolations through `escapeHtml`; `recovery.ts` ("Redefina sua senha — {tenant}"), `invite.ts` ("Você foi convidado(a) a administrar {tenant}"), `neutral.ts` for other action types. Unit-tested with snapshot + "contains no unescaped `<`" assertions.

### Pattern 7: First-admin invite and accept

- `tenant_invites` (new table, admin-lane-only, RLS on with **no** tenant policy — same shape as `platform_admins` `[cited STATE.md 01-03]`): `id, tenant_id, email citext, role text check in ('admin_tenant'), status text check in ('pending','sent','accepted','expired') default 'pending', user_id uuid null, sent_at, accepted_at, created_by uuid, created_at`; unique `(tenant_id, lower(email))` with `tenant_id` first.
- Sending (`sendPendingInvites(tenantId)`): requires a verified primary host `h`; `supabaseAdmin.auth.admin.inviteUserByEmail(email, { redirectTo: \`https://${h}/auth/confirm?next=/aceitar-convite\`, data: { name?: … } })` `[VERIFIED: node_modules …/auth-js GoTrueAdminApi.ts]` signature `inviteUserByEmail(email: string, options: { data?: object; redirectTo?: string } = {}): Promise<UserResponse>` → creates the `auth.users` row (`invited_at`), which the `auth_user_mirror` migration mirrors into `public.users`; then insert `memberships (tenant_id, user_id, role='admin_tenant', status='invited')` and mark the invite `sent`. `[VERIFIED: packages/core/db/schema/memberships.ts:39]` `check('memberships_status_chk', sql\`${t.status} in ('active','blocked','invited')\`)` — no migration needed for the status. Local origin: `http://<host>:3000` (derive scheme/port from `PLATFORM_HOST`/env, never hardcode).
- Accept: the e-mail link hits `/auth/confirm?next=/aceitar-convite&token_hash=…&type=invite` (`invite` is in `OTP_TYPES` `[VERIFIED: auth/confirm/route.ts:30]`), `verifyOtp` creates a session and redirects to `/aceitar-convite`. That page (public path in `proxy.ts` `PUBLIC`) shows the branded "Você foi convidado(a) a administrar {tenant}" form: password (`PasswordField`, D-10) + the two D-03 consent checkboxes (reuse `RulesSheet`, `/termos`, `/privacidade`, versions from `GET /v1/public/tenants/{slug}`). Its server action: `supabase.auth.updateUser({ password })` (same as `redefinir-senha/actions.ts` `[VERIFIED]`) then `POST /v1/me/accept-invite { rulesVersion, termsVersion, ip, userAgent }` → API (tenant lane, `requireAuth` must **allow `status = 'invited'`** — it does today: only `blocked`/tenant-status fail `[VERIFIED: require-auth.ts:57]`) writes `consent_records` and flips membership to `active`, invite to `accepted` → redirect `/inicio`.
- Web guard: `requireBootstrap()` callers redirect `membership.status === 'invited'` to `/aceitar-convite` so an invited admin who wanders to `/inicio` before accepting is routed back (bootstrap already types `status: z.enum(['active','blocked','invited'])` `[VERIFIED: packages/contracts/src/bootstrap.ts:14]`).
- Expiry: invite links follow `MAILER_OTP_EXP` — `[CITED: github.com/supabase/auth README]` "Controls the duration an email link or OTP is valid for" (confirmation, recovery, magic link, invite, email change); locally `[auth.email] otp_expiry = 3600` `[VERIFIED: supabase/config.toml:243]`. One hour is short for an admin invite; recommend `otp_expiry = 86400` locally and "Email OTP Expiration" = 86400 on the hosted project (A4). An expired/used link lands on `/auth/confirm`'s existing fallback `redirect('/esqueci-senha?erro=link-invalido')` `[VERIFIED: confirm/route.ts:58]` — add a `type=invite`-aware branch that redirects to `/convite-expirado` ("Este convite expirou. Peça um novo convite ao administrador da plataforma.") instead of the recovery form.

### Pattern 8: Registry extensions for navigation, home slots and settings rows

`ModuleManifest` today `[VERIFIED: packages/core/server/modules/manifest.ts:44-51]`:
```ts
export interface ModuleManifest {
  key: ModuleKey;
  nav?: ModuleNav;
  routes?: () => Promise<Hono<AppEnv>>;
  jobs?: AnyJobDefinition[];
  events?: EventSubscription[];
  defaultRolePermissions?: Partial<Record<TenantRole, string[]>>;
}
```
and `ModuleNav { label, icon, href, order }` `[VERIFIED: manifest.ts:11-16]`; bootstrap already ships `modules[].nav { label, icon, href, order }` `[VERIFIED: bootstrap.ts:34-41]`.

Extend **additively** (optional fields, old modules keep working):
```ts
export interface ModuleNav { label: string; icon: string; href: string; order: number; placement?: 'tab' | 'topbar'; badge?: 'unreadNotifications' | 'unreadConversations' }
export interface ModuleManifest { …; home?: { order: number }[]; settings?: { key: string; order: number }[] }
```
Bootstrap schema gains the same optional keys. The web composition point `packages/core/ui/nav.ts` builds `tabs = [kernel Início(order 0)] + modules with placement ≠ 'topbar' sorted by order + [kernel Perfil(last)]` and `topbar = modules with placement 'topbar'` (bell → `counters.unreadNotifications`, chat → `unreadConversations`, both already in bootstrap `[VERIFIED: bootstrap.ts:46-49]`). Icons are strings (`'bell'`, `'message-circle'`, `'home'`, `'users'`, `'calendar-days'`, `'user'`) mapped to lucide components in `packages/core/ui` — the manifest lives on the server and must stay serialisable. Home slots: in this phase `/inicio` renders `[BrandedWelcome, EmptyState('Em breve')]`; module widgets are a Phase 4+ web-side registry (`apps/web/modules/registry.tsx`) keyed by `home[].order`.

### Pattern 9: PWA — manifest route, icons via sharp, serwist under Turbopack

- **Manifest**: `app/manifest.webmanifest/route.ts` with `export const dynamic = 'force-dynamic'`, `Cache-Control: private, no-store`, resolves the tenant from `getHostBrand()` (host only: **the browser fetches the manifest without cookies** unless `crossorigin="use-credentials"`, so it must not need a session) and returns `{ id: '/', name, short_name, start_url: '/', scope: '/', display: 'standalone', lang: 'pt-BR', background_color: '#f5f7fb', theme_color: colors.primary, icons: [ {192 png}, {512 png}, {512 png, purpose: 'maskable'} ] }`; generic hosts get the neutral TRIA manifest. `generateMetadata` in the layouts returns `manifest: '/manifest.webmanifest'`, `icons: { icon: faviconUrl, apple: apple180 }`, `appleWebApp: { capable: true, title: displayName, statusBarStyle: 'default' }`. Because every tenant is its own origin (D-35), `id: '/'` is already per tenant; the CONTEXT's `/m/[slug]/…` path is unnecessary.
- **proxy.ts `PUBLIC`** must add `/manifest.webmanifest`, `/serwist/`, `/~offline`, `/aceitar-convite`, `/convite-expirado`, `/comunidade-indisponivel` `[VERIFIED: apps/web/proxy.ts:15-26]` (otherwise unauthenticated manifest/SW fetches are redirected to `/entrar` and the install criteria fail).
- **Icons** (API, `packages/core/server/branding/derive-icons.ts`): read the uploaded logo (SVG is rasterised by sharp's librsvg), `sharp(buf).resize(512, 512, { fit: 'contain', background: { r:0,g:0,b:0,alpha:0 } }).png()` for 512/192/180/48/32; maskable 512 = `sharp({ create: { width: 512, height: 512, channels: 4, background: primaryHex } }).composite([{ input: logoResizedTo(410) /* 80% safe zone */, gravity: 'centre' }]).png()`; `favicon.ico` = `pngToIco([png32, png48])`. Store under `<tenant_id>/branding/icons/<iconVersion>/…` in the public bucket; write absolute public URLs into `tenants.branding` (`logoUrl`, `iconUrl` (override), `faviconUrl`, `iconUrls.{i192,i512,maskable512,apple180}`, `iconVersion`). Free plan has no transforms `[CLAUDE.md]`, so derivation happens here, once per upload. `[ASSUMED]` exact sharp composite options — verify in the unit test with a real PNG (A5).
- **Bucket**: local `supabase/config.toml` `[storage.buckets.branding] public = true; file_size_limit = "2MiB"; allowed_mime_types = ["image/png","image/svg+xml","image/webp","image/jpeg","image/x-icon"]` `[CITED: cli/config]`; hosted: a `--custom` migration `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) … on conflict do nothing` plus a `storage.objects` **select** policy for `bucket_id = 'branding'` (public read); inserts happen only through service-key-signed URLs, so no insert policy for `authenticated`. Browser upload = `fetch(signedUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type, 'x-upsert': 'false' } })` — `[VERIFIED: node_modules/.pnpm/@supabase+storage-js@2.116.0/…/dist/index.mjs:757-790]` `uploadToSignedUrl` does exactly a `PUT` to `${url}/object/upload/sign/${path}?token=…` with `x-upsert` and `content-type` headers, and the docblock states signed upload URLs "can be used to upload files to the bucket without further authentication. They are valid for 2 hours."
- **Service worker** `[CITED: serwist.pages.dev/docs/next/turbo; github.com/serwist/serwist examples/next-turbo-basic]`: `next.config.ts` → `withSerwist(withNextIntl(nextConfig))`; `app/serwist/[path]/route.ts` exporting `createSerwistRoute({ additionalPrecacheEntries: [{ url: '/~offline', revision }], swSrc: 'app/sw.ts', useNativeEsbuild: true })`; `app/sw.ts` with `new Serwist({ precacheEntries: self.__SW_MANIFEST, skipWaiting: true, clientsClaim: true, navigationPreload: true, runtimeCaching: [ { matcher: ({url}) => url.pathname.startsWith('/auth/') || url.pathname.startsWith('/v1/') || url.pathname === '/manifest.webmanifest', handler: new NetworkOnly() }, ...defaultCache ], fallbacks: { entries: [{ url: '/~offline', matcher: ({ request }) => request.destination === 'document' }] } })`; root layout wraps children in `<SerwistProvider swUrl="/serwist/sw.js">` from `@serwist/turbopack/react`; add `"webworker"` to `apps/web/tsconfig.json` `lib`; add `headers()` rule `source: '/serwist/:path*'` → `Cache-Control: no-store` (the route handler is dynamic, but the header makes the intent explicit `[CITED: nextjs PWA guide §8]`). Update prompt: `skipWaiting + clientsClaim` (no prompt) is acceptable for V1; a "Nova versão disponível — atualizar" toast is a Phase 8 nicety. `/~offline` is a pt-BR page ("Você está offline") using neutral tokens (it is precached once per origin, so it cannot depend on a session; it may still read the host brand at build… no — keep it neutral).
- **iOS**: `InstallHint` follows the official `InstallPrompt` snippet `[CITED: nextjs.org/docs/app/guides/progressive-web-apps]` (`/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream`, `matchMedia('(display-mode: standalone)')`) — built, not mounted (PWA-02 in Phase 7). `apple-mobile-web-app-capable` comes from `appleWebApp.capable`; safe areas via `viewportFit: 'cover'` in `generateViewport` and the prototype's `--safe-top: max(env(safe-area-inset-top), 12px)` contract `[VERIFIED: reference/frontend-design/app/globals.css]`.

### Pattern 10: Suspended tenant (D-32)

Add `TENANT_SUSPENDED` to `ERROR_CODES` `[VERIFIED: packages/contracts/src/errors.ts:4-17]` and `ERROR_MESSAGES` (`'Esta comunidade está temporariamente indisponível.'`). Split `require-auth.ts:57` — today `if (membership.status === 'blocked' || membership.tenantStatus !== 'active') throw new ApiError(403, 'MEMBERSHIP_BLOCKED', …)` — into `tenantStatus !== 'active' → TENANT_SUSPENDED` (checked first) and `blocked → MEMBERSHIP_BLOCKED`. `bootstrapRedirectPath` `[VERIFIED: apps/web/lib/bootstrap.ts:90-102]` maps `TENANT_SUSPENDED` → `/auth/suspended` (Route Handler that signs out, like `/auth/blocked`) → `/comunidade-indisponivel` (public, branded through the host brand because the host still resolves per Pattern 1). `/entrar` on a suspended host shows the same message above the form and the login action refuses early (no GoTrue call) — `getHostBrand().status === 'suspended'`. Sign-up on a suspended host: `getPublicTenant` already answers 404 for suspended `[VERIFIED: public.ts:70]`.

### Pattern 11: Build-output check ("no authenticated route is static")

`[VERIFIED: apps/web/.next/prerender-manifest.json]` (version 4) lists prerendered routes under `routes` — today `['/', '/_global-error', '/_not-found', '/endereco-invalido', '/privacidade', '/redefinir-senha', '/termos']`, and `[VERIFIED: apps/web/.next/app-path-routes-manifest.json]` maps `"/(app)/inicio/page": "/inicio"` etc. Script `apps/web/scripts/check-no-static-routes.mjs`: after `next build`, load both manifests, collect every path whose source key starts with `/(app)/` (and, for criterion 1's branded login, `/(auth)/`), and fail if any appears in `prerender-manifest.routes`. Wire it as `"build": "next build && node scripts/check-no-static-routes.mjs"`. Once the root layout reads the theme cookie, the expected `routes` set shrinks to `/_global-error` and `/_not-found` only.

### Anti-Patterns to Avoid
- **`"use cache"`/`cacheComponents` for tenant data in this phase** — see Pattern 1 decision; also `cookies()`/`headers()` inside a cached scope throws at runtime.
- **Hardcoding Vercel DNS targets** (`cname.vercel-dns.com`, `76.76.21.21`) — per-project CNAMEs make that wrong; always show `/config` values.
- **Treating `verified: true` from `POST …/domains` as "DNS done"** — it only means ownership; the customer still has to create the CNAME/A; use `misconfigured === false`.
- **Manifest/SW behind auth** — `proxy.ts` would redirect the credential-less manifest fetch to `/entrar`.
- **Re-declaring `--color-*` under `[data-theme]`** (prototype trick) — replaced by `@theme inline`.
- **`react-email` in the API** — CLI-weight runtime deps; plain HTML.
- **A `for: 'all'` policy on `tenant_invites` or widening `memberships` policies** — admin-lane only (SCHEMA-CONVENTIONS (i), `memberships.ts:40-46` comment).
- **Blocking on contrast** — warn + explicit confirmation (discretion note).
- **Answering the hook with 429/503 on permanent template errors** — GoTrue retries within the same 5 s budget; return 500.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Webhook signature verification | HMAC/timestamp parsing | `standardwebhooks` `Webhook.verify` | Timing-safe compare, timestamp tolerance, multi-secret rotation |
| Image resizing / rasterising SVG / compositing | Canvas/pngjs pipelines | `sharp` 0.35.4 | libvips, SVG via librsvg, alpha-correct compositing |
| ICO container | Manual ICO header bytes | `png-to-ico` | PNG-in-ICO directory entries, multiple sizes |
| Service worker precache/routing | Hand-written `sw.js` (prototype `public/sw.js`) | `serwist` + `@serwist/turbopack` | Revisioned precache manifest, navigation preload, fallback routing, Turbopack build |
| Class merging | String concat | `clsx` + `tailwind-merge` | Conflict resolution of Tailwind utilities |
| Sheet/dialog springs & drag-to-dismiss | Custom rAF animation | `motion` | Gesture + spring physics the prototype already relies on |
| Job scheduling/retries | `setInterval` in the API | pg-boss `startAfter` + `singletonKey` (existing `enqueueInTx`) | Transactional, idempotent, survives restarts |
| Redirect-URL allow-list edits | String appends | Read-modify-write through the Management API + advisory lock | Preserves entries added by hand/other flows |
| Relative-luminance contrast | — (this one is fine to write: ~20 lines of the WCAG formula) | pure function in `@tria/contracts` with unit tests against WebAIM known pairs | No suitable maintained tiny dependency; formula is normative |

**Key insight:** the hard parts of this phase are edge cases in *other people's* systems (GoTrue's hook budget, Vercel's two-step verification, browser manifest fetch semantics, service-worker lifecycles); libraries encode those edge cases, hand-rolled code rediscovers them in production.

## Runtime State Inventory

Step 2.5: SKIPPED — this is an additive greenfield phase (new tables/columns, new routes, new packages), not a rename/refactor. The only stored-data change is a jsonb *widening* of `tenants.branding` (new keys; existing rows keep `{}` and read as "no branding"); the seed script must be updated to write `colors.primary/secondary` + derivations for both seed tenants so the two-tenant smoke has two distinct brands (`[VERIFIED: scripts/seed.ts:112-129]` upserts `displayName`/`rulesText` only today).

## Common Pitfalls

### Pitfall 1: One tenant's brand cached for another
**What goes wrong:** a host-keyed cache entry written under the wrong key (`undefined:branding`) or a Next cache keyed by path serves tenant A's logo on B's host.
**Why it happens:** caches keyed by anything other than the normalised host/tenant id; static rendering of layouts.
**How to avoid:** all brand caches keyed by `normalizeHost(host)` (existing `createBoundedTtlCache`), bootstrap per request, no `"use cache"`, root layout dynamic via `cookies()`, Pattern 11 build check, two-tenant Playwright smoke asserting `--brand-primary`, logo `src`, manifest `name` and `theme-color` per host.
**Warning signs:** `○ (Static)` for any `(app)`/`(auth)` route; a route handler without `force-dynamic`/`no-store`.

### Pitfall 2: Flash of default brand or wrong theme
**What goes wrong:** first paint shows TRIA blue or light mode before hydration.
**Why it happens:** brand vars or `data-theme` applied in `useEffect` (the prototype's `ThemeContext` does exactly this).
**How to avoid:** SSR `<html data-theme>` from the cookie and brand vars on the layout wrapper; the client only *changes* them on toggle. Assert in Playwright by reading `getComputedStyle(document.documentElement).getPropertyValue('--brand-primary')` right after `domcontentloaded` with JavaScript **disabled** (`browser.newContext({ javaScriptEnabled: false })`).

### Pitfall 3: Manifest / service worker unreachable behind the auth redirect
**What goes wrong:** Chrome reports "no matching service worker" / manifest fetch 307 → `/entrar`; install never offered.
**Why it happens:** `proxy.ts` PUBLIC regexes do not include `/manifest.webmanifest`, `/serwist/`, `/~offline`; manifest fetch carries no cookies.
**How to avoid:** add them to `PUBLIC`; resolve the manifest from the host only; Playwright asserts `GET /manifest.webmanifest` is 200 JSON with the tenant name in a fresh context.

### Pitfall 4: `@serwist/turbopack` + TypeScript 7
**What goes wrong:** `createSerwistRoute` (esbuild-based) may type-check `app/sw.ts` through a TS API path; the official example pins `"typescript": "npm:@typescript/typescript6@6.0.2"` `[VERIFIED: examples/next-turbo-basic/package.json]`.
**Why it happens:** TS 7.0 ships no JS compiler API (CLAUDE.md).
**How to avoid:** Wave 0 spike: install and run `next build` once with TS 7.0.2; if it fails, apply the CLAUDE.md alias fallback in `apps/web` only. `useNativeEsbuild: true` avoids esbuild-wasm.

### Pitfall 5: Vercel verification semantics
**What goes wrong:** panel says "Verificado" while the site 404s / has no certificate, or never verifies because the TXT challenge was hidden.
**Why it happens:** conflating `verified` (ownership) with `misconfigured` (DNS/cert); only reading the add response.
**How to avoid:** `check()` = project-domain `verified` **and** `/config.misconfigured === false`; show the TXT record whenever `verification[]` is non-empty; 409 on add for a domain on another project is surfaced as "Este domínio está em uso em outro projeto Vercel — crie o registro TXT para provar a posse" with the challenge. Rate limits: back off on `rate_limit_exceeded`; the 10-minute cadence is far below any limit.

### Pitfall 6: Send Email Hook 5-second budget and duplicate sends
**What goes wrong:** Resend takes > 5 s → GoTrue retries → duplicate e-mails or an auth request failing with "hook timed out".
**Why it happens:** the budget includes retries; a slow transport or a DB lookup on a cold API instance.
**How to avoid:** min-instances 1 for the API in production (CLAUDE.md); 3 s transport timeout; idempotency key = `webhook-id` header stored in a tiny in-memory LRU (and `Idempotency-Key` header on Resend, which supports it — ASSUMED A6) so a retry does not resend; log with `tenant_id`, `email_action_type`, `webhook-id`. Integration test: hook route answers 200 in < 1 s with the `local` transport.

### Pitfall 7: Hook route mounted behind auth or after body parsing
**What goes wrong:** signature verification fails because the body was re-serialised, or the route 401s.
**How to avoid:** mount `/v1/hooks` before `requireAuth` groups; read `c.req.text()`; do not use `zod-openapi` body validation for this route (validate *after* verifying the raw body).

### Pitfall 8: Invited admin state machine gaps
**What goes wrong:** invite e-mail sent before a verified primary host exists → link points nowhere; an invited user reaching `/inicio` with an `invited` membership; resending to an already-accepted invite.
**How to avoid:** `sendPendingInvites` is the only sender and requires `verified_at` + `is_primary`; bootstrap callers redirect `invited` → `/aceitar-convite`; `resend` is a no-op on `accepted` with a 409-style validation error.

### Pitfall 9: `tenant_domains` unique host vs re-attach after removal
**What goes wrong:** removing a domain from Vercel but leaving the row (or vice versa) blocks re-attaching.
**How to avoid:** `removeDomain` is idempotent on 404; the row is deleted in the same admin transaction *after* the provider call succeeds; `invalidateTenantHost` on both tiers (the web cache expires by TTL only).

### Pitfall 10: Public bucket key guessing / oversized SVGs
**What goes wrong:** anyone can read `branding` objects (by design), but an attacker could upload a 50 MB SVG with scripts via a leaked signed URL.
**How to avoid:** bucket `file_size_limit = 2MiB` and `allowed_mime_types` enforced by Storage; SVG is rasterised by `sharp` for icons and, for the logo itself, served with `Content-Type: image/svg+xml` only through `<img>` (never inlined), which does not execute scripts; `complete` re-checks size/mime from object metadata.

## Code Examples

### Vercel adapter (fetch + Zod)
```ts
// packages/core/server/domains/vercel.ts — Source: vercel.com/docs/rest-api/projects/add-a-domain-to-a-project, …/get-a-project-domain, …/verify-project-domain, vercel.com/docs/rest-api/domains/get-a-domain-s-configuration
const projectDomain = z.object({
  name: z.string(), apexName: z.string(), projectId: z.string(), verified: z.boolean(),
  verification: z.array(z.object({ type: z.string(), domain: z.string(), value: z.string(), reason: z.string() })).optional(),
});
const domainConfig = z.object({
  configuredBy: z.enum(['A', 'CNAME', 'dns-01', 'http']).nullable(), misconfigured: z.boolean(),
  recommendedCNAME: z.array(z.object({ rank: z.number(), value: z.string() })),
  recommendedIPv4: z.array(z.object({ rank: z.number(), value: z.array(z.string()) })),
  acceptedChallenges: z.array(z.string()),
});
const base = 'https://api.vercel.com';
const q = `?teamId=${encodeURIComponent(env.VERCEL_TEAM_ID)}`;
const headers = { Authorization: `Bearer ${env.VERCEL_TOKEN}`, 'Content-Type': 'application/json' };

async function check(host: string): Promise<DomainCheck> {
  const [pd, cfg] = await Promise.all([
    fetch(`${base}/v9/projects/${env.VERCEL_PROJECT_ID}/domains/${host}${q}`, { headers }).then(parse(projectDomain)),
    fetch(`${base}/v6/domains/${host}/config${q}&projectIdOrName=${env.VERCEL_PROJECT_ID}`, { headers }).then(parse(domainConfig)),
  ]);
  let ownershipVerified = pd.verified;
  if (!ownershipVerified) {
    const v = await fetch(`${base}/v9/projects/${env.VERCEL_PROJECT_ID}/domains/${host}/verify${q}`, { method: 'POST', headers });
    ownershipVerified = v.ok && (await v.json()).verified === true;   // 400 = TXT missing/mismatch → still pending
  }
  const records: DnsRecord[] = [];
  if (pd.name === pd.apexName) records.push({ type: 'A', name: host, value: cfg.recommendedIPv4.find(r => r.rank === 1)?.value[0] ?? '', purpose: 'routing' });
  else records.push({ type: 'CNAME', name: host, value: cfg.recommendedCNAME.find(r => r.rank === 1)?.value ?? '', purpose: 'routing' });
  for (const c of pd.verification ?? []) records.push({ type: 'TXT', name: c.domain, value: c.value, purpose: 'ownership' });
  return { ownershipVerified, configured: !cfg.misconfigured, records };
}
```

### Send Email Hook route (Hono)
```ts
// apps/api/src/routes/hooks.ts — Source: supabase.com/docs/guides/auth/auth-hooks/send-email-hook, …/auth-hooks
import { Webhook } from 'standardwebhooks';
export const hookRoutes = new Hono<AppEnv>().post('/auth/send-email', async (c) => {
  const raw = await c.req.text();
  const headers = { 'webhook-id': c.req.header('webhook-id') ?? '', 'webhook-timestamp': c.req.header('webhook-timestamp') ?? '', 'webhook-signature': c.req.header('webhook-signature') ?? '' };
  const secrets = env.SEND_EMAIL_HOOK_SECRETS.replace('v1,whsec_', '').split('|');
  const payload = verifyWithAny(secrets, raw, headers, (s) => new Webhook(s).verify(raw, headers));   // throws → 401 { error: { http_code: 401, message } }
  const { user, email_data } = sendEmailPayloadSchema.parse(payload);
  await sendAuthMail({ user, emailData: email_data, logger: c.get('logger') });   // resolves tenant, renders, transport.send with 3 s timeout
  return c.json({}, 200);
});
```

### Theme cookie + brand vars in layouts
```tsx
// apps/web/app/layout.tsx
import { cookies } from 'next/headers';
import { SerwistProvider } from '@serwist/turbopack/react';
export default async function RootLayout({ children }) {
  const theme = (await cookies()).get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
  return (
    <html lang="pt-BR" data-theme={theme} className={manrope.variable} suppressHydrationWarning>
      <body className="bg-bg text-text antialiased"><SerwistProvider swUrl="/serwist/sw.js"><NextIntlClientProvider>{children}</NextIntlClientProvider></SerwistProvider></body>
    </html>
  );
}
// apps/web/app/(app)/layout.tsx
export async function generateMetadata(): Promise<Metadata> {
  const { tenant } = await requireBootstrap();
  return { title: tenant.displayName, manifest: '/manifest.webmanifest', icons: { icon: tenant.branding.faviconUrl ?? undefined, apple: tenant.branding.iconUrls?.apple180 }, appleWebApp: { capable: true, title: tenant.displayName } };
}
export async function generateViewport(): Promise<Viewport> {
  const { tenant } = await requireBootstrap();
  return { themeColor: tenant.branding.colors.primary, viewportFit: 'cover', width: 'device-width', initialScale: 1 };
}
export default async function AppLayout({ children }) {
  const bootstrap = await requireBootstrap();
  return <AppShell bootstrap={bootstrap} style={brandStyleVars(bootstrap.tenant.branding)}>{children}</AppShell>;
}
```

### Signed upload from the panel (browser)
```ts
// Source: storage-js 2.116.0 uploadToSignedUrl implementation (PUT to signedUrl with content-type + x-upsert)
const { signedUrl, uploadId } = await startUpload({ kind: 'logo', mime: file.type, size: file.size });   // server action → API
const res = await fetch(signedUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type, 'x-upsert': 'false' } });
if (!res.ok) throw new Error('upload failed');
await completeUpload(uploadId);   // server action → API derives icons, writes branding
```

### Domain-verify job re-enqueue
```ts
// packages/core/server/jobs/kernel-jobs.ts — pattern from packages/core/server/jobs/boss.ts enqueueInTx + QUEUE_POLICY 'short'
export const domainVerifyJob: JobDefinition<{ domainId: string }> = {
  name: 'domain-verify',
  async handler({ domainId }) {
    const result = await checkDomain(domainId);        // platform lane: provider.check → row update → on verified: allow-list, invites, invalidate
    if (result.status === 'pending') await withAdminTx((tx) => enqueueInTx(tx, 'domain-verify', { domainId }, { singletonKey: domainId, startAfter: 600 }));
  },
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `[data-theme] { --color-*: var(--theme-*) }` re-declaration (prototype) | Tailwind v4 `@theme inline` | Tailwind 4.0 (2025) | Aliases resolve per element; one declaration |
| Global `cname.vercel-dns.com` CNAME | Per-project CNAME from `/v6/domains/{domain}/config` | Vercel docs updated 2026-08-28 | DNS instructions must be fetched, never hardcoded |
| `@react-email/components` | `react-email` single package (deprecated components package) | React Email 6 (2026) | Still too heavy for the API; plain HTML chosen |
| `middleware.ts` | `proxy.ts` (already in repo) | Next 16 | — |
| Supabase HS256 secret / SMTP templates | ES256 JWKS (in repo) / Send Email Hook | — | Branding needs the hook; SMTP stays fallback |
| `next-pwa` | `@serwist/turbopack` 9.5 | Next 15/16 Turbopack default | — |
| APCA as "WCAG 3 contrast" | WCAG 2.2 AA remains normative; APCA exploratory | July 2023 removal from draft | WCAG 2.x thresholds chosen |

**Deprecated/outdated:**
- `@react-email/components`: npm deprecation "Package no longer supported".
- STACK.md §6 `"use cache" + cacheTag('tenant-<id>')`: superseded for this phase (Cache Components not enabled; serverless in-memory cache does not persist).
- CONTEXT's `/m/[slug]/manifest.webmanifest` path idea: unnecessary with one origin per tenant (D-35); `/manifest.webmanifest` resolved by host.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The hosted Vercel token/team/project ids and `PATCH /v1/projects/{ref}/config/auth` with a PAT work as documented from Cloud Run (Phase 01.1 has not run) | Pattern 5 | Domain attach fails only in production; fake adapter keeps local/CI green — add to the 01.1 runbook |
| A2 | `POST /v10/projects/{id}/domains` returns `verified: true` immediately for a customer domain not used elsewhere on Vercel (TXT only when used by another account) | Pattern 5 | UI shows an unnecessary TXT step; harmless |
| A3 | `inviteUserByEmail` on an already-invited (unconfirmed) user re-sends the invite rather than erroring | Pattern 7 / resend | "Reenviar convite" may need `generateLink({ type: 'invite' })` + our transport instead |
| A4 | Hosted "Email OTP Expiration" can be raised to 86400 s (24 h) | Pattern 7 | Invites expire after 1 h; resend UX covers it |
| A5 | sharp composite options for the maskable icon (80 % safe zone, `gravity: 'centre'`) render as expected for SVG and transparent PNG inputs | Pattern 9 | Icon looks cropped on Android; unit test with fixtures catches it |
| A6 | Resend accepts an `Idempotency-Key` header on `emails.send` | Pitfall 6 | Fall back to the in-memory `webhook-id` LRU only |
| A7 | `[storage.buckets.*]` in `config.toml` seeds the bucket on `supabase start` but the hosted project needs a migration/insert | Pattern 9 | Hosted upload 404s until the bucket exists; the custom migration covers both |
| A8 | Mailpit `POST /api/v1/send` remains available in the CLI-bundled Mailpit (probed v1.30.2 today) | Pattern 6 | Fall back to SMTP `[local_smtp] smtp_port = 54325` + nodemailer |
| A9 | `next-request-in-use-cache` / Cache Components stay off; `cookies()` in the root layout is acceptable cost (all routes dynamic) | Pattern 3 | Slight TTFB cost on `/termos` etc.; acceptable for a branded app |
| A10 | Signed upload `PUT` needs no `apikey` header from the browser (docs: "without further authentication") | Pattern 9 | Add the publishable key header in the client fetch |
| A11 | `primaryDark = mix(primary, white 30%)` is a good default for the D-41 dark surface | Pattern 2 | Panel preview + contrast warning let the super_admin see it; tune constant |
| A12 | Vercel `verification[]` TXT record name is `_vercel.<apex>` (docs troubleshooting: `dig TXT _vercel.tenant1.com`); use `verification[].domain` verbatim anyway | Pattern 5 | None if `domain` field is shown as-is |

## Open Questions (RESOLVED)

_All five questions below were closed by the Phase 2 plan set (plan-checker iteration 1); the original text is kept verbatim, each item carries its "Resolved by" line._

1. **Hosted proof of the Vercel + Supabase Management calls**
   - What we know: endpoints, bodies and error codes from official docs; adapter written now, proven against the fake.
   - What's unclear: token scopes for a team token, whether the Cloud Run egress needs anything, PAT lifetime.
   - Recommendation: record "attach a real customer domain end-to-end" as a Phase 01.1-02 runbook item; keep `DOMAIN_PROVIDER=fake` outside production.
   - **Resolved by:** 02-09 `<assumption_delta_decision>` (hosted proof deferred to the 01.1 runbook, adapters proven against the fake) + 02-16 backstop prohibition (flat-scalar hosted Vercel/Supabase proof stays manual).
2. **Resend "Reenviar convite" mechanics** (A3)
   - Recommendation: implement resend as `inviteUserByEmail` first; if GoTrue answers "already registered", fall back to `generateLink({ type: 'invite', email, options: { redirectTo } })` and deliver through our own transport (the hook is bypassed by `generateLink`, so render the same template directly).
   - **Resolved by:** 02-10 Task 2 — `resendInvite` is `generateLink`-first through the 02-06 template/transport, with the `inviteUserByEmail` path kept as a flagged fallback recorded in the SUMMARY.
3. **Where the TXT challenge appears for a *fresh* domain** (A2) — only observable on Vercel; the UI handles both cases.
   - **Resolved by:** 02-09 — the fake provider's `needs-txt` hook emits the TXT record + `ownershipVerified false` on add and true on verify, so both shapes are exercised by `domains-fake.test.ts` and the panel UI (02-15) renders either.
4. **Tailwind + `@tria/ui` packaging** — whether `apps/web` scans `packages/ui/src` and `packages/core/ui` for classes (Tailwind v4 auto-detects from the CSS import graph; add `@source "../../packages/ui/src"; @source "../../packages/core/ui";` in `globals.css` to be explicit). Verify in Wave 0 that primitives' classes are emitted.
   - **Resolved by:** 02-02 — `apps/web/app/globals.css` carries explicit `@source` directives for `packages/ui/src` and `packages/core/ui` (acceptance-gated).
5. **Manrope font** — the prototype uses `next/font/google` Manrope; decide self-host (`next/font/local`, offline-friendly for the PWA) vs Google (needs network at build). Recommendation: `next/font/google` with `display: 'swap'` (fonts are inlined at build on Vercel).
   - **Resolved by:** 02-02 — Manrope via `next/font/google` exposed as the `--font-manrope` variable on `<html>`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | ✓ | v24.14.0 | — |
| pnpm | install | ✓ | 12.4.1 | — |
| Docker | Supabase local stack | ✓ | running | — |
| Supabase local stack (`pnpm supabase status`) | API/e2e/pgTAP | ✓ | CLI 2.117.0; Postgres :54322, API :54321, Mailpit :54324 | — |
| Mailpit HTTP API | `local` mail transport + e2e | ✓ | v1.30.2 (`/api/v1/send` → 200) | SMTP :54325 via `[local_smtp] smtp_port` |
| `dig` | manual DNS checks in the runbook | ✓ | — | — |
| Vercel CLI | not required (REST API used) | ✓ | 53.2.0 | — |
| Vercel/Supabase hosted projects | real domain adapter, hosted allow-list | ✗ (Phase 01.1 not run) | — | `DOMAIN_PROVIDER=fake`, allow-list `local` no-op |
| Resend account/API key | `resend` transport | ✗ locally by design | — | `MAIL_TRANSPORT=local` (Mailpit) |
| Disk space | `sharp`/`esbuild` binaries, Playwright browsers | ⚠ 2.1 GiB free (85 % used) | — | Free space before the install wave (memory note: disk hit 92 % on 2026-09-12) |
| Playwright browsers | e2e | ✓ (Phase 1 suite runs) | 1.63.0 | — |

**Missing dependencies with no fallback:** none for local execution.
**Missing dependencies with fallback:** hosted Vercel/Supabase/Resend (fake/local adapters); low disk (clean before installing).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.0 (unit: `packages/*`, `apps/api/tests/unit`; integration: `apps/api/tests/integration` against the local stack), Playwright 1.63.0 (`apps/web/e2e`, projects `mobile-chromium` iPhone 14 + `desktop-chromium`), pgTAP via `supabase test db` (`supabase/tests/*.sql`) |
| Config file | `packages/config/vitest.base.ts` merged per package; `apps/web/playwright.config.ts`; no Vitest in `apps/web` yet (**Wave 0**: add `apps/web/vitest.config.ts` + `packages/ui/vitest.config.ts` with `happy-dom` for component/theme tests) |
| Quick run command | `pnpm --filter @tria/core test` / `pnpm --filter @tria/contracts test` / `pnpm --filter @tria/api test` |
| Full suite command | `pnpm turbo lint typecheck test && pnpm test:integration && pnpm supabase test db && pnpm e2e` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TENANT-02 | Two hosts render only their own brand (vars, logo, `theme-color`, manifest name), login page branded before auth, no flash with JS disabled | e2e | `pnpm e2e -- branding.spec.ts` | ❌ Wave 0 `apps/web/e2e/branding.spec.ts` |
| TENANT-02 | No `(app)`/`(auth)` route prerendered static | build check | `pnpm --filter @tria/web build` (runs `scripts/check-no-static-routes.mjs`) | ❌ Wave 0 |
| TENANT-02 | Contrast/derivation pure functions (known WebAIM pairs, onPrimary choice, dark variant) | unit | `pnpm --filter @tria/contracts test -- branding` | ❌ `packages/contracts/tests/branding.test.ts` |
| TENANT-02 | by-host answer carries brand, `status`, `isPrimary`, `primaryHost`; unverified host → 404; suspended host → 200 with status | integration | `pnpm test:integration -- public-host` | ❌ (extend `apps/api/tests/integration/bootstrap.test.ts` or new `hosts.test.ts`) |
| TENANT-06 | Hook route: valid signature → 200 `{}` and Mailpit receives a branded mail (tenant name in subject, logo/primary in HTML); bad signature → 401; < 1 s | integration | `pnpm test:integration -- send-email-hook` | ❌ `apps/api/tests/integration/send-email-hook.test.ts` |
| TENANT-06 | Templates escape input, contain CTA with persisted colors, plain-text alternative | unit | `pnpm --filter @tria/core test -- mail` | ❌ `packages/core/tests/mail-templates.test.ts` |
| TENANT-06 | Real recovery e-mail through the enabled local hook shows tenant name (extends `recovery.spec.ts`) | e2e | `pnpm e2e -- recovery.spec.ts` | ✅ exists; extend assertion on subject/body |
| TENANT-07 | `DomainProvider` contract: fake and Vercel (mocked HTTP) produce the same `DomainCheck` shape; 409/400/404 mapping | unit | `pnpm --filter @tria/core test -- domains` | ❌ `packages/core/tests/domain-provider.test.ts` |
| TENANT-07 | Attach → pending row with DNS records → verify-now → `verified_at`, allow-list `add` called, host resolves, invite sent; remove → provider + allow-list `remove`; primary switch; 308 alias | integration + e2e | `pnpm test:integration -- domains` ; `pnpm e2e -- domains.spec.ts` | ❌ both |
| TENANT-07 | `domain-verify` job re-enqueues while pending, expires after deadline, idempotent singletonKey | integration | `pnpm test:integration -- domain-verify-job` (pattern: existing `jobs.test.ts`) | ❌ |
| MOD-04 / ROLE-04 | Toggle module → `tenant_modules` row, `moduleFlags.invalidate`, bootstrap nav changes, module route 404 (`MODULE_DISABLED`) without restart | integration | `pnpm test:integration -- modules` | ✅ `modules.test.ts` exists; extend with the platform PUT |
| MOD-04 | Nav composition (tabs vs topbar placement, order, kernel Início/Perfil) | unit | `pnpm --filter @tria/core test -- nav` | ❌ `packages/core/tests/nav.test.ts` |
| ROLE-03 | Create tenant: rows in `tenants`, `tenant_modules` (all keys, `example` false), `tenant_invites` pending; slug immutable; validation errors | integration | `pnpm test:integration -- platform-tenants` | ❌ |
| ROLE-03 | Invite flow e2e: verified host → invite mail → `/auth/confirm?type=invite` → `/aceitar-convite` → password + consents → `/inicio` as `admin_tenant`; expired link screen | e2e | `pnpm e2e -- invite.spec.ts` | ❌ |
| ROLE-05 | List with status + open detail; non-admin 403 (`platform.spec.ts` covers auth) | e2e | `pnpm e2e -- platform.spec.ts` | ✅ exists; extend |
| ROLE-03/07 | `tenant_invites`, `tenant_domains` new columns: RLS on, no tenant policy for invites (admin-lane only), `tenant_id` first in indexes, cross-tenant negative | pgTAP | `pnpm supabase test db` | ✅ `010`/`020`/`040` catalogue tests auto-cover; add explicit cases to `020-tenant-isolation.sql` |
| D-32 | Suspended tenant: bootstrap 403 `TENANT_SUSPENDED`, web redirects to `/auth/suspended` → branded screen; login refused | integration + e2e | `pnpm test:integration -- suspended`; `pnpm e2e -- suspended.spec.ts` | ❌ |
| UI-01 | `@tria/ui` primitives render, `Button` uses `--color-on-brand`, `BottomSheet` a11y (`role=dialog`, Escape) | unit (happy-dom) | `pnpm --filter @tria/ui test` | ❌ Wave 0 (framework install) |
| UI-03 | Grep guard: no legacy brand hex/`Igor Alves`/`btn-gold` outside `reference/` | lint | `pnpm lint` (+ `scripts/check-brand-literals.sh`) | ❌ |
| UI-04 | Design-team approval of the UI-SPEC mockup | manual | `checkpoint:human-verify` before panel/shell coding | — |
| PWA-01 | Manifest route 200/no-store/tenant name/icons; SW registered (`navigator.serviceWorker.ready`), `/~offline` precached; installability audit | e2e (+ manual iOS) | `pnpm e2e -- pwa.spec.ts`; manual: iOS Safari "Adicionar à Tela de Início" runs standalone | ❌ |
| PWA-01 | Icon derivation produces 192/512/maskable/180/favicon.ico with correct dimensions from PNG and SVG fixtures | unit | `pnpm --filter @tria/core test -- icons` | ❌ |
| PWA-03 | Every new string in `pt-BR.json`; no hardcoded pt-BR literals in TSX (grep for `>[A-ZÁÉÍÓÚ][a-záéíóú]+ ` heuristics is noisy — use `next-intl`'s missing-key error in tests) | unit/lint | `pnpm --filter @tria/web typecheck` (next-intl typed keys) | ❌ enable `next-intl` type-safe messages |

### Sampling Rate
- **Per task commit:** the owning package's `pnpm --filter <pkg> test` + `pnpm lint`
- **Per wave merge:** `pnpm turbo lint typecheck test` + `pnpm test:integration` + `pnpm supabase test db`
- **Phase gate:** full suite including `pnpm e2e` on both Playwright projects, the build-output check, and the manual iOS/Android standalone check before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `apps/web/vitest.config.ts` + `packages/ui/vitest.config.ts` (`happy-dom`, Testing Library) — framework install: `pnpm --filter @tria/web add -D vitest@5.0.0 happy-dom @testing-library/react@16.3.3 @testing-library/jest-dom@7.0.1 @vitejs/plugin-react@6.1.1`
- [ ] `apps/web/scripts/check-no-static-routes.mjs` wired into `build`
- [ ] `apps/web/e2e/branding.spec.ts`, `domains.spec.ts`, `invite.spec.ts`, `pwa.spec.ts`, `suspended.spec.ts`; fixtures: seed tenants with distinct brands + logos (`scripts/seed.ts`), `e2e/mail.ts` generalised from "recovery" to any `/auth/confirm` link (already generic in `extractConfirmLink`)
- [ ] `apps/api/tests/integration/{send-email-hook,domains,domain-verify-job,platform-tenants,suspended}.test.ts`
- [ ] `packages/contracts/tests/branding.test.ts`, `packages/core/tests/{domain-provider,mail-templates,nav,icons}.test.ts` (PNG/SVG fixtures under `packages/core/tests/fixtures/`)
- [ ] Local stack config: `[auth.hook.send_email]`, `[storage.buckets.branding]`, `otp_expiry = 86400`, `SEND_EMAIL_HOOK_SECRETS` in `scripts/local-env.sh`
- [ ] Spike: `@serwist/turbopack` build under TypeScript 7.0.2 (Pitfall 4)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase invite `token_hash` exchanged only in the `/auth/confirm` Route Handler; password policy D-10 (`minimum_password_length = 8`); expired links → dedicated screen, no token echo |
| V3 Session Management | yes | Existing HttpOnly/SameSite=Lax cookies; theme cookie is non-sensitive and not HttpOnly; `/auth/suspended` clears session like `/auth/blocked` |
| V4 Access Control | yes | `requireSuperAdmin()` on every `/v1/platform/*`; `withAdminTx` confined by Biome; `tenant_invites` admin-lane only (RLS, no policy); accept-invite only for the session's own `invited` membership; module toggle invalidates flags |
| V5 Input Validation | yes | Zod 4 on every body (`defaultHook` → `VALIDATION_FAILED`); host through `isRegistrableHost` + not `PLATFORM_HOST` + not already used; hex colors `^#[0-9a-f]{6}$`; slug `^[a-z0-9-]{3,40}$` (matches `tenants_slug_chk`); upload mime/size allow-list; `escapeHtml` in templates; `redirect_to` from the hook parsed with `new URL` and host checked against `tenant_domains` before use |
| V6 Cryptography | yes | `standardwebhooks` (HMAC-SHA256, timing-safe) for the hook; no custom crypto; secrets in Secret Manager |
| V10/V12 Files & Resources | yes | Storage-enforced `file_size_limit`/`allowed_mime_types`; SVG served only via `<img>`; objects keyed by server-generated UUID under `<tenant_id>/branding/` |
| V13 API / Web Services | yes | Hook route rate-limited by GoTrue's own budget; `Cache-Control: no-store` on all platform/public tenant answers; Vercel/Supabase tokens never leave the API |
| V14 Configuration | yes | `additional_redirect_urls` explicit per domain (WR-09); `DOMAIN_PROVIDER`/`MAIL_TRANSPORT` default to fake/local outside production (fail-safe) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged Send Email Hook call harvesting `token_hash` | Spoofing | standard-webhooks signature; timestamp tolerance; 401 on failure; the hook never returns the token |
| Open redirect via `redirect_to` in the hook / `next` in `/auth/confirm` | Tampering | Host must match a verified `tenant_domains` row or `PLATFORM_HOST`; existing `sameOriginPath` guard |
| Cross-tenant brand/host leak (cache key confusion) | Information disclosure | Host-normalised bounded caches, per-request bootstrap, build-output check, two-tenant e2e |
| Domain takeover: attaching a host owned by someone else | Spoofing | Vercel ownership `verified` + `misconfigured === false` required; only `super_admin` can attach; audit log line per attach/verify/remove |
| Allow-list wildcard creep | Elevation of privilege | Add/remove exact `https://<host>/auth/confirm**`; advisory lock; never `https://**` |
| Malicious SVG logo (script) | Tampering/XSS | Rasterised for icons; served as `<img>` only; CSP `img-src` includes the Storage origin, no `object`/inline |
| Invite replay / accepting someone else's invite | Spoofing | `token_hash` single-use (GoTrue); accept-invite acts on `ctx.userId`'s own membership only; consent versions validated (D-03 pattern) |
| Suspended tenant still serving members | Elevation of privilege | `TENANT_SUSPENDED` checked in `requireAuth` before membership status; host cache invalidated on suspend |
| Job storm on `domain-verify` | Denial of service | `singletonKey` + `short` policy; 7-day deadline; 10-min cadence; `rate_limit_exceeded` back-off |

## Sources

### Primary (HIGH confidence — read in this session)
- Repository files (line-cited above): `packages/contracts/src/{hosts,bootstrap,platform,modules,errors,index}.ts`, `packages/core/server/modules/{manifest,flags-cache}.ts`, `packages/core/server/tenancy/tenant-host.ts`, `packages/core/server/auth/require-auth.ts`, `packages/core/server/jobs/boss.ts`, `packages/core/server/platform/*`, `packages/core/db/schema/{tenants,tenant-domains,memberships,tenant-modules}.ts`, `apps/api/src/{app,worker,env}.ts`, `apps/api/src/routes/{platform,public}.ts`, `apps/api/src/modules/registry.ts`, `apps/web/{proxy.ts,next.config.ts,lib/{tenant-host,bootstrap,platform,env}.ts,app/layout.tsx,app/(app)/layout.tsx,app/(auth)/layout.tsx,app/auth/confirm/route.ts,app/(auth)/redefinir-senha/*,e2e/{fixtures,mail}.ts,playwright.config.ts,.next/{prerender-manifest,app-path-routes-manifest}.json,.turbo/turbo-build.log}`, `supabase/config.toml`, `supabase/templates/recovery.html`, `scripts/seed.ts`, `packages/core/docs/SCHEMA-CONVENTIONS.md`, `docs/DEPLOY.md`, `.planning/research/{PROTOTYPE,PITFALLS}.md`, `reference/frontend-design/{app/globals.css,app/layout.tsx,contexts/ThemeContext.tsx,components/layout/*,lib/nav.ts,public/manifest.json,package.json}`
- `node_modules/.pnpm/@supabase+storage-js@2.116.0/…/dist/index.mjs` (`uploadToSignedUrl`, `createSignedUploadUrl`), GoTrueAdminApi.ts (`inviteUserByEmail` signature)
- npm registry (`npm view`, `package-legitimacy check`) for every version/download figure (2026-09-14)
- Live probes: `pnpm supabase status`, Mailpit `POST /api/v1/send` → 200 (v1.30.2), `node/pnpm/docker/vercel` versions, disk

### Secondary (MEDIUM confidence — official documentation fetched this session; the seam classifies WebFetch as LOW, provenance rule treats official docs as `[CITED]`)
- https://vercel.com/docs/rest-api/projects/add-a-domain-to-a-project — `POST /v10/projects/{idOrName}/domains`, response schema, error list
- https://vercel.com/docs/rest-api/projects/get-a-project-domain, …/verify-project-domain — `/v9` paths, `verification[]`, 400 TXT messages
- https://vercel.com/docs/rest-api/domains/get-a-domain-s-configuration — `/v6/domains/{domain}/config`, `configuredBy`, `misconfigured`, `recommendedCNAME/IPv4`
- https://vercel.com/docs/platforms/multi-tenant-platforms/configuring-domains and …/reference — flow order, error codes, TXT troubleshooting, domain limits
- https://vercel.com/docs/domains/working-with-domains/add-a-domain — per-project CNAME (`d1d4fc829fe7bc7c.vercel-dns-017.com`), A for apex, TXT when used by another account
- https://supabase.com/docs/reference/api/v1-update-auth-service-config — `PATCH /v1/projects/{ref}/config/auth`, `uri_allow_list: string`, scope `auth:write`
- https://supabase.com/docs/guides/self-hosting/auth/config, https://supabase.com/docs/guides/auth/redirect-urls — comma-separated list, glob rules, production caution
- https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook, https://supabase.com/docs/guides/auth/auth-hooks — payload, action types, headers, secret format, 5 s budget/retries, status-code handling, config block
- https://github.com/supabase/auth (README) — `MAILER_OTP_EXP` covers invite links; `/invite` endpoint
- https://supabase.com/docs/guides/local-development/cli/config — hook config keys, `otp_expiry`, template types, `storage.buckets`
- https://serwist.pages.dev/docs/next/turbo and https://github.com/serwist/serwist/tree/main/examples/next-turbo-basic (raw files) — `withSerwist`, `createSerwistRoute`, `app/sw.ts`, `SerwistProvider`, tsconfig `webworker`, TS6 alias in the example
- https://nextjs.org/docs/app/guides/progressive-web-apps — install prompt, headers, `useOffline`, Serwist pointers
- https://nextjs.org/docs/app/api-reference/directives/use-cache — `cacheComponents` requirement, request-API restriction, serverless persistence note
- https://nextjs.org/docs/app/api-reference/functions/generate-viewport — `themeColor`, `viewportFit`
- https://tailwindcss.com/docs/theme, https://tailwindcss.com/docs/dark-mode — `@theme inline`, `@custom-variant dark ([data-theme=dark])`
- https://adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html (via WebSearch) — APCA non-normative status

### Tertiary (LOW confidence)
- WebSearch summaries on `react-email` v6 consolidation (github.com/resend/react-email issue #3556) — corroborated by `npm view react-email dependencies`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version read from the registry; legitimacy seam run; peer/engine ranges checked
- Architecture: MEDIUM-HIGH — built on read source files; external contracts from official docs; hosted behaviour untested (Phase 01.1)
- Pitfalls: MEDIUM — Next/Vercel/GoTrue behaviours cited from docs; two (TS7 + serwist, hook idempotency) need the Wave 0 spike
- Validation: HIGH for infrastructure (existing suites inspected), MEDIUM for the new spec list

**Research date:** 2026-09-14
**Valid until:** 2026-10-14 for the stack/docs; re-check Vercel domain docs and `@serwist/turbopack` releases before Phase 01.1 runs the hosted proof
