---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 03
subsystem: database
tags: [direct-messages, schema, rls, pair-uniqueness, expand-only, definer, D-719, D-720, D-721, CHAT-06]
requires: []
provides:
  - "chat_conversations.direct_low_user_id / direct_high_user_id, two CHECKs and the partial unique index chat_conversations_direct_pair_uq"
  - "app.direct_conversation_open(uuid) returning (conversation_id, created): the only creator of a direct conversation, SQLSTATE DM001"
  - "app.pair_open_in (no lane grant), app.members_blocked_between, app.social_pair_open (system user only), app.direct_pair_readable"
  - "chat_conversations_insert narrowed to support rows; chat_conversations_select gains the readable-pair term"
  - "pgTAP 237-direct-conversations.sql (86 assertions)"
affects: [11-06, 11-07, 11-09]
tech-stack:
  added: []
  patterns: ["claims-pinned security definer with one neutral SQLSTATE", "partial unique index as the on-conflict arbiter of a lazy creator", "uuid byte-order pair encoding"]
key-files:
  created:
    - supabase/migrations/20261119155818_direct_pair_gates.sql
    - supabase/migrations/20261119155903_direct_pairs.sql
    - supabase/migrations/20261119155914_direct_open.sql
    - supabase/migrations/20261119160110_direct_policies.sql
    - supabase/tests/237-direct-conversations.sql
  modified:
    - packages/modules/chat/db/schema.ts
    - supabase/migrations/meta/_journal.json
key-decisions:
  - "A refusal never says why: eight causes (staff target, self, other tenant, block either way, administrator-blocked, removed, null) and social off all answer DM001 with the one message 'direct_conversation_open: not available'; a non-live or claimless caller is 42501"
  - "A staff caller of the opener is DM001 (not 42501): the live check is role-agnostic, the role check lives in app.pair_open_in"
  - "An existing pair cannot be re-opened while a block stands or social is off (DM001), though its rows stay untouched"
  - "app.direct_pair_readable is not a 'caller is a participant' check; the participant term already in the select policy does that, the new term only answers 'is the pair open'"
requirements-completed: [CHAT-06]
duration: about 25 min
completed: 2026-11-19
status: complete
commits: 3
plan_head_before: 027c2ca5dd33873bdb68a1a05dadfd570ba34252
actuals:
  tokens: 60000
  tasks: 3
  commits: 3
---

# Phase 11 Plan 03: Direct conversation database half Summary

One conversation per member pair per tenant, created only by a claims-pinned definer (`app.direct_conversation_open`) that enrols both members and refuses every ineligible opening with the single SQLSTATE `DM001`, plus a select-policy term that hides a paired direct while the administrator has blocked or removed the other member or `social` is off.

## What was built

- Task 1 (75d966d6, tracer): the four helper functions (`*_direct_pair_gates.sql`, sorted first), the generated pair columns, `chat_conversations_direct_pair_chk`, `chat_conversations_direct_pair_kind_chk` and the partial unique index `chat_conversations_direct_pair_uq` (tenant first) (`*_direct_pairs.sql`), and `app.direct_conversation_open` (`*_direct_open.sql`, `on conflict` on the pair index, both users enrolled as `member`). pgTAP 237 sections 1 and 2. The bare direct fixtures of 152, 235 and 236 still pass because no CHECK forces the pair on every direct row.
- Task 2 (4f5aa84d): `*_direct_policies.sql` (two `ALTER POLICY`): the lane insert keeps only the `support` branch, the select policy ANDs `direct_low_user_id is null or app.direct_pair_readable(...)`. pgTAP sections 3 and 4: lane refusals (paired and bare direct, a creator enrolling someone else, a third member enrolling itself), the support insert as positive control, readable by both participants only (third member, `support_tenant`, `admin_tenant` and tenant B see nothing, with positive controls), social off and on, `blocked_at`, `status = 'blocked'`, `deleted_at`, anonymised, and the two 12.4 triggers leaving a direct alone.
- Task 3 (97616cb0, [BLOCKING] push): pgTAP sections 5 to 7 (eligibility matrix, concurrency by construction, participant invariant, grants). Migrations applied to the LOCAL stack with `scripts/supabase.sh migration up`; both drift gates answer `No schema changes`; the destructive-statement grep matches nothing.

## Verification run

| Gate | Result |
|------|--------|
| pgTAP 000, 152, 235, 236, 237 | PASS (658 assertions; 237 alone is 86) |
| `pnpm db:generate`, `pnpm db:generate:central` | both `No schema changes` |
| shape grep over the four migrations | no match (expand-only) |
| `vitest run tests/integration/chat.test.ts` (after pgTAP) | 15/15 |
| `vitest run` in `packages/modules/chat` | 288/288; `tsc --noEmit` clean |
| `tests/unit/isolation-inventory`, `admin-lane-inventory`, `module-readmes` | 49/49 |
| `pnpm boundaries`, `scripts/check-ui-literals.sh`, `pnpm guard:lanes` | OK |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] drizzle-kit named the two generated migrations randomly**
- **Found during:** Tasks 1 and 2
- **Issue:** `drizzle-kit generate` produced `*_boring_lady_bullseye.sql` and `*_eager_texas_twister.sql`, but the plan's artifacts are `*_direct_pairs.sql` and `*_direct_policies.sql`.
- **Fix:** renamed both files and their `tag` in `_journal.json` before applying (the snapshot files are keyed by timestamp only).
- **Commits:** 75d966d6, 4f5aa84d

**2. [Rule 1 - Bug in my own test] two assertions mis-modelled the fixture**
- **Found during:** Tasks 2 and 3
- **Issue:** the tenant B open returned `created = false` because section 2 already stored tenant B's row for the same pair, and a participant cannot count the other participant's row (`chat_participants_select` is own rows only).
- **Fix:** the first now asserts the tenant B call answers tenant B's own conversation id; the second counts as the table owner. No production code changed.

**Total deviations:** 2 auto-fixed (1 blocker, 1 test-only bug). **Impact:** none on the delivered schema.

## Notes for the next plans

- Twenty truly concurrent first calls were not run (no multi-session harness in pgTAP). The guarantee is by construction: one atomic `INSERT ... ON CONFLICT` on the partial unique index, losers wait for the winner's commit and read its id; pgTAP asserts the arbiter text and that two calls in one transaction leave one row.
- `has_function_privilege` confirmed `app.pair_open_in` is executable by neither `authenticated`, `anon`, `service_role` nor `api_user`; only other definers (owner) reach it.
- Plan 06 (triggers and notice) can call `app.pair_open_in(tenant, a, b)` from definers and `app.social_pair_open` from the worker lane (zero system user). Plan 07 owns the block's effects and the CHAT-07 `empty` edge.
- Hosted push (the four migrations) is the release plan's and Igor's; nothing was pushed or applied to a hosted project.

## Known Stubs

None.

## Threat Flags

None. The new definers sit inside the plan's threat model (T-11-01, T-11-02, T-11-03, T-11-05, T-11-19), each with a pgTAP assertion.

## Self-Check: PASSED

- Files: the four migrations, `237-direct-conversations.sql`, `schema.ts` and this file exist.
- Commits 75d966d6, 4f5aa84d and 97616cb0 are in `git log`; `rev-list --count 027c2ca5..HEAD` before this commit was 3.
- ROADMAP.md, STATE.md and REQUIREMENTS.md were not touched.
