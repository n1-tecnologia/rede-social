---
phase: 13-app-nativo-ios-e-android-por-tenant-white-label
plan: 10
subsystem: api-public-reads
tags: [native-app, api, bootstrap, purchase-switch, min-version, by-host, additive, D-615, D-617, D-603, tracer]

requires:
  - phase: 13-app-nativo-ios-e-android-por-tenant-white-label
    provides: "native contracts subpath: purchaseVisible, NATIVE_PLATFORM_HEADER, hostAppSchema, appVersionAnswerSchema, deriveAppIds (plan 03)"
  - phase: 13-app-nativo-ios-e-android-por-tenant-white-label
    provides: "platform.tenant_apps with the min_version_* and store_url_* columns (plan 05)"
  - phase: 13-app-nativo-ios-e-android-por-tenant-white-label
    provides: "apps kernel module, the switch route and invalidatePurchaseSwitch (plan 09)"
provides:
  - "readPurchaseSwitches (bounded 15 s cache), readHostAppBlock / hostAppBlockOf, readAppVersion / appVersionAnswerOf and nativeRequestOf in packages/core/server/apps/read.ts"
  - "GET /v1/me/bootstrap fills purchaseVisible per store from the x-rede-app-platform header and fails closed"
  - "GET /v1/public/tenants/by-host carries the additive app block (null when the tenant has no app row)"
  - "GET /v1/public/tenants/{slug}/app-version, unauthenticated, Cache-Control public, max-age=60"
affects: [13-12, 13-18, 13-19, 13-20, 13-26, 13-29]

plan_head_before: e46db7ab8c9f216e6a6487c66ed2df89ea7b2093
actuals:
  tokens: 12200
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "read functions take their store as an optional dependency, so the same rules run over in-memory stores in unit tests and over the real tables in the integration test"
    - "the platform header is parsed by one pure function (nativeRequestOf); the bootstrap holds no inline boolean logic, the contracts' purchaseVisible decides"
    - "one data source (platform.tenant_apps) behind three reads and one TTL cache owned beside the writer that invalidates it"

key-files:
  created:
    - packages/core/server/apps/read.ts
    - packages/core/tests/apps-read.test.ts
    - apps/api/tests/integration/public-app.test.ts
  modified:
    - packages/core/server/apps/index.ts
    - packages/core/server/apps/tenant-app.ts
    - packages/core/server/tenancy/public-tenant.ts
    - packages/core/tests/apps-tab.test.ts
    - apps/api/src/routes/me.ts
    - apps/api/src/routes/public.ts
    - apps/api/tests/integration/bootstrap.test.ts
    - apps/api/tests/integration/hosts.test.ts
    - apps/api/tests/isolation-inventory.ts

key-decisions:
  - "purchaseSwitchCache (plan 09's Map) becomes a createBoundedTtlCache of 500 entries in tenant-app.ts, next to invalidatePurchaseSwitch; read.ts fills it with a 15 s TTL. The fake-clock proofs use vitest fake timers because the contracts' cache reads Date.now()."
  - "readPurchaseSwitches always returns a strict {ios, android} pair (a tenant with no row reads false/false); null is never returned. A failed read throws, is never cached, and the bootstrap catches it and answers false."
  - "The bootstrap reads the switches only when the header is exactly ios or android; any other present value is native with no platform and answers false without a read."
  - "The by-host composition lives in routes/public.ts (it calls resolveTenantHost), so public-tenant.ts gained a small getHostApp(tenantId, primaryHost) wrapper over readHostAppBlock, which the route calls."
  - "iOS appId is sent only when team id and bundle id exist and the joined string fits the strict 160-character bound; the bundle id falls back to deriveAppIds(primaryHost) when none is saved. Android needs an application id (saved or derived) and at least one fingerprint."
  - "The unknown-slug 404 for app-version is checked with slugSchema before any store read, like the by-slug public answer (adjacency T-04-07)."

patterns-established:
  - "An additive field on a strict public answer is sent as an explicit null when empty, so the web tells 'no app' from an API that predates the key."

requirements-completed: [NATIVE-07, NATIVE-24]

coverage:
  - id: D1
    description: "Tracer: with the switches at default a native iOS bootstrap answers purchaseVisible false and a browser true; turning the iOS switch on through plan 09's route flips iOS only; android stays false"
    requirement: NATIVE-24
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/public-app.test.ts#tracer: with the switches at their default: native iOS false, a browser true; then iOS on shows iOS only"
        status: pass
    human_judgment: false
  - id: D2
    description: "Fail-closed header table: '', IOS, Android, windows, ios,android each answer false even with both switches on; ios / android select; the answer is a strict boolean on the wire"
    requirement: NATIVE-24
    verification:
      - kind: unit
        ref: "packages/core/tests/apps-read.test.ts#nativeRequestOf (includes 'ios ', ' ios' and 'ios\\n')"
        status: pass
      - kind: integration
        ref: "public-app.test.ts#every header value outside ios / android ... / the answer is a strict boolean on the wire"
        status: pass
    human_judgment: false
  - id: D3
    description: "Idempotency and concurrency: two reads and a repeated switch write leave one row and one answer; concurrent bootstrap reads during a switch write return the old or new value, never an error; cache serves the old value at 14 s and the new at 16 s, the writing instance at once; the cache never exceeds 500 entries"
    requirement: NATIVE-24
    verification:
      - kind: unit
        ref: "apps-read.test.ts#readPurchaseSwitches (fake clock, bound, invalidation)"
        status: pass
      - kind: integration
        ref: "public-app.test.ts#two concurrent bootstrap reads during a switch write"
        status: pass
    human_judgment: false
  - id: D4
    description: "By-host app block: ios / android each complete or null (D-611), purchase mirrors the switches, null for a tenant with no row, no key beyond ios / android / purchase and no reviewer, privacy or credential datum; the answer parses with the strict hostTenantSchema and keeps every old field"
    requirement: NATIVE-24
    verification:
      - kind: unit
        ref: "apps-read.test.ts#readHostAppBlock"
        status: pass
      - kind: integration
        ref: "public-app.test.ts#GET /v1/public/tenants/by-host carries the additive app block; hosts.test.ts#2"
        status: pass
    human_judgment: false
  - id: D5
    description: "Minimum-version read: unauthenticated strict answer, 0.0.0 and null for a tenant with no row or a malformed stored floor, Cache-Control public, max-age=60, no cookie, 404 TENANT_NOT_FOUND for an unknown or malformed slug, a suspended tenant still answers"
    requirement: NATIVE-07
    verification:
      - kind: unit
        ref: "apps-read.test.ts#readAppVersion"
        status: pass
      - kind: integration
        ref: "public-app.test.ts#GET /v1/public/tenants/{slug}/app-version"
        status: pass
    human_judgment: false
  - id: D6
    description: "Gate: core suite, boundaries, lane guard, api unit suite, typecheck of contracts, core, api and web, web bootstrap/host tests, contracts suite and the named API integration suites"
    requirement: NATIVE-24
    verification:
      - kind: other
        ref: "core vitest 1462 pass; api unit 131 pass; contracts 451 pass; web lib/bootstrap.test.ts + lib/tenant-host.test.ts + proxy.test.ts 75 pass; pnpm boundaries; pnpm guard:lanes; tsc --noEmit in contracts, core, api, web"
        status: pass
      - kind: integration
        ref: "hosts + bootstrap + public-app + platform-apps (56 pass); two-database-routing + platform-domains + mirror-ownership + platform-lane-b + isolation (136 pass)"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-11-05
status: complete
---

# Phase 13 Plan 10: Purchase answer, by-host app block and minimum-version read Summary

**`GET /v1/me/bootstrap` now answers `purchaseVisible` per store from the `x-rede-app-platform` header through the contracts' `purchaseVisible` rule and fails closed (no row, a switch read that throws, or any header value other than exactly `ios` / `android` all give `false`; no header, a browser, gives `true`), the by-host answer carries the additive `app` block, and an unauthenticated `GET /v1/public/tenants/{slug}/app-version` serves the version floors, all from `platform.tenant_apps` behind one bounded 15-second cache.**

## Performance

- **Duration:** about 40 min
- **Started:** 2026-11-05T15:10Z (approximate)
- **Completed:** 2026-11-05T15:50Z
- **Tasks:** 3 (one tracer, one TDD, one gate)
- **Files modified:** 12 (3 created, 9 modified)

## Accomplishments

- Tracer: with no `tenant_apps` row the native bootstrap answers `false` for both stores and a browser `true`; `PUT .../app/purchase` (plan 09) turning iOS on flips only the iOS answer, which the writing instance sees at once (`invalidatePurchaseSwitch` drops the key) and other instances within 15 seconds.
- `read.ts`: `nativeRequestOf` (absent header is a browser; a present header selects a platform only when it is exactly `ios` or `android`), `readPurchaseSwitches` (strict booleans, bounded cache), `hostAppBlockOf` / `readHostAppBlock` (field-by-field from non-secret columns), `readAppVersion` / `appVersionAnswerOf` (0.0.0 and null when absent or malformed).
- By-host: `app: null` is sent explicitly for a tenant with no app; for one with data the block carries `ios.appId` (`TEAMID.bundleId`), `android.applicationId` + fingerprints and the switches, each platform complete or `null` so the matching `.well-known` file answers 404 (D-611). Nothing else, proved by key-set and substring checks (no reviewer e-mail, privacy URL or credential).
- App version: strict answer, `Cache-Control: public, max-age=60`, no cookie, 404 `TENANT_NOT_FOUND` for an unknown or malformed slug, a suspended tenant still answers.

## Task Commits

1. **Cache refactor (Task 1 prerequisite):** `55e45549` (refactor) - plan 09's Map becomes a bounded TTL cache
2. **Task 1 tracer + Task 2 tests (RED):** `f6877edd` (test)
3. **Tasks 1 and 2 (GREEN):** `7c830eb9` (feat)
4. **Task 3 gate:** `36b871d4` (test) - the route inventory entry; the rest of the gate is verification runs

**Plan metadata:** the docs commit that carries this file.

## Files Created/Modified

- `packages/core/server/apps/read.ts` - the three reads, the pure builders and the header parser
- `packages/core/server/apps/tenant-app.ts` - `purchaseSwitchCache` is a `createBoundedTtlCache`; `PURCHASE_SWITCH_CACHE_MAX`, `PURCHASE_SWITCH_TTL_MS`, `PurchaseSwitches`
- `packages/core/server/apps/index.ts` - exports the new surface plus `pgAppStore`
- `packages/core/server/tenancy/public-tenant.ts` - `getHostApp` wrapper (additive; no existing line changed)
- `apps/api/src/routes/me.ts` - `purchaseVisible: purchaseVisible({ native, platform, switches })` replaces the neutral `true` placeholder from plan 03
- `apps/api/src/routes/public.ts` - the `app` key on the by-host answer and the `app-version` route
- `packages/core/tests/apps-read.test.ts`, `apps/api/tests/integration/public-app.test.ts` - the proofs
- `apps/api/tests/integration/hosts.test.ts`, `bootstrap.test.ts`, `apps/api/tests/isolation-inventory.ts`, `packages/core/tests/apps-tab.test.ts` - existing tests/inventory updated for the additive change

## Decisions Made

See `key-decisions`. The one with downstream effect: `app` is always present on the by-host answer (explicit `null`), so the web's `hostTenantSchema` (strict, `.nullable().optional()`) must already be deployed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan 09's cache was a plain Map, not the contracts' bounded cache**
- **Found during:** Task 1
- **Issue:** plan 09 left `purchaseSwitchCache` as a `Map<string, {ios, android, at}>`; the plan asks for a `createBoundedTtlCache` so the cache cannot grow without bound.
- **Fix:** replaced it in `tenant-app.ts` with a `createBoundedTtlCache<PurchaseSwitches>(500)` and adapted the one plan-09 test that used `.clear()` / `.has()` / the old value shape (`apps-tab.test.ts`, same assertions). `invalidatePurchaseSwitch` is unchanged.
- **Files modified:** `packages/core/server/apps/tenant-app.ts`, `packages/core/tests/apps-tab.test.ts`
- **Verification:** `apps-tab.test.ts` 19 pass.
- **Committed in:** `55e45549`

**2. [Rule 3 - Blocking] The by-host answer is composed in routes/public.ts, not in public-tenant.ts**
- **Found during:** Task 1
- **Issue:** `public-tenant.ts` only builds the by-slug answer; by-host calls `resolveTenantHost` inside the route.
- **Fix:** `public-tenant.ts` gained `getHostApp` (a thin call to `readHostAppBlock`, keeping the plan's key link) and the route attaches its result. No existing line of that file changed.
- **Committed in:** `7c830eb9`

**3. [Rule 1 - Existing assertion invalidated by the additive field] hosts.test.ts pinned the exact key set**
- **Found during:** Task 1 verification
- **Issue:** `hosts.test.ts` case 2 asserts the exact keys of the by-host body; the explicit `app: null` the plan asks for adds a key.
- **Fix:** the key list now includes `app` and the case asserts it is `null` for a tenant with no app (the file is not in the plan's list).
- **Committed in:** `7c830eb9`

**4. [Plan wording] A padded header (`ios `) cannot reach the API from the wire**
- **Issue:** the Fetch/HTTP layer trims leading and trailing whitespace of a header value, so the boundary row `ios ` is never seen by the route in an integration test.
- **Fix:** the padded, leading-space and trailing-newline values are proved at unit level on `nativeRequestOf` (all native, no platform); the integration table covers `''`, `IOS`, `Android`, `windows`, `ios,android`, `ios android`, `ios;`.

**5. [Plan wording] "same rate-limit and CORS behaviour as by-host"**
- **Issue:** `/v1/public` has no rate-limit or CORS middleware (only request id, logger and the event flush in `app.ts`), so there is nothing to compare beyond observable headers.
- **Fix:** the test asserts both routes grant no `access-control-allow-origin` and treat `x-request-id` alike. If a limiter is added to the public group later, both routes inherit it from the group.

**6. [Plan wording] `readPurchaseSwitches` never returns `null`**
- The plan's signature allows `null`; the implementation returns the `false/false` pair for a tenant with no row, which `purchaseVisible` treats the same. Narrower, same behaviour.

**7. [Plan wording] `pnpm db:reset && pnpm db:seed` skipped; turbo typecheck replaced by `tsc --noEmit`**
- This plan adds no migration, so no reset was needed (rule: reset at most once, only when truly needed); typecheck ran as `tsc --noEmit` in contracts, core, api and web because `turbo typecheck --filter=web` starts a Next build the disk rules forbid.

**8. [Plan wording] Task 2 shares Task 1's RED**
- The version-read and edge tests were written with Task 1's tests and share one RED commit and one GREEN commit (the version read lives in the same file as the other two reads). The acceptance greps (`app-version` in `public.ts`, `max-age=60` in the integration test) both hold.

---

**Total deviations:** 8 (1 Rule 1, 2 Rule 3, 5 plan-wording notes)
**Impact on plan:** none on the truths. The one runtime line removed from `me.ts` is plan 03's placeholder `purchaseVisible: true`, replaced as planned.

## TDD Gate Compliance

RED `test(13-10)` (`f6877edd`) before GREEN `feat(13-10)` (`7c830eb9`). A new module cannot give a valid RED from tests alone (an import failure is `INVALID_RED`), so the RED commit carries inert `read.ts` signatures.

| Command exit | Tests | Failing | Target test (assertion failure) |
|--------------|-------|---------|---------------------------------|
| 1 | 28 | 25 | `readHostAppBlock (D-603, D-611, T-13-24) a tenant with team id, bundle id, application id and one fingerprint gets both sides` (expected null to deeply equal { ios, android, purchase }) |

The record was built from the real Vitest JSON report with the throwaway normaliser kept outside the repo; `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK`. No REFACTOR commit beyond `55e45549`, which preceded RED.

## Issues Encountered

- `pnpm supabase test db` after the integration suites: 56 files, 3401 tests, one failure, `154-moderation-log.sql` test 48 (the invariant that every moderation row's actor membership belongs to the row's tenant). The local `moderation_log` holds 2 rows whose actor membership no longer exists, left by earlier integration runs (this plan writes no moderation row; the table is append-only, so it was not cleaned). It is the known "154 trips on residue" hazard; a `db:reset` clears it. Not caused by this plan.
- `GET /v1/openapi.json` 500 (the `.catch()` in `notificationQuerySchema.limit`) is pre-existing and untouched; the new route is a plain `createRoute` over strict Zod objects and was exercised through the app, but the OpenAPI document itself was not generated here.
- Out-of-flow note: no in-flight de-duplication of concurrent cache misses; two simultaneous first reads both hit the store once, which is harmless and bounded by the 15 s TTL.

## Known Stubs

None. `pendingDeletion: null` in the bootstrap is plan 03's neutral value and belongs to another plan.

## Threat Flags

None beyond the plan's register. T-13-24 (information disclosure through the public answers) is mitigated and proved: the block is built field by field, parses with the strict schemas, and the tests assert no reviewer e-mail, privacy URL or credential appears. T-13-25 (forged header) is accepted: the header only hides purchase UI for the caller's own session.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Deploy order (hard constraint):** `hostTenantSchema` is strict. The web must be deployed BEFORE this API revision starts sending the `app` key (it is `.nullable().optional()` on the web side since plan 03, so a web at or after commit `04004d81` parses it; an older web would reject every by-host answer). The bootstrap field `purchaseVisible` is already in `bootstrapSchema` with a `.default(true)`, so it is safe in either order. Nothing was pushed or deployed.
- The web BFF (a later plan) must forward `x-rede-app-platform: ios|android` on `/v1/me/bootstrap` when the in-app user agent marker is present; without it the API treats the request as a browser and answers `true`.
- Plan 29 (`--min-version`) writes `min_version_*` / `store_url_*`; this plan only reads them. A floor change reaches installed apps within 60 seconds of the HTTP cache.
- The `.well-known` routes (D-611) can read `app.ios.appId` / `app.android` from the by-host answer.
- STATE.md stays on Phase 09.4's pointer by plan design. Disk stayed at about 7.2 GiB free throughout; nothing generated under `.next` or `.turbo`.

## Self-Check: PASSED

- Files exist: `read.ts`, `apps-read.test.ts`, `public-app.test.ts` (checked with `[ -f ]`).
- Commits found: `55e45549`, `f6877edd`, `7c830eb9`, `36b871d4`; `git rev-list --count e46db7ab..HEAD` = 4 before this SUMMARY.
