# Phase 13 deferred items (out of scope of the plan that found them)

## Found during 13-24 (2026-11-05)

- `packages/core/tests/tenant-set-no-platform.test.ts` "never references schema platform or the central ledger"
  fails on `supabase/migrations/20261105141336_push_devices.sql` (plan 13-06). The guard's regex `/"platform"/i`
  matches the new column reference `"push_subscriptions"."platform"` in the CHECK constraints, a false positive:
  the file does not touch schema `platform` or the central ledger. Fix belongs to plan 13-06's owner: either
  tighten the guard to `"platform"\s*\.` / schema-qualified shapes, or rename the column. Not touched by 13-24.
