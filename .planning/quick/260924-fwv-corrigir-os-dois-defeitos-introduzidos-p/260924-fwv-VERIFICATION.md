---
phase: quick-260924-fwv
verified: 2026-09-24T15:25:07Z
status: passed
score: 8/8 must-haves verified
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/quick/260924-fwv-corrigir-os-dois-defeitos-introduzidos-p/260924-fwv-PLAN.md"
  - ".planning/quick/260924-fwv-corrigir-os-dois-defeitos-introduzidos-p/260924-fwv-SUMMARY.md"
  - "apps/api/tests/integration/communities.test.ts"
  - "apps/web/app/(app)/comunidades/actions.test.ts"
  - "apps/web/components/stories/StoryVideo.test.tsx"
  - "apps/web/components/stories/StoryVideo.tsx"
  - "apps/web/components/stories/StoryViewerHost.test.tsx"
  - "apps/web/components/stories/StoryViewerHost.tsx"
  - "packages/modules/communities/server/service.ts"
  - "packages/modules/stories/tests/story-viewer.test.tsx"
  - "packages/modules/stories/ui/StoryViewer.tsx"
covered_digest: "v1:sha256:5591b08a1700f5c102a7412356ddfb17c9b5f36379154daaf9d1ee57e038111c"
behavior_unverified: 0
overrides_applied: 0
gaps: []
deferred: []
advisory:
  - finding: "Through the shipped ADMIN FORM, a rename/description edit of a community whose cover was retired is still refused — the form always submits `coverAssetId`, so the request DOES assert the dangling id and keeps case 31's 404, which the BFF's `coverAwareRefusal` turns into `cover_invalid` (\"Não foi possível usar esta imagem de capa. Escolha outra.\"). Archive and reactivate — the gap's own repro — are fully fixed because they submit `status` only."
    category: other
    reason: "NOT a regression and NOT in this task's scope: the pre-fix code produced the identical `cover_invalid` on that same path (`updateCommunity` 404 -> re-read succeeds -> cover_invalid), so this fix moved it in no direction. The task's truth #1 is scoped to writes that assert NO cover, and that is satisfied. Recorded because Phase 5's SC-1a says 'EDIT', and the phase re-verification should decide whether 'the admin must pick another cover (or clear it) before renaming' satisfies that criterion. The remedy is reachable in one click and the copy is actionable, unlike the pre-gap-closure false 'Comunidade não encontrada'. A single cover-silent PATCH (archive/reactivate) also self-heals the row, after which the form sends null and the edit passes."
    evidence_status: "verifier probe P2 (re-sent retired id -> bare 404) + `actions.ts` coverAwareRefusal + `CommunityForm.tsx:177` submitting `{ name, description, coverAssetId }` + `service.ts:95` returning the raw stored `cover_asset_id` on a read"
behavior_unverified_items: []
coincidental_reliance_items: []
---

# Quick Task 260924-fwv Verification Report

**Task Goal:** Corrigir os dois defeitos introduzidos pela gap closure da Fase 5 — CR-01 (`updateCommunity` revalida a capa armazenada em todo PATCH) e CR-02 (`bindPlay` não chaveado por story id).
**Verified:** 2026-09-24T15:25:07Z
**Status:** passed
**Re-verification:** No — initial verification of this quick task (third attempt at the two underlying Phase 5 requirements)

## How this verification was conducted

The SUMMARY was read and then set aside. Both of GAP A's and GAP B's ORIGINAL reproductions (from
`05-VERIFICATION.md`) were re-run by this verifier against the shipped code using **throwaway probes
this verifier wrote**, not the plan's new tests:

- `apps/api/tests/integration/zzprobe-verifier.test.ts` — 4 cases, shipped endpoints only.
- `apps/web/components/stories/zzprobe-verifier.test.tsx` — 3 cases, built on the real harness.

Both probe files were deleted before this report was written; the working tree carries no tracked
change (`git status --short` shows only pre-existing untracked paths plus this report).

## Goal Achievement

### Observable Truths

| # | Truth (PLAN `must_haves.truths`) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | CR-01: a community whose cover was retired through `DELETE /v1/media/{assetId}` still accepts every write — `{status:'archived'}` answers 200 and the stored `cover_asset_id` is then null | ✓ VERIFIED | **Verifier probe P1, the GAP A repro replayed independently:** create `201` → `DELETE /v1/media/{id}` `200` → `GET /v1/communities/{id}` `200` → `PATCH {status:'archived'}` **200** (was `404`) → `cover_asset_id` reads back **null** → `{status:'active'}` 200, `{name}` 200, `{description}` 200. Code: `service.ts:521-524` branches on `input.coverAssetId !== undefined` |
| 2 | CR-01 regression guard: a PATCH that SENDS an unusable cover id still answers the bare 404 with no `details`; case 31's property byte-unchanged | ✓ VERIFIED | **Probe P2 (oracle rebuild attempt):** four refusals — foreign-tenant cover, unknown cover uuid, own soft-deleted cover, unknown community id — all `404`, and their bodies minus `requestId` collapse to **one distinct string** `{"error":{"code":"NOT_FOUND","message":"Não encontrado."}}`, no `details` key. `git diff` on `communities.test.ts` is **81 insertions, 0 deletions** — case 31 is literally byte-unchanged. `isolation.test.ts` b5 green in the full run |
| 3 | CR-01 regression guard: a PATCH identical to a stored row carrying a USABLE cover is still observably inert | ✓ VERIFIED | **Probe P3:** re-sent identical cover → 200, `updated_at` unmoved; identical name → 200, `updated_at` unmoved; a REAL cover change → `updated_at` moves; `post_count` and `last_activity_at` unmoved in all three. Cases 24 and 31 green in the full integration run |
| 4 | CR-01: the self-heal is BOUNDED and each side effect pinned — one `updated_at` move, exactly one `community.updated`, next identical PATCH inert again | ✓ VERIFIED | Case 33's own assertions (run by this verifier, green). Independently corroborated by the probe run's server logs: the healing PATCH logged `contentChanged:true, archivedNow:true` + one `community.updated` + one `community.archived`; the NEXT write logged `contentChanged:false, hasCover:false` — the repair did not re-fire |
| 5 | CR-02: a tap on `story-autoplay-badge` plays the CURRENT story's element and ZERO neighbours, with three adjacent video stories mounted | ✓ VERIFIED | **Probe Q1** (GAP B's original two-adjacent-video repro, ungated): active `2` calls, neighbour `0`. **Probe Q2** (three stories, gated release forcing the *PREVIOUS* neighbour to attach LAST — the mirror of case 14, which forces the NEXT one): prev `0`, active `2`, next `0`, with per-release `data-playback-id` assertions proving the forced order held. Code: `playRefs.current[item.id]?.()` at `StoryViewerHost.tsx:174` |
| 6 | CR-02: a neighbour leaving the window clears only its OWN registration; the active story's badge still reaches its own element | ✓ VERIFIED (behaviorally, by a discriminating count) | The plan itself calls its guard "blind by construction". **Probe Q3 removes the blindness:** after story 0 leaves the 3-wide window (element count 3→2), a tap on the badge gives the active element **exactly 2** `play()` calls — the gesture-synchronous one from `onRequestPlay` **and** the pause/mute effect's. Pre-fix, `detach()` nulled the single shared slot, so only the effect call could land: the count would be **1**. `toBe(2)` is therefore a real discriminator, and it passes. The departed neighbour's element stayed at `0` |
| 7 | Each fix carries a named test that fails before it and passes after — neither ships on a suite that structurally cannot see it | ✓ VERIFIED | Both named tests exist and pass: `communities.test.ts` case 33 and `StoryViewerHost.test.tsx` case 14. Their discriminating power was re-established by this verifier rather than inherited — see "RED-ness re-established" below. This verifier's own independent probes are discriminators of the same shape (Q2 forces the other neighbour; Q3 pins an exact count) and they pass |
| 8 | CR-02's pre-fix failure is FORCED by the harness, not sampled | ✓ VERIFIED | Case 14 gates `playbackToken` per asset id, releases story 1 → 0 → 2 one at a time inside `act`, and asserts after each release both the element COUNT and the arriving element's `data-playback-id` — harness-describing assertions that fail loudly if the forcing stops working. Verified by reading the case and by reproducing the same technique in probe Q2 with the release order reversed |

**Score:** 8/8 truths verified (0 present, behavior-unverified)

### RED-ness re-established (truth 7, the claim this task exists to make credible)

`SUMMARY.md` claims both REDs were machine-verified `RED_EVIDENCE_OK`. That claim was **not
inherited**. This verifier attempted to re-run both reproductions against the pre-fix code by
restoring `service.ts` / the two story components from commits `ca0d761` / `16a3755`; the sandbox
denied overwriting tracked files. RED-ness was therefore re-established deterministically instead:

- **CR-01.** `git show ca0d761:…/service.ts` shows `await resolveCoverAsset(tx, ctx, coverAssetId)`
  called **unconditionally** on the resolved (i.e. stored) id. Probe P2 observed, on the shipped
  code, that `resolveCoverAsset` still answers a bare `404` for a soft-deleted own asset. The
  pre-fix archive in P1/case 33 therefore *necessarily* returned 404 — the executor's quoted
  failure (`expected 404 to be 200`) is the only possible outcome of that pair of facts.
- **CR-02.** `git show 16a3755:…/StoryViewerHost.tsx` shows `playRef.current = play` written by
  every bridge into ONE slot and `onRequestPlay: () => playRef.current?.()`. With case 14's forced
  release order (story 2 last, asserted per release), the pre-fix badge necessarily called story 2's
  `play` — so `expect(play2).toHaveBeenCalledTimes(0)` is the assertion that fails, and
  `expect(play0)…(0)` and `expect(play1)…>0` both pass. That matches the executor's quoted failure
  (`the NEXT neighbour — forced to attach last — must not be played: expected +0, got 1`) exactly,
  including which half carries the proof. Probe Q3 additionally shows the unkeyed-`detach` defect
  would change a measured count from 2 to 1.

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `packages/modules/communities/server/service.ts` | one shared cover lookup feeding a throwing `resolveCoverAsset` and a boolean `coverIsUsable`; `updateCommunity` branches on the REQUEST | ✓ VERIFIED | `loadCoverAsset` (lines 299-315) is the single `select`; `isUsableCover` (317-320) is the single tuple rule; both consumers call them. The diff shows the select statement is byte-identical to the pre-fix one (moved, not rewritten) |
| `apps/api/tests/integration/communities.test.ts` | new case 33, the DOMESTIC stale cover retired through the shipped DELETE | ✓ VERIFIED | Case 33 present (lines ~1108-1186), uses its OWN seeded asset, drives the shipped `DELETE /v1/media/{id}`, pins the self-heal's three side effects and the repeat's inertness. 81 insertions / 0 deletions |
| `apps/web/components/stories/StoryVideo.tsx` | `storyId` prop and two-argument `onPlayRef(storyId, play \| null)` | ✓ VERIFIED | `storyId: string` REQUIRED (line 42); `onPlayRef?.(storyId, …)` on attach (150) and `onPlayRef?.(storyId, null)` on detach (164); effect deps `[onPlayRef, storyId]` (182) |
| `apps/web/components/stories/StoryViewerHost.tsx` | `playRefs` record keyed by story id, `bindPlay(storyId, play \| null)`, `onRequestPlay` resolving `item.id` | ✓ VERIFIED | `playRefs` record + `useCallback([], …)` `bindPlay` with owner-only `delete` (lines 152-157); `onRequestPlay: () => playRefs.current[item.id]?.()` (174); `storyId={item.id}` (179) |
| `apps/web/components/stories/StoryViewerHost.test.tsx` | new case 14, three adjacent video stories, per-element `play` spies | ✓ VERIFIED | Case 14 present; 184 insertions / 2 deletions (the 2 are the `MuxPlayerStandIn` widening) — no existing assertion removed |
| `apps/web/app/(app)/comunidades/actions.test.ts` | the archive case no longer documents the stale-cover 404 as intended | ✓ VERIFIED | Case renamed + comment rewritten, **assertions unchanged**; new sibling case pins a successful `archiveCommunityAction` with no `loadCommunity` re-read |
| `StoryViewer.tsx` + `story-viewer.test.tsx` | the two comment blocks name no spec and state the hit-testing half is asserted by no automated test | ✓ VERIFIED | `grep -n "e2e/stories.spec.ts"` over both files → **exit 1, no match**. Full diff of `StoryViewer.tsx` against `16a3755` is **comment text only** — zero code lines changed |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `resolveCoverAsset` | `coverIsUsable` | ONE shared `select` | ✓ WIRED | Both call `loadCoverAsset`; the `(id, tenant_id, deleted_at is null)` predicate exists exactly once in the file (`grep` over `service.ts` finds one `from media_assets`) and the tuple rule exactly once in `isUsableCover` |
| `bindPlay` | `bindCountBump` | identical `(id, value \| null)` idiom | ✓ WIRED | Both are `useCallback([], …)` storing on truthy and `delete`-ing the single key on null, eight lines apart |
| `bindPlay` | `StoryVideo`'s listener effect | stable identity, `storyId` plain string | ✓ WIRED | `useCallback(…, [])` — provably stable; `storyId` is `item.id`. No inline `onPlayRef` anywhere (`grep` finds one JSX site, `onPlayRef={bindPlay}`). Empirically no attach/detach loop: every story test completes in ~430 ms with a bounded `attachments` count |
| `StoryVideo`'s `onPlayRef` call sites | both moved together | typecheck | ✓ WIRED | `pnpm turbo typecheck --force` → 10/10 successful. `storyId` reached all seven `StoryVideo.test.tsx` render sites (the PLAN's `key_links` line 49 undercounted them at two; the SUMMARY records this as deviation 1 and it is accurate) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| `service.ts` `updateCommunity` | `coverAssetId` | request body, else stored column checked through a real `select` in the tenant lane | ✓ (probe P1/P4 read the healed value straight from Postgres) | ✓ FLOWING |
| `StoryViewerHost` | `playRefs.current[item.id]` | a closure registered by the REAL `StoryVideo` bridge over the REAL vendor element | ✓ (probe Q1-Q3 spied the element's own `play`) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| GAP A repro, shipped endpoints only | `vitest run tests/integration/zzprobe-verifier.test.ts` (verifier probe) | 4 passed — archive 200, cover null, all verbs reachable | ✓ PASS |
| Anti-oracle rebuild attempt (4 refusal shapes) | same run, case P2 | 1 distinct body across foreign / unknown / retired cover and unknown community | ✓ PASS |
| Inertness + no `post_count` / `last_activity_at` drift | same run, case P3 | inert on identical, moves on a real change | ✓ PASS |
| A cover-silent PATCH cannot LAUNDER a foreign id | same run, case P4 | healed to null in both the body and the row | ✓ PASS |
| GAP B repro, two adjacent videos | `vitest run components/stories/zzprobe-verifier.test.tsx` (verifier probe) | active 2, neighbour 0 | ✓ PASS |
| Forced order, PREVIOUS neighbour last | same run, case Q2 | prev 0, active 2, next 0 | ✓ PASS |
| Owner-only clear, discriminating count | same run, case Q3 | active **2** (gesture + effect), departed neighbour 0 | ✓ PASS |
| WR-09 claim deleted | `grep -n "e2e/stories.spec.ts" StoryViewer.tsx story-viewer.test.tsx` | no match (exit 1) | ✓ PASS |

### Gate Re-run (all seven, by this verifier, after the probes were deleted)

| # | Command | Result |
| --- | --- | --- |
| 1 | `pnpm lint` | exit 0 — 9/9 tasks; `check-ui-literals: OK` |
| 2 | `pnpm turbo typecheck --force` | exit 0 — 10/10, **0 cached** |
| 3 | `pnpm --filter @tria/web test` | exit 0 — 15 files, **128 passed** |
| 4 | `pnpm --filter @tria/module-stories test` | exit 0 — 9 files, **89 passed** |
| 5 | `pnpm --filter @tria/api test` | exit 0 — 3 files, **16 passed** |
| 6 | `pnpm --filter @tria/api test:integration` | exit 0 — 29 files, **480 passed** |
| 7 | `pnpm boundaries` | exit 0 — 556 files, 9 packages, no issues |

Every count matches the SUMMARY's claim exactly. The integration run also confirms the verifier's
probe left no fixture behind.

### Requirements Coverage

| Requirement | Description | Status | Evidence |
| --- | --- | --- | --- |
| COMM-01 | `admin_tenant` can create, edit and archive communities (name, description, cover image) | ✓ SATISFIED **for this task's scope** (the CR-01 defect) | Probe P1 + case 33. See the advisory for the form-submitted-cover sliver that the PHASE re-verification, not this task, must rule on |
| STORY-02 | full-screen viewer with progress bars, auto-advance, tap-to-navigate, hold-to-pause | ✓ SATISFIED **for this task's scope** (the CR-02 defect) | Probes Q1-Q3 + case 14. SC-3c's missing browser coverage stays open by design (WR-09 corrected the claim, not the coverage) |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| — | — | none | — | Zero `TBD` / `FIXME` / `XXX` / `TODO` / `HACK` across all nine changed files; zero `.skip(` / `.todo(` tests (`clock.skip(600)` in `story-viewer.test.tsx:245` is a manual-clock helper, not a skipped test) |

### Adversarial checks requested at dispatch

1. **Both original reproductions re-run by the verifier, not the new tests** — done, with independent
   probes; both now answer the fixed way. ✓
2. **The CR-01 self-heal judged on its own merits** — bounded (one `updated_at` move, one
   `community.updated`, next identical PATCH inert, observed in the probe's own server logs); it can
   only ever NULL, never write an id (probe P4 proved a hand-written foreign stored id heals to null
   and is not laundered into the response); and it is unreachable from any path but the admin
   `PATCH /v1/communities/{id}` route — `grep` finds no service, job or seed caller of
   `updateCommunity`. The media sweeper only purges `pending` / `deleted` / `rejected` rows, so the
   heal cannot fire against an asset that is merely transcoding. ✓
3. **Anti-oracle property survived** — strengthened, not weakened: probe P2 collapsed four different
   refusal causes into one byte-identical body with no `details`; `isolation.test.ts` b5 still green.
   The new `coverIsUsable` branch returns a boolean that never reaches the response and runs in the
   tenant lane. ✓
4. **`changedContent` inertness did not regress** — probe P3: identical cover inert, identical name
   inert, real cover change registers, `post_count` / `last_activity_at` never move. ✓
5. **`onPlayRef` stability** — `bindPlay` is `useCallback([], …)`; `storyId` is a plain string; no
   consumer passes an inline callback; no loop observed. Owner-only delete confirmed behaviorally by
   probe Q3's exact call count, not just by reading the `delete` statement. ✓

### Human Verification Required

None for this quick task. (SC-3c's browser-level hit-testing check and the pt-BR cover-refusal copy
remain open HUMAN items in `05-VERIFICATION.md`; this task deliberately did not claim them and the
comment blocks now say so honestly.)

### Gaps Summary

No gaps. Both defects the Phase 5 verifier reproduced RED were re-reproduced by this verifier
through independent probes and both now answer the fixed way; the three regression guards the fix
could plausibly have broken (the anti-oracle equality, the no-op-PATCH inertness contract, and the
`StoryVideo` render-site fan-out) were each checked directly and all hold. One advisory is recorded
for the phase re-verification to weigh: the admin FORM always submits `coverAssetId`, so a rename of
a community whose cover was retired is still refused — with the actionable `cover_invalid` copy, and
identically to the pre-fix behaviour, so this fix neither caused nor closed it.

---

_Verified: 2026-09-24T15:25:07Z_
_Verifier: Claude (gsd-verifier)_
