---
gsd_state_version: "1.0"
current_phase: 02
current_phase_name: Tenant Shell, Branding & Platform Panel
status: executing
stopped_at: Completed 02-17-PLAN.md
last_updated: "2026-09-17T13:25:01.300Z"
last_activity: 2026-09-17
last_activity_desc: Phase 02 execution started
state_head: a095736f52c0e2440abfd4772d523337f11dd164
progress:
  total_phases: 9
  completed_phases: 0
  total_plans: 32
  completed_plans: 26
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-11)

**Core value:** A tenant's members open one branded app and feel it is their organization's community: the tenant's identity everywhere, the tenant's content in the feed, and zero leakage between tenants.
**Current focus:** Phase 02 — Tenant Shell, Branding & Platform Panel

## Current Position

Phase: 02 (Tenant Shell, Branding & Platform Panel) — EXECUTING
Plan: 2 of 20
Status: Ready to execute
Last activity: 2026-09-17 — Phase 02 execution started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 9
- Average duration: - min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 9 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P01 | 7 min | 2 tasks | 84 files |
| Phase 01 P02 | 1h 34m | 3 tasks | 37 files |
| Phase 01 P03 | 12min | 2 tasks | 15 files |
| Phase 01 P09 | 21 min | 2 tasks | 12 files |
| Phase 01 P04 | 25 min | 3 tasks | 32 files |
| Phase 01 P05 | 17min | 2 tasks | 20 files |
| Phase 01 P06 | 22 min | 3 tasks | 36 files |
| Phase 01 P07 | 25 min | 3 tasks | 42 files |
| Phase 01 P08 | 78 min | 3 tasks | 18 files |
| Phase 02 P01 | 95 min | 2 tasks | 22 files |
| Phase 02 P02 | 185min | 3 tasks | 41 files |
| Phase 02 P03 | 14 min | 3 tasks | 34 files |
| Phase 02 P04 | 37 min | 3 tasks | 28 files |
| Phase 02 P05 | 60 | 3 tasks | 10 files |
| Phase 02 P06 | 21min | 3 tasks | 23 files |
| Phase 02 P07 | 36min | 3 tasks | 41 files |
| Phase 02 P08 | 15min | 3 tasks | 30 files |
| Phase 02 P09 | 18min | 3 tasks | 21 files |
| Phase 02 P11 | 21min | 3 tasks | 27 files |
| Phase 02 P12 | 24min | 3 tasks | 30 files |
| Phase 02 P10 | 22min | 3 tasks | 23 files |
| Phase 02 P13 | 21min | 3 tasks | 18 files |
| Phase 02 P15 | 13min | 3 tasks | 15 files |
| Phase 02 P14 | 20 min | 3 tasks | 21 files |
| Phase 02 P16 | 1h 47m | 3 tasks | 12 files |
| Phase 02 P17 | 8 min | 2 tasks | 4 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: 8 vertical MVP phases (standard granularity); chat folded into the realtime phase with notifications + push; pilot hardening folded into the moderation/admin phase.
- [Roadmap]: EVENT-07 (reminders) mapped to Phase 7, not Phase 6 - delivery needs the notification module; Phase 6 only emits event domain events.
- [Roadmap]: MEDIA-04 (link unfurl) mapped to Phase 4 (Feed) where it is user-observable; Phase 3 owns uploads/images/video only.
- [Roadmap]: Auth UI ships functional-minimal in Phase 1; visual port with the shared UI package in Phase 2.
- [2026-09-11, user]: Each tenant on its own custom domain (customer-owned host, `tenant_domains`, host -> tenant in `proxy.ts`, membership must match host: 403 `TENANT_HOST_MISMATCH`); platform domain reserved for TRIA `super_admin`; TENANT-01 reworded, TENANT-07 (domain management in the platform panel) added to Phase 2; Phase 1 plans revised accordingly (D-20..D-24).
- [PROJECT]: Supabase Free plan for the pilot (worker image resize, 50 MB cap); Realtime via Broadcast (read-only browser subscription); `@supabase/ssr` for session; identity != membership (`memberships` table); video via Mux/Cloudflare Stream (choose in Phase 3).
- [Phase 01]: 01-01: local DATABASE_URL on the direct port 54322 - the local Supavisor refuses api_user (ENOIDENTIFIER) and api_user.rede-social (ENOTFOUND); pooler proof deferred to the 01-03 spike and the 01-12 hosted run
- [Phase 01]: 01-01: root package.json is ESM (type: module) so tsx runs scripts/seed.ts with top-level await
- [Phase 01]: 01-01: jwtVerify keeps audience 'authenticated' (A1 held); TS 6 alias not needed (A5)
- [Phase 01]: 01-01: public by-host lookup runs through the admin lane in tenant-host.ts with a 60 s positive+negative cache, answering slug + displayName only
- [Phase 01]: 01-02: *.vercel.app hosts are generic wherever PLATFORM_HOST is unset (Preview/local); production proxy.ts 307s them to https://PLATFORM_HOST (D-20/D-21)
- [Phase 01]: 01-02: proxy.ts host cache = module Map keyed by normalised host, 300 s hit / 60 s 404 / 10 s error, fail-open to generic; unregistered hosts render the neutral shell
- [Phase 01]: 01-02: session cookies HttpOnly+SameSite=Lax (+Secure in production) via lib/supabase/cookie-options.ts (@supabase/ssr defaults httpOnly:false)
- [Phase 01]: 01-02: next@16.3.5 installed (RESEARCH pin); CLAUDE.md stack table still says 16.3.4 - user to reconcile
- [Phase 01]: 01-02: mobile-chromium = iPhone 14 preset on Chromium; next-env.d.ts git-ignored (typecheck runs next typegen first); apps/web AGENTS.md+CLAUDE.md from next dev committed
- [Phase 01]: 01-03: local Supavisor still refuses api_user (ENOIDENTIFIER / ENOTFOUND) — the lane spike ran on the direct port 54322 with max:2; the staging Supavisor run in 01-12 is now the SINGLE authoritative transaction-pooler proof for TENANT-03
- [Phase 01]: 01-03: the pooler fallback is a DATABASE_URL switch to the session pooler (5432) with withTenantTx unchanged; the per-request PostgREST client (fallback #2) is rejected as a code fork
- [Phase 01]: 01-03: platform_admins is invisible to tenant lanes through RLS-with-no-policy (not a per-table revoke); 01-08's coverage test should assert pg_policy count = 0 for it
- [Phase 01]: 01-03: chat/notification stub column shapes (kind, seq bigint, role, last_read_at, payload, event_id) are fixed for Phase 7; open question is whether chat_conversations gains a status column and a widened one-support-per-member index
- [Phase 01]: GoTrue duplicate e-mail is matched on code 'email_exists', code 'user_already_exists' or a 422 message containing 'already been registered'; the concurrent loser gets an opaque 500 and is reclassified as 409 only after auth.users confirms the e-mail exists — A genuine GoTrue outage must still answer 500, so the race path re-queries instead of assuming duplication; this also made the AUTH-01 concurrency test keepable rather than skipped
- [Phase 01]: apps/web/proxy.ts resolves the host tenant from x-forwarded-host first, falling back to host — Next re-requests the destination of a Server Action redirect() on the server own origin, carrying the browser-facing host only in x-forwarded-host; reading host first dropped the tenant shell after every sign-up. Vercel/Cloud Run overwrite the header at the edge and the host only selects the public shell (D-20/D-23), so trusting it cannot leak another tenant data
- [Phase 01]: consent_records is append-only by construction: RLS on with a single select-only policy and no insert/update/delete policy at all — Writes exist only through the admin lane, so the absence of a write policy is the tamper-resistance mechanism for LGPD evidence (T-04-02)
- [Phase 01]: 01-05: recovery redirectTo is derived only from the request origin (x-forwarded-host before host) — no SITE_URL, no env fallback (D-22)
- [Phase 01]: 01-05: the (app) layout routes every 403 envelope code to a Route Handler under /auth/* because only a Route Handler may clear the session cookies
- [Phase 01]: 01-05: /endereco-invalido takes no props and reads no cookie, header or search param — D-23 privacy is structural, not a review note
- [Phase 01]: 01-05: e2e fixtures send recovery mail from one throwaway user per case — GoTrue throttles recovery mail per user (max_frequency)
- [Phase 01]: 01-05: postgres@3.4.9 added as a @tria/web devDependency so e2e/admin.ts can write membership rows (fixtures only, never app code)
- [Phase 01]: Cross-tenant admin-lane reads live in packages/core/server/platform/* (Biome confines withAdminTx to the kernel's tenancy/platform lanes and scripts/), so API routes never bypass RLS directly
- [Phase 01]: moduleFlags is a factory with an injectable loader and clock plus one process-wide instance: TTL and tenant-isolation behaviour is unit-tested without a database and without test-only setters in production code
- [Phase 01]: permissionsFor(role, enabledKeys) applies a module's defaultRolePermissions only while its flag is on, so disabling a module revokes what it granted
- [Phase 01]: The D-21 platform host is authorised by the API (a 200 from GET /v1/platform/tenants), never by JWT claims; FORBIDDEN and TENANT_HOST_MISMATCH reuse the /auth/host-mismatch sign-out handler
- [Phase 01]: enqueueInTx switches to api_user for the enqueue only, so the tenant lane (authenticated) holds no privileges on schema pgboss and cannot read another tenant's job payloads
- [Phase 01]: Queue names travel app-tier to kernel via registerJobQueues; the kernel never imports a module (MOD-02)
- [Phase 01]: pg-boss is declared in both @tria/core and @tria/api: tsup externalises only declared deps, and bundling pg-boss broke the ESM build
- [Phase 02]: 02-01: resolveBranding throws on a malformed stored hex instead of falling back to the neutral brand — a corrupt tenants.branding row fails loud (500 → generic shell), never renders TRIA blue to a configured tenant; the panel validates with the same schema before saving
- [Phase 02]: 02-01: apps/web splits HostTenant (full by-host answer from resolveHostTenant: status, isPrimary, primaryHost, branding) from HostShell (the four size-limited x-tenant-* headers from getHostTenant); the brand always comes from the cached fetch (getHostBrand), never a header
- [Phase 02]: 02-01: resolveTenantHost resolves VERIFIED hosts only (isNotNull verified_at, D-36) and returns tenants.status instead of filtering on it (D-32); a suspended tenant's host answers 200 status 'suspended' so its screens stay branded — requireAuth still refuses its members
- [Phase 02]: 02-01: TTL_HIT_MS on the web host cache lowered 300 s → 60 s; with no cross-instance invalidation on Vercel the TTL IS the brand cache bust (≤ 60 s web + 60 s API)
- [Phase 02]: 02-02: @tria/ui brand utilities bound via @theme inline (bg-brand → var(--brand-accent) on the element); --color-* aliases intentionally not emitted as CSS variables
- [Phase 02]: 02-02: tokens.css is the only hex file; excluded from Biome's CSS formatter (linter on), Tailwind directives enabled repo-wide in biome.json
- [Phase 02]: 02-02: package-legitimacy checkpoint approved by the user 2026-09-16 for the whole phase (incl. 02-03's sharp/resend/standardwebhooks) — do not re-ask
- [Phase 02]: 02-03: assertProductionEnv() runs at import in every environment — a vercel/resend/supabase selection without its secrets is invalid anywhere; fake/local defaults never trip it (T-02-10)
- [Phase 02]: 02-03: tenant_invites is exempted BY NAME from pgTAP 010's at-least-one-policy assertion and pinned at ZERO policies in 040 (platform_admins mirror) — a tenant table is either isolated by a policy or pinned as invisible
- [Phase 02]: 02-03: request bodies normalise BEFORE validating (adminEmail trim+lowercase → z.email(); host normalizeHost → isRegistrableHost), because Zod 4 runs format checks before overwrite transforms
- [Phase 02]: 02-03: GET /v1/platform/tenants answers primaryHost + nextCursor:null now (the widened contract is the route's response type); query/cursor handling stays with 02-12
- [Phase 02]: 02-03: TENANT_SUSPENDED keeps the Phase 1 /auth/blocked sign-out path on the web until 02-08 ships /auth/suspended → /comunidade-indisponivel
- [Phase 02]: 02-04: D-33 design review provisionally approved by the product owner (Igor Vilas Boas) on 2026-09-16 with no change list; the team designer reviews the platform-panel screens later — designer deltas are a follow-up polish pass, not a blocker for coding the [designed] screens
- [Phase 02]: 02-04: catalog loader = pure assembleMessages() (sorted, deep-merge, duplicate leaf path throws naming both files) behind a memoized loadMessages(); next-intl onError throws outside production, getMessageFallback renders the dotted key
- [Phase 02]: 02-04: hard-coded UI literals are a lint failure — scripts/check-ui-literals.sh (hex in strings/classes, legacy prototype classes, pt-BR JSX text, catalog root-key contract) runs after turbo lint in the root lint script; the Phase 1 #ddd hairline was fixed with var(--theme-border), not allow-listed
- [Phase 02]: 02-04: derived brand tokens (--brand-accent/-hover/-soft/-gradient) are declared per element (* and [data-theme=dark] *), never only on :root — var() indirections resolve where declared, so a nested [data-brand-root] scope could not recolour bg-brand (pre-existing 02-02 bug found by the mockup brand picker)
- [Phase 02]: 02-05: listPlatformTenants uses three separate selects (page, enabled modules, verified primary hosts) so module-less/host-less tenants still list with [] / null primaryHost
- [Phase 02]: 02-05: duplicate slug is mapped from Postgres 23505 by walking drizzle's cause chain and only when the constraint name contains 'slug' → 400 VALIDATION_FAILED { slug: 'taken' }; the unique constraint is the concurrency arbiter
- [Phase 02]: 02-05: 'example' is refused twice — z.enum(REAL_TENANT_DEFAULT_MODULES) at the PUT modules route and { module: 'not_toggleable' } in setModuleEnabled for non-route callers
- [Phase 02]: 02-05: platformDefaultHook lives in apps/api/src/http/openapi.ts (shared by createOpenApiApp and routes/platform/*) to avoid an index ↔ tenants import cycle
- [Phase 02]: 02-05: sendPendingInvites(tenantId, actor?) — actor optional so 02-09's domain-verify job can call it without a request; claim-before-send with claim revert on GoTrue failure
- [Phase 02]: 02-05: integration fixtures that provision tenants run cleanupTestTenants() in beforeAll AND afterAll (memberships.tenant_id has no cascade; an interrupted run must not poison the next one)
- [Phase 02]: 02-06: buildActionLink keeps redirect_to verbatim and appends token_hash/type (URLSearchParams re-encoded next=/…)
- [Phase 02]: 02-06: e-mail layout re-filters the logo through safeHttpUrl and adds a primary top accent so link-less mails stay branded
- [Phase 02]: 02-06: scripts/supabase.sh prefers the pinned node_modules/.bin/supabase and exports the local throwaway SEND_EMAIL_HOOK_SECRETS (same constant as local-env.sh); every CLI command validates the hook block
- [Phase 02]: 02-06: integration suite serves the app in-process on 0.0.0.0:8787 via a Vitest globalSetup attached only to integration runs (GoTrue hook callback)
- [Phase 02]: 02-07: app.json — kernel tab label at app.nav.home; app.home is the welcome/soon object (a key cannot be both string and object)
- [Phase 02]: 02-07: ThemeToggle has no local state — <html data-theme> is the single source of truth via useSyncExternalStore + MutationObserver, so the settings row and rail row never disagree
- [Phase 02]: 02-07: activeTabKey returns null when no tab matches (aria-current never claimed by Início on /configuracoes); module tabs/slots/home widgets exist only via bootstrap.modules (MOD-04)
- [Phase 02]: 02-08: server pages hand lucide icons to client primitives by name (AuthInput) — React Flight refuses forwardRef objects as client props
- [Phase 02]: 02-08: alias hosts fold into the primary origin via primaryHostRedirect() in proxy.ts (308, no-store, isRegistrableHost + loop guard) before the Supabase client; TENANT_SUSPENDED now routes to /auth/suspended → /comunidade-indisponivel (02-03 interim mapping removed)
- [Phase 02]: 02-09: checkDomain(domainId, actor, { source, tenantId? }) is the ONE check the route, the restart and the kernel.domain-verify job share; verified_at is written only by its single update … where verified_at is null returning, the loser runs no side effects, and already_verified re-runs the idempotent side effects (cache, allow-list under pg_advisory_xact_lock, claim-before-send invites) so a failed allow-list call is recoverable from Verificar agora
- [Phase 02]: 02-09: the poller crash re-arm lives in platform/domains.ts (rearmDomainVerification) because Biome confines withAdminTx to server/{tenancy,platform}; domains/* (adapters + verify-job) never touch the database; kernel.domain-verify registers its queue in domains/index.ts and worker.ts lists kernel jobs explicitly before module jobs (registry untouched)
- [Phase 02]: 02-09: case-variant invariant pinned as the schema behaves — same lower-case host on another tenant is 23505, an upper-cased spelling is 23514 (tenant_domains_host_chk; hosts are lower-cased at the boundary) and the citext lookup is case-insensitive; the plan's 23505-for-Inv-A.Test was unreachable
- [Phase 02]: 02-09: adapter request helpers take { method, path, body } so every call site carries the HTTP method literally and the COVERAGE OPT-OUT audit is a grep on vercel.ts (0 hits); provider errors on attach map by kind (in_use → 409 DOMAIN_IN_USE { reason: provider }, invalid_domain → 400, rate_limited → 503, else 500) and a concurrent identical attach never compensates with removeDomain
- [Phase 02]: 02-11: TS 7 spike passed — next build with @serwist/turbopack under typescript@7.0.2, no TS 6 alias; tsconfig lib + WebWorker type-checks (no triple-slash fallback)
- [Phase 02]: 02-11: standalone-mode emulation is unsupported by the bundled Chromium 153 (display-mode ignored by Emulation.setEmulatedMedia; --app headless does not report standalone) — pwa.spec.ts asserts the browser half and skips the standalone half with an annotation; the real-device install check stays the definitive PWA-01 proof
- [Phase 02]: 02-11: SW caching is allow-list shaped — documents/RSC/actions//auth//v1//api//m//serwist NetworkOnly, CacheFirst next-static, bounded SWR brand-assets; SerwistProvider cacheOnNavigation and reloadOnOnline explicitly false; manifest + head icons from ONE allow-listed set with whole-set neutral fallback
- [Phase 02]: 02-11: /~offline + pwa.json landed in the Task 1 commit (Rule 3) because a 404 precache entry fails the SW install; InstallHint lives in apps/web/components/pwa (unmounted, Phase 7 may hoist to @tria/core/ui); vitest.config.ts uses oxc.jsx automatic (Vite 8) for .tsx helper tests
- [Phase 02]: 02-12: platform panel authorises by host gate (notFound before any fetch) then GET /v1/platform/tenants?limit=1 — a 200 is the only proof of super_admin; every page/tab re-proves it
- [Phase 02]: 02-12: server actions return catalog KEYS; client panel components translate with useTranslations('platform') (functions never cross the server→client prop boundary)
- [Phase 02]: 02-12: tenant page header keeps the display name as the single h1 (own back control + crumb instead of PageHeader); slug rendered as text only — immutable after creation (D-31)
- [Phase 02]: 02-10: resend of a sent/expired invite uses GoTrue admin generateLink({ type: 'invite' }) + the 02-06 template/transport (never inviteUserByEmail again); proven locally that generateLink regenerates the confirmation token — the old token_hash is refused, the new one verifies
- [Phase 02]: 02-10: invited scope is an allow-list in requireAuth (/v1/me/bootstrap + /v1/me/accept-invite) checked after the host check; the bootstrap stays 200 with membership.status = 'invited' and the web guard lives in requireBootstrap()
- [Phase 02]: 02-10: the accept action sets the password through @supabase/ssr updateUser BEFORE calling POST /v1/me/accept-invite, so a failure in between leaves a recoverable state routed back to /aceitar-convite
- [Phase 02]: 02-10: integration cases that read a GoTrue-originated invite mail must attach *.localhost hosts — GoTrue drops a redirectTo outside additional_redirect_urls and mails a neutral link without /auth/confirm
- [Phase 02]: 02-13: colours have two doors (panel PUT …/branding/colors with the confirmLowContrast gate; 02-05 PATCH ungated) and ONE persistence path — applyBrandColors bumps iconVersion and re-derives only when the primary changes
- [Phase 02]: 02-13: icon derivation never runs in the request path — complete/colors decode the image header and enqueue kernel.branding-derive-icons (singletonKey = tenantId, short); the worker derives under versioned immutable keys with an optimistic iconVersion write (superseded on a race)
- [Phase 02]: 02-13: stateless signed-upload id <kind>-<uuid>.<ext>; the object under <tenant_id>/branding/ is the proof; assertTenantKey before every Storage call; test cleanup goes through the Storage API (direct deletes from storage.objects are refused)
- [Phase 02]: 02-15: the four domain row actions share runDomainAction (uuid gate → fetch → readRow → mapDomainActionError → revalidate → redirect-after-try); mapDomainActionError is called once, behaviour pinned by e2e
- [Phase 02]: 02-15: AttachDomainForm keeps the host input controlled (synced from AttachDomainState.value) because React 19 resets uncontrolled forms after every action
- [Phase 02]: 02-15: Módulos rows render Ativado/Desativado as StatusPills with the helper at the card bottom per the approved tenant-page-modulos mockup (D-33)
- [Phase 02]: 02-14: brand aliases (--brand-accent & co.) are declared on every brand scope in tokens.css (:root, [data-brand-root], [data-brand-scope], [style*="--brand-primary"]) with a light-in-dark override; the per-element * rule was replaced — bg-brand is asserted by rendered colour in e2e
- [Phase 02]: 02-14: kernel BrandPreview (packages/core/ui) takes strings as props and derives colours with the contracts functions; Phase 8 reuses it unchanged; branding specs spawn their own ROLE=worker via apps/web/e2e/worker.ts
- [Phase 02-16]: 02-16: honest two-witness ROLE-04 proof — panel path with feed (bootstrap within the flags TTL, nav unchanged) + reference module flipped by spec-only SQL on the throwaway tenant (tab/slot + 200/404); Phase 4 extends the smoke with the feed tab
- [Phase 02-16]: 02-16: pnpm verify is the local exit gate and ci.yml mirrors it step for step (one checks job; PWA production-build e2e appended with its own report folders); spec filters must use pnpm --filter @tria/web exec playwright test <spec> — pnpm e2e -- <spec> runs the whole suite
- [Phase 02-16]: 02-16: scripts/check-static-routes.sh is the build-output gate (exit 2 without a build, strict allow-list /_* and /serwist/*); apps/api/turbo.json declares @react-email/render as an implicit boundary dependency so boundaries can follow the build
- [Phase 02-16]: 02-16: served-HTML follow-up of a brand/status change is bounded by the 60 s web host cache (observed 55-61 s); specs poll up to 70 s and annotate the delay, assertions stay exact; the real-device standalone install and the hosted provider flows stay explicit backstops
- [Phase 02]: 02-17: a thrown domainProvider.verify is a normal poller outcome — checkDomain evaluates verify_deadline_at first (expired, nothing re-armed) and otherwise records last_error = '<kind>[:<status>]' and enqueueVerify(tx, domainId) inside the same admin transaction, guarded by verified_at is null; verify-job.ts keeps its crash re-arm for THROWN errors only
- [Phase 02]: 02-17: ensureVerifiedSideEffects returns a boolean and both checkDomain branches clear last_error via clearLastErrorIfSettled only when BOTH side effects succeeded — a failed side effect keeps its error so the Domínios card keeps offering 'Verificar agora'
- [Phase 02]: 02-17: fake provider 'provider-fails-once' switch (module-level Set of hosts that already threw; first verify -> DomainProviderError('unavailable', 503)); IN-01..IN-07 stay deferred to Phase 8 hardening (product-owner decision 2026-09-17)

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1]: Supavisor transaction pooling + `SET LOCAL ROLE` / `set_config` behaviour must be validated with a spike before schema freeze (fallback: per-request Supabase client with user JWT).
- [Phase 3]: Video vendor (Mux vs Cloudflare Stream) pricing is LOW confidence; verify at phase start, decide whether the pilot can defer video.
- [Phase 7]: Realtime connection quota on the Free plan (200) and "new post to every member" fan-out strategy need pilot member count.
- [Phase 8]: LGPD legal review is out of research scope; flag to user before pilot go-live.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260914-mfk | Route bootstrap 401/403 to redirects through one requireBootstrap()/requirePlatformTenants() helper so concurrently rendered segments no longer log a false ApiClientError | 2026-09-14 | 43db3cd | [260914-mfk-move-the-bootstrap-error-to-redirect-map](./quick/260914-mfk-move-the-bootstrap-error-to-redirect-map/) |

### Roadmap Evolution

- Phase 01.1 inserted after Phase 1: Cloud Provisioning & First Release: plans 01-10/01-11/01-12 moved out of Phase 1 as 01.1-01..03 because the cloud accounts do not exist yet; Phase 1 closes on the local stack and Phases 2-8 proceed locally. PWA-04 moved to 01.1.

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| *(none)* | | | | |

## Session Continuity

Last session: 2026-09-17T13:25:01.270Z
Stopped at: Completed 02-17-PLAN.md
Resume file: None
