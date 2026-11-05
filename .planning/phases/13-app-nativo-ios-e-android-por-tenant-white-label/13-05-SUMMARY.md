---
phase: 13-app-nativo-ios-e-android-por-tenant-white-label
plan: 05
subsystem: database
tags: [native-app, schema, control-plane, sealed-credentials, rls, pgtap, drizzle, D-605, D-615, D-617, D-539, tracer, blocking-schema]

requires:
  - phase: 13-app-nativo-ios-e-android-por-tenant-white-label
    provides: "APP_CREDENTIAL_KINDS and the id/team/fingerprint validators in @rede-social/contracts/native (plan 03)"
  - phase: 09.2-banco-por-tenant-projeto-supabase-dedicado-por-tenant
    provides: "the platform schema, the central migration set with its own ledger, the zero-policy rule and the 09.2/09.4 hardening pattern"
provides:
  - "platform.tenant_apps: the non-secret facts of a tenant's native app, keyed by tenant_id, both purchase switches default false"
  - "platform.tenant_app_credentials: one SEALED row per (tenant_id, kind), six kinds, unique key, row id stable across a replace"
  - "Drizzle exports tenantApps, tenantAppCredentials, GENERATED_CREDENTIAL_KINDS, ALL_CREDENTIAL_KINDS"
  - "pgTAP 224-central-tenant-apps.sql (112 assertions) and 210-central-registry.sql counting thirteen platform tables"
affects: [13-06, 13-08, 13-09, 13-10, 13-12, 13-15, 13-24, 13-29]

plan_head_before: 26fe8065752b275202bdbf658619786711bd891e
actuals:
  tokens: 12000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "credential-per-row layout: a new credential kind needs no migration of the layout, only a value in the code constant and the CHECK of the next migration"
    - "format CHECKs named per concern and asserted by constraint name in pgTAP (throws_ok with the full violation message), so a refusal by the wrong CHECK fails the test"
    - "central hardening file generated with drizzle-kit generate --custom, so the journal and snapshot stay in sync"

key-files:
  created:
    - packages/core/db/central/apps.ts
    - supabase/central/migrations/20261105140052_platform_tenant_apps.sql
    - supabase/central/migrations/20261105140526_platform_tenant_apps_hardening.sql
    - supabase/central/migrations/meta/20261105140052_snapshot.json
    - supabase/central/migrations/meta/20261105140526_snapshot.json
    - supabase/tests/224-central-tenant-apps.sql
  modified:
    - packages/core/db/central/index.ts
    - supabase/central/migrations/meta/_journal.json
    - supabase/tests/210-central-registry.sql

key-decisions:
  - "The credential kind CHECK is built from APP_CREDENTIAL_KINDS plus GENERATED_CREDENTIAL_KINDS (sql.raw over the constants), so the code and the migration cannot drift on the six kinds."
  - "tenant_apps_ids_chk is a sixth CHECK beside the five the plan names: bundle_id and application_id carry the same shape the contract validators accept (iOS hyphen, Android underscore, at most 160 characters)."
  - "tenant_apps_sha256_chk also refuses a null element, an empty element and one element holding two comma-joined fingerprints, not only a malformed pair."
  - "reviewer_user_id is a plain uuid with no foreign key: the reviewer lives in the tenant's own project, which may be another database than the control plane."
  - "The five manual checklist flags are columns named manual_apple_account, manual_play_account, manual_screenshots, manual_submitted and manual_published, matching APP_CHECKLIST_MANUAL_KEYS."
  - "team_id is stored upper-case only (^[A-Z0-9]{10}$) as the plan states, while the contract's isValidTeamId also accepts lower case, so plan 09 must upper-case before the write."

patterns-established:
  - "Control-plane tables hold no plain secret column: columns_are() in pgTAP pins tenant_app_credentials to exactly id, tenant_id, kind, sealed, held_at."

requirements-completed: [NATIVE-24, NATIVE-26, NATIVE-27]

coverage:
  - id: D1
    description: "Tracer: one tenant_apps row and one sealed credential row written and read back through the platform lane, the same statements refused to the tenant lane with 42501, in ONE generated central migration"
    requirement: NATIVE-26
    verification:
      - kind: integration
        ref: "supabase/tests/224-central-tenant-apps.sql#section 5 exposure"
        status: pass
    human_judgment: false
  - id: D2
    description: "Both purchase switches default to false and a switch update changes only its own column (storage half of the NATIVE-24 default)"
    requirement: NATIVE-24
    verification:
      - kind: integration
        ref: "supabase/tests/224-central-tenant-apps.sql#D-617 default and one-switch update"
        status: pass
    human_judgment: false
  - id: D3
    description: "Format CHECKs on team id, fingerprints, https URLs, three-part versions, bundle and application ids and the id lock, each refused with its own constraint name"
    requirement: NATIVE-24
    verification:
      - kind: integration
        ref: "supabase/tests/224-central-tenant-apps.sql#section 2 CHECKs"
        status: pass
    human_judgment: false
  - id: D4
    description: "Credential rows: six kinds accepted, other kinds refused with 23514, a duplicate (tenant_id, kind) refused with 23505, a replace keeps the row id, cascade on tenant delete, no orphan"
    requirement: NATIVE-26
    verification:
      - kind: integration
        ref: "supabase/tests/224-central-tenant-apps.sql#sections 3 and 4"
        status: pass
      - kind: other
        ref: "two real concurrent psql sessions: replace race leaves one row, insert race refuses the loser with 23505, insert racing a tenant delete fails the foreign key (0 orphans)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Generated credential kinds (ios_distribution, android_keystore, reviewer_password) accepted, a kind outside the six refused"
    requirement: NATIVE-27
    verification:
      - kind: integration
        ref: "supabase/tests/224-central-tenant-apps.sql#NATIVE-27 kinds"
        status: pass
    human_judgment: false
  - id: D6
    description: "The central migration set applies from scratch with zero drift on both sets, the whole pgTAP suite (54 files, 3244 assertions) is green and no platform table reaches a tenant project"
    verification:
      - kind: integration
        ref: "pnpm db:generate; pnpm db:generate:central; pnpm db:reset && pnpm db:seed && pnpm supabase test db; bash scripts/db-two-databases.sh --reset; --assert-no-platform"
        status: pass
    human_judgment: false

duration: 16min
completed: 2026-11-05
status: complete
---

# Phase 13 Plan 05: Control-plane tables for the App tab Summary

**`platform.tenant_apps` and `platform.tenant_app_credentials` in the central migration set: non-secret app facts with both purchase switches off by default, one sealed credential per (tenant, kind) with a stable row id, RLS on with zero policies, closed to every lane but the platform's and proven by 112 pgTAP assertions.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-11-05T13:55:00Z
- **Completed:** 2026-11-05T14:12:00Z
- **Tasks:** 3
- **Files modified:** 9 (6 created, 3 modified)

## Accomplishments

- Tracer: both tables in one generated central migration, applied locally, a row written and read back by `service_role` and the same insert refused to the tenant lane (permission denied for schema platform, 42501).
- D-617 stored fail closed: `purchase_ios` and `purchase_android` are `boolean not null default false`; a row with only `tenant_id` reads `false|false`, and no migration, trigger or seed sets either to true.
- Credential-per-row layout (D-605, D-539): six kinds (the entered three, the generated three) from a CHECK built out of the contract constants; replacing a value is an update by `(tenant_id, kind)` that keeps the row id, so the sealed AAD `<rowId>:<kind>` stays valid. `columns_are` pins the table to five columns, none able to hold a secret in clear.
- Closing hardening migration revokes `public`, `anon`, `authenticated` and `api_user` and grants `service_role` only; `210-central-registry.sql` now counts thirteen platform tables with no assertion weakened.
- Block-schema gate green: zero drift on the tenant and central sets, full reset plus seed, the whole pgTAP suite (54 files, 3244 assertions), `--assert-no-platform` on `rede_tenant_b`, typecheck of core and api.

## Task Commits

1. **Task 1: [tracer] the two tables, CHECKs and RLS, one generated migration** - `4bd08ff0` (feat)
2. **Task 2 RED: pgTAP proof of shape, CHECKs, cascade and closed exposure** - `253cb19e` (test)
3. **Task 2 GREEN: hardening migration and the 210 count** - `0e643817` (feat)
4. **Task 3: [BLOCKING schema] drift, reset, full suite, assert-no-platform, typecheck** - no commit; it only verifies Tasks 1 and 2 (no file changed)

**Plan metadata:** the docs commit that carries this SUMMARY.

## Generated file names (Task 3 record)

- `supabase/central/migrations/20261105140052_platform_tenant_apps.sql` (generated by `pnpm db:generate:central --name platform_tenant_apps`, header comment added)
- `supabase/central/migrations/20261105140526_platform_tenant_apps_hardening.sql` (generated empty with `--custom`, hand-written body)
- Snapshots `meta/20261105140052_snapshot.json`, `meta/20261105140526_snapshot.json` and the journal entries idx 10 and 11.

## Files Created/Modified

- `packages/core/db/central/apps.ts` - Drizzle definitions, the two kind constants, the CHECKs and the unique index
- `packages/core/db/central/index.ts` - exports `./apps`
- `supabase/central/migrations/*_platform_tenant_apps*.sql` - the generated tables migration and the hand-written hardening
- `supabase/tests/224-central-tenant-apps.sql` - 112 pgTAP assertions
- `supabase/tests/210-central-registry.sql` - eleven becomes thirteen in the header and the three exposure counts (plan count unchanged)

## Decisions Made

See `key-decisions` above. The one with downstream effect: `team_id` is stored upper-case only, so plan 09's `setAppLinks` must upper-case the Team ID before the write (the contract's `isValidTeamId` accepts lower case).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The local Supabase stack was stopped**
- **Found during:** Task 1 (`pnpm db:central` failed with `errorCode: unexpected`)
- **Issue:** the eleven `supabase_*` containers were Exited since two days earlier, although the orchestrator brief said the stack was up.
- **Fix:** `pnpm supabase start` (it resumed the existing containers, no image pull).
- **Files modified:** none
- **Verification:** `pnpm db:central` then applied the migration.

**2. [Rule 3 - Blocking] First generate ran without `--name`**
- **Found during:** Task 1
- **Issue:** `pnpm db:generate:central` was run without the name and produced `20261105140046_lovely_bloodstorm.sql`.
- **Fix:** deleted that file, its snapshot and restored the journal before the migration was ever applied or committed, then regenerated once with `--name platform_tenant_apps`. The committed history has exactly one generated tables migration, as the plan requires.
- **Files modified:** none that remain
- **Verification:** `pnpm db:generate:central` prints "No schema changes".

**3. [Rule 2 - Missing Critical] Stricter fingerprint and id CHECKs than the truth lists**
- **Found during:** Task 1
- **Issue:** a plain element regex over `array_to_string` lets a null element, an empty element or one element carrying two comma-joined fingerprints through. The truth also asks that `bundle_id` / `application_id` match the contract shape, which needed its own CHECK.
- **Fix:** `tenant_apps_sha256_chk` also checks `array_position(..., null) is null` and that splitting the joined text gives back the same cardinality; added `tenant_apps_ids_chk`.
- **Files modified:** `packages/core/db/central/apps.ts`, the generated migration
- **Verification:** pgTAP 224 refuses each of those shapes with the constraint name.
- **Committed in:** `4bd08ff0`

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 missing critical)
**Impact on plan:** none on scope; the first two were environment and sequencing slips, the third hardens a CHECK the plan asked for.

## TDD Gate Compliance

Task 2 is the only `tdd="true"` task, and Task 1 had already created the tables. `registry_hardening` (09.2) sets default privileges for the `platform` schema (`service_role` only), so the freshly created tables were already closed: 110 of the 112 assertions passed the first time they ran, before the hardening migration existed. That is a property of the repository, not an unproven test. The one assertion that genuinely depends on the new file is the ledger check (`both ... recorded in the central ledger`), and it is the real RED:

- RED commit `253cb19e`: `pnpm supabase test db supabase/tests/000-helpers.sql supabase/tests/224-central-tenant-apps.sql` exited 1; failing test 111 `T-13-10: the tables migration and its closing hardening migration are both recorded in the central ledger`, have 1, want 2 (112 run, 111 pass, 1 fail). The evidence record was built from that real TAP output, normalised with a throwaway script kept in the scratchpad (outside the repo), and `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK`.
- An earlier run failed with "planned 114 but ran 110" (a miscounted plan, not a RED); the plan number was corrected to 112 before the RED commit.
- GREEN commit `0e643817`: the hardening migration applied, 224 and 210 pass (184 assertions across 000, 224 and 210), then the whole suite (3244).
- No REFACTOR commit.

## Issues Encountered

- **Disk fell from 6.8 GiB to 1.3 GiB free during Task 3** (the `db:reset`, the full pgTAP run and `db-two-databases.sh --reset`). The Docker VM image is sparse and 5.5 GiB of local volumes are reclaimable; a different project's `next dev` (CRM) is also running. I did not prune anything and did not run any build. This is below the 3 GiB stop line of the dispatch brief; the verification work was already finished, so only the SUMMARY and the state files remained. Igor should free space (the memory note says prune only anonymous Docker volumes) before the next plan.
- `apps/web/.next/dev` (957 MB) pre-existed (not created by this plan) and was left alone.
- The `tests.*` helpers cannot be replayed through bare `psql` (pgTAP state survives a session), so the RED TAP was captured by running `000-helpers.sql` in its own psql call and the 224 file in a second one.

## Authentication Gates

None.

## Known Stubs

None. Nothing reads or writes the new tables yet; plan 09 does, by design.

## Threat Flags

None beyond the plan's register: T-13-09 (tenant-lane read of credentials) and T-13-10 (platform table in a tenant project, secret in a plain column) are mitigated and proven by 224 (17 assertions on 42501, ledger and `columns_are`) and by `--assert-no-platform`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 06 and later plans can read and write `platform.tenant_apps` and `platform.tenant_app_credentials` through the platform lane; plan 09 owns the routes.
- Nothing was pushed, `supabase db push` was never run and no hosted project was touched. The two migrations reach production with the next central deploy (the runner applies them in order, expand-only).
- Local DB state: reset and re-seeded; the tenant set is unchanged (`git status supabase/migrations` is empty).

## Self-Check: PASSED

- Created files exist: `apps.ts`, both migrations, both snapshots, `224-central-tenant-apps.sql` (checked with `[ -f ]`).
- Commits `4bd08ff0`, `253cb19e`, `0e643817` are in `git log`; `git rev-list --count 26fe8065..HEAD` = 3.
- Acceptance criteria re-run: one `*_platform_tenant_apps.sql` containing `tenant_app_credentials`, `ENABLE ROW LEVEL SECURITY` and `tenant_app_credentials_kind_chk`; `CREATE POLICY` count 0; `purchase_ios" boolean DEFAULT false NOT NULL` count 1; `git status --porcelain supabase/migrations` empty; 224 holds 17 `42501` and 32 `23514|23505` lines; hardening has `service_role` and no grant to `authenticated`; `210` diff is counts and text only.
- Plan verification: `pnpm db:generate` and `pnpm db:generate:central` print "No schema changes"; reset + seed + full pgTAP green (54 files, 3244 tests, Result: PASS); `--assert-no-platform` ok; typecheck core and api green.

---
*Phase: 13-app-nativo-ios-e-android-por-tenant-white-label*
*Completed: 2026-11-05*
