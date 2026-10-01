---
phase: 07-notifications-web-push-chat
plan: 13
subsystem: testing
tags: [gap-closure, exit-gate, feed, double-tap, FEED-04, test-isolation, WINDOWS-64, truth-15, playwright]

requires:
  - phase: 07-notifications-web-push-chat
    provides: "07-11's exit-gate trace (unlike-only double tap) and 07-VERIFICATION truth 15 gap item 2; 07-12's harness-owned PLATFORM_HOST"
provides:
  - "apps/web/e2e/admin.ts: feedPostLikeState(postId, email) and clearFeedPostLike(postId, email), scoped to one post and one member"
  - "FEED-04 cases that clear their own like before login and in finally, guard the rendered start, confirm each write in the database, and count the like requests per post"
  - "double-tap-timing annotation (pointerup handler gap and event-time gap)"
  - "scrollFeedToBottom waits for React's hydration mark on the scroll root before scrolling"
  - "The Double-tap verdict: T"
affects: [07-14, 07-15, pnpm verify exit gate]

actuals:
  tokens: 3551
  tasks: 2
  commits: 2
plan_head_before: d88293782db06ba740bc7907e86cea80d34bdb65

tech-stack:
  added: []
  patterns:
    - "A like case owns its own like: clear it in the database before login and in finally, assert the start in the database and on screen, and confirm every write through the server's response and the database"
    - "Like requests for one post are counted by a POST whose postData carries the post id (the reels e6 precedent)"
    - "A spec scrolls the app's scroll root only after React has hydrated it (ScrollRoot resets the position on mount)"

key-files:
  created: []
  modified:
    - apps/web/e2e/admin.ts
    - apps/web/e2e/feed.spec.ts

key-decisions:
  - "07-13 Double-tap verdict T: a member's double tap within about 1 s of load unlikes a post only when that post is already liked (Phase 4's one-toggle design). The 07-11 red was a like left behind by an earlier run on the shared member and gallery post"
  - "07-13: scrollFeedToBottom waits for React's hydration mark on main.app-scroll, because ScrollRoot's mount effect undoes a scroll that lands before hydration (the 05.3 page-2 race, 3/30 before, 0/30 after). This is a deterministic precondition, not a wait or retry, and the double-tap case never calls it"

patterns-established:
  - "Fixture-only like helpers scoped to one post id AND one member e-mail; like_count stays right through its trigger"

requirements-completed: [NOTIF-01, NOTIF-02, NOTIF-03, NOTIF-04, EVENT-07, PWA-02, CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05]

coverage:
  - id: D1
    description: "07-11's double-tap signature reproduced on HEAD from a dirty start: the like inserted first, the case failed at 'Descurtir', the database went from 1 like to 0, and the trace showed one server action carrying the gallery post id (the unlike)"
    verification:
      - kind: e2e
        ref: "psql insert of the member's like on the gallery post; playwright test feed.spec.ts -g 'double tap on the gallery' --project=desktop-chromium on d882937 (1 failed at line 341); count after = 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "From a restored start the double tap sends exactly one like request and leaves one row, with both pointerups reaching the wrapper at most 0.3 ms apart, on both projects"
    verification:
      - kind: e2e
        ref: "playwright test feed.spec.ts -g 'double tap on the gallery' --project=desktop-chromium --repeat-each=20 (20 passed) && --project=mobile-chromium --repeat-each=5 (5 passed)"
        status: pass
      - kind: e2e
        ref: "dirty-start verify: insert the like, run the desktop case (1 passed), member's like count afterwards = 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every FEED-04 case clears its own like before login and in finally, asserts the database start state and the rendered 'Curtir', and confirms each like/unlike through the server and the database. The FEED-04 describe holds across both projects and repeats"
    verification:
      - kind: e2e
        ref: "playwright test feed.spec.ts -g FEED-04 --repeat-each=6 (36 passed, after the hydration precondition)"
        status: pass
      - kind: e2e
        ref: "playwright test feed.spec.ts -g 'a tap fills' --project=mobile-chromium --repeat-each=18 (18 passed)"
        status: pass
      - kind: other
        ref: "psql: member's likes on the gallery post and the first filler = 0 after all runs"
        status: pass
    human_judgment: false
  - id: D4
    description: "The plan's whole-file gates: feed.spec.ts --repeat-each=3 and feed-media.spec.ts feed.spec.ts"
    verification:
      - kind: e2e
        ref: "playwright test feed.spec.ts --repeat-each=3 (64 passed, 9 skipped, 5 failed: all UI-D-20 repeat iterations, pre-existing, see Issues)"
        status: fail
      - kind: e2e
        ref: "playwright test feed-media.spec.ts feed.spec.ts (run A 31 passed 3 skipped; run B 30 passed 1 failed 3 skipped: feed-media desktop dot race, pre-existing, see Issues)"
        status: fail
    human_judgment: true
    rationale: "Every FEED-04 and other feed.spec case passed. The reds are two pre-existing races outside this plan's files: the UI-D-20 fixture recreating its tenant under the same host on every repeat, and a non-retrying dot read in feed-media.spec. The developer decides whether 07-15 needs them fixed (the full gate does not repeat specs)"

duration: 28min
completed: 2026-10-01
status: complete
---

# Phase 7 Plan 13: Desktop double-tap gap (WINDOWS 64): finding and self-restoring FEED-04 cases Summary

**The 07-11 desktop double-tap red was a like left over from an earlier run. The double tap toggles a post the member already likes, so a leftover turned the gesture into an unlike. This was proven on HEAD and then disproven as a product fault across 25 clean-start repeats. Every FEED-04 case now restores and checks its own like in the database. A hydration precondition in `scrollFeedToBottom` closes the page-2 race recorded in 05.3.**

## Performance

- **Duration:** about 28 min
- **Started:** 2026-10-01T11:24:08Z
- **Completed:** 2026-10-01T11:52Z
- **Tasks:** 2
- **Files modified:** 2 (`apps/web/e2e/admin.ts`, `apps/web/e2e/feed.spec.ts`), plus two deferred-items ledgers

## Double-tap verdict

**Verdict: T.** A member's double tap within about 1 s of load unlikes a post **only when that post is already liked**, rendered "Descurtir". That is Phase 4's designed toggle: one toggle with three entry points, so `PostCard` passes `onDoubleTapLike={toggle}`. It is not a bug. LiveShell's load-time fetch did not stretch the gesture.

**Step 1: the 07-11 signature on HEAD (`d882937`, before any edit).**
- The member's like on the gallery post was inserted first. The count was 1 before the run and `like_count` was 1.
- The desktop case failed at line 341, `expect(…'Descurtir').toBeVisible()`, because the element was not found.
- The count afterwards was **0**: the double tap had unliked an already-liked post.
- The trace showed exactly one server action carrying the gallery post id (`0d000000-…-000000000003`, action `40ec9c41…`), so the gesture caused a single request and it was the unlike. The two other `/inicio` POSTs carried only an asset id (`…00a4`, the video's playback mints).
- No row needed restoring afterwards: the count was already 0.

**Step 4: clean-start evidence (the case as rewritten in Task 1).**

| Run | Result | Like requests per double tap | Database after the like | Largest handler gap | Largest event-time gap |
|---|---|---|---|---|---|
| desktop-chromium `--repeat-each=20` | 20/20 passed | 1 in every repeat (asserted) | `{ liked: true, likeCount: 1 }` in every repeat (asserted) | 0.3 ms | 0.3 ms |
| mobile-chromium `--repeat-each=5` | 5/5 passed | 1 in every repeat | `{ liked: true, likeCount: 1 }` in every repeat | 0.3 ms | 0.1 ms |
| dirty start (like inserted, then the desktop case) | 1/1 passed | 1 | count 0 afterwards | n/a | n/a |
| later: FEED-04 `--repeat-each=6`, both projects | 12/12 double-tap runs passed | 1 | 1 row | 0.3 ms | 0.2 ms |

Every repeat recorded exactly 2 `pointerup`s on the strip.

**What this answers:**
- The double tap never sent an unlike, or a second request, from a card rendered "Curtir". That rules out S2, a like-state bug.
- It never failed to send its like. That rules out S1, a window stretched by a main-thread stall.
- The 07-11 failure was a like left over from an earlier run. The case's old cleanup asserted only the optimistic "Curtir" and the page closed straight after, so its unlike could be lost.
- Both candidates fit: an earlier repeat (the verifier's `--repeat-each=4` red came 1 of 4), or this case's run on the other project, which uses the same member and post. The evidence does not say which one it was in 07-11's own runs, because those runs left no database snapshot.
- The 07-11 entry "a failed like reverts…" failed right after, consistent with the same residue. Its case clicks "Curtir" on a post another case had left liked.

**Caveats the developer should know:**
- Playwright's `dblclick` dispatches both clicks back to back, so the handler gap measures only that nothing between the two events stalled the handler: 0.3 ms at most.
- It cannot replay a human-paced double tap (about 100-250 ms apart). By `DoubleTapHeart`'s code, though, a stall between two human taps can only push the second tap into a new window. That sends **no** request; it cannot produce an unlike.
- **Product note, no code planned:** the feed's double tap toggles (Phase 4 design), while the Reels double tap only likes (D-128). Whether the feed's double tap should become like-only, so that a member never unlikes by double-tapping a photo, is a product decision outside this gap.

## Accomplishments

- **07-11's signature reproduced and explained** before any edit. See the verdict above.
- **`admin.ts`** gained two fixture-only helpers next to `feedPostIdFor`, using the same `sql()` superuser fixture client:
  - `feedPostLikeState(postId, email)` returns `{ liked, likeCount }`.
  - `clearFeedPostLike(postId, email)` deletes only that member's like on that post and returns the row count. The trigger keeps `like_count`.
- **The double-tap case:**
  - It clears and asserts the database start before login, and guards the rendered start ("Curtir", no like segment).
  - It counts the POSTs that carry the gallery id and arms `waitForResponse` before the gesture.
  - A capture-phase `pointerup` probe on the strip records `performance.now()` and `event.timeStamp`.
  - After the optimistic asserts it awaits the like and asserts exactly 1 request and `{ liked: true, likeCount: 1 }`, then pushes the `double-tap-timing` annotation.
  - The reload asserts are unchanged ('1 curtida', never '2 curtidas').
  - The cleanup waits for the unlike's response and asserts `{ liked: false, likeCount: 0 }`. A `finally` clears again.
- **The tap and failed-like cases:**
  - Both do the same start restore, database assert and rendered "Curtir" guard on the first filler.
  - The tap case confirms its like and its unlike through the server and the database.
  - The failed like asserts the database still holds no like after the revert. `breakServerActions` and every existing assertion stay as they were.
  - Both clear again in `finally`.
  - The FEED-04 describe closes the fixture client in `afterAll`.
- **The page-2 race after a reload is closed.** This was the 05.3 deferred `feed.spec.ts:355` item:
  - Running the rewritten tap case surfaced it 3 times in 30 mobile runs (line 362). Each time the snapshot held only page 1 (10 cards), and the trace showed no load-more request after the reload.
  - Cause: `ScrollRoot`'s mount effect (`scrollTo({ top: 0 })` keyed on the pathname) undoes a scroll that lands between the load event and hydration.
  - `scrollFeedToBottom` now waits for React's hydration mark (`__reactProps`) on `main.app-scroll` before scrolling. This is the suite's existing `waitForHydration` proof.
  - Afterwards: 0 of 30 mobile tap runs failed (18/18 alone, 36/36 for FEED-04 on both projects).
  - The pre-07-13 tap case ran 18/18 alone as a baseline, so the plan-mandated await of the like response before the reload probably shifted this pre-existing race's timing.

## Task Commits

1. **Task 1: reproduce, helpers, double-tap case, verdict** - `2314e58` (test)
2. **Task 2: tap and failed-like cases, hydration precondition** - `1ff843a` (test)

**Plan metadata:** recorded in the docs commit that adds this SUMMARY.

## Files Created/Modified

- `apps/web/e2e/admin.ts`: `feedPostLikeState` and `clearFeedPostLike`.
- `apps/web/e2e/feed.spec.ts`: the request-matching helpers `carriesPost`, `countPostRequests` and `nextPostResponse`, plus `anyLikeSegment` (built from the catalog) and `LIKER`. Also the three self-restoring FEED-04 cases, the `afterAll(closeAdmin)` and the hydration precondition in `scrollFeedToBottom`.
- `.planning/phases/07-notifications-web-push-chat/deferred-items.md`: the desktop double-tap entry is resolved, and two pre-existing reds are recorded (below).
- `.planning/phases/05.3-reels/deferred-items.md`: the `feed.spec.ts:355` race is resolved, with the evidence.

## Decisions Made

- **Verdict T,** by the rule the plan fixed in advance. No settle, wait, retry or timing change touches the double tap, and no product code changed. `git diff d882937..HEAD` outside `apps/web/e2e/` is empty.
- **The hydration precondition is a Rule 1 fix inside the FEED-04 file.** The plan required the file to be stable across repeats, and the race sat in the reload steps the plan kept unchanged.
  - The fix is deterministic: it waits for a proven mechanism, adds no sleep, and does not re-run anything.
  - It loosens no assertion.
  - The double-tap case never calls `scrollFeedToBottom`, so the verdict's evidence is untouched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `scrollFeedToBottom` could scroll before hydration, so page 2 never loaded after a reload**
- **Found during:** Task 2 (the whole-file repeat runs).
- **Issue:** the tap case failed at line 362 in 1 of 6 mobile runs (twice in FEED-04 `--repeat-each=6` runs and once in an 18-run alone). Each failure showed only page 1 and no load-more POST after the reload. `ScrollRoot` resets the scroll root to the top on mount.
- **Fix:** wait for `__reactProps` on `main.app-scroll` before scrolling.
- **Files modified:** `apps/web/e2e/feed.spec.ts`
- **Verification:** 18/18 for the tap case alone on mobile, and 36/36 for FEED-04 on both projects.
- **Committed in:** `1ff843a`

---

**Total deviations:** 1 auto-fixed (Rule 1).
**Impact on plan:** it makes the plan's own repeat gate meaningful. No scope creep into product code.

## Issues Encountered

Two pre-existing reds outside this plan's files keep the plan's whole-file verify commands from being fully green. Both are recorded with evidence in `07-…/deferred-items.md`, and neither is a like case.

1. **`feed.spec.ts --repeat-each=3`:** 64 passed, 9 skipped and **5 failed**. All 5 failures are "UI-D-20 — a community with nothing published", on the 2nd and 3rd iterations only.
   - The describe recreates its empty tenant under the same slug and host on every repeat, and the member then lands on "Endereço incorreto".
   - Reproduced with `-g "UI-D-20" --project=desktop-chromium --repeat-each=2` and no FEED-04 case in the run: 2 passed, 2 failed.
   - The first iteration passes, and so does any non-repeated run. The full `pnpm verify` gate does not repeat specs.
   - An earlier run of the same command, before the hydration fix, failed 7 or 8 cases. Seven were UI-D-20. The extra failure was one mobile "a failed like reverts…" case, whose output a later run overwrote. Its signature is therefore unknown. The likely candidate is the page-2 race the hydration fix closed (that case also scrolls to page 2 first).
2. **`feed-media.spec.ts feed.spec.ts`:** run A passed 31 with 3 skipped. Run B passed 30, failed **1** and skipped 3.
   - The failure is `feed-media.spec.ts:76` on desktop. After `ArrowLeft` the live region read "2 de 3", but the non-retrying `activeDot` read 2.
   - In isolation the case passed 20/20 (`--repeat-each=10`, both projects).
   - 07-13 did not touch that file.

The database checks all hold: the member's likes on the gallery post and on the first filler number **0** after every run.

No `.env*` file was read or changed. No reset or seed ran. The only database writes were this plan's scoped like insert and deletes. Disk stayed at 12 GiB free, so `.turbo/cache` was not touched. Ports 3000, 8787 and 8788 are free. A temporary baseline spec (`e2e/zz-feed-baseline-tmp.spec.ts`, a copy of `d882937`'s file) was created untracked and deleted after its run.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- Gap item 2 of truth 15 (WINDOWS 64) is explained and closed in the spec. Next are 07-14 (the C-WR-03 regression tests for `/notificacoes`) and 07-15 (the turbo `.next/types` race, the consented reset and the full `pnpm verify`).
- For 07-15: the two open reds above do not affect a single non-repeated gate run of `feed.spec.ts`. `feed-media.spec.ts:76` is a rare race that the gate could still hit, and its fix path is in deferred-items.
- For the developer: decide whether the feed's double tap should stay a toggle (Phase 4) or become like-only like Reels (D-128).

## Self-Check: PASSED

- FOUND: apps/web/e2e/admin.ts, apps/web/e2e/feed.spec.ts
- FOUND: 2314e58, 1ff843a (`git rev-list --count d882937..HEAD` = 2)
- Acceptance: 2 helper exports, 1 `double-tap-timing`, 6 `clearFeedPostLike(`, 8 `feedPostLikeState(` in feed.spec.ts, and no file outside `apps/web/e2e/` changed.
