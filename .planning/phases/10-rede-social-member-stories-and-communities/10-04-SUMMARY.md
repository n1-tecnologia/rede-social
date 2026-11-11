---
phase: 10-rede-social-member-stories-and-communities
plan: 04
subsystem: database
tags: [member-stories, schema, rls, tracer, spike, moderation-vocabulary, pgtap, D-705, D-708, D-711, D-716, D-717, D-718]

requires:
  - phase: 10-03
    provides: "app.member_community_hidden_ids() (hidden-creator definer), communities.kind, the community audience; plpgsql-definer and enable_sort pin lessons"
  - phase: 09-rede-social-social
    provides: "app.social_enabled(), the social-gate constants, app.media_asset_hidden() 09-14 body, the moderation_log post_removed shape"
provides:
  - "stories.visibility (default 'tenant', stories_visibility_chk) stamped audience; stories_audience_gate (select) and stories_social_insert_gate (insert), both RESTRICTIVE"
  - "branch 3 of the audience gate: a story held by a highlight of a community the caller can read is readable by everyone who reads the community, social on or off (D-716)"
  - "feed_comments_story_gate / feed_likes_story_gate (select) and their *_story_insert_gate twins: a story's likes and comments follow the story gate"
  - "app.media_asset_hidden() gains a followers-story block and a soft-deleted followers-story block (A5)"
  - "moderation_log accepts story_removed, community_archived, community_removed with subjects story and community; MODERATION_ACTIONS / MODERATION_SUBJECT_TYPES appended; recordModerationAction entries"
  - "10-04-SPIKE.md: A10 measured, CHOSEN_FORM EXISTS_JOIN"
affects: [10-05, 10-06, 10-07, 10-08, 10-09, 10-11]

actuals:
  tokens: 33000
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "Restrictive select gate with the audience literal first: the statement's own `visibility = 'tenant'` qual runs before the policy disjunction, so the walk never reaches branch 3 on the strip"
    - "Definer that cannot lean on the caller's RLS repeats the policy's inner community read with explicit pins (tenant, deleted_at, member_community_hidden_ids)"
    - "A custom migration's drizzle snapshot is the PREVIOUS schema; when the schema file changed before `generate --custom`, patch the custom snapshot with the next generated one (keep id and prevId) and delete the throwaway migration"

key-files:
  created:
    - supabase/migrations/20261111145716_member_stories.sql
    - supabase/migrations/20261111150352_story_media_gate.sql
    - supabase/migrations/20261111151218_moderation_member_content.sql
    - supabase/tests/231-member-stories.sql
    - .planning/phases/10-rede-social-member-stories-and-communities/10-04-spike.sql
    - .planning/phases/10-rede-social-member-stories-and-communities/10-04-SPIKE.md
  modified:
    - packages/modules/stories/db/schema.ts
    - packages/modules/feed/db/schema.ts
    - packages/core/db/schema/moderation-log.ts
    - packages/contracts/src/moderation.ts
    - packages/core/server/moderation/log.ts
    - packages/core/tests/moderation-log.test.ts
    - packages/contracts/tests/moderation.test.ts
    - supabase/tests/154-moderation-log.sql
    - supabase/migrations/meta/_journal.json

key-decisions:
  - "A10: branch 3 keeps the per-row EXISTS_JOIN form. Measured on a 6000 member story volume fixture: Inicio strip 1.3 ms and 96 buffers (branch 3 never executed), comments page of a 200-comment story 8.6 ms / 5.7 ms; the ids-array definer form made the story gate a hashed Seq Scan on stories (82 to 89 ms). CHOSEN_FORM: EXISTS_JOIN"
  - "A5 embodied: the video of a followers-only member story is hidden from a caller outside the story gate; the same block opens when a readable highlight holds the story. One-task revert documented in the migration header"
  - "Soft-deleted followers stories keep their video closed (09-14 lesson applied to stories) beyond the plan's literal 'live story' text; the staff exemption (admin_tenant or the zero user, social on) is the only way in"
  - "Removal-class subject binding is enforced twice: by the CHECK (story iff story_removed, community iff community_archived or community_removed) and by a writer-side map that throws before the insert"
  - "Story like and comment gates are four policies (select and a separate insert each), named *_story_gate and *_story_insert_gate"

patterns-established:
  - "The strip statement must keep naming `visibility = 'tenant'` (Inicio) or `'followers'` (Explorar): it is what keeps branch 3 off the walked rows. Plan 08 inherits this as a hard requirement"

requirements-completed: [MSTORY-04, MSTORY-08, MPUB-04, MCOMM-10, MSTORY-09, MPUB-07]

coverage:
  - id: D1
    description: "A member story is read by its author, a live follower and the admin lane and by nobody else; an organization story by every lane of the tenant; insert gate forbids a forged audience"
    requirement: MSTORY-04
    verification:
      - kind: integration
        ref: "supabase/tests/231-member-stories.sql sections 1, 2, 5"
        status: pass
    human_judgment: false
  - id: D2
    description: "social OFF hides every member story from every audience lane while the highlight branch stays open; blocking or removing the author closes follower and highlight lanes, the moderator keeps reading, nothing is deleted"
    requirement: MSTORY-08
    verification:
      - kind: integration
        ref: "supabase/tests/231-member-stories.sql sections 3, 4, 6"
        status: pass
    human_judgment: false
  - id: D3
    description: "Story likes and comments follow the story gate; rows without story_id untouched; the followers-only story video is not playable by an outsider (A5) and opens through a readable highlight"
    requirement: MPUB-04
    verification:
      - kind: integration
        ref: "supabase/tests/231-member-stories.sql sections 7, 8, 9"
        status: pass
    human_judgment: false
  - id: D4
    description: "The moderation log accepts story_removed, community_archived, community_removed with their subjects at the database and in the kernel writer; each subject bound to its actions"
    requirement: MCOMM-10
    verification:
      - kind: integration
        ref: "supabase/tests/154-moderation-log.sql fact 8"
        status: pass
      - kind: unit
        ref: "packages/core/tests/moderation-log.test.ts (10-04 describe); packages/contracts/tests/moderation.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "All three migrations are expand-only, apply on a fresh database through the Supabase runner, and db:generate prints No schema changes"
    requirement: MPUB-07
    verification:
      - kind: other
        ref: "pnpm db:generate | grep 'No schema changes' && pnpm db:reset && pnpm db:seed && pnpm supabase test db (65 files, 4463 tests, PASS)"
        status: pass
    human_judgment: false

duration: 75min
completed: 2026-11-11
status: complete
plan_head_before: 8623a9b8b66e857630711978bb544083a9806fb0
commits: 6
---

# Phase 10 Plan 04: Member Stories Schema Summary

**Postgres alone now decides who reads a member story: `stories.visibility` stamped at publish, a restrictive audience gate with a no-`social` highlight branch (EXISTS_JOIN, measured), story like and comment gates, a hardened story-video media gate, and a moderation log that accepts `story_removed`, `community_archived` and `community_removed`.**

## Performance

- **Duration:** about 75 min
- **Completed:** 2026-11-11
- **Tasks:** 3 of 3 (Task 1 and Task 3 each with a red commit first)
- **Files:** 6 created, 9 modified (plus 3 drizzle snapshots)

## Accomplishments

- **Tracer (Task 1):** `visibility` column (default `'tenant'`), `stories_visibility_chk`, `stories_audience_gate`, `stories_social_insert_gate`, and four story gates on `feed_comments` and `feed_likes`; pgTAP 231 section 1 red then green; full suite green after reset.
- **Measurement and proof (Task 2):** `10-04-spike.sql` builds a rolled-back volume fixture (62 members, 3000 org and 6000 member stories, 40 communities, 400 highlights, 3000 items, a 200-comment story) and compares the two forms; `10-04-SPIKE.md` records `CHOSEN_FORM: EXISTS_JOIN`. `app.media_asset_hidden` re-created with the story blocks. pgTAP 231 completed to 99 assertions (lane table, social off, liveness, insert gate, highlight clock, likes/comments, media gate, catalog, EXPLAIN pins).
- **Vocabulary (Task 3):** the two CHECKs widened in one custom migration (current action list kept), mirrored in Drizzle, contract lists appended, kernel `ModerationEntry` union and writer extended; pgTAP 154 fact 8 (17 new assertions) and the vitest cases.
- **Verification:** `pnpm db:generate` prints "No schema changes"; `pnpm db:reset && pnpm db:seed && pnpm supabase test db` is green (65 files, 4463 tests); core vitest 14 passed, contracts vitest 604 passed; `turbo typecheck` for contracts and core passes.

## Task Commits

1. **Task 1 RED:** `0b621b68` (test): failing pgTAP tracer. Target tests failed on the planned behavior (`column "visibility" of relation "stories" does not exist`, then the like and comment negatives landing on a 23503 instead of 42501).
2. **Task 1 GREEN:** `a7a24acb` (feat): column, check, gates, story like and comment gates, generated migration, journal and snapshot.
3. **Task 2:** `6d11fd41` (feat): spike script and record, `*_story_media_gate.sql`, pgTAP 231 completed.
4. **Task 3 RED:** `4c844a7f` (test): failing vitest cases, contracts pin, pgTAP 154 fact 8. Failing targets: the accepted pairs (23514 on `moderation_log_action_chk`), the catalog match, and the append-only assertions on rows that could not be inserted.
5. **Task 3 GREEN:** `34edc8a6` (feat): migration, mirrors, contract values, kernel entries.
6. **Doc fix:** `1ddcd0cb` (docs): header wording so the plan's expand-only grep reads 0.

**Plan metadata:** this SUMMARY is committed separately. STATE.md and ROADMAP.md were not touched. Nothing was pushed; no hosted project was touched.

## Key Decisions (A5 and A10)

- **A10, quoted from the spike:** `CHOSEN_FORM: EXISTS_JOIN`. The Inicio strip read costs 1.318 ms and 96 buffer hits with branch 3 never executed (the statement's own `visibility = 'tenant'` qual runs before the policy disjunction); the worst measured per-row case (200 comments of a story the caller cannot read, every row running branch 3) is 5.7 ms and 2013 buffers. The ids-array definer made `feed_comments_story_gate`'s inner `exists` an uncorrelated hashed subplan: `Seq Scan on stories` and 82 to 89 ms. Assumption A10 half-confirmed (a measured plan was needed and found a cliff) and half-refuted (the per-row form does not degrade the strip).
- **A5:** embodied as the third and fourth blocks of `app.media_asset_hidden`; photo variants stay the accepted id-capability residual of Phase 9.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Soft-deleted followers stories keep their video closed**
- **Found during:** Task 2 (A5 design, against the D-708 prohibition on back doors)
- **Issue:** the plan's A5 block covers only a LIVE story. A moderator's takedown (`story_removed`) or an author's own delete would reopen the video to every tenant member who knows the asset id, the exact failure 09-14 closed for posts.
- **Fix:** a fourth block (soft-deleted followers story, caller outside the staff exemption, social on), same shape as the 09-14 post block; pgTAP 231 section 8 asserts it for a stranger, the author and the admin.
- **Files modified:** `supabase/migrations/20261111150352_story_media_gate.sql`, `supabase/tests/231-member-stories.sql`
- **Commit:** `6d11fd41`

**2. [Rule 3 - Blocking] Two existing test files needed the appended values**
- **Found during:** Task 3
- **Issue:** `packages/contracts/tests/moderation.test.ts` pinned the exact action and subject lists and `.at(-1) === 'profile_form_exported'`, so appending the new values could not stay green without updating it (not in the plan's file list).
- **Fix:** the pin now lists the nine actions and five subject types in order and checks the Phase 12 value keeps position 5.
- **Files modified:** `packages/contracts/tests/moderation.test.ts` | **Commit:** `4c844a7f` (RED) and `34edc8a6`

**3. [Rule 3 - Blocking] The drizzle snapshot of a custom migration is the previous schema**
- **Found during:** Task 3 (`pnpm db:generate` produced a second throwaway migration after the custom one)
- **Fix:** copied the generated snapshot into the custom migration's snapshot (kept its `id` and `prevId`), deleted the throwaway SQL, snapshot and journal entry; `db:generate` then prints "No schema changes". The custom SQL is byte-equal to what the generator wrote.
- **Files modified:** `supabase/migrations/meta/20261111151218_snapshot.json`, `supabase/migrations/meta/_journal.json`
- **Commit:** `34edc8a6`

**4. [Rule 1 - Bug in my test] Planner-sensitive EXPLAIN pin in 231 section 10**
- **Found during:** Task 2 (full run after the spike)
- **Issue:** with bitmap scans on, the planner flips between a correlated Index Only Scan and a hashed bitmap subplan for `viewer_seen` depending on the statistics left by earlier files.
- **Fix:** `set local enable_bitmapscan = off` around both EXPLAINs (the 180 precedent) so the pin is on the index the subplan reads; reason written in the file.
- **Commit:** `6d11fd41`

**Total deviations:** 4 (Rule 1, 2, 3, 3). **Impact:** no scope change; deviation 1 hardens D-708's "no back door" prohibition.

## Issues Encountered and Notes for the Orchestrator and Later Plans

- **apps/web typecheck is RED until plan 10-11, as designed.** Appending the three actions breaks two exhaustive `Record<ModerationAction, ...>` maps: `apps/web/lib/moderation-view.ts` (`TEMPLATE_KEY`) and `apps/web/components/admin/ModerationLogRow.tsx` (`GLYPHS`). Plan 10-04's file list and verify scope (contracts, core) leave them alone, and plan 10-11 owns the rows, labels and the approved pt-BR strings. `apps/api` and `packages/modules/stories` typecheck clean. Do not run the web typecheck gate between plans 04 and 11.
- **Flaky EXPLAIN pin in plan 03's `232-feed-community-audience.sql` test 56** ("merged Inicio served by feed_posts_tenant_org_created_idx") failed twice in a row right after `db:reset`, `db:seed` and the spike, then passed on every later run with no code change (autovacuum or statistics). Not caused by 04 (no feed_posts index or policy change here); worth a `enable_*` pin the way 180 got one if it recurs in CI.
- **Plan 08 must keep the audience literal in the strip statement** (`visibility = 'tenant'` for Inicio, `'followers'` for Explorar): it is what keeps branch 3 off the walked rows (SPIKE caveat).
- **Per-lane read of `story_views` in the strip** is planned as a hashed bitmap subplan once the table has volume; the Index Only Scan form holds with bitmap off or on the owner role. Both are asserted in 231 section 10.
- `gsd_run check tdd-red-evidence` was not used (pg_prove and vitest output read directly; the RED evidence is recorded per commit above).
- `pnpm db:reset` failed once with `LegacyDbSetupError` on the first attempt (the realtime container was still starting) and succeeded on the immediate retry; the stack stayed healthy.
- `pnpm db:two` and `db:migrate-all --dry-run` were not run (out of this plan's verify chain and local-only scope); three `db:reset` runs of the full migration set through the Supabase runner evidence a fresh apply.

## Known Stubs

None. (`app.community_action_allowed` from plan 03 is untouched and still the constant-false Escopo seam.)

## Threat Flags

None beyond the plan's threat model. Mitigations in place: T-10-09 (audience gate and story like/comment gates, pgTAP 231 sections 1 to 7), T-10-10 (insert gate, section 5), T-10-11 (media gate, section 8), T-10-12 (CHECK binding plus writer map, pgTAP 154 fact 8), T-10-13 (A10 measurement, EXPLAIN pins). Observation, out of scope: the strip now depends on a planner evaluation order (user qual before policy disjunction); the SPIKE records it as a caveat for plan 08.

## Self-Check: PASSED

- FOUND: `supabase/migrations/20261111145716_member_stories.sql`, `20261111150352_story_media_gate.sql`, `20261111151218_moderation_member_content.sql`, `supabase/tests/231-member-stories.sql`, `10-04-spike.sql` (ends with `rollback;`, 10 `explain`), `10-04-SPIKE.md` (`CHOSEN_FORM: EXISTS_JOIN`, `Execution Time` present)
- FOUND commits: `0b621b68`, `a7a24acb`, `6d11fd41`, `4c844a7f`, `34edc8a6`, `1ddcd0cb`
- `commits: 6` measured with `git rev-list --count 8623a9b8..HEAD` before this SUMMARY commit
- `grep -c "CREATE POLICY"` on `*_member_stories.sql` prints 6; the drop/rename grep prints 0 on `*_member_stories.sql` and `*_moderation_member_content.sql`; `grep -q "stories s"` on `*_story_media_gate.sql` holds
