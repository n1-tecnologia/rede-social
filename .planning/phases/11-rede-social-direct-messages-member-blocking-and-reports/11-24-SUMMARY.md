---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 24
subsystem: web
tags: [web, story-menu, story-comment-menu, community-menu, report-entries, ui-gated, sketch-025, D-616, D-733, UI-D-701, UI-D-869, AD-1, AD-8]

requires:
  - phase: 11-rede-social-direct-messages-member-blocking-and-reports
    provides: "plan 02 (approved sketch 025), plan 15 (canReport and canBlock riders on stories, story comments and communities), plan 18 (safety catalog), plan 20 (ReportAndBlock, useReportAndBlock, reportContent and blockMember), plan 27 (membership-keyed block)"
provides:
  - "The story viewer's Mais opcoes control and the sheet Opcoes do story for every viewer of someone else's story: Denunciar story and Bloquear {nome} above Excluir story, from the riders"
  - "The story comment sheet's menu (the shared CommentItem) wired with the subject story_comment and a list re-read after a block"
  - "CommunityMenu: the header's Mais opcoes da comunidade control and the sheet Opcoes da comunidade (Denunciar comunidade, Bloquear {nome}), absent for the creator, the locked page, an archived community and not-found"
  - "CommunityHeader's action slot as a props-only flex cluster"
affects: [11-25, 11-26]

plan_head_before: 1e9b46ec
actuals:
  tokens: 18100
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A viewer or page opts into the safety rows through the binding it already receives (storyCommentsProps carries postMenuSafety and the tenant name); the rows follow the item's riders, the opt-in only decides whether the sheet and dialog exist"
    - "useReportAndBlock is generic: commentSubject picks post_comment or story_comment, openReport and openBlock take any target, open tells a clocked host to pause"
    - "An overlay opened from inside a z-10 stacking context (the header's action cluster) is portalled to document.body, the profile trigger's idiom"

key-files:
  created:
    - apps/web/app/(app)/comunidades/[communityId]/CommunityMenu.tsx
    - apps/web/app/(app)/comunidades/[communityId]/CommunityMenu.test.tsx
    - apps/web/app/(app)/comunidades/[communityId]/page.safety-menu.test.tsx
  modified:
    - apps/web/components/stories/StoryViewerHost.tsx
    - apps/web/components/stories/StoryViewerHost.test.tsx
    - apps/web/components/feed/ReportAndBlock.tsx
    - apps/web/lib/story-view.ts
    - apps/web/lib/story-view.test.ts
    - apps/web/lib/registry.tsx
    - apps/web/app/(app)/comunidades/[communityId]/page.tsx
    - packages/modules/communities/ui/CommunityHeader.tsx
    - packages/modules/communities/tests/community-page-ui.test.tsx

key-decisions:
  - "The safety opt-in (PostMenuSafety and the tenant name) rides in the StoryCommentsBinding built by storyCommentsProps, so none of the four story hosts (Inicio, Explorar, the community page, the story deep link) needed an edit; a viewer with no comments binding draws no safety row"
  - "A successful block bumps an epoch that remounts the story CommentSheet, so its list is read again and the blocked member's comments leave it (the filter of plan 05 does the hiding); a failed block re-reads nothing"
  - "The community menu is mounted from viewer.canReport and community.createdBy only on the active, readable page; the locked branch builds its own plain header, an archived community passes menuNode null, not-found throws before a header exists"
  - "StoryMenuRow (the story viewer's row, itself the product's one menu geometry) is reused for the community sheet instead of a second row component"

patterns-established:
  - "useReportAndBlock({ tenantName, safety, commentSubject }) returns openReport, openBlock and open besides the post and comment callbacks: plan 25 and later hosts reuse it for any subject"

requirements-completed: [MODER-05, MODER-04, CHAT-07]

coverage:
  - id: D1
    description: "A plain member sees Mais opcoes on another member's story, opens Opcoes do story with Denunciar story and Bloquear {nome}, reports it once with subject story, and the viewer's clock stays paused through the sheet, the report sheet and the dialog"
    requirement: MODER-05
    verification:
      - kind: unit
        ref: "apps/web/components/stories/StoryViewerHost.test.tsx#S1 to S3"
        status: pass
    human_judgment: false
  - id: D2
    description: "Who sees what on a story: the author sees neither new row, an organization story only Denunciar, staff never Bloquear, a moderator both rows above Excluir story, riders absent or no opt-in draws no control, a story with no caption reports normally"
    requirement: MODER-05
    verification:
      - kind: unit
        ref: "apps/web/components/stories/StoryViewerHost.test.tsx#S4 to S8"
        status: pass
      - kind: unit
        ref: "apps/web/lib/story-view.test.ts#37b"
        status: pass
    human_judgment: false
  - id: D3
    description: "The story comment menu: Denunciar comentario and Bloquear {nome} per the comment's riders, the viewer's own comment only its delete row, staff never Bloquear, the report sends story_comment (never post_comment), a block sends the membership id and re-reads the list without the blocked member, the dialog body follows social.participate"
    requirement: CHAT-07
    verification:
      - kind: unit
        ref: "apps/web/components/stories/StoryViewerHost.test.tsx#C1 to C7"
        status: pass
    human_judgment: false
  - id: D4
    description: "The community header menu: the action slot is a flex cluster (pencil then ellipsis, 44px each, after the back control), the control opens Opcoes da comunidade with Denunciar comunidade and Bloquear {nome}, reports with subject community, works with social on or off, and is absent for the creator, the locked page, an archived community and not-found"
    requirement: MODER-05
    verification:
      - kind: unit
        ref: "packages/modules/communities/tests/community-page-ui.test.tsx#7c and 7d"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/comunidades/[communityId]/CommunityMenu.test.tsx"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/comunidades/[communityId]/page.safety-menu.test.tsx"
        status: pass
    human_judgment: false
  - id: D5
    description: "Real-device and browser look of the three menus: the story sheet over the dark viewer at 320px, the 44px ellipsis chip beside the pencil on a photographic cover, the community sheet and report sheet stacking over the app chrome (the portal), and the long-name wrapping of Bloquear {nome}"
    verification: []
    human_judgment: true
    rationale: "Layout, stacking and contrast facts that happy-dom cannot measure; no browser or Playwright run was made (plan 26 owns the e2e specs)"

duration: 25min
completed: 2026-11-20
status: complete
---

# Phase 11 Plan 24: Report and block entries on stories, story comments and communities Summary

**Stories, story comments and the community header now offer Denunciar and Bloquear from the API riders only, over plan 20's shared report sheet and block dialog, with the viewer's clock paused and the community control absent for its creator, the locked page, an archived community and not-found.**

## Performance

- **Duration:** about 25 min
- **Completed:** 2026-11-20
- **Tasks:** 3 (one tracer, two auto)
- **Files:** 3 created, 9 modified
- **Commits:** 3 task commits

## Accomplishments

- **Story menu.** `Mais opcoes` in the viewer's header now renders whenever the sheet would hold a row: the author, curator and moderator rows as before, plus `Denunciar story` (`canReport`) and `Bloquear {nome}` (`canBlock`, named from the story's member author) for any viewer. They sit above the destructive `Excluir story`, which now appears only for a role. Choosing one closes the sheet and opens `ReportAndBlock` in the same batch; `useReportAndBlock` exposes `open`, so the viewer's `externallyPaused` covers the report sheet and the block dialog and the clock never restarts in between.
- **Story comments.** The story comment sheet is the feed's `CommentItem`; the host now feeds it the riders (`storyCommentView` copies `canReport`, `canBlock` and the author's membership id), the three menu labels and `onReportComment` and `onBlockComment` from a hook created with `commentSubject: 'story_comment'`. A successful block bumps an epoch that remounts the sheet, so the list is read again without the blocked member.
- **Community menu.** `CommunityHeader`'s action slot became a props-only flex cluster (8px gap); `CommunityMenu` (client) draws the 44px `Ellipsis` chip and the sheet `Opcoes da comunidade`, portalled to `document.body`, over the same shared sheet and dialog with subject `community`. The page mounts it from `viewer.canReport` and `viewer.canBlock` (the creator as block target, member communities only), beside the edit pencil, on an active readable community only.
- No new catalog key: every word was already in `safety.json` and `stories.json`. No string was added to `packages/modules`.

## Task Commits

1. **Task 1: story menu for every viewer (tracer)** - `aba7586f` (feat). This commit also carries the story comment wiring (host, hook options, registry opt-in, `storyCommentView` riders), because the host file is shared.
2. **Task 2: story comment menu tests and the stable motion stand-in** - `221d3471` (test)
3. **Task 3: community header menu** - `62c0c93c` (feat)

**Plan metadata:** the docs commit that carries this file.

## Files Created/Modified

See the frontmatter. Shipped tests touched, each with its reason:

- `StoryViewerHost.test.tsx`: the `next-intl` stand-in now answers the `safety` and `feed` namespaces from their own real catalogs (every other namespace is the stories catalog, as before), and the `motion/react` stand-in keeps ONE component per tag (it built a fresh `forwardRef` on every access, so any host render remounted a sheet's subtree and a list inside a sheet re-read itself). Every shipped case passes unchanged.
- `page.test.tsx` (community) and every other shipped test: untouched and green.

## Decisions Made

See `key-decisions`. The opt-in travelling in the comment binding is the one structural choice: it kept four host call sites (Inicio, Explorar, the community page and the story deep link) unedited, at the price that a viewer with no comment binding offers no report entry (every real host passes one).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Files outside `files_modified` were edited**
- **Found during:** Task 1
- **Issue:** the entries need data and a hook that the plan's file list does not hold: `StoryViewerItemView` had no riders or author (`apps/web/lib/story-view.ts`), `useReportAndBlock` was post-and-comment only (`apps/web/components/feed/ReportAndBlock.tsx`), and no host passed the opt-in (`apps/web/lib/registry.tsx`, `storyCommentsProps`).
- **Fix:** `storyViewerItem` copies `canReport`, `canBlock` and the member author only when present; `storyCommentView` copies the riders and the membership id; `useReportAndBlock` gained `commentSubject`, `openReport`, `openBlock` and `open`; `storyCommentsProps` returns `safety` and `tenantName`. `StoriesSurface.tsx` and `StoryMenuRow.tsx`, which the plan listed, needed no edit.
- **Verification:** `story-view.test.ts` 37b, the whole web suite, typecheck.
- **Committed in:** `aba7586f`

**2. [Rule 1 - Test double] The `motion` stand-in remounted sheets on every render**
- **Found during:** Task 2
- **Issue:** asserting that a failed block does not re-read the comment list failed with 3 reads: not a product bug, the stand-in made a new component type per access.
- **Fix:** one cached component per tag (the real `motion.div` is stable); all 61 shipped cases of the file still pass.
- **Committed in:** `221d3471`

**3. [Process] Tests written beside the code**
- The plan asks for failing tests first. Tasks 1 and 2 were implemented and their tests written in the same pass (as in plan 20), then run green; the red run was not performed as a separate step. Task 3's module cluster test and the menu tests were written after the header and menu files.

**4. [Plan reading] Task 2's code landed in Task 1's commit**
- The host file is one component, so the comment wiring is in `aba7586f`; Task 2's own commit is its test suite and the stand-in fix.

**5. [Addition] `page.safety-menu.test.tsx`**
- The plan lists `CommunityMenu.test.tsx` only; the absence on the locked, archived and not-found pages is a page fact, so a new page-level test file was added beside the untouched `page.test.tsx`.

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 test double), 3 process or scope notes.
**Impact on plan:** none on behavior; the extra files are the minimal path for the riders and the opt-in to reach the three surfaces.

## Issues Encountered

- `EventsSections.test.tsx` (Phase 10.2 flake) did not trip in the full web run; no rerun was needed.
- The row menu of a story comment has no title, so its tests find it as the newest dialog on the page; a title would be a copy change outside this plan.

## Gates Run

- `pnpm lint` (turbo lint, `check-ui-literals.sh`, dashboard fixtures) after each task: green.
- Story, feed and community component tests: `components/stories` and `components/feed` 222 tests; `app/(app)/comunidades` 13 files / 169 tests; `module-feed` `comment-panel` and `comments-removal` 28 tests; `module-communities` whole suite 11 files / 93 tests.
- Whole web suite through turbo (`TURBO_CACHE=local:r`, `--concurrency=4`), which includes the catalog and message-parity tests: 442 files / 10636 tests green.
- `turbo typecheck` for web (`next typegen`, `next build`, `tsc`), `module-communities`, `module-stories`, `api` and `module-feed`: green; the build shows no `node:fs` leak.
- `pnpm boundaries`: no issues in 2703 files. `pnpm guard:lanes`: OK. `biome check` on every touched path: clean.
- Not run: Playwright (plan 26), API integration suites (no API change), `pnpm db:reset`, `pnpm db:seed`; no `supabase` command was issued. `.next/cache` was removed after each build; free disk stayed at 16 GiB.

## Known Stubs

None. Every control is wired to plan 20's actions; the only absences are the opt-in and rider absences described above.

## Threat Flags

None: no endpoint, auth path or schema was added. T-11-36 is mitigated (rows follow `canReport` and `canBlock`, tests for the author, an organization story, staff, the creator, the locked, archived and not-found states), T-11-03 (the shared success sentence, no screen implies a notice to the author or creator), T-11-16 (names only as React text, labels and `aria-label`), T-11-17 (the sketch guard printed 1 at the start of every task).

## User Setup Required

None - no external service configuration required.

## Owed outside this plan

- A real-device and browser pass of the three menus (see coverage D5), and the Playwright specs that touch the same menus (plan 26).

## Next Phase Readiness

Plan 25 and later hosts reuse `useReportAndBlock` through `openReport` and `openBlock` with their own subject; nothing here blocks them.

## Self-Check: PASSED

The three commits exist (`aba7586f`, `221d3471`, `62c0c93c`), `CommunityMenu.tsx`, `CommunityMenu.test.tsx` and `page.safety-menu.test.tsx` exist, the sketch guard prints 1, `grep -rn "Mais opções\|Denunciar" packages/modules/communities/ui` outside comments prints 0, and no commit of this plan carries a Co-Authored-By line.

---
*Phase: 11-rede-social-direct-messages-member-blocking-and-reports*
*Completed: 2026-11-20*
