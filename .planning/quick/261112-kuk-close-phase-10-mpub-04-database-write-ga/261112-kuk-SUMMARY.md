---
phase: quick-261112-kuk
plan: 01
subsystem: database
tags: [rls, pgtap, stories, communities, feed, media, mpub-04, phase-10-gap, quick]
requires: [10-VERIFICATION gap MPUB-04, 10-REVIEW WR-03, WR-04, WR-05]
provides:
  - "ONE expand-only migration 20261112182228_member_content_write_gates.sql (7 policies, 1 ALTER POLICY, 1 guard function + trigger, re-created app.media_asset_hidden)"
  - "pgTAP 231 section 12 (61 assertions) and 232 sections 8 and 9 (18 assertions)"
affects: [stories, communities, feed, media playback]
key-files:
  created:
    - supabase/migrations/20261112182228_member_content_write_gates.sql
    - supabase/migrations/meta/20261112182228_snapshot.json
  modified:
    - supabase/migrations/meta/_journal.json
    - supabase/tests/231-member-stories.sql
    - supabase/tests/232-feed-community-audience.sql
    - packages/modules/stories/db/schema.ts
    - packages/modules/feed/db/schema.ts
    - packages/modules/feed/server/service.ts
    - packages/modules/stories/server/service.ts
    - packages/modules/stories/tests/events.test.ts
    - packages/modules/stories/tests/story-highlights.test.ts
    - docs/DEPLOY.md
decisions:
  - "Stories UPDATE is guarded by a BEFORE UPDATE invoker trigger (counters + soft delete of own story), not by a policy, so the invoker counter triggers keep working"
  - "Item insert gate pins the story author (D-716); a member never updates a highlight item"
  - "resolveHighlight reads the highlight unlocked, judges the place, then locks for update (the row lock passes the UPDATE policy)"
metrics:
  duration: "about 1h"
  completed: 2026-11-12
status: complete
commits: 3
plan_head_before: 310cbe68cdb2b2546e3413fe0d2334a1de93aed3
actuals:
  tokens: 20000
  tasks: 3
  commits: 3
---

# Quick 261112-kuk: close Phase 10 gap MPUB-04 (database write gates) Summary

The database now refuses, with 42501 or zero rows, the member-lane writes the API alone refused: story forgery and
hard delete, highlight and item writes outside a member community the caller created (including saving another
member's story), a staff `'tenant'` post into a member community, and the video of a hidden member community.

## Commits

| Commit | Message |
| ------ | ------- |
| 35226de7 | test: red pgTAP negatives (47 failing) |
| 28f83dd8 | fix: the migration, TS mirror, docblock, DEPLOY.md |
| cb2b4507 | fix: read a highlight unlocked before judging its place (found in Task 3) |

## Red run (Task 1, against the pre-migration database)

47 failing assertions, exactly the plan's number: 38 in 231 and 9 in 232; planned = ran in both files; no failing
assertion outside the `12:`, `8:`, `9:` set; every positive control and all older assertions green.
`gsd-tools check tdd-red-evidence` returned RED_EVIDENCE_OK for both files (231: 167 tests, 129 pass, 38 fail; 232:
74 tests, 65 pass, 9 fail), fed with the real TAP printed by `psql -f` (pgTAP loaded in a session, rolled back).

Failing set: 12a (9) stories update guard, 12b (3) stories delete, 12c (10) highlights, 12d (7) items, 12e (9) catalog;
8 (5) staff insert gate, 9 (4) hidden-community media.

## Green totals

- Seven-file pgTAP set after `supabase migration up` (231, 232, 230, 120, 020, 201, 202): 828 tests, all ok.
- After `db:reset` + `db:seed`, the whole suite `pnpm supabase test db`: Files=65, Tests=4552, PASS (020, 040, 120, 201,
  202, 230, 231 (167), 232 (74) all ok).
- `pnpm db:generate`: "No schema changes" before the migration, after it and after the last commit.
- biome check on the touched files, typecheck of module-stories and module-feed: clean. Module stories unit tests:
  16 files, 217 tests pass.
- API integration, one file at a time (passed / failed): stories 78/0, stories-author-photo 4/0, member-stories 46/0
  (first run 41/5, see below), communities 49/0, communities-delete 19/0, member-communities 48/0, feed 19/0,
  feed-social 53/0, feed-media 14/0, feed-interactions 18/0, feed-edit-delete 11/0, feed-community-delete 9/0,
  moderation-member-content 22/0, moderation-posts 22/0, moderation-comments 20/0, moderation-log 13/0,
  media-playback 39/0, social-media 49/0, social-module 13/0, isolation 87/0. No skipped test. stories and
  stories-author-photo were re-run after the service fix (78/0 and 4/0).
- The stack was left freshly reset and seeded after the last integration run.

## Deviations from Plan

**1. [Rule 1 - Bug] 12b null-role delete subject changed.** The plan's subject was a followers story (B9). A lane with a
null role claim cannot READ a followers story (the audience gate), so its delete matched zero rows before the gate
existed and the assertion was not red (first red run: 37 in 231, not 38). The subject is now BC, an organization story
(`visibility = 'tenant'`) the null-role lane can read; red run is the planned 38 + 9 = 47. B9 is not created.

**2. [Rule 1 - Bug] `resolveHighlight` lock order (not in the plan's file list).** `select ... for update` also passes the
table's UPDATE policy, so with `story_highlights_member_update_gate` a member who does not own the highlight's community
read zero rows and got the 404 of a miss where the seam owes a 403 (member-stories.test.ts 9, 4, 5, 6, 8 failed, 41 of
46 passed). The function now reads the highlight with no lock, calls `resolveHighlightPlace`, then re-reads it
`for update` for a write intent (the same 10-09 rule `resolveHighlightPlace` already follows for communities). The
pins in `events.test.ts` (tests 12, 14) and `story-highlights.test.ts` (test 1) that list statement order gained the
second `highlight` read. Files: `packages/modules/stories/server/service.ts`, the two test files. Commit cb2b4507.
Cost: one extra indexed read per highlight write.

**3. Parenthesis count of the re-created definer** was wrong in the first draft (107 opens against 110 closes); caught
by a count before applying, fixed, and the body diff against `20261111150352_story_media_gate.sql` is exactly the two
inserted alternatives.

**4. `_journal.json` trailing newline** restored by hand (drizzle-kit writes it without one; HEAD had it).

## Known Stubs

None.

## Threat Flags

None. The migration only tightens; no new endpoint, auth path or file access.

## Release steps Igor still owns

- `pnpm db:two` and `pnpm db:migrate-all -- --dry-run` (not authorized here), then the ledgered fan-out of the ninth Phase 10
  migration (DEPLOY.md item 9) to every ready tenant project before the API deploys. The migration is safe to apply
  ahead of any code, but the `resolveHighlight` change must ship with the API: a new policy with the OLD API turns the
  403 of a non-owner member naming a foreign highlight into a 404 (no data leak, a status difference only).
- Push and deploy; re-run the verifier of Phase 10 (10-VERIFICATION.md was not touched).
- The local `tests` pgTAP helper schema was dropped and recreated during the red run; `db:reset` leaves the stack clean.

## Self-Check: PASSED

- Migration, snapshot, journal entry, both test files and this summary exist; commits 35226de7, 28f83dd8, cb2b4507 exist
  on master; none carries a trailer.
