---
gsd_state_version: "1.0"
current_phase: 01
current_phase_name: Foundation - Kernel, Tenancy, Auth & CI/CD
status: executing
stopped_at: Completed 01-08-PLAN.md
last_updated: "2026-09-13T16:03:45.406Z"
last_activity: 2026-09-11
last_activity_desc: Phase 01 execution started
state_head: 71a03ec81358a04932a46a425dd7dc25b2f1a173
progress:
  total_phases: 8
  completed_phases: 0
  total_plans: 12
  completed_plans: 9
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-11)

**Core value:** A tenant's members open one branded app and feel it is their organization's community: the tenant's identity everywhere, the tenant's content in the feed, and zero leakage between tenants.
**Current focus:** Phase 01 — Foundation - Kernel, Tenancy, Auth & CI/CD

## Current Position

Phase: 01 (Foundation - Kernel, Tenancy, Auth & CI/CD) — EXECUTING
Plan: 10 of 12
Status: Ready to execute
Last activity: 2026-09-11 — Phase 01 execution started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: - min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

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

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1]: Supavisor transaction pooling + `SET LOCAL ROLE` / `set_config` behaviour must be validated with a spike before schema freeze (fallback: per-request Supabase client with user JWT).
- [Phase 3]: Video vendor (Mux vs Cloudflare Stream) pricing is LOW confidence; verify at phase start, decide whether the pilot can defer video.
- [Phase 7]: Realtime connection quota on the Free plan (200) and "new post to every member" fan-out strategy need pilot member count.
- [Phase 8]: LGPD legal review is out of research scope; flag to user before pilot go-live.

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| *(none)* | | | | |

## Session Continuity

Last session: 2026-09-13T16:03:45.389Z
Stopped at: Completed 01-08-PLAN.md
Resume file: None
