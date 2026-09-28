---
phase: quick-260924-fwv
plan: 01
subsystem: api
tags: [postgres, drizzle, hono, react, vitest, testing-library, stories, communities]

requires:
  - phase: 05-communities-stories
    provides: "the two defects this task fixes (CR-01, CR-02) and the verification pack that reproduced them RED"
provides:
  - "CR-01: updateCommunity validates the cover the REQUEST asserts, never the one the row stores — a community whose cover was retired through DELETE /v1/media/{assetId} stays writable and self-heals its dangling reference to null"
  - "CR-02: StoryViewerHost keys the play registration by story id, so the play badge reaches the CURRENT story's element and neither neighbour's, and only the owner can clear its own slot"
  - "WR-09: two stories-module comment blocks no longer name a Playwright spec as a regression gate the repo does not have"
affects: [05-communities-stories re-verification, stories, communities]

actuals:
  tokens: 9666
  tasks: 3
  commits: 5
  plan_head_before: 2b267761d6c23b6f168e7d6bf04a9b9caa45725c

tech-stack:
  added: []
  patterns:
    - "One shared lookup + one shared predicate feeding both a throwing and a boolean consumer (loadCoverAsset / isUsableCover -> resolveCoverAsset / coverIsUsable)"
    - "Per-entity callback registration keyed by id with owner-only clear (bindPlay now matches bindCountBump)"
    - "Forced-order test harness: gated async fixtures released deliberately so a pre-fix green is a test defect, not evidence of absence"

key-files:
  created: []
  modified:
    - packages/modules/communities/server/service.ts
    - apps/api/tests/integration/communities.test.ts
    - apps/web/app/(app)/comunidades/actions.test.ts
    - apps/web/components/stories/StoryVideo.tsx
    - apps/web/components/stories/StoryViewerHost.tsx
    - apps/web/components/stories/StoryVideo.test.tsx
    - apps/web/components/stories/StoryViewerHost.test.tsx
    - packages/modules/stories/ui/StoryViewer.tsx
    - packages/modules/stories/tests/story-viewer.test.tsx

key-decisions:
  - "A dangling STORED cover is self-healed to null rather than enforced: a request that asserted nothing about the cover must never 404 on one. A request that DOES assert an id keeps its byte-identical bare 404, so case 31's anti-oracle property is unchanged."
  - "storyId was made a REQUIRED prop on StoryVideoProps (not optional-with-fallback), so the compiler enumerates every render site — which is what caught the six the plan did not mention."
  - "Case 14's RED is carried by 'story 2's spy is at zero' — the neighbour the harness forces to attach last. 'Story 1 was played' is explicitly NOT evidence and is documented as such in the case."

patterns-established:
  - "Bounded self-heal: a repair write is made observable (updated_at moves, exactly one event) and then proven inert on the next identical request, so it is a one-time repair rather than a write on every request forever."
  - "Harness-describing assertions alongside bug-describing ones: the per-release element-count and data-playback-id checks pass both before and after the fix, so a harness that stops forcing the order fails loudly instead of going quietly green."

requirements-completed: [COMM-01, STORY-02]

coverage:
  - id: D1
    description: "A community whose cover asset was retired through DELETE /v1/media/{assetId} still accepts every write, and its stored cover_asset_id reads back null afterwards"
    requirement: "COMM-01"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#33. the DOMESTIC stale cover: retiring a community's OWN cover must not brick every later write (CR-01)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The CR-01 regression guards hold: a PATCH sending an unusable cover id is still the bare 404 with no details key, and a PATCH identical to a stored row with a usable cover is still observably inert"
    requirement: "COMM-01"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#31. a PATCH re-sending the stored cover is still INERT — and still validated"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#24. a PATCH identical to the stored row is a 200 that changes nothing"
        status: pass
    human_judgment: false
  - id: D3
    description: "The self-heal is bounded and each side effect is pinned: the healing PATCH moves updated_at and announces exactly one community.updated, and an identical PATCH immediately after is inert again"
    requirement: "COMM-01"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#33 (updated_at + event-count assertions)"
        status: pass
    human_judgment: false
  - id: D4
    description: "With three adjacent video stories mounted, a tap on story-autoplay-badge calls play() on the current story's element and on zero neighbour elements"
    requirement: "STORY-02"
    verification:
      - kind: unit
        ref: "apps/web/components/stories/StoryViewerHost.test.tsx#14. the play badge reaches the CURRENT story's element and NEITHER neighbour's (CR-02)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A neighbour StoryVideo leaving the window clears only its OWN play registration; the active story's badge still reaches its own element afterwards"
    requirement: "STORY-02"
    verification:
      - kind: unit
        ref: "apps/web/components/stories/StoryViewerHost.test.tsx#14 (owner-only-clear guard half)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Neither stories-module file names a Playwright spec as a regression gate the repo does not have (WR-09)"
    verification:
      - kind: other
        ref: "! grep -n 'e2e/stories.spec.ts' packages/modules/stories/ui/StoryViewer.tsx packages/modules/stories/tests/story-viewer.test.tsx"
        status: pass
    human_judgment: false
  - id: D7
    description: "The CR-04 hit-testing half — a tap on the error COPY falling through to the stage via pointer-events-none — remains asserted by no automated test"
    verification: []
    human_judgment: true
    rationale: "happy-dom does not hit-test and no browser-level spec in this repo drives these controls. This run's scope was CR-01 and CR-02; WR-09 only corrected the inaccurate coverage CLAIM. SC-3c's missing browser coverage stays open and out of scope."

duration: 24 min
completed: 2026-09-24
status: complete
---

# Quick Task 260924-fwv: Corrigir os dois defeitos introduzidos pela rodada de gap-closure da Fase 5

**`updateCommunity` now validates the cover the REQUEST asserts instead of the one the row stores (a retired cover self-heals to null rather than bricking every later write), and `StoryViewerHost` keys its play registration by story id so the play badge reaches the current story's element rather than whichever neighbour attached last.**

## Performance

- **Duration:** 24 min
- **Tasks:** 3 of 3
- **Files modified:** 9

## Accomplishments

- **CR-01 fixed and pinned.** `updateCommunity` branches on whether the request carried `coverAssetId`. An asserted id is refused exactly as before; a dangling *stored* reference is dropped to null. A community whose own admin retired its cover through `DELETE /v1/media/{assetId}` can now be renamed, edited, archived and reactivated — previously every one of those 404'd permanently and the BFF reported "Comunidade não encontrada" about a community open on the admin's screen.
- **CR-02 fixed and pinned.** `StoryVideo` takes a required `storyId` and calls `onPlayRef(storyId, play | null)`; `StoryViewerHost` holds a `playRefs` record keyed by story id. Only the owner clears its own slot, so a neighbour leaving the 3-wide window can no longer silence the active story.
- **Both fixes ship with a test observed failing before the fix and passing after it**, each verified through `gsd_run check tdd-red-evidence` with verdict `RED_EVIDENCE_OK` — the thing the two previous rounds of this phase did not have.
- **WR-09 folded in:** two comment blocks that named `apps/web/e2e/stories.spec.ts` as a regression gate now name no spec and state plainly that the hit-testing half is asserted by no automated test.
- **All seven Task 3 gates exit zero**, including the whole integration suite (480 tests) — not a narrowed subset.

## Task Commits

1. **Task 1 RED: failing case 33 for the domestic stale cover** — `ca0d761` (test)
2. **Task 1 GREEN: validate the cover the REQUEST asserts** — `7b3f47d` (feat)
3. **Task 2 RED: failing case 14 for the shared play registration** — `16a3755` (test)
4. **Task 2 GREEN: key the play registration by story id + WR-09** — `d92cb15` (fix)
5. **Task 3 fallout: biome formatting on the touched files** — `e1631da` (style)

## RED → GREEN evidence

Both REDs were machine-verified, not asserted in prose. Vitest emits no TAP and no TAP reporter is wired up here, so each run was taken with `--reporter=json` and normalised by a **throwaway** script in the session scratch dir, deleted before any commit (confirmed absent from all five commits). Every count below is measured from the vitest report; none is fabricated.

| Fix | Target test | Pre-fix | Verdict |
|-----|-------------|---------|---------|
| CR-01 | `communities.test.ts` case 33 | 33 discovered, 32 pass, 1 fail — `PATCH { status: archived } after the cover was retired: expected 404 to be 200` | `RED_EVIDENCE_OK` |
| CR-02 | `StoryViewerHost.test.tsx` case 14 | 14 discovered, 13 pass, 1 fail — `the NEXT neighbour — forced to attach last — must not be played: expected +0 times, but got 1 times` | `RED_EVIDENCE_OK` |

**Case 14's RED landed on the intended assertion.** The failure is `story 2's spy is at zero` — the neighbour the harness forced to attach last — not on the "story 1 was played" half, which the plan correctly identifies as no evidence at all (the badge handler clears `blocked[currentId]`, which drops `autoplayBlocked` out of `paused`, which re-runs the pause/mute effect and plays the active element on broken and fixed code alike). The per-release element-count and `data-playback-id` assertions all passed in the pre-fix run, proving the forced release order (story 1 → story 0 → story 2) actually held rather than being hoped for. The stop rule was never triggered: the pre-fix run was not green.

The detach/owner-only-clear half passes today and is recorded as a **regression guard only**, exactly as the plan requires — no RED was manufactured for it.

## Task 3 gate results (verbatim)

| # | Command | Result |
|---|---------|--------|
| 1 | `pnpm lint` | **exit 0** — 9/9 tasks; `Checked 262 files… No fixes applied`; `check-ui-literals: OK` *(failed twice first — see deviations)* |
| 2 | `pnpm turbo typecheck` | **exit 0** — 10/10 tasks successful |
| 3 | `pnpm --filter @rede-social/web test` | **exit 0** — Test Files 15 passed (15), Tests 128 passed (128) |
| 4 | `pnpm --filter @rede-social/module-stories test` | **exit 0** — Test Files 9 passed (9), Tests 89 passed (89) |
| 5 | `pnpm --filter @rede-social/api test` | **exit 0** — Test Files 3 passed (3), Tests 16 passed (16) |
| 6 | `pnpm --filter @rede-social/api test:integration` | **exit 0** — Test Files 29 passed (29), Tests 480 passed (480) |
| 7 | `pnpm boundaries` | **exit 0** — `Checked 556 files in 9 packages, no issues found` |

Plan-level verification also run: `! grep -n "e2e/stories.spec.ts" packages/modules/stories/ui/StoryViewer.tsx packages/modules/stories/tests/story-viewer.test.tsx` — passes, neither file names the spec.

`pnpm verify` was deliberately NOT run: it resets/re-seeds the database and runs the full Playwright and PWA suites (~20 min). It is the phase exit gate and belongs to the re-verification round that follows this plan.

## Files Created/Modified

- `packages/modules/communities/server/service.ts` — extracted `loadCoverAsset` (the single select) and `isUsableCover` (the single tuple rule); `resolveCoverAsset` keeps its exact throwing contract on top of them, new sibling `coverIsUsable` answers a boolean off the same row; `updateCommunity` branches on whether the request carried `coverAssetId`.
- `apps/api/tests/integration/communities.test.ts` — new case 33 (the domestic stale cover, retired through the shipped DELETE endpoint).
- `apps/web/app/(app)/comunidades/actions.test.ts` — the archive case keeps its assertions but no longer presents the stale-cover archive 404 as intended; new sibling case for a successful `archiveCommunityAction`.
- `apps/web/components/stories/StoryVideo.tsx` — required `storyId` prop, two-argument `onPlayRef(storyId, play | null)`.
- `apps/web/components/stories/StoryViewerHost.tsx` — `playRefs` record keyed by story id, `bindPlay(storyId, play | null)`, `onRequestPlay` resolving `item.id`.
- `apps/web/components/stories/StoryViewerHost.test.tsx` — new case 14; `MuxPlayerStandIn` now forwards `playbackId` as `data-playback-id`; new `mountedPlayers(count)` helper.
- `apps/web/components/stories/StoryVideo.test.tsx` — `storyId` at all seven render sites; case 5 asserts the id at index 0 and the callable/null at index 1.
- `packages/modules/stories/ui/StoryViewer.tsx` — WR-09 comment correction only (no code change).
- `packages/modules/stories/tests/story-viewer.test.tsx` — WR-09 comment correction only.

## Decisions Made

- **`storyId` stayed REQUIRED rather than optional-with-a-stable-fallback.** An optional prop reaches the same property but silently tolerates a render site that forgets it — and a forgotten site is exactly the CR-02 failure mode (an unkeyed registration). Required means the compiler enumerates every consumer, which is how the six unlisted render sites were found rather than guessed at.
- **The BFF's `coverAwareRefusal` was left untouched**, as the plan directs. The server fix removes the cause, so its conservative `not_found` for a cover-silent submission stays correct; only the *meaning* of that 404 narrowed, which is a comment/name change, not a code change.

## Deviations from Plan

### 1. [Planned correction, handed to me at dispatch] `storyId` needed all seven `StoryVideo` render sites, not one

- **Found during:** Task 2
- **Issue:** The plan's `key_links` line at PLAN.md:49 states that `StoryVideo`'s `onPlayRef` prop "has exactly TWO call sites — `StoryViewerHost.tsx:159` and `StoryVideo.test.tsx:211` (case 5). Both must move together or typecheck fails." That is true of **`onPlayRef`** and false of **`storyId`**: Task 2 makes `storyId` a *required* prop, and `StoryVideo.test.tsx` renders the component at seven places (lines 144, 167, 182, 197, 201, 211, 233). `apps/web/tsconfig.json` includes `**/*.tsx` with no test exclusion, so Task 3's typecheck would have failed on the six the plan did not name.
- **Fix:** Added a `STORY_ID` constant to `StoryVideo.test.tsx` and passed `storyId={STORY_ID}` at all seven sites. Chose this over making `storyId` optional with a per-mount fallback (see Decisions).
- **Verification:** `pnpm turbo typecheck` exit 0 (gate 2), which is the gate that would have caught a missed site.
- **Commit:** `d92cb15`
- **Note for the artifact:** PLAN.md line 49 remains inaccurate about `storyId` and should not be read as a count of render sites.

### 2. [Rule 3 - Blocking] Biome formatting fallout on the files Tasks 1 and 2 own

- **Found during:** Task 3, gate 1
- **Issue:** `pnpm lint` failed twice — first on `service.ts` (Biome would collapse `coverIsUsable`'s signature to one line), then on the two story test files (line-length wrapping in the new case 14 assertions and the widened `StoryVideo` render calls).
- **Fix:** `biome check --write` on exactly those three files. Formatting only — no assertion, no behaviour, no test name changed.
- **Verification:** `pnpm lint` exit 0; the full web, stories and API suites re-run green afterwards.
- **Commit:** `e1631da`

**Total deviations:** 1 pre-authorised plan correction + 1 auto-fixed blocking issue (Rule 3). **Impact:** none on behaviour. Deviation 1 was identified before execution and treated as planned work; deviation 2 is cosmetic.

## Known Stubs

None. A scan of all nine changed files for hardcoded empty values, placeholder text, `TODO`/`FIXME`, `.skip(` and `test.todo(` found only pre-existing prose uses of the word "placeholder" (describing the feed's `processando` video placeholder and a form's `comments.placeholder` catalog key) and `clock.skip(600)`, which is a manual-clock test helper, not a skipped test.

## Scope explicitly NOT closed

**SC-3c stays open.** WR-09 only deleted an inaccurate claim; it did not add the browser-level coverage the claim promised. The CR-04 hit-testing half (a tap on the error copy falling through to the stage via `pointer-events-none`) is still asserted by no automated test and is carried as an open human check in the phase's verification pack — now stated honestly in both comment blocks instead of being attributed to a spec that never asserted it. Writing that coverage was deliberately out of this run's scope, which the user set to CR-01 and CR-02.

## Next

Ready for the Phase 05 re-verification round (`pnpm verify` and `/gsd-verify-work 05`). Both defects the verifier reproduced RED through shipped endpoints are now fixed, each pinned by a named test that was observed failing before the fix.

## Self-Check: PASSED

- All nine modified files exist on disk (`git status --short` reports no tracked changes — working tree clean).
- All five commits verified present via `git log 2b267761..HEAD`: `ca0d761`, `7b3f47d`, `16a3755`, `d92cb15`, `e1631da`.
- `commits: 5` is MEASURED — `git rev-list --count 2b267761d6c23b6f168e7d6bf04a9b9caa45725c..HEAD`, base read from the on-disk plan ledger.
- The throwaway TAP normaliser was deleted and is confirmed absent from all five commits.
- All seven Task 3 gate commands re-confirmed exit 0 after the final formatting commit.
