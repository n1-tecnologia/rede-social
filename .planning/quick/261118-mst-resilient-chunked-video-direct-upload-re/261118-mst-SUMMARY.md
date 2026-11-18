---
phase: quick-261118-mst
plan: 01
subsystem: media
tags: [media, video, upload, resilience, mux, quick]
status: complete
requires: []
provides:
  - "uploadChunked: in-repo resumable uploader for the provider's direct-upload URL (retry with backoff, status query, fresh slice per attempt, offline pause, stall watchdog, wake lock)"
affects: [apps/web/lib/upload.ts, apps/web/components/media/useSignedUpload.ts, apps/web/app/(app)/suporte/voice-deps.ts]
tech-stack:
  added: []
  removed: ["@mux/upchunk 3.5.0"]
key-files:
  created: []
  modified:
    - apps/web/lib/upload.ts
    - apps/web/lib/upload.test.ts
    - apps/web/package.json
    - pnpm-lock.yaml
    - apps/web/components/media/VideoUploadField.tsx
    - apps/web/app/(app)/cursos/lesson-actions.ts
    - apps/web/lib/csp.ts
    - apps/web/e2e/courses-admin.spec.ts
    - apps/web/e2e/fixtures/README.md
decisions:
  - "A 308 with a readable Range sets the committed offset (trusted, behind or ahead); a 308 with no readable Range advances by the chunk sent on a data chunk and keeps the last known offset on a status query"
  - "A stall watchdog (CHUNKED_STALL_MS 120 s) and a no-progress guard were added beyond the brief"
commits: 3
plan_head_before: 12916534c75eaab3049b18968ae9a20e7eaff49a
actuals:
  tokens: 14500
  tasks: 3
  commits: 3
duration: about 1 h
completed: 2026-11-18
---

# Quick 261118-mst: Resilient chunked video direct upload

An in-repo resumable uploader replaces the third-party chunk-upload library behind the unchanged `uploadChunked(uploadUrl, file, opts)` signature: it retries with backoff, asks the server how much it persisted, re-slices the file for every attempt, pauses offline and keeps the screen awake.

## What is known and what is not (read this first)

- **The `net::ERR_BLOB_REFERENCED_BLOB_BROKEN` trigger is UNKNOWN and was NOT reproduced.** A 6 GiB sparse file uploads fine at loopback with the old library and with plain `file.slice`. The cause on the real member's machine could be sleep or hibernate, a network change over hours, a cloud-synced or external drive, the file changing on disk, or memory. Nothing here claims a root cause for it; the uploader instead re-slices per attempt, retries and resumes, so a broken read costs one chunk and a retry rather than the whole upload.
- What WAS reproduced (by the orchestrator, restated here in the same harness): the old library stops at once on any network-level failure (status 0) and gives a 5xx only 5 retries one second apart (about 5 s), and it never asks the server how much was persisted.
- **UNVERIFIED against a real Mux upload URL (Igor's check on the first real large upload):**
  1. The status query (an empty PUT with `Content-Range: bytes */total`) was never run against real Mux. The old library only ever read the `Range` of a 308 chunk answer. The uploader degrades safely: any answer other than a 2xx or a 308 makes it resend from the last known offset (a truly expired session then answers the resend with a fatal 4xx).
  2. Whether Mux exposes the `Range` response header to the browser through CORS (`Access-Control-Expose-Headers`) is unknown. That is why a 308 with no readable `Range` on a data chunk advances by the chunk just sent (what the old library did), and on a status query keeps the last known offset. A readable `Range` on any 308 is trusted.
  3. A 2xx to the status query is trusted as "already complete". Against an endpoint that is not a resumable session (the fake provider's Supabase signed upload URL, non-production only) an empty-body PUT could create a zero-byte object and look like success. Against real Mux the behaviour is the first real large upload's check.
- Two additions beyond the brief, both pinned by tests: the stall watchdog `CHUNKED_STALL_MS` (120 s without upload progress aborts the request and retries it as status 0, for a half-open connection after sleep) and a no-progress guard (a 308 that does not move the committed offset past its value before the attempt counts as a failed attempt, so a server repeating the same Range cannot spin).

## What changed

Commits (single-repo, path-scoped, identity igor.vboas, no trailer; base `12916534`):

| Commit | Content |
| ------ | ------- |
| `e6b09771` | `apps/web/lib/upload.ts`, `apps/web/lib/upload.test.ts`: the uploader and its tests |
| `eee1325b` | `apps/web/package.json`, `pnpm-lock.yaml`: the dependency removed |
| `a9160ccf` | wording only in `VideoUploadField.tsx`, `lesson-actions.ts`, `csp.ts`, `courses-admin.spec.ts`, `e2e/fixtures/README.md` |

The uploader (all in `apps/web/lib/upload.ts`, `uploadBytes`, `useSignedUpload.ts` and `voice-deps.ts` untouched):

- Exported constants: `CHUNKED_CHUNK_BYTES` 32 MiB (a multiple of 256 KiB, only the last chunk smaller), `CHUNKED_BACKOFF_MS` 1, 2, 4, 8, 16, 30 s, `CHUNKED_MAX_FAILURES` 12, `CHUNKED_STALL_MS` 120 s.
- Each attempt builds a FRESH `file.slice(start, end)`; the Blob is never kept; the file is never copied into memory.
- Each request is an XHR PUT with exactly two request headers (`Content-Type`, `Content-Range`), so the Mux CORS preflight is the same set as before.
- Retry for status 0 (network, timeout, stall), 408, 429 and every 5xx; before re-sending it asks `bytes */total`. Every other 4xx is fatal at once; 413 is `too_large`. 12 consecutive failures with no new committed byte end as `transfer`; a newly committed byte resets the counter.
- Offline: pauses without counting an attempt, continues on `online`. Abort stops the XHR and clears every timer and listener. Progress is a monotonic integer percent, 100 only at success.
- The one console line is `media.chunked_failed` with a short reason (`status N; committed=x/total; attempts=n`), never the URL, a header or the file name (T-mst-01, pinned by a test).
- Screen Wake Lock helper kept (about 40 lines, every call feature-detected and guarded, re-requested on `visibilitychange`, released on settle).
- Dependency: `@mux/upchunk` removed. `pnpm remove --offline` is not an option of pnpm 12.4.1 for `remove`, so I ran `npm_config_offline=true pnpm remove @mux/upchunk --filter @rede-social/web --lockfile-only`. It reordered the `package.json` dependency keys, so I restored that file and deleted the single line by hand; the lockfile diff is 63 deletions and 0 insertions (the importer entry, the package, its snapshot and the transitive entries `dom-walk`, `event-target-shim`, `global`, `is-function`, `min-document`, `parse-headers`, `xhr`). `pnpm install --frozen-lockfile --offline --lockfile-only` confirms the lockfile matches. Note: `pnpm-lock.yaml` sits under the Deploy API workflow's path filter, so pushing it triggers that workflow; nothing was pushed from here.
- Wording: every comment that named the old library or "5 MiB slices" now describes the new uploader. No catalog key, copy, UI, ETA, API, package or Mux provider change; `VIDEO_UPLOAD_TTL_S` stays 3 h.

## Tests (real numbers)

- Red first (before the uploader existed, `vitest run lib/upload.test.ts --testTimeout 2000`): **39 failed, 21 passed (60)**; the 21 are the 20 existing cases plus the one new case that already passes against the old code (an already-aborted signal resolves at once). Vitest emits no TAP, so no TAP evidence was produced and none was fabricated.
- Green after the uploader: **60 passed (60)** in `lib/upload.test.ts` (20 existing + 40 new: B01-B21 with the `it.each` expansions). `lib/upload.test.ts` plus `components/media`: 12 files, 234 tests passed.
- CI static sequence (CI env set, `TURBO_CACHE=local:r`):
  - `biome format --write` on the touched files: no change. `biome check` on upload.ts and upload.test.ts: clean.
  - `pnpm lint`: exit 0 (3 pre-existing Biome infos, check-ui-literals OK, dashboard fixtures OK).
  - `pnpm turbo typecheck build test --concurrency=4`: 38 of 40 tasks succeeded; typecheck green everywhere; the only failure was the known web `EventsSections.test.tsx` flake under load (1 test of 10068 in `apps/web`, test files 415 passed, 1 failed), which cancelled the web build in the same run. **Re-run alone, `EventsSections.test.tsx` passes (18 of 18)**, and `pnpm turbo build --concurrency=4` re-run alone is green (exit 0).
  - `pnpm check:static-routes`, `boundaries`, `boundaries:negative`, `guard:lanes`, `guard:hooks`, `guard:workflows`: all exit 0.
  - Heavy caches (`.turbo/cache`, `apps/web/.next/cache`, `apps/web/.next/dev`) removed afterwards; free disk is 13.5 GiB afterwards after the cleanup (15.6 GiB at the start; the remaining difference was not investigated), and no new large scratch file was created (the existing sparse files were reused).
- Not run (per the orchestrator): the full Playwright e2e, the integration suites, pgTAP, any hosted project. The e2e case that goes through `uploadChunked` under `VIDEO_PROVIDER=fake` (courses-admin) was NOT run, so the fake provider's signed Storage URL with the new two-header PUT and the status-query branch is not exercised end to end.

## Real-browser check (scratch, not committed, headless Chromium, 6 GiB sparse file, local protocol mock)

The REAL `apps/web/lib/upload.ts` was bundled with esbuild and driven by Playwright; the mock server gained a status-query branch (308 plus `Range`, or 308 without it). Scratch harness: `/private/tmp/claude-501/-Users-igorvboas-Library-Developer-TRIA-rede-social/55c5e100-0fe6-4038-9083-1323a9357057/scratchpad/blobrepro` (`run-real.mjs`, `server2.mjs`, `run-old.mjs`).

| Run | Verdict | Seconds | Received | Data requests | Status queries |
| --- | ------- | ------- | -------- | ------------- | -------------- |
| New uploader, no faults | done | 12 | 6.00 GiB | 192 | 0 |
| New uploader, `FAIL_AT=20 FAIL_N=8 FAIL_MODE=drop` | done | 28 | 6.00 GiB | 197 | 4 (3 of them hit the fault window) |
| New uploader, `FAIL_AT=20 FAIL_N=8 FAIL_MODE=503` | done | 28 | 6.00 GiB | 196 | 4 (3 or more hit the fault window; 200 PUTs in total) |
| Old library, same drop fault | stopped: "Server responded with 0. Stopping upload." | 2 | 0.09 GiB | 21 requests | none |
| Old library, same 503 fault | stopped: "Server responded with 503. Stopping upload." | 6 | 0.09 GiB | 24 requests | none |

Notes: the fault window consumes eight consecutive PUTs of any kind, so some status queries are themselves faulted (treated as inconclusive, then resent from the last offset). A first pair of runs counted only the queries that reached the handler (1 and 0) and was re-run with the fixed counter; the table is the re-run. The old-library rows only restate the orchestrator's reproduction. This is a loopback mock: it proves the protocol loop, not Mux.

## Deviations from Plan

- **[Rule 3 - Blocking] `pnpm remove ... --offline` is not an option in pnpm 12.4.1** (`Unknown option: 'offline'`). Used `--lockfile-only` with `npm_config_offline=true` instead (no network needed, lockfile diff reviewed, 0 insertions). pnpm also re-sorted the `package.json` dependency keys; I reverted that and removed only the one line. Commit `eee1325b`.
- **[Rule 3 - Blocking] The old library vanished from the repo's `node_modules/.pnpm`** after the removal, so the contrast runs loaded it from the pnpm store path through a scratch copy of the harness (`server-old.mjs`). The scratch originals were not edited.
- **[Test hygiene]** The fake XHR step field is named `effect`, not `then`, because Biome's `noThenProperty` rejects a thenable; assertions read the logged reason through a small helper because of Biome's `noUnsafeOptionalChaining`. Test-only.
- The plan's guard that a `308` claiming the whole file with no 2xx is treated as a failed attempt is implemented at the top of the loop (`committed >= total`), counted against the budget.

## Known Stubs

None.

## Threat Flags

None. The uploader adds no new host, header or endpoint; the CSP `connect-src` is unchanged (comment wording only). T-mst-01 (log hygiene) and T-mst-02 (bounded retry, stall watchdog, no-progress guard) are pinned by tests B09, B14-B18.

## Open for Igor

- The first real large upload to Mux is the check for: the status query, `Range` exposure through CORS, and a 2xx status answer. Watch the browser console for `media.chunked_failed` and its short reason.
- Bandwidth is the speed limit, and this change does not alter it: 7.2 GB at 20 Mbps is about 50 minutes; at 5 Mbps it is about 3.2 hours, which is beyond the 3 hour Mux upload window (`VIDEO_UPLOAD_TTL_S`, unchanged). Only fewer sequential round trips from the larger chunks were in scope.
- The `ERR_BLOB_REFERENCED_BLOB_BROKEN` cause remains unknown; if it recurs the console line will now say how far the upload had committed and how many attempts were made.
- Nothing is pushed or deployed. The lockfile change would trigger the Deploy API workflow when pushed.

## Self-Check: PASSED

- Files exist: `apps/web/lib/upload.ts`, `apps/web/lib/upload.test.ts` (found).
- Commits exist: `e6b09771`, `eee1325b`, `a9160ccf` (found in `git log`); `git rev-list --count 12916534..HEAD` is 3; no Co-Authored-By trailer; nothing staged; nothing pushed.
- `grep -rIl -i upchunk apps/web` (excluding node_modules, .next, the ignored tsbuildinfo, `upload.ts`, `package.json`) prints nothing; `upload.ts` and `package.json` contain no match either.
