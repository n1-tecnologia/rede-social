---
phase: quick-261117-mvo
plan: 01
subsystem: web-media
tags: [feature, media, mux-player, lessons, live-replay, quick]
status: complete
commits: 3
plan_head_before: 13d24645ae7476f6fb90b4c89ef58470f14abc3c
key-files:
  modified:
    - apps/web/components/media/VideoPlayer.tsx
    - apps/web/components/media/VideoPlayer.test.tsx
    - apps/web/app/(app)/cursos/[courseId]/aulas/[lessonId]/LessonPlayer.tsx
    - apps/web/app/(app)/configuracoes/midia/MediaLibrary.tsx
    - apps/web/messages/pt-BR/media.json
    - apps/web/lib/progress-reporter.test.ts
    - apps/web/e2e/media-video.spec.ts
actuals:
  tasks: 3
  commits: 3
completed: 2026-11-17
---

# Quick 261117-mvo: Mux Player bar for long videos Summary

`VideoPlayer` has an opt-in `controls` mode (default false) that shows the vendor bar (10 s back and forward, speed 0.5 to 2, a time bar to drag, volume, fullscreen, hotkeys). Lessons, live replays and the media library preview use it. The feed, Reels, stories, the composer preview and the lesson-form preview are unchanged: the 2026-10-20 no-bar rule still holds there, and the unedited default-mode tests prove it.

## What shipped

Commits (path-scoped, no co-author trailer, nothing pushed):

- `267492a8` Task 1 (tracer): the `controls` prop and its two chrome variants. In controls mode the style drops `--controls` (keeps `--dialog: none`), `nohotkeys` is not passed, seek offsets are 10 and `playbackRates` is 0.5 to 2. The frame no longer swallows clicks and is a `role="group"` named `media.player.label`. The cover button, play badge and corner sound button are not rendered. `LessonPlayer` passes `controls`, which covers the lesson page and the live replay (`LiveReplayMedia` renders `LessonPlayer`). The catalog gets `media.player.label` = "Reprodutor de vídeo".
- `ef498129` Task 2: the intent bridge, the error state and the tests. The frame listens to the vendor's `mediapauserequest`, `mediaplayrequest`, `mediamuterequest` and `mediaunmuterequest` events. A pause or play on the bar sets `choice`, and a mute or unmute sets the visit's sound (`setVideoSoundWanted`). Our own pauses (scroll-out, tab hidden) do not dispatch these events, so they never read as intent. In the error state `--controls: none` returns, so the catalog line plus "Tentar novamente" are the whole state, and the retry remount brings the bar back. The docblock describes both modes. A seek test for the reporter was added to `progress-reporter.test.ts`. `report`, `progressHandlers`, `resumeAt`, `progress-reporter.ts` and the API are untouched.
- `9c1899b2` Task 3: `MediaLibrary` passes `controls`, and the e2e case that asserted "no bar" is rewritten for the bar.

Gates run and green: vitest (`VideoPlayer.test.tsx`, `FeedVideo.test.tsx`, `progress-reporter.test.ts`: 75 tests passed), Biome on the seven touched files, `scripts/check-ui-literals.sh apps/web/components/media`, `pnpm --filter @rede-social/web typecheck`. The scope check shows exactly the seven planned files across the three commits.

## Notes the plan asked to record

**(a) Vendor labels stay in English.** media-chrome 4.19.2 only localizes through `media-chrome/dist/lang/pt.js`, an `addTranslation` side effect that mux-player does not bundle, and `media-chrome` is not a direct dependency of `apps/web`. The `lang` attribute alone does nothing, so none is set and no dependency was added. One-line path to close the gap: add `media-chrome` as a direct dependency pinned to the version mux-player resolves (4.19.2), import `media-chrome/dist/lang/pt.js` once client-side, then set `lang="pt"` on the player. This needs Igor's dependency decision.

**(b) Product note.** Dragging forward past `ceil(0.9 x duration)` while the video is playing completes the lesson by the server's existing rule (`writeLessonProgress` in `learn-service.ts` decides completion from its own duration). Going back afterwards never un-completes it: `completed_at = coalesce(stored, new)` is one-way on the server, and so is the client session's completion flip. No client guard and no API change were made. If Igor wants forward drags blocked, that is a server or product rule, outside this change.

**(c) Volume slider is not bridged.** `mediavolumerequest` (the slider) only adjusts the element and does not touch the visit's sound, so dragging the slider does not change `setVideoSoundWanted`. Only the mute and unmute buttons (and the `m` key) do. It is noted in the docblock.

**(d) Not run.**
- The rewritten e2e case in `apps/web/e2e/media-video.spec.ts` was written and type-checked/linted only. Playwright needs the local Supabase stack, which the constraints forbid.
- Real-browser checks nobody has done: bar targets and the settings menu fit inside the 16:9 frame at phone width; fullscreen from the library BottomSheet; iOS autoplay staying muted until the bar's unmute; LiveReplay's focus-then-play still landing on a working bar; reduced-motion look of the vendor bar.
- No full e2e, no `next build` or dev, no `db:reset`.

## Deviations from Plan

- In the Task 2 test "a play made on the bar after a pause", `media.play` is called 3 times, not 2: first view, the play request flipping `choice` (an idempotent `playVideo` on an already-playing element), and re-entry. The assertion states 3 with a comment. Behavior is as designed; the plan's count was an estimate.
- Otherwise none. The vendor event names and prop names were re-checked against node_modules (`media-chrome` constants and the mux-player-react types) and matched the plan.

## Known Stubs

None.

## Threat Flags

None new. The plan's mitigations hold: `--dialog: none` stays in controls mode, the error state hides the bar (tested), paused ticks stay dropped and seeks report true places (tested).

## Self-Check: PASSED

All seven files exist and are committed; commits `267492a8`, `ef498129` and `9c1899b2` are on `master`; no co-author trailer.
