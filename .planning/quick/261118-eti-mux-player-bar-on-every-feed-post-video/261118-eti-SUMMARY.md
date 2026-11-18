---
phase: quick-261118-eti
plan: 01
subsystem: web-media
tags: [feature, media, mux-player, feed, quick]
status: complete
commits: 3
plan_head_before: 612eaa118fbdeeb43ebdaae53bbf3ac7b50f1729
key-files:
  created:
    - apps/web/components/media/vendor-bar.ts
    - apps/web/components/media/vendor-bar.test.ts
  modified:
    - apps/web/components/media/FeedVideo.tsx
    - apps/web/components/media/FeedVideo.test.tsx
    - apps/web/components/media/video-sound.ts
    - apps/web/components/media/video-sound.test.ts
    - apps/web/components/media/VideoPlayer.tsx
    - apps/web/lib/feed-view.tsx
    - packages/modules/feed/ui/PostMedia.tsx
    - apps/web/e2e/feed-media.spec.ts
actuals:
  tasks: 3
  commits: 3
completed: 2026-11-18
---

# Quick 261118-eti: Mux Player bar on every feed post video Summary

Every READY feed post video now shows the vendor's bar (play and pause, a time bar to drag, speed 0.5 to 2, volume, 10 s back and forward, fullscreen, hotkeys while the player has focus), wired so it never fights the feed's autoplay, one-at-a-time turn, shared sound or card gestures. Web only: no SQL, no API change, no dependency, no catalog key.

## What shipped

Three path-scoped commits, no trailer, nothing pushed (`git rev-list --count 612eaa11..HEAD` = 3):

- `199719bb` Task 1 (tracer): new `vendor-bar.ts` (`SEEK_STEP_SECONDS`, `PLAYBACK_RATES`, now shared with `VideoPlayer`, and `isVendorBarEvent`, the vendor's own gesture-layer rule read from `composedPath()[0]`). `FeedVideo` passes `forwardSeekOffset`/`backwardSeekOffset` 10, the 0.5 to 2 `playbackRates`, stops passing `nohotkeys`, and drops `--controls: none` while healthy (it returns in the error state, so the catalog line and the retry are the whole state; `--dialog: none` stays). The frame swallows only SURFACE clicks. A `Set` of pointer ids filled on `onPointerDownCapture` records presses that STARTED on the bar; `onPointerDown`, `onPointerUp` and `onPointerCancel` stop those from reaching `DoubleTapHeart`, so a bar press never likes, opens Reels, pauses, holds or bursts the heart, even when a scrub ends over the video. A press that starts on the video and ends over the bar ends normally. The corner sound button moved from `bottom-3` to `top-3`.
- `e8fc15f5` Task 2: an effect on the frame carries the vendor's `mediapauserequest` (member pause, sticks across scrolling and tab changes), `mediaplayrequest` (clears the pause and bumps `claims` to take the turn), `mediamuterequest` and `mediaunmuterequest` (`setVideoSoundWanted`). Our own scroll-out and tab-hidden pauses dispatch none of these, so they are never read as intent. `video-sound`'s `onGesture` returns early on a bar event, so a bar button never double-toggles a held-back video's sound. A `fullscreenchange` listener makes `--media-object-fit` `contain` while `document.fullscreenElement` is inside the frame, `cover` after exit.
- `24d5a262` Task 3: the e2e case that asserted "no bar" is rewritten for the bar (written, typechecked, linted, NOT run); `FeedVideo`, `VideoPlayer`, `feed-view` and `PostMedia` comments now describe the bar and where it is wired. Comments and the e2e only.

Scope check: the three commits together list exactly the ten planned files; `git status --short` for those paths is clean; nothing else was staged.

## Red first (real output)

Task 1, `vitest run components/media/FeedVideo.test.tsx components/media/vendor-bar.test.ts components/media/VideoPlayer.test.tsx` before any implementation: `Test Files 2 failed | 1 passed`, `Tests 7 failed | 68 passed`; `vendor-bar.test.ts` failed to resolve `./vendor-bar`. Failing cases, with reasons:

- `hands the vendor the bar and its hotkeys, the 10 s jumps and the 0.5 to 2 speeds, and no muted`: props still carried `nohotkeys` and no seek offsets.
- `a click on the bar reaches the vendor: the bar's buttons work`: `expected "vi.fn()" to be called 1 times, but got 0 times` (the capture rule swallowed it).
- `the sound button moved to the top right, off the bar's fullscreen button`: no `top-3` in the class.
- `two quick taps on the bar like nothing, open nothing, burst nothing and pause nothing`, `one tap on the bar opens nothing, and pauses nothing in a card with no Reels`, `a press that starts on the bar and ends on the video is no tap`: `expected "vi.fn()" to not be called at all, but actually been called 1 times` (the bar press liked or opened).
- `a press held on the bar does not hold the video`: `expected true to be false` (the video paused on the hold).
- Already green before the change, kept as regression guards: the frame box case, the video click swallowed, hold that starts on the video and ends over the bar, cancel leaves no stale press.

Task 2, before implementation: `FeedVideo.test.tsx` `Tests 8 failed | 54 passed`; `video-sound.test.ts` `Tests 1 failed | 14 passed` (`expected [ false, true, false ] to deeply equal [ false, true ]`). Failing cases: bar pause sticks across scrolling, bar pause sticks across a tab change, bar play clears the pause and plays while any of the frame is in view, one at a time with the bar, mute and unmute are the visit's sound, reduced motion plus bar play, browser fullscreen contains the video (`expected 'cover' to be 'contain'`), a bar press on a held-back video is no sound gesture and no pause, and the `video-sound` bar-event case. Already green (guards): our own pauses never read as intent, the error state hides the bar and the retry restores it (Task 1 already did it), another element's fullscreen leaves the fit alone.

## Green (real output)

- After Task 1: `Test Files 3 passed (3)`, `Tests 81 passed (81)` (FeedVideo, vendor-bar, VideoPlayer, all pre-existing cases unedited).
- After Task 2: `vitest run components/media`: `Test Files 11 passed (11)`, `Tests 168 passed (168)`.

## Gates (run from the repo root with the CI env exported)

| Gate | Result |
| --- | --- |
| `biome format --write` then `biome check` on the ten files | clean, no fixes |
| `pnpm lint` (Biome plus `check-ui-literals.sh`) | exit 0 |
| `pnpm turbo typecheck build test --concurrency=4` | 41 of 41 tasks successful (`EventsSections` flake did not trip) |
| `pnpm check:static-routes` | exit 0 |
| `pnpm boundaries` | exit 0 |
| `pnpm boundaries:negative` | exit 0 |
| `pnpm guard:lanes` | exit 0 |
| `pnpm guard:hooks` | exit 0 |
| `pnpm guard:workflows` | exit 0 |
| `pnpm --filter @rede-social/module-feed test` | 27 files, 345 tests passed |
| `pnpm --filter @rede-social/web test` (whole suite) | 416 files, 10022 tests passed |

Known reds not caused by this task and not run: pgTAP 120, 141, 154, 232; isolation b3, b8 and the phase-10 sweep; move-copy. The `EventsSections` Em breve flake did not appear. Playwright was NOT run. `.turbo/cache`, `apps/web/.next/cache` and `apps/web/.next/dev` were removed after the build gates; free disk stayed at 12 GiB.

## Decisions taken

- Origin rule is the vendor's own: bar when the real origin (`composedPath()[0]`) is inside a `mux-player` and is not `video`, `media-controller` or the host. A missing path fails closed toward today's behavior (surface). A happy-dom probe showed a composed event crosses an open shadow root, so the shadow-root case is covered by a test.
- Press-start rule: where the press STARTED decides (Set of pointer ids), not where it ended.
- Sound button to the top right; kept (it is the only in-place sound switch when the tap opens Reels and what `Ativar som` reads on). Hidden keyboard pause button kept.
- Hotkeys on (mvo's choice), vendor theme, autohide and the pre-playback centre play button left as the vendor has them; a click on the centre play button plays in place (a bar play request), it does not open Reels.
- Fullscreen contain through the standard `fullscreenchange` and `document.fullscreenElement` only; iPhone's native video fullscreen contains already.
- `mediavolumerequest` (slider) and the seek requests are not bridged (documented in the docblock).

## Unchanged

Reels (`ReelVideo`), stories (`StoryVideo`) and `VideoPlayer` in both modes behave as before (its cases pass unedited; it only imports the two constants from `vendor-bar` now). The processing, failed and rejected frames are untouched. The vendor labels stay in English: media-chrome's pt dictionary is not bundled and `media-chrome` is not a direct dependency, so closing it needs Igor's dependency decision (the same open item as quick 261117-mvo).

## e2e not run

`apps/web/e2e/feed-media.spec.ts` was rewritten (retitled 2026-11-18; it now asserts `--controls` is not `none`, no `nohotkeys` attribute, still autoplays, and the corner sound button name) and was typechecked and linted only. `reels.spec.ts` and `social.spec.ts` were reviewed and left alone: their taps hit the video surface with the stream hung, where the vendor bar is `display: none` before first play. `stories.spec.ts` is about stories. Playwright needs the local stack, which the constraints forbid.

## Manual checks only a real browser can do (Igor, phone and desktop, after deploy; nobody has done them)

1. Phone width, shortest frames (1.91:1 is about 205 px tall): the bar, the speed menu and the touch targets fit.
2. The autohidden bar's bottom strip still takes taps (vendor `opacity: 0`, not `pointer-events: none`): a double tap there does not like. Vendor behavior, not mitigated.
3. The centre play button before the first play, on a video waiting below the fold and under reduced motion: it plays in place, does not open Reels.
4. Desktop fullscreen: the video is contained (not cropped) and covers again on exit.
5. iPhone native fullscreen.
6. A bar play on a second video while another one plays: the second takes the turn and the first pauses; a bar pause then scrolling away and back does not resume it.
7. The corner sound button against the bar in every ratio (9:16, 4:5, 16:9, 1.91:1), and `Ativar som` on a video the browser held back, including a bar mute and unmute.
8. A tap on the video itself still pauses or opens Reels, a double tap likes, a hold pauses; a tap on any bar button does none of those.

## Deviations from Plan

None. The plan's Task 1 listed the error-state rule under Task 2's tests; the conditional `--controls: none` was implemented in Task 1 (the vendor props step), so those Task 2 cases were guards that already passed.

## Known Stubs

None.

## Threat Flags

None new. T-261118-eti-03 mitigated and tested (error state hides the bar, `--dialog: none` stays); the accepted threats stand; no token handling, dependency or endpoint changed.

## Self-Check: PASSED

All ten files exist; commits `199719bb`, `e8fc15f5` and `24d5a262` are on `master`; no co-author trailer; nothing pushed.
