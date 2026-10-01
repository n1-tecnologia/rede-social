---
phase: 07-notifications-web-push-chat
plan: 10
subsystem: chat
tags: [chat, support, staff-inbox, split-view, realtime, next16, playwright, D-221, D-224, D-225, D-238, UI-D-262, UI-D-263, UI-D-264]
status: complete

requires:
  - phase: 07-notifications-web-push-chat
    provides: "07-08 inbox API (GET /v1/chat/inbox, GET /v1/chat/conversations/{id}, the staff reply with 409 member_blocked/member_removed, the shared staff read position, chat.message/chat.read on support-inbox); 07-09 ThreadPane, ThreadHeader, chat-view, lib/chat, the messages/read BFF routes, LiveShell joining support-inbox for chat.support holders; 07-02 sketch 007 (approved 2026-09-30, provisional)"
provides:
  - "@rede-social/module-chat/ui InboxRow (avatar, name, one-line preview, time, awaiting dot, Bloqueado pill, departed variant) and the ThreadHeader staff variant { avatar, name, profileHref, profileLabel }"
  - "apps/web/lib/chat-view.ts inboxTime ('HH:mm' / 'Ontem' / dd/MM in the tenant zone) and inboxRowView"
  - "apps/web/lib/chat.ts fetchInbox/getInbox, fetchConversation/getConversation, replyToConversation, and fetchMessages with cursor null (latest page)"
  - "the shared /suporte layout segment: chat.support holders get SupportSplit (list + pane; one 288px|1fr card from lg), everyone else passes through to the 07-09 member thread"
  - "SupportInbox: support-inbox live page-1 refetch through GET /api/chat/inbox, keyset load-more through loadMoreInboxAction, pull-to-refresh, skeletons, empty and error states"
  - "/suporte/[conversationId] staff thread with loading.tsx and the one not-found screen; replyToConversationAction"
  - "ThreadPane viewer='staff', onSendAction, readOnlyNotice and the 409 race"
  - "chat.inbox.*, chat.staff.*, chat.blocked.*, chat.removed.*, chat.notFound.* catalog keys"
affects: [07-11 real-device test plan and deploy notes, 08 moderation (block/remove member actions reuse the read-only notices), 08.1 multi-tenant identity (the staff routes read the caller's tenant from the bootstrap)]

actuals:
  tokens: 24900
  tasks: 2
  commits: 5
plan_head_before: 61d936bde88b6db58fbcc4229ef9684b6c44d5aa

tech-stack:
  added: []
  patterns:
    - "A shared layout segment holds a list that must survive child navigations; a client wrapper reads useSelectedLayoutSegment() and lays out list/pane with CSS only (no JS media query), so SSR and hydration agree at every width"
    - "A module package's plain <a> rows become client navigations through click delegation in the host (router.push, scroll: false), keeping the module free of next/link (MOD-02)"
    - "The layout streams the list in its own Suspense boundary, so the right pane never waits for the list and the list never blanks for the pane"
    - "e2e locators for streamed Suspense content are scoped to the rendered container: React parks resolved content in a hidden <div hidden id='S:…'> before revealing it"

key-files:
  created:
    - packages/modules/chat/ui/InboxRow.tsx
    - packages/modules/chat/tests/inbox-row.test.tsx
    - packages/modules/chat/tests/thread-header.test.tsx
    - apps/web/app/(app)/suporte/layout.tsx
    - apps/web/app/(app)/suporte/SupportSplit.tsx
    - apps/web/app/(app)/suporte/SupportInbox.tsx
    - apps/web/app/(app)/suporte/[conversationId]/page.tsx
    - apps/web/app/(app)/suporte/[conversationId]/loading.tsx
    - apps/web/app/(app)/suporte/[conversationId]/not-found.tsx
    - apps/web/app/api/chat/inbox/route.ts
  modified:
    - packages/modules/chat/ui/ThreadHeader.tsx
    - packages/modules/chat/ui/index.ts
    - apps/web/lib/chat.ts
    - apps/web/lib/chat-view.ts
    - apps/web/lib/chat-view.test.ts
    - apps/web/app/(app)/suporte/page.tsx
    - apps/web/app/(app)/suporte/ThreadPane.tsx
    - apps/web/app/(app)/suporte/actions.ts
    - apps/web/messages/pt-BR/chat.json
    - apps/web/i18n/messages.test.ts
    - apps/web/e2e/chat.spec.ts
    - apps/web/e2e/chat-admin.ts
    - scripts/check-static-routes.sh

key-decisions:
  - "The split layout is CSS-only on top of useSelectedLayoutSegment(): below lg the list or the pane is hidden by class, from lg both show in one grid card; no JS breakpoint, so a resize never changes the URL or remounts anything"
  - "Inbox rows stay plain <a> in the module; SupportInbox delegates plain left clicks to router.push(href, { scroll: false }) so the shared layout, the list state and its scroll position survive the navigation; modified clicks keep the browser's behaviour"
  - "The inbox page 1 streams in its own Suspense boundary inside the layout (72px row skeletons); router.refresh() re-seeds the list from the server's new page 1"
  - "Live refresh merges page 1 at the top by conversation id and keeps every older loaded row; page 1's cursor replaces the list cursor only while the list holds a single page"
  - "The conversation not-found screen names the caller's tenant from the bootstrap (the shell's own display name), falling back to the host shell only if the bootstrap cannot be read"
  - "A reply racing a block restores the draft with the notice as the composer's inline error, toasts the same sentence, and router.refresh() swaps the composer for the read-only notice"
  - "A departed member's header shows the neutral avatar and 'Membro removido' in tertiary with no link; a blocked member keeps the profile link (UI-D-263)"

patterns-established:
  - "Shared-segment master/detail: layout.tsx gates by permission and renders a client split with list={<Suspense><ListLoader/></Suspense>} beside children"
  - "Staff-side reuse of a member pane through viewer + an injected server action prop, instead of a second pane component"

requirements-completed: [CHAT-03, CHAT-04]

coverage:
  - id: D1
    description: "InboxRow: one link with avatar, name 14/700, one-line preview, tabular time, the 8px brand awaiting dot with the sr suffix, the neutral Bloqueado pill in the dot slot, the departed variant (tertiary name, neutral avatar), aria-current on the open row, truncation geometry, and no shipped words"
    requirement: CHAT-03
    verification:
      - kind: unit
        ref: "packages/modules/chat/tests/inbox-row.test.tsx"
        status: pass
    human_judgment: false
  - id: D2
    description: "Inbox times in the tenant clock ('HH:mm' today, 'Ontem', dd/MM) across the UTC midnight and under Manaus; team previews prefixed '{firstName}: '; multi-line previews on one line; the removed name"
    requirement: CHAT-03
    verification:
      - kind: unit
        ref: "apps/web/lib/chat-view.test.ts#inboxTime / inboxRowView (13-18)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/chat.spec.ts#8. inbox times are the São Paulo wall clock, not the device clock"
        status: pass
    human_judgment: false
  - id: D3
    description: "A support user's chat slot counts the awaiting threads ('Suporte, 1 aguardando resposta'), /suporte lists the seeded thread with the dot and the preview, and tapping opens the staff thread whose header links /membros/{membershipId} and whose own team bubble reads 'Você'"
    requirement: CHAT-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/chat.spec.ts#1. the support user: the slot counts 1, the inbox marks the seeded thread"
        status: pass
    human_judgment: false
  - id: D4
    description: "Shared thread, live (D-225, D-238): a member message moves the row to the top in two staff inboxes; when one staff member opens it the other's dot and count clear without a reload; the admin reads team bubbles by first name"
    requirement: CHAT-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/chat.spec.ts#2. two staff members share the thread"
        status: pass
    human_judgment: false
  - id: D5
    description: "A staff reply reaches the member live labelled with the agent's first name, and reads 'Você' for its author"
    requirement: CHAT-04
    verification:
      - kind: e2e
        ref: "apps/web/e2e/chat.spec.ts#3. a staff reply reaches the member live"
        status: pass
    human_judgment: false
  - id: D6
    description: "Blocked member: the Bloqueado pill in the inbox, the read-only notice in place of the composer, and a reply racing the block toasts the notice, sends nothing and swaps the notice in"
    requirement: CHAT-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/chat.spec.ts#4. a blocked member"
        status: pass
      - kind: unit
        ref: "packages/modules/chat/tests/thread-header.test.tsx"
        status: pass
    human_judgment: false
  - id: D7
    description: "Every miss is one screen (T-07-66, T-07-67): a member on a staff URL, a lab conversation id, a random uuid and a malformed id all render 'Conversa não encontrada' with 'Ver conversas'"
    requirement: CHAT-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/chat.spec.ts#5. every miss is one screen"
        status: pass
    human_judgment: false
  - id: D8
    description: "Desktop split (UI-D-264): at 1280×800 the 288px list sits beside the idle pane; a row click navigates client-side, swaps only the right pane, marks the row aria-current and keeps the list's scrollTop; resizing to 900 shows the thread alone with the URL kept, and back shows the list"
    requirement: CHAT-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/chat.spec.ts#6. desktop split"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/chat.spec.ts#7. E13 backstop"
        status: pass
    human_judgment: false
  - id: D9
    description: "Catalog strings verbatim (inbox, staff header, blocked/removed notices, not-found) with {firstName}, {preview}, {name} and {tenant} formatted; no status words (D-221)"
    requirement: CHAT-03
    verification:
      - kind: unit
        ref: "apps/web/i18n/messages.test.ts#07-10 describes"
        status: pass
    human_judgment: false
  - id: D10
    description: "Static-route gate: /suporte/[conversationId] is required and dynamic"
    verification:
      - kind: other
        ref: "bash scripts/check-static-routes.sh (54 guarded routes, 0 offenders)"
        status: pass
    human_judgment: false
  - id: D11
    description: "The staff inbox and thread as they look and feel on a real phone (thumb reach, keyboard lift in the staff thread, pull-to-refresh) and the split view against the designer's eye"
    requirement: CHAT-03
    verification: []
    human_judgment: true
    rationale: "Phones cannot reach *.localhost; real-device checks belong to the 07-11 test plan and the phase UAT on a deployed host. The sketch 007 approval is provisional (product owner), so a designer pass may still adjust the look."

duration: 39min
completed: 2026-09-30
---

# Phase 7 Plan 10: Staff Side of Support (Inbox, Staff Thread, Desktop Split) Summary

**Staff now open the chat slot to one activity-ordered inbox that refreshes itself over the `support-inbox` topic and marks what awaits the team with a brand dot. Any staff member can open any conversation from a thread whose header links the member's profile, and a read or reply clears "awaiting" for the whole team live. Blocked and departed members' threads are read-only, every miss is one not-found screen, and from `lg` the list stays beside the conversation in one split card.**

## Performance

- **Duration:** 39 min
- **Started:** 2026-09-30T20:25:08Z
- **Completed:** 2026-09-30T21:04:00Z
- **Tasks:** 2 of 2
- **Files modified:** 27 (10 created, 13 modified in the two task commits; plus this SUMMARY and the ledger)

## Accomplishments

- **D-33 gate.** Both preconditions (`grep -q '^approved: true' .planning/sketches/007-phase-07-designed-screens/README.md`) passed. Sketch 007 was approved by igor.vboas on **2026-09-30** (`approval_kind: provisional`, committed in 67ba861). The README was not edited.
- **`InboxRow`** (module, props-only). It has the UI-D-262 geometry:
  - a 72px row with the 40px avatar and a `User` fallback;
  - the name and a one-line preview, which truncate;
  - a `tabular-nums` time;
  - the 8px `bg-brand` dot with the ", aguardando resposta" suffix;
  - the neutral "Bloqueado" pill in the dot slot;
  - the departed variant;
  - `aria-current` on the open row.
- **Formatters.** `inboxTime` prints "HH:mm", "Ontem" or `dd/MM` in the tenant zone, from the caller's single clock read. `inboxRowView` adds the team preview prefix, keeps the preview on one line and applies the removed name.
- **The shared `/suporte` layout.** It gates by permission. A caller without `chat.support` gets 07-09's member thread, untouched. Staff get `SupportSplit`:
  - The list is rendered once in the layout segment, so it survives every `/suporte/{id}` navigation.
  - Below `lg`, list and thread are separate routes.
  - From `lg`, they share one `288px | 1fr` card at the shell's content height, and only the panes scroll.
  - The list's first page streams in its own Suspense boundary behind row skeletons.
- **`SupportInbox`.** It joins `tenant:<t>:support-inbox`. On `chat.message` / `chat.read`, on re-subscribe and on refocus, it refetches page 1 through the new `GET /api/chat/inbox` BFF, with coalesced runs (T-07-71). The refetch merges by id at the top. The list also has:
  - keyset load-more through `loadMoreInboxAction`, with the inline error and a retry;
  - pull-to-refresh on the phone;
  - the empty state and the generic first-load error.
  
  Row clicks become client navigations, so the list keeps its scroll position.
- **Staff thread `/suporte/[conversationId]`.** The page checks `chat.support` and the uuid, then reads the conversation detail and the latest page.
  - The `ThreadHeader` staff variant goes back to `/suporte`. It has one link to `/membros/{membershipId}` with the avatar and the name `<h1>`; a departed member gets no link.
  - `ThreadPane` runs with `viewer="staff"` and the staff reply action.
  - Blocked and departed members get the read-only notice in place of the composer. A 409 race restores the draft, shows the toast, and refreshes into the notice.
  - `loading.tsx` draws the thread geometry. `not-found.tsx` is the one D-23 screen.
- **Idle pane.** `/suporte` for staff is now the "Escolha uma conversa" pane from `lg`. This closes ledger entry 63.
- **Proof.**
  - Unit tests: chat module 43, web `chat-view` + `i18n` 557.
  - Web typecheck, lint, `check-ui-literals`, web build, and the static-route gate (54 guarded routes, 0 offenders).
  - Plan-level e2e from a reset and seeded database: `chat.spec.ts notifications.spec.ts push.spec.ts` gave **93 passed, 5 skipped by design, exit 0**.

## Task Commits

1. **Task 1: staff inbox, shared split layout, live page-1 refresh, keyset paging, states**: `a00066c` (feat)
2. **Task 2: staff thread, profile-link header, read-only notices and 409 race, not-found, staff e2e**: `2535208` (feat)

`commits: 5` in the frontmatter is measured with `git rev-list --count 61d936b..HEAD`. It includes three commits the developer made in another session while this plan ran: `0941f16` (08.1 research), `43d303e` (08.1 decisions D-317..D-319 and validation) and `8bef939` (08.1 patterns). This plan's own commits are the two above plus the docs commits. `actuals.tokens` covers only this plan's two task commits (chars/4 over their added lines).

## Files Created/Modified

See `key-files`. The main ones:
- `packages/modules/chat/ui/InboxRow.tsx`, `packages/modules/chat/ui/ThreadHeader.tsx`: the row and the header staff variant.
- `apps/web/app/(app)/suporte/{layout,SupportSplit,SupportInbox}.tsx`: the shared segment, the split and the live list.
- `apps/web/app/(app)/suporte/[conversationId]/{page,loading,not-found}.tsx`: the staff thread route.
- `apps/web/app/api/chat/inbox/route.ts`: the realtime-triggered page-1 refetch.
- `apps/web/app/(app)/suporte/{ThreadPane.tsx,actions.ts}`: the staff send path, the notices and `loadMoreInboxAction` / `replyToConversationAction`.

## Decisions Made

See `key-decisions`. Also:
- **The e2e runs its staff cases per project on purpose.** Case 1 is the phone flow, so it is skipped on desktop. Cases 6 and 7 are the `lg` split, so they are skipped on the phone. Cases 2-5 and 8 run on both projects.
- **The staff cases never mutate the seeded thread's messages.** They use `rafael.teixeira@rede-demo.local` and throwaway conversations. `beforeEach` restores a clean inbox, keeping only the seeded thread with the team read position at seq 2 (the seed's).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The not-found screen named the raw hostname instead of the tenant**
- **Found during:** Task 2 (e2e case 5)
- **Issue:** Following the events not-found, the screen read the host shell's name. In this environment the host lookup does not resolve the tenant (the known `<old-brand>-*` env hosts, the same cause as ledger #61), so the body read "Ela não existe ou não é de rede-demo.localhost."
- **Fix:** `/suporte` is an authenticated route, so the screen names the caller's tenant from the bootstrap. That is the same `tenant.displayName` the shell brands itself with, and the API holds it equal to the host's tenant. It falls back to the host shell only when the bootstrap cannot be read. The five causes still render one indistinguishable screen.
- **Files modified:** apps/web/app/(app)/suporte/[conversationId]/not-found.tsx
- **Committed in:** 2535208

**2. [Test precision] The streamed Suspense rows were counted before they were revealed**
- **Found during:** Task 2 (plan-level e2e, case 6 on the first full run)
- **Issue:** React streams a resolved Suspense boundary into a hidden `<div hidden id="S:…">` before revealing it. An unscoped `a[data-inbox-row]` count matched those hidden rows while the skeleton was still on screen, so the scroll assertion ran against a pane that was not yet scrollable.
- **Fix:** The inbox locators are scoped to `[data-support-list]`. Case 6 waits for the last row to be visible and polls the scroll. The case then passed three times in a row and in the full run.
- **Committed in:** 2535208

**3. [Plan detail] `inboxTime` takes the "Ontem" word as a fourth argument**
- The plan's signature was `inboxTime(iso, keys, tz)`. The word comes from the catalog, so the function takes `words: { yesterday }` and stays pure (the `chatDayLabel` precedent).

**4. [Plan detail] `fetchMessages` accepts `cursor: null` for the latest page**
- The staff page's first render needs the latest 50 messages with no cursor. The existing BFF's cursor parsing is unchanged.

**5. [Plan detail] `ThreadPane` gains `raceNotices`**
- The 409 answer carries only the code. The page formats the two notice sentences (the blocked one needs the member's name) and hands them to the pane, which toasts the matching one.

---

**Total deviations:** 5 (1 Rule 1, 1 test precision, 3 plan-detail)
**Impact on plan:** Deviation 1 keeps the not-found body correct wherever the host lookup and the membership disagree about the display name. The rest are signatures and test scoping. There is no scope creep.

## Issues Encountered

- The first plan-level e2e run had one failure: case 6, the streaming-scope issue above. After the fix, a fresh reset, seed and run of all three specs was green.
- Every page logs `pageerror: Cannot read properties of undefined (reading 'waiting')` under Playwright, because the service worker registration is blocked. It also appears on `/inicio`, it is pre-existing, and none of this plan's pages add any console error.
- `db:seed` still prints `<old-brand>-*.localhost` hosts from `apps/api/.env.local` (known). The e2e reads its hosts from `apps/web/.env.local` and passes.
- Running `biome check` from `apps/web` over the chat module path warns about an unused suppression in `ChatComposer.tsx`. That warning is pre-existing and not from this plan. The module's own `lint` script is clean.

## Known Stubs

None. Ledger entry 63 (staff `/suporte` rendering the not-found screen) is marked **fixed**.

## Threat Flags

None beyond the plan's register. `GET /api/chat/inbox` is the plan's own artifact. It is gated by `Sec-Fetch-Site: same-origin` and the session, forwards the caller's Bearer, and the API re-enforces `chat.support` (T-07-66). Previews render as React text only (T-07-70), and page-1 refetches are coalesced (T-07-71).

## User Setup Required

None. No external service configuration is needed.

## Next Phase Readiness

- The chat loop is complete on the web: the member thread (07-09) and the staff inbox and thread (07-10).
- For 07-11: the real-device checks still owed are UI E10/partial (07-09) and the staff screens on a phone (D11 above). The deploy order is unchanged (API before web).
- Phase 8's block and remove actions will surface through the notices built here, with no UI change needed.

---
*Phase: 07-notifications-web-push-chat*
*Completed: 2026-09-30*

## Self-Check: PASSED

All ten created key files exist on disk. The two task commits (`a00066c`, `2535208`), the sketch approval commit `67ba861` and the three interleaved developer commits (`0941f16`, `43d303e`, `8bef939`) are in history.
