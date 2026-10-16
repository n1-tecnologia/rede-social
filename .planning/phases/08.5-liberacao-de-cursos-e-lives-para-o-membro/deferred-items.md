# Phase 08.5 deferred items

Out-of-scope discoveries logged by the plan executors: failures the 08.5-13 exit gate hit that this
phase's changes did not cause (the 08.3-12 posture). An entry stays open until it carries
`status: resolved`.

## Deferred Items

- `push-send-job.test.ts` times out under the full `pnpm turbo typecheck build test` graph
  status: open
  **What:** in the first `pnpm verify` run of the 08.5-13 gate (2026-10-16), the case "5_000
  subscriptions over 50 jobs, 4 at a time" of `packages/modules/notifications/tests/push-send-job.test.ts`
  hit Vitest's 5 s default timeout while all 31 turbo tasks ran in parallel. The timed-out case kept
  writing into the shared fake push outbox, so the next three cases of the same `describe` read 700,
  232 and 215 entries instead of 300, 40 and 7. Turbo then cancelled the other tasks.
  **Why not this phase:** `packages/modules/notifications` has no diff between `5c6c7bd5` (the commit
  before 08.5-01) and HEAD (the PR-6 check). The package alone is 127/127 in 1.6 s, and the stage
  re-run with `--concurrency=4` is 33/33.
  **Fix idea:** give the 5_000-subscription case an explicit timeout (or a smaller fan-out), and reset
  the fake outbox in a `beforeEach` so one slow case cannot spill into the next. Until then, run the
  stage with `--concurrency=4` on a loaded machine.

- `scripts/seed.ts` second-run idempotency trips `story_views_uq` on a database a browser run left behind
  status: open
  **What:** `bootstrap.test.ts` › "11. a second run exits 0 and leaves tenant_domains unchanged"
  re-runs the seed. The seeded story views insert with `on conflict (id) do nothing`, but the table's
  unique key is `story_views_uq (tenant_id, user_id, story_id)`. A view the member's browser recorded
  in an earlier e2e run (row `a431cc93-…`, `viewed_at` 2026-10-16 02:59Z, i.e. during 08.5-12's e2e
  run) has a different id for the same (tenant, member, story `0d…00d3`), so the seed's insert raises
  `23505` and the case fails (1 of 1163).
  **Why not this phase:** `pnpm verify` runs `test:integration` on whatever database the previous e2e
  left (its `db:reset` comes after integration), and neither `scripts/seed.ts`, the stories module nor
  `bootstrap.test.ts` changed between `5c6c7bd5` and HEAD. It is the "UAT rows / e2e residue break
  seed-pinned tests" drift recorded in project memory. After `pnpm db:reset && pnpm db:seed`, the same
  suite passes.
  **Fix idea:** make the seeded view insert `on conflict on constraint story_views_uq do nothing` (or
  `on conflict (tenant_id, user_id, story_id)`), or have `verify` reset and seed before `supabase test db`.
