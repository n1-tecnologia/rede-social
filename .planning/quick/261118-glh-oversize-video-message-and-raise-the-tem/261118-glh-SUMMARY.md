---
phase: quick-261118-glh
plan: 01
subsystem: media
tags: [temporary, media, video, feed, upload-window, pick-time-gate, quick]
status: complete
requires: [quick-261117-d1o]
provides:
  - pick-time refusal of a non-image 'size' verdict with the shared too-large sentence
  - TEMPORARY post video cap of 8 GiB and 9000 s
  - Mux direct-upload window of 3 h, pinned against the 24 h sweeper window
key-files:
  modified:
    - apps/web/components/media/useSignedUpload.ts
    - apps/web/components/media/useSignedUpload.test.tsx
    - packages/contracts/src/media.ts
    - packages/contracts/tests/media.test.ts
    - apps/web/components/media/VideoUploadField.tsx
    - packages/core/server/media/video/types.ts
    - packages/core/server/media/limits.ts
    - packages/core/tests/media-video-mux.test.ts
    - apps/api/tests/integration/media-sweeper.test.ts
decisions:
  - Only the image kind enters the photo re-encode; a video or a file over its table cap is refused at pick time.
  - 8 GiB post cap is TEMPORARY and UNVERIFIED against Mux.
  - VIDEO_UPLOAD_TTL_S is 3 h (10800 s); MEDIA_PENDING_TTL_MS (24 h) is untouched.
commits: 3
plan_head_before: 67a0cc85198fc87866c1cdb23667521a980f3660
actuals:
  tokens: 30000
  tasks: 3
  commits: 3
duration: about 15 min
completed: 2026-11-18
---

# Quick 261118-glh: oversize video message and the TEMPORARY 8 GiB / 3 h raise

One-liner: a video or file over its cap is now refused at pick time with "Arquivo muito grande. O limite é N MB." instead of the photo-prepare sentence, the post video cap is TEMPORARILY 8 GiB / 9000 s, and the Mux direct-upload window is 3 h, with the 24 h sweeper window pinned above it.

## Commits (3, all on master, none pushed, no trailer)

| Task | SHA | Message |
|------|-----|---------|
| 1 | a1bf74e9 | fix(web): refuse an oversize video or file at pick time instead of sending it to the photo re-encode |
| 2 | fceb5b69 | feat(quick-261118-glh): temporarily allow an 8 GiB feed post video |
| 3 | 82894cd4 | feat(quick-261118-glh): widen the video direct-upload window to 3 h and pin it against the sweeper |

`git log -4 --format=%B | grep -ci "co-authored\|generated with"` prints 0. No fix commit was needed.

## What a person now reads for an oversize video

`messageFor('too_large')` -> catalog `media.errors.size` -> **"Arquivo muito grande. O limite é 8192 MB."** for the 8 GiB post cap (`formatMediaLimit` prints megabytes above 10 MB; a GB wording was left out of scope per the plan). For a lesson video the limit reads "4096 MB", for an attachment "50 MB". No catalog key was added. The test asserts `errors.size:${formatMediaLimit(cap)}` through the mocked translator, computed from the table.

## Task 1 (tracer): pick-time gate by kind

RED (before the hook edit), `vitest run components/media/useSignedUpload.test.tsx`: **3 failed | 9 passed (12)**. G1 (post video), G2 (lesson video) and G3 (PDF attachment) failed with `expected 'errors.generic' to be 'errors.size:4096 MB'` (and `...:50 MB` for G3); the six older cases plus the three guards G4 (video at the cap goes to start), G5 (image over cap re-encoded once with `{ maxBytes: cap }`), G6 (HEIC re-encoded once) passed.

GREEN: new file **12 passed (12)**; `components/media`: **11 files, 174 tests passed**.

Fix: in `pick`, after the member-cap check and before `busy.current = true`, `if (verdict === 'size' && kind !== 'image') return fail(messageFor('too_large'));` and the re-encode branch comment reworded. `pick` stays try plus catch only. HEIC is unchanged for every kind.

Caller grep: `normaliseImage(` is called only by `useSignedUpload.ts` in product code (definition in `lib/upload.ts`); `lib/app-icon-image.ts` references `normaliseImage` as an image-only icon source and was not touched; `classifyMediaFile` has a single product caller, `useSignedUpload.ts`. Nothing else routes a non-image through a re-encode. Branding pickers use `classifyFile` (image-only).

Side effect (reported, per plan): an attachment (kind file) whose mime is an image and that is over 50 MiB used to be rescued by the photo re-encode and is now refused with the 50 MB sentence. An oversize PDF attachment now also reads the size sentence instead of the wrong photo-prepare one.

## Task 2: 8 GiB post cap (TEMPORARY)

RED: `vitest run tests/media.test.ts` in contracts: **1 failed | 21 passed (22)** (explicit pin: expected 8589934592, received 4294967296). GREEN: contracts whole package **20 files, 622 tests passed**; `tsc --noEmit` exit 0; module-social **7 files, 67 tests**; web `lib/social-limits.test.ts` + `SocialLimitsSheet.test.tsx` **2 files, 42 tests**.

Checks: `grep -c "8 \* 1024 \* 1024 \* 1024" packages/contracts/src/media.ts` prints 1; TEMPORARY comment names 8 GiB / 9000 s, the first raise (261117-d1o, 4 GiB), this one, the original 500 MiB and 300 s, the revert recipe and the D-474 clause; `grep -c "500 MiB / 5 min" VideoUploadField.tsx` prints 0. Pin sweep over the six derived files printed nothing; in `apps/api/tests/integration/media.test.ts` the only hits are the lesson case P24/P46 (4 GiB lesson, stays). Story (500 MiB, 60 s) and lesson (4 GiB, 4 h) did not move.

**The 8 GiB cap is UNVERIFIED against Mux.** Mux documents a 12 h maximum duration per asset and the direct-upload timeout range 60 to 604800 s, but no file-size cap could be confirmed. A Mux refusal would show as a failed upload. A real 7 GB upload is Igor's check.

Accepted side effect (D-474): the member-video range a super_admin may set in the platform social form widens to 1..8192 MB and 1..9000 s; defaults (60 s, 100 MiB) and every saved tenant value are unchanged.

## Task 3: 3 h upload window

RED: `vitest run tests/media-video-mux.test.ts` in core: **1 failed | 11 passed (12)** (W1: expected 10800, received 3600). GREEN: media-video-mux + media-video + media: **3 files, 71 tests passed**. `tsc --noEmit` exit 0 for core and for api.

`VIDEO_UPLOAD_TTL_S = 3 * 60 * 60` in `video/types.ts` (positive gate: one match; negative gate `grep -rn "3600" packages/core/server/media/video` prints nothing). Docblocks in `types.ts` and on `MEDIA_PENDING_TTL_MS` in `limits.ts` updated; `mux.ts` and `video/index.ts` needed no edit.

### Every consumer of the one-hour idea checked (step 5)

- `grep -rn VIDEO_UPLOAD_TTL_S apps packages docs`: only `types.ts` (definition), `video/index.ts` (re-export), `video/mux.ts` line 97 (`timeout: VIDEO_UPLOAD_TTL_S`, the ONLY consumer), `limits.ts` (docblock) and the new tests. No doc and no SQL pins it.
- The fake provider (`video/fake.ts`) never reads the constant: its target is a Supabase signed upload URL with Supabase's own fixed life, non-production only. Left unchanged.
- Sweeper: `MEDIA_PENDING_TTL_MS` is a TypeScript constant (24 h) in the Drizzle predicate of `sweep-job.ts`; the reconcile pass only asks the provider about pending/processing videos older than five minutes and applies nothing for `waiting`. Unit pin W3: 3 h < 24 h. Integration case S4 proves a pending video as old as the window survives a sweep.
- SQL: `grep -rniE "interval '(1 hour|60 minutes)'|make_interval\(hours => 1\)" supabase/migrations supabase/central/migrations` hits only event check-in/ticket guards (`now() < v_starts - interval '1 hour'`), none about media_assets or video. **No SQL function holds a one-hour literal for pending video assets: no blocker, no SQL written.**
- Other media literals: `3600`/"one hour" in `packages/core/server/media` and `apps/web/components/media` are the signed-read TTL (`MEDIA_SIGNED_READ_TTL_S`), the Storage cache-control, the deleted/rejected asset window (1 h) and the docblock I wrote; none concerns a pending video upload.
- `docs/DEPLOY.md` `grep -nE "upload window|timed_out|1 hour"`: only line 3112 (orphan-route margin on `platform.video_asset_routes`, route creation, not the upload window). Not edited.

## Gate table

CI env (public local-test values) set for every run. Disk at start 18 GiB free (`df -g /`), 15 to 17 GiB during the gates; Docker answered (`docker info`), local stack up (10 supabase containers), no `next dev` running; caches `.turbo/cache`, `apps/web/.next/cache`, `apps/web/.next/dev` removed before and after the build. Load average was 10.5 at the lint step (another project on the machine); no flake appeared.

| Gate | Result |
|------|--------|
| `pnpm lint` (whole repo) | exit 0 (Biome: only 3 pre-existing infos in web; 20/20 tasks; check-ui-literals OK) |
| `pnpm turbo typecheck build test --concurrency=4` | exit 0, 41/41 tasks, 0 cached; web 416 files / 10028 tests, core 116 / 1858, contracts 20 / 622, api (unit) 11 / 136, module-feed 345, chat 288, courses 373, dashboard 506, store 169, events 217, stories 217, payments 122, reels 152, communities 87, social 67, notifications 188, ui 306, profile-form 3, reuse-fixture 3. The known EventsSections flake did not trip |
| `pnpm check:static-routes` | exit 0 |
| `pnpm boundaries` | exit 0 |
| `pnpm boundaries:negative` | exit 0 |
| `pnpm guard:lanes` | exit 0 |
| `pnpm guard:hooks` | exit 0 |
| `pnpm guard:workflows` | exit 0 |
| integration `media-sweeper.test.ts` (includes new S4) | RUN: 1 file, 16 passed |
| integration `media.test.ts` | RUN: 1 file, 43 passed |
| integration `social-media.test.ts` | RUN: 1 file, 49 passed |
| integration `mux-webhook.test.ts` | RUN: 1 file, 27 passed |

Integration files ran one at a time against the existing local stack (Docker answered, disk over 10 GiB at that moment; no `db:reset`, no `db:seed`).

## NOT run

Playwright (any e2e), pgTAP (no SQL changed), any hosted project, the other integration files outside the four named, a real 7 GB upload to Mux. Known reds not caused by this task and not exercised: pgTAP 120/141/154/232, isolation b3/b8/phase-10 sweep, move-copy.

## Deviations from Plan

None - plan executed as written. The plan's expected `app-icon-image.ts` is an image-only icon source and was not edited. (Biome first call in Task 2 failed only because of a shell word-splitting slip in my command; rerun formatted all files with no changes.)

## Revert recipe (find with `grep -rn "261118-glh\|TEMPORARY" packages`)

1. `packages/contracts/src/media.ts`: `MEDIA_LIMITS.video.post` back to `maxBytes: 500 * 1024 * 1024` and `maxDurationSeconds: 300`, delete the TEMPORARY comment.
2. `packages/contracts/tests/media.test.ts`: flip the explicit TEMPORARY post pin to 500 MiB and 300 s (the derived case needs no edit).
3. `packages/core/server/media/video/types.ts`: `VIDEO_UPLOAD_TTL_S` back to one hour (3600) and its docblock; flip the W1 pin (10_800) in `packages/core/tests/media-video-mux.test.ts`. The pick-time fix (Task 1) is a real bug fix and stays.

## Release note

The cap and the 3 h window are API code paths (start refusal and the Mux upload timeout; the worker image rides the same workflow), so they take effect through the Deploy API gate after Igor's approval. The pick-time fix ships with the web on Vercel. Nothing was pushed or deployed.

## Known Stubs

None.

## Threat Flags

None. The 3 h direct-upload target is bound per asset and tenant (T-quick-glh-02, accepted in the plan).

## Self-Check: PASSED

- Commits a1bf74e9, fceb5b69, 82894cd4 exist in `git log`.
- All nine files of the plan were modified and committed; `git status --short` shows nothing tracked uncommitted.
- Docs artifacts (this SUMMARY, PLAN) left uncommitted for the orchestrator.
