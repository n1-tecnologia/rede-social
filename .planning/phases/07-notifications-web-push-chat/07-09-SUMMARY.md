---
phase: 07-notifications-web-push-chat
plan: 09
subsystem: chat
tags: [chat, support, member-thread, realtime, catch-up, linkify, badges, next16, playwright]
status: complete

requires:
  - phase: 07-notifications-web-push-chat
    provides: "07-08 chat module (routes, gapless seq, ids-only chat.message/chat.unread/chat.read signals, conversationsBadge, seeded support users and demo thread); 07-03 RealtimeProvider, useRealtimeTopic, LiveCountersProvider, SlotBadgeLabelsProvider, LiveShell; 07-02 sketch 007 (approved 2026-09-30, provisional)"
  - phase: 04-feed
    provides: "the http/https linkifier and URL matcher (T-04-43), re-homed here"
provides:
  - "@rede-social/ui linkify(text, { linkClassName }) and the React-free matcher entry @rede-social/ui/text/url (LINK_URL_PATTERN, trimMatchedUrl); the feed re-exports both"
  - "@rede-social/module-chat/ui: MessageBubble, DaySeparator, MessageList, ChatComposer, ThreadHeader (member variant)"
  - "apps/web/lib/chat-view.ts: tenantDayKeys, chatDayLabel, chatMessageView, chatRuns"
  - "apps/web/lib/chat.ts: fetchSupportThread/getSupportThread, fetchMessages/getMessages, markConversationRead, sendSupportMessage"
  - "/suporte (member thread) with ThreadPane; staff get not-found until 07-10"
  - "BFF GET /api/chat/conversations/{id}/messages (server-formatted views + day keys) and POST /api/chat/conversations/{id}/read"
  - "sendSupportMessageAction (server action)"
  - "Badge variant 'dot'; TenantLogo size 'thread' and hideOnError; LiveCountersProvider `events` prop and conversationsBadge; SlotBadgeLabel style argument and slotBadgeStyle"
  - "chat.json catalog (root chat, member-side keys)"
affects: [07-10 staff inbox and staff thread (reuses ThreadHeader slot, ThreadPane pattern, BFF routes, chat-view staff viewer, support-inbox join), 07-11 real-device test plan and deploy notes, 08 moderation (blocked member notice)]

actuals:
  tokens: 40400
  tasks: 3
  commits: 5
plan_head_before: 15f613ec97fb7b5ecd2d59546d68bd9c4d29b367

tech-stack:
  added: []
  patterns:
    - "Realtime-triggered refetches go through GET route handlers that answer server-formatted views; user sends go through a server action"
    - "A React-free subpath entry (@rede-social/ui/text/url) lets a module's contracts and the client linkifier share one matcher without pulling React into the API"
    - "Catch-up is coalesced (one run in flight, one re-run scheduled) and merges by id in seq order; replayed signals at or below lastSeq are ignored"
    - "Scroll intents (bottom, keep-if-near-bottom, anchor-after-prepend) are applied in a layout effect after each views change"

key-files:
  created:
    - packages/ui/src/text/url.ts
    - packages/ui/src/text/linkify.tsx
    - packages/ui/tests/linkify.test.tsx
    - packages/modules/feed/tests/linkify-reexport.test.ts
    - packages/modules/chat/ui/MessageBubble.tsx
    - packages/modules/chat/ui/DaySeparator.tsx
    - packages/modules/chat/ui/MessageList.tsx
    - packages/modules/chat/ui/ChatComposer.tsx
    - packages/modules/chat/ui/ThreadHeader.tsx
    - packages/modules/chat/ui/index.ts
    - packages/modules/chat/tests/message-list.test.tsx
    - packages/modules/chat/tests/chat-composer.test.tsx
    - packages/core/ui/HidingLogoImage.tsx
    - apps/web/lib/chat.ts
    - apps/web/lib/chat-view.ts
    - apps/web/lib/chat-view.test.ts
    - apps/web/app/(app)/suporte/page.tsx
    - apps/web/app/(app)/suporte/loading.tsx
    - apps/web/app/(app)/suporte/ThreadPane.tsx
    - apps/web/app/(app)/suporte/actions.ts
    - apps/web/app/api/chat/conversations/[conversationId]/messages/route.ts
    - apps/web/app/api/chat/conversations/[conversationId]/read/route.ts
    - apps/web/messages/pt-BR/chat.json
    - apps/web/e2e/chat.spec.ts
    - apps/web/e2e/chat-admin.ts
  modified:
    - packages/ui/src/index.ts
    - packages/ui/package.json
    - packages/ui/src/primitives/Badge.tsx
    - packages/ui/tests/button.test.tsx
    - packages/modules/feed/ui/linkify.tsx
    - packages/modules/feed/contracts/index.ts
    - packages/modules/chat/package.json
    - packages/modules/chat/tsconfig.json
    - packages/modules/chat/vitest.config.ts
    - packages/core/ui/TenantLogo.tsx
    - packages/core/ui/TopBar.tsx
    - packages/core/ui/DesktopRail.tsx
    - packages/core/ui/index.ts
    - packages/core/ui/realtime/LiveCountersProvider.tsx
    - packages/core/ui/realtime/SlotBadgeLabels.tsx
    - packages/core/tests/live-counters.test.tsx
    - packages/core/tests/tenant-logo.test.tsx
    - apps/web/package.json
    - apps/web/components/shell/LiveShell.tsx
    - apps/web/app/(app)/layout.tsx
    - apps/web/i18n/messages.test.ts
    - apps/web/e2e/notifications.spec.ts
    - scripts/check-static-routes.sh
    - pnpm-lock.yaml

key-decisions:
  - "The URL matcher moved with the linkifier into @rede-social/ui, exposed through a React-free ./text/url entry; the feed contracts re-export the same objects (FEED_URL_PATTERN === LINK_URL_PATTERN), so the unfurl path and every linkified surface keep one rule"
  - "Chat views carry dayKey plus server-formatted time; chatDayLabel formats a fixed calendar date from the key, so day labels are recomputed on the client from server-provided todayKey/yesterdayKey without reading a clock"
  - "LiveShell learns chat.support from bootstrap.permissions through a new supportInbox prop (set in the (app) layout) and joins tenant:<t>:support-inbox only then"
  - "The composer counter is formatted by the host (pt-BR grouping, '1.800/2.000') and passed into the catalog's verbatim '{count}/2.000'"
  - "With experimental.useOffline on, a server action that fails at the transport level is retried by Next once back online instead of rejecting; the draft-restore path covers server errors, and an offline send stays 'Enviando…' until it goes through"

patterns-established:
  - "Thread pane: fixed-height column matching the shell paddings, header outside the scroller, composer below, pill anchored above the composer"
  - "BFF read marks: same-origin gate, 256-byte body cap, contract-validated body, one forward, keepalive fetch from the client"

requirements-completed: [CHAT-02, CHAT-04, CHAT-05]

coverage:
  - id: D1
    description: "One shared http/https linkifier in @rede-social/ui with side-aware ink; javascript: and HTML stay text; the feed re-exports the same function and matcher"
    verification:
      - kind: unit
        ref: "packages/ui/tests/linkify.test.tsx"
        status: pass
      - kind: unit
        ref: "packages/modules/feed/tests/linkify-reexport.test.ts"
        status: pass
      - kind: unit
        ref: "packages/modules/chat/tests/message-list.test.tsx"
        status: pass
    human_judgment: false
  - id: D2
    description: "Bubbles, day separators, runs and times in the tenant clock (Hoje/Ontem across a UTC midnight, São Paulo against Manaus, the 4:59/5:01 run rule, labels per viewer)"
    requirement: CHAT-04
    verification:
      - kind: unit
        ref: "apps/web/lib/chat-view.test.ts"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/chat.spec.ts#7. bubble times are the São Paulo wall clock, not the device clock"
        status: pass
    human_judgment: false
  - id: D3
    description: "Composer rules: 16px 2,000-cap field, disabled for whitespace, pointer-aware Enter, counter from 1,800 turning danger at 2,000, draft restored with the inline error cleared by the next keystroke"
    requirement: CHAT-02
    verification:
      - kind: unit
        ref: "packages/modules/chat/tests/chat-composer.test.tsx"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/chat.spec.ts#5. the composer"
        status: pass
    human_judgment: false
  - id: D4
    description: "A member taps the chat slot, sees the greeting, sends 'Oi', the greeting is replaced by their bubble, and a reload shows the same thread"
    requirement: CHAT-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/chat.spec.ts#1. the chat slot opens the greeting"
        status: pass
    human_judgment: false
  - id: D5
    description: "Staff replies arrive live without a reload, labelled with the agent's first name only (no avatar, no surname), and a dropped signal is caught up exactly once in order on refocus"
    requirement: CHAT-04
    verification:
      - kind: e2e
        ref: "apps/web/e2e/chat.spec.ts#2. a staff reply appears live"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/chat.spec.ts#4. catch-up after dropped signals"
        status: pass
    human_judgment: false
  - id: D6
    description: "The member's chat slot turns into the 12px dot within 15 s of a staff reply elsewhere in the app, named 'Suporte, nova resposta da equipe', and opening the thread clears it; staff get the count; the app badge counts the dot as one"
    requirement: CHAT-05
    verification:
      - kind: e2e
        ref: "apps/web/e2e/chat.spec.ts#3. a staff reply turns the chat slot into the dot elsewhere"
        status: pass
      - kind: unit
        ref: "packages/core/tests/live-counters.test.tsx (07-09 cases)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/notifications.spec.ts#D-239: the app badge mirrors the bell count"
        status: pass
    human_judgment: false
  - id: D7
    description: "Long content and history: a 2,000-character message with 40 line breaks arrives live in full with the scroller at the bottom, a 300-character URL never scrolls the pane sideways, 50 messages open at the bottom and 'Carregar mensagens anteriores' prepends 10 with the top kept in view"
    requirement: CHAT-04
    verification:
      - kind: e2e
        ref: "apps/web/e2e/chat.spec.ts#6. a 2,000-character message"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/chat.spec.ts#8. history"
        status: pass
    human_judgment: false
  - id: D8
    description: "The designed header, greeting and dot as they look on a real phone in the Home Screen app (keyboard lift, BottomNav never covering the field)"
    requirement: CHAT-02
    verification: []
    human_judgment: true
    rationale: "UI E10/partial is a real-device backstop (07-11 test plan); phones cannot reach *.localhost, so it is blocked until the phase UAT on a deployed host."

duration: 42min
completed: 2026-09-30
---

# Phase 7 Plan 09: Member Side of the Support Conversation Summary

**A member taps the chat icon and lands in their one thread with the organisation's team. Replies arrive live in `seq` order and survive dropped signals through an `afterSeq` catch-up. A 12px dot on the chat slot says the team answered. Bubbles use the one shared http/https linkifier, re-homed into `@rede-social/ui`, and all times follow the tenant's clock.**

## Performance

- **Duration:** 42 min
- **Started:** 2026-09-30T19:38:25Z
- **Completed:** 2026-09-30T20:20:59Z
- **Tasks:** 3 of 3
- **Files modified:** 53 (including the lockfile)

## Accomplishments

- **Linkifier re-homed.** `linkify(text, { linkClassName })` now lives in `@rede-social/ui`. The URL matcher sits in a React-free `@rede-social/ui/text/url` entry, so the feed contracts (imported by the API) and the client share the same regex object. The feed file re-exports it, so `PostCaption`, `CommentItem` and the reels overlay are unchanged.
- **Chat UI pieces.** `@rede-social/module-chat/ui` is props-only and ships no words:
  - `MessageBubble`: the label sits above the bubble on neutral ground, with the `ShieldCheck` mark and the sr-only suffix. Link ink depends on the side.
  - `DaySeparator` and `MessageList` (the `log` role, polite, additions only).
  - `ChatComposer`: grows to 120px, Enter behaves according to the pointer type, the counter appears from 1,800, and a failed send puts the draft back.
  - `ThreadHeader`: the member variant, with a documented slot for 07-10's staff variant.
- **Tenant-clock formatters.** `chat-view.ts` is clock-free and formats in the tenant zone. It provides `tenantDayKeys`, `chatDayLabel`, `chatMessageView` (member and staff viewers, first name only) and `chatRuns` (time on the last bubble of a run, day separators, pending bubbles last).
- **`/suporte` for members.** The page gates on `chat.support` / `chat.support.contact` and renders the header with `TenantLogo size="thread"`. `ThreadPane` then handles:
  - opening at the bottom before paint;
  - history, keeping the top message anchored;
  - catch-up on `chat.message`, on (re)subscribe and on refocus;
  - auto-scroll within 80px of the bottom, otherwise the "{n} novas mensagens" pill;
  - read marks with `keepalive`;
  - the optimistic send, which adopts the conversation id on the first message;
  - the load-error state.
  
  `loading.tsx` draws 4 bubble skeletons and an inert composer.
- **Server side of the web app.**
  - The send goes through a server action. It reads the bootstrap and the translator before the write, so a formatting failure can never restore a draft that was already sent.
  - The catch-up and history GET is a route handler that answers server-formatted views plus `todayKey`/`yesterdayKey`.
  - The read POST is a route handler with a 256-byte body limit.
- **Badges.**
  - `Badge variant="dot"`.
  - `TopBar` and `DesktopRail` draw the member's dot or the staff count from `conversationsBadge`, and the accessible name carries the state ("Suporte, nova resposta da equipe" / "Suporte, {count} aguardando resposta").
  - `LiveCountersProvider` gains an `events` prop. `LiveShell` refetches on `chat.unread`, and for holders of `chat.support` it also joins `support-inbox` for `chat.message` / `chat.read`.
- **Proof.**
  - Unit: ui 90, core 264, chat 31, feed 155, web 1142.
  - Build and gates: the web build, the static-route gate (`/suporte` is dynamic), `check-ui-literals` and `boundaries`.
  - The 16-case `chat membro` e2e on mobile and desktop, from a reset and seeded database.

## Task Commits

1. **Task 1: linkifier re-home, chat bubbles/list/composer, tenant-clock formatters**: `b4c911f` (feat)
2. **Task 2: member thread at /suporte, BFF routes, send action, dot badge and slot labels**: `8eaf68f` (feat)
3. **Task 3: the member thread in the browser**: `da7a8a1` (test)

`commits: 5` in the frontmatter is measured with `git rev-list --count 15f613e..HEAD`. It includes two commits the developer made in another session while this plan ran: `6129ac8` (the ROADMAP/STATE insertion of Phase 08.1) and `fc82802` (the 08.1 context).

## Files Created/Modified

See `key-files`. The main ones:
- `packages/ui/src/text/linkify.tsx`, `packages/ui/src/text/url.ts`: the one linkifier and its matcher.
- `packages/modules/chat/ui/*`: the bubble pair, the list, the composer and the header.
- `apps/web/lib/chat-view.ts`, `apps/web/lib/chat.ts`: the formatters and the one fetch layer.
- `apps/web/app/(app)/suporte/{page,loading,ThreadPane,actions}.tsx|ts`: the member thread.
- `apps/web/app/api/chat/conversations/[conversationId]/{messages,read}/route.ts`: the BFF.
- `packages/core/ui/{TopBar,DesktopRail,TenantLogo,HidingLogoImage}.tsx`, `packages/core/ui/realtime/*`: the dot, the thread logo and the chat events.

## Decisions Made

See `key-decisions`. Also:
- **D-33 gate:** Task 2's precondition `grep -q '^approved: true' .planning/sketches/007-phase-07-designed-screens/README.md` passed. Sketch 007 was approved by igor.vboas on **2026-09-30** (`approval_kind: provisional`, committed in 67ba861). The README was not edited.
- **Staff `/suporte` is the not-found screen until 07-10**, which replaces that branch with the inbox. This is recorded as ledger entry 63.
- The rail's dot drops the TopBar's 2px separating ring, as sketch 007 surface 9 draws it (`.rail .badge.dot { box-shadow: none }`).
- A logo that fails to load is hidden on the `error` event only. A decoded-size probe on mount would misread an SVG wordmark with no intrinsic size, and the seed logos are SVGs.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The URL matcher had to move with the linkifier**
- **Found during:** Task 1
- **Issue:** The feed's `linkify` imported `FEED_URL_PATTERN` / `trimMatchedUrl` from the feed contracts. `@rede-social/ui` cannot import a module, and a copy would break the one-matcher rule that ties the caption links to the unfurl (MEDIA-04, T-04-43).
- **Fix:** The matcher moved to `packages/ui/src/text/url.ts`, exported through a new React-free `@rede-social/ui/text/url` entry. The feed contracts re-export the same objects under their historical names. `linkify-reexport.test.ts` pins identity (`toBe`), not equality.
- **Files modified:** packages/ui/src/text/url.ts, packages/ui/package.json, packages/modules/feed/contracts/index.ts
- **Committed in:** b4c911f

**2. [Rule 3 - Blocking] `LiveShell` needed the viewer's permission**
- **Found during:** Task 2
- **Issue:** Joining `support-inbox` only for holders of `chat.support` needs `bootstrap.permissions`, which `LiveShell` did not receive.
- **Fix:** Added a `supportInbox` prop, set in `apps/web/app/(app)/layout.tsx` (a file not in the plan's list) from `bootstrap.permissions.includes('chat.support')`.
- **Committed in:** 8eaf68f

**3. [Rule 1 - Bug] The D-239 e2e expected the icon badge without the chat half**
- **Found during:** Task 3, plan-level verification (`notifications.spec.ts` "D-239: the app badge mirrors the bell count", 4 received against 3 expected on both projects)
- **Issue:** 07-08's seeded demo thread leaves `member@rede-demo.local` with an unread staff reply (`last_staff_seq 2 > last_read_seq 0`). `unreadConversations` is therefore 1, and the icon sums 3 + 1 (this plan's D-239 truth). The expectation predates the seeded thread.
- **Fix:** The test resets the seeded read position to 0 first, so the result does not depend on test order, and expects `3 + 1`, with a comment. `chat-admin.ts` provides the helper, and the spec closes its connection in `afterAll`.
- **Files modified:** apps/web/e2e/notifications.spec.ts
- **Committed in:** da7a8a1

**4. [Plan detail] Test file locations follow the packages' configs**
- `packages/ui` collects `tests/**` only, so the linkifier test is `packages/ui/tests/linkify.test.tsx` rather than `src/text/linkify.test.tsx`.
- The live-counters cases extend the existing `packages/core/tests/live-counters.test.tsx` rather than a new `ui/realtime/LiveCountersProvider.test.tsx`.

**5. [Plan detail] The greeting is inlined in `ThreadPane`; the loading composer is drawn, not rendered**
- `loading.tsx` is a server component and cannot hand `ChatComposer` its callbacks. It draws the composer's geometry with a disabled field and button, using catalog strings.

**6. [Plan detail] `chatDayLabel` takes the two words, not `t`**
- `chatDayLabel(dayKey, keys, { today, yesterday })` stays pure and client-safe. `ThreadPane` recomputes labels when a BFF answer brings new day keys (a thread left open across midnight).

**7. [Test precision] Two e2e locator traps, and the offline retry**
- Next's route announcer is also `role="alert"`, so the spec scopes the composer error to `[data-chat-send-error]`.
- The dev server's Fast Refresh once left a hidden stale copy of the page tree. The spec scopes its locators to the visible `[data-chat-thread]`. It did not reproduce in isolation, and no second GET was made.
- A transport-level abort of the send action never settles, because `experimental.useOffline` makes Next retry it. The failing-send case therefore answers the action with a 500.

---

**Total deviations:** 7 (1 Rule 1, 2 Rule 3, 4 plan-detail or test-precision)
**Impact on plan:** Deviations 1 and 2 were needed to keep the MOD-02 rule and to meet the plan's own intent. Deviation 3 corrects a stale expectation to this plan's D-239 truth. There is no scope creep.

## Issues Encountered

- Plan-level e2e (`chat.spec.ts notifications.spec.ts feed-comments.spec.ts`, from reset and seed): 69 passed and 10 skipped by design. One failure was the known cold-run flake `feed-comments.spec.ts` "a failed comment list renders the inline error…" on mobile (deferred-items.md, 07-04). It passed on the next run in isolation. The earlier run's D-239 failure is deviation 3, fixed and re-run green.
- `db:seed` still prints `<old-brand>-*.localhost` hosts from `apps/api/.env.local`. The e2e reads its hosts from `apps/web/.env.local` and passes. I did not work around this.
- `[WebServer] chat.messages_bff_failed { status: 404 }` appears once per chat run. A pane from the previous test is still subscribed when `beforeEach` deletes its conversation, and the BFF answers the API's bare 404 as designed.

## Known Stubs

| File | Line | Stub | Resolved by |
|------|------|------|-------------|
| apps/web/app/(app)/suporte/page.tsx | staff branch | A holder of `chat.support` reaching `/suporte` gets the not-found screen (intentional per the plan) | 07-10 (the staff inbox and split view) |

Ledger: entry 62 (the 07-08 slot to a missing page, plus the count-only chat badge) is marked **fixed**. Entry 63 (the staff branch above) is **open**.

## Threat Flags

None. The two new BFF route handlers are the plan's own T-07-62/T-07-63 surface. Both are gated (same-origin or `Sec-Fetch-Site`, session, uuid, and a body cap on the read) and forward the member's own Bearer.

## Notes for 07-10 / 07-11

- **07-10:**
  - `chatMessageView(..., { viewer: 'staff' })` already labels team bubbles and "Você".
  - The messages BFF picks the viewer from `bootstrap.permissions`.
  - `LiveShell` already joins `support-inbox` for staff.
  - `ThreadHeader` documents where the staff variant goes.
  - The blocked-reply race should reuse `ChatComposer`'s `false` return (draft restore) and add its notice.
- **07-11:** real-device checks still owed: UI E10/partial (keyboard lift, BottomNav clear of the field) and the look of the dot and the header on a phone.

## User Setup Required

None. No external service configuration is needed.

## Next Phase Readiness

- Ready for 07-10: the staff inbox, the staff thread and the desktop split view on top of these components and routes.

---
*Phase: 07-notifications-web-push-chat*
*Completed: 2026-09-30*

## Self-Check: PASSED

All 25 created key files exist on disk. The three task commits (`b4c911f`, `8eaf68f`, `da7a8a1`), the two interleaved developer commits (`6129ac8`, `fc82802`) and the sketch approval commit `67ba861` are in history.
