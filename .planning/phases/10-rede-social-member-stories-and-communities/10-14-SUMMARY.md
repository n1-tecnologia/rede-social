---
phase: 10-rede-social-member-stories-and-communities
plan: 14
subsystem: web
tags: [member-communities, web, community-page, owner-controls, composer, lifecycle, moderator, tracer, escopo-seam, UI-D-709, UI-D-710, UI-D-711, UI-D-712, UI-D-713, UI-D-714, UI-D-716, UI-D-717, UI-D-718, D-706, D-713, D-718]

requires:
  - phase: 10-02
    provides: "the sketch 020 review gate (approved: true, provisional, D-33)"
  - phase: 10-06
    provides: "the community wire with kind, createdBy and viewer { isOwner, canPublish, canEdit, canCurate, actions } (the Escopo seam)"
  - phase: 10-09
    provides: "the member highlight owner seam (the curator row, the picker pager, the own history)"
  - phase: 10-12
    provides: "the member story publish screen and the highlight sheet's once-per-opening confirm copy"
  - phase: 10-13
    provides: "CommunityForm memberMode, the list loader carrying viewer.actions"
provides:
  - "the community page's controls decided by the API's viewer flags only: viewer.actions.post (FAB, desktop button, owner empty list, ?comunidade=), viewer.actions.story (the Destaques '+' circle), canEdit (pencil, Reativar, Excluir), canCurate (manage circle); no role name and no id comparison in the page"
  - "CommunityHeader byline slot and the page's 'Criada por voce' / 'Criada por {name}' line, the link live only where the profile opens (canBrowseMemberDirectory)"
  - "the member composer inside a community: ?comunidade= kept only when viewer.actions.post allows it (silent fallback otherwise), the read-only destination line, communityId in the create body, landing and close on the community page, the edit helper"
  - "editar redirects by viewer.canEdit and destaques answers not-found by viewer.canCurate, so social off removes the creator's writes and a blocked creator's pages are the shipped not-found screens"
  - "communityRelation (organization | owner | moderator) read from the API's flags, the archive and delete confirmations in three copy variants, no store refusal block on a member community"
  - "the creator's 'Adicionar stories' helper and the once-per-opening confirm in HighlightManager (member prop)"
  - "a like on a vanished community refreshes the page after the shipped generic toast"
  - "the admin's destination pickers (composer and story publish) offer organization communities only"
  - "carry-forward of 10-11: delete and removal bodies of a post inside a member community say it leaves the community"
affects: [10-15]

actuals:
  tokens: 24000
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "The page decides every control from the payload's viewer flags; fixtures make a flag disagree with the others (post true with canPublish false) to prove which flag is read"
    - "communityRelation(community) is one pure read of kind and viewer.isOwner, shared by the page, the edit route and the client dialogs through a type-only import"
    - "A client island wraps the toggles it receives to add a page-level reaction (CommunityPosts refreshes the route after a code-less like failure) without touching the shared list"
    - "A host-side once-per-opening confirm for a switch list whose module has no gate: the toggle promise waits on a dialog answer, and a decline reverts the switch"

key-files:
  created:
    - apps/web/app/(app)/comunidades/[communityId]/page.test.tsx
    - apps/web/app/(app)/comunidades/[communityId]/editar/page.test.tsx
    - apps/web/app/(app)/comunidades/[communityId]/destaques/page.test.tsx
    - apps/web/app/(app)/comunidades/[communityId]/CommunityPosts.test.tsx
    - apps/web/app/(app)/criar/page.test.tsx
  modified:
    - apps/web/app/(app)/comunidades/[communityId]/page.tsx
    - apps/web/app/(app)/comunidades/[communityId]/CommunityPosts.tsx
    - apps/web/app/(app)/comunidades/[communityId]/DeleteCommunityControl.tsx
    - apps/web/app/(app)/comunidades/[communityId]/editar/page.tsx
    - apps/web/app/(app)/comunidades/[communityId]/destaques/page.tsx
    - apps/web/app/(app)/comunidades/CommunityForm.tsx
    - apps/web/app/(app)/criar/page.tsx
    - apps/web/app/(app)/criar/ComposerForm.tsx
    - apps/web/app/(app)/criar/actions.ts
    - apps/web/app/(app)/stories/publicar/page.tsx
    - apps/web/components/stories/HighlightManager.tsx
    - apps/web/lib/communities.ts
    - apps/web/messages/pt-BR/communities.json
    - apps/web/messages/pt-BR/feed.json
    - packages/modules/communities/ui/CommunityHeader.tsx

key-decisions:
  - "Carry-forward of 10-11 decided with ONE catalog variant, for Igor to confirm: feed.deleteCommunity.body 'Ela sai da comunidade para todos os membros. Os comentarios tambem deixam de aparecer.' and feed.removeCommunity.body 'Ela sai da comunidade e do link compartilhado para todos. A pessoa nao e avisada.' (UI-SPEC and sketch 020 give no wording for a post inside a community). Wired in the community page by overriding deleteBodyMember and removeBody of postMenuLabels for a member community only; the organization community keeps the shipped strings. The module PostMenu is untouched"
  - "The moderator's removal flag (removal: 'moderation') needed no change: the card already carries the API's removal statement and the page's menu toast is the shipped 'Publicacao removida.'"
  - "The admin's pickers keep communities where viewer.actions.post (composer) or viewer.actions.story / kind (story publish) say so: the list read carries member communities for moderation, so the plan's premise that the API's picker data already excludes them was false for listAllCommunities"
  - "communityRelation lives in lib/communities.ts (not in the client form) so the server pages can import it; the client components import only its type"
  - "ReactivateCommunity takes no relation prop: its confirmation copy is the same shipped sentence for every viewer (a community the moderator archived must look to its creator exactly like one they archived), so a prop would change nothing"
  - "The Destaques '+' circle gate moved from stories.story.publish AND stories.story.manage to viewer.actions.story, as the plan says; for admin_tenant nothing changes, for a custom role holding only the story permissions the API's value (feed.post.create AND content.publish for an organization community) now decides"
  - "StoriesSurface's own viewer keeps canCurate from STORY_PERMISSIONS.manage (the 'Destacar' pill inside a highlight story): the creator curates through the manage screen, the plan did not ask for the pill on a member community"

patterns-established:
  - "Escopo fixtures in page tests: flags built as viewerOf builds them for each viewer kind, plus fixtures that break the equality on purpose"

requirements-completed: [MCOMM-06, MCOMM-07, MCOMM-10, MPUB-01, MPUB-03, MPUB-05, MPUB-06, UI-04]

duration: 110min
completed: 2026-11-11
status: complete
plan_head_before: 58cc209b3703458279e1fcc905e46d6ced41c0be
commits: 6
---

# Phase 10 Plan 14: The Creator's Community Page, Composer, Lifecycle and Curation Summary

**The creator of a member community now publishes in it through the member composer (destination line, back to the community page), sees the owner-only controls drawn from the API's `viewer` flags, runs archive and delete with their own confirmations and curates highlights; a moderator moderates without publishing; another member sees a read-only community; `social` off and a blocked creator behave as UI-D-716 and UI-D-717 say.**

## Accomplishments

- **Tracer (Task 1):** `CommunityHeader` gained the optional `byline` slot (`mt-2 flex min-h-11 items-center gap-2`, between the name row and the description). The page builds "Criada por voce" (plain text) for the creator and "Criada por {name}" for everyone else, with the name a link to `/membros/{membershipId}` only where that profile opens (`canBrowseMemberDirectory`: a member while `social` is on, or staff) and plain text otherwise; the line exists for member communities only and the user id never reaches the page. The FAB and desktop button read `viewer.actions.post`, the "+" circle reads `viewer.actions.story`, the pencil and the lifecycle read `viewer.canEdit`, the manage circle reads `viewer.canCurate`; all of them are absent on an archived community. `/criar?comunidade={id}` for a member reads the community and keeps it only when it is active and `viewer.actions.post` is true, else the plain member composer with no redirect. `ComposerForm` takes `memberCommunity`: the destination line replaces the audience line, the create body carries `communityId`, the member lands on `/comunidades/{id}` with "Publicacao criada." and close or a confirmed discard return there; editing a post of a community shows the line and "A publicacao nao pode mudar de comunidade.". The create action also revalidates the community page.
- **Matrix, social off and blocked creator (Task 2):** `editar` redirects by `viewer.canEdit` and `destaques` answers `notFound` by `viewer.canCurate` (creator, moderator, another member, support and the creator with `social` off are each covered); a blocked or departed creator is the API's bare 404 and therefore the shipped not-found screen. `CommunityPosts` wraps like and unlike so a code-less failure (the vanished community) refreshes the route after the list's shipped generic toast. The admin's composer picker keeps only communities with `viewer.actions.post`, and the admin story composer offers no member community.
- **Lifecycle, moderator and curation (Task 3):** `communityRelation` (organization, owner, moderator) is read from `kind` and `viewer.isOwner`. `CommunityForm` and `DeleteCommunityControl` select the confirmation copy by it (`confirm.archive` unchanged, `archiveOwn`, `archiveMod`, `deleteMod`); the moderator's edit form shows neither the audience line nor the store block, and a member community never shows the store refusal block. `HighlightManager` takes `member`: the picker helper becomes `stories.highlights.picker.memberHelper` and the first switch-on of each opening asks with plan 12's `memberConfirm` copy; the `destaques` page passes it for a member community.

## Task Commits

| Task | RED | GREEN |
|------|-----|-------|
| 1 (tracer) | `8b894248` | `bf3e2602` |
| 2 | `4a03f1ad` | `17beb37c` |
| 3 | `a810a77c` | `23d41caf` |

Red evidence: for each task a real Vitest `--reporter=json` run was normalised by a throwaway script kept in the session scratchpad (never committed) and `gsd-tools check tdd-red-evidence` answered `RED_EVIDENCE_OK` with the real counts: Task 1 web 69 tests with 16 failed and the module header test 12 with 1 failed; Task 2 143 tests with 12 failed; Task 3 177 tests with 17 failed. No count was invented.

## Verification (observed)

| Gate | Result |
|------|--------|
| sketch gate `grep -q '^approved: true' ...020.../README.md` | passes (provisional approval, commit 30ce8537), run first |
| `apps/web` Vitest, whole app, final | 361 files, 8426 tests, all passed (8357 at the start, 69 new) |
| `@rede-social/module-communities` tests | 9 files, 79 passed |
| `TURBO_CACHE=local:r pnpm turbo typecheck --filter=@rede-social/web --filter=@rede-social/module-communities --concurrency=4` | 4 tasks successful (it ran the web `next build` as a dependency; `.next` 527 MB, `.next/cache` 422 MB, nothing deleted) |
| `bash scripts/check-ui-literals.sh` | OK |
| Biome on the touched paths | clean |
| Acceptance greps (byline, audienceCommunity, "Criada por voce", viewer count 21, admin_tenant count 0, actions.post / actions.story in the page, actions.post in `criar/page.tsx`, notFound in destaques, redirect in editar, archiveMod, deleteMod, "Manter comunidade", relation in DeleteCommunityControl) | all pass |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan premise false] The admin's pickers did list member communities**
- **Found during:** Task 2
- **Issue:** the plan says the API's catalog and picker data already exclude member communities. `listAllCommunities` reads the same list the admin sees for moderation, which carries member communities, so the admin's `/criar` picker and the admin story composer's destination groups (`includeEmptyPlaces`) would have offered them.
- **Fix:** `criar/page.tsx` keeps `viewer.actions.post` communities for the admin; `stories/publicar/page.tsx` (a 10-12 file outside this plan's list) keeps a member community only where `actions.story` is true, organization communities unchanged. A case in `stories/publicar/page.test.tsx` (P9) and two in `criar/page.test.tsx` (P6, P7).
- **Commit:** `17beb37c`

**2. [Rule 2 - Carry-forward] The post delete and removal wording inside a member community**
- Two new keys (see key-decisions); wired where the page builds the menu labels. Tested in the community page test (cases 20 and 21).
- **Commit:** `23d41caf`

**3. [Rule 3 - Blocking] Files outside the plan's list**
- `apps/web/lib/communities.ts` and its test (`communityRelation`, shared by two server pages and the client dialogs), `apps/web/app/(app)/stories/publicar/page.tsx` and its test (item 1), the module test `packages/modules/communities/tests/community-page-ui.test.tsx` (the byline slot case).
- New test files: the community page, `editar`, `destaques`, `CommunityPosts` and `criar` page tests. The plan names page-level tests but not these files.

**4. [Rule 2] Vanished content: the like refreshes, the comment is not rewired**
- The plan says a like or a comment on content that has just vanished reverts, toasts and refreshes. `CommunityPosts` now refreshes after a like or unlike that fails with no code of its own (the list already reverts and toasts). The comment sheet's actions live in `lib/registry.tsx` and the shared list, outside this plan; a comment on vanished content keeps the shipped generic error toast and does not refresh.

**5. [Plan wording] `ReactivateCommunity` takes no `relation` prop**
- Its confirmation is the same shipped sentence for every viewer (and must not hint who archived the community), so a prop would change nothing. Only a test was added (case 7: no mention of a moderator or an administrator).

**6. [Plan wording] The member's once-per-opening confirm is host-side**
- The module's switch list has a gate only in the Destacar sheet. For "Adicionar stories" the host holds the toggle promise on a brand `ConfirmDialog`: while the dialog is up the switch already shows ON (the list's optimistic move) and a decline reverts it, where the Destacar sheet keeps it off until the confirm. A module-side `onBeforeOn` passthrough in `HighlightEditSheet` would make it identical; it was not added because the module is outside this plan.

**7. [Plan wording] "the page passes the member's stories" to the manager**
- Not needed: the picker's pager (`loadMoreOwnStoriesAction`) already reads the caller's own history for a member.

**8. Matrix tests written after the code**
- Cases 12 to 18 of the community page test (the viewer matrix, social off, blocked creator) passed on their first run: Task 1's page rewrite already read the flags, so they are regression coverage, not red-first. The Task 2 red evidence is the guard, picker and refresh cases (12 failures).

**Total deviations:** 8. **Impact:** no scope change; items 1, 4 and 6 are the ones to read.

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema. T-10-51: the page and the composer only decide UX; the API's 403 is the control and a foreign `?comunidade=` falls back silently. T-10-52: the byline link targets `/membros/{membershipId}`; no user id reaches the page. T-10-53: the creator sees the same pill and note for any archive, no screen names a moderator, and the moderator copy is shown only to the moderator. T-10-54: names render as React text.

## Open items for the orchestrator

- **Decision for Igor:** the two new post wording keys (`feed.deleteCommunity.body`, `feed.removeCommunity.body`), the answer to the carry-forward from 10-11.
- **Same wording gap on `/post/[postId]`:** the post detail page builds its menu with `postMenuLabels(tf)` and still reads "Ela sai de Explorar..." for a community post. Not in this plan's files; a follow-up (override by the post's community, as the community page does).
- **Deep link `/stories/[storyId]/page.tsx`:** not changed (outside this plan's list); a member story opened by link is still headed by the tenant's name instead of the author. Small follow-up from 10-12 (build a member group from `story.author`).
- **Store product pickers** (`loja/novo`, `loja/[productId]/editar`) still use `listAllCommunities`, so an admin sees member communities there; a member community cannot be linked to a product (D-713), so the API is the control, but the picker should probably drop them like the others. Not touched.
- **Destaques "+" circle gate:** now `viewer.actions.story` (feed.post.create AND content.publish for an organization community) instead of `stories.story.publish AND stories.story.manage`. Identical for admin_tenant; a custom role with only the story permissions would lose the circle until the Escopo scope exists.
- **`revalidatePath` of the community page after a member create** (`criar/actions.ts`) has no unit test (the action has no test file); the redirect target and the body are tested in the form.
- **Backstop row** (E09 long display name at 320px in the byline) has no unit test by design; it is for the plan 15 visual tests, together with the real-device checks. The sketch gate is a provisional approval (30ce8537); the sketch README and `.planning/sketches` were not edited. Nothing was pushed or deployed and no database command was run.

## Self-Check: PASSED

- FOUND: the five new test files and the fifteen modified files listed in key-files
- FOUND commits: `8b894248`, `bf3e2602`, `4a03f1ad`, `17beb37c`, `a810a77c`, `23d41caf`
- `git rev-list --count 58cc209b3703458279e1fcc905e46d6ced41c0be..HEAD` = 6 before this SUMMARY commit
- No `Co-Authored-By` trailer and no tool attribution in any of the six commits; `.planning/ROADMAP.md` and `.planning/STATE.md` not staged
