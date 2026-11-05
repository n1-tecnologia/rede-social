---
phase: 13-app-nativo-ios-e-android-por-tenant-white-label
plan: 29
subsystem: release-tooling
tags: [native-app, release, command, store-apis, signing, sealed-credentials, dry-run, D-605, D-607, D-611, D-619, tracer, github-actions-mask]

requires:
  - phase: 13-app-nativo-ios-e-android-por-tenant-white-label
    provides: "13-03 contracts (tenantBuildSchema, deriveAppIds, deriveStoreName, deriveIconLabel); 13-05 platform.tenant_apps and tenant_app_credentials; 13-09 readAppCredential and readAppTab; 13-10 min_version/store_url columns; 13-24 icon, splash, adaptive and notification derivations"
provides:
  - "`pnpm platform:app-release` with dispatch, prepare, publish and cleanup"
  - "deriveBuildRecord / renderAssets / writeBuildRecord and the closed refusal reasons"
  - "unsealToDirectory (mask first, mode 0600, own temp directory) and cleanupDirectory"
  - "ensureAndroidKeystore / ensureIosSigning (generated on first use, sealed under <rowId>:<kind>, read back before use)"
  - "createAppleClient, createGoogleClient and createFakeStores"
  - "versions.ts: last build, minimum version and store link writers"
affects: [13-30 protected workflow, 13-31 store listing, 13-32 first real release, 13-25 app.config.ts (reads build.json)]

plan_head_before: 0e46d7e4de74860208b8149f57d02d2b16b3d6e9
actuals:
  tokens: 49000
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Closed-outcome reporter: every output line is `app-release <step> <outcome> [<reason>]` from identifiers that match a tight pattern, so no free text can reach a log"
    - "Injectable store origins plus loopback fake servers; a dry run persists nothing (generated signing material and recorded builds live in memory)"
    - "Mask lines emitted before the first file, only on a GitHub Actions runner; secrets exist on disk only as mode-0600 files in an own `app-release-*` directory"
    - "Registration steps are idempotent and race-safe: a 409 on a bundle id, a capability or a profile re-reads and reuses the winner"
    - "jose loaded through the kernel package's own resolution (createRequire), no install"

key-files:
  created:
    - scripts/app-release/index.ts
    - scripts/app-release/config.ts
    - scripts/app-release/prepare.ts
    - scripts/app-release/publish.ts
    - scripts/app-release/unseal.ts
    - scripts/app-release/mask.ts
    - scripts/app-release/cleanup.ts
    - scripts/app-release/signing.ts
    - scripts/app-release/store-apple.ts
    - scripts/app-release/store-google.ts
    - scripts/app-release/store-http.ts
    - scripts/app-release/versions.ts
    - scripts/app-release/fake-stores.ts
    - scripts/app-release/sources.ts
    - scripts/app-release/report.ts
    - scripts/app-release/jose-loader.ts
    - scripts/app-release/fixtures.ts
    - scripts/app-release/config.test.ts
    - scripts/app-release/unseal.test.ts
    - scripts/app-release/signing.test.ts
    - scripts/app-release/store.test.ts
    - apps/api/tests/integration/app-release.test.ts
  modified:
    - package.json

key-decisions:
  - "The build record is written to `--out` (default `apps/mobile/.tenant`) and the command refuses with `workspace_missing` when the parent folder does not exist; this plan never creates `apps/mobile`"
  - "A dry run never persists: generated keystore and certificate are sealed into an in-memory store, recorded builds go to a memory store, mask lines are dropped (printing them would print the secrets)"
  - "Mask lines go to standard output only when GITHUB_ACTIONS is true; anywhere else they are discarded"
  - "The gate for dispatch and prepare is: the credentials of the chosen platform held (asc_key and apns_key for iOS, play_service_account for Android) and the account step ticked (appleAccount / playAccount); the links row is NOT required, because the Play fingerprint exists only after the first upload (UI-D-624)"
  - "One build number for both stores: the highest recorded either side plus one, recorded only by publish"
  - "The Play internal-track release status defaults to `draft` (the only status Play accepts for an app that was never released); the first real run in plan 32 must confirm whether `completed` is needed for testers to receive it"
  - "No colour, name or logo fallback: a tenant with no configured colours is refused `no_brand_colors`, with no logo `no_logo`"

requirements-completed: [NATIVE-02, NATIVE-15, NATIVE-27, NATIVE-28]

coverage:
  - id: D1
    description: "A dry run derives the tenant's build record, unseals the held credentials, registers ids and signing material on local fake stores, writes a schema-valid build.json and prints only closed outcomes"
    requirement: NATIVE-28
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/app-release.test.ts#derives the build record, registers on the fakes, writes build.json and prints only closed outcomes"
        status: pass
    human_judgment: false
  - id: D2
    description: "Credentials reach the runner only as masked, mode-0600 files in an own temp directory that is always deleted; no sentinel secret reaches standard output or error"
    requirement: NATIVE-27
    verification:
      - kind: unit
        ref: "scripts/app-release/unseal.test.ts#emits the mask line for every secret BEFORE the first file is written"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/app-release.test.ts#a dry-run publish after a dry-run prepare prints only closed outcomes and no sentinel"
        status: pass
    human_judgment: false
  - id: D3
    description: "The Android keystore and the iOS distribution key and certificate are generated on first use, sealed per tenant under <rowId>:<kind>, read back before use and reused; two racing runs leave one row"
    requirement: NATIVE-27
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/app-release.test.ts#two concurrent first-use runs leave exactly one keystore row"
        status: pass
      - kind: unit
        ref: "scripts/app-release/signing.test.ts#seals first and reads the value back before it returns"
        status: pass
    human_judgment: false
  - id: D4
    description: "App Store Connect and Google Play REST clients (bundle id, capabilities, certificate, profile, app-record preflight, build poll, TestFlight group; edits, bundle upload, internal track) against loopback fakes"
    requirement: NATIVE-28
    verification:
      - kind: unit
        ref: "scripts/app-release/store.test.ts"
        status: pass
    human_judgment: true
    rationale: "The endpoint paths and payloads were written from knowledge of the Apple and Google references (no web tool was available to fetch them); only the first real run in plan 32 can prove them against the real hosts"
  - id: D5
    description: "Publish records the last build, minimum version and store links per platform only after that platform's steps succeed; the build number moves once per publish; two dry runs are byte-identical"
    requirement: NATIVE-28
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/app-release.test.ts#publish records the build only after the uploads succeed"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/app-release.test.ts#two dry runs print byte-identical logs and write a byte-identical build.json"
        status: pass
    human_judgment: false
  - id: D6
    description: "keytool and openssl subprocesses run with the real binaries"
    verification: []
    human_judgment: true
    rationale: "This machine has no JRE (the macOS keytool stub exits with 'Unable to locate a Java Runtime'), so keytool was exercised through a recording stand-in only; openssl was exercised for real (CSR). The first CI run proves keytool"

duration: 35min
completed: 2026-11-05
status: complete
---

# Phase 13 Plan 29: The per-tenant app release command Summary

**`pnpm platform:app-release` derives a tenant's app from its control-plane record, unseals its sealed store credentials into masked mode-0600 files, registers its bundle id, capabilities, certificate, profile and Play edit, generates and seals its signing material once, and publishes to TestFlight and the Play internal track, all provable on local fake stores with `--dry-run` and printing only closed outcomes.**

## Performance

- **Duration:** about 35 min (start not clock-stamped; reconstructed from the first and last test runs)
- **Completed:** 2026-11-05
- **Tasks:** 3 (one tracer, one TDD, one gate)
- **Files:** 23 (22 created, `package.json` modified)

## Accomplishments

- Tracer: a dry run for a seeded tenant derives the record (store name cut by code points, host baked, ids, colours, permission texts with `{tenant}` replaced), registers on the fakes, writes a `tenantBuildSchema`-valid `build.json` and five images, and prints closed outcomes; the integration test scans stdout and stderr for sentinel secrets (Key ID, Issuer ID, every PEM line, the service-account key id) and finds none.
- Custody: `::add-mask::` for every secret and derived string (whole and line by line, newlines escaped) is emitted before the first file is written, observed by counting files at each mask call; files are 0600 in an `app-release-*` directory that is deleted in a `finally`; `cleanup` refuses anything that is not such a directory.
- Signing: the Android keystore (`keytool`, random passwords through the environment, alias carrying the tenant id) and the iOS distribution key and certificate (CSR with `openssl`, certificate through the ASC API) are generated on first use under a tenant-and-kind advisory lock, sealed as `<rowId>:<kind>`, and read back before anything depends on them; a tenant A value does not open with tenant B's AAD (proved against the database).
- Stores: ES256 App Store Connect client (20-minute token, refreshed a minute early) and service-account Google client, both with injectable origins and an origin guard (https or loopback only); the fakes verify token shape and, when given the keys, signatures.
- Publish: waits for the processed iOS build and offers it to the internal TestFlight group, uploads the AAB to the internal track only, validates and commits, and records each platform only after its own steps; `--min-version` and the two store links are written only for platforms in the run.

## Task Commits

1. **Task 1: [tracer] a dry run on fake stores** - `a0268748` (feat)
2. **Task 2 RED: failing proofs of masked unsealing and sealed-first signing** - `ada26b86` (test)
3. **Task 2 GREEN: mask-first unsealing, sealed-first signing, race-safe registration** - `c79c6667` (feat)
4. **Task 3: publish, recording, repeatability, gates** - `0bd3d165` (feat)
5. **Follow-up: mask lines only on a GitHub runner** - `320779e0` (fix)

**Plan metadata:** the docs commit that carries this file.

## Endpoint paths used (the record the plan asks for)

Written from knowledge of the references: no web tool was available to fetch the pages, so they are unverified against the live documentation.

- App Store Connect (v1, JSON:API): `GET/POST /v1/bundleIds` (list with `filter[identifier]`, `filter[platform]`), `GET /v1/bundleIds/{id}/bundleIdCapabilities`, `POST /v1/bundleIdCapabilities` (`PUSH_NOTIFICATIONS`, `ASSOCIATED_DOMAINS`), `POST /v1/certificates` (`IOS_DISTRIBUTION`, `csrContent`), `GET/POST /v1/profiles` and `DELETE /v1/profiles/{id}` (`IOS_APP_STORE`), `GET /v1/apps?filter[bundleId]`, `GET /v1/builds?filter[app]&filter[version]` (`processingState`), `GET /v1/betaGroups?filter[app]&filter[isInternalGroup]=true`, `POST /v1/betaGroups/{id}/relationships/builds`. Token: ES256, header `kid`, claims `iss`, `aud=appstoreconnect-v1`, `iat`, `exp` (at most 20 minutes).
- Google: `POST {token origin}/token` (jwt-bearer, scope `androidpublisher`), `POST /androidpublisher/v3/applications/{package}/edits`, `DELETE .../edits/{id}`, `POST /upload/androidpublisher/v3/applications/{package}/edits/{id}/bundles?uploadType=media`, `PUT .../edits/{id}/tracks/internal`, `POST .../edits/{id}:validate` and `:commit`.

## Spike verdicts (S6, S8)

`13-SPIKE-RESULTS.md` does not exist yet (plan 13-04, the spikes, is not done). Nothing in this plan depends on fastlane: registration and upload run through the REST clients only, which is the S6-fail path, so the command is correct under either verdict. S8 (Firebase `getConfig` for `google-services.json`) is open: the build record carries `googleServicesFile: null` and no Firebase management client was written (see Known Gaps).

## Decisions Made

See `key-decisions`. The ones with downstream effect: the output directory is a flag with a safe default (plan 30 passes `apps/mobile/.tenant` once plan 02 creates it), the CI hand-off folder must be `app-release-*` directly under `$RUNNER_TEMP` (`--secrets-dir`, removed by `cleanup --secrets-dir`), and `publish` reads `build.json` back (it does not re-derive), so what is published is what was built. Rule recorded for the operator: a tenant's primary domain changing later needs a new build, because `host` is baked into `applinks:<host>` and the `autoVerify` filter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `jose` cannot be resolved from the repository root**
- **Found during:** Task 1
- **Issue:** the plan says to sign the tokens with `jose` and install nothing, but `jose` is a dependency of `@rede-social/core`, not of the root, so `scripts/` cannot import it by name.
- **Fix:** `jose-loader.ts` loads the kernel's pinned copy through `createRequire` on `packages/core/package.json`; no install, no lockfile change.
- **Files modified:** `scripts/app-release/jose-loader.ts`
- **Committed in:** `a0268748`

**2. [Rule 1 - Bug] Two racing runs failed on a 409 at the store**
- **Found during:** Task 2 (integration test of two concurrent iOS runs)
- **Issue:** `registerBundleId`, the capability POST and `ensureProfile` do lookup-then-create outside the lock, so the loser of a race got `store_conflict`.
- **Fix:** a 409 re-reads and reuses the winner's resource; the fake now answers 409 for a duplicate capability, as the real API does. Unit and integration tests cover the race.
- **Files modified:** `scripts/app-release/store-apple.ts`, `scripts/app-release/fake-stores.ts`
- **Committed in:** `c79c6667`

**3. [Rule 2 - Missing critical] Mask lines would print the secrets on a laptop**
- **Found during:** Task 3 review
- **Issue:** the real (non-dry) path wrote `::add-mask::<secret>` to standard output unconditionally; only a GitHub runner consumes it, anywhere else it prints the secret.
- **Fix:** written only when `GITHUB_ACTIONS` is true; dropped otherwise (dry runs always drop).
- **Files modified:** `scripts/app-release/index.ts`
- **Committed in:** `320779e0`

**4. [Rule 2 - Missing critical] Unguarded cleanup could delete outside its own directory**
- **Found during:** Task 2 RED (the auto-mode classifier blocked running a test that called the unguarded `cleanupDirectory` on `/`)
- **Issue:** `cleanupDirectory` was a bare recursive remove.
- **Fix:** it now refuses anything that is not an absolute, normalised path whose last segment starts with `app-release-` (and `--secrets-dir` must sit directly under the runner temp folder). The guard landed in the RED commit for safety, so the "refuses foreign directories" test passed at RED; the other nine RED tests failed on assertions.
- **Files modified:** `scripts/app-release/cleanup.ts`
- **Committed in:** `ada26b86`

**5. [Plan wording] Build workspace and database reset**
- `apps/mobile` does not exist (plans 02 and 04 pending), so the default output folder cannot be written; the command refuses with `workspace_missing` and every test passes `--out` to a temp folder. `pnpm db:reset && pnpm db:seed` was skipped: this plan adds no migration, every test removes its own rows (0 leftover `ar-%` tenants and 0 orphan credentials afterwards), following plans 09 and 10.
- The plan's gate for dispatch ("incomplete checklist") is implemented as the account ticks plus the held credentials; `links`, `privacyUrl` and `reviewer` are not gated here (see Decisions); the listing plan (31) gates the last two.
- Extra files not in the plan's list: `report.ts`, `store-http.ts`, `sources.ts`, `prepare.ts`, `publish.ts`, `jose-loader.ts`, `fixtures.ts`.

---

**Total deviations:** 4 auto-fixed (1 blocking, 1 bug, 2 missing critical), plus the wording notes above.
**Impact on plan:** none on scope; each fix protects custody or repeatability.

## TDD Gate Compliance

Task 2 is the `tdd="true"` task. RED commit `ada26b86` precedes GREEN commit `c79c6667`; no refactor commit.
- RED evidence from real Vitest output: `pnpm exec vitest run --config scripts/vitest.config.ts scripts/app-release/unseal.test.ts scripts/app-release/signing.test.ts` exited 1 with 19 tests, 10 passed and 9 failed on assertions, among them the target test `unsealToDirectory (T-13-50) emits the mask line for every secret BEFORE the first file is written (the order is observed, not assumed)` ("expected 0 to be greater than 0"). The JSON report was normalised to TAP by a throwaway script in the scratchpad (outside the repo, real names and counts) and `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK / target_test_failed`.
- The RED commit carries `mask.ts` as an inert stub so the tests fail on assertions and not on a missing module.
- GREEN: the same two files pass 19 of 19; with the other two files, 47 of 47, later 48.
- The tracer's first-pass `unseal.ts`, `cleanup.ts` and `signing.ts` (Task 1) were deliberately thin (no masks, default file mode, no traversal guard, no read-back, no `tool_missing`) so the Task 2 tests are real RED.

## Verification

- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/app-release`: 4 files, 48 tests passed.
- `pnpm --filter @rede-social/api exec vitest run tests/integration/app-release.test.ts`: 17 tests passed (dry run tracer, sentinel scan, repeatability, concurrency, AAD, publish, dispatch).
- `pnpm lint` exit 0; `pnpm boundaries` no issues in 2230 files; `pnpm guard:workflows` and both self-tests ok; `TURBO_CACHE=local:r pnpm turbo typecheck --filter=@rede-social/core --filter=@rede-social/contracts` 2 successful; `tsc --noEmit` clean in `apps/api` and over `scripts/app-release/*.ts` (ad hoc config in the scratchpad, since `scripts/` has no tsconfig).
- Acceptance greps: `exec(`/`execSync(`/`shell: true` 0; `writeFile` lines without `dir` 0; `console.log` 0; real hostnames outside the default-origin constants 0; `add-mask` in `mask.ts` 2; `git diff -U0 0e46d7e4 HEAD -- package.json` shows only the added `platform:app-release` line.
- No test contacts a non-local host (loopback fakes only). Disk: 8.2 GiB free before and after; no `.next` or turbo cache created.

## Known Gaps and Deferred Items

- **Firebase management** (`google-services.json`): COVERAGE section 2 lists the `getConfig` call as INTEGRATE for plans 29/30 with a manual-row fallback; S8 is unresolved (no spike results), so `googleServicesFile` is `null` and the file is a manual checklist row until the spike proves the call.
- **Real `keytool`**: no JRE on this machine; exercised through a recording stand-in. **Store endpoints**: unverified against live docs (see above). Both are first proven by the first real run (plan 32).
- **Play track status**: `draft` by default; testers may need `completed`.
- **TestFlight build upload** is the workflow's own step (plan 30); `publish` only polls, attaches to the internal group and records.

## Threat Flags

None beyond the plan's register (T-13-50, T-13-51, T-13-52 all mitigated and tested): no new endpoint, no new auth path; the `gh` subprocess takes an argument array only.

## Next Phase Readiness

- Plan 30 can call `pnpm platform:app-release dispatch <slug> --check-only` in its secret-free `validate` job, then `prepare <slug> --env <e> --platform <p> --secrets-dir "$RUNNER_TEMP/app-release-<run>"`, build with the files in that folder (`asc_key.json`, `play_sa.json`, `android.keystore`, `android-signing.properties`, `ios_distribution.p12`, `ios_distribution.password`, `profile.mobileprovision`), then `publish <slug> --aab <path>`, and finally `cleanup --secrets-dir <same>` in its `if: always()` step. Workflow inputs match the dispatch call: `tenant`, `env`, `platform`.
- Plan 25 (`app.config.ts`) reads `apps/mobile/.tenant/build.json` (`host`, `hosts`, ids, colours, strings) and the five images beside it.
- Requirements: only NATIVE-27 is marked complete (its other plan, 05, is done). NATIVE-02 (plan 25), NATIVE-15 (plans 25, 26) and NATIVE-28 (plan 30) stay Pending because other declaring plans have no SUMMARY.

---
*Phase: 13-app-nativo-ios-e-android-por-tenant-white-label*
*Completed: 2026-11-05*

## Self-Check: PASSED

All 22 created files exist; commits `a0268748`, `ada26b86`, `c79c6667`, `0bd3d165` and `320779e0` are in the history; nothing under `.planning/sketches/` or `apps/mobile` was touched.
