---
phase: 13-app-nativo-ios-e-android-por-tenant-white-label
plan: 24
subsystem: branding
tags: [native-app, branding, icons, splash, sharp, D-607, UI-D-602, tracer]

requires:
  - phase: 02-branding
    provides: "icons.ts: inspectBrandingImage, MASKABLE_SAFE_ZONE, MAX_INPUT_PIXELS, SVG_RASTER_TARGET, readPixel"
  - phase: 13-app-nativo-ios-e-android-por-tenant-white-label
    provides: "13-03 contracts tracer (the native subpath that owns deriveStoreName and deriveIconLabel)"
provides:
  - "deriveStoreIcon: 1024 opaque App Store icon and 512 Google Play icon from the tenant logo over primary"
  - "deriveSplash: primary background, logo at one third or the tenant name in onPrimary (mode logo | name)"
  - "wrapName: grapheme-safe wrapping to at most three lines with an ellipsis"
  - "deriveAdaptiveForeground: transparent 1024 with the logo in the central 66%"
  - "deriveNotificationIcon: 96 white silhouette from the logo alpha, white-disc fallback reported as quality fallback"
  - "AppAssetError (bad_color | bad_name), parseAssetColor, openLogo, fitLogo helpers, all re-exported from the branding barrel"
affects: [13-25, 13-29]

plan_head_before: c36644fa481fad478459156c9de28dce18aba8de
actuals:
  tokens: 8000
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "extend, never edit: the native pipeline re-states the private SVG-density helper of icons.ts instead of exporting it, so the PWA pipeline stays byte for byte unchanged"
    - "grapheme-cluster wrapping with Intl.Segmenter so emoji and accents are never split"
    - "decode-and-measure tests: size, alpha flag, pixel reads and bounding boxes over generated fixtures, no binary fixtures"

key-files:
  created:
    - packages/core/server/branding/app-assets.ts
    - packages/core/tests/app-assets.test.ts
  modified:
    - packages/core/server/branding/index.ts

key-decisions:
  - "The 160dp ceiling of UI-D-602 is a device size, not an asset size: the 1024 splash keeps the logo at one third of the short side inside the 80% safe zone, and the native shell (plan 25) enforces the 160dp cap when it lays the image out. The plan's phrase 'never larger than 160 of 1024' cannot be read as 160 px without contradicting the one-third rule and its own test."
  - "The Play icon is a 32-bit PNG (alpha channel present, every pixel opaque) because Play asks for 32-bit; the App Store file has no alpha channel at all."
  - "The logo mime is optional in the options: it is sniffed from the magic bytes (png, jpeg, webp, svg) and then checked by inspectBrandingImage, so a lying buffer still dies with BrandingImageError."
  - "A 5000x5000 input dies as not_an_image (the header decode itself exceeds limitInputPixels), a 5000 px side with few pixels dies as too_large; both are BrandingImageError from the existing inspector."
  - "The name is NFC-normalised before wrapping so decomposed accents compose into one grapheme."

patterns-established:
  - "Tenant text entering an SVG is XML-escaped and stripped of characters XML forbids before it is drawn."

requirements-completed: [NATIVE-02, NATIVE-06]

coverage:
  - id: D1
    description: "Tracer: the tenant logo becomes the 1024 opaque App Store icon and the 512 Play icon, measured by decoding (size, no alpha, corner and centre pixels, bounding box inside the 80% zone)"
    requirement: "NATIVE-02"
    verification:
      - kind: unit
        ref: "packages/core/tests/app-assets.test.ts#deriveStoreIcon"
        status: pass
    human_judgment: false
  - id: D2
    description: "Splash: primary background, logo at one third and centred, or the escaped tenant name in onPrimary up to three lines, with the mode reported"
    requirement: "NATIVE-06"
    verification:
      - kind: unit
        ref: "packages/core/tests/app-assets.test.ts#deriveSplash and #wrapName"
        status: pass
    human_judgment: true
    rationale: "Geometry and colours are measured; whether the name-only splash reads well in the tenant's real font (Manrope is not bundled in the build image, a system sans is used where absent) needs a look at a real release build."
  - id: D3
    description: "Android assets: adaptive foreground inside the 66% zone and the white notification silhouette with the opaque-logo fallback"
    requirement: "NATIVE-02"
    verification:
      - kind: unit
        ref: "packages/core/tests/app-assets.test.ts#deriveAdaptiveForeground and #deriveNotificationIcon"
        status: pass
    human_judgment: false
  - id: D4
    description: "T-13-28: oversized, unsafe or non-image input and markup in the display name are refused or escaped; every function is deterministic; the PWA pipeline is untouched"
    requirement: "NATIVE-02"
    verification:
      - kind: unit
        ref: "packages/core/tests/app-assets.test.ts#every asset"
        status: pass
      - kind: unit
        ref: "packages/core/tests/icons.test.ts (unchanged, 11 tests)"
        status: pass
    human_judgment: false

duration: 14min
completed: 2026-11-05
status: complete
---

# Phase 13 Plan 24: Native app assets from the tenant branding Summary

**Pure sharp functions turn the tenant logo, colours and display name into the App Store and Play icons, the splash, the Android adaptive foreground and the white notification silhouette, reusing the PWA icon pipeline's guards without touching it.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-11-05T14:13:00Z
- **Completed:** 2026-11-05T14:27:00Z
- **Tasks:** 2 (a tracer and a TDD task)
- **Files modified:** 3 (two created, one barrel line)

## Accomplishments

- `deriveStoreIcon` puts the logo inside the 80% safe zone over `primary` on a 1024 square flattened to no alpha channel (the OS rounds), and downsizes to the 512 Play file.
- `deriveSplash` gives one image for light and dark: with a logo, its larger side is one third of 1024 and centred within 2 px; without one, the escaped `displayName` is drawn in `onPrimary`, wrapped by `wrapName` to at most three lines, and the result says `logo` or `name`. A blank name is a typed error, never a platform placeholder.
- `wrapName` cuts on grapheme clusters (`Intl.Segmenter`), so a joined family emoji and a decomposed accent stay whole, breaks a word longer than the line and ends with an ellipsis when text remains.
- `deriveAdaptiveForeground` (transparent 1024, logo inside 66%) and `deriveNotificationIcon` (96 px white pixels carrying the logo alpha; a fully opaque logo gets a white disc and `quality: 'fallback'`).
- Every input passes `inspectBrandingImage` first and every decode carries `limitInputPixels`; a colour is validated with the contracts' `hexColorSchema`.

## Task Commits

1. **Task 1: [tracer] store icons** - `bc49e2b7` (feat)
2. **Task 2 RED: failing tests with inert stubs** - `52e10d86` (test)
3. **Task 2 GREEN: splash, wrapName, adaptive foreground, notification icon** - `f54f2aad` (feat)

**Plan metadata:** the docs commit that carries this summary.

Tracer gate: the tracer's automated `<verify>` (app-assets and icons tests) was re-run end to end after Task 1 and passed, so expansion proceeded.

## TDD Gate Compliance

- RED commit `52e10d86` precedes GREEN commit `f54f2aad`. No refactor commit.
- RED evidence from real Vitest output: `pnpm exec vitest run tests/app-assets.test.ts` exited 1 with 20 tests, 9 passed, 11 failed on assertions (for example "expected [ 1, 1, true ] to deeply equal [ 1024, 1024, false ]" for the target test `deriveSplash ... centres the logo within one third of the short side and the 80 % safe zone`). The Vitest JSON report was normalised to TAP by a throwaway script in the scratchpad (outside the repo, real names and real counts) and `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK / target_test_failed`.
- The RED commit carries deliberately inert stubs (valid 1x1 PNG, empty wrap) so the tests fail on assertions and not on a missing export. The 9 passing RED tests are the Task 1 tests plus the blank-name and determinism guards that hold for a constant stub.
- GREEN: the same file passes 20 of 20; `icons.test.ts` passes unchanged.

## Verification

- `pnpm --filter @rede-social/core exec vitest run tests/app-assets.test.ts tests/icons.test.ts`: 2 files, 31 tests passed (Task 1 run) and 20 of 20 for `app-assets.test.ts` after Task 2.
- Core typecheck: `tsc --noEmit` and `tsc --noEmit -p ui/tsconfig.json` clean (run directly in `packages/core`, not through turbo, to leave no cache on a tight disk).
- Acceptance: `git diff --stat -- packages/core/server/branding/icons.ts` prints nothing; `grep -c limitInputPixels app-assets.ts` is 7; `grep -c escape app-assets.ts` is 3; the test feeding `Marca & <Co> "Teste"` renders without throwing.
- Full core suite: 1398 of 1399 pass; the one failure is not from this plan (see Issues).
- A rendered name splash was viewed once as a PNG in the scratchpad (three centred lines, ellipsis on the third); the file lives outside the repo.

## Files Created/Modified

- `packages/core/server/branding/app-assets.ts` - the five derivations, `wrapName`, helpers, `AppAssetError`
- `packages/core/tests/app-assets.test.ts` - decode-and-measure proofs, fixtures generated with sharp
- `packages/core/server/branding/index.ts` - re-export of `./app-assets`

## Decisions Made

See `key-decisions` above. The reading of "160dp" is the one that matters for plan 25: the shell, not this module, applies the device-size ceiling.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's 5000x5000 refusal reason**
- **Found during:** Task 1
- **Issue:** The plan says a 5000x5000 input is refused by `inspectBrandingImage` before decoding; the existing inspector refuses it with `not_an_image` (25 M pixels exceeds `limitInputPixels` in the header decode), and `too_large` only fires for a long thin image.
- **Fix:** The test asserts a `BrandingImageError` for the 5000x5000 bomb and `too_large` for a 5000x10 image. No change to `icons.ts`.
- **Files modified:** `packages/core/tests/app-assets.test.ts`
- **Commit:** `bc49e2b7`

**2. [Rule 3 - Blocking] The SVG-density helper of icons.ts is private**
- **Found during:** Task 1
- **Issue:** Reusing `basePipeline` would have needed an export, which edits `icons.ts` and breaks the "diff over icons.ts is empty" criterion.
- **Fix:** `openLogo` re-states those ten lines and imports the public constants (`MASKABLE_SAFE_ZONE`, `MAX_INPUT_PIXELS`, `SVG_RASTER_TARGET`). The only duplicated private value is the 2400 density ceiling.
- **Files modified:** `packages/core/server/branding/app-assets.ts`
- **Commit:** `bc49e2b7`

**3. [Rule 1 - Bug] Two of my own RED tests were wrong**
- **Found during:** Task 2 GREEN
- **Issue:** `Comunidade Alfa` is 15 characters, over the 14-character line, so it correctly wraps to two lines; and NFC normalisation correctly composes a decomposed `c` + cedilla + `a` + tilde.
- **Fix:** The tests now use a 14-character name for the one-line case (plus the two-line case for 15) and assert whole graphemes with no line starting on a combining mark.
- **Files modified:** `packages/core/tests/app-assets.test.ts`
- **Commit:** `f54f2aad`

---

**Total deviations:** 3 auto-fixed (2 bugs in test or plan text, 1 blocking reuse constraint)
**Impact on plan:** none on scope or the public surface.

## Issues Encountered

- `packages/core/tests/tenant-set-no-platform.test.ts` fails on `supabase/migrations/20261105141336_push_devices.sql` (plan 13-06): the guard's `"platform"` regex matches the new column `"push_subscriptions"."platform"`. A false positive from another plan, out of scope here; logged in `.planning/phases/13-app-nativo-ios-e-android-por-tenant-white-label/deferred-items.md`.
- Manrope is not bundled for the build host: in this environment the name splash fell back to the system sans. The asset geometry is unaffected; a real release build should confirm the look (plan 29).

## Known Stubs

None. (The RED-phase inert stubs were fully replaced in the GREEN commit.)

## Threat Flags

None beyond the plan's register. T-13-28 (decompression bomb, unsafe SVG, markup in the display name) is mitigated: `inspectBrandingImage` first, `limitInputPixels` on every decode, the display name XML-escaped and stripped of forbidden characters, each proven by a test.

## User Setup Required

None.

## Next Phase Readiness

- Plan 29 (the release script) can call `deriveStoreIcon`, `deriveSplash`, `deriveAdaptiveForeground` and `deriveNotificationIcon` with the logo buffer and the tenant colours; the adaptive icon's background layer is the plain `primary` colour the script writes.
- Plan 25 (native screens) must apply the 160dp ceiling for the splash logo on large screens.
- Nothing pushed, nothing touched on a hosted project.

---
*Phase: 13-app-nativo-ios-e-android-por-tenant-white-label*
*Completed: 2026-11-05*

## Self-Check: PASSED

- Files exist: `app-assets.ts`, `app-assets.test.ts` (checked with `[ -f ]`).
- Commits found: `bc49e2b7`, `52e10d86`, `f54f2aad`.
