---
phase: 08-moderation-tenant-admin-panel-pilot-hardening
plan: 09
subsystem: modularity
tags: [modularity, reuse, readme, drift-check, boundaries, D-347, MOD-05, hono, vitest, turbo]

requires:
  - phase: 08-moderation-tenant-admin-panel-pilot-hardening
    provides: "08-01 kernel moderation capability (recordModerationAction, listModerationLog, KERNEL_PERMISSIONS), 08-02/08-03 module comment removal through the writer, 08-04 blockMembership/unblockMembership and membership.blocked, 08-05 setMembershipRole and the /v1/admin members routes"
  - phase: 06-events
    provides: "@rede-social/module-events, whose schema references only kernel tables"
provides:
  - "@rede-social/reuse-fixture (turbo tag app): fixtureApp mounts the events module on the kernel contracts alone"
  - "Root test:integration chains the API suite and the fixture's seeded-stack case"
  - "Seven module READMEs and packages/core/server/moderation/README.md with fixed headings"
  - "apps/api/tests/unit/module-readmes.test.ts: checkReadme drift check against MODULE_REGISTRY, emits and kernel imports"
affects: [08-10, 08-11, 08-12, go-live-gate, future-module-packages, V2-module-publishing]

actuals:
  tokens: 17500
  tasks: 2
  commits: 2
plan_head_before: 7a22353ee872ced1887137fe72bacd9673f773ce

tech-stack:
  added: []
  patterns:
    - "A fixture app proves module reuse: dependency set asserted by its own unit test plus turbo boundaries on the app tag"
    - "README drift check: a pure checkReadme(manifest, readme, emittedNames, kernelSpecifiers) run over every MODULE_REGISTRY entry, both directions for events"

key-files:
  created:
    - packages/reuse-fixture/package.json
    - packages/reuse-fixture/tsconfig.json
    - packages/reuse-fixture/turbo.json
    - packages/reuse-fixture/vitest.config.ts
    - packages/reuse-fixture/vitest.integration.config.ts
    - packages/reuse-fixture/README.md
    - packages/reuse-fixture/src/app.ts
    - packages/reuse-fixture/src/session.ts
    - packages/reuse-fixture/tests/reuse.test.ts
    - packages/reuse-fixture/tests/reuse.integration.test.ts
    - packages/modules/chat/README.md
    - packages/modules/communities/README.md
    - packages/modules/events/README.md
    - packages/modules/feed/README.md
    - packages/modules/notifications/README.md
    - packages/modules/reels/README.md
    - packages/modules/stories/README.md
    - packages/core/server/moderation/README.md
    - apps/api/tests/unit/module-readmes.test.ts
  modified:
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "The fixture's session helper is a plain fetch to the local GoTrue password grant, not @supabase/supabase-js, so the asserted dependency set stays the kernel contracts plus one module"
  - "The fixture's DB config reads apps/api/.env.local (process env wins) and is NOT merged with vitestBase, because mergeConfig concatenates include arrays and would pull the no-database file into the DB run"
  - "The drift check reads every literal event name in emit()'s second argument, so ternary emits (event.cancelled / event.reactivated) are caught, and it fails both ways: an event listed but no longer emitted or consumed is drift too"
  - "The drift check also asserts the registry covers every packages/modules/* package with a module.ts, so no README can escape it"

patterns-established:
  - "Module README contract: Contracts, Events emitted, Events consumed, Flag key, Kernel dependencies, Navigation, Jobs, Reuse (kernel capability READMEs drop Flag key)"
  - "Copy-a-module recipe lives in packages/reuse-fixture/README.md and src/app.ts's header comment"

requirements-completed: [MOD-05]

coverage:
  - id: D1
    description: "The events module builds, mounts and serves on a fresh app that provides only the kernel contracts: typecheck passes, the route table equals the events routes under /v1/events entry for entry, GET /v1/events without a token answers 401 UNAUTHENTICATED with no database, and the dependency set is exactly core, contracts, module-events, hono, @hono/zod-openapi and zod"
    requirement: MOD-05
    verification:
      - kind: unit
        ref: "packages/reuse-fixture/tests/reuse.test.ts#reuse fixture (MOD-05) (3 cases)"
        status: pass
      - kind: other
        ref: "pnpm --filter @rede-social/reuse-fixture typecheck && pnpm --filter @rede-social/reuse-fixture lint && pnpm boundaries"
        status: pass
    human_judgment: false
  - id: D2
    description: "On the seeded local stack, a rede-demo member session read through the fixture app answers 200 with the seeded upcoming and past events and nothing from rede-lab"
    requirement: MOD-05
    verification:
      - kind: integration
        ref: "packages/reuse-fixture/tests/reuse.integration.test.ts#reuse fixture against the seeded stack (MOD-05)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Root test:integration runs the API suite and then the fixture's DB case, so pnpm verify and the CI db job execute it with no workflow edit"
    requirement: MOD-05
    verification:
      - kind: integration
        ref: "pnpm test:integration (API 46 files / 799 tests, then fixture 1 file / 1 test, exit 0)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Seven module READMEs and the kernel moderation README carry the fixed headings, and a unit test fails whenever a README drifts from its manifest, its emitted events or its kernel imports; its own cases prove each kind of drift is reported"
    requirement: MOD-05
    verification:
      - kind: unit
        ref: "apps/api/tests/unit/module-readmes.test.ts (14 cases) with tests/unit/registry.test.ts"
        status: pass
      - kind: other
        ref: "pnpm lint"
        status: pass
    human_judgment: false
  - id: D5
    description: "The READMEs' prose (purpose paragraphs, the Reuse recipes, the copy-a-module recipe) is accurate and usable by a developer starting another project"
    requirement: MOD-05
    verification: []
    human_judgment: true
    rationale: "The test checks the listed facts (keys, events, hrefs, jobs, specifiers, headings); whether the prose explains the module well enough to copy it is a reader's judgment"
  - id: D6
    description: "MOD-05 flagged assumption: reuse by publishing to a package registry or running in a separate repository is not exercised; the proof is in-monorepo through workspace:*"
    requirement: MOD-05
    verification: []
    human_judgment: true
    rationale: "V1 has no registry; the developer decides whether the in-monorepo proof satisfies MOD-05 for the pilot (the edge probe classified MOD-05 as unclassified)"

duration: 14min
completed: 2026-10-02
status: complete
---

# Phase 8 Plan 09: MOD-05 Reuse Fixture and Module READMEs Summary

**The events module now builds, mounts and serves on a fresh `packages/reuse-fixture` app with only the kernel contracts (401 with no database, 200 for a seeded rede-demo member). Seven module READMEs plus the kernel moderation README are kept honest by a `checkReadme` drift test that runs over every registry manifest.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-10-02T15:49:49Z
- **Completed:** 2026-10-02T16:03:49Z
- **Tasks:** 2
- **Files modified:** 21 (19 created, 2 modified)

## Accomplishments

- `@rede-social/reuse-fixture` (tag `app`) composes exactly what a host app owes the kernel: a request id, a per-request logger from the kernel root, `flushEventsAfterHandler`, the `errorEnvelope` `onError`, `setPermissionResolver` (kernel grants plus the events manifest), the manifest's bus subscriptions and job names, and `.route('/v1/events', eventsRoutes)`. No other module is imported.
- No-database proofs: the fixture's non-`ALL` route table equals the events router's under `/v1/events`, entry for entry. `GET /v1/events` without a token answers 401 `UNAUTHENTICATED` with a request id. The dependency set is asserted, and the test fails on any other `@rede-social/module-*`, `@rede-social/api` or `@rede-social/web`.
- Seeded-stack proof: `member@rede-demo.local` (local password grant) lists seeded events e01, e02, e05 and e07 under upcoming and e04 and e06 under past, and no `rede-lab` id appears.
- The root `test:integration` now runs `api` and then `reuse-fixture`. The full chain ran green locally: API 46 files / 799 tests, then fixture 1/1.
- D-347 READMEs for chat, communities, events, feed, notifications, reels and stories, plus `packages/core/server/moderation/README.md`. The kernel README covers the writer contract (inside your own `tx`, never from a subscriber), the reader, member admin, the three permissions, the `/v1/admin` routes table, `membership.blocked` and the append-only guarantees.
- `module-readmes.test.ts` checks each README against its manifest: flag key, `requires`, consumed events, sources and retractions, nav href, jobs and sweep functions. It also checks the module's emitted events in both directions, ternary emits included, and its `@rede-social/core/...` imports. A hand-made drift (dropping `event.cancelled` from the events README) failed the test as intended and was then restored.

## Task Commits

1. **Task 1 (tracer): reuse fixture, no-DB and seeded-session proofs, test:integration chain**: `08ed122` (feat)
2. **Task 2: eight READMEs and the drift-check unit test**: `dbfa17e` (docs)

**Plan metadata:** recorded in the SUMMARY commit that follows (docs)

## Files Created/Modified

- `packages/reuse-fixture/src/app.ts`: `fixtureApp`, the MOD-05 worked example, with a header comment listing what the kernel provides and what the host provides
- `packages/reuse-fixture/src/session.ts`: `passwordSession(email)` via fetch to the local GoTrue password grant
- `packages/reuse-fixture/tests/reuse.test.ts`: route set, 401, dependency set (placeholder env, no DB)
- `packages/reuse-fixture/tests/reuse.integration.test.ts`: seeded rede-demo member reads the seeded events
- `packages/reuse-fixture/{package.json,tsconfig.json,turbo.json,vitest.config.ts,vitest.integration.config.ts,README.md}`: package, `app` tag, the two configs, the copy-a-module recipe
- `package.json`: `test:integration` chains the fixture's DB case
- `pnpm-lock.yaml`: one new importer block (`packages/reuse-fixture`), no new external package
- `packages/modules/{chat,communities,events,feed,notifications,reels,stories}/README.md`: the module interface documents
- `packages/core/server/moderation/README.md`: the kernel moderation capability's interface
- `apps/api/tests/unit/module-readmes.test.ts`: `checkReadme`, the scanners and their own cases

## Decisions Made

- The session helper uses a plain `fetch` (no `@supabase/supabase-js`), so the fixture's dependency set stays the six packages the plan names.
- The fixture's DB config does not merge `vitestBase`, because `mergeConfig` concatenates `include` (see Deviation 1).
- The drift check catches ternary emits and fails both ways (listed but gone is drift). It also requires the registry to cover every module package.
- Moderation's README lives in the kernel (`packages/core/server/moderation/README.md`) with no `## Flag key` heading; its opening paragraph states that the capability is always on (08-01's recorded shape).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The fixture's DB run also ran the no-database file**
- **Found during:** Task 1
- **Issue:** `mergeConfig(vitestBase, …)` concatenates `include` arrays, so the integration config's run picked up `tests/reuse.test.ts` through the base's `tests/**/*.test.ts` (it reported 2 files).
- **Fix:** `vitest.integration.config.ts` uses `defineConfig` alone with `environment: 'node'`, with a comment explaining why.
- **Files modified:** `packages/reuse-fixture/vitest.integration.config.ts`
- **Verification:** the DB run now reports 1 file / 1 test, and the unit run 1 file / 3 tests.
- **Committed in:** `08ed122`

**2. [Rule 2 - Missing critical] The emit scanner would have missed the events module's ternary emit**
- **Found during:** Task 2
- **Issue:** The plan's literal pattern `emit(ctx, '<name>'` cannot see `emit(ctx, cancel ? 'event.cancelled' : 'event.reactivated', …)` in `events/server/service.ts`. A README could drop either event and the check would still pass.
- **Fix:** `emittedNamesIn` reads every quoted `noun.verb` name in `emit()`'s second argument. The checker also reports names that are listed but no longer emitted or consumed, a missing `requires`, missing sweep functions, heading order, and a missing `packages/reuse-fixture` pointer. A completeness case asserts that the registry covers every `packages/modules/*` package.
- **Files modified:** `apps/api/tests/unit/module-readmes.test.ts`
- **Verification:** the checker's own cases 1-5 pass. Removing `event.cancelled` from the events README made the real test fail with `events emitted: "event.cancelled" is not listed`, and restoring it made the test pass again.
- **Committed in:** `dbfa17e`

**3. [Minor] The fixture's tsconfig extends the base without DOM/React**
- The plan said "mirroring a module's". The fixture compiles only the module's server surface, which typechecks under the base `ES2023` lib, so the narrower config is the stricter proof. A `./app` export was added for any future consumer.

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical) plus 1 minor config narrowing.
**Impact on plan:** Both auto-fixes make the proofs stricter. No scope creep and no new external dependency.

## Issues Encountered

- Biome reformatted one long `throw new Error(...)` in `session.ts` and the new test file; this was fixed before each commit.
- Repo rules recorded: the local `pnpm db:reset && pnpm db:seed` ran under the developer's 2026-10-02 consent for all Phase 8 plans (backup at `~/rede-social-local-backups/pre-08-reset.sql`), on the local stack only. No deploy, push or hosted command ran. Turbo ran with `TURBO_CACHE=local:r`; free disk stayed around 15 GiB. No commits from the concurrent quick task `261002-f4y` landed in this plan's range (`7a22353..dbfa17e`). The commits carry no Claude trailer.
- Process hygiene: the integration chain's 8787 listener exited with the run, and no tsx watch, next or vitest process was left behind.

## Known Stubs

None.

## Threat Flags

None. The fixture is a test-only app that is never deployed. Its password grant runs against the local stack with the same env the API integration suite reads (T-08-49 accepted). T-08-47 is mitigated: the 401 case proves the module's own guard chain travels with its router. T-08-48 is mitigated by the dependency-set case plus `turbo boundaries` (no issues across 14 packages). T-08-SC is mitigated: the lockfile diff is a single importer block that links workspace packages and already-pinned `hono` 4.13.7, `@hono/zod-openapi` 1.6.3, `zod` 4.6.2, `typescript` 7.0.2, `vitest` 5.0.0 and `@types/node` 24.13.4.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- MOD-05's automated half is in place, and ROADMAP SC 4 ("one module reusable") is now a CI check through `pnpm turbo test` and `pnpm test:integration`. The CI `db` job picks it up with no workflow edit; it has not run on CI yet because nothing was pushed.
- Two items wait on the developer at verify-work (coverage D5, D6): whether the README prose works as a copy recipe, and whether the in-monorepo proof (no registry publish) satisfies MOD-05 for the pilot.
- A future module must add a README that passes `module-readmes.test.ts`, because the completeness case fails for any `packages/modules/*` package that is missing from the registry or its README.

---
*Phase: 08-moderation-tenant-admin-panel-pilot-hardening*
*Completed: 2026-10-02*
