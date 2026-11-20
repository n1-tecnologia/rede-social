---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 19
subsystem: web
tags: [web, conversas, bubble, inbox-row, ui-gated, sketch-025, D-719, D-720, D-721, UI-D-861, UI-D-862, UI-D-863, UI-D-866, UI-D-879]

requires:
  - phase: 11-rede-social-direct-messages-member-blocking-and-reports
    provides: "plan 02 (approved sketch 025), plan 10 (the list API and the counters), plan 18 (view functions, GET /api/chat/direct, catalogs)"
provides:
  - "/conversas: the full-screen Conversas route (page, loading, error) in the 680px column, not-found without chat.direct"
  - "ConversationsList and ConversationsSkeleton: the pinned support row, the direct rows by recency, blank/loading/error/later-page states, live refresh by merge"
  - "withConversationsDestination and chatSlotLabel (lib/chat-nav.ts): the chat slot opens /conversas and reads 'Conversas' from the permission chat.direct, with the ICU plural name"
  - "InboxRow optional unread, avatarSlot, label and previewMuted props (additive, no word in the package)"
affects: [11-22, 11-23, 11-24]

plan_head_before: 90fed6302c2934be1f7b2606d6a829bed07d6af0
actuals:
  tokens: 22000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "host-side nav rewrite from permission data: withConversationsDestination mirrors withTabOverrides, keyed on a permission and never on a role"
    - "the live list reuses reconcileInboxPage and the staff inbox's coalesced refetch (one in flight, one queued) over a BFF read, with the focused row put back by href after a merge"
    - "the module row stays props-only: the host builds the count Badge, the dot, the avatar node and the whole-link accessible name"

key-files:
  created:
    - apps/web/app/(app)/conversas/page.tsx
    - apps/web/app/(app)/conversas/page.test.tsx
    - apps/web/app/(app)/conversas/loading.tsx
    - apps/web/app/(app)/conversas/error.tsx
    - apps/web/app/(app)/conversas/boundaries.test.tsx
    - apps/web/app/(app)/conversas/ConversationsList.tsx
    - apps/web/app/(app)/conversas/ConversationsList.test.tsx
    - apps/web/lib/chat-nav.ts
    - apps/web/lib/chat-nav.test.ts
    - apps/web/lib/chat-nav.topbar.test.tsx
  modified:
    - apps/web/app/(app)/layout.tsx
    - apps/web/components/shell/LiveShell.tsx
    - packages/modules/chat/ui/InboxRow.tsx
    - packages/modules/chat/tests/inbox-row.test.tsx

key-decisions:
  - "The destination follows the composed permission chat.direct (data), applied to the finished nav in the layout; only the slot's href and label change, so the icon, the order and the counter it reads stay the manifest's (D-719, T-11-35)"
  - "The bubble's number name is produced in the same place as the dot's sentence (LiveShell labelFor), through the pure chatSlotLabel, with a new LiveShell prop conversations = permissions.includes('chat.direct')"
  - "InboxRow gained unread, avatarSlot, label (aria-label of the link) and previewMuted; awaitingSr and blockedLabel became optional because a Conversas row has neither"
  - "The page back control reuses chat.member.back ('Voltar'): plan 18 pinned the exact chat key set, so a new 'Voltar para o início' key was not added"
  - "An API 404 on page 1 is the not-found screen; other failures are the list's own error card (page passes initial null); a refusal bootstrapRedirectPath knows is a redirect"

patterns-established:
  - "Live list over a BFF read: signal on the member's own user topic (chat.unread), (re)subscribe and refocus all call one coalesced refreshPage1 that merges by conversation id"

requirements-completed: [CHAT-06]

coverage:
  - id: D1
    description: "A member holding chat.direct taps the bubble, lands on /conversas and sees the pinned support row (dot) then each direct conversation by recency with avatar, name, one-line preview, time and the count badge (99+ cap), each row one link named by its finished label"
    requirement: CHAT-06
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/conversas/ConversationsList.test.tsx#ConversationsList (UI-D-862, UI-D-879)"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/conversas/page.test.tsx#/conversas page (UI-D-862, T-11-35)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The chat slot opens /conversas and reads Conversas only with chat.direct; staff, a member with social off and a tenant without chat get the shipped slot (Suporte, dot or count)"
    requirement: CHAT-06
    verification:
      - kind: unit
        ref: "apps/web/lib/chat-nav.test.ts#withConversationsDestination (UI-D-861)"
        status: pass
      - kind: unit
        ref: "apps/web/lib/chat-nav.topbar.test.tsx#the chat bubble in the TopBar (UI-D-861)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Loading (header at once, three skeleton rows, aria-busy), blank (support row stays, card with Encontrar pessoas), first-read error (card, no support row), failed later page (rows kept, inline retry) and the live merge without moving the scroll or the focus"
    requirement: CHAT-06
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/conversas/ConversationsList.test.tsx#ConversationsList states (UI-D-863), live refresh (UI-D-863, D-240)"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/conversas/boundaries.test.tsx"
        status: pass
    human_judgment: false
  - id: D4
    description: "The row on a real phone: VoiceOver and TalkBack phrases of the rows and the bubble, the 44px targets, the focus kept when a row moves in iOS Safari and Firefox (no moveBefore), the 320px layout, and the bubble's count over the tenant's own brand"
    requirement: CHAT-06
    verification: []
    human_judgment: true
    rationale: "happy-dom cannot reproduce the browser's blur of a moved element or a screen reader's speech; UI-D-879 names these as Igor's real-device proofs"

duration: 20min
completed: 2026-11-19
status: complete
---

# Phase 11 Plan 19: Conversas list and the bubble that opens it Summary

**/conversas with the pinned support row and the direct rows by recency (count badge, 99+, every state, live merge that keeps scroll and focus), and a chat bubble that opens it and says "Conversas, N conversas com mensagem nova" only for a viewer who holds chat.direct.**

## Performance

- **Duration:** about 20 min
- **Tasks:** 3 (one tracer, two auto)
- **Files:** 10 created, 4 modified
- **Commits:** 3 task commits

## Accomplishments

- `withConversationsDestination(nav, permissions, label)` rewrites only the chat slot's `href` (`/conversas`) and `label` when `permissions` has `chat.direct`; otherwise the nav comes back untouched. The layout applies it to the finished nav, so staff, a member with `social` off and a tenant without chat keep `/suporte`, "Suporte", the dot or the staff count.
- `/conversas` is a server page under the shipped `PageHeader` (back to `/inicio`) with the list in a `mx-auto w-full max-w-[680px]` column on every breakpoint. It 404s without `chat.direct`, reads page 1 through `fetchDirectList`, formats it through `conversationsPageView` from one `Date.now()`, and passes the tenant and member ids of the bootstrap to the list.
- `ConversationsList` draws exactly what the API answered: row 1 is always the support row (tenant logo or `Headset` in a 40px neutral disc, the dot as its mark, opening `/suporte`), then the direct rows, each one `<a>` named by the finished label, with the `Mic` glyph for voice, the shipped count `Badge` (`99+`) and "Membro removido" with the neutral avatar. Nothing is filtered or flagged client-side (T-11-03), every member string is a React text node (T-11-16), and a plain left click becomes `router.push`.
- States: `loading.tsx` (header at once, three skeleton rows, `aria-busy`), `error.tsx` (header and the list's card), blank (support row stays, card with `Encontrar pessoas` to `/membros`, no "Nova conversa", no search), first-read error (card, no support row, retry shows the skeleton), failed later page (rows kept, inline retry that re-arms the sentinel), `PullToRefresh` and `InfiniteScroll` by cursor.
- Live: the member's own `chat.unread` signal, every (re)subscribe and every refocus run one coalesced refetch of page 1 through `GET /api/chat/direct`, merged by conversation id with the shipped `reconcileInboxPage`; a failed refetch keeps the screen, nothing animates, `scrollTo` is never called and the focused row is put back by its href after the commit.
- The bubble: `chatSlotLabel` gives "Conversas, {count, plural, ...}" for `chat.direct` and the shipped sentences otherwise; `LiveShell` takes a new `conversations` prop from the permission. At zero the name is the plain slot label. The slot's `Badge` style is the API's `conversationsBadge: 'count'`, so no style logic was added to the shared shell components.
- `InboxRow` gained `unread`, `avatarSlot`, `label` and `previewMuted` (additive, props only, no word in the package); the 26 shipped and new row tests pass and the shipped inbox, suporte and shell tests are unchanged.

## Task Commits

1. **Task 1 (tracer): the bubble opens Conversas, the list shows the support row and the direct rows** - `375d34b8` (feat)
2. **Task 2: Conversas states, paging and the live refresh** - `551b77ae` (feat)
3. **Task 3: the bubble names how many conversations wait, only for a member with chat.direct** - `3c83fdca` (feat)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The web typecheck is not type-only: it runs `next build`**
- **Found during:** Task 1 verification
- **Issue:** `turbo typecheck --filter=@rede-social/web` builds first, and a type error in my `page.test.tsx` (`props` typed `unknown`) failed the build.
- **Fix:** cast the child props to `Record<string, unknown>` in the test helper.
- **Files modified:** `apps/web/app/(app)/conversas/page.test.tsx`
- **Committed in:** `375d34b8`

**2. [Rule 3 - Blocking] `error.tsx` uses Next 16.3's `retry`, not `reset`**
- **Found during:** Task 2
- **Issue:** the other boundaries in the app use `reset`; the Next docs of this version name `retry` the stable prop (v16.3.0) and `reset` the exception. Next 16.3.5's error boundary does pass `retry`.
- **Fix:** `conversas/error.tsx` takes `retry`.
- **Committed in:** `551b77ae`

### Plan deviations and notes

- **`LiveShell.tsx` was edited though not in `files_modified`.** The plan says to add the plural sentence "in the same place the dot's sentence is produced", which is `LiveShell`'s `labelFor`; it got one optional `conversations` prop and delegates to the pure `chatSlotLabel` (tested in `lib/chat-nav.test.ts` and in a real TopBar render). No shared shell component in `packages/core/ui` changed.
- **Extra tests** beyond the plan's list: `boundaries.test.tsx` (loading and error files) and `lib/chat-nav.topbar.test.tsx` (the shipped TopBar with the real catalog, 99+, social off, staff).
- **`InboxRow` already had `previewLeading` and optional case lines** (Phase 12.4 and 12.5), so only `unread`, `avatarSlot`, `label` and `previewMuted` were added, and `awaitingSr` and `blockedLabel` became optional.
- **Back control label** is `chat.member.back` ("Voltar"), not the sketch's "Voltar para o início": plan 18 pins the exact `chat` key set in `i18n/direct-messages.test.ts`, so adding a key would have been a catalog change outside this plan. The name is still a link to `/inicio`.
- **No red run was captured for Task 1's nav and `InboxRow` additions** (the code was written in the same pass; the page and list tests did fail first on the missing modules). Task 2 and Task 3 each ran red first (17 and 7 failures) before the code.
- **The focus-kept assertions cannot discriminate in happy-dom.** I tried to simulate the browser's blur of a moved element (patching `insertBefore`/`appendChild`) and removing the restore line still passed, because happy-dom keeps the focus of a moved subtree. The tests assert the contract (`document.activeElement` is the same row, `scrollTop` unchanged, `window.scrollTo` never called), and the restore itself (`useLayoutEffect` after a merge) is reviewed code. React 19 uses `moveBefore` where it exists, which keeps focus natively (Chrome); Safari and Firefox are where the restore matters and are Igor's real-device check.

**Total deviations:** 2 auto-fixed (both Rule 3). **Impact:** none on scope.

## Issues Encountered

None blocking. Free disk stayed at 17 GiB after each web build (`apps/web/.next/cache` removed each time). Machine load spiked to 11 during the full suite; no test timed out.

## Known Stubs

None. The list, the nav rewrite and the label are wired to the real contracts and tested. `/conversas/{conversationId}` (the row's destination) does not exist yet; plan 22 builds it, so a tap on a direct row lands on the app's not-found until then.

## Threat Flags

None. No new endpoint: the list reads the existing `GET /api/chat/direct`, and the page and the nav follow the permission, never a role (T-11-35, T-11-16, T-11-03 and T-11-17 mitigations are tested above).

## Verification

- Gate `grep -q '^approved: true' .planning/sketches/025-phase-11-designed-screens/README.md` passed before each task; the sketch was only read.
- `pnpm exec vitest run lib/chat-nav.test.ts lib/chat-nav.topbar.test.tsx "app/(app)/conversas" "app/(app)/suporte" components/shell`: 30 files, 524 tests passed. `tests/inbox-row.test.tsx` in `@rede-social/module-chat`: 26 passed.
- `TURBO_CACHE=local:r pnpm turbo test --filter=@rede-social/web --filter=@rede-social/module-chat --concurrency=4`: web 425 files, 10375 tests passed (the Phase 10.2 `EventsSections` flake did not occur); chat module 17 files, 328 tests passed.
- `TURBO_CACHE=local:r pnpm turbo typecheck --filter=@rede-social/web --filter=@rede-social/module-chat --filter=@rede-social/api --concurrency=4`: 5 tasks passed, including the web build (no `node:fs` leak through the contracts index).
- `turbo run lint` (exit 0), `bash scripts/check-ui-literals.sh`, `pnpm boundaries`, `pnpm guard:lanes` and `biome check` on every touched file: clean.
- Acceptance greps: `grep -c "^approved: true"` prints 1; the label-literal grep over `packages/modules/chat/ui` (excluding comment lines) prints 0; `grep -q aria-busy conversas/loading.tsx` passes.
- No database command ran; ROADMAP, STATE and REQUIREMENTS were not touched.

## Next Phase Readiness

Plan 22 (the conversation) and plan 23 (the entry points) can link to `/conversas` and `/conversas/{conversationId}`; `CONVERSATIONS_HREF` is exported from `lib/chat-nav.ts`. Real-device proofs for this plan (VoiceOver/TalkBack phrases of the rows and the bubble, the focus when a row moves in Safari, 320px, the 44px targets) are Igor's, listed in UI-SPEC § Sketch gate.

## Self-Check: PASSED

- Created files exist on disk (`conversas/page.tsx`, `loading.tsx`, `error.tsx`, `ConversationsList.tsx` and the four test files, `lib/chat-nav.ts` and its two tests).
- Commits `375d34b8`, `551b77ae`, `3c83fdca` exist; `git rev-list --count 90fed630..HEAD` was 3 before this SUMMARY.
