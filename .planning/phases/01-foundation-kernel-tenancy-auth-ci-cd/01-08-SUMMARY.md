---
phase: 01-foundation-kernel-tenancy-auth-ci-cd
plan: 08
subsystem: testing
tags: [pgtap, rls, multi-tenant, vitest, playwright, turborepo-boundaries, biome, supabase-cli, drizzle]

# Dependency graph
requires:
  - phase: 01-01
    provides: "kernel lanes (withTenantTx/withAdminTx), api_user role, app.* helpers, core schema + RLS policies, integration test harness"
  - phase: 01-03
    provides: "lane spike, platform_admins with RLS and zero policies, SCHEMA-CONVENTIONS.md"
  - phase: 01-04
    provides: "consent_records (append-only, select-only policy)"
  - phase: 01-05
    provides: "403 contracts (MEMBERSHIP_BLOCKED, NO_MEMBERSHIP, TENANT_HOST_MISMATCH)"
  - phase: 01-06
    provides: "tenant_modules, requireModule/requireRole guards, platform lane, super_admin seed"
  - phase: 01-07
    provides: "@tria/module-example (example_items, guarded routes, pgboss schema and its role switch)"
  - phase: 01-09
    provides: "ci.yml, which already called `pnpm boundaries:negative` and `supabase test db`"
provides:
  - "Five pgTAP files (71 assertions) proving RLS coverage, cross-tenant isolation, lane roles and the schema conventions INSIDE Postgres, re-runnable on every CI run"
  - "apps/api/tests/integration/isolation.test.ts — the two-tenant API exit gate (11 cases: list, detail, empty, disabled module, blocked mid-session, cookie/host override, host mismatch, platform identity, public host lookup)"
  - "@tria/boundary-fixture + scripts/check-boundaries.sh — MOD-02 made falsifiable: both enforcement layers must reject a module that crosses a boundary"
  - "`pnpm boundaries` exits 0 for the first time (turbo tag rules corrected); `pnpm boundaries:negative` exists, so ci.yml no longer references missing targets"
  - "A clean `supabase db reset` from an empty database with the entire Phase 1 suite green in 90 s, and `db:generate` proven to be a no-op"
  - "scripts/local-env.sh emits the seed credentials, and playwright.config.ts loads .env.local — a clean machine runs the whole suite with no variables typed by hand"
affects: [01-10, 01-11, 01-12, phase-2-domains, phase-4-feed, every-later-phase]

actuals:
  tokens: 17247      # 68,990 chars / 4 over `git diff 896fa6b..HEAD`; estimate was 65,000
  tasks: 3
  commits: 3         # MEASURED: git rev-list --count 896fa6b..HEAD before the docs commit (#3968)
plan_head_before: 896fa6b9078082b388f954c953c03361a992b99a

tech-stack:
  added: [pgTAP 3.36 via supabase/pg_prove, "supabase test db"]
  patterns:
    - "pgTAP file layout: 000-helpers commits (installs pgTAP + a `tests` schema); 010..040 each open their own transaction and roll it back, so file order can never change a result and the suite is idempotent against a seeded or empty database"
    - "Lane helpers in SQL mirror the kernel: `set_config(..., is_local => true)` from a plain plpgsql function (no SET clause, no SECURITY DEFINER) leaves the role in place for the transaction and dies with it"
    - "Adjacency by construction: both tenants carry identical-looking content (same title, same message body, same `member@…` local part) so every assertion has to compare ids"
    - "A negative fixture package proves a lint rule still bites; the check fails loudly when the linter exits non-zero for the wrong reason"

key-files:
  created:
    - supabase/tests/000-helpers.sql
    - supabase/tests/010-rls-coverage.sql
    - supabase/tests/020-tenant-isolation.sql
    - supabase/tests/030-lanes.sql
    - supabase/tests/040-schema-conventions.sql
    - apps/api/tests/integration/isolation.test.ts
    - scripts/check-boundaries.sh
    - packages/boundary-fixture/{package.json,turbo.json,tsconfig.json,src/index.ts}
  modified:
    - turbo.json
    - biome.json
    - packages/core/docs/SCHEMA-CONVENTIONS.md
    - scripts/local-env.sh
    - apps/web/playwright.config.ts
    - apps/api/tests/integration/modules.test.ts

key-decisions:
  - "pgTAP helpers switch roles with `set_config('role', …, true)` rather than a bare `SET LOCAL ROLE` inside the function, because a plain plpgsql function opens no GUC nesting level — the lane survives the call exactly as `withTenantTx` intends"
  - "`api_user` cannot be asserted to fail `set local role postgres` from pg_prove (SET ROLE is checked against the SESSION user, which is postgres there). The catalogue assertion replaces it: api_user is a member of exactly {authenticated, service_role}"
  - "Dropped the `contracts` and `tooling` turbo boundary tag rules: turbo 2.10.12 mis-attributes their dependency edges (it reports @tria/config — zero workspace dependencies in package.json and in the lockfile importer — as depending on @tria/core and @tria/contracts), so any rule written there fails the correct graph"
  - "Dropped `module.dependents.deny: [\"module\"]`: redundant with `module.dependencies.allow`, and the only rule the negative fixture could not exercise without turning the positive run red (`--filter` excludes a package from being checked, not from the graph)"
  - "The fixture is linted by the PROJECT'S OWN biome.json, not a fixture-local copy: Biome 2.5.13 refuses a second config inside a project that already has a root one, and exercising the real configuration is the stronger claim anyway"
  - "`@tria/module-example` is imported but NOT declared in the fixture's dependencies — a declared edge would trip the other end's rules during the positive run, and undeclared is the truthful shape of reaching into another module's internals"

patterns-established:
  - "Test gate rule 1: every new tenant-owned table adds a case to supabase/tests/020-tenant-isolation.sql"
  - "Test gate rule 2: every new endpoint adds a cross-tenant case to apps/api/tests/integration/isolation.test.ts"
  - "Both gates seed identical-looking data in the two tenants; assertions compare ids, never contents"

requirements-completed: [TENANT-05, TENANT-03, MOD-02, ROLE-01, ROLE-02]

coverage:
  - id: D1
    description: "Every table in `public` has RLS, and every table with a tenant_id column has at least one policy — asserted from the catalogue, so a table added in a later phase is covered the day it is created"
    requirement: TENANT-03
    verification:
      - kind: integration
        ref: "supabase/tests/010-rls-coverage.sql (4 assertions, via `pnpm supabase test db`)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A tenant lane cannot list, read by id, insert or update another tenant's rows in example_items, memberships, tenant_modules, tenant_domains, consent_records, chat_conversations/participants/messages, notifications or platform_admins — with identical-looking content on both sides, and proved symmetrically from both lanes"
    requirement: TENANT-05
    verification:
      - kind: integration
        ref: "supabase/tests/020-tenant-isolation.sql (25 assertions)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Lane roles: api_user owns nothing until it opens a lane (42501), the tenant lane runs as `authenticated` with the bound claims, a claimless lane returns zero rows, service_role bypasses RLS, and no runtime role has rolbypassrls or can become postgres"
    requirement: TENANT-03
    verification:
      - kind: integration
        ref: "supabase/tests/030-lanes.sql (15 assertions)"
        status: pass
    human_judgment: false
  - id: D4
    description: "ROLE-01/ROLE-02 at the schema level: users carries no tenant_id and no role, memberships rejects `super_admin` (23514), a second membership for the same user is 23505, platform_admins has ZERO policies, consent_records has no update/delete policy, every tenant table is indexed tenant-first, and tenant_domains is citext + globally unique + one primary per tenant + lane-read-only"
    requirement: ROLE-01
    verification:
      - kind: integration
        ref: "supabase/tests/040-schema-conventions.sql (26 assertions)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The API-level two-tenant gate: cross-tenant list and detail, disabled module 404, empty tenant 200 [], a member blocked between two requests, cookie/unknown host cannot override the membership, a session of tenant A on tenant B's registered host is 403 TENANT_HOST_MISMATCH with no row and no tenant name, the platform identity, and the public by-host lookup"
    requirement: TENANT-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts (11 cases, via `pnpm test:integration`)"
        status: pass
    human_judgment: false
  - id: D6
    description: "MOD-02 is build-failing and falsifiable: a module-tagged package that imports an app package, the kernel's admin lane and another module's internals is rejected by turbo boundaries (3 violations) and by the project's own Biome config (3 noRestrictedImports errors), while the legitimate graph passes"
    requirement: MOD-02
    verification:
      - kind: other
        ref: "pnpm boundaries (exit 0) && pnpm boundaries:negative (exit 0) && pnpm turbo boundaries --filter=@tria/boundary-fixture (exit 1)"
        status: pass
    human_judgment: false
  - id: D7
    description: "[BLOCKING] Migrations apply cleanly from an empty database through the Supabase CLI only (9/9), and the entire Phase 1 suite is green from that state; db:generate is a no-op, so the Drizzle schema and supabase/migrations are in sync"
    requirement: TENANT-03
    verification:
      - kind: other
        ref: "pnpm db:reset && pnpm supabase test db && pnpm db:seed && pnpm turbo lint typecheck build test && pnpm boundaries && pnpm boundaries:negative && pnpm guard:lanes && pnpm test:integration && pnpm spike:supavisor && pnpm e2e && pnpm db:generate && test -z \"$(git status --porcelain supabase/migrations)\" — exit 0, 90 s"
        status: pass
    human_judgment: false
  - id: D8
    description: "The image built from the post-01-07 tree still boots without a database: /v1/health answers {\"ok\":true} with DATABASE_URL pointing at a closed port (the API never starts pg-boss at boot)"
    verification:
      - kind: other
        ref: "docker build -f apps/api/Dockerfile -t tria-api:local . && docker run … -e DATABASE_URL=postgres://x:y@127.0.0.1:1/x -e ROLE=api && curl /v1/health"
        status: pass
    human_judgment: false
  - id: D9
    description: "A clean machine can go from `pnpm supabase start` to the full green suite using only documented steps — local-env.sh now generates the seed credentials and Playwright loads them"
    verification:
      - kind: other
        ref: "bash scripts/local-env.sh --write && pnpm db:seed && pnpm e2e (no variables passed on the command line)"
        status: pass
    human_judgment: false

duration: 78min
completed: 2026-09-13
status: complete
---

# Phase 01 Plan 08: Two-tenant isolation gate Summary

**71 pgTAP assertions inside Postgres plus an 11-case API suite that prove one tenant's session can never reach another tenant's row, a negative fixture that makes the module boundary falsifiable, and a clean `db:reset` with the whole Phase 1 suite green in 90 seconds.**

## Performance

- **Duration:** 78 min
- **Started:** 2026-09-13T14:45Z
- **Completed:** 2026-09-13T16:01Z
- **Tasks:** 3
- **Files modified:** 18 (12 created, 6 modified)

## Accomplishments

- **The database now proves its own isolation.** `pnpm supabase test db` runs 71 assertions across five files: every `public` table has RLS and every tenant table has a policy (010); a tenant lane sees its own rows and zero rows of the other tenant across nine tables, with a `42501` on a cross-tenant insert and a zero-row cross-tenant update (020); `api_user` owns nothing until it opens a lane and a claimless lane returns zero rows rather than everything (030); `users` has no tenant or role column, `memberships` rejects `super_admin`, `platform_admins` has zero policies and `tenant_domains` is case-proof (040). It passes twice in a row on the same database and from an empty one.
- **`isolation.test.ts` is the API-level exit gate.** Eleven cases, every one comparing ids: the other tenant's item is `404 NOT_FOUND` and never `403`; a tenant without the module gets `404 MODULE_DISABLED` on read *and* write; a tenant with the module and no rows gets `200 { items: [] }` while the neighbour demonstrably has rows; a member blocked between two requests is refused on the very next one with the same token; a cookie and an unknown host saying "tria-lab" still yield tria-demo's data; and a tria-demo session on tria-lab's registered host is `403 TENANT_HOST_MISMATCH` with no details, no tenant name and no lab id anywhere in the body — on `/me/bootstrap` and on `/v1/example/items`, in both directions.
- **MOD-02 is falsifiable again.** `@tria/boundary-fixture` imports an app package, the kernel's admin lane and another module's internals; `pnpm boundaries:negative` requires *both* layers to reject it and fails loudly if Biome exits non-zero for any other reason (the "no files were processed" false green was caught during development and is now an explicit failure branch).
- **`pnpm boundaries` exits 0 for the first time in this phase**, and both CI targets that 01-09 had already wired now exist — broken window #7 closed.
- **The [BLOCKING] clean apply passed.** From `supabase stop --no-backup`: 9/9 migrations through the Supabase CLI only, then pgTAP → seed → lint/typecheck/build/test (20 tasks) → boundaries → negative boundaries → lane guard → 69 integration tests → the Supavisor spike → 64 e2e tests → `db:generate` no-op, in 90 s end to end.

## Task Commits

1. **Task 1: pgTAP suite** — `5672df1` (test)
2. **Task 2: API isolation suite + MOD-02 negative fixture** — `fbd8046` (feat)
3. **Task 3: [BLOCKING] clean schema apply** — `71a03ec` (fix)

## Files Created/Modified

- `supabase/tests/000-helpers.sql` — pgTAP + the `tests` schema (fixtures and lane helpers). The only file that commits.
- `supabase/tests/010-rls-coverage.sql` — RLS/policy coverage from the catalogue (4 assertions).
- `supabase/tests/020-tenant-isolation.sql` — cross-tenant negatives with identical-looking content, both lanes (25).
- `supabase/tests/030-lanes.sql` — `api_user` privileges, claimless lane, role catalogue (15).
- `supabase/tests/040-schema-conventions.sql` — ROLE-01/02, platform_admins, consent_records, tenant-first indexes, D-20 (26).
- `apps/api/tests/integration/isolation.test.ts` — the two-tenant API gate (11 cases).
- `scripts/check-boundaries.sh` — `pnpm boundaries:negative`; both layers must reject the fixture.
- `packages/boundary-fixture/*` — the module-tagged package that violates all three lanes on purpose.
- `turbo.json` — corrected boundary tag rules (see Deviations).
- `biome.json` — the fixture is linted by the root config; the module lane now also refuses `@tria/module-*/{server,db,ui,contracts}/*` and `@tria/api*`.
- `packages/core/docs/SCHEMA-CONVENTIONS.md` — §(j) Test gate rewritten: the six files, what each refuses, and the two rules that keep the gate honest.
- `scripts/local-env.sh` — emits `SEED_PASSWORD` / `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD`.
- `apps/web/playwright.config.ts` — loads `apps/web/.env.local` before specs are collected.
- `apps/api/tests/integration/modules.test.ts` — module ordering assertion brought up to date with 01-07.

## Decisions Made

See `key-decisions` in the frontmatter. The two that will matter later:

- **The turbo boundary layer is now three tags, not five.** `contracts` and `tooling` carry no rule block because turbo 2.10.12 attributes their dependency edges incorrectly on this graph. Both are leaf packages, so nothing real is uncovered; the import-level lanes are Biome's job and the fixture proves that layer independently. If a future turbo release fixes the attribution, the two blocks can come back (the comment in `turbo.json` records the exact symptom to re-test).
- **`030-lanes.sql` cannot assert `set local role postgres` fails for `api_user`.** PostgreSQL checks `SET ROLE` against the *session* user, and pg_prove connects as `postgres`, so the statement succeeds no matter which role is current. The honest catalogue assertion replaced it: `api_user` is a member of exactly `{authenticated, service_role}`, plus `NOINHERIT`, plus no `rolbypassrls`/`rolsuper`.

## Inherited Debt — disposition

1. **`pnpm boundaries` broken since 01-04** — CLOSED. `scripts/check-boundaries.sh` and `@tria/boundary-fixture` now exist, and the positive run was additionally red for three pre-existing tag violations that had nothing to do with the missing script; both are fixed (`pnpm boundaries` exit 0, `pnpm boundaries:negative` exit 0).
2. **`ci.yml` referencing missing targets** — CLOSED. Broken window #7 marked fixed. CI's step order is mirrored exactly by Task 3's chain.
3. **`SUPER_ADMIN_PASSWORD` local-environment gap** — CLOSED. `.env.example` already listed all three variables; what was missing was generation. `scripts/local-env.sh` now emits `SEED_PASSWORD`, `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` (local throwaways, overridable by export), and `playwright.config.ts` loads that file the way `apps/api/vitest.config.ts` already did. `db:reset → local-env.sh --write → db:seed → full suite` now runs with nothing typed by hand. No value was printed into the execution transcript.
4. **`pg_policy` count = 0 for `platform_admins`, not merely "RLS enabled"** — DONE, and doubled: `040` asserts both the zero-policy count *and* that RLS is still enabled (without it the schema-wide `authenticated` SELECT grant from 01-01's `alter default privileges` would apply), while `020` inserts a real `platform_admins` row and asserts the tenant lane counts zero.
5. **`GET /v1/openapi.json` public in every environment** — NOT taken. It is an exposure/configuration concern, not a schema or convention invariant, so it has no natural home in `040`. Left for 01-09's environment restrictions, as the note allowed. Flagged below under Threat Flags so it is not lost.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `pnpm boundaries` was red for three pre-existing tag violations**
- **Found during:** Task 2
- **Issue:** Independently of the new fixture, `turbo boundaries` reported three violations on the correct graph: `@tria/config` — a package whose `package.json` and lockfile importer declare ZERO workspace dependencies — was reported as depending on `@tria/core` and `@tria/contracts`, and `@tria/contracts` as depending on `@tria/core`. Verified by moving the fixture out of the workspace entirely and re-running (`3 issues found`), so it was not caused by this plan.
- **Fix:** Removed the `contracts` and `tooling` tag rule blocks from `turbo.json` with a comment recording the exact symptom. Both are leaves; the rules were near-vacuous and could only ever produce false failures on this graph.
- **Files modified:** `turbo.json`
- **Verification:** `pnpm boundaries` exit 0, 142 files in 7 packages, no issues.
- **Committed in:** `fbd8046`

**2. [Rule 3 - Blocking] `module.dependents.deny: ["module"]` made the positive run red whenever the fixture existed**
- **Found during:** Task 2
- **Issue:** `pnpm boundaries` filters the fixture out with `--filter='!@tria/boundary-fixture'`, but `--filter` excludes a package from being *checked*, not from the graph — so `@tria/module-example`'s `dependents` rule still saw the fixture and failed the positive run. It fired on the import alone, with or without a declared dependency.
- **Fix:** Removed the rule. It is redundant: the same module → module edge already fails `module.dependencies.allow` and is reported against the importing package, which is where it belongs and where real modules are checked. The fixture still produces three turbo violations (undeclared import, app tag, module tag).
- **Files modified:** `turbo.json`, `packages/boundary-fixture/package.json`
- **Verification:** `pnpm boundaries` exit 0; `pnpm turbo boundaries --filter=@tria/boundary-fixture` exit 1 with 3 issues.
- **Committed in:** `fbd8046`

**3. [Rule 3 - Blocking] A fixture-local `biome.json` cannot exist — plan step 2.3 adapted**
- **Found during:** Task 2
- **Issue:** The plan asked for `packages/boundary-fixture/biome.json` extending the root config with its own `files.includes`. Extending kept the root's `!packages/boundary-fixture` exclusion, so Biome processed 0 files and exited 1 with "No files were processed" — a false green for the negative check. Making it standalone produced `Found a nested root configuration, but there's already a root configuration` (Biome 2.5.13), with or without `root: true`.
- **Fix:** Deleted the fixture-local config. The root `biome.json` no longer excludes the fixture, and the existing `packages/modules/**` override now also matches `packages/boundary-fixture/**` — so the fixture is held to exactly the rules a real module is held to. `check-boundaries.sh` passes `--config-path=.` to pin the root config explicitly, and additionally requires the word `noRestrictedImports` in Biome's output, so a non-zero exit for any other reason is reported as a false negative rather than a pass.
- **Files modified:** `biome.json`, `scripts/check-boundaries.sh`
- **Verification:** `pnpm biome lint --config-path=. packages/boundary-fixture/src` → 3 `noRestrictedImports` errors, exit 1; `pnpm turbo lint` still exit 0 (20 tasks).
- **Committed in:** `fbd8046`

**4. [Rule 2 - Missing Critical] The module import lane never matched a deep import**
- **Found during:** Task 2
- **Issue:** The `packages/modules/**` Biome rule restricted `@tria/module-*/src/**`, which never matches a published-looking subpath such as `@tria/module-example/server/service` — precisely how one module would reach another's internals. A real module could have done it unnoticed.
- **Fix:** Added `@tria/module-*/{server,db,ui,contracts}/*` to the "Import published entry points only" group, and `@tria/api` / `@tria/api/*` as "A module may not import an app package".
- **Files modified:** `biome.json`
- **Verification:** the fixture's `@tria/module-example/server/service` import is now reported; `pnpm turbo lint` exit 0 (no real module regressed).
- **Committed in:** `fbd8046`

**5. [Rule 1 - Bug] `modules.test.ts` asserted a pre-01-07 module ordering**
- **Found during:** Task 3 (it only surfaced once the suite could actually run — see Inherited Debt 3)
- **Issue:** Case 1 asserted the seven tria-demo keys sorted alphabetically, with the comment "no manifest exists yet". 01-07 shipped `@tria/module-example` with `nav.order 90`, so `example` now leads and the six manifest-less keys follow (`MODULE_KEY_ORDER_FALLBACK = 1000`). The test had never run since 01-07 because it requires `SUPER_ADMIN_PASSWORD`.
- **Fix:** The case now asserts the ordering RULE and the module's `nav` object, and the comment explains what Phase 4 will change when the throwaway module is deleted.
- **Files modified:** `apps/api/tests/integration/modules.test.ts`
- **Verification:** `pnpm test:integration` → 7 files, 69 tests, all pass.
- **Committed in:** `71a03ec`

**6. [Rule 3 - Blocking] The e2e suite still demanded a hand-exported `SEED_PASSWORD`**
- **Found during:** Task 3
- **Issue:** `apps/web/e2e/fixtures.ts` throws at import time without `SEED_PASSWORD`, and Playwright — unlike `apps/api/vitest.config.ts` — never read `.env.local`. Generating the value was therefore not enough.
- **Fix:** `playwright.config.ts` calls `process.loadEnvFile('apps/web/.env.local')` when the file exists; anything already exported still wins, which is how CI passes its own values.
- **Files modified:** `apps/web/playwright.config.ts`
- **Verification:** `pnpm e2e` → 64 passed, with no variables on the command line.
- **Committed in:** `71a03ec`

**7. [Rule 1 - Bug] Two pgTAP assertions from the plan were untestable or wrong as written**
- **Found during:** Task 1
- **Issue:** (a) `throws_ok('set local role postgres', '42501')` as `api_user` **succeeds** — PostgreSQL checks `SET ROLE` against the session user, which is `postgres` under pg_prove. (b) Inserting `host = 'A.TEST'` raises `23514` (`tenant_domains_host_chk` requires lowercase), not the `23505` the plan expected — the check constraint fires before uniqueness.
- **Fix:** (a) replaced with the catalogue statement of the same property: `api_user` is a member of exactly `{authenticated, service_role}`. (b) split into three assertions that together cover the real behaviour: a duplicate lowercase host for another tenant is `23505`, an upper-case host is refused at storage time with `23514`, and a `citext` lookup with `'CONV-A.TEST'` still finds the stored row.
- **Files modified:** `supabase/tests/030-lanes.sql`, `supabase/tests/040-schema-conventions.sql`
- **Verification:** `pnpm supabase test db` → 71 assertions, PASS, twice consecutively.
- **Committed in:** `5672df1`

**8. [Rule 3 - Blocking] pg_prove's connection role could not open the api_user lane**
- **Found during:** Task 1
- **Issue:** `postgres` created `api_user` and holds ADMIN OPTION on it, but PostgreSQL 16+ grants CREATE ROLE membership with `SET FALSE`, so `set role api_user` was denied. `api_user` also lacks `USAGE` on `extensions`, where pgTAP lives, so `is()` was unresolvable while impersonating it.
- **Fix:** `tests.allow_role_switch()` grants both, and is called inside `030`'s transaction, so both grants roll back with the file. Neither touches `public`, so what `030` proves about `api_user`'s data privileges is unaffected.
- **Files modified:** `supabase/tests/000-helpers.sql`, `supabase/tests/030-lanes.sql`
- **Verification:** `030` asserts `current_user = 'api_user'` and a `42501` on `public.tenants` in the same transaction.
- **Committed in:** `5672df1`

**9. [Rule 3 - Blocking] The `Host:` header was dropped from isolation case (f)**
- **Found during:** Task 2
- **Issue:** The plan asked for `Cookie: tenant_slug=tria-lab` + `Host: tria-lab.example` + `x-tenant-host: tria-lab.example`. `Host` is a forbidden header name on `Request` and, more importantly, `requireAuth` explicitly never reads `Host`/`X-Forwarded-Host` (01-01) — asserting on it would test the fetch implementation, not the product.
- **Fix:** The case sends the cookie and `x-tenant-host` (an unregistered host) and asserts `tenant.slug === 'tria-demo'`. The header the API *does* read is covered by case (f2) with a registered host.
- **Files modified:** `apps/api/tests/integration/isolation.test.ts`
- **Verification:** case (f) passes; `requireAuth`'s comment confirms `Host` is never read.
- **Committed in:** `fbd8046`

---

**Total deviations:** 9 auto-fixed (3 × Rule 1 bug, 1 × Rule 2 missing critical, 5 × Rule 3 blocking)
**Impact on plan:** No scope creep. Six of the nine are the clean-apply and the negative fixture doing exactly what they exist to do — surfacing a claim that was never actually checked. The two turbo.json rule removals are the only reduction in stated coverage, and both are documented in the file with the symptom to re-test.

## Issues Encountered

- **`turbo boundaries` tag semantics could not be pinned down by reading.** Four experiments (adding a tag to an allowlist, swapping `allow` for `deny`, removing a devDependency, moving the fixture out of the workspace) were needed to establish that the two leaf-tag rules mis-attribute their edges. The evidence is recorded in the `turbo.json` comment so the next person does not repeat it.
- **The first `pnpm boundaries:negative` implementation was a false green** — Biome exited 1 with "No files were processed". The script now requires `noRestrictedImports` to appear in the output, so that class of failure is reported as a failure.

## User Setup Required

None — no external service configuration. Local setup is now fully generated: `pnpm supabase start` → `pnpm db:reset` → `bash scripts/local-env.sh --write` → `pnpm db:seed` → the whole suite.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: information_disclosure | `apps/api/src/app.ts` | `GET /v1/openapi.json` is registered unconditionally, so the full route surface is public in every environment. Carried over from 01-01; not asserted here because it is a configuration concern rather than a schema invariant. Owed by 01-09's environment restrictions. |

## Known Stubs

None introduced by this plan. Open broken windows #2, #5, #6 and #9 remain and are owned by Phase 7 (chat/notifications) and Phase 4 (deleting `@tria/module-example`); #7 and #8 were closed here.

## Next Phase Readiness

- The phase's exit gate is installed and green from an empty database. Every later phase inherits it as a regression gate, with the two rules now written into `packages/core/docs/SCHEMA-CONVENTIONS.md` §(j): a new tenant table adds a case to `020`, a new endpoint adds a cross-tenant case to `isolation.test.ts`.
- `ci.yml` (01-09) runs exactly this order and no longer references anything missing.
- Remaining in phase 01: 01-10, 01-11 and 01-12. 01-12's staging run is still the authoritative transaction-pooler proof for TENANT-03 — the local Supavisor refuses `api_user`, so the local `DATABASE_URL` uses the direct port and `pnpm spike:supavisor` is a contingency check, not the proof.
- Concern for 01-12: the migration count assertion in this plan is `9 == 9`. Any plan that adds a migration must re-run `pnpm db:reset` from empty rather than an incremental apply, or drift will only be caught by `db:generate`.

---
*Phase: 01-foundation-kernel-tenancy-auth-ci-cd*
*Completed: 2026-09-13*

## Self-Check: PASSED

All 11 files listed in `key-files.created` exist on disk; all three task commits (`5672df1`, `fbd8046`, `71a03ec`) are present in `git log`. The plan-level verification chain was re-run end to end from an empty database after the last fix and exited 0.
