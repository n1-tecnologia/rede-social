---
phase: quick-261117-mvo
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/components/media/VideoPlayer.tsx
  - apps/web/components/media/VideoPlayer.test.tsx
  - apps/web/app/(app)/cursos/[courseId]/aulas/[lessonId]/LessonPlayer.tsx
  - apps/web/app/(app)/configuracoes/midia/MediaLibrary.tsx
  - apps/web/messages/pt-BR/media.json
  - apps/web/lib/progress-reporter.test.ts
  - apps/web/e2e/media-video.spec.ts
autonomous: true
requirements: []
tags: [feature, media, mux-player, lessons, live-replay, quick]

estimate:
  tokens: 45000
  raw_tokens: 45000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "VideoPlayer takes a new opt-in prop `controls` (default false). With it false the vendor element receives EXACTLY today's props (nohotkeys, style --controls none and --dialog none, no seek or rate props), the frame still swallows vendor clicks, and the full-frame toggle, the play badge and the corner sound button render as before: feed, Reels, stories, the composer preview and the lesson-form preview are untouched (locked decisions 1 and 2)."
    - "With `controls` true the vendor bar shows: the style no longer sets --controls (it keeps --dialog none so the vendor's English error dialog stays hidden and the catalog's own error line plus 'Tentar novamente' remain the only error UI), `nohotkeys` is NOT passed (space, arrows, k, m, f work, scoped to the focused player by media-controller's own keydown listener), forwardSeekOffset and backwardSeekOffset are 10, playbackRates is the explicit list 0.5 to 2, noMutedPref and noVolumePref stay on (locked decision 3)."
    - "With `controls` true the frame no longer swallows clicks (a click or tap reaches the vendor's gesture layer and bar), the full-frame toggle, the play badge and the corner sound button are NOT rendered (the vendor bar owns play, pause and volume), the frame is a role=group named by the catalog line `media.player.label`, and while the player is in the error state the bar is hidden (the catalog error line is the whole state)."
    - "The member's intent made on the vendor bar keeps the autoplay-in-view rules honest: a pause request (button, space, k, tap) makes `choice` pause, so scrolling away and back or switching tabs does NOT resume it; a play request makes `choice` play; a mute or unmute request (button, m) sets the visit's sound (`setVideoSoundWanted`), so a mute survives re-entry. The signals are the vendor's bubbling composed request events (mediapauserequest, mediaplayrequest, mediamuterequest, mediaunmuterequest), which only controls, hotkeys and the gesture layer dispatch, never a programmatic play(), pause() or muted assignment (locked decision 5)."
    - "Progress stays correct with seeking (locked decision 4): a tick while PAUSED is still dropped (a seek while paused writes nothing), a seek while playing reports the new real place as a tick through the reporter's 15 s window, pause and ended report as before, startTime resume is unchanged. Going back after 90 percent needs NO client guard and NO API change: the server writes the last position but keeps `completed_at = coalesce(stored, new)` (learn-service.ts writeLessonProgress, one-way), and the lesson session's completion flip is one-way too. Dragging forward past ceil(0.9 x duration) while playing completes the lesson by the server's existing rule; that is recorded as a product note in the SUMMARY, not changed."
    - "LessonPlayer passes `controls`, which covers the lesson page (MemberLessonPage) AND the live replay (LiveReplayMedia renders LessonPlayer); the media library preview (MediaLibrary) passes `controls`. No other call site changes (locked decision 2)."
    - "pt-BR: the catalog gets `media.player.label`; the vendor's own control labels and tooltips stay in English, because media-chrome 4.19.2 only localizes through `media-chrome/dist/lang/pt.js` (an addTranslation side effect that mux-player does not bundle) and `media-chrome` is not a direct dependency of apps/web, so the `lang` attribute alone does nothing. No dependency is added and no `lang` is set; the gap and the one-line path to close it are written in the SUMMARY (locked decision 6)."
  artifacts:
    - path: "apps/web/components/media/VideoPlayer.tsx"
      provides: "the `controls` prop, the two chrome variants, the intent bridge, the honest docblock"
      contains: "controls"
    - path: "apps/web/components/media/VideoPlayer.test.tsx"
      provides: "controls-mode cases: vendor props, absent cover and sound buttons, click passes through, intent bridge, error hides the bar, progress with seeks; the default-mode cases untouched"
      contains: "mediapauserequest"
    - path: "apps/web/messages/pt-BR/media.json"
      provides: "media.player.label"
      contains: "Reprodutor de vídeo"
    - path: "apps/web/e2e/media-video.spec.ts"
      provides: "the media library preview case rewritten for the bar (written, tsc and biome checked, NOT run)"
      contains: "player.label"
  key_links:
    - from: "apps/web/app/(app)/cursos/[courseId]/aulas/[lessonId]/LessonPlayer.tsx"
      to: "apps/web/components/media/VideoPlayer.tsx"
      via: "the `controls` prop"
    - from: "apps/web/components/media/VideoPlayer.tsx (frame listeners)"
      to: "apps/web/components/media/video-sound.ts"
      via: "setVideoSoundWanted on the mute and unmute request events"
---

<objective>
Give the long videos of the app the Mux Player bar (back and forward 10 s, speed, a time bar to drag to any minute, volume, fullscreen): course lessons, live replays (both through LessonPlayer to VideoPlayer) and the media library preview. Feed, Reels and stories keep NO bar (the client's FRONT.pdf decision of 2026-10-20 still holds there).

Purpose: a member of a 1 hour lesson can jump back 10 s, speed up, and drag to a minute. Today the player has no seek at all (`--controls: none`, `nohotkeys`, a transparent full-frame toggle button).
Output: `VideoPlayer` with an opt-in `controls` mode (default false, byte for byte today's behavior), two call sites passing it, a catalog line, unit tests, the one e2e case that asserted "no bar" rewritten.

Locked decisions come from the invoking request (no CONTEXT.md exists for a quick task); they are cited as "locked decision N" below: 1 opt-in default false; 2 LessonPlayer plus the library preview and nothing else; 3 vendor bar on, hotkeys on, the cover button must not cover the bar, own sound button out, frame and error plus retry kept; 4 seeking must not write a wrong position; 5 keep lessons' autoplay and no-loop semantics, invent nothing; 6 reduced motion, phone width and pt-BR labels considered, no new dependency.
</objective>

<execution_context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/workflows/execute-plan.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@apps/web/components/media/VideoPlayer.tsx
@apps/web/components/media/VideoPlayer.test.tsx
@apps/web/components/media/video-sound.ts
@apps/web/app/(app)/cursos/[courseId]/aulas/[lessonId]/LessonPlayer.tsx
@apps/web/lib/progress-reporter.ts
@apps/web/messages/pt-BR/media.json

## Live observation at planning time (2026-11-17, mutable-scope authority)

Call sites of `<VideoPlayer` (rg, tests and node_modules excluded):
- `components/media/FeedVideo.tsx:229` processing/failed fallback, `bleed`: NO controls (unchanged).
- `app/(app)/configuracoes/midia/MediaLibrary.tsx:310` the BottomSheet preview: gets `controls`.
- `app/(app)/criar/ComposerForm.tsx:994` composer preview: NO controls (locked decision 2, unchanged).
- `app/(app)/cursos/[courseId]/aulas/VideoBlock.tsx:166` lesson-form (admin) preview: NO controls (unchanged).
- `app/(app)/cursos/[courseId]/aulas/[lessonId]/LessonPlayer.tsx:94`: gets `controls`. LessonPlayer is rendered by `MemberLessonPage.tsx:132` and by `LiveReplay.tsx:126` (LiveReplayMedia), so one edit covers the lesson page (member and the admin "Ver como aluno" preview with writes off) and the replay. LiveReplay only type-imports from VideoPlayer and its focus-then-play probe finds `mux-player` inside its box: no edit needed there.
- `ReelVideo.tsx` and `StoryVideo.tsx` are separate components that do not import VideoPlayer: not touched. `BottomSheet.tsx` has no key handling of its own, so vendor hotkeys do not collide with it. The files in the touch list have no uncommitted changes (git status clean for them).

## Vendor facts verified in node_modules (do not re-derive)

Package dir: `node_modules/.pnpm/@mux+mux-player-react@3.13.4_*/node_modules/@mux/` and `node_modules/.pnpm/media-chrome@4.19.2_react@19.3.0/node_modules/media-chrome/dist/`.
- React props (`mux-player-react/dist/types/types.d.ts` lines 64-93): `hotkeys?: string`, `nohotkeys?: boolean`, `forwardSeekOffset?: number`, `backwardSeekOffset?: number`, `playbackRates?: number[]`. The element's `playbackRates` setter joins the numbers with a space into the `playbackrates` attribute. media-chrome's own default list is 1, 1.2, 1.5, 1.7, 2.
- Default theme (`mux-player/dist/themes/gerwig`) contains seek-backward, seek-forward, time-range, mute button, volume range, playback-rate menu and fullscreen button. Dropping `--controls: none` shows it; its touch layout (large centre play and seek buttons, tap toggles the bar) is the vendor's.
- `media-controller.js` registers its `keydown` handler on ITSELF (line ~496): space and k toggle play, m mutes, f fullscreen, arrows seek or change volume. Hotkeys therefore only act while focus is inside the player; nothing is registered on `document`.
- Request events `mediaplayrequest`, `mediapauserequest`, `mediamuterequest`, `mediaunmuterequest` are CustomEvents with `composed: true, bubbles: true`, dispatched by `media-play-button`, `media-gesture-receiver`, `media-mute-button` and the controller's hotkey handler; the controller registers listeners on itself and calls no stopPropagation, so they reach the light-DOM frame div. A programmatic `play()`, `pause()` or `muted =` dispatches none of them.
- Localization: `media-controller` applies a `lang` attribute with `setLanguage()`, but the dictionaries are added only by importing `media-chrome/dist/lang/pt.js`; `mux-player` dist does not contain "Retroceder" or any pt string and `apps/web` does not depend on `media-chrome` (pnpm strict). So `lang` would do nothing.

## Server behavior verified (`packages/modules/courses/server/learn-service.ts` writeLessonProgress, lines 495-556)
Position is clamped to [0, duration] and the row's `last_position_seconds` is the last write; `completed_at = coalesce(stored, new)` never reverts. `LessonSession.markCompleted` is one-way on the client. So no API change and no client guard is needed for "back after 90 percent".

## Project rules for the executor
pt-BR through the next-intl catalog; Biome for lint/format; Vitest from `apps/web`; do NOT run the full e2e, `db:reset`, `next build`, `next dev` or turbo (disk and `.next` growth); do NOT push or deploy; commits are path-scoped (never `git add -A`; the tree has many unrelated untracked files), with NO Co-Authored-By trailer, no "Generated with" line and no mention of autonhealth (public repo, identity igor.vboas). Code comments match the density of the surrounding docblocks.
</context>

<tasks>

<task type="tracer">
  <name>Task 1: `controls` mode end to end for the lesson (vendor bar on, cover button and sound button out, LessonPlayer opts in)</name>
  <files>apps/web/components/media/VideoPlayer.tsx, apps/web/components/media/VideoPlayer.test.tsx, apps/web/app/(app)/cursos/[courseId]/aulas/[lessonId]/LessonPlayer.tsx, apps/web/messages/pt-BR/media.json</files>
  <read_first>
    apps/web/components/media/VideoPlayer.tsx (whole file; the render at lines 471-563 and the docblock at 104-153)
    apps/web/components/media/VideoPlayer.test.tsx (the stand-in technique, `recorded`, `scrollTo`, `player()`)
    apps/web/app/(app)/cursos/[courseId]/aulas/[lessonId]/LessonPlayer.tsx
    apps/web/messages/pt-BR/media.json (the `player` object at line 28)
  </read_first>
  <action>
    Implement the thinnest complete path: one prop that turns the bar on for the lesson player, with real behavior and tests. Per locked decisions 1, 2, 3.

    In `VideoPlayer.tsx`:
    1. Add `controls?: boolean` to `VideoPlayerProps`, default false in the destructuring, with a doc comment that says: opt-in vendor bar for LONG videos (lessons, live replays, the media library preview); false keeps the 2026-10-20 no-bar rule for every short, autoplaying surface. Do not touch `loop={onProgress ? undefined : true}`: lessons pass onProgress so they never loop (locked decision 5), and the library preview keeps looping as it does today.
    2. Add two module constants beside the poster-probe ones: `SEEK_STEP_SECONDS = 10` and an explicit `PLAYBACK_RATES` list 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2 (the vendor default tops out at 2 but has no slow rate; a lesson needs 0.5 and 0.75).
    3. Vendor props. When `controls` is false the props the vendor receives must stay identical key for key to today's (nohotkeys true, style with `--controls: none` and `--dialog: none`, no seek or rate props); the existing "hands the vendor no controls" test must keep passing unedited. When true: omit `nohotkeys` entirely, pass `forwardSeekOffset` and `backwardSeekOffset` as SEEK_STEP_SECONDS and `playbackRates` as PLAYBACK_RATES, and omit `--controls` from the style while KEEPING `--dialog: none` and `--media-background-color: transparent` (the vendor dialog is English and raw; the catalog error line plus retry stay the error UI). Keep `noMutedPref`, `noVolumePref`, `playsInline`, `streamType`, poster handling, `startTime` and the progress handlers exactly as they are. If the vendor's `style` type rejects the conditional keys, widen with a local `CSSProperties & Record<string, string>` alias rather than casting to any.
    4. Frame. In controls mode do not attach `onClickCapture={stopVendorClick}` (a capture-phase stopPropagation on the frame would stop every click before it reaches the bar and the gesture layer, which is exactly what the default mode wants and controls mode must not do) and make the frame `role="group"` with `aria-label={t('player.label')}`. Default mode keeps the handler and has no role.
    5. Do not render the full-frame `video-player-toggle` button, the play badge inside it, or the corner `video-player-sound` IconButton when `controls` is true. Why remove rather than shrink the toggle to "the area above the bar" (locked decision 3): the vendor's gesture layer already gives click-to-play on desktop and tap-to-show-bar on touch, so a second click target above it would double-toggle on desktop and fight the touch behavior, and the bar's centre play button replaces the badge when paused (including under reduced motion and after a browser refusal, where `blocked` previously showed the badge). Leave `toggle()`, `badge`, `toggleLabel` and `retry` code paths in place for the default mode.
    6. Add a short docblock paragraph under the existing "No player bar" one naming the two modes and stating that the 2026-10-20 rule still holds for the feed, Reels, stories and every call site that does not pass `controls`. (Task 2 completes the docblock with the intent bridge.)

    In `LessonPlayer.tsx`: pass `controls` to `VideoPlayer` and add one sentence to the component docblock (the member player shows the vendor bar; the bar is why the reporter ignores paused ticks and keeps one-way completion).

    In `messages/pt-BR/media.json`: add `player.label` = "Reprodutor de vídeo" (UTF-8, same file, sibling of `player.close`).

    In `VideoPlayer.test.tsx` add a `describe('VideoPlayer — controls mode (2026-11-17)')` with a local `withControls` render helper (reuse `show`, `player`, `scrollTo`, `recorded`, the stand-in; do not change the existing cases): (a) vendor props in controls mode (no `nohotkeys` key, style has no `--controls`, `--dialog` none, seek offsets 10, `playbackRates` contains 0.5 and 2, `noMutedPref` and `noVolumePref` true) and that the default mode props carry none of `forwardSeekOffset`, `backwardSeekOffset`, `playbackRates`; (b) `video-player-toggle`, `video-player-badge` and `video-player-sound` are absent after the player mounts and after `scrollTo(1)`, and the frame is `getByRole('group', { name: m('player.label') })`; (c) a click on the vendor element DOES reach a listener on it (the inverse of the existing swallow test); (d) autoplay in view still plays with sound and pauses on leaving, and under reduced motion (reuse the matchMedia spy from the existing test) it does not play by itself; (e) `loop` follows `onProgress` exactly as before.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec vitest run components/media/VideoPlayer.test.tsx</automated>
  </verify>
  <done>
    All pre-existing VideoPlayer cases pass unedited (default mode unchanged) and the new controls-mode cases pass; LessonPlayer passes `controls`; the catalog has `player.label`. Committed path-scoped with a `feat(web): ...` message (no co-author trailer).
  </done>
</task>

<task type="auto">
  <name>Task 2: carry the member's bar actions into the autoplay rules; hide the bar on error; prove seeking writes a true position</name>
  <files>apps/web/components/media/VideoPlayer.tsx, apps/web/components/media/VideoPlayer.test.tsx, apps/web/lib/progress-reporter.test.ts</files>
  <read_first>
    apps/web/components/media/VideoPlayer.tsx (as left by Task 1: the attach effect at ~303-349, `wants`/`shouldPlay` at ~369-388, `choice` state)
    apps/web/components/media/video-sound.ts (`setVideoSoundWanted`, and that `attempt` sets `muted` on every playVideo)
    apps/web/lib/progress-reporter.ts and apps/web/lib/progress-reporter.test.ts
  </read_first>
  <action>
    Without this task controls mode regresses two things lessons do today (locked decision 5, keep what lessons do): an explicit pause is forgotten when the member scrolls away and back or switches tabs (today the cover button sets `choice` to pause), and a mute is undone on re-entry (`playVideo` re-applies the visit's sound to `muted` on every play). Fix both through the vendor's own intent signals rather than by guessing from pause and volumechange events, which our own `pauseVideo` and `attempt` also cause.

    In `VideoPlayer.tsx`:
    1. Add one effect, active only when `controls` is true and `status === 'ready'`, that adds native listeners on the frame element (`frameRef`, the same node the other effects use) and removes them on cleanup, for: `mediapauserequest` sets `choice` to 'pause'; `mediaplayrequest` sets `choice` to 'play' and clears `blocked`; `mediamuterequest` calls `setVideoSoundWanted(false)`; `mediaunmuterequest` calls `setVideoSoundWanted(true)`. The unmute call runs inside the member's click or keypress, which is the gesture iOS needs, and it is the visit-wide choice exactly like the old corner button (consistent with video-sound's "ONE playback rule for every video"). Deliberately NOT bridged: `mediavolumerequest` (the slider only adjusts the element; one-line note in the docblock) and seek requests (a seek expresses no play or pause intent).
    2. While `failed` is true in controls mode, put `--controls: none` back in the style so the bar is not drawn under the catalog error line; the retry already remounts the player through `key={mints}` and clears `failed`, so the bar returns by itself.
    3. Finish the docblock: replace the single-mode "No player bar" wording with two clearly labelled modes. State for controls mode: what the bar offers (10 s seek, rates, time range, volume, fullscreen), hotkeys scoped to the focused player, no cover button and no corner sound button and why, the intent bridge and the four event names, autoplay-in-view unchanged, loop unchanged, the error state hides the bar, vendor labels in English (media-chrome pt dictionary is not bundled and media-chrome is not a direct dependency; closing it needs a dependency decision), and `mediavolumerequest` not bridged. Extend the `onProgress` prop comment: a seek while playing reports the new place as a tick, a seek while paused reports nothing, and the server keeps completion one-way.
    4. Do NOT change `report`, `progressHandlers`, `resumeAt` or `lib/progress-reporter.ts`: the existing paused-tick guard is the seek safety (locked decision 4). Do NOT touch the API.

    In `VideoPlayer.test.tsx` (inside the controls-mode describe; the stand-in's `play` and `pause` mocks already flip `paused` and dispatch `playing` and `pause`; dispatch the request events with `new CustomEvent(name, { bubbles: true, composed: true })` on the vendor element, and mimic the vendor acting on a request by setting `paused` and dispatching `pause` or `playing` yourself): (a) pause request, vendor pauses, `scrollTo(0)` then `scrollTo(1)`: still paused and `media.play` not called again; (b) then a play request plus vendor playing: leaving and re-entering view pauses then plays again; (c) mute request: `videoSoundWanted()` false and `element.muted` true; unmute request: true and `element.muted` false; (d) our own programmatic pause (scroll out) does not turn into a pause intent: after `scrollTo(0)` then `scrollTo(1)` with no request event the video plays again; (e) error event hides the bar (`recorded.at(-1)` style `--controls` is 'none'), the catalog line and retry show, and after retry the new render has no `--controls` again; (f) progress with seeks: render with `controls`, `startTime` 120 and an `onProgress` spy, call the recorded `onTimeUpdate` with fake events whose `target` is `{ currentTime, duration, paused }`: a playing tick at 3301.9 of 3600 reports (3301, 3600, 'tick'); a later playing tick at 600.4 (seek back after 90 percent) reports (600, 3600, 'tick') unchanged by the client; a tick with `paused: true` after a seek reports nothing; `onPause` at 600 reports (600, 3600, 'pause'); the recorded props still carry `startTime` 120.

    In `lib/progress-reporter.test.ts` add one case to the existing describe: after a position near the end, a LOWER position (a seek back) is sent as is on a pause and becomes `lastPosition()`, so the pagehide beacon carries the place the member is really at (the server then keeps `completed_at`, see context).
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec vitest run components/media/VideoPlayer.test.tsx lib/progress-reporter.test.ts</automated>
  </verify>
  <done>
    A pause or mute made on the bar survives scrolling and tab changes; our own pauses never read as intent; the bar is hidden in the error state; paused ticks stay dropped, seeks report true places, and the docblock describes both modes honestly. The default-mode cases still pass untouched. Committed path-scoped with a `feat(web): ...` message (no co-author trailer).
  </done>
</task>

<task type="auto">
  <name>Task 3: library preview opts in, the "no bar" e2e case is rewritten, and the gates run</name>
  <files>apps/web/app/(app)/configuracoes/midia/MediaLibrary.tsx, apps/web/e2e/media-video.spec.ts</files>
  <read_first>
    apps/web/app/(app)/configuracoes/midia/MediaLibrary.tsx (line ~310, the BottomSheet preview)
    apps/web/e2e/media-video.spec.ts (the case titled '2026-10-20: the player has no bar, plays by itself never paused, and a click pauses it under the badge', ~lines 389-437, and the error case right after it)
  </read_first>
  <action>
    1. `MediaLibrary.tsx`: pass `controls` to the `<VideoPlayer ... />` in the BottomSheet (locked decision 2). Nothing else in the file changes; the preview keeps looping (no onProgress) and keeps autoplay in view as today.
    2. `e2e/media-video.spec.ts`: this case asserts exactly what the change legitimately reverses for the library preview (`--controls` is none, a cover toggle, a badge, a sound button), so rewrite it for the bar and retitle it 2026-11-17. Keep its seeding, context route, login and navigation steps. New assertions: `--controls` computed on the `mux-player` is NOT 'none'; the `mux-player` has no `nohotkeys` attribute; `[data-video-sound]` and `video-player-toggle` and `video-player-badge` each have count 0; the frame is reachable as `getByRole('group', { name: M.player.label })`; it still autoplays (`expect.poll(() => playerProperty(player, 'paused')).toBe(false)`). Do not assert bar visibility or button geometry: the bar autohides and the stream never loads in this spec. Leave the error case below it unchanged (its assertions of no sound button, no toggle and no visible vendor dialog stay true in controls mode). Do not run Playwright (needs the local stack; rule: no full e2e).
    3. Run the gates listed in verify. Fix anything they report in the touched files only.
    4. Final honesty pass over the docblock in `VideoPlayer.tsx` against the behavior as built.
    5. Commit path-scoped (list the files explicitly), no co-author trailer. Do not push.
    6. Write the SUMMARY with: what shipped; the 2026-10-20 rule still holds for feed, Reels, stories, composer and lesson-form previews; the vendor-labels-in-English gap with its fix path (add `media-chrome` as a direct dependency pinned to the version mux-player resolves, import `media-chrome/dist/lang/pt.js` once client-side, then set `lang="pt"`; needs Igor's dependency decision); the product note (dragging past 90 percent while playing completes the lesson by the server's existing rule; if Igor wants it blocked it is a server or product rule, not this change); the e2e case was rewritten but NOT run; the manual checks only a real browser can do (phone width: bar targets and the settings menu fit inside the 16:9 frame; fullscreen from the library BottomSheet; iOS: autoplay stays muted until the bar's unmute; LiveReplay focus then play still lands on a working bar).
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec vitest run components/media/VideoPlayer.test.tsx components/media/FeedVideo.test.tsx lib/progress-reporter.test.ts && pnpm exec biome check "apps/web/components/media/VideoPlayer.tsx" "apps/web/components/media/VideoPlayer.test.tsx" "apps/web/app/(app)/cursos/[courseId]/aulas/[lessonId]/LessonPlayer.tsx" "apps/web/app/(app)/configuracoes/midia/MediaLibrary.tsx" "apps/web/messages/pt-BR/media.json" "apps/web/lib/progress-reporter.test.ts" "apps/web/e2e/media-video.spec.ts" && bash scripts/check-ui-literals.sh apps/web/components/media</automated>
  </verify>
  <done>
    The library preview shows the bar; the rewritten e2e case type-checks and lints; tests, Biome and the UI-literal guard are green; `pnpm --filter @rede-social/web typecheck` passes (run it once at the end; it is the slow gate and writes only git-ignored files); a third path-scoped commit exists; SUMMARY written; nothing pushed.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser DOM, vendor shadow tree to the frame listeners | custom request events bubble out of the vendor element to this component |
| member input (seek, rate, mute) to the progress write | the position a member's seek produces is sent to the existing lesson-progress API |
| playback token to the vendor element | the minted token lives in a closure and is handed to the vendor only |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-261117-mvo-01 | Tampering | forged `mediamuterequest` and the other request events | low | accept | Only same-origin script can dispatch events on our own DOM; the worst effect is a pause, play or mute of the member's own player (the same thing the bar does). No data, token or write is reachable from the handlers. |
| T-261117-mvo-02 | Information Disclosure | vendor error dialog and bar in controls mode | medium | mitigate | `--dialog: none` stays in controls mode so a raw provider error or token fragment never renders (T-03-51 posture); the error state shows only the catalog line and hides the bar; test (e) in Task 2 asserts both. No download button exists in the vendor bar. |
| T-261117-mvo-03 | Tampering | seek forward past 90 percent completes a lesson | medium | accept | Completion is decided by the server from its own duration (R-Pitfall 10, learn-service.ts); the client sends only a true position; one-way `coalesce` already prevents reverting. Recorded as a product note in the SUMMARY; a change would be a server or product rule, outside this quick task. |
| T-261117-mvo-04 | Repudiation | wrong resume place after seeking | low | mitigate | Paused ticks stay dropped, playing seeks report the true place, the pagehide beacon carries `lastPosition()`; covered by tests in Task 2. |
| T-261117-mvo-SC | Tampering | package installs | n/a | accept | No dependency is added or changed (locked decision 6); the media-chrome pt dictionary was deliberately NOT pulled in for that reason. |
</threat_model>

<verification>
Run from the repo root, nothing else (no e2e, no db:reset, no next build or dev):

1. `pnpm --filter @rede-social/web exec vitest run components/media/VideoPlayer.test.tsx components/media/FeedVideo.test.tsx lib/progress-reporter.test.ts` (FeedVideo's cases guard the default mode, which feed videos use).
2. `pnpm exec biome check` on the seven touched files (quote the paths with parentheses and brackets).
3. `bash scripts/check-ui-literals.sh apps/web/components/media`.
4. `pnpm --filter @rede-social/web typecheck` (its `next typegen` only refreshes `.next/types`, which already exists; do not run build or dev).
5. Scope check after the third commit: `git diff --name-only HEAD~3 HEAD` lists exactly the seven files in `files_modified` (if another actor committed in between, check each of the three SHAs with `git show --name-only --format= <sha>` instead). `git status --short` for the touched paths is clean.
6. No call site other than LessonPlayer and MediaLibrary passes `controls` (read both files and the three untouched call sites listed in the context; do not rely on a count-based grep because the JSX spans lines).
</verification>

<success_criteria>
- A member opening a lesson or a live replay sees the Mux bar: 10 s back and forward, speed, time bar, volume, fullscreen, space and arrows working while the player has focus; the library preview shows it too.
- Feed, Reels, stories, the composer preview and the lesson-form preview behave exactly as before (the unedited default-mode tests prove it).
- Pausing or muting on the bar sticks across scroll and tab changes; autoplay in view, no-loop and reduced-motion behavior are unchanged.
- Seeking never writes a wrong position and never un-completes a lesson; no API change.
- Three path-scoped commits, no co-author trailer, nothing pushed, SUMMARY written with the pt-BR vendor-label gap, the product note on dragging past 90 percent, and the not-run e2e / manual checks listed.
</success_criteria>

<output>
Create `.planning/quick/261117-mvo-barra-de-controles-do-mux-player-voltar-/261117-mvo-SUMMARY.md` when done
</output>
