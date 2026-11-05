---
phase: 13-app-nativo-ios-e-android-por-tenant-white-label
plan: 09
subsystem: platform-api
tags: [native-app, platform-api, sealed-credentials, write-only, super-admin, D-605, D-539, D-615, D-617, tracer]

requires:
  - phase: 13-app-nativo-ios-e-android-por-tenant-white-label
    provides: "native contracts subpath: deriveAppIds, linkVerdict, appState, checklistCounts, the credential bodies (plan 03)"
  - phase: 13-app-nativo-ios-e-android-por-tenant-white-label
    provides: "platform.tenant_apps and platform.tenant_app_credentials with the stable row id and the six kinds (plan 05)"
  - phase: 09.2-database-per-tenant
    provides: "secrets/sealed.ts custody, the platform lane, requireSuperAdmin and refuseWhileMoving"
provides:
  - "packages/core/server/apps/: write-only store credential custody (validate, then seal under <rowId>:<kind>) and the App tab reads and writes"
  - "GET /v1/platform/tenants/{id}/app and PUT .../app/credentials/{kind}, ids, links, purchase, privacy, checklist/{key}"
  - "appTabSchema and the write bodies in @rede-social/contracts/native; CREDENTIAL_NOT_P8, CREDENTIAL_KEY_ID_MISMATCH, CREDENTIAL_NOT_SERVICE_ACCOUNT, IDS_LOCKED"
  - "readAppCredential (unseal) for the release worker (plan 12) and the release script (plan 29) only"
  - "invalidatePurchaseSwitch and purchaseSwitchCache for plan 10"
affects: [13-10, 13-12, 13-21, 13-22, 13-29, 13-31]

plan_head_before: ca2eb1715a5701dccd2e274af2fe9adb8a2aeca0
actuals:
  tokens: 26500
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "kernel module over two small store seams (AppStore, CredentialStore): the rules run in unit tests on in-memory stores and in the integration test on the real tables"
    - "validate-then-seal under a per-(tenant, kind) advisory lock, so the first-time concurrent saves of one pair reuse the winner's row id and the AAD stays valid"
    - "one write primitive for the tab: lazy row creation, row lock, a synchronous change(current) that may refuse, patch with updated_at, all in one platform transaction"

key-files:
  created:
    - packages/core/server/apps/index.ts
    - packages/core/server/apps/validate.ts
    - packages/core/server/apps/credentials.ts
    - packages/core/server/apps/tenant-app.ts
    - packages/core/tests/apps-credentials.test.ts
    - packages/core/tests/apps-tab.test.ts
    - packages/core/tests/fixtures/apps-memory.ts
    - apps/api/src/routes/platform/apps.ts
    - apps/api/tests/integration/platform-apps.test.ts
  modified:
    - packages/contracts/src/native.ts
    - packages/contracts/src/errors.ts
    - packages/core/server/http/api-error.ts
    - apps/api/src/routes/platform/index.ts
    - apps/api/tests/isolation-inventory.ts
    - biome.json

key-decisions:
  - "The seven routes are classified in apps/api/tests/isolation-inventory.ts (the route inventory), not in admin-lane-inventory/platform.ts: that file lists withAdminTx call sites only and a row for a file with no site fails its own test."
  - "The sealed payload is JSON {keyId, issuerId?, p8} for asc_key and apns_key, and the service-account JSON verbatim for play_service_account; readAppCredential returns that string."
  - "ids are refused whenever ids_locked_at is set, even for identical values (strict reading of 'any change'); ticking published before both ids exist sets the flag and the lock engages when setAppIds stores the pair."
  - "The App tab icon label (identity.shortName) is derived from the display name (deriveIconLabel), because no tenant short name is stored anywhere; the web manifest derives it the same way."
  - "listing.description and listing.ageRating are in the strict schema and read null until plan 13-31 supplies the builders."
  - "Derived ids are shown (idsDefault: true) but NOT written to the row; only setAppIds stores them, so the published lock needs a saved pair."

patterns-established:
  - "A secret travels only in a request body: the path carries the fixed kind and step names, so the generic access log (which records the path) can never see a value."

requirements-completed: [NATIVE-24, NATIVE-26]

coverage:
  - id: D1
    description: "Tracer: a super_admin saves an Apple push key through the real route; the read answers held with a date and no field of a secret kind; the sentinel is in no response, header, log line or plain column and only inside the sealed value"
    requirement: NATIVE-26
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/platform-apps.test.ts#tracer: an Apple push key is saved write-only and read back as held"
        status: pass
    human_judgment: false
  - id: D2
    description: "Format validation before any replace (EC P-256 .p8, Google service account) with closed codes naming no value; a bad file leaves the held value unchanged"
    requirement: NATIVE-26
    verification:
      - kind: unit
        ref: "packages/core/tests/apps-credentials.test.ts#validateP8 / validatePlayServiceAccount / replaceAppCredential"
        status: pass
      - kind: integration
        ref: "platform-apps.test.ts#a wrong file changes nothing"
        status: pass
    human_judgment: false
  - id: D3
    description: "Replacing a credential twice answers 200 both times and keeps one row with the same id; two concurrent first saves leave one row that opens (service-level re-proof of NATIVE-26)"
    requirement: NATIVE-26
    verification:
      - kind: integration
        ref: "platform-apps.test.ts#replacing the same credential twice / two concurrent first saves"
        status: pass
    human_judgment: false
  - id: D4
    description: "Ids (IDS_LOCKED on publication), links (Team ID upper-cased, fingerprint normalised, verdicts), privacy URL (https only) and the five manual steps, with the derived state and counts"
    requirement: NATIVE-24
    verification:
      - kind: unit
        ref: "packages/core/tests/apps-tab.test.ts"
        status: pass
      - kind: integration
        ref: "platform-apps.test.ts#the App tab writes through the routes"
        status: pass
    human_judgment: false
  - id: D5
    description: "Purchase switch: default off for a tenant with no row, the first write creates the row with the other switch off, one switch per call, the in-process cache is dropped, unknown tenant is 404 and a moving tenant is refused"
    requirement: NATIVE-24
    verification:
      - kind: unit
        ref: "packages/core/tests/apps-tab.test.ts#setPurchaseSwitch (D-617, NATIVE-24)"
        status: pass
      - kind: integration
        ref: "platform-apps.test.ts#the first switch write creates the row / a tenant being moved is read-only"
        status: pass
    human_judgment: false
  - id: D6
    description: "Security gate: tenant admin, member and anonymous are refused on every route; no route unseals; the sweep finds no sentinel fragment in any body, header, log line or plain column; repository gates green"
    requirement: NATIVE-26
    verification:
      - kind: integration
        ref: "platform-apps.test.ts#SECURITY GATE (sweep) and the refusals case"
        status: pass
      - kind: other
        ref: "pnpm boundaries; pnpm guard:lanes; tsc --noEmit in contracts, core, api, web; pnpm supabase test db (55 files, 3304 tests)"
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-11-05
status: complete
---

# Phase 13 Plan 09: App tab platform API and write-only store credentials Summary

**A `super_admin`-only `/v1/platform/tenants/{id}/app*` API over a new `packages/core/server/apps/` kernel module: the three store credentials are format-checked, sealed under `<rowId>:<kind>` and readable only as held plus a date, and the ids, Team ID and fingerprint, per-store purchase switches (default off), privacy URL and manual steps are written and read with the derived state, proved by a sentinel sweep across every route, header, log line and plain column.**

## Performance

- **Duration:** about 22 min
- **Started:** 2026-11-05T14:25Z (approximate)
- **Completed:** 2026-11-05T14:47Z
- **Tasks:** 3 (one tracer, one TDD, one gate)
- **Files modified:** 15 (9 created, 6 modified)

## Accomplishments

- Tracer: `PUT .../app/credentials/apns_key` validates the `.p8` (EC P-256 through `createPrivateKey`), seals `{keyId, p8}` with the AAD `<rowId>:apns_key` in one platform transaction under a per-(tenant, kind) advisory lock, answers `{ ok: true }`; `GET .../app` answers `held: true` and a date and no field of a secret kind. The sentinel (a real generated PEM, its body, both ends, the Key ID) is in no body, header, captured log line or plain column.
- `appTabSchema` (strict at every level) carries identity (derived ids shown as defaults, lock state, last builds), the three credentials as `{ kind, held, heldAt }`, links with both verdicts, purchase, listing, the ten-row checklist and the derived `appState`, all built from the contracts' pure functions.
- Writes: ids (409 `IDS_LOCKED` once published; un-ticking unlocks), links (Team ID stored upper-case, fingerprint normalised, null clears), purchase switch (one side per call, row created lazily with the other side off, `invalidatePurchaseSwitch`), privacy URL (https only, 2048), the five manual steps with `published` driving the lock.
- A tenant being moved is read-only on all seven write routes (409 `TENANT_MOVING`, the existing `refuseWhileMoving`), its read still answers; a tenant admin and a member get 403, an anonymous caller 401, an unknown tenant 404.

## Task Commits

1. **Contracts first:** schemas, bodies, `fileKeyId`, four error codes - `82a85d2c` (feat)
2. **Task 1 tracer:** RED `02e18d29` (test), GREEN `5603681b` (feat)
3. **Task 2 writes:** RED `15d0740f` (test), GREEN `6d4c9f45` (feat)
4. **Task 3 security gate:** the sweep - `1c84f226` (test)

**Plan metadata:** the docs commit that carries this file.

## Files Created/Modified

- `packages/core/server/apps/validate.ts` - `CredentialRefusal` (message is the closed code), `validateP8`, `validatePlayServiceAccount`
- `packages/core/server/apps/credentials.ts` - `CredentialStore` and its pg implementation, `replaceAppCredential`, `readAppCredential`, `heldCredentials`, `summarizeHeld`
- `packages/core/server/apps/tenant-app.ts` - `AppStore`, `buildAppTab`, `readAppTab`, the five writers, `invalidatePurchaseSwitch`, `purchaseSwitchCache`
- `packages/core/server/apps/index.ts` - the public surface the routes import
- `apps/api/src/routes/platform/apps.ts` - the seven routes; `index.ts` mounts them after the guard middleware
- `packages/contracts/src/native.ts` - `appTabSchema`, the write bodies, optional `fileKeyId`, exported `checklistAutoRows`
- `packages/core/tests/fixtures/apps-memory.ts` - in-memory stores for the unit tests
- `apps/api/tests/isolation-inventory.ts`, `biome.json` - the seven route entries and the `apps/**` import exemption

## Decisions Made

See `key-decisions`. The two with downstream effect: `readAppCredential` returns the sealed JSON string (plans 12 and 29 parse it), and the derived ids are never written by a read, so plan 29 must treat a tenant with no saved ids as using `deriveAppIds(primaryHost)`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The platform lane inventory cannot list the routes**
- **Found during:** Task 1
- **Issue:** the plan says the routes go in `apps/api/tests/admin-lane-inventory/platform.ts`, and acceptance asks for `grep -c "purchase"` there to be at least 1. That file lists `withAdminTx(` call sites only (its unit test fails on an entry with no site), and the new code uses only `withPlatformTx`. `pnpm guard:lanes` is `scripts/guard-local-settings.sh` and does not read the inventory either. The inventory that classifies routes is `apps/api/tests/isolation-inventory.ts`, whose unit test fails on an unclassified route.
- **Fix:** the seven routes are classified in `isolation-inventory.ts` (`PLATFORM_LANE` exemption); `admin-lane-inventory/platform.ts` is untouched, so that acceptance grep prints 0 by design.
- **Files modified:** `apps/api/tests/isolation-inventory.ts`
- **Verification:** `vitest run tests/unit` 131 pass; `pnpm guard:lanes` OK.
- **Committed in:** `5603681b`, `6d4c9f45`

**2. [Rule 3 - Blocking] The error message map needed the four new codes**
- **Found during:** contracts commit
- **Issue:** `ERROR_MESSAGES` is `Record<ErrorCode, string>`; the new codes would not compile without entries.
- **Fix:** four pt-BR messages in `packages/core/server/http/api-error.ts` (not in the plan's file list).
- **Verification:** `tsc --noEmit` in core and api.
- **Committed in:** `82a85d2c`

**3. [Rule 1 - Bug prevented] First-time concurrent saves would bind a sealed value to a row id that never lands**
- **Found during:** Task 1 design
- **Issue:** two simultaneous first saves of one (tenant, kind) would each invent a row id; the `ON CONFLICT` keeps the winner's id, so the loser's sealed value (AAD with its own id) would be unreadable.
- **Fix:** the write takes `pg_advisory_xact_lock(hashtext('app-credential:<tenant>:<kind>'))`, reads the id, seals and upserts in one transaction.
- **Verification:** integration case "two concurrent first saves": both 200, one row, the value opens.
- **Committed in:** `5603681b`

**4. [Rule 3 - Blocking] Unit tests need a store seam, and the typecheck needed a direct tsc**
- **Found during:** Task 1
- **Issue:** `packages/core` unit tests have no database, yet the plan's unit tests exercise replace and read-back. `turbo typecheck --filter=web` starts a Next build, which the executor rules forbid.
- **Fix:** the module reads and writes through two small store seams (in-memory fakes in `packages/core/tests/fixtures/apps-memory.ts`, real tables in the integration test); typecheck was run as `tsc --noEmit` in contracts, core, api and web.
- **Committed in:** `02e18d29`, `5603681b`

**5. [Plan wording] `pnpm db:reset && pnpm db:seed` skipped**
- **Issue:** the plan's verify lines reset the database first. This plan adds no migration, the 13-05 migrations were already applied to the local stack, and every test removes its own rows.
- **Fix:** none needed; `pnpm supabase test db` ran on the existing state (55 files, 3304 tests, PASS) before the integration suites, and the post-run count of leftover `pa-%` tenants, test projects and app rows is 0.

**6. [Plan wording] Task 3 asks for an unseal spy "zero times"; the legitimate door is exempt**
- The spy counts `open` calls: 0 across the whole sub-router sweep; the test then calls `readAppCredential` (the worker's door) once and sees exactly 1.

---

**Total deviations:** 6 (1 Rule 1 prevented, 3 Rule 3, 2 plan-wording notes)
**Impact on plan:** none on scope or the truths; item 1 changes which file carries the route classification.

## TDD Gate Compliance

Tasks 1 and 2 followed RED then GREEN with `test(13-09)` commits before the `feat(13-09)` commits. Task 3 only strengthens the integration test. No REFACTOR commit. Each RED commit carries inert stubs of the new module exports (a brand-new module cannot give a valid RED from tests alone: an import failure is `INVALID_RED`).

| Task | Command exit | Tests | Failing | Target test (assertion failure) |
|------|--------------|-------|---------|---------------------------------|
| 1 | 1 | 16 | 13 | `validateP8 ... refuses an RSA key, a P-384 key, a certificate, garbage and an empty string with CREDENTIAL_NOT_P8` (expected 'no refusal' to be 'CREDENTIAL_NOT_P8') |
| 2 | 1 | 19 | 16 | `setAppIds ... accepts valid ids and stores them` (expected 'br.com.cliente.comunidade' to be 'br.com.cliente.app') |

Evidence was built from the real Vitest JSON report with the throwaway normaliser kept outside the repo in the scratchpad (real counts and messages), and `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK / target_test_failed` for both.

## Issues Encountered

- A first run of the sweep failed on its own adversarial input: the test put a key fragment in a URL path, and the generic access log records the path. A credential never travels in a URL (the path carries only the fixed kind and step names), so the sweep now sends the sentinel in bodies only and a code comment says why. No code change.
- Pre-existing `biome check` findings in `packages/contracts/tests/text.test.ts` (template-literal infos) are out of scope and untouched.

## Known Stubs

- `listing.description` and `listing.ageRating` in the App tab answer `null` (`packages/core/server/apps/tenant-app.ts`, `buildAppTab`). Plan 13-31 (`listing.ts`) supplies them; plan 22 shows the standard text meanwhile. Recorded in `.planning/WINDOWS.md`.

## Threat Flags

None beyond the plan's register: T-13-16 (secret in a response, log, URL or column), T-13-17 (non-super-admin reaching the routes) and T-13-18 (a wrong file replacing a working credential, ids changed after publication) are mitigated and proved by the sentinel sweep, the refusal matrix and the validate-before-replace tests.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 10 can read `tenant_apps` for the by-host `app` block and the purchase switches, and import `invalidatePurchaseSwitch` / `purchaseSwitchCache` from `@rede-social/core/server/apps/index`.
- **Deploy order (from plan 03):** `hostTenantSchema` stays strict, so the web must be deployed before the API starts sending the `app` block (that happens in plan 10, not here). This plan adds only new routes and two additive error codes.
- `readAppCredential` is the one unseal door for plans 12 and 29. `team_id` is already upper-cased on write (plan 05's note).
- Plans 21 and 22 parse `appTabSchema` and call the seven routes; STATE.md stays on Phase 09.4's pointer by plan design.
- Nothing was pushed or deployed; no hosted project was touched. Disk stayed at 9.5 GiB free throughout.

## Self-Check: PASSED

- Files exist: all nine created files (checked with `[ -f ]`).
- Commits found: `82a85d2c`, `02e18d29`, `5603681b`, `15d0740f`, `6d4c9f45`, `1c84f226`; `git rev-list --count ca2eb171..HEAD` = 6 before this SUMMARY.
- Acceptance: `grep -c "packages/core/server/apps" biome.json` = 1; `CREDENTIAL_NOT_P8` in `errors.ts`; `visible: true` count in `server/apps/*.ts` = 0; `apps.ts` imports only `@rede-social/core/server/apps/index` from the module; `grep -c "app/"` in the integration test is well above 8; the `purchase` grep in `admin-lane-inventory/platform.ts` is 0 by deviation 1.
- Plan verification: core vitest 98 files / 1434 tests pass; contracts 451 pass; api unit 131 pass; `pnpm boundaries` and `pnpm guard:lanes` exit 0; `tsc --noEmit` clean in contracts, core, api and web; web `route-handlers.inventory` 4 pass; `pnpm supabase test db` 55 files / 3304 tests PASS; `platform-apps` + `platform-projects` integration 67 pass.
