---
phase: quick-261009-h4q
plan: 01
subsystem: ci
tags: [ci, lane-guard, test, one-line-fix]
status: complete
requirements: [TENANT-03]
key-files:
  modified:
    - apps/api/tests/integration/data-api-not-exposed.test.ts
commits: 1
plan_head_before: 7866dc1366f13abafcb4e62024295b6faaf004b7
actuals:
  tokens: 100
  tasks: 1
  commits: 1
---

# Quick 261009-h4q: Quote the memberships role column so the lane guard passes

The `afterAll` cleanup in `data-api-not-exposed.test.ts` now writes the memberships column as `set "role" = 'member'`, so the CI "Lane guard" grep no longer reads it as a session-scoped role switch.

## What changed

- `apps/api/tests/integration/data-api-not-exposed.test.ts` line 234: `set role = 'member'` became `set "role" = 'member'`. Postgres resolves the quoted lowercase identifier to the same column, so behaviour is unchanged.
- `scripts/guard-local-settings.sh` is untouched (no diff). The guard stays strict for every real role switch.

## Verification

- Guard before: exit 1, one offender at `data-api-not-exposed.test.ts:234`.
- Guard after: exit 0, `guard:lanes: OK — no non-LOCAL role switch or session-scoped claims in packages apps scripts`.
- `pnpm --filter @rede-social/api exec biome check tests/integration/data-api-not-exposed.test.ts`: clean, no fixes applied.
- Commit numstat: 1 insertion, 1 deletion, one file.
- Commit: `f8cde4c` `fix(quick-261009-h4q): quote the memberships role column so the lane guard passes`. No Co-Authored-By or attribution line.
- Nothing was pushed.

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED
