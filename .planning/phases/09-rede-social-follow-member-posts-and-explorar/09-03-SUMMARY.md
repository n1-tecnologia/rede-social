---
phase: 09-rede-social-follow-member-posts-and-explorar
plan: 03
subsystem: api
tags: [social, feed, tracer, rls, audience, spike, D-471, D-473, D-476, D-483, D-484]

requires:
  - phase: 09-01
    provides: "the social module key, feed.post.create composed for the role member while social is on, withSocialEnabled, rede-lab seeded with social on"
  - phase: 09-02
    provides: "social_follows, the kernel seam app.social_enabled() and app.social_visible_author_ids() with their TS constants, the seeded follow graph on rede-lab"
provides:
  - "feed_posts.visibility ('tenant' | 'followers', default 'tenant') and feed_posts.deleted_by_user_id, the visibility vocabulary check and the shape check, in one expand-only migration"
  - "restrictive policies feed_posts_social_gate (select) and feed_posts_social_insert_gate (insert); comments and likes inherit the gate through their existing inner exists"
  - "kernel SOCIAL_STAFF_EXEMPT and SOCIAL_SYSTEM_USER_ID next to the seam constants"
  - "createPost stamps the audience from the author's role; Inicio and the video path read p.visibility = 'tenant'; memberPostVisible(canModerate) is the service form of the policy"
  - "GET /v1/feed?scope=explorar (following-only, chronological, one statement) with the scope_conflict 400, the 403 for a real support user and the 404 MODULE_DISABLED"
  - "FeedPost.audience (optional, emitted only as 'followers'), FEED_SCOPES, FEED_AUDIENCES"
  - "post.published returns no intent for a member post (D-476)"
  - "09-03-SPIKE.md: the measured Explorar form (CHOSEN_FORM: ANY_SET) and the three partial indexes plan 04 builds"
  - "pgTAP 201 (47 tests) and integration feed-social.test.ts (14 cases)"
affects: [09-04, 09-05, 09-06, 09-07, 09-08, 09-09, 09-10, 09-11, 09-13]

actuals:
  tokens: 50218
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "stamped audience column instead of a read-time role: the policy, the service predicate and the partial indexes all read a literal"
    - "restrictive select policy plus restrictive insert policy on the same table, the service predicate written beside it as the precise rule"
    - "staff exemption by identity (admin role OR the zero user), not by role claim, wrapped as an InitPlan scalar subquery"
    - "scope as a filter of the existing feed endpoint (the Reels precedent), never a second route or a second projection"

key-files:
  created:
    - supabase/migrations/20261019211658_feed_social_visibility.sql
    - supabase/migrations/meta/20261019211658_snapshot.json
    - supabase/tests/201-feed-social-gate.sql
    - apps/api/tests/integration/feed-social.test.ts
    - packages/modules/feed/tests/contracts.test.ts
    - packages/modules/feed/tests/member-stamp.test.ts
    - .planning/phases/09-rede-social-follow-member-posts-and-explorar/09-03-spike.sql
    - .planning/phases/09-rede-social-follow-member-posts-and-explorar/09-03-SPIKE.md
  modified:
    - packages/modules/feed/db/schema.ts
    - packages/modules/feed/contracts/index.ts
    - packages/modules/feed/server/service.ts
    - packages/modules/feed/server/routes.ts
    - packages/modules/feed/server/notifications.ts
    - packages/modules/feed/tests/notification-sources.test.ts
    - packages/modules/feed/README.md
    - packages/core/db/social-gate.ts
    - apps/api/tests/integration/feed.test.ts
    - supabase/migrations/meta/_journal.json

key-decisions:
  - "Planning decision 1 (stamp the audience): feed_posts.visibility is written by createPost from ctx.role and backed by the restrictive insert policy; the check feed_posts_visibility_shape_chk makes a followers post without a community a database fact"
  - "Planning decision 2 (staff exemption): admin_tenant plus the zero user, never the support_tenant claim; a real support session reads zero member posts (pgTAP 201 section 1, integration 403 on the scope), and the exemption always requires app.social_enabled()"
  - "Planning decision 3 (two fragments, one meaning): memberPostVisible in service.ts and feed_posts_social_gate in schema.ts are written side by side and agree"
  - "Planning decision 4 (simple form first): the tracer uses author_user_id = any (the seam set); the spike measured it against the LATERAL top-N form and recorded CHOSEN_FORM: ANY_SET, so no index is created in this plan"
  - "Planning decision 5 (no removal field yet): canModerate is plumbed through the list read only; the soft-delete branch and deleted_by_user_id writes are plan 07"
  - "Planning decision 6 (notification guard ships with the first member post): resolvePostPublished returns [] unless visibility is 'tenant'"
  - "SPIKE outcome: CHOSEN_FORM: ANY_SET with feed_posts_tenant_followers_created_idx, feed_posts_tenant_org_created_idx and feed_posts_tenant_org_nocommunity_created_idx for plan 04; no video sibling index is needed"
  - "The route answers 404 MODULE_DISABLED for scope=explorar BEFORE it checks the permission, so a member of a tenant without social (who holds neither permission) is told 'not here', never 'forbidden'"

patterns-established:
  - "Reading the policy and the service fragment as a pair: any later change to who reads a member post edits both files in one commit"
  - "A stamped column is the literal a partial index can prove; plans 04-07 must keep 'tenant' and 'followers' as literals, never bound parameters"

requirements-completed: [SOCIAL-03, SOCIAL-04, SOCIAL-06, SOCIAL-08, SOCIAL-09, SOCIAL-10, EXPL-02]

coverage:
  - id: D1
    description: "Tracer: a member publishes (201, audience followers), a follower lists it newest first in Explorar and not in Inicio, a stranger lists neither, the author's own Explorar holds it, an admin post is in Inicio and never in Explorar"
    requirement: SOCIAL-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-social.test.ts#09 tracer (7 cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The audience is stamped from the role and refused by the database when forged: member cannot insert 'tenant', staff cannot insert 'followers', a member post has no community, null role fails closed"
    requirement: SOCIAL-03
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/member-stamp.test.ts (3 cases)"
        status: pass
      - kind: pgtap
        ref: "supabase/tests/201-feed-social-gate.sql section 4 (9 tests)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed-social.test.ts#11 forged audience is a strict 400 and writes nothing"
        status: pass
    human_judgment: false
  - id: D3
    description: "feed_posts_social_gate: author, follower, admin and the system lane read a member post; a stranger, a real support user, another tenant and a null role do not; social off hides every member post and deletes nothing; blocked, removed and unfollowed authors leave the follower's lane and return"
    requirement: SOCIAL-06
    verification:
      - kind: pgtap
        ref: "supabase/tests/201-feed-social-gate.sql sections 1, 2, 3 and 6 (32 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Comments and likes of a hidden post are hidden and refused with no new policy (inherited through the existing inner exists); the story comment stays visible"
    requirement: SOCIAL-06
    verification:
      - kind: pgtap
        ref: "supabase/tests/201-feed-social-gate.sql section 5 (6 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Query contract of GET /v1/feed?scope=explorar: scope_conflict 400 with communityId or media, 403 for a real support user, 404 MODULE_DISABLED when social is off, one statement against the feed tables, audience emitted only as followers"
    requirement: EXPL-02
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/contracts.test.ts (7 cases)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed-social.test.ts#09 audience cases 8, 9, 10 and 14"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed-query-budget.test.ts (budget of 1 unchanged)"
        status: pass
    human_judgment: false
  - id: D6
    description: "D-476: a member post notifies nobody; an admin post keeps its single all-members broadcast"
    requirement: SOCIAL-08
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/notification-sources.test.ts (D-476 cases)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed-social.test.ts#12 (the real resolver in the system lane)"
        status: pass
    human_judgment: false
  - id: D7
    description: "EP-11 idempotency: two identical publishes make two posts, identical edits advance edited_at and keep the audience, a repeated delete is the bare 404"
    requirement: SOCIAL-09
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-social.test.ts#13"
        status: pass
    human_judgment: false
  - id: D8
    description: "The Explorar query form and its indexes are decided by measurement on a volume fixture (22400 posts) and recorded"
    requirement: SOCIAL-10
    verification:
      - kind: command
        ref: "psql -f 09-03-spike.sql (exit 0, rolled back) and grep CHOSEN_FORM / INDEXES in 09-03-SPIKE.md"
        status: pass
    human_judgment: true
    rationale: "The thresholds are the planner's written default and were applied literally, but whether ANY_SET's per-page cost (about 12 / density of the followed set in the tenant timeline) is acceptable as tenants grow is a product-scale judgement recorded in the spike for plan 04 and the DEPLOY.md owner."

duration: 24min
completed: 2026-10-19
plan_head_before: 0f06418f0e38567e8bf2c54c6a012b01b87a3734
commits: 4
status: complete
---

# Phase 9 Plan 03: Member posts, their audience gate and Explorar Summary

**A member of a `social` tenant now publishes a post stamped `visibility = 'followers'`; two restrictive RLS policies and a matching service predicate let only the author, the author's live followers, the tenant admin and the system lanes read it; it appears in the new `?scope=explorar` of the feed and never in Início, notifies nobody, and the Explorar query form (`ANY_SET`) and its three partial indexes were chosen by a rolled-back volume-fixture spike.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-10-19T21:12:30Z
- **Completed:** 2026-10-19T21:37:00Z (approximate; the SUMMARY and tracking commits follow)
- **Tasks:** 3 (one tracer, TDD; one measurement spike; one pgTAP proof)
- **Files modified:** 18 including one generated drizzle snapshot (9858 lines) and the generated spike SQL (1810 lines)

## Accomplishments

- On rede-lab with `social` on, Helena (a member) `POST /v1/feed/posts` and gets 201 with `audience: 'followers'`; `adminSql` confirms `visibility = 'followers'` and `community_id is null`. Alvaro (who follows Helena in the seed) lists both of her posts in `GET /v1/feed?scope=explorar`, newest first, and neither in `GET /v1/feed`. Marcos (follows nobody) lists neither, and his own post is the positive control in the same list. Helena's own Explorar holds her posts and Marcos's (she follows him). The lab admin's post is in Início for members and never in Explorar; the admin's Explorar (moderator) holds the member posts. A followers post planted by `adminSql` for a stranger never reaches Alvaro and its detail read is the bare 404.
- The database is the gate, not only a route: `feed_posts_social_gate` (restrictive, select) ANDs with the tenant isolation and the community gate; `feed_posts_social_insert_gate` (restrictive, insert) refuses a forged audience. pgTAP 201 proves the truth table: author, follower, stranger, admin, REAL support (reads nothing), system user (reads), other tenant, null role, `social` off and absent, blocked and removed authors, unfollow and re-follow, the insert gate, the shape and vocabulary checks, comment and like inheritance, and the policy shapes by catalog.
- `scope` is a closed filter of the existing endpoint: 400 `scope_conflict` with `communityId` or `media`, 404 `MODULE_DISABLED` while the tenant lacks `social`, 403 for a real support user, otherwise one statement (measured by `pg_stat_statements`, the feed-table budget of 1 is unchanged).
- A member post notifies nobody (D-476): `resolvePostPublished` returns `[]` unless `visibility = 'tenant'`, proved with the real resolver in the real system lane (which also proves the zero-user exemption keeps the workers reading member posts).
- The Wave 0 spike chose `ANY_SET` and recorded three partial indexes for plan 04, with the measured numbers and the scaling caveat.

## Task Commits

1. **Task 1 (tracer, TDD): the visibility column and policies, the member stamp, the Início predicate, the Explorar scope, the notification guard**
   - RED: `f91f43ef` (test)
   - GREEN: `0dab04fa` (feat)
2. **Task 2: Wave 0 plan-measurement spike** - `a5788de0` (docs)
3. **Task 3: [BLOCKING schema] pgTAP 201** - `ec71d4d6` (test)

**Plan metadata:** committed separately (docs: complete plan, then state and roadmap).

## TDD Gate Compliance

RED then GREEN for Task 1, in order: `test(09-03)` `f91f43ef` then `feat(09-03)` `0dab04fa`. No REFACTOR commit.

RED evidence (a real run, a throwaway scratchpad normalizer, nothing committed): `pnpm --filter @rede-social/module-feed test` exit 1, 273 tests, 267 passed, 6 failed, target `createPost stamps the audience from the role (D-473) a member context inserts visibility "followers" and the post answers audience "followers"`, verdict `RED_EVIDENCE_OK / target_test_failed` from `gsd_run check tdd-red-evidence`. The six failing tests are assertion failures on the planned behavior (scope parse, audience parse, the three stamp cases, the D-476 guard). The integration file was also run against the previous state: 13 of 14 failed, 1 passed (the strict-body case that already refused an unknown key). The RED commit ships no stubs: the failing tests import only symbols that already exist.

## Files Created/Modified

- `packages/modules/feed/db/schema.ts` - `visibility`, `deletedByUserId`, the two checks and the two restrictive policies; the table docblock now states that authorship is generic and the audience is stamped
- `supabase/migrations/20261019211658_feed_social_visibility.sql` (+ journal, snapshot) - generated, expand-only, header names SOCIAL-06, D-473, D-483
- `packages/core/db/social-gate.ts` - `SOCIAL_SYSTEM_USER_ID`, `SOCIAL_STAFF_EXEMPT` (an InitPlan scalar subquery) with the docblock on who the system lanes are and why a real support session is not exempt
- `packages/modules/feed/contracts/index.ts` - `FEED_SCOPES`, `scope`, `FEED_AUDIENCES`, optional `audience`
- `packages/modules/feed/server/service.ts` - `visibility` in the projection and `FeedRow`, `audience` in `toPost`, `memberPostVisible`, the `scope` branch and `opts` of `listFeed`, the member stamp in `createPost`, the Início/video `p.visibility = 'tenant'`
- `packages/modules/feed/server/routes.ts` - the scope conflict, module and permission checks in the list handler, 403/404 descriptions
- `packages/modules/feed/server/notifications.ts` - the D-476 guard
- Tests: `contracts.test.ts` (new), `member-stamp.test.ts` (new), `notification-sources.test.ts`, `feed-social.test.ts` (new), `feed.test.ts` case 7, `201-feed-social-gate.sql` (new)
- `09-03-spike.sql`, `09-03-SPIKE.md` - the measurement and its record
- `packages/modules/feed/README.md` - the kernel dependency list (the README drift test) and one paragraph on the audience

## Decisions Made

Planning decisions 1-6 were followed as written (see `key-decisions`). Three choices beyond them: (1) the route checks the `social` module first and the permission second, so the plan's "a member of rede-demo answers 404" holds for a caller who holds neither permission; (2) `SOCIAL_STAFF_EXEMPT` is the plan's expression wrapped in `(select ...)` so the planner treats it as an InitPlan evaluated once per statement instead of once per row; (3) the notification guard compares `visibility !== 'tenant'`, so an unexpected future value is silent rather than broadcast.

## Spike outcome

`CHOSEN_FORM: ANY_SET` (quoted from `09-03-SPIKE.md`). The planner's rule was applied literally: F3 (a member following the three rarest authors) page 5 showed no Seq Scan on `feed_posts`, 0.6 ms and 96 to 210 shared hits in every state, page 21 0.64 ms. Findings plan 04 needs:

| Read (fixture: 20000 member posts, 2400 organization posts) | Measured |
|---|---|
| Explorar, ANY_SET, F50 and F3, with the followers partial index | 0.5 to 0.7 ms, 96 to 107 hits |
| Explorar, LATERAL_TOPN with the per-author index | 0.8 to 1.4 ms, 190 to 713 hits (correct and bounded, costlier here); without that index 9119 hits |
| Moderator all-members read | 0.17 ms, 85 hits |
| Início, merged and community-null, with the organization-only partials | 63 and 31 hits, 28 discarded rows, against 128 and 148 discarded without |
| Reels 'Todos', plan 04 form (shared member fragment) | 214 hits on the existing video partial index; no sibling needed |

Indexes recorded for plan 04: `feed_posts_tenant_followers_created_idx`, `feed_posts_tenant_org_created_idx`, `feed_posts_tenant_org_nocommunity_created_idx`. RESEARCH A1 confirmed at this scale, A2 refuted for this policy shape (the author test is a filter inside a disjunction, never an index condition; a trailing-author index changed nothing), A5 confirmed, A3 and A4 not measurable here. The honest caveat, recorded in the spike: ANY_SET's cost per page is about `12 / density` and grows with tenant size for a member who follows few authors; the LATERAL form with a per-author index is the measured escape hatch.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] feed.test.ts case 7 asserted a member post leads Início**
- **Found during:** Task 1 (the verify run of feed.test.ts)
- **Issue:** case 7 ("turning social on makes the SAME member an author") expected the member's new post to be the first item of `GET /v1/feed`. By design (SOCIAL-04) a member post is never in Início.
- **Fix:** the case now asserts `audience: 'followers'`, that the post is absent from Início and that it is the first item of the author's own `?scope=explorar` (D-471). The original invariant (the post round-trips through the generic author path) is kept.
- **Files modified:** `apps/api/tests/integration/feed.test.ts`
- **Committed in:** `0dab04fa`

**2. [Rule 3 - Blocking] The feed README drift test lists kernel imports**
- **Found during:** Task 1 (`pnpm --filter @rede-social/api test`, `module-readmes.test.ts` case 2)
- **Issue:** the feed module now imports `@rede-social/core/db/social-gate`, which the README's "Kernel dependencies" list did not name.
- **Fix:** added the entry (and one paragraph on the stamped audience) to the README.
- **Files modified:** `packages/modules/feed/README.md`
- **Committed in:** `0dab04fa`

**3. [Rule 3 - Plan files] Test files the plan lists or implies did not exist as described**
- `packages/modules/feed/tests/contracts.test.ts` is listed as "extended" but did not exist (the existing contract tests live in `community-contract.test.ts`); it was created. The `createPost` behavior case of the plan needed a service-level unit test with the tenant lane mocked, so `packages/modules/feed/tests/member-stamp.test.ts` was added. Both are new files in the module's `tests` directory.

**4. [Process] The plan commit ledger (protocol 0c) was written after the first commit**
- The ledger file `gsd-plan-head-before-09-03` was created retroactively with the HEAD that preceded the first plan commit (`0f06418f0e38567e8bf2c54c6a012b01b87a3734`), which is exactly the value protocol 0c would have recorded. `commits: 4` is measured with `git rev-list --count 0f06418f..HEAD` at the time of writing, before this SUMMARY and the tracking commit.

### Beyond the plan (spike only)

The spike measured two more index states than the plan asked for (organization-only partials, and a trailing-author index for RESEARCH A2) and a deep page (page 21), because the plan's decision list required indexes for Início and the video read, and A2 was otherwise left unmeasured.

---

**Total deviations:** 3 auto-fixed (all Rule 3), 1 process note
**Impact on plan:** all necessary; no scope creep and no architectural change.

## Issues Encountered

- A `cat > file` with no stdin hung a shell call once (killed; the target migration file was not touched). The migration header was then prepended with a script.
- The pgTAP catalog case first compared `roles::text` inside `results_eq` and failed with "could not determine which collation to use"; rewritten as a count over `pg_policies` with `roles = '{authenticated}'::name[]`.
- Buffer numbers in `EXPLAIN` vary on a cold session (one early run showed 1207 hits for a plan that later runs show at 206); every run stayed far under the decision thresholds, and the spike says so.
- `TURBO_CACHE=local:r pnpm turbo typecheck` pulls a production web build through the web package (about 1 GB of disk this time; 8.0 GB free afterwards). `apps/web/.next` is regenerable and gitignored.

## Verification Results

- Task 1 verify: `pnpm --filter @rede-social/module-feed test` 273 passed (22 files); module `typecheck` and `lint` clean; `pnpm --filter @rede-social/api typecheck` and `lint` clean; `pnpm --filter @rede-social/api test` 72 passed (8 files); `pnpm boundaries`: "Checked 1653 files in 18 packages, no issues found".
- `pnpm db:reset && pnpm db:seed && VIDEO_PROVIDER=fake pnpm --filter @rede-social/api exec vitest run tests/integration/feed-social.test.ts tests/integration/feed.test.ts tests/integration/feed-query-budget.test.ts`: 3 files, 44 passed (feed-social 14).
- Task 2 verify: `psql ... -v ON_ERROR_STOP=1 -f 09-03-spike.sql` exit 0, the script ends in `rollback;`, `explain` appears 54 times in the file, `select count(*) from public.feed_posts` is 65 afterwards (the seed count) and no `spike_*` index remains; the `CHOSEN_FORM` and `INDEXES:` lines are present.
- Task 3 verify: `pnpm db:generate` prints "No schema changes, nothing to migrate" (checked before the last reset); `pnpm supabase test db` after reset and seed: `Files=38, Tests=1986, Result: PASS` (201-feed-social-gate.sql: 47 tests; 1939 before this plan); feed-social 14 passed again.
- Beyond the plan: `pnpm --filter @rede-social/api test:integration` (full suite, run after pgTAP as the project memory requires): 74 files, 1440 passed. `pnpm --filter @rede-social/web exec vitest run`: 171 files, 3842 passed. `@rede-social/core` 447, module-reels 139, module-dashboard 503, module-notifications 134, module-social 32 passed. `TURBO_CACHE=local:r pnpm turbo typecheck --concurrency=4`: 20 of 20 tasks successful.
- Acceptance greps: one `*_feed_social_visibility.sql` sorting after `*_social_functions.sql`; 2 `CREATE POLICY`; 0 destructive words; `feed_posts_visibility_shape_chk` and `DEFAULT 'tenant'` present; `memberPostVisible`, `scope_conflict`, `SOCIAL_STAFF_EXEMPT`, `09 tracer` present; the 201 file has `select plan(`, `feed_posts_social_gate`, `feed_posts_visibility_shape_chk`, `42501` and the zero uuid.

`db:reset` ran three times: (1) Task 1's verify, (2) Task 2's verify, (3) Task 3's verify chain, each followed by `pnpm db:seed`. The reset consent of plan 09-01 covered them. The local database is not reset after the final full integration run, so it carries that run's residue (and `pnpm supabase test db` should be run after a reset and seed, not on top of it, before the next plan).

## Known Stubs

None. The RED commit shipped no stubs.

## Threat Flags

None new. The `scope=explorar` branch of the list handler is the surface the plan's threat model covers (T-09-07, T-09-08, T-09-10, T-09-11, T-09-24).

## Observations for later plans (not fixed here)

- **Plan 04:** build the three recorded indexes and pin each plan BY NAME; relax the Reels video path to `memberPostVisible(false)` (until then member videos are absent from Reels, and the video path walks them: 946 hits for 12 rows in the spike). `090-feed.sql` and `130-reels.sql` still pin the old indexes and still pass.
- **Web plans:** `FeedPost.audience` is the field that says whose voice a post is; `PostHeader` decides the Administrador badge in the host, so it must read `audience` rather than infer admin from the author.
- **Dashboard (plan 13's DEPLOY.md item, RESEARCH Open Question 3):** the owner dashboard reads `feed_posts` in the system lane, which is exempt from the gate, so its Conteúdo counts include member posts while `social` is on. Not filtered by this plan.
- **Início is organization-only for everyone**, including the author: Helena's own posts are not in her Início (they are in her Explorar, D-471).
- The e2e suite was not run (no web app or browser in this session).

## User Setup Required

None - no external service configuration required. Nothing was pushed and no cloud project was touched; `social` is on only for the local rede-lab seed tenant (and was toggled on and restored for rede-demo inside integration cases).

## Next Phase Readiness

Ready for 09-04. The audience column, both policies and the seam constants have their final names; the Explorar form and indexes are decided in `09-03-SPIKE.md`; `listFeed` already takes `opts: { canModerate }`.

## Self-Check: PASSED

- Created files exist (migration, snapshot, pgTAP 201, feed-social.test.ts, contracts.test.ts, member-stamp.test.ts, the spike SQL and record): FOUND
- Commits `f91f43ef`, `0dab04fa`, `a5788de0`, `ec71d4d6`: FOUND
- RED before GREEN (`git log --grep` on `test(9-3)` and `feat(9-3)`): confirmed
- No attribution trailer in the four commit messages: confirmed (0 matches for the pattern in `0f06418f..HEAD`)

---
*Phase: 09-rede-social-follow-member-posts-and-explorar*
*Completed: 2026-10-19*
