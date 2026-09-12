---
gsd_state_version: "1.0"
current_phase: 01
current_phase_name: Foundation - Kernel, Tenancy, Auth & CI/CD
status: executing
stopped_at: Completed 01-03-PLAN.md
last_updated: "2026-09-12T21:12:54.751Z"
last_activity: 2026-09-11
last_activity_desc: Phase 01 execution started
state_head: 48c6da5eff5277a230728bc0578c26f7ee836fe2
progress:
  total_phases: 8
  completed_phases: 0
  total_plans: 12
  completed_plans: 3
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-11)

**Core value:** A tenant's members open one branded app and feel it is their organization's community: the tenant's identity everywhere, the tenant's content in the feed, and zero leakage between tenants.
**Current focus:** Phase 01 — Foundation - Kernel, Tenancy, Auth & CI/CD

## Current Position

Phase: 01 (Foundation - Kernel, Tenancy, Auth & CI/CD) — EXECUTING
Plan: 4 of 12
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

Last session: 2026-09-12T21:12:43.428Z
Stopped at: Completed 01-03-PLAN.md
Resume file: None
