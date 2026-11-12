---
phase: 10-rede-social-member-stories-and-communities
fixed_at: 2026-11-12T00:00:00Z
review_path: .planning/phases/10-rede-social-member-stories-and-communities/10-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 10: Code Review Fix Report

**Fixed at:** 2026-11-12
**Source review:** `.planning/phases/10-rede-social-member-stories-and-communities/10-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (WR-01, WR-02, WR-06, as scoped by the caller)
- Fixed: 3
- Skipped: 0

Not in scope and untouched: WR-03, WR-04, WR-05 (database hardening, a migration and a db reset: the
developer decides) and IN-01..IN-05.

**Where verification ran:** the main checkout on `master` (no worktree: the project's gates need the
installed `node_modules`, which a hand-made worktree does not have). Every fix was written red first,
then green; no database, no `db:reset`, no integration suite was run.

## Fixed Issues

### WR-01: A moderator's removal of a member-community post is unreachable from the UI

**Files modified:** `packages/modules/feed/server/service.ts`, `packages/modules/feed/server/routes.ts`,
`packages/modules/feed/contracts/index.ts`, `packages/modules/feed/tests/community-removal-flag.test.ts` (new)
**Commit:** b219a0b0
**Applied fix:** `toPost` now emits `removal: 'moderation'` for a holder of `moderation.manage` on `'followers'`
and `'community'` posts, never on the viewer's own post. The suggested one-line change alone would not have
reached the screen: `listCommunityFeed` (the community page's read) never passed `canModerate` to `feedPage`,
so the flag could not ride a community page. `listCommunityFeed` now takes `opts: { canModerate }` (default
false) and hands it to `feedPage`, and the `GET /v1/feed?communityId=` route reads `canModerate` once, before
the service opens its transaction (the existing comment-removal rule). Início and Reels still never carry the
key. The contract docblock names the second audience. `PostMenu.tsx`, `PostDetail.tsx`, `FeedList.tsx` and
`feed-view.tsx` only read the flag and needed no change; `'followers'` (Explorar) behaves as before (feed suite
and the web suite pass).
**Test evidence:** 5 new cases (moderator sees the flag on a community post; non-moderator, default options,
author and an organization `'tenant'` post do not). Red before the fix (1 failed, 4 passed), green after.
**Status:** fixed: requires human verification (logic change; the end-to-end moderator path on a real community
page is covered only by the integration suites, which were not run).

### WR-02: `viewer.actions.story` reused `canPublish` (post rule)

**Files modified:** `packages/modules/communities/server/service.ts`,
`packages/modules/communities/contracts/index.ts`, `packages/modules/communities/tests/viewer-story-action.test.ts` (new)
**Commit:** 700af570
**Applied fix:** in `viewerOf`, `actions.story` is now `canStory = member ? canCurate : flags.canPublishStory && flags.canCurateOrg`.
For a member community that is its creator holding `stories.story.publish`; for an organization community it is
both story halves (`stories.story.publish` and `stories.story.manage`), which reproduces the pre-Phase-10 gate
exactly (the review's `canCurateOrg && canPostOrg` would have mixed in the post rule and not required the story
publish key, so it was not used). `viewer.actions` keeps the same five keys; `post` is still `canPublish`.
The web consumers (`comunidades/[communityId]/page.tsx` and `stories/publicar/page.tsx`) already read
`viewer.actions.story` and needed no change. Docblocks of `viewerOf` and the contract were updated.
**Test evidence:** 8 new cases (admin and creator with `stories` on and off, publish without manage, a
non-creator reader, an admin on a member community, the five keys). Red before (3 failed, 5 passed), green after.
**Note:** `apps/api/tests/integration/member-communities.test.ts` still asserts `actions.story === canPublish`
per viewer; with the `stories` module on (the lab tenant) the values are equal for every viewer in that matrix,
so it should still pass, but it was not run here. Its wording is now looser than the rule.
**Status:** fixed: requires human verification (logic change).

### WR-06: Story viewer's curator menu keyed on `stories.story.manage`

**Files modified:** `apps/web/app/(app)/comunidades/[communityId]/page.tsx`,
`apps/web/app/(app)/comunidades/[communityId]/page.test.tsx`
**Commit:** ffa1426a
**Applied fix:** the community page's story viewer now gets `canCurate: viewer.canCurate` (the API's per-community
flag) instead of `bootstrap.permissions.includes(STORY_PERMISSIONS.manage)`; the now-unused import was removed.
An admin on a member community no longer sees a "Destacar" that can only fail, and the creator gets the curator
menu on their own community. The moderator delete for a member story stays on the `memberMenu.canModerate` path
(untouched).
**`apps/web/app/(app)/stories/[storyId]/page.tsx`: left alone, on purpose.** The deep link names one story with
no community context in the page (no `viewer` flag exists there), so there is no unambiguous per-place value to
pass; the story's place would have to be resolved first, which is a behaviour change beyond this finding.
**Test evidence:** 3 new page cases (admin on a member community: false; the creator without
`stories.story.manage`: true; admin on an organization community: true). Red before (2 failed), green after.
**Status:** fixed

## Skipped Issues

None. `/stories/[storyId]/page.tsx` (the second location of WR-06) was deliberately not changed, see above.

## Verification

| Check | Result |
|---|---|
| `apps/web` Vitest | 361 files, 8429 tests passed |
| `@rede-social/module-feed` Vitest | 27 files, 345 tests passed (5 new) |
| `@rede-social/module-communities` Vitest | 10 files, 87 tests passed (8 new) |
| `@rede-social/module-stories` Vitest | 16 files, 217 tests passed |
| `turbo typecheck` (web, feed, communities, stories, `--concurrency=4`, `TURBO_CACHE=local:r`) | 6 of 6 tasks successful |
| `scripts/check-ui-literals.sh` | OK |
| Biome on touched packages and `app/(app)/comunidades` | clean (114 files) |
| `apps/web/.next/cache` after the run | 296 MB (under 2 GB, not deleted) |

No commit carries a Co-Authored-By trailer or tool attribution.

---

_Fixed: 2026-11-12_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
