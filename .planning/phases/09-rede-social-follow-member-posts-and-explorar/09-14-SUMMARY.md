---
phase: 09-rede-social-follow-member-posts-and-explorar
plan: 14
subsystem: database
tags: [rls, postgres, security-definer, media-gate, social, gap-closure, pgtap, drizzle]

requires:
  - phase: 09-rede-social-follow-member-posts-and-explorar
    provides: "app.media_asset_hidden social branch (09-05), the feed_posts social policies (09-03), app.social_enabled and app.social_visible_author_ids (09-02), the moderator takedown (09-12)"
provides:
  - "app.media_asset_hidden keeps a followers-only video closed once its post is soft-deleted (WR-01)"
  - "five restrictive delete and media write policies plus the feed_posts BEFORE UPDATE guard (WR-07)"
  - "app.social_can_read_for(p_user, p_author), the oracle-free explicit-user social read test for the notifications worker (plan 09-15)"
affects: [09-15, 09-16, 09-17, notifications, phase-10-member-authoring]

actuals:
  tokens: 20700
  tasks: 3
  commits: 6
plan_head_before: c244681fc33adf760f27d0bc78ab9e1661208eaa
commits: 6

tech-stack:
  added: []
  patterns:
    - "BEFORE UPDATE guard comparing to_jsonb(NEW) and to_jsonb(OLD) minus the counter columns, instead of a restrictive UPDATE policy, wherever invoker-rights triggers move columns of rows the actor does not own"
    - "explicit-user definer that answers about other users only to the system lane (zero user), about the caller otherwise"

key-files:
  created:
    - supabase/migrations/20261020123217_social_audience_revocation.sql
    - supabase/migrations/20261020123622_feed_social_member_write_gate.sql
    - supabase/migrations/20261020123631_feed_member_update_guard.sql
    - supabase/migrations/20261020123859_social_can_read_for.sql
    - supabase/tests/202-feed-member-write-gate.sql
    - supabase/tests/203-social-can-read-for.sql
  modified:
    - packages/modules/feed/db/schema.ts
    - supabase/tests/201-feed-social-gate.sql
    - apps/api/tests/integration/media-playback.test.ts
    - supabase/migrations/meta/_journal.json

key-decisions:
  - "The review's WR-07 UPDATE policy was REPLACED by the BEFORE UPDATE guard feed_posts_member_update_guard. The counter triggers app.feed_like_count and app.feed_comment_count run with the invoker's rights and update feed_posts.like_count and comment_count on posts the liker or commenter did not write. An UPDATE whose USING fails is filtered, not refused: it would match zero rows without an error, so like_count and comment_count would have drifted silently for every post a member reacts to. The guard compares OLD and NEW minus the two counter columns, so exactly those two move."
  - "feed_comments gets the DELETE policy only, no UPDATE guard: the D-334 cascade soft-deletes other members' replies in one statement and the like counter moves feed_comments.like_count as the invoker; a guard would refuse both. Recorded as a deliberate non-guard and asserted absent in pgTAP 202."
  - "The deleted-post branch of media_asset_hidden mirrors the live-post staff exemption: admin_tenant or the zero user, only while social is enabled (D-483). Limited to visibility = 'followers'; a soft-deleted organization post never hid anything."
  - "app.social_can_read_for answers about another user only to the system lane (the zero user); every other lane is answered only about itself, which closes the follow-graph oracle (D-468). The author must be a live member (role member), the recipient a live admin_tenant or a live member who is the author or follows them."
  - "Assumption delta no-change (planning decision 1); each task applied its own migration with migration up and the single db:reset ran in Task 3 (planning decision 6)."
  - "Reversibility: tasks 1 and 3 reversible by a later create or replace; task 2 costly (restrictive policies and a guard on tables every later member-authoring phase writes through)."

patterns-established:
  - "Counter-safe write backstop: guard by OLD/NEW comparison, not by row filter, when counters are maintained by invoker-rights triggers"
  - "pgTAP existence probes through to_regprocedure so a missing function fails the assertion instead of aborting the file"

requirements-completed: [SOCIAL-03, SOCIAL-06, SOCIAL-07, EXPL-06]

coverage:
  - id: D1
    description: "A moderator takedown or an author delete of a followers-only video post ends playback for the follower, the stranger and the author; the admin keeps it while social is on; a live organization carrier keeps it open (WR-01)"
    requirement: SOCIAL-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/media-playback.test.ts#a moderator takedown ends playback for the follower who could play it"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/media-playback.test.ts#the author deleting their own post closes playback the same way"
        status: pass
      - kind: unit
        ref: "supabase/tests/201-feed-social-gate.sql (112 assertions)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The member lane cannot hard-delete or re-audience what it did not write, and the like and comment counters keep moving (WR-07)"
    requirement: SOCIAL-03
    verification:
      - kind: unit
        ref: "supabase/tests/202-feed-member-write-gate.sql (61 assertions)"
        status: pass
      - kind: integration
        ref: "tests/integration feed-interactions, moderation-comments, moderation-posts, social-media, feed, feed-edit-delete, feed-media, feed-social, social"
        status: pass
    human_judgment: false
  - id: D3
    description: "app.social_can_read_for is fail-closed, tenant-pinned and oracle-free (consumed by plan 09-15)"
    requirement: SOCIAL-06
    verification:
      - kind: unit
        ref: "supabase/tests/203-social-can-read-for.sql (38 assertions)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The whole migration chain applies from scratch and the full pgTAP suite passes on a reset, seeded database"
    verification:
      - kind: other
        ref: "pnpm db:reset && pnpm db:seed && pnpm supabase test db (40 files, 2167 tests, PASS)"
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-10-20
status: complete
---

# Phase 9 Plan 14: Audience revocation and member write gate Summary

**A soft-deleted followers-only video stays closed (moderator takedown now ends playback), the member lane is refused hard deletes and audience rewrites at the database through five restrictive policies and a counter-safe BEFORE UPDATE guard, and the notifications worker gets an oracle-free `app.social_can_read_for`.**

## Performance

- **Duration:** 10 min (12:30 to 12:41 UTC)
- **Started:** 2026-10-20T12:30:38Z
- **Completed:** 2026-10-20T12:41:00Z
- **Tasks:** 3
- **Files modified:** 14 (10 under supabase/migrations or tests, the feed schema TS, one integration file, journal and snapshots)

## Accomplishments

- **WR-01 closed (Task 1, tracer).** `app.media_asset_hidden` was re-created with the same signature, OID, hardening and grants as the (A or B) and not C rule: A is the 09-05 live-post branch, B is new (a soft-deleted `followers` post carries the asset and the caller is not inside the staff exemption), C is the 09-05 "a live carrier is visible" exit. The staff exemption (`admin_tenant` or the zero user) holds only while `social` is on, as in the live branch. The moderator takedown and the author's own delete now close playback identically for the follower, the stranger and the author; the admin is still served. Nothing is deleted.
- **WR-07 closed (Task 2).** Five RESTRICTIVE policies from `packages/modules/feed/db/schema.ts` (`feed_posts_member_delete_gate`, `feed_post_media_member_insert_gate`, `feed_post_media_member_update_gate`, `feed_post_media_member_delete_gate`, `feed_comments_member_delete_gate`) and the `feed_posts_member_update_guard` BEFORE UPDATE trigger.
- **WR-02 SQL half (Task 3).** `app.social_can_read_for(p_user, p_author)` for plan 09-15, plus the one clean apply of the whole chain.

## The review's UPDATE policy was replaced by the guard, and why

The code review (WR-07) sketched a restrictive UPDATE policy narrowed to the author. It was NOT used. The counter triggers `app.feed_like_count()` and `app.feed_comment_count()` are not security definer: they run as the member who liked or commented and `update public.feed_posts set like_count = like_count + 1` on a post that member did not write. A row whose USING fails on an UPDATE is filtered, not refused, so an author-narrowed UPDATE policy would make every non-author counter update match zero rows with no error, and `like_count` / `comment_count` would drift silently for every post a member reacts to. The BEFORE UPDATE guard compares `to_jsonb(NEW)` and `to_jsonb(OLD)` minus the two counter columns: on a post it did not write a member may move only those two columns, and no member lane may move `author_user_id`, `visibility`, `community_id` or `tenant_id` (SQLSTATE 42501, fixed message). The DELETE side has no such trap (the service never hard-deletes), so it uses plain restrictive policies as the review asked. pgTAP 202 proves the counters still move (like, unlike, comment, soft-delete on an organization post and on a followee's post, and the D-334 cascade dropping `comment_count` by 2).

## Clean-apply reset: it ran

`pnpm db:reset` ran exactly once, in Task 3, on Igor's consent of 2026-10-20 (recorded in the run instructions). The sequence was `pnpm db:generate` ("No schema changes"), `pnpm db:reset` (all migrations including the four of this plan applied from scratch), `pnpm db:seed`, the full `pnpm supabase test db`, then the integration files. No `unrun-verify` entry was needed. Nothing was pushed to the hosted project.

## Verification results (real numbers)

| Check | Result |
|-------|--------|
| Full pgTAP on the reset, seeded database | 40 files, 2167 tests, PASS |
| pgTAP 201 (extended) | 112 assertions, PASS |
| pgTAP 202 (new) | 61 assertions, PASS |
| pgTAP 203 (new) | 38 assertions, PASS |
| 180-store, 040-schema-conventions, 090, 110, 130, 020 | PASS |
| Integration after the reset: media-playback, feed-interactions, feed-social, moderation-posts, moderation-comments | 5 files, 144 tests, PASS |
| Integration: social-media, feed-edit-delete, feed-media, feed, social | 112 tests (feed-edit-delete, feed-media, feed-social, feed, social) and 90 tests (feed-interactions, moderation-comments, moderation-posts, social-media) before the reset, PASS |
| isolation.test.ts "phase 09 sweep" | 3 passed, 66 skipped by the filter, PASS |
| `pnpm db:generate` | "No schema changes, nothing to migrate" |
| `@rede-social/module-feed` typecheck, lint; `pnpm boundaries` | clean, no issues in 1717 files |
| `git diff --stat -- packages/modules/feed/server/service.ts` | empty (EP-63) |

## Task Commits

1. **Task 1 (tracer), RED:** `55f14358` (test) - pgTAP 201 flipped plus new cases, media-playback takedown, author-delete and rewritten soft-deleted cases
2. **Task 1, GREEN:** `cb8589ed` (feat) - `20261020123217_social_audience_revocation.sql`
3. **Task 2, RED:** `571e3e12` (test) - pgTAP 202
4. **Task 2, GREEN:** `67ae2751` (feat) - schema TS, `20261020123622_feed_social_member_write_gate.sql`, `20261020123631_feed_member_update_guard.sql`
5. **Task 3, RED:** `8f3813ed` (test) - pgTAP 203
6. **Task 3, GREEN:** `26411436` (feat) - `20261020123859_social_can_read_for.sql`

**Plan metadata:** the docs commit that carries this SUMMARY, STATE.md and ROADMAP.md.

## Files Created/Modified

- `supabase/migrations/20261020123217_social_audience_revocation.sql` - `app.media_asset_hidden` re-created with the soft-deleted followers branch
- `supabase/migrations/20261020123622_feed_social_member_write_gate.sql` - generated: five restrictive policies
- `supabase/migrations/20261020123631_feed_member_update_guard.sql` - `app.feed_posts_member_update_guard()` and its BEFORE UPDATE trigger
- `supabase/migrations/20261020123859_social_can_read_for.sql` - `app.social_can_read_for(uuid, uuid)`
- `packages/modules/feed/db/schema.ts` - the five `pgPolicy` entries, each commented with WR-07, SOCIAL-03 and why restrictive
- `supabase/tests/201-feed-social-gate.sql` - flipped deleted-post case, 11 new assertions, fixtures a7 to a9, plan 101 to 112
- `supabase/tests/202-feed-member-write-gate.sql` - new, 61 assertions
- `supabase/tests/203-social-can-read-for.sql` - new, 38 assertions
- `apps/api/tests/integration/media-playback.test.ts` - takedown tracer with positive control, author delete, rewritten soft-deleted case

## Decisions Made

Planning decisions 1 to 7 of the plan were followed as written; they are listed under `key-decisions`. Two small execution choices: the guard migration omits `drop trigger if exists` (expand-only, nothing existed to drop), and `social_can_read_for` requires the author to be a live `member` role (followers posts exist only for members), which is stricter than "a live membership" and fails closed.

## Deviations from Plan

None - plan executed exactly as written. No existing case in 090, 110, 130 or 020 encoded the old tenant-only rule; no policy or guard was loosened to make a test pass. Two test-authoring fixes during RED, both inside new files before their commits: an unescaped apostrophe in a 201 title (SQL syntax error) and `to_regprocedure` instead of a `::regprocedure` cast in 202 so a missing function fails an assertion rather than aborting the file.

## TDD Gate Compliance

RED and GREEN commits exist for all three tasks (`test(09-14)` precedes `feat(09-14)` each time). No refactor commit. Honest account of the RED evidence:

- Task 1: genuine RED. The integration run showed 3 failed, 36 passed (the takedown, author-delete and rewritten soft-deleted cases); pgTAP 201 showed 5 of 112 failed (the flipped M3 case, the follower, the author, a real support_tenant, and the admin with `social` off), all with `have: false / want: true`.
- Task 2: genuine RED. pgTAP 202 showed 29 of 61 failed against the old schema (catalog, deletes, media writes, the guard and the downstream counter cases that cascaded from M2 hard-deleting M1's post).
- Task 3: the RED is an abort, not an assertion failure: the file stops at its first call with `function app.social_can_read_for(unknown, unknown) does not exist` (0 assertions ran, plan of 38). For a function that does not exist that is the only possible RED; it proves the target is missing, not that each assertion can fail. The positive controls beside each negative in the file carry that weight, and all 38 pass once the function exists.
- `gsd_run check tdd-red-evidence` was not run: it parses `node --test` TAP, which Vitest never emits, and `workflow.tdd_mode` is false. No evidence record was fabricated; the raw failing output was saved in the session scratchpad only.

## Issues Encountered

None blocking. The full pgTAP suite was deliberately not run between Tasks 1 and 3 (pgTAP 154 trips on `moderation_log` rows the integration runs leave); only the files each task named were run, and the single reset in Task 3 cleared the residue before the full run.

## Known Stubs

None. Nothing in this plan renders to a UI or carries placeholder data.

## Threat Flags

None beyond the plan's register. `app.social_can_read_for` is a new SECURITY DEFINER surface, covered by T-09-51 (oracle) and T-09-52 (posture), both asserted in pgTAP 203. Accepted residuals stay as planned: T-09-53 / EP-60 (playback tokens minted before a takedown live until their own expiry) and T-09-54 / A6 (member photo variants stay id capabilities), both to be recorded by plan 09-17.

## User Setup Required

None - no external service configuration required. The four migrations are NOT applied to the hosted project; the push is a human step in `docs/DEPLOY.md` (plan 09-17).

## Next Phase Readiness

- Plan 09-15 can wire `app.social_can_read_for` into the reply notice resolver in `packages/modules/feed/server/notifications.ts` (system lane, zero user).
- Local database is freshly reset and seeded, with the integration residue of this plan's runs; run pgTAP before any further integration suites.
- Nothing pushed, nothing deployed.

## Self-Check: PASSED

- All six created files and the four modified files exist on disk.
- All six task commits are present in `git log` (55f14358, cb8589ed, 571e3e12, 67ae2751, 8f3813ed, 26411436), `commits: 6` measured from `plan_head_before` c244681f.
- Every task's acceptance criteria were re-run and passed (greps, release grep, `limit 1` count 0, db:generate "No schema changes", the verify commands).

---
*Phase: 09-rede-social-follow-member-posts-and-explorar*
*Completed: 2026-10-20*
