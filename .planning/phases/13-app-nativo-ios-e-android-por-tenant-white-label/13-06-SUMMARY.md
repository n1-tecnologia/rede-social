---
phase: 13-app-nativo-ios-e-android-por-tenant-white-label
plan: 06
subsystem: database
tags: [native-app, schema, push, rls, definer-functions, pgtap, D-606, D-603, tracer, blocking-schema]

requires:
  - phase: 07-notifications
    provides: "public.push_subscriptions, app.push_subscription_upsert and the owner-only policies this plan widens"
  - phase: 13-app-nativo-ios-e-android-por-tenant-white-label
    provides: "13-03 token shape constants (APNS_TOKEN_PATTERN, FCM_TOKEN_PATTERN, NATIVE_PLATFORMS)"
provides:
  - "push_subscriptions holds a native device token as a second kind of the same row (kind webpush | apns | fcm)"
  - "push_subscriptions_kind_chk, push_subscriptions_platform_chk, push_subscriptions_environment_chk"
  - "app.push_device_upsert(kind, token, platform, environment, app_version): same-tenant handoff, idempotent, 42501 / 22023"
  - "app.push_subscriptions_for_v2(uuid[]): the send job's read of both kinds with the native columns"
  - "app.push_subscriptions_for(uuid[]) narrowed to web rows only (same signature and return type)"
affects: [13-11, 13-12, 13-26]

plan_head_before: 5f2afb19571fa53deedc8db239edc64712bf16c4
actuals:
  tokens: 9000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "native token is a second kind of an endpoint-keyed row, not a devices table (add-alongside)"
    - "narrow the old reader and add a _v2 reader so a previous worker revision never sees a native row"
    - "pgTAP RED with function-existence facts via to_regprocedure so absence is a failed assertion, not a crash"

key-files:
  created:
    - supabase/migrations/20261105141336_push_devices.sql
    - supabase/migrations/meta/20261105141336_snapshot.json
    - supabase/migrations/20261105141819_push_devices_functions.sql
    - supabase/migrations/meta/20261105141819_snapshot.json
    - supabase/tests/221-native-devices.sql
  modified:
    - packages/modules/notifications/db/schema.ts
    - supabase/migrations/meta/_journal.json

key-decisions:
  - "app.push_subscriptions_for_v2 is executable by authenticated (plus service_role and api_user), not 'authenticated cannot execute' as the plan text said: the send job reads inside withTenantTx, which switches to authenticated, so a narrower grant would lock out plan 12's only caller. Same exposure as the shipped web reader."
  - "A re-saved native token clears failure_count (the app just proved the token alive, like the web writer) and leaves created_at and last_success_at alone; the plan's 'resets nothing else' is read as those two."
  - "The 22023 message is the fixed text 'push_device_upsert: invalid device' so a token never reaches an error, a log or a pgTAP failure message."
  - "The environment is required for both native kinds (production | sandbox); the CHECK still allows null for rows written by other paths."

patterns-established:
  - "Hand-written function migration produced by drizzle-kit generate --custom so journal and snapshot stay in sync"

requirements-completed: [NATIVE-08]

coverage:
  - id: D1
    description: "push_subscriptions holds a native token (kind, platform, app_environment, app_version, nullable keys) under CHECKs that keep web rows complete; expand-only generated migration, zero drift on both Drizzle sets"
    requirement: "NATIVE-08"
    verification:
      - kind: integration
        ref: "supabase/tests/221-native-devices.sql#fact 1 (9 refusals 23514, 3 valid shapes, kind default)"
        status: pass
      - kind: other
        ref: "pnpm db:generate and pnpm db:generate:central print 'No schema changes'"
        status: pass
    human_judgment: false
  - id: D2
    description: "app.push_device_upsert saves, hands off inside one tenant, is idempotent and refuses bad input and non-live callers; the same token in another tenant is a separate row"
    requirement: "NATIVE-08"
    verification:
      - kind: integration
        ref: "supabase/tests/221-native-devices.sql#facts 2, 3 and 5"
        status: pass
    human_judgment: false
  - id: D3
    description: "Two-tenant and owner-only isolation of native rows with positive controls; the old reader returns web rows only and _for_v2 returns both kinds"
    requirement: "NATIVE-08"
    verification:
      - kind: integration
        ref: "supabase/tests/221-native-devices.sql#facts 4 and 6"
        status: pass
      - kind: integration
        ref: "pnpm supabase test db (55 files, 3304 tests) and bash scripts/db-two-databases.sh --assert-no-platform"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-11-05
status: complete
---

# Phase 13 Plan 06: Native device tokens in push_subscriptions Summary

**The push table now holds an APNs or FCM device token as a second `kind` of the same endpoint-keyed row, written through a tenant-scoped definer with the web handoff rule, read through a new `_for_v2` reader, with the old reader narrowed to web rows so a previous worker revision keeps working.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-11-05T14:13:20Z
- **Completed:** 2026-11-05T14:21:00Z
- **Tasks:** 3 (tracer, TDD, blocking schema gate)
- **Files modified:** 7 (two of them generated snapshots)

## Accomplishments

- `public.push_subscriptions` gained `kind` (default `webpush`), `platform`, `app_environment`, `app_version`; `p256dh` and `auth` are nullable under `push_subscriptions_kind_chk`, plus `push_subscriptions_platform_chk` and `push_subscriptions_environment_chk`. The unique key `(tenant_id, endpoint)` and both owner-only policies are untouched, so `endpoint` holds the device token for native kinds.
- `app.push_device_upsert` follows the shipped conventions (definer, empty search_path, tenant pinned in every statement, 42501 without claim or live membership, 22023 on bad input with a message that never contains the token) and keeps the handoff: another member's row for the same token in the same tenant is deleted, a token in another tenant is untouched.
- `app.push_subscriptions_for` keeps its exact signature and return type and gains `kind = 'webpush'` (T-13-12); `app.push_subscriptions_for_v2` returns the old columns plus the four native ones for plan 12's worker.
- `221-native-devices.sql`: 60 assertions (privilege facts, 9 CHECK refusals with 3 positive controls, idempotency, handoff, two-tenant negatives beside positive controls, five refusal cases, both readers).

## Task Commits

1. **Task 1: [tracer] widened table and one generated migration** - `9f62ce39` (feat)
2. **Task 2 RED: failing pgTAP proof** - `abd49622` (test)
3. **Task 2 GREEN: writer, new reader, narrowed old reader** - `ba051663` (feat)
4. **Task 3: [BLOCKING schema] gate** - no files; ran against the committed state (below)

**Plan metadata:** the docs commit that carries this summary (docs: complete plan).

## TDD Gate Compliance

- RED commit `abd49622` precedes GREEN commit `ba051663`. Both commits are in the log (`test(13-06)` then `feat(13-06)`). No refactor commit.
- RED evidence: `pnpm supabase test db supabase/tests/000-helpers.sql supabase/tests/221-native-devices.sql` exited 1. The per-test TAP was captured by running the same file through `psql` in the local database (the CLI prints only failure summaries) and normalised with a throwaway script kept in the scratchpad, outside the repo. Real counts: 54 assertions ran before the file stopped at the first reader query, 24 ok and 30 not ok. Target test `fact 0: the writer, the old reader and _for_v2 exist and are SECURITY DEFINER with search_path pinned to ""` failed on its assertion, the cause being `42883 function app.push_device_upsert(...) does not exist`. `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` (`target_test_failed`).
- GREEN: the same files plus 153 passed (102 tests, exit 0) on the first run after `supabase migration up`.

## [BLOCKING schema] gate results (Task 3)

- `pnpm db:generate` and `pnpm db:generate:central`: "No schema changes, nothing to migrate".
- `pnpm db:reset` then `pnpm db:seed`: exit 0 (once). Whole `pnpm supabase test db`: 55 files, 3304 tests, Result: PASS.
- `bash scripts/db-two-databases.sh --reset`: tenant set applied 158 migrations; `--assert-no-platform`: "ok: no platform schema and no central ledger in rede_tenant_b".
- `TURBO_CACHE=local:r pnpm turbo typecheck --filter=@rede-social/module-notifications --filter=@rede-social/core --filter=@rede-social/api`: 3 successful.
- `git status --porcelain supabase/central` prints nothing; the shipped `20260930180227_push_subscriptions_functions.sql` is unchanged. The API integration suite was not run (the plan assigns it to the owning API plan, after pgTAP).
- The two generated files: `supabase/migrations/20261105141336_push_devices.sql` (generated, header comment added by hand) and `supabase/migrations/20261105141819_push_devices_functions.sql` (hand-written through `drizzle-kit generate --custom`, so the journal and snapshot are in sync). Disk stayed between 8.4 and 10 GiB free throughout; no `.turbo` or `.next` was created by this plan.

## Files Created/Modified

- `packages/modules/notifications/db/schema.ts` - kind, platform, app environment, app version, nullable keys, three CHECKs, fact 6 in the table doc
- `supabase/migrations/20261105141336_push_devices.sql` - expand-only table change (+ snapshot, journal)
- `supabase/migrations/20261105141819_push_devices_functions.sql` - `push_device_upsert`, narrowed `push_subscriptions_for`, `push_subscriptions_for_v2` (+ snapshot, journal)
- `supabase/tests/221-native-devices.sql` - the pgTAP proof

## Decisions Made

See `key-decisions` above. Reversibility of D-606 is as the plan recorded it: the CHECK and the nullable keys are the costly part; the add-alongside choice keeps a later `devices` table possible by referencing `push_subscriptions.id`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `_for_v2` grant would lock out its only caller**
- **Found during:** Task 2 (reading plan 12 and `send-job.ts` before writing the function)
- **Issue:** The plan asks that `authenticated` cannot execute `_for_v2` (grant to the connection role and `service_role` only). Plan 12 reads it "inside the tenant transaction", and `withTenantTx` runs `set local role authenticated`; the shipped web reader is likewise granted to `authenticated` and the send job calls it that way. A narrower grant would fail every native send with permission denied.
- **Fix:** `grant execute ... to authenticated, service_role, api_user`; `app` is not PostgREST-exposed, the function is tenant-pinned and refuses a lane without a claim (42501), so the exposure equals the shipped reader's. The pgTAP fact now asserts authenticated CAN execute all three, service_role can execute `_for_v2`, anon cannot execute any.
- **Files modified:** `supabase/migrations/20261105141819_push_devices_functions.sql`, `supabase/tests/221-native-devices.sql`
- **Verification:** `221-native-devices.sql` facts 0 and 6 pass.
- **Committed in:** `abd49622` (test), `ba051663` (grant)

**2. [Rule 3 - Blocking] RED had to avoid a mid-file crash**
- **Found during:** Task 2 RED
- **Issue:** `results_eq` over a query that calls a missing function aborts the whole file, so a first draft produced a crash instead of a clean assertion failure.
- **Fix:** facts about existence use `to_regprocedure(...)`; the idempotency check calls the writer inside `lives_ok` and compares the row id kept in a temp table. Reader queries in section 6 still stop the RED run once the readers are reached (54 of 60 assertions executed), which is a consequence of the missing function and not an unrelated crash.
- **Files modified:** `supabase/tests/221-native-devices.sql`
- **Committed in:** `abd49622`

---

**Total deviations:** 2 auto-fixed (1 bug in the plan text, 1 blocking test-shape issue)
**Impact on plan:** The grant change is necessary for plan 12 to work. No scope creep.

## Issues Encountered

- The first `psql` replay of the test file failed because the pgTAP extension was not visible to that session until `000-helpers.sql` had run and committed; replaying the test file alone afterwards produced the real TAP.
- Applied the new migrations to the running local stack with `supabase migration up` between RED and GREEN to keep to a single `db:reset`, which Task 3 then ran from scratch.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-13-11 (token read or overwritten across members or tenants) is mitigated and proven by facts 3 to 5; T-13-12 (old worker meets a native row) is mitigated and proven by fact 6.

## User Setup Required

None - no external service configuration required. Deploy order for the hosted environments remains migration, then API, then worker.

## Next Phase Readiness

- Plan 11 (device routes) can call `app.push_device_upsert`; plan 12 (worker) can switch to `app.push_subscriptions_for_v2` inside `withTenantTx`.
- Not pushed, nothing applied to a hosted project.

## Self-Check: PASSED

- Files exist: both migrations, both snapshots, `221-native-devices.sql`, `schema.ts` (checked with `ls`/`git log`).
- Commits found: `9f62ce39`, `abd49622`, `ba051663`.
- Acceptance criteria: one `*_push_devices.sql` with `push_subscriptions_kind_chk`, two `DROP NOT NULL` and `DEFAULT 'webpush'`; one `*_push_devices_functions.sql` with `push_device_upsert`, `push_subscriptions_for_v2`, four `set search_path = ''` and `revoke all on function`; `grep -c 42501` 14 and `grep -c 23514` 21 in the pgTAP file; the shipped functions migration shows no diff.

---
*Phase: 13-app-nativo-ios-e-android-por-tenant-white-label*
*Completed: 2026-11-05*
