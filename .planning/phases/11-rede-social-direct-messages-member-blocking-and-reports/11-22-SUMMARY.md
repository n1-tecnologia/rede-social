---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 22
subsystem: web
tags: [web, direct-thread, composer-states, lazy-start, message-menu, voice-reuse, ui-gated, sketch-025, D-720, D-721, D-722, D-723, D-733, D-734, UI-D-864, UI-D-865, UI-D-870]

requires:
  - phase: 11-rede-social-direct-messages-member-blocking-and-reports
    provides: "plan 02 (approved sketch 025), plan 10 (direct detail and composer enum), plan 12 (direct voice send), plan 18 (view functions, BFF reads, catalogs), plan 20 (ReportAndBlock, block and unblock actions), plan 19 (/conversas rows that link here)"
provides:
  - "/conversas/com/{membershipId}: the lazy start (redirect to the pair's existing conversation, own membership to /conversas, one not-found for every miss, the empty thread otherwise)"
  - "/conversas/{conversationId}: the direct thread (DirectThreadFrame header, DirectThreadPane body, loading, one not-found screen, the thread error card)"
  - "DirectThreadPane: text and voice, in-place first send with history replace and no toast, catch-up through the shipped BFF read, the five-state composer slot re-read on every signal, subscribe and refocus"
  - "ComposerStateStrip: the closed, blocker and removed strips from the finished views"
  - "MessageList optional per-message menu slot (gutter, incoming bubbles only, props only) and MessageMenuSheet with MessageMenuTrigger"
  - "sendDirectMessage and sendDirectVoice server actions, postDirectMessage and postDirectVoice loaders"

plan_head_before: 7f668a3cf4734e37e3ffcc6e71ebed962cf95e48
actuals:
  tokens: 90000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "a direct thread pane copies the support pane's structure (cursor, catch-up, read mark, optimistic send, voice queue) and never extends it"
    - "the composer state is one finished object re-read through a coalesced BFF read; the pane rebuilds it from NAMED fields and refuses any strip that does not match its state"
    - "the member-side row the viewer did not write is the other bubble: authorIsViewer, the API's own fact, decides it in chatMessageView"
    - "a module list takes an optional per-item ReactNode slot and the host decides who gets it; the package ships no word"

key-files:
  created:
    - apps/web/app/(app)/conversas/[conversationId]/page.tsx
    - apps/web/app/(app)/conversas/[conversationId]/loading.tsx
    - apps/web/app/(app)/conversas/[conversationId]/not-found.tsx
    - apps/web/app/(app)/conversas/[conversationId]/page.test.tsx
    - apps/web/app/(app)/conversas/com/[membershipId]/page.tsx
    - apps/web/app/(app)/conversas/com/[membershipId]/not-found.tsx
    - apps/web/app/(app)/conversas/com/[membershipId]/page.test.tsx
    - apps/web/app/(app)/conversas/actions.ts
    - apps/web/app/(app)/conversas/actions.test.ts
    - apps/web/components/chat/DirectThreadFrame.tsx
    - apps/web/components/chat/DirectThreadPane.tsx
    - apps/web/components/chat/DirectThreadPane.test.tsx
    - apps/web/components/chat/DirectThreadPane.voice.test.tsx
    - apps/web/components/chat/ComposerStateStrip.tsx
    - apps/web/components/chat/ComposerStateStrip.test.tsx
    - apps/web/components/chat/MessageMenuSheet.tsx
    - apps/web/components/chat/MessageMenuSheet.test.tsx
  modified:
    - apps/web/lib/chat.ts
    - apps/web/lib/chat-direct.test.ts
    - apps/web/lib/chat-view.ts
    - apps/web/lib/chat-view.test.ts
    - packages/modules/chat/ui/MessageList.tsx
    - packages/modules/chat/tests/message-list.test.tsx

key-decisions:
  - "chatMessageView now owns a member-side row only when authorIsViewer is true: in a direct conversation both people write on the member side, so without this every bubble would read as the viewer's. A support thread is unchanged (every member-side row there is the viewer's)"
  - "The header lives in a server DirectThreadFrame shared by both routes (staff-variant ThreadHeader, or a bare PageHeader when the first read failed), and the pane draws only the body, so the lazy start and the open thread cannot disagree about the frame"
  - "A lost session is never a send result code: a 401 or 403 the bootstrap knows is a navigation outside the try (the plan listed an unauthenticated code, which could never be produced); not_found was added for the 404 that runs the shipped mid-session handling"
  - "The state read after a first send, a block and an unblock is explicit, because the API signals only messages on the conversation topic (no signal carries a block change), so a block made on another device shows up on the next message signal, subscribe or refocus"
  - "The block dialog's action is wrapped so a block made from a message menu re-reads the composer at once and the strip follows (UI-D-872)"
  - "The support pane's voice machinery was copied, not shared: the plan forbids a branch in the 1257-line ThreadPane, and extracting a shared hook would have edited a shipped, tested file"

patterns-established:
  - "Pane body plus server frame: the route owns the column and header, the client pane owns only what changes"
  - "A strip is a finished view with a kind, a glyph, one sentence and an optional button; the component draws and never decides"

requirements-completed: [CHAT-06, CHAT-07, MODER-05]

coverage:
  - id: D1
    description: "A member opens a conversation from a member: the empty thread (Escreva para {nome}), the first send creates the conversation in place with a history replace, focus kept and no toast; a pair with a conversation redirects to it, the own membership to /conversas, every miss is one not-found screen"
    requirement: CHAT-06
    verification:
      - kind: unit
        ref: "apps/web/components/chat/DirectThreadPane.test.tsx#the lazy start (D-720, UI-D-864) — tracer"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/conversas/com/[membershipId]/page.test.tsx"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/conversas/actions.test.ts#sendDirectMessage (D-720)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The thread: header with the contact's avatar and name linking to the profile (neutral and unlinked for a removed account), log with day separators and no sender label, catch-up on a signal through the shipped BFF read, read mark, thread error card, and every miss is one not-found screen"
    requirement: CHAT-06
    verification:
      - kind: unit
        ref: "apps/web/components/chat/DirectThreadPane.test.tsx#the thread (UI-D-864, D-240)"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/conversas/[conversationId]/page.test.tsx"
        status: pass
    human_judgment: false
  - id: D3
    description: "The composer slot's states: open (composer and microphone), closed (one sentence, no composer or microphone, no name or block word in any output), blocker (one-tap Desbloquear with Desbloqueando…, composer back with focus and the person named in the toast, failure keeps the strip), removed; a live change swaps silently with no toast, scroll or focus move"
    requirement: CHAT-07
    verification:
      - kind: unit
        ref: "apps/web/components/chat/ComposerStateStrip.test.tsx"
        status: pass
      - kind: unit
        ref: "apps/web/components/chat/DirectThreadPane.test.tsx#the composer slot (UI-D-865), the unblock, a live change"
        status: pass
    human_judgment: false
  - id: D4
    description: "A refused send is silent and neutral: closed removes the optimistic bubble, toasts the one sentence and draws the strip; a refused take is discarded the same way; a gone conversation runs the generic toast and a page refresh"
    requirement: CHAT-07
    verification:
      - kind: unit
        ref: "apps/web/components/chat/DirectThreadPane.test.tsx#a refused send (D-722: silent and neutral)"
        status: pass
      - kind: unit
        ref: "apps/web/components/chat/DirectThreadPane.voice.test.tsx#a take answered closed is discarded like a text"
        status: pass
    human_judgment: false
  - id: D5
    description: "The message menu: a gutter trigger beside incoming bubbles only (40px wide at 320px, 44 from 390px), a sheet with Denunciar mensagem and, when canBlock allows, Bloquear {nome} (never for a blocker, a removed account or staff), reporting a direct_message once and blocking by membership id with the strip following"
    requirement: MODER-05
    verification:
      - kind: unit
        ref: "apps/web/components/chat/MessageMenuSheet.test.tsx"
        status: pass
      - kind: unit
        ref: "apps/web/components/chat/DirectThreadPane.test.tsx#the message menu"
        status: pass
      - kind: unit
        ref: "packages/modules/chat/tests/message-list.test.tsx#MessageList per-message menu slot (11-22, D-733, UI-D-870)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Voice in the thread with the shipped composer, bubble, player and voice-send helpers: pending bubble at once, one take in flight, the first recording creates the conversation, retry and discard, the take posted to the direct voice route"
    requirement: CHAT-06
    verification:
      - kind: unit
        ref: "apps/web/components/chat/DirectThreadPane.voice.test.tsx"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/conversas/actions.test.ts#sendDirectVoice (D-734, VOICE-18)"
        status: pass
    human_judgment: false
  - id: D7
    description: "E2 overflow and E2 long-text backstops: a 2000-character text or unbroken URL wraps inside max-w-[85%] with the 40px gutter trigger fully visible at 320 and 390px, and a 60-character contact name truncates in the header"
    verification: []
    human_judgment: true
    rationale: "Layout facts at 320px and 390px that happy-dom cannot measure; the classes are asserted (max-w-[85%], [overflow-wrap:anywhere], h-11 w-10 min-[390px]:w-11, truncate) but no browser run was made. Held-out visual check of the plan."
  - id: D8
    description: "A real phone: VoiceOver and TalkBack phrases of the strips and the trigger, the focus returning to the trigger after the sheet in iOS Safari, recording and playing a take in both directions, the keyboard over the composer at 320px"
    verification: []
    human_judgment: true
    rationale: "The fake recorder, happy-dom focus and no screen reader stand in for the device; UI-D-879 names these as Igor's real-device proofs"

duration: 30min
completed: 2026-11-19
status: complete
---

# Phase 11 Plan 22: The direct conversation screen Summary

**The direct thread at `/conversas/{conversationId}` and its lazy start at `/conversas/com/{membershipId}`: text and voice, the five-state composer slot (open, closed with one calm sentence, the blocker's one-tap Desbloquear, removed), a refused send that is silent and neutral, and a gutter message menu that reports or blocks, all built from the shipped chat parts.**

## Performance

- **Duration:** about 30 min
- **Tasks:** 3 (one tracer, two auto)
- **Files:** 17 created, 6 modified
- **Commits:** 3 task commits

## Accomplishments

- **Lazy start.** `/conversas/com/{membershipId}` redirects to the pair's existing conversation (never two), sends the caller's own membership to `/conversas` without asking the API, and draws the empty thread (80px avatar, "Escreva para {nome}", the explanation) otherwise. The first send, text or voice, swaps the view in place: `window.history.replaceState` makes the address `/conversas/{conversationId}`, the field keeps focus, and no toast or confirmation row appears. A failed first send keeps the draft with the shipped inline error. Every miss (no `chat.direct`, malformed id, staff, removed, other tenant, unknown) is the one not-found screen "Conversa não encontrada" with `Voltar para Conversas`.
- **The thread.** `DirectThreadFrame` (server) draws the fixed-height 680px column and the staff-variant `ThreadHeader` with the contact; `DirectThreadPane` (client) copies the support pane's structure: scroll intents, history, the catch-up cursor from `chat-cursor.ts`, the read mark, optimistic bubbles. Own bubbles are right in brand, the other member's left and neutral, with no sender label. A removed account is "Membro removido" with a neutral avatar and no link.
- **The composer slot.** `ComposerStateStrip` draws the three strips from the finished `composerStateView`. The blocked member's strip is one sentence: the composer AND its microphone are gone, and no output (text, accessible name, attributes, classes) holds a name or a block word, which a test scans. The blocker's strip names the person (clamped to two lines), and `Desbloquear` is one tap with `Desbloqueando…`, then the composer returns, takes focus, and the toast names the person; a failure keeps the strip and fires the generic toast. The state is re-read through a coalesced `GET /api/chat/direct/{id}` on every signal, subscribe and refocus, parsed from named fields (a strip that does not match its state is refused), with no toast, scroll move or focus move.
- **A refused send is silent.** `closed` removes the optimistic bubble, toasts "Esta conversa não aceita novas mensagens." and draws the strip (a refused voice take is discarded the same way); a 404 runs the generic toast and `router.refresh()`.
- **The message menu.** `MessageList` gained an optional `menu` slot in the gutter beside an incoming bubble only (`flex items-center gap-1`, bubble keeps `max-w-[85%]`); the host's `MessageMenuTrigger` is 44px tall and 40px wide at 320px, 44x44 from 390px. `MessageMenuSheet` has `Denunciar mensagem` and, only when the server's `canBlock` allows and the person is live, `Bloquear {nome}`; there is no copy, reply, forward or delete row. Both open plan 20's `ReportAndBlock` (subject `direct_message`, voice flag; block by the other's membership id), and a block re-reads the composer so the blocker's strip follows.
- **Voice.** The composer passes the opt-in voice props; the take goes through `voice-deps` and `runVoiceSend` to `sendDirectVoice` -> `POST /v1/chat/direct/voice-messages`, mapped to the shipped voice words (`direct_closed` becomes `closed`).

## Task Commits

1. **Task 1 (tracer): open a conversation from a member and send the first message in place** - `8fff9a65` (feat)
2. **Task 2: the composer slot's states, the neutral refusal and the one-tap unblock** - `80f06d40` (feat)
3. **Task 3: the message menu and voice in the direct thread** - `dbe38363` (feat)

**Plan metadata:** the docs commit that carries this file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `chatMessageView` marked every direct bubble as the viewer's own**
- **Found during:** Task 1 (reading `service.ts`: both people write with `author_side = 'member'`)
- **Issue:** for a member viewer `own` was `row.side === 'member'`, so the other member's message would draw on the right in brand.
- **Fix:** a member viewer owns a member-side row only when `row.authorIsViewer` is true, and the other's row gets `authorKey: 'member:other'`. In a support thread every member-side row is the viewer's, so nothing changes there; the BFF catch-up route formats through the same function, so it needed no change. Test `7b` in `chat-view.test.ts`.
- **Files modified:** `apps/web/lib/chat-view.ts`, `apps/web/lib/chat-view.test.ts` (neither in the plan's list)
- **Committed in:** `8fff9a65`

**2. [Rule 3 - Blocking] A frame component and a not-found for the lazy-start route**
- **Found during:** Task 1
- **Issue:** both routes need the same column and header, and `notFound()` in `/conversas/com/{id}` would not reach the sibling `[conversationId]/not-found.tsx`.
- **Fix:** `components/chat/DirectThreadFrame.tsx` (server frame, shared) and `conversas/com/[membershipId]/not-found.tsx` (a one-line re-export of the same screen).
- **Committed in:** `8fff9a65`

**3. [Rule 1 - Plan inconsistency] Result codes of the text send**
- **Issue:** the plan lists `unauthenticated`, but a 401 or 403 the bootstrap knows must be a navigation outside the try (the same bullet), so that code could never be produced; and the 404 that runs the generic toast plus refresh needs a code of its own.
- **Fix:** the result codes are `closed`, `invalid`, `rate_limited`, `not_found`, `failed` (a lost session redirects, tested).
- **Committed in:** `8fff9a65`

**4. [Rule 2 - Coverage] Loader tests**
- `lib/chat-direct.test.ts` (plan 18's file) gained `postDirectMessage` and `postDirectVoice` cases. Committed in `8fff9a65` and `dbe38363`.

### Notes on process

- **Tests were written beside the code, not strictly before it.** Each task's tests passed on their first full run (the strip, pane, page and action tests), so no red run was captured; the assertions were checked against the behaviours listed in the plan's `<behavior>` and edge truths, and the discriminating ones (a neutral strip with no name or block word, one toast, no scroll or focus move on a live change, no trigger beside own bubbles) assert absence directly.
- **The pane's voice machinery is a copy of the support pane's** (about 200 lines: queue, retry, discard, bubble props). That is what the plan asks (no branch in `ThreadPane`), but the two now have to be kept in step; a shared `useVoiceSends` hook is an advisory for later.
- **Free disk stayed above 15 GiB**; `apps/web/.next/cache` was removed after the build.

**Total deviations:** 4 (1 Rule 1 bug, 1 Rule 3 blocking, 1 Rule 1 plan inconsistency, 1 Rule 2 coverage). **Impact:** none on scope; the first one is what makes the thread correct at all.

## Issues Encountered

- The toast animates under happy-dom and cancels on cleanup (an unhandled `AbortError`); the new tests set `MotionGlobalConfig.skipAnimations = true` as the report sheet's tests do.
- The API emits no signal on a block or unblock, so a block made on another device reaches an open thread on the next message signal, subscribe or refocus (the three triggers the plan names), not instantly.

## Known Stubs

None. Every control is wired to its server action and tested. The only state not drawn by design is "not drawn at all" (UI-D-865 state 5), which is the not-found screen.

## Threat Flags

None. No new endpoint: the pane calls the shipped BFF reads and the actions call routes the API already guards. T-11-03 (no name, reason or block word in the blocked member's strip, toast, accessible name or log, scanned by tests and by a logged-shape check), T-11-02 (the screen renders only what the API returned; every miss is one not-found), T-11-16 (every name and message is React text, a markup test), T-11-06 (one not-found for every miss, the own-membership redirect needs no API call) and T-11-17 (the sketch guard printed 1 before each task) are mitigated as in the register.

## User Setup Required

None - no external service configuration required.

## Owed outside this plan

- Held-out visual checks (E2 overflow, E2 long-text) at 320px and 390px with a 2000-character text, a long unbroken URL and a 60-character name.
- Real-device proofs: VoiceOver and TalkBack phrases of the strips and the trigger, the focus returning to the trigger in iOS Safari, a real recording sent and played both ways, the keyboard over the composer at 320px.
- Playwright was not run (no stack started). The entry points that link to `/conversas/com/{membershipId}` (the profile "Enviar mensagem" and the member row) belong to plan 23; until then the lazy start is reachable only by its address.
- If the other member is removed while the thread is open, the strip follows but the header (rendered by the server) keeps the old name until the next navigation or refresh.

## Gates Run

- Sketch guard `grep -q '^approved: true' .planning/sketches/025-phase-11-designed-screens/README.md` printed `1` before each task; the sketch was only read.
- `pnpm lint` (turbo lint, `check-ui-literals.sh`, dashboard fixtures): green after each task. `biome check` on every touched file clean.
- `pnpm --filter @rede-social/web exec vitest run components/chat "app/(app)/conversas" "app/(app)/suporte"`: 32 files, 587 tests green. `tests/message-list.test.tsx`: 12 green.
- `TURBO_CACHE=local:r pnpm turbo test --filter=@rede-social/web --filter=@rede-social/module-chat --concurrency=4`: web 439 files, 10561 tests; chat module 17 files, 332 tests. The Phase 10.2 `EventsSections` flake did not occur.
- `TURBO_CACHE=local:r pnpm turbo typecheck --filter=@rede-social/web --filter=@rede-social/module-chat --filter=@rede-social/api --concurrency=4`: 5 tasks passed, including the web build (no `node:fs` leak through the contracts index); the build route table lists `/conversas/[conversationId]`.
- `pnpm boundaries` (2699 files, no issues), `pnpm guard:lanes`, `bash scripts/check-ui-literals.sh`: clean.
- Acceptance greps: guard count 1; `ThreadPane` import lines in `DirectThreadPane.tsx` 0; the label-literal grep over `packages/modules/chat/ui` 0; the shipped `suporte` and `message-list` cases pass unchanged.
- Not run: Playwright, API integration suites (no API change), `pnpm db:reset`, `pnpm db:seed`. No `supabase` command was issued; ROADMAP, STATE and REQUIREMENTS were not touched.

## Next Phase Readiness

Plan 23 (the entry points) can link to `/conversas/com/{membershipId}`; plan 19's rows already reach `/conversas/{conversationId}`. `useReportAndBlock`'s generic `subjectType` and the `menu` slot of `MessageList` are ready for the other subjects.

## Self-Check: PASSED

- Created files exist on disk (the two pages, loading, both not-found files, actions, the frame, the pane, the strip, the menu and the seven test files).
- Commits `8fff9a65`, `80f06d40`, `dbe38363` exist; `git rev-list --count 7f668a3c..HEAD` was 3 before this SUMMARY; no commit carries a Co-Authored-By line.
