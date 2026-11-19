---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 10
subsystem: api
tags: [direct-messages, api, conversas-list, unread-counters, composer-state, neutral-refusal, D-719, D-721, D-722, D-723, D-725, CHAT-06, CHAT-07]
requires:
  - phase: 11-03
    provides: "the pair columns and the readable policy app.direct_pair_readable"
  - phase: 11-07
    provides: "the member block effects (a block closes the pair, never hides it)"
  - phase: 11-08
    provides: "chat.direct, the direct service file, the send and with routes, the fixtures"
  - phase: 11-09
    provides: "chat_participants_select narrowed so staff read participants of support conversations only"
provides:
  - "GET /v1/chat/direct: the Conversas list (support summary on page 1, paired rows newest first, 20 a page by keyset)"
  - "GET /v1/chat/direct/{conversationId}: other member, composer enum, canBlock, positions"
  - "chatCounters member branch: support dot plus unread directs, conversationsBadge count, when chat.direct is held"
  - "memberSupportUnread: the one statement of the support dot shared by the counter and the list"
  - "strict new contracts for the list, the preview, the other member and the detail"
affects: [11-11, 11-12, 11-13, 11-18, 11-19, 11-22]
tech-stack:
  added: []
  patterns:
    - "list, counter and reads share the lane and the readable policy, no restated predicate (T-11-25)"
    - "composer as one finished enum by precedence removed, blocker, closed, open; the only block-derived fact"
    - "support dot read by one exported statement used by two callers"
key-files:
  created:
    - apps/api/tests/integration/direct-chat-block.test.ts
  modified:
    - packages/modules/chat/contracts/index.ts
    - packages/modules/chat/server/direct.ts
    - packages/modules/chat/server/service.ts
    - packages/modules/chat/server/routes.ts
    - packages/modules/chat/server/index.ts
    - packages/modules/chat/README.md
    - packages/modules/chat/tests/direct-contracts.test.ts
    - apps/api/tests/integration/direct-chat.test.ts
    - apps/api/tests/integration/direct-fixtures.ts
    - apps/api/tests/integration/isolation.test.ts
    - apps/api/tests/isolation-inventory.ts
key-decisions:
  - "Staff never read a member-to-member direct: the list and detail select through the caller's own participant row, so they rely on nothing 11-09 narrowed"
  - "The other member is the pair user that is not the caller, joined to memberships in the lane; a membership the lane cannot see, a soft-deleted or an anonymised one is removed with a null id, name and avatar"
  - "support is absent (not null) on pages after the first, so the first page is the only one that pays for the support read"
  - "The counter predicate is c.last_seq > p.last_read_seq as the plan says; the row unread number counts live messages of the other side above the read position, capped at 100"
  - "canBlock compares ctx.role to member on the server; the web never compares a role"
requirements-completed: [CHAT-06, CHAT-07]
duration: 16 min
completed: 2026-11-19
status: complete
commits: 3
plan_head_before: da5dd7034f82ad3ed1fa4b2edbea1a636c42b84a
actuals:
  tokens: 52000
  tasks: 3
  commits: 3
coverage:
  - id: D1
    description: "The Conversas list: support row plus paired rows newest first, unread counts, previews (text, recording, retired recording), anonymised member kept unnamed, keyset paging with a tie, a forged cursor degrading to page 1, support on page 1 only"
    requirement: CHAT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/direct-chat.test.ts#direct list tracer 1, 2, 3 and 4"
        status: pass
    human_judgment: false
  - id: D2
    description: "The bubble counts the support dot plus unread directs when chat.direct is held, keeps the dot without it, leaves staff untouched, and falls to a dot when social is off"
    requirement: CHAT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/direct-chat.test.ts#direct list tracer 1 and 3; direct support unchanged 15; chat.test.ts 15/15; direct-chat-block.test.ts#hidden parity 10"
        status: pass
    human_judgment: false
  - id: D3
    description: "The detail composer enum (open, closed, blocker, removed over blocker) with canBlock, the key sets equal on both sides of a block and equal to an open pair, the whole history readable by both sides, unblock restoring open"
    requirement: CHAT-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/direct-chat-block.test.ts#composer states 1, 2, 3, 5"
        status: pass
    human_judgment: false
  - id: D4
    description: "Neutral refusal: the blocked member's and the blocker's refused sends are the same 409 direct_closed, stored nowhere, with no name, id or block word; the unblock reopens and the next send works"
    requirement: CHAT-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/direct-chat-block.test.ts#neutral refusal 6; block does not leak 7"
        status: pass
    human_judgment: false
  - id: D5
    description: "Hidden-conversation parity: the administrator block drops the badge, the row and the history together and unblock restores all three; social off hides every direct read for both participants and restores unchanged; a member block never hides the conversation"
    requirement: CHAT-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/direct-chat-block.test.ts#composer states 4; hidden parity 8, 9, 10"
        status: pass
    human_judgment: false
  - id: D6
    description: "Cross-tenant: a user in both tenants lists only the request tenant's conversations, tenant B's session on tenant A's conversation detail is the bare 404 of an unknown id, beside positive controls and the wrong-host 403; both routes have inventory entries"
    requirement: CHAT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#phase 11 sweep: direct list"
        status: pass
      - kind: unit
        ref: "apps/api/tests/unit/isolation-inventory.test.ts"
        status: pass
    human_judgment: false
  - id: D7
    description: "D-725: the shipped feed, member-block, support chat and case suites pass unchanged"
    requirement: CHAT-07
    verification:
      - kind: integration
        ref: "feed-social 53/53, reports-blocks 22/22, chat 15/15, chat-cases 29/29"
        status: pass
    human_judgment: false
---

# Phase 11 Plan 10: The Conversas list, the bubble and the conversation detail Summary

**The reading half of the direct API: a keyset Conversas list with the pinned support summary, a conversation-counting bubble, and a conversation detail whose composer is one finished enum, all behind the same readable policy so the list, the counter and the reads cannot disagree.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-11-19T17:00:00Z
- **Completed:** 2026-11-19T20:16:00Z
- **Tasks:** 3
- **Files modified:** 12 (1 created, 11 modified)

## Accomplishments

- `GET /v1/chat/direct` returns `{ support?, rows, nextCursor }`: rows are the paired conversations the lane reads, ordered by `(last_message_at desc, id desc)`, 20 a page, over-fetch of one, the shipped `decodeInstantCursor` guard (a forged cursor is page 1). Each row has the other member, a `text` or `voice` preview (with the stored length and `deleted: true` once the asset is retired), the instant and an unread count capped at 100. `support` (preview or null, and the shipped dot) only on page 1.
- `chatCounters` adds the unread directs to the support dot and answers `conversationsBadge: 'count'` when `chat.direct` is held; without it the dot is byte-identical, staff untouched. The dot is one exported statement (`memberSupportUnread`) used by the counter and by the list.
- `GET /v1/chat/direct/{conversationId}` returns `{ conversationId, other, composer, canBlock, lastSeq, lastReadSeq }` with `composer` by the precedence removed, blocker, closed, open; the two sides of a block have equal key sets and differ in the composer word and `canBlock` alone.
- Two inventory entries and one `phase 11 sweep: direct list` isolation case; README documents the routes and the counters rule.

## Task Commits

1. **Task 1 (tracer): list, counter and detail** - `10ee2251` (feat)
2. **Task 2: composer states, neutral refusal, no-leak scan** - `09ae5a37` (test)
3. **Task 3: hidden-conversation parity and README** - `d994c24e` (test)

**Plan metadata:** the commit of this file (docs: complete plan).

## Files Created/Modified

- `packages/modules/chat/server/direct.ts` - `listDirect`, `getDirectDetail`, the shared other-member and last-message projections
- `packages/modules/chat/server/service.ts` - `chatCounters` direct branch, exported `memberSupportUnread`, `decodeInstantCursor`, `CURSOR_NO_INSTANT`, `ISO_MICROSECONDS`
- `packages/modules/chat/server/routes.ts`, `index.ts` - the two routes and exports
- `packages/modules/chat/contracts/index.ts` - the new strict schemas
- `apps/api/tests/integration/direct-chat-block.test.ts` - new, 11 cases
- `apps/api/tests/integration/direct-chat.test.ts`, `direct-fixtures.ts`, `isolation.test.ts`, `isolation-inventory.ts`, `packages/modules/chat/tests/direct-contracts.test.ts`, `packages/modules/chat/README.md`

## Decisions Made

See `key-decisions`. Notably the list and detail read only through the caller's own participant row, so they do not depend on the 11-09 participants narrowing, and a member block is never a hiding rule (D-723): only the administrator's block, a removal and `social` off hide a conversation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The 11-08 test "direct support unchanged 15" asserted the counters did not move when a direct arrives**
- **Found during:** Task 1
- **Issue:** That assertion encoded the pre-plan-10 behaviour. With the bubble now counting directs for a `chat.direct` holder, `unreadConversations` rises by one and the badge is `count`.
- **Fix:** The assertion now expects `unreadConversations + 1` and `conversationsBadge: 'count'` with every other counter equal; the support thread assertions are unchanged.
- **Files modified:** `apps/api/tests/integration/direct-chat.test.ts`
- **Committed in:** `10ee2251`

**2. [Rule 3 - Blocking] Three helpers of `service.ts` exported for the direct file**
- **Found during:** Task 1
- **Issue:** `direct.ts` imports from `service.ts` (never the reverse), and needs the instant-cursor guard, its no-instant literal and the microsecond formatter.
- **Fix:** exported `decodeInstantCursor`, `CURSOR_NO_INSTANT`, `ISO_MICROSECONDS`; not re-exported by `server/index.ts`.
- **Committed in:** `10ee2251`

**3. [Plan sequencing] The detail route shipped with the Task 1 commit**
- The Task 1 `<files>` and the inventory unit test need both routes' entries once the route table has them, and both live in the same files, so the detail code landed in `10ee2251`. Task 2 added the composer proofs (`09ae5a37`); they passed on first run rather than failing first. The assertions are structural (key sets, status codes, word scans), not tautologies.

**4. Fixtures** `direct-fixtures.ts` gained `directList`, `directDetail`, `markRead`, `readMessages`, `countersOf` (test helpers only).

---

**Total deviations:** 4 (1 bug in a prior test, 1 blocking export, 1 sequencing note, 1 test helper addition)
**Impact on plan:** no scope creep; no migration, no policy or SQL definer changed.

## Issues Encountered

- A first fixture attempt nulled `member_profiles.display_name` (NOT NULL) and left a throwaway user and an asset in the local database; I removed that residue by hand (local only, my own fixture rows). The test now relies on the API forcing a null name for a removed member.
- Edge, left as is: the counter predicate `last_seq > last_read_seq` would count a conversation whose only unread messages were soft-deleted by moderation, while the row's `unreadCount` reads 0 for it. Direct messages have no deletion route in V1, so nothing produces it today.

## Verification run

| Gate | Result |
|------|--------|
| `module-chat` vitest, whole package (16 files) | 302/302 |
| `direct-contracts.test.ts` | 14/14 |
| `apps/api` unit suite plus `admin-lane-inventory` (isolation inventory, registry, module readmes included) | 138/138 |
| `direct-chat.test.ts` | 19/19 |
| `direct-chat-block.test.ts` | 11/11 |
| `isolation.test.ts -t "phase 11 sweep"` | 3/3 (the other 93 skipped by the filter; the file's known-red cases not run) |
| `feed-social`, `reports-blocks`, `chat`, `chat-cases` | 53/53, 22/22, 15/15, 29/29 |
| `turbo typecheck` module-chat, api, web | pass |
| `turbo test` web and module-chat | web 416 files, 10068 tests pass |
| `pnpm boundaries`, `check-ui-literals.sh`, `pnpm guard:lanes`, `biome check` | pass |

No pgTAP was run: this plan adds no migration, policy or function. Not run: the full `isolation.test.ts` (its five known-red stale-seed cases are outside this plan) and `stories.test.ts`/`feed-query-budget.test.ts`.

## Threat Flags

None. The two routes sit behind `requireModule('social')` and `requirePermission('chat.direct')`, read only through the tenant lane, and have inventory entries.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plans 12 (voice), 18, 19 and 22 can build on `GET /v1/chat/direct` and `GET /v1/chat/direct/{conversationId}`. `blockedByViewer` is deliberately absent (plan 11's social read). `createReport` still fails closed for the four new subjects until plan 14.

---
*Phase: 11-rede-social-direct-messages-member-blocking-and-reports*
*Completed: 2026-11-19*

## Self-Check: PASSED

- Files: `direct-chat-block.test.ts`, `direct.ts`, `routes.ts`, `contracts/index.ts`, `README.md` present on disk.
- Commits `10ee2251`, `09ae5a37`, `d994c24e` found in `git log`; `git rev-list --count` from `plan_head_before` is 3.
- Acceptance greps: `GET /v1/chat/direct'` and `GET /v1/chat/direct/:conversationId` are in `apps/api/tests/isolation-inventory.ts`; the shipped `chat.test.ts` passes unchanged.
