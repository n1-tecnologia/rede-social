---
phase: 01-foundation-kernel-tenancy-auth-ci-cd
plan: 09
subsystem: infra
tags: [docker, cloud-run, github-actions, workload-identity-federation, artifact-registry, supabase-cli, vercel, turbo-prune, pnpm-deploy, health-check, keepalive]

# Dependency graph
requires:
  - phase: 01-01
    provides: "@rede-social/* monorepo with stable root scripts (lint/typecheck/build/test, boundaries, boundaries:negative, guard:lanes, db:seed, test:integration, spike:supavisor, e2e), apps/api with tsup build + GET /v1/health, supabase/roles.sql + migrations, scripts/local-env.sh + db-local-role.sh, idempotent scripts/seed.ts reading TENANT_*_HOST"
  - phase: 01-02
    provides: "@rede-social/web (Next 16 build target for Vercel) and the Playwright suite ci.yml runs"
  - phase: 01-03
    provides: "pnpm spike:supavisor as a root script and packages/core/db/README.md's hosted DATABASE_URL shapes (transaction pooler for the API, session pooler for pg-boss)"
provides:
  - "apps/api/Dockerfile: one node:24-slim multi-stage image (turbo prune -> pnpm install --frozen-lockfile -> turbo build -> pnpm deploy --prod --legacy) serving both Cloud Run roles (ROLE=api / ROLE=worker, D-18), non-root, 439 MB"
  - ".dockerignore keeping node_modules, build output, .planning/.claude/.gsd, reference, apps/web and every secret file out of the build context"
  - "GET /v1/health?deep=1 -> { ok, service, role, db: true } (500 { db: false } when Postgres is unreachable); the plain route stays credential-free"
  - ".github/workflows/ci.yml: one `checks` job mirroring the local exit gate, reusable through `on: workflow_call`"
  - ".github/workflows/deploy-api.yml: WIF build/push to Artifact Registry; PR -> staging (migrations + roles + config + seed + api-staging/worker-staging); main -> reusable `checks` + `build` -> migrate-and-deploy-prod behind the `production` environment, migrations -> API -> worker, never seeding"
  - ".github/workflows/seed-prod.yml (workflow_dispatch only, environment production) and keepalive-staging.yml (Mon/Thu cron on /v1/health?deep=1)"
  - "apps/web/vercel.json with the turbo-ignore ignoreCommand"
  - "docs/DEPLOY.md: the complete name contract (GitHub variables, environment variables, environment secrets, GCP Secret Manager secrets, Vercel env per environment), the production-gate rules and the operational runbook"
affects: [01-07, 01-08, 01-10, 01-11, 01-12]

# Actuals (#2632) — same estimateTokens scale as the plan's estimate (chars/4 over the realized diff)
actuals:
  tokens: 9000       # 35,846 chars / 4 over `git diff deb2c4e..HEAD`; estimate was 45,000
  tasks: 2
  commits: 2         # MEASURED: git rev-list --count deb2c4e..HEAD before the docs commit (#3968)
plan_head_before: deb2c4e1168b6ea70d9f1f5a3a066fbe39a59097

# Tech tracking
tech-stack:
  added: ["Docker multi-stage build on node:24-slim", "turbo prune --docker", "pnpm deploy --prod --legacy", "GitHub Actions: checkout@v7, setup-node@v7, pnpm/action-setup@v6, supabase/setup-cli@v3, google-github-actions/auth@v3, google-github-actions/deploy-cloudrun@v3, docker/setup-buildx-action@v4, docker/login-action@v4, docker/build-push-action@v7, actions/upload-artifact@v7"]
  patterns:
    - "One image, four services: apps/api/Dockerfile builds once per SHA and is deployed as api-staging/worker-staging and api/worker; the role is an env var (ROLE), never a separate build (D-18)"
    - "CI is written once and reused: ci.yml declares `on: workflow_call` and deploy-api.yml mounts it as its `checks` job, so the production gate re-runs the identical steps for the exact SHA it deploys — there is no second, drifting copy (D-12)"
    - "Every deploy-cloudrun step passes `--service-account=${{ vars.RUNTIME_SA }}` as a gcloud flag rather than an action input, so the same string applies uniformly to all four services and the mounted Secret Manager values are readable at runtime"
    - "Liveness is credential-free, keep-alive is not: GET /v1/health touches no database (the image smoke boots with DATABASE_URL on a closed port), GET /v1/health?deep=1 runs `select 1` so the Free-plan inactivity timer is reset by real DB activity"
    - "Secrets are environment-scoped: the workflows use `pull_request` (never `pull_request_target`), so fork PRs get no secrets, and a job without `environment:` can read none"
    - "docs/DEPLOY.md is the single name contract: every `secrets.*`, `vars.*` and Secret Manager name used by any workflow is listed there, so 01-10/01-11 are checklists rather than guesswork"

key-files:
  created:
    - apps/api/Dockerfile
    - .dockerignore
    - apps/api/tests/integration/health.test.ts
    - apps/api/tests/integration/health-no-db.ts
    - .github/workflows/ci.yml
    - .github/workflows/deploy-api.yml
    - .github/workflows/seed-prod.yml
    - .github/workflows/keepalive-staging.yml
    - apps/web/vercel.json
    - docs/DEPLOY.md
  modified:
    - apps/api/src/routes/health.ts
    - packages/contracts/package.json

key-decisions:
  - "`pnpm deploy --filter=@rede-social/api --prod --legacy /app` produces the runner tree. `--legacy` is required on pnpm 12 (it warns `Shared workspace lockfile detected but configuration forces legacy deploy implementation` and without it the shared-lockfile deploy path needs inject-workspace-packages). The deploy root holds `dist/` and `node_modules/` directly, so CMD is `node dist/main.js`, not `node apps/api/dist/main.js` — the plan sanctioned `path per the deploy output`"
  - "Final image is 439 MB (node:24-slim base + 41 production packages). tsup bundles every @rede-social/* source into dist/, so only third-party deps ship; @rede-social/core's transitive runtime deps (postgres, jose, @supabase/supabase-js) come along because pnpm deploy resolves prod deps transitively"
  - "The deep health check is the ONLY query in the codebase outside withTenantTx/withAdminTx, and that is deliberate: `select 1` reads no table (so api_user's NOINHERIT lack of privileges is irrelevant) and switches no role, so nothing can leak onto a pooled connection. `pnpm guard:lanes` stays green"
  - "All four Cloud Run services mount DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_KEY, not just the worker's BOSS_DATABASE_URL: apps/api/src/env.ts validates all three at import, so a worker with only BOSS_DATABASE_URL would crash before pg-boss ever starts (01-07)"
  - "The image reference is computed in a dedicated `build` step and exported as a job output, so the four deploy steps all pin the same immutable `:<github.sha>` tag — a production deploy can never pick up a newer `:latest`"
  - "actions/upload-artifact@v7 (v7.0.1 confirmed as the current release); the plan listed action versions for every other action but not this one"
  - "packages/contracts declares `files: [src, legal]` now, before 01-04 creates packages/contracts/legal/*.md: pnpm deploy copies only what a package would publish, and a files entry for a not-yet-existing directory is harmless"

patterns-established:
  - "Docker context is the repo root and the Dockerfile lives with its app (`docker build -f apps/api/Dockerfile .`); .dockerignore is the single place that decides what a build may see"
  - "Workflow name contract: no workflow may read a `secrets.*` / `vars.*` / Secret Manager name that docs/DEPLOY.md does not list (cross-checked mechanically at the end of this plan)"
  - "Production safety is job-graph-enforced, not policy-enforced: `needs: [checks, build]` means a direct admin push to main goes through the same checks, so branch protection is a convenience rather than the gate"
  - "Fresh-process probes for import-time behaviour: env.ts validates at import, so claims about a different environment (closed-port DATABASE_URL) are proven by spawning tsx in a child process, with LOG_LEVEL=fatal keeping pino off the stdout that carries the body"

requirements-completed: [PWA-04]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "One node:24-slim image built from `turbo prune @rede-social/api --docker` starts as ROLE=api and answers GET /v1/health -> 200 {ok:true} with DATABASE_URL pointing at a closed port, and starts as ROLE=worker from the same image (D-18)"
    requirement: PWA-04
    verification:
      - kind: other
        ref: "docker build -f apps/api/Dockerfile -t rede-social-api:local . && docker run -e ROLE=api ... && curl -fsS :18080/v1/health | grep '\"ok\":true' -> exit 0 (image 439 MB)"
        status: pass
      - kind: other
        ref: "docker run -e ROLE=worker ... -> log line {\"port\":8080,\"role\":\"worker\",\"message\":\"api listening\"} (01-07 adds the pg-boss branch)"
        status: pass
    human_judgment: false
  - id: D2
    description: "GET /v1/health?deep=1 runs `select 1` through the api_user client and reports db:true; it returns 500 {db:false} when Postgres is unreachable, while the plain route stays 200 without any database access"
    requirement: PWA-04
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/health.test.ts#1. answers 200 without touching the database"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/health.test.ts#2. deep=1 runs select 1 through api_user and reports db: true"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/health.test.ts#3. stays 200 in a fresh process whose DATABASE_URL points at a closed port"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/health.test.ts#4. deep=1 returns 500 with db: false when the database is unreachable"
        status: pass
    human_judgment: false
  - id: D3
    description: "Four workflow files parse and encode D-11/D-12/D-14/D-15: ci.yml mirrors the local exit gate and is reusable (workflow_call); deploy-api.yml gates migrate-and-deploy-prod on `needs: [checks, build]` plus the `production` environment, keeps a non-cancelling concurrency group, never seeds production, and passes vars.RUNTIME_SA on all four deploy-cloudrun steps; seed-prod.yml is workflow_dispatch only; keepalive-staging.yml crons the deep health check"
    requirement: PWA-04
    verification:
      - kind: other
        ref: "ruby -ryaml YAML.load_file on all four workflows + the plan's grep/awk assertions + the parsed-YAML check that migrate-and-deploy-prod needs [checks, build] and checks.uses == ./.github/workflows/ci.yml -> VERIFY-TASK2: PASS"
        status: pass
      - kind: other
        ref: "ruby check: jobs['migrate-and-deploy-prod'] body contains no 'db:seed' -> absent; seed-prod.yml triggers == ['workflow_dispatch']"
        status: pass
    human_judgment: false
  - id: D4
    description: "docs/DEPLOY.md enumerates every secret, variable and Secret Manager name the workflows read, per environment, plus the production-gate rules and the runbook"
    requirement: PWA-04
    verification:
      - kind: other
        ref: "mechanical cross-check: every `secrets.*` / `vars.*` reference in .github/workflows/*.yml (20 names) and every `*-{staging,prod}:latest` Secret Manager name (8 names) appears in docs/DEPLOY.md -> all OK"
        status: pass
    human_judgment: false
  - id: D5
    description: "The pipeline actually builds, migrates and deploys against live GitHub/GCP/Supabase/Vercel accounts, and the production approval gate behaves as designed"
    requirement: PWA-04
    verification: []
    human_judgment: true
    rationale: "No cloud accounts exist yet — this plan is pipeline-as-code only, by design. The first real runs are plans 01-10 (GitHub repo, environments, Vercel project), 01-11 (Supabase projects, GCP WIF/Artifact Registry/Secret Manager/service accounts) and 01-12 (the staging Supavisor spike and the first gated production deploy). A human must confirm the gate stops on approval there."

# Metrics
duration: 21 min
completed: 2026-09-12
status: complete
---

# Phase 01 Plan 09: Delivery Pipeline as Code Summary

**One `node:24-slim` image serves both Cloud Run roles and four GitHub workflows encode the whole delivery path — PR to staging, `main` through a reusable same-SHA `checks` job to an approval-gated production deploy — with `docs/DEPLOY.md` naming every secret the provisioning plans must create.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-09-12T21:12:00Z
- **Completed:** 2026-09-12T21:33:00Z
- **Tasks:** 2 of 2
- **Files modified:** 12 (10 created, 2 modified)

## Accomplishments

- **One image, both roles, no credentials needed to be healthy.** `apps/api/Dockerfile` prunes the monorepo to `@rede-social/api`'s slice, installs with `--frozen-lockfile`, builds with tsup and ships a `pnpm deploy --prod` tree under the non-root `node` user. It was built and run locally in both modes: `ROLE=api` answered `GET /v1/health` with `{"ok":true}` while `DATABASE_URL` pointed at a closed port, and `ROLE=worker` booted from the same image logging `role=worker` (the pg-boss branch lands in 01-07). Final size **439 MB**.
- **Deep health check wired for the Free-plan keep-alive.** `GET /v1/health?deep=1` runs `select 1` through the `api_user` client and returns `db: true`, or `500 {db:false}` when Postgres is unreachable. Four integration cases cover both routes, two of them in a fresh child process so the closed-port claim is proven against `env.ts`'s import-time validation rather than mocked.
- **CI written once and reused by the production gate.** `ci.yml` runs install → `turbo lint typecheck build test` → `boundaries` → `boundaries:negative` → `guard:lanes` → Supabase CLI 2.117.0 local stack with ES256 keys → `db reset` → `supabase test db` → seed → `test:integration` → `spike:supavisor` → Playwright, in the same order as the local exit gate. `on: workflow_call` lets `deploy-api.yml` mount it as its `checks` job, so the production path re-runs the identical steps for the exact SHA being deployed instead of trusting an earlier PR run.
- **Production cannot be reached untested or unapproved.** `migrate-and-deploy-prod` declares `needs: [checks, build]` *and* `environment: { name: production }`, so a direct admin push to `main` still goes through the checks; `concurrency: deploy-<ref>` with `cancel-in-progress: false` means two pushes queue rather than migrating in parallel (PWA-04); the job never seeds (D-14 keeps that in `seed-prod.yml`, `workflow_dispatch` only).
- **Runtime identity is explicit on every deploy.** All four `deploy-cloudrun@v3` steps pass `--service-account=${{ vars.RUNTIME_SA }}`, the account 01-11 creates with `roles/secretmanager.secretAccessor` — without it Cloud Run would run as the default compute SA and the mounted secrets would be unreadable at boot.
- **`docs/DEPLOY.md` is a checklist, not prose.** Environments table, GitHub variables (incl. `RUNTIME_SA`), environment variables (`PLATFORM_HOST`, `TENANT_DEMO_HOST`, `TENANT_LAB_HOST`, D-24), twelve environment secrets, eight Secret Manager names, Vercel env per environment, the three production-gate conditions, and a runbook (unpause a paused Free project, rotate the `api_user` password, seed production, roll back a revision, the `workflow_dispatch` fallback, "production is never a promoted preview"). A mechanical cross-check confirms no workflow reads a name the document omits.

## Task Commits

1. **Task 1: Cloud Run image (API + worker from one Dockerfile), deep health check, local build/run smoke** — `d30369a` (feat)
2. **Task 2: GitHub Actions workflows, Vercel ignore step and DEPLOY.md contract** — `5bee2fa` (feat)

**Plan metadata:** see the `docs(01-09)` commit.

## Files Created/Modified

- `apps/api/Dockerfile` — four-stage build (`base` → `pruner` → `builder` → `runner`) on `node:24-slim`; `pnpm dlx turbo@2.10.12 prune @rede-social/api --docker`, cached install layer from `out/json/`, `pnpm turbo build --filter=@rede-social/api...`, `pnpm deploy --prod --legacy /app`; `USER node`, `EXPOSE 8080`, `ROLE=api`, `CMD ["node","dist/main.js"]`
- `.dockerignore` — excludes `node_modules`, `.turbo`, `dist`, `.next`, `out`, `.git`, `.github`, `.gsd`, `.planning`, `.claude`, `reference`, `.env*`, `supabase/.temp`, `supabase/signing_keys.json`, `.vercel`, `docs`, `apps/web`
- `apps/api/src/routes/health.ts` — adds the `deep` query parameter, the `db` field, the 500 failure response and the comment explaining why this single query is allowed outside the lanes
- `apps/api/tests/integration/health.test.ts` — four cases: plain 200 without DB, `deep=1` with `db:true`, fresh-process 200 on a closed port, fresh-process 500 `db:false`
- `apps/api/tests/integration/health-no-db.ts` — the tsx child-process probe (`--deep` flag) the last two cases spawn; not collected by Vitest (`include` is `*.test.ts`)
- `packages/contracts/package.json` — `files: ["src", "legal"]` so `pnpm deploy` ships 01-04's legal texts into the image
- `.github/workflows/ci.yml` — the `checks` job; job-level concurrency keyed on `github.workflow` so the direct and called groups stay apart; local-stack-only `SEED_PASSWORD` / `SUPER_ADMIN_*` at job level; `playwright-report` uploaded on failure
- `.github/workflows/deploy-api.yml` — `checks` (reusable `ci.yml`, push only), `build` (WIF → Artifact Registry, image output pinned to `github.sha`), `staging` (PR only: `db push --include-roles`, `alter role api_user … password`, `config push`, seed with the three host variables, `api-staging` + `worker-staging`, deep health check), `migrate-and-deploy-prod` (push to `main`, `needs: [checks, build]`, `production` environment, migrations → `api` → `worker`, deep health check, no seeding) plus the commented `workflow_dispatch` fallback for RESEARCH §Pitfall 5
- `.github/workflows/seed-prod.yml` — `workflow_dispatch` only, `environment: production`, `pnpm db:seed` with the production secrets and the D-24 host variables
- `.github/workflows/keepalive-staging.yml` — `cron: '0 9 * * 1,4'` + manual dispatch, `curl -fsS --retry 3 "${{ vars.API_STAGING_URL }}/v1/health?deep=1"`
- `apps/web/vercel.json` — `ignoreCommand: npx turbo-ignore --fallback=HEAD^1`
- `docs/DEPLOY.md` — the environment/secret/variable contract, the production-gate rules and the runbook

## Decisions Made

See `key-decisions` in the frontmatter. The two that matter most downstream:

1. **`pnpm deploy --legacy` and the resulting CMD path.** pnpm 12 refuses the modern deploy path against a shared workspace lockfile without `inject-workspace-packages`; `--legacy` copies from the content-addressable store instead and warns explicitly. The deploy root is flat (`/app/dist`, `/app/node_modules`), so the entrypoint is `node dist/main.js`. 01-08's image rebuild and 01-12's staging deploy both depend on that path.
2. **Every Cloud Run service gets the full env triple.** `apps/api/src/env.ts` validates `DATABASE_URL`, `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` at import, so the worker services mount those in addition to `BOSS_DATABASE_URL`. 01-11 must therefore create `api-database-url-*`, `supabase-url-*` and `supabase-service-key-*` before either worker can boot, not only `worker-database-url-*`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Worker services mount the full environment, not only `BOSS_DATABASE_URL`**
- **Found during:** Task 2 (deploy-api.yml)
- **Issue:** The plan's staging bullet described the worker's `secrets:` as "incl. `BOSS_DATABASE_URL=worker-database-url-staging:latest`". `apps/api/src/env.ts` (01-01) validates `DATABASE_URL`, `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` at module import, so a worker container given only `BOSS_DATABASE_URL` would exit before pg-boss started — an immediate crash-loop on the first 01-07 deploy.
- **Fix:** Both worker steps (`worker-staging`, `worker`) mount `DATABASE_URL`, `BOSS_DATABASE_URL`, `SUPABASE_SERVICE_KEY` and `SUPABASE_URL`; `docs/DEPLOY.md` records which secret feeds which service.
- **Files modified:** `.github/workflows/deploy-api.yml`, `docs/DEPLOY.md`
- **Verification:** The local `ROLE=worker` container boots with exactly this env triple (Task 1 smoke); the Secret Manager cross-check confirms all eight names are documented.
- **Committed in:** `5bee2fa`

**2. [Rule 3 - Blocking] The plan's `<verify>` grep needed `-F` on this machine**
- **Found during:** Task 2 (running the plan's `<verify>` block)
- **Issue:** `grep -q -- '--service-account=${{ vars.RUNTIME_SA }}'` returned no match even though the string is present four times. `grep` on this machine is **ugrep 7.8.4** (installed as a shell function), whose BRE treats `$` as an anchor mid-pattern; GNU grep on an `ubuntu-latest` runner does not.
- **Fix:** Re-ran that one assertion as `grep -qF` (literal string, dialect-independent) and confirmed independently with `grep -cP -- '--service-account=\$\{\{ vars\.RUNTIME_SA \}\}'` → 4. No file was changed; the plan's `awk` counter already proved four `deploy-cloudrun@v3` steps paired with four `vars.RUNTIME_SA` references.
- **Files modified:** none (test-harness only)
- **Verification:** Full `<verify>` chain with `-F` substituted for that single assertion → `VERIFY-TASK2: PASS`.
- **Committed in:** n/a

---

**Total deviations:** 2 auto-fixed (1× Rule 2 missing critical, 1× Rule 3 blocking/tooling).
**Impact on plan:** None on scope. Deviation 1 is a correctness requirement the plan's shorthand omitted; deviation 2 is a local grep-dialect artifact with no effect on the committed files.

## Issues Encountered

- **`ci.yml` references two scripts that later plans still owe.** `pnpm boundaries:negative` runs `scripts/check-boundaries.sh` (not yet on disk) and `supabase test db` needs `supabase/tests/` (empty today). Both are deliberate: the plan requires CI to mirror the 01-08 exit gate, and the missing pieces belong to the boundary-fixture and pgTAP plans in this phase. Until they land, a real CI run would fail at those steps — which is exactly the coupling the exit gate is meant to expose, and is not observable now because no repository/remote exists yet.
- **No authentication was attempted.** `gh`, `gcloud`, `vercel` and remote `supabase` calls were deliberately not run: no accounts exist until 01-10/01-11, and this plan's validation contract is YAML parsing, grep assertions and a local Docker build/run.
- **Local test image removed** after the smoke (`docker rmi rede-social-api:local`) to give the 9 GiB of free disk back; 01-08 Task 3 rebuilds it after every wave.

## User Setup Required

None from this plan directly — but everything `docs/DEPLOY.md` lists is user/provisioning work that plans 01-10 and 01-11 will perform. That document is the authoritative checklist; no separate USER-SETUP.md was generated (the plan declares no `user_setup` frontmatter).

## Next Phase Readiness

**Ready for 01-10 and 01-11.** The provisioning plans now have exact names to create rather than guesses: five repository variables, three environment variables per environment, twelve environment secrets per environment, eight Secret Manager secrets, four Vercel variables per Vercel environment, one Artifact Registry repo (`rede-social`, `southamerica-east1`), two service accounts (`DEPLOY_SA`, `RUNTIME_SA` with `secretAccessor`) and one WIF provider.

**Ready for 01-07 and 01-08.** The image already runs with `ROLE=worker`; 01-07 only has to add the branch in `apps/api/src/main.ts` and 01-08's Docker smoke will exercise the complete tree (including 01-04's `packages/contracts/legal/*.md`, which the `files` field already admits).

**Open for 01-12.** The transaction-pooler proof for TENANT-03 is still the staging `pnpm spike:supavisor` run; `ci.yml` runs the local (direct-port contingency) variant on every PR, which is a regression guard, not the authoritative proof. `docs/DEPLOY.md` records the session-mode fallback path (change `DATABASE_URL` in Secret Manager only).

**Concern to carry forward.** RESEARCH §Pitfall 5 / Open Question 1 is still open: if the GitHub account cannot create protected environments on a private repository, 01-10 must switch `migrate-and-deploy-prod` to the commented `workflow_dispatch` fallback. The job graph (`needs: [checks, build]`) is unaffected either way, so the safety property survives the fallback.

---
*Phase: 01-foundation-kernel-tenancy-auth-ci-cd*
*Completed: 2026-09-12*

## Self-Check: PASSED

All 13 files listed in `key-files` exist on disk; both task commits (`d30369a`, `5bee2fa`) are present in `git log --all`. Plan-level verification re-run at close-out: the four workflows parse, the full `<verify>` grep/awk/ruby chain passes, and the Docker build + `ROLE=api` / `ROLE=worker` smokes passed before the test image was removed.
