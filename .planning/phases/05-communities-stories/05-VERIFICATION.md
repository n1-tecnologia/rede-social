---
phase: 05-communities-stories
verified: 2026-09-24T16:05:00Z
status: human_needed
score: 15/15 must-haves verified
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
  - ".planning/quick/260924-fwv-corrigir-os-dois-defeitos-introduzidos-p/260924-fwv-PLAN.md"
  - ".planning/quick/260924-fwv-corrigir-os-dois-defeitos-introduzidos-p/260924-fwv-SUMMARY.md"
  - ".planning/quick/260924-fwv-corrigir-os-dois-defeitos-introduzidos-p/260924-fwv-VERIFICATION.md"
  - "apps/api/tests/integration/communities.test.ts"
  - "apps/api/tests/integration/isolation.test.ts"
  - "apps/web/app/(app)/comunidades/CommunityForm.tsx"
  - "apps/web/app/(app)/comunidades/actions.test.ts"
  - "apps/web/app/(app)/comunidades/actions.ts"
  - "apps/web/components/stories/StoryVideo.test.tsx"
  - "apps/web/components/stories/StoryVideo.tsx"
  - "apps/web/components/stories/StoryViewerHost.test.tsx"
  - "apps/web/components/stories/StoryViewerHost.tsx"
  - "apps/web/e2e/stories.spec.ts"
  - "apps/web/messages/pt-BR/communities.json"
  - "packages/core/tests/media-image.test.tsx"
  - "packages/core/ui/MediaImage.tsx"
  - "packages/modules/communities/contracts/index.ts"
  - "packages/modules/communities/server/service.ts"
  - "packages/modules/stories/tests/story-viewer-media.test.tsx"
  - "packages/modules/stories/tests/story-viewer.test.tsx"
  - "packages/modules/stories/ui/StoryViewer.tsx"
  - "scripts/check-static-routes.sh"
covered_digest: "v1:sha256:61adb732c7de9146e5743061ebf73f794d4adee6ee0dc8dcdaaf252eca258275"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 13/15
  gaps_closed:
    - "SC-1a / COMM-01 — the CR-01 regression is closed. `updateCommunity` now validates only the cover the REQUEST asserts; a community whose own cover was retired through the shipped `DELETE /v1/media/{id}` accepts archive, reactivate, rename and description edits again, and the dangling reference self-heals to null once. VERIFIED BY RUNNING integration case 33 (480/480 green in this verifier's own `pnpm test:integration` run against a freshly reset+seeded database), not by reading the SUMMARY"
    - "SC-3c / STORY-02 — the CR-02 regression is closed. The play registration is keyed by story id (`playRefs.current[item.id]`), `StoryVideo` takes a required `storyId` and only the OWNER clears its own slot. VERIFIED BY RUNNING `StoryViewerHost.test.tsx` case 14 (20/20 green in this verifier's own run), whose forced attach order makes the NEXT neighbour the last writer of the pre-fix single slot"
    - "WR-09 — the two comments that named `apps/web/e2e/stories.spec.ts` as the gate for the `pointer-events-none` half of CR-04 no longer exist. `grep -n 'e2e/stories.spec.ts'` over `StoryViewer.tsx` and `story-viewer.test.tsx` exits 1. The corrected text states the hit-testing half is asserted by NO automated test — an honest description of an uncovered property, NOT new coverage"
  gaps_remaining: []
  regressions: []
gaps: []
deferred: []
advisory:
  - finding: "WR-03 — `MediaImage`'s `failedId` latch is only ever set, never cleared, so an asset that arrives with an empty variant ladder and later gains variants stays on the fallback forever"
    category: other
    reason: "Carried unchanged from the previous report. `MediaImage.tsx` was NOT modified by the quick task (`git diff 6e42242..HEAD` does not list it), so under the evidence gate this is now new-scope for this round; the reachable trigger (a still-transcoding pinned asset whose worker finishes while the viewer is open on it) still could not be reproduced without a real transcode. Recorded, NOT cleared."
    evidence_status: "attempted, inconclusive — requires a real worker transcode completing mid-view"
  - finding: "WR-05/WR-06 — refs written during render in three components, and `setMediaState` called from inside `setAttempt`'s updater"
    category: architectural
    reason: "Carried unchanged. Documented React invariant violations under `reactCompiler: true` and React 19.3 concurrent features. No failing test or reproducible command produced; the code survives today because the inner update is idempotent."
    evidence_status: "none provided"
  - finding: "WINDOWS.md entry 41 still reads `fixed` although the deferred error-copy hit-test property is covered nowhere"
    category: other
    reason: "Carried, and now sharper: the quick task corrected the SOURCE comments that made the same over-statement, but entry 41 in the ledger was not touched. `grep -c 'story-autoplay-badge|story-media-error|story-media-retry' apps/web/e2e/stories.spec.ts` = 0 and `git log ad72a0a..HEAD -- apps/web/e2e/stories.spec.ts` is empty, both re-run here. Ledger-accuracy finding, not a code defect — the honest ledger status is `open`, matching entry 43."
    evidence_status: "grep -c over stories.spec.ts = 0; git log on that file is empty (both re-run in this verification)"
  - finding: "The Playwright story suite is fixture-destructive downstream of the API integration suite: running `pnpm test:integration` drains the `media` Storage bucket (56 objects after seed -> 7 observed here), after which every image-backed viewer case fails at `openViewer` because the progress clock never starts"
    category: other
    reason: "Discovered and root-caused during this verification after an initial e2e run went 7-red. It is NOT a product defect and NOT a regression: `pnpm verify` already re-runs `pnpm db:reset && pnpm db:seed` immediately before `pnpm e2e` for exactly this reason. Recorded so that a future reader who runs `stories.spec.ts` out of that order does not mistake the resulting red for a viewer regression. After re-seeding, the same suite ran 20 passed / 1 skipped."
    evidence_status: "reproduced and resolved in this run — storage.objects(media) 56 -> 7 after the integration suite; 56 again after db:reset+db:seed; e2e 7 failed -> 0 failed with no code change"
behavior_unverified_items: []
coincidental_reliance_items: []
human_verification:
  - test: "Publish a VIDEO story as `admin_tenant`, wait for it to become ready, then open it from the `/inicio` strip and watch it end to end"
    expected: "The segment fills from the video's own time and auto-advances (or closes) when the video ends"
    why_human: "H-05-02 / WINDOWS entry 42, still OPEN and NOT discharged by this re-verification. The local video provider is `fake` with no HLS stream (the browser console shows `[mux-player] The playback-token provided is invalid or malformed` for every seeded video) and the seed fixture is image-only, so no e2e can assert over a player that cannot play. 05-11 proved the component chain and carried this forward rather than absorbing it; the quick task changed nothing about it"
  - test: "Open the story viewer on a phone (or a mobile emulation profile) on a story whose image is already decoded, and watch CPU and memory for 30 s"
    expected: "The bar fills smoothly and the tab stays idle between frames"
    why_human: "H-05-01's open half. 05-10's render-count ceiling (throws at 400, settles at ~8) is an automated BOUND, not a render-RATE profile on a real decoder. Still open"
  - test: "In the viewer, tap the story error COPY (not the retry button) on a failed story"
    expected: "The tap falls through the `pointer-events-none` container to the stage and advances the story"
    why_human: "happy-dom does not hit-test, so `pointer-events-none` has no effect on synthetic dispatch (05-10 deviation 3, coverage D6 `deferred`). Re-confirmed here: `apps/web/e2e/stories.spec.ts` contains ZERO references to the badge, the media-error container or the retry control. The quick task DELETED the comments that falsely claimed that spec covered it — deleting a false claim is not adding coverage, and this property is still asserted nowhere"
  - test: "As `admin_tenant`, open a community whose cover asset was retired, rename it, and read the pt-BR refusal sentence \"Não foi possível usar esta imagem de capa. Escolha outra.\" in the CommunityForm alert card on a 320px phone viewport. Then pick another cover (or clear it) and save again"
    expected: "The sentence reads naturally, fits the alert card as UI-SPEC error/E13 designs it, and the recourse (choose another cover, or clear it) is obvious and works"
    why_human: "05-09 coverage D6, `human_judgment: true` — tone and placement are editorial. This is also the surface of the DEVELOPER-ACCEPTED residual behaviour recorded in this report's Decisions section: the shipped form always submits `coverAssetId`, so a rename that re-asserts a retired id still gets `cover_invalid`. The mechanism is accepted; what a human should judge is whether the copy makes the recourse clear"
  - test: "As `admin_tenant`, archive (and then reactivate) a community whose cover asset was retired through the media library, on the real admin screen"
    expected: "Both writes succeed, no \"Comunidade não encontrada\" appears, and the card falls back to the brand gradient"
    why_human: "The mechanism is now covered by integration case 33, which this verifier RAN green — this item is the product-surface confirmation of the previously failed gap, cheap to do while the admin screen is open. It is a confirmation, not an open defect"
  - test: "Backstop B-05-01 (05-04): a 60-character community name at 24/700 on a 320px viewport"
    expected: "Wraps to at most three lines without clipping the cover above it"
    why_human: "Declared `verification: backstop`, abstain reason `insufficient_spec` — no automated evidence anywhere in the phase, and neither gap closure nor the quick task touched layout"
  - test: "Backstop B-05-02 (05-05): a 40-character tenant display name on /inicio above the strip"
    expected: "The strip carries no tenant string; the welcome heading above it absorbs the length as Phase 2 pinned it"
    why_human: "Declared `verification: backstop`, reason `insufficient_spec`; the second half inherits a Phase 2 backstop that is itself unverified"
  - test: "Backstop B-05-03 (05-06): a 25-story sequence at 320px"
    expected: "Every progress segment stays at least 2px wide and the bar row does not wrap"
    why_human: "Declared `verification: backstop`, reason `insufficient_spec`, and it stays abstained. NOTE for whoever closes it: `stories.spec.ts` line 552 asserts exactly this property at 320px for `STORY_PAGE_SIZE` stories, and this verifier RAN it green — but `STORY_PAGE_SIZE` is 10, not 25, and the strip shows one page, so 25 is not a state the product can reach. A human may judge the claim discharged at the reachable maximum"
  - test: "Backstop B-05-04 (05-08): a 90-character story caption and a 40-character community name in one history row at 320px"
    expected: "Both truncate with a title attribute while the row keeps its minimum height"
    why_human: "Declared `verification: backstop`, reason `insufficient_spec`"
  - test: "Backstop B-05-05 (05-08): twelve communities with 40-character names in the pin sheet"
    expected: "Each truncates while the switch stays fully reachable inside the 80%-height sheet"
    why_human: "Declared `verification: backstop`, reason `insufficient_spec`"
  - test: "Resolve the 22 flagged prohibitions — the 14 carried from 05-01..05-08 (P-05-01..P-05-14) and the 8 that gap closure added (N-05-01..N-05-08). `05-VERIFICATION-DEBT.md` sections 2 and 4 carry the evidence beside each"
    expected: "Each must-NOT is judged still honoured by the shipped code"
    why_human: "All 22 carry `status: unverified` with `verification: flagged`. They fail closed and need explicit human resolution. The dossier reads each one but resolves none, by its own governing rule — and this report folds none of them into its pass"
  - test: "Judge prohibition N-05-02 (\"A refused cover must never be silently dropped, nulled or substituted so the write can proceed\") against the CR-01 self-heal specifically"
    expected: "A human decides whether nulling a DANGLING STORED cover on a request that asserted nothing about a cover is inside or outside that must-NOT"
    why_human: "NEW this round, and the only prohibition whose subject matter the fix actually moved. The fix keeps the prohibition's literal case intact — a request that SENDS an unusable id is still refused with the bare 404 (`service.ts:522`) — and only drops a reference the community's own admin already retired. But the admin is not told the reference was dropped, and N-05-02's sentence is about silence. It is a judgment call, it belongs to the same human resolving the other 22, and it must not be settled by this report"
---

# Phase 5: Communities & Stories Verification Report

**Phase Goal:** `admin_tenant` organizes content into communities and broadcasts 24 h stories; members browse communities with their posts and pinned stories, and watch stories in a full-screen viewer with the complete gesture set.
**Verified:** 2026-09-24T16:05:00Z
**Status:** human_needed
**Re-verification:** Yes — third pass. After gap-closure plans 05-09..05-12 AND quick task 260924-fwv, which fixed the two regressions the second pass found.

## Mode note

`**Mode:** mvp` was removed from this phase by 05-12 at the developer's explicit decision (commit
`6198fd3`). Re-confirmed on disk in this pass: the Phase 5 ROADMAP section carries no `Mode:` line
while Phase 6 still does. This report therefore verifies goal-backward against the five Success
Criteria, with no MVP User-Flow-Coverage section and no fallback note.

## Headline

**Both blocking gaps are closed, and both closures were re-established here rather than inherited.**
The previous report's two reproductions were replayed against the shipped code by running the named
tests that own them, and the browser-level gesture suite was run end to end.

- **GAP A (SC-1a / COMM-01)** — `pnpm test:integration` against a freshly `db:reset`+`db:seed`
  database: **480/480 green**, including new case 33, which drives the exact repro through shipped
  endpoints (create `201` -> `DELETE /v1/media/{id}` `200` -> `GET /v1/communities/{id}` `200` ->
  `PATCH {status:'archived'}` **200**, stored `cover_asset_id` reads back **null**, repeat PATCH
  observably inert, then reactivate `200` and rename `200`).
- **GAP B (SC-3c / STORY-02)** — `StoryViewerHost.test.tsx` + `StoryVideo.test.tsx`: **20/20 green**,
  including new case 14, which forces the NEXT neighbour to attach last and asserts it receives zero
  `play()` calls.
- **The browser gate** — `apps/web/e2e/stories.spec.ts --project=mobile-chromium`: **20 passed,
  1 skipped**, run by this verifier against the post-fix code. Tap-to-navigate, hold-to-pause,
  the filling bar, swipe-dismiss, back-dismiss, deep link and the 320px progress-bar geometry all
  pass in a real browser.

**Score moves 13/15 -> 15/15. No new regression was found.** The status is `human_needed`, not
`passed`, because twelve verification items still require a human — eleven carried forward unchanged
from the previous report plus one new prohibition judgment the CR-01 fix creates. None of them was
folded into the pass.

## RED-ness of the two fixes, re-established rather than inherited

`260924-fwv-SUMMARY.md`'s and `260924-fwv-VERIFICATION.md`'s RED claims were read and then set aside.
Both were re-derived here from the pre-fix sources:

- **CR-01.** `git show ca0d761:packages/modules/communities/server/service.ts` calls
  `resolveCoverAsset(tx, ctx, coverAssetId)` at line **469, unconditionally**, on the id resolved from
  the STORED column. The shipped `loadCoverAsset` still carries `and deleted_at is null`, so a
  soft-deleted own asset is invisible and the throw is the bare 404. Case 33's archive therefore
  **necessarily** returned 404 pre-fix; the fix at `service.ts:521-524` is the branch on
  `input.coverAssetId !== undefined`.
- **CR-02.** `git show 16a3755:apps/web/components/stories/StoryViewerHost.tsx` shows
  `const playRef = useRef<(() => void) | null>(null)` at line **131**, written by every mounted
  bridge (line 133), and `onRequestPlay: () => playRef.current?.()` at line **156**. With case 14's
  forced release order (story 2 released LAST, asserted per release by element count and
  `data-playback-id`), the pre-fix badge necessarily reached story 2's element — which is exactly the
  assertion the case names as carrying the red.

## Goal Achievement

### Observable Truths

| #   | Truth (roadmap Success Criterion / plan must-have) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | SC-1a — `admin_tenant` creates, EDITS and ARCHIVES a community (name, description, cover image) | ✓ VERIFIED | **Gap closed.** Integration case 33 RUN by this verifier inside a 480/480 green suite: the GAP A repro now answers 200 at every step and the dangling reference self-heals to null exactly once (`updated_at` moves once, one `community.updated`, one `community.archived`, next identical PATCH inert). Code: `service.ts:521-524`. The narrower form-level behaviour is a recorded DECISION, not a gap — see Decisions below |
| 2 | SC-1b — the main feed merges tenant-wide and community posts in one query, one ordering | ✓ VERIFIED | Regression check clean; file untouched by the quick task. `pnpm supabase test db` RUN here: 12 files, **285 tests, Result: PASS**, including `090-feed.sql`'s `EXPLAIN` pinning `feed_posts_tenant_created_all_idx` with a `Seq Scan` negative |
| 3 | SC-1c / COMM-02 — every tenant member sees every community; `community_members` exists for V2 | ✓ VERIFIED | Regression check clean; files untouched. `010-rls-coverage.sql` and `110-communities-stories.sql` green in the 285-test run. `listCommunities` still never joins `community_members` (`service.ts:123-140`) |
| 4 | SC-1d / COMM-04 — the admin posts directly into a community from its page | ✓ VERIFIED | Regression check clean; files untouched; feed + communities integration cases green in the 480/480 run |
| 5 | SC-2 / COMM-03 — member browses the community list and opens a community to its posts and pinned stories | ✓ VERIFIED | Regression check clean; `110-communities-stories.sql` highlights assertions green |
| 6 | SC-3a / STORY-01 — the admin publishes an image or short-video story with an optional caption from a phone | ✓ VERIFIED | Regression check clean, and now with a browser-level walk RUN here: `stories.spec.ts` "an admin taps the own-circle, publishes a photo, and sees it at the head of the strip" **passed (12.1s)** on `mobile-chromium`, worker-derived ladder included |
| 7 | SC-3b — members see active stories in a horizontally scrollable strip | ✓ VERIFIED | Both strip cases (member view without the publish door; admin view with the leading "Seu story" link) **passed** in this verifier's e2e run |
| 8 | SC-3c / STORY-02 — a full-screen viewer with progress bars, auto-advance, tap-to-navigate and hold-to-pause | ✓ VERIFIED | **Gap closed, and the criterion's four named behaviours all have executable evidence run here.** Browser: bar fills and keeps filling; tap right advances / tap left goes back; press-and-HOLD freezes the bar and release resumes from the same point; swipe and BACK dismiss; deep link renders — all green on `mobile-chromium`. Auto-advance: `story-viewer.test.tsx` case 7 ("the clock advances the sequence by itself") green in the 89-test stories run. Video regression: case 14 green. The sub-properties still uncovered (a real video end to end, the error-COPY hit test) are NOT part of SC-3c's text and are carried as human items 1 and 3 |
| 9 | SC-4a / STORY-03 — a story leaves the strip 24 h after publishing, record retained, no cron | ✓ VERIFIED | Regression check clean; pgTAP transaction-controlled-clock block green in the 285-test run. E2E "the history lists EXPIRED stories too" passed |
| 10 | SC-4b / STORY-04 — a pinned story stays visible on its communities after expiry until unpinned | ✓ VERIFIED | Regression check clean; `listCommunityHighlights` still carries no expiry predicate. E2E pin-sheet case ("toggles ONE community immediately, with no save button anywhere") passed |
| 11 | SC-5a — a member can like a story | ✓ VERIFIED | E2E "tapping the heart moves the count, and the server's value is what is shown" passed |
| 12 | SC-5b — a member can comment; likes and replies on story comments are rejected by API AND DB | ✓ VERIFIED | Regression check clean — the phase's strongest work, declarative in the database (`throws_ok` battery green in the 285-test run). E2E comment-sheet walk passed |
| 13 | Phase-wide — no Phase 5 write may persist or reveal another tenant's data (TENANT-05, D-23, core value) | ✓ VERIFIED | Re-checked against the CR-01 fix specifically: `loadCoverAsset` is the single `select` and still carries `tenant_id = ctx.tenantId and deleted_at is null`; `insertCommunity` still calls `resolveCoverAsset` as its FIRST statement (`service.ts:421`); the non-throwing `coverIsUsable` sibling reads the SAME statement, so the self-heal cannot become an oracle — a foreign id and an unknown id both produce `null` with no distinguishable output. `isolation.test.ts` b5 green in the 480/480 run |
| 14 | 05-02 — the D-33 / UI-04 design gate is real and enforced before the five prototype-less surfaces are coded | ✓ VERIFIED | Regression check clean; sketch 003 README still `approved: true` |
| 15 | MOD-04 — both new modules toggle in both directions with no migration and no route edit | ✓ VERIFIED | `apps/api/src/modules/registry.ts` still holds exactly `communities`, `feed`, `stories`; `pnpm check:static-routes` RUN here: 39 guarded routes, **offenders: 0** |

**Score:** 15/15 truths verified (0 present, behavior-unverified)

## Decisions recorded (not gaps)

### D-1. A rename of a community whose cover was retired still shows `cover_invalid`, and that is accepted

Verified mechanism, checked in the code rather than taken from the quick task's advisory:

- `apps/web/app/(app)/comunidades/CommunityForm.tsx:177` builds `{ name, description, coverAssetId }`
  for BOTH modes, so an edit always re-asserts whatever cover the form is holding.
- The form seeds `coverAssetId` from the loaded community (`useState(start.coverAssetId)`, line 104),
  and the read projection returns the raw stored column even for a soft-deleted asset
  (`toCommunity`, `service.ts:95`). So the resubmitted id IS the retired one.
- `service.ts:522` therefore takes the `input.coverAssetId !== undefined` branch and throws case 31's
  bare 404 — correct behaviour for a request that makes a cover claim.
- `actions.ts:240-245` (`coverAwareRefusal`) re-reads the community, finds it, and attributes the
  refusal to the cover: `cover_invalid` ->
  "Não foi possível usar esta imagem de capa. Escolha outra." (`communities.json:103`).

**This is not a regression and not a gap.** The pre-gap-closure code produced the identical
`cover_invalid` on that same path, so the fix moved it in no direction; the recourse is one click
(pick another cover, or clear it), and a single cover-silent PATCH — archive or reactivate — heals
the row, after which the form submits `null` and the edit passes (case 33 asserts the rename 200
after the heal). **The developer was shown this and decided to accept it.** SC-1a's "EDIT" clause is
satisfied by that acceptance, and this report does not re-open it. What remains is editorial and is
carried as human item 4: whether the sentence makes the recourse obvious on a phone.

### D-2. `pnpm verify` has NOT been run against these fixes, and this report does not claim it

What WAS run here, all against the post-fix working tree: `pnpm lint` (9/9, plus the UI-literal
gate), `pnpm turbo run test typecheck` (18/18 tasks; 700 unit tests), `pnpm test:integration`
(480/480), `pnpm supabase test db` (285, PASS), `pnpm check:static-routes` (0 offenders), and
`playwright test stories.spec.ts --project=mobile-chromium` (20 passed, 1 skipped).

What was NOT run: the rest of the Playwright suite, `e2e:pwa`, `boundaries`, `boundaries:negative`,
`guard:lanes`, `spike:supavisor`, `build`. **`pnpm verify` remains the phase exit gate and is still
owed.** It is not load-bearing for the two gap closures — those are proven by the runs above — but it
is load-bearing for the phase's own exit criteria, and nobody should read this report as having
discharged it.

### Deferred Items

None. Phases 6-8 were read for coverage of either closed gap or of any carried item; none of them
commits to a Phase 5 community write path, the story viewer's play registration, or the outstanding
device checks. Under the conservative matching rule, nothing is deferred.

### Advisory (New Scope, Unevidenced)

| # | Finding | Category | Why Advisory |
| --- | --- | --- | --- |
| 1 | WR-03 — `MediaImage`'s `failedId` latch is never cleared, so a recovered asset stays on the fallback | other | Carried. The file was NOT touched by the quick task, so it is new-scope for this round; the trigger (a worker transcode finishing while the viewer is open) still cannot be reproduced without a real transcode. Recorded, not cleared |
| 2 | WR-05/WR-06 — refs written during render in three components; `setMediaState` called inside `setAttempt`'s updater | architectural | Carried. Documented React invariant violations under `reactCompiler: true`; no failing test or reproducible command produced |
| 3 | WINDOWS.md entry 41 still reads `fixed` although the error-copy hit-test property is covered nowhere | other | Carried, and sharper: the quick task fixed the same over-statement in the SOURCE comments but not in the ledger. Evidence re-run here (`grep -c` = 0, empty `git log`). Demotes a ledger claim, not a must-have |
| 4 | The story e2e suite is fixture-destructive downstream of the API integration suite | other | Found and root-caused in this run, not a product defect. `pnpm test:integration` drained the `media` bucket 56 -> 7 objects; every image-backed viewer case then failed at `openViewer`. `pnpm verify` already re-seeds before `pnpm e2e`, which is why the official gate never sees it. Recorded so a future red is not mistaken for a viewer regression |

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `packages/modules/communities/server/service.ts` | community CRUD inside `withTenantTx`, validating the cover the REQUEST asserts | ✓ VERIFIED | One shared `loadCoverAsset` select (lines 299-315) feeding both a throwing `resolveCoverAsset` and a boolean `coverIsUsable`; one `isUsableCover` tuple rule (317-320); `updateCommunity` branches at 521-524. The `(tenant_id, deleted_at is null)` predicate exists exactly once in the file |
| `apps/api/tests/integration/communities.test.ts` | cases 27-33, the cover battery INCLUDING the domestic retired asset | ✓ VERIFIED | Case 33 present (lines ~1109-1186), uses its OWN seeded asset, drives the shipped `DELETE /v1/media/{id}`, pins the self-heal's three side effects and the repeat's inertness, then asserts reactivate and rename. `git diff` on the file is 81 insertions / 0 deletions — case 31's foreign-stale-cover property is byte-unchanged |
| `apps/api/tests/integration/isolation.test.ts` | case b5, the cross-tenant cover gate with its positive control | ✓ VERIFIED | Untouched by the quick task; green in the 480/480 run |
| `apps/web/app/(app)/comunidades/actions.ts` | `coverAwareRefusal`, fact-based attribution of a bare 404 | ✓ VERIFIED | Unchanged code, and now correct end to end: the API can no longer produce a cover-flavoured 404 on a cover-silent PATCH, so the `submittedCoverAssetId === null` short-circuit no longer mis-reports an archive |
| `apps/web/app/(app)/comunidades/actions.test.ts` | the archive case no longer documents the stale-cover 404 as intended | ✓ VERIFIED | Case renamed and its comment rewritten with **assertions unchanged**, plus a new sibling pinning a successful `archiveCommunityAction` with no `loadCommunity` re-read |
| `apps/web/components/stories/StoryViewerHost.tsx` | `playRefs` keyed by story id, owner-only clear, `onRequestPlay` resolving `item.id` | ✓ VERIFIED | `playRefs` record + `useCallback([], …)` `bindPlay` with `delete` on null (lines 148-157); `onRequestPlay: () => playRefs.current[item.id]?.()` (174); `storyId={item.id}` passed to `StoryVideo` (179). Byte-for-byte the shape `bindCountBump` already used eight lines above — the asymmetry WAS the bug |
| `apps/web/components/stories/StoryVideo.tsx` | required `storyId` and two-argument `onPlayRef(storyId, play \| null)` | ✓ VERIFIED | `storyId: string` required (line 42); `onPlayRef?.(storyId, …)` on attach and `onPlayRef?.(storyId, null)` on detach; effect deps `[onPlayRef, storyId]` — a plain value, so WR-01's loop class is not reopened |
| `apps/web/components/stories/StoryViewerHost.test.tsx` | case 14, three adjacent video stories with per-element `play` spies | ✓ VERIFIED | Present, RUN green here. The forcing is asserted (element count + `data-playback-id` after each gated release), and the case names which assertion carries the red and which guard is blind by construction — no over-claim |
| `packages/modules/stories/ui/StoryViewer.tsx` | the viewer, with the badge and error container out of the gesture stage | ✓ VERIFIED | Structural isolation unchanged (`grep -c stopPropagation` = 0); the only change since the last report is the corrected coverage comment. Full diff against `16a3755` is comment text only — zero code lines |
| `packages/modules/stories/tests/story-viewer-media.test.tsx` | the REAL MediaImage under the REAL StoryViewer | ✓ VERIFIED | Untouched; green in the stories module's 89-test run |
| `packages/core/ui/MediaImage.tsx` | private-image renderer with ready/failed reporting, loop-free | ✓ VERIFIED | Untouched by the quick task; component tests green. WR-03 remains advisory |
| `apps/web/e2e/stories.spec.ts` | the browser-level gesture and walk suite | ✓ VERIFIED (as coverage) | 20 passed / 1 skipped RUN here. It still contains ZERO references to the badge, the media-error container or the retry — an accurate, now honestly-documented hole, carried as human item 3 |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `updateCommunity` | `loadCoverAsset` | ONE shared select, two answers | ✓ WIRED | `resolveCoverAsset` (throws) and `coverIsUsable` (boolean) both call it; the tenant/deleted predicate appears exactly once in the file |
| `updateCommunity` | `communities.cover_asset_id` | the self-heal write | ✓ WIRED | Case 33 reads the healed `null` straight from Postgres with an admin connection after the shipped PATCH |
| `CommunityForm` | `updateCommunityAction` -> API | `{ name, description, coverAssetId }` | ✓ WIRED | Verified by reading the submit payload at line 177 — this is also the link that produces the accepted D-1 behaviour |
| `StoryViewerHost.bindPlay` | `StoryVideo`'s attach/detach | `(storyId, play \| null)` | ✓ WIRED | One JSX site (`onPlayRef={bindPlay}`), `useCallback([], …)` so identity is stable, `storyId` a plain string. Typecheck green across 10 packages |
| `story badge` -> `playRefs[item.id]` -> vendor element `play()` | the member's own gesture | synchronous call inside the click handler | ✓ WIRED | Case 14 spies the ELEMENT's own `play`: active > 0, both neighbours exactly 0 |
| strip circle -> viewer -> progress clock | real media load | browser | ✓ WIRED | E2E `openViewer` polls the rendered fill width > 0, which is also the proof the image decoded; green |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| `service.ts` `updateCommunity` | `coverAssetId` | request body when asserted, else the stored column checked through a real tenant-scoped `select` | ✓ (case 33 reads the healed value from Postgres) | ✓ FLOWING |
| `CommunityForm` | `coverAssetId` initial value | the API read projection (`toCommunity`) | ✓ | ✓ FLOWING |
| `StoryViewerHost` | `playRefs.current[item.id]` | a closure registered by the REAL `StoryVideo` bridge over the REAL vendor element | ✓ (case 14 spies the element's own `play`) | ✓ FLOWING |
| story progress bar | segment fill width | the rAF clock for images, the element's own `timeupdate` for video | ✓ for images (e2e measures computed width); video's real-stream half is human item 1 | ✓ FLOWING |
| strip circles | active stories | `listActiveStories` with `expires_at > now()` and the readiness filter | ✓ (e2e counts 3 seeded active ready stories and excludes the `processing` fixture) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| The GAP A repro through shipped endpoints | `pnpm db:reset && pnpm db:seed && pnpm test:integration` | 29 files, **480 passed**, incl. case 33 | ✓ PASS |
| The GAP B repro at component level | `pnpm exec vitest run components/stories/StoryViewerHost.test.tsx components/stories/StoryVideo.test.tsx` | 2 files, **20 passed**, incl. case 14 | ✓ PASS |
| Whole-workspace unit + types | `pnpm turbo run test typecheck` | **18/18 tasks**, 700 tests passed | ✓ PASS |
| Database rules (RLS, isolation, feed index, story constraints) | `pnpm supabase test db` | 12 files, **285 tests, Result: PASS** | ✓ PASS |
| Browser gesture set and walks | `playwright test stories.spec.ts --project=mobile-chromium` | **20 passed, 1 skipped** (after restoring the seed fixtures) | ✓ PASS |
| Lint + UI-literal gate | `pnpm lint` | 9/9 tasks, catalog files valid | ✓ PASS |
| Authenticated-route staticness | `pnpm check:static-routes` | 39 guarded routes, offenders 0 | ✓ PASS |
| Pre-fix RED for both defects | `git show ca0d761:…/service.ts`, `git show 16a3755:…/StoryViewerHost.tsx` | unconditional `resolveCoverAsset` (469); single `playRef` (131-133,156) | ✓ PASS (RED re-derived) |
| A real VIDEO story playing end to end | — | Not runnable: provider `fake`, `[mux-player] playback-token invalid or malformed` for every seeded video | ? SKIP -> human item 1 |
| A tap on the error COPY falling through | — | happy-dom does not hit-test; no browser spec drives that control | ? SKIP -> human item 3 |

### Probe Execution

| Probe | Command | Result | Status |
| --- | --- | --- | --- |
| — | — | No `scripts/*/tests/probe-*.sh` exists and no PLAN or SUMMARY in this phase declares a probe | N/A — not applicable to this phase |

### Requirements Coverage

Every one of the nine Phase 5 requirement IDs declared in the plans' frontmatter is accounted for
below. All nine currently read `- [ ]` / `Gaps Found` in `.planning/REQUIREMENTS.md`.

| Requirement | Source Plan(s) | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| COMM-01 | 05-01, 05-04, 05-09 | create, edit and archive communities (name, description, cover) | ✓ SATISFIED — **newly earned this pass** | Truth 1. Integration case 33 + cases 24-32 green in a 480/480 run; the accepted D-1 disposition covers the residual form-level edit |
| COMM-02 | 05-01 | every tenant member sees every community; membership table exists for V2 | ✓ SATISFIED — **already satisfied in both prior passes** | Truth 3. Verified ✓ in verification #1 and #2; reverted only by the blanket commit, not by a finding |
| COMM-03 | 05-04 | browse the list (cover, name, description, post count); open to posts and pinned stories | ✓ SATISFIED — **already satisfied in both prior passes** | Truth 5 |
| COMM-04 | 05-03 | admin posts directly into a community from its page | ✓ SATISFIED — **already satisfied in both prior passes** | Truth 4 |
| STORY-01 | 05-05 | publish an image or short-video story with an optional caption | ✓ SATISFIED — **already satisfied in both prior passes**, and now with a browser walk | Truth 6; e2e publish case green here |
| STORY-02 | 05-06, 05-10, 05-11 | strip + full-screen viewer with progress bars, auto-advance, tap-to-navigate, hold-to-pause | ✓ SATISFIED — **newly earned this pass** | Truths 7 and 8. Case 14 green; all four named gestures green in a real browser |
| STORY-03 | 05-05 | 24 h visibility by `expires_at`, record retained | ✓ SATISFIED — **already satisfied in both prior passes** | Truth 9 |
| STORY-04 | 05-08 | pin to communities; pinned story survives expiry until unpinned | ✓ SATISFIED — **already satisfied in both prior passes** | Truth 10 |
| STORY-05 | 05-07 | like and comment on a story; comment likes and replies refused | ✓ SATISFIED — **already satisfied in both prior passes** | Truths 11 and 12 |

**Orphaned requirements:** none. `grep -E "Phase 5" .planning/REQUIREMENTS.md` maps exactly these
nine IDs to this phase, and every one appears in at least one plan's `requirements` frontmatter.

**The "blanket revert" claim, checked against git rather than accepted.** It holds, with one detail
worth stating precisely:

- **`99782b6`** (after verification #1, which found 2 gaps) reverted **all nine** rows from
  `Complete` to `Gaps Found` in one edit — confirmed by its diff. Seven of those nine were ✓ VERIFIED
  in that very report; they lost their mark to the blanket action, not to a finding.
- **`5e0334f`** and **`350f88f`** later re-marked **only** COMM-01 and **only** STORY-02, because only
  those two had a gap-closure plan claiming them.
- **`6e42242`** (after verification #2) reverted **only those two** again — its diff touches COMM-01
  and STORY-02 and nothing else.

So the seven never-failing requirements have been sitting at `Gaps Found` since `99782b6` purely as
collateral. **All nine are now earned and the roadmap step can correct all nine at once.**

### Anti-Patterns Found

No blocker. No `TBD`, `FIXME` or `XXX` in any of the nine files the quick task changed
(`grep -nE "TBD|FIXME|XXX|HACK|PLACEHOLDER"` over each: zero hits), so the debt-marker gate is clean.

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| `apps/web/components/stories/StoryVideo.tsx` | ~182 | `onPlayRef` is an effect dependency while other volatile inputs go through refs | ⚠️ Warning | WR-01, carried. Mitigated in practice: the only consumer passes a `useCallback([], …)` and `storyId` is a plain string, so no attach/detach loop is reachable today |
| `apps/web/components/stories/StoryVideo.tsx` | ~150 | `void element.play?.()` — `play()` rejections are unhandled promise rejections | ⚠️ Warning | WR-02, carried. `NotAllowedError` is the *expected* path this component models; Sentry will record it as an error |
| `packages/modules/communities/server/service.ts` | docblock above `resolveCoverAsset` | a docblock that once denied the tenant comparison the statement makes | ⚠️ Warning | WR-04, carried. The surrounding text was rewritten by the fix and now describes the branch accurately; the original wording concern is no longer reachable at the quoted lines but the file's correctness argument still rests on being read literally |
| `packages/modules/stories/ui/StoryViewer.tsx` | ~184-189, ~591-596 | retry re-mounts the media but leaves `videoProgress`, `canPlay`, `playing`, `blocked` stale for that story | ⚠️ Warning | WR-07, carried. A retried video can show the previous attempt's fill |
| `packages/modules/communities/server/service.ts` | ~527-530 | `changedContent` compares uuids as JavaScript strings | ⚠️ Warning | WR-08, carried and unchanged by the fix. An upper-case re-send of the stored cover is not inert: `updated_at` moves and an event fires for a no-op |
| `apps/web/components/stories/StoryViewerHost.tsx`, `StoryVideo.tsx` | — | none | ℹ️ Info | The CR-02 fix adds no new pattern: it replaces one ref with a keyed record already used by a sibling in the same file |

### Human Verification Required

Twelve items. Eleven are carried forward unchanged from the previous report (nothing was "resolved
by being written down more confidently"); one is new and is created by the CR-01 fix itself.

#### 1. A VIDEO story watched end to end

**Test:** Publish a VIDEO story as `admin_tenant`, wait for it to become ready, open it from the
`/inicio` strip and watch it to the end.
**Expected:** The segment fills from the video's own time and auto-advances (or closes) when it ends.
**Why human:** H-05-02 / WINDOWS entry 42, `open`. The local provider is `fake`; the browser console
in this verifier's own e2e run shows `[mux-player 3.13.4] The playback-token provided is invalid or
malformed` for every seeded video, and the seed fixture is image-only. Nothing local can prove a real
transcode plays.

#### 2. The 30 s device render-rate profile (image path)

**Test:** Open the viewer on a phone (or a mobile emulation profile) on a story whose image is
already decoded; watch CPU and memory for 30 s.
**Expected:** The bar fills smoothly and the tab stays idle between frames.
**Why human:** H-05-01's open half. 05-10's render-count ceiling is a BOUND, not a profile.

#### 3. A tap on the story error COPY

**Test:** In the viewer, tap the error COPY (not the retry button) on a failed story.
**Expected:** The tap falls through `pointer-events-none` to the stage and advances the story.
**Why human:** happy-dom does not hit-test. Re-confirmed here: `stories.spec.ts` has zero references
to the badge, the error container or the retry. The quick task deleted the comments that falsely
claimed otherwise — that is honesty, not coverage.

#### 4. The pt-BR cover-refusal sentence, and the accepted D-1 recourse

**Test:** As `admin_tenant`, open a community whose cover was retired, rename it, and read
"Não foi possível usar esta imagem de capa. Escolha outra." in the alert card at 320px. Then pick
another cover (or clear it) and save again.
**Expected:** The sentence reads naturally, fits the card per UI-SPEC error/E13, and the recourse is
obvious and works.
**Why human:** 05-09 coverage D6, `human_judgment: true`. This is the surface of the accepted
decision D-1 — the mechanism is settled, the copy is not.

#### 5. Archive/reactivate on the real admin screen

**Test:** Archive, then reactivate, a community whose cover asset was retired.
**Expected:** Both succeed, no false "Comunidade não encontrada", and the card falls back to the
brand gradient.
**Why human:** Product-surface confirmation of the previously failed gap. The mechanism is covered by
case 33, which this verifier ran green.

#### 6-10. The five backstop visual claims (B-05-01 … B-05-05)

All five remain `verification: backstop` / `insufficient_spec` and route to a human unchanged:
B-05-01 (60-char community name at 24/700, 320px), B-05-02 (40-char tenant display name on
`/inicio`), B-05-03 (25-story sequence at 320px), B-05-04 (90-char caption + 40-char community name
in one history row at 320px), B-05-05 (twelve 40-char community names in the pin sheet).
**Note on B-05-03 only:** `stories.spec.ts:552` asserts exactly that property at 320px for
`STORY_PAGE_SIZE` stories and passed in this run — but `STORY_PAGE_SIZE` is **10**, and the strip
shows one page, so 25 is unreachable. A human may judge the claim discharged at the reachable
maximum; this report does not make that call.

#### 11. The 22 flagged prohibitions

**Test:** Resolve P-05-01 … P-05-14 (14 carried) and N-05-01 … N-05-08 (8 added by gap closure),
using the evidence in `05-VERIFICATION-DEBT.md` sections 2 and 4.
**Expected:** Each must-NOT is judged still honoured by the shipped code.
**Why human:** All 22 carry `status: unverified` / `verification: flagged`; they fail closed.

#### 12. N-05-02 against the CR-01 self-heal — NEW

**Test:** Judge "A refused cover must never be silently dropped, nulled or substituted so the write
can proceed" against `service.ts:523`, where a cover-silent PATCH nulls a dangling stored reference.
**Expected:** A decision on whether a reference the admin already retired, dropped on a request that
asserted nothing about a cover, is inside or outside that must-NOT.
**Why human:** The fix keeps the prohibition's literal case intact — a request that SENDS an unusable
id is still refused with the bare 404 — and the alternative is the bricked row the prohibition never
intended. But the admin is not told the reference was dropped, and N-05-02's sentence is about
silence. This is the one prohibition whose subject matter the fix actually moved, and it must not be
settled by this report.

### Gaps Summary

**None.** Both blocking gaps from the previous pass are closed, each proven by running the test that
owns it rather than by reading the SUMMARY, and each with its pre-fix RED re-derived from the
pre-fix source. No new regression was found: the quick task's source diff is nine files
(`git diff --stat 6e42242..HEAD`), two of them comment-only, and every other truth's evidence is
untouched and was re-checked green.

The phase does **not** pass outright, because twelve items still need a human. That is the honest
shape of this phase: the code is now correct on every criterion the roadmap states and every check
this repo can run, while a video story that really plays, a real-device profile, one hit-test, one
piece of copy, five 320px layout claims and twenty-three fail-closed judgments remain outside what
any command here can settle. `pnpm verify` — the phase exit gate — is also still owed.

---

_Verified: 2026-09-24T16:05:00Z_
_Verifier: Claude (gsd-verifier)_
