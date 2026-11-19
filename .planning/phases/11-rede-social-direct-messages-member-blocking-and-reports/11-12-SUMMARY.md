---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 12
subsystem: api
tags: [direct-messages, voice, idempotent-send, media-gate, concurrency, isolation, D-722, D-734, D-846, D-858, D-867, CHAT-06, CHAT-07]
requires:
  - phase: 11-08
    provides: "the direct text send path, the target resolver, the limiters and app.direct_conversation_open"
  - phase: 11-10
    provides: "the direct list, detail and composer routes and the direct-fixtures helpers"
  - phase: 11-06
    provides: "the DM001 send guard and the conversation row lock the two-connection proof pins"
  - phase: 11-09
    provides: "app.chat_asset_hidden opening a direct recording to the two participants only"
provides:
  - "POST /v1/chat/direct/voice-messages { toMembershipId, mediaId }: a recording to another member over the shipped voice machinery, idempotent per take, server-measured duration"
  - "sendDirectVoiceMessage and the strict directVoiceSendInputSchema; assetIndexViolated and insertedMessage exported from the chat service"
  - "the proof that only the two participants play a direct recording (a third member, admin_tenant, support_tenant and another tenant get the bare 404)"
  - "the two-connection proof that a send and a block serialise on the conversation row lock, with no deadlock"
  - "the isolation case and inventory entry for the voice route, and the staff-cannot-reach-a-direct-conversation negative"
affects: [11-22, 11-27, 11-14]
actuals:
  tokens: 17000
  tasks: 3
  commits: 3
plan_head_before: d8a626c980d06053477bd828f51645d844d02615
tech-stack:
  added: []
  patterns:
    - "the direct voice send repeats the support voice order: stored-message read, asset check, then the pair, so a refusal for the asset never reveals a block"
    - "a lock-order proof uses a holder connection with an uncommitted write and pg_blocking_pids (walked recursively) as the barrier, never a sleep"
key-files:
  created:
    - apps/api/tests/integration/direct-chat-voice.test.ts
  modified:
    - packages/modules/chat/contracts/index.ts
    - packages/modules/chat/server/direct.ts
    - packages/modules/chat/server/service.ts
    - packages/modules/chat/server/routes.ts
    - packages/modules/chat/README.md
    - packages/modules/chat/tests/direct-contracts.test.ts
    - apps/api/tests/integration/direct-chat-block.test.ts
    - apps/api/tests/integration/isolation.test.ts
    - apps/api/tests/isolation-inventory.ts
key-decisions:
  - "No production change was needed for the send-versus-block proof: the lock order shipped in 11-06 and 11-07 (conversation row first, then member_blocks) already serialises them, so no migration was written"
  - "The two-waiter barrier follows pg_blocking_pids recursively: a row lock queues the second waiter behind the first waiter's tuple lock, so a flat count of backends behind the holder saw only one"
  - "The direct voice sweep case is an it() with ctx.skip when ffmpeg is missing, not it.skipIf: the inventory unit test reads titles from it( calls only"
requirements-completed: [CHAT-06, CHAT-07]
coverage:
  - id: D1
    description: "A member sends one recording to another member: 201, empty body, the server-measured duration, both participants play it"
    requirement: CHAT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/direct-chat-voice.test.ts#1. A sends a recording to B"
        status: pass
    human_judgment: false
  - id: D2
    description: "Only the two participants play a direct recording: a third member, admin_tenant, support_tenant and another tenant's user get the bare 404 of an unknown id, before any report"
    requirement: CHAT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/direct-chat-voice.test.ts#2. the gate"
        status: pass
    human_judgment: false
  - id: D3
    description: "Idempotent per take: the same mediaId is the stored message with created false and no second chat.message_sent; two concurrent sends store one message"
    requirement: CHAT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/direct-chat-voice.test.ts#3. idempotent per take"
        status: pass
    human_judgment: false
  - id: D4
    description: "Refusals keep the words of text and of 12.5: voice_not_ready, voice_invalid, a plain VALIDATION_FAILED for an extra key, direct_closed with the body of text, asset words asked before the pair, 403 for staff, MODULE_DISABLED with social off"
    requirement: CHAT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/direct-chat-voice.test.ts#4. refusals"
        status: pass
    human_judgment: false
  - id: D5
    description: "A send and a block serialise: the block waits for an in-flight send, then every later send of either side is direct_closed; queued together they never deadlock nor both win"
    requirement: CHAT-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/direct-chat-block.test.ts#send versus block 12 to 14"
        status: pass
    human_judgment: false
  - id: D6
    description: "Cross-tenant: tenant B's session on tenant A's membership id or recording is the answer of an unknown id, beside the positive controls and the wrong-host 403, and the route is in the isolation inventory"
    requirement: CHAT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#phase 11 sweep: direct voice"
        status: pass
      - kind: unit
        ref: "apps/api/tests/unit/isolation-inventory.test.ts"
        status: pass
    human_judgment: false
  - id: D7
    description: "Staff cannot reach a direct conversation: the voice and text staff replies and both reads of its id are the bare 404 of an unknown id and nothing is stored"
    requirement: CHAT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/direct-chat-voice.test.ts#5. D-846, D-859"
        status: pass
    human_judgment: false
duration: 17min
completed: 2026-11-19
status: complete
---

# Phase 11 Plan 12: Voice in direct chats and the send-versus-block proof Summary

**A member can now send a recording to another member through `POST /v1/chat/direct/voice-messages` over the shipped 12.5 voice machinery, stored once per take and playable only by the two participants, and a two-connection test pins that a message in flight and a block serialise on the conversation row lock.**

## Performance

- **Duration:** about 17 min
- **Tasks:** 3 of 3 (Task 1 tracer, Tasks 2 and 3 auto)
- **Files:** 1 created, 9 modified

## Accomplishments

- `sendDirectVoiceMessage` mirrors the support voice send: the caller's own stored message for the asset is read first, then `assertVoiceUsable`, then the target resolver, the new-conversation limiter, `app.direct_conversation_open` and `insertMessage` with `{ kind: 'voice', mediaAssetId }`. The duration is copied from the asset in the insert, so no client duration exists. A `23505` on `chat_messages_tenant_media_asset_uq` re-reads in a new transaction; `chat.message_sent` is emitted after commit only by the call that stored the message.
- The asset is asked before the pair, so a closed pair with a bad or not-ready asset answers the 12.5 words and never `direct_closed`; a usable take to a closed pair answers the same `409 CONFLICT { chat: 'direct_closed' }` body as text (asserted byte-equal) and the take stays unused.
- The gate is asserted through `GET /v1/media/{id}/original`: the sender and the recipient get the signed 302, and a third member, `admin_tenant`, `support_tenant` and a user of another tenant get the bare 404 identical to an unknown id.
- The staff reply routes stay support-only: the staff voice reply, text reply, message read and detail read of a direct conversation id are the bare 404 of an unknown id and store nothing.
- `send versus block` (cases 12 to 14 of `direct-chat-block.test.ts`): a holder connection keeps an uncommitted message insert, the block through the API waits (Postgres reports it through `pg_blocking_pids`), answers only after the commit, the message is stored, the block exists, both follow rows are gone and the next send of either side is `direct_closed`. The reverse order and a send plus a block queued behind one lock are covered; the second never deadlocks nor lets both win.
- The five direct routes all have inventory entries and cross-tenant cases (send, with, list and detail from 11-08 and 11-10; the voice route added here), each beside a positive control and the wrong-host 403.

## Task Commits

1. **Task 1: the direct voice send, its gate and idempotency** - `0aa57806` (feat)
2. **Task 2: send versus block with two connections** - `0ddf4b24` (test)
3. **Task 3: staff negatives, typed race helpers, README** - `06d8f7da` (test)

## Deviations from Plan

**1. [Rule 1 - Bug] Limiter key typed as string**
- **Found during:** Task 1 typecheck
- **Issue:** `sendDirectVoiceOnce` took the limiter key as `string`; `safetyLimiterKey` returns `string[]`
- **Fix:** typed the parameter `string[]` (the test run had passed because vitest does not typecheck)
- **Files modified:** packages/modules/chat/server/direct.ts
- **Commit:** `0aa57806`

**2. [Rule 3 - Blocking] Inventory test reads only `it(` titles**
- **Found during:** Task 1
- **Issue:** the voice sweep case written as `it.skipIf(...)(` was not seen by `isolation-inventory.test.ts`
- **Fix:** written as `it(` with `skip(!hasFfmpeg, ...)` from the test context
- **Files modified:** apps/api/tests/integration/isolation.test.ts
- **Commit:** `0aa57806`

**3. [Rule 1 - Bug] Race test barrier counted one waiter, not two**
- **Found during:** Task 2 (case 14 failed three times at first)
- **Issue:** a row lock queues the second waiter behind the first waiter, so counting backends directly behind the holder never reached two
- **Fix:** the barrier walks `pg_blocking_pids` recursively
- **Files modified:** apps/api/tests/integration/direct-chat-block.test.ts
- **Commit:** `0ddf4b24`

**4. [Rule 1 - Bug] Test helper types**
- **Found during:** Task 3 typecheck of the api package
- **Issue:** the `request` and `post` helpers return `Promise<Response> | Response`, so `.then` and a typed `Promise<Response>` array failed
- **Fix:** wrapped in `Promise.resolve` and widened the array type
- **Files modified:** the two test files
- **Commit:** `06d8f7da`

**Total deviations:** 4 auto-fixed (3 bugs in code or tests I wrote, 1 blocking). **Impact:** none on scope; no production behaviour changed beyond the plan.

## Checks run

- `direct-contracts.test.ts` (module-chat): 15 of 15; whole module-chat suite 322 of 322.
- API unit suite 138 of 138, including `isolation-inventory`, `module-readmes`, `registry` and `admin-lane-inventory`.
- Integration, one by one: `direct-chat-voice` 5 of 5, `direct-chat-block` 14 of 14, `chat` 15, `chat-voice` 23, `chat-voice-gate` 9, `chat-voice-previews` 11, `chat-voice-reply` 18, `chat-cases-notices` 16, `direct-chat` 19, `direct-notifications` 23, `reports-new-subjects` 12, all green.
- The race cases: `direct-chat-block` run three times in a row, then `direct-chat-voice` plus `direct-chat-block` twice more after the type fixes; all green. No wall-clock timing: the barrier is `pg_blocking_pids`.
- `isolation.test.ts` in full: 93 passed, 4 failed, all four the known pre-existing red (b3 and b8 stories, the two events tests); every phase 11 sweep case passes, including the new voice one.
- `pnpm turbo typecheck` for module-chat, api and web, `pnpm turbo test --filter=@rede-social/web` (416 files, 10068 tests), `pnpm boundaries`, `bash scripts/check-ui-literals.sh`, `pnpm guard:lanes` and `biome check` on the touched trees: clean. pgTAP was not run (no database change in this plan; `supabase test db` untouched).
- Disk stayed at 12 GiB free throughout.

## Known Stubs

None.

## Threat Flags

None. The new route sits inside the plan's threat model (T-11-01, T-11-02, T-11-04, T-11-27).

## Issues Encountered

- A first lock-order guess for the race barrier was wrong (deviation 3); no production code needed to change.
- The voice suites need `ffmpeg` on PATH (present locally); they skip with a message otherwise.

## Next Phase Readiness

Plan 22 (the web composer) can pass the voice bundle to the shared composer and post to `POST /v1/chat/direct/voice-messages`. The route's answer is the same `{ conversationId, created, message }` as the text send. The direct push of plan 13 already formats a recording as "Mensagem de voz".

## Self-Check: PASSED

- Created file exists: `apps/api/tests/integration/direct-chat-voice.test.ts`.
- Commits `0aa57806`, `0ddf4b24` and `06d8f7da` exist on master and touch only this plan's paths.
- ROADMAP.md, STATE.md and REQUIREMENTS.md were not touched.
