---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 07
subsystem: database
tags: [member-block, follow-graph, definer, rls, expand-only, D-722, D-723, D-724, D-725, D-616, CHAT-07]
requires: ["11-03", "11-06"]
provides:
  - "app.member_block_create replaced: pair conversation row lock (for update) before the block is written, then both social_follows rows between the pair deleted in the claim's tenant, on every call"
  - "social_follows_insert_member gains `and not (select app.members_blocked_between(followee_user_id))`: a follow across a block is refused from both sides"
  - "pgTAP 238-direct-block-effects.sql sections 6 to 9 (109 assertions in the file)"
affects: [11-10, 11-11, 11-12]
tech-stack:
  added: []
  patterns: ["create or replace of a shipped definer from its NEWEST body", "lock first, then the block table (same order as the send guard)", "refusal compared with the unknown-target failure to prove the block is not revealed"]
key-files:
  created:
    - supabase/migrations/20261119173204_block_effects.sql
    - supabase/migrations/20261119173313_follow_block_policy.sql
    - supabase/migrations/meta/20261119173204_snapshot.json
    - supabase/migrations/meta/20261119173313_snapshot.json
  modified:
    - packages/modules/social/db/schema.ts
    - supabase/migrations/meta/_journal.json
    - supabase/tests/238-direct-block-effects.sql
    - apps/api/tests/integration/reports-blocks.test.ts
    - apps/api/tests/integration/member-communities.test.ts
key-decisions:
  - "The follow delete runs on every call, even when the block row already existed, so a follow that reappeared out of band is cleared by the second call (answer stays false)"
  - "The lock selects the paired direct by tenant and least/greatest of the two uuids; no paired row means no lock and no wait"
  - "The policy term sits in a scalar subselect like the existing social_enabled term"
requirements-completed: [CHAT-07]
duration: about 45 min
completed: 2026-11-19
status: complete
commits: 4
plan_head_before: 22726e1ee7e15623e2178db35b84ccee1f2edfdb
actuals:
  tokens: 40000
  tasks: 3
  commits: 4
coverage:
  - id: D1
    description: "A member block deletes both follow rows between the pair in the claim's tenant in its own transaction and deletes no conversation, message or participant"
    requirement: CHAT-07
    verification:
      - kind: integration
        ref: "supabase/tests/238-direct-block-effects.sql sections 6 and 7"
        status: pass
    human_judgment: false
  - id: D2
    description: "The block takes the pair's conversation lock before writing member_blocks, so a send and a block serialise"
    requirement: CHAT-07
    verification:
      - kind: integration
        ref: "supabase/tests/238-direct-block-effects.sql (body order assertion)"
        status: pass
    human_judgment: true
    rationale: "pgTAP proves the statement order in the body; the real two-connection race is plan 12's proof"
  - id: D3
    description: "A follow across a block is refused from both sides with the unknown-target failure; other pairs, other tenants and the unblocked pair are accepted"
    requirement: CHAT-07
    verification:
      - kind: integration
        ref: "supabase/tests/238-direct-block-effects.sql section 8"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every preserved Phase 13 behaviour of the block definer (BL001, 42501, definer hardening, grants, idempotency, blocker-only read)"
    requirement: CHAT-07
    verification:
      - kind: integration
        ref: "supabase/tests/238-direct-block-effects.sql section 9 and 223-reports-blocks.sql"
        status: pass
    human_judgment: false
---

# Phase 11 Plan 07: Block effects in the database Summary

A member block now takes the pair's conversation row lock, writes the block, and deletes both follow rows between the two members in the same transaction; the follow insert policy refuses a new follow across a block from either side; no conversation, message or participant is ever deleted.

## What was built

- Task 1 (6a628ae0, tracer): `*_block_effects.sql` replaces `app.member_block_create` from the newest body (`20261105152916_reports_blocks_functions.sql`, confirmed as the only file defining it). After the target checks and before the insert, a `perform ... for update` locks the paired direct (tenant, `least`/`greatest` of the two uuids). After the `on conflict do nothing` insert and its row count, `delete from public.social_follows` removes the two directions between the caller and the target in the claim's tenant, on every call. Return value, definer hardening, `revoke all` from public and `grant execute` to authenticated are unchanged. pgTAP sections 6 (path, scope, history intact, composer closed for both) and 7 (empty edge, idempotency, unblock restores nothing).
- Task 2 (abc6e5c7): `social_follows_insert_member` in `packages/modules/social/db/schema.ts` gains the `members_blocked_between` term; drizzle-kit emitted a single `ALTER POLICY` (`*_follow_block_policy.sql`). pgTAP section 8: both sides refused 42501, the refusal is identical to a follow toward an unknown target, third-member and other-tenant positive controls, accepted again after unblock.
- Task 3 (12a35af6, [BLOCKING] push): pgTAP section 9 pins every preserved behaviour (BL001 for null, self, admin, support, removed, administrator-blocked, another tenant's and unknown targets; 42501 for no claims, a removed caller and an administrator-blocked caller; security definer with an empty `search_path` and boolean return; anon cannot execute, authenticated can; two calls leave one row; the blocked member, a third member and the administrator read no `member_blocks` row, the blocker reads theirs). Both migrations were applied to the LOCAL stack with `migration up --local`; both drift gates answer `No schema changes`.
- Fix commit (3716afe2): two shipped integration suites outside the plan's files turned red because of the new behaviour (see Deviations).

## Verification run

| Gate | Result |
|------|--------|
| pgTAP 000, 152, 223, 235, 236, 237, 238 | PASS (238 alone is 109 assertions) |
| pgTAP 200, 201, 202, 203 (social), 010, 020, 160, 231 | PASS |
| `pnpm db:generate`, `pnpm db:generate:central` | both `No schema changes` |
| shape grep over the two migrations | no match (expand-only) |
| `reports-blocks.test.ts`, `social-module.test.ts` (after pgTAP) | 35/35 |
| `story-comment-block`, `member-communities` (48), `member-stories` (46), `move-copy`, `social`, `feed-social` | all green |
| `tests/unit/admin-lane-inventory`, `module-readmes`, `isolation-inventory` | 49/49 |
| `packages/modules/social` vitest + `tsc --noEmit` | 67/67, clean |
| `pnpm boundaries`, `check-ui-literals.sh`, `pnpm guard:lanes`, biome on the edited files | OK |
| `isolation.test.ts` | 88/93; the 5 reds are stories and events (b3, b8, events x2, phase 10 member-story sweep): the seeded demo stories and events are stale, a pre-existing red, not caused by this plan |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug caused by my change] `reports-blocks.test.ts` relied on a follow the block now clears**
- **Found during:** Task 3 (integration run after pgTAP)
- **Issue:** the "five read paths" test blocks and unblocks the author while the blocker's follow of the author carries the author's followers-only post to Explorar; D-724 deletes that follow and unblocking restores nothing, so the Explorar positive control and the 404 of the followers-only detail changed (now the 403 of the followers-only gate, before the viewer-block 404).
- **Fix:** a `followAuthor()` helper sets the follow again before the positive controls and after the unblock (with an assertion that the unblock restored nothing); the member-detail assertion accepts 403 or 404 with a comment.
- **Files modified:** `apps/api/tests/integration/reports-blocks.test.ts`
- **Commit:** 3716afe2

**2. [Rule 1 - Bug caused by my change] a block through the API deleted a SEEDED follow of the local database**
- **Found during:** Task 3 (`member-stories.test.ts` test 6 went red after `member-communities` ran)
- **Issue:** `member-communities` (A12) has Marcos block Helena through `/v1/blocks`; the definer now deleted the seeded `helena.kuster -> marcos.vinicius` follow of rede-lab (`scripts/seed.ts`, 09-02), which `member-stories` and other suites read.
- **Fix:** the A12 test remembers whether the follow existed and puts it back after the unblock. The local row was re-inserted once by hand with the seed's own statement (`on conflict do nothing`); no reseed, no reset.
- **Files modified:** `apps/api/tests/integration/member-communities.test.ts`
- **Commit:** 3716afe2

**Total deviations:** 2 auto-fixed (both Rule 1, both test-side fallout of the plan's intended behaviour). **Impact:** none on the delivered schema.

## Issues Encountered

- Other suites that block seeded lab members through the API (the Phase 13 and Phase 11 story-comment suites, Phase 12 tests) now clear follows of the same two users. `story-comment-block` blocks Alvaro -> Marcos, a pair with no seeded follow, so it is safe today; any future suite that blocks a seeded follower pair must restore the follow as `member-communities` does.
- Plan 12's two-connection proof is the real send-versus-block race; here the lock order is asserted from the function body only.

## Notes for the next plans

- Plan 11 (API): the neutral 404 for a follow toward a blocked pair is the first layer; the policy refuses with 42501 as the backstop and the failure text equals an unknown target's.
- Plans 10, 11, 12: `app.member_block_create` still returns true only when this call created the block; follow rows are gone either way, `social` on or off.
- Nothing was pushed or applied to a hosted project; every migration command used `--local` (or the default local `migration up --local`).

## Known Stubs

None.

## Threat Flags

None. The new surface sits inside the plan's threat model (T-11-01, T-11-03, T-11-04, T-11-21), each with a pgTAP assertion.

## Self-Check: PASSED

- Files: `20261119173204_block_effects.sql`, `20261119173313_follow_block_policy.sql`, both snapshots, `238-direct-block-effects.sql` and this file exist.
- Commits 6a628ae0, abc6e5c7, 12a35af6 and 3716afe2 are in `git log`; `rev-list --count 22726e1e..HEAD` before this commit was 4.
- Acceptance criteria re-run: `grep social_follows` and `grep for update` over `*_block_effects.sql` match, `members_blocked_between` in `*_follow_block_policy.sql` matches and the file is one `ALTER POLICY`, 223 passes unchanged, both drift gates print `No schema changes`, shape grep prints nothing.
- ROADMAP.md, STATE.md and REQUIREMENTS.md were not touched; `.planning/sketches/025-phase-11-designed-screens/` was not touched.
