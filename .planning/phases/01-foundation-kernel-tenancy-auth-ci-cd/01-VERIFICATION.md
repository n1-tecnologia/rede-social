---
phase: 01-foundation-kernel-tenancy-auth-ci-cd
verified: 2026-09-14T21:54:37Z
status: passed
score: 29/30 must-haves verified
covered_files: [".github/workflows/ci.yml",".github/workflows/deploy-api.yml",".github/workflows/keepalive-staging.yml",".github/workflows/seed-prod.yml",".planning/REQUIREMENTS.md",".planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-01-PLAN.md",".planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-01-SUMMARY.md",".planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-02-PLAN.md",".planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-02-SUMMARY.md",".planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-03-PLAN.md",".planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-03-SUMMARY.md",".planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-04-PLAN.md",".planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-04-SUMMARY.md",".planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-05-PLAN.md",".planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-05-SUMMARY.md",".planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-06-PLAN.md",".planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-06-SUMMARY.md",".planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-07-PLAN.md",".planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-07-SUMMARY.md",".planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-08-PLAN.md",".planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-08-SUMMARY.md",".planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-09-PLAN.md",".planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-09-SUMMARY.md","apps/api/Dockerfile","apps/api/drizzle.config.ts","apps/api/package.json","apps/api/src/app-type.ts","apps/api/src/app.ts","apps/api/src/env.ts","apps/api/src/http/logger.ts","apps/api/src/http/openapi.ts","apps/api/src/http/request-id.ts","apps/api/src/main.ts","apps/api/src/modules/registry.ts","apps/api/src/routes/health.ts","apps/api/src/routes/me.ts","apps/api/src/routes/platform.ts","apps/api/src/routes/public.ts","apps/api/src/worker.ts","apps/api/tests/integration/auth-middleware.test.ts","apps/api/tests/integration/bootstrap.test.ts","apps/api/tests/integration/example.test.ts","apps/api/tests/integration/gotrue-signup-disabled.test.ts","apps/api/tests/integration/health-no-db.ts","apps/api/tests/integration/health.test.ts","apps/api/tests/integration/isolation.test.ts","apps/api/tests/integration/jobs.test.ts","apps/api/tests/integration/modules.test.ts","apps/api/tests/integration/setup.ts","apps/api/tests/integration/signup.test.ts","apps/api/tests/integration/worker.test.ts","apps/api/tests/unit/health.test.ts","apps/api/tests/unit/mounts.test.ts","apps/api/tests/unit/registry.test.ts","apps/api/tsconfig.json","apps/api/tsup.config.ts","apps/api/turbo.json","apps/api/vitest.config.ts","apps/web/AGENTS.md","apps/web/CLAUDE.md","apps/web/app/(app)/actions.ts","apps/web/app/(app)/inicio/example-actions.ts","apps/web/app/(app)/inicio/page.tsx","apps/web/app/(app)/layout.tsx","apps/web/app/(auth)/SubmitButton.tsx","apps/web/app/(auth)/acesso-suspenso/page.tsx","apps/web/app/(auth)/cadastro/[slug]/PasswordField.tsx","apps/web/app/(auth)/cadastro/[slug]/RulesSheet.tsx","apps/web/app/(auth)/cadastro/[slug]/actions.ts","apps/web/app/(auth)/cadastro/[slug]/not-found.tsx","apps/web/app/(auth)/cadastro/[slug]/page.tsx","apps/web/app/(auth)/endereco-invalido/page.tsx","apps/web/app/(auth)/entrar/actions.ts","apps/web/app/(auth)/entrar/page.tsx","apps/web/app/(auth)/esqueci-senha/actions.ts","apps/web/app/(auth)/esqueci-senha/page.tsx","apps/web/app/(auth)/layout.tsx","apps/web/app/(auth)/privacidade/page.tsx","apps/web/app/(auth)/redefinir-senha/actions.ts","apps/web/app/(auth)/redefinir-senha/page.tsx","apps/web/app/(auth)/sem-comunidade/page.tsx","apps/web/app/(auth)/termos/page.tsx","apps/web/app/auth/blocked/route.ts","apps/web/app/auth/confirm/route.ts","apps/web/app/auth/host-mismatch/route.ts","apps/web/app/layout.tsx","apps/web/app/page.tsx","apps/web/e2e/admin.ts","apps/web/e2e/blocked.spec.ts","apps/web/e2e/example.spec.ts","apps/web/e2e/fixtures.ts","apps/web/e2e/host-mismatch.spec.ts","apps/web/e2e/login.spec.ts","apps/web/e2e/logout.spec.ts","apps/web/e2e/mail.ts","apps/web/e2e/platform.spec.ts","apps/web/e2e/recovery.spec.ts","apps/web/e2e/session.spec.ts","apps/web/e2e/signup.spec.ts","apps/web/i18n/request.ts","apps/web/lib/api.ts","apps/web/lib/bootstrap.ts","apps/web/lib/env.ts","apps/web/lib/platform.ts","apps/web/lib/supabase/cookie-options.ts","apps/web/lib/supabase/server.ts","apps/web/lib/tenant-host.ts","apps/web/messages/pt-BR.json","apps/web/next.config.ts","apps/web/package.json","apps/web/playwright.config.ts","apps/web/proxy.ts","apps/web/tsconfig.json","apps/web/turbo.json","apps/web/vercel.json","biome.json","docs/DEPLOY.md","package.json","packages/boundary-fixture/package.json","packages/boundary-fixture/src/index.ts","packages/boundary-fixture/tsconfig.json","packages/boundary-fixture/turbo.json","packages/config/biome.base.json","packages/config/package.json","packages/config/tsconfig.base.json","packages/config/tsconfig.json","packages/config/turbo.json","packages/config/vitest.base.ts","packages/contracts/legal/politica-de-privacidade.md","packages/contracts/legal/termos-de-uso.md","packages/contracts/package.json","packages/contracts/src/auth.ts","packages/contracts/src/bootstrap.ts","packages/contracts/src/errors.ts","packages/contracts/src/events.ts","packages/contracts/src/hosts.ts","packages/contracts/src/index.ts","packages/contracts/src/legal.ts","packages/contracts/src/modules.ts","packages/contracts/src/platform.ts","packages/contracts/tests/hosts.test.ts","packages/contracts/tests/legal.test.ts","packages/contracts/tsconfig.json","packages/contracts/turbo.json","packages/contracts/vitest.config.ts","packages/core/db/README.md","packages/core/db/admin-tx.ts","packages/core/db/client.ts","packages/core/db/rls.ts","packages/core/db/schema/chat-stubs.ts","packages/core/db/schema/consent-records.ts","packages/core/db/schema/index.ts","packages/core/db/schema/memberships.ts","packages/core/db/schema/notification-stubs.ts","packages/core/db/schema/platform-admins.ts","packages/core/db/schema/tenant-domains.ts","packages/core/db/schema/tenant-modules.ts","packages/core/db/schema/tenants.ts","packages/core/db/schema/users.ts","packages/core/db/tenant-tx.ts","packages/core/docs/SCHEMA-CONVENTIONS.md","packages/core/package.json","packages/core/server/auth/context.ts","packages/core/server/auth/jwks.ts","packages/core/server/auth/require-auth.ts","packages/core/server/env.ts","packages/core/server/events/bus.ts","packages/core/server/http/api-error.ts","packages/core/server/jobs/boss.ts","packages/core/server/logging.ts","packages/core/server/modules/flags-cache.ts","packages/core/server/modules/manifest.ts","packages/core/server/modules/require-module.ts","packages/core/server/platform/platform-admins.ts","packages/core/server/platform/require-super-admin.ts","packages/core/server/platform/tenants.ts","packages/core/server/rbac/require-role.ts","packages/core/server/supabase-admin.ts","packages/core/server/tenancy/membership.ts","packages/core/server/tenancy/public-tenant.ts","packages/core/server/tenancy/signup.ts","packages/core/server/tenancy/tenant-host.ts","packages/core/tests/bus.test.ts","packages/core/tests/flags-cache.test.ts","packages/core/tests/require-module.test.ts","packages/core/tests/require-role.test.ts","packages/core/tests/tenant-host.test.ts","packages/core/tsconfig.json","packages/core/turbo.json","packages/core/vitest.config.ts","packages/modules/example/contracts/index.ts","packages/modules/example/db/schema.ts","packages/modules/example/module.ts","packages/modules/example/package.json","packages/modules/example/server/index.ts","packages/modules/example/server/jobs.ts","packages/modules/example/server/routes.ts","packages/modules/example/server/service.ts","packages/modules/example/tsconfig.json","packages/modules/example/turbo.json","packages/modules/example/ui/ExampleWidget.tsx","packages/modules/example/ui/index.ts","packages/ui/package.json","packages/ui/src/index.ts","packages/ui/tsconfig.json","packages/ui/turbo.json","pnpm-workspace.yaml","scripts/check-boundaries.sh","scripts/db-local-role.sh","scripts/guard-local-settings.sh","scripts/local-env.sh","scripts/seed.ts","scripts/spike-supavisor.test.ts","scripts/vitest.config.ts","supabase/.gitignore","supabase/config.toml","supabase/migrations/.gitkeep","supabase/migrations/20260912030541_app_helpers.sql","supabase/migrations/20260912031019_core.sql","supabase/migrations/20260912031029_app_membership_lookup_and_grants.sql","supabase/migrations/20260912031030_auth_user_mirror.sql","supabase/migrations/20260912205432_platform_admins_and_v2_stubs.sql","supabase/migrations/20260912214429_consent_records.sql","supabase/migrations/20260913143601_tenant_modules.sql","supabase/migrations/20260913150245_pgboss_schema.sql","supabase/migrations/20260913151120_example_items.sql","supabase/migrations/20260914170253_memberships_tenant_select.sql","supabase/migrations/20260914171114_membership_lookup_lifecycle.sql","supabase/migrations/meta/20260912030541_snapshot.json","supabase/migrations/meta/20260912031019_snapshot.json","supabase/migrations/meta/20260912031029_snapshot.json","supabase/migrations/meta/20260912205432_snapshot.json","supabase/migrations/meta/20260912214429_snapshot.json","supabase/migrations/meta/20260913143601_snapshot.json","supabase/migrations/meta/20260913150245_snapshot.json","supabase/migrations/meta/20260913151120_snapshot.json","supabase/migrations/meta/20260914170253_snapshot.json","supabase/migrations/meta/20260914171114_snapshot.json","supabase/migrations/meta/_journal.json","supabase/roles.sql","supabase/seed.sql","supabase/templates/recovery.html","supabase/tests/000-helpers.sql","supabase/tests/010-rls-coverage.sql","supabase/tests/020-tenant-isolation.sql","supabase/tests/030-lanes.sql","supabase/tests/040-schema-conventions.sql","turbo.json"]
covered_digest: "v1:sha256:10c9a44918f5626f64a8a2231ba0213f8f2a560d78b4e03ca27aeea9ee776bfb"
behavior_unverified: 0
overrides_applied: 0
decision_coverage:
  honored: 24
  total: 24
  not_honored: []
deferred:

  - truth: "MOD-01 concurrency: two worker instances (or a worker and the API's first lazy enqueue) booting together call createQueue('example.process') without error — verified on staging where api-staging and worker-staging boot together"
    addressed_in: "Phase 01.1"
    evidence: "Phase 01.1 SC-3: 'The first pull request produces a Vercel Preview and a staging deploy' (api-staging + worker-staging deployed by deploy-api.yml). Plan 01-07 declared this truth `verification: backstop` and named the staging run (then 01-12) as its proof; locally only single-instance idempotency is exercised (jobs.test.ts 'createQueues refuses a pre-existing queue with another policy', worker.test.ts fresh-process boot)."
  - truth: "TENANT-03 transaction-pooler proof: the tenant lane holds its LOCAL claims/role through Supavisor transaction mode (port 6543)"
    addressed_in: "Phase 01.1"
    evidence: "Phase 01.1 requirements line: 'hosted evidence for TENANT-03: the staging Supavisor transaction-pooler spike'; ROADMAP 01.1 Notes: 'Until this phase runs, the local Supavisor's refusal of api_user means TENANT-03's transaction-pooler proof rests on the direct-port spike from plan 01-03 only.' Locally: pnpm spike:supavisor 3/3 on the direct port (accepted contingency per the orchestrator's environment notes)."
  - truth: "bootstrap counters (unreadNotifications / unreadConversations) reflect real data"
    addressed_in: "Phase 7"
    evidence: "WINDOWS.md #2 (open, owned by Phase 7); ROADMAP Phase 7 goal covers notifications and support chat. apps/api/src/routes/me.ts:89 returns literal zeros — a recorded window, not a Phase 1 must-have."
human_verification:

  - test: "Judgment-tier prohibition (AUTH-04, plan 01-04): open http://tria-demo.localhost:3000/cadastro on a phone-sized viewport and inspect the two consent controls (community rules, TRIA terms/privacy)."
    expected: "Two separate, visibly UNCHECKED checkboxes, neither pre-checked, not merged into one control, not collapsed/hidden; submitting with either one unchecked is refused (browser `required` + API 400 VALIDATION_FAILED)."
    why_human: "unverified-prohibition — human review recommended. `verification: judgment` items require explicit human resolution per ADR-550 D4. Non-authoritative LLM-judge verdict: HONORED — apps/web/app/(auth)/cadastro/[slug]/page.tsx:99-112 renders two `<input type=checkbox required>` with no `defaultChecked`; signup.spec.ts:96-97 asserts `not.toBeChecked()` on both; signup.test.ts #6 asserts 400 on a missing consent (all passing in this run)."
  - test: "Judgment-tier prohibition (AUTH-06, plan 01-05): block a seeded member (set memberships.status='blocked' via psql), reload /inicio as that member, and read the /acesso-suspenso screen and the raw 403 body from GET /v1/me/bootstrap."
    expected: "Screen shows only 'Seu acesso a {tenant} foi suspenso. Fale com a equipe.' — no reason, no moderator, no timestamp, no hint that the e-mail exists in another tenant; the 403 body's `details` carries only `tenantName`."
    why_human: "unverified-prohibition — human review recommended. `verification: judgment` item. Non-authoritative LLM-judge verdict: HONORED — acesso-suspenso/page.tsx renders only `suspended.title`/`suspended.body` with the tenant name; require-auth.ts:60 throws MEMBERSHIP_BLOCKED with `{ tenantName }` only; blocked.spec.ts and auth-middleware.test.ts (a, c, c2, h) pass."
  - test: "Policy consequence of the WR-09 fix (password-recovery origin allow-list): decide whether Vercel Preview deployments must be able to send recovery e-mails."
    expected: "Either accept that on Preview hosts (`*.vercel.app`, `PLATFORM_HOST` unset) `/esqueci-senha` sends NO e-mail and answers the constant D-10 message, or add a Preview allow-list env in Phase 01.1 (01-REVIEW-FIX.md 'Please confirm')."
    why_human: "Product/deploy policy decision the fixer explicitly escalated; the code path is tested locally (recovery.spec.ts case 6, passing) but the intended production behaviour on Preview is a choice, not a fact the codebase can prove."
---

# Phase 01: Foundation - Kernel, Tenancy, Auth & CI/CD — Verification Report

**Phase Goal:** Two isolated tenants exist on the local Supabase stack, with the deploy pipeline written as code (the hosted staging + production stack lands in Phase 01.1); a person can sign up through a tenant's public link, log in, stay logged in, recover their password and log out, and the API serves only their tenant's data through an RLS-protected database lane.
**Verified:** 2026-09-14T19:34:59Z
**Status:** human_needed
**Re-verification:** No — initial verification

**Mode note:** ROADMAP.md stamps `**Mode:** mvp` on every phase as the project-wide "vertical MVP slices" marker (`PROJECT_MODE=mvp`, line 7). The Phase 1 goal is not a User Story (`user-story.validate` → `valid: false`), so the MVP User-Flow-Coverage format was not applied; the phase was verified goal-backward against the four roadmap Success Criteria the orchestrator supplied plus the nine plans' `must_haves`. If the verify-work workflow intends real MVP-mode verification for later phases, their goals must be rewritten as User Stories via `/gsd-mvp-phase`.

## How this verification was run

Nothing in this report rests on SUMMARY.md counts. Every gate below was re-executed in this session against the current `master` (HEAD `2ed9609`, all 16 review-fix commits `a168f4c..182e9ed` confirmed present by `verify.commits`):

| Gate | Command | Result |
|---|---|---|
| pgTAP | `pnpm supabase test db` (run twice, no reset between) | 5 files, **77/77 ok**, both runs |
| API integration | `pnpm test:integration` | **10 files, 78/78 passed** |
| Lint/typecheck/build/unit | `pnpm turbo run lint typecheck build test` (+ `--force` rebuild of `@tria/web`) | **20/20 tasks** successful; `next build` compiled 15 routes |
| Module boundaries | `pnpm boundaries` | 148 files, 7 packages, no issues |
| Negative boundary fixture | `pnpm boundaries:negative` | both layers (turbo boundaries + Biome `noRestrictedImports`) reject `@tria/boundary-fixture` |
| Lane guard | `pnpm guard:lanes` | OK |
| Pooler spike (local, direct-port contingency) | `pnpm spike:supavisor` | 3/3 passed |
| E2E | `pnpm --filter @tria/web exec playwright test --project=mobile-chromium` | **34/34 passed** (32.5 s; fresh `next dev` on :3000, API `tsx watch` on :8787 started 14:05 local, after the last fix commit at 14:00) |
| Migration drift | `pnpm db:generate` | "No schema changes, nothing to migrate"; `git status` clean |
| Docker | `docker build -f apps/api/Dockerfile .` → run `ROLE=api` with an unreachable `DATABASE_URL` | build OK (453 MB); `GET /v1/health` → 200 `{ok:true,service:"api",role:"api"}`; `?deep=1` → 500 `{db:false}` |
| Live DB catalog | `psql` against `supabase_db_rede-social` | every `tenant_id` table has RLS on + ≥1 policy; `platform_admins` RLS on + 0 policies; `api_user` NOINHERIT/NOBYPASSRLS/LOGIN; `app.membership_for_user` honours `deleted_at`/`blocked_at`; 11/11 migrations applied |
| JWKS | `curl 127.0.0.1:54321/auth/v1/.well-known/jwks.json` | 1 key, ES256/EC |
| Workflow YAML | parsed with `yaml`; job graph and `secrets.*`/`vars.*` extracted | 4 workflows valid; all 20 referenced secret/variable names present in `docs/DEPLOY.md` |
| Decision coverage | `check.decision-coverage-verify` | 24/24 CONTEXT decisions honored |

Not re-run: `pnpm db:reset` (destructive; the fixer's reset is corroborated by 11/11 migrations applied and pgTAP 040 passing) and the `ROLE=worker` container (the secret-read guard blocks reading `DATABASE_URL` for the container; the same image/entry is covered by `worker.test.ts`, which boots `src/main.ts` with `ROLE=worker` in a fresh process, asserts the probe and SIGTERM exit 0 — passed above).

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| **SC-1** | | | |
| 1 | Sign-up through tenant A's public link on A's own domain, accepting A's rules + TRIA terms recorded with a timestamp, creates a `member` of A | ✓ VERIFIED | `signup.test.ts` #1 (201, one membership `role=member status=active`, two `consent_records` rows `tenant_rules`/`tria_terms` with DB `accepted_at`, ip, user_agent, versions); `signup.spec.ts` #1 on `tria-demo.localhost/cadastro`; `POST /v1/public/signup/{slug}` in `routes/public.ts:84` → `signupMember()` |
| 2 | Member logs in with e-mail + password and lands on `/inicio` showing tenant, role, e-mail from `/v1/me/bootstrap` | ✓ VERIFIED | `login.spec.ts` #25 (heading 'TRIA Demo', role, e-mail); `entrar/actions.ts:21` `signInWithPassword`; `(app)/layout.tsx` → `getBootstrap()` |
| 3 | Session survives closing/reopening the browser (behavior-dependent) | ✓ VERIFIED | `session.spec.ts`: saves `storageState` (asserts `sb-*` cookies), opens a NEW context, `/inicio` 200 + heading, reload after 2 s still `/inicio`; `proxy.ts:106` `getClaims()` refresh per request |
| 4 | Forgotten password recovered via e-mail link (origin-derived), new password signs in | ✓ VERIFIED | `recovery.spec.ts` #3 (Mailpit link → `/auth/confirm` → `/redefinir-senha` → `/inicio`), #1/#2 constant D-10 answer, #4/#5/#7 open-redirect guards, #6 WR-09 refused origin sends nothing; `auth/confirm/route.ts` `verifyOtp` + `sameOriginPath()` |
| 5 | Member can log out (device-local) | ✓ VERIFIED | `logout.spec.ts` (device B stays logged in); `(app)/actions.ts` `scope: 'local'` |
| 6 | Sign-up link survives register → login round-trip | ✓ VERIFIED | `signup.spec.ts` #2 (register → Sair → `/entrar` shows 'Comunidade: TRIA Demo', 'Criar nova conta' → `/cadastro`), #6 generic-host cookie variant |
| **SC-2** | | | |
| 7 | `GET /me/bootstrap` returns tenant, role, enabled modules from the membership row | ✓ VERIFIED | `bootstrap.test.ts` #1; `modules.test.ts` #1 (demo: 7 keys, lab: `[events, feed]`), #2 permissions from role; `me.ts:36-88` `moduleFlags.flags(ctx)` inside the tenant lane; `require-auth.ts` sets `ctx.tenantId` from `membershipForUser()` only |
| 8 | Host only selects the shell; session of A on B's registered host → 403 `TENANT_HOST_MISMATCH` naming no tenant | ✓ VERIFIED | `bootstrap.test.ts` #7/#8/#9/#12; `isolation.test.ts` f (cookie + unknown host ignored) and f2 (registered host → 403 on every route, body free of both slugs/names/ids, symmetric); `host-mismatch.spec.ts` #1 screen shows only the D-23 sentence; `require-auth.ts:66-72` |
| 9 | Blocked membership → 401/403 on the very next request, same token, no redeploy/re-login (behavior-dependent) | ✓ VERIFIED | `auth-middleware.test.ts` a/b/c/c2/c3/g/h; `isolation.test.ts` e; `blocked.spec.ts`; `membership.ts` reads `app.membership_for_user()` per request with no cache; live function def honours `blocked_at`/`deleted_at` (WR-08) |
| **SC-3** | | | |
| 10 | Every tenant-owned table carries `tenant_id` with RLS enabled | ✓ VERIFIED | pgTAP `010-rls-coverage.sql`; live catalog: `chat_*`, `consent_records`, `example_items`, `memberships`, `notifications`, `tenant_domains`, `tenant_modules` all `relrowsecurity=t` + 1 policy + `tenant_id`; `platform_admins` RLS on, 0 policies (admin lane only, by design) |
| 11 | Tenant lane runs under a non-service DB role inside a per-request transaction; LOCAL settings never leak | ✓ VERIFIED | `tenant-tx.ts` (`set_config(..., true)` + `set local role authenticated` inside `db.transaction`); `admin-tx.ts` is the only `service_role` switch (CR-03), import-restricted by Biome; pgTAP `030-lanes.sql`; `spike:supavisor` 3/3 (40 interleaved tx on `max: 2`, bare statement sees `api_user` + empty claims); `guard:lanes` OK; live roles: `api_user` NOINHERIT, NOBYPASSRLS |
| 12 | No list or detail endpoint returns another tenant's rows | ✓ VERIFIED | `isolation.test.ts` a (list ids + every row `tenantId === demo`, identical titles in both tenants), b (foreign id → 404 `NOT_FOUND` never 403), d (empty tenant → `{items: []}`); `example.test.ts` #4; pgTAP `020-tenant-isolation.sql` |
| 13 | Routes of a module disabled for the tenant return 404 | ✓ VERIFIED | `isolation.test.ts` c; `modules.test.ts` #4/#5 (missing row ≡ `enabled=false`)/#6/#7 (401 before 404, 403 `FORBIDDEN` for member on admin route); `require-module.ts` → `MODULE_DISABLED` |
| 14 | The automated two-tenant suite (pgTAP + API integration) passes | ✓ VERIFIED | pgTAP 77/77 (twice, per-file `begin…rollback`), integration 78/78 — executed in this session |
| **SC-4** | | | |
| 15 | Kernel package, feature-module template, and lint/dependency rules that fail the build on cross-module internals | ✓ VERIFIED | `packages/core` (kernel), `packages/modules/example` (exports exactly `./module ./contracts ./server ./ui ./db`); `pnpm boundaries` green; `pnpm boundaries:negative` proves both turbo tags and Biome `noRestrictedImports` reject `@tria/boundary-fixture` (app dep, admin-lane deep import, `@tria/core/db` raw client, `withAdminTx` via `tenant-tx`) |
| 16 | Cloud Run image serves API and worker from one image (`ROLE`) | ✓ VERIFIED | `apps/api/Dockerfile` (`node:24-slim`, `turbo@2.10.12 prune @tria/api --docker`, `USER node`, `ROLE=api` default); built and run in this session (API role: health 200 without DB); `main.ts:15` branches to `startWorker()`; `worker.ts` binds the probe AFTER `boss.start()` (CR-01), `worker.test.ts` passes |
| 17 | `ci.yml` mirrors the local exit gate and is reusable via `workflow_call` | ✓ VERIFIED | Parsed steps: install → `turbo lint typecheck build test` → boundaries → boundaries:negative → guard:lanes → Supabase CLI + ES256 keys → `db reset` → `test db` → env → seed → integration → spike → Playwright — the same order as the local gate; `on: workflow_call: {}` |
| 18 | `deploy-api.yml`: staging on PR, gated production on `main` | ✓ VERIFIED | Parsed: `staging` job `if: pull_request`, `needs: build`, `environment: staging`; `checks` job `uses: ./.github/workflows/ci.yml` on push; `migrate-and-deploy-prod` `if: push && refs/heads/main`, `needs: [checks, build]`, `environment: production`, order migrations → API → worker, no seed; `concurrency: deploy-${{ github.ref }}` `cancel-in-progress: false`; all four `deploy-cloudrun@v3` steps carry `--service-account=${{ vars.RUNTIME_SA }}`; `seed-prod.yml` is `workflow_dispatch` only |
| 19 | `docs/DEPLOY.md` lists every secret/variable the workflows reference | ✓ VERIFIED | 12 `secrets.*` + 8 `vars.*` names extracted from the four workflows; 20/20 found in `docs/DEPLOY.md` (sections: repo vars, env vars, env secrets, Secret Manager, Vercel, production gate, runbook) |
| 20 | Pipeline validated locally (YAML, grep assertions, Docker build/run) | ✓ VERIFIED | YAML parse of all four workflows + `vercel.json` (`ignoreCommand: npx turbo-ignore --fallback=HEAD^1`); keepalive cron `0 9 * * 1,4` → `GET /v1/health?deep=1`; Docker build/run above |
| **Plan-level truths (selected)** | | | |
| 21 | Two isolated tenants seeded with registered primary hosts, idempotent seed (D-14/D-24) | ✓ VERIFIED | `bootstrap.test.ts` #11 (second `db:seed` exits 0, `tenant_domains` unchanged, one primary per tenant), #10 by-host lookup (normalised, 404, 400); `modules.test.ts` #1 per-tenant module rows |
| 22 | AUTH-01 ordering (backstop): failed consent insert deletes the auth user, no orphan identity | ✓ VERIFIED | `signup.test.ts` #9 forces the consent insert to fail; ERROR log `signup.compensated … auth user deleted` observed in this run's output |
| 23 | AUTH-01 concurrency (backstop): concurrent duplicate sign-ups → exactly one 201, one membership | ✓ VERIFIED | `signup.test.ts` #10 (five concurrent identical sign-ups) |
| 24 | MOD-01 concurrency (backstop): two worker instances / worker + API lazy enqueue create the queue without error — on staging | ⚠️ insufficient_spec → DEFERRED | Plan 01-07 named the staging boot (now Phase 01.1) as the proof; locally only single-instance idempotency + policy-mismatch refusal are exercised (`jobs.test.ts`). See Deferred Items — not a gap. |
| 25 | Flags cache: 30 s TTL keyed by tenant, `invalidate()` immediate, A's refresh never serves B | ✓ VERIFIED | `flags-cache.test.ts` (fake timers, `ttlMs === 30_000`, invalidate); `modules.test.ts` #8 |
| 26 | Platform lane: `super_admin` gets `/v1/platform/tenants` without membership; refused on a tenant host; tenant admin 403 | ✓ VERIFIED | `modules.test.ts` #9-#12; `platform.spec.ts` #1-#4; `isolation.test.ts` g/g2 |
| 27 | Transactional job enqueue in the same tx + typed after-commit domain event; events dropped on failed handler (WR-01) | ✓ VERIFIED | `example.test.ts` #1/#6/#7; `jobs.test.ts` (WR-02 real error surfaces, WR-03 `short` policy + singletonKey dedupe); `bus.test.ts` 7 cases incl. `c.error` drop |
| 28 | `api_user` outside any lane cannot read tenant tables (42501, NOINHERIT) | ✓ VERIFIED | `bootstrap.test.ts` #6; pgTAP 030; live `pg_roles` (`rolinherit=f`, `rolbypassrls=f`) |
| 29 | Legal texts carry `version:` front-matter equal to `TRIA_TERMS_VERSION`/`TRIA_PRIVACY_VERSION`, versions equal | ✓ VERIFIED | `packages/contracts/tests/legal.test.ts` (part of the 20/20 turbo run); `/termos`, `/privacidade` pages exist |
| 30 | GoTrue public sign-up closed; only the API's `admin.createUser` path creates users (CR-02) | ✓ VERIFIED | `supabase/config.toml` `[auth] enable_signup = false` (with `[auth.email] enable_signup = true` documented); `gotrue-signup-disabled.test.ts` passes; `signup.test.ts` still green |

**Score:** 29/30 truths verified (0 present-but-behavior-unverified; 1 deferred to Phase 01.1 per the plan's own wording — not a failure)

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|---|---|---|
| 1 | MOD-01 concurrency: concurrent worker/API queue creation on a real two-service boot | Phase 01.1 | 01.1 SC-3 (first PR → staging deploy of `api-staging` + `worker-staging`); plan 01-07 truth text "verified on staging where api-staging and worker-staging boot together (01-12)" |
| 2 | TENANT-03 transaction-pooler (Supavisor 6543) proof | Phase 01.1 | 01.1 requirements: "hosted evidence for TENANT-03: the staging Supavisor transaction-pooler spike"; local Supavisor refuses `api_user` (accepted contingency, `packages/core/db/README.md` §DATABASE_URL shapes documents the session-pooler fallback as a config-only switch) |
| 3 | Bootstrap `counters` are literal zeros | Phase 7 | WINDOWS.md #2 open; Phase 7 owns notifications/chat |

### Required Artifacts

`verify.artifacts` across the nine plans: 60/67 auto-passed. The 7 tool flags were all naming/location differences, each resolved manually to a substantive, wired equivalent:

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/core/server/auth/require-auth.ts` | contains `createRemoteJWKSet` | ✓ VERIFIED | JWKS lives in `auth/jwks.ts:5` (`createRemoteJWKSet`), imported by `require-auth.ts:9`; `jwtVerify` with issuer + audience |
| `apps/web/app/(auth)/entrar/page.tsx` | contains `signInWithPassword` | ✓ VERIFIED | call is in the co-located server action `entrar/actions.ts:21`; page renders the form bound to it |
| `apps/api/src/routes/public.ts` | contains `signup/:slug` | ✓ VERIFIED | OpenAPI path syntax `'/signup/{slug}'` at line 84, handler calls `signupMember` |
| `packages/contracts/src/auth.ts` | exports `signupSchema` | ✓ VERIFIED | exported as `signupBodySchema` + `signupFormSchema` (+ `loginSchema`, `forgotSchema`, `resetSchema`, `slugSchema`) |
| `packages/core/server/events/bus.ts` | exports `flushEventsAfterResponse` | ✓ VERIFIED | renamed to `flushEventsAfterHandler` by WR-01 (runs before the response); mounted in `app.ts:20`, tested in `bus.test.ts` |
| `apps/api/Dockerfile` | contains `turbo prune` | ✓ VERIFIED | `pnpm dlx turbo@2.10.12 prune @tria/api --docker` (line 21) |
| all other 60 artifacts | per plan frontmatter | ✓ VERIFIED | exist, substantive, wired (tool-verified; spot-read: `tenant-tx.ts`, `admin-tx.ts`, `require-auth.ts`, `membership.ts`, `me.ts`, `proxy.ts`, `tenant-host.ts`, `worker.ts`, `acesso-suspenso/page.tsx`, `cadastro/[slug]/page.tsx`) |

No artifact is MISSING, STUB or ORPHANED. `packages/ui/src/index.ts` is a documented Phase 2 placeholder (shared UI package is a Phase 2 deliverable per ROADMAP Notes) — not a Phase 1 must-have.

### Key Link Verification

`verify.key-links`: 30/35 auto-verified. The 5 flags were malformed `from:` fields (descriptive text instead of a path) or a pattern living in a sibling file; each resolved manually:

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `packages/core/db/schema/*.ts` | `supabase/migrations/*_app_helpers.sql` | `pgPolicy` using `app.tenant_id()` | ✓ WIRED | `20260912030541_app_helpers.sql` precedes `_core.sql` in the journal; live policies reference `app.tenant_id()` (pgTAP 010/020 exercise them) |
| `apps/web/proxy.ts` | `apps/api/src/routes/public.ts` | `/v1/public/tenants/by-host` | ✓ WIRED | fetch is in `apps/web/lib/tenant-host.ts:66`, called from `proxy.ts` via `resolveHostTenant`; bounded LRU cache (WR-06) |
| `apps/web/app/(app)/layout.tsx` (platform mode) | `apps/api/src/routes/platform.ts` | `getPlatformTenants()` | ✓ WIRED | `layout.tsx:44-52` — 403 `FORBIDDEN`/`TENANT_HOST_MISMATCH` → `/auth/host-mismatch`; `platform.spec.ts` #1 renders the tenant list |
| `deploy-api.yml` (4 deploy steps) | runtime SA with `secretAccessor` | `--service-account=${{ vars.RUNTIME_SA }}` | ✓ WIRED | lines 158, 173, 241, 256; `RUNTIME_SA` documented in DEPLOY.md |
| `deploy-api.yml` (`checks` → prod `needs`) | `ci.yml` (`on: workflow_call`) | `uses: ./.github/workflows/ci.yml`; prod `needs: [checks, build]` | ✓ WIRED | parsed job graph above |
| `me.ts` → `tenant-tx.ts` | `withTenantTx` | | ✓ WIRED | tool-verified |
| `require-auth.ts` → `membership.ts` / `tenant-host.ts` | per-request `membershipForUser`, `resolveTenantHost` | | ✓ WIRED | read in full above; order verify → membership → blocked → host |
| `signup.ts` → `admin-tx.ts` / `supabase-admin.ts` | `withAdminTx`, `auth.admin.createUser/deleteUser` | | ✓ WIRED | tool-verified; compensation exercised by `signup.test.ts` #9 |
| `recovery.html` → `auth/confirm/route.ts` | `TokenHash` | | ✓ WIRED | tool-verified; `recovery.spec.ts` #3 follows the real e-mail |
| `app.ts` → `module-example/server/routes.ts` | `requireModule('example')` | | ✓ WIRED | tool-verified; `isolation.test.ts` c |
| `inicio/page.tsx` → `@tria/module-example/ui` | `ExampleWidget` when enabled | | ✓ WIRED | `example.spec.ts` #1-#3 |
| remaining 19 links | per plan frontmatter | | ✓ WIRED | tool-verified |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `apps/web/app/(app)/inicio/page.tsx` | `bootstrap.tenant/membership/modules` | `getBootstrap()` → `GET /v1/me/bootstrap` → `withTenantTx` select on `memberships`/`tenants`/`tenant_modules` | Yes | ✓ FLOWING (`login.spec.ts` #25 asserts tenant name, role, e-mail) |
| `apps/api/src/routes/me.ts` | `modules`, `permissions` | `moduleFlags.flags(ctx)` (tenant lane) + registry | Yes | ✓ FLOWING (`modules.test.ts` #1-#3) |
| `apps/api/src/routes/me.ts` | `counters` | literal `{0, 0}` | No | ⚠️ STATIC — recorded open window #2 (Phase 7); not a Phase 1 must-have |
| `packages/modules/example/ui/ExampleWidget.tsx` | `items` | `GET /v1/example/items` via `withTenantTx` on `example_items` | Yes | ✓ FLOWING (`example.spec.ts` #1: created item appears) |
| `apps/web/app/(auth)/entrar/page.tsx` | `tenantName` | `x-tenant-*` headers (proxy) / `GET /v1/public/tenants/{slug}` | Yes | ✓ FLOWING (`login.spec.ts` #11 D-22) |
| `apps/web/app/(app)/layout.tsx` (platform) | tenant list | `GET /v1/platform/tenants` via `withAdminTx` | Yes | ✓ FLOWING (`platform.spec.ts` #1) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Health without DB (fresh container) | `docker run … -e DATABASE_URL=postgres://…@127.0.0.1:1/… tria-api:verify` + `curl /v1/health` | 200 `{ok:true}`; `?deep=1` 500 `{db:false}` | ✓ PASS |
| Live API deep health through `api_user` | `curl localhost:8787/v1/health?deep=1` | 200 `{db:true}` | ✓ PASS |
| JWKS serves an ES256 key | `curl …/.well-known/jwks.json` | 1 key ES256/EC | ✓ PASS |
| pgTAP idempotent without reset | `pnpm supabase test db` ×2 | 77/77 both times | ✓ PASS |
| Full e2e on iPhone-14 viewport | `playwright test --project=mobile-chromium` | 34/34 | ✓ PASS |
| Migration drift | `pnpm db:generate` | no changes; working tree clean | ✓ PASS |
| Worker role in Docker | needs `DATABASE_URL` from `.env.local` | blocked by the secret-read guard | ? SKIP — covered by `worker.test.ts` (fresh `main.ts` process, `ROLE=worker`, probe 200, SIGTERM exit 0) |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes are declared or present in this project. The phase's runnable checks are the scripted gates above (`check-boundaries.sh`, `guard-local-settings.sh`, `spike-supavisor.test.ts`), all executed: PASS.

### Requirements Coverage

| Requirement | Source Plan(s) | Description (abridged) | Status | Evidence |
|---|---|---|---|---|
| TENANT-01 | 01-01, 01-02, 01-05, 01-06 | One deployment, each tenant on its own domain; host selects only the public shell; membership is the tenant of record; mismatch → 403 | ✓ SATISFIED | `tenant_domains` + `by-host` lookup; `proxy.ts` host modes; truths 8, 21; `host-mismatch.spec.ts`, `isolation.test.ts` f/f2 |
| TENANT-03 | 01-01, 01-03, 01-08 | `tenant_id` on every tenant row; API under an RLS-subject role, no service key for user traffic | ✓ SATISFIED (local) | truths 10, 11, 28; Supavisor 6543 proof deferred to 01.1 (accepted) |
| TENANT-05 | 01-08 | Automated ≥2-tenant isolation suite | ✓ SATISFIED (phase scope) | pgTAP 020 covers `example_items`, `memberships`, `tenant_modules`, `tenant_domains`, `consent_records`, `chat_*`, `notifications`; API suite covers every existing list/detail endpoint. Search/storage/notification/chat *endpoints* do not exist yet — SCHEMA-CONVENTIONS §(j) obliges later phases to extend `020` and `isolation.test.ts` |
| MOD-01 | 01-01, 01-07 | Monorepo, each feature a self-contained module package | ✓ SATISFIED | `@tria/module-example` (schema, server, contracts, ui, module manifest; five exports); `MODULE_REGISTRY` composed in the app tier |
| MOD-02 | 01-06, 01-07, 01-08 | Kernel package; modules depend only on kernel + contracts; enforced by lint/dependency rules | ✓ SATISFIED | `packages/core`; turbo boundaries tags + Biome `noRestrictedImports`; negative fixture proves both bite |
| ROLE-01 | 01-01, 01-03, 01-06, 01-08 | Four roles; `super_admin` cross-tenant; roles on membership not user | ✓ SATISFIED | `memberships.role` CHECK (rejects `super_admin`, pgTAP 040); `platform_admins` + `requireSuperAdmin`; `users` has no role column |
| ROLE-02 | 01-01, 01-04, 01-08 | Identity ≠ membership; V1 one membership per user via droppable constraint | ✓ SATISFIED | `memberships_one_tenant_per_user_v1` unique index (pgTAP 040: 23505); `signup.test.ts` #8 duplicate on another tenant → 409 |
| ROLE-06 | 01-06, 01-07 | API authorization by role + enabled modules; disabled module → 404 | ✓ SATISFIED | truth 13; `requireRole` → 403 `FORBIDDEN`; `example` never in `REAL_TENANT_DEFAULT_MODULES` (`registry.test.ts` #4) |
| AUTH-01 | 01-04 | Public sign-up link → member; link survives round-trip | ✓ SATISFIED | truths 1, 6, 22, 23 |
| AUTH-02 | 01-02 | E-mail/password login via the Next.js server; stays logged in across restarts | ✓ SATISFIED | truths 2, 3; HttpOnly cookies set by `proxy.ts`/actions |
| AUTH-03 | 01-05 | Recover password via e-mail link | ✓ SATISFIED (local Mailpit) | truth 4; real Resend delivery is 01.1 SC-3 |
| AUTH-04 | 01-04 | Accept tenant rules + TRIA terms at sign-up, recorded with timestamp | ✓ SATISFIED | truth 1 (`accepted_at` DB `now()`, `text_version`); judgment-tier prohibition flagged for human review (below) |
| AUTH-05 | 01-02 | Log out from any page | ✓ SATISFIED | truth 5; "Sair" in the `(app)` top bar |
| AUTH-06 | 01-01, 01-05 | JWT verified via JWKS; tenant/role/status resolved per request; blocked member cut off immediately | ✓ SATISFIED | truths 9, 28; `auth-middleware.test.ts` d/d2/e/f (expired, forged, HS256 all 401) |
| PWA-04 | 01-09 (declared) | GitHub → Vercel + Cloud Run auto-deploy with preview/staging + production | ↪ MOVED to Phase 01.1 | REQUIREMENTS.md traceability row reads `PWA-04 \| Phase 01.1 \| Pending` (line 288) and the checkbox at line 135 is unticked — the move is reflected. Plan 01-09's pipeline-as-code share is done (truths 16-20) |

**Orphaned requirements:** none — every ID REQUIREMENTS.md maps to Phase 1 (14) appears in at least one plan's `requirements:`; PWA-04 is correctly re-homed to 01.1.

### Prohibitions (must-NOT), by verification tier

| # | Plan | Requirement | Tier | Statement (abridged) | Enforcement evidence | Disposition |
|---|---|---|---|---|---|---|
| P1 | 01-01 | TENANT-03 | test | No tenant query via `postgres`/`service_role`/non-LOCAL switch; only `withTenantTx`/`withAdminTx` | `guard:lanes` (grep gate, OK); Biome restricts `@tria/core/db/admin-tx` + raw `@tria/core/db` for modules; `boundaries:negative`; pgTAP 030 | ✓ verified |
| P2 | 01-01 | TENANT-01 | test | Host/`Host`/`X-Forwarded-Host`/cookie/path never SELECT tenant data | `bootstrap.test.ts` #9/#12; `isolation.test.ts` f/f2 | ✓ verified |
| P3 | 01-02 | TENANT-01 | test | Web tier never trusts client `x-tenant-*`; proxy overwrites | `proxy.ts:32-43` sets all four headers on every request; `isolation.test.ts` f | ✓ verified |
| P4 | 01-02 | AUTH-05 | test | "Sair" never signs out other devices | `logout.spec.ts`; `(app)/actions.ts` `scope: 'local'` | ✓ verified |
| P5 | 01-04 | AUTH-01 | test | Duplicate e-mail never discloses the owning tenant | `signup.test.ts` #8 (body free of the other tenant); `signup.spec.ts` #3; `signup.duplicate_email` logged server-side with ip/UA (WR-05 partial) | ✓ verified |
| P6 | 01-04 | AUTH-04 | **judgment** | Consents never pre-checked, merged, hidden, or skippable | page: two `required` checkboxes, no `defaultChecked`; `signup.spec.ts` #1 `not.toBeChecked()` ×2; `signup.test.ts` #6 400 on missing consent | LLM-judge: HONORED — **unverified-prohibition, human review recommended** (Human item 1) |
| P7 | 01-05 | AUTH-06 | **judgment** | Suspension screen / 403 body reveal only the tenant name | `acesso-suspenso/page.tsx`; `require-auth.ts:60` `{ tenantName }` only; `blocked.spec.ts` | LLM-judge: HONORED — **unverified-prohibition, human review recommended** (Human item 2) |
| P8 | 01-05 | TENANT-01 | test | Host-mismatch screen/URL/403 body name neither tenant | `isolation.test.ts` f2 (body scanned for both slugs, names, ids); `host-mismatch.spec.ts` #1; `/auth/host-mismatch` takes no query params | ✓ verified |
| P9 | 01-06 | ROLE-06 | test | `example` never in `REAL_TENANT_DEFAULT_MODULES` | `apps/api/tests/unit/registry.test.ts` #4 (length 6, `not.toContain('example')`) | ✓ verified |
| P10 | 01-09 | PWA-04 | test | No production migration outside the `production` approval; no Preview promotion | `deploy-api.yml` prod job `environment: production`, `needs: [checks, build]`, push-to-main only; staging job never touches prod secrets; `seed-prod.yml` dispatch-only | ✓ verified in code — the reviewer-approval gate itself is a GitHub Environment setting provisioned in Phase 01.1 SC-1 |

### Decision Coverage

`check.decision-coverage-verify`: **24/24** trackable CONTEXT.md decisions (D-01..D-24) are honored by shipped artifacts; `not_honored: []`. Spot-confirmed in code: D-05 HttpOnly cookies via proxy, D-09 per-request membership, D-10 constant recovery answer, D-12 gated production job, D-14 seed by script, D-17 per-tenant module rows, D-18 one image two roles, D-19 throwaway example module, D-20 `tenant_domains`, D-21 host modes, D-22 slug from host, D-23 host can only deny, D-24 seeded hosts.

### Test Quality Audit

| Test File | Linked Req | Active | Skipped | Circular | Assertion Level | Verdict |
|---|---|---|---|---|---|---|
| `supabase/tests/010..040-*.sql` | TENANT-03/05, ROLE-01/02 | 77 | 0 | No | Value (catalog, SQLSTATE, row counts) | OK |
| `apps/api/tests/integration/isolation.test.ts` | TENANT-05, TENANT-01, AUTH-06, ROLE-06 | 12 | 0 | No | Behavioral (multi-step, body scans) | OK |
| `apps/api/tests/integration/bootstrap.test.ts` | TENANT-01/03, AUTH-06 | 14 | 0 | No | Value/Behavioral | OK |
| `apps/api/tests/integration/auth-middleware.test.ts` | AUTH-06, TENANT-01 | 12 | 0 | No | Behavioral (block/unblock, forged/expired keys) | OK |
| `apps/api/tests/integration/signup.test.ts` | AUTH-01/04, ROLE-02 | 10 | 0 | No | Value/Behavioral (DB rows, compensation, concurrency) | OK |
| `apps/api/tests/integration/modules.test.ts` | ROLE-06, ROLE-01 | 12 | 0 | No | Value/Behavioral | OK |
| `apps/api/tests/integration/example.test.ts`, `jobs.test.ts`, `worker.test.ts`, `health.test.ts`, `gotrue-signup-disabled.test.ts` | MOD-01/02, D-18 | 18 | 0 | No | Behavioral | OK |
| `apps/web/e2e/*.spec.ts` (9 files) | AUTH-01..06, TENANT-01, ROLE-06 | 34 | 0 locally (`test.skip(isRemote)` guards evaluate false; all 34 ran) | No | Behavioral (real browser, real Mailpit e-mail) | OK |
| `packages/core/tests/*`, `packages/contracts/tests/*`, `apps/api/tests/unit/*` | MOD-02, ROLE-06, AUTH-04 | all | 0 | No | Value | OK |

**Disabled tests on requirements:** 0. **Circular patterns detected:** 0 (expected values come from seed constants, catalog queries and independent SQL, not from the system under test). **Insufficient assertions:** 0.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `apps/api/src/routes/me.ts` | 89 | `counters: { unreadNotifications: 0, unreadConversations: 0 }` hardcoded | ℹ️ Info | Recorded open window #2, owned by Phase 7; not a Phase 1 truth |
| `packages/ui/src/index.ts` | 1 | "Placeholder until Phase 2 ports the prototype components" | ℹ️ Info | Shared UI package is a Phase 2 deliverable per ROADMAP Notes |
| `apps/api/src/app.ts` | — | `GET /v1/openapi.json` public in every environment | ℹ️ Info | Known and accepted for this phase (deferred to the deploy phase) |
| `packages/core/db/schema/{chat,notification}-stubs.ts` | — | Shape-only tables | ℹ️ Info | Intentional Foundation deliverable (open windows #5, #6, Phase 7); they do carry `tenant_id` + RLS + isolation policy and are covered by pgTAP 010/020 |
| `packages/modules/example/**` | — | Throwaway module (D-19) | ℹ️ Info | Open window #9, deleted in Phase 4 |

**Debt-marker gate:** no `TBD`/`FIXME`/`XXX` in any phase source file. No `TODO`/`HACK` markers. All "placeholder" hits are input attributes, unit-test env values, or the documented D-07 `/inicio` page (which the e2e proves renders real bootstrap data).

**WINDOWS.md cross-check:** entries #1, #3, #4, #7, #8 marked fixed are fixed in code (`me.ts` modules/permissions from `tenant_modules`; `entrar/page.tsx` host/cookie hint; `layout.tsx` handles `MEMBERSHIP_BLOCKED`/`NO_MEMBERSHIP`/`TENANT_HOST_MISMATCH`; `check-boundaries.sh` + `supabase/tests/` exist; `MODULE_REGISTRY` has `example`). Open entries #2, #5, #6, #9 are legitimately deferred (Phase 7 / Phase 4).

### Review-fix cross-check (01-REVIEW.md → 01-REVIEW-FIX.md)

All 12 fixes claimed landed in code and are pinned by tests that ran green in this session: CR-01 (`worker.ts` probe after `boss.start()`, `worker.test.ts`), CR-02 (`config.toml` `enable_signup = false`, `gotrue-signup-disabled.test.ts`), CR-03 (`withAdminTx` only in `admin-tx.ts`; `tenant-tx.ts` exports `Tx` + `withTenantTx` only; fixture imports it via `tenant-tx` and is rejected), WR-01 (`c.error` drop, `bus.test.ts`), WR-02/03 (`jobs.test.ts`), WR-06 (`createBoundedTtlCache`, `hosts.test.ts`, `tenant-host.test.ts`), WR-07 (`memberships_tenant_select` migration, pgTAP 020/040), WR-08 (`membership_lookup_lifecycle` migration; live function def; auth-middleware c2/c3), WR-09 (`recoveryOrigin()`, `recovery.spec.ts` #6), WR-10 (`sameOriginPath()`, `recovery.spec.ts` #7), WR-12 (`packages/core/server/logging.ts` root logger; integration output shows `severity` keys only). The three "Needs decision" items (WR-04 `X-Client-IP` trust, WR-05 rate limiting, WR-11 PR-triggered staging deploys) are recorded, not fixed; none breaks a success criterion — they are Phase 01.1 topology/policy decisions. WR-04 is worth noting for LGPD evidence integrity: `consent_records.ip` currently trusts the BFF's `X-Client-IP` from any caller of the public API.

### Human Verification Required

Three items — two are the judgment-tier prohibitions the ADR-550 protocol routes to explicit human resolution (code and tests already support both; the flag is procedural), and one is a policy confirmation the fixer escalated:

#### 1. AUTH-04 consent controls (judgment-tier prohibition, plan 01-04)

**Test:** Open `http://tria-demo.localhost:3000/cadastro` on a phone-sized viewport. Inspect the two consent controls. Try submitting with each one unchecked.
**Expected:** Two separate, visibly unchecked checkboxes (community rules of "TRIA Demo"; TRIA terms + privacy), neither pre-checked, not merged, not hidden behind a collapsed section; submission with either unchecked is refused (browser `required`; the API answers 400 `VALIDATION_FAILED` if the form is bypassed).
**Why human:** `verification: judgment` — protocol requires explicit human resolution. Non-authoritative LLM-judge verdict: HONORED (`cadastro/[slug]/page.tsx:99-112`; `signup.spec.ts:96-97`; `signup.test.ts` #6). Flag: unverified-prohibition — human review recommended.

#### 2. AUTH-06 suspension disclosure (judgment-tier prohibition, plan 01-05)

**Test:** As a seeded member, log in; then `update public.memberships set status='blocked', blocked_at=now() where user_id=…` via psql; reload `/inicio`; read `/acesso-suspenso` and the raw 403 body of `GET /v1/me/bootstrap` with the same token.
**Expected:** Screen: "Seu acesso a TRIA Demo foi suspenso. Fale com a equipe." and a link back to `/entrar` — nothing else. 403 body: `{ error: { code: 'MEMBERSHIP_BLOCKED', details: { tenantName } } }` — no reason, actor, timestamp, or hint about other tenants.
**Why human:** `verification: judgment`. Non-authoritative LLM-judge verdict: HONORED (`acesso-suspenso/page.tsx`; `require-auth.ts:60`; `blocked.spec.ts`; `auth-middleware.test.ts` a/c/c2/h). Flag: unverified-prohibition — human review recommended.

#### 3. WR-09 policy consequence — recovery e-mails on Vercel Preview

**Test:** Decide whether Preview deployments (`*.vercel.app`, `PLATFORM_HOST` unset → every host is `generic`) must be able to send password-recovery e-mails.
**Expected:** Either accept "no e-mail on Preview, constant D-10 answer" (current behaviour, `recovery.spec.ts` #6 green) or schedule a Preview allow-list env in Phase 01.1.
**Why human:** Deploy/product policy the fixer explicitly asked to confirm; the codebase cannot prove which behaviour is intended.

### Gaps Summary

No gaps. Every roadmap Success Criterion is observably true on the local stack, proven by gates re-executed in this session rather than by SUMMARY counts: sign-up → login → persistent session → recovery → logout run end-to-end in a real mobile browser (34/34); `/v1/me/bootstrap` resolves tenant, role and modules from the membership row and the host can only deny a session (403 `TENANT_HOST_MISMATCH`, body free of tenant data); a blocked membership is refused on the very next request with the same token; every `tenant_id` table has RLS with a policy, the tenant lane is `authenticated` inside a per-request transaction with LOCAL settings that provably do not leak, list/detail endpoints never cross tenants, and disabled modules 404; the monorepo has a kernel, a module template and two independent boundary enforcers that demonstrably fail on a cross-boundary fixture; the delivery pipeline exists as valid YAML with the staging/production gating structure the roadmap specifies, a Docker image that builds and serves `/v1/health` with no database, and a `DEPLOY.md` that names all 20 secrets/variables the workflows reference.

The status is `human_needed` solely because two must-NOT items are declared `verification: judgment` (the protocol requires a human to close them even though code and passing tests support both) and because the WR-09 fix carries a Preview-deployment policy choice the fixer escalated. Three items are deferred, not failed: the two-instance worker boot and the Supavisor transaction-pooler proof land with the staging stack in Phase 01.1, and bootstrap counters are Phase 7's.

Known and accepted (not reported as gaps, per the orchestrator's environment notes): public `/v1/openapi.json`, placeholder legal copy, direct-port local `DATABASE_URL`, two removed turbo boundary rules (reason documented in `turbo.json`), and the throwaway `@tria/module-example`.

---

_Verified: 2026-09-14T19:34:59Z_
_Verifier: Claude (gsd-verifier)_

## Incremental re-verification (2026-09-14, after quick task 260914-mfk)

Four covered files changed after the full verification run (`c94df87` → `43db3cd`): `apps/web/lib/bootstrap.ts`, `apps/web/lib/platform.ts`, `apps/web/app/(app)/layout.tsx`, `apps/web/app/(app)/inicio/page.tsx`. The change moves the 401/403 → redirect mapping into `requireBootstrap()` / `requirePlatformTenants()` so concurrently rendered segments no longer surface a false `ApiClientError` render error. No API, schema, migration, policy or workflow file changed.

Evidence (orchestrator, not re-running the 37-minute full gate):
- Quick-task executor gate on the fixed tree: `pnpm --filter @tria/web typecheck` and `lint` clean; Playwright `mobile-chromium` **34/34** (covers blocked, host-mismatch, session, login, logout, signup, recovery, platform, example specs — the very flows the mapping serves); captured dev-server log: **0** `ApiClientError` / `⨯` lines vs 12 before the fix.
- Orchestrator re-ran `pnpm --filter @tria/web typecheck` and `lint` on HEAD: both exit 0.
- Grep: the envelope-code → redirect mapping exists in exactly one place per branch (`lib/bootstrap.ts` for tenant hosts, `lib/platform.ts` for the platform host); all other occurrences are comments.
- Success criteria 1 and 2 (login, session, recovery, logout, blocked → 403 on the next request, host mismatch) are unchanged in behaviour; the UAT recorded 3/3 pass on 2026-09-14.

`covered_digest` re-stamped against the current tree with `verification.fingerprint`.
