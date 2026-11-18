---
phase: quick-261118-mst
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/lib/upload.ts
  - apps/web/lib/upload.test.ts
  - apps/web/package.json
  - pnpm-lock.yaml
  - apps/web/components/media/VideoUploadField.tsx
  - apps/web/app/(app)/cursos/lesson-actions.ts
  - apps/web/lib/csp.ts
  - apps/web/e2e/courses-admin.spec.ts
  - apps/web/e2e/fixtures/README.md
  - .planning/quick/261118-mst-resilient-chunked-video-direct-upload-re/261118-mst-SUMMARY.md
autonomous: true
requirements: []
tags: [media, video, upload, resilience, mux, quick]

estimate:
  tokens: 90000
  raw_tokens: 90000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "ROOT CAUSE (investigated read-only by the orchestrator on 2026-11-18, not re-derived here). The chunked video direct-upload in apps/web/lib/upload.ts `uploadChunked` delegates to the third-party chunk-upload library pinned in apps/web/package.json (3.5.0). In that version (a) a network-level XHR failure is `statusCode 0` and only 408/502/503/504 are retried, so ANY network failure, including the browser failing to read a chunk Blob, stops the upload at once and the member restarts a 7 GB upload from zero; (b) a 5xx gets only 5 retries one second apart (about 5 s of resilience for an upload that lasts hours); (c) it never asks the server how much was persisted, so it cannot resume; (d) every chunk is built from a stream into freshly COPIED Blobs, not from `file.slice()`. (a) and (b) were reproduced in headless Chromium against a local protocol mock (a connection reset stops it after 21 requests; eight 503s stop it after 5 retries, about 5 s). The `net::ERR_BLOB_REFERENCED_BLOB_BROKEN` itself was NOT reproduced (a 6 GB sparse file uploads fine at loopback with the library, 16 s, 1229 requests, and with plain `file.slice` 32 MiB XHR PUTs, 12 s, 192 requests), so its trigger on the real user's machine is UNKNOWN (sleep or hibernate or a network change during hours, a cloud-synced or external drive, the file changing on disk, memory). The SUMMARY says this plainly and never claims it was reproduced."
    - "`uploadChunked(uploadUrl, file, opts)` keeps its exported signature and its `UploadOutcome` result, so `uploadBytes`, `useSignedUpload` (apps/web/components/media/useSignedUpload.ts) and apps/web/app/(app)/suporte/voice-deps.ts need NO change. It no longer imports anything from the third-party library; it is an in-repo resumable uploader for the provider's direct-upload URL: a PUT per chunk with `Content-Range: bytes start-end/total`, a 308 whose `Range: bytes=0-N` header says N+1 bytes are persisted, a 2xx meaning done."
    - "Every ATTEMPT reads its bytes from a FRESH `file.slice(start, end)`; a chunk Blob is never kept across attempts and the file is never copied into memory (brief (a)). Chunk size is the named constant 32 MiB, a multiple of 256 KiB, only the last chunk smaller (brief (b))."
    - "Each chunk request is an XHR PUT carrying exactly two request headers, `Content-Type: file.type` and `Content-Range`, and no others, so the Mux CORS preflight is unchanged (brief (c)). The status query carries the same two header names."
    - "After ANY 308 whose `Range` is readable, the uploader trusts it as the committed offset and continues from it, whether it is behind or ahead of the chunk just sent (brief (d))."
    - "A failure is retried with exponential backoff 1, 2, 4, 8, 16 then 30 s (30 s cap) for: a network failure (status 0, including a stalled request), 408, 429 and any 5xx. Before re-sending, the uploader asks the server for the committed offset with a PUT of an empty body and `Content-Range: bytes */total` (308 plus an optional Range, or 2xx meaning already complete) and resumes from it; if that query is inconclusive it resends from the last known offset (brief (e))."
    - "The uploader gives up with `{ ok: false, reason: 'transfer' }` after 12 consecutive failed attempts with no newly committed byte in between (the counter resets whenever the committed offset passes its previous high-water mark); every other 4xx (400, 401, 403, 404, 410 ...) is fatal at once and 413 maps to `too_large`, exactly as `uploadToSignedUrl` does (brief (f))."
    - "While `navigator.onLine === false` the uploader pauses without counting an attempt and continues on the `online` event; the listener is removed on settle (brief (g)). `signal` abort calls `xhr.abort()`, clears every timer and listener and resolves `{ ok: false, reason: 'aborted' }`; an already-aborted signal resolves at once with no request (brief (h))."
    - "Progress stays monotonic across a retry or a resume, is an integer percent through `opts.onProgress` computed from `xhr.upload.onprogress` plus the committed offset, and reports 100 only at success (brief (i))."
    - "The single raw log stays `console.error('media.chunked_failed', { error })`, console only, never rendered, and the short reason carries the last status or error name, the committed offset and the attempt count. It never carries the upload URL, any header or the file name (the URL is a bearer capability) (brief (j))."
    - "Screen Wake Lock is held while uploading when the API exists (feature-detected, every call guarded, re-requested on visibilitychange to visible, released on settle) as a small private helper, or left out with a plain statement in the SUMMARY if it cannot stay near 30 lines (brief (k))."
    - "No catalog key is added and no copy changes (`media.errors.transfer` stays); a file the browser cannot read after the retry budget simply ends as `transfer`. No ETA and no UI are added. The Mux provider side is unchanged (VIDEO_UPLOAD_TTL_S stays 3 h; the API already hands out the URL). Scope is the files of files_modified: web only, no packages or API change."
    - "The third-party chunk-upload dependency is removed from apps/web/package.json and pnpm-lock.yaml with `pnpm remove ... --filter @rede-social/web --offline`; if that needs the network the dependency stays in place and the SUMMARY reports it. Every comment that says the transfer goes through that library or in 5 MiB slices (upload.ts header docs and the `uploadChunked` doc, VideoUploadField.tsx, lesson-actions.ts, csp.ts, the courses-admin e2e comment near line 3487, the e2e fixtures README) describes the new uploader; wording only."
    - "The SUMMARY records honestly: the blob-broken trigger is unknown and was not reproduced; the real Mux status query (`bytes */total`) is UNVERIFIED against a real Mux upload URL (the library only ever read the Range of a 308 chunk response), so the first real large upload is Igor's check; whether Mux exposes the `Range` response header to the browser through CORS is UNVERIFIED too, which is why a 308 without a readable Range on a data chunk advances by the chunk sent (see the Range-exposure note in context); real-browser request counts for no faults, a dropped connection and 503s versus the old library stopping at once; the unit and CI results."
  artifacts:
    - path: "apps/web/lib/upload.ts"
      provides: "the in-repo resumable uploader behind the unchanged `uploadChunked` signature, the named constants CHUNKED_CHUNK_BYTES / CHUNKED_BACKOFF_MS / CHUNKED_MAX_FAILURES / CHUNKED_STALL_MS, a guarded wake-lock helper and the rewritten header and doc comments"
      contains: "CHUNKED_CHUNK_BYTES"
    - path: "apps/web/lib/upload.test.ts"
      provides: "red-first cases for the chunked path with a fake XMLHttpRequest and a fake File (none existed before)"
    - path: "apps/web/package.json"
      provides: "the third-party chunk-upload dependency removed (or the SUMMARY reports why not)"
    - path: ".planning/quick/261118-mst-resilient-chunked-video-direct-upload-re/261118-mst-SUMMARY.md"
      provides: "what ran with real counts, what was NOT run or verified, the commit SHAs, the real-browser counts and the open Igor checks"
  key_links:
    - from: "apps/web/lib/upload.ts uploadBytes"
      to: "apps/web/lib/upload.ts uploadChunked"
      via: "every provider other than 'supabase' still routes to `uploadChunked(started.signedUrl, file, opts)`; unchanged"
    - from: "apps/web/components/media/useSignedUpload.ts and apps/web/app/(app)/suporte/voice-deps.ts"
      to: "apps/web/lib/upload.ts uploadBytes"
      via: "they call `uploadBytes` and read an `UploadOutcome`; the outcome union is unchanged so neither file moves"
    - from: "uploadChunked XHR PUT"
      to: "apps/web/lib/csp.ts connect-src"
      via: "the same XHR PUT to the same provider upload host as before, so the CSP needs no edit (only its comment wording)"
---

<objective>
Make the chunked video direct-upload survive a multi-hour upload. A real member's 7.2 GB feed-post video upload died with the console line `media.chunked_failed` plus `net::ERR_BLOB_REFERENCED_BLOB_BROKEN` on the PUT to the Mux direct-upload URL, and the whole 7 GB had to restart from zero. The stock chunk-upload library stops at once on any network-level failure and cannot resume; this plan replaces it with an in-repo resumable uploader that retries with backoff, asks the server how much it persisted, re-slices the file for every attempt, pauses offline, keeps the screen awake and never walks progress back.

Purpose: a member's long upload finishes or ends only after a real, bounded retry budget (12 consecutive failures with no new byte, about 4 minutes of backoff), instead of stopping on the first dropped request. Speed is bandwidth-bound; the only speed lever here is fewer sequential round trips from 32 MiB chunks. No ETA and no UI.

Output: red-first tests for the chunked path, the uploader, the dependency removal, reworded comments, a scratch (uncommitted) real-browser check against the 6 GB sparse file, the full CI static sequence green, two or three path-scoped trailer-free commits, and a SUMMARY.

Decomposition note (tracer first): Task 1 is the leading slice. It writes the red tests first (the single-chunk path through the `uploadBytes` router down to the fake XHR first, then the failure paths) and then the uploader, proven end to end by those tests. Tasks 2 and 3 expand from the proven uploader: Task 2 removes the dependency and rewords every comment, Task 3 proves it in a real browser and runs the full CI static sequence. No task shares a file with another.
</objective>

<execution_context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/workflows/execute-plan.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@apps/web/AGENTS.md
@apps/web/lib/upload.ts
@apps/web/lib/upload.test.ts

Facts verified while planning (2026-11-18), so the executor does not re-derive them. Re-read a file only where a task says so.

The code today (apps/web/lib/upload.ts):
- `uploadChunked(uploadUrl, file, opts: Pick<TransferOptions, 'onProgress' | 'signal'>): Promise<UploadOutcome>` does `await import` of the library, builds an upload with a chunk size constant `UPCHUNK_CHUNK_SIZE_KB = 5120` (kibibytes, 5 MiB), maps the library's progress event to a monotonic integer percent, `success` to `{ ok: true }`, and `error` to `console.error('media.chunked_failed', { error })` plus `{ ok: false, reason: 'transfer' }`. `UploadOutcome` is `{ ok: true } | { ok: false; reason: 'transfer' | 'too_large' | 'aborted' }`. `uploadToSignedUrl` (same file) is the XHR style to follow: a `settle` guard, `opts.signal?.removeEventListener('abort', onAbort)` on settle, 413 to `too_large`.
- `uploadBytes(started, file, opts)` sends `provider === 'supabase'` to `uploadToSignedUrl` or `uploadResumable` (TUS) by the 6 MiB threshold and EVERY other provider (`mux`, `fake`) to `uploadChunked(started.signedUrl, file, opts)`. The fake provider's URL is a Supabase signed upload URL, which is why the courses-admin e2e video case goes through `uploadChunked` too.
- Callers: apps/web/components/media/useSignedUpload.ts (line ~217, `uploadBytes`) and apps/web/app/(app)/suporte/voice-deps.ts (line ~29). Their tests (AvatarUploadField.test.ts, ThreadPane.voice.test.tsx, voice-deps.test.ts) mock `uploadBytes`; nothing in the repo mocks the third-party library.

What the old library did (read from node_modules/.pnpm/@mux+upchunk@3.5.0/node_modules/@mux/upchunk/dist/upchunk.mjs, lines ~1129-1150 and ~1345-1360):
- Request headers on each chunk PUT: exactly `Content-Type: file.type` and `Content-Range: bytes {start}-{end}/{total}`; no other header, `GET` never used.
- `isIncompleteChunkUploadNeedingRetry` only resends when a 308 carries a `Range` that parses and ends BEFORE the chunk end; a 308 WITHOUT a `Range` header (or one the browser cannot read) is treated as success and the next chunk is sent. So the old code never needed the browser to read `Range` and was proven against real Mux uploads either way.

Range-exposure note (the one place this plan deliberately reads the brief conservatively): the GCS resumable protocol says a 308 without `Range` means 0 bytes persisted. But whether Mux's direct-upload endpoint exposes the `Range` response header to the browser through CORS (`Access-Control-Expose-Headers`) is UNKNOWN, and `xhr.getResponseHeader('Range')` returns null for a header the browser hides. Reading "missing means 0" on a DATA-chunk response could therefore rewind every upload to 0 forever on a real Mux URL. So: a 308 with a readable Range sets the committed offset to N+1 (trusted, brief (d)); a 308 WITHOUT a readable Range on a data-chunk response advances by the chunk just sent (what the old library did); a 308 WITHOUT a readable Range on a status query is inconclusive and keeps the last known offset. The status-query-with-Range, the data-chunk-with-Range and the no-progress guard below make the loop safe in both worlds. The SUMMARY must name this and say it is UNVERIFIED against real Mux.

Test file facts (apps/web/lib/upload.test.ts): environment is happy-dom (`// @vitest-environment happy-dom` on line 1); it already has `file()` and `sizedFile()` helpers (the latter fakes `size` with `Object.defineProperty` so no big buffer is allocated), a hoisted `vi.mock('tus-js-client')` double, a `stubXhr()` double for the plain PUT that has no `getResponseHeader` (leave it alone, add a NEW richer fake for the chunked path), `started` (provider 'supabase') and `afterEach(vi.unstubAllGlobals)` patterns. The package's vitest testTimeout is 15 s (apps/web/vitest.config.ts). There are NO chunked-path cases today. Run with `pnpm --filter @rede-social/web exec vitest run lib/upload.test.ts` (Vitest 5 does not walk up for a config).

Dependency and wording sites (verified): the package name is `@rede-social/web`; apps/web/package.json line 19 lists the dependency at 3.5.0; pnpm-lock.yaml has the importer entry (~line 323), the package entry (~2470) and the snapshot (~5659, which pulls `event-target-shim` and `xhr`). apps/web/tsconfig.tsbuildinfo mentions the library but is git-ignored (never edit or commit it). Comment sites: apps/web/lib/upload.ts (header docs ~lines 9-23 say two transfer shapes; the `UPCHUNK_CHUNK_SIZE_KB` doc ~258-264; the `uploadChunked` doc ~266-276); apps/web/components/media/VideoUploadField.tsx line ~37 ("travels through ... in 5 MiB slices with retries and 308-continue semantics"); apps/web/app/(app)/cursos/lesson-actions.ts line ~37 ("the video went browser to provider through ..."); apps/web/lib/csp.ts line ~19 ("Mux playback, Mux Data and ... upload host come from Mux's own CSP guidance"); apps/web/e2e/courses-admin.spec.ts line ~3487 ("... through ..."); apps/web/e2e/fixtures/README.md lines 5 and 6 ("a transfer is a single 5 MiB slice", "... in one slice"). The planning-time grep of apps, packages and .github found no other mention.

Real-browser harness (scratch, outside the repo): /private/tmp/claude-501/-Users-igorvboas-Library-Developer-TRIA-rede-social/55c5e100-0fe6-4038-9083-1323a9357057/scratchpad/blobrepro with server.mjs (protocol mock, env knobs FAIL_AT, FAIL_N, FAIL_MODE=drop|503), page.html, run.mjs (headless Chromium through Playwright resolved from apps/web, aborts if free disk falls under its GiB argument), sparse6g.bin (6 GiB sparse, uses no disk) and sparse600m.bin. Free disk at planning time was about 15.6 GiB, so keep the guard argument at 8. server.mjs has NO status-query branch: a PUT with `Content-Range: bytes */N` fails its range regex and is answered 200 'done', which would make a status query look like completion, so the scratch copy MUST add a branch answering 308 with `Range: bytes=0-{lastEnd}` (or 308 with no Range when nothing is persisted). esbuild is at apps/web/node_modules/.bin/esbuild; apps/web/lib/upload.ts imports `@rede-social/contracts/...` (TypeScript source through the package exports) and `@/lib/supabase-origin` (the `@` alias, read of `process.env.NODE_ENV`), so bundle it with an alias for `@` to apps/web and a define for `process.env.NODE_ENV` and `process.env.NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS`.

Tooling facts: formatter is Biome (`pnpm exec biome format --write {files}`; lineWidth 100, single quotes, trailing commas, semicolons; recommended lint rules, `useImportType` is an error; it does not format .md or the lockfile). The root `pnpm lint` is `turbo run lint` plus scripts/check-ui-literals.sh and scripts/check-dashboard-fixtures.sh. CI env for the build is in .github/workflows/ci.yml: API_URL=http://127.0.0.1:8787, NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=ci-build-placeholder, NEXT_PUBLIC_VAPID_PUBLIC_KEY=BJHs89NeHI8M9hJQWfvb1_irumrdO-cNFTwQZUHrWx3Lp3smi-NAifeRu5Pm4rWfwmQCL5GvEdK8_PVtNafxV1k (a local-only test key, private half discarded). Do not read any .env file. apps/web/AGENTS.md was read: no Next.js API is touched, this is browser transfer logic and comments.

Known reds that are NOT ours (ignore, do not chase): pgTAP 120/141/154/232, isolation b3/b8/phase-10 sweep, move-copy stale rede-demo avatar row, and the web EventsSections flake under load (passes alone). Those suites are not part of the static sequence below except the web flake, which is re-run alone if it appears.

Commit rules: path-scoped only (`git commit -m "..." -- {paths}`, one `git add {file}` first for a brand-new untracked file), NO Co-Authored-By trailer and no tool attribution of any kind (public repository, identity igor.vboas noreply), never `git add -A` or `git commit -a`, never stage .planning/sketches/ or the unrelated untracked files (.claude/*, .planning/debug, .planning/research/.cache, the sparse files), never push, never edit STATE.md, ROADMAP.md or REQUIREMENTS.md. No db reset, no db seed, no hosted project, no .env read. Do not run the full Playwright e2e or the integration suites (the local stack is not needed for this change); if the local stack happens to answer and you want one named e2e case, run only that one and say so.
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: A chunked direct upload that retries, resumes and re-slices (red first), in apps/web/lib/upload.ts</name>
  <files>apps/web/lib/upload.ts, apps/web/lib/upload.test.ts</files>
  <read_first>
    - apps/web/lib/upload.ts (whole file, already summarised in context; re-read only the lines you edit)
    - apps/web/lib/upload.test.ts (helpers `file`, `sizedFile`, `stubXhr`, `started`, the hoisted tus double, the existing describe layout)
    - node_modules/.pnpm/@mux+upchunk@3.5.0/node_modules/@mux/upchunk/dist/upchunk.mjs lines 1129-1150 and 1345-1360 (the headers and the 308 handling the old code proved against Mux)
  </read_first>
  <behavior>
    Write ALL of these cases first, in a new describe block (or blocks) for the chunked path in apps/web/lib/upload.test.ts, with a NEW richer fake `XMLHttpRequest` and a fake `File`, and run them red before touching upload.ts. Notation: C is `CHUNKED_CHUNK_BYTES` (32 MiB = 33554432), imported from './upload'.

    The fake XHR (new, local to the chunked describe): installed with `vi.stubGlobal('XMLHttpRequest', ...)`; every instance is recorded (method, url, the ordered `setRequestHeader` calls, the sent body, an `abort` spy); it answers from a per-test script of steps in order: a status with an optional `Range` header, `'error'` (fires `onerror`, which is status 0), `'timeout'` (fires `ontimeout`), or `'hang'` (never answers); `getResponseHeader(name)` is case-insensitive and returns the scripted Range or null; before answering a step it may fire `upload.onprogress({ lengthComputable: true, loaded, total })` events; it answers through `Promise.resolve().then(...)` (NOT setTimeout or queueMicrotask, which the fake timers would hold). The fake File: `sizedFile`-style with `size` faked, `type` set (for example 'video/mp4') and `slice` replaced by a `vi.fn` that returns a NEW tiny Blob on every call, so the tests can assert the arguments and that a new call and a new Blob happens per attempt. Use `vi.useFakeTimers()` and `await vi.advanceTimersByTimeAsync(...)` for every wait; restore real timers, globals, mocks and any `navigator` or `window` stubs in `afterEach`.

    B01 single chunk: a 1 MiB file with type 'video/mp4' makes exactly ONE request, a PUT, whose recorded header names, lower-cased and sorted, are exactly `['content-range', 'content-type']` (no x-upsert, no authorization, nothing else), `Content-Type` is 'video/mp4', `Content-Range` is `bytes 0-1048575/1048576`, the body is the Blob returned by exactly one `slice(0, 1048576)`, a 200 answer resolves `{ ok: true }` and the last `onProgress` value is 100.
    B02 multi-chunk with 308 plus Range: a 2.5C file, scripted 308 `bytes=0-{C-1}`, 308 `bytes=0-{2C-1}`, 200: three requests with `Content-Range` `bytes 0-{C-1}/{2.5C}`, `bytes {C}-{2C-1}/{2.5C}`, `bytes {2C}-{2.5C-1}/{2.5C}`, slice calls `(0,C)`, `(C,2C)`, `(2C,2.5C)`, outcome ok. Also pin `CHUNKED_CHUNK_BYTES === 32 * 1024 * 1024` and `CHUNKED_CHUNK_BYTES % (256 * 1024) === 0`.
    B03 Range behind and ahead: a 2C file whose first 308 says `bytes=0-{C/2-1}` makes the second request start at C/2 (`bytes {C/2}-{1.5C-1}/{2C}`), the next 308 says `bytes=0-{1.5C-1}` and the third request is `bytes {1.5C}-{2C-1}/{2C}` answered 200; slice start offsets are 0, C/2, 1.5C. A 3C file whose first 308 says `bytes=0-{2C-1}` (AHEAD of the chunk sent) makes the second request start at 2C.
    B04 308 without a readable Range: on a DATA chunk it advances by the chunk sent (a 2C file, first answer 308 with no Range, second request starts at C); on a STATUS QUERY it is inconclusive and keeps the last known offset (chunk 2 fails with status 0, the query answers 308 with no Range, chunk 2 is resent from C, not from 0).
    B05 retry after status 0 re-slices from the committed offset: a 2C file: chunk 1 answers 308 `bytes=0-{C-1}`, chunk 2 fails with `'error'`, 999 ms later still only 2 requests exist, at 1000 ms the status query appears (a PUT with an EMPTY body and `Content-Range: bytes */{2C}`, the same two header names, no slice call for it) and answers 308 `bytes=0-{C-1}`, chunk 2 is resent and answers 200. Slice calls are exactly `(0,C)`, `(C,2C)`, `(C,2C)` (the third a NEW call with the same arguments), `slice.mock.results[1].value !== slice.mock.results[2].value`, the two chunk-2 bodies are different objects, and the request order is data, data, query, data.
    B06 retriable statuses: `it.each` over 408, 429, 500, 502, 503, 504: the first request answers that status, the retry (after the query) answers 200, outcome ok; the first backoff is 1000 ms.
    B07 status-query resume: chunk 2 fails but the query answers 308 `bytes=0-{1.5C-1}`, so the next data request starts at 1.5C and is the last (`bytes {1.5C}-{2C-1}/{2C}`); a query answering 200 (and one answering 201) resolves `{ ok: true }` with NO further data request.
    B08 inconclusive status query: after a failed chunk the query answers 503 (one case) or fails with `'error'` (another), and a 404 (a third): the next data request resends from the last known offset with no extra backoff wait between the failed query and that resend; request order data, query, data.
    B09 fatal 4xx: `it.each` over 400, 401, 403, 404, 410: exactly ONE request, outcome `{ ok: false, reason: 'transfer' }`, no timer left pending (`vi.getTimerCount() === 0`), no status query, and `console.error` called once with first argument 'media.chunked_failed' and an `{ error }` string containing `status {code}`.
    B10 413: one request, outcome `{ ok: false, reason: 'too_large' }`.
    B11 abort: aborting while a request hangs calls that request's `abort` once, resolves `{ ok: false, reason: 'aborted' }`, leaves `vi.getTimerCount() === 0`, and no request appears after advancing an hour; aborting during a backoff wait resolves aborted, clears the timer and sends nothing more; an already-aborted signal resolves aborted with ZERO requests, ZERO slice calls and ZERO wake-lock requests.
    B12 offline: with `navigator.onLine` stubbed to false at the moment the first request fails, no further request appears and no timer is pending after ten minutes of fake time, and the failure is NOT counted; dispatching `online` on `window` resumes with the status query and the resend and ends ok; `window.removeEventListener` was called for 'online' by the time it settles; aborting while paused offline resolves aborted; starting while already offline sends nothing until `online`. Stub `navigator.onLine` with `Object.defineProperty(navigator, 'onLine', { configurable: true, get })` and delete the own property in `afterEach`.
    B13 monotonic progress: a 2C file: chunk 1 emits upload progress `loaded` 0.9C (45 percent) then fails with status 0; the query answers 308 `bytes=0-{0.5C-1}`; the resend from 0.5C emits `loaded` 0.1C (30 percent) and then 0.5C, then 308, then the final chunk answers 200. The reported percents are strictly increasing, never repeat and never go down, every value before success is at most 99, and 100 appears exactly once and last.
    B14 retry budget: every request answers 503 forever; the outcome is `{ ok: false, reason: 'transfer' }` after exactly 12 data requests (the status queries are not counted); the gaps between consecutive DATA sends on the fake clock are 1000, 2000, 4000, 8000, 16000, 30000, 30000 ms (record `Date.now()` per request; the fake queries answer instantly); `console.error` is called once, first argument 'media.chunked_failed', and the `error` string contains `status 503`, `committed=0` and `attempts=12`.
    B15 success resets the failure counter: a 2C file with 11 consecutive 503 answers on chunk 1, then 308 `bytes=0-{C-1}`, then 11 consecutive 503 answers on chunk 2, then 200: outcome ok (22 failures overall, never 12 in a row).
    B16 no-progress guard: a 3C file where chunk 1 answers 308 `bytes=0-{C-1}` and every later answer is the SAME 308 `bytes=0-{C-1}` (no new byte): the outcome is `transfer` after the budget, never an endless loop (assert the data request count is bounded, 13 at most).
    B17 stall watchdog: a request that hangs with no progress is aborted at `CHUNKED_STALL_MS` and treated as status 0 (999.. just before it nothing happened; at it the request's `abort` was called and, after the 1000 ms backoff, the query and the resend happen and the upload ends ok); an `onprogress` event before the deadline postpones it by a full `CHUNKED_STALL_MS`.
    B18 log hygiene: for the B09 and B14 failures, `JSON.stringify` of every `console.error` call's arguments contains neither the upload URL (use one with a recognisable secret like `?sig=SECRET-TOKEN`) nor the file name.
    B19 an empty file (size 0) resolves `{ ok: false, reason: 'transfer' }` with zero requests and one `console.error` line.
    B20 wake lock: with `navigator.wakeLock = { request }` stubbed (request resolves a sentinel with `release` and `released`), `request` is called once with 'screen' at start and the sentinel is released when the upload settles (success, failure and abort each); a `visibilitychange` to visible re-requests; a `request` that rejects or throws does not break the upload; with no `wakeLock` API (the happy-dom default) the upload works. Remove the stub in `afterEach`.
    B21 router: `uploadBytes({ ...started, provider: 'mux', signedUrl: 'https://direct-uploads.example/put?sig=abc' }, file, { mime })` goes through the chunked uploader (the fake XHR sees a `content-range` header) and builds NO tus upload (`tusState.constructed` stays empty); `provider: 'supabase'` routing and every existing case are unchanged.
  </behavior>
  <action>
    1. RED FIRST (tests before implementation, per the brief). Write every case in the behavior block into apps/web/lib/upload.test.ts. Import `CHUNKED_CHUNK_BYTES`, `CHUNKED_MAX_FAILURES`, `CHUNKED_STALL_MS` and `uploadChunked` from './upload' alongside the existing imports (they do not exist yet, which is itself part of the red). Pin the backoff numbers as literals in the test (1000, 2000, 4000, 8000, 16000, 30000) so an accidental edit of the constant is caught. Then run `pnpm --filter @rede-social/web exec vitest run lib/upload.test.ts --bail 1` and see it fail BEFORE you implement anything. Do not fabricate counts or evidence files; the plain vitest red output is the evidence, mention only the real numbers in the SUMMARY. If the old library path hangs a case until the 15 s timeout, that is a valid red.

    2. IMPLEMENT in apps/web/lib/upload.ts. Delete `UPCHUNK_CHUNK_SIZE_KB` and the dynamic import; keep the exported `uploadChunked(uploadUrl, file, opts)` signature and the `Pick<TransferOptions, 'onProgress' | 'signal'>` option type. Add and EXPORT these named constants, each with a comment that says why: `CHUNKED_CHUNK_BYTES` = 32 * 1024 * 1024 (a multiple of the 256 KiB the provider requires, 128 of them; only the last chunk may be smaller; 32 MiB instead of 5 MiB means 6.4 times fewer sequential round trips and at most 32 MiB re-sent after a failure; a `file.slice` Blob is a lazy reference into the file, never a copy), `CHUNKED_BACKOFF_MS` = [1000, 2000, 4000, 8000, 16000, 30000] (failure n waits entry min(n-1, last)), `CHUNKED_MAX_FAILURES` = 12, `CHUNKED_STALL_MS` = 120000 (a request that makes no upload progress for this long is treated as dead). Per MEDIA-03 and R-04 the bytes still go browser to provider and never touch Cloud Run.

    3. BEHAVIOUR of the uploader (implement exactly; describe nothing else, no ETA, no UI, no catalog key):
       - Guards first: an empty file logs the single `media.chunked_failed` line and resolves `transfer` with no request; an already-aborted signal resolves `aborted` immediately, before any slice, request, wake-lock call or listener.
       - State: `committed` (bytes the server is known to have persisted), `highest` (the high-water mark of `committed`), `failures` (consecutive), `sends` (total data-chunk sends), the highest reported percent, a `settled` guard, one `cancel` slot the current wait installs (backoff timer, online wait, in-flight XHR) so a single abort handler can stop whatever is pending. Every timer, listener and the wake lock is released in the single `settle` path, and `signal`'s abort listener is removed there (follow `uploadToSignedUrl`).
       - One request wrapper used for both data chunks and status queries: `new XMLHttpRequest()`, `open('PUT', uploadUrl)`, then EXACTLY two `setRequestHeader` calls, `Content-Type` with `file.type` and `Content-Range`; nothing else (the CORS preflight must stay the same set the old library sent; per brief (c)). It resolves exactly once with `{ status, range }` where a network error, a timeout and a stall are status 0 with a short detail string ('network error', 'timeout', 'stalled'), `range` is `xhr.getResponseHeader('Range')`. `xhr.upload.onprogress` feeds progress and re-arms the stall watchdog; `xhr.upload.onload` and the send itself also (re)arm it so the wait for the response gets a fresh `CHUNKED_STALL_MS`; the watchdog calls `xhr.abort()` and resolves the attempt as status 0 'stalled'; an `onabort` that the uploader did not cause is also status 0. The data request body is a FRESH `file.slice(start, end)` built inside the attempt, with `start = committed` and `end = Math.min(start + CHUNKED_CHUNK_BYTES, file.size)`; the Content-Range string is built from those numbers, never from `blob.size`; the Blob is never stored outside the attempt (brief (a)). The status query is a PUT with an empty body (`send()` with no argument; no slice) and `Content-Range: bytes */{total}`.
       - Classification of a data-chunk answer: 2xx is done (resolve ok after emitting 100); 308 reads `Range` with the pattern `bytes=0-{N}` and sets the new committed offset to min(N + 1, total), and WITHOUT a readable Range it sets it to `end` (advance by the chunk, see the Range-exposure note in context); 413 is fatal `too_large`; 408, 429, any status of 500 and above and status 0 are retriable; any other 4xx is fatal `transfer`; anything else (for example a stray 3xx) is retriable so it ends at the budget instead of hanging or failing instantly. An answer that leaves `committed` at or below its value before the attempt (a 308 that did not advance, including a Range that is behind) COUNTS as a failed attempt after `committed` has been set to the trusted offset (brief (d) is honoured: the offset is trusted, and the spin is bounded by the budget).
       - Status-query answer: 2xx means the object is already complete, resolve ok; 308 with a readable Range sets `committed` from it, 308 without one keeps the last known offset; EVERYTHING else (4xx, 5xx, network failure, stall) is inconclusive: keep the last known offset, do not count it as a failure and do not wait again, go straight to the data resend (a truly expired session answers the resend with a fatal 4xx). A 308 that claims the whole file is committed while no 2xx has arrived is treated as a failed attempt that goes through the query again (success is only ever declared on a 2xx).
       - One `commit(n)` helper does every assignment of `committed` (clamped to 0..total): when the value passes `highest` it raises `highest` and resets `failures` to 0 (brief (f): the counter resets whenever bytes are newly committed; a rewind that only re-sends already counted bytes never resets it).
       - Failure path (retriable outcome or no-progress answer): if `navigator.onLine === false` do NOT increment `failures` and do not start a backoff, only mark that a status query is needed and loop to the offline wait; otherwise increment `failures`; if it reaches `CHUNKED_MAX_FAILURES` resolve `transfer`; otherwise mark that a status query is needed and wait `CHUNKED_BACKOFF_MS[min(failures - 1, length - 1)]` ms in a timer the abort handler can clear.
       - Offline wait at the top of each loop turn: while `navigator.onLine === false` wait for the window `online` event without any timer and without counting; remove the listener when it fires and on settle (brief (g)).
       - Abort (brief (h)): the abort handler calls the in-flight XHR's `abort()`, runs the `cancel` slot (clears the backoff timer and the online listener), and resolves `{ ok: false, reason: 'aborted' }` through `settle`.
       - Progress (brief (i)): `percent = Math.min(99, Math.floor(bytes / file.size * 100))` where `bytes` is `committed` plus the in-flight `Math.min(event.loaded, end - start)`; report through `opts.onProgress` only when it exceeds the highest reported percent (monotonic across retries and resumes); report 100 once, only on success.
       - The single raw log (brief (j)): on every give-up path call `console.error('media.chunked_failed', { error })` exactly once, where `error` is one short string of the form `{detail}; committed={n}/{total}; attempts={sends}`, `detail` being `status {code}` for an HTTP answer, `status 0 (network error)`, `status 0 (stalled)`, `status 308 without progress`, `empty file` and so on. NEVER put the URL, a header, the file name or the response body in it (the upload URL is a bearer capability; T-mst-01). Resolve `transfer` (or `too_large` for 413). The member sees the existing catalog sentence only; add no key and change no copy.
       - Wake lock (brief (k)): a small private helper `holdScreenAwake(): () => void` that returns the release function. If `navigator.wakeLock` is absent it returns a no-op. Otherwise it requests `navigator.wakeLock.request('screen')` inside try/catch (a rejection or a throw is swallowed), re-requests on `document` `visibilitychange` when `document.visibilityState === 'visible'` and the previous sentinel is released or missing, and its release function removes the listener and releases the sentinel (guarded, never throwing). It is called once at start (after the empty-file and aborted guards) and released in `settle`. If the helper cannot stay near 30 lines fully guarded, drop it, drop test B20 and say so plainly in the SUMMARY.
       - Keep `uploadBytes` and every other export exactly as they are.

    4. COMMENTS in apps/web/lib/upload.ts: rewrite the file header docs so they list three transfer shapes (plain PUT, TUS, and the provider's chunked resumable direct-upload) and rewrite the `uploadChunked` doc to describe the new uploader: what it does, why 32 MiB, the retry budget, the status query, the fresh slice per attempt, offline, abort, wake lock, and the Range-exposure choice. The removed library may be named ONCE in that doc as history ("replaces ...: it treated any network-level failure as final and could not resume"); every other file must not mention it.

    5. SEE GREEN: `pnpm --filter @rede-social/web exec vitest run lib/upload.test.ts` (every existing case plus the new ones), then `pnpm exec biome format --write apps/web/lib/upload.ts apps/web/lib/upload.test.ts` and `pnpm exec biome check apps/web/lib/upload.ts apps/web/lib/upload.test.ts`; re-run the test file once after formatting. The full typecheck runs in Task 3 (the web typecheck needs `next typegen` through turbo).

    6. COMMIT path-scoped, no trailer: `git commit -m "feat(quick-261118-mst): resumable in-repo uploader for the video direct-upload URL (retry, status query, fresh slice per attempt)" -- apps/web/lib/upload.ts apps/web/lib/upload.test.ts`.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec vitest run lib/upload.test.ts && pnpm exec biome check apps/web/lib/upload.ts apps/web/lib/upload.test.ts</automated>
  </verify>
  <done>
    All B01-B21 cases exist, were seen red first against the old implementation, and are green; the existing upload.test.ts cases still pass; `uploadChunked` no longer imports the third-party library, keeps its signature and outcome union, sends exactly two request headers, slices fresh per attempt, retries with the 1/2/4/8/16/30 s backoff and the 12-failure budget, queries the committed offset before resending, honours a readable Range of any 308, treats other 4xx as fatal and 413 as `too_large`, pauses offline, aborts cleanly, keeps progress monotonic with 100 only at success, logs one short reason with no URL, and holds the screen awake (or the SUMMARY says the helper was left out). One path-scoped commit with no trailer exists.
  </done>
</task>

<task type="auto">
  <name>Task 2: Remove the third-party chunk-upload dependency and reword every comment that names it or "5 MiB slices"</name>
  <files>apps/web/package.json, pnpm-lock.yaml, apps/web/components/media/VideoUploadField.tsx, apps/web/app/(app)/cursos/lesson-actions.ts, apps/web/lib/csp.ts, apps/web/e2e/courses-admin.spec.ts, apps/web/e2e/fixtures/README.md</files>
  <read_first>
    - apps/web/components/media/VideoUploadField.tsx (the docblock around line 37)
    - apps/web/app/(app)/cursos/lesson-actions.ts (the docblock around line 37)
    - apps/web/lib/csp.ts (the comment around line 19)
    - apps/web/e2e/courses-admin.spec.ts (the comment around line 3487)
    - apps/web/e2e/fixtures/README.md (lines 5 and 6)
  </read_first>
  <action>
    <!-- planner-discipline-allow: upchunk -->
    1. Dependency removal (after Task 1 removed the only import): run `pnpm remove @mux/upchunk --filter @rede-social/web --offline`. Work from the repository root.
       - If it succeeds, inspect `git diff --stat -- apps/web/package.json pnpm-lock.yaml`: expect one removed line in apps/web/package.json and a lockfile diff that only removes the importer entry, the package entry, the snapshot and the transitive entries nothing else uses (for example `xhr` and `event-target-shim`). If the lockfile diff shows unrelated churn (any other package version moving), restore exactly those two files with `git checkout -- apps/web/package.json pnpm-lock.yaml` (nothing else was modified in them before this task) and treat the removal as blocked.
       - If pnpm needs the network (an offline-metadata error), do NOT retry with the network and do NOT hand-edit the lockfile: leave the dependency and the lockfile untouched (confirm with `git status --short apps/web/package.json pnpm-lock.yaml` printing nothing) and carry the fact into the SUMMARY.
       - Note for the SUMMARY: pnpm-lock.yaml sits under the Deploy API workflow's path filter, so a pushed lockfile change would trigger that workflow; the orchestrator decides about the push, never push from here.
       Commit the removal on its own, only if it happened: `git commit -m "chore(quick-261118-mst): drop the unused third-party chunk-upload dependency" -- apps/web/package.json pnpm-lock.yaml`.

    2. Wording only, no behaviour change and no code change in these files; keep each comment's surrounding structure and length:
       - apps/web/components/media/VideoUploadField.tsx: the docblock sentence that says a provider-owned object travels through the old library in 5 MiB slices with retries and 308-continue semantics becomes: a provider-owned object travels through the in-repo resumable uploader (`uploadChunked` in `lib/upload.ts`) in 32 MiB chunks that retry with backoff, ask the server how much it persisted and resume from there, so a dropped connection resumes instead of restarting a large video, and the bytes never pass through Cloud Run (MEDIA-01, R-04). Keep the rest of the docblock.
       - apps/web/app/(app)/cursos/lesson-actions.ts: "the video went browser to provider through ..." becomes "through the resumable `uploadChunked` uploader"; nothing else in that comment moves.
       - apps/web/lib/csp.ts: the phrase naming the old library's upload host becomes "the resumable uploader's direct-upload host" (the same XHR PUT to the same Mux upload host, so `connect-src` itself is untouched); keep the "Mux's own CSP guidance" clause.
       - apps/web/e2e/courses-admin.spec.ts near line 3487: the comment says the iPhone recording goes browser to provider (the fake's signed Storage URL) through the old library; it becomes "through the resumable `uploadChunked` uploader (one 186 KiB request)". Touch the comment only.
       - apps/web/e2e/fixtures/README.md lines 5 and 6: "small enough that a ... transfer is a single 5 MiB slice" becomes "small enough that the resumable `uploadChunked` uploader sends it as a single request (one chunk, far under its 32 MiB chunk size)", and "... through ... under `VIDEO_PROVIDER=fake`, in one slice" becomes "through `uploadChunked` under `VIDEO_PROVIDER=fake`, in one chunk". Do not run Biome on this .md file.

    3. `pnpm exec biome format --write apps/web/components/media/VideoUploadField.tsx "apps/web/app/(app)/cursos/lesson-actions.ts" apps/web/lib/csp.ts apps/web/e2e/courses-admin.spec.ts apps/web/package.json`, then `git diff --stat` on the touched files and read the diff once: only comment lines and the one dependency line (and the lockfile) may differ.

    4. Commit the wording on its own, path-scoped, no trailer: `git commit -m "docs(quick-261118-mst): describe the resumable uploader instead of the removed library in the upload comments" -- apps/web/components/media/VideoUploadField.tsx "apps/web/app/(app)/cursos/lesson-actions.ts" apps/web/lib/csp.ts apps/web/e2e/courses-admin.spec.ts apps/web/e2e/fixtures/README.md`.
  </action>
  <verify>
    <automated>! grep -rIl -i upchunk apps/web --exclude-dir=node_modules --exclude-dir=.next --exclude=tsconfig.tsbuildinfo --exclude=upload.ts --exclude=package.json && pnpm --filter @rede-social/web exec vitest run lib/upload.test.ts components/media</automated>
  </verify>
  <done>
    No file under apps/web outside node_modules, .next, the ignored tsbuildinfo, apps/web/lib/upload.ts and apps/web/package.json names the removed library. Either apps/web/package.json and pnpm-lock.yaml no longer list it (a clean removal commit exists) or the dependency stayed because pnpm needed the network and that fact is ready for the SUMMARY. The five wording files differ from before only in comment lines. The web media tests and upload tests pass. The wording commit exists, path-scoped, with no trailer.
  </done>
</task>

<task type="auto">
  <name>Task 3: Prove it in a real browser (scratch, not committed), run the full CI static sequence, write the SUMMARY</name>
  <files>.planning/quick/261118-mst-resilient-chunked-video-direct-upload-re/261118-mst-SUMMARY.md</files>
  <read_first>
    - /private/tmp/claude-501/-Users-igorvboas-Library-Developer-TRIA-rede-social/55c5e100-0fe6-4038-9083-1323a9357057/scratchpad/blobrepro/server.mjs, page.html and run.mjs (the harness; copy, never edit the originals)
    - .github/workflows/ci.yml lines 80-112 (the static sequence and its env)
  </read_first>
  <action>
    PART A: scratch real-browser check. NOTHING in this part is committed or placed inside the repository; work only in the harness directory (call it SCRATCH) /private/tmp/claude-501/-Users-igorvboas-Library-Developer-TRIA-rede-social/55c5e100-0fe6-4038-9083-1323a9357057/scratchpad/blobrepro. Never create a non-sparse large file; the existing sparse6g.bin (6 GiB, no disk) is the input, recreate it with `mkfile -n 6g sparse6g.bin` only if it is missing. Keep run guards at 8 GiB free.
    1. Make copies in SCRATCH: `server2.mjs` (copy of server.mjs) that ALSO (a) serves `/real.mjs` and `/page-real.html`, (b) answers a PUT whose `Content-Range` is `bytes */{total}` as a status query: 308 with `Range: bytes=0-{lastEnd}` when `stats.lastEnd >= 0`, else 308 with no Range, counting it in a new `stats.queries` and NOT mistaking it for completion, and (c) keeps FAIL_AT, FAIL_N and FAIL_MODE behaviour for all PUTs (queries included). `page-real.html` (copy of page.html idea) loads `/real.mjs` and exposes `window.startReal()` that reads the picked file, calls `uploadChunked('/put', file, { onProgress: (p) => { window.__pct = p; } })`, and sets `window.__done = true` on `{ ok: true }` or `window.__error = reason` otherwise; it also keeps the page's console output visible. `run-real.mjs` (copy of run.mjs) takes mode `real` (calls `window.startReal()`) and imports `start` and `stats` from `server2.mjs`; it prints data requests and queries separately and the last console lines (including any `media.chunked_failed`).
    2. Bundle the REAL uploader (not a transpiled copy): an entry file in SCRATCH that imports `uploadChunked` from the repository's apps/web/lib/upload.ts and attaches nothing else; build it with `apps/web/node_modules/.bin/esbuild` as an ESM browser bundle into SCRATCH/real.mjs with `--alias:@=` the absolute apps/web path, `--define:process.env.NODE_ENV='"development"'`, `--define:process.env.NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS='"0"'` and `--external:tus-js-client` if bundling it gives trouble (it is only loaded by a dynamic import this check never executes).
    3. Run, each time `node run-real.mjs real sparse6g.bin 8` from SCRATCH, and record verdict, seconds, data requests, queries and the last console lines:
       - no faults;
       - `FAIL_AT=20 FAIL_N=8 FAIL_MODE=drop` (a connection reset on eight consecutive requests);
       - `FAIL_AT=20 FAIL_N=8 FAIL_MODE=503`.
       Expected: all three finish with the 6 GiB received (192 data chunks of 32 MiB at no faults); the fault runs finish after the backoff waits with extra requests for the retries and status queries. If a run does not finish, that is a real finding: read the console lines, fix the uploader in a new small commit (path-scoped) with a test for the cause, rebuild real.mjs and run again; never record a pass you did not see.
    4. Contrast with the old library using the unchanged harness: `FAIL_AT=20 FAIL_N=8 FAIL_MODE=drop node run.mjs upchunk sparse6g.bin 8` and the same with `FAIL_MODE=503`, record that it stops at once (and after how many requests). These runs only restate the orchestrator's reproduction; say so.
    5. Do NOT claim the `net::ERR_BLOB_REFERENCED_BLOB_BROKEN` trigger was reproduced or fixed by a root cause; say what the uploader does instead (re-slice per attempt, retry, resume).

    PART B: the FULL CI static sequence, from the repository root, with the CI env set on the commands that need it: API_URL=http://127.0.0.1:8787 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=ci-build-placeholder NEXT_PUBLIC_VAPID_PUBLIC_KEY=BJHs89NeHI8M9hJQWfvb1_irumrdO-cNFTwQZUHrWx3Lp3smi-NAifeRu5Pm4rWfwmQCL5GvEdK8_PVtNafxV1k TURBO_CACHE=local:r. Run in this order and stop at the first real red of ours:
    1. `pnpm exec biome format --write` on every .ts, .tsx and package.json file touched by this plan (a no-op after Tasks 1 and 2, run it anyway).
    2. `pnpm lint` (the whole root script).
    3. `pnpm turbo typecheck build test --concurrency=4` (long: run it in the background and wait; give it the maximum timeout). If only the known web EventsSections flake fails, re-run `pnpm --filter @rede-social/web exec vitest run` on that file alone and record that it passes alone.
    4. `pnpm check:static-routes`, `pnpm boundaries`, `pnpm boundaries:negative`, `pnpm guard:lanes`, `pnpm guard:hooks`, `pnpm guard:workflows`.
    5. Afterwards clear the heavy caches: remove `.turbo/cache`, `apps/web/.next/cache` and `apps/web/.next/dev` (rm -rf of exactly those three paths) and confirm free disk with `df -k /`.
    A red that is one of the known reds listed in context is reported, not chased; any other red of ours is fixed with a test and a new path-scoped commit.

    PART C: the SUMMARY at .planning/quick/261118-mst-resilient-chunked-video-direct-upload-re/261118-mst-SUMMARY.md, following the execute-plan summary template, with: what changed and the commit SHAs; the unit cases (count and result) and the CI sequence results with real numbers; the real-browser table (three runs and the two contrast runs: verdict, seconds, data requests, queries); the root-cause statement exactly as in must_haves, including that the blob-broken trigger is UNKNOWN and was NOT reproduced; the explicit UNVERIFIED list: (1) the real Mux status query `bytes */total` was never run against a real Mux upload URL (the old library only ever read the Range of a 308 chunk response) and the uploader degrades safely, an answer other than 2xx or a 308 makes it retry from the last known offset; (2) whether Mux exposes the `Range` response header to the browser through CORS, and the consequence chosen (a 308 without a readable Range on a data chunk advances by the chunk; on a status query it keeps the last known offset); (2b) a 2xx answer to the status query is trusted as "already complete"; against an endpoint that is not a resumable session (the fake provider's Supabase signed upload URL, non-production only) an empty-body PUT could create a zero-byte object and look like success, and against real Mux the behaviour is the first real large upload's check; (3) the stall watchdog `CHUNKED_STALL_MS` (an addition beyond the brief for a half-open connection after sleep) and the no-progress guard (also an addition, so a server repeating the same Range cannot spin), both pinned by tests; the dependency removal outcome (done, or blocked by the network and left in place) and the note that pnpm-lock.yaml sits under the Deploy API workflow path filter; whether the wake-lock helper was kept; that no catalog key, copy, UI, ETA, API, package or Mux provider change was made and VIDEO_UPLOAD_TTL_S stayed 3 h; the bandwidth-bound speed note (7.2 GB at 20 Mbps is about 50 minutes, at 5 Mbps about 3.2 hours which exceeds the 3 hour Mux upload window; only fewer round trips from bigger chunks was in scope); that the first real large upload is Igor's check; nothing pushed or deployed. Then stage and commit it path-scoped with no trailer: `git add` the SUMMARY (and this PLAN only if `git ls-files --error-unmatch` shows it untracked), `git commit -m "docs(quick-261118-mst): summary of the resilient chunked video upload" -- {those paths}`. Do not edit STATE.md.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec vitest run lib/upload.test.ts && test -s .planning/quick/261118-mst-resilient-chunked-video-direct-upload-re/261118-mst-SUMMARY.md</automated>
  </verify>
  <done>
    The three real-browser runs against the 6 GiB sparse file finish (or a real finding was fixed and re-run) and their request counts are in the SUMMARY next to the old library stopping at once under the same faults; the full CI static sequence is green apart from the listed known reds; the three heavy cache paths are cleared; the SUMMARY states plainly what is UNKNOWN or UNVERIFIED (blob-broken trigger, real Mux status query, Range exposure) and what stays Igor's (the first real large upload); the SUMMARY commit exists, path-scoped, with no trailer; nothing was pushed.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser to provider direct-upload host | the member's browser PUTs file bytes straight to a URL the API minted from the video provider; the URL is a bearer capability |
| provider response to uploader state | status codes and the `Range` header of the provider's answers drive the uploader's committed offset and retry decisions |
| uploader to console | the only raw diagnostic is one console line the member never sees |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-mst-01 | Information Disclosure | `console.error('media.chunked_failed', ...)` in apps/web/lib/upload.ts | medium | mitigate | the reason string carries only the last status or error name, the committed offset, the total and the attempt count; never the upload URL, a header, the file name or a response body; test B18 pins it for a fatal 4xx and for the exhausted budget |
| T-mst-02 | Denial of Service | retry loop in `uploadChunked` | medium | mitigate | bounded by 12 consecutive failures with no new committed byte, exponential backoff capped at 30 s, a no-progress guard so a server repeating the same Range cannot spin the loop (tests B14, B15, B16), a stall watchdog so a half-open connection cannot hang forever (B17), and offline waits use no timer; every timer, listener and the wake lock is released in the single settle path (B11, B12, B20) |
| T-mst-03 | Tampering | upload target origin | low | accept | the URL is minted by the API from the provider and the browser's `connect-src` (apps/web/lib/csp.ts, unchanged) already limits the host; the uploader adds no new host and no new header |
| T-mst-04 | Tampering | trusting the response `Range` as the committed offset | low | accept | the offset is clamped to 0..total and only changes which byte range the member's own upload resends to the URL the API chose; a hostile answer can at worst fail or stall the member's own upload, which ends at the retry budget as `transfer` |
| T-mst-SC | Tampering | npm package changes | low | accept | no package is added; one is removed (smaller supply-chain surface) with the lockfile diff reviewed for unrelated churn; the package legitimacy gate is not triggered because nothing is installed |
</threat_model>

<verification>
- `pnpm --filter @rede-social/web exec vitest run lib/upload.test.ts` green (new B01-B21 plus every existing case).
- `pnpm --filter @rede-social/web exec vitest run components/media` green (the hook and field that call `uploadBytes` are untouched).
- `! grep -rIl -i upchunk apps/web --exclude-dir=node_modules --exclude-dir=.next --exclude=tsconfig.tsbuildinfo --exclude=upload.ts --exclude=package.json` prints nothing, and apps/web/package.json no longer lists the dependency unless the SUMMARY says pnpm needed the network.
- Scratch real-browser runs (no faults, `FAIL_AT=20 FAIL_N=8 FAIL_MODE=drop`, `FAIL_MODE=503`) finish with 6 GiB received; the old library stops at once under the same faults.
- `pnpm lint`, `pnpm turbo typecheck build test --concurrency=4` (CI env), `pnpm check:static-routes`, `pnpm boundaries`, `pnpm boundaries:negative`, `pnpm guard:lanes`, `pnpm guard:hooks`, `pnpm guard:workflows` green apart from the known reds.
- `git log -5 --format=%B` shows no Co-Authored-By trailer and no tool attribution; `git status --short` shows nothing staged and no scratch file inside the repository; nothing was pushed.
</verification>

<success_criteria>
A large chunked video upload no longer dies on the first dropped request: it retries network failures, 408, 429 and 5xx with 1/2/4/8/16/30 s backoff for up to 12 consecutive failures, asks the server for the committed offset before resending, resumes from any readable Range, re-slices the file for every attempt, pauses while offline, aborts cleanly, never walks progress back, keeps the screen awake, logs one short reason with no URL, and ends as `transfer` or `too_large` otherwise; the old library and every comment naming it are gone; the unit tests, the real-browser runs and the CI static sequence prove it; and the SUMMARY is honest that the blob-broken trigger is unknown and not reproduced and that the real Mux status query and Range exposure are unverified until Igor's first real large upload.
</success_criteria>

<output>
Create `.planning/quick/261118-mst-resilient-chunked-video-direct-upload-re/261118-mst-SUMMARY.md` when done
</output>
