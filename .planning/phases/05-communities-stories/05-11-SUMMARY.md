---
phase: 05-communities-stories
plan: 11
subsystem: ui
tags: [stories, viewer, video, mux-player, next-dynamic, mutation-observer, static-route-gate, tdd, gap-closure]

# Dependency graph
requires:
  - phase: 05-06
    provides: "the StoryViewer surface — the pager, the clock, videoProgress and the StoryMediaControls contract the bridge reports into"
  - phase: 05-10
    provides: "the memoised control identities (handlers stable over [items], object over [items, index, paused, muted]) and the restructured pointer subtree this plan's e2e gate exercises"
provides:
  - "StoryVideo that attaches its four listeners WHENEVER the vendor element appears — a MutationObserver over its own frame, reconciling on every mutation, kept for the life of the mount"
  - "a player-element ref plus an attachment counter, so the pause/mute effect applies the flags the bridge is ALREADY HOLDING at the moment the element arrives"
  - "StoryVideo.tsx with ZERO biome suppressions: `tokens` is gone from both dependency arrays, so there is nothing left to suppress"
  - "apps/web/components/stories/StoryVideo.test.tsx — the bridge's own contract in six counted cases"
  - "StoryViewerHost.test.tsx with the './StoryVideo' stub DELETED: the server action and the vendor package are mocked instead, and case 13 asserts a real video segment filling to 50% and handing over"
  - "scripts/check-static-routes.sh naming all three shipped /stories routes inside the TENANT-02 gate"
affects: [05-12, stories, media]

actuals:
  tokens: 11585
  tasks: 3
  # MEASURED: git rev-list --count 6a8aa44..HEAD — 4 task commits (2 RED + 1 GREEN
  # + 1 chore) plus this plan's docs commit, which is the 5th.
  commits: 5

plan_head_before: 6a8aa4402b2c05e5ca1e83beb05b2cc05eee1bff

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A component whose child mounts a DOM node ASYNCHRONOUSLY observes for that node instead of guessing when it will arrive: reconcile once synchronously, then a MutationObserver over the owned frame for the life of the mount — never a one-shot querySelector keyed on the commit that is supposed to produce it"
    - "The observer is NOT disconnected on first success: the node is replaced when the source changes, and a one-shot observer reproduces the same class of defect one level up"
    - "A ref callback is not a substitute when the child comes through `next/dynamic`: the wrapper does not forward refs, so `ref={…}` is a second silent no-op with the same shape as the first. Recorded in the docblock so the next reader does not try it"
    - "An 'element has arrived' counter is a genuine dependency only if the effect READS it (`if (attachments === 0) return`); an unread extra dependency is a biome error, and biome's error is right — a dependency the body ignores is how this defect was documented as intentional in the first place"
    - "A test that reproduces the late mount rather than removing it: the VENDOR package is replaced by a stand-in that defers its element one further tick, and `next/dynamic` is deliberately left unmocked"

key-files:
  created:
    - "apps/web/components/stories/StoryVideo.test.tsx"
  modified:
    - "apps/web/components/stories/StoryVideo.tsx"
    - "apps/web/components/stories/StoryViewerHost.test.tsx"
    - "scripts/check-static-routes.sh"

key-decisions:
  - "The listener effect keys on `[onPlayRef]` alone, NOT on `[assetId, onPlayRef]` as the plan's action text specified. Biome errors on `assetId` as an extra dependency (`useExhaustiveDependencies`: 'Specifying more dependencies than required…'), the plan's own fails_when forbids resolving that with a suppression, and the MutationObserver already covers the asset-change case the re-key was meant to cover — a replaced element is reconciled, the old detached and the new attached. Probed rather than assumed: the deps were temporarily widened and biome was run against them"
  - "The pause/mute effect reads `attachments` (`if (attachments === 0) return`) rather than listing it unread. The early return is real — before the first attachment there is no element to apply anything to — and it is what makes the counter a legitimate dependency instead of a suppression waiting to be written"
  - "`StoryViewerHost.test.tsx`'s new case 13 asserts the zero/non-finite duration guard BETWEEN the 50% assertion and the hand-over, not after it as the plan's action text ordered: once the viewer has advanced, segment 0 is full by POSITION (`k < index`) and could no longer show a fill that failed to move. Documented in a comment beside the assertion"
  - "The vendor stand-in attaches its media surface (currentTime, duration, muted, play, pause) in a REF CALLBACK rather than an effect, so the properties are on the node before the bridge's MutationObserver callback can be delivered as a microtask — a deterministic ordering instead of a race between two async mechanisms"
  - "STORY-02 is marked complete. 05-10 deliberately withheld it because the video half was still broken; it no longer is, and all four of SC-3c's clauses now have executable evidence. The absence of a VIDEO-playback e2e is a verification-DEPTH limitation carried into 05-12's human pack, not an unimplemented requirement"

patterns-established:
  - "A defect whose cause was written into a docblock as INTENT gets the docblock rewritten as part of the fix, stating the real rule and naming the alternative that was rejected — otherwise the next reader restores the bug from the comment"
  - "A test-only TDD task whose implementation already landed in an earlier task takes its RED record by restoring the pre-fix source from its own RED commit, running the shipped (formatted) assertions against it, and restoring the fixed source before committing"

requirements-completed: [STORY-02]

coverage:
  - id: D1
    description: "The bridge attaches its four listeners to a vendor element that mounts a tick after the token resolves, and forwards canplay/playing/timeupdate/error exactly once per dispatch"
    requirement: "STORY-02"
    verification:
      - kind: unit
        ref: "apps/web/components/stories/StoryVideo.test.tsx#1. attaches to an element that mounts LATE and forwards all four of its events"
        status: pass
      - kind: static
        ref: "grep: MutationObserver prints 1 and biome-ignore prints 0 over the non-comment lines of StoryVideo.tsx; `tokens]` prints 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "A VIDEO story inside the REAL viewer fills its segment from the element's own time (50% at 2.5s of 5s) and hands over to the next story at the full duration"
    requirement: "STORY-02"
    verification:
      - kind: unit
        ref: "apps/web/components/stories/StoryViewerHost.test.tsx#13 (story-fill-0 width 50%, then data-story-index 1), with './StoryVideo' unmocked and 'next/dynamic' unmocked"
        status: pass
    human_judgment: false
  - id: D3
    description: "A time update whose duration is zero or non-finite moves nothing — a segment never fills off a number the element cannot mean"
    requirement: "STORY-02"
    verification:
      - kind: unit
        ref: "StoryVideo.test.tsx#2 (two dispatches, zero calls); StoryViewerHost.test.tsx#13 (fill stays at 50% across both)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The paused and muted flags the bridge is already holding are applied AT ARRIVAL, with no prop change in between; flipping paused to false plays; unmount detaches every listener and hands the host null"
    requirement: "STORY-02"
    verification:
      - kind: unit
        ref: "StoryVideo.test.tsx#3 (pause called once, muted true, play zero), #4 (resume), #5 (callable then null, post-unmount dispatch fires nothing)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A refused playback token surfaces as a media error and mounts no vendor element — no provider string, status or expiry sentence reaches the screen"
    requirement: "STORY-02"
    verification:
      - kind: unit
        ref: "StoryVideo.test.tsx#6"
        status: pass
    human_judgment: false
  - id: D6
    description: "T-05-49: all three shipped /stories routes are inside the TENANT-02 static-route gate, so a rename fails the gate instead of silently dropping them from coverage"
    requirement: "TENANT-02"
    verification:
      - kind: static
        ref: "pnpm --filter @tria/web build && bash scripts/check-static-routes.sh — offenders: 0, 39 guarded routes checked; grep '(app)/stories/' prints 3"
        status: pass
    human_judgment: false
  - id: D7
    description: "The shipped browser-level gesture contract still holds over 05-10 Task 3's restructured pointer subtree and this plan's rewritten bridge"
    requirement: "STORY-02"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/stories.spec.ts — 31 passed / 11 skipped across both projects; on mobile-chromium all 8 tap/hold/swipe/deep-link cases pass (lines 319, 339, 361, 402, 427, 439, 458, 470)"
        status: pass
    human_judgment: false
  - id: D8
    description: "A real video story plays through in the viewer end to end: the segment fills from the asset's own time and auto-advances (or closes) when the video ends"
    verification: []
    human_judgment: true
    rationale: "NAMED LIMITATION, carried forward rather than absorbed. The local video provider is `fake` with no real HLS stream and the seed fixture is image-only, so an e2e would assert over a player that cannot play. 05-VERIFICATION human check 2 — publish a video story as admin_tenant, wait for ready, open it from the strip — stays OPEN and is carried into 05-12's human-verification pack. The component-level chain proved in D1–D4 is everything that can be proved without a real transcode."

# Metrics
duration: 13min
completed: 2026-09-24
status: complete
---

# Phase 05 Plan 11: Story Viewer Video Path Summary

**The video half of GAP 2 is closed: `StoryVideo` now observes for the vendor element it was always going to lose the race with, applies the pause and mute flags the moment that element arrives, and a real video story inside the real viewer fills its progress segment from the asset's own time and hands over to the next story — with the late mount reproduced in the tests rather than removed, and the three shipped `/stories` routes finally inside the static-route gate.**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-09-24T12:13:57Z
- **Completed:** 2026-09-24T12:26:38Z
- **Tasks:** 3 (2 TDD: 2 RED-verified cycles; 1 auto)
- **Files modified:** 4 (3 modified, 1 created)

## Accomplishments

- **The bridge stopped guessing when the element would arrive.** The shipped listener effect keyed on `[tokens, onPlayRef]` with a docblock declaring that `tokens` was a dependency the body never read *and that this was the point* — because setting the token is what mounts `<mux-player>`. It is not. `MuxPlayer` comes through `next/dynamic(…, { ssr: false })`, whose chunk has not resolved on the commit where `tokens` first becomes non-null; the one-shot `querySelector` returned null, the effect returned early, and `onPlayRef` is a stable `useCallback([])` in the host, so neither dependency ever changed again. The effect now resolves its own frame, reconciles once synchronously, and keeps a `MutationObserver` over that frame with `childList` + `subtree` for the life of the mount. Reconcile detaches what is attached when the query finds a different node, so a replaced element (an asset change) cannot strand the listeners.
- **The observer is deliberately NOT disconnected on first success.** A one-shot observer would reproduce the same class of defect one level up — the element is replaced, not merely created once.
- **A ref callback was considered and rejected, in writing.** `next/dynamic` does not forward refs to the wrapped component, so `ref={…}` on `<MuxPlayer>` would be a second silent no-op with exactly the shape of the first. The docblock now says so, because the docblock is how the original bug was preserved as intent.
- **The second half of the same defect is fixed with it.** The pause/mute effect had the identical one-shot query, so `muted` and `paused` were not applied until some later toggle happened to re-run it. It now reads the element from a ref and keys on an attachment counter it actually reads (`if (attachments === 0) return`), so the flags the bridge *arrives holding* are applied at arrival. `StoryVideo.test.tsx#3` asserts exactly that, with no prop change between the render and the assertion.
- **Both `biome-ignore` suppressions are gone.** With `tokens` out of both dependency arrays there is nothing left to suppress — `grep -c biome-ignore` over the file's non-comment lines prints 0.
- **The suite can now see the video path at all.** `StoryViewerHost.test.tsx` stubbed `./StoryVideo` with a `<div/>` "because its vendor element cannot mount under happy-dom", and that stub is precisely why a broken viewer shipped green. The stub is deleted. The seams that belong to a unit test are mocked instead: the playback-token **server action** (a credential minted on the server) and the **vendor package** (a third party's custom element). `next/dynamic` is left unmocked — mocking it to resolve eagerly would delete the very condition the defect lives in.
- **The stub-proof is in the DOM.** Case 13 reads `story-fill-0`'s inline width going `0%` → `50%` after a `timeupdate` at 2.5 s of a 5 s asset, then asserts `data-story-index` moved to `1` at the full duration. A `<div/>` stand-in produces no `mux-player` to dispatch on and no fill movement, so a re-stubbed suite cannot satisfy this case.
- **The bridge has a contract of its own** — six counted cases: late attach and four forwarded events, the duration guard (two dispatches, zero calls), the flags applied at arrival, resume, the play binding plus a clean detach that leaves no live listener, and a refused token that raises the media error and mounts no vendor element.
- **Three shipped authenticated routes rejoined the gate that exists to watch them.** `GUARDED_PREFIXES` already covered `/stories/*` through the `(app)` prefix, but the *existence* half of the check did not name them — so a rename would have dropped them from coverage silently rather than failing with "route moved or renamed". Insertions only; `ALLOWED_STATIC` and `STATIC_DYNAMIC_ROUTE` untouched.
- **The wave's browser-level regression gate was actually run, and it is green.** `apps/web/e2e/stories.spec.ts` drives the story stage with real pointer events over 05-10 Task 3's restructured pointer subtree *and* this plan's rewritten bridge. On `mobile-chromium` all eight tap / hold / swipe / deep-link cases pass; the full run across both projects is 31 passed / 11 skipped (the 11 are the desktop-project skips the spec itself declares: "the gesture model is the phone's").

## Task Commits

| Task | Gate | Commit | Files |
|---|---|---|---|
| 1 | RED | `f91b818` | `apps/web/components/stories/StoryViewerHost.test.tsx` |
| 1 | GREEN | `ca61d0e` | `apps/web/components/stories/StoryVideo.tsx` |
| 2 | RED+GREEN | `1db7071` | `apps/web/components/stories/StoryVideo.test.tsx` (new) |
| 3 | — | `aeaaf19` | `scripts/check-static-routes.sh` |

## TDD Gate Compliance

Tasks 1 and 2 carried `tdd="true"`; both ran a full RED → GREEN cycle with a verified evidence record. Task 3 is `type="auto"` and carries no gate. No REFACTOR commit was needed: each GREEN landed in its final shape.

| Task | Target test | RED verdict | RED evidence |
|---|---|---|---|
| 1 | `StoryViewerHost … 13. a VIDEO story's segment advances from the ELEMENT'S OWN TIME and then hands over` | `RED_EVIDENCE_OK` | exit 1, 13 tests / 12 pass / 1 fail; `expected '0%' to be '50%'` |
| 2 | `StoryVideo … 1. attaches to an element that mounts LATE and forwards all four of its events` | `RED_EVIDENCE_OK` | exit 1, 6 tests / 3 pass / 3 fail; `expected "vi.fn()" to be called 1 times, but got 0 times` |

**RED evidence provenance.** Vitest emits no TAP and this repo wires no TAP reporter, so each RED run was executed with `--reporter=json --outputFile=<tmp>.json` and normalised into the checker's TAP-shaped record by a throwaway script under the session scratch directory. That script is not a project artifact, was never committed, and does not appear in `key-files`. No count above was hand-written: every `tests`/`pass`/`fail` figure is projected from a real Vitest run, and both records were verified with `gsd-tools check tdd-red-evidence` before the corresponding production edit.

**Task 2's RED is honest, not inherited.** Task 2 creates a test file for a component Task 1 had already fixed, so a naive run would have been green. The pre-05-11 `StoryVideo.tsx` was restored from Task 1's own RED commit (`f91b818`), the *shipped* (biome-formatted) assertions were run against it, and the fixed source was restored before committing — `git diff --stat` over `StoryVideo.tsx` confirmed byte-identical restoration. Three of the six cases go red there: case 1 (no listener ever attaches), case 3 (the flags are never applied on arrival) and case 5 (the play binding is never handed a callable). Case 4 passes against the *old* bridge for an instructive reason worth recording — flipping `paused` IS the "later toggle" the old effect waited for, which is exactly the behaviour case 3 exists to forbid.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The listener effect keys on `[onPlayRef]`, not `[assetId, onPlayRef]`**
- **Found during:** Task 1 GREEN
- **Issue:** The plan's action text says the effect "keys on the asset id and the play-binding callback". The effect body never reads `assetId`, and biome's `lint/correctness/useExhaustiveDependencies` errors on it: *"Specifying more dependencies than required can lead to unnecessary re-rendering"*. The plan's own `fails_when` forbids resolving this with a suppression comment, and its acceptance criteria require `grep -c biome-ignore` to print 0.
- **Probed rather than assumed:** the deps were temporarily widened to `[assetId, onPlayRef]` and biome was run against the file — it errored with an "Unsafe fix: Remove the extra dependencies from the list" on `assetId` specifically.
- **Fix:** `[onPlayRef]`. The re-key on `assetId` was meant to cover an asset change replacing the element; the `MutationObserver` covers that case directly and more reliably — reconcile detaches the old node and attaches the new one whenever the query disagrees with what is attached.
- **Files modified:** `apps/web/components/stories/StoryVideo.tsx`
- **Commit:** `ca61d0e`

### Adjusted Assertions (no behaviour change)

**2. Case 13's duration guard is asserted BEFORE the hand-over, not after it**
- **Found during:** Task 1 RED
- **Issue:** The plan's action text orders the case as 50% → advance → "finally dispatch a `timeupdate` with a zero duration and assert the fill did not move". Once the viewer has advanced, `story-fill-0` is `100%` by POSITION (`StoryProgressBars` renders `k < index` as full), so a fill that failed to move would be indistinguishable from one that did.
- **Fix:** the guard (zero duration *and* non-finite duration, two dispatches) is asserted between the 50% assertion and the hand-over, where 50% is still an observable that could change. Documented in a comment beside the assertion. The same guard is independently asserted at the bridge's own level in `StoryVideo.test.tsx#2`.
- **Files modified:** `apps/web/components/stories/StoryViewerHost.test.tsx`
- **Commit:** `f91b818`

**3. The vendor stand-in attaches its media surface in a ref callback, not an effect**
- **Found during:** Task 2
- **Issue:** The plan asks the stand-in to "give the rendered element the media-element surface the bridge reaches for". An effect would set `play`/`pause` during the passive-effect flush, racing the `MutationObserver` callback (delivered as a microtask) that triggers the bridge's pause/mute effect.
- **Fix:** a ref callback, which runs during the commit — the properties are on the node before the observer can be delivered. Deterministic instead of racy; documented beside the mock.

## Authentication Gates

None. This plan touches no server route, no credential and no auth path. The playback token is unchanged: still minted per request in the bridge's own closure, never cached, never written to a cookie, the router cache or a log line.

## Verification

| Gate | Result |
|---|---|
| `pnpm --filter @tria/web typecheck` | ✓ |
| `pnpm --filter @tria/web lint` (biome, 262 files) | ✓ no suppressions added anywhere |
| `pnpm --filter @tria/web test` | ✓ 126 passed / 15 files (`StoryVideo.test.tsx` 6/6, `StoryViewerHost.test.tsx` 13/13 — 12 pre-existing + the new case 13) |
| `pnpm --filter @tria/web build && bash scripts/check-static-routes.sh` | ✓ `offenders: 0`, `guarded routes checked: 39` |
| `grep -c "(app)/stories/" scripts/check-static-routes.sh` | ✓ 3 |
| `git diff --stat scripts/check-static-routes.sh` | ✓ 6 insertions, 0 deletions |
| `pnpm db:reset && pnpm db:seed && playwright test stories.spec.ts` | ✓ 31 passed / 11 skipped; `--project=mobile-chromium` 20 passed / 1 skipped, including all 8 gesture cases |
| `git status --porcelain -- apps/web/e2e` | ✓ empty — the shipped suite was RUN, not edited |
| `bash scripts/check-ui-literals.sh` | ✓ OK |
| `pnpm boundaries` | ✓ 556 files, 9 packages, no issues |
| No schema/migration file touched | ✓ `git diff --name-only 6a8aa44..HEAD` lists three `.tsx` files and one `.sh`; zero matches under `supabase/migrations/` or any `db/schema` |

## Inherited Verification Debt — resolved

05-10 deferred `apps/web/e2e/stories.spec.ts` to this plan and recorded it as `unrun-verify` entry **41** in `.planning/WINDOWS.md`. It was run here, green, in a real browser, after a full `db:reset` + `db:seed`. **No case failed**, so there was nothing to diagnose against 05-10's restructure: the badge and the media-error container being siblings of the gesture stage rather than children of it does not disturb any of the eight gesture cases. Ledger entry 41 is now `fixed`.

The 11 "skipped" results in the cross-project run are the spec's own `test.skip(!isMobile, 'the gesture model is the phone's')` guards firing on `desktop-chromium`; the `mobile-chromium` project ran and passed every one of them. This is stated explicitly because "31 passed, 11 skipped" on its own would be exactly the shape of a suite that never exercised what it claims to.

## Known Stubs

None introduced. One stub was RETIRED: `StoryViewerHost.test.tsx`'s `vi.mock('./StoryVideo')` — the stand-in that made GAP 2's video half invisible to the suite — is deleted, and the file's docblock now records why stubbing the component under test was the wrong seam in the first place.

## Threat Flags

None. No new network endpoint, auth path, file-access pattern or trust-boundary schema change. The plan's register is addressed as written: `T-05-49` (the static-route coverage gap) is mitigated by Task 3 and proved by a real build plus a zero-offender gate run; `T-05-50` (the permanently-stuck video path, a denial of service on one of the phase's two media kinds) is mitigated by Task 1 and asserted at both the bridge level and the viewer level with the late mount reproduced; `T-05-51` is `accept` and unchanged — Task 2's refusal case proves a refused token surfaces as a media error rather than a provider string; `T-05-52` is `accept` (the stand-in lives only in two test files); `T-05-SC` holds — no package install occurred, `@mux/mux-player-react` was already a declared dependency of `apps/web`.

## Open Items Carried Forward

- **NAMED LIMITATION — there is no end-to-end case for VIDEO playback, and this plan did not invent one.** The local video provider is `fake` with no real HLS stream and the seed fixture is image-only, so an e2e would assert over a player that cannot play. `05-VERIFICATION.md` human check 2 — *publish a VIDEO story as `admin_tenant`, wait for it to become ready, then open it from the `/inicio` strip; the segment should fill from the video's own time and auto-advance or close when the video ends* — stays **OPEN** and is carried into 05-12's human-verification pack. Recorded as a new `unrun-verify` entry in `.planning/WINDOWS.md`.
- **The two plan prohibitions remain `status: unverified` / `verification: flagged`, as the plan declared them.** Both now have executable evidence pointing the right way: "a video segment must never be driven by a substitute clock" is asserted by the duration guard at both levels (`StoryVideo.test.tsx#2`, `StoryViewerHost.test.tsx#13`) and by the fact that `StoryViewer`'s clock is still gated off for `isVideo` — the bar moves only on the element's own report, or not at all. "The playback token must never be cached, persisted or reused" is unchanged by this plan; there is still no `"use cache"`, `unstable_cache` or `revalidate` anywhere near it, and `StoryVideo.test.tsx#6` proves a refusal surfaces as a media error rather than a provider string.
- **05-10's human check 1 is unaffected and still open** — a 30 s device profile of the viewer's image path on real hardware. No automated check in this repo can settle a render-rate property under a real decoder.
- **STORY-02 is now marked complete in `REQUIREMENTS.md`.** 05-10 withheld it because the requirement covers both media paths and the video half was broken; it no longer is. All four of SC-3c's clauses — progress bars, auto-advance, tap-to-navigate, hold-to-pause — have executable evidence, the image path from 05-10 and the video path from here, with the browser-level gesture gate green. The open human check is a verification-DEPTH item, not an unimplemented clause.

## Self-Check: PASSED

All five declared files exist on disk; all four task commits resolve in `git log`.
