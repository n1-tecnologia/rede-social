---
phase: 03-media-pipeline-member-profiles
fixed_at: 2026-09-22T11:05:00Z
review_path: .planning/phases/03-media-pipeline-member-profiles/03-REVIEW.md
iteration: 1
fix_scope: critical_only
findings_total: 14
findings_in_scope: 2
fixed: 2
skipped: 12
skipped_out_of_scope: 12
status: all_fixed
---

# Phase 3: Code Review Fix Report

**Fixed at:** 2026-09-22
**Source review:** `.planning/phases/03-media-pipeline-member-profiles/03-REVIEW.md`
**Iteration:** 1
**Scope:** the two `critical` findings only — the user chose "Fix CR-01 + CR-02 now" and explicitly
deferred the eight warnings and four info items.

**Summary:**

- Findings in scope: 2 (CR-01, CR-02)
- Fixed: 2
- Skipped: 12 (all out of scope by the user's decision — no finding was skipped because it could not
  be applied)

Both fixes are **mutation-verified**: for each one I reintroduced the bug, confirmed the new test
went red, then restored the fix and confirmed it went green again. Neither test passes against the
pre-fix code.

## Fixed Issues

### CR-01: `DELETE /v1/media/{assetId}` had no owner or role check

**Files modified:**
- `/Users/igorvboas/Library/Developer/TRIA/rede_social/packages/core/server/media/service.ts`
- `/Users/igorvboas/Library/Developer/TRIA/rede_social/apps/api/tests/integration/media.test.ts`

**Commit:** `d3e4d81`

**Applied fix:** `ASSET_COLUMNS` and the `AssetRow` type gain `ownerUserId` (the column already
existed on `media_assets` — this is a guard, not a schema change, and no migration was added). A new
`assertMayRetire(ctx, row)` sits next to `loadOwnAsset` and is called from `deleteAsset` immediately
after the row loads. `loadOwnAsset`'s docblock was corrected: its name is older than its predicate,
and it loads the *community's* asset, not the caller's.

**The two deliberate decisions in this fix:**

1. **Owner-OR-admin, never admin-only.** `updateOwnProfile`
   (`packages/core/server/profiles/service.ts`) calls `deleteAsset` with the **member's own** ctx for
   R-07 replace-on-write, so an admin-only gate would silently take away every member's ability to
   change their avatar. This path is covered by `profile.test.ts:331` ("replacing a photo
   soft-deletes the previous asset"), which still passes; I also added an explicit case asserting the
   community admin may retire a member's asset, so the "OR admin" half cannot be dropped by a future
   simplification either.

2. **The refusal is a bare `404 NOT_FOUND`, not a `403`.** This preserves the module's refusal
   vocabulary and does not regress the cross-tenant 404. My reasoning, as requested:
   - A caller reaching this branch is holding an id the platform *handed* them —
     `memberProfileSchema` publishes `avatarAssetId` for every member, so `GET /v1/members` is a
     directory of deletable ids. A 403 would answer "that id exists and is somebody else's", turning
     `DELETE` into an ownership oracle over the whole community.
   - A nonexistent id, another community's asset and a fellow member's asset now take the **same**
     branch with the same body and no `details`. The cross-tenant 404 stays structural (it is still
     the `!row` branch — RLS never returns the row), rather than becoming a second rule that has to
     agree with the first.
   - `listAssets` keeps its `403 FORBIDDEN` and that is not an inconsistency: it is a pure role gate
     on a *collection*, with no id in the request, so its refusal discloses nothing about any
     particular row. The distinction is now written down in the `assertMayRetire` docblock.

**Regression tests added** (`apps/api/tests/integration/media.test.ts`, new describe
`intra-tenant authorization — a fellow member is not an owner`):
- a second seeded member of `tria-demo` (`joao.goncalves@tria-demo.local`) is refused with 404, the
  envelope carries no `details`, the row survives as `ready`, and the owner then deletes it fine;
- a random uuid produces the byte-identical refusal — the two are indistinguishable;
- `admin@tria-demo.local` may retire the member's asset (200).

**Mutation check:** removing the `assertMayRetire(ctx, row);` line makes the first case fail with
`expected 200 to be 404`. The other two still pass, which is the point — only the new case pins the
guard.

**Relationship to WR-08 (left open, deliberately):** WR-08 (`completeUpload` shares this root cause)
is **not** closed. I did not widen the change to cover it: the guard is a named helper
(`assertMayRetire`) rather than an inline condition, so closing WR-08 later is a one-line call in
`completeUpload` plus its own test, but that line was **not** added. `completeUpload` is still
reachable by any member of the tenant holding a `pending` asset id.

### CR-02: profile surfaces requested `w320` that the worker never derived

**Files modified:**
- `/Users/igorvboas/Library/Developer/TRIA/rede_social/packages/core/server/media/limits.ts`
- `/Users/igorvboas/Library/Developer/TRIA/rede_social/packages/core/server/media/service.ts`
- `/Users/igorvboas/Library/Developer/TRIA/rede_social/packages/core/tests/media.test.ts`
- `/Users/igorvboas/Library/Developer/TRIA/rede_social/apps/api/tests/integration/media.test.ts`

**Commit:** `86c0b14`

**Applied fix:** I took the reviewer's **preferred** option — derive the whole ladder for the purpose
— and went one step further than the suggested patch: rather than keeping an ignored `_originalWidth`
parameter, I **removed the parameter entirely**. `widthsForPurpose(purpose)` is now a pure function of
the purpose, so the source-size dependency cannot be reintroduced by accident; a future caller that
tries to pass a width does not compile. The `deriveAssetVariants` call site still probes the original
(it records `width`/`height` on the row) but no longer feeds that into the ladder.

**Why this option and not the contract change:** the four React call sites (`ProfileHeader`,
`AvatarUploadField`, `MemberRow`, `ProfileNudgeCard`) *and* `avatarSrcSet` in
`packages/contracts/src/profiles.ts` all render the static `PURPOSE_WIDTHS.avatar`. Making the derived
ladder equal to that constant by construction fixes all five at once with **zero** front-end or
contract edits — `memberProfileSchema`'s `.strict()` shape (D-45) is untouched and
`packages/contracts/src/index.ts` is byte-identical. The alternative (`avatarWidths: number[]` on both
profile schemas, threaded through `MediaImage` and `avatarSrcSet`) would have changed a frozen contract
and five call sites to reach the same rendered `srcset`. It also makes `MediaImage`'s own prop doc
("the variant ladder the payload declares — never a hand-written width list") true again in the only
way a payload carrying just an `assetId` can make it true.

**The cost, stated plainly:** an original smaller than a rung now produces a duplicate. A 200 px
avatar writes `w128.webp` (a real downscale) and `w320.webp` (a 200 px file, because
`deriveVariants` already resizes with `withoutEnlargement`). The `320w` descriptor therefore slightly
overstates what it delivers — the browser at DPR 2 picks it for an 80 px box and gets a 200 px image,
which is the sharpest thing that exists. That is a few kilobytes against a member's photo vanishing.

**Tests changed and added:**
- `packages/core/tests/media.test.ts` — the test that *pinned the clamp* is replaced. It now asserts
  the ladder equals `PURPOSE_WIDTHS[purpose]` for avatar/post/cover, that `attachment` stays empty,
  that the returned array is a fresh copy (a caller cannot mutate the shared contract table), and a
  second case asserts every non-attachment purpose derives at least one rung. Changing this test was
  unavoidable — it existed specifically to pin the behaviour the review identified as wrong.
- `apps/api/tests/integration/media.test.ts` — a new 200x200 JPEG fixture and a describe
  (`the derived ladder is a function of the PURPOSE, not of the source size`) that uploads it through
  the real broker, runs the derive job, and asserts the payload advertises both rungs, that
  `GET /v1/media/{id}/w320` answers **302** (this is the 404 that erased the photo) with a 200 px
  WebP, and that `w128` is still a genuine 128 px downscale.

**Mutation check:** restoring the clamp (`.filter((w) => w <= probed.width)` at the call site) makes
the new integration case fail with `expected [ { width: 128 } ] to deeply equal [ { width: 128 }, … ]`.

## Skipped Issues

All twelve were skipped for exactly one reason: **out of scope for this pass.** None was attempted,
none failed, and none was rolled back. The user was asked and chose "Fix CR-01 + CR-02 now"; the
review text for each of these is unmodified and still actionable.

| ID | Title | Reason |
|----|-------|--------|
| WR-01 | memo (50 min) + redirect `max-age` (25 min) can exceed the 60-min signed URL | out of scope (user deferred) |
| WR-02 | an oversized video is run through the browser's *image* re-encoder | out of scope (user deferred) |
| WR-03 | the tenant byte ceiling is charged from client-declared `pending` bytes | out of scope (user deferred) |
| WR-04 | a `video.asset.ready` with no playback id flips the asset to `ready` | out of scope (user deferred) |
| WR-05 | an unvalidated `assetId` reaches a uuid comparison and kills the fallback | out of scope (user deferred) |
| WR-06 | the sweeper batch is oldest-first, so poison rows starve newer ones | out of scope (user deferred) |
| WR-07 | side effects inside a `setItems` updater swallow the "Vídeo pronto" announcement | out of scope (user deferred) |
| WR-08 | `completeUpload` can be driven by any member of the tenant | out of scope (user deferred) — **shares CR-01's root cause and is still open**; see the note under CR-01 |
| IN-01 | the Mux webhook's 403 breaks the D-09 error envelope | out of scope (user deferred) |
| IN-02 | `media_provider_events` grows without bound | out of scope (user deferred) |
| IN-03 | `member_profiles.display_name` can be the empty string | out of scope (user deferred) |
| IN-04 | the signed-read memo is per-process, so a purged object survives ~50 min | out of scope (user deferred) |

## Verification

**Where these ran:** the **main working tree** on branch `master`, against the live local Supabase
stack (`supabase start` containers up). Sequential mode, no worktree — so every number below is
reproducible from the tree as it stands. Hooks were on; nothing used `--no-verify`.

| Gate | Command | Result |
|------|---------|--------|
| Lint | `pnpm lint` | **PASS** — 7 packages, 463 files, no fixes applied; `check-ui-literals` OK |
| Typecheck | `pnpm typecheck` | **PASS** — 8 tasks |
| Unit tests | `pnpm test` | **PASS** — 386 tests across contracts (57), ui (42), core (190), api (15), web (82) |
| API integration | `pnpm test:integration` | **PASS** — 22 files, **317 tests** |
| pgTAP / RLS | `pnpm supabase test db` | **PASS** — 9 files, 128 tests |
| Module boundaries | `pnpm boundaries` + `:negative` | **PASS** — 417 files, 7 packages; both layers still reject the fixture |
| Lane guard | `pnpm guard:lanes` | **PASS** — no non-LOCAL role switch or session-scoped claims |
| E2E (media + profile) | `playwright test profile.spec.ts media-upload.spec.ts` | **PASS** — 26 tests, incl. *"a photo renders from /v1/media in the derived widths"* and *"a photo that cannot be fetched degrades to the neutral icon"* |

**Baseline for comparison:** before any edit, `media.test.ts` + `profile.test.ts` +
`isolation.test.ts` were 63/63 green. After both fixes the same three files are 66/66 (the three new
CR-01 cases), and `media.test.ts` alone is 32/32 (adding the CR-02 case). No test that passed before
fails now, and no pre-existing failure was inherited or masked.

**Not run:** the full `pnpm verify` chain (the PWA e2e config and the Supavisor spike were not
exercised) and the remaining e2e specs beyond the two most relevant ones. Nothing in either fix
touches the service worker, the pooler, or the video/branding e2e paths.

## What a human should still look at

1. **CR-02 is a behaviour change with a storage tradeoff**, not just a bug fix. Deriving every rung
   means an original smaller than a rung produces near-duplicate objects. I judged that correct (the
   alternative loses a member's photo, and the pilot's ceiling is 800 MB per tenant against a few KB
   per duplicate), but it is a product call worth a nod rather than something a test can settle.
2. **The `320w` descriptor now slightly overstates** what a small avatar delivers. The browser's
   candidate selection is still correct — it picks the sharpest file that exists — but if that ever
   matters, the honest fix is the contract change (`avatarWidths` in the payload) the review listed as
   the alternative.
3. **WR-08 remains open** and shares CR-01's root cause. It is the obvious next fix and is now a
   one-line call to `assertMayRetire` plus a test.

---

_Fixed: 2026-09-22_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
