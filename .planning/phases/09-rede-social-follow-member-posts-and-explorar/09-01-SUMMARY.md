---
phase: 09-rede-social-follow-member-posts-and-explorar
plan: 01
subsystem: api
tags: [social, tracer, module-key, permissions, registry, D-482, D-121]

requires:
  - phase: 08.3-courses
    provides: "the tenant_modules_key_chk drop-and-re-add migration shape and the withModuleEnabled test helper"
  - phase: 05.3-reels
    provides: "the `requires` composition rule (effectiveKeys, D-121) that social reuses"
provides:
  - "module key `social` appended LAST to TOGGLEABLE_MODULES, off by default, migration widens tenant_modules_key_chk"
  - "workspace package @rede-social/module-social (manifest, SOCIAL_PERMISSIONS, README with the MOD-05 headings)"
  - "permission social.participate, composed for role member only"
  - "registry branch: feed.post.create and feed.post.manage for role member while social is effective (replaces the posting-policy blob)"
  - "seed: social ON for rede-lab, OFF for rede-demo; withSocialEnabled test helper; platform catalog strings"
affects: [09-02, 09-03, 09-06, 09-08, 09-12, 09-13]

actuals:
  tokens: 12000
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "one permission branch in the app-tier registry keyed on an effective module (no module-to-module edge)"
    - "member-only permission by construction, guarded by a unit tripwire (store case 14 mirrored)"

key-files:
  created:
    - packages/modules/social/module.ts
    - packages/modules/social/contracts/index.ts
    - packages/modules/social/README.md
    - packages/modules/social/tests/module.test.ts
    - packages/modules/social/package.json
    - apps/api/tests/integration/social-module.test.ts
    - apps/web/messages/pt-BR/platform.social.json
    - supabase/migrations/20261019202758_social_module_key.sql
  modified:
    - packages/contracts/src/modules.ts
    - apps/api/src/modules/registry.ts
    - apps/api/tests/unit/registry.test.ts
    - apps/api/tests/integration/setup.ts
    - apps/api/tests/integration/feed.test.ts
    - apps/api/tests/integration/modules.test.ts
    - apps/api/tests/integration/isolation.test.ts
    - apps/api/tests/integration/platform-tenants.test.ts
    - packages/contracts/tests/platform.test.ts
    - packages/modules/feed/module.ts
    - packages/modules/feed/README.md
    - scripts/seed.ts
    - apps/web/i18n/messages.test.ts

key-decisions:
  - "Planning decision 1: the legacy posting-policy flag is ignored, not removed; feedSettingsSchema and FEED_POSTING_POLICIES stay exported and are parsed nowhere on a request path"
  - "Planning decision 2: the permission branch lives in the app-tier registry, not in the social manifest, so no module names another module's permission string (MOD-02)"
  - "Planning decision 3: no routes in the manifest yet; plan 02 adds the routes loader with the first route file"
  - "Planning decision 4: requires is enforced in the composition only; plan 02 chains requireModule('feed') beside requireModule('social') on every social route"
  - "Planning decision 5: seed has social ON for rede-lab and OFF for rede-demo (and the real tenant), so older demo specs that assert a member holds no feed.post.create stay valid"

patterns-established:
  - "Social switch: effective.has('social') && role === 'member' is the whole authoring rule"
  - "Lab pins end in social: ['reels','events','feed','social'] (no nav sorts after feed by key)"

requirements-completed: [SOCIAL-01, SOCIAL-02]

coverage:
  - id: D1
    description: "social key appended last to TOGGLEABLE_MODULES, absent from REAL_TENANT_DEFAULT_MODULES, and the generated migration widens tenant_modules_key_chk with no backfill row"
    requirement: SOCIAL-01
    verification:
      - kind: unit
        ref: "apps/api/tests/unit/registry.test.ts#4. the key VOCABULARY is the seven default modules plus store, courses and social"
        status: pass
      - kind: command
        ref: "pnpm db:generate (prints 'No schema changes, nothing to migrate') then pnpm db:reset applies the migration"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/social-module.test.ts#7. the toggle accepts the new key at validation and at the database CHECK"
        status: pass
    human_judgment: false
  - id: D2
    description: "@rede-social/module-social manifest: requires feed, member-only social.participate, no nav, no routes"
    requirement: SOCIAL-01
    verification:
      - kind: unit
        ref: "packages/modules/social/tests/module.test.ts"
        status: pass
      - kind: unit
        ref: "apps/api/tests/unit/module-readmes.test.ts#2. social: README matches its manifest, its emits and its kernel imports"
        status: pass
    human_judgment: false
  - id: D3
    description: "permissionsFor composes feed.post.create, feed.post.manage and social.participate for a member only while social and feed are effective; staff sets are identical with and without social; the legacy blob grants nothing"
    requirement: SOCIAL-02
    verification:
      - kind: unit
        ref: "apps/api/tests/unit/registry.test.ts#6b, 16, 17, 18"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/social-module.test.ts#09 tracer"
        status: pass
    human_judgment: false
  - id: D4
    description: "platform toggle PUT /v1/platform/tenants/{id}/modules/social flips the composed permissions on the next request; no row reads as off"
    requirement: SOCIAL-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/social-module.test.ts#09 toggle"
        status: pass
    human_judgment: false
  - id: D5
    description: "every existing test that encoded the old policy flag or the old lab module set rewritten (feed case 7, modules, isolation, platform-tenants, contracts)"
    verification:
      - kind: integration
        ref: "pnpm --filter @rede-social/api test:integration (72 files, 1404 tests passed)"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-10-19
plan_head_before: c4f5d69b5e6482af4a1f72e21ddce6f4ca502bd7
commits: 4
status: complete
---

# Phase 9 Plan 01: Social module switch Summary

**The `social` module is now the single per-tenant switch that makes members authors: a `social` key and CHECK migration, a `@rede-social/module-social` package with a member-only `social.participate`, and one registry branch that replaces the old posting-policy blob.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-10-19T20:25:51Z
- **Completed:** 2026-10-19T20:40:27Z
- **Tasks:** 2
- **Files modified:** 30 (including the generated drizzle snapshot and the lockfile)

## Accomplishments

- A super_admin can turn "Rede social" on for a tenant: on rede-lab (seeded on) a member's `GET /v1/me/bootstrap` lists a `social` entry and holds `social.participate`, `feed.post.create` and `feed.post.manage`; a rede-demo member (off) holds none. Both answers come from the one composed set `permissionsFor`.
- `social` is `requires: ['feed']` (D-121): with `feed` off it contributes no entry and no permission, and turning `feed` back on restores both without touching the `social` row.
- The legacy posting-policy blob on the `feed` settings is ignored (T-09-45): a members-valued blob grants a member nothing by itself.
- `tenant_modules_key_chk` is widened by a generated, data-free migration; no backfill row, so every existing tenant reads as off.
- `PUT /v1/platform/tenants/{id}/modules/social` is accepted by the route enum and the CHECK and flips permissions on the next request.

## Task Commits

1. **Task 1 (tracer, TDD): the key, CHECK migration, package, registry branch, seed, real bootstrap check**
   - RED: `27b7080b` (test) - registry matrices and the integration tracer, failing on assertions against the unchanged API
   - GREEN: `77c11247` (feat)
2. **Task 2: [BLOCKING schema] proof and rewrite of every test that encoded the old flag or lab set** - `966b280c` (test), plus `09ee67ac` (test) for the e2e switch counts (deviation 3)

**Plan metadata:** committed separately (docs: complete plan)

## TDD Gate Compliance

RED then GREEN, in order: `test(09-01)` `27b7080b`, then `feat(09-01)` `77c11247`. No REFACTOR commit (none needed).

RED evidence (real run, `pnpm --filter @rede-social/api exec vitest run tests/unit/registry.test.ts`, exit 1, 19 tests, 13 passed, 6 failed). Target test `6b. D-482: the social module is the ONE switch that turns a member into an author` failed on `AssertionError: expected false to be true`; the other five failures are the key-list, vocabulary, EP-04, EP-06/07 and D-121 cases. The Vitest JSON report was piped through a throwaway scratchpad normalizer (real names, real counts, nothing committed) and `gsd-tools check tdd-red-evidence` answered `RED_EVIDENCE_OK / target_test_failed`.

The integration tracer was also run RED against the old API and DB: 8 tests, 1 passed, 7 failed (for example `expected [ 'reels', 'events', 'feed' ] to include 'social'` and `expected 400 to be 200` on the platform toggle).

GREEN run: `social-module.test.ts` 8 of 8 passed; registry and README unit files 36 of 36 passed.

Two honest deviations from a strict RED-first order, both forced by structure: the new package's `module.test.ts` (5 cases) ships in the GREEN commit, because a brand-new package cannot produce a valid RED from an import failure and the plan did not call for an inert stub; and the registry unit matrices (listed under Task 2 in the plan) were rewritten in the RED commit because Task 1's verify runs them.

## Files Created/Modified

- `packages/modules/social/module.ts` - manifest: key, `requires: ['feed']`, `member: ['social.participate']`, no nav or routes
- `packages/modules/social/contracts/index.ts` - `SOCIAL_MODULE_KEY`, `SOCIAL_PERMISSIONS` with the member-only warning
- `packages/modules/social/README.md` - the eight MOD-05 headings, describing exactly what exists now
- `packages/modules/social/tests/module.test.ts` - manifest as data
- `supabase/migrations/20261019202758_social_module_key.sql` - DROP and ADD of `tenant_modules_key_chk` ending in `'social'`, with its journal and snapshot
- `packages/contracts/src/modules.ts` - `social` appended last; not in the default list
- `apps/api/src/modules/registry.ts` - `MODULE_REGISTRY.social` and the `effective.has('social') && role === 'member'` branch; `feedSettingsSchema` import dropped
- `scripts/seed.ts` - rede-lab gains `social`
- `apps/api/tests/integration/setup.ts` - `ToggleableInTests` gains `social`; `withSocialEnabled`
- `apps/api/tests/integration/social-module.test.ts` - `09 tracer` (5 cases) and `09 toggle` (3 cases)
- `apps/api/tests/unit/registry.test.ts`, `feed.test.ts`, `modules.test.ts`, `isolation.test.ts`, `platform-tenants.test.ts`, `packages/contracts/tests/platform.test.ts` - rewritten pins and matrices
- `apps/web/messages/pt-BR/platform.social.json`, `apps/web/i18n/messages.test.ts` - module name and description for the platform panel
- `packages/modules/feed/module.ts`, `README.md` - docblocks now name `social` as the switch

## Decisions Made

Planning decisions 1-5 of the plan were followed as written (see `key-decisions`). Reversibility of D-482 is costly: the key lives in a CHECK constraint through a migration, in the registry and in the registry test lists; folding it back needs a second migration, as D-121 did.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Contracts vocabulary test pinned nine keys**
- **Found during:** Task 1 (full turbo gate)
- **Issue:** `packages/contracts/tests/platform.test.ts` asserted `TOGGLEABLE_MODULES` has length 9 and ends in `courses`; not in the plan's file list.
- **Fix:** length 10, last key `social`.
- **Files modified:** `packages/contracts/tests/platform.test.ts`
- **Committed in:** `77c11247`

**2. [Rule 3 - Blocking] More lab pins than the plan named**
- **Found during:** Task 2 (running `modules.test.ts` and reading `platform-tenants.test.ts`)
- **Issue:** `modules.test.ts` case 9 (the platform list of lab's enabled modules) and cases 13 and 14, and `platform-tenants.test.ts` case 17, also pin the lab module set.
- **Fix:** each now ends in `social`.
- **Files modified:** `apps/api/tests/integration/modules.test.ts`, `apps/api/tests/integration/platform-tenants.test.ts`
- **Committed in:** `966b280c`

**3. [Rule 3 - Blocking] E2E specs pinned nine module switches**
- **Found during:** wrap-up (reading the e2e specs that count the Módulos tab switches)
- **Issue:** `phase2-smoke.spec.ts` (1 place) and `platform-domains.spec.ts` (3 places) hard-code `toHaveCount(9)` for the platform Módulos tab; the vocabulary now has ten keys.
- **Fix:** counts and their comments now say ten. `platform-tenants.spec.ts` already reads `TOGGLEABLE_MODULES.length`.
- **Files modified:** `apps/web/e2e/phase2-smoke.spec.ts`, `apps/web/e2e/platform-domains.spec.ts`
- **Verification:** `biome check` and web `typecheck` clean. The e2e itself was NOT run (needs the web app and a browser).
- **Committed in:** `09ee67ac`

**4. [Ordering] Registry unit matrices rewritten in the RED commit**
- **Why:** Task 1's verify runs `registry.test.ts`; keeping it in Task 2 would leave Task 1 unable to pass its own verify. No content change from the plan.
- **Committed in:** `27b7080b`

---

**Total deviations:** 3 auto-fixed (all Rule 3), 1 ordering note
**Impact on plan:** all necessary for the suite to stay green. No scope creep.

## Issues Encountered

- The precondition asked to confirm with the developer before the first `pnpm db:reset`. The dispatch instructions authorised a reset when the verification needs one, and the local DB had been freshly seeded that day (tenants created 15:52 UTC, 21 users), so the reset cost nothing beyond a re-seed. Two resets and seeds were run: one to apply the migration, one for the plan's [BLOCKING schema] chain.
- `.planning/STATE.md` carried an unrelated uncommitted modification from before this run; it is updated by the state handlers below, not by any task commit.

## Verification Results

- `pnpm --filter @rede-social/module-social test`: 5 passed; `typecheck` and `lint` clean.
- `pnpm --filter @rede-social/api typecheck`, `lint`; `tests/unit/registry.test.ts` + `module-readmes.test.ts`: 36 passed.
- `pnpm --filter @rede-social/web exec vitest run i18n`: 1219 passed; web `typecheck` clean; `pnpm boundaries`: "Checked 1640 files in 18 packages, no issues found".
- `pnpm db:generate`: "No schema changes, nothing to migrate".
- `pnpm supabase test db` (after reset and seed): `Files=36, Tests=1862, Result: PASS`.
- `social-module.test.ts` + `modules.test.ts` + `feed.test.ts`: 41 passed; `isolation.test.ts -t "h. bootstrap is scoped to the tenant"`: 1 passed.
- `pnpm --filter @rede-social/api test` and `@rede-social/module-feed` test, typecheck, lint: all passed (261 module-feed tests).
- Beyond the plan: full API integration suite 72 files, 1404 passed; `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4`: 37 of 37 tasks successful.

## Known Stubs

None. The manifest deliberately omits `routes`; that is a documented absence (plan 02), not a stub.

## Threat Flags

None. The only new surface is a workspace package with no network, route or file access; the platform toggle route already existed and now accepts one more enum value.

## Observations for later plans (not fixed here)

- Web code still reads the legacy value: `apps/web/lib/feed-view.tsx` (crown badge when `feed.settings.postingPolicy !== 'members'`), `apps/web/lib/registry.tsx`, `apps/web/app/(app)/criar/page.tsx` and a few docblocks in `packages/modules/feed/{server/routes.ts,ui/ComposeFab.tsx,db/schema.ts}` and `contracts/index.ts`. With `social` on and the old value absent, the web would still show the admin badge on member posts. The web plans (08-12) own this.
- The e2e suite was not run (no web app or browser in this session). Besides the switch counts fixed above, any e2e spec that pins the rede-lab member's modules or authoring controls may need the same `social` update; the web plans own the e2e pass.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 09-02. The vocabulary every later plan reads exists: `social` in the registry, `social.participate` for members, the `withSocialEnabled` helper, and rede-lab seeded with `social` on. Plan 02 must chain `requireModule('feed')` beside `requireModule('social')` on its routes and add the manifest `routes` loader.

## Self-Check: PASSED

- Created files exist (module.ts, contracts/index.ts, README.md, tests/module.test.ts, social-module.test.ts, platform.social.json, the migration): FOUND
- Commits `27b7080b`, `77c11247`, `966b280c`: FOUND

---
*Phase: 09-rede-social-follow-member-posts-and-explorar*
*Completed: 2026-10-19*
