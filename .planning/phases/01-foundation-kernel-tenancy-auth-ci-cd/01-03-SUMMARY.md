---
phase: 01-foundation-kernel-tenancy-auth-ci-cd
plan: 03
subsystem: infra
tags: [tenancy, rls, supavisor, pgbouncer, pooling, drizzle, postgres, vitest, ci-guard, schema-conventions]

# Dependency graph
requires: ["01-01"]
provides:
  - "TENANT-03 evidence: 40 interleaved tenant lanes on a postgres.js pool of max:2 keep claims and role transaction-local; api_user outside a lane raises 42501 (NOINHERIT); a lane that aborts leaves nothing on the connection"
  - "scripts/spike-supavisor.test.ts parameterised only by SPIKE_DATABASE_URL, so the same file proves transaction (6543) or session (5432) mode — the fallback is a config switch, never a code fork"
  - "pnpm guard:lanes (scripts/guard-local-settings.sh): CI grep guard failing any set_config('request.jwt.claims', ..., false) or `set role` without LOCAL under packages/apps/scripts"
  - "packages/core/db/README.md: the two lanes, DATABASE_URL shapes per environment, the session-pooler fallback procedure and the recorded local run"
  - "platform_admins (ROLE-01 super_admin storage) with RLS and NO policy for authenticated — invisible to every tenant lane"
  - "V2-safe stubs chat_conversations / chat_participants / chat_messages / notifications with tenant_id + RLS + isolation policy, so Phase 7 adds rows and routes, not table rewrites"
  - "packages/core/docs/SCHEMA-CONVENTIONS.md: the mergeability checklist for every table added by every later module"
affects: [01-06, 01-08, 01-09, 01-12, phase-7-chat-notifications]

# Actuals (#2632) — same estimateTokens scale as the plan's estimate (chars/4 over the realized diff)
actuals:
  tokens: 21100     # 84,495 chars / 4 over `git diff 8e08bd9..HEAD` (12,950 without pnpm-lock.yaml + the drizzle snapshot); estimate was 45,000
  tasks: 2
  commits: 2        # MEASURED: git rev-list --count 8e08bd9..HEAD before the docs commit (#3968)
plan_head_before: 8e08bd93d2a85058dff868e9dc9dbb6eb47e8beb

# Tech tracking
tech-stack:
  added: []          # postgres 3.4.9 promoted to a root devDependency (already in the stack via @tria/core)
  patterns:
    - "Spike-as-test: the pooler proof is a vitest file (`pnpm spike:supavisor`, scripts/vitest.config.ts) that CI can re-run, not a throwaway script; it is parameterised only by SPIKE_DATABASE_URL so local, staging-transaction and staging-session runs are the same file"
    - "Contingency chain inside the spike: a LOOPBACK :54329 target retries `api_user.<project-ref>` and then the direct port 54322, printing every refusal; an explicit non-local URL never falls back, so a staging pooler refusal is a hard failure"
    - "LOCAL-settings guard: greps *.ts and *.sql for session-scoped claims and for `set role` without LOCAL; both branches proven to fire against a tampered copy of tenant-tx.ts"
    - "Deny-by-default table: RLS enabled with NO policy at all (platform_admins) is the way to make a table invisible to the tenant lane while the admin lane still reads it"
    - "V2-safe stubs: V1 product rules live in permissions and flags (chat kind, generic author_user_id), never in column shapes, so V2 is a value change and not a migration"

key-files:
  created:
    - scripts/spike-supavisor.test.ts
    - scripts/vitest.config.ts
    - scripts/guard-local-settings.sh
    - packages/core/db/README.md
    - packages/core/db/schema/platform-admins.ts
    - packages/core/db/schema/chat-stubs.ts
    - packages/core/db/schema/notification-stubs.ts
    - packages/core/docs/SCHEMA-CONVENTIONS.md
    - supabase/migrations/20260912205432_platform_admins_and_v2_stubs.sql
  modified:
    - packages/core/db/schema/index.ts
    - package.json
    - pnpm-lock.yaml
    - turbo.json
    - supabase/migrations/meta/_journal.json

key-decisions:
  - "Local spike ran on the direct port 54322: the local Supavisor refused `api_user` (ENOIDENTIFIER) and `api_user.rede-social` (ENOTFOUND), exactly as 01-01 recorded. The plan's recorded contingency applies — max:2 still forces the 40 lanes to reuse two physical connections, so the LOCAL-scope and NOINHERIT assertions stay meaningful, and the staging Supavisor run in 01-12 is the SINGLE authoritative transaction-pooler proof for TENANT-03"
  - "The stub column names follow the PLAN, not ARCHITECTURE.md verbatim: `created_by_user_id`/`author_user_id` instead of `created_by`/`sender_id`, `notifications.user_id` instead of `recipient_user_id`, `chat_conversations.subject` instead of `title`. The plan's names apply PITFALLS §9's generic-authorship rule consistently; Phase 7 builds on these (reversibility: costly)"
  - "The one-support-conversation index is `(tenant_id, created_by_user_id) where kind = 'support'` as the plan specifies. ARCHITECTURE.md also scopes it by `status='open'`; the stub has no status column, so Phase 7 either adds `status` and widens the index, or keeps one support thread per member for the tenant's lifetime (the V1 product rule)"
  - "SPIKE_*/TENANT_A/TENANT_B/SEED_PASSWORD declared as turbo.json globalPassThroughEnv: the spike is not a turbo task, so the vars are passed through rather than hashed, and Biome's noUndeclaredEnvVars stops warning on the new files"
  - "platform_admins keeps the schema-wide table GRANT to `authenticated` (from 01-01's `alter default privileges`); invisibility comes from RLS-with-no-policy, verified empirically to return 0 rows inside a tenant lane. Revoking the grant per table was rejected as a second, divergent mechanism"

patterns-established:
  - "Every new table in `public` inherits the lane grants automatically through 01-01's `alter default privileges` (verified: authenticated=true, anon=false, service_role=true on all five new tables) — new migrations do not need their own GRANT block"
  - "Negative checks for guard scripts run against a tampered COPY in the scratch dir, never against the working tree"
  - "Additive migrations are applied with `pnpm supabase migration up` (never `db reset`) while another plan's e2e may be using the shared local stack"

requirements-completed: [TENANT-03, ROLE-01]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "TENANT-03 concurrency: 40 interleaved withTenantTx-style transactions alternating between tenant A and tenant B on a pool of max:2 each see current_user='authenticated' and their own app.tenant_id(); after the batch four bare probes see current_user='api_user' and an empty request.jwt.claims"
    requirement: TENANT-03
    verification:
      - kind: integration
        ref: "scripts/spike-supavisor.test.ts#keeps claims and role inside each transaction and drops them after, under connection reuse"
        status: pass
    human_judgment: false
  - id: D2
    description: "api_user outside a lane cannot read tenant tables — SQLSTATE 42501, 'permission denied for table tenants' (A2 confirmed)"
    requirement: TENANT-03
    verification:
      - kind: integration
        ref: "scripts/spike-supavisor.test.ts#api_user outside a lane cannot read tenant tables (NOINHERIT, SQLSTATE 42501)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Error isolation: malformed claims abort only their own transaction (22P02); the next lanes on both pooled connections are correct and no claim survives"
    requirement: TENANT-03
    verification:
      - kind: integration
        ref: "scripts/spike-supavisor.test.ts#an error inside a lane is isolated: malformed claims abort that transaction only"
        status: pass
    human_judgment: false
  - id: D4
    description: "pnpm guard:lanes exits 0 on the committed tree and exits 1 on a tampered copy where `local` is removed from the role switch and the claims are session-scoped"
    requirement: TENANT-03
    verification:
      - kind: other
        ref: "pnpm guard:lanes -> exit 0; bash scripts/guard-local-settings.sh <scratch>/packages -> exit 1, both branches printed"
        status: pass
    human_judgment: false
  - id: D5
    description: "The fallback is a config switch, not a code fork: packages/core/db/README.md documents that a Supavisor 6543 failure changes only DATABASE_URL to the session pooler (5432) with withTenantTx unchanged, and rejects the per-request PostgREST client"
    verification:
      - kind: other
        ref: "packages/core/db/README.md#Fallback switch (if the spike fails on Supavisor 6543)"
        status: pass
    human_judgment: false
  - id: D6
    description: "platform_admins exists with RLS enabled and zero policy objects; a tenant lane sees 0 rows"
    requirement: ROLE-01
    verification:
      - kind: other
        ref: "psql: relrowsecurity count = 5; pg_policy count for platform_admins = 0; lane query returned platform_admins=0"
        status: pass
    human_judgment: false
  - id: D7
    description: "chat/notification stubs exist with tenant_id + RLS + isolation policy and the Phase 7 column shapes (kind, role, last_read_at, seq bigint, payload, event_id); tenant A's lane sees its conversation, tenant B's lane sees zero"
    verification:
      - kind: other
        ref: "psql lane probe: chat_A=1 / chat_B=0; partial unique index rejected a second 'support' conversation (23505) while a 'direct' one was accepted"
        status: pass
    human_judgment: false
  - id: D8
    description: "SCHEMA-CONVENTIONS.md states every PITFALLS §9 rule plus the lane rules and the new-module checklist"
    verification:
      - kind: other
        ref: "packages/core/docs/SCHEMA-CONVENTIONS.md sections (a)-(k); contains tenant_id, memberships, author_user_id, deleted_at, expires_at, tenant_modules, withTenantTx, supabase db push"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-09-12
status: complete
---

# Phase 01 Plan 03: Pooler lane spike, LOCAL-settings guard and the V2-safe Foundation schema Summary

**The phase's hardest constraint is retired: 40 interleaved tenant lanes sharing two physical connections each see only their own tenant and leave nothing behind (`api_user` + empty claims after the batch, `42501` on a bare read, clean state after an aborted lane), a CI grep guard now fails any non-LOCAL role switch or session-scoped claims injection, the session-pooler fallback is documented as a `DATABASE_URL` change with `withTenantTx` untouched, and the Foundation's V2-safe tables — `platform_admins` (RLS, no policy) plus the chat/notification stubs — landed with the schema-conventions doc that every later module is reviewed against.**

## Performance

- **Duration:** 12 min (continuation session; the previous executor was interrupted by a model switch after writing Task 1's files but before verifying or committing them)
- **Started:** 2026-09-12T20:46:37Z
- **Completed:** 2026-09-12T20:58:15Z
- **Tasks:** 2
- **Files modified:** 15 (2 task commits)

## Accomplishments

- **TENANT-03 proven under connection reuse.** `pnpm spike:supavisor` runs three cases green: 40 interleaved lanes (alternating `tria-demo` / `tria-lab`) on a `postgres.js` pool of `max: 2` — every lane reports `current_user = 'authenticated'`, its own `app.tenant_id()` and exactly one visible `tenants` row (policy `id = app.tenant_id()`); four bare probes after the batch report `current_user = 'api_user'` and an empty `request.jwt.claims`; a bare `select count(*) from public.tenants` raises `42501` (`permission denied for table tenants`, A2 confirmed); a lane that aborts on malformed claims (`22P02`) leaves the next lanes on both pooled connections correct and the connections clean.
- **Timing/throughput (A2 record):** 40 interleaved lanes on `max: 2` in **39 ms (~1023 lanes/s)** against the local stack.
- **`pnpm guard:lanes` installed and proven in both directions:** exit 0 on the committed tree, exit 1 on a tampered copy of `tenant-tx.ts` in the scratch dir — it printed both offending lines (`set_config('request.jwt.claims', ${claims}, false)` and `set role authenticated`).
- **The fallback is a configuration switch.** `packages/core/db/README.md` documents the two lanes and who may import each, the `DATABASE_URL` shape per environment (local 54329 / current 54322 contingency, staging transaction 6543, worker session 5432, migrations), the exact procedure if the staging Supavisor run fails (change only `DATABASE_URL` to port 5432, keep `prepare: false` and every line of `withTenantTx`), and why fallback #2 (per-request PostgREST client with the user JWT) is **not** recommended.
- **ROLE-01 storage exists:** `platform_admins` (`user_id` pk → `users.id` on delete cascade, `created_at`) with RLS enabled and **zero policy objects** — a tenant lane queries it and gets 0 rows, so platform staff are invisible to every tenant (threat T-03-02).
- **Phase 7's table shapes exist under RLS from day one:** `chat_conversations` (`kind` support|direct|group with CHECK, `subject`, `created_by_user_id`, `last_message_at`, partial unique index `chat_conversations_one_support_per_member`), `chat_participants` (`role` member|support|admin, `last_read_at`, pk `(conversation_id, user_id)`), `chat_messages` (`seq bigint`, generic `author_user_id`, `deleted_at`, unique `(conversation_id, seq)`, index `(tenant_id, conversation_id, seq desc)`), `notifications` (`kind`, `payload jsonb`, `event_id`, `read_at`, unique `(event_id, user_id) where event_id is not null`, index `(tenant_id, user_id, read_at)`). All four carry `tenant_id` + `tenantIsolationPolicy`.
- **`packages/core/docs/SCHEMA-CONVENTIONS.md`** covers tenancy, identity/membership, authorship, lifecycle, shared behaviours, feature flags, naming/placement, migrations, lanes, the pgTAP test gate and a copy-paste checklist for a new module.
- **No regressions:** `pnpm turbo run typecheck lint` (13 tasks) green, the 14 API integration cases from 01-01/01-02 still pass, the spike and the guard still pass after the schema landed.

## Task Commits

Each task was committed atomically:

1. **Task 1: Supavisor/PgBouncer transaction-mode spike, LOCAL-settings guard and fallback documentation** — `68ef91f` (test)
2. **Task 2: platform_admins, chat/notification V2-safe stubs and the schema conventions doc** — `48c6da5` (feat)

**Plan metadata:** see the `docs(01-03)` commit that follows this SUMMARY.

## Files Created/Modified

- `scripts/spike-supavisor.test.ts` — the pooler lane spike (three cases, contingency chain, timing/throughput log, `spike target:` line that never prints a password)
- `scripts/vitest.config.ts` — root-level spike runner: `include: ['scripts/**/*.test.ts']`, node environment, `testTimeout: 30_000`, `SPIKE_*` / `TENANT_*` env read from `apps/api/.env.local` when present (`DATABASE_URL` deliberately NOT forwarded, so the spike always tries the pooler first)
- `scripts/guard-local-settings.sh` — `set -euo pipefail`, `grep -rEn` over `packages apps scripts` (`*.ts`, `*.sql`) for session-scoped claims and non-LOCAL role switches; prints offenders and exits 1
- `packages/core/db/README.md` — lane contract, `DATABASE_URL` table, fallback switch, run schedule, and the "Local run" record
- `packages/core/db/schema/platform-admins.ts`, `chat-stubs.ts`, `notification-stubs.ts`, `index.ts` — the new tables and their exports
- `packages/core/docs/SCHEMA-CONVENTIONS.md` — sections (a) tenancy, (b) identity/membership, (c) authorship, (d) lifecycle, (e) shared behaviours, (f) flags, (g) naming, (h) migrations, (i) lanes, (j) test gate, (k) new-module checklist
- `supabase/migrations/20260912205432_platform_admins_and_v2_stubs.sql` (+ drizzle snapshot/journal) — five `create table`, five `enable row level security`, four policies, seven indexes; applied with `pnpm supabase migration up`
- `package.json` / `pnpm-lock.yaml` — `postgres@3.4.9` as a root devDependency (the spike imports the driver outside any workspace package)
- `turbo.json` — `globalPassThroughEnv: ["SPIKE_*", "TENANT_A", "TENANT_B", "SEED_PASSWORD"]`

## Decisions Made

- **Local spike target: direct port 54322 (recorded contingency).** The local Supavisor refused both username forms, reproducing 01-01 exactly:
  - `api_user @ 127.0.0.1:54329` → `(ENOIDENTIFIER) no tenant identifier provided (external_id or sni_hostname required)`
  - `api_user.rede-social @ 127.0.0.1:54329` (`[ROLE].[PROJECT-REF]` with the local `project_id`) → `(ENOTFOUND) tenant/user api_user.rede-social not found`

  The spike printed `spike target: 127.0.0.1:54322` plus the `spike contingency:` line, and `packages/core/db/README.md` records it under "Local run". **Consequence: the staging Supavisor run in plan 01-12 Task 1 step 4 is the single authoritative transaction-pooler proof for TENANT-03** and must not be skipped. The assertions remain meaningful locally because `max: 2` still forces 40 lanes through two physical connections — what is unproven locally is Supavisor's own transaction-mode multiplexing, not the LOCAL scope of the settings.
- **Stub column names follow the plan, not ARCHITECTURE.md verbatim** (`created_by_user_id`, `author_user_id`, `notifications.user_id`, `subject`). The plan applies PITFALLS §9's generic-authorship rule consistently; these shapes are what Phase 7 builds on (`reversibility: costly`).
- **`chat_conversations_one_support_per_member` is `(tenant_id, created_by_user_id) where kind = 'support'`** as the plan specifies. ARCHITECTURE.md additionally scopes it by `status = 'open'`; the stub has no `status` column, so Phase 7 must decide between adding `status` + widening the index and keeping one support thread per member permanently. Flagged for Phase 7, not decided here.
- **`platform_admins` invisibility comes from RLS-with-no-policy, not from revoking the table grant.** The schema-wide `alter default privileges` from 01-01 gives `authenticated` the SELECT privilege; RLS with no policy still yields 0 rows (verified in a lane). Introducing a per-table revoke would be a second, divergent mechanism for the same guarantee.
- **`turbo.json` `globalPassThroughEnv`** for `SPIKE_*` / `TENANT_A` / `TENANT_B` / `SEED_PASSWORD`: the spike is not a turbo task, so these must be passed through rather than hashed into task caches; it also silences Biome's `noUndeclaredEnvVars` on the new files.
- **Additive apply, not reset:** the migration was applied with `pnpm supabase migration up` (never `pnpm db:reset`) because 01-02's Playwright e2e shares the local stack.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The spike's NOINHERIT assertion read the message off the drizzle wrapper**
- **Found during:** Task 1 (first verification run of the files left by the interrupted executor)
- **Issue:** `await expect(attempt).rejects.toThrow(/permission denied|42501/)` failed. drizzle-orm 0.45 wraps driver errors in `DrizzleQueryError`, whose own message is only `Failed query: select count(*) from public.tenants`; both the SQLSTATE and the server message live on `cause`. The database behaviour was correct all along (`cause.code = '42501'` matched) — the assertion was wrong. This is the same trap as 01-01 deviation #3.
- **Fix:** capture the rejection once, assert `{ cause: { code: '42501' } }`, then assert `cause.message` matches `/permission denied/i`, and log the real driver message so the SUMMARY can quote it.
- **Files modified:** `scripts/spike-supavisor.test.ts`
- **Verification:** three cases green; the log now reads `spike noinherit: bare select on public.tenants raised 42501 — permission denied for table tenants (A2)`
- **Committed in:** `68ef91f`

**2. [Rule 3 - Blocking] `SPIKE_*` env vars were undeclared for Turborepo**
- **Found during:** Task 1 (Biome check on the new files)
- **Issue:** `lint/suspicious/noUndeclaredEnvVars` warned on `SPIKE_DATABASE_URL` / `SPIKE_ADMIN_DATABASE_URL` / `SPIKE_PROJECT_REF`, which would become recurring noise once 01-09 wires `ci.yml`
- **Fix:** `globalPassThroughEnv: ["SPIKE_*", "TENANT_A", "TENANT_B", "SEED_PASSWORD"]` in `turbo.json` (pass-through, so no task cache key changes)
- **Files modified:** `turbo.json`
- **Verification:** `npx biome check` clean on all new files; `npx turbo run lint --dry=json` parses the config; `pnpm turbo run typecheck lint` green (13 tasks)
- **Committed in:** `68ef91f`

**3. [Rule 3 - Blocking] `pnpm db:generate -- --name=...` is not valid under pnpm 12**
- **Found during:** Task 2
- **Issue:** the plan's command form passes `--` through to drizzle-kit, which rejects it (`Unrecognized options for command 'generate': --`)
- **Fix:** ran `pnpm db:generate --name=platform_admins_and_v2_stubs` (no separator). Nothing committed — a command-form correction, recorded here so 01-08/01-12 use the right form.
- **Verification:** migration `20260912205432_platform_admins_and_v2_stubs.sql` generated and applied

**Housekeeping:** Task 1's files (`spike-supavisor.test.ts`, `vitest.config.ts`, `guard-local-settings.sh`, `packages/core/db/README.md`, the root `postgres` devDependency) were written by the previous, interrupted executor session and were never verified or committed by it. Each was read against the plan's acceptance criteria, its verification re-run, the bug above fixed, and then committed in `68ef91f`.

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking)
**Impact on plan:** none on scope. The assertion fix strengthens the TENANT-03 evidence (the SQLSTATE and the server message are now both checked at their real location); the other two are tooling corrections.

## Issues Encountered

- The local Supavisor still refuses `api_user` under both username forms (see Decisions). This is a known local-stack limitation recorded in 01-01, and the plan sanctions the direct-port contingency — but it means **01-12's staging run is now load-bearing**: if it is skipped, TENANT-03 has no transaction-pooler proof at all.
- `psql` had to be run from the host (`/opt/homebrew/bin/psql`) rather than through `docker exec`; the plan's verification command form works as written from the host shell.

## Known Stubs

| File | Stub | Reason / resolved by |
|------|------|----------------------|
| `packages/core/db/schema/chat-stubs.ts` | Three tables with no triggers, no Realtime wiring, no routes | Intentional per the plan: Phase 1 ships shape only so `010-rls-coverage.sql` (01-08) passes from day one; Phase 7 adds `realtime.broadcast_changes` triggers, `realtime.messages` policies and the module routes |
| `packages/core/db/schema/notification-stubs.ts` | `notifications` with no producer and no fan-out worker | Same: Phase 7 builds the notification module (fan-out idempotent on `(event_id, user_id)`, which this stub's partial unique index already enforces) |
| `packages/core/db/schema/platform-admins.ts` | No rows are ever written in this phase; no reader exists yet | Plan 01-06 adds `requireSuperAdmin()` and the platform login path; Phase 2 adds the platform panel |

These stubs are exactly the plan's deliverable ("Phase 7 adds rows, not migrations that rewrite tables") and do not block this plan's goal.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: information-disclosure (low, accepted) | `packages/core/db/schema/platform-admins.ts` | `authenticated` holds the schema-wide SELECT grant on `platform_admins` (inherited from 01-01's `alter default privileges`); only RLS-with-no-policy keeps the table empty for tenant lanes. If any future migration adds a policy to this table — even a narrow one — the tenant lane immediately gains visibility of platform staff. 01-08's pgTAP coverage test should assert `pg_policy` count = 0 for `platform_admins` rather than merely "has RLS". |

## Authentication Gates

None.

## User Setup Required

None — local stack only. The staging run of `pnpm spike:supavisor` (plan 01-12) will need the hosted `SPIKE_DATABASE_URL` with `api_user.<project-ref>` and `API_DB_PASSWORD`.

## Next Phase Readiness

- **01-08 (isolation suite):** the four new tenant tables must each gain a case in `020-tenant-isolation.sql`; `010-rls-coverage.sql` already passes them, and it should additionally assert zero policies on `platform_admins` (see Threat Flags).
- **01-09 (CI):** `ci.yml` must run `pnpm guard:lanes` and `pnpm spike:supavisor` (the latter after `pnpm db:seed`, since the spike resolves `tria-demo` / `tria-lab` ids).
- **01-12 (staging):** run `SPIKE_DATABASE_URL=postgres://api_user.<ref>:<pw>@aws-0-sa-east-1.pooler.supabase.com:6543/postgres pnpm spike:supavisor` before the production gate and record the result in `packages/core/db/README.md`'s run-schedule table. This is the authoritative transaction-pooler proof.
- **01-06:** `requireSuperAdmin()` reads `platform_admins` through `withAdminTx`; the table and its deny-by-default posture are ready.
- **Phase 7:** the chat/notification shapes are fixed; the open question is whether `chat_conversations` gains a `status` column (and a widened one-support-per-member index) or keeps one support thread per member for the tenant's lifetime.

---
*Phase: 01-foundation-kernel-tenancy-auth-ci-cd*
*Completed: 2026-09-12*

## Self-Check: PASSED

All nine key files exist on disk; task commits `68ef91f` and `48c6da5` are in `git log`. Before this SUMMARY was written, `pnpm spike:supavisor` (3 cases), `pnpm guard:lanes` (plus the tampered-copy negative check), `pnpm supabase migration up` with the psql RLS/policy assertions, `pnpm turbo run typecheck lint` (13 tasks) and the 14 API integration cases were all re-run green.
