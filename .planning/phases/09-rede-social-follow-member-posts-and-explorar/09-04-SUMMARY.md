---
phase: 09-rede-social-follow-member-posts-and-explorar
plan: 04
subsystem: api
tags: [social, feed, audiences, reels, indexes, explorar, moderator-view, D-471, D-475, D-480, D-483, D-484]

requires:
  - phase: 09-03
    provides: "feed_posts.visibility and the two restrictive policies, memberPostVisible, the scope=explorar branch, the spike record (CHOSEN_FORM: ANY_SET and three INDEXES lines)"
provides:
  - "Reels 'Todos' (GET /v1/feed?media=video) lists organization videos plus the viewer's live followees' and own member videos, newest first, on the same (created_at, id) cursor; Inicio and the community lanes never list a member post; a moderator's Reels lists none (D-480)"
  - "three expand-only partial indexes on feed_posts, exactly the INDEXES lines of 09-03-SPIKE.md: feed_posts_tenant_followers_created_idx, feed_posts_tenant_org_created_idx, feed_posts_tenant_org_nocommunity_created_idx"
  - "optional feedPageSchema.followsAnyone, emitted only on an empty first Explorar page of a non-moderator, decided in a second statement that reads the seam and no feed table (UI-D-494)"
  - "the three-audience table (predicate, index, who sees what) on listFeed"
  - "plan pins by index NAME on volume fixtures: pgTAP 201 (Explorar for 50 followees, 3 rare followees, a deep page, the moderator), 090 (Inicio, communities on and off), 130 (Reels with the member fragment); statement budget of 1 for Explorar (member and moderator) and Reels 'Todos'"
affects: [09-05, 09-06, 09-07, 09-08, 09-09, 09-10, 09-11, 09-13]

actuals:
  tokens: 17700
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "one predicate fragment per caller kind: the non-moderator member fragment names the post table only (a two-table disjunction became a join filter and flipped Reels to a Seq Scan), the moderator fragment adds the author's live membership"
    - "plan pins taken as the authenticated role with the viewer's claims, so the restrictive policies and the seam functions are inside the EXPLAIN as in production"
    - "empty-state flags decided by the server in a second statement that touches no feed table, so the feed statement budget stays at 1"

key-files:
  created:
    - supabase/migrations/20261019214205_feed_social_indexes.sql
    - supabase/migrations/meta/20261019214205_snapshot.json
  modified:
    - packages/modules/feed/db/schema.ts
    - packages/modules/feed/server/service.ts
    - packages/modules/feed/server/routes.ts
    - packages/modules/feed/contracts/index.ts
    - packages/modules/feed/tests/contracts.test.ts
    - apps/api/tests/integration/feed-social.test.ts
    - apps/api/tests/integration/feed-query-budget.test.ts
    - supabase/tests/201-feed-social-gate.sql
    - supabase/tests/090-feed.sql
    - supabase/tests/130-reels.sql
    - supabase/migrations/meta/_journal.json

key-decisions:
  - "Planning decision 1 (video path = the member fragment): memberPostVisible(false) plus READY_VIDEO_POST replaces the Inicio literal on media=video; no lane or route was added"
  - "Planning decision 2 (indexes come from the record): the three INDEXES lines were built verbatim; the Explorar statement stays ANY_SET with the literals p.visibility = 'followers' and p.community_id is null; every plan is pinned by name on a measured fixture"
  - "Planning decision 3 (followsAnyone is a second statement on an empty first page only): select cardinality(app.social_visible_author_ids()) > 1, no feed table, budget of 1 untouched, key absent otherwise and for a moderator"
  - "Planning decision 4 (blocked authors are hidden from the moderator too, RESEARCH Open Question 5): the moderator branch still requires the author's membership to be active, not blocked and not removed. A default the user can reverse with one predicate"
  - "Planning decision 5 (old indexes stay): the non-partial siblings were not touched; 090 keeps the two pre-Phase-9 statements and asserts they still plan as index scans"
  - "memberPostVisible(false) no longer tests ms.status: the seam set already holds only the caller and the LIVE followees, so the extra test changed no answer but made the predicate a two-table disjunction that flipped Reels' plan (measured)"
  - "Scaling trigger for the ANY_SET form (asked of this summary by the spike): switch Explorar to the LATERAL top-N form and create the per-author index I2 when a member who follows few authors examines thousands of rows per page (the spike's thresholds: Execution Time above 50 ms or more than 5000 shared hits on a deep page); re-run 09-03-spike.sql first"

requirements-completed: [SOCIAL-04, SOCIAL-09, SOCIAL-10, EXPL-02, EXPL-06]

coverage:
  - id: D1
    description: "Tracer: a follower's Reels 'Todos' lists the followed member's READY video beside the admin's newest first, a stranger's lists the admin's only, the author sees her own, Inicio and the community lanes list no member video, a moderator's Reels lists none"
    requirement: EXPL-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-social.test.ts#09 reels (6 cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Three audiences, one projection and one ordering expression; each page is one statement against the feed tables for a member, a moderator and Reels 'Todos'"
    requirement: SOCIAL-10
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-query-budget.test.ts#GET /v1/feed?scope=explorar (3 cases, exact budget of 1, non-empty pages)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The recorded indexes exist with literal partial predicates and the plans of Explorar (50 followees, 3 rare followees, a deep page), the moderator read, Inicio (communities on and off) and Reels 'Todos' are pinned by index name with no Seq Scan on feed_posts"
    requirement: SOCIAL-10
    verification:
      - kind: pgtap
        ref: "supabase/tests/201-feed-social-gate.sql section 7 (10 tests), 090-feed.sql (4 tests), 130-reels.sql (4 pinned tests, member fragment)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The moderator's Explorar lists every live member post without following anyone, canManage false, never the admin's own organization post; a real support user answers 403; a tenant without social answers 404 MODULE_DISABLED even for its own admin"
    requirement: EXPL-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-social.test.ts#09 explorar 9"
        status: pass
    human_judgment: false
  - id: D5
    description: "followsAnyone: false for a member who follows nobody, true for a silent live followee, false for a blocked-only followee, absent for a moderator, absent on a cursor page"
    requirement: EXPL-02
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/contracts.test.ts#followsAnyone (4 cases)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed-social.test.ts#09 explorar 1, 2, 3, 6"
        status: pass
    human_judgment: false
  - id: D6
    description: "Adjacency and ordering: a same-microsecond organization post and member post land in different audiences; a limit-1 walk of Explorar and of Reels 'Todos' neither duplicates nor skips tied rows; a cursor survives a new follow; a tampered or foreign cursor degrades to page 1"
    requirement: SOCIAL-04
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-social.test.ts#09 explorar 4, 5, 6, 7 (EP-13, EP-15, EP-47, EP-49, EP-54, EP-56)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Blocked authors leave Explorar, Reels and the moderator's Explorar and return with identical ids and counts on unblock; social off hides everything (404 on the scope, member videos gone from Reels, Inicio unchanged) and turning it on restores the original order; no follow row is lost"
    requirement: SOCIAL-09
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-social.test.ts#09 explorar 3, 8, 10, 11 (EP-26, EP-28, EP-48, EP-55)"
        status: pass
    human_judgment: false
  - id: D8
    description: "Whether the moderator should also lose a BLOCKED author's posts (RESEARCH Open Question 5) and whether ANY_SET stays acceptable as tenants grow"
    requirement: SOCIAL-10
    verification: []
    human_judgment: true
    rationale: "Both are product and scale judgements recorded as defaults (planning decision 4 and the scaling trigger in key-decisions); no test can say they are the right ones."

duration: 18min
completed: 2026-10-19
plan_head_before: 80b544eecf4dfcec225927bfd9d4af2f3513cb99
commits: 5
status: complete
---

# Phase 9 Plan 04: The three audiences, finished and fast Summary

**Reels 'Todos' now mixes the organization's videos with the videos of the people a member follows and their own, Explorar and the moderator's all-members read are served by the three partial indexes the spike chose (`ANY_SET` form, kept), `followsAnyone` tells an empty Explorar why it is empty, and every audience is one statement pinned by index name on a volume fixture.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-10-19T21:39:18Z
- **Completed:** 2026-10-19T21:58Z (approximate; this SUMMARY and the tracking commit follow)
- **Tasks:** 3 (one tracer, TDD; one blocking schema; one TDD)
- **Files modified:** 13 including one generated drizzle snapshot (9942 lines)

## Accomplishments

- **Tracer (Task 1).** On rede-lab with `social` on, Alvaro (who follows Helena) lists Helena's ready video beside the admin's in `GET /v1/feed?media=video`, newest first; Marcos (follows nobody) lists the admin's only; Helena lists her own; no Inicio holds either member video for anyone; the lab admin's Reels holds no member video while his Explorar does (D-480); a member post cannot be written into a community (`feed_posts_visibility_shape_chk`) and the community lanes hold none. The change is one expression: the video path swaps the Inicio literal for `memberPostVisible(false)`.
- **Indexes and plans (Task 2).** One generated, expand-only migration `20261019214205_feed_social_indexes.sql` creates exactly the three `INDEXES:` lines of the spike record (literal partial predicates, `desc nulls first`, `tenant_id` first). The Explorar statement stays `ANY_SET` (the record's choice). Pinned by index name with no `Seq Scan on feed_posts`: Explorar for a member who follows 50 authors, for one who follows the 3 rare authors, a deep keyset page, and the moderator's read (all `feed_posts_tenant_followers_created_idx`, as the authenticated role with the viewer's claims, so the restrictive policies and seam functions are inside the plan); Inicio with communities on (`feed_posts_tenant_org_created_idx`) and off (`feed_posts_tenant_org_nocommunity_created_idx`) in 090; Reels 'Todos' in 130 (`feed_posts_tenant_video_created_idx`, unchanged). Dropping the followers index in a scratch copy of 201 turned the Explorar pins red (tests 51 and 53 among them), so the pins are falsifiable.
- **Budget.** `feed-query-budget.test.ts` gained three exact cases at the budget of 1: a member's Explorar (a full page of 10 followee posts, `followsAnyone` absent), a moderator's Explorar (a full page of 10), and Reels 'Todos' with the member fragment.
- **Audience behavior (Task 3).** `followsAnyone` on `feedPageSchema` (optional, boolean) and in `listFeed`: empty first Explorar page of a non-moderator, one extra statement `select cardinality(app.social_visible_author_ids()) > 1`. The `09 explorar` block holds 11 cases covering EP-13, 14, 15, 26, 28, 47, 48, 49, 54, 55, 56 and D-475/D-483/D-484.

## Task Commits

1. **Task 1 (tracer, TDD): the member fragment as the video-path audience**
   - RED: `35250693` (test)
   - GREEN: `a9dec3cf` (feat)
2. **Task 2: [BLOCKING schema] indexes, Explorar plan pins, 090/130 updates, budget** - `8a2c8e3f` (feat)
3. **Task 3 (TDD): followsAnyone and the audience matrix**
   - RED: `5df17ac7` (test)
   - GREEN: `b43cb7be` (feat)

**Plan metadata:** committed separately (docs: complete plan, then state and roadmap).

## TDD Gate Compliance

Task 1: `test(09-04)` `35250693` precedes `feat(09-04)` `a9dec3cf`. Task 3: `test(09-04)` `5df17ac7` precedes `feat(09-04)` `b43cb7be`. No REFACTOR commit.

RED evidence (real runs, no normalizer was needed because the verdict is read from Vitest's own assertion text):
- Task 1: `vitest run tests/integration/feed-social.test.ts -t "reels"` against the previous service: 2 failed, 4 passed (case 1 and case 3 failed on `expect(found).toContain(<Helena's video id>)`; the other four are the negative controls: stranger, Inicio, moderator, community lane). The RED commit ships no stubs.
- Task 3: `vitest run tests/contracts.test.ts`: 2 failed (cases 8 and 9, `followsAnyone` unknown to the strict schema), 9 passed; `vitest run tests/integration/feed-social.test.ts -t "09 explorar"`: 2 failed (cases 1 and 3, `expected { items: [], nextCursor: null } to deeply equal { items: [], nextCursor: null, followsAnyone: ... }`), 9 passed (the audience matrix characterizes behavior that earlier tasks of this plan and plan 03 already deliver).

## Files Created/Modified

- `supabase/migrations/20261019214205_feed_social_indexes.sql` (+ journal, snapshot) - generated, three `create index`, header names SOCIAL-04, SOCIAL-10, EXPL-02 and the spike record
- `packages/modules/feed/db/schema.ts` - the three index declarations with the docblock saying which read each serves
- `packages/modules/feed/server/service.ts` - the video-path predicate, `memberPostVisible` split by caller kind, `followsAnyone`, the three-audience table, the community-lane comment
- `packages/modules/feed/server/routes.ts` - the list route's description (empty-state key, Reels 'Todos')
- `packages/modules/feed/contracts/index.ts` - `followsAnyone`
- Tests: `contracts.test.ts`, `feed-social.test.ts` (`09 reels` 6 cases, `09 explorar` 11 cases), `feed-query-budget.test.ts` (3 cases), pgTAP `201` (47 -> 57 tests), `090` (40 -> 44), `130` (20, statements and fixture changed)

## Decisions Made

Planning decisions 1-5 were followed as written (see `key-decisions`). Beyond them: the non-moderator member fragment no longer repeats the author's membership test (deviation 1), and the scaling trigger of the `ANY_SET` form is recorded.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug / T-09-11] The shared member fragment flipped Reels 'Todos' to a sequential scan once the fixture was mixed**
- **Found during:** Task 2 (updating `130-reels.sql` so half of the volume fixture's videos are member posts)
- **Issue:** `memberPostVisible` tested `ms.status/blocked_at/deleted_at` inside the same disjunction as `p.visibility` and `p.author_user_id = any(...)`. Because it names two tables, the disjunction cannot be pushed below the join to `memberships`; the planner treated it as a join filter, estimated the join at 24 of 496 video rows, and chose `Hash Join` over `Seq Scan on feed_posts` instead of `feed_posts_tenant_video_created_idx` (4 pgTAP failures, quoted plan above in the 130 comment). A real tenant with member videos would have met the same plan.
- **Fix:** for the non-moderator the predicate is `p.visibility = 'tenant' or (social_enabled and p.author_user_id = any(seam set))`, over `p` alone (a plain filter). This changes no answer: the seam set already holds only the caller and the live followees. The liveness test on `ms` stays on the moderator branch (D-484 default), where there is no author set.
- **Files modified:** `packages/modules/feed/server/service.ts`, `supabase/tests/130-reels.sql`
- **Verification:** 130 green again with the mixed fixture; the 14 `09 explorar`/`09 reels` blocked-author cases and 201 stay green
- **Commit:** `8a2c8e3f`

**2. [Process] Plan-sanctioned test rewrites, listed for transparency**
- `090-feed.sql` kept its two pre-Phase-9 statements and gained two Inicio statements with the literal `p.visibility = 'tenant'` plus 2,000 member posts in the fixture; `130-reels.sql` statements now carry the member fragment and half the video fixture is `followers`. The plan asked for exactly this ("update any assertion whose index changed"). No pinned name changed.

---

**Total deviations:** 1 auto-fixed (Rule 1), 1 process note
**Impact on plan:** the fix is necessary for the plan's own T-09-11 mitigation (named-index pins on a mixed volume); no architectural change.

## Issues Encountered

- `git add` with a shell variable holding several paths failed under zsh (no word splitting); rerun with an array. Nothing was staged or committed by the failed call.
- A scratch copy of 201 run with plain `psql` failed on pgTAP's search path; the scratch copies were run through `supabase test db` instead and deleted (`git status` shows no leftover `zz-tmp-*` file).
- Disk stayed above 6 GB free throughout; no `next build` was run.

## Verification Results

- Task 1 verify: `pnpm --filter @rede-social/module-feed test` 273 passed (22 files); module `typecheck` and `lint` clean; `@rede-social/api` `typecheck` and `lint` clean; `pnpm boundaries`: "Checked 1653 files in 18 packages, no issues found". After `pnpm db:reset && pnpm db:seed`: `vitest run tests/integration/feed-social.test.ts tests/integration/reels.test.ts -t "reels"` 2 files, 7 passed; the two files whole: 31 passed.
- Task 2 verify: `pnpm db:generate | grep "No schema changes"` -> "No schema changes, nothing to migrate"; reset, seed, `pnpm supabase test db`: `Files=38, Tests=2000, Result: PASS` (1986 before this plan); `vitest run tests/integration/feed-query-budget.test.ts tests/integration/feed-social.test.ts`: 2 files, 34 passed. Acceptance: one `*_feed_social_indexes.sql` sorting after `*_feed_social_visibility.sql`; destructive-words grep prints 0; the three spike index names are in the schema and the migration; `Seq Scan` in 201; `explorar` in the budget test.
- Task 3 verify: module-feed 277 passed (contract file 11); `@rede-social/api test` 8 files, 72 passed; after reset and seed `vitest run tests/integration/feed-social.test.ts tests/integration/feed.test.ts tests/integration/reels.test.ts tests/integration/feed-query-budget.test.ts`: 4 files, 75 passed.
- Phase-level: reset, seed, `pnpm supabase test db` `Files=38, Tests=2000, Result: PASS`; `pnpm db:generate` "No schema changes"; then the full `pnpm --filter @rede-social/api test:integration` (run AFTER pgTAP): `Test Files 74 passed (74), Tests 1460 passed (1460)`; `pnpm --filter @rede-social/web typecheck` (`next typegen && tsc --noEmit`) clean.
- Not run: the Playwright e2e suite, the web Vitest suite, `turbo typecheck`/`build` (they pull a web build and the contract change is an optional key the web does not yet read), and any cloud command. Nothing was pushed.

**`db:reset` ran five times, all local:** (1) Task 1's verify, (2) after the index migration was generated (to apply it and re-baseline pgTAP), (3) Task 2's verify chain, (4) Task 3's verify, (5) before the final pgTAP run. Each was followed by `pnpm db:seed`. The local database is NOT reset after the last full integration run, so it carries that run's residue; run `pnpm db:reset && pnpm db:seed` before the next pgTAP run.

## Known Stubs

None. Both RED commits shipped no stubs.

## Threat Flags

None new. The only new surface is `followsAnyone`, an optional boolean on a page the caller can already read; it reveals only whether the caller follows a live member, which the caller's own `/v1/social/me/following` already says.

## Observations for later plans (not fixed here)

- **Plan 08 (web):** `followsAnyone` is the input of the three Explorar empty states; read it from `FeedPage`, do not infer it. A tampered cursor is a first page, so it can carry the key too.
- **Plan 07 (moderation):** the moderator fragment requires the author to be active (D-484 default). A moderator who must remove a blocked member's post has to unblock first, as the RESEARCH default says; reverse it by dropping the three `ms.*` conjuncts of the moderator branch.
- **Reels lanes (`video-communities`):** untouched on purpose; a member post has no community, so a lane can never hold one.
- **ANY_SET caveat from the spike still stands:** cost per Explorar page is about `12 / density` of the followed set in the tenant's member timeline and grows with the tenant, not with page depth. The trigger and the escape hatch (LATERAL top-N with the per-author index I2, re-measured with `09-03-spike.sql`) are in `key-decisions`.
- **Dashboard (plan 13's DEPLOY.md item):** the owner dashboard still reads `feed_posts` in the system lane and counts member posts while `social` is on (carried from 09-03; not changed here).

## User Setup Required

None - no external service configuration required. `social` was toggled for rede-lab and restored inside cases; no cloud project was touched and nothing was pushed.

## Next Phase Readiness

Ready for 09-05. The audiences, the indexes and the pins have their final names.

## Self-Check: PASSED

- Created files exist (migration, snapshot): FOUND
- Commits `35250693`, `a9dec3cf`, `8a2c8e3f`, `5df17ac7`, `b43cb7be`: FOUND
- RED before GREEN for both TDD tasks (`git log --grep` on `^test\(0*9-0*4\)` and `^feat\(0*9-0*4\)`): confirmed
- No attribution trailer in the five commit messages: confirmed

---
*Phase: 09-rede-social-follow-member-posts-and-explorar*
*Completed: 2026-10-19*
