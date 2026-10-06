---
phase: quick-261006-fs9
plan: 01
subsystem: notifications push / worker / deploy
tags: [push, web-push, pg-boss, localConcurrency, connection-pool, supavisor, cloud-run, max-instances, launch-10k]
status: complete
requires: []
provides:
  - "mapWithConcurrency (bounded parallel map, input order kept)"
  - "PUSH_SEND_PARALLELISM = 16, PUSH_SEND_JOB_CONCURRENCY = 4"
  - "JobDefinition.concurrency -> pg-boss localConcurrency in the worker"
  - "DATABASE_POOL_MAX env knob (default 5, worker 10)"
  - "Cloud Run --max-instances: prod api 25 / worker 1, hml api 2 / worker 1"
  - "docs/DEPLOY.md ## Connection budget (Pro)"
affects: [notifications, worker, deploy-api.yml, deploy-hml.yml]
tech-stack:
  added: []
  patterns:
    - "Queue concurrency is manifest data (JobDefinition.concurrency), never a hardcoded queue name in the app tier (MOD-04)"
key-files:
  created:
    - packages/modules/notifications/server/push/parallel.ts
    - packages/modules/notifications/tests/push-parallel.test.ts
    - packages/modules/notifications/tests/push-send-job.test.ts
  modified:
    - packages/modules/notifications/contracts/index.ts
    - packages/modules/notifications/server/push/send-job.ts
    - packages/modules/notifications/README.md
    - packages/core/server/modules/manifest.ts
    - packages/core/server/env.ts
    - packages/core/db/client.ts
    - packages/core/db/README.md
    - apps/api/src/worker.ts
    - apps/api/tests/unit/registry.test.ts
    - .github/workflows/deploy-api.yml
    - .github/workflows/deploy-hml.yml
    - docs/DEPLOY.md
decisions:
  - "Push sends run 16 in flight per job and 4 jobs per worker; the badge counts stay sequential, one recipient at a time, before any send (A-WR-03 unchanged)"
  - "The worker app pool is DATABASE_POOL_MAX=10 (api keeps 5, pg-boss keeps 2); 13 worst-case holders vs 10 is a brief wait, never a deadlock, because no handler holds-and-waits on the app pool"
  - "Cloud Run caps from 2 x (A x 6 + W x 13) + H x 6 + R <= L on Supabase Small (L 400): A 25, W 1, H 2, R 40 -> 378"
metrics:
  duration: "~9 min"
  completed: 2026-10-06
  tasks: 2
  files: 15
requirements: [NOTIF-03, MOD-04]
actuals:
  tokens: 13000
  tasks: 2
  commits: 2
plan_head_before: 3ed1544680ad2b82815215b16cb59eb14d6e69e8
commits: 2
---

# Quick 261006-fs9 Plan 01: Push fan-out throughput and Cloud Run max-instances Summary

A push job now sends at most 16 subscriptions at a time through a small bounded-parallel map, after the same sequential per-recipient badge counts. The worker runs `notifications.push-send` 4 at a time from the job definition's `concurrency`, on an app pool sized by a new `DATABASE_POOL_MAX` knob (10 on the worker). Cloud Run is capped (production api 25 and worker 1, hml api 2 and worker 1) using the pooler budget formula now written in docs/DEPLOY.md.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 (tracer) | 2c43d93 | perf(quick-261006-fs9): send a push job's subscriptions with bounded parallelism |
| 2 | 0eb4a27 | perf(quick-261006-fs9): run push jobs 4 at a time and cap Cloud Run by the pooler budget |

Neither commit has a Claude/Anthropic trailer (`git log -2 --format=%B | grep -ci anthropic` prints 0). Author is the repo-local identity.

## What changed

**Task 1:**
- `PUSH_SEND_PARALLELISM = 16` and `PUSH_SEND_JOB_CONCURRENCY = 4` added to the notifications contracts.
- `server/push/parallel.ts` adds `mapWithConcurrency`. It has no dependency, keeps results in input order, clamps the limit to an integer between 1 and the list length (0, a negative number, a fraction or NaN fall back to the clamp), and resolves `[]` for an empty list without calling `fn`. If `fn` rejects, the whole call rejects.
- In `send-job.ts`, only the serial send loop changed: it is now `mapWithConcurrency(subscriptions, PUSH_SEND_PARALLELISM, …)` with the same per-row body. Step 1, the badge loop, step 3 (report order, retry enqueue, logs) and every log field are byte-identical. The step-2 docblock was updated.
- Tests:
  - `push-parallel.test.ts`: 10 cases.
  - `push-send-job.test.ts`: the 5,000-subscription run (50 jobs × 100 users, 4 jobs at a time over the real fake transport), the single-job lane ceiling, the PUSH_MAX_ATTEMPTS case, the failing-counters case and the thrown-send case.

**Task 2:**
- `JobDefinition.concurrency?` was added to the manifest, and `pushSendJob.concurrency = PUSH_SEND_JOB_CONCURRENCY`.
- The worker calls `boss.work(name, { localConcurrency: job.concurrency ?? 1 }, …)` and logs a `concurrency` map in `worker.started`. `createBoss({ max: 2 })` was not touched.
- `DATABASE_POOL_MAX` (int 1..20, default 5) is used by `packages/core/db/client.ts`.
- New unit guard (registry test 13): only `notifications.push-send` declares a concurrency, and it is 4.
- Workflow flags and `DATABASE_POOL_MAX=10` were added on the worker env only. Both files still parse, and each deploy step's flags were checked after parsing.
- The DEPLOY.md section and the README pool rows were written.

## Task 2 pool-fit re-check (result)

The re-check passed. No worker handler holds an app-pool connection while acquiring a second one, so the pool was sized as planned.

- **Push-send:** at most one lane at any moment, in this order: the read lane; then for each distinct recipient a flags-cache-miss lane (only on a miss), released before that recipient's counters lane opens; then the report lane. The single-job test asserts global max open lanes = 1, a per-job max of 1, and that no `resolveCounters` call ran inside a lane of its own job. The 5,000 run asserts a per-job max of 1 and a global max ≤ 4.
- **Fan-out** (`fanout-job.ts`) and **sink** (`sink.ts`) both read `moduleFlags` before opening their lane. Inside the fan-out lane, sources and `deliverIntent` take the caller's `tx`.
- **Nested-lane scan:** a scripted search of `packages/core/server` and `packages/modules` for lane callbacks that call any function which itself opens a lane flagged only tx-taking helpers. These are `enqueueInTx`, `enqueueVerify`, `enqueueDerivation`, `applyBrandColors`, `createPendingInvite`, `armEventReminders`, `upsertLinkPreview` and the domains `tenantExists(tx, …)`. Every one of them uses the caller's `tx`, so all are false positives.
  - `enqueueInTx` writes the job through the lane's own connection. It only *starts* the separate API-side pg-boss pool (`getBoss`, max 1), which never waits on the app pool, so there is no cycle.
  - The media, domain, branding, invite, sweep and provider-event jobs run their `withAdminTx` calls one after another. `deleteProviderAsset` runs outside the lane.
- **Worst case:** 4 push jobs + 9 other queues = 13 holders against a pool of 10. At most 3 handlers wait briefly in postgres.js, with no starvation or deadlock. The pg-boss pool stays at 2: no connection is held across a handler, LISTEN/NOTIFY is off, and polls and completes are single short queries.

## Gate results (all run locally, read-only turbo cache)

| Gate | Result |
|------|--------|
| `vitest run tests/push-parallel.test.ts tests/push-send-job.test.ts` (notifications) | 2 files, 16 tests passed |
| `pnpm --filter @rede-social/module-notifications test` | 13 files, 127 tests passed |
| `pnpm --filter @rede-social/api exec vitest run tests/unit` | 7 files, 58 tests passed (includes the new registry test 13 and module-readmes) |
| `TURBO_CACHE=local:r pnpm typecheck` | 16/16 tasks successful |
| `TURBO_CACHE=local:r pnpm lint` | exit 0 (Biome + check-ui-literals OK) |
| `TURBO_CACHE=local:r pnpm turbo test` | 13/13 tasks successful (every package's unit suite green; the ERROR log lines in the output are expected-failure fixtures of existing tests) |
| `pnpm boundaries` / `pnpm boundaries:negative` / `pnpm guard:lanes` | no issues / both layers reject the fixture / OK |
| Workflow grep checks + yaml parse | `--max-instances=25` (api), `--max-instances=1` (worker), `--max-instances=2` (hml api), `DATABASE_POOL_MAX=10` on both worker steps; `yaml ok` |
| `git diff 3ed1544..HEAD` touches `supabase/`, `counters.ts`, `apps/api/src/modules/registry.ts`? | no |

## Integration files: verify on CI

These were not run successfully locally because the local Supabase stack is down and Docker is not running (`docker info` failed). Per the constraints, the stack was not started and `db:reset` was not run. Command run: `pnpm --filter @rede-social/api exec vitest run tests/integration/push.test.ts tests/integration/worker.test.ts`. Exact local errors:

- `tests/integration/push.test.ts`: suite setup failed with `Error: connect ECONNREFUSED 127.0.0.1:54322` (postgres.js).
- `tests/integration/worker.test.ts`: `Error: worker never answered on port 50101: TypeError: fetch failed`. The spawned worker could not reach the database at 127.0.0.1:54322 (ECONNREFUSED).

**Verify on CI:** `ci.yml` runs `supabase start` plus the integration suite. push.test.ts case 1 checks the badge against `/v1/me/counters`. Case 4 covers 410 delete, a 503 retried alone with backoff, and the healthy sibling never re-sent. worker.test.ts boots `ROLE=worker` with the new work options.

## Deployment note

Nothing was deployed. No gcloud, gh, vercel or supabase remote command was run, and no workflow was run. The next production deploy (`deploy-api.yml`) changes the Cloud Run flags (api `--max-instances=25`, worker `--max-instances=1`) and the worker env (`DATABASE_POOL_MAX=10`). It applies **no migration** from this task. The next hml deploy adds api `--max-instances=2`. The worker settings take effect only when `HML_SUPABASE=isolated`.

## Deviations from Plan

1. **[Rule 2 - test coverage]** `push-send-job.test.ts` also asserts `pushSendJob.concurrency === PUSH_SEND_JOB_CONCURRENCY` (added in Task 2) and a per-job send ceiling (≤ 16 per tenant in the 5,000 run). Both are extra guards and change no behavior.
2. **[Test design]** Each fake job has its own tenant id, so lanes, counts and sends can be attributed to a job in the concurrent 5,000 run. The plan's "lanes attributable to its own job" is implemented as a per-tenant open-lane counter.
3. **[Doc placement]** The README line was merged into the existing `notifications.push-send` bullet instead of being added as a separate bullet, which keeps one entry per job in the Jobs section.
4. The workflow verify greps (`grep -c -- "--max-instances=1 "`, `grep -c DATABASE_POOL_MAX=10`) also count the new YAML comment lines. The parsed-YAML check confirms each value is on the right deploy step.

Otherwise the plan was executed as written. No batched badge, migration, definer or counters-seam change was made.

## Known Stubs

None.

## Threat Flags

None. The new surface (up to 64 outbound sends per worker, and the pool and instance sizing) is covered by T-fs9-01..07 in the plan.

## Self-Check: PASSED

- FOUND: packages/modules/notifications/server/push/parallel.ts
- FOUND: packages/modules/notifications/tests/push-parallel.test.ts
- FOUND: packages/modules/notifications/tests/push-send-job.test.ts
- FOUND: docs/DEPLOY.md "## Connection budget (Pro)"
- FOUND: commit 2c43d93
- FOUND: commit 0eb4a27
