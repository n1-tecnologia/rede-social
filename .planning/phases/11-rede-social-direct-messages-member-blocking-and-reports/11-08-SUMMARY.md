---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 08
subsystem: api
tags: [direct-messages, api, lazy-creation, permission-composition, neutral-refusal, rate-limit, isolation, D-719, D-720, D-721, D-722, D-734, CHAT-06]
requires:
  - phase: 11-03
    provides: "app.direct_conversation_open, the pair columns and the readable policy"
  - phase: 11-06
    provides: "the DM001 send guard in the chat_messages BEFORE INSERT trigger"
  - phase: 11-07
    provides: "the block effects (a block either way closes the pair)"
provides:
  - "POST /v1/chat/direct/messages: a member writes to another member by membership id; the conversation is created lazily in the same transaction as the first message, once per pair"
  - "GET /v1/chat/direct/with/{membershipId}: the pair's conversation id or null, the other member and the composer enum (open, blocker, closed)"
  - "chat.direct composed in the app registry for a member when social and chat are both effective"
  - "direct_closed, the one neutral word of a refused direct send (409), appended to CHAT_ISSUES"
  - "directMessageLimiter (30 a minute) and directConversationLimiter (20 an hour)"
  - "direct-fixtures.ts and the phase 11 isolation cases with their inventory entries"
affects: [11-10, 11-12, 11-13, 11-18, 11-22]
tech-stack:
  added: []
  patterns: ["app-tier permission composition for a string that needs two modules (MOD-02)", "one bare 404 for every membership-id miss, a block is not a miss", "limiter spent inside the write transaction after the existence read, before any write"]
key-files:
  created:
    - packages/modules/chat/server/direct.ts
    - packages/modules/chat/tests/direct-contracts.test.ts
    - apps/api/tests/integration/direct-fixtures.ts
    - apps/api/tests/integration/direct-chat.test.ts
  modified:
    - packages/modules/chat/contracts/index.ts
    - packages/modules/chat/server/service.ts
    - packages/modules/chat/server/routes.ts
    - packages/modules/chat/server/index.ts
    - packages/modules/chat/README.md
    - packages/modules/chat/tests/contracts.test.ts
    - packages/core/server/safety/limits.ts
    - apps/api/src/modules/registry.ts
    - apps/api/tests/unit/registry.test.ts
    - apps/api/tests/integration/setup.ts
    - apps/api/tests/integration/isolation.test.ts
    - apps/api/tests/isolation-inventory.ts
key-decisions:
  - "The target is resolved by MEMBERSHIP id in the caller's lane (live member, same tenant, not the caller) and every miss is one bare 404 with an identical body; a member block is NOT a miss at this layer, the database refuses with DM001 and the answer is 409 with details.chat = direct_closed"
  - "directConversationLimiter is spent inside the write transaction, after the existence read and before any write, so only a first send counts and a refused one rolls back with nothing written; directMessageLimiter is spent first, so every attempt counts"
  - "A 42501 from the definer (the caller stopped being live between the guard and the statement) is a plain 403 FORBIDDEN, never a module or a block word"
  - "The with composer reads is_blocked_by_viewer (blocker) before members_blocked_between (closed): a mutual block reads blocker, and the answer has no flag that says blocked me"
requirements-completed: [CHAT-06]
duration: 15 min
completed: 2026-11-19
status: complete
commits: 3
plan_head_before: 202f567fa88f3430973cf51f883d79621e570268
actuals:
  tokens: 38000
  tasks: 3
  commits: 3
coverage:
  - id: D1
    description: "A member writes to another member by membership id; the conversation is born with its first message, one per pair, twenty concurrent first sends make one with seqs 1..20"
    requirement: CHAT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/direct-chat.test.ts#direct tracer 1 and 2"
        status: pass
    human_judgment: false
  - id: D2
    description: "A closed pair is refused 409 direct_closed on both sides with identical bodies naming no block, no name and no id; nothing is written, no conversation is left behind"
    requirement: CHAT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/direct-chat.test.ts#direct tracer 4"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every membership-id miss (staff, self, another tenant, administrator-blocked, removed, anonymised, unknown) is one bare 404 on a send and on with; guards, strict body and the encoding edges hold"
    requirement: CHAT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/direct-chat.test.ts#direct tracer 3, direct with 8 and 9, direct admin block 10 and 11"
        status: pass
    human_judgment: false
  - id: D4
    description: "GET with answers the conversation or null, the other member's name and live avatar, and a composer that differs between blocker and blocked in that word alone"
    requirement: CHAT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/direct-chat.test.ts#direct with 5, 6 and 7"
        status: pass
    human_judgment: false
  - id: D5
    description: "chat.direct is composed only for a member with social and chat effective, never by a manifest, never for staff"
    requirement: CHAT-06
    verification:
      - kind: unit
        ref: "apps/api/tests/unit/registry.test.ts#28 and 29"
        status: pass
    human_judgment: false
  - id: D6
    description: "The abuse limits hold (31st send of a minute, 21st new conversation of an hour are 429) and the support chat is unchanged"
    requirement: CHAT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/direct-chat.test.ts#direct limits 12 and 13, direct support unchanged 15; chat.test.ts 15/15; chat-cases.test.ts 29/29"
        status: pass
    human_judgment: false
  - id: D7
    description: "Cross-tenant: tenant B's session cannot send to tenant A's membership id nor read A's conversation or with, each the bare 404 of an unknown id, beside both positive controls and the wrong-host 403"
    requirement: CHAT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#phase 11 sweep: direct chat and direct with"
        status: pass
    human_judgment: false
---

# Phase 11 Plan 08: Direct messages through the API Summary

A member now opens a direct conversation by sending the first message to another member's membership id: one transaction creates the conversation (through the plan 03 definer) and stores the message (the shared `insertMessage`), the pair never has two, and a closed pair is refused with the single word `direct_closed` that never says why.

## Performance

- **Duration:** 15 min
- **Started:** 2026-11-19T17:41:23Z
- **Completed:** 2026-11-19T17:56:30Z
- **Tasks:** 3
- **Files modified:** 16 (4 created, 12 modified)

## Accomplishments

- `POST /v1/chat/direct/messages` and `GET /v1/chat/direct/with/{membershipId}` under `requireModule('social')` and `requirePermission('chat.direct')`; a staff caller is 403, `social` or `chat` off is `404 MODULE_DISABLED`.
- `chat.direct` is composed in `permissionsFor` for a `member` when `social` and `chat` are both effective (the chat manifest cannot name it: MOD-02); `registry.test.ts` cases 28 and 29 pin it.
- `direct_closed` appended to `CHAT_ISSUES`; strict new schemas (`directSendInputSchema`, `directWithParamsSchema`, `directWithAnswerSchema`, `directSendResultSchema`), `DIRECT_COMPOSER_STATES`, `CHAT_NOTIFICATION_KINDS.directMessage`; no existing response schema gained a required key.
- Limiters: 30 sends a minute and 20 new conversations an hour, in `limits.ts` beside `reportLimiter`.
- Isolation: two `phase 11 sweep` cases (send, with) using a shared identity in both seed tenants, each negative compared with an unknown id, beside its positive control and the wrong-host 403, with their inventory entries.

## Task Commits

1. **Task 1 (tracer): the permission, the contracts, `sendDirectMessage` and the send route** - `d9fb2c84` (feat)
2. **Task 2: the `with` read and the composer enum** - `d9801cf4` (feat)
3. **Task 3: administrator block, removal, limits and support regression through the API** - `c93ae7d8` (test)

**Plan metadata:** the commit of this file (docs: complete plan).

## Verification run

| Gate | Result |
|------|--------|
| `module-chat` vitest (whole package, 16 files) | 296/296 |
| `direct-contracts.test.ts` | 8/8 |
| `apps/api` unit (11 files: registry 30, isolation-inventory 9, module-readmes, admin-lane-inventory) | 138/138 |
| `core` whole suite (limits.ts touched) | 1858/1858 |
| `apps/web` whole suite via `TURBO_CACHE=local:r pnpm turbo test --filter=@rede-social/web --concurrency=4` | 416 files, 10068/10068 |
| `turbo typecheck lint` for web, module-chat, api, core (web build included) | 10 tasks green |
| `pnpm boundaries`, `scripts/check-ui-literals.sh`, `pnpm guard:lanes` | OK |
| `direct-chat.test.ts` | 15/15 (tracer 4, with 5, admin block 2, limits 3, support unchanged 1) |
| `isolation.test.ts -t "phase 11 sweep"` | 2/2 |
| `chat.test.ts`, `chat-cases.test.ts` (shipped support suites, unchanged) | 15/15, 29/29 |
| `social-module.test.ts`, `bootstrap.test.ts` (permission composition neighbours) | 13/13, 24/24 |

pgTAP was not run: this plan changes no migration and no schema (the database half is plans 03, 06, 07).

## Decisions Made

- The new-conversation limiter is spent inside the write transaction after the existence read, so a concurrent first send counts once per attempt and a refusal rolls back with nothing written. The plan listed the limiters before the transaction; both are still before any write, and the existence read is what makes "only when no conversation exists yet" possible.
- A `42501` is mapped to a plain `403 FORBIDDEN` (the caller stopped being live), never to the module or a block word (Pitfall 4).
- `getDirectWith` always answers `removed: false`: a removed member is a miss here, the `removed` composer state belongs to the list and detail of plan 10.
- A mutual block reads `blocker` (the member can still lift their own); the answer never carries a "blocked me" field.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Two existing pin tests broke when the closed lists grew**
- **Found during:** Task 1
- **Issue:** `packages/modules/chat/tests/contracts.test.ts` pinned `CHAT_PERMISSIONS` (three keys) and `CHAT_ISSUES` (13 words), which the plan's own contract change makes four and 14.
- **Fix:** updated both pins, appended `direct_closed` last as the plan requires.
- **Files modified:** `packages/modules/chat/tests/contracts.test.ts`
- **Committed in:** `d9fb2c84`

**2. [Rule 3 - Blocking] The module README test demanded the new kernel import**
- **Found during:** Task 1
- **Issue:** `module-readmes.test.ts` failed with "kernel dependencies: @rede-social/core/server/safety/limits is not listed".
- **Fix:** listed it and documented the direct routes, the permission, the neutral word and the limits in the chat README (the plan allowed the README edit).
- **Files modified:** `packages/modules/chat/README.md`
- **Committed in:** `d9fb2c84`, `d9801cf4`

**3. [Rule 1 - Bug in my own test] Two Task 3 fixtures were wrong, not the service**
- **Found during:** Task 3
- **Issue:** the anonymised-member fixture violated `memberships_deletion_chk` (anonymised needs a deletion request and due date), and the support-unchanged case used `post` without importing it.
- **Fix:** the fixture sets `deletion_requested_at` and `deletion_due_at` like the real flow; added the import. No production code changed.
- **Committed in:** `c93ae7d8`

---

**Total deviations:** 3 auto-fixed (2 bug, 1 blocking). **Impact:** none on the delivered behaviour.

## Issues Encountered

- Task 3 had no red-then-fix cycle on the service: tests 10 to 15 (administrator block, removal, limits, MODULE_DISABLED on lab, support unchanged) passed as soon as the fixtures were right, because the database rules of plans 03 and 06 and the Task 1 resolver already produced them. The tests are not vacuous: each asserts the refusal, the rollback (row counts) and a positive control beside it.
- **Pre-existing red, not mine:** `apps/api/tests/integration/modules.test.ts` cases 1 and 9 fail because rede-demo has `payments` enabled in the local database while the test lists nine keys (the diff is the single extra key `payments`; nothing from chat or social). Not touched, not reseeded.
- Leftover `case-sweep-sent-*` throwaway users in the local auth table are from earlier suites; the users this plan created were all removed (0 direct rows, 0 blocks, demo and lab module rows back to their seed values).

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Threat Flags

None. The new surface sits inside the plan's threat model: T-11-01 (isolation cases with positive controls), T-11-06 (one bare 404, byte-compared in tests 3 and 8), T-11-03 (409 `direct_closed` only, no block word, name or id in the body, tests 4 and 7), T-11-07 (limiters, tests 12 and 13), T-11-22 (registry composition, cases 28 and 29, tests 3 and 9).

## Next Phase Readiness

- Plan 10 (list, detail, counters) can reuse `resolveDirectTarget` and `directConversationOf` from `server/direct.ts` and the `removed` composer state.
- Plan 12 (voice) reuses `insertMessage` (now exported with `MessageContent`); plan 13 produces the push for `CHAT_NOTIFICATION_KINDS.directMessage` from the ids-only `chat.message_sent` this plan emits (the existing source returns nothing for a non-support conversation).
- Web plans consume `directSendInputSchema`, `directWithAnswerSchema`, `DIRECT_COMPOSER_STATES` and the `direct_closed` word.
- Nothing was pushed, no hosted project touched, ROADMAP, STATE and REQUIREMENTS not edited.

## Self-Check: PASSED

- Files exist: `packages/modules/chat/server/direct.ts`, `packages/modules/chat/tests/direct-contracts.test.ts`, `apps/api/tests/integration/direct-fixtures.ts`, `apps/api/tests/integration/direct-chat.test.ts`.
- Commits `d9fb2c84`, `d9801cf4`, `c93ae7d8` are in `git log`; `git rev-list --count 202f567f..HEAD` before this commit was 3.
- Acceptance greps: `direct_closed` in the contracts, `POST /v1/chat/direct/messages` and `GET /v1/chat/direct/with/:membershipId` in the isolation inventory, each case id matching an `it(` title (`isolation-inventory.test.ts` 9/9).
