---
status: testing
phase: 05-communities-stories
source: [05-VERIFICATION.md]
started: 2026-09-24T15:40:00Z
updated: 2026-09-24T15:40:00Z
---

## Current Test

number: 1
name: Publish a VIDEO story as `admin_tenant`, wait for it to become ready, then open it from the `/inicio` strip and watch it end to end
expected: |
  The segment fills from the video's own time and auto-advances (or closes) when the video ends
awaiting: user response

## Tests

### 1. Publish a VIDEO story as `admin_tenant`, wait for it to become ready, then open it from the `/inicio` strip and watch it end to end
expected: The segment fills from the video's own time and auto-advances (or closes) when the video ends
why_human: H-05-02 / WINDOWS entry 42, still OPEN. The local video provider is `fake` with no HLS stream (console shows `[mux-player] The playback-token provided is invalid or malformed` for every seeded video) and the seed fixture is image-only, so no e2e can assert over a player that cannot play.
result: [pending]

### 2. Open the story viewer on a phone (or a mobile emulation profile) on a story whose image is already decoded, and watch CPU and memory for 30 s
expected: The bar fills smoothly and the tab stays idle between frames
why_human: H-05-01's open half. 05-10's render-count ceiling (throws at 400, settles at ~8) is an automated BOUND, not a render-RATE profile on a real decoder.
result: [pending]

### 3. In the viewer, tap the story error COPY (not the retry button) on a failed story
expected: The tap falls through the `pointer-events-none` container to the stage and advances the story
why_human: happy-dom does not hit-test, so `pointer-events-none` has no effect on synthetic dispatch (05-10 deviation 3, coverage D6 `deferred`). `apps/web/e2e/stories.spec.ts` contains ZERO references to the badge, the media-error container or the retry control — quick-260924-fwv deleted the comments that falsely claimed it did, which is not the same as adding coverage.
result: [pending]

### 4. As `admin_tenant`, open a community whose cover asset was retired, rename it, and read the pt-BR refusal sentence "Não foi possível usar esta imagem de capa. Escolha outra." in the CommunityForm alert card on a 320px phone viewport. Then pick another cover (or clear it) and save again
expected: The sentence reads naturally, fits the alert card as UI-SPEC error/E13 designs it, and the recourse (choose another cover, or clear it) is obvious and works
why_human: 05-09 coverage D6, `human_judgment: true` — tone and placement are editorial. This is the surface of the DEVELOPER-ACCEPTED residual behaviour (the shipped form always submits `coverAssetId`, so a rename that re-asserts a retired id still gets `cover_invalid`). The mechanism is accepted; judge only whether the copy makes the recourse clear.
result: [pending]

### 5. As `admin_tenant`, archive (and then reactivate) a community whose cover asset was retired through the media library, on the real admin screen
expected: Both writes succeed, no "Comunidade não encontrada" appears, and the card falls back to the brand gradient
why_human: Mechanism is covered by integration case 33, which the verifier ran green — this is the product-surface confirmation of the previously failed gap. A confirmation, not an open defect.
result: [pending]

### 6. Backstop B-05-01 (05-04): a 60-character community name at 24/700 on a 320px viewport
expected: Wraps to at most three lines without clipping the cover above it
why_human: Declared `verification: backstop`, abstain reason `insufficient_spec` — no automated evidence anywhere in the phase.
result: [pending]

### 7. Backstop B-05-02 (05-05): a 40-character tenant display name on /inicio above the strip
expected: The strip carries no tenant string; the welcome heading above it absorbs the length as Phase 2 pinned it
why_human: Declared `verification: backstop`, reason `insufficient_spec`; the second half inherits a Phase 2 backstop that is itself unverified.
result: [pending]

### 8. Backstop B-05-03 (05-06): a 25-story sequence at 320px
expected: Every progress segment stays at least 2px wide and the bar row does not wrap
why_human: Declared `verification: backstop`, reason `insufficient_spec`. NOTE: `stories.spec.ts:552` asserts exactly this at 320px for `STORY_PAGE_SIZE` stories and ran green — but `STORY_PAGE_SIZE` is 10, not 25, and the strip shows one page, so 25 is not a reachable state. A human may judge the claim discharged at the reachable maximum.
result: [pending]

### 9. Backstop B-05-04 (05-08): a 90-character story caption and a 40-character community name in one history row at 320px
expected: Both truncate with a title attribute while the row keeps its minimum height
why_human: Declared `verification: backstop`, reason `insufficient_spec`.
result: [pending]

### 10. Backstop B-05-05 (05-08): twelve communities with 40-character names in the pin sheet
expected: Each truncates while the switch stays fully reachable inside the 80%-height sheet
why_human: Declared `verification: backstop`, reason `insufficient_spec`.
result: [pending]

### 11. Resolve the 22 flagged prohibitions — the 14 carried from 05-01..05-08 (P-05-01..P-05-14) and the 8 that gap closure added (N-05-01..N-05-08). `05-VERIFICATION-DEBT.md` sections 2 and 4 carry the evidence beside each
expected: Each must-NOT is judged still honoured by the shipped code
why_human: All 22 carry `status: unverified` with `verification: flagged`. They fail closed and need explicit human resolution. The dossier reads each one but resolves none, by its own governing rule.
result: [pending]

### 12. Judge prohibition N-05-02 ("A refused cover must never be silently dropped, nulled or substituted so the write can proceed") against the CR-01 self-heal specifically
expected: A human decides whether nulling a DANGLING STORED cover on a request that asserted nothing about a cover is inside or outside that must-NOT
why_human: NEW this round, and the only prohibition whose subject matter the fix actually moved. The literal case is intact — a request that SENDS an unusable id is still refused with the bare 404 (`service.ts:522`) — and only a reference the community's own admin already retired is dropped. But the admin is not told, and N-05-02's sentence is about silence. Belongs to the same human resolving the other 22.
result: [pending]

## Summary

total: 12
passed: 0
issues: 0
pending: 12
skipped: 0
blocked: 0

## Gaps
