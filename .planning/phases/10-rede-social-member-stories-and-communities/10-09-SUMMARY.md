---
phase: 10-rede-social-member-stories-and-communities
plan: 09
subsystem: api
tags: [member-stories, highlights, owner-seam, tracer, idor, D-706, D-713, D-716, D-718, MPUB-06, MCOMM-06, T-10-34, T-10-35, T-10-36]

requires:
  - phase: 10-04
    provides: "stories_audience_gate branch 3 (a story held by a highlight of a community the caller can read, with `social` on or off)"
  - phase: 10-05
    provides: "stories.story.publish for members, the owner seam of posts, withCommunitiesEnabled and withStoriesEnabled helpers"
  - phase: 10-07
    provides: "a member publishes a story (visibility followers), the fail-closed 403 on a destination that this plan replaces"
  - phase: 10-08
    provides: "memberStoryVisible, the follow-bound Explorar reads that a highlight story must stay out of"
provides:
  - "resolveHighlightPlace owner branch: every write intent is 403 unless an organization place meets stories.story.manage or a member community meets its creator holding stories.story.publish; the read intent answers { curator }"
  - "the member publish destination (communityId via newHighlight or highlightId): a creator saves their own story in their own community's highlight, everyone who sees the community reads it after the 24 hours, with social on or off"
  - "the story predicate of Pitfall 9 (curatableStory): s.author_user_id = ctx.userId for a member, s.visibility = 'tenant' for a manager, in the story SELECT of insertHighlightItem, addStoryToHighlight, resolveChosenCover and the story's memberships read"
  - "any-of guards requirePermission('stories.story.manage', 'stories.story.publish') on the eight highlight curation routes, with the place check in every handler path"
  - "place-dependent curator: GET /highlights?scope=all and GET /highlights/{id}"
  - "listHighlightCatalog scoped by caller: the admin sees Início and active ORGANIZATION communities, a member only the active communities they created"
  - "HighlightCaller { canManage, canPublish } exported from the stories service; highlight service functions take it as their last argument"
affects: [10-10, 10-11, 10-12, 10-13, 10-14, 10-15]

actuals:
  tokens: 28900
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "Permission flags travel in the place gate (HighlightCaller), computed once per request by the route; the service never reads a permission or compares a role"
    - "A place read WITHOUT a row lock first (so a non-owner gets the 403 of a place that exists), then the share lock only for a caller who may curate, whose locked status feeds the archived refusal"
    - "One story predicate (curatableStory) spliced into every statement that selects a story for curation, so a story the caller may not curate writes zero rows and is the bare 404"

key-files:
  created: []
  modified:
    - packages/modules/stories/server/service.ts
    - packages/modules/stories/server/routes.ts
    - packages/modules/stories/contracts/index.ts
    - packages/modules/stories/tests/events.test.ts
    - packages/modules/stories/tests/story-highlights.test.ts
    - apps/api/tests/integration/member-stories.test.ts
    - apps/api/tests/integration/stories.test.ts
    - supabase/tests/120-story-highlights.sql

key-decisions:
  - "No moderator takedown inside a highlight (planner choice, kept): a moderator removes a member story through deleteStory (plan 07), which removes it from every highlight read, or archives the community; every highlight write on a member community by an admin is 403. D-711 enumerates only stories and communities"
  - "The place seam answers 404 (a miss, a hidden creator, another tenant's) BEFORE 403, so a publish naming a highlight that does not exist is now the bare 404 for a caller who may not curate; 05.2's route-level 403 before any lookup (T-05.1-05, T-05.2-32) is superseded. Highlight ids are already readable by every member through the highlight reads, so no new oracle"
  - "The community is read without a lock and locked only for a caller who may curate: `select … for share` also passes communities_member_update_gate, so a member who is not the creator would have read zero rows and got the 404 of a miss where the plan wants the 403 of a foreign community"
  - "curator is computed per place in the service (resolveHighlightPlace's answer): manager on an organization place (Início included), the creator on their own member community, nobody else; scope=all asks the same question and is 403 where the caller is not that curator (after the 404 of a missing place)"
  - "The member's catalog is ordered by community activity (last_activity_at desc) through a join on communities; the admin's order (community_id nulls first, position, id) is unchanged"
  - "No buyer path: highlight curation is admin (organization places) and creator (own member community) only, as the Escopo note says"

patterns-established:
  - "Plan-07's fail-closed refusal of a destination is replaced by the seam, not by a second check: every route that writes a highlight reaches resolveHighlightPlace through resolveHighlight, so no route learns what a place is"
  - "Moderator reads and member reads of a saved story differ on purpose: highlights of a hidden community are the bare 404 for the admin too, while the story by id stays readable by the moderator branch (D-717)"

requirements-completed: [MSTORY-06, MPUB-01, MPUB-06, MCOMM-06]

coverage:
  - id: D1
    description: "Tracer: Helena publishes a story with newHighlight naming her own member community (201), the highlight exists there holding the story; Marcos (not a follower) reads it through the highlight reads, likes and comments; one hour and 25 hours later he still reads it while it is gone from Explorar and from the authors read; Marcos and the lab admin naming that community are 403, and the admin's organization highlight works as before"
    requirement: MSTORY-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/member-stories.test.ts#10 highlights (cases 1-4)"
        status: pass
      - kind: pgtap
        ref: "supabase/tests/120-story-highlights.sql#tests 42-44 (member story past 24 hours through an active member community's highlight, not through a soft-deleted one, not unheld)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Pitfall 9 / T-10-35 IDOR: another member's story and the admin's story added to a member's highlight is the bare 404 with no story_highlight_items row; an admin adding a member story to an organization highlight is 404; a foreign story already in a highlight cannot be its cover; own story is the positive control"
    requirement: MPUB-01
    verification:
      - kind: integration
        ref: "member-stories.test.ts#10 highlights (case 5)"
        status: pass
    human_judgment: false
  - id: D3
    description: "D-713 / T-10-34 owner seam and guards: Marcos on Helena's community, a member on Início or an organization community, and the admin on a member community are 403 on every write; an unknown community is 404; the creator creates, renames, reorders, edits and deletes her own highlights; positive controls on the admin's organization places"
    requirement: MCOMM-06
    verification:
      - kind: integration
        ref: "member-stories.test.ts#10 highlights (cases 6-7)"
        status: pass
    human_judgment: false
  - id: D4
    description: "curator is place-dependent: scope=all and the empty-highlight read are open to the creator on her community and to the admin on organization places, and closed (403 and bare 404) to the admin on a member community and to Marcos"
    requirement: MCOMM-06
    verification:
      - kind: integration
        ref: "member-stories.test.ts#10 highlights (case 8)"
        status: pass
    human_judgment: false
  - id: D5
    description: "MPUB-06 catalog scope: the admin's catalog never lists a member community's highlight and its order is unchanged (EP-51); a member's catalog holds only their own active communities, an archived one excluded; a tenant with only member communities (EP-49) or none (EP-50) gives an empty community catalog, not an error"
    requirement: MPUB-06
    verification:
      - kind: integration
        ref: "member-stories.test.ts#10 highlight edges (cases 1-3); stories.test.ts#10-09 MPUB-06 / EP-51 catalog"
        status: pass
    human_judgment: false
  - id: D6
    description: "D-708 / D-718: with social off the creator's create, add and publish-with-destination are 403 while the community's highlights and the saved story stay 200 for Marcos, and turning social back on restores the writes with no data change; a blocked creator's highlights are the bare 404 for Marcos and the admin and the story for Marcos, unblocking restores them; a deleted community's highlights are the bare 404"
    requirement: MSTORY-06
    verification:
      - kind: integration
        ref: "member-stories.test.ts#10 highlight edges (cases 4-6)"
        status: pass
    human_judgment: false

duration: about 25min
completed: 2026-11-11
status: complete
plan_head_before: f6a287706723621630fbe009d599a1775a16423b
commits: 6
---

# Phase 10 Plan 09: Highlight Owner Seam Summary

**A creator now saves their own story in a highlight of their own community and everyone who sees the community reads it after the 24 hours (social on or off); the place seam `resolveHighlightPlace` refuses every other writer with 403 (admin and other members included), the story SELECT of every item write carries the caller's own predicate so a member can never publish someone else's story, `curator` is computed per place, and the admin's catalog lists organization communities only.**

## Performance

- **Duration:** about 25 min (estimate 220000 tokens; realized diff about 28900 tokens on the chars/4 scale)
- **Completed:** 2026-11-11
- **Tasks:** 3 of 3. Task 1 is the tracer (red `a0ed3621`, green `de9937e9`; its automated verify ran green before the expansion tasks: `Tracer verified end-to-end, expanding`). Tasks 2 and 3 each have their red commit first.
- **Files:** 0 created, 8 modified

## Accomplishments

- **Tracer (Task 1):** the owner branch of `resolveHighlightPlace` (organization place needs `stories.story.manage`, member community needs its creator holding `stories.story.publish`, flags in the gate, 404 then 403 then `archived`), the member publish destination through the same seam, and the route's old "manage for any destination" check removed. pgTAP 120 gains the member highlight clock case (plan 41 to 44).
- **Back doors (Task 2):** `curatableStory` in the story SELECT of `insertHighlightItem`, `addStoryToHighlight`, `resolveChosenCover` and `listStoryHighlightIds`; the eight highlight routes take the any-of guard; `curator` comes from the place seam for `GET /highlights?scope=all` and `GET /highlights/{id}`.
- **Catalog and edges (Task 3):** `listHighlightCatalog` offers a manager Início plus active organization communities (order unchanged) and a member only their own active communities (activity order, never Início); EP-49, EP-50, EP-51 and the social-off, blocked and deleted cases are asserted end to end.

## Task Commits

1. **Task 1 RED:** `a0ed3621` (test): tracer cases 1-4 and the pgTAP 120 clock case.
2. **Task 1 GREEN:** `de9937e9` (feat): owner branch, gate flags, member publish destination.
3. **Task 2 RED:** `c51eaad0` (test): IDOR, guards, curator cases 5-8.
4. **Task 2 GREEN:** `4796415f` (feat): author predicate, any-of guards, place-dependent curator.
5. **Task 3 RED:** `8719c795` (test): `10 highlight edges` and the stories.test.ts catalog case.
6. **Task 3 GREEN:** `22d38656` (feat): catalog scope.

**Plan metadata:** this SUMMARY is committed separately. `.planning/STATE.md` and `.planning/ROADMAP.md` were not touched (the orchestrator owns them). Nothing was pushed and no hosted project was touched. No commit carries a `Co-Authored-By` trailer or tool attribution.

## Verification

- pgTAP `000-helpers.sql`, `120-story-highlights.sql` (44 tests) and `231-member-stories.sql`: 151 tests, PASS. No migration in this plan, so no `db:reset` was needed; the local stack was used as left by plan 08.
- Integration, one invocation: `member-stories`, `stories`, `social-module`, `isolation`: 217 tests, all pass (`member-stories` 46 with `10 highlights` 8 and `10 highlight edges` 6; `stories` 78).
- Units: module-stories 202 passed, api 134 passed (isolation inventory and module README checks included). `tsc --noEmit` through turbo for module-stories and api (`TURBO_CACHE=local:r`, `--concurrency=4`), `pnpm boundaries` and Biome (api lint, stories module) are clean. `apps/web` was not touched; its known red spots (plans 11 and 12) are as before.
- Acceptance greps: `created_by_user_id` inside `resolveHighlightPlace`, `10 highlights`, `10 highlight edges`, `c.kind = 'organization'`, `s.author_user_id = `, and `requirePermission('stories.story.manage', 'stories.story.publish')` on the highlight routes (11 lines, at least 8 required) all pass.
- Module flags of the local `rede-lab` tenant were checked before and after: `communities` false, `notifications` false, `social` true (as at dispatch), no `Teste` stories, communities or highlights left, no organization community left soft-deleted.

## TDD Gate Compliance

Each of the three tasks has its `test(10-09)` commit before its `feat(10-09)` commit. The Task 1 RED failed on the planned behaviour (publish with a destination answered 403 where 201 was due). The Task 2 RED failed on the planned behaviour (the member's create and add answered 403 where 201 and 404 were due). The Task 3 RED failed on the three catalog cases (EP-49, EP-50, EP-51 and the demo catalog case); the social-off, blocked and deleted cases passed at once because the earlier tasks already carried those behaviours, and stand as guards. `gsd_run check tdd-red-evidence` was not used (Vitest emits no TAP), as in plans 03 to 08.

## Decisions Made

Listed under `key-decisions` above. The one the plan asked for by name: no moderator takedown inside a highlight (kept as the planner's choice; an admin on a member community is 403 on every highlight write).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan inconsistent with the database] The place read cannot take the share lock for a non-owner**
- **Found during:** Task 1 (the case that has Marcos naming Helena's community answered 404 where 403 is due)
- **Issue:** the plan selects kind and creator "beside locked" in the existing `for share` statement. `select … for share` also applies the table's UPDATE policy `communities_member_update_gate`, under which a member who is not the creator sees no row, so a foreign member community came back as the 404 of a miss.
- **Fix:** `resolveHighlightPlace` reads the community without a lock (kind, creator, locked), decides the 403, and only for a caller who may curate takes the `for share` lock in a second statement whose status feeds the `archived` refusal (so the lock still covers R-1 and the refusal reads the locked value). The two unit suites that script the statements now classify a `place-lock` statement.
- **Files modified:** `packages/modules/stories/server/service.ts`, `packages/modules/stories/tests/events.test.ts`, `story-highlights.test.ts` | **Commit:** `de9937e9`

**2. [Rule 3 - Blocking] Two unit suites outside the plan's file list had to follow the new signatures**
- **Issue:** `events.test.ts` and `story-highlights.test.ts` call the highlight service functions, which now take the permission flags, and script the place statement.
- **Fix:** they pass `{ canManage: true, canPublish: true }` (the organization curator) and the scripted place answer carries `kind`, `owner`, `locked` and the new lock statement.
- **Files modified:** `packages/modules/stories/tests/events.test.ts`, `packages/modules/stories/tests/story-highlights.test.ts` | **Commit:** `de9937e9`

**3. [Plan text vs earlier tests] Two earlier assertions of "403 before any lookup" were superseded by the plan's own 404-then-403 order**
- **Issue:** `stories.test.ts` 05.2-22 and `member-stories.test.ts` case 9 (plan 07) expected 403 for a publish naming a random highlight id, from the route-level manage check that this plan removes.
- **Fix:** both now assert 403 for a place that exists and may not be curated and the bare 404 for an id that does not exist. This is a deliberate consequence of "404 (miss), then 403, then archived", not a regression: highlight ids are already readable by every member through the highlight reads.
- **Files modified:** `apps/api/tests/integration/stories.test.ts`, `apps/api/tests/integration/member-stories.test.ts` | **Commit:** `de9937e9`

**4. [Rule 1 - Plan text vs the locked audience gate] A blocked creator's saved story stays readable by id for the moderator**
- **Found during:** Task 3 (the blocked-creator case)
- **Issue:** the plan says the community's highlights and the saved story answer the bare 404 "for Marcos AND for the admin". The highlights do (community hidden), and so does the story for Marcos (branch 3 closes), but the admin reads the story by id through the moderator branch of `stories_audience_gate` (D-717, pgTAP 231 section 4), which the notes of plan 08 forbid changing.
- **Fix:** the test asserts exactly that split: row and detail 404 for both, story 404 for Marcos and 200 for the admin, restored on unblock.
- **Files modified:** `apps/api/tests/integration/member-stories.test.ts` | **Commit:** `8719c795`

**5. [Rule 2 - Missing critical functionality] The story's memberships read carries the same predicate**
- **Issue:** `GET /{storyId}/highlights` is opened to members by the any-of guard; without the predicate a member who can read another member's story (a follower) could list its highlight ids.
- **Fix:** `listStoryHighlightIds` selects the story with `curatableStory`, so a story the caller may not curate is the bare 404. The plan lists the route in the guards but not in the IDOR predicate.
- **Files modified:** `packages/modules/stories/server/service.ts` | **Commit:** `4796415f`

**6. [Rule 2 - Missing critical functionality] A hidden creator hides the place in the seam's own statement**
- **Issue:** the plan asks for the explicit hidden-creator predicate in the catalog; the place seam is the statement every other read and write goes through.
- **Fix:** `resolveHighlightPlace` (and the member form of the catalog) carry the live-membership `exists` of plan 06 beside the RLS gate. Plan 06's second term, the viewer-block predicate, was not added: a highlight of a community the VIEWER blocked the creator of still reads, because the story branch (branch 3) carries no viewer-block term either and this plan must not widen that gate.
- **Files modified:** `packages/modules/stories/server/service.ts` | **Commit:** `de9937e9`

**7. [Plan wording] `publishStory` takes its flags as an optional third argument**
- The route passes the flags only when the body names a destination; a caller that passes none is `NO_CURATION` (may read, may not write), which keeps the 17 existing `publishStory(ctx, input)` unit calls unchanged and fails closed.

**8. [Verification note] Two early turbo typecheck runs did not set `TURBO_CACHE=local:r`**
- The first two typecheck runs (during Task 1) wrote their results to the local turbo cache before the flag was applied; every later gate used it. Disk stayed at 24 GiB free.

**Total deviations:** 8 (Rule 1 x2, Rule 2 x2, Rule 3 x1, plan-text or ordering notes x3). **Impact:** no scope change; items 1, 3 and 4 correct what the plan text got slightly wrong about the database, the old tests and the locked audience gate.

## Issues Encountered

- A first red run of Task 2 failed cases 6 and 8 for test-side reasons (an empty `highlightIds` is a 400 by contract; a later case depended on a fixture the first failure had skipped); the fixtures were fixed, the planned behaviour was already green.
- `biome check --write` on a whole package reformatted `packages/modules/stories/db/schema.ts`, which is outside this plan; the change was reverted and no commit touches it (a formatting nit that predates this plan).

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. Mitigations in place: T-10-34 (the owner branch of `resolveHighlightPlace`, the any-of guards plus the place check, 404 before 403, the negative tests with positive controls), T-10-35 (`curatableStory` in every story SELECT, PR-6: only the author's own story, only into the author's own community, only by an explicit write; the IDOR cases and the cover case), T-10-36 (the community's hidden gate in the statement and in RLS, branch 3 resolves through it; the blocked-creator case for Marcos and the admin).

## Notes for the plans after this one

- **Plans 11 and 12 (web):** the highlight service functions and routes changed their meaning, not their wire shapes. `GET /v1/stories/highlights?scope=all` is now 200 for the creator on their own member community and for a manager on an organization place or Início, and 403 elsewhere; an empty highlight reads 200 only for that curator. `GET /v1/stories/highlights/catalog` is the caller's: a manager gets Início plus organization communities, a member only their own active communities and no Início (so an empty list is a normal answer). `GET /{storyId}/highlights` is the bare 404 for a story the caller may not curate (a member asking after someone else's story, an admin asking after a member story). A publish with `newHighlight` or `highlightId` is the creator's act on their own community; Início and organization places stay the admin's, and a destination that does not exist is 404 before 403.
- **Plan 10-10 onwards (same service file):** the highlight service functions take `HighlightCaller` last (`createHighlight(ctx, input, caller)` and so on); `getHighlight(ctx, id, caller)` no longer takes `{ curator }`, and `listHighlights` takes `{ communityId, all }`. The route computes the flags with `highlightCaller(ctx)` before the transaction opens.
- **Plan 15 (rollout):** no migration here (service and route change only), so nothing to apply ahead of the code.

## User Setup Required

None. The local database was not reset (no migration); the integration suites left no residue.

## Self-Check: PASSED

- FOUND: `apps/api/tests/integration/member-stories.test.ts` (`10 highlights`, `10 highlight edges`), `supabase/tests/120-story-highlights.sql` (`select plan(44)`), `packages/modules/stories/server/service.ts` (`resolveHighlightPlace`, `curatableStory`, `HighlightCaller`), `packages/modules/stories/server/routes.ts` (`highlightCaller`), `10-09-SUMMARY.md`
- FOUND commits: `a0ed3621`, `de9937e9`, `c51eaad0`, `4796415f`, `8719c795`, `22d38656`
- `commits: 6` measured with `git rev-list --count f6a28770..HEAD` before this SUMMARY commit; no `Co-Authored-By` trailer and no tool attribution in any commit of the plan; no path under `.planning/sketches/`, `STATE.md` or `ROADMAP.md` staged
