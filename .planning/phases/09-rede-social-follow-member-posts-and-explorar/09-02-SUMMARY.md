---
phase: 09-rede-social-follow-member-posts-and-explorar
plan: 02
subsystem: api
tags: [social, follow-graph, tracer, rls, definer, seam, D-466, D-467, D-468, D-483, D-484]

requires:
  - phase: 09-01
    provides: "the `social` module key, social.participate for role member only, withSocialEnabled, rede-lab seeded with social on"
  - phase: 08.2-store
    provides: "the community-gate seam shape (kernel stubs, module bodies, create or replace) that the social seam copies"
provides:
  - "table social_follows with own-row RLS (select for the two parties, member-only insert, own delete), unique arbiter and two list-order indexes"
  - "kernel seam app.social_enabled() and app.social_visible_author_ids(): stubs in a kernel migration, bodies in the social migration, constants in packages/core/db/social-gate.ts"
  - "definer app.social_counts(membership): two integers for a live member of the caller's tenant, null otherwise"
  - "six /v1/social routes behind requireModule('feed') and requireModule('social') and social.participate: PUT and DELETE follows, POST follows/state, GET me/followers, me/following, members/{id}"
  - "GET /v1/members reopened to a member only while social.participate is composed; blocked members dropped from the directory"
  - "two rede-lab follow fixtures in the seed; pgTAP 200 plus 010, 020, 160 rows; inventory entries and a two-tenant sweep"
affects: [09-03, 09-04, 09-05, 09-06, 09-10, 09-11, 09-13]

actuals:
  tokens: 37300
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "kernel seam declared as stubs by a custom migration that sorts before the generated policy, bodies swapped with create or replace (08.2 precedent reused for authors)"
    - "own-row select with no tenant-isolation policy; other members' numbers come from a tenant-pinned definer returning integers only"
    - "both requireModule('feed') and requireModule('social') on a module with routes and requires (the requires trap)"
    - "insert as select-from-memberships with the liveness predicate in the same statement, plus the policy as backstop"

key-files:
  created:
    - packages/modules/social/db/schema.ts
    - packages/modules/social/server/routes.ts
    - packages/modules/social/server/service.ts
    - packages/modules/social/server/index.ts
    - packages/modules/social/tests/contracts.test.ts
    - packages/modules/social/tests/service.test.ts
    - packages/core/db/social-gate.ts
    - supabase/migrations/20261019204645_social_gate_seam.sql
    - supabase/migrations/20261019204728_social_follows.sql
    - supabase/migrations/20261019204737_social_functions.sql
    - supabase/tests/200-social.sql
    - apps/api/tests/integration/social.test.ts
  modified:
    - packages/modules/social/module.ts
    - packages/modules/social/contracts/index.ts
    - packages/modules/social/README.md
    - packages/modules/social/tests/module.test.ts
    - packages/core/package.json
    - packages/core/server/profiles/service.ts
    - apps/api/src/app.ts
    - apps/api/src/routes/members.ts
    - apps/api/tests/isolation-inventory.ts
    - apps/api/tests/integration/members.test.ts
    - apps/api/tests/integration/isolation.test.ts
    - apps/api/tests/unit/members-directory-staff-only.test.ts
    - scripts/seed.ts
    - supabase/tests/010-rls-coverage.sql
    - supabase/tests/020-tenant-isolation.sql
    - supabase/tests/160-shared-identity.sql
    - supabase/migrations/meta/_journal.json

key-decisions:
  - "Planning decision 1 (migration order): seam declaration (custom), then the generated table, then the functions (custom); timestamps 20261019204645, 20261019204728, 20261019204737 sort in that order and the policy resolves app.social_enabled() at CREATE POLICY"
  - "Planning decision 2 (seam split): bodies live in the social migration, constants in packages/core/db/social-gate.ts, so a project reusing the feed without social keeps the stubs and the gate is a no-op"
  - "Planning decision 3 (liveness in the seam): social_visible_author_ids joins memberships and keeps live member followees only, so D-484 holds at the RLS layer as well; the caller's own id is always appended"
  - "Planning decision 4 (liveness in SQL): lists and counts exclude non-live parties by join, never by a JavaScript filter after the limit"
  - "Planning decision 5 (separate social profile read): GET /v1/social/members/{id} is independent of GET /v1/members/{id}; memberProfileSchema is untouched and its contract test still rejects role, followerCount and followingCount"
  - "Planning decision 6 (permission, not role): every social route uses requirePermission('social.participate') after both module guards; staff get 403, a disabled module gets 404 first"
  - "Planning decision 7 (directory gate): a small listGate middleware, not requireRole; staff pass, a member passes only with social.participate, anything else is the old 403 before query validation"
  - "A 42501 from the insert policy (social turned off between the guard and the write) maps to 404 MODULE_DISABLED, never a 500"

patterns-established:
  - "Unfollow looks the target up WITHOUT the liveness predicate, so a blocked or demoted target can still be unfollowed and the answer is always 200"
  - "Follow insert re-selects the target's liveness in the same statement; the definer count coming back null turns a race into the bare 404"

requirements-completed: [FOLLOW-01, FOLLOW-02, FOLLOW-03, FOLLOW-04, FOLLOW-06, SOCIAL-10]

coverage:
  - id: D1
    description: "social_follows table, own-row policies, checks and indexes, plus the seam stubs, seam bodies and app.social_counts, applied in order on a fresh reset"
    requirement: FOLLOW-01
    verification:
      - kind: pgtap
        ref: "supabase/tests/200-social.sql (66 tests: policies, refusal matrix, seam truth table, counts definer, posture, tenant pin)"
        status: pass
      - kind: command
        ref: "pnpm db:generate prints 'No schema changes, nothing to migrate' after the three migrations"
        status: pass
    human_judgment: false
  - id: D2
    description: "tracer: PUT and DELETE /v1/social/follows/{membershipId} write and remove one row through the tenant lane, idempotently, with the closed self_follow code and one bare 404 for every other miss"
    requirement: FOLLOW-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/social.test.ts#09 tracer (7 cases)"
        status: pass
      - kind: unit
        ref: "packages/modules/social/tests/service.test.ts (7 cases, tenant lane mocked)"
        status: pass
    human_judgment: false
  - id: D3
    description: "private lists, batch state and the social profile variant; counts public, lists private, no list route takes a member id; blocked members vanish and return"
    requirement: FOLLOW-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/social.test.ts#09 reads (8 cases)"
        status: pass
      - kind: unit
        ref: "packages/modules/social/tests/contracts.test.ts (strict shapes, D-45 base schema still rejects role and counts)"
        status: pass
    human_judgment: false
  - id: D4
    description: "social off or feed off answers 404 MODULE_DISABLED on every route; staff get 403; ten parallel PUTs leave one row"
    requirement: FOLLOW-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/social.test.ts#09 gate (5 cases)"
        status: pass
    human_judgment: false
  - id: D5
    description: "GET /v1/members open to a member only while social.participate is composed, staff always, 403 before validation otherwise, blocked members absent"
    requirement: FOLLOW-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/members.test.ts#31 and #31b"
        status: pass
      - kind: unit
        ref: "apps/api/tests/unit/members-directory-staff-only.test.ts#1b"
        status: pass
    human_judgment: false
  - id: D6
    description: "two-tenant isolation: six routes in the inventory, a sweep with both tenants on, pgTAP 010, 020 and 160 rows"
    requirement: SOCIAL-10
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#phase 09 sweep: social follows"
        status: pass
      - kind: unit
        ref: "apps/api/tests/unit/isolation-inventory.test.ts (9 passed)"
        status: pass
      - kind: pgtap
        ref: "pnpm supabase test db: Files=37, Tests=1939, Result: PASS"
        status: pass
    human_judgment: false

duration: 27min
completed: 2026-10-19
plan_head_before: e5738a03347df419e4ff8d4308c09178e54a0495
commits: 5
status: complete
---

# Phase 9 Plan 02: Follow graph Summary

**A one-directional, idempotent member-to-member follow graph: a `social_follows` table with own-row RLS, the social gate seam (stubs, bodies and kernel constants), a tenant-pinned counts definer, six `/v1/social` routes behind both module guards, and the directory reopened to members while `social` is on.**

## Performance

- **Duration:** 27 min
- **Started:** 2026-10-19T20:43:00Z (approximate; the start was not recorded at launch)
- **Completed:** 2026-10-19T21:10:00Z
- **Tasks:** 3 (one tracer, two auto)
- **Files modified:** 32 including three generated drizzle snapshots

## Accomplishments

- On rede-lab, `alvaro.pinheiro@rede-lab.local` PUTs a follow on Helena and gets 200 `{ following: true, followerCount: 1 }`; DELETE answers 200 `{ following: false, followerCount: 0 }`. Each call is one row written or removed through the tenant lane, and the response count equals an independent Postgres count.
- A self-follow is 400 `VALIDATION_FAILED` with `details.follow = 'self_follow'`; an unknown, staff or rede-demo target is ONE bare 404 (the three bodies compared equal); admin and support get 403 before the target is looked up.
- Counts are public, lists are private: `GET /v1/social/me/followers` and `/me/following` read the session's own rows newest first on `(created_at, id)` (a limit-1 walk over two tied instants neither skips nor repeats); a router-path test proves no list route takes a member id.
- A blocked member vanishes from lists, counts and the directory and returns on unblock with the follow rows intact; a new PUT on them is the bare 404, DELETE still answers 200.
- `social` off, or `feed` off with `social` on, answers 404 `MODULE_DISABLED` on all six routes; the rows return when turned back on.
- `GET /v1/members` answers 200 to a rede-lab member (social on), is still 403 before validation for rede-demo and the throwaway tenant (social off), and never lists staff or a blocked member.

## Task Commits

1. **Task 1 (tracer, TDD): seam, table, functions, PUT and DELETE, mount, seed**
   - RED: `a0f17ac4` (test)
   - GREEN: `3b8dacd2` (feat)
2. **Task 2 (TDD): private lists, batch state, social profile, directory gate**
   - RED: `95aadf23` (test)
   - GREEN: `e94a3954` (feat)
3. **Task 3: [BLOCKING schema] pgTAP 200, rows in 010, 020, 160, inventory and the two-tenant sweep** - `39dec390` (test)

**Plan metadata:** committed separately (docs: complete plan).

## TDD Gate Compliance

RED then GREEN for both TDD tasks, in order: `test(09-02)` `a0f17ac4` then `feat(09-02)` `3b8dacd2`; `test(09-02)` `95aadf23` then `feat(09-02)` `e94a3954`. No REFACTOR commit.

RED evidence (real runs, throwaway scratchpad normalizer, nothing committed): `pnpm --filter @rede-social/module-social test` exit 1, 18 tests, 5 passed, 13 failed, target `followMember (D-467) inserts once and answers following true with the definer count`, verdict `RED_EVIDENCE_OK / target_test_failed`. Second RED: exit 1, 32 tests, 21 passed, 11 failed, target `memberSocialProfileSchema ... parses the zero-relations shape`, verdict `RED_EVIDENCE_OK`. Both REDs shipped deliberately inert, self-documented stubs in `contracts/index.ts` and `server/service.ts` (replaced in GREEN) so the failures are assertion failures, not import errors. The integration REDs were also run against the previous state: tracer 7 of 7 failed; reads and gate 10 of 12 failed plus the members case 31 (53 tests, 11 failed, 42 passed). `gate case 2` (feed off) passed in RED because unmatched paths under `/v1/social` already hit the module guards; that is a true statement about the router, not a hole in the test.

## Files Created/Modified

- `supabase/migrations/20261019204645_social_gate_seam.sql` - kernel stubs `app.social_enabled()` (false) and `app.social_visible_author_ids()` (empty), hardened, sorting before the policy that calls them
- `supabase/migrations/20261019204728_social_follows.sql` - generated: the table, three policies, unique arbiter, two list indexes, `social_follows_no_self_chk`
- `supabase/migrations/20261019204737_social_functions.sql` - the two seam bodies, `app.social_counts`, `revoke update, truncate`
- `packages/modules/social/db/schema.ts` - `socialFollows` with the docblock of what not to "fix" (no tenant-wide select, no update policy)
- `packages/core/db/social-gate.ts` and `packages/core/package.json` - the kernel constants and their export entry
- `packages/modules/social/server/{service,routes,index}.ts` and `module.ts` - the six routes, the service, the manifest `routes` loader
- `packages/modules/social/contracts/index.ts` - follow, list, batch state and social profile schemas
- `apps/api/src/app.ts` - `.route('/v1/social', socialRoutes)`
- `apps/api/src/routes/members.ts`, `packages/core/server/profiles/service.ts` - `listGate` and the `blocked_at is null` conjunct
- `scripts/seed.ts` - two rede-lab follow fixtures in the admin lane
- Tests: `supabase/tests/200-social.sql` (new), rows in 010, 020, 160, `apps/api/tests/integration/{social,members,isolation}.test.ts`, `isolation-inventory.ts`, `tests/unit/members-directory-staff-only.test.ts`, module `contracts`, `service` and `module` tests

## Decisions Made

Planning decisions 1-7 were followed as written (see `key-decisions`). One implementation choice beyond them: the follow insert is `insert ... select from memberships where <live member>` so the liveness predicate and the insert share one statement, and a `42501` from the policy (social turned off between the guard and the write) maps to 404 `MODULE_DISABLED` instead of a 500. Reversibility of the seam signatures is costly, as the plan said: plans 03-05 read `app.social_visible_author_ids()` by name.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The kernel export map had no entry for the new seam file**
- **Found during:** Task 1
- **Issue:** `@rede-social/core/db/social-gate` could not be imported by the module without an `exports` entry in `packages/core/package.json`, which the plan did not list.
- **Fix:** added `"./db/social-gate": "./db/social-gate.ts"` beside `course-gate`.
- **Files modified:** `packages/core/package.json`
- **Committed in:** `3b8dacd2`

**2. [Rule 3 - Blocking] 09-01's manifest test asserted `routes` is absent**
- **Found during:** Task 1 (running the module tests after adding the routes loader)
- **Fix:** `packages/modules/social/tests/module.test.ts` now asserts `routes` is a function and keeps the other absent keys. The README's kernel dependency list and contracts table were updated for `module-readmes.test.ts`.
- **Files modified:** `packages/modules/social/tests/module.test.ts`, `packages/modules/social/README.md`
- **Committed in:** `3b8dacd2`, `e94a3954`

**3. [Rule 3 - Blocking] Two existing tests encoded the staff-only directory**
- **Found during:** Task 2
- **Issue:** `apps/api/tests/unit/members-directory-staff-only.test.ts` (member always 403) and `isolation.test.ts` case `n` (lab member list refused) failed once a member of a social-on tenant may list. Neither file was in Task 2's list.
- **Fix:** the unit test mocks `permissionsForRequest` and gains case 1b (member with `social.participate` 200, without it 403, gate before validation); case `n` now expects 200 for the lab member with no rede-demo id in it and keeps the 403 for the demo member.
- **Files modified:** `apps/api/tests/unit/members-directory-staff-only.test.ts`, `apps/api/tests/integration/isolation.test.ts`
- **Committed in:** `e94a3954`

**4. [Ordering] The integration tracer file was committed in the RED commit and extended in later commits**
- The tracer, reads and gate cases are all in `social.test.ts`; the tracer's `afterAll` that restores the seeded alvaro-to-helena fixture was added in the Task 2 GREEN commit when the reads showed the dependency.

---

**Total deviations:** 3 auto-fixed (all Rule 3), 1 ordering note
**Impact on plan:** all necessary for the suite to stay green. No scope creep.

## Issues Encountered

- The turbo gate `typecheck test` re-ran a production `next build` through the web package's `test` dependency, which cost about 2 GB of disk (8.2 GB free before, 6.1 GB after). It stayed above the 4 GB floor; `apps/web/.next` is regenerable.
- `isolation.test.ts` was left with a hand-simplified `six()` helper inside the sweep for the two named-id routes; the six-route matrix itself is the `sixRoutes()` list in the same case.

## Verification Results

- `pnpm --filter @rede-social/module-social test`: 3 files, 32 passed; `typecheck`, `lint` clean.
- `pnpm --filter @rede-social/core test`: 41 files, 447 passed. `pnpm --filter @rede-social/api typecheck`, `lint` clean; `tests/unit` (excluding the inventory file until Task 3) 63 passed.
- `pnpm boundaries`: "Checked 1650 files in 18 packages, no issues found". `bash scripts/check-ui-literals.sh`: OK.
- `pnpm db:generate`: "No schema changes, nothing to migrate" after the three migrations (and before the Task 3 commit).
- `pnpm supabase test db` after reset and seed: `Files=37, Tests=1939, Result: PASS` (200-social.sql: 66 tests; 020 plan 274 to 280; 160 plan 72 to 77).
- `apps/api/tests/integration/social.test.ts`: 20 passed (tracer 7, reads 8, gate 5). With `members.test.ts`: 53 passed. `isolation.test.ts -t "phase 09 sweep"`: 1 passed. `tests/unit/isolation-inventory.test.ts`: 9 passed.
- Beyond the plan: full API integration suite `pnpm --filter @rede-social/api test:integration`: 73 files, 1426 passed (run after pgTAP, as the project memory requires). `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4`: 37 of 37 tasks successful.
- Acceptance greps: three migration files in order seam, follows, functions; 3 `CREATE POLICY` in the generated file; 0 destructive words in each; 2 and 3 `create or replace function app.social_` in the seam and functions files; 6 inventory lines.

`db:reset` ran three times: (1) Task 1's verify, (2) Task 2's verify, (3) Task 3's verify chain, each followed by `pnpm db:seed`. The reset consent of plan 09-01 covered them. The local database is not reset after the final integration run, so it carries that run's residue.

## Known Stubs

None. The RED stubs of the two TDD tasks were fully replaced in their GREEN commits.

## Threat Flags

None. The six routes and the directory gate are the surface the plan's threat model covers (T-09-02 through T-09-09); T-09-40 (follow spam, no rate limiter) stays accepted and is for plan 13's DEPLOY.md item.

## Observations for later plans (not fixed here)

- The web still reads the staff-only rule in `apps/web/lib/member-directory.ts` (`canBrowseMemberDirectory`); plan 10 owns that half of FOLLOW-06.
- `social_visible_author_ids()` costs one indexed join to `memberships` per statement. Plan 03's volume-fixture plan measurement should include it.
- The e2e suite was not run (no web app or browser in this session).

## User Setup Required

None - no external service configuration required. Nothing was pushed and no cloud project was touched; `social` is on only for the local rede-lab seed tenant.

## Next Phase Readiness

Ready for 09-03. The seam names exist with final signatures (`app.social_enabled()`, `app.social_visible_author_ids()`, `SOCIAL_VISIBLE_AUTHOR_IDS`, `SOCIAL_ENABLED`), the follow table is proven in Postgres and through the API, and the lab has a seeded graph to read.

## Self-Check: PASSED

- Created files exist (schema, routes, service, index, social-gate, three migrations, 200-social.sql, social.test.ts): FOUND
- Commits `a0f17ac4`, `3b8dacd2`, `95aadf23`, `e94a3954`, `39dec390`: FOUND
- RED before GREEN for both TDD tasks (`git log --grep` on `test(9-2)` and `feat(9-2)`): confirmed
- No attribution trailer in the five commit messages: confirmed

---
*Phase: 09-rede-social-follow-member-posts-and-explorar*
*Completed: 2026-10-19*
