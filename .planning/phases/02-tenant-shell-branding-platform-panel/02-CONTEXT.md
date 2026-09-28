# Phase 2: Tenant Shell, Branding & Platform Panel - Context

**Gathered:** 2026-09-14
**Status:** Ready for planning

> Decision numbering continues from Phase 1 (D-01..D-24 in `01-CONTEXT.md`) because code comments already cite those ids; this phase owns **D-25..D-42**.

<domain>
## Phase Boundary

Phase 2 turns the functional-minimal Phase 1 app into the tenant's own branded, installable product and gives Rede Social a platform panel to provision tenants without touching the database:

- **Branded shell (TENANT-02, UI-01, UI-03, PWA-01, PWA-03):** the prototype's design tokens and shared primitives are ported into `@rede-social/ui` (`packages/ui`); a responsive `AppShell` (mobile TopBar + floating BottomNav, desktop left rail + centred column) lives in `packages/core/ui`; the tenant's logo, colors, favicon and display name are server-rendered with no default-brand flash; navigation is registry-driven (MOD-04); light + dark theme; per-tenant manifest + icons + service worker so the app installs and runs standalone on iOS and Android; every shell/auth string in the pt-BR catalog.
- **Branded public pages:** `/entrar`, `/cadastro`, `/esqueci-senha`, `/redefinir-senha` on a tenant host already carry that tenant's brand before authentication (roadmap success criterion 1); the Phase 1 plain forms get the prototype's visual port.
- **Platform panel on the platform host (ROLE-03, ROLE-04, ROLE-05, TENANT-07, UI-04):** `super_admin` creates a tenant (name, slug, initial colors, modules, first admin e-mail), lists tenants with status, opens a tenant page (branding with logo/icon upload, module toggles effective without redeploy, custom domains with DNS instructions + verification status, admin invites, suspend/reactivate). Panel screens are designed in the prototype's language and approved by the design team before implementation.
- **Custom domains (TENANT-07, D-20..D-24 follow-through):** attach a customer-owned host, register it with the hosting provider (Vercel Domains REST API) and the Supabase Auth redirect allow-list, show the DNS records, poll verification, aliases redirect to the primary.
- **Branded auth e-mails (TENANT-06):** recovery and invite e-mails carry the tenant's display name, logo and primary color via the Supabase Send Email Hook → API → Resend.
- **First-admin onboarding:** invite link → "aceitar convite" screen (password + the two consents) on the tenant domain.

Out of this phase: any content module (feed, stories, communities, events, chat, notifications — Phases 4-7), profiles UI and the media pipeline (Phase 3; only the kernel branding upload ships here), the tenant admin panel / `admin_tenant` branding editor (ADMIN-01, Phase 8 — but it will reuse this phase's branding endpoints), Web Push and the iOS install hint *wiring* (Phase 7; the hint component is built here, unused), cloud provisioning (Phase 01.1 — this phase is developed and verified on the local stack; the Vercel/Supabase provider calls run through an adapter with a local fake).

</domain>

<decisions>
## Implementation Decisions

### Tenant branding model
- **D-25:** A tenant's brand is **primary color + secondary color + logo + display name** (+ an optional square app icon, D-28). Everything else is derived: `--brand-on-primary` (white/navy by contrast), hover/tint/shade steps and the CTA gradients via `color-mix`, dark-mode variants (D-41); background, text, border and surface colors stay the neutral design tokens ported from the prototype. `tenants.branding.colors` gets **fixed keys `primary` and `secondary`** (hex); derived values that non-CSS consumers need (e-mail templates, manifest `theme_color`) are persisted alongside at save time. — **Reversibility:** costly — the key names are read by the bootstrap contract, the public by-host brand answer, the manifest route, the e-mail templates and the panel form; renaming them touches every consumer and needs a jsonb backfill.
- **D-26:** The logo is rendered **as-is** (colored PNG/SVG/WebP), never as a tinted monochrome mask; the prototype's `.brand-ig-mark` technique is **not ported**. The shell constrains height (TopBar / rail) and the auth pages show it larger; when a tenant has no logo yet, the display name renders as text in its place.
- **D-27:** Logo/icon upload ships in this phase as a **kernel (platform-lane) capability, not the media module**: the panel asks the API for a signed upload URL, the browser uploads directly to the **public `branding` bucket** under `<tenant_id>/branding/<uuid>.<ext>`, then calls a `complete` endpoint that verifies the object, derives the icon set with `sharp` (D-28) and writes the URLs into `tenants.branding`. Accepted: PNG, SVG, WebP, JPEG; small size cap (order of 2 MB). Phase 3's media pipeline reuses the same signed-upload shape; Phase 8's ADMIN-01 reuses these endpoints under `admin_tenant`. — **Reversibility:** reversible — the bucket layout follows STACK.md §4 and the endpoints are additive.
- **D-28:** Favicon and PWA icons are **derived from the logo by default** — `favicon.ico`, `icon-192.png`, `icon-512.png`, a **maskable** 512 (logo centred inside the safe zone over the primary color) and `apple-touch-icon` 180 — with an **optional square-icon override** the `super_admin` can upload when the logo is horizontal or illegible in a square; the override replaces the whole derived set.
- **Locked by the roadmap (criterion 1):** on a tenant host the public auth pages render the tenant's logo, colors and display name before login. The public by-host answer therefore has to carry the brand (how: Claude's discretion below); it must stay `.strict()` and carry nothing beyond brand fields.

### Platform panel: tenant creation and first admin
- **D-29:** The first `admin_tenant` joins through a **Supabase invite link + an "aceitar convite" screen**. The API pre-creates the membership (`role = admin_tenant`, `status = invited`) and calls `auth.admin.inviteUserByEmail` with `redirectTo` on the tenant's primary verified host. The link opens a pt-BR page on the tenant domain (path suggestion `/aceitar-convite`) that says "Você foi convidado(a) a administrar {tenant}", sets the password (D-10 policy, min 8) **and records both consents** (tenant rules + Rede Social terms — same `consent_records` rows as D-03, AUTH-04 is not skipped for admins), then flips the membership to `active` and lands on `/inicio`. Reuses `/auth/confirm` (token_hash, type `invite`) and the password-setting logic of `/redefinir-senha`. — **Reversibility:** costly — once real invites are sent, the screen path and the consent-at-accept rule are part of every tenant admin's onboarding; changing them invalidates outstanding links and the LGPD evidence shape.
- **D-30:** Invite timing: the admin e-mail is collected at tenant creation and stored as a **pending invite** (suggested `tenant_invites`: `tenant_id`, `email`, `role`, `status pending|sent|accepted|expired`, `sent_at`, `accepted_at`, `created_by`). `inviteUserByEmail` is called **automatically when the tenant's primary domain becomes verified** (D-34) — immediately at creation if a verified primary host already exists (seed tenants, D-24). The panel shows "Convite pendente — aguardando domínio" / "Convite enviado em …" / "Aceito" and always offers **"Reenviar convite"**.
- **D-31:** Creation is a **single "Novo tenant" form → tenant page with tabs**. Form: display name; slug (suggested from the name, editable, **immutable after creation**); primary + secondary hex with a live swatch preview and contrast feedback; module checklist with all six real modules on by default (D-17; `example` is never listed, D-19); first admin e-mail. Submit creates `tenants` + `tenant_modules` + the pending invite and redirects to the tenant page, whose tabs are **Marca** (logo + optional icon upload, colors, live preview of TopBar/login in light and dark), **Módulos** (toggles; effect within the flags-cache TTL, no redeploy), **Domínios** (D-34/D-35), **Admins** (invite state, resend, admin_tenant memberships), **Status** (active/suspended with confirm). Logo upload lives on the tenant page because the storage key needs the `tenant_id`.
- **D-32:** `super_admin` can **suspend and reactivate** a tenant (`tenants.status` already allows `active|suspended`). A suspended tenant refuses member bootstrap/login with a 403 envelope code and a pt-BR screen in the D-09 pattern ("Esta comunidade está temporariamente indisponível."); the public shell still resolves the host so the screen is branded. Exact code and copy: Claude's discretion.
- **D-33:** **UI-04 review pattern (reused by Phases 4-8):** `/gsd-ui-phase 2` produces the UI-SPEC in the prototype's visual language for the screens the prototype lacks (tenant list, new tenant, tenant page tabs, domain attach, accept-invite, settings, desktop shell/rail); a **static HTML mockup** (`/gsd-sketch`) is shared with the design team and **approved before the panel/shell screens are coded**. The plan orders schema, API, domain-provider adapter, e-mail hook and `@rede-social/ui` primitives first so the approval is not on the critical path, and models the approval as a human-verify checkpoint. The platform panel is **desktop-first but responsive** (tables, forms, side navigation) and lives only on the platform host (D-21).

### Custom domains
- **D-34:** Attach flow: `super_admin` enters a host (apex or subdomain, `tenant_domains_host_chk` shape) → API validates (registrable, unused, not the platform host) → registers it with the hosting provider (Vercel Domains REST API, project-scoped) → stores the `tenant_domains` row with `verified_at = null` → the panel shows the **DNS records to create** from the provider's answer (CNAME for a subdomain, A record for an apex, plus the TXT ownership challenge when the provider demands one) with copy buttons and status "Aguardando DNS". A **pg-boss job polls verification** (order of every 10 min, up to ~7 days, then "Expirado" with the option to restart) and the panel has **"Verificar agora"** for an on-demand check. On verified: `verified_at` set, host added to that Supabase project's Auth redirect allow-list (Management API), pending admin invite sent (D-30), status "Verificado". Removing a host removes it from the provider and the allow-list. — **Reversibility:** costly — the provider adapter contract and the `tenant_domains` lifecycle (`verified_at`, polling job) are consumed by the invite flow, `proxy.ts` and the seed.
- **D-35:** A tenant may have several verified hosts but **exactly one primary**; **non-primary hosts 308-redirect to the primary** preserving path and query (done in `proxy.ts`; the by-host answer must expose whether the host is primary and which host is). Rationale: PWA installs, session cookies and push subscriptions are per origin — one origin per tenant. The primary can be switched among verified hosts in the panel; the primary cannot be removed while other hosts exist (promote another first).
- **D-36:** **Only verified hosts resolve** in `proxy.ts` / `GET /v1/public/tenants/by-host` (`verified_at is not null`); an unverified host renders the generic shell. Local/dev/CI use a **fake domain-provider adapter** (env-selected) that returns fixed DNS instructions and verifies on the first check, so the whole flow is e2e-testable without Vercel; the seed keeps registering the platform-owned hosts as already verified (D-24).

### Branded auth e-mails
- **D-37:** Auth e-mails are branded through the **Supabase Send Email Hook → API → Resend**: GoTrue calls a signed HTTPS hook on the API for every auth e-mail; the API resolves the tenant from the user's membership (recovery, invite) or, when the user has no membership yet, from the `redirect_to` host via `tenant_domains`; on the platform host / `platform_admins` it uses a neutral platform template. Templates (pt-BR) exist for recovery and invite, with a neutral fallback for the other GoTrue types; the API sends through the **Resend HTTP API** (a mail-transport adapter with `resend` and `local` implementations so local dev never sends real mail). Phase 1's `/esqueci-senha` (`resetPasswordForEmail` through `@supabase/ssr`) is **unchanged**. Locally the hook is enabled in `supabase/config.toml` (`[auth.hook.send_email]`). — **Reversibility:** costly — supersedes D-13's SMTP path for auth mail (Custom SMTP stays configured only as the fallback when the hook is disabled); the template engine chosen here is what Phase 7 reuses for notification mail.
- **D-38:** Sender and signature: **From `{tenant displayName} <no-reply@{Rede Social sending domain}>`** (the D-13 mail subdomain), pt-BR subject naming the tenant ("Redefina sua senha — {tenant}"), body with the tenant logo (display name as text when there is no logo), a primary-colored CTA with `--brand-on-primary` text, a plain-text alternative, and a **small muted footer "Enviado pela plataforma Rede Social"**. No Rede Social logo in the body.

### App shell, navigation, theme, home
- **D-39:** **Desktop = left rail + centred column; mobile = the prototype's TopBar + floating glass BottomNav.** The rail carries the tenant logo on top, the registry nav items with icon + label, and the bell/chat/theme/logout affordances; content sits in a centred column with a max width in the ~640-720 px range on a neutral ground. The iPhone `DeviceShell` mockup is **not shipped**; the shell reproduces the prototype's `--safe-*` / scroll-container contract so fixed sub-headers and composers keep working (PROTOTYPE.md §9 risk 2). Built in `packages/core/ui` as `AppShell` on top of `@rede-social/ui` primitives.
- **D-40:** Navigation with every module on: **tabs = Início, Comunidades, Eventos, Perfil; TopBar slots = bell (notifications, unread badge) and chat bubble (support, unread badge)**. Tabs come from the registry `nav` entries of *enabled* modules in `order` (`feed` → "Início", `communities`, `events`) plus the kernel's "Perfil" always last; `notifications` and `chat` declare a TopBar placement instead of a tab (manifest shape: Claude's discretion); `stories` has no nav entry (it is a strip on Início from Phase 5). A disabled module's tab/slot disappears. In this phase only the kernel entries render (Início, Perfil); module tabs appear as their modules ship. The notifications icon is `Bell`, not the prototype's `Heart`.
- **D-41:** **Light + dark with a user toggle.** Default light; the toggle lives on the settings page; the preference is persisted per device in a way the server can read (cookie) so `data-theme` is rendered on the first HTML with no flash; the prototype's two-layer token model (`--theme-*` raw → `--color-*` aliases re-declared under `[data-theme]`) is kept. The tenant's primary color gets an **automatically derived dark-surface variant** (`color-mix` towards white, tuned) and the branding save validates contrast **in both modes**; the panel preview shows both.
- **D-42:** **Home is a kernel page at `/inicio`** (tab "Início", first). In this phase it shows a branded welcome ("Bem-vindo(a) à {tenant}", logo) and an `EmptyState` "Em breve". The registry gains a **home-slot concept** so later modules register widgets in order (stories strip, feed list) and the home still renders the remaining widgets when `feed` is off. **Amends D-07:** the post-login path stays `/inicio` (not `/feed`); whether the feed module also owns `/feed` for deep links is the Phase 4 planner's call. A minimal **settings page** (`/configuracoes`) holds the theme toggle and "Sair" (D-08) with placeholder rows for profile edit (Phase 3) and push (Phase 7).
- **PWA (locked by the roadmap; details Claude's):** per-tenant manifest from a `no-store` route handler (name/short_name = display name, `theme_color` = primary, `background_color` = neutral bg, icons from D-28, `display: standalone`, `start_url`/`scope` = `/`, `id` per tenant), serwist service worker via `@serwist/turbopack`, pt-BR offline fallback page; the iOS "Adicionar à Tela de Início" hint component is built and left unmounted until Phase 7 (PWA-02).

### Claude's Discretion
- How the public by-host answer exposes the brand (extend `hostTenantSchema` with a `branding` object vs a sibling public route) and how `proxy.ts` / the auth layout receive it (headers are size-limited — probably a second cached fetch in the layout keyed by host); cache TTLs and a cache bust when branding changes so a new logo appears within minutes.
- Domain-provider adapter interface (`addDomain`, `getDnsRecords`, `verify`, `removeDomain`), the Supabase Management API call for the allow-list, secret placement (Vercel token, project id, Supabase PAT in Secret Manager), the TXT ownership-challenge handling, polling cadence/backoff and job idempotency. Phase 01.1 has not run: the real adapter is written now and proven only against the fake locally; the hosted proof is recorded as an item for the 01.1 runbook.
- Send-email hook path, signature verification, template engine (React Email vs plain HTML strings), the `local` mail transport (log / dev inbox), and how derived brand colors reach the templates (persisted at save time — CSS `color-mix` is unavailable in e-mail).
- Registry extensions (`nav.placement`, home slots, settings rows), `@rede-social/ui` layout (`tokens.css`, `@theme inline`, `cn`, hooks) and which prototype primitives beyond UI-01's list are ported now (PROTOTYPE.md §9 A2-A6): port what this phase's screens need, the rest lazily per phase.
- Contrast algorithm (WCAG 2.x vs APCA) and thresholds; on failure the panel should warn and require explicit confirmation rather than block.
- Suspended-tenant envelope code and screen copy (D-09 pattern); platform panel URL space (suggestion `/plataforma/*`), list search/filters/pagination.
- Service-worker caching strategy, offline page, update prompt; theme cookie name; invite-link expiry (Supabase default) and what an expired link shows.
- pt-BR catalog organisation: keep the single next-intl catalog, namespaced per kernel area / module.
- Test strategy: extend the two-tenant Playwright smoke to assert brand isolation (A's brand never on B's host, no default-brand flash), a build-output check that no authenticated route is static, and e2e for attach-domain (fake provider) → verified → invite → accept.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` §"Phase 2: Tenant Shell, Branding & Platform Panel" — goal, the four success criteria, research-needed list (Vercel Domains API, serwist under Next 16.3, branded e-mails), notes (UI-SPEC review pattern, `no-store` manifest/icons, iOS hint built but unwired)
- `.planning/REQUIREMENTS.md` — TENANT-02, TENANT-06, TENANT-07, MOD-04, ROLE-03, ROLE-04, ROLE-05, UI-01, UI-03, UI-04, PWA-01, PWA-03 (exact wording); ADMIN-01 (Phase 8) for what the branding endpoints must later serve
- `.planning/PROJECT.md` §Constraints, §Key Decisions, §Out of Scope — locked stack, Free plan, "no tenant subdomains / no DNS automation on the customer's behalf", design prototype is the UI source of truth

### Prior decisions this phase builds on
- `.planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-CONTEXT.md` — D-01..D-24; especially D-03 (consent records), D-07 (amended by D-42), D-08/D-09 (logout, blocked-member pattern), D-10 (password policy, recovery), D-13 (Resend SMTP, superseded for auth mail by D-37), D-16/D-17 (modules), D-18 (`@rede-social/*` layout), D-20..D-24 (domains, platform host, host mismatch, seed hosts)
- `.planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-VERIFICATION.md` — what Phase 1 proved and the isolation suite this phase extends
- `.planning/STATE.md` §Accumulated Context → Decisions — Phase 1 execution truths (proxy host cache, `x-forwarded-host` first, cookie options, platform host authorised by the API, flags cache, event bus)

### Architecture, schema and pitfalls
- `.planning/research/ARCHITECTURE.md` §Pattern 3 (module registry, `tenant_modules`, bootstrap shape) and §Pattern 4 (login → tenant → theme flow; written for the single-URL premise — read with D-20..D-24)
- `.planning/research/PITFALLS.md` §Pitfall 2 (Next caches one tenant's branding for another), §Pitfall 5 (flash-of-wrong-brand, per-tenant manifest/favicon), §Pitfall 6 (iOS push/install), §Pitfall 8 (uploads through the API), §Pitfall 13 (environments)
- `packages/core/docs/SCHEMA-CONVENTIONS.md` — `tenant_id` first in every index, RLS conventions, admin-lane-only writes
- `.planning/research/STACK.md` §Stack Patterns 1 (PWA: serwist, per-tenant manifest route, icons via `sharp`, install UX), 2 (auth endpoints, tenant scoping), 4 (buckets: `branding` public, key prefix), 6 (white-label theming with `@theme inline`, `"use cache"` + `cacheTag('tenant-<id>')`)
- `.claude/CLAUDE.md` §Technology Stack and §"What NOT to Use" — pinned versions, `@serwist/turbopack` not `next-pwa`, no `beforeinstallprompt`-only UX, no uploads through Cloud Run

### Design prototype (visual source of truth)
- `.planning/research/PROTOTYPE.md` §2 Design tokens (color model, hardcoded hex inventory, "what must change for TENANT-02"), §5 Component inventory (`components/ui/*`, `components/layout/*` port notes), §7 Interaction details, §9 Port plan Phase A (A1-A10 map directly onto this phase), §10 Open questions 6-9 and 12 (desktop, bell, dark mode, branding limits, copy — answered by D-26, D-39, D-40, D-41)
- `reference/frontend-design/app/globals.css` — two-layer token model, `[data-theme]` re-declaration trick, `.glass-bar`, safe-area classes
- `reference/frontend-design/components/ui/*` — Button, IconButton, Avatar, Badge, BottomSheet, ConfirmDialog, EmptyState, Input, Skeleton, Tabs, Toast (UI-01 list)
- `reference/frontend-design/components/layout/{TopBar,BottomNav,AreaTabs,PullToRefresh,SafeAreaWrapper}.tsx` — shell components to port with registry-driven slots
- `reference/frontend-design/contexts/ThemeContext.tsx` — light/dark toggle behaviour to port (D-41), moving persistence to a cookie
- `reference/frontend-design/app/(auth)/{login,register,forgot-password}/page.tsx` — visuals for the auth pages' port
- `reference/frontend-design/public/manifest.json` — what the prototype's manifest had (single icon, no maskable) and must not be copied as-is

### Deployment
- `docs/DEPLOY.md` — environments, seed hosts, runbook; the custom-domain runbook item is a Phase 01.1-02 deliverable this phase's provider adapter must match

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/ui` (`@rede-social/ui`) exists as an empty package with the right name and exports map — the port target for tokens and primitives (D-18).
- `packages/core/db/schema/tenants.ts` — `branding` jsonb already typed `{ logoUrl, faviconUrl, colors }`, `status` CHECK `active|suspended`, `plan`, `timezone`; `tenant-domains.ts` — `host` citext unique, `is_primary` (one per tenant, partial unique index), `verified_at`, cascade delete. Phase 2 adds columns/keys, no rewrite.
- `packages/core/db/schema/memberships.ts` — `status` CHECK already includes `invited` (D-29 needs no migration for the status).
- `packages/contracts/src/bootstrap.ts` — `tenant.branding` and `modules[].nav { label, icon, href, order }` already flow to the web app; `platform.ts` — `platformTenantsSchema` (thin list) is the base for the panel list; `hosts.ts` — `hostTenantSchema` is `.strict()` `{ slug, displayName }` (extend or sibling, see discretion), `normalizeHost`, `createBoundedTtlCache`.
- `packages/core/server/modules/manifest.ts` — `ModuleManifest { key, nav?, routes?, jobs?, events?, defaultRolePermissions? }` + `defineModule`; `flags-cache.ts` (30 s tenant-keyed cache with `invalidate(tenantId)`) — the module toggle in the panel must call the invalidation or accept the TTL.
- `packages/core/server/platform/*` — `requireSuperAdmin`, `listPlatformTenants`, admin-lane readers; `apps/api/src/routes/platform.ts` — the platform `OpenAPIHono<PlatformEnv>` to extend with create/update/modules/domains/invites/branding routes.
- `apps/web/lib/tenant-host.ts` + `proxy.ts` — host classification (`tenant|platform|generic`), header hand-off (`x-tenant-mode/host/slug/name`), 300/60/10 s cache; `lib/bootstrap.ts` — `requireBootstrap()` / `loadOrRedirect()` / `bootstrapRedirectPath()` (add the suspended code here); `lib/platform.ts` — `requirePlatformTenants()`.
- `apps/web/app/(app)/layout.tsx` — the current inline `TopBar` + `<main>` is the seam where `AppShell` goes; `app/layout.tsx` — neutral metadata to replace with tenant `generateMetadata` (manifest, icons, theme-color); `app/(auth)/layout.tsx` — neutral auth chrome to brand.
- `apps/web/app/auth/confirm/route.ts` (token_hash exchange) and `app/(auth)/redefinir-senha/*` — reused by the accept-invite screen (D-29).
- `apps/web/messages/pt-BR.json` + `i18n/request.ts` — next-intl single catalog without routing; namespaces `common, login, signup, forgot, reset, suspended, hostMismatch, noCommunity, platform, app, example, legal`.
- `apps/api/src/worker.ts` + kernel `jobs` (pg-boss, `registerJobQueues`) — the domain-verification poller (D-34) is a kernel job following the module job pattern.
- `apps/web/e2e/*` + `playwright.config.ts` — two-tenant fixtures (`rede-demo.localhost`, `rede-lab.localhost`, platform host `rede-social.localhost`), mobile + desktop projects.
- Prototype (read-only, git-ignored clone) — source of every primitive and shell component; port, never refactor in place.

### Established Patterns
- Host selects the public shell; membership is the authority (D-23) — brand on the public pages comes from the host tenant, brand inside the app comes from `/me/bootstrap`; they must be the same tenant or the API already refused with `TENANT_HOST_MISMATCH`.
- Every API refusal is a stable envelope code mapped to a redirect in `bootstrapRedirectPath` / `platformRedirectPath`; 403s that must clear cookies go through Route Handlers under `/auth/*`.
- Cross-tenant reads/writes live only in `packages/core/server/platform/*` behind `withAdminTx` (Biome confines it); the panel's mutations (create tenant, toggle module, attach domain, invite) belong there, never in module packages.
- Kernel never imports a module (MOD-02); registry composition happens in `apps/api/src/modules/registry.ts` and, for the web, an equivalent composition point the shell reads from bootstrap.
- Migrations: Drizzle schema → `drizzle-kit generate` → `supabase/migrations` → Supabase CLI applies; `tenant_id` first in indexes; new tables get RLS + a select-only tenant policy unless admin-lane-only.
- next-intl single pt-BR catalog; pt-BR route paths (`/entrar`, `/cadastro`, `/inicio`); `PLATFORM_HOST` env drives the platform mode; `*.localhost` hosts in dev.

### Integration Points
- `apps/web/app/(app)/layout.tsx` → `AppShell` (brand vars on `<html>`/`<body>`, theme cookie → `data-theme`, registry nav from bootstrap); `app/layout.tsx` → per-tenant `generateMetadata`; `app/m/[slug]/manifest.webmanifest/route.ts` (or equivalent) `no-store`; `app/sw.ts` + serwist route.
- `apps/web/app/(auth)/*` → branded layout fed by the host tenant's public brand; new `/aceitar-convite`; `/configuracoes` settings page.
- `apps/web/app/(app)/plataforma/*` (suggested) → panel screens on the platform host; `proxy.ts` gains the alias 308 (D-35).
- `apps/api/src/routes/platform.ts` → tenant CRUD, modules toggle, branding signed-upload + complete, domains attach/verify/remove/primary, invites send/resend; `apps/api/src/routes/public.ts` → brand in the by-host answer; new hook route for Send Email; kernel job `domain-verify`.
- `packages/core/db/schema/*` → `tenant_invites` (suggested), branding keys, any domain status columns; `supabase/config.toml` → `[auth.hook.send_email]`, redirect allow-list handling per environment.
- `scripts/seed.ts` → seed tenants get verified hosts, brand colors and a logo placeholder so the smoke test can assert two different brands.

</code_context>

<specifics>
## Specific Ideas

- Invite screen copy: "Você foi convidado(a) a administrar {tenant}"; the two consent checkboxes reuse the D-03 wording.
- Suspended copy (suggested): "Esta comunidade está temporariamente indisponível."
- E-mail: From "{Tenant} <no-reply@mail.{rede-social-domain}>", subject "Redefina sua senha — {tenant}", footer "Enviado pela plataforma Rede Social", CTA in the primary color.
- Panel tenant-page tabs, in order: Marca · Módulos · Domínios · Admins · Status. Domain rows show host, primary badge, status (Aguardando DNS / Verificado / Expirado), DNS records with copy buttons, "Verificar agora".
- Home in this phase: logo, "Bem-vindo(a) à {tenant}", EmptyState "Em breve"; settings page with the theme toggle and "Sair".
- Two-tenant smoke: log in on `rede-demo.localhost` and `rede-lab.localhost`, assert each shell shows only its brand (logo URL, `--brand-primary`, `theme-color`, manifest name) and that the login page is already branded before auth.

</specifics>

<deferred>
## Deferred Ideas

- `admin_tenant` editing the brand from inside the app (ADMIN-01) — Phase 8; this phase's branding endpoints and preview component are built to be reused there.
- Android install prompt (`beforeinstallprompt`) UX and iOS install-hint wiring — Phase 7 with push (PWA-02); the hint component is built here.
- E-mail notifications beyond auth (digests) — Phase 7 reuses the D-37 template engine and transport.
- Per-tenant sending domain for e-mails (tenant's own `no-reply@cliente.com.br`) — V2; needs per-tenant Resend domain verification.
- `super_admin` "view as tenant" / impersonation to preview a tenant's app — not in scope; the panel's live preview covers branding.
- Vercel domain-verified webhook instead of polling — revisit if the API exists and polling proves noisy.
- Multiple admins invited at creation, invite expiry customisation, tenant deletion/archival — Phase 8 hardening or V2.
- "Sair de todos os aparelhos", per-tenant e-mail confirmation toggle, OTP recovery — still deferred from Phase 1.

</deferred>

---

*Phase: 02-tenant-shell-branding-platform-panel*
*Context gathered: 2026-09-14*
