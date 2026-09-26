## Deferred Items

- `feed.spec.ts` fails 4 cases on the `:3100` production build and passes under `next dev`
  status: open
  **Found during:** 05.3-09 Task 3 (the exit gate's `:3100` rerun, made for `stories.spec.ts`, which the dev overlay blocks).
  **What:** On `next start -p 3100` these cases fail:
  - mobile "pull-to-refresh re-reads page 1 and replaces the list": 30 cards where 20 were expected.
  - desktop "the sentinel appends one page per intersection and then stops".
  - "a failed like reverts, toasts, and never removes the card", on both projects: a strict-mode violation, because two "Aviso 1" cards are on screen.
  All three read as the infinite-scroll sentinel appending more than one page per intersection when the production build renders faster. The same spec passes under `next dev`: in the gate run 13/0/0 mobile and 9/1/3 desktop (the one failure is the race in the next item), and in an isolated rerun 23 passed, 3 skipped.
  **Why deferred:** 05.3 changed no feed surface Início uses. `git diff 2a7cec3..HEAD` over `apps/web/lib/feed.ts` adds an optional `media` parameter only Reels passes, and `LikeButton`'s default tone is byte-identical (pinned by 05.3-06's tests). `feed.spec.ts` had never been run on `:3100` before (05.2-12 ran stories, comunidades and the two smokes there). Out of this plan's scope under the scope-boundary rule.
  **Suggested next step:** run `feed.spec.ts` on a `:3100` build of `2a7cec3` to confirm it predates 05.3. Then either make the sentinel test wait for exactly one append, or check `FeedWidget`'s sentinel for a double append in production.

- `feed.spec.ts:355` raced once under `next dev` in the gate run (desktop)
  status: open
  **Found during:** 05.3-09 Task 3.
  **What:** after `page.reload()` the case calls `scrollFeedToBottom` at once. The page snapshot at failure shows only page 1 (10 cards), so the scroll ran before the list could trigger the sentinel, and "Aviso 1" (page 2 since 05-03) never loaded. An isolated rerun passed on both projects.
  **Suggested fix:** in the spec, wait for the first card after the reload before scrolling.

- `phase2-smoke.spec.ts` case 1 fails on `:3100` (all three projects; the rest of the serial file then skips)
  status: open
  **Found during:** 05.3-09 Task 3.
  **What:** the invite mail link is built for the API's configured web origin (`:3000`). The case expects `http://e2e-smoke-….localhost:3100/auth/confirm`. This is an environment mismatch of the port-swapped run, not a product change. The spec passes under `next dev` (mobile 5/0/0, pixel 2/0/3, desktop 5/0/0).
  **Suggested next step:** none for the product. A `:3100` harness that also needs this spec must start the API with the matching web origin.

- REELS-08 under a real network loss: Next 16.3's offline retry holds a failed server action
  status: open
  **Found during:** 05.3-09 Task 2 (e15/e17).
  **What:** with `experimental.useOffline` on (PWA-01), a server action whose POST fails at the NETWORK is not rejected. Next probes `HEAD /reels?_rsc` and re-sends the action until connectivity returns. So on a real network loss, a lane's first page and the load-more stay in their loading state (no "Não foi possível carregar os vídeos." / "…mais vídeos." toast) until the network is back, and then they succeed. The UI-SPEC error states appear when the API answers badly (e15/e17 prove them with a 500). The mints behave the same way.
  **Why deferred:** a decision, not a defect this plan can settle. It may be the intended offline posture (the app's offline banner covers the loss), or the UI-SPEC may want a timeout that surfaces UI-D-93a/c during a long offline stretch. Verification should decide.
