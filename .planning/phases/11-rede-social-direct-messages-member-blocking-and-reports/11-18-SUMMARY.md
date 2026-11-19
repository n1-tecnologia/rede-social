---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 18
subsystem: web
tags: [web, view-functions, catalogs, bff, loaders, pt-BR, ungated, D-719, D-722, D-730, D-732, UI-D-860, UI-D-866, UI-D-873, UI-D-874, UI-D-880]

requires:
  - phase: 11-rede-social-direct-messages-member-blocking-and-reports
    provides: "plans 08, 10, 11, 14, 15, 16, 17, 27: the direct chat routes, the Conversas list, the report queue projection, the resolve actions, the profile riders"
provides:
  - "conversationRowView, supportRowView, conversationsPageView: finished Conversas rows (prefix rule, voice previews, 99+ cap, removed member)"
  - "composerStateView, directDetailView, directWithView: the one composer enum as a finished strip; the closed strip is one sentence with no name or block word"
  - "reportSubjectView, reportRowView, resolveRowsFor, reportHref, parseReportEstado: exhaustive over the six subjects with never guards"
  - "fetchDirectList, fetchDirectDetail, fetchDirectWith (lib/chat.ts) and fetchReports (lib/reports.ts) over the strict contracts"
  - "GET /api/chat/direct and GET /api/chat/direct/{conversationId}: same-origin BFF reads returning finished views, no-store"
  - "every Phase 11 sentence as a catalog key: chat.json, social.json, notifications.json, moderation.json and the new safety.json (with the Phase 13 report and block copy), pinned by i18n/direct-messages.test.ts"
affects: [11-19, 11-20, 11-21, 11-22, 11-23, 11-24, 11-25, 11-26]

plan_head_before: de4a8ee0c2a37842be8e351f140e575f43a4b338
actuals:
  tokens: 30000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "finished-view BFF read: sameOriginGet, claims, one forward, view function, no-store, shape-only log"
    - "exhaustive switch over a closed vocabulary with a never assignment guard in every report view function"
    - "one pt-BR sentence per catalog key, the key set and the sentences pinned verbatim by a catalog test with a forbidden-word scan by audience"

key-files:
  created:
    - apps/web/app/api/chat/direct/route.ts
    - apps/web/app/api/chat/direct/[conversationId]/route.ts
    - apps/web/lib/reports.ts
    - apps/web/lib/reports.test.ts
    - apps/web/lib/reports-view.ts
    - apps/web/lib/reports-view.test.ts
    - apps/web/lib/chat-direct.test.ts
    - apps/web/messages/pt-BR/safety.json
    - apps/web/i18n/direct-messages.test.ts
  modified:
    - apps/web/lib/chat.ts
    - apps/web/lib/chat-view.ts
    - apps/web/lib/chat-view.test.ts
    - apps/web/app/api/chat/handlers.test.ts
    - apps/web/messages/pt-BR/chat.json
    - apps/web/messages/pt-BR/social.json
    - apps/web/messages/pt-BR/notifications.json
    - apps/web/messages/pt-BR/moderation.json
    - apps/web/i18n/chat-cases-messages.test.ts
    - apps/web/lib/route-handlers.inventory.ts

key-decisions:
  - "The detail and with views return the composer as ONE finished object ({ state, strip }); a departed account wins over any word, then blocker, then closed (UI-D-865, A-UI-8)"
  - "resolveRowsFor returns { rows, helper }: an open report only, never a disabled row; a community's remove row is kind archive with the Archive glyph and the label Arquivar comunidade; a message gets dismiss and (member author) block with the helper line"
  - "Placeholders follow the UI-SPEC table literally: {nome}, {motivo}, {data} where it writes them, {name}, {tenant}, {count}, {actor} elsewhere"
  - "The Phase 13 removal dialog and resolved toasts live in safety.queue.* (the plan's wording); the Phase 11 resolve rows and the archive dialog live in moderation.report.*"

patterns-established:
  - "A view function takes the translator scoped to its namespace (safety for the subject and queue words, moderation for the resolve rows, chat for the conversation views)"
  - "A view carries no block fact beyond the composer enum: the key set of directDetailView is asserted exactly"

requirements-completed: [CHAT-06, CHAT-07, MODER-04, MODER-05]

coverage:
  - id: D1
    description: "The Conversas list reaches the screens as finished rows (support row pinned, prefix rule, voice previews, 99+ cap, removed member) through one same-origin no-store read that costs zero API calls for a cross-site or anonymous request and one for a good one"
    requirement: CHAT-06
    verification:
      - kind: unit
        ref: "apps/web/lib/chat-view.test.ts#conversationRowView, supportRowView"
        status: pass
      - kind: unit
        ref: "apps/web/app/api/chat/handlers.test.ts#GET /api/chat/direct, direct list shared gates"
        status: pass
      - kind: unit
        ref: "apps/web/lib/chat-direct.test.ts#fetchDirectList"
        status: pass
    human_judgment: false
  - id: D2
    description: "The composer area is one finished enum; the closed strip is the blocked member's one sentence and its whole output has no name, reason or block word"
    requirement: CHAT-07
    verification:
      - kind: unit
        ref: "apps/web/lib/chat-view.test.ts#composerStateView, directDetailView and directWithView"
        status: pass
      - kind: unit
        ref: "apps/web/app/api/chat/handlers.test.ts#GET /api/chat/direct/{conversationId}"
        status: pass
    human_judgment: false
  - id: D3
    description: "The report views map each of the six subjects to its pill, sheet title, privacy line, queue row, own-page href and the legal resolve rows only"
    requirement: MODER-05
    verification:
      - kind: unit
        ref: "apps/web/lib/reports-view.test.ts"
        status: pass
      - kind: unit
        ref: "apps/web/lib/reports.test.ts#fetchReports"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every Phase 11 pt-BR sentence is a catalog key in a host catalog, pinned verbatim with its placeholders, its ICU plurals and the UI-D-860 forbidden-word scan by audience"
    requirement: MODER-04
    verification:
      - kind: unit
        ref: "apps/web/i18n/direct-messages.test.ts"
        status: pass
      - kind: other
        ref: "bash scripts/check-ui-literals.sh"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-11-19
status: complete
---

# Phase 11 Plan 18: Web view functions, loaders, BFF reads and catalogs Summary

**Finished-view layer for every Phase 11 screen: Conversas rows, the one composer enum as a strip, the six-subject report queue views and legal resolve rows, two same-origin BFF reads, and all pt-BR copy as pinned catalog keys.**

## Performance

- **Duration:** about 25 min
- **Tasks:** 3 (one tracer, two auto)
- **Files:** 9 created, 10 modified
- **Commits:** 3 task commits

## Accomplishments

- `GET /api/chat/direct` (page 1 with the pinned support row, later pages without) and `GET /api/chat/direct/{conversationId}` copy the shipped BFF pattern: `sameOriginGet` 403, claims 401, cursor and uuid gates at zero API cost, one forward, finished views, `no-store`, shape-only logs. The strict list and detail schemas refuse any extra key, so a "blocked me" field can never pass through (tested).
- `conversationRowView` and `supportRowView` build the prefix ("Você: " only on the viewer's own, nothing on the other member's, "Equipe: " on the support row), the voice and retired-voice previews (the retired one prints no length), the `99+` cap by integer comparison, the grapheme cut of the text preview and the row's accessible name with the count clause only when unread.
- `composerStateView` returns exactly one of four states by the precedence removed, blocker, closed; the `closed` strip's keys are pinned and a scan proves no name, reason or block word appears in its output.
- `reportSubjectView`, `reportRowView`, `resolveRowsFor` are exhaustive with `never` guards; a community's removal reads "Comunidade arquivada" and its action row "Arquivar comunidade"; a message has no clamp, no link and only dismiss and block; `Ver conteúdo` hrefs are built from the API's `ref`.
- The catalogs carry every sentence of the Copywriting Contract and `safety.json` also owns the Phase 13 report and block copy. `direct-messages.test.ts` pins 120 sentences, the exact key set of each new subtree, the ICU plurals and the forbidden words by audience.

## Task Commits

1. **Task 1 (tracer): Conversas as finished rows through loader, BFF read and view functions** - `411da4d9`
2. **Task 2: composer strips, direct detail read, report views, loader and resolve rows** - `eb2c0568`
3. **Task 3: the catalogs, safety.json and the catalog test, lint and typecheck** - `a7d945fc`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Route-handler inventory lists the two new BFF reads**
- **Found during:** Task 3 (full web suite)
- **Issue:** `lib/route-handlers.inventory.test.ts` fails for any `route.ts` with no entry.
- **Fix:** two `proxies` entries in `lib/route-handlers.inventory.ts`.
- **Commit:** `a7d945fc`

**2. [Rule 3 - Blocking] The shipped chat key-set test excluded the new subtrees**
- **Found during:** Task 3
- **Issue:** `i18n/chat-cases-messages.test.ts` pins the exact `chat` key set and went red on the new keys (a test outside the plan's files).
- **Fix:** the filter now skips `conversations.*`, `direct.*`, `navConversations` and `navConversationsBadge`, which `direct-messages.test.ts` pins; no sentence of the shipped test changed.
- **Commit:** `a7d945fc`

**3. [Rule 1 - Plan inconsistency] Unread 120 cannot cross the BFF**
- **Issue:** the plan's Test 1 names an unread count of 120 through the handler, but the strict contract caps `unreadCount` at 100 (`DIRECT_UNREAD_CAP`) and would refuse 120.
- **Fix:** the handler test uses 100 (the server cap) and prints `99+`; the pure `conversationRowView` test covers 99, 100 and 120.

**4. [Rule 2 - Test coverage] Loader tests were not written in Task 1**
- **Issue:** Task 1's Test 3 (a 404 throws the typed error, a non-conforming answer is refused) was not in the Task 1 commit.
- **Fix:** `lib/chat-direct.test.ts` (and `lib/reports.test.ts`) landed with Task 2; they pass against the Task 1 loaders unchanged.

**Total deviations:** 4 (2 Rule 3, 1 Rule 1, 1 Rule 2). **Impact:** none on scope.

### Notes on process

- Task 1 tests and code were written before the first run, so a red run was not captured for the tracer. Task 2 and Task 3 both ran red first (missing modules, then 87 missing catalog keys).
- Two small catalog additions the contract does not spell out: `chat.conversations.error.more` ("Não foi possível carregar mais conversas.", the inline retry line of UI-D-863, worded like the shipped inbox one) and the `conversations.row.labelRead`/`supportLabel*` name variants (the row name without the count clause).
- pt-BR plural rules read 0 as the singular, so the bubble and row names for 0 say "0 conversa" and "0 mensagem nova"; the views never format a count of 0 (no clause when read).

## Known Stubs

None. Every function is wired to a real contract and tested; no screen consumes them yet (plans 19 to 26).

## Threat Flags

None. The two BFF reads are gated exactly as the shipped ones (T-11-33, T-11-06 tested: non-uuid id answers 404 at zero cost, cross-site 403, anonymous 401).

## Verification

- `pnpm --filter @rede-social/web exec vitest run lib/chat-view.test.ts app/api/chat/handlers.test.ts` (Task 1) passed; Task 2 and Task 3 verify commands passed.
- `TURBO_CACHE=local:r pnpm turbo test --filter=@rede-social/web --concurrency=4`: 420 files, 10323 tests passed (the Phase 10.2 `EventsSections` flake did not occur in the final run).
- `TURBO_CACHE=local:r pnpm turbo typecheck --filter=@rede-social/web --filter=@rede-social/api --concurrency=4`: 4 tasks passed.
- `TURBO_CACHE=local:r pnpm turbo build --filter=@rede-social/web --concurrency=4` passed (no `node:fs` leak); `apps/web/.next/cache` removed after.
- `bash scripts/check-ui-literals.sh`, `pnpm boundaries`, `pnpm guard:lanes`, turbo lint for web and `biome check` on every touched file: clean.
- Acceptance greps (`conversationRowView`, `composerStateView`, `resolveRowsFor`, `safety.json` single root, route file) pass.
- Free disk after the build: 16 GiB. No database command ran; ROADMAP, STATE and REQUIREMENTS untouched.

## Next Phase Readiness

Plans 19 to 26 can build the screens from finished facts: `conversationsPageView` for the list, `directDetailView`/`directWithView` for the thread header and strip, `reportSubjectView` for the report sheet titles, `reportRowView` and `resolveRowsFor` for the queue, the `safety.*`, `chat.conversations.*`, `chat.direct.*`, `social.profile.*` and `moderation.report.*` keys for every word.

## Self-Check: PASSED

- Created files exist on disk (route handlers, reports and reports-view with tests, chat-direct test, safety.json, direct-messages test).
- Commits `411da4d9`, `eb2c0568`, `a7d945fc` exist; `git rev-list --count de4a8ee0..HEAD` was 3 before this SUMMARY.
