---
phase: 10-rede-social-member-stories-and-communities
plan: 12
subsystem: web
tags: [member-stories, web, explorar-row, story-composer, viewer-menus, highlight-checklist, tracer, escopo-seam, UI-D-697, UI-D-698, UI-D-699, UI-D-700, UI-D-701, UI-D-702, UI-D-703, UI-D-704, UI-D-705, D-704, D-714, D-715, D-716, D-717]

requires:
  - phase: 10-02
    provides: "the sketch 020 review gate (approved: true, provisional, D-33)"
  - phase: 10-06
    provides: "the communities list wire with kind, createdBy and viewer.actions (the Escopo seam) and memberQuota"
  - phase: 10-07
    provides: "the story wire with authorUserId nullable and author { membershipId, displayName, avatarUrl }; the member publish and delete"
  - phase: 10-08
    provides: "GET /v1/stories/authors and /authors/{membershipId} (the Explorar row reads)"
  - phase: 10-09
    provides: "the highlight owner seam: a member's catalog, checklist and publish destination"
  - phase: 10-11
    provides: "the web foundations (catalogs, member-community post wording)"
  - phase: 10-13
    provides: "the communities list loader carrying viewer.actions whole, memberQuota"
provides:
  - "Explorar's story row (member: own circle with the + badge or the open state, then followed authors; moderator: every member's circle, paged 20 at a time with trailing skeletons and a Recarregar retry circle), between the chips and the feed, never the reason Explorar errors"
  - "the lazy author groups in the grouped viewer: read when the circle is tapped, resumed at the first unseen story, the ring and the accessible name greyed on close from the session's seen set"
  - "the viewer's Mais opcoes over member groups (the author's three rows, the moderator's one) with two delete copy variants; no ring and no Destacar pill anywhere else"
  - "the member publish screen: tenant limits helper, video row absent when off, ready-gated video, audience line, destination groups from viewer.actions.story, the visibility notice in two tones, the 403 refusals"
  - "the highlight checklist in member mode: notice above the groups and a brand confirm once per opening of the sheet"
  - "Seus stories for a member: owned-community-only Destacar, the author's delete copy, the Explorar empty state"
  - "Inicio's publish circle needs content.publish as well (Pitfall 12)"
affects: [10-14, 10-15]

actuals:
  tokens: 44000
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "Row builders (memberStoriesRow, moderatorStoriesRow, appendAuthors) are pure functions in lib/story-view.ts, used by the server for the first page and by the client for the moderator's next pages, so the two can never disagree about a circle or a group number"
    - "A lazy group is read BEFORE the viewer opens when the resume index depends on its items (author circles); a failed read opens the viewer on the group's error frame and its retry"
    - "The module sheet takes a `notice` node and a `confirmOn` copy object: the module ships no words, the host owns them, and a switch-on gate (`onBeforeOn`) keeps the optimistic machine untouched"
    - "The destination decision of the publish page reads viewer.actions.story and nothing else (the Escopo seam), proved by fixtures where it and the owner flag disagree"

key-files:
  created:
    - apps/web/app/(app)/inicio/ExplorarStoriesRow.tsx
    - apps/web/app/(app)/inicio/ExplorarStoriesRow.test.tsx
    - apps/web/components/stories/StoryVisibilityNotice.tsx
    - apps/web/lib/registry.test.tsx
    - apps/web/app/(app)/stories/publicar/page.test.tsx
    - apps/web/app/(app)/stories/meus/StoryHistoryList.test.tsx
  modified:
    - apps/web/app/(app)/inicio/ExplorarBody.tsx
    - apps/web/app/(app)/inicio/ExplorarSkeleton.tsx
    - apps/web/app/(app)/inicio/page.tsx
    - apps/web/app/(app)/stories/story-actions.ts
    - apps/web/app/(app)/stories/highlight-actions.ts
    - apps/web/app/(app)/stories/publicar/StoryComposer.tsx
    - apps/web/app/(app)/stories/publicar/page.tsx
    - apps/web/app/(app)/stories/meus/page.tsx
    - apps/web/app/(app)/stories/meus/StoryHistoryList.tsx
    - apps/web/components/stories/StoriesSurface.tsx
    - apps/web/components/stories/StoryViewerHost.tsx
    - apps/web/lib/stories.ts
    - apps/web/lib/story-view.ts
    - apps/web/lib/registry.tsx
    - apps/web/lib/communities.ts
    - apps/web/messages/pt-BR/stories.json
    - apps/web/messages/pt-BR/social.json
    - packages/modules/stories/ui/StoryCircle.tsx
    - packages/modules/stories/ui/StoriesStrip.tsx
    - packages/modules/stories/ui/HighlightSheet.tsx
    - packages/modules/stories/ui/index.ts

key-decisions:
  - "The row builders and the two permission rules (explorarStoriesRowKind, storyPublishDoorFor) live in lib/story-view.ts, not in lib/stories.ts: lib/stories.ts imports the API client (server only) and the moderator's next page is built on the client. The plan listed lib/stories.ts for the loaders only; story-view.ts and its test are outside the plan's file list"
  - "The strip's new props are onReachEnd, loadingMore and retry: the plan said a trailing 'loading', which clashes with the shipped whole-row `loading` skeleton"
  - "The Explorar row does not sit in a StoriesBand: UI-D-697 says the row adds no hairline and no heading, and a band draws a hairline"
  - "A 403 on a member's publish is told apart by what was SENT, because the API's 403 carries no detail: with a destination chosen it is 'Voce nao pode publicar nesta comunidade.', with none it is the Rede social turned off and Publicar is disabled"
  - "Owned-community source for the viewer menu and Seus stories: communities module on plus memberQuota.ownedActive > 0 from a one-row list read (ownsActiveCommunity, lib/communities.ts). The publish page's destination decision is the one that reads viewer.actions.story, as the plan says"
  - "The member's own circle takes its photo from bootstrap.membership.profile.avatarUrl (the authors read has no circle for a member with no live story) and is drawn only for a member the composed permissions let publish (storyPublishDoorFor('explorar'))"
  - "highlightPlacesView gained includeHome: false so a member's sheet never has an Inicio group whatever the catalogue holds"

patterns-established:
  - "Test doubles for motion/react re-create elements on every render: re-query a dialog after a click that changes its state (M7)"
  - "A never-settling mocked promise inside a React transition entangles every later transition of the file: settle it at the end of the case (composer case 10)"

requirements-completed: [MSTORY-01, MSTORY-03, MSTORY-06, MSTORY-09, MPUB-02, UI-04]

coverage:
  - id: D1
    description: "Tracer: a member sees the Explorar row between the chips and the feed with their own circle first (the + badge and a link to /stories/publicar with no story, a neutral-ring button 'Abrir seus stories' with one) and one circle per followed author (brand ring and 'Ha stories novos' while unseen), taps a circle and the group is read and opened at the first unseen story; the failed read leaves the own circle alone as the publish door"
    requirement: MSTORY-03
    verification:
      - kind: unit
        ref: "apps/web/components/stories/StoriesSurface.test.tsx#E1-E6; apps/web/lib/story-view.test.ts#R1-R9, R12, R14; apps/web/lib/stories.test.ts#A1-A6; apps/web/app/(app)/stories/story-actions.test.ts#G1-G6; packages/modules/stories/tests/stories-strip.test.tsx#B1-B3"
        status: pass
    human_judgment: false
  - id: D2
    description: "The moderator's every-member row pages 20 at a time: three trailing skeleton circles while loading, pages appended and de-duplicated, a failed page keeps the loaded circles and leaves one Recarregar circle asking for the same cursor"
    requirement: MSTORY-03
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/inicio/ExplorarStoriesRow.test.tsx#P1-P5; packages/modules/stories/tests/stories-strip.test.tsx#P1-P4; apps/web/lib/story-view.test.ts#R10-R11"
        status: pass
    human_judgment: false
  - id: D3
    description: "Viewer menus over member groups: the author's sheet (Publicar novo story as an anchor, Destacar only with an owned community, Excluir story in danger), the moderator's (Excluir story only), nothing for anyone else (absent from the DOM, a curator of the organization included), no labelled Destacar pill on a member group; two fixed delete copy variants, pending state, no optimistic removal, a failure keeps the story"
    requirement: MSTORY-09
    verification:
      - kind: unit
        ref: "apps/web/components/stories/StoryViewerHost.test.tsx#M1-M9"
        status: pass
    human_judgment: false
  - id: D4
    description: "Pitfall 12: a member holding the composed permission set gets no publish circle in Inicio (no node at all) while the administrator's circle is unchanged; Explorar carries the member's own circle"
    requirement: MPUB-02
    verification:
      - kind: unit
        ref: "apps/web/lib/registry.test.tsx; apps/web/lib/story-view.test.ts#R13"
        status: pass
    human_judgment: false
  - id: D5
    description: "Member publish screen: video row absent from the DOM when off, helper from the tenant limits, caps on both uploads, audience line, ready-gated video with its line and the falhou state with Remover video, landing and toasts, archived and 403 refusals keeping media and caption"
    requirement: MSTORY-01
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/stories/publicar/StoryComposer.test.tsx#M1-M15"
        status: pass
    human_judgment: false
  - id: D6
    description: "Escopo seam: the publish page's destination groups are the active communities whose viewer.actions.story is true, never the owner flag (fixtures where the two disagree), no Inicio group, origin fallback, social off and communities off"
    requirement: MSTORY-06
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/stories/publicar/page.test.tsx#P1-P8"
        status: pass
    human_judgment: false
  - id: D7
    description: "Highlight checklist in member mode: the visibility notice above the groups, the brand confirm once per opening with the focus on cancel, the switch off until confirmed, later switch-ons and every switch-off write at once, a failed write reverts, reopening asks again; Seus stories for a member"
    requirement: MSTORY-06
    verification:
      - kind: unit
        ref: "packages/modules/stories/tests/highlight-sheet.test.tsx#N1-N2, K1-K6; apps/web/app/(app)/stories/meus/StoryHistoryList.test.tsx#H1-H5; apps/web/app/(app)/stories/highlight-actions.test.ts#7b-7c"
        status: pass
    human_judgment: false
  - id: D8
    description: "Visual and real-device behaviour of the row, the viewer menus and the publish frame at 390px and 320px against the approved sketch 020 (the two backstop rows: the own circle's accessible name wrapping and the helper over two lines at 320px)"
    requirement: UI-04
    human_judgment: true
    rationale: "No unit test asserts layout; the sketch approval is provisional and the plan 15 e2e and visual tests own the 320px and real-device checks"

duration: about 5h
completed: 2026-11-11
status: complete
plan_head_before: 5d1dadd0473518dbbae14d59d370f921b61ffc7a
commits: 6
---

# Phase 10 Plan 12: Member Stories Web Summary

**A member now meets member stories on the web: Explorar carries a story row (their own "+" circle, then the authors they follow, read lazily into the grouped viewer and resumed at the first unseen story), a moderator sees every member's circle and deletes any member story, and a member publishes a story under the tenant's limits with the destination, the visibility notice and the one-time highlight confirm, while Inicio's circle and every organization surface stay as they were.**

## Performance

- **Duration:** about 5 h (estimate 300000 tokens; realized diff about 44000 tokens on the chars/4 scale of added lines)
- **Completed:** 2026-11-11
- **Tasks:** 3 of 3, each with its `test(10-12)` commit before its `feat(10-12)` commit. Task 1 is the tracer: its automated verify ran green end to end before the expansion tasks (tracer verified, expanding).
- **Files:** 6 created, 31 modified (production, tests, catalogs)

## Accomplishments

- **Tracer (Task 1):** `StoryCircle` gained the `badge` (24px brand "+") and the `glyph` photo fallback (neutral `User`, never initials); `StoriesStrip` gained `onReachEnd`, `loadingMore` and `retry`. `loadStoryAuthors` and `loadAuthorStories` read the 10-08 routes through the strict contracts (a 404 is the empty answer, any other failure is `null` and is logged by shape), with `loadAuthorStoriesAction` and `loadStoryAuthorsPageAction`. The surface reads an author's group when the circle is tapped, resumes at the first unseen story, and re-derives the ring and the accessible name on close. `ExplorarStoriesRow` renders between the chips and the feed from its own read that starts beside the feed's (the row never delays the posts), with its three-circle skeleton.
- **Moderator row, menus, Inicio (Task 2):** the paged moderator row, the viewer's "Mais opcoes" over member groups (author and moderator rows, two delete copies, pending state, no optimistic removal), and `canPublish` in Inicio now `storyPublishDoorFor('inicio', ...)` (`stories.story.publish` and `content.publish`).
- **Publish, destination, checklist, history (Task 3):** the composer's member mode, the page that reads `viewer.actions.story` for the destinations (the Escopo seam) and the tenant limits off the bootstrap, `StoryVisibilityNotice` in two tones, `HighlightSheet` with `notice` and `confirmOn`, the member `Seus stories` and the `createHref` the empty sheet needs.

## Task Commits

1. **Task 1 RED:** `75526739` (test): 95 web tests with 28 failed; 36 module tests with 5 failed.
2. **Task 1 GREEN:** `e1f37de6` (feat).
3. **Task 2 RED:** `d974596f` (test): 138 tests with 17 failed.
4. **Task 2 GREEN:** `e898b486` (feat).
5. **Task 3 RED:** `d47efce3` (test): 2383 web tests with 26 failed (this run also holds the old red case 6, now fixed by the fixture); 25 module tests with 6 failed.
6. **Task 3 GREEN:** `a2a20b70` (feat).

Red evidence: for each task a real Vitest `--reporter=json` run was normalised by a throwaway script kept in the session scratchpad (never committed) and `gsd-tools check tdd-red-evidence` answered `RED_EVIDENCE_OK` with the real counts above. No count was invented.

**Plan metadata:** this SUMMARY is committed separately. `.planning/STATE.md`, `.planning/ROADMAP.md` and `.planning/sketches` were not touched. Nothing was pushed or deployed and no hosted project or database command was used. No commit carries a `Co-Authored-By` trailer or tool attribution.

## Verification (observed)

| Gate | Result |
|------|--------|
| `apps/web` Vitest, whole app, final | 356 files, 8357 tests, all passed (the known `highlight-actions.test.ts` case 6 is green) |
| `@rede-social/module-stories` tests | 16 files, 217 passed |
| `TURBO_CACHE=local:r pnpm turbo typecheck --filter=@rede-social/web --filter=@rede-social/module-stories --concurrency=4` | 4 tasks successful (ran the web `next build` as a dependency; `.next` is 493 MB, `.next/cache` 388 MB, nothing deleted) |
| `bash scripts/check-ui-literals.sh` | OK |
| `pnpm boundaries` | no issues |
| Biome on `apps/web` and `packages/modules/stories` | clean (3 pre-existing infos) |
| sketch gate `grep -q '^approved: true' ...020.../README.md` | passes (provisional approval, commit 30ce8537) |
| Acceptance greps of the three tasks (badge, glyph, onReachEnd, ExplorarStoriesRow, content.publish, confirmMod, Manter story, MoreHorizontal, the notice sentence, memberConfirm, Mostrar na comunidade, member, actions.story) | all pass; the D-704 grep for story circles outside the row finds only the platform preview that already existed |

## Decisions Made

See `key-decisions`. The plan's decisions D-704, D-714, D-715, D-716, D-717 and UI-D-697 to UI-D-705 are embodied as written, with the deviations below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The builders needed a shared, client-safe home outside the listed files**
- **Found during:** Task 1
- **Issue:** the plan names `lib/stories.ts` (server only, imports the API client) for the loaders and says nothing of where the circles and groups are composed, but the moderator's next pages are built on the client and the same builders serve the server's first page.
- **Fix:** `lib/story-view.ts` gained `StoryGroupView` kind `member`, `authorGroupView`, `authorCircleView`, `ownCircleView`, `memberStoriesRow`, `moderatorStoriesRow`, `appendAuthors`, `authorRowLabels`, `fillName`, `explorarStoriesRowKind` and `storyPublishDoorFor`, with their cases in `story-view.test.ts`. `apps/web/lib/registry.test.tsx` is new: the plan's "registry unit test" renders the real Inicio stories slot.
- **Commits:** `e1f37de6`, `e898b486`

**2. [Rule 3 - Blocking] The strip's trailing props are named onReachEnd, loadingMore and retry**
- The plan says a trailing `loading`; `loading` is already the whole-row skeleton. The behaviour is the plan's.

**3. [Rule 3 - Blocking] Files outside the plan's list had to change**
- `apps/web/app/(app)/inicio/page.tsx` (the skeleton prop `storiesRow`, so the three skeleton circles show only for a viewer who gets the row), `apps/web/lib/communities.ts` and its test (`ownsActiveCommunity`), `apps/web/lib/story-view.ts` and its test, `apps/web/lib/registry.test.tsx`, `StoryHistoryList.test.tsx`, `publicar/page.test.tsx`, `ExplorarStoriesRow.test.tsx` (new), `packages/modules/stories/tests/*` (the module cases the plan asks for "beside the existing circle tests"), `packages/modules/stories/ui/index.ts` (one type export).

**4. [Rule 2 - Missing critical functionality] The own circle is drawn only for a member who may publish**
- `memberStoriesRow` takes `canPublish` (default true); the host passes `storyPublishDoorFor('explorar', permissions)`. A member the composed permissions do not let publish gets no publish door; their own live story, if one exists, still opens.

**5. [Rule 1 - Plan inconsistent with the wire] The API's 403 carries no detail**
- The plan lists "403 forbidden" and "social off" as two refusals; both are the same bare `403 FORBIDDEN`. The composer tells them apart by what it sent (a destination chosen versus none). With a destination chosen while the Rede social was turned off the member reads the community sentence; the next attempt without a destination reads the social one. `StoryWriteResult` gained the `forbidden` code.

**6. [Rule 1 - Plan item not reachable] "Este espaco nao aceita videos no momento." is not drawn**
- With member video off the picker does not exist, and a stale tab's broker refusal arrives as the media hook's generic upload error (the hook cannot tell a 403 apart). Nothing in this screen can show the sentence without changing `useSignedUpload` or the upload actions, which are shared and outside this plan, so the key was not added. See open items.

**7. [Rule 3 - Blocking] Tests written red-first that needed correction afterwards**
- `stories-strip.test.tsx` B3 fired an image `error` event on an element happy-dom had already replaced (an unloaded image reads as failed on mount); `StoryViewerHost.test.tsx` M7 re-queries the dialog after the click (the `motion/react` double re-creates its elements on every render); `StoryComposer.test.tsx` case 10 now settles its pending publish (a never-settling promise inside a React transition entangles every later transition of the file, which made `busy` stick for every case after it). The 10-12 composer cases M12 and M13 need that.
- Cases written in the same commit as the code they cover, after the fact: `story-view.test.ts` R14 (red first, run before its code), `lib/communities.test.ts` O1 to O3 (`ownsActiveCommunity`, written after).

**8. [Rule 1 - Bug in a test fixture] The old red case 6 was a fixture problem**
- `highlight-actions.test.ts` case 6 failed because its community fixtures lacked the keys plan 10-06 made required (`kind`, `createdBy`, `viewer`) and the page's `memberQuota`. No production code was wrong; the fixture now carries them (commit `d47efce3`), and the whole `apps/web` suite is green.

**9. [Rule 2] `highlightPlacesView` gained `includeHome: false`**
- A member's sheet has no Inicio group whatever the catalogue holds (UI-D-704); the publish page passes `includeHome: !isMember`.

**10. [Rule 2] `loadHighlightSheetAction` returns `createHref` when the caller owns an active community**
- The member's empty sheet needs the manage route of "the member's most recently active community" (UI-D-705); the key is absent otherwise, so the organization's answer is exactly what it was.

**11. [Plan wording] The viewer's delete keeps the shipped handling**
- The plan says "the viewer moves on or closes on the last"; the shipped handling, which this plan reuses as instructed, closes the viewer after a delete (the story is dropped from every group and the route is refreshed once the viewer has closed).

**Total deviations:** 11 (Rule 1 x3, Rule 2 x3, Rule 3 x4, wording x1; items 5 and 6 are plan items the wire or the shared hook cannot carry). **Impact:** no scope change; items 5 and 6 are the ones to read.

## Auth gates

None.

## Known Stubs

None. Every new string is in a host catalog (`stories.json`, `social.json`); the module packages stayed props-only.

## Threat Flags

None. No new endpoint, auth path or schema. T-10-44: the hidden controls are UX only and every write answers to the API (the stale-tab refusals are tested: the 403 copy, archived, the failed delete keeping the story, a failed toggle reverting). T-10-45: the ring exists only in `StoryCircle`, drawn by the Explorar row; the grep finds no other consumer in the web beyond the platform preview that already existed. T-10-46: names and captions render as React text; no `dangerouslySetInnerHTML`; a display name with markup or `$&` is inserted after the template split (case R5). T-10-47: the deep link's unreadable story stays the one shipped `stories.notFound` screen; nothing here distinguishes a miss.

## Open items for the orchestrator

- **Copy gap carried from 10-11, not reachable here:** none of this plan's files renders a post delete or removal body, so the "sai de Explorar" wording of a member-community post is unchanged and still undecided (no key invented).
- **The moderator's `removal: 'moderation'` flag (10-07/10-10):** not used by any stories screen of this plan; nothing to change here.
- **Member row, one unpaged page (10-07 note):** read as the API describes it (`nextCursor` always null); the member passes no paging.
- **`getOrderableCommunities` (10-13):** not touched; `lib/communities.ts` only gained `ownsActiveCommunity`.
- **The deep link `/stories/[storyId]` was not changed:** it is outside the plan's files, and a readable member story opened by link is still headed by the tenant's name (with the author's photo when the wire carries one), not by the author. Opening a circle in Explorar pushes that URL, so a refresh lands on it. A small follow-up (build a member group from `story.author` there) would fix the header; it is not made.
- **One extra read per Explorar visit for a member** on a tenant with the communities module on: the one-row list read that says whether they own an active community (for "Destacar"). The same read opens `Seus stories`.
- **The "Este espaco nao aceita videos no momento." line** needs either a refusal code from the media broker or a `forbiddenMessage` option on `useSignedUpload`; decide before the real-device walk.
- **Backstop rows** (E02 long-text at 320px, E04 overflow at 320px) have no unit test by design; they are for the plan 15 visual tests, together with the real-device checks. The sketch gate is a provisional approval (30ce8537); the sketch README and `.planning/sketches` were not edited.
- **Release order is unchanged:** web before the API for the story wire (A7). This plan is web only and already tolerates `authorUserId: string | null`.

## Self-Check: PASSED

- FOUND: `apps/web/app/(app)/inicio/ExplorarStoriesRow.tsx`, `ExplorarStoriesRow.test.tsx`, `apps/web/components/stories/StoryVisibilityNotice.tsx`, `apps/web/lib/registry.test.tsx`, `apps/web/app/(app)/stories/publicar/page.test.tsx`, `apps/web/app/(app)/stories/meus/StoryHistoryList.test.tsx`
- FOUND commits: `75526739`, `e1f37de6`, `d974596f`, `e898b486`, `d47efce3`, `a2a20b70`
- `git rev-list --count 5d1dadd0473518dbbae14d59d370f921b61ffc7a..HEAD` = 6 before this SUMMARY commit
- No `Co-Authored-By` trailer and no tool attribution in any of the six commits; `.planning/ROADMAP.md`, `.planning/STATE.md` and `.planning/sketches` not staged
