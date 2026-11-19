---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 13
subsystem: api
tags: [direct-messages, push, notification-source, worker-lane, literal-title, voice-preview, D-228, D-235, D-236, D-728, D-860, CHAT-06]
requires:
  - phase: 11-04
    provides: "the push hint's optional literal title `titleText` (max 60 code points), cut by the payload builder"
  - phase: 11-06
    provides: "app.direct_message_notice, the worker-only definer that reads a direct message for the notification lane"
  - phase: 11-08
    provides: "CHAT_NOTIFICATION_KINDS.directMessage and the direct send path that emits chat.message_sent"
provides:
  - "the direct branch of resolveMessageSent: ONE push-only chat.direct_message intent to the other participant, titled with the writer's name, body cut on a word at 100 graphemes or Mensagem de voz · m:ss, url /conversas/{id}"
  - "directMessagePushCopy and directPushTitleText in notification-copy.ts"
  - "the proof through the real fan-out: one push per message, one tag per conversation, no bell row, nothing for a closed pair"
affects: [11-27, 11-14, 11-17]
actuals:
  tokens: 16000
  tasks: 2
  commits: 4
plan_head_before: d44606caae759c6749964d5e5426703a1c19ef8b
tech-stack:
  added: []
  patterns:
    - "a notification source whose first read returns no row for a kind the worker lane cannot read falls through to a worker-only definer, never to a widened policy"
    - "a literal push title is spread onto the hint only when the producer's string is not blank, so the banner falls back to the tenant name"
key-files:
  created:
    - packages/modules/chat/tests/direct-notification-copy.test.ts
  modified:
    - packages/modules/chat/server/notifications.ts
    - packages/modules/chat/server/notification-copy.ts
    - packages/modules/chat/tests/notification-sources.test.ts
    - packages/modules/chat/README.md
    - apps/api/tests/integration/direct-notifications.test.ts
    - apps/api/tests/integration/chat-cases-notices.test.ts
key-decisions:
  - "The direct branch runs only when the shipped first read returns NO row; a row of any non-support kind still yields [] and never reaches the definer, so the support branch is byte-identical"
  - "Two cheap consistency guards beyond the plan: a notice whose writer is not the event's authorUserId, or whose recipient is the writer, yields []"
  - "The banner is suppressed for a participant looking at the app by the shipped global service-worker rule (a window focused and visible), not by a per-conversation presence (Assumption A5); plan 27's ledger row asks Igor to confirm it on two phones"
requirements-completed: [CHAT-06]
coverage:
  - id: D1
    description: "A direct message pushes the other participant exactly once, titled with the writer's name, body the message start, url /conversas/{id}, the conversation tag as tag and topic, renotify true; no bell row; the writer gets nothing"
    requirement: CHAT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/direct-notifications.test.ts#1. the path"
        status: pass
      - kind: unit
        ref: "packages/modules/chat/tests/notification-sources.test.ts#chat direct message push"
        status: pass
    human_judgment: false
  - id: D2
    description: "One banner per conversation: the same tag for two messages of a conversation, another tag for another conversation"
    requirement: CHAT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/direct-notifications.test.ts#2. one banner per conversation"
        status: pass
    human_judgment: false
  - id: D3
    description: "A recording pushes Mensagem de voz · 0:42 from the stored length and a retired asset pushes nothing"
    requirement: CHAT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/direct-notifications.test.ts#3. voice"
        status: pass
    human_judgment: false
  - id: D4
    description: "No push to a closed pair (a block in either direction, social off, an administrator-blocked, removed or anonymised recipient, a deleted message) and no cross-tenant read"
    requirement: CHAT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/direct-notifications.test.ts#4a to 4e"
        status: pass
    human_judgment: false
  - id: D5
    description: "The cut by graphemes (emoji, ZWJ sequences, flags, combining marks) and the blank-name fallback to the tenant title"
    requirement: CHAT-06
    verification:
      - kind: unit
        ref: "packages/modules/chat/tests/direct-notification-copy.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "The banner is suppressed while the participant is looking at the app, by the global service-worker rule"
    requirement: CHAT-06
    verification: []
    human_judgment: true
    rationale: "A device behaviour of the shipped service worker; only two real phones can show it (plan 27 ledger row)"
duration: 12min
completed: 2026-11-19
status: complete
---

# Phase 11 Plan 13: Direct message push Summary

**A direct message now pushes its other participant once per conversation through the worker-only notice definer, titled with the writer's display name, never ringing the bell and never reaching a closed pair.**

## Performance

- **Duration:** about 12 min
- **Tasks:** 2 of 2 (Task 1 tracer, Task 2 regression)
- **Files:** 1 created, 6 modified

## Accomplishments

- `resolveMessageSent` gained a direct branch. The worker lane is `support_tenant` with the zero user, so the shipped first read finds no row for a direct; the resolver then runs `select * from app.direct_message_notice(messageId)` and builds the intent only from its row. No policy was widened.
- The intent is push only (`channels: ['push']`), kind `chat.direct_message`, audience the one other participant, `excludeUserIds` the writer, `dedupeKey` `chat.direct_message:{messageId}`, subject the conversation, push hint = the shipped chat hint (32-hex `tag` and `topic`, `renotify`, `urgency: 'high'`, 72 h TTL) plus `titleText` = the trimmed writer name (omitted when blank) and the url `/conversas/{id}`.
- The body is `directMessagePushCopy` (`cutOnWord` at 100 graphemes, `…` only when cut) or `voicePreview` of the STORED length; a recording whose asset is gone, `deliverable` false, zero rows (deleted message, support case, another tenant's id, unknown id) and a mismatched author all yield `[]`.
- Proof through the real fan-out (`notificationsFanoutJob.handler`) on the live local stack: one push-send job per message, one tag per conversation, the device payload titled with the writer's name, no `notifications` row for either side, the writer's own device never pushed, the badge equal to the bell count plus the conversations count, 72 h TTL and high urgency in the transport options, and the support reply and team pushes still titled `team` and `tenant` with no `titleText`.

## Task Commits

1. **Task 1 (tracer): the direct branch** - `090a2cdc` (feat)
2. **Task 2: badge, TTL, urgency and unchanged notices** - `6b86e71e` (test)
3. **Fix of a red outside my files** - `9720d450` (fix)
4. **README** - `5830cbdb` (docs)

Tracer gate: the `<verify>` of Task 1 (module-chat copy and sources tests, then `direct-notifications.test.ts`) was green before Task 2 started and again at the end.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The shipped counters encoding test was red since plan 11-10**
- **Found during:** Task 2 (running `chat-cases-notices.test.ts`, whose acceptance criterion is "passes unchanged")
- **Issue:** `EP-055 encoding` slices `service.ts` from `export async function chatCounters` and expects two `c.state <> 'closed'`; plan 11-10 moved the member's dot statement into `memberSupportUnread`, which sits just above `chatCounters`, so only one remained in the slice. Not caused by this plan.
- **Fix:** the slice now starts at `export async function memberSupportUnread` (both statements, same assertions).
- **Files modified:** `apps/api/tests/integration/chat-cases-notices.test.ts`
- **Commit:** `9720d450`

**2. [Rule 2 - Missing critical] Two consistency guards**: a notice whose `writer_user_id` differs from the event's `authorUserId`, or whose recipient is the writer, yields `[]` (a forged or inconsistent event names no one). Unit cases in `notification-sources.test.ts`. Commit `090a2cdc`.

**3. Additions not in the plan's file list:** `packages/modules/chat/README.md` (a short section; no kernel import, event or job changed, so the `module-readmes` rule needed nothing) and a `directPushTitleText` helper beside `directMessagePushCopy`.

**Total deviations:** 3 (1 blocking fix of a red outside my files, 1 added guard, 1 doc/helper addition). **Impact:** none on scope.

## Gates run

- `module-chat` whole suite: 17 files, 321 tests pass. `module-notifications` whole suite: 15 files, 204 pass (not edited, run as a watcher of the shared lists).
- `direct-notifications.test.ts` 23/23 (the 10 follow tests of plan 11 plus 13 new), `chat-cases-notices.test.ts` 16/16 (after the fix), `chat-voice-previews.test.ts` 11/11, `notifications-prune.test.ts` 5/5, one file at a time.
- `apps/api` unit dir (11 files, 138 tests, includes `module-readmes` and `isolation-inventory`) and `tests/admin-lane-inventory` pass.
- `pnpm boundaries`, `bash scripts/check-ui-literals.sh`, `pnpm guard:lanes`: OK. Biome clean on the touched paths.
- Typecheck (module-chat, api, web) clean. There is no separate worker package in this workspace; the worker code is not edited.
- Web suite via turbo: the first run exited red (the tail was cut and the failing test was not captured), the immediate rerun was green: 416 files, 10068 tests. Treat as a load flake unconfirmed.
- No pgTAP run: this plan adds no migration. No pre-existing red suite was touched.

## Deployment note

The push hint carries `titleText` (plan 04's strict contract), so the API and the worker must deploy together.

## Known Stubs

None.

## Threat Flags

None. The plan's register is met: T-11-08 (`deliverable` recomputed at fan-out; body bounded to 100 graphemes; title is the display name), T-11-02 (audience is the one other participant; the definer answers only the zero user; no policy widened), T-11-01 (the definer pins the claim's tenant; case 4e proves a lab-lane resolution of a demo message answers `[]`, with the demo lane as the positive control), T-11-13 (one tag per conversation; case 2).

## Self-Check: PASSED

- Created file exists: `packages/modules/chat/tests/direct-notification-copy.test.ts`.
- Commits `090a2cdc`, `6b86e71e`, `9720d450`, `5830cbdb` exist on master; each `git show --stat` listed only its own paths.
- Acceptance: `grep -q direct_message_notice packages/modules/chat/server/notifications.ts` passes; the integration describe asserts no bell row for the kind and exactly one push-send job per message; `chat-cases-notices` and `chat-voice-previews` pass (the former after the one-line slice fix above); module and API typecheck clean.
