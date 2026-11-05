---
phase: 13-app-nativo-ios-e-android-por-tenant-white-label
plan: 03
subsystem: contracts
tags: [native-app, contracts, bridge, additive, ids, zod, D-600, D-603, D-607, D-615, D-617, tracer]

requires:
  - phase: 01-foundation
    provides: "hostTenantSchema, normalizeHost/isRegistrableHost, bootstrapSchema additive rule"
provides:
  - "@rede-social/contracts/native and /hosts subpaths (native kept out of the barrel)"
  - "bridge vocabulary: strict versioned web-to-native messages and native-to-web events, feed snapshot, token patterns, safe parseBridgeMessage"
  - "deriveAppIds, id validators, deriveStoreName/deriveIconLabel, appState/checklistCounts, linkVerdict/normalizeFingerprint/isValidTeamId, compareVersions/isBelowMinVersion, purchaseVisible"
  - "tenantBuildSchema, appVersionAnswerSchema, write-only credential bodies and held-only answers, REMOVED_MEMBER_NAME"
  - "additive hostTenantSchema.app, bootstrapSchema.purchaseVisible and pendingDeletion"
affects: [13-04, 13-05, 13-06, 13-07, 13-08, 13-09, 13-10, 13-18, 13-21, 13-22, 13-23, 13-29]

plan_head_before: a2186f0910faf29730721bf5597deef9253f286d
actuals:
  tokens: 16350
  tasks: 3
  commits: 7

tech-stack:
  added: []
  patterns:
    - "client-safe contract SUBPATH, never re-exported from the barrel"
    - "additive fields on existing answers: .optional()/.default(), strictness only where it already was"
    - "one `member()` helper stamps v:1 + literal type + .strict() on every bridge message"

key-files:
  created:
    - packages/contracts/src/native.ts
    - packages/contracts/tests/native-additive.test.ts
    - packages/contracts/tests/native-bridge.test.ts
    - packages/contracts/tests/native.test.ts
  modified:
    - packages/contracts/package.json
    - packages/contracts/src/hosts.ts
    - packages/contracts/src/bootstrap.ts
    - apps/api/src/routes/me.ts

key-decisions:
  - "hostAppSchema is defined in hosts.ts and re-exported by native.ts (the plan's own cycle fallback): native imports hosts, never the reverse, so no TDZ at module load."
  - "deriveAppIds returns an iOS id that keeps hyphens and an Android id that uses underscores; they are the same string for any host without a hyphen. Apple bundle ids allow no underscore."
  - "parseBridgeMessage reads `type` first: unknown type -> unknown_type (dropped quietly), known type with a bad body -> bad_shape; a leading BOM -> bad_json."
  - "The device in push.state/push.result is a discriminated union on `kind`, so the token must match its own kind's pattern."

patterns-established:
  - "Pure functions only in native.ts: no module state, no logging, no console."

requirements-completed: [NATIVE-02, NATIVE-05, NATIVE-32]

coverage:
  - id: D1
    description: "Tracer: by-host answer with and without the app block, bootstrap without the new fields, and one id derivation, all via the new native subpath"
    requirement: NATIVE-32
    verification:
      - kind: unit
        ref: "packages/contracts/tests/native-additive.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Versioned strict bridge vocabulary for both directions, bounded feed snapshot, token shapes and a parser that never throws"
    requirement: NATIVE-05
    verification:
      - kind: unit
        ref: "packages/contracts/tests/native-bridge.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Id derivation, store-name and icon-label cuts, app state, link verdicts, version floor, build record and write-only credential bodies"
    requirement: NATIVE-02
    verification:
      - kind: unit
        ref: "packages/contracts/tests/native.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Consumers of the changed schemas still compile (api, web)"
    requirement: NATIVE-32
    verification:
      - kind: other
        ref: "pnpm --filter @rede-social/api exec tsc --noEmit; pnpm --filter @rede-social/web exec tsc --noEmit"
        status: pass
    human_judgment: false

duration: 13min
completed: 2026-11-05
status: complete
---

# Phase 13 Plan 03: Native contracts subpath Summary

**One client-safe `@rede-social/contracts/native` subpath holding the strict versioned bridge, feed snapshot, host-to-store-id derivation, store listing cuts, app state and credential bodies, plus additive `app`, `purchaseVisible` and `pendingDeletion` fields that old and new clients both parse.**

## Performance

- **Duration:** about 13 min
- **Started:** 2026-11-05T13:42Z (approximate)
- **Completed:** 2026-11-05T13:56Z
- **Tasks:** 3 (one tracer, two TDD)
- **Files modified:** 8 (4 created, 4 modified)

## Accomplishments

- The tracer proves the rolling-deploy contract first: `hostTenantSchema` parses an answer with the `app` block, with `app: null`, and without it (reads `undefined`), and still rejects any other unknown key; `bootstrapSchema` reads a bootstrap without the new fields as `purchaseVisible: true` and `pendingDeletion: null`.
- The bridge is one vocabulary: 12 web-to-native messages and 5 native-to-web events, every member `.strict()` with `v: 1`, size-capped in UTF-8 bytes before `JSON.parse`, and a parser that answers `not_string`, `too_large`, `bad_json`, `unknown_type` or `bad_shape` and never throws or echoes input (T-13-05).
- `deriveAppIds`, `deriveStoreName` (30), `deriveIconLabel` (12), `appState` with the four pills, `linkVerdict`, `normalizeFingerprint`, version floor functions, `tenantBuildSchema` and the three write-only credential bodies exist as pure tested functions that plans 04 to 29 import.
- 451 contracts tests pass (the 368 existing plus 83 new); `tsc --noEmit` passes in contracts, api and web.

## Task Commits

1. **Task 1: [tracer] subpath, additive app block and bootstrap fields, one derivation** - RED `cb7d9538` (test), GREEN `04004d81` (feat)
2. **Task 2: bridge vocabulary, snapshot, token shapes, safe parser** - RED `0fffe8b3` (test), GREEN `7b039dd8` (feat)
3. **Task 3: state functions, store-name cuts, build record, version rule, credential bodies** - RED `7ddc9924` (test), GREEN `a1178d4e` (feat)
4. **Deviation fix: neutral bootstrap values from the API route** - `86108be7` (fix)

**Plan metadata:** the docs commit that carries this file.

## TDD Gate Compliance

All three tasks followed RED then GREEN with `test(13-03)` commits before their `feat(13-03)` commits. No REFACTOR commit was needed. Each RED commit carries an inert, self-documented stub of the new exports (a brand-new module cannot give a valid RED from tests alone, because an import failure is `INVALID_RED`); each GREEN replaces the stub.

RED evidence, from real Vitest runs (JSON reporter, then a throwaway normaliser kept outside the repo in the scratchpad to give `check tdd-red-evidence` the TAP shape it reads; counts are the real ones), each returning `RED_EVIDENCE_OK / target_test_failed`:

| Task | Command exit | Tests | Failing | Target test (assertion failure) |
|------|--------------|-------|---------|---------------------------------|
| 1 | 1 | 20 | 14 | `deriveAppIds - the tracer derivation reverses the labels of the primary host` (expected null to deeply equal an id pair) |
| 2 | 1 | 49 | 33 | `parseBridgeMessage returns the message for a valid JSON string` |
| 3 | 1 | 34 | 26 | `deriveStoreName and deriveIconLabel (D-607) cuts at 30 and reports it` |

Two earlier attempts at the Task 1 RED were `INVALID_RED` (module not found; then a `describe` body that crashed on `bootstrapSchema.omit` of a key that did not exist yet) and were fixed before any commit, by adding the stub and moving the fixture into the test bodies.

## Files Created/Modified

- `packages/contracts/src/native.ts` - the subpath: marker, bridge, snapshot, token patterns, id derivation, store cuts, state functions, build record, credential bodies.
- `packages/contracts/src/hosts.ts` - `hostAppSchema` and the additive `app: hostAppSchema.nullable().optional()` inside the still-strict `hostTenantSchema` (added lines only).
- `packages/contracts/src/bootstrap.ts` - `purchaseVisible` and `pendingDeletion` with defaults (added lines only).
- `packages/contracts/package.json` - `./native` and `./hosts` exports.
- `packages/contracts/tests/native-additive.test.ts`, `native-bridge.test.ts`, `native.test.ts` - 83 tests.
- `apps/api/src/routes/me.ts` - sends the neutral defaults so the route still compiles (deviation below).

## Decisions Made

- `hostAppSchema` lives in `hosts.ts` and `native.ts` re-exports it (the cycle fallback the plan named). With the schema in `native.ts`, loading `native` first would hit a temporal-dead-zone error in `hosts.ts`.
- iOS and Android ids are equal only for hosts without a hyphen (see deviation 1).
- `snapshot.feed` reuses `feedSnapshotSchema.shape` through the shared `member()` helper, so the snapshot is strict at both levels.
- `storeUrl` in `appVersionAnswerSchema` and every URL in `tenantBuildSchema` are https-only, because the shell opens them.
- `compareVersions` returns `NaN` for a malformed side, so `isBelowMinVersion` is false and a malformed floor never blocks a member (UI-D-613).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The shared "Android form" id is not a valid iOS bundle id**
- **Found during:** Task 3 (the plan's own table `my-community.example.com.br -> br.com.example.my_community` plus the truth "every output passes both validators")
- **Issue:** the plan derives one string with `_` for both stores, yet its `isValidBundleId` (and Apple) allow hyphens and no underscore, so `deriveAppIds` returned `null` for any hyphenated host and the 200-host property failed (125 derived, expected over 150).
- **Fix:** the iOS id keeps hyphens (`br.com.example.my-community`, `com.xn--exmplo-gva`), the Android id uses `_` (`br.com.example.my_community`, `com.xn__exmplo_gva`); both get the `x` prefix on a digit-leading label. The two are the same string for a host with no hyphen. Test table updated.
- **Files modified:** `packages/contracts/src/native.ts`, `packages/contracts/tests/native.test.ts`
- **Commit:** `a1178d4e`
- **Impact for later plans:** plan 21 and the release script (29) must treat the iOS and Android ids as two values, which they already do (`bundleId`, `applicationId`).

**2. [Rule 3 - Blocking] API bootstrap route no longer type-checked**
- **Found during:** Task 3 verification (`typecheck --filter=@rede-social/api`)
- **Issue:** `const body: Bootstrap` in `apps/api/src/routes/me.ts` is the schema's output type, where the two `.default()` fields are required, so `TS2739` blocked the API typecheck. This is the consumer breakage the acceptance criterion exists to catch.
- **Fix:** the route sends the neutral values (`purchaseVisible: true`, `pendingDeletion: null`) with a comment that the store switch and deletion window are computed by their own plans.
- **Files modified:** `apps/api/src/routes/me.ts` (not in the plan's `files_modified`)
- **Commit:** `86108be7`
- **Verification:** `tsc --noEmit` clean in api and web; 131 API unit tests pass. API integration tests were not run (they need the local stack and a reset, which this plan must not touch); they parse the bootstrap through `bootstrapSchema`, which accepts the added keys.

**3. [Acceptance metric, not behaviour] `grep -c "\.strict()"` reads 18, not 20**
- **Found during:** Task 2 and Task 3 acceptance gate
- **Issue:** all 17 bridge messages are stamped strict by ONE `member()` helper, so the literal count undercounts. Every schema object in the file is strict; the tests prove it for the bridge (an extra key is refused on all 12 web messages and on the events), for the snapshot, the build record and each credential body.
- **Fix:** none; padding `.strict()` calls to reach 20 would add noise. Recorded as a deliberate deviation from the grep metric only.

**4. [Plan wording] "all four combinations succeed" for the by-host answer**
- **Found during:** Task 1 tests
- **Issue:** `hostTenantSchema` stays `.strict()` (a plan truth), so an OLD web, which does not know `app`, rejects a NEW API answer that carries it. The matrix therefore proves old and new answers against the new schemas, and for the (non-strict) bootstrap also against the pre-plan shape.
- **Consequence:** the web must deploy before the API starts sending `app` in the by-host answer. The schema comment says so; plan 09 (which first sends it) should keep that order.

**Total deviations:** 4 (1 Rule 1 bug, 1 Rule 3 blocker, 2 plan-wording/metric notes).

## Issues Encountered

- `turbo typecheck --filter=@rede-social/web` depends on `build` and started `next build`, which the executor rules forbid for disk reasons; it was aborted at once (exit 130) and the web check was run as plain `tsc --noEmit` instead. The only artefact it left, an empty `apps/web/.next/cache`, was removed. No `.turbo/cache` was created (`TURBO_CACHE=local:r`).
- Disk had 6.1 to 6.2 GiB free throughout; nothing added there.

## Known Stubs

None. The temporary RED stubs were fully replaced in each GREEN commit.

## Threat Flags

None. No new endpoint, auth path or schema at a trust boundary was added; the plan's T-13-05 (bridge tampering) and T-13-06 (contract change failing installed clients) are both mitigated and tested.

## Next Phase Readiness

Plans 04 onward can import `@rede-social/contracts/native` and `/hosts`. Plan 09 must keep the deploy order web-before-API for the by-host `app` block. STATE.md stays on Phase 09.4 per the plan.

## Self-Check: PASSED

- Files found: `packages/contracts/src/native.ts`, the three test files, `packages/contracts/package.json` exports `./native` and `./hosts`.
- Commits found: `cb7d9538`, `04004d81`, `0fffe8b3`, `7b039dd8`, `7ddc9924`, `a1178d4e`, `86108be7`.
- Acceptance criteria re-run: barrel does not mention native (0 lines), no module-notifications import (0), no `console.` (0), hosts/bootstrap diff has no deleted lines, exports present; `.strict()` count noted in deviation 3.
- Plan verification: `vitest run` 18 files / 451 tests pass, `tsc --noEmit` clean in contracts, api and web; nothing under `.planning/sketches/` staged.
