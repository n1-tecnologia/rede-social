---
phase: 10-rede-social-member-stories-and-communities
plan: 03
subsystem: database
tags: [member-communities, schema, rls, tracer, pgtap, D-701, D-702, D-706, D-707, D-708, D-718, escopo-seam]

requires:
  - phase: 09-rede-social-social
    provides: "app.social_enabled(), the feed_posts social gates and feed_posts_member_update_guard that this plan widens"
  - phase: 09.3-pendencias-de-backend-do-front-pdf
    provides: "the community_deleted_ids definer and the deleted-community gate that the hidden-creator gate copies"
provides:
  - "communities.kind (organization default, member), COMMUNITY_MEMBER_POSITION = 1000000, communities_kind_chk, communities_member_position_chk, communities_tenant_creator_idx"
  - "four RESTRICTIVE policies on communities: kind insert gate, member update gate, member delete gate, hidden-creator select gate"
  - "app.member_community_hidden_ids() definer (ids of member communities whose creator has no live membership)"
  - "feed_posts.visibility third value 'community': widened checks, owner insert branch, select branch without social or follow term, feed_posts_member_hidden_community_gate"
  - "app.feed_posts_member_update_guard() as an allow-list (closes the Phase 9 advisory)"
  - "Escopo seam: kernel stub app.community_action_allowed(uuid, text) = constant false, plus one reserved OR branch on feed_posts_social_insert_gate"
  - "pgTAP 230 (74), 232 (56), 110 extended (+10)"
affects: [10-04, 10-05, 10-06, 10-07, 10-09, escopo phase (after Phase 11)]

actuals:
  tokens: 27000
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "Role-first restrictive predicates (tenant_role() = 'member' and ... or tenant_role() <> 'member') so a null role denies"
    - "Definer declared in a custom migration that sorts before the generated one whose policies call it; plpgsql when the body reads a column added one file later"
    - "Kernel stub seam with a constant body, replaced later by create or replace with the same signature"

key-files:
  created:
    - supabase/migrations/20261111143858_member_communities_functions.sql
    - supabase/migrations/20261111143948_member_communities.sql
    - supabase/migrations/20261111144148_feed_community_audience.sql
    - supabase/migrations/20261111144205_feed_member_update_allowlist.sql
    - supabase/tests/230-member-communities.sql
    - supabase/tests/232-feed-community-audience.sql
  modified:
    - packages/modules/communities/db/schema.ts
    - packages/modules/feed/db/schema.ts
    - supabase/tests/110-communities-stories.sql
    - supabase/tests/180-store.sql
    - supabase/migrations/meta/_journal.json

key-decisions:
  - "A1 embodied: member communities sort after organization ones through the CHECK-backed sentinel position 1000000; the list statement, its index and its cursor are unchanged"
  - "A11 embodied: communities_member_update_gate has no app.social_enabled() term, so the non-definer community_post_stats trigger never fails and post_count keeps moving with social off (pgTAP 110 and 230 section 8 prove it)"
  - "Allow-list decision: the member update guard names what an author may change (caption, media_kind, link_preview_id, edited_at, like_count, comment_count) and allows deleted_at/deleted_by_user_id only as the live -> deleted-by-the-caller transition the service writes; everything else, including clearing deleted_at, raises 42501"
  - "The update and WITH CHECK predicates of communities_member_update_gate are written role-first so a null role claim fails closed (EP-46); the plan's literal form let a null-role lane update as the creator"
  - "The hidden-creator definer is plpgsql, not language sql, because it reads communities.kind which the generated file adds one file later and a sql body is bound at creation"

patterns-established:
  - "Pin repair precedent reused: a new restrictive select clause shrinks the planner estimate again, so 180's P41 pin gets enable_sort = off beside enable_seqscan and enable_bitmapscan"

requirements-completed: [MCOMM-01, MCOMM-07, MCOMM-08, MPUB-04, MPUB-07]

coverage:
  - id: D1
    description: "A member lane creates a community stamped kind member (own user, sentinel position) and nothing else; a second member, a forged creator, a forged kind and an admin inserting kind member are refused"
    requirement: MCOMM-01
    verification:
      - kind: integration
        ref: "supabase/tests/230-member-communities.sql sections 1, 4, 5, 6, 7"
        status: pass
    human_judgment: false
  - id: D2
    description: "A blocked, departed or non-active creator's community and posts leave every read (moderator included) and return on restore; no row is touched; empty tenant and no-claims lane get '{}'"
    requirement: MCOMM-07
    verification:
      - kind: integration
        ref: "supabase/tests/230-member-communities.sql sections 2, 3; supabase/tests/232-feed-community-audience.sql section 4"
        status: pass
    human_judgment: false
  - id: D3
    description: "The third post audience 'community': widened checks, owner insert gate, select gate with no social or follow term, comments and likes inheriting the gates, social off keeps reads"
    requirement: MCOMM-08
    verification:
      - kind: integration
        ref: "supabase/tests/232-feed-community-audience.sql sections 1 to 5"
        status: pass
    human_judgment: false
  - id: D4
    description: "Member update guard is an allow-list; counters keep moving with a member lane writer, social on and off"
    requirement: MPUB-04
    verification:
      - kind: integration
        ref: "supabase/tests/232-feed-community-audience.sql section 6; supabase/tests/110-communities-stories.sql (member-lane reconciliation); supabase/tests/202-feed-member-write-gate.sql"
        status: pass
    human_judgment: false
  - id: D5
    description: "All four migrations are expand-only, apply on a fresh database through the Supabase runner, and db:generate reports no schema changes"
    requirement: MPUB-07
    verification:
      - kind: other
        ref: "pnpm db:generate | grep 'No schema changes' && pnpm db:reset && pnpm db:seed && pnpm supabase test db (64 files, 4347 tests, PASS)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Escopo seam: app.community_action_allowed is constant false (five actions, null community, unknown action, every lane) and the reserved insert branch changes no refusal"
    requirement: MPUB-04
    verification:
      - kind: integration
        ref: "supabase/tests/230-member-communities.sql section 9; supabase/tests/232-feed-community-audience.sql section 2 (member into an organization community raises 42501)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-11-11
status: complete
plan_head_before: 6e07d31335bb22cd7feeaeb360d28bed68f9eb58
commits: 6
---

# Phase 10 Plan 03: Member Communities Schema Summary

**Postgres alone, as the member lane, now lets a member create a `kind = 'member'` community at the sentinel position and publish `'community'` posts in it, refuses every forged kind, creator, audience or non-owner write (42501), hides a blocked or departed creator's community and posts from every read, keeps member communities readable with `social` off, and bounds a member author's updates with an allow-list guard.**

## Performance

- **Duration:** about 25 min
- **Completed:** 2026-11-11
- **Tasks:** 3 of 3 (Task 1 and Task 2 each with a red commit first)
- **Files:** 6 created, 5 modified (plus 4 drizzle snapshots)

## Accomplishments

- **Tracer (Task 1):** custom definer migration first (EP-54), generated `kind` migration second; four restrictive policies on `communities`; pgTAP 230 section 1 red then green.
- **Third audience (Task 2):** `feed_posts.visibility` accepts `'community'`; the shape check forces a community id; the insert gate has the owner branch (active, live, own member community, `social` on) and the reserved Escopo branch; the select gate has a `'community'` branch with no `social` and no follow term; `feed_posts_member_hidden_community_gate` hides a hidden creator's posts; the guard is an allow-list.
- **Proof (Task 3):** pgTAP 230 (74 assertions), 232 (56, including a volume-fixture EXPLAIN pin by index name), 110 extended with a member-lane counter reconciliation (`social` on and off). Full suite after `pnpm db:reset && pnpm db:seed`: 64 files, 4347 tests, PASS; `pnpm db:generate` prints "No schema changes".
- **Escopo seam:** `app.community_action_allowed(uuid, text)` is a constant-false kernel stub with the seam catalog facts; the reserved branch is never taken, and pgTAP 230/232 pin that no answer changed.

## Task Commits

1. **Task 1 RED:** `b2ad9494` (test): failing pgTAP tracer. Target test 1 failed on the assertion (`column "kind" of relation "communities" does not exist`), the file then died at test 2.
2. **Task 1 GREEN:** `b93a2a16` (feat): definer + Escopo stub, `kind`, checks, index, four policies, pgTAP 230 tracer green.
3. **Task 2 RED:** `ba637292` (test): failing pgTAP 232 (tests 1 and 6 failed on the planned behavior: `feed_posts_visibility_chk` and `feed_posts_social_insert_gate` refused the `'community'` post).
4. **Task 2 GREEN:** `ab3d04f4` (feat): third audience, hidden-community gate, allow-list guard, two migrations.
5. **Fix:** `b128ddf8` (fix): fail-closed update gate for a null role (deviation 2 below).
6. **Task 3:** `b30871b5` (test): 230 and 232 completed, 110 extended, 180's planner settings re-pinned.

**Plan metadata:** this SUMMARY is committed separately. STATE.md and ROADMAP.md were not touched (the orchestrator owns them). Nothing was pushed and no hosted project was touched.

## Files Created/Modified

- `supabase/migrations/20261111143858_member_communities_functions.sql` - the two definers (hidden-creator ids, Escopo stub); sorts first.
- `supabase/migrations/20261111143948_member_communities.sql` - `kind`, checks, creator index, four policies.
- `supabase/migrations/20261111144148_feed_community_audience.sql` - widened visibility checks, hidden gate, widened select and insert gates.
- `supabase/migrations/20261111144205_feed_member_update_allowlist.sql` - the allow-list guard body.
- `packages/modules/communities/db/schema.ts`, `packages/modules/feed/db/schema.ts` - the schema source of truth.
- `supabase/tests/230-member-communities.sql`, `232-feed-community-audience.sql`, `110-communities-stories.sql`, `180-store.sql`.

## Decisions Made

- A1, A11 and the allow-list rule are embodied as listed under `key-decisions`.
- The allow-list lets an author soft-delete (the service writes `deleted_at = now()`, `deleted_by_user_id = <author>` together), so `202`'s author soft-delete positive control and the member-lane soft delete in 110 stay green; clearing `deleted_at`, stamping another user, setting one column without the other, and any column outside the list raise 42501.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The hidden-creator definer is `language plpgsql`, not `language sql`**
- **Found during:** Task 1 (design check before writing the file)
- **Issue:** the custom file must sort before the generated one (EP-54, the policies call the function), but the function reads `communities.kind`, which the generated file adds one file later; a `language sql` body is bound at creation and would fail.
- **Fix:** plpgsql body with the identical attributes (stable, security definer, `search_path = ''`, same revoke/grant), explained in the migration header. The Escopo stub stays `language sql` (it reads no table).
- **Files modified:** `supabase/migrations/20261111143858_member_communities_functions.sql`
- **Verification:** pgTAP 230 sections 3 and 9 (behaviour and catalog facts), 040 green.
- **Committed in:** `b93a2a16`

**2. [Rule 2 - Missing critical functionality] Update gate fails closed on a null role**
- **Found during:** Task 3 (pgTAP 230 section 6, EP-46)
- **Issue:** the plan's literal predicate `tenant_role() <> 'member' or created_by_user_id = app.user_id()` is `null or true` = true for the creator when the role claim is null, so a lane with no role claim could update; EP-46 requires refusal.
- **Fix:** role-first form `(tenant_role() = 'member' and created_by_user_id = app.user_id()) or tenant_role() <> 'member'` (and the WITH CHECK analogue). Identical for every non-null role. The generated migration was never pushed, so its policy text and the three drizzle snapshots were patched in place; `pnpm db:generate` still prints "No schema changes".
- **Files modified:** `packages/modules/communities/db/schema.ts`, `supabase/migrations/20261111143948_member_communities.sql`, snapshots `20261111143948`, `20261111144148`, `20261111144205`
- **Verification:** pgTAP 230 section 6 (4 assertions) and the full suite.
- **Committed in:** `b128ddf8`

**3. [Rule 1 - Bug] Existing pin `180-store.sql` P41 broke because of the extra restrictive gate**
- **Found during:** Task 3 (full pgTAP run)
- **Issue:** the new `feed_posts_member_hidden_community_gate` shrinks the merged feed's row estimate again; with 500 volume rows the planner chose `feed_posts_tenant_author_idx` + Sort over the ordered walk of `feed_posts_tenant_created_all_idx`. The same effect was fixed in 09.3-06 with `enable_seqscan`/`enable_bitmapscan` off.
- **Fix:** `set local enable_sort = off` beside them (reset after), with the reason in the file; the name pin stays falsifiable. Início's real read shapes are pinned by name with every gate in place in 201 and in 232 section 7 (both pass).
- **Files modified:** `supabase/tests/180-store.sql` (not in the plan's file list)
- **Verification:** `180-store.sql` and the full suite pass.
- **Committed in:** `b30871b5`

**Total deviations:** 3 auto-fixed (Rule 1, Rule 2, Rule 3). **Impact:** no scope change; item 2 closes a fail-open edge the plan's truth EP-46 asked to close.

## Issues Encountered

- `gsd_run check tdd-red-evidence` was not used: pg_prove output was read directly. The RED evidence is recorded above per commit (target tests failed on the planned behavior, not on syntax or fixture crashes).
- `pnpm db:two` and `pnpm db:migrate-all -- --dry-run` (fresh second database / ledgered fan-out) were not run: the plan's verify chain does not include them and they sit outside the local-only scope. "Applies on a fresh project" is evidenced by three `pnpm db:reset` runs of the full migration set through the Supabase runner; running `db:two` before the release remains advisable.

## User Setup Required

None. The local database was reset and seeded on Igor's word of 2026-11-11 (local stack only).

## Next Phase Readiness

Plans 04, 05 and 06 can read `communities.kind`, `COMMUNITY_MEMBER_POSITION`, the `'community'` audience and `app.member_community_hidden_ids()`. Reminders for them: the service must stamp `kind`, `created_by_user_id`, `position` and `visibility` from the session; Início, Explorar and Reels "Todos" already name `'tenant'`/`'followers'` literally (RESEARCH Pitfall 1 for Reels "Todos" is plan-05/06 work); `reorderCommunities` must add `kind = 'organization'` (Pitfall 3).

## Known Stubs

- `app.community_action_allowed(uuid, text)` is an intentional constant-`false` stub (the Escopo seam, `supabase/migrations/20261111143858_member_communities_functions.sql`). The per-product action scope built after Phase 11 replaces only the body; pgTAP 230 section 9 pins the stub and says its constant-false assertions are replaced then. No UI or data flows through it.

## Threat Flags

None beyond the plan's threat model: no new endpoint, no new auth path. A pre-existing observation, out of scope and not changed: `tenantIsolationPolicy` does not require a role claim, so a lane with a tenant id and a null `tenant_role` is not shut out of a table by isolation alone (the new `communities` and `feed_posts` insert/update gates now fail closed on it; the existing `feed_posts_member_update_guard` still returns NEW for a null role by design of 09-14).

## Self-Check: PASSED

- FOUND: `supabase/migrations/20261111143858_member_communities_functions.sql`, `20261111143948_member_communities.sql`, `20261111144148_feed_community_audience.sql`, `20261111144205_feed_member_update_allowlist.sql`, `supabase/tests/230-member-communities.sql`, `supabase/tests/232-feed-community-audience.sql`
- FOUND commits: `b2ad9494`, `b93a2a16`, `ba637292`, `ab3d04f4`, `b128ddf8`, `b30871b5`
- `commits: 6` measured with `git rev-list --count 6e07d313..HEAD` before this SUMMARY commit
- Sorted migration list puts `*_member_communities_functions.sql` before `*_member_communities.sql`; `grep -c "CREATE POLICY"` on the generated file prints 4; the drop/rename grep prints 0 on both generated files
