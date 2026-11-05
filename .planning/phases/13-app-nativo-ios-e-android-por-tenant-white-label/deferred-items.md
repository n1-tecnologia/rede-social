# Phase 13 deferred items (out of scope of the plan that found them)

## Found during 13-24 (2026-11-05) — RESOLVED by the orchestrator in the same wave

- `packages/core/tests/tenant-set-no-platform.test.ts` "never references schema platform or the central ledger"
  failed on `supabase/migrations/20261105141336_push_devices.sql` (plan 13-06): the guard's `/"platform"/i`
  matched the new COLUMN `"push_subscriptions"."platform"`, a false positive. Fixed by narrowing the guard to the
  schema shapes (`platform.x`, `"platform"."x"`, `schema [if not exists] platform`, `search_path ... platform`);
  core suite is 96 files / 1399 tests green again.
