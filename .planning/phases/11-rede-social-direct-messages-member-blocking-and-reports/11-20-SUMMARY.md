---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 20
subsystem: web
tags: [web, report-and-block, report-sheet, block-dialog, blocked-list, ui-gated, sketch-025, D-616, D-722, D-724, D-733, UI-D-632, UI-D-633, UI-D-634, UI-D-635, UI-D-869, UI-D-871, UI-D-872]

requires:
  - phase: 11-rede-social-direct-messages-member-blocking-and-reports
    provides: "plan 02 (approved sketch 025), plan 15 (canReport and canBlock riders), plan 18 (reportSubjectView, safety catalog), plan 27 (membership-keyed block routes)"
provides:
  - "CommentItem 'Mais acoes do comentario' menu (props only) and the PostMenu report and block rows"
  - "ReportAndBlock: the report sheet for every subject and the block dialog with its two bodies; useReportAndBlock hook"
  - "reportContent, blockMember, unblockMember, unblockBlocked, loadMoreBlocked server actions with closed result codes"
  - "lib/blocks.ts loader and /configuracoes/bloqueados (page, list, loading) plus the settings row"
affects: [11-22, 11-23, 11-24, 11-25]

plan_head_before: 31d75557a2c7047b891b73f67edb5e4210c53f62
actuals:
  tokens: 35500
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A module menu draws a safety row only when its API rider, its label and its host callback are all present; the report sheet and the block dialog are the host's, so no string lives in packages/modules"
    - "A client host takes the server actions as props (menu.safety.reportAction and blockAction) like onLike and onDelete, which keeps lib/api and its env out of client component tests"
    - "Optional module labels: an absent moreActions label keeps the shipped direct delete control, so hosts that have not adopted the menu are unchanged"

key-files:
  created:
    - packages/modules/feed/ui/MenuRow.tsx
    - apps/web/components/feed/ReportAndBlock.tsx
    - apps/web/components/feed/ReportAndBlock.test.tsx
    - apps/web/components/feed/safety-actions.ts
    - apps/web/components/feed/safety-actions.test.ts
    - apps/web/lib/blocks.ts
    - apps/web/lib/blocks.test.ts
    - apps/web/app/(app)/configuracoes/bloqueados/page.tsx
    - apps/web/app/(app)/configuracoes/bloqueados/BlockedList.tsx
    - apps/web/app/(app)/configuracoes/bloqueados/BlockedList.test.tsx
    - apps/web/app/(app)/configuracoes/bloqueados/loading.tsx
    - apps/web/app/(app)/configuracoes/bloqueados/page.test.tsx
    - apps/web/app/(app)/configuracoes/page.blocked-row.test.tsx
  modified:
    - packages/modules/feed/ui/CommentItem.tsx
    - packages/modules/feed/ui/CommentsList.tsx
    - packages/modules/feed/ui/FeedList.tsx
    - packages/modules/feed/ui/PostCard.tsx
    - packages/modules/feed/ui/PostMenu.tsx
    - packages/modules/feed/tests/comments-removal.test.tsx
    - packages/modules/feed/tests/post-menu.test.tsx
    - packages/modules/feed/tests/feed-list-member-menu.test.tsx
    - apps/web/components/feed/FeedSurface.tsx
    - apps/web/components/feed/PostDetail.tsx
    - apps/web/lib/feed-view.tsx
    - apps/web/lib/registry.tsx
    - apps/web/app/(app)/post/[postId]/page.tsx
    - apps/web/app/(app)/comunidades/[communityId]/page.tsx
    - apps/web/app/(app)/comunidades/[communityId]/page.test.tsx
    - apps/web/app/(app)/configuracoes/page.tsx
    - packages/core/ui/nav.ts
    - packages/core/tests/nav.test.ts

key-decisions:
  - "The comment menu is the control only when the host passes labels.moreActions; without it the row keeps the shipped direct delete button, so the story and Reels hosts (which build their own label blocks, plan 24 for stories) are unchanged until they opt in"
  - "Hosts opt a posts surface in through menu.safety = { socialOn, reportAction, blockAction } (built by postMenuSafety in lib/registry.tsx); the block dialog body is chosen from the composed social.participate permission, never a role"
  - "The server actions travel as props, not imports, so FeedSurface and PostDetail tests stay unchanged and no client file imports lib/api"
  - "ConfirmDialog closes on settle by design, so a failed block raises the shipped error toast and releases the dialog; the member reopens it from the menu"
  - "Block and unblock revalidate the root layout on a real change so the blocked member's items leave every list at once (D-725: no other filter)"

patterns-established:
  - "useReportAndBlock({ tenantName, safety }) returns { element, menuLabels, commentLabels, onReportPost, onReportComment, onBlockPost, onBlockComment }: plans 22, 23, 24 and 25 reuse it by passing their own subjectType"

requirements-completed: [MODER-05, CHAT-07]

coverage:
  - id: D1
    description: "A member opens a comment's menu, taps Denunciar comentario, chooses a reason and sends once; the sheet shows Enviando..., closes and toasts the success sentence; no note is sent when none was written"
    requirement: MODER-05
    verification:
      - kind: unit
        ref: "apps/web/components/feed/ReportAndBlock.test.tsx#the path of 11-20 Task 1 and the report sheet describe"
        status: pass
      - kind: unit
        ref: "apps/web/components/feed/safety-actions.test.ts#reportContent"
        status: pass
    human_judgment: false
  - id: D2
    description: "The module menus (post and comment) draw Denunciar and Bloquear only from the riders, keep the delete row last with its data hooks, show only the delete row on the viewer's own comment and hold no label literal"
    requirement: MODER-05
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/comments-removal.test.tsx#the Mais acoes do comentario menu"
        status: pass
      - kind: unit
        ref: "packages/modules/feed/tests/post-menu.test.tsx#the report and block rows"
        status: pass
      - kind: unit
        ref: "packages/modules/feed/tests/feed-list-member-menu.test.tsx#the report and block rows follow the post riders"
        status: pass
    human_judgment: false
  - id: D3
    description: "The block dialog has two bodies chosen from the social.participate permission, wraps a 40-character name, blocks once by membership id, toasts once and shows the shipped error toast on any failure"
    requirement: CHAT-07
    verification:
      - kind: unit
        ref: "apps/web/components/feed/ReportAndBlock.test.tsx#the block dialog"
        status: pass
      - kind: unit
        ref: "apps/web/components/feed/safety-actions.test.ts#blockMember, unblockMember and unblockBlocked"
        status: pass
    human_judgment: false
  - id: D4
    description: "Membros bloqueados: the settings row under Editar perfil (absent on the platform host), the page, the list with one-tap unblock, keyset paging, empty state and failure states"
    requirement: CHAT-07
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/bloqueados/BlockedList.test.tsx"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/page.blocked-row.test.tsx"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/bloqueados/page.test.tsx"
        status: pass
    human_judgment: false
  - id: D5
    description: "E7 overflow (held-out visual check): the voice-message sheet with a 500-character note and its counter stays inside the sheet and keeps the send button reachable at 320px"
    verification: []
    human_judgment: true
    rationale: "A layout fact at 320px that happy-dom cannot measure; the sheet scrolls inside the shipped BottomSheet body (80% height cap) but no browser run was made. Backstop row of the plan."
  - id: D6
    description: "The comment menu replaces the direct delete control in the real hosts (feed sheet, post page, community page, Reels), so the Playwright specs that click [data-comment-delete] directly need a first tap on the new control"
    verification: []
    human_judgment: true
    rationale: "e2e specs (feed-comments, moderation, phase8-smoke) were not run or edited: no stack was started. They are owed an update before the next e2e run."

duration: 21min
completed: 2026-11-19
status: complete
---

# Phase 11 Plan 20: Report and block screens Summary

**One report sheet for every subject, the block dialog with its two bodies chosen from the social.participate permission, the post and comment menus fed by the API riders, and the Membros bloqueados page with one-tap unblock; no word lives in packages/modules.**

## Performance

- **Duration:** about 21 min (21:51 to 22:12, 2026-11-19)
- **Tasks:** 3 (one tracer, two auto)
- **Files:** 13 created, 18 modified
- **Commits:** 3 task commits

## Accomplishments

- `CommentItem`'s single trash button became the `Mais acoes do comentario` menu (an `Ellipsis` `IconButton` opening the shipped `BottomSheet`): `Denunciar comentario`, `Bloquear {nome}` and the destructive delete row last, keeping `data-comment-delete` and `data-comment-removal`. Every label and callback is a prop; the stale comment predicting this menu is rewritten. `PostMenu` gained the same two rows above its delete rows. `MenuRow` is now one shared file.
- `ReportAndBlock` owns the report sheet for the six subjects (title and a message's privacy line from `reportSubjectView`, five reasons as a radio group, optional 500-character note with its counter, `Enviando...` with locked fields and an unclosable sheet, success, already reported and unavailable as toasts with the sheet closing, any other failure as the alert block with the choices kept) and the block dialog. `useReportAndBlock` is the hook the other plans reuse.
- `reportContent`, `blockMember`, `unblockMember`, `unblockBlocked` and `loadMoreBlocked` are server actions that parse with the API's own Zod before the request and answer closed codes, never an API message. A real block change revalidates the root layout so the blocked member's items leave the lists.
- `/configuracoes/bloqueados`: server page (not found on the platform host), `BlockedList` (avatar, name or `Membro removido`, outline `Desbloquear` with `Desbloqueando...`, keyset paging by 20, empty state, failure states), `loading.tsx`, and the settings row under `Editar perfil` (a `ban` glyph added to the core nav icon map).

## Task Commits

1. **Task 1: report a comment or a post from its menu (tracer)** - `12f56b26` (feat)
2. **Task 2: the block dialog with its two bodies and the Bloquear rows** - `d62f4057` (feat)
3. **Task 3: Membros bloqueados** - `e912f222` (feat)

**Plan metadata:** the docs commit that carries this file.

## Files Created/Modified

See the frontmatter `key-files`. Shipped tests changed, each named with its reason:

- `packages/modules/feed/tests/comments-removal.test.tsx`, `post-menu.test.tsx`, `feed-list-member-menu.test.tsx`: only new `describe` blocks were appended; no shipped assertion changed (the legacy single-control path is kept for a host without `moreActions`, test M7).
- `apps/web/app/(app)/comunidades/[communityId]/page.test.tsx`: the `@/lib/registry` mock gained `postMenuSafety: () => undefined`, because the page now calls it (one line).
- `packages/core/tests/nav.test.ts`: one assertion for the new `ban` icon name.
- `FeedSurface.test.tsx` and `PostDetail.test.tsx` pass UNCHANGED.

## Decisions Made

See `key-decisions`. In short: the menu is adopted by a host through `labels.moreActions` (backwards compatible), the opt-in of a posts surface is `menu.safety` built from the composed permission, and the actions travel as props.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Icon for the settings row**
- **Found during:** Task 3
- **Issue:** the `Ban` glyph was not in the core nav icon map (`iconFor('ban')` fell back to the grid icon), and the file is outside the plan's `files_modified`.
- **Fix:** added `ban: Ban` to `ICONS` in `packages/core/ui/nav.ts` and one assertion in `packages/core/tests/nav.test.ts`.
- **Verification:** `packages/core` suite 116 files / 1858 tests green.
- **Committed in:** `e912f222`

**2. [Rule 3 - Blocking] Registry and two page files carry the opt-in**
- **Found during:** Task 1
- **Issue:** with no host passing `menu.safety`, no member would ever see the new rows; `lib/registry.tsx`, `/post/[postId]/page.tsx` and the community page are not in the plan's file list.
- **Fix:** `postMenuSafety(bootstrap)` in `lib/registry.tsx` and one `safety:` line in each of the three `menu` objects; one mock line in the community page test.
- **Committed in:** `12f56b26`

**3. [Rule 3 - Blocking] Server actions as props**
- **Found during:** Task 1
- **Issue:** importing `safety-actions` into `FeedSurface` and `PostDetail` loaded `lib/api` and its env validation in their shipped tests (`Invalid environment variables`), and the acceptance criterion says those tests pass unchanged.
- **Fix:** the actions travel through `menu.safety` like `onLike` and `onDelete`; the client files import only their types.
- **Committed in:** `12f56b26`

**4. [Process] Tests written beside the code, not strictly before it**
- Tasks 1 and 2 were implemented and their tests written in the same pass, then run green; the plan's "see them fail first" step was not performed as a separate run. Coverage asserts the plan's behaviours (listed in `coverage`).

---

**Total deviations:** 3 auto-fixed (3 blocking) plus 1 process note.
**Impact on plan:** all necessary to make the entries reachable and keep the shipped tests unchanged; no scope creep.

## Issues Encountered

- Plan Task 2 wording "keep the dialog usable" after a failure: the shipped `ConfirmDialog` always closes when its action settles, so a failed block closes the dialog with the error toast and the member reopens it from the menu. No change to the shared primitive was made.
- `CANNOT_BLOCK`, the rate limit, a lost session and a lost network are all the same shipped error toast by design (the API's one refusal names no reason).

## Gates Run

- `pnpm lint` (turbo lint, `check-ui-literals.sh`, dashboard fixtures): green, run after each task and at the end.
- `pnpm --filter module-feed` vitest: 27 files / 362 tests; `tsc --noEmit` clean.
- Whole web suite through turbo (`TURBO_CACHE=local:r --concurrency=4`): 431 files / 10461 tests green (the flaky `EventsSections.test.tsx` did not trip, no rerun needed).
- `pnpm turbo typecheck` for web, module-feed and core (this runs `next build`, so a `node:fs` leak through the contracts index would fail it): green.
- `pnpm boundaries`: no issues in 2681 files. `pnpm guard:lanes`: OK. `biome check` on every touched file: clean.
- Not run: Playwright (no stack started), API integration suites (no API change), `pnpm db:reset` and `pnpm db:seed` (never). No `supabase` command was issued.

## Known Stubs

None. Every control is wired to its server action; the only null paths are the opt-in absences described above.

## Threat Flags

None: the plan adds no endpoint; the new server actions call routes the API already guards, validate before the request and return closed codes. T-11-03, T-11-16, T-11-36 and T-11-17 are mitigated as in the register (no sentence implies a notice, every member string is React text, the rows follow the riders, the sketch guard passed at the start of every task).

## User Setup Required

None - no external service configuration required.

## Owed outside this plan

- Playwright specs `apps/web/e2e/feed-comments.spec.ts`, `moderation.spec.ts` and `phase8-smoke.spec.ts` click `[data-comment-delete]` directly; with the menu adopted by the real hosts they need a first tap on `[data-comment-more]` (which also carries `data-comment-removal`). They were not edited or run here.
- The backstop row (the voice-message sheet at 320px) and a real-device pass of the new sheets are for a browser run.

## Next Phase Readiness

Plans 22, 23, 24 and 25 reuse `ReportAndBlock` through `useReportAndBlock` (pass their own `subjectType`, `voice` for a voice message) and the same `CommentItem` serves story comments with the subject passed by the host.

## Self-Check: PASSED

All created files exist, the three task commits exist, the sketch guard prints 1, no commit carries a Co-Authored-By line, and `grep -rn "Denunciar\|Bloquear" packages/modules/feed/ui` outside comments prints 0.

---
*Phase: 11-rede-social-direct-messages-member-blocking-and-reports*
*Completed: 2026-11-19*
