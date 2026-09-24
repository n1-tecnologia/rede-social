---
phase: 05-communities-stories
plan: 10
subsystem: ui
tags: [stories, viewer, media-image, render-loop, CR-03, CR-04, pointer-events, tdd, gap-closure]

# Dependency graph
requires:
  - phase: 05-06
    provides: "the StoryViewer surface — the pager, the gesture pipeline, the clock, the media-control contract and the host's MediaImage/StoryVideo wiring"
  - phase: 05-01
    provides: "MediaImage itself and the /v1/media/{assetId}/{variant} serving contract"
provides:
  - "MediaImage whose mount effect depends on VALUES ([assetId, src]) and never on the caller's callback identities — the reports are read through refs assigned during render"
  - "MediaImage reports onFailed exactly once for an EMPTY variant ladder instead of returning the fallback silently (CR-03)"
  - "StoryViewer's media controls as TWO memoised layers: a per-item stable handler map over [items], and a control-object map over [items, index, paused, muted, handlers] — controlsFor, the render-time factory, is gone"
  - "the autoplay play badge and the media-error container as SIBLINGS of the gesture stage, the error container pointer-events-none with a pointer-events-auto retry (CR-04)"
  - "packages/core/tests/media-image.test.tsx — the component's reporting contract in four counted cases"
  - "packages/modules/stories/tests/story-viewer-media.test.tsx — the REAL MediaImage under the REAL StoryViewer, with a bounded render count and the empty-ladder error path"
  - "story-viewer.test.tsx cases 12a/12b/12c — badge tap and retry tap act without advancing; the stage is still live"
affects: [05-11, 05-12, stories, media]

# ⚠️ 05-11 CONTRACT NOTE — the shape of the object StoryViewer hands its media children
#
# `StoryMediaControls` is UNCHANGED as a type: the same eight members, the same meanings, the same
# call site (`item.media(controls)`). What changed is its IDENTITY LIFECYCLE, and 05-11's video half
# must be written against the new one:
#   - the five handlers (onLoad, onError, onCanPlay, onPlaying, onTimeUpdate) are now REFERENTIALLY
#     STABLE for the life of the `items` array. They are memoised over `[items]` alone;
#   - the control OBJECT's identity changes only when one of `[items, index, paused, muted]` changes
#     — so a mute toggle DOES hand StoryVideo a new object (it must), and a keystroke does NOT;
#   - `onTimeUpdate` reads the current index and `goNext` through a live ref rather than a render
#     closure, so it is correct at call time regardless of when it was created.
# Consequence for 05-11: `StoryVideo`'s `controlsRef` idiom still works and is still correct, but an
# effect keyed on a handler identity will now fire ONCE per sequence rather than per render. If the
# video bridge needs to re-attach when playback state changes, key it on a VALUE (the asset id, the
# token, a ref callback on the element) — never on a handler identity.

actuals:
  tokens: 18967
  tasks: 3
  # MEASURED from plan_head_before: 6 task commits (3 RED + 3 GREEN) + this plan's own docs commit.
  commits: 7

plan_head_before: 5e0334f673d229db1c978cce78fabb1c5b869fce

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A component that reports to a caller it does not control names VALUES in its effect dependency array, never the caller's callback identities; the callbacks are read through refs assigned during render (the StoryVideo `controlsRef` idiom, now shared by MediaImage)"
    - "A container that hands callbacks to children stabilises them at its own end too: a live ref for the volatile values, one memo over the array for the handlers, one memo over the genuinely-changing inputs for the object"
    - "Isolating a control from a gesture surface is STRUCTURAL — move it out of the handler-owning subtree — never propagational; an `absolute inset-0` sibling gets `pointer-events-none` with `pointer-events-auto` on the one control that needs a tap"
    - "A render-rate defect needs a render-COUNT assertion; the counting wrapper throws at a hard ceiling so a regression is reported in milliseconds instead of exhausting the heap"

key-files:
  created:
    - "packages/core/tests/media-image.test.tsx"
    - "packages/modules/stories/tests/story-viewer-media.test.tsx"
  modified:
    - "packages/core/ui/MediaImage.tsx"
    - "packages/modules/stories/ui/StoryViewer.tsx"
    - "packages/modules/stories/tests/story-viewer.test.tsx"

key-decisions:
  - "The loop is fixed at BOTH ends rather than one: MediaImage stops taking the caller's identities as dependencies AND StoryViewer stops rebuilding them. Fixing only the component would leave the next consumer of StoryViewer's controls to rediscover the same defect"
  - "A ref assigned during render, not `useEffectEvent`: the hook appears nowhere in this codebase and `StoryVideo` already established the ref idiom for exactly this problem"
  - "The plan's `assumption-delta` decision was honoured as written — `no-change`. The empty ladder routes into the EXISTING failure outcome and the existing `onFailed` report; no three-valued `status` union was introduced, because from every consumer's point of view 'there was never anything to render' IS 'the fallback renders' and the viewer's `error` state already has the right copy, affordance and behaviour"
  - "`if (src === null) return` was introduced in Task 1 as a behaviour-neutral guard (it makes `src` a genuine dependency and satisfies biome's exhaustive-dependencies rule without a suppression comment), and Task 2's GREEN replaced the bare `return` with the failure report. No suppression comment was added anywhere"
  - "The badge's `data-play-attempt` attribute lives ON the badge, which unmounts the moment the tap clears `blocked` — so case 12a asserts the host's `onRequestPlay` spy instead, which is the same event observed from the other side"
  - "Case 12c (the stage is still live) is not optional decoration: without it, 12a and 12b would also pass over a viewer whose gesture pipeline had been broken entirely rather than isolated"
  - "The core test's four cases assert with `toHaveBeenCalledTimes` spies rather than integer counters; the swap was made during GREEN and re-proved RED against the pre-GREEN component (expected 1, got 0) before landing, so the shipped assertion shape has its own RED record"

patterns-established:
  - "A render-count ceiling that THROWS is written before the failing composition is run, so the RED phase produces a usable evidence record instead of an OOM kill with no test counts"
  - "A deliberate test stand-in carries a docblock naming the sibling file where the real integration is asserted, so the next reader who finds the stub finds the answer beside it"
  - "A DOM restructure under a shipped e2e suite names that suite and the plan/wave that runs it, in a comment beside the move"

requirements-completed: []

coverage:
  - id: D1
    description: "MediaImage's mount effect cannot be re-armed by a caller that rebuilds onReady/onFailed every render: the deps are [assetId, src] and the reports are read through refs"
    requirement: "STORY-02"
    verification:
      - kind: unit
        ref: "packages/core/tests/media-image.test.tsx#1. a decoded image under a caller that rebuilds both reports every render SETTLES"
        status: pass
      - kind: unit
        ref: "packages/modules/stories/tests/story-viewer-media.test.tsx#1 (render count < 40, ready reported once per asset)"
        status: pass
    human_judgment: false
  - id: D2
    description: "StoryViewer no longer manufactures the control callbacks during render: stable per-item handlers memoised over [items], control object memoised over [items, index, paused, muted]"
    requirement: "STORY-02"
    verification:
      - kind: unit
        ref: "packages/modules/stories/tests/story-viewer-media.test.tsx#2 (a mute toggle does not re-report and does not cascade), #3 (advancing reports for the new asset only)"
        status: pass
      - kind: static
        ref: "grep: `const controlsFor = (` prints 0 in StoryViewer.tsx; `useMemo` prints 4"
        status: pass
    human_judgment: false
  - id: D3
    description: "The unit suite can SEE the media contract: the real MediaImage renders under the real StoryViewer, proved by an <img> whose srcSet names /v1/media/{assetId}/w320 320w"
    requirement: "STORY-02"
    verification:
      - kind: unit
        ref: "packages/modules/stories/tests/story-viewer-media.test.tsx#1 (srcSet assertion; no vi.mock of either component in the file)"
        status: pass
    human_judgment: false
  - id: D4
    description: "CR-03: an empty variant ladder reports onFailed exactly once, renders no <img>, and drives the viewer to its error state with a retry, a focusable close and an unchanged story index"
    requirement: "STORY-02"
    verification:
      - kind: unit
        ref: "packages/core/tests/media-image.test.tsx#2 (empty ladder), #3 (zero natural width), #4 (happy path, no re-report on a parent re-render)"
        status: pass
      - kind: unit
        ref: "packages/modules/stories/tests/story-viewer-media.test.tsx#4 (media-error test id, retry, focusable close, fill 0%, index unchanged after 2x the story duration)"
        status: pass
    human_judgment: false
  - id: D5
    description: "CR-04: a tap on the play badge or on the media-error retry acts without advancing, and a tap on the media still advances"
    requirement: "STORY-02"
    verification:
      - kind: unit
        ref: "packages/modules/stories/tests/story-viewer.test.tsx#12a, #12b, #12c"
        status: pass
      - kind: static
        ref: "grep: `stopPropagation` prints 0 in non-comment lines of StoryViewer.tsx; badge and error container both appear after the stage div's closing tag"
        status: pass
    human_judgment: false
  - id: D6
    description: "The error container is transparent to hit-testing, so a tap on the error COPY still reaches the stage and advances past a failed story"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/stories.spec.ts — runs as a gate in 05-11 Task 3 (wave 9)"
        status: deferred
    human_judgment: false
    rationale: "happy-dom does not hit-test, so `pointer-events-none` has no effect on synthetic event dispatch there. The property is real-browser-only and is covered by the shipped gesture spec, deliberately not run in wave 8 (05-09 holds the seeded database and the dev-server ports)."
  - id: D7
    description: "The bound holds on a real device under a real decoder: the viewer's image path does not burn CPU or battery over an already-decoded story"
    verification: []
    human_judgment: true
    rationale: "A render-rate property on real hardware cannot be proven by any automated check in this repo. The verifier's human check 1 (a 30 s device profile with the tab idle between frames) stays open. Carried forward as the plan's flagged STORY-02 assumption."

# Metrics
duration: 42min
completed: 2026-09-24
status: complete
---

# Phase 05 Plan 10: Story Viewer Image Path Summary

**The story viewer's image path settles: `MediaImage` reports through refs with an effect that depends on values rather than on the caller's callback identities, `StoryViewer` hands out memoised controls instead of manufacturing them each render, an empty variant ladder now reports failure instead of freezing the viewer in `loading`, and the play badge and error retry sit outside the gesture stage so one tap means one thing.**

## Performance

- **Duration:** ~42 min
- **Started:** 2026-09-24T11:57:00Z
- **Completed:** 2026-09-24T12:39:00Z
- **Tasks:** 3 (all TDD: 3 RED commits, 3 GREEN commits)
- **Files modified:** 5 (3 modified, 2 created)

## Accomplishments

- **The image half of GAP 2 is closed at both ends.** `MediaImage`'s mount effect called `onReady` whenever the image was already decoded, with `onReady` in its own dependency array; `StoryViewer` rebuilt `onLoad`/`onError` through a render-time factory on every pass; `controls.onLoad` wrote a fresh object into `mediaState`. The three together spun without bound — a verifier probe reproducing exactly that composition ran to `FATAL ERROR: JavaScript heap out of memory` after ~168 s. Both ends are fixed: the component now names only `[assetId, src]` and reads its reports through refs assigned during render (the `StoryVideo` idiom), and the viewer produces its handlers once per `items` array and its control object only when one of `[items, index, paused, muted]` changes.
- **The suite can finally see what it claims to verify.** `story-viewer.test.tsx:101` stubbed `media` with a plain `<div/>`, which is exactly why a broken viewer shipped green. `story-viewer-media.test.tsx` now renders the REAL `MediaImage` under the REAL `StoryViewer`, with the image forced into the decoded state, and asserts a bounded render count as a first-class criterion. The stub-proof is in the DOM: an `<img>` whose `srcSet` names `/v1/media/asset-0/w320 320w`, which no `<div/>` can produce.
- **The RED phase reported the loop instead of becoming it.** The counting wrapper throws at a hard ceiling (400 renders, two orders of magnitude above the settled ~8). The first run failed 3/3 in under a second with `media render count exceeded 400` — a usable RED evidence record, where an OOM kill would have been no record at all.
- **CR-03: a story with nothing to render says so.** `listCommunityHighlights` deliberately omits the `status = 'ready'` filter, so a pinned, still-transcoding asset reaches the viewer with no variants published. The `src === null` branch returned the fallback and reported nothing at all, and because the clock is gated on `currentState === 'ready'` the member got a black screen with no progress, no auto-advance, no error copy and no retry, forever. The mount effect's first branch now marks the asset failed and reports through the failure ref — once per asset, because `src` is already a dependency.
- **CR-04: one tap, one meaning.** The play badge and the media-error container lived inside the div that owns `onPointerDown`/`onPointerMove`/`onPointerUp`. Pressing "play" ran the badge's handler *and* the stage's tap-zone maths — the member lost the story instead of starting it. Both are now siblings of the stage at the same `z-[4]`. The error container, being `absolute inset-0`, carries `pointer-events-none` with only its retry `pointer-events-auto` — the idiom the veil and the tap-zone row already use in this file.
- **The isolation is structural, not propagational.** `grep -c stopPropagation` over the non-comment lines of `StoryViewer.tsx` prints 0. A control that is not in the handler-owning subtree cannot bubble into it, and there is no propagation call for a later edit to delete by accident.
- **Three memos the reviewer recorded as defeated (IN-03) are restored.** With stable handler identities the viewer's existing `useMemo`s and the children's own memo boundaries stop being invalidated on every pass.

## Task Commits

| Task | Gate | Commit | Files |
|---|---|---|---|
| 1 | RED | `c5ad228` | `packages/modules/stories/tests/story-viewer-media.test.tsx` (new) |
| 1 | GREEN | `8c286c7` | `packages/core/ui/MediaImage.tsx`, `packages/modules/stories/ui/StoryViewer.tsx`, the test |
| 2 | RED | `b6971eb` | `packages/core/tests/media-image.test.tsx` (new), `story-viewer-media.test.tsx` case 4 |
| 2 | GREEN | `75f1637` | `packages/core/ui/MediaImage.tsx`, `packages/core/tests/media-image.test.tsx` |
| 3 | RED | `7615667` | `packages/modules/stories/tests/story-viewer.test.tsx` (cases 12a/12b/12c) |
| 3 | GREEN | `1f4b2eb` | `packages/modules/stories/ui/StoryViewer.tsx` |

## TDD Gate Compliance

All three tasks carried `tdd="true"` and every one ran a full RED → GREEN cycle with a verified evidence record. No REFACTOR commit was needed: each GREEN landed in its final shape.

| Task | Target test | RED verdict | RED evidence |
|---|---|---|---|
| 1 | `…the image path settles… 1. a decoded story image renders the real component…` | `RED_EVIDENCE_OK` | exit 1, 3 tests / 0 pass / 3 fail, `Error: media render count exceeded 400` |
| 2 | `MediaImage — the reporting contract… 2. an EMPTY variant ladder reports FAILURE exactly once…` | `RED_EVIDENCE_OK` | exit 1, 4 tests / 3 pass / 1 fail, `expected "vi.fn()" to be called 1 times, but got 0 times` |
| 2 (viewer half) | `…the image path settles… 4. CR-03: a story with an EMPTY variant ladder reaches the error state…` | `RED_EVIDENCE_OK` | exit 1, 4 tests / 3 pass / 1 fail, `expected +0 to be 1` |
| 3 | `…12a. CR-04: tapping the play badge starts playback and does NOT advance the story` | `RED_EVIDENCE_OK` | exit 1, 20 tests / 18 pass / 2 fail, `expected "vi.fn()" to be called 1 times, but got 0 times` |

**RED evidence provenance.** Vitest emits no TAP and this repo wires no TAP reporter, so each RED run was executed with `--reporter=json --outputFile=<tmp>.json` and normalised into the checker's record shape by a throwaway script under the session scratch directory. The script is not a project artifact, was never committed, and does not appear in `key-files`. No count was hand-written: every `tests`/`pass`/`fail` figure above is projected from a real Vitest run.

**One discipline note, stated rather than buried.** Task 2's four core cases were converted from integer counters to `toHaveBeenCalledTimes` spies during GREEN, to satisfy the plan's acceptance criterion. Because that changed the shipped assertion shape after the RED record was taken, the pre-GREEN `MediaImage` was restored from the RED commit, the converted file was re-run against it (`expected 1, got 0` — `RED_EVIDENCE_OK`), and the GREEN file was restored before committing. The assertion that ships has its own RED record, not an inherited one.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `if (src === null) return` added to the mount effect in Task 1, not Task 2**
- **Found during:** Task 1 GREEN
- **Issue:** With the dependency array changed to `[assetId, src]` as the plan's acceptance criterion requires, biome's `lint/correctness/useExhaustiveDependencies` failed the build: `src` was named but not read in the effect body. The plan's own `fails_when` forbids resolving this with an unexplained suppression comment.
- **Fix:** A behaviour-neutral early return on the null `src`, which makes `src` a genuine dependency. Task 2's GREEN then replaced the bare `return` with the failure report the plan specifies — so the branch the plan asked for exists exactly where it asked for it, and no suppression comment was added anywhere in either package.
- **Files modified:** `packages/core/ui/MediaImage.tsx`
- **Commit:** `8c286c7` (guard), `75f1637` (report)

### Adjusted Assertions (no behaviour change)

**2. Case 12a asserts `onRequestPlay` rather than the `data-play-attempt` attribute**
- **Found during:** Task 3 RED
- **Issue:** The plan asks case 12a to "assert the play attempt attribute incremented". `data-play-attempt` is an attribute ON the badge, and the badge's own click handler clears `blocked`, which unmounts the badge — so the attribute is unreadable immediately after the very tap that increments it.
- **Fix:** The case asserts the host's `onRequestPlay` spy was called exactly once (the same event, observed from the other side) plus the badge's dismissal, alongside the unchanged story index. Documented in a comment beside the assertion.
- **Files modified:** `packages/modules/stories/tests/story-viewer.test.tsx`
- **Commit:** `7615667`

**3. The "a tap on the error COPY still advances" behaviour is not asserted at unit level**
- **Found during:** Task 3
- **Issue:** happy-dom does not hit-test, so `pointer-events-none` has no effect on synthetic event dispatch. A unit case asserting the copy is transparent would fail against a correct implementation.
- **Fix:** Recorded as coverage item D6 with `status: deferred`, routed to `apps/web/e2e/stories.spec.ts` in 05-11 Task 3, and the limitation is written into the test file's CR-04 comment block so the next reader does not mistake the absence for an oversight. The plan's `<action>` required three cases; three cases were written.

**4. One comment reworded so the acceptance grep reads the code rather than the prose**
- **Found during:** Task 3 GREEN
- **Issue:** `grep -c "stopPropagation"` over non-comment lines printed 1 — the match was inside the new `{/* … */}` JSX comment explaining why there is no such call (JSX comment continuation lines do not start with `*` or `//`, so the filter does not exclude them).
- **Fix:** Reworded to "no propagation-halting call anywhere in this file". The criterion now measures the code, which is what it was for.

## Authentication Gates

None. This plan touches no server, no route and no credential.

## Verification

| Gate | Result |
|---|---|
| `pnpm --filter @tria/core typecheck && lint && test` | ✓ 201 passed / 22 files (`media-image.test.tsx` 4/4) |
| `pnpm --filter @tria/module-stories typecheck && lint && test` | ✓ 89 passed / 9 files (86 pre-existing + 3 CR-04 cases; `story-viewer-media.test.tsx` 4/4) |
| `pnpm --filter @tria/web typecheck && lint && test` | ✓ 119 passed / 14 files — `StoryViewerHost.test.tsx` is the second, independent witness that the control identities changed shape without changing behaviour |
| `bash scripts/check-ui-literals.sh` | ✓ OK |
| `pnpm boundaries` | ✓ 555 files, 9 packages, no issues |
| No schema/migration file touched | ✓ `git diff --name-only` over the plan's six commits lists five `.tsx`/`.ts` files and nothing under `supabase/migrations/` or any `db/schema` |

**Deferred to 05-11 Task 3 (wave 9), by design:** `pnpm --filter @tria/web exec playwright test stories.spec.ts` — the shipped tap/hold/swipe/deep-link suite over the stage this plan restructured. It is not run here because 05-09 holds the seeded database and the dev-server ports in wave 8, and two Playwright runs against one database is a race, not a gate. `05-11` declares `depends_on: ["05-06", "05-10"]`, so both plans' edits are in the tree when it runs.

## Known Stubs

None introduced. One stub was RETIRED as a silent liability and re-stated as a deliberate choice: `story-viewer.test.tsx`'s `media` stand-in now carries a docblock explaining that the file is about the pointer pipeline and naming `story-viewer-media.test.tsx` as where the real media integration is asserted.

## Threat Flags

None. No new network endpoint, auth path, file-access pattern or trust-boundary schema change. The plan's register (`T-05-45`, `T-05-46`, `T-05-47`, `T-05-SC`) is addressed as written: the two denial-of-service items are mitigated with the bounded-render and failure-report gates, the repudiation item by the structural pointer isolation, and no package install occurred.

## Open Items Carried Forward

- **STORY-02's flagged assumption stands.** No automated check can prove the render bound holds on a real device under a real decoder. `05-VERIFICATION.md`'s human check 1 — open the viewer on a phone with an already-decoded story and watch CPU and battery for 30 s — remains open.
- **The three plan prohibitions remain `status: unverified` / `verification: flagged`,** as the plan declared them. Two of the three now have executable evidence pointing the right way: "a story the member did not see must stop and say so" is asserted by `story-viewer-media.test.tsx#4` (index unchanged after 2× the story duration), and "a story that cannot render must never leave the member without a reachable exit" by the focusable close in the same case. The third — "progress must never be fabricated" — is unchanged by this plan and still rests on the clock's `currentState !== 'ready'` gate.
- **GAP 2's video half is NOT closed here.** `StoryVideo`'s one-shot `querySelector` against a `next/dynamic(ssr:false)` child, and the video progress segment that never advances, are 05-11.
- **STORY-02 was deliberately NOT marked complete in `REQUIREMENTS.md`.** The plan's frontmatter claims it, but the requirement covers both media paths and the video path is still broken. `requirements.mark-complete` was therefore not run for this plan; `requirements-completed` is empty above. 05-11 closes the video half and is the plan that should claim it.

## Self-Check: PASSED

All created files exist on disk; all six task commits resolve in `git log`.
