---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 27
subsystem: api
tags: [member-block, api, membership-keyed, no-user-id-exposure, neutral-refusal, gap-closure-13-14, D-616, D-722, D-733, A7]

requires:
  - phase: 11
    provides: "plan 07 block definers and effects (follows removed, DM001/BL001 pair closing); plan 14 report contracts file"
  - phase: 13
    provides: "13-14 user-id block routes, blockLimiter, the blocked list (the gap this closes)"
provides:
  - "POST /v1/blocks/members/{membershipId} and DELETE /v1/blocks/members/{membershipId}, answering { changed } only"
  - "blockMemberByMembership and unblockMemberByMembership in the safety service"
  - "blockMembershipParamsSchema (strict uuid) in the moderation contracts"
affects: [11-20, 11-22, 11-23, 11-24]

actuals:
  tokens: 11000
  tasks: 2
  commits: 1
plan_head_before: 36180f48576efeb3d8b2340dfb80497db78b716f

tech-stack:
  added: []
  patterns:
    - "A membership-keyed route resolves the target to a user id INSIDE the caller's tenant transaction and reuses the shipped SQL definer, so the id never leaves the server"
    - "A lookup miss throws the same ApiError(400, CANNOT_BLOCK) that the definer's BL001 maps to: one refusal body, no oracle"

key-files:
  created:
    - apps/api/tests/integration/block-by-membership.test.ts
  modified:
    - packages/contracts/src/moderation.ts
    - packages/contracts/tests/moderation.test.ts
    - packages/core/server/safety/blocks.ts
    - packages/core/server/safety/index.ts
    - apps/api/src/routes/safety.ts
    - apps/api/tests/integration/isolation.test.ts
    - apps/api/tests/isolation-inventory.ts

key-decisions:
  - "Option (b) of the Phase 13 gap: membership-keyed routes; the rejected alternative, an optional author.userId on every author card, would put the cross-community identity (stories rule A7) on the wire and is NOT done (T-11-34)"
  - "The unblock resolves the membership WITHOUT a liveness predicate, so a member removed since can still be unblocked; a miss is { changed: false } (never an error, never an oracle)"
  - "Both new routes consume the shared blockLimiter (60 an hour, every attempt counted); the shipped DELETE /v1/blocks/{userId} is untouched and still does not consume it"
  - "A-11-ROLE stays the recorded residual: the route enforces only what the SQL definer enforces; the canBlock rider and the screens keep staff from being offered Bloquear"

patterns-established:
  - "Membership id in, user id never out: author cards and directory rows carry the membership id, every action route keyed by it resolves in the lane"

requirements-completed: [CHAT-07, MODER-04]

coverage:
  - id: D1
    description: "A member blocks and unblocks another by membership id; the follows go with the block; repeats answer changed false; the blocked member sees no block; no user id in any answer"
    requirement: CHAT-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/block-by-membership.test.ts#block by membership tracer"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every miss (staff, self, another tenant, unknown, removed, blocked by the administrator) answers the byte-identical 400 CANNOT_BLOCK of the shipped user-id route; an unblock of any non-blocked id is 200 changed false"
    requirement: MODER-04
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/block-by-membership.test.ts#refusal matrix"
        status: pass
    human_judgment: false
  - id: D3
    description: "Tenant isolation: a shared identity blocks only in the request tenant, tenant B's membership id is refused, the wrong host is 403, both routes are in the isolation inventory"
    requirement: CHAT-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/block-by-membership.test.ts#tenant"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#phase 11 sweep: block by membership"
        status: pass
      - kind: unit
        ref: "apps/api/tests/unit/isolation-inventory.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "The routes are silent: no notification, no job, no moderation row, nothing changes in the blocked member's own reads"
    requirement: CHAT-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/block-by-membership.test.ts#silent"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-11-19
status: complete
---

# Phase 11 Plan 27: Block by membership id Summary

**Membership-keyed `POST` and `DELETE /v1/blocks/members/{membershipId}` that resolve the target in the caller's tenant lane, reuse the shipped block definers, refuse every miss with the one `400 CANNOT_BLOCK` body and put no user id on the wire.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-11-19
- **Tasks:** 2
- **Files modified:** 8 (1 created)

## Accomplishments

- A block menu can now block and unblock the member behind a card with the id the card already holds. The service resolves `memberships.id` to a user id inside one `withTenantTx` and calls `app.member_block_create` / `app.member_block_delete`; the user id never leaves the transaction, the answer is `{ changed }` only and the log line names no target.
- One refusal body: a lookup miss throws the same `ApiError(400, 'CANNOT_BLOCK')` the definer's `BL001` maps to, so unknown, another tenant's, staff, oneself, removed and administrator-blocked members compare byte for byte equal to the shipped user-id route's staff-target answer (7 miss kinds, block side), and an unblock of any id holding no block of the caller is the same `200 { changed: false }`.
- The unblock has no liveness predicate: a member removed since can still be unblocked by membership id, and the shipped list row of a departed member (`displayName: null`) still unblocks by user id.
- The shared 60-per-hour `blockLimiter` counts every attempt of both new routes and answers `429 RATE_LIMITED`; the shipped routes are untouched.
- Tenant safety: a shared identity with memberships in demo and lab blocks only in the request's tenant (the other tenant's membership id is the same 400, the other tenant's follow is untouched, the wrong host is 403), proved in the file and in the isolation suite with positive controls; both routes are in `isolation-inventory.ts`.

## Task Commits

Both tasks were authored together (the tracer's tests, the refusal matrix, tenant and silent cases were written up front in the same files) and landed in one path-scoped commit:

1. **Task 1 (tracer) and Task 2 (refusal matrix, tenant, silent, typecheck):** `4f18267d` (feat)

**Plan metadata:** the SUMMARY commit that follows.

## Files Created/Modified

- `packages/contracts/src/moderation.ts` - `blockMembershipParamsSchema` (strict `{ membershipId: uuid }`)
- `packages/contracts/tests/moderation.test.ts` - cases for the params schema and the `{ changed }`-only answer
- `packages/core/server/safety/blocks.ts` - `blockMemberByMembership`, `unblockMemberByMembership`, and the lane lookup
- `packages/core/server/safety/index.ts` - exports the two functions
- `apps/api/src/routes/safety.ts` - the two routes beside the user-id ones, with the shared limiter and `Cache-Control: no-store`
- `apps/api/tests/integration/block-by-membership.test.ts` - the proof (9 tests, throwaway members, all rows swept)
- `apps/api/tests/integration/isolation.test.ts`, `apps/api/tests/isolation-inventory.ts` - the `phase 11 sweep: block by membership` case and the two inventory entries

## Decisions Made

- Option (b) of the Phase 13 SUMMARY gap, as the plan decided. The rejected alternative (an additive optional `author.userId` on every author card) is recorded here per T-11-34: it would expose the cross-tenant person identity (stories rule A7).
- Membership lookup is by `id` plus the caller's tenant id, with no `deleted_at` / role / status predicate: the block route's refusals of staff and removed members are the SQL definer's, and the unblock needs to find removed members.
- No migration, no schema change, no change to the blocked list or the shipped routes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in my own test] The wrong-host negative used a shared identity**
- **Found during:** Task 1 (full `isolation.test.ts` run)
- **Issue:** the 11-27 isolation case sent a demo token of a shared identity (members of both tenants) on the lab host and expected the 403; that identity is legitimately a lab member, so the call was a valid 200.
- **Fix:** the host-refusal negatives use the demo-only seeded member session (`tokens.demoMember`) on the lab host, as the sibling sweeps do.
- **Files modified:** `apps/api/tests/integration/isolation.test.ts`
- **Verification:** the case passes in the full file.
- **Committed in:** `4f18267d`

### Process deviation

- Task 1 and Task 2 share one commit instead of two: the Task 2 cases (refusal matrix, tenant, silent) were written in the same pass as the tracer, in the same files, and splitting them afterwards would have produced a commit whose tests did not match its code. The contract test was seen RED first (schema missing, 1 failed of 33) before the schema was added; the integration file was written before the routes existed.

**Total deviations:** 1 auto-fixed (test bug) plus 1 process note. **Impact:** none on behaviour.

## Issues Encountered

- `pnpm exec biome` needed the file list on one command line without a variable (the variable was not word-split under zsh); formatting was applied with `biome check --write` before the commit.
- `timeout` is not installed on this machine; the web suite ran without it.

## Gates run

| Gate | Result |
|------|--------|
| `packages/contracts` full suite | 20 files, 628 tests pass |
| `packages/core` full suite | 116 files, 1858 tests pass |
| `apps/api` unit suite (inventory, module readmes, lane inventory) | 13 files, 146 tests pass |
| `block-by-membership.test.ts` | 9 of 9 pass |
| `reports-blocks`, `reports-new-subjects`, `direct-chat-block`, `social-block`, `story-comment-block`, `direct-chat`, `direct-notifications`, `member-communities`, `direct-chat-voice` | all pass, one by one |
| `isolation.test.ts` (full) | 94 of 98 pass; the 4 red are the pre-existing seed-staleness ones (b3, b8, two events tests), none mine; the 11-27 case passes |
| `turbo typecheck` core, contracts, api, web | clean |
| `TURBO_CACHE=local:r pnpm turbo test --filter=@rede-social/web --concurrency=4` | 416 files, 10068 tests pass |
| `pnpm boundaries`, `scripts/check-ui-literals.sh`, `pnpm guard:lanes`, `biome check` | clean |

No seeded row was touched (all fixtures are throwaway members and shared identities swept in `afterAll`); the local `member_blocks` table was verified empty and no fixture user remained after the runs. Free disk was 8.6 GiB at the end; `apps/web/.next/cache` removed.

## Known Stubs

None.

## Threat Flags

None. The two routes add no surface beyond the planned T-11-34, T-11-06, T-11-01, T-11-03 and T-11-07 mitigations (membership id in, no user id out; one refusal body; lane lookup; silent; shared limiter).

## Next Phase Readiness

Plans 20, 22, 23 and 24 can call `POST` and `DELETE /v1/blocks/members/{membershipId}` from the block dialog and the unblock buttons with the membership id their cards already hold.

## Self-Check: PASSED

- `apps/api/tests/integration/block-by-membership.test.ts` exists; `grep -q "blocks/members"` matches `apps/api/src/routes/safety.ts` and `apps/api/tests/isolation-inventory.ts`; `blockMemberByMembership` is in `packages/core/server/safety/blocks.ts`; `CANNOT_BLOCK` is in the new test.
- Commit `4f18267d` exists; `reports-blocks.test.ts` passes unchanged.

---
*Phase: 11-rede-social-direct-messages-member-blocking-and-reports*
*Completed: 2026-11-19*
