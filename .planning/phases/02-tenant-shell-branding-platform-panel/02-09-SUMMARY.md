---
phase: 02-tenant-shell-branding-platform-panel
plan: 09
subsystem: custom domains (kernel adapters, platform-lane service, pg-boss poller, platform API routes)
tags: [domains, platform, api, jobs, pg-boss, vercel, supabase-management, tdd, pgtap]

# Dependency graph
requires:
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 01
    provides: "resolveTenantHost verified-only (D-36) with isPrimary/primaryHost (D-35) and invalidateTenantHost; hostTenantSchema"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 03
    provides: "tenant_domains verification columns (verification_status, dns_records, last_checked_at, verify_deadline_at, last_error), kernel env selectors DOMAIN_PROVIDER / AUTH_ALLOW_LIST + credentials + assertProductionEnv, contracts domains.ts (dnsRecordSchema, tenantDomainSchema, attachDomainBodySchema), ERROR_CODES"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 05
    provides: "routes/platform/index.ts with requireSuperAdmin() + chained sub-routers, platformDefaultHook, sendPendingInvites (claim-before-send), PlatformActor/logFor, throwaway-tenant integration fixtures"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 06
    provides: "in-process integration listener on 8787 (GoTrue Send Email Hook), Vitest globalSetup"
  - phase: 01-foundation-kernel-tenancy-auth-ci-cd
    provides: "pg-boss wiring (boss.ts: enqueueInTx, registerJobQueues, QUEUE_POLICY short, lazy API boss), apps/api/src/worker.ts, JobDefinition, admin lane confinement (Biome), pgTAP gate"
provides:
  - "packages/core/server/domains/types.ts — DomainProvider / AuthAllowList contracts, DomainCheck, DomainProviderError (kind + status only), allowListEntry(host) = https://<host>/auth/confirm**, DOMAIN_VERIFY_QUEUE = 'kernel.domain-verify', DOMAIN_VERIFY_INTERVAL_S = 600, DOMAIN_VERIFY_DEADLINE_MS = 7 d, DomainVerifyPayload"
  - "packages/core/server/domains/fake.ts — createFakeDomainProvider (CNAME for subdomains, A for apexes, `needs-txt` → TXT challenge + ownership false on add / true on verify, `never-verifies` → configured false), fakeDomainProviderStats() call counters"
  - "packages/core/server/domains/vercel.ts — createVercelDomainProvider({ token, projectId, teamId, fetchImpl?, baseUrl? }): POST /v10 add (409 → GET status: ours vs in_use), GET /v9 status + GET /v6 config in parallel, POST /verify only while unverified (400 = still pending), DELETE detach (404 ok); routing targets ONLY from recommendedCNAME / recommendedIPv4 rank 1; TXT per verification[] entry verbatim; encodeURIComponent, redirect 'error', 10 s timeout"
  - "packages/core/server/domains/auth-allow-list.ts — createLocalAuthAllowList + localAllowListEntries ledger (no-op, config.toml already allows *.localhost); createSupabaseAuthAllowList({ pat, projectRef, fetchImpl?, baseUrl? }): GET → modify → PATCH uri_allow_list, order preserved, PATCH only on change, exact-entry remove, regex-guarded entries (never a wildcard), status-only errors"
  - "packages/core/server/domains/index.ts — env-selected singletons domainProvider / authAllowList (requireEnv narrowing, never process.env) and the kernel queue's self-registration registerJobQueues([DOMAIN_VERIFY_QUEUE])"
  - "packages/core/server/domains/verify-job.ts — domainVerifyJob (never throws; z.uuid payload guard; checkDomain source 'job' as SYSTEM_ACTOR; crash path re-arms one deferred job through the platform lane)"
  - "packages/core/server/platform/domains.ts — listTenantDomains, attachDomain (platform-host / shape guards, citext idempotency, provider-before-row, one-primary + host unique-violation handling, compensation), checkDomain(domainId, actor, { source, tenantId? }) shared by route and job (single `update … where verified_at is null returning` winner; idempotent side effects: invalidateTenantHost → allow-list add under pg_advisory_xact_lock → sendPendingInvites), setPrimaryDomain (verified only, demote-then-promote in one tx), removeDomain (primary refused while aliases exist; provider → allow-list → row → cache), restartDomainVerification (expired only), rearmDomainVerification, dedupeDnsRecords"
  - "apps/api/src/routes/platform/domains.ts — domainsRoutes: GET/POST /tenants/{id}/domains, POST …/{domainId}/verify | /restart | /primary, DELETE …/{domainId} (204); chained on platformRoutes; no-store; platform.domains.* audit lines"
  - "apps/api/src/worker.ts — kernel jobs listed explicitly ([domainVerifyJob, ...module jobs]); registry untouched"
  - "@rede-social/contracts — ERROR_CODES DOMAIN_IN_USE / DOMAIN_STATE_INVALID (+ pt-BR messages), tenantDomainsListSchema / TenantDomainsList, tenantDomainParamsSchema, DOMAIN_STATE_REASONS (not_verified | primary_with_aliases | expired | not_expired)"
  - "Kernel: env.PLATFORM_HOST (optional), enqueueInTx opts.startAfter passthrough"
  - "Tests: apps/api/tests/integration/platform-domains.test.ts (16 cases), packages/core/tests/domains-{fake,vercel,allow-list}.test.ts (23 cases), supabase/tests/050-tenant-domains-invariants.sql (6)"
  - "docs/DEPLOY.md — 'Custom domains (TENANT-07, D-34)' section, Secret Manager rows vercel-token-prod / supabase-pat-prod, WR-09 amended, hosted-proof runbook item; 02-USER-SETUP.md"
affects: [02-10 invite flow (verified primary triggers the invite), 02-12 platform panel list, 02-13 branding routes (append to the same router), 02-15 Domínios tab (list/attach/verify/restart/primary/delete + DOMAIN_STATE_REASONS), 02-16 backstop, Phase 01.1 hosted proof, Phase 8 reconcile]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Kernel adapter pair behind one contract (types.ts), selected by the kernel env with the LOCAL implementation as default; production adapters use plain fetch with injected fetchImpl for unit tests, encodeURIComponent on every path, redirect 'error', AbortSignal.timeout, and error messages that carry kind + status only"
    - "ONE check function shared by the route ('Verificar agora'), the restart and the poller; the verified transition is a single `update … where verified_at is null returning` and the loser runs no side effects"
    - "Kernel-owned pg-boss queue registers itself in the kernel barrel every enqueue path imports (domains/index.ts); the worker lists kernel jobs explicitly before module jobs; the poller paces itself with startAfter + singletonKey under the `short` policy"
    - "Job handlers never throw: payload guard, try/catch, crash path re-arms one deferred job through a platform-lane helper (adapters and jobs never import admin-tx)"
    - "Cross-process read-modify-write of an external setting serialised with pg_advisory_xact_lock on a constant key inside an admin transaction"
    - "Platform sub-router per area chained with .route('/', …) on the guarded parent (02-13 appends brandingRoutes after domainsRoutes)"

key-files:
  created:
    - packages/core/server/domains/types.ts
    - packages/core/server/domains/fake.ts
    - packages/core/server/domains/vercel.ts
    - packages/core/server/domains/auth-allow-list.ts
    - packages/core/server/domains/index.ts
    - packages/core/server/domains/verify-job.ts
    - packages/core/server/platform/domains.ts
    - apps/api/src/routes/platform/domains.ts
    - apps/api/tests/integration/platform-domains.test.ts
    - packages/core/tests/domains-fake.test.ts
    - packages/core/tests/domains-vercel.test.ts
    - packages/core/tests/domains-allow-list.test.ts
    - supabase/tests/050-tenant-domains-invariants.sql
    - .planning/phases/02-tenant-shell-branding-platform-panel/02-USER-SETUP.md
  modified:
    - packages/contracts/src/errors.ts
    - packages/contracts/src/domains.ts
    - packages/core/server/http/api-error.ts
    - packages/core/server/env.ts
    - packages/core/server/jobs/boss.ts
    - apps/api/src/routes/platform/index.ts
    - apps/api/src/worker.ts
    - docs/DEPLOY.md

key-decisions:
  - "02-09: checkDomain takes an optional tenantId scope — the route passes it (another tenant's domain id is a plain 404, T-02-57), the job omits it; one function, two callers, no second read path"
  - "02-09: the poller's crash re-arm lives in platform/domains.ts (rearmDomainVerification) because Biome confines withAdminTx to server/{tenancy,platform}; domains/verify-job.ts and the adapters never touch the database directly"
  - "02-09: the case-variant invariant is pinned as the schema actually behaves — the same lower-case host on another tenant is 23505 (unique), an upper-cased spelling is 23514 (tenant_domains_host_chk, hosts are lower-cased at the boundary) and the citext lookup finds it case-insensitively; the plan's '23505 for Inv-A.Test' was unreachable"
  - "02-09: attach's provider errors map to the envelope by kind (in_use → 409 DOMAIN_IN_USE { reason: 'provider' }, invalid_domain → 400, rate_limited → 503 INTERNAL, others → 500) and a concurrent identical attach never compensates with removeDomain — the registration belongs to the winner"
  - "02-09: the fake provider's records come from the host shape only (3+ labels → CNAME, 2 → A, `needs-txt` → + TXT at _vercel.<apex>), so tests can assert exact records without fixtures"
  - "02-09: request helpers take an options object ({ method, path, body }) so every call site carries the HTTP method literally — the OPT-OUT audit (no list / redirect / account delete / records endpoints) is a grep on the adapter file"

patterns-established:
  - "Adapter contract + fake/local default + production adapter over injected fetch, unit-tested against invented targets (see tech-stack.patterns)"
  - "Single-writer verified transition with idempotent, re-runnable side effects recorded in last_error"
  - "Job never throws; re-arm through a platform-lane helper"

requirements-completed: [TENANT-07, ROLE-03]

coverage:
  - id: D1
    description: "A super_admin attaches a customer host through the API: normalised, pending, primary when first, DNS records from the provider, ~7-day deadline, one waiting kernel.domain-verify job (startAfter ≥ 590 s, singletonKey = domainId); unverified host answers 404 on by-host; 'Verificar agora' verifies on the first fake check, by-host answers 200 with isPrimary/primaryHost, the first-admin invite flips pending → sent exactly once and the allow-list has the per-domain entry"
    requirement: TENANT-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/platform-domains.test.ts#tracer (cases 1-4)"
        status: pass
    human_judgment: false
  - id: D2
    description: "kernel.domain-verify poller in the worker: never-verifies host stays pending with last_checked_at stamped and exactly one created job (duplicate re-arm dropped), past verify_deadline_at → expired with nothing enqueued, malformed payload swallowed; verify on expired → 409 { reason: 'expired' }; restart → 200 pending with a fresh deadline and job, restart on non-expired → 409 { reason: 'not_expired' }; the worker still boots and answers its probe with the kernel queue registered (policy short)"
    requirement: TENANT-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/platform-domains.test.ts#poller (cases 5-9)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/worker.test.ts (fresh-process boot with domainVerifyJob in the job list)"
        status: pass
      - kind: other
        ref: "psql: select policy from pgboss.queue where name = 'kernel.domain-verify' → short"
        status: pass
    human_judgment: false
  - id: D3
    description: "D-35 primary switching and removal: set-primary refuses unverified (409 not_verified), promotes a verified alias in one tx (alias first, former primary demoted, by-host on the former primary names the alias), is idempotent; DELETE refuses the primary while aliases exist (409 primary_with_aliases), removes a non-primary host (204: by-host 404, allow-list entry gone, provider detach counted), 404 on repeat and across tenants"
    requirement: TENANT-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/platform-domains.test.ts#primary switching and removal (cases 10-12)"
        status: pass
    human_judgment: false
  - id: D4
    description: "TENANT-07 edge ledger — idempotency (re-attach with different casing → 200 same id, no provider call; double verify never resets verified_at, no provider call, one sent invite, one auth user), adjacency (409 DOMAIN_IN_USE names neither the owner's id nor slug; platform host → 400 { host: 'platform_host' }; malformed host → 400), concurrency (two verifies + the job → one verified_at, one sent invite, one auth user), invariants (23505 second primary, 23505 same host, 23514 upper-cased host, unverified never resolves until verified_at is set — then for exactly the owning slug)"
    requirement: TENANT-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/platform-domains.test.ts#cases 13-16"
        status: pass
      - kind: integration
        ref: "supabase/tests/050-tenant-domains-invariants.sql (6/6; pgTAP 93/93)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every platform domain route sits under requireSuperAdmin() (ROLE-03), answers Cache-Control: no-store, scopes rows by tenant_id AND id, logs platform.domains.<verb>; the six operations are in /v1/openapi.json"
    requirement: ROLE-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/platform-domains.test.ts (no-store asserted on list/attach/verify/restart/primary; cross-tenant DELETE → 404)"
        status: pass
      - kind: other
        ref: "curl http://localhost:8787/v1/openapi.json | jq '.paths' → /domains (GET+POST), /{domainId} (DELETE), /verify, /restart, /primary"
        status: pass
    human_judgment: false
  - id: D6
    description: "Production adapters proven against the documented bodies over mocked fetch: Vercel add/status/config/verify/detach semantics, targets only from recommended* rank 1, TXT verbatim, 409 disambiguation, error-kind mapping, URL-encoding, no redirects, token never in messages; Supabase allow-list GET → PATCH read-modify-write, no PATCH when unchanged, exact-entry remove, wildcard refusal, PAT never in messages; env selection through requireEnv, no process.env; no OPT-OUT endpoint has code; no hard-coded generic Vercel targets"
    requirement: TENANT-07
    verification:
      - kind: unit
        ref: "packages/core/tests/domains-vercel.test.ts (10), domains-allow-list.test.ts (7), domains-fake.test.ts (6)"
        status: pass
      - kind: other
        ref: "grep audits on vercel.ts / auth-allow-list.ts / index.ts (acceptance criteria) → 0 hard-coded targets, 0 OPT-OUT endpoints, 0 wildcard entries, 0 process.env"
        status: pass
    human_judgment: false
  - id: D7
    description: "Hosted proof of the Vercel + Supabase Management calls (token scope, Cloud Run egress, whether a fresh domain shows a TXT step)"
    requirement: TENANT-07
    verification: []
    human_judgment: true
    rationale: "Phase 01.1 has not run; no hosted project exists. Recorded as the 'Attach a real customer domain end-to-end' runbook item in docs/DEPLOY.md and in 02-USER-SETUP.md — the fake/local adapters are what run locally and in CI (D-36)."

# Metrics
duration: 18min
completed: 2026-09-17
status: complete
actuals:
  tokens: 33832
  tasks: 3
  commits: 5
plan_head_before: 2293938c58cef9fe793f07ce20f12e23553e35ca
---

# Phase 02 Plan 09: Custom Domains (TENANT-07) Summary

**Custom domains through the platform API end to end: env-selected provider adapters (fake locally, Vercel Project Domains hosted) and allow-list writers (local ledger, Supabase Management API), a platform-lane service whose single `update … where verified_at is null returning` is the only writer of `verified_at`, a never-throwing `kernel.domain-verify` pg-boss poller in the worker (600 s cadence, 7-day deadline, expiry + restart), D-35 primary switching and removal, six routes on the guarded platform router — all pinned by 16 integration cases, 23 unit cases and a pgTAP invariants file.**

## Performance

- **Duration:** 18 min of execution (24 min wall clock incl. context loading)
- **Started:** 2026-09-17T00:23:08Z
- **Completed:** 2026-09-17T00:41:09Z
- **Tasks:** 3 (Task 1 tracer; Task 2 TDD RED + GREEN; Task 3 TDD RED + GREEN)
- **Files modified:** 21 (13 created, 8 modified; +2,975 / −12)

## Accomplishments

- **Adapter contracts + local implementations** (`packages/core/server/domains/`): `DomainProvider` (add / dns / verify / remove) and `AuthAllowList` (add / remove) with `DomainProviderError` carrying kind + status only; the fake provider verifies on the first check (D-36) with `needs-txt` / `never-verifies` hooks and call counters; the local allow-list is a no-op ledger. `domains/index.ts` selects by the kernel env and self-registers the kernel queue.
- **Platform-lane service** (`platform/domains.ts`): `attachDomain` (platform-host and shape guards, citext idempotency with no provider call, provider-before-row, first host primary with a one-primary retry, host-unique re-read, compensation), `checkDomain` shared by route/restart/job (winner via `verified_at is null returning`; loser runs no side effects; side effects idempotent and re-runnable: cache invalidation → allow-list add under `pg_advisory_xact_lock` → claim-before-send invites; failures recorded in `last_error`), `setPrimaryDomain`, `removeDomain`, `restartDomainVerification`, `rearmDomainVerification`.
- **Poller**: `domainVerifyJob` runs in the worker (listed explicitly before module jobs; registry untouched); `enqueueInTx` gained `startAfter`; one waiting job per host under `short`.
- **Routes**: `GET/POST /v1/platform/tenants/{id}/domains`, `POST …/{domainId}/verify | /restart | /primary`, `DELETE …/{domainId}` — under `requireSuperAdmin()`, `no-store`, tenant-scoped, audited.
- **Contracts**: `DOMAIN_IN_USE`, `DOMAIN_STATE_INVALID` (+ pt-BR), `tenantDomainsListSchema`, `tenantDomainParamsSchema`, `DOMAIN_STATE_REASONS`; kernel `PLATFORM_HOST`.
- **Production adapters**: Vercel (five documented calls, targets only from `recommended*` rank 1, TXT verbatim, 409 disambiguation, encode/no-redirect/timeout) and Supabase allow-list (GET → PATCH, regex-guarded entries, PATCH only on change).
- **Tests**: integration 135/135 (16 new incl. concurrency and invariants; worker boot still green), core unit 96/96 (23 new), API unit 15/15, pgTAP 93/93 (050 new), monorepo lint/typecheck/build green.
- **Docs**: `docs/DEPLOY.md` custom-domains section, Secret Manager rows, WR-09 amendment (runtime entries vs `supabase config push`), hosted-proof runbook item; `02-USER-SETUP.md`.

## Task Commits

1. **Task 1: tracer — attach, verify, resolve, invite** — `3b0d77f` (feat)
2. **Task 2: lifecycle expansion (TDD)** — `32a4824` (test, RED) → `a538260` (feat, GREEN)
3. **Task 3: real adapters + docs (TDD)** — `9303810` (test, RED) → `ef1595a` (feat, GREEN; includes the small options-object refactor of the request helpers made before the commit, tests green throughout)

**Plan metadata:** see the final `docs(02-09)` commit.

## TDD Gate Compliance

- Task 2: RED `32a4824` (integration file fails on the missing `verify-job` module and the absent primary/restart/delete routes; pgTAP 050 passes as a pin of the 02-03 schema) → GREEN `a538260` (16/16). No REFACTOR needed.
- Task 3: RED `9303810` (vercel module missing; `createSupabaseAuthAllowList` not a function; the fake suite passes as a contract pin) → GREEN `ef1595a` (23/23). The refactor (request helpers take `{ method, path, body }`) was folded into GREEN with tests green before and after.

## Files Created/Modified

- `packages/core/server/domains/types.ts` — contracts, error class, `allowListEntry`, queue/cadence/deadline constants
- `packages/core/server/domains/fake.ts` — env-default provider with test hooks and counters
- `packages/core/server/domains/vercel.ts` — Vercel Project Domains REST adapter
- `packages/core/server/domains/auth-allow-list.ts` — local ledger + Supabase Management API writer
- `packages/core/server/domains/index.ts` — env-selected singletons, kernel queue registration
- `packages/core/server/domains/verify-job.ts` — `domainVerifyJob`
- `packages/core/server/platform/domains.ts` — the service (list / attach / check / primary / remove / restart / rearm)
- `apps/api/src/routes/platform/domains.ts` — `domainsRoutes`; `apps/api/src/routes/platform/index.ts` — chained
- `apps/api/src/worker.ts` — kernel jobs merged
- `packages/contracts/src/{errors,domains}.ts`, `packages/core/server/http/api-error.ts`, `packages/core/server/env.ts`, `packages/core/server/jobs/boss.ts`
- `apps/api/tests/integration/platform-domains.test.ts`, `packages/core/tests/domains-{fake,vercel,allow-list}.test.ts`, `supabase/tests/050-tenant-domains-invariants.sql`
- `docs/DEPLOY.md`, `.planning/phases/02-…/02-USER-SETUP.md`

## Decisions Made

- `checkDomain(domainId, actor, { source, tenantId? })`: the route scopes by tenant (404 for another tenant's id), the job does not — one function, no second read path.
- The job's crash re-arm is a platform-lane helper (`rearmDomainVerification`) because Biome confines `withAdminTx` to `server/{tenancy,platform}`; `domains/*` (adapters + job) never import the database.
- Provider-error → envelope mapping on attach: `in_use` → 409 `DOMAIN_IN_USE { reason: 'provider' }`, `invalid_domain` → 400, `rate_limited` → 503 `INTERNAL` (+ `platform.domains.provider_rate_limited`), others → 500. A concurrent identical attach re-reads the winner and never calls `removeDomain`.
- Request helpers take an options object so every call site carries the HTTP method literally; the COVERAGE OPT-OUT audit is a grep on the adapter file (0 hits).
- `already_verified` answers the fresh row after re-running the idempotent side effects — that is what makes a failed allow-list call recoverable from "Verificar agora".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's case-variant invariant (`Inv-A.Test` → 23505) is unreachable on the 02-03 schema**
- **Found during:** Task 2 RED (first pgTAP run: `caught 23514 tenant_domains_host_chk, wanted 23505`)
- **Issue:** `tenant_domains_host_chk` (`^[a-z0-9.-]{1,253}$`) refuses any upper-case host before the unique index is reached; hosts are lower-cased at the boundary by `normalizeHost`, so the citext uniqueness is exercised by same-spelling collisions and case-insensitive lookups, not by upper-cased inserts.
- **Fix:** pgTAP 050 case 2 inserts the same lower-case host for tenant B (23505) and case 5 looks the verified host up as `INV-A.TEST` (citext, exactly one tenant); the integration invariants case asserts 23505 for the same spelling, 23514 for the upper-cased spelling, and a citext count of 1 for `ALIAS-….CLIENTE.TEST`. `plan(6)` with three `throws_ok` kept.
- **Files modified:** `supabase/tests/050-tenant-domains-invariants.sql`, `apps/api/tests/integration/platform-domains.test.ts`
- **Verification:** pgTAP 93/93, platform-domains 16/16
- **Committed in:** `32a4824`

**2. [Rule 3 - Blocking] Crash re-arm moved out of `verify-job.ts` into the platform lane**
- **Found during:** Task 2 (design) — the plan asked `verify-job.ts` to re-arm "through `withAdminTx` + `enqueueInTx`", but its own acceptance criterion requires `grep -l "admin-tx" packages/core/server/domains/*.ts` to print nothing and Biome forbids the import there.
- **Fix:** `rearmDomainVerification(domainId)` in `platform/domains.ts` (loads the row, re-arms only when still pending); the job calls it in its catch path.
- **Files modified:** `packages/core/server/platform/domains.ts`, `packages/core/server/domains/verify-job.ts`
- **Committed in:** `a538260`

---

**Total deviations:** 2 auto-fixed (1 bug in a planned assertion, 1 blocking lint/acceptance conflict). **Impact:** both keep the plan's intent (the invariants are pinned more precisely; the job never touches the database); no scope creep.

## Issues Encountered

- `pnpm --filter @rede-social/core test -- domains` and `pnpm test:integration -- <filters>` do not forward file filters (known from 02-01/02-05): the whole suites ran each time (core 96/96, integration 135/135), which is stronger than the filtered acceptance run. Single-file runs used `pnpm --filter <pkg> exec vitest run <file>`.
- The `curl …/v1/openapi.json` acceptance check hit the developer's `pnpm --filter @rede-social/api dev` listener on 8787 (tsx watch), which had reloaded the new routes — all six operations present. The integration global setup reused that listener (`EADDRINUSE` path) for the GoTrue hook, as designed in 02-06.
- The secret-file read guard prevented confirming `PLATFORM_HOST` / `DOMAIN_PROVIDER` names inside `apps/api/.env.local`; the integration run proved them (attach of `rede-social.localhost` answered `400 { host: 'platform_host' }`, the fake provider ran).

## User Setup Required

**External services require manual configuration — hosted environments only, deferred to the Phase 01.1 runbook.** See [02-USER-SETUP.md](./02-USER-SETUP.md) for the `api` / `worker` variables (`DOMAIN_PROVIDER`, `VERCEL_TOKEN` / `VERCEL_PROJECT_ID` / `VERCEL_TEAM_ID`, `AUTH_ALLOW_LIST`, `SUPABASE_PAT` / `SUPABASE_PROJECT_REF`), the Secret Manager rows and the verification steps. Locally and in CI nothing is needed (fake / local defaults).

## Human-check notes for the end-of-phase verifier

- With the API dev server running, `curl -s http://localhost:8787/v1/openapi.json | jq '.paths | keys'` lists the five domain paths (six operations). The panel UI (02-15) is the place to eyeball the flow; until then the integration suite is the proof.
- Hosted proof (coverage D7) cannot be done locally — see `docs/DEPLOY.md` runbook item "Attach a real customer domain end-to-end".

## Known Stubs

None — no placeholder values flow to any consumer; the `fake` / `local` adapters are deliberate, documented environment defaults (D-36), not stubs.

## Threat Flags

None beyond the plan's `<threat_model>`: the new surface (six platform routes, two outbound REST clients, one pg-boss queue) is exactly the register's T-02-50..59; mitigations are implemented as listed (single-writer verified transition, tenant-scoped reads, no owner in the 409 body, secrets from the kernel env only, kind+status error messages, encode/no-redirect/timeout, advisory-locked allow-list writes, regex-guarded entries, never-throwing handler with cadence + deadline).

## Next Phase Readiness

- 02-10 (invite flow): a verified primary now triggers `sendPendingInvites` from the API and the poller; `02-USER-SETUP.md` is the place for any further hosted items.
- 02-12 / 02-15 (panel): consume `tenantDomainsListSchema`, `DOMAIN_STATE_REASONS` and the six routes; `dnsRecords` are validated strings to render as text nodes with copy buttons (T-02-56).
- 02-13: append `.route('/', brandingRoutes)` after `domainsRoutes` in `routes/platform/index.ts` and list any kernel job in `worker.ts` the same way.
- Phase 01.1: hosted proof + secrets (`vercel-token-prod`, `supabase-pat-prod`); Phase 8: provider reconciliation and the allow-list reconcile command.

---
*Phase: 02-tenant-shell-branding-platform-panel*
*Completed: 2026-09-17*

## Self-Check: PASSED

All 14 created files exist on disk; task commits 3b0d77f, 32a4824, a538260, 9303810 and ef1595a are in history; commits measured from plan_head_before 2293938 = 5.
