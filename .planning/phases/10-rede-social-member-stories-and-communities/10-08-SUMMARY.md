---
phase: 10-rede-social-member-stories-and-communities
plan: 08
subsystem: api
tags: [member-stories, explorar, authors-read, tracer, spike, blocking-schema-push, D-705, D-708, D-714, D-717, D-718, D-616]

requires:
  - phase: 10-04
    provides: "stories.visibility, stories_audience_gate (branch 3 EXISTS_JOIN), the A10 first half (strip stays off branch 3 by naming the audience literal)"
  - phase: 10-05
    provides: "withCommunitiesEnabled and withStoriesEnabled test helpers"
  - phase: 10-07
    provides: "the author { membershipId, displayName, avatarUrl } wire on member stories, GET /v1/stories/mine for members, the story_removed moderation row"
provides:
  - "GET /v1/stories/authors: Explorar's story row, one circle per author. Member scope: ONE unpaged page (own circle first, then unseen before seen, newest, membership_id); moderator scope (moderation.manage): keyset pages of 20 over every live member with a live member story, isSelf false"
  - "GET /v1/stories/authors/{membershipId}: one author's live stories oldest first through the story projection (viewerSeen included), bare 404 on zero readable rows"
  - "memberStoryVisible(canModerate): the service form of stories_audience_gate on the by-id read, the view write, like and unlike, the comment list and create, the group read"
  - "storyAuthorCircleSchema, storyAuthorsPageSchema, storyAuthorsQuerySchema, authorStoriesSchema, STORY_AUTHORS_PAGE_SIZE (20)"
  - "stories_tenant_author_expires_idx, the index chosen by the A10 measurement (migration 20261111163020_member_stories_authors.sql, expand-only)"
  - "10-08-SPIKE.md and 10-08-spike.sql: CHOSEN_FORM LATERAL"
affects: [10-09, 10-11, 10-12, 10-14, 10-15]

actuals:
  tokens: 38000
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "Service-form audience fragment written side by side with the restrictive policy, with canModerate rendered as a literal and computed by the route before the transaction opens"
    - "LATERAL aggregate over a followed set (unnest of the visible-author seam) instead of a grouped scan, chosen by measurement on a volume fixture"
    - "Keyset over an aggregate with a MIXED order (latest desc, id asc) written out as an explicit comparison instead of keysetComparison"
    - "Moderator-only statement scope: the flag picks a different statement, never a different predicate inside one"

key-files:
  created:
    - .planning/phases/10-rede-social-member-stories-and-communities/10-08-spike.sql
    - .planning/phases/10-rede-social-member-stories-and-communities/10-08-SPIKE.md
    - supabase/migrations/20261111163020_member_stories_authors.sql
    - supabase/migrations/meta/20261111163020_snapshot.json
  modified:
    - packages/modules/stories/contracts/index.ts
    - packages/modules/stories/server/service.ts
    - packages/modules/stories/server/routes.ts
    - packages/modules/stories/db/schema.ts
    - packages/modules/stories/README.md
    - packages/modules/stories/tests/contracts.test.ts
    - supabase/migrations/meta/_journal.json
    - supabase/tests/231-member-stories.sql
    - apps/api/tests/isolation-inventory.ts
    - apps/api/tests/integration/isolation.test.ts
    - apps/api/tests/integration/member-stories.test.ts
    - apps/api/tests/integration/feed-query-budget.test.ts

key-decisions:
  - "A10 (second half) embodied: the authors read was measured on a volume fixture (8000 live member stories, 200 members, 3000 expired, 500 deleted, 3000 organization; three runs) and the spike ends CHOSEN_FORM: LATERAL with the index stories_tenant_author_expires_idx (tenant_id, author_user_id, expires_at desc nulls first, id desc nulls first) where deleted_at is null and visibility = 'followers'. The grouped form (the tracer statement) was 131 to 137 ms on the moderator's pages with no index able to help; LATERAL is 12 ms. Member reads: 1.2 and 4.9 ms. Início strip untouched (0.8 to 0.9 ms)"
  - "Ordering split (Claude's discretion, recorded): a member's row is ordered fully by the server (is_self desc, has_unseen desc, latest desc, membership_id) in one unpaged page; the moderator's row is paged by recency only (latest desc, membership_id asc) and the web puts unseen first inside the pages it has loaded, because 'unseen before seen' cannot be a stable keyset"
  - "The authors routes check the social switch BEFORE the permission flags (module, then role): with social off a member does not even hold social.participate, so the permission check first would have answered 403 where D-718 says 404 MODULE_DISABLED. A real support session is 403 with social on"
  - "Explorar's group read stays follow-bound: a member story readable only because a community highlight holds it (branch 3) is NOT readable from Explorar (the group read adds the social term and, for a member, the visible-author predicate on top of memberStoryVisible), so a stranger still gets the bare 404 on a story that sits in a highlight"
  - "The new contract is storyAuthorCircleSchema, not storyAuthorSchema: storyAuthorSchema already names the three-field author of a member story (10-07, A7), so the circle (seven keys) got its own name; the plan text used the same name for both"
  - "social off: both routes answer 404 MODULE_DISABLED for everyone, the moderator included. This agrees with plan 07's finding (pgTAP 231 section 3: with social off the admin reads zero member stories); the gate was not touched and nothing here reopens that decision"

patterns-established:
  - "A keyset over an aggregate costs the same on every page; the bound is the number of live authors, which the per-author index range and the page size keep small"
  - "The shared kernel seams (SOCIAL_ENABLED, SOCIAL_VISIBLE_AUTHOR_IDS) feed both the policy and the service fragment, so the two cannot disagree about who a follower is"

requirements-completed: [MSTORY-03, MSTORY-04, MSTORY-08, MPUB-05, MPUB-07]

coverage:
  - id: D1
    description: "Tracer: Alvaro (follows Helena) reads Helena's circle with exactly the seven keys and not Marcos's, no own item without a live story, no user id on the wire; the group read returns her live stories oldest first with viewerSeen; Marcos gets the bare 404 on the group, the story id, a like, the comment list and a comment while Alvaro's succeed; the lab admin reads Helena's group without a follow; a real support session is 403 on both routes"
    requirement: MSTORY-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/member-stories.test.ts#10 authors (cases 1-4)"
        status: pass
      - kind: unit
        ref: "packages/modules/stories/tests/contracts.test.ts#10-08 storyAuthorCircleSchema"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-718: both routes answer 404 MODULE_DISABLED when social is off (member and moderator), come back with social on; a malformed or unknown membership id is the bare 404; EP-61 empty answers 200 { items: [], nextCursor: null }"
    requirement: MPUB-05
    verification:
      - kind: integration
        ref: "member-stories.test.ts#10 authors (cases 5-7); 10 authors moderator case 4"
        status: pass
    human_judgment: false
  - id: D3
    description: "EP-60 expiry boundary (expires_at in the future is in, exactly at insert or earlier is out, the circle leaves when the window closes) and EP-62 ordering (own first, unseen before seen, newest, membership_id tiebreak with two authors at the same instant)"
    requirement: MSTORY-03
    verification:
      - kind: integration
        ref: "member-stories.test.ts#10 authors moderator (cases 1-2)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Moderator row: limit 2 over five authors pages 2, 2, 1 with each author once even when a story is published between pages, a tampered cursor is page 1, isSelf false, no organization circle"
    requirement: MSTORY-03
    verification:
      - kind: integration
        ref: "member-stories.test.ts#10 authors moderator (case 3)"
        status: pass
    human_judgment: false
  - id: D5
    description: "MSTORY-08 / D-708 / D-616: blocking or removing the author drops the circle and 404s the group for the follower AND the moderator, unblocking restores both, nothing is deleted; a viewer-blocked author leaves only the viewer's row and the blocked author's row is unchanged; a moderator-deleted story leaves the read"
    requirement: MSTORY-08
    verification:
      - kind: integration
        ref: "member-stories.test.ts#10 authors moderator (cases 5-7)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A10 measured and built as recorded: the spike ends CHOSEN_FORM: LATERAL with the named index; the index exists by name with its partial predicate and both the member read (3 followees, 6000 member stories) and the moderator's page 1 walk it by name with no Seq Scan on stories; the story_views_uq index-only probe and the strip pins are unchanged"
    requirement: MPUB-07
    verification:
      - kind: pgtap
        ref: "supabase/tests/231-member-stories.sql#section 11 (7 new tests, plan 106)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Statement budget and isolation: one statement per authors page (member and moderator) and one per group read, story_views never read on its own; both routes in the isolation inventory with a lab positive control, the cross-tenant bare 404 and the wrong-host 403; the migration is expand-only and db:generate reports no schema changes"
    requirement: MPUB-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-query-budget.test.ts#GET /v1/stories/authors; isolation.test.ts#phase 10 sweep"
        status: pass
      - kind: unit
        ref: "apps/api/tests/unit/isolation-inventory.test.ts"
        status: pass
    human_judgment: false

duration: about 50min
completed: 2026-11-11
status: complete
plan_head_before: 4b0ab2966a4631fc10f02dd704a97e9933287dae
commits: 6
---

# Phase 10 Plan 08: Explorar Authors Read Summary

**Explorar's story row now has its API: a member reads one circle per followed author (own circle first, unseen before seen) and each circle opens that author's live stories lazily, a moderator reads every live member's circle cursor-paged, an unreadable story is the bare 404 in the statement as well as in RLS, and the grouped form the tracer started with was replaced by a LATERAL form chosen by measurement (131 ms down to 12 ms on the moderator's pages) with its own index.**

## Performance

- **Duration:** about 50 min
- **Completed:** 2026-11-11
- **Tasks:** 3 of 3. Task 1 is the tracer (red `935d91c2`, green `728ecad5`; its automated verify ran green before the expansion tasks, `Tracer verified end-to-end, expanding`). Task 2 is the measurement plus the local schema push. Task 3 has its red commit first.
- **Files:** 4 created, 12 modified

## Accomplishments

- **Tracer (Task 1):** `GET /v1/stories/authors` and `GET /v1/stories/authors/{membershipId}`, the seven-key circle contract, `memberStoryVisible(canModerate)` on the by-id read, the view write, like, unlike and the comment list and create (the routes compute the moderator flag before the transaction opens), `social` off is 404 `MODULE_DISABLED`, a caller with neither `social.participate` nor `moderation.manage` is 403.
- **Measurement and schema push (Task 2):** `10-08-spike.sql` (27 `explain` statements, one transaction ending in `rollback;`, run three times) and `10-08-SPIKE.md`; `CHOSEN_FORM: LATERAL`; the expand-only migration `20261111163020_member_stories_authors.sql` (one index); `listStoryAuthors` switched to the recorded form; pgTAP 231 pins the index by name (plan 99 to 106).
- **Moderator row and filters (Task 3):** keyset-paged moderator scope (every live member with a live member story, newest first, `isSelf` false), the viewer-block and live-author filters on both reads, one statement per page and per group, both routes in the isolation inventory with a case written first.

## Task Commits

1. **Task 1 RED:** `935d91c2` (test): the circle contract cases and the failing authors/group/404 cases.
2. **Task 1 GREEN:** `728ecad5` (feat): contracts, `memberStoryVisible`, both routes, `listStoryAuthors` (member form G) and `listAuthorStories`.
3. **Task 2:** `7ebcf209` (feat): spike script and record, index, migration, journal and snapshot, LATERAL member read, pgTAP 231 section 11.
4. **Task 3 RED:** `d455015f` (test): moderator cursor, ordering, expiry boundary, blocks, budget cases, isolation case and the two inventory entries.
5. **Task 3 GREEN:** `2924dd6a` (feat): the moderator scope with its keyset.
6. **Docs:** `b6e21aee` (docs): the stories README lists the new contracts and service functions.

**Plan metadata:** this SUMMARY is committed separately. `.planning/STATE.md` and `.planning/ROADMAP.md` were not touched (the orchestrator owns them). Nothing was pushed and no hosted project was touched.

## A10 (second half): the measurement

Fixture: one tenant, 200 members, 8000 live member stories (members 1..5 wrote 100 each), 3000 expired, 500 soft-deleted, 3000 organization stories; viewer VA follows 50 authors, viewer VB follows 3; the moderator is the admin lane. Medians of three runs, every read as the `authenticated` lane with all gates inside the plan.

| Read | G (grouped) with the new index | L (LATERAL) with the new index | Without a new index |
|------|-------------------------------:|-------------------------------:|--------------------:|
| member, 50 followees | 18.1 ms | **4.9 ms** | G 39.7 / L 33.7 ms |
| member, 3 followees | 4.0 ms | **1.2 ms** | G 5.1 / L 3.4 ms |
| moderator page 1 | 45.5 ms | **12.0 ms** | G 134.5 / L 121.5 ms |
| moderator page 5 | 45.5 ms | **12.0 ms** | G 131.8 / L 119.9 ms |
| Início strip (8000 member stories present) | 0.8 ms | 0.8 ms | 0.9 ms |

`10-08-SPIKE.md` ends with `CHOSEN_FORM: LATERAL` and `INDEXES:` listing `stories_tenant_author_expires_idx`. The decision rule (page 5 above 50 ms or above 5000 buffer hits) sent the read to LATERAL; both forms trip the 5000-hit clause on the moderator reads (two thirds of L's hits are the per-story `story_views` index-only probe), so the clause that separates them is execution time, and the spike says so. No plan in any state contains a `Seq Scan on stories`.

## Verification

- `pnpm db:reset && pnpm db:seed`, then `pnpm db:generate` printed `No schema changes, nothing to migrate`, then `pnpm supabase test db`: 65 files, 4470 tests, PASS (run before any integration file, twice: after Task 2 and again at the end). The flaky pin in `232-feed-community-audience.sql` test 56 did not recur and `pnpm db:reset` did not fail with `LegacyDbSetupError`.
- Integration, final run in one invocation: `member-stories`, `stories`, `isolation`, `feed-query-budget`, `moderation-comments`, `stories-author-photo`: 236 tests, all pass. The plan's three files alone: 135 pass; `stories.test.ts` alone: 77 pass.
- Units: module-stories 202 passed, api 134 passed (the isolation inventory and the module README checks included). `tsc --noEmit` through turbo for module-stories and api (`TURBO_CACHE=local:r`, `--concurrency=4`), `pnpm boundaries` and Biome (api lint, stories module) are clean. `apps/web` was not touched; its two known red spots (plan 11 and plan 12) are as before.
- Acceptance greps of the three tasks all pass (`memberStoryVisible`, `authors`, `storyAuthorSchema`, `10 authors`, `CHOSEN_FORM`, `INDEXES:`, the spike ends with `rollback;` with 27 `explain` statements, exactly one `*_member_stories_authors.sql` with zero `drop`/`rename`/`alter column`, `stories_tenant_author` in 231, both inventory keys, `phase 10 sweep`, `is_blocked_by_viewer`, `keysetComparison`, `10 authors moderator`).

## TDD Gate Compliance

Tasks 1 and 3 each have their `test(10-08)` commit before their `feat(10-08)` commit. The Task 1 RED failed on the planned behaviour (the contract names did not exist; the routes answered 404 where 200, 403 and `MODULE_DISABLED` were due). The Task 3 RED failed on the moderator behaviour (an empty moderator row where five circles are due, no moderator circle for the lab admin in the isolation positive control, no `nextCursor`); the block, ordering and expiry cases passed at once because the member form already carried those filters, and stand as guards. Task 2 is `type="auto"` without `tdd` (a measurement and a migration). `gsd_run check tdd-red-evidence` was not used (Vitest emits no TAP), as in plans 03 to 07.

## Decisions Made

A10, the ordering split and the four decisions listed under `key-decisions` above (module-before-permission order on the authors routes, the follow-bound group read, the new circle contract name, social off for the moderator).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan inconsistent with the code] The contract name `storyAuthorSchema` was already taken**
- **Found during:** Task 1 (GREEN)
- **Issue:** the plan names the seven-key circle `storyAuthorSchema`, but plan 07 already published a `storyAuthorSchema` for the three-field `author` of a member story, which `storySummarySchema` embeds.
- **Fix:** the circle is `storyAuthorCircleSchema` (type `StoryAuthorCircle`); `storyAuthorSchema` is unchanged and a contract test pins that the two are different. The plan's acceptance grep for `storyAuthorSchema` still passes. No downstream plan names the circle contract (greps of plans 09 to 15 found none).
- **Files modified:** `packages/modules/stories/contracts/index.ts`, `packages/modules/stories/tests/contracts.test.ts` | **Commit:** `728ecad5`

**2. [Rule 1 - Plan order vs the social switch] Module check first, then the permission check**
- **Found during:** Task 1 (the D-718 case)
- **Issue:** the plan lists the permission 403 and the `MODULE_DISABLED` 404 without an order; with `social` off a member does not hold `social.participate` at all, so checking permissions first answers 403 where the truth says 404.
- **Fix:** `authorsAudience` asks `moduleFlags.isEnabled(ctx, 'social')` first (the ROLE-06 order: not here before not allowed), then the two permission flags. A support session is 403 with social on.
- **Files modified:** `packages/modules/stories/server/routes.ts` | **Commit:** `728ecad5`

**3. [Rule 2 - Missing critical functionality] The group read must stay follow-bound**
- **Found during:** Task 1
- **Issue:** the plan says the group read uses `memberStoryVisible(canModerate)`, whose branch 3 (a community highlight holds the story) would let a stranger read Helena's story from Explorar when it also sits in a highlight, breaking the bare 404 for a non-follower (T-10-30, D-705).
- **Fix:** `listAuthorStories` adds the social term and, for a member, `s.author_user_id = any (SOCIAL_VISIBLE_AUTHOR_IDS)` on top of the fragment; a moderator reads any live member's circle. The fragment is unchanged for the by-id, like, view and comment statements, where branch 3 is the rule.
- **Files modified:** `packages/modules/stories/server/service.ts` | **Commit:** `728ecad5`

**4. [Rule 3 - Blocking] The by-id routes had to compute the moderator flag**
- **Found during:** Task 1
- **Issue:** `memberStoryVisible(canModerate)` needs the flag in `getStory`, `likeStory`, `unlikeStory`, `markStoriesSeen` and `createStoryComment`, whose routes did not read permissions.
- **Fix:** each service function takes an optional `{ canModerate }` (default false, which fails closed to the narrower predicate) and the routes pass `permissionsForRequest(...).includes('moderation.manage')` read before the transaction opens. The list-comments route already did.
- **Files modified:** `packages/modules/stories/server/routes.ts`, `service.ts` | **Commit:** `728ecad5`

**5. [Rule 3 - Blocking] The test sweep could not delete moderation rows**
- **Found during:** Task 3 (the red run of the moderator delete case)
- **Issue:** `member-stories.test.ts`'s `sweep()` ran `delete from moderation_log`, which the append-only trigger refuses once a row exists (plan 07's cases never wrote one in this file). The aborted `afterAll` also left the local `rede-lab` `notifications` module switched ON, which turned `isolation.test.ts` case `h` red.
- **Fix:** the sweep deletes this file's own `story_removed` rows inside a transaction with `session_replication_role = replica` (the `move-copy.test.ts` precedent, scoped to this file's story ids); the local `notifications` row of `rede-lab` was set back to `false` by hand (the seed's value) and the final runs leave no residue (no `stories`, `notifications` or `ms08-` identities left).
- **Files modified:** `apps/api/tests/integration/member-stories.test.ts` | **Commit:** `d455015f`

**6. [Rule 3 - Blocking] `pg_indexes` prints a descending key as plain `DESC`**
- **Found during:** Task 2 (pgTAP 231 section 11)
- **Issue:** the definition check I wrote for `expires_at DESC NULLS FIRST` failed; for a descending key `NULLS FIRST` is Postgres' default and is not printed.
- **Fix:** the test matches `(tenant_id, author_user_id, expires_at DESC, id DESC)` and says why in the file.
- **Files modified:** `supabase/tests/231-member-stories.sql` | **Commit:** `7ebcf209`

**7. [Rule 3 - Blocking] The stories README is outside the plan's file list**
- **Fix:** one line naming the new contracts and service functions (the module README is the published surface); committed as `b6e21aee`.

**8. [Plan ordering note] The api unit inventory check was red between the Task 1 and Task 3 red commits**
- The plan puts the two inventory entries in Task 3, but the unit check `apps/api/tests/unit/isolation-inventory.test.ts` fails as soon as a mounted route has no entry, so `pnpm --filter @rede-social/api test` was red on `728ecad5` and `7ebcf209` and is green from `d455015f`. Task 1's own verify (module tests, typecheck, boundaries, the two integration files) was green; nothing was pushed.

**Total deviations:** 8 (Rule 1 x2, Rule 2 x1, Rule 3 x4, plan-order note x1). **Impact:** no scope change; items 1 and 3 change a name and tighten a predicate the plan text got slightly wrong.

## Issues Encountered

- A story whose `expires_at` equals the insert transaction's `now()` is out of the read by the time the API asks (`expires_at > now()`), which is what EP-60 wants; the test uses `adminSql` timestamps on both sides of the boundary and waits 4.6 seconds for a story to expire inside the case.
- The moderator's per-story `story_views` probe is the dominant buffer cost (16000 of 24.5k hits on page 1); it is the constant-tenant form that keeps `story_views_uq` index-only (pgTAP 120's pin), so it was left alone.

## Known Stubs

None. The `isMember` flag of `listStoryAuthors` is read by the route's guard and passed through for the service signature the plan names; the service branches on `canModerate` only.

## Threat Flags

None beyond the plan's register. Mitigations in place: T-10-30 (`memberStoryVisible` beside `stories_audience_gate`, the group read answers 404 on zero readable rows and stays follow-bound, the isolation inventory and sweep with positive controls, 403 for support), T-10-31 (the live-followee seam, the live-member join, `app.is_blocked_by_viewer`, block, unblock, removal and viewer-block cases), T-10-32 (cursor-bounded pages, the measured form and index, the EXPLAIN pin by name, the statement budget), T-10-33 (kernel envelope with total decoders, the five-author `limit = 2` test).

## Notes for the plans after this one

- **Plan 09 (highlight owner seam, same service file):** `memberStoryVisible` takes the alias `s` and is exported to nothing; reuse it by name inside the file. A story held by a community highlight stays readable by id, like and comment (branch 3) but is not in Explorar.
- **Plan 11 and 12 (web):** `GET /v1/stories/authors` for a member is one unpaged page (`nextCursor` always null) already ordered; for a moderator `limit` is 1..50 (default 20), `isSelf` is always false, and the web puts unseen first inside the loaded pages only. The contract names are `storyAuthorCircleSchema`, `storyAuthorsPageSchema`, `storyAuthorsQuerySchema`, `authorStoriesSchema`. With `social` off both routes are 404 `MODULE_DISABLED` for everyone, the moderator included (consistent with pgTAP 231 section 3 and plan 07's note); a group that yields no readable story is a bare 404 the web should show as "Story não encontrado".
- **Plan 15 (rollout):** the migration adds one index only, so it can be applied ahead of the code. The web-first order from plan 07 (A7) is unchanged.

## User Setup Required

None. The local database was reset and seeded (Igor's word of 2026-11-11, local only); the integration suites left no residue.

## Self-Check: PASSED

- FOUND: `10-08-SPIKE.md` (`CHOSEN_FORM: LATERAL`, `INDEXES:`), `10-08-spike.sql` (ends with `rollback;`, 27 `explain`), `supabase/migrations/20261111163020_member_stories_authors.sql`, `supabase/migrations/meta/20261111163020_snapshot.json`, `apps/api/tests/integration/member-stories.test.ts` (`10 authors`, `10 authors moderator`), `apps/api/tests/integration/isolation.test.ts` (`phase 10 sweep`), `10-08-SUMMARY.md`
- FOUND commits: `935d91c2`, `728ecad5`, `7ebcf209`, `d455015f`, `2924dd6a`, `b6e21aee`
- `commits: 6` measured with `git rev-list --count 4b0ab296..HEAD` before this SUMMARY commit; no `Co-Authored-By` trailer and no tool attribution in any commit of the plan; no path under `.planning/sketches/`, `STATE.md` or `ROADMAP.md` staged
