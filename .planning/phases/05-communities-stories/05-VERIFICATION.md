---
phase: 05-communities-stories
verified: 2026-09-24T13:20:00Z
status: gaps_found
score: 13/15 must-haves verified
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/ROADMAP.md"
  - ".planning/WINDOWS.md"
  - ".planning/phases/05-communities-stories/05-01-PLAN.md"
  - ".planning/phases/05-communities-stories/05-01-SUMMARY.md"
  - ".planning/phases/05-communities-stories/05-02-PLAN.md"
  - ".planning/phases/05-communities-stories/05-02-SUMMARY.md"
  - ".planning/phases/05-communities-stories/05-03-PLAN.md"
  - ".planning/phases/05-communities-stories/05-03-SUMMARY.md"
  - ".planning/phases/05-communities-stories/05-04-PLAN.md"
  - ".planning/phases/05-communities-stories/05-04-SUMMARY.md"
  - ".planning/phases/05-communities-stories/05-05-PLAN.md"
  - ".planning/phases/05-communities-stories/05-05-SUMMARY.md"
  - ".planning/phases/05-communities-stories/05-06-PLAN.md"
  - ".planning/phases/05-communities-stories/05-06-SUMMARY.md"
  - ".planning/phases/05-communities-stories/05-07-PLAN.md"
  - ".planning/phases/05-communities-stories/05-07-SUMMARY.md"
  - ".planning/phases/05-communities-stories/05-08-PLAN.md"
  - ".planning/phases/05-communities-stories/05-08-SUMMARY.md"
  - ".planning/phases/05-communities-stories/05-09-PLAN.md"
  - ".planning/phases/05-communities-stories/05-09-SUMMARY.md"
  - ".planning/phases/05-communities-stories/05-10-PLAN.md"
  - ".planning/phases/05-communities-stories/05-10-SUMMARY.md"
  - ".planning/phases/05-communities-stories/05-11-PLAN.md"
  - ".planning/phases/05-communities-stories/05-11-SUMMARY.md"
  - ".planning/phases/05-communities-stories/05-12-PLAN.md"
  - ".planning/phases/05-communities-stories/05-12-SUMMARY.md"
  - ".planning/phases/05-communities-stories/05-REVIEW.md"
  - ".planning/phases/05-communities-stories/05-VERIFICATION-DEBT.md"
  - "apps/api/tests/integration/communities.test.ts"
  - "apps/api/tests/integration/isolation.test.ts"
  - "apps/web/app/(app)/comunidades/CommunityForm.tsx"
  - "apps/web/app/(app)/comunidades/actions.test.ts"
  - "apps/web/app/(app)/comunidades/actions.ts"
  - "apps/web/components/stories/StoryVideo.test.tsx"
  - "apps/web/components/stories/StoryVideo.tsx"
  - "apps/web/components/stories/StoryViewerHost.test.tsx"
  - "apps/web/messages/pt-BR/communities.json"
  - "packages/core/tests/media-image.test.tsx"
  - "packages/core/ui/MediaImage.tsx"
  - "packages/modules/communities/contracts/index.ts"
  - "packages/modules/communities/server/service.ts"
  - "packages/modules/stories/tests/story-viewer-media.test.tsx"
  - "packages/modules/stories/tests/story-viewer.test.tsx"
  - "packages/modules/stories/ui/StoryViewer.tsx"
  - "scripts/check-static-routes.sh"
covered_digest: "v1:sha256:86db924771bc962c69c8d70b9003aa2a2165559ea67ee695b70da70dc4e60529"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 13/15
  gaps_closed:
    - "No Phase 5 write may persist or reveal another tenant's data (TENANT-05, D-23 existence-oracle rule) — closed by 05-09's resolveCoverAsset inside withTenantTx; verified against the code, not the SUMMARY"
    - "STORY-02 image path: the MediaImage <-> StoryViewer render loop — closed by 05-10 at both ends; the render-ceiling test with its stub-proof srcSet assertion was RUN by this verifier and passes"
    - "STORY-02 CR-03: an empty variant ladder now reports instead of hanging the viewer in `loading`"
    - "STORY-02 CR-04 (structural half): the play badge and the media-error container are OUT of the pointer-owning subtree"
    - "STORY-02 video path mechanism: StoryVideo's MutationObserver attaches to the late-mounting mux-player; StoryViewerHost.test.tsx case 13 was RUN by this verifier and passes"
  gaps_remaining: []
  regressions:
    - "CR-01 — 05-09 made every community whose cover asset was retired permanently un-editable and un-archivable (REPRODUCED RED by this verifier through shipped endpoints only)"
    - "CR-02 — 05-11 activated onPlayRef against a single shared playRef, so the play badge plays an offscreen neighbour's video (REPRODUCED RED by this verifier)"
gaps:
  - truth: "SC-1a — `admin_tenant` can create, EDIT and ARCHIVE a community (name, description, cover image)"
    status: failed
    reason: "REGRESSION introduced by gap-closure plan 05-09. `updateCommunity` re-validates the STORED cover on every PATCH, including a `{status}`-only archive. `DELETE /v1/media/{assetId}` is a shipped, reachable soft delete that `assertMayRetire` explicitly permits the owner (and any `admin_tenant`) to call; nothing nulls `communities.cover_asset_id`; `resolveCoverAsset`'s lookup carries `deleted_at is null`, so it finds nothing and throws a bare 404. Every subsequent write to that community — rename, description edit, archive, reactivate — 404s permanently, and the BFF's `coverAwareRefusal` short-circuits on a null submitted cover, so the admin is told \"Comunidade não encontrada\" about a community that is open on their screen and still in the list. VERIFIER REPRO (red, deterministic, shipped endpoints only): POST /v1/communities {valid cover} -> 201; DELETE /v1/media/{assetId} -> 200; GET /v1/communities/{id} -> 200 (still reads fine); PATCH /v1/communities/{id} {status:'archived'} -> 404 {\"error\":{\"code\":\"NOT_FOUND\",\"message\":\"Não encontrado.\"}}."
    artifacts:
      - path: "packages/modules/communities/server/service.ts"
        issue: "Lines 460-469 — `input.coverAssetId === undefined ? before.cover_asset_id : input.coverAssetId` is then passed to `resolveCoverAsset` unconditionally, so a PATCH that asserts nothing about the cover is refused on the cover"
      - path: "apps/web/app/(app)/comunidades/actions.ts"
        issue: "`coverAwareRefusal` returns early when `submittedCoverAssetId === null`, so archive/reactivate surface the bare 404 as `not_found` -> \"Comunidade não encontrada\""
      - path: "apps/api/tests/integration/communities.test.ts"
        issue: "Case 31 covers only the FOREIGN stale cover (an id the API can no longer produce, written by hand). The same-tenant retired asset — the case an ordinary admin reaches in two clicks — is covered nowhere"
    missing:
      - "Validate only what the request ASSERTS: when `input.coverAssetId` is present, keep case 31's 404; when the field is absent, treat a stored reference that no longer resolves as \"no cover\" and drop it rather than refusing the write"
      - "An integration case: seed a cover/image/ready asset, create a community with it, retire the asset through `DELETE /v1/media/{id}`, assert `PATCH { status: 'archived' }` -> 200 and the stored `cover_asset_id` is null"
      - "A BFF case asserting that an archive on such a community does not report \"Comunidade não encontrada\""
  - truth: "SC-3c / STORY-02 — a full-screen viewer with progress bars, auto-advance, tap-to-navigate and hold-to-pause (the phase goal's \"complete gesture set\")"
    status: partial
    reason: "The IMAGE half is genuinely closed and behaviorally proven (verified by running the tests, not by reading the SUMMARY). The VIDEO half's mechanism is proven at component level but carries a REGRESSION introduced by gap-closure plan 05-11: `StoryViewerHost` holds ONE `playRef` for ALL mounted videos while `StoryViewer` mounts a 3-wide neighbour window, so the play badge's gesture-synchronous `play()` reaches whichever element attached last. The sibling `bindCountBump` in the SAME file is already keyed by story id; the asymmetry is the bug. Before 05-11 the one-shot querySelector almost never found an element, so this was masked; 05-11 made the attach reliable and exposed it. On iOS the correct element then only gets the effect-driven `play()` OUTSIDE the gesture — the call iOS rejects — so the recovery path this feature exists for (UI-D-34) silently fails. VERIFIER REPRO (red, deterministic): two adjacent video stories, both vendor elements mounted, `play` spy per element, zero calls before the tap; after one tap on `story-autoplay-badge` the OFFSCREEN NEIGHBOUR's element received `play()` (1 call) alongside the active one (1 call, from the later effect, not the gesture)."
    artifacts:
      - path: "apps/web/components/stories/StoryViewerHost.tsx"
        issue: "Lines ~130-137 — `const playRef = useRef<(() => void) | null>(null)` and `bindPlay = useCallback((play) => { playRef.current = play })` take no story id, and the same `bindPlay` is passed to every `StoryVideo`; `onRequestPlay: () => playRef.current?.()` therefore calls whichever attached last"
      - path: "apps/web/components/stories/StoryVideo.tsx"
        issue: "`detach()` calls `onPlayRef?.(null)` unconditionally, so a neighbour leaving the 3-wide window clears the registration the ACTIVE story owns"
      - path: "packages/modules/stories/ui/StoryViewer.tsx"
        issue: "Line 503 mounts `Math.abs(k - index) <= 1` — up to three stories, and therefore up to three video bridges, at once"
      - path: "apps/web/components/stories/StoryViewerHost.test.tsx"
        issue: "Case 13 renders ONE video plus one image; no test in the tree renders two adjacent videos, which is why this shipped green"
    missing:
      - "Key the play registration by story id — `bindPlay(storyId, play)` with a `Record<string, () => void>`, and let only the OWNER clear its own slot — the exact shape `bindCountBump` already uses in the same file"
      - "A test: two video stories, arm the autoplay-blocked window on story 0, tap the badge, assert story 0's element received `play()` and story 1's did not; then advance so story 0's neighbour unmounts and assert the badge still works"
      - "WR-09: the two comments at `StoryViewer.tsx:554-557` and `story-viewer.test.tsx:412-418` name `apps/web/e2e/stories.spec.ts` as the gate for the `pointer-events-none` half of the CR-04 fix. That file contains ZERO references to `story-autoplay-badge`, `story-media-error` or the retry control, and `git log ad72a0a..HEAD -- apps/web/e2e/stories.spec.ts` is empty. Either add the three cases or delete the claim"
deferred: []
advisory:
  - finding: "WR-03 — `MediaImage`'s `failedId` latch is only ever set, never cleared, so an asset that arrives with an empty variant ladder and later gains variants stays on the fallback forever"
    category: other
    reason: "Raised by 05-REVIEW. `MediaImage.tsx` WAS modified this round, so under the evidence gate this would block as a regression — but the reachable trigger (a still-transcoding pinned asset whose worker finishes while the viewer is open on it) could not be reproduced without a real transcode, which is the same limitation H-05-02 names. Resolved by clearing the latch at the top of the effect plus a re-render case in `media-image.test.tsx`. Recorded rather than blocked because no reproducible command demonstrates it; it is NOT cleared."
    evidence_status: "attempted, inconclusive — requires a real worker transcode completing mid-view"
  - finding: "WR-05/WR-06 — refs written during render in three components, and `setMediaState` called from inside `setAttempt`'s updater"
    category: architectural
    reason: "Documented React invariant violations under `reactCompiler: true` and React 19.3 concurrent features. No failing test or reproducible command produced; the code survives today because the inner update is idempotent."
    evidence_status: "none provided"
  - finding: "WINDOWS.md entry 41 is marked `fixed` on the premise that 05-11 Task 3 closed the browser-level gesture gate for the CR-04 restructure"
    category: other
    reason: "05-11 Task 3 RAN `stories.spec.ts` as a regression gate over the restructured stage (8 gesture cases green), which is real — but it added no case for the badge, the retry or the error copy. The specific deferred property (a tap on the error COPY falling through `pointer-events-none`) remains covered nowhere, so `fixed` over-states what happened. This is a ledger-accuracy finding, not a code defect."
    evidence_status: "grep -c over stories.spec.ts = 0; git log ad72a0a..HEAD on that file is empty"
behavior_unverified_items: []
human_verification:
  - test: "Archive a community whose cover asset was retired (this is gap 1 — it must be FIXED, not verified by hand). Once fixed, confirm the admin sees no false \"Comunidade não encontrada\""
    expected: "Archive succeeds and the card falls back to the brand gradient"
    why_human: "The pt-BR copy and the admin's read of it are editorial; the mechanism itself is now covered by a reproducible integration case"
  - test: "Publish a VIDEO story as `admin_tenant`, wait for it to become ready, then open it from the `/inicio` strip and watch it end to end"
    expected: "The segment fills from the video's own time and auto-advances (or closes) when the video ends"
    why_human: "H-05-02 / WINDOWS entry 42, still OPEN. The local video provider is `fake` with no HLS stream and the seed fixture is image-only, so no e2e can assert over a player that cannot play. 05-11 proved the component chain and explicitly carried this forward rather than absorbing it"
  - test: "Open the story viewer on a phone (or a mobile emulation profile) on a story whose image is already decoded, and watch CPU and memory for 30 s"
    expected: "The bar fills smoothly and the tab stays idle between frames"
    why_human: "H-05-01's open half. 05-10's render-count ceiling (400, settles at ~8) is an automated BOUND, not a render-RATE profile on a real decoder"
  - test: "In the viewer, tap the story error COPY (not the retry button) on a failed story"
    expected: "The tap falls through the `pointer-events-none` container to the stage and advances the story"
    why_human: "happy-dom does not hit-test, so `pointer-events-none` has no effect on synthetic dispatch. 05-10 deviation 3, coverage D6 `deferred`. The e2e gate the code comments name for this does not exist (see WR-09 in the gaps)"
  - test: "Read the pt-BR refusal sentence \"Não foi possível usar esta imagem de capa. Escolha outra.\" in the CommunityForm alert card on a 320px phone viewport"
    expected: "It reads naturally and fits the alert card as UI-SPEC error/E13 designs it"
    why_human: "05-09 coverage D6, `human_judgment: true` — tone and placement are editorial"
  - test: "Backstop B-05-01 (05-04): a 60-character community name at 24/700 on a 320px viewport"
    expected: "Wraps to at most three lines without clipping the cover above it"
    why_human: "Declared `verification: backstop`, abstain reason `insufficient_spec` — no automated evidence anywhere in the phase, and gap closure touched no layout"
  - test: "Backstop B-05-02 (05-05): a 40-character tenant display name on /inicio above the strip"
    expected: "The strip carries no tenant string; the welcome heading above it absorbs the length as Phase 2 pinned it"
    why_human: "Declared `verification: backstop`, reason `insufficient_spec`; the second half inherits a Phase 2 backstop that is itself unverified"
  - test: "Backstop B-05-03 (05-06): a 25-story sequence at 320px"
    expected: "Every progress segment stays at least 2px wide and the bar row does not wrap"
    why_human: "Declared `verification: backstop`, reason `insufficient_spec`"
  - test: "Backstop B-05-04 (05-08): a 90-character story caption and a 40-character community name in one history row at 320px"
    expected: "Both truncate with a title attribute while the row keeps its minimum height"
    why_human: "Declared `verification: backstop`, reason `insufficient_spec`"
  - test: "Backstop B-05-05 (05-08): twelve communities with 40-character names in the pin sheet"
    expected: "Each truncates while the switch stays fully reachable inside the 80%-height sheet"
    why_human: "Declared `verification: backstop`, reason `insufficient_spec`"
  - test: "Resolve the 22 flagged prohibitions — the 14 carried from 05-01..05-08 (P-05-01..P-05-14) and the 8 that gap closure added (N-05-01..N-05-08). `05-VERIFICATION-DEBT.md` sections 2 and 4 carry the evidence beside each"
    expected: "Each must-NOT is judged still honoured by the shipped code"
    why_human: "All 22 carry `status: unverified` with `verification: flagged`. They fail closed and need explicit human resolution. The dossier reads each one but resolves none, by its own governing rule — and this report does not fold any of them into a pass"
---

# Phase 5: Communities & Stories Verification Report

**Phase Goal:** `admin_tenant` organizes content into communities and broadcasts 24 h stories; members browse communities with their posts and pinned stories, and watch stories in a full-screen viewer with the complete gesture set.
**Verified:** 2026-09-24T13:20:00Z
**Status:** gaps_found
**Re-verification:** Yes — after gap-closure plans 05-09, 05-10, 05-11 and the 05-12 debt dossier

## Mode note

`**Mode:** mvp` was removed from this phase by 05-12 at the developer's explicit decision (commit `6198fd3`), rather than inventing a User Story goal after the fact. Confirmed on disk: the Phase 5 ROADMAP section carries no `Mode:` line, while Phase 6 still does. This report therefore verifies goal-backward against the five Success Criteria with no MVP flow-coverage section and no fallback note. That is the right outcome — the previous report's mode note is discharged.

## Headline

**The score did not move — 13/15, same as the previous pass — but its composition changed completely.** Both original gaps were worked on honestly and two of the three halves genuinely closed. In their place, the gap closure introduced **two new regressions**, one per gap, each on a file this round modified, each with **no test coverage**, and **each reproduced RED by this verifier** through a deterministic command rather than inherited from the reviewer's severity.

That is the finding: this phase has now failed verification twice on the same two requirements (COMM-01 and STORY-02), for different reasons each time.

## Goal Achievement

### Observable Truths

| #   | Truth (roadmap Success Criterion / plan must-have) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | SC-1a — `admin_tenant` creates, EDITS and ARCHIVES a community (name, description, cover image) | ✗ FAILED | **Regression from 05-09.** Was VERIFIED last pass. A retired cover asset now bricks every write to its community. Verifier repro, shipped endpoints only: create 201 → `DELETE /v1/media/{id}` 200 → `GET /v1/communities/{id}` **200** → `PATCH {status:'archived'}` **404 NOT_FOUND "Não encontrado."** |
| 2 | SC-1b — the main feed merges tenant-wide and community posts in one query, one ordering | ✓ VERIFIED | Regression check clean: `feed_posts_tenant_created_all_idx` present in `packages/modules/feed/db/schema.ts`; `supabase/tests/090-feed.sql` pins it by name in an `EXPLAIN` with a `Seq Scan` negative. File untouched by gap closure; pgTAP 285 `Result: PASS` |
| 3 | SC-1c / COMM-02 — every tenant member sees every community; `community_members` exists for V2 | ✓ VERIFIED | Regression check clean: both tables declared with `tenantIsolationPolicy` + `.enableRLS()`; `010-rls-coverage.sql` enumerates both with no exemption. Files untouched |
| 4 | SC-1d / COMM-04 — the admin posts directly into a community from its page | ✓ VERIFIED | Regression check clean; files untouched |
| 5 | SC-2 — member browses the community list and opens a community to its posts and pinned stories | ✓ VERIFIED | Regression check clean; `110-communities-stories.sql` highlights assertions unchanged and green |
| 6 | SC-3a / STORY-01 — the admin publishes an image or short-video story with an optional caption from a phone | ✓ VERIFIED | Regression check clean; `publishStory` still resolves the asset inside the transaction and checks `purpose`/`kind` |
| 7 | SC-3b — members see active stories in a horizontally scrollable strip | ✓ VERIFIED | Regression check clean; `stories: { home: [storiesHome] }` still registered at order 5 |
| 8 | SC-3c / STORY-02 — a full-screen viewer with progress bars, auto-advance, tap-to-navigate and hold-to-pause | ✗ FAILED (partial — image half closed) | **Image half genuinely closed** — `story-viewer-media.test.tsx` RUN by this verifier: 4/4 pass, with a 400-render ceiling that throws before the assertion under the old loop and a stub-proof `srcSet` assertion (`/v1/media/asset-0/w320 320w`) proving the REAL `MediaImage` renders. **Video half carries a new regression from 05-11 (CR-02)**, reproduced RED: one tap on the badge sent `play()` to the OFFSCREEN neighbour's element |
| 9 | SC-4a / STORY-03 — a story leaves the strip 24 h after publishing, record retained, no cron | ✓ VERIFIED | Regression check clean; pgTAP transaction-controlled-clock block unchanged and green |
| 10 | SC-4b / STORY-04 — a pinned story stays visible on its communities after expiry until unpinned | ✓ VERIFIED | Regression check clean; `listCommunityHighlights` still carries no expiry predicate |
| 11 | SC-5a — a member can like a story | ✓ VERIFIED | Regression check clean |
| 12 | SC-5b — a member can comment; likes and replies on story comments are rejected by API AND DB | ✓ VERIFIED | Regression check clean — the phase's strongest work, declarative in the database |
| 13 | Phase-wide — no Phase 5 write may persist or reveal another tenant's data (TENANT-05, D-23, core value) | ✓ VERIFIED — **gap closed** | `resolveCoverAsset` is the FIRST statement of `insertCommunity` and runs before `changedContent` in `updateCommunity`, both inside `withTenantTx`. A miss of any kind throws one bare `ApiError(404,'NOT_FOUND')` with no `details`; `isolation.test.ts` b5 asserts the two refusal bodies as a `JSON.stringify` EQUALITY (minus `requestId`), not two literal checks. Integration 479/479 green. The independent review could not construct a cross-tenant oracle; neither could this verifier |
| 14 | 05-02 — the D-33 / UI-04 design gate is real and enforced before the five prototype-less surfaces are coded | ✓ VERIFIED | Regression check clean; sketch 003 README still `approved: true` |
| 15 | MOD-04 — both new modules toggle in both directions with no migration and no route edit | ✓ VERIFIED | `apps/api/src/modules/registry.ts:27,29` unchanged; `phase5-smoke.spec.ts` intact |

**Score:** 13/15 truths verified (0 present, behavior-unverified)

### Deferred Items

None. Phase 6 (Events), Phase 7 (Notifications & Chat) and Phase 8 (Moderation & Pilot Hardening) were read for coverage of either regression. Phase 8's pilot go-live "isolation" gate is a milestone-wide check, not a commitment to fix a Phase 5 community write path or the story viewer's play badge. Under the conservative matching rule, neither gap is deferred.

### Advisory (New Scope, Unevidenced)

New-scope findings from Step 7 with no deterministic evidence — reported, not blocking, and they do not revert a completed must-have.

| # | Finding | Category | Why Advisory |
| --- | --- | --- | --- |
| 1 | WR-03 — `MediaImage`'s `failedId` latch is never cleared, so a recovered asset stays on the fallback | other | On a modified file, so it would block as a regression — but the trigger (a worker transcode finishing while the viewer is open) could not be reproduced without a real transcode, the same limitation H-05-02 names. Recorded, not cleared |
| 2 | WR-05/WR-06 — refs written during render in three components; `setMediaState` called inside `setAttempt`'s updater | architectural | Documented React invariant violations under `reactCompiler: true`; no failing test or reproducible command produced |
| 3 | WINDOWS.md entry 41 marked `fixed` although the deferred error-copy hit-test property is covered nowhere | other | Ledger-accuracy finding, not a code defect. Evidence is real (`grep -c` = 0, empty `git log`) but it demotes a ledger claim, not a must-have |

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `packages/modules/communities/server/service.ts` | community CRUD inside `withTenantTx` with a validated cover | ⚠️ HOLLOW | The cover is now validated (gap 1 closed) — but `updateCommunity` validates a cover the request never asserted, which breaks edit/archive (new gap) |
| `packages/modules/communities/contracts/index.ts` | the closed `COMMUNITY_ISSUE_SET` including `cover_invalid` | ✓ VERIFIED | `asCommunityIssue` narrows against the exported set, one definition |
| `apps/api/tests/integration/isolation.test.ts` | case b5, the cross-tenant cover gate with its positive control | ✓ VERIFIED | Byte-equality assertion on the two refusal bodies; 479/479 integration green |
| `apps/api/tests/integration/communities.test.ts` | cases 27-32, the same-tenant cover refusal battery | ⚠️ PARTIAL | Six real cases; case 31 covers the FOREIGN stale cover only, not the same-tenant retired asset that CR-01 reaches |
| `apps/web/app/(app)/comunidades/actions.ts` | `coverAwareRefusal`, fact-based attribution of a bare 404 | ⚠️ HOLLOW | Correct for the create/edit path; its `submittedCoverAssetId === null` short-circuit is what turns CR-01 into a false "Comunidade não encontrada" on archive |
| `packages/core/ui/MediaImage.tsx` | private-image renderer with ready/failed reporting, loop-free | ✓ VERIFIED | Effect array is values-only `[assetId, src]`; reports go through refs; the `src === null` branch now reports (CR-03) |
| `packages/core/tests/media-image.test.tsx` | the component-level loop and empty-ladder cases | ✓ VERIFIED | Cases 1-3 present; case 1 is "a caller that rebuilds both reports every render SETTLES" |
| `packages/modules/stories/tests/story-viewer-media.test.tsx` | the REAL MediaImage under the REAL StoryViewer | ✓ VERIFIED | **Run by this verifier: 4/4 pass.** Render ceiling 400 (settles ~8) and a stub-proof `srcSet` assertion |
| `packages/modules/stories/ui/StoryViewer.tsx` | the viewer, with the badge and error container out of the gesture stage | ⚠️ HOLLOW | Structural isolation real (`grep -c stopPropagation` = 0); WR-06's impure updater still there; `onRequestPlay` resolves through the host's single shared ref |
| `apps/web/components/stories/StoryVideo.tsx` | the video bridge attaching to a late-mounting `mux-player` | ⚠️ HOLLOW | The MutationObserver is correct, scoped to `frameRef`, and torn down properly — but `onPlayRef?.(play)` / `onPlayRef?.(null)` carry no story identity, which is CR-02 |
| `apps/web/components/stories/StoryVideo.test.tsx` | the bridge's own contract | ✓ VERIFIED | Six cases including late mount, all four events, and no live listener after unmount |
| `apps/web/components/stories/StoryViewerHost.test.tsx` | a video segment advancing inside the real viewer | ⚠️ PARTIAL | **Case 13 run by this verifier: passes.** But every video case renders ONE video; two adjacent videos — the CR-02 condition — are rendered nowhere |
| `apps/web/components/stories/StoryViewerHost.tsx` | the app-tier composition | ✗ STUB (behaviourally, for multi-video) | One `playRef` for all mounted videos, while `bindCountBump` two lines above is correctly keyed by story id |
| `scripts/check-static-routes.sh` | the three `/stories` routes inside the TENANT-02 gate | ✓ VERIFIED | **Run by this verifier:** `offenders: 0`, `guarded routes checked: 39`, exit 0 |
| `apps/web/messages/pt-BR/communities.json` | the `cover_invalid` sentence | ✓ VERIFIED | Valid JSON, one added key, consumed by `CommunityForm.messageFor` |
| `.planning/phases/05-communities-stories/05-VERIFICATION-DEBT.md` | the 23-item dossier | ✓ VERIFIED | Assembles all 23 with per-item evidence, marks 3 converted / 1 partial / 1 open / 18 carried, and resolves none — which is the correct behaviour |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `createCommunity` / `updateCommunity` | `media_assets` | `resolveCoverAsset` inside `withTenantTx` | ✓ WIRED | Service lines 382 and 469 |
| `resolveCoverAsset` | the caller's refusal | one bare 404 / `400 cover_invalid` | ✓ WIRED | No log line, event or message on the refusal path names the asset, the tenant or the slug |
| `updateCommunity` | a `{status}`-only PATCH | the resolved-cover branch | ✗ NOT_WIRED (wrong semantics) | It validates a cover the request never asserted — CR-01 |
| `StoryViewer` media slot | `MediaImage` | `item.media(controls)` with memoised control identity | ✓ WIRED | Proven by the render-ceiling test with a stub-proof `srcSet` assertion |
| `StoryVideo` | the late `mux-player` | `MutationObserver` on `frameRef` | ✓ WIRED | Four listeners attached, `found === playerRef.current` double-attach guard, `observer.disconnect()` + `detach()` on cleanup |
| `StoryVideo` | `StoryViewer`'s clock | `controls.onTimeUpdate(currentTime, duration)` | ✓ WIRED | Case 13: 2.5/5 → 50%, guard holds on 0 and Infinity, 5/5 → index 1 |
| `StoryViewerHost` play badge | the ACTIVE story's video element | `playRef.current?.()` | ✗ NOT_WIRED | One shared ref across a 3-wide neighbour window — CR-02, reproduced |
| `apps/api/src/modules/registry.ts` | both module manifests | MODULE_REGISTRY keys | ✓ WIRED | Lines 27, 29 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| `CommunitiesList.tsx` | community page | `getCommunities` → keyset SQL | Yes | ✓ FLOWING |
| `comunidades/[communityId]/page.tsx` | Destaques | `listCommunityHighlights` (pins join) | Yes | ✓ FLOWING |
| `/inicio` strip | stories | `listActiveStories` (`expires_at > now()`, `status='ready'`) | Yes | ✓ FLOWING |
| `StoryViewer` | `mediaState[currentId]` (image) | `MediaImage.onReady` / `onFailed`, including the empty-ladder branch | Yes | ✓ FLOWING (was DISCONNECTED) |
| `StoryViewer` | `videoProgress[currentId]` | `controls.onTimeUpdate` ← `StoryVideo`'s observer-attached listener | Yes | ✓ FLOWING (was DISCONNECTED) |
| `StoryViewerHost` | `playRef.current` | whichever `StoryVideo` attached last, regardless of which story it belongs to | **No — wrong element** | ✗ DISCONNECTED |
| `updateCommunity` | `coverAssetId` on a `{status}`-only PATCH | `before.cover_asset_id`, which may name a soft-deleted asset | **No — refuses the write** | ✗ DISCONNECTED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| The image half of the viewer settles under the real `MediaImage` | `npx vitest run tests/story-viewer-media.test.tsx` (packages/modules/stories) | 4 passed / 4, 792 ms | ✓ PASS |
| A video segment advances from the element's own time and hands over | `npx vitest run -t "13. a VIDEO story"` (apps/web) | 1 passed, 125 skipped | ✓ PASS |
| Archive a community whose cover asset was retired | throwaway integration probe, shipped endpoints only, then removed | `PATCH … {status:'archived'}` → **404** `{"error":{"code":"NOT_FOUND","message":"Não encontrado."}}` (create 201, delete 200, read 200) | ✗ FAIL — CR-01 |
| The play badge plays the ACTIVE story's element, not a neighbour's | throwaway probe rendering two adjacent video stories, then removed | before the tap: story0 0 calls, story1 0 calls; after one tap: story0 **1**, **neighbour story1 1** | ✗ FAIL — CR-02 |
| The three `/stories` routes are inside the TENANT-02 static-route gate | `bash scripts/check-static-routes.sh` | `offenders: 0`, 39 guarded routes, exit 0 | ✓ PASS |
| Phase-5 changed files carry no `TBD`/`FIXME`/`XXX` | grep over the 17 files changed since `ad72a0a` | no matches | ✓ PASS |
| Phase-5 changed files carry no `TODO`/`HACK`/`PLACEHOLDER` | same | no matches | ✓ PASS |
| Full workspace suite | not re-run | orchestrator reports build 2/2, unit 698, pgTAP 285 `Result: PASS`, integration 479, all exit 0 | ? SKIP (single-run budget; recorded, and explicitly NOT relied on — see below) |

**Why the green suite is again not sufficient.** Both new defects live in code the suite structurally cannot reach. No test in the tree renders two adjacent video stories, so CR-02's shared-ref collision is invisible; `StoryViewerHost.test.tsx` case 13 renders one video plus one image. And `communities.test.ts` case 31 covers only the *foreign* stale cover — an id the API can no longer produce, written into the row by hand — while the same-tenant retired asset that an admin reaches in two clicks through `DELETE /v1/media/{id}` is covered nowhere. `actions.test.ts` goes further and asserts the `not_found` answer for archive *as if it were the intended one*. A green run and both of these defects are compatible states, exactly as they were last pass.

### Probe Execution

No `scripts/*/tests/probe-*.sh` exist in this repository and no PLAN or SUMMARY declares a probe path. **Step 7c: SKIPPED (no probes declared or discoverable).** The two throwaway probes recorded under Behavioral Spot-Checks were written by this verifier, run, and removed; the working tree is unchanged.

### Decision Coverage

`gsd_run query check.decision-coverage-verify` over `05-CONTEXT.md`: **19/19 trackable decisions honored**, `not_honored: []`. Non-blocking gate, recorded as required. No decision was abandoned during execution or gap closure.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| COMM-01 | 05-02, 05-04, **05-09** | create, edit and archive communities (name, description, cover image) | ✗ BLOCKED | The *cover-security* half is genuinely fixed (truth 13). The *edit and archive* half is now broken by the fix itself — reproduced 404 on `{status:'archived'}` |
| COMM-02 | 05-01, 05-03 | every member sees every community; membership table exists for V2 | ✓ SATISFIED | Truth 3 |
| COMM-03 | 05-01, 05-04, 05-08 | browse the list; open a community to its posts and pinned stories | ✓ SATISFIED | Truths 5, 10 |
| COMM-04 | 05-03 | post directly into a community from its page | ✓ SATISFIED | Truth 4 |
| STORY-01 | 05-02, 05-05 | publish a story with an image or short video and optional caption | ✓ SATISFIED | Truth 6 |
| STORY-02 | 05-02, 05-06, **05-10**, **05-11** | strip + full-screen viewer with bars, auto-advance, tap-to-navigate, hold-to-pause | ✗ BLOCKED | Strip satisfied (truth 7); image path of the viewer now satisfied and proven; video path carries CR-02 and has no end-to-end evidence (H-05-02 open) |
| STORY-03 | 05-05 | 24 h visibility, then hidden by `expires_at`, record retained | ✓ SATISFIED | Truth 9 |
| STORY-04 | 05-02, 05-08 | pin to one or more communities; pinned survives expiry until unpinned | ✓ SATISFIED | Truth 10 |
| STORY-05 | 05-06, 05-07 | like and comment on a story; story comments cannot be liked or replied to | ✓ SATISFIED | Truths 11, 12 |
| TENANT-02 | 05-11 | (claimed by 05-11 coverage D6) the three `/stories` routes inside the static-route gate | ✓ SATISFIED | Gate run by this verifier: 39 routes, 0 offenders |

**Orphaned requirements:** none. All nine IDs REQUIREMENTS.md maps to Phase 5 are claimed by at least one plan's `requirements` frontmatter.

#### The two re-marked requirements — are the marks earned?

**COMM-01 (`- [x]` line 65, `Complete` line 245, re-marked by `5e0334f`): NOT EARNED.** 05-09 genuinely closed what it set out to close — the existence oracle is gone and I could not rebuild it. But COMM-01's own text is "create, **edit and archive** communities (name, description, cover image)", and the fix broke edit and archive for every community whose cover asset is later retired. The mark was made against a re-read of reality at the time, which is the right *method*; it is simply that the requirement's other half regressed in the same commit and nothing looked. It should revert to `- [ ]` / `Gaps Found`.

**STORY-02 (`- [x]` line 73, `Complete` line 251, re-marked by `350f88f`): NOT EARNED.** 05-11 closed the video *mechanism* and ran the e2e spec green — both real. But the mark rests on an e2e run that, by 05-11's own coverage entry D8, could not assert a real video playing (`human_judgment: true`, "NAMED LIMITATION, carried forward rather than absorbed"), and the same commit activated `onPlayRef` into a shared ref, which is CR-02. A requirement whose own SUMMARY carries an open, not-closable human item should not read `Complete`. It should revert to `- [ ]` / `Gaps Found`.

**A separate traceability inaccuracy, in the other direction.** Seven Phase 5 requirements — COMM-02, COMM-03, COMM-04, STORY-01, STORY-03, STORY-04, STORY-05 — currently read `- [ ]` / `Gaps Found`, yet both this pass and the previous one found all seven SATISFIED with codebase evidence. They were reverted wholesale by `99782b6` and never re-marked, because only the two plans that closed a gap edited the file. The ledger therefore under-states seven requirements and over-states two. 05-12's decision to make no edit was correct on its own terms (it must not edit the record to match a memory) but it leaves nine rows that all disagree with reality. Worth one deliberate pass after the gaps close.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| `packages/modules/communities/server/service.ts` | 460-469 | A write path validates a precondition the request never asserted, against a reference that can go stale under a shipped endpoint | 🛑 Blocker | Rename, edit, archive and reactivate all 404 permanently; the admin is told the community does not exist |
| `apps/web/components/stories/StoryViewerHost.tsx` | ~130-137 | One shared mutable registration for N simultaneously-mounted children, beside a correctly-keyed sibling registration in the same file | 🛑 Blocker | The play badge plays an offscreen video; a neighbour unmount nulls a live registration |
| `apps/web/components/stories/StoryVideo.tsx` | 174 | `onPlayRef` is an effect dependency while every other volatile input is read through a ref | ⚠️ Warning | WR-01 — an inline callback from any future consumer reopens GAP 2's loop class, one prop over |
| `apps/web/components/stories/StoryVideo.tsx` | 143, 190 | `void element.play?.()` — `play()` rejections are unhandled promise rejections | ⚠️ Warning | WR-02 — `NotAllowedError` is the *expected* path this component models; Sentry records it as an error |
| `packages/core/ui/MediaImage.tsx` | 75-76, 110-133 | A failure latch that is only ever set | ⚠️ Warning | WR-03 — see Advisory 1 |
| `packages/modules/communities/server/service.ts` | 20-30, 260-262 | A docblock that asserts the opposite of the statement three lines below ("there is nothing here that compares tenant ids" over a `tenant_id = ${ctx.tenantId}` predicate) | ⚠️ Warning | WR-04 — in the one file whose correctness argument rests on being read literally; CLAUDE.md names hand-compared tenant ids as an anti-pattern |
| `packages/modules/stories/ui/StoryViewer.tsx` | 591-596 | `setMediaState` called from inside `setAttempt`'s updater | ⚠️ Warning | WR-06 — a documented invariant violation under `reactCompiler: true` |
| `packages/modules/stories/ui/StoryViewer.tsx` | 184-189, 591-596 | Retry re-mounts the media but leaves `videoProgress`, `canPlay`, `playing` and `blocked` stale for that story | ⚠️ Warning | WR-07 — a retried video shows the previous attempt's fill and can sit with the badge up |
| `packages/modules/communities/server/service.ts` | 471-481 | `changedContent` compares uuids as JavaScript strings | ⚠️ Warning | WR-08 — an upper-case re-send of the stored cover is no longer inert; `updated_at` moves and an event fires for a no-op |
| `packages/modules/stories/ui/StoryViewer.tsx`, `packages/modules/stories/tests/story-viewer.test.tsx` | 554-557, 412-418 | Two comments cite an e2e regression gate that does not exist | ⚠️ Warning | WR-09 — **independently confirmed here**: `grep -c` for `story-autoplay-badge`/`story-media-error`/`retry` in `stories.spec.ts` returns **0**, and `git log ad72a0a..HEAD -- apps/web/e2e/stories.spec.ts` is **empty**. The `pointer-events-none` half of CR-04 is covered nowhere |

**Debt-marker gate: PASSES.** No `TBD`, `FIXME`, `XXX`, `TODO`, `HACK` or `PLACEHOLDER` marker exists in any of the 17 files this gap-closure round changed.

**Evidence gate (#3304) applied.** Both 🛑 Blockers above are on files git-modified since the previous `verified:` timestamp (`2026-09-24T02:05:00Z`) by this gap-closure round, so both are regressions and block unconditionally. Independently, both were given deterministic evidence anyway — a red, reproducible command each — so neither rests on judgment. The three unevidenced or unreproducible findings were routed to `advisory:` rather than being promoted to blockers.

### Prohibitions (flagged, unverified) — 22, none resolved here

The 14 carried from 05-01..05-08 (P-05-01..P-05-14) and the 8 that gap closure added (N-05-01..N-05-08) all still carry `status: unverified` / `verification: flagged`. Under the fail-closed rule none can be absorbed into a passing verdict, and **this report does not fold any of them into a pass because the dossier discusses them.** `05-VERIFICATION-DEBT.md` sections 2 and 4 are the right place to resolve them: each row carries a reading of the shipped code by file and line, and each is explicitly marked a *proposal*, not a resolution.

One correction to the dossier's own reading, from this pass: **P-05-10** ("the viewer must not mount two different meanings on the same tap") is marked `converted (partial)` on the strength of cases 12a/12b/12c. Those three are real and they do prove the structural isolation. But CR-02 means a tap on the badge now carries a *different* second meaning than the one 12a tested for — it plays the wrong video — so the prohibition's spirit is still at risk on the video path, by a mechanism 12a cannot see (it uses a stub `onRequestPlay` and never goes through `StoryVideo`). The `converted` marking is accurate about what the tests assert and should not be widened.

N-05-01..N-05-03 (05-09's anti-leak trio) have `isolation.test.ts` b5 genuinely behind them, and this verifier independently failed to build an oracle — but they remain `flagged` until a human says so.

### Human Verification Required

Eleven items. Four are inherited and still open, five are the declared `backstop` visual claims, one is the pt-BR copy judgment from 05-09, and one is the 22-prohibition resolution.

#### 1. A VIDEO story watched end to end on a device (H-05-02 — OPEN, not discharged)

**Test:** Publish a video story as `admin_tenant`, wait for it to become ready, open it from the `/inicio` strip and watch it through.
**Expected:** The segment fills from the video's own time and auto-advances (or closes) when the video ends.
**Why human:** The local video provider is `fake` with no HLS stream and the seed fixture is image-only, so no e2e can assert over a player that cannot play. `WINDOWS.md` entry 42, `open`. 05-11 proved the component chain (`StoryVideo.test.tsx` ×6, `StoryViewerHost.test.tsx` case 13, both re-run green here) and explicitly carried this forward rather than absorbing it. That honesty is preserved: nothing in this report closes it.

#### 2. The 30 s device render-rate profile for the image path (H-05-01, open half)

**Test:** Open the viewer on a phone (or a mobile emulation profile) on an already-decoded story image; watch CPU and memory for 30 s.
**Expected:** The bar fills smoothly and the tab stays idle between frames.
**Why human:** 05-10's render-count ceiling (400, settles at ~8) is an automated **bound**, not a **profile**. The bound is real and I ran it; it does not answer the question this item asks.

#### 3. A tap on the story error COPY

**Test:** With a failed story on screen, tap the error copy itself — not the retry button.
**Expected:** The tap falls through the `pointer-events-none` container to the stage and advances the story.
**Why human:** happy-dom does not hit-test, so `pointer-events-none` has no effect on synthetic dispatch. 05-10 deviation 3, coverage D6 `deferred`. The e2e gate the code comments name for this **does not exist** (WR-09, confirmed here), so this property is asserted nowhere in the repo.

#### 4. The pt-BR cover-refusal sentence in the alert card

**Test:** Read "Não foi possível usar esta imagem de capa. Escolha outra." in the `CommunityForm` alert card on a 320px phone viewport.
**Expected:** It reads naturally and fits the card as UI-SPEC error/E13 designs it.
**Why human:** 05-09 coverage D6, `human_judgment: true` — tone and placement are editorial.

#### 5-9. The five declared `verification: backstop` visual claims

B-05-01 (60-character community name at 24/700, 320px, ≤3 lines, cover not clipped); B-05-02 (40-character tenant display name — the strip carries no tenant string, the welcome heading absorbs it); B-05-03 (25-story sequence at 320px, every segment ≥2px, no wrap); B-05-04 (90-character caption + 40-character community name in one history row at 320px, both truncate with a title attribute, row keeps its minimum height); B-05-05 (twelve 40-character community names in the pin sheet, each truncating with the switch reachable inside the 80%-height sheet).

**Why human:** All five are declared `verification: backstop` in their source plans with no automated evidence anywhere in the phase; they abstain with reason `insufficient_spec`. **Gap closure converted none of them** — 05-09, 05-10 and 05-11 touched no layout, no type scale and no truncation rule.

#### 10. The 22 flagged prohibitions

See the Prohibitions section and `05-VERIFICATION-DEBT.md` sections 2 and 4.
**Why human:** All 22 carry `status: unverified` / `verification: flagged` and fail closed.

#### 11. Confirm the archive copy once CR-01 is fixed

**Test:** After the gap closes, archive a community whose cover asset was retired.
**Expected:** Archive succeeds and the card falls back to the brand gradient, with no "Comunidade não encontrada".
**Why human:** The mechanism will be covered by the integration case the gap asks for; the admin's read of the resulting copy is editorial.

### Gaps Summary

Phase 5's gap closure did real work, and three of its four claims hold under independent trace.

**GAP 1 is genuinely closed.** `resolveCoverAsset` runs inside the writing transaction, `media_assets_tenant_select` makes a foreign row invisible rather than denied, both refusal paths throw the identical bare `404 NOT_FOUND` with no `details`, and `isolation.test.ts` b5 asserts that as a byte equality rather than two literal checks — so a future extra key, a different message or even a different key order fails there. No log line, event or error message on the refusal path names the asset, the tenant or the slug. I tried to rebuild the cross-tenant existence oracle and could not. Truth 13 flips from FAILED to VERIFIED on the code, not on the SUMMARY.

**GAP 2's image half is genuinely closed, and provably so.** `MediaImage`'s effect array is values-only, both reports go through refs, `StoryViewer`'s control objects survive an unrelated re-render, and the `src === null` branch now reports instead of swallowing (CR-03). The test that proves it is a good test: it renders the **real** `MediaImage` under the **real** `StoryViewer` and pins that with a stub-proof `srcSet` assertion, and its 400-render ceiling throws before the assertion is ever reached under the old loop. I ran it. It passes in 792 ms, settling at about eight renders where the previous verifier's probe reached an out-of-memory abort.

**GAP 2's video half closed its mechanism and opened a new hole in the same stroke.** The `MutationObserver` is right — correctly scoped to the bridge's own frame, guarded against double-attach, fully torn down — and a video segment now genuinely advances from the element's own `timeupdate` and hands over at the end. But making the attach reliable activated `onPlayRef`, and the host holds **one** `playRef` for **all** mounted videos while the viewer mounts a three-wide neighbour window. With two adjacent video stories, one tap on the play badge sends `play()` to the offscreen neighbour. I reproduced it: zero calls on both elements before the tap, one call on the neighbour after it. The correct element then only receives the effect-driven `play()` outside the gesture — which is exactly the call iOS refuses, on the platform this whole affordance exists for. The shape of the fix is already in the same file: `bindCountBump`, eight lines above, is correctly keyed by story id.

**And the COMM-01 fix broke COMM-01's other half.** `updateCommunity` now re-validates the cover the row already stores, on every PATCH, including one that only writes `{status}`. `DELETE /v1/media/{assetId}` is a shipped endpoint that `assertMayRetire` lets the uploading admin call; nothing nulls the community's reference; the lookup filters `deleted_at is null`. So an admin who tidies up an old image silently converts one of their communities into a row they can never rename, edit, archive or reactivate again — and the product answers "Comunidade não encontrada" about a community that is visibly on their screen and still in the list. I reproduced the whole chain through shipped endpoints only: create 201, delete 200, read **200**, archive **404**. The existing case 31 misses it because it tests the *foreign* stale cover, an id the API can no longer produce; `actions.test.ts` goes further and pins the `not_found` answer for archive as though it were intended.

Both regressions are narrow and local, both have a known-good shape already present in the same file or the same phase, and both need the same thing the first two gaps needed: a fix, a test that would have caught it, and another re-verification. Neither requires re-planning the phase.

Two things worth saying plainly beyond the gaps. First, `REQUIREMENTS.md` now disagrees with reality on all nine Phase 5 rows — two read `Complete` that are not, and seven read `Gaps Found` that have been satisfied since the first pass. Second, twenty-two prohibitions, five backstop claims and four device checks remain fail-closed, and the 05-12 dossier is exactly the right artifact for them precisely because it resolves none of them. This report holds to the same rule: nothing here became true by being written down more confidently.

---

_Verified: 2026-09-24T13:20:00Z_
_Verifier: Claude (gsd-verifier)_
