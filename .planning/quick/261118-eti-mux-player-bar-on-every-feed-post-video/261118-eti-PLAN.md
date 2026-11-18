---
phase: quick-261118-eti
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/components/media/vendor-bar.ts
  - apps/web/components/media/vendor-bar.test.ts
  - apps/web/components/media/FeedVideo.tsx
  - apps/web/components/media/FeedVideo.test.tsx
  - apps/web/components/media/video-sound.ts
  - apps/web/components/media/video-sound.test.ts
  - apps/web/components/media/VideoPlayer.tsx
  - apps/web/lib/feed-view.tsx
  - packages/modules/feed/ui/PostMedia.tsx
  - apps/web/e2e/feed-media.spec.ts
autonomous: true
requirements: []
tags: [feature, media, mux-player, feed, quick]

estimate:
  tokens: 60000
  raw_tokens: 60000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "Every READY FeedVideo hands the vendor the bar (locked decision 1): `nohotkeys` is no longer passed, `--controls: none` is no longer in the style, `forwardSeekOffset` and `backwardSeekOffset` are 10, `playbackRates` is the explicit 0.5 to 2 list, while `--dialog: none`, `--media-object-fit: cover`, `--media-background-color: transparent`, `noMutedPref`, `noVolumePref`, `loop`, `playsInline`, `streamType` and the `preload` rule stay exactly as today. The processing, failed and rejected frames (the `VideoPlayer` fallback) are untouched."
    - "A press, tap, hold or click that lands on the vendor's own bar, centre buttons or menus (a pointer or click event whose real origin, `composedPath()[0]`, lies inside a `mux-player` and is not the `video`, the `media-controller` or the host itself, the vendor's own gesture-layer rule) reaches the vendor and NEVER likes the post, opens Reels, pauses, starts a hold, bursts the heart or counts as the double tap's first tap. A press that STARTS on the bar is never a tap on the surface even if it ends on the surface (a scrub that ends over the video); a press that starts on the surface and ends over the bar still ends normally (a hold resumes). The video surface keeps its taps exactly as before, and a surface click is still swallowed in the capture phase so the vendor never toggles play by itself (locked decision 2)."
    - "The bar's own pause, play, mute and unmute requests (the vendor's bubbling composed events `mediapauserequest`, `mediaplayrequest`, `mediamuterequest`, `mediaunmuterequest`, which only the bar, the hotkeys and the gesture layer dispatch, never a programmatic play, pause or muted write) are carried into the feed's shared state (locked decision 3): a bar pause sets the member's pause, so scrolling away and back or switching tabs does NOT resume it; a bar play clears it and takes the turn (one video at a time, the previously playing one pauses) and plays while any of the frame is in view; a bar mute or unmute is the visit's sound (`setVideoSoundWanted`). Our own scroll-out and tab-hidden pauses are not read as intent. Reduced motion is unchanged: nothing autoplays, a bar play or a tap starts it."
    - "A touch or click on the bar is not a sound gesture: `video-sound`'s document-level gesture hook ignores events that come from the vendor's bar, so a bar button never double-toggles the sound of a video the browser held back, and the frame's `unlocking` note is never left set by a bar press (the next surface tap on a held-back video still unmutes inside the touch and is not a pause)."
    - "The error state hides the bar: while the player is in the error state `--controls: none` returns, the catalog line `feedVideo.error` and the retry are the whole state, and the retry remount brings the bar back. The vendor error dialog stays hidden (`--dialog: none`)."
    - "In browser fullscreen the video is contained, not cropped: while `document.fullscreenElement` is inside the frame, `--media-object-fit` is `contain`; it returns to `cover` on exit."
    - "No layout shift when the bar appears: the frame box (`aspect-ratio` from the video's clamped ratio, `overflow-hidden`, the `md` narrowing, the 4:5 fallback, the poster) is unchanged, because the bar is the vendor's own overlay inside the player; the corner sound button, which would sit on the bar's fullscreen button, moves from the bottom right to the top right and stays (always there while the video can play, `data-video-sound`, `Ativar som` when the browser held the sound back)."
    - "Everything else the feed guarantees still holds: autoplay at 60 percent in view, one video at a time with the newest taking the turn, the shared sound preference, the suspension under Reels, hold-to-pause, double tap likes through `usePostVideoGestures`, one tap opens Reels when the card offers it, the keyboard pause button, the ratio learning from the poster. Reels (`ReelVideo`), stories (`StoryVideo`) and `VideoPlayer` in both of its modes behave exactly as before, and the vendor's bar labels stay in English (no translation, no dependency)."
  artifacts:
    - path: "apps/web/components/media/vendor-bar.ts"
      provides: "SEEK_STEP_SECONDS, PLAYBACK_RATES (shared with VideoPlayer) and isVendorBarEvent, the origin rule shared by FeedVideo and video-sound"
      contains: "isVendorBarEvent"
    - path: "apps/web/components/media/vendor-bar.test.ts"
      provides: "the origin rule: bar control true; video, media-controller, host and outside elements false"
      contains: "isVendorBarEvent"
    - path: "apps/web/components/media/FeedVideo.tsx"
      provides: "the bar props, the bar/surface event split, the intent bridge, the error rule, the fullscreen fit, the moved sound button, the honest docblock"
      contains: "mediapauserequest"
    - path: "apps/web/components/media/FeedVideo.test.tsx"
      provides: "the rewritten no-chrome case and the new bar cases (vendor props, isolation, bridge, error, fullscreen)"
      contains: "mediaplayrequest"
    - path: "apps/web/components/media/video-sound.ts"
      provides: "onGesture ignores events from the vendor's bar"
      contains: "isVendorBarEvent"
    - path: "apps/web/e2e/feed-media.spec.ts"
      provides: "the feed video 'no bar' case rewritten for the bar (written, typechecked and linted, NOT run)"
      contains: "2026-11-18"
  key_links:
    - from: "apps/web/components/media/FeedVideo.tsx"
      to: "apps/web/components/media/vendor-bar.ts"
      via: "isVendorBarEvent, SEEK_STEP_SECONDS, PLAYBACK_RATES"
    - from: "apps/web/components/media/video-sound.ts"
      to: "apps/web/components/media/vendor-bar.ts"
      via: "isVendorBarEvent in onGesture"
    - from: "apps/web/components/media/FeedVideo.tsx (frame listeners)"
      to: "apps/web/components/media/video-sound.ts"
      via: "setVideoSoundWanted on the mute and unmute request events"
    - from: "apps/web/components/media/VideoPlayer.tsx"
      to: "apps/web/components/media/vendor-bar.ts"
      via: "the shared seek step and rates constants"
---

<objective>
Show the Mux Player bar (play and pause, a draggable time bar, speed, volume, 10 s back and forward, fullscreen) on EVERY ready feed post video, the way quick 261117-mvo did for lessons, replays and the library preview, while the feed keeps everything it already guarantees.

Purpose: on 2026-11-18 Igor saw a feed post video in production with no way to pause, scrub or speed it up ("nao esta aparecendo o player para pausar, play, controlar a minutagem, acelerar"). He chose "all feed videos", not only long ones. The feed does not use `VideoPlayer`; it renders `@mux/mux-player-react` itself in `FeedVideo` with in-view autoplay, tap gestures, a shared one-at-a-time turn and a shared sound rule, so the bar needs its own wiring there.
Output: `FeedVideo` with the vendor bar, a small shared `vendor-bar.ts` (constants plus the origin rule that tells the bar's events from the video surface's), the bar's intents bridged into the feed's shared state, a guard in `video-sound`, unit tests, and the one e2e case that asserted "no bar" rewritten (not run).

Locked decisions come from the invoking request (no CONTEXT.md exists for a quick task); they are cited as "locked decision N": 1 the bar on every ready feed video, Igor's choice of 2026-11-18; 2 keep every feed guarantee (autoplay in view, one at a time, shared sound, no heart or open or pause from the bar's own events, ratio frame and poster, error hides the bar, reduced motion, no layout shift); 3 bridge the bar's pause, play, mute and unmute requests into the feed's shared state with a bar pause sticking across scrolling; 4 web only, Reels and stories out of scope, vendor labels stay in English, no dependency, no API, no SQL.
</objective>

<execution_context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/workflows/execute-plan.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/261117-mvo-barra-de-controles-do-mux-player-voltar-/261117-mvo-PLAN.md
@.planning/quick/261117-mvo-barra-de-controles-do-mux-player-voltar-/261117-mvo-SUMMARY.md
@apps/web/components/media/FeedVideo.tsx
@apps/web/components/media/FeedVideo.test.tsx
@apps/web/components/media/video-sound.ts
@apps/web/components/media/video-sound.test.ts
@apps/web/components/media/VideoPlayer.tsx
@packages/ui/src/overlays/DoubleTapHeart.tsx
@packages/modules/feed/ui/PostMedia.tsx

## Live observation at planning time (2026-11-18, mutable-scope authority)

`git status --short` for every file in `files_modified` is clean (no uncommitted change). `apps/web/AGENTS.md` was read: no Next.js API is touched by this task (no `next/*` change beyond what `FeedVideo` already imports), so no Next doc lookup is needed.

Mounting and gestures today (read in full):
- `FeedVideo` (client) renders `ReadyFeedVideo` for `status === 'ready'`; any other status returns the `VideoPlayer` fallback frame. `ReadyFeedVideo` mounts `MuxPlayer` (`next/dynamic`, `ssr: false`) inside a frame div (`feed-video-frame`, `data-feed-video`, `data-video-surface` only when the card hands no `onOpen`, `tabIndex -1`, inline `aspect-ratio`, `overflow-hidden`), itself inside `DoubleTapHeart` (`onDoubleTap` is the card's like, `onSingleTap` is `onOpen ?? tapPause`, slop 10 px, hold 200 ms via `onHoldStart` and `onHoldEnd`). The vendor props today: `--controls: none`, `--dialog: none`, `--media-object-fit: cover`, `--media-background-color: transparent`, `nohotkeys`, `noMutedPref`, `noVolumePref`, `loop`, `playsInline`, `streamType="on-demand"`, `preload` from `view.mostly`, `poster`, `key={mints}`.
- The frame swallows EVERY click in the capture phase (`onClickCapture`, `stopVendorClick`): React's root capture listener runs first, so the native `stopPropagation` keeps the click from ever reaching the vendor, whose `media-gesture-receiver` would otherwise toggle play on a mouse click and fight the single tap. With the bar on, this rule must only swallow SURFACE clicks, otherwise no bar button could ever be clicked.
- `DoubleTapHeart` is the frame's React ancestor and counts every `pointerdown` and `pointerup` that bubbles to it (double tap = like and heart burst, single tap = open or pause after 300 ms, still press 200 ms = hold = pause). Pointer events from inside the vendor's shadow tree bubble out retargeted to the `mux-player` host, so without a split a tap on a bar button would like, open Reels, pause or hold the video. Two quick taps on the 10 s forward button would even burst the heart. `onPointerDownCapture={notePress}` records `unlocking` (a press that lands on a held-back video), which a bar press must not set.
- State machine in `ReadyFeedVideo`: `memberPaused` (null, true, false), `claims` (bumped to take the turn), `view` (`visible`, `mostly` at 60 percent), module-level `contenders` (the newest wants-to-play video plays), `hidden`, `held`, `suspended`; `wants` then `shouldPlay` drive `playVideo` and `pauseVideo` from `video-sound`. `togglePause` is the tap and the hidden keyboard button: element playing sets `memberPaused` true and pauses; else `memberPaused` false, `claims` plus 1, play. A member pause survives scrolling because `wants` is false while `memberPaused === true`. The bar must set exactly this state.
- `video-sound.ts`: a document-level capture listener (`touchend` and `click`, installed on the first `playVideo`) replays every held-back element WITH sound inside the gesture when the event's target is inside `[data-video-surface]` and outside `[data-video-sound]`. The target seen at the document is the `mux-player` host (retargeted), so a bar button click on a held-back video would unmute it and then still reach the bar's mute button, which would toggle it straight back. The module therefore needs to ignore bar-origin events.
- `PostMedia` provides `usePostVideoGestures()` (`onDoubleTapLike`, `onOpen`) around the injected video; its comment at line 215 says "the player has no seek bar" and `apps/web/lib/feed-view.tsx` line 146 says "no player chrome": both become stale. No ancestor of the card handles a click (checked: `PostCard` only has a comments button, `FeedList` only retry buttons, `feed-view` none), so bar clicks need no React-level isolation beyond the capture rule.
- Call sites: `FeedVideo` is mounted only by `apps/web/lib/feed-view.tsx`; `suspendFeedVideos` is imported by `useReelsOverlay.tsx` and `StoryViewerHost.tsx` (their tests mock the module, unaffected). `ReelVideo.tsx` and `StoryVideo.tsx` are separate components and are not touched.
- `VideoPlayer.tsx` (mvo, committed) owns module-private `SEEK_STEP_SECONDS = 10` and `PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]`. `FeedVideo.test.tsx` mocks `./VideoPlayer` with a factory that exposes only `VideoPlayer`, so `FeedVideo` must NOT import constants from `./VideoPlayer`: they move to the new `vendor-bar.ts` and `VideoPlayer` imports them from there.
- `FeedVideo.test.tsx` (976 lines): the stand-in technique (the vendor package replaced by a `mux-player` element mounted one tick late, `recorded` props, `media.play` and `media.pause` mocks that flip `paused` and dispatch `playing` and `pause`, a stubbed `IntersectionObserver` with `scrollTo(frame, share)`, `tap`, `doubleTap`, `holdDown`, `release`, `windowCloses`, `refuseSoundOutsideGestures`, the REAL `media.json` catalog). The case titled "hands the vendor no controls, no dialog, cover, loop and the preference opt-outs, and no muted" (under the describe "FeedVideo — no player chrome") asserts `nohotkeys: true` and `--controls: 'none'`: it legitimately reverses and is rewritten. Every other existing case must keep passing UNEDITED (including the sound-button cases: the button keeps `data-testid="feed-video-sound"` and `data-video-sound`).
- e2e: `apps/web/e2e/feed-media.spec.ts` case "2026-10-20: the feed video has no player bar, plays in view never paused, and its sound button says what it hears" (about lines 128 to 156) asserts `--controls` is `none` and no visible `media-control-bar`: it is the ONLY e2e case that asserts "no bar" for the feed (also the spec's header comment lines 16 to 18). `reels.spec.ts` (line ~1084), `social.spec.ts` (lines ~478 and ~1783) tap the feed frame at 30 percent of its width and the middle of its visible height with `hangStreams`/a hung stream: with the stream never loading, `mediahasplayed` stays false so the vendor bar is `display: none`, and the pre-playback centre play button sits at the centre, so that tap point stays on the video surface; those specs need no edit. `stories.spec.ts` line 2476 is about stories.

## Vendor facts verified in node_modules at planning time (do not re-derive)

Package dirs: `node_modules/.pnpm/@mux+mux-player@3.13.4_react@19.3.0/node_modules/@mux/mux-player/dist/themes/gerwig/index.mjs` and `node_modules/.pnpm/media-chrome@4.19.2_react@19.3.0/node_modules/media-chrome/dist/`.
- The default theme renders (on-demand) a pre-playback centre play button, a `media-time-range` and a bottom `media-control-bar` (play, seek back, seek forward, time, mute, volume, rate menu, fullscreen). `media-controller:not([mediahasplayed]) *:is(media-control-bar, media-time-range) { display: none }`: the bar only appears after the first play and the pre-playback centre button shows before it. The bar is an absolutely positioned overlay inside `media-controller` (layers are `position: absolute`), so it takes no space in the frame.
- Autohide (container default 2 s, initial state `userinactive`): while playing, the chrome fades to `opacity: 0` after 2 s without pointer activity, and while PAUSED it stays visible. `opacity: 0` does not set `pointer-events: none`, so an autohidden bar still takes hits in its strip (vendor behavior, same as lessons; recorded as a manual check, not mitigated).
- The vendor's own gesture rule (`media-gesture-receiver.js` handleEvent): a click acts only when `event.composedPath()[0].localName` is `video` or `media-controller`; the gesture layer and the chrome layers have `pointer-events: none` except the slotted chrome, so a hit on the video surface has real origin `video` (inside `mux-video`'s shadow root) and a hit on any bar, centre button, menu or range has another origin. The vendor's request events (`mediaplayrequest`, `mediapauserequest`, `mediamuterequest`, `mediaunmuterequest`) are `CustomEvent`s with `composed: true, bubbles: true`; a mouse click on the video surface dispatches play or pause requests (which is why the capture rule swallows surface clicks), and a programmatic `play()`, `pause()` or `muted =` dispatches none (mvo verified this).
- Touch: media-container toggles the bar on `pointerup` of the controller (not on click), so swallowing the surface CLICK does not stop the bar from showing on a tap. Hotkeys (space, k, m, f, arrows) are registered on `media-controller` itself and only act while focus is inside the player.
- Props (mux-player-react types): `forwardSeekOffset`, `backwardSeekOffset`, `playbackRates: number[]`, `nohotkeys`. mvo already used them in `VideoPlayer` controls mode.
- happy-dom 20.14.5 `Event.composedPath()` walks `parentNode` (and a shadow host when the event is `composed`) from the original target, and testing-library's `fireEvent` creates composed, bubbling pointer and click events, so a light-DOM child appended to the stand-in `mux-player` element is a faithful bar control for the origin rule.

## Decisions taken here (Claude's discretion; none contradicts a locked decision)

1. The origin rule is the vendor's own: bar when the real origin is inside a `mux-player` and is not `video`, `media-controller` or `mux-player`. It lives in `vendor-bar.ts` so `FeedVideo` and `video-sound` share it.
2. The split uses where the press STARTED (a `Set` of pointer ids filled in the frame's `onPointerDownCapture`) for `pointerdown` and `pointerup` and `pointercancel`, not where it ended, so a scrub that ends over the video is never a tap and a surface hold that ends over the bar still resumes.
3. The corner sound button stays (it is the only way to turn the sound on in place for a tenant whose tap opens Reels, and it is what `Ativar som` reads on) and moves to the top right so it never covers the bar's fullscreen button; the hidden keyboard pause button stays; hotkeys are on (mvo's choice); autohide, the vendor theme and the pre-playback centre play button stay the vendor's. A click on the centre play button plays in place (a bar play request), it does not open Reels.
4. Fullscreen contains the video (the feed's `cover` would crop a portrait video on a wide screen) through `document.fullscreenElement` and the standard `fullscreenchange` event only (iPhone uses the native video fullscreen, which contains already).
5. The vendor error dialog and the English labels stay as mvo left them.

## Project rules for the executor

- pt-BR through the next-intl catalog; this task needs NO new catalog key (the vendor bar's labels are not translated here; `apps/web/i18n` tests pin exact key sets, so do not add any). Biome for lint and format. Vitest runs from `apps/web`. A web type error only shows in the build, so the typecheck and build gates matter.
- Commits are PATH-SCOPED: `git commit -m "<message>" -- <the exact paths>`; a brand-new untracked file (`vendor-bar.ts`, `vendor-bar.test.ts`) needs one `git add <file>` first. NEVER `git add -A`. NO `Co-Authored-By` trailer and no tool attribution of any kind in any message (public repository, identity igor.vboas noreply); use the `feat(web): ...` style. NEVER push. NEVER stage anything under `.planning/sketches/`, nor the unrelated untracked files (root `ACESSOS-LOCAIS.md`, `locais.md`, `docs/LOCAL-SETUP.md`, the FRONT PDF, `zz_*` scripts, `.claude/*`, `.planning/debug`).
- Do NOT run `pnpm db:reset`, `pnpm db:seed`, Playwright or any e2e, or touch any hosted project. Do NOT read `.env*` (a hook blocks it). Do NOT edit STATE.md, ROADMAP.md or REQUIREMENTS.md (the orchestrator owns tracking). The SUMMARY file in this quick directory is the only `.planning` file to write, and it is not part of the source commits.
- Disk is tight: after the build gates run `rm -rf .turbo/cache apps/web/.next/cache apps/web/.next/dev`.
- Known reds that are NOT ours (do not chase): pgTAP 120, 141, 154, 232; isolation b3, b8 and the phase-10 sweep; the move-copy stale rede-demo avatar row; the web `EventsSections` flake under load (it passes alone). None of them is part of the gates below except possibly the flake.
- Code comments match the density of the surrounding docblocks; they say why, not what.
- CI env for every gate below (the VAPID value is the local test key already in `.github/workflows/ci.yml`): `API_URL=http://127.0.0.1:8787 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=ci-build-placeholder NEXT_PUBLIC_VAPID_PUBLIC_KEY=BJHs89NeHI8M9hJQWfvb1_irumrdO-cNFTwQZUHrWx3Lp3smi-NAifeRu5Pm4rWfwmQCL5GvEdK8_PVtNafxV1k TURBO_CACHE=local:r`.
</context>

<tasks>

<task type="tracer">
  <name>Task 1: the bar on a feed video, end to end for one path: the vendor gets the bar, and a press on the bar never likes, opens, pauses or holds</name>
  <files>apps/web/components/media/vendor-bar.ts, apps/web/components/media/vendor-bar.test.ts, apps/web/components/media/FeedVideo.tsx, apps/web/components/media/FeedVideo.test.tsx, apps/web/components/media/VideoPlayer.tsx</files>
  <read_first>
    apps/web/components/media/FeedVideo.tsx (whole file; the vendor element at lines 524-550, the frame at 497-523, `notePress` and `tapPause` at 454-477, `stopVendorClick` at 479-482)
    apps/web/components/media/FeedVideo.test.tsx (the mock block at lines 29-115, helpers at 117-290, the describe "no player chrome" at 415-446, the taps at 513-610, the holds at 612-686, "one tap opens Reels" at 688-760)
    packages/ui/src/overlays/DoubleTapHeart.tsx (what it counts and where it listens)
    apps/web/components/media/VideoPlayer.tsx (the two module constants at lines ~99-102 and where they are used)
    node_modules/.pnpm/media-chrome@4.19.2_react@19.3.0/node_modules/media-chrome/dist/media-gesture-receiver.js (the allow list at handleEvent)
  </read_first>
  <action>
    Implement the thinnest complete path: a ready feed video shows the vendor bar, and the bar's own events never reach the card's gestures. Per locked decisions 1, 2 and 4. Write the failing tests FIRST, run them and see them fail for the stated reason (record the failing case names in the SUMMARY), then implement.

    Red first, in `FeedVideo.test.tsx`: rewrite the case "hands the vendor no controls ..." (rename its describe from "no player chrome" to the bar) so it asserts the new vendor props, and add a local helper that appends a plain button (the stand-in's "bar control") inside the mounted `mux-player` stand-in, returning it. Cases to add or rewrite: (a) vendor props: `recorded.at(-1)` has NO `nohotkeys` key, `forwardSeekOffset` and `backwardSeekOffset` are 10, `playbackRates` is an array containing 0.5 and 2, `noMutedPref`, `noVolumePref`, `loop`, `playsInline`, `streamType` are as before, and its style has no `--controls`, has `--dialog` `none`, `--media-object-fit` `cover` and `--media-background-color` `transparent`; the frame's `aspectRatio` style, `data-ratio` and the `overflow-hidden` class are exactly what they were. (b) Through `PostMedia` with both `onOpenVideo` and `onDoubleTapLike`: two quick taps on the bar control neither like, nor open, nor burst the heart (`[data-double-tap-burst]` absent), nor pause the video; one tap on the bar control opens nothing and, in a card with no `onOpenVideo`, does not pause the video after the double-tap window; a press held 260 ms on the bar control does not pause the video. (c) A press that starts on the bar control and is released on the frame is no tap (nothing opens, likes or pauses); a hold that starts on the frame and is released over the bar control ends and the video resumes. (d) A click on the bar control reaches a listener on that control (it is not swallowed), while the existing click on the `mux-player` element itself is still swallowed (that existing case stays unedited). (e) The sound button keeps its test id and `data-video-sound` and its class list no longer contains `bottom-3` (it moved to the top right: `top-3 right-3`). In `vendor-bar.test.ts` add cases for `isVendorBarEvent`: true for an event dispatched on a button inside a `mux-player`; false when dispatched on the `mux-player` host itself, on a `video` or a `media-controller` element inside it, on an element outside any `mux-player`, and for an event with no usable `composedPath`; if a 3-line probe shows happy-dom lets a composed event cross an open shadow root, add one case with the control inside a shadow root of an element inside the `mux-player`, otherwise skip it and say so in the SUMMARY.

    Then implement. New `vendor-bar.ts` (plain module, comment says why): export `SEEK_STEP_SECONDS` (10), `PLAYBACK_RATES` (0.5, 0.75, 1, 1.25, 1.5, 1.75, 2) and `isVendorBarEvent(event: Event): boolean` which reads `event.composedPath()` (a missing method or an empty path means false), takes the first element of the path, returns false when it is not an `Element` or its `localName` is `video`, `media-controller` or `mux-player`, and otherwise returns true only when some element on the path is a `mux-player`. The docblock names the reason: events from the vendor's shadow tree are retargeted to the host, and this is the vendor's own gesture-layer rule (its allow list is `video` and `media-controller`).

    `VideoPlayer.tsx`: delete its two local constants and import them from `./vendor-bar`; no other change in this task (its docblock is Task 3). Its existing cases must pass unedited.

    `FeedVideo.tsx`:
    1. Vendor element: stop passing `nohotkeys`; pass `forwardSeekOffset` and `backwardSeekOffset` as `SEEK_STEP_SECONDS` and `playbackRates` as `PLAYBACK_RATES`; remove `--controls: none` from the style while the player is healthy and put it back while `failed` is true (spread a conditional object, as `VideoPlayer` does, widening the style type with a local alias rather than casting to any if TypeScript complains); keep every other prop and style key exactly as is.
    2. Click rule: replace `stopVendorClick` with a capture handler that stops propagation only when `isVendorBarEvent(event.nativeEvent)` is false (a surface click is still swallowed so the vendor never toggles play by itself; a bar click goes through to the vendor).
    3. Pointer split, by where the press started: keep a `useRef` `Set<number>` of pointer ids on the frame. In `onPointerDownCapture` (replacing `notePress`): for a bar-origin event add the pointer id and set `unlocking.current` to false; otherwise delete the id and set `unlocking.current` to `heldBack(element)` as today. Add `onPointerDown` on the frame that calls `stopPropagation` when the id is in the set (so `DoubleTapHeart`, an ancestor, never sees the press), and `onPointerUp` and `onPointerCancel` on the frame that do the same and then delete the id. Do not add an `onClick` handler (no ancestor handles card clicks; an `onClick` would also trip Biome's key-event rule). Keep the existing `biome-ignore` on the frame and update its sentence to say the frame also keeps the bar's own presses and clicks away from the card.
    4. Move the corner sound button from `bottom-3` to `top-3` (keep `right-3`, `z-[2]` and every other class and attribute), with a one-line comment: the vendor's bar owns the bottom edge.
    5. Do not touch `DoubleTapHeart`, `usePostVideoGestures`, `PostMedia` logic, the `contend` queue, `togglePause`, the hidden keyboard button or the ratio learning.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec vitest run components/media/FeedVideo.test.tsx components/media/vendor-bar.test.ts components/media/VideoPlayer.test.tsx && pnpm exec biome format --write apps/web/components/media/vendor-bar.ts apps/web/components/media/vendor-bar.test.ts apps/web/components/media/FeedVideo.tsx apps/web/components/media/FeedVideo.test.tsx apps/web/components/media/VideoPlayer.tsx && pnpm exec biome check apps/web/components/media/vendor-bar.ts apps/web/components/media/vendor-bar.test.ts apps/web/components/media/FeedVideo.tsx apps/web/components/media/FeedVideo.test.tsx apps/web/components/media/VideoPlayer.tsx</automated>
  </verify>
  <done>
    The new and rewritten cases failed first for the stated reasons (props still carried `nohotkeys` and `--controls: none`; a bar-origin double tap liked, opened or paused) and now pass; every other pre-existing FeedVideo and VideoPlayer case passes unedited; Biome format and check are clean on the five files. Committed path-scoped (`git add` the two new files first) with a `feat(web): ...` message and no trailer; nothing pushed.
  </done>
</task>

<task type="auto">
  <name>Task 2: carry the bar's pause, play, mute and unmute into the feed's shared state; keep the bar out of the sound gesture; contain the video in fullscreen</name>
  <files>apps/web/components/media/FeedVideo.tsx, apps/web/components/media/FeedVideo.test.tsx, apps/web/components/media/video-sound.ts, apps/web/components/media/video-sound.test.ts</files>
  <read_first>
    apps/web/components/media/FeedVideo.tsx (as left by Task 1: the state block at 248-268, `wants` and `shouldPlay` at 416-440, `togglePause` at 442-452, the style block of the vendor element)
    apps/web/components/media/video-sound.ts (`onGesture` at 85-101, `setVideoSoundWanted`, how `attempt` writes `muted` on every play)
    apps/web/components/media/video-sound.test.ts (the `surface()` helper and the "turns the sound on at the next touch" case, lines 58-150)
    apps/web/components/media/VideoPlayer.tsx (mvo's intent bridge effect, lines ~403-428, the model for this one)
  </read_first>
  <action>
    Without this task the bar and the feed's autoplay fight (locked decisions 2 and 3): a pause made on the bar would be undone when the video scrolls back in view, a bar play on a video that is not the newest contender would never take the turn, a bar mute would be re-applied as sound on the next play, and a bar press on a video the browser held back would unmute and re-mute it in one gesture. Use the vendor's own intent events, never guesses from `pause` or `volumechange`, which our own `pauseVideo` and `playVideo` also cause. Write the failing tests first.

    Tests first, in `FeedVideo.test.tsx` (new describe for the bar's intents; dispatch the request events with `new CustomEvent(name, { bubbles: true, composed: true })` on the stand-in `mux-player`, and mimic the vendor acting on a request by calling `media.pause(player)` or `media.play(player)` yourself, as the real controller does before the event reaches the frame): (a) pause request while playing, then `scrollTo(frame, 0)` then `scrollTo(frame, 1)`: still paused and `media.play` not called again; (b) then a play request: it plays while in view, and leaving and re-entering view pauses then plays again; (c) one at a time with the bar: two videos in view, the second newest and playing, the first paused; a pause request on the second hands the turn back (the first plays); a play request on the second takes it again (the second plays, the first pauses); (d) mute request: `videoSoundWanted()` false and the element muted; unmute request: true and unmuted, and the next autoplay after a mute stays muted; (e) our own pauses never read as intent: after `scrollTo(frame, 0)` then `scrollTo(frame, 1)` with no request event the video plays again, and the same after a `visibilitychange` to hidden and back; (f) reduced motion (reuse the `matchMedia` spy of the existing reduced-motion case): nothing plays by itself, a play request while in view plays it; (g) error: after the element's `error` event the last recorded style has `--controls` `none` and the catalog line and retry show, and after the retry mints again the last recorded style has no `--controls`; (h) fullscreen: stub `document.fullscreenElement` (configurable getter) to return the frame, dispatch `fullscreenchange` on `document`, and the last recorded style has `--media-object-fit` `contain`; with the getter returning null and the event again it is `cover`; remove the stub in `afterEach`; (i) a press on the bar control of a video the browser held back (reuse `refuseSoundOutsideGestures`, open the gesture) fires pointer down, up and click on the control: the element stays muted and playing, the sound button still reads `Ativar som`, and the NEXT ordinary tap on the frame unmutes it inside the touch and is not a pause, after which another tap pauses. In `video-sound.test.ts` add: a click or touch on a button inside a `mux-player` element inside a `data-video-surface` does not replay a held-back video with sound, while the same touch on the `mux-player` element itself (or on a plain child outside any `mux-player`) still does.

    Then implement in `FeedVideo.tsx`: (1) one effect with an empty dependency list that adds native listeners on the frame element for the four request events and removes them on cleanup: `mediapauserequest` sets `memberPaused` to true; `mediaplayrequest` sets `memberPaused` to false and bumps `claims` (the vendor has already started the element inside the member's gesture, the effects then make this video the newest contender and apply the visit's sound); `mediamuterequest` calls `setVideoSoundWanted(false)`; `mediaunmuterequest` calls `setVideoSoundWanted(true)`. Not bridged, on purpose and noted in the docblock: `mediavolumerequest` (the slider adjusts the element only) and the seek requests (no play, pause or sound intent). (2) A `fullscreen` state set from a `document` `fullscreenchange` listener (added and removed in an effect) as "the frame contains `document.fullscreenElement`", used as `--media-object-fit`: `contain` while true, `cover` otherwise. Do not change `togglePause`, `wants`, `shouldPlay` or the queue.

    In `video-sound.ts`: import `isVendorBarEvent` from `./vendor-bar` and, in `onGesture`, return early when it is true (after the existing `closest` checks); add one docblock sentence: a touch or click on the vendor's own bar is the bar's, never a sound gesture, because the bar's mute button would otherwise toggle straight back what the gesture just turned on.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec vitest run components/media/FeedVideo.test.tsx components/media/video-sound.test.ts components/media/vendor-bar.test.ts components/media/VideoPlayer.test.tsx && pnpm exec biome format --write apps/web/components/media/FeedVideo.tsx apps/web/components/media/FeedVideo.test.tsx apps/web/components/media/video-sound.ts apps/web/components/media/video-sound.test.ts && pnpm exec biome check apps/web/components/media/FeedVideo.tsx apps/web/components/media/FeedVideo.test.tsx apps/web/components/media/video-sound.ts apps/web/components/media/video-sound.test.ts</automated>
  </verify>
  <done>
    A pause or mute made on the bar survives scrolling, tab changes and the next play; a bar play takes the turn; our own pauses never read as intent; a bar press is never a sound gesture nor leaves `unlocking` set; the error state hides the bar and the retry restores it; fullscreen contains the video. All Task 1 cases and every pre-existing case still pass unedited. Committed path-scoped with a `feat(web): ...` message and no trailer; nothing pushed.
  </done>
</task>

<task type="auto">
  <name>Task 3: the "no bar" e2e case is rewritten, the docblocks tell the truth, and every gate runs</name>
  <files>apps/web/e2e/feed-media.spec.ts, apps/web/components/media/FeedVideo.tsx, apps/web/components/media/VideoPlayer.tsx, apps/web/lib/feed-view.tsx, packages/modules/feed/ui/PostMedia.tsx</files>
  <read_first>
    apps/web/e2e/feed-media.spec.ts (the header comment at lines 8-22 and the case at about lines 128-156), apps/web/e2e/media-video.spec.ts (mvo's rewritten case at about lines 389-422, the model)
    apps/web/components/media/FeedVideo.tsx (the docblock at about lines 169-226, as left by Tasks 1 and 2)
    apps/web/components/media/VideoPlayer.tsx (the `controls` prop comment at about lines 69-75 and the docblock paragraphs at about lines 129-166)
    apps/web/lib/feed-view.tsx line 146, packages/modules/feed/ui/PostMedia.tsx lines 82-88 and 215-217
  </read_first>
  <action>
    1. `e2e/feed-media.spec.ts`: this case asserts exactly what the change legitimately reverses (`--controls` is `none`, no visible `media-control-bar`); rewrite it for the bar and retitle it 2026-11-18, keeping its seeding, `page.route('**/stream.mux.com/**', () => undefined)`, login and navigation. New assertions: the `mux-player`'s computed `--controls` is NOT `none`; the element has no `nohotkeys` attribute; it still autoplays (`expect.poll` on `paused` becomes false); the corner sound button `[data-video-sound]` is still there (count 1) with the accessible name `M.feedVideo.unmute` when the element is muted and `M.feedVideo.mute` otherwise, as the old case did. Do not assert bar visibility or geometry (the bar starts autohidden and the stream never loads in this spec). Update the file's header comment (lines 16 to 18) to say that since 2026-11-18 the feed video shows the vendor bar and is otherwise unchanged. Do not run Playwright. Leave `reels.spec.ts`, `social.spec.ts` and `stories.spec.ts` alone (see the context for why they stay true).
    2. Honesty pass, comments only: rewrite the `FeedVideo` docblock where it says "no player chrome" and "no seek bar" to describe the bar as built (the vendor bar and hotkeys on, the origin rule and why, the press-start rule, the four bridged requests and the two that are not, the error rule, the fullscreen contain, the sound button at the top right, the autohide and the invisible-strip caveat, labels in English), keeping the paragraphs about gestures, holds, sound, ratio and reduced motion accurate; update the `VideoPlayer` `controls` prop comment and docblock sentences that list the feed among the no-bar surfaces (the feed now shows the bar, wired by `FeedVideo`, while Reels, stories, the composer and the lesson-form previews keep none); update the one-line comments in `feed-view.tsx` ("no player chrome") and `PostMedia.tsx` ("the player has no seek bar") to say the player draws the vendor bar but handles its own taps on the video. No code change in these three files beyond comments.
    3. Format, then run the gates in this order from the repo root with the CI env from the project rules exported, fixing anything they report in the touched files only: (a) `pnpm exec biome format --write` on every file of `files_modified`, then `pnpm exec biome check` on them; (b) the new tests once more by name (`FeedVideo.test.tsx`, `video-sound.test.ts`, `vendor-bar.test.ts`, `VideoPlayer.test.tsx`); (c) the whole root `pnpm lint` (it runs Biome check including format AND `scripts/check-ui-literals.sh`; the last CI run failed on a Biome FORMAT error in a test helper that a gate without lint missed); (d) `pnpm turbo typecheck build test --concurrency=4` (a web type error only shows in the build; if only the `EventsSections` flake fails, rerun that file alone and record it); (e) `pnpm check:static-routes`; (f) `pnpm boundaries`; (g) `pnpm boundaries:negative`; (h) `pnpm guard:lanes`; (i) `pnpm guard:hooks`; (j) `pnpm guard:workflows`; (k) the suites by name for the touched areas: `pnpm --filter @rede-social/module-feed test` and the WHOLE web suite `pnpm --filter @rede-social/web test` (`apps/web/lib/filled-cta.test.ts` pins class fragments by substring in module files and the `apps/web/i18n` tests pin exact catalog key sets, so the whole suite is the check, not the media folder). Always finish with `rm -rf .turbo/cache apps/web/.next/cache apps/web/.next/dev`, also when a gate failed.
    4. Commit path-scoped, listing the files explicitly (the comment and e2e files in a third commit), no trailer, nothing pushed. Scope check: `git show --name-only --format= <sha>` for each of the three SHAs together list exactly the ten files of `files_modified`, and `git status --short` for those paths is clean. Do not stage anything else.
    5. Write `.planning/quick/261118-eti-mux-player-bar-on-every-feed-post-video/261118-eti-SUMMARY.md` (not part of the source commits) with: what shipped per commit; the red-first evidence (which new cases failed first and why); the decisions taken (origin rule, press-start rule, sound button to the top right, fullscreen contain, hotkeys on, vendor theme and autohide left as is); Reels, stories and `VideoPlayer` unchanged; the vendor labels in English (the same open item as mvo: media-chrome's pt dictionary is not bundled and `media-chrome` is not a direct dependency, closing it needs Igor's dependency decision); the e2e case rewritten but NOT run, and `reels.spec.ts` and `social.spec.ts` reviewed and left; the gates that ran and their results with the known reds named; and the manual checks only a real browser can do and nobody has done: phone width with the shortest frames (1.91:1 is about 205 px tall) and the speed menu and bar targets fitting, the autohidden bar's strip taking taps at the bottom of the video (vendor behavior, a double tap there does not like), the centre play button before the first play on a video waiting below the fold or under reduced motion, desktop fullscreen contain and exit, iPhone native fullscreen, a bar play on a second video while another plays, and the corner sound button against the bar in every ratio.
  </action>
  <verify>
    <automated>export API_URL=http://127.0.0.1:8787 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=ci-build-placeholder NEXT_PUBLIC_VAPID_PUBLIC_KEY=BJHs89NeHI8M9hJQWfvb1_irumrdO-cNFTwQZUHrWx3Lp3smi-NAifeRu5Pm4rWfwmQCL5GvEdK8_PVtNafxV1k TURBO_CACHE=local:r && pnpm --filter @rede-social/web exec vitest run components/media/FeedVideo.test.tsx components/media/video-sound.test.ts components/media/vendor-bar.test.ts components/media/VideoPlayer.test.tsx && pnpm lint && pnpm turbo typecheck build test --concurrency=4 && pnpm check:static-routes && pnpm boundaries && pnpm boundaries:negative && pnpm guard:lanes && pnpm guard:hooks && pnpm guard:workflows && pnpm --filter @rede-social/module-feed test && pnpm --filter @rede-social/web test; status=$?; rm -rf .turbo/cache apps/web/.next/cache apps/web/.next/dev; exit $status</automated>
  </verify>
  <done>
    The rewritten e2e case type-checks and lints (not run); the docblocks describe the feed's bar honestly; the whole chain above is green except the named known reds; the three path-scoped commits list exactly the ten planned files and nothing else; the SUMMARY is written with the manual checks and the not-run list; the caches are cleared; nothing pushed.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| vendor shadow tree to the frame and card | pointer, click and request events bubble out of the vendor element, retargeted to the host, to this component and to its React ancestors |
| member input (bar buttons, hotkeys, scrub, rate) to the shared playback state | what the member does on the bar changes the feed's pause, turn and sound state |
| playback token to the vendor element | the minted token lives in a closure and is handed to the vendor only; the bar's seek preview uses the thumbnail and storyboard tokens already passed |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-261118-eti-01 | Tampering | forged request events (`mediapauserequest` and the other three) dispatched on the frame | low | accept | Only same-origin script can dispatch events on our own DOM; the worst effect is a pause, play or mute of the viewer's own player (what the bar does). The handlers reach no data, token or write. |
| T-261118-eti-02 | Tampering | the origin rule (`isVendorBarEvent`): a script that dispatches a composed event from inside a `mux-player` to make the card ignore a tap | low | accept | Same-origin script only; the effect is that one tap or like on the viewer's own screen is ignored. The rule fails closed toward today's behavior (a missing `composedPath` or an unknown origin is a surface event). |
| T-261118-eti-03 | Information Disclosure | vendor error dialog and bar in the error state | medium | mitigate | `--dialog: none` stays; the error state puts `--controls: none` back so the bar is not drawn under the catalog line; only the catalog line `feedVideo.error` and the retry show, never a provider status or token fragment (T-03-51 posture). Covered by Task 1 (props) and Task 2 case (g). |
| T-261118-eti-04 | Information Disclosure | playback and thumbnail tokens | low | accept | No token handling changes: the token stays in the closure and is passed as before; the existing test that no token-bearing URL lands in the page stays green. The bar adds no download control. |
| T-261118-eti-05 | Denial of Service (usability) | the autohidden bar still takes taps in its bottom strip, so a double tap there does not like | low | accept | Vendor behavior (media-chrome sets `opacity: 0`, not `pointer-events: none`), same in the lessons since mvo; the strip is a small part of the frame. Listed as a manual check in the SUMMARY, not mitigated. |
| T-261118-eti-SC | Tampering | package installs | n/a | accept | No dependency is added or changed (locked decision 4); the media-chrome pt dictionary is deliberately NOT pulled in for that reason. |
</threat_model>

<verification>
Run from the repo root with the CI env exported (see the project rules); never e2e, db:reset, db:seed or a hosted project.

1. Red first: the new and rewritten FeedVideo cases failed before the implementation (recorded in the SUMMARY), then `pnpm --filter @rede-social/web exec vitest run components/media/FeedVideo.test.tsx components/media/video-sound.test.ts components/media/vendor-bar.test.ts components/media/VideoPlayer.test.tsx` is green.
2. `pnpm exec biome format --write` then `pnpm exec biome check` on every file of `files_modified`.
3. `pnpm lint` (the whole root script, UI-literal guard included).
4. `pnpm turbo typecheck build test --concurrency=4`.
5. `pnpm check:static-routes`, `pnpm boundaries`, `pnpm boundaries:negative`, `pnpm guard:lanes`, `pnpm guard:hooks`, `pnpm guard:workflows`.
6. `pnpm --filter @rede-social/module-feed test` and the whole `pnpm --filter @rede-social/web test`.
7. `rm -rf .turbo/cache apps/web/.next/cache apps/web/.next/dev`.
8. Scope: `git show --name-only --format= <sha>` for each of the three commits together list exactly the ten files in `files_modified`; no trailer in any message (`git log -3 --format=%B` shows none); `git status --short` for those paths is clean; nothing under `.planning/sketches/` or the unrelated untracked files was staged; nothing pushed.
9. Call-site check by reading, not by a count-based grep (the JSX spans lines): `FeedVideo` is the only component whose vendor props changed; `ReelVideo.tsx`, `StoryVideo.tsx` and the default-mode and controls-mode behavior of `VideoPlayer` are untouched (its existing cases pass unedited).
</verification>

<success_criteria>
- Every ready feed post video shows the Mux bar (10 s back and forward, speed 0.5 to 2, a time bar to drag, volume, fullscreen, hotkeys while the player has focus); the processing and failed frames are unchanged.
- A press, tap, hold or click on the bar never likes, opens Reels, pauses or holds the video, and the video surface keeps every gesture it had.
- A pause or mute made on the bar sticks across scrolling and tab changes, a bar play takes the turn, autoplay in view, one-at-a-time, the shared sound rule, reduced motion and the ratio frame with its poster are unchanged, and the frame does not shift when the bar appears.
- The error state hides the bar; fullscreen contains the video; the corner sound button no longer sits on the bar.
- Reels, stories and `VideoPlayer` behave as before; no dependency, API, SQL or catalog key was added.
- Three path-scoped commits, no co-author trailer, nothing pushed, SUMMARY written with the not-run e2e and the manual checks.
</success_criteria>

<output>
Create `.planning/quick/261118-eti-mux-player-bar-on-every-feed-post-video/261118-eti-SUMMARY.md` when done
</output>
