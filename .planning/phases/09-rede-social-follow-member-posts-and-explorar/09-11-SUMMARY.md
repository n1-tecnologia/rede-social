---
phase: 09-rede-social-follow-member-posts-and-explorar
plan: 11
subsystem: web
tags: [web, locked-screen, siga-para-ver, mid-session-refusal, D-469, D-470, D-483, D-484, UI-D-499, UI-D-500]

requires:
  - phase: 09-05
    provides: "the 403 FORBIDDEN { access: 'follow_required', author } on GET /v1/feed/posts/{id}, the bare 403 { access: 'follow_required' } on every interaction route, ACCESS_REFUSALS with follow_required appended last, postLockedAuthorSchema"
  - phase: 09-10
    provides: "FollowControl and FollowButton (md, fullWidth), the social.json catalog root, @rede-social/module-social/ui"
provides:
  - "@rede-social/module-social/ui: LockedPost, the props-only 'Siga para ver' card (avatar node, heading clamped to two lines, body capped at 260px, action node; nothing else)"
  - "apps/web/lib/feed.ts: loadPost's 'follow-required' result (author parsed with the strict postLockedAuthorSchema; malformed body is the standard not-found; access matched by name)"
  - "LockedPostScreen: avatar link with a decorative lock disc, FollowControl, mark focus + router.refresh() in a transition, card-shaped aria-busy skeleton while it is in flight; post-focus.ts one-shot with a 10 s staleness bound; PostDetail consumes it"
  - "follow_required through the feed actions (FollowRequiredCode, isFollowRequired, the two result unions), the comment list (CommentAccessRefusal widened, onLocked(code)), FeedList, FeedSurface, PostDetail and ReelsHost (overlay toasts without refreshing), useFollowRequiredRefusal"
  - "catalog: social.locked.{title, body, profile}, feed.errors.followRequired; Reels label followRequired"
affects: [09-13]

actuals:
  tokens: 28400
  tasks: 3
  commits: 6
plan_head_before: 159cc0415d836275c46bca8afcc5a1b04569c814

tech-stack:
  added: []
  patterns:
    - "A new access word is mapped BY NAME at every consumer (a lookup against ACCESS_REFUSALS, a guard that throws if the word leaves the list), never by position"
    - "A client screen that disappears when the server re-renders the same URL hands one fact to its successor through a module one-shot with a staleness bound (post-focus.ts), not through the URL"
    - "One comment list serves two closed refusal values: the type is widened and the host receives the code, instead of forking the list"
    - "A refusal mid-session is a reaction: revert, close the sheet first, one info toast, router.refresh(); the overlay over a feed toasts only"

key-files:
  created:
    - packages/modules/social/ui/LockedPost.tsx
    - packages/modules/social/tests/locked-post.test.tsx
    - apps/web/components/social/LockedPostScreen.tsx
    - apps/web/components/social/LockedPostScreen.test.tsx
    - apps/web/components/social/post-focus.ts
    - apps/web/components/social/post-focus.test.ts
    - apps/web/lib/feed.test.ts
    - "apps/web/app/(app)/inicio/feed-actions.test.ts"
  modified:
    - packages/modules/social/ui/index.ts
    - packages/modules/social/README.md
    - apps/web/lib/feed.ts
    - "apps/web/app/(app)/post/[postId]/page.tsx"
    - "apps/web/app/(app)/post/[postId]/editar/page.tsx"
    - apps/web/components/social/FollowControl.tsx
    - apps/web/components/feed/PostDetail.tsx
    - apps/web/components/feed/PostDetail.test.tsx
    - apps/web/components/feed/FeedSurface.tsx
    - apps/web/components/feed/FeedSurface.test.tsx
    - apps/web/components/feed/community-locked.ts
    - apps/web/components/reels/ReelsHost.tsx
    - apps/web/components/reels/ReelsHost.test.tsx
    - "apps/web/app/(app)/inicio/feed-actions.ts"
    - apps/web/lib/registry.tsx
    - packages/modules/feed/ui/CommentsList.tsx
    - packages/modules/feed/ui/FeedList.tsx
    - packages/modules/feed/ui/index.ts
    - packages/modules/feed/tests/comments-list-locked.test.tsx
    - apps/web/messages/pt-BR/social.json
    - apps/web/messages/pt-BR/feed.json
    - apps/web/i18n/messages.test.ts
    - apps/web/e2e/social.spec.ts
    - apps/web/e2e/social-admin.ts

key-decisions:
  - "Planning decision 1 (the locked card is a props-only module component): LockedPost takes heading, body, avatar node and action node; the host builds the avatar link, the lock disc and the Seguir control, so the module ships no language and knows no route"
  - "Planning decision 2 (the access value is matched by name): lib/feed.ts and feed-actions.ts look follow_required up in ACCESS_REFUSALS by value (feed-actions throws at load if it ever leaves the list); ACCESS_REFUSALS[0] stays the community code; a unit case pins that the list holds the word and index 0 is community_locked"
  - "Planning decision 3 (focus survives the refresh through a one-shot module variable): post-focus.ts markFocusAfterFollow / consumeFocusAfterFollow; no query parameter, so the URL stays the shared link; added a 10 s staleness bound so a refresh that never landed cannot steal focus on a later visit"
  - "Planning decision 4 (the skeleton is the card's own shape, drawn by the screen): an 80px circle, 14px bar at 45%, 12px bar at 70%, a 44px rounded-xl block inside the same wrapper and card classes; no route loading.tsx"
  - "Planning decision 5 (the comment list's refusal type is widened, not forked): CommentAccessRefusal = community_locked | follow_required; onLocked receives the code; FeedList closes the sheet for either"
  - "Planning decision 6 (a support user never gets this screen): the API answers them the bare 404, so loadPost and the page have no branch for them; an e2e proves the standard not-found for a real support_tenant"
  - "The focus target is the PostCard's own role=article (it already carries tabIndex -1 and data-post-id): no wrapper was added to PostDetail, so the page's flex/gap flow is unchanged"
  - "The screen's follow state is lifted (followed) so that if the refresh itself fails the card returns reading Seguindo, not a stale Seguir"

requirements-completed: [SOCIAL-06, FOLLOW-05, SOCIAL-09]

coverage:
  - id: D1
    description: "Tracer: Marcos (not the author, not a follower) opens a shared link to Helena's member post and sees under the 'Publicação' header ONE card with her linked avatar and lock disc, 'Siga Helena Küster para ver', the body and a full-width Seguir; the document the browser received holds her name and not the caption; one tap re-renders the SAME URL as the real post with its comment field and focus inside the post region; a follower opens the link and meets the post directly"
    requirement: SOCIAL-06
    verification:
      - kind: e2e
        ref: "apps/web/e2e/social.spec.ts#09-11 'Siga para ver': a shared link to a followers-only member post (4 cases, mobile and desktop)"
        status: pass
      - kind: unit
        ref: "packages/modules/social/tests/locked-post.test.tsx L1-L5; components/social/LockedPostScreen.test.tsx S1-S6; components/social/post-focus.test.ts F1-F5; lib/feed.test.ts P1-P8"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every other miss is the single 'Publicação não encontrada' screen: a real support_tenant, a member of another tenant, an unknown/removed post (including a post removed between the tap and the refresh), a blocked author for a stranger and for a follower, and social off (and turning it back on restores the locked screen); a forged or malformed author body falls back to not-found and community_locked keeps its redirect"
    requirement: SOCIAL-09
    verification:
      - kind: e2e
        ref: "apps/web/e2e/social.spec.ts#09-11 support/other tenant, removed post, blocked author, social off then on (mobile and desktop)"
        status: pass
      - kind: unit
        ref: "apps/web/lib/feed.test.ts P4-P8 (strict author schema, community redirect, 404/400, a 500 with a follow_required body)"
        status: pass
    human_judgment: false
  - id: D3
    description: "UI-D-500: a like, unlike, comment, reply or comment like refused with follow_required answers code follow_required from every action, the comment list reports the code to its host once, the feed and post page toast 'Siga o autor para curtir e comentar.' (info) and refresh, the sheet closes first, the Reels overlay toasts without refreshing, any other code is the generic error toast, and community_locked is unchanged"
    requirement: SOCIAL-06
    verification:
      - kind: unit
        ref: "app/(app)/inicio/feed-actions.test.ts (7 actions x 3 cases); packages/modules/feed/tests/comments-list-locked.test.tsx 1-9; components/feed/FeedSurface.test.tsx and PostDetail.test.tsx (4 + 4 cases); components/reels/ReelsHost.test.tsx (follow_required overlay vs tab, generic)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/social.spec.ts#09-11 a like or a comment refused because the viewer stopped following (stale tab) (4 cases: Explorar like, sheet comment, post page like into the locked screen, Reels overlay)"
        status: pass
      - kind: e2e
        ref: "reels.spec.ts and comunidades.spec.ts full files (community-locked reaction not regressed; 192 passed with social.spec.ts)"
        status: pass
    human_judgment: false
  - id: D4
    description: "D-470 / FOLLOW-05: the Seguir control is added in no place beyond the plan's (the locked screen is the fourth of the four); the module card stays props-only and imports nothing from the feed package"
    requirement: FOLLOW-05
    verification:
      - kind: unit
        ref: "apps/web/components/social/no-follow-outside.test.tsx (plan 09-10, still green); pnpm boundaries: 1,720 files in 18 packages, no issues"
        status: pass
    human_judgment: false
  - id: D5
    description: "UI E05 states: a failed follow keeps the card and the button with the catalog error toast; the pending refresh swaps the card for an aria-busy card-shaped skeleton in the same wrapper and card classes; a 40-grapheme name clamps to two lines at 320px with no horizontal scroll; the avatar link carries its own name and the lock disc and glyph are aria-hidden; Tab reaches the link then the button and Enter follows"
    verification:
      - kind: unit
        ref: "components/social/LockedPostScreen.test.tsx S7-S12"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/social.spec.ts#09-11 a 40-grapheme name clamps ...; the keyboard reaches the avatar link, then the button"
        status: pass
    human_judgment: false
  - id: D6
    description: "The 'Siga para ver' card, the skeleton-to-post swap and the toast moment read as the approved sketch 012 under any tenant brand at 320 and 390px, on a real phone"
    verification: []
    human_judgment: true
    rationale: "Visual fidelity to a provisionally approved sketch is a design judgment (designer review is a follow-up, D-33); that the swap 'moves nothing' is asserted structurally (same wrapper and card classes), not by a pixel measure; real-device behaviour of the tap, the focus move and the toast is unverified (real-device rows are blocked locally)."

duration: 29 min
completed: 2026-10-20
status: complete
---

# Phase 9 Plan 11: The "Siga para ver" screen and the mid-session refusal Summary

**A stranger who opens a shared link to a followers-only member post sees one card naming the author with a brand Seguir button and nothing of the post, following re-renders the same URL as the real post with focus in it, every other miss is the standard "Publicação não encontrada", and a like or comment refused because the viewer stopped following reverts, says one sentence, closes the sheet and removes the card.**

## Performance

- **Duration:** 29 min (02:31Z to 03:00Z, including about 20 min of Playwright runs)
- **Tasks:** 3 (one tracer TDD, one TDD, one auto)
- **Files:** 32 changed (8 created), 1,840 insertions, 50 deletions, measured against `plan_head_before`

## Accomplishments

- **Tracer (Task 1, SOCIAL-06, D-469, UI-D-499).** `LockedPost` is a props-only module card. `loadPost` returns `follow-required` with the author, parsed by the strict `postLockedAuthorSchema` (a missing author, an extra key or a non-uuid id is the standard not-found, so a forged body cannot draw the card), the access word is found by name and `community_locked` keeps its redirect. `LockedPostScreen` renders the header and one card: the author's avatar as a link to `/membros/{id}` with a decorative lock disc, the heading, the body, a full-width `FollowControl`. On a confirmed follow it marks the focus and calls `router.refresh()` in a transition, swapping the card for an `aria-busy` skeleton of the same box while it is in flight; `PostDetail` consumes the mark and focuses the post's own `role="article"`. The page never receives more than the author (the e2e asserts the HTML document holds her name and not the caption). The edit page treats `follow-required` as not-found.
- **Mid-session refusal (Task 2, UI-D-500).** The like, unlike, comment, reply and both comment-like actions answer `code: 'follow_required'` for a 403 of that word (a 500, or a 403 with another word, stays `generic`; `community_locked` is unchanged). `CommentAccessRefusal` is widened to the two closed values and `onLocked` hands the code to the host; `FeedList` closes the sheet for either. `FeedSurface` and `PostDetail` toast "Siga o autor para curtir e comentar." (info) and refresh; the Reels overlay toasts without refreshing. Four e2e walks prove it end to end with a stale tab (the follow row deleted behind the open page).
- **States and edges (Task 3).** A failed follow keeps the card and the button; a refresh that answers 404 (the post removed between the tap and the refresh) lands on the standard screen; an 80-grapheme name clamps; a blocked author is the standard screen for a stranger and for a follower and unblocking brings the locked screen back; `social` off is the standard screen and turning it back on restores the locked one; Tab reaches the link then the button and Enter follows.

## Task Commits

1. **Task 1 (tracer, TDD):** RED `723c85e2` (test), GREEN `2c0e5772` (feat)
2. **Task 2 (TDD):** RED `47494d95` (test), GREEN `13b9e72a` (feat)
3. **Task 3 (auto):** `2c5b5e37` (test)
4. **README:** `2fced40b` (docs, the social module lists `LockedPost`)

**Plan metadata:** committed separately (docs: summary, then state and roadmap).

## TDD Gate Compliance

`^test\(0*9-0*11\):` 3 commits, `^feat\(0*9-0*11\):` 2 commits, no REFACTOR commit; each TDD task has its `test(09-11)` commit before its `feat(09-11)` commit. `workflow.tdd_mode` is off and the plan is not `type: tdd`, so `gsd check tdd-red-evidence` was not run (Vitest emits no TAP); real runs are quoted, nothing was fabricated.

- **Task 1 RED (`723c85e2`):** the new modules were shipped as inert stubs (`LockedPost` renders an empty div, `LockedPostScreen` renders null, `post-focus` is a no-op) so a missing import could not stand in for a failure. Module `locked-post`: 5 of 5 failed on assertions. Web: `lib/feed.test.ts` 7 of 13 failed (P2, P3 and the five P4 cases, all `expected { status: 'error' }` where the new result or `not-found` was planned; P1, P5-P8 are negative controls that already held), `LockedPostScreen` S1-S6 6 of 6 failed (the elements are not found), `post-focus` F1, F2, F4 failed (F3, F5 hold on the stub), the 3 catalog pins failed.
- **Task 2 RED (`47494d95`):** no stubs were needed (the tests drive existing code): `feed-actions.test.ts` 7 failed (every follow_required case; the 14 community and generic controls passed), `comments-list-locked` 7 of 9 failed (the code argument on the community cases and the follow cases; 2 and 9 are controls), `FeedSurface` 2, `PostDetail` 2, `ReelsHost` 1 and the catalog pin 1 failed. The RED commit does not typecheck in the web test files (the label and the extra `onCommentsLocked` argument do not exist yet); it was fixed in the GREEN commit, the same task.
- **Task 3:** not a `tdd="true"` task; the component cases passed on arrival because the behavior was built in Task 1, and the e2e walks passed against the existing screen.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The edit page consumed `loadPost`'s union**
- **Found during:** Task 1 (web typecheck: `Property 'post' does not exist on type { status: 'follow-required' }` in `post/[postId]/editar/page.tsx`)
- **Fix:** `follow-required` is `notFound()` there (an edit screen is never a place to meet "Siga para ver"). **Commit:** `2c0e5772`
- **Files:** `apps/web/app/(app)/post/[postId]/editar/page.tsx` (not in the plan's list)

**2. [Rule 3 - Blocking] Files the plan did not list**
- `apps/web/lib/feed.test.ts` did not exist ("extend" became "create"); `post-focus.test.ts` (the one-shot has its own cases); `app/(app)/inicio/feed-actions.test.ts` (no test of the actions existed); `apps/web/components/feed/FeedSurface.test.tsx`, `PostDetail.test.tsx` (the host reactions and the focus), `packages/modules/feed/ui/index.ts` (the host needs the `CommentAccessRefusal` type), `packages/modules/social/README.md` (the `./ui` row), `apps/web/e2e/social-admin.ts` (`setPostRemoved`). **Commits:** `723c85e2`, `47494d95`, `2c0e5772`, `13b9e72a`, `2c5b5e37`, `2fced40b`.

**3. [Rule 1 - Bug avoided] The focus mark could outlive its refresh**
- **Issue:** `markFocusAfterFollow` is module state; a refresh that never landed would hand the focus to the same post on a later visit. A test of the failed-follow case even caught the leak from an earlier case.
- **Fix:** the mark carries a timestamp and goes stale after 10 s; `consumeFocusAfterFollow` clears it either way. **Commit:** `2c0e5772`

**4. [Rule 2 - Missing critical] The follow state survives a failed refresh**
- **Issue:** the skeleton replaces the card, which unmounts `FollowControl`; if the refresh itself failed the card would return reading "Seguir" although the follow had happened.
- **Fix:** the screen lifts a `followed` flag and remounts the control as "Seguindo". **Commit:** `2c0e5772`

**5. [Rule 1 - Bug in my own e2e] An over-eager `replace` removed a constant from another describe**
- **Found during:** the first full `social.spec.ts` run (2 failures, `MARCOS_NAME is not defined` in the 09-10 lists describe). Cause: my cleanup of an unused variable in the 09-11 block replaced the same two lines in the 09-10 block. Restored and re-run green. **Commit:** `2c0e5772`

### Judgment calls worth a reviewer's eye

- **Focus goes to the PostCard's `role="article"`, not to a heading.** The UI-SPEC says "the post's region heading"; the card already is the focusable region (`tabIndex -1`, `data-post-id`), and wrapping `PostDetail` in an element would have changed the page's flex/gap flow.
- **The skeleton test is structural.** "The swap moves nothing" is asserted as the same wrapper node and the same card classes with the same anchor sizes (S8); no pixel measure exists in this environment.
- **`social` off then on in the e2e** polls with `toPass` up to 90 s because the API and the web tier cache a tenant's modules for 30 s; locally the change was visible within the first poll (2 s per project).
- **A blank display name** renders "Siga  para ver" (see Issues); the plan has no fallback copy, so it was left and recorded.
- **Display-name catalog placement:** `feed.errors.followRequired` is in `feed.json` as the plan says, although its sibling `communityLocked` lives in `feed.store.json`; the loader merges both under the `feed` root.

### Design gate note (for /gsd-verify-work)

Sketch `012-phase-09-designed-screens` was approved provisionally by Igor in chat on 2026-10-19 (commit `48c79511`). The orchestrator wrote the README approval keys and the MANIFEST row on Igor's explicit instruction ("pode alterar voce mesmo"); this executor did not write or stage anything under `.planning/sketches/`. The precondition grep passed (`approved (provisional) by the product owner, 2026-10-19`). Designer review (D-33) remains a follow-up.

**Total deviations:** 5 (2 Rule 3, 2 Rule 1, 1 Rule 2). **Impact:** none on scope; every must-have truth has a test.

## Issues Encountered

- **`pnpm db:reset && pnpm db:seed` was NOT run** before any Playwright verify command (repo rule 3: no consent to reset). `social.spec.ts`, `reels.spec.ts` and `comunidades.spec.ts` ran on the existing local database. Logged in `.planning/WINDOWS.md` as `unrun-verify`. Everything the e2e touched is cleaned up: no throwaway tenant, user or post left, the follow table holds exactly the two seeded edges, Helena is `active` and `social` is on for rede-lab.
- **E2E results, stated plainly:** the final full `social.spec.ts` run: 103 passed, 3 skipped, exit 0 (two projects, local stack, `VIDEO_PROVIDER=fake`). The Task 2 verify command (`social.spec.ts reels.spec.ts comunidades.spec.ts`), run before the Task 3 cases existed: 192 passed, 10 skipped, exit 0. The known failures of `profile.spec.ts` and `admin-members.spec.ts` ("role tracer") were not selected by any of these commands and were not touched.
- **The blank-display-name edge** (see Deviations) and **the four comment-id routes of the API** (the 09-05 residual: an admin holding a blocked author's comment id can still read replies; the fix is `canModerate` plus the liveness test in `packages/modules/feed/server/service.ts`, API code outside this plan's files) are recorded in `deferred-items.md` and `.planning/WINDOWS.md` for the verifier.
- **Not run:** any real-device check, `turbo run build` as a goal of its own (the gate ran the web build because `typecheck` depends on it), `pnpm db:reset`/`db:seed`, pgTAP and the API integration suites (no SQL or API code changed).

## Verification Results

- `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4`: **37 of 37 tasks successful** on the full run, after Task 3.
- Counts after the last commit: web 190 files, 4,183 tests; module-social 7 files, 63 tests; module-feed 24 files, 318 tests; web typecheck, module typecheck, `biome check` clean (two pre-existing infos); `bash scripts/check-ui-literals.sh` OK; `pnpm boundaries`: 1,720 files in 18 packages, no issues; `apps/api/tests/unit/module-readmes.test.ts` 17 passed; `scripts/e2e-affected.test.ts` passed.
- Cleanup: `apps/web/.next` (1.4 GB), `apps/web/test-results` removed; no `next dev`, API or Playwright process left; free disk 7.5 GB.

## Known Stubs

None. The inert RED stubs of Task 1 (`LockedPost`, `LockedPostScreen`, `post-focus`) were fully replaced in `2c0e5772` (`grep "RED stub"` finds nothing under `apps` or `packages`).

## Threat Flags

None. No new endpoint, auth path or schema. T-09-27 is mitigated by the screen taking only `author` (a test passes a forged caption and a count and finds neither in the DOM) and the e2e asserting the received HTML holds the name and not the caption; T-09-38 by the strict author parse with a not-found fallback (five malformed bodies tested) and names rendered as React text; T-09-15 stays accepted exactly as planned (support, blocked author, `social` off and other tenants all get the bare not-found screen, proven by e2e).

## Next Phase Readiness

Ready for 09-13 (the phase's closing plan). Carry-overs: a clean `pnpm db:reset && pnpm db:seed` run of the three e2e files when Igor consents; the designer review of sketch 012 (D-33); a real-phone check of the tap, the focus move and the toast; the 09-05 comment-id residual; the blank-display-name edge.

## Self-Check: PASSED

- Created files exist (`LockedPost.tsx`, `locked-post.test.tsx`, `LockedPostScreen.tsx` and its test, `post-focus.ts` and its test, `lib/feed.test.ts`, `feed-actions.test.ts`): FOUND
- Commits `723c85e2`, `2c0e5772`, `47494d95`, `13b9e72a`, `2c5b5e37`, `2fced40b` exist; measured `commits: 6` from the persisted ledger
- RED before GREEN for both TDD tasks (`git log --grep` on `^test\(0*9-0*11\)` and `^feat\(0*9-0*11\)`): confirmed
- Acceptance greps (`follow-required` in `lib/feed.ts` and the post page, `line-clamp-2` in `LockedPost.tsx`, `markFocusAfterFollow` in the screen, `consumeFocusAfterFollow` in `PostDetail`, `"locked"` in `social.json`, `isFollowRequired`, `useFollowRequiredRefusal`, `follow_required` in `CommentsList`, `followRequired` in `feed.json`, `Publicação não encontrada` and `scrollWidth` in the spec): PASS
- No attribution trailer, no Claude or Anthropic mention in any of the six commit messages: confirmed (0 matches in `159cc041..HEAD`)

---
*Phase: 09-rede-social-follow-member-posts-and-explorar*
*Completed: 2026-10-20*
