---
phase: 03-media-pipeline-member-profiles
plan: 07
subsystem: media
tags: [media, video, mux, player, upchunk, playback-token, keyset, admin, ui, isolation]

# Dependency graph
requires:
  - phase: 03-06
    provides: "the VideoProvider seam — signPlayback(id, { expiresInSeconds }) -> { playback, thumbnail, storyboard }, the fake provider with its deferred synthetic ready event, VideoProviderError, and the media_assets video columns"
  - phase: 03-05
    provides: "the member directory's keyset loop, its `Carregar mais` shape and loading.tsx convention"
  - phase: 03-04
    provides: "useSignedUpload, uploadBytes/uploadToSignedUrl/uploadResumable, MediaImage, FileDropZone usage, the /v1/media web proxy route and the media.json catalog"
  - phase: 03-03
    provides: "encodeCursor/decodeCursor and the over-fetch `limit + 1` page shape, lifted here into packages/core/server/paging.ts"
  - phase: 03-01
    provides: "the media broker (startUpload/completeUpload/serveVariant/deleteAsset/assetView), MEDIA_LIMITS, the private media bucket"
provides:
  - "GET /v1/media/{assetId}/playback — a short-lived signed playback credential minted PER REQUEST against the caller's own membership (D-44), Cache-Control: no-store, never persisted or logged"
  - "GET /v1/media — an admin_tenant-only keyset list of the community's assets, newest first"
  - "packages/core/server/paging.ts — the repo's ONE keyset cursor encoder; profiles/search.ts re-exports it"
  - "playbackTokens(ctx, assetId) and listAssets(ctx, query) on the kernel media service"
  - "/configuracoes/midia — the minimal admin media screen R-04 chose, reachable only by admin_tenant"
  - "VideoPlayer — the three-state player (processing/ready/failed) Phase 4's feed and Phase 5's stories render"
  - "VideoUploadField + uploadChunked() — a resumable UpChunk transfer straight to the provider"
  - "CONFLICT in ERROR_CODES — the 409 the plan's not_ready refusal needed"
affects: [03-08, phase-04-feed, phase-05-stories, phase-07-realtime, phase-01.1-cloud-provisioning]

actuals:
  tokens: 61949
  tasks: 3
  commits: 3
plan_head_before: ec59798627c3dd0f342f60839d0dc283f5db5486

# Tech tracking
tech-stack:
  added: ["@mux/mux-player-react@3.13.4", "@mux/upchunk@3.5.0"]
  patterns:
    - "One cursor encoder for the repo: the second caller LIFTS the implementation into a shared module rather than copying it, and the original re-exports so no call site or test changes"
    - "A bearer credential the server hands the browser is minted per request, answered `no-store`, and never written to a row, a log or a cacheable payload"
    - "An almost-closed refusal vocabulary: exactly ONE distinguishable code, reachable only for a resource the caller provably owns; every other miss is the same bare 404"
    - "A provider-owned upload has no `complete` call — the transfer hook branches on the broker rather than assuming Storage owns every object"
    - "Ask the third-party element for its own derived URL instead of rebuilding a vendor URL, then probe it: the seam holds even inside a UI backstop"
    - "A Playwright hydration gate that is also the real user path: `waitForEvent('filechooser')` cannot resolve before React's own onClick ran"

key-files:
  created:
    - packages/core/server/paging.ts
    - apps/web/lib/media.ts
    - apps/web/components/media/MediaAssetRow.tsx
    - apps/web/components/media/VideoPlayer.tsx
    - apps/web/components/media/VideoUploadField.tsx
    - apps/web/app/(app)/configuracoes/midia/page.tsx
    - apps/web/app/(app)/configuracoes/midia/loading.tsx
    - apps/web/app/(app)/configuracoes/midia/MediaLibrary.tsx
    - apps/web/app/(app)/configuracoes/midia/actions.ts
    - apps/api/tests/integration/media-playback.test.ts
    - apps/web/e2e/media-video.spec.ts
    - apps/web/e2e/fixtures/sample.mp4
  modified:
    - packages/contracts/src/media.ts
    - packages/contracts/src/errors.ts
    - packages/core/server/http/api-error.ts
    - packages/core/server/media/service.ts
    - packages/core/server/profiles/search.ts
    - packages/core/ui/nav.ts
    - apps/api/src/routes/media.ts
    - apps/web/app/(app)/configuracoes/page.tsx
    - apps/web/app/(app)/perfil/actions.ts
    - apps/web/components/media/useSignedUpload.ts
    - apps/web/lib/upload.ts
    - apps/web/messages/pt-BR/media.json
    - apps/web/messages/pt-BR/app.json
    - apps/web/e2e/admin.ts
    - apps/web/e2e/fixtures/README.md

key-decisions:
  - "`@mux/upchunk@3.5.0`'s `chunkSize` is in KiB, not bytes — verified in dist/upchunk.mjs (`chunkByteSize = chunkSize * 1024`), so the plan's 5120 is 5 MiB, a 256 KiB multiple inside UpChunk's own bounds"
  - "`tokens` on <mux-player> is a PROPERTY-only path: `set tokens` stores a private field and never reflects a `playback-token` attribute, so the e2e asserts the element's own getter"
  - "@mux/mux-player only derives a poster when the thumbnail token's decoded `aud` claim is 't'; the fake's non-JWT tokens mean the local run always exercises the no-poster branch"
  - "A provider-owned upload skips `complete` entirely: calling it would hand a video to the image/PDF decoder and reject an upload the provider already accepted"
  - "`CONFLICT` joined ERROR_CODES — the plan's `ApiError(409, 'CONFLICT')` had no member to use"
  - "The not-found e2e asserts the rendered screen, not response.status(): adding loading.tsx makes the route stream and the shell commits 200 before notFound() throws"
  - "The 5-minute poll ceiling is driven by Playwright's clock rather than a test-only prop, so no test seam ships in the component"
  - "MediaAssetRow takes the community timezone as a prop defaulting to the tenants column default — the bootstrap payload does not carry `timezone` yet"

patterns-established:
  - "Pattern 1 (one encoder, two callers): a shared module plus a re-export from the original, so lifting costs no call-site change"
  - "Pattern 2 (per-request credential): minted on demand, `no-store`, never persisted, asserted absent from the row"
  - "Pattern 3 (almost-closed refusal vocabulary): one distinguishable code for a resource the caller owns; everything else identical"
  - "Pattern 4 (ask the element, do not rebuild the URL): a UI backstop that respects the provider seam"

requirements-completed: [MEDIA-03, TENANT-04]

coverage:
  - id: D1
    description: "`GET /v1/media/{assetId}/playback` mints three distinct non-empty tokens for a ready video of the caller's own community, answers `Cache-Control: no-store`, is minted fresh on every request and leaves no trace of the credential in the row"
    requirement: TENANT-04
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/media-playback.test.ts#mints three non-empty tokens for a READY video and answers Cache-Control: no-store"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/media-playback.test.ts#is minted fresh on every request — nothing is cached between two calls"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/media-playback.test.ts#a MEMBER of the same community may obtain a token — playback is not an admin surface"
        status: pass
    human_judgment: false
  - id: D2
    description: "The refusal vocabulary is almost closed: `409 { media: 'not_ready' }` is the ONLY distinguishable code and only for the caller's own transcoding asset; an unknown id, an image, a failed row, a rejected row, a ready row with no playback id and a soft-deleted row all answer the SAME bare 404 with no details payload"
    requirement: TENANT-04
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/media-playback.test.ts#a still-transcoding asset answers 409 { media: \"not_ready\" } — the ONE distinguishable code"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/media-playback.test.ts#every OTHER miss is the SAME bare 404 with no details payload (T-03-49)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/media-playback.test.ts#a soft-deleted video takes the same bare 404 — the row is invisible to the lane"
        status: pass
    human_judgment: false
  - id: D3
    description: "A tenant-B session provably cannot obtain a playback token for a tenant-A video nor see it in a list: the 404 body carries no tokens object, no playback id, no filename and no tenant name, and tenant B's list contains none of tenant A's asset ids"
    requirement: TENANT-04
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/media-playback.test.ts#a tenant-B admin gets a bare 404 for a tenant-A ready video, with NO token in the body"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/media-playback.test.ts#a tenant-B admin's list contains NONE of tenant A's asset ids"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/media-playback.test.ts#a tenant-B MEMBER is refused the list with 403 before any tenant consideration"
        status: pass
    human_judgment: false
  - id: D4
    description: "`GET /v1/media` is admin_tenant-only, lists newest-first, pages by the shared keyset cursor without repeating or skipping a row, degrades a tampered cursor to the first page and clamps `limit`"
    requirement: MEDIA-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/media-playback.test.ts#refuses a MEMBER with 403 FORBIDDEN before any tenant consideration (T-03-48)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/media-playback.test.ts#pages by the shared keyset cursor and never repeats or skips a row"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/media-playback.test.ts#a tampered or stale cursor answers the FIRST page rather than an error (T-03-52)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/media-video.spec.ts#pagination is the directory contract: 25 rows, then \"Carregar mais\" appends the rest"
        status: pass
    human_judgment: false
  - id: D5
    description: "Exactly one keyset cursor implementation exists in the repo: encodeCursor/decodeCursor moved to packages/core/server/paging.ts and profiles/search.ts re-exports them, with 03-03's unit suite unchanged and green"
    verification:
      - kind: unit
        ref: "pnpm --filter @rede-social/core test -- profiles-search — 189 tests pass with no change to packages/core/tests/profiles-search.test.ts"
        status: pass
      - kind: other
        ref: "grep -vE '^[[:space:]]*(//|\\*|/\\*)' packages/core/server/profiles/search.ts | grep -c 'function encodeCursor' prints 0; the file contains `from '../paging'`"
        status: pass
    human_judgment: false
  - id: D6
    description: "`/configuracoes/midia` is reachable only by admin_tenant: the 'Administração' group and its row are ABSENT from the DOM for a member and a support_tenant (toHaveCount(0), not hidden and not disabled), and the route itself renders no media screen and no 403 copy for either"
    requirement: MEDIA-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/media-video.spec.ts#an admin_tenant reaches \"Mídia\" from Configurações and lands on the empty library"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/media-video.spec.ts#a member never learns the screen exists — no group, and a direct visit is not-found"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/media-video.spec.ts#a support_tenant is refused exactly like a member"
        status: pass
    human_judgment: false
  - id: D7
    description: "An admin uploads a phone-recorded video with a resumable chunked transfer whose bytes never pass through our origin; the row enters the list at 'Processando' and flips to 'Pronto', announced once through an aria-live region"
    requirement: MEDIA-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/media-video.spec.ts#an admin uploads a video: progress, then the row sits at \"Processando\" and flips to \"Pronto\""
        status: pass
      - kind: unit
        ref: "apps/web/lib/upload.test.ts — the threshold router's supabase branch is unchanged (82 web tests pass)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The list re-fetches while a row is processing and, after five minutes, stops and offers an outline 'Atualizar' that really re-reads"
    requirement: MEDIA-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/media-video.spec.ts#the list polls while a row is processing and, after five minutes, stops and offers \"Atualizar\""
        status: pass
    human_judgment: false
  - id: D9
    description: "The player renders its three states: a ready asset opens with a non-empty playback token in a sheet on the phone and a centred 680px dialog on the desktop; a failed row shows the danger pill and the catalog line with no player frame; a processing placeholder does not spin under prefers-reduced-motion"
    requirement: MEDIA-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/media-video.spec.ts#tapping a \"Pronto\" row opens the player with a non-empty playback token"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/media-video.spec.ts#the player opens in a sheet on the phone and a centred dialog on the desktop"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/media-video.spec.ts#a failed row carries the danger pill and the failure line"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/media-video.spec.ts#under prefers-reduced-motion the processing spinner does not spin, and the copy still carries the state"
        status: pass
    human_judgment: false
  - id: D10
    description: "No raw player error, provider status or token fragment reaches the screen: a refused token becomes the generic toast plus a ghost 'Tentar novamente' that re-mints, and a failed row never shows its provider failure_reason"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/media-video.spec.ts#a playback token refused mid-session becomes the generic toast plus a retry that re-mints"
        status: pass
      - kind: other
        ref: "grep -vE '^[[:space:]]*(//|\\*|/\\*)' apps/web/components/media/VideoPlayer.tsx | grep -cE 'error\\.message|String\\(error\\)' prints 0"
        status: pass
    human_judgment: false
  - id: D11
    description: "E10/partial backstop — a ready asset whose still does not resolve renders the player with no broken-image glyph and no raw error text, and `data-poster=\"none\"` proves the fallback really ran rather than that nothing visibly broke"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/media-video.spec.ts#E10/partial backstop — a ready asset whose poster never resolves shows no broken glyph and no raw error"
        status: pass
    human_judgment: true
    rationale: "The test proves the NO-POSTER branch, which is the only one the fake provider can reach: @mux/mux-player only derives a still when the thumbnail token's decoded `aud` is 't', and the fake mints non-JWT tokens. That a real signed Mux thumbnail token produces a still — and that a FAILING real still degrades the same way — is observable only against a real account. Recorded as broken-windows entry 14 and tied to the docs/DEPLOY.md Phase 01.1 runbook."
  - id: D12
    description: "The refusal copy is video-specific and interpolated: a .gif is refused at pick time with \"Formato de vídeo não suportado…\", costs no request to /v1/media/uploads, and the picker offers exactly video/mp4,video/quicktime"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/media-video.spec.ts#a .gif is refused at pick time and costs no upload request at all"
        status: pass
      - kind: other
        ref: "bash scripts/check-ui-literals.sh — every string comes from apps/web/messages/pt-BR/media.json, which carries {duration} and {percent}"
        status: pass
    human_judgment: false
  - id: D13
    description: "Real-device HLS playback on iOS Safari and Android Chrome, and a real Mux transcode end to end"
    requirement: MEDIA-03
    verification: []
    human_judgment: true
    rationale: "No Mux account exists and Phase 01.1 is deferred to the end of the milestone (the user's standing decision). Every proof here runs against VIDEO_PROVIDER=fake. This is the known-blocked UAT line 03-06 recorded in docs/DEPLOY.md, carried forward unchanged — it is criterion 4's device half and cannot be automated from a headless Chromium."

# Metrics
duration: 62 min
completed: 2026-09-22
status: complete
---

# Phase 3 Plan 07: Video Playback and the Admin Media Screen Summary

**`GET /v1/media/{assetId}/playback` mints a short-lived signed credential per request against the caller's own membership and refuses a foreign asset with the same bare 404 an unknown id gets; `/configuracoes/midia` is an `admin_tenant`-only screen where a phone video uploads resumably through UpChunk, sits at "Processando", flips to "Pronto" with a spoken announcement and plays in a branded HLS player — with exactly one keyset cursor implementation left in the repo.**

## Performance

- **Duration:** 62 min
- **Started:** 2026-09-22T02:30:35Z
- **Completed:** 2026-09-22T03:33:23Z
- **Tasks:** 3 (one tracer, two expansion)
- **Files modified:** 31 (29 source + the lockfile + a binary fixture)

## Package install bases — TWO SEPARATE ONES, do not conflate them

| Package | Version | Basis | Gate owed? |
|---|---|---|---|
| `@mux/mux-player-react` | 3.13.4 | The **blocking-human legitimacy approval** the user gave on 2026-09-21, verbatim **"Approved — install both."**, recorded in `03-06-SUMMARY.md` §"Package legitimacy approval (Task 1)" and as a STATE decision. That approval names `@mux/mux-node` and `@mux/mux-player-react` explicitly and is scoped to Phase 3. | No — already given in 03-06. Not re-asked. |
| `@mux/upchunk` | 3.5.0 | Its **own `OK` / Approved verdict** in `03-RESEARCH.md` §Package Legitimacy Audit (line 174: last publish 2025-02-19, 207,244 weekly downloads, `github.com/muxinc/upchunk`, `scripts.postinstall` null). A package with an `OK` verdict is never `[SUS]`/`[ASSUMED]`. | No — and **not covered by the 03-06 checkpoint**. A later reader must not attribute it there. |

**CLAUDE.md pin to reconcile (user action, not a blocker).** The stack table pins
`@mux/mux-player-react` at **3.13.3**; the tree now carries **3.13.4**. `@mux/upchunk` is not in the
table at all. This is the same kind of drift 01-02 recorded for `next@16.3.5` against a 16.3.4 pin,
and it joins 03-06's `@mux/mux-node` 15.1.0 → 15.2.0 note.

## Accomplishments

- **A playback credential that cannot leak and cannot be used as an oracle.** The row is read in the
  tenant lane, so a foreign asset is *invisible* rather than denied — the 404 is structural. Exactly
  one distinguishable code exists (`409 { media: 'not_ready' }`) and it is reachable only for an
  asset the caller provably owns; an unknown id, an image, a `failed` row, a `rejected` row, a
  `ready` row with no playback id and a soft-deleted row all take the same bare 404 with **no
  details payload**. The token is minted after that read, answered `Cache-Control: no-store`, and an
  integration case asserts the string appears nowhere in `row_to_json(media_assets)`.
- **One cursor encoder in the repo, and 03-03 never noticed.** `encodeCursor`/`decodeCursor` moved
  verbatim into `packages/core/server/paging.ts`; `profiles/search.ts` re-exports them, so every
  03-03 call site and `packages/core/tests/profiles-search.test.ts` are byte-identical and green.
  The media list uses the same `{ v: 1, n, id }` envelope with `created_at desc, id desc`.
- **The admin screen no other role can see.** The "Administração" group is rendered only for
  `admin_tenant` and is *absent from the DOM* for a member and a `support_tenant` — asserted with
  `toHaveCount(0)`, not a visibility check — and the route re-checks the role and `notFound()`s
  rather than rendering a 403 screen.
- **A real resumable upload of a real video.** `apps/web/e2e/fixtures/sample.mp4` is 186 KiB of
  genuine H.264 (no ffmpeg on the machine, so it is generated with AVFoundation — the script is in
  the fixtures README). The e2e records every request and asserts that nothing carrying the file's
  bytes went to our own origin, and that a `PUT` to a non-origin host did.
- **The row really flips.** With a `ROLE=worker` spawned, the fake provider's deferred synthetic
  ready event lands a couple of seconds after the upload; the 5-second poll makes the flip visible
  without a reload and the `aria-live="polite"` region announces "Vídeo pronto." exactly once per
  row that reaches `ready`.
- **The poll is bounded by construction.** It is armed only while a row can still change, its
  elapsed check runs *before* the re-fetch, and after five minutes it stops and hands the member an
  explicit "Atualizar". That ordering is also why a Playwright `clock.fastForward` over the ceiling
  costs a handful of no-ops instead of seventy round trips — so **no test-only override ships in the
  component**.
- **Three player states and nothing raw.** A refused or expired token becomes the generic toast plus
  a ghost "Tentar novamente" that re-mints; a failed transcode is a danger pill and one catalog line
  with **no player frame at all**; and a grep pins the absence of `error.message`/`String(error)` in
  every render path.

## Task Commits

Each task was committed atomically:

1. **Task 1 (tracer): the shared cursor, the playback and list routes, and `/configuracoes/midia`** — `86b4cbb` (feat)
2. **Task 2: the resumable upload and the three-state player** — `e0885e1` (feat)
3. **Task 3: the remaining states, the role matrix and the repo's web gates** — `51509ba` (test)

**Commits measured, not narrated:** `git rev-list --count ec59798..HEAD` = **3**.

**Tracer feedback gate.** Auto mode is off (`auto_advance: false`, `_auto_chain_active: false`) and
`human_verify_mode` is `end-of-phase`; the tracer carries no `gate` attribute and its `<verify>` is
`<automated>`-only, so row 3 of the precedence chain applies: the verify chain was re-run end to end
(T1 chain + 295 integration + 14 Playwright, all green) and expansion continued without a
checkpoint.

## Files Created/Modified

- `packages/core/server/paging.ts` — `CURSOR_VERSION`, `encodeCursor`, `decodeCursor`, `KeysetCursor`.
  Pure and TOTAL: a tampered, truncated or stale cursor degrades to the first page by design.
- `packages/core/server/profiles/search.ts` — now a re-export; `MemberCursor` is an alias of the
  shared type. This is the only edit this plan makes to a 03-03 file.
- `packages/contracts/src/media.ts` — `mediaPlaybackSchema` (with the never-cache docblock),
  `mediaListQuerySchema`, `mediaListSchema`, `MEDIA_LIST_PAGE_SIZE`, `MEDIA_LIST_MAX_PAGE_SIZE`,
  `PLAYBACK_TOKEN_TTL_SECONDS` (2 h, above every allowed duration). `src/index.ts` untouched.
- `packages/contracts/src/errors.ts` + `packages/core/server/http/api-error.ts` — `CONFLICT`.
- `packages/core/server/media/service.ts` — `playbackTokens` and `listAssets`.
- `apps/api/src/routes/media.ts` — `GET /` first and `GET /{assetId}/playback` before the variant
  route, both `no-store`; the file's docblock now states that registration order is part of the contract.
- `packages/core/ui/nav.ts` — `film` in `ICONS`. No new nav tab this phase (R-11).
- `apps/web/app/(app)/configuracoes/page.tsx` — the `admin_tenant`-only "Administração" group.
- `apps/web/app/(app)/configuracoes/midia/{page,loading,MediaLibrary,actions}.tsx|ts` — the screen.
- `apps/web/components/media/{MediaAssetRow,VideoPlayer,VideoUploadField}.tsx` — the three components.
- `apps/web/lib/media.ts` — `getMediaAssets`, `loadMediaAssets`, `getPlaybackTokens`.
- `apps/web/lib/upload.ts` — `uploadChunked` plus the provider branch in `uploadBytes`.
- `apps/web/components/media/useSignedUpload.ts` — `onHandedToProvider` and kind-aware refusal copy.
- `apps/web/app/(app)/perfil/actions.ts` — `provider` added to the start action's answer.
- `apps/web/messages/pt-BR/{media,app}.json` — the video half of the catalog and the two new
  settings leaves.
- `apps/api/tests/integration/media-playback.test.ts` (19 cases), `apps/web/e2e/media-video.spec.ts`
  (17 cases × 2 projects), `apps/web/e2e/{admin.ts,fixtures/sample.mp4,fixtures/README.md}`.

## Decisions Made

- **`@mux/upchunk`'s `chunkSize` is in KiB, not bytes.** Verified in `dist/upchunk.mjs`
  (`chunkByteSize = chunkSize * 1024`, with `DEFAULT_MIN_CHUNK_SIZE = 256` and
  `DEFAULT_MAX_CHUNK_SIZE = 512` — both KiB), not taken from a README. The plan's `5120` is therefore
  5 MiB, a 256 KiB multiple inside the library's own bounds, and a non-multiple would be rejected at
  construction.
- **`tokens` on `<mux-player>` is a property-only path.** `set tokens` stores the object in a private
  field and never reflects a `playback-token` attribute (`dist/base.mjs`). The plan's acceptance
  criterion expected an attribute; the e2e reads the element's own `tokens.playback` getter instead,
  which is what actually proves a token reached the player. **This is the third RESEARCH/plan
  assumption about this vendor corrected against published source** — after 03-04's TUS endpoint and
  03-06's `signPlaybackId` key names.
- **The player only derives a still when the thumbnail token's `aud` is `'t'`** (a fourth such
  correction). Its thumbnail-URL builder returns `undefined` when a token is present whose decoded
  `aud` is anything else, and the fake provider mints deterministic non-JWT tokens — so locally the
  player never builds a poster at all. `VideoPlayer` therefore models three cases, reports which one
  happened through `data-poster`, and reaches "no poster" in the two that matter. The real-token path
  is broken-windows entry 14.
- **A provider-owned upload skips `complete`.** `completeUpload` re-reads the object from Storage and
  decodes it as an image or a PDF; for a fake-brokered video (whose bytes really are in the private
  bucket) that path would call `inspectPdf` on an MP4 and flip a perfectly good asset to `rejected`.
  The hook now branches on `started.upload.provider` and calls `onHandedToProvider` instead.
- **The not-found e2e asserts the screen, not the status.** Adding `loading.tsx` — Task 3's own
  requirement — makes the route stream, so the shell commits `200` before the server component
  reaches `notFound()`. The status of a streamed shell is an implementation detail of rendering; the
  isolation rule is that the screen is not there and no refusal is explained, and that is what the
  assertions now pin.
- **`pickVideo` is the hydration gate.** The same `loading.tsx` puts the client island behind a
  Suspense boundary, so a bare `setInputFiles` can land on server-rendered HTML where nothing is
  listening — 03-04 documented exactly this trap for the photo zone. The file now goes through the
  real "Enviar vídeo" → `filechooser` path, which cannot resolve before React's own `onClick` ran.
- **The poll ceiling is driven by Playwright's clock**, not by a `pollCeilingMs` prop. The plan asked
  for "the ceiling overridable for tests"; shipping a test-only prop in a production component is
  worse than using the harness's own clock, and the poll's elapsed-check-before-refetch ordering
  makes `fastForward` cheap.
- **`MediaAssetRow` takes `timeZone` as a prop** defaulting to `America/Sao_Paulo` (the
  `tenants.timezone` column default). `bootstrapSchema.tenant` carries no `timezone` field, and
  widening the bootstrap contract was out of this plan's blast radius; when a later phase adds it the
  screen passes it and nothing else changes.
- **The player sheet is located by `[aria-modal="true"]` in tests.** `<mux-player>` mounts its own
  `<media-error-dialog role="dialog">`, so a bare `getByRole('dialog')` is ambiguous whenever a
  player is open.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `CONFLICT` was not a member of `ERROR_CODES`**
- **Found during:** Task 1 (the service's `not_ready` branch)
- **Issue:** The plan's action text says `throw new ApiError(409, 'CONFLICT', { media: 'not_ready' })`,
  but `ErrorCode` had no `CONFLICT` member, so the kernel did not typecheck.
- **Fix:** Added `'CONFLICT'` to `ERROR_CODES` with its pt-BR message in `ERROR_MESSAGES` (the one
  exhaustive map over the union). `bootstrapRedirectPath`'s switch has a `default`, so no web branch
  needed changing.
- **Files modified:** `packages/contracts/src/errors.ts`, `packages/core/server/http/api-error.ts`
- **Verification:** `pnpm --filter @rede-social/contracts typecheck`, `@rede-social/core typecheck`, and the 409
  integration case.
- **Committed in:** `86b4cbb`

**2. [Rule 1 - Bug] A video upload would have been rejected by `complete`**
- **Found during:** Task 2 (reusing `useSignedUpload` for video)
- **Issue:** The plan says to reuse the hook UNCHANGED, but the hook always calls
  `completeMediaUploadAction`. For a video that path re-reads the object and, because the kind is not
  `image`, runs `inspectPdf` on it — which throws and flips the row to `rejected` with the object
  deleted. The real Mux path would 404 (`object_missing`) instead. Either way the admin would be told
  a successful upload failed.
- **Fix:** Added `onHandedToProvider` to the hook and branched on `started.upload.provider`; the
  provider path never calls `complete`, because the provider owns the object and its webhook is what
  moves the row to `ready`. `AvatarUploadField` is untouched, and the acceptance criterion that
  `VideoUploadField` must not FORK the hook still holds (it reuses it).
- **Files modified:** `apps/web/components/media/useSignedUpload.ts`,
  `apps/web/app/(app)/perfil/actions.ts` (the start action now returns `provider`),
  `apps/web/lib/upload.ts` (`StartedUpload.provider`), plus the two test fixtures that construct that shape.
- **Verification:** the end-to-end upload e2e reaches `Pronto`; 82 web unit tests pass.
- **Committed in:** `e0885e1`

**3. [Rule 2 - Missing Critical] The video zone said "Use JPEG, PNG ou WebP."**
- **Found during:** Task 2 (the pick-time refusal)
- **Issue:** `useSignedUpload`'s `type_not_allowed` copy is the photo sentence. The UI-SPEC gives the
  video zone its own line and `media.json` already carried `errors.videoType`, but nothing selected it.
- **Fix:** The refusal copy is now chosen by KIND inside the hook, so the advice matches what the
  member is actually holding.
- **Files modified:** `apps/web/components/media/useSignedUpload.ts`
- **Verification:** the `.gif` e2e asserts the exact video sentence.
- **Committed in:** `e0885e1`

### Acceptance criteria whose NOTATION did not match the repo's conventions

Three greps in the plan assume a spelling the repo does not use. The behaviour each was reaching for
is present and verified; the criterion's literal string is not, and that is recorded rather than
worked around:

1. **Task 1 — `apps/web/app/(app)/configuracoes/page.tsx` contains `'film'`.** The file contains
   `icon="film"`. JSX attributes are double-quoted by Biome, as every sibling row is
   (`icon="user-circle"`, `icon="bell"`). Using `icon={'film'}` to satisfy a grep would make this one
   row inconsistent with the file.
2. **Task 2 — `VideoUploadField.tsx` contains `video/mp4`.** The component derives its `accept` with
   `mediaAcceptFor('video', 'post')` from `MEDIA_LIMITS` — the same single source the server
   validates against, and the same call `AvatarUploadField` makes. Hard-coding the mime list would
   create a second place for it to drift. The e2e now pins the rendered value instead:
   `toHaveAttribute('accept', 'video/mp4,video/quicktime')`.
3. **Task 2 — `VideoUploadField.tsx` contains `role="alert"`.** The alert is emitted by
   `FileDropZone`'s own `error` slot (`<p role="alert" class="text-sm text-danger">` in
   `packages/ui/src/primitives/FileDropZone.tsx`), which is exactly what the UI-SPEC's Upload
   contract specifies ("the message renders **inside** the zone's `error` slot"). A second alert
   region in this file would mean two live regions on one zone. The grep passes only because a
   comment names the mechanism; **the string is not the proof — the e2e assertion on the zone's alert
   text is.**

### Plan text corrected against published source

- **Task 2's `<MuxPlayer …/>` acceptance criterion expects a `playback-token` attribute.** The
  element does not reflect one (see Decisions). The e2e reads the element's `tokens` getter.

---

**Total deviations:** 3 auto-fixed (1 blocking, 1 bug, 1 missing critical) plus 4 recorded
criterion/notation mismatches.
**Impact on plan:** All three auto-fixes were required for the plan's own behaviour to work; none
widened scope. The notation mismatches changed no behaviour.

## Issues Encountered

- **`next build` and `next dev` share `apps/web/.next`.** Task 3's verify chain runs the production
  build before the Playwright segment, and Playwright reuses a running dev server. Running the build
  against a live dev server left a tree that produced eight spurious e2e failures. Recovered by
  killing the dev server and removing `.next` before the e2e segment. Worth knowing for 03-08's
  `pnpm verify`, which runs `build` and `e2e` in one chain.
- **Blocking service workers in Playwright surfaces a pre-existing unhandled rejection** in the
  Serwist registration component (it reads `.waiting` off a rejected `register()`). The block was
  reverted — it was not needed once the assertions moved off `response.status()` — and the defect is
  recorded in `deferred-items.md` for Phase 7 or 8.

## Known Stubs

None. The stub scan over all 31 changed files found no `TODO`/`FIXME`/placeholder, no skipped or
`todo` test, and no hardcoded empty value flowing to a rendered surface. The two "placeholder"
matches are pre-existing prose in a Phase 2 docblock and a test comment.

## Broken-windows ledger

- **Entry 14 recorded** (`unrun-verify`, `apps/web/components/media/VideoPlayer.tsx`): the
  poster/still half of the ready player has never rendered a real image, because the local fake's
  non-JWT thumbnail tokens make the player decline to derive one. Closed by the Phase 01.1 Mux
  runbook alongside entry 12.
- **Entry 13 is half closed, and deliberately left open.** It reads "`signPlayback` and `getAsset`
  are wired to no route yet". This plan routes `signPlayback`; `getAsset` still has no caller (it
  waits for a reconciliation job). Marking the entry `fixed` would misreport `getAsset`, so it stays
  open and the remaining half is recorded in `deferred-items.md`.

## Threat Flags

None. Every surface this plan adds is already in the plan's own STRIDE register: the two routes
(T-03-46/47/48/49/52), the minted token as a credential valid outside our infrastructure (T-03-47),
the player's refusal vocabulary (T-03-51) and the browser→provider upload (T-03-SC). The three new
server actions are thin wrappers over those routes with `z.uuid()` validation and catalog-key
refusals; `removeAssetAction` calls the pre-existing `DELETE /v1/media/{assetId}`, whose tenant check
is unchanged. The new `e2e/admin.ts` helpers use the superuser fixture connection that file already
owns and are never reachable from application code.

## Verification

| Gate | Result |
|---|---|
| `pnpm --filter @rede-social/contracts typecheck` | pass |
| `pnpm --filter @rede-social/core typecheck` / `lint` | pass |
| `pnpm --filter @rede-social/core test -- profiles-search` | 189 tests pass (the cursor lift changed nothing) |
| `pnpm --filter @rede-social/api typecheck` / `lint` | pass |
| `pnpm --filter @rede-social/web typecheck` / `lint` / `test` | pass (82 tests) |
| `bash scripts/check-ui-literals.sh` | pass |
| `pnpm --filter @rede-social/web build` | pass |
| `bash scripts/check-static-routes.sh` | pass — `/configuracoes/midia` builds as `ƒ`, 0 offenders |
| `pnpm boundaries` | pass — 414 files, 7 packages |
| `pnpm test:integration -- media-playback members` | 295 tests pass across 21 files |
| `pnpm --filter @rede-social/web exec playwright test media-video.spec.ts` | 34 pass (17 cases × 2 projects) |
| `grep -rln "@mux/mux-node"` over source | exactly `packages/core/server/media/video/mux.ts` |
| `grep -rln "@mux/mux-player-react" apps/web/` | exactly `apps/web/components/media/VideoPlayer.tsx` |

`pnpm verify` was deliberately NOT run — the plan assigns T3 to 03-08 Task 3 alone.

## User Setup Required

None — no new external service configuration. The five Mux secrets and their runbook were recorded
by 03-06 in `docs/DEPLOY.md` and are unchanged.

## Next Phase Readiness

- **03-08 (sweeper + isolation suite + exit gate)** — lift the three cross-tenant cases from
  `media-playback.test.ts` (`describe('cross-tenant refusal …')`) into `isolation.test.ts`; they are
  written against the seeded `rede-demo`/`rede-lab` pair that file already uses. The sweeper must call
  `videoProvider.deleteAsset` for a collected video carrying a `provider_asset_id`. Two known-blocked
  UAT lines carry forward: the real Mux transcode and real-device HLS (windows 12), and the real
  poster/still (window 14).
- **Phase 4 (feed)** — render a post's video as `<VideoPlayer assetId status />`; it fetches its own
  token and owns all three states, so the composer needs no video logic. Widening `GET /v1/media`
  beyond `admin_tenant` is the single `ctx.role !== 'admin_tenant'` predicate in `listAssets`.
- **Phase 5 (stories)** — `MEDIA_LIMITS.video.story.maxDurationSeconds` is already 60 and the ready
  handler already enforces it; a story player is `VideoPlayer` in a different frame.
- **Phase 7 (realtime)** — replace `MediaLibrary`'s poll with a Broadcast subscription on the
  tenant's channel. The row-state contract, the merge and the live region do not change; only the
  `useEffect` that arms the interval goes away.
- **Phase 8 (hardening)** — the "Recusado" and "Falhou" rows are where an admin-facing retry or a
  quota readout lands. Both `deferred-items.md` entries (the service-worker registration rejection
  and the unwired `getAsset`) belong here or in Phase 7.

## Self-Check: PASSED

All 12 created files exist on disk; all three task commits (`86b4cbb`, `e0885e1`, `51509ba`) are in
`git log`; every task's `<acceptance_criteria>` was re-run (the four notation mismatches are
documented above with the behaviour verified another way); and every plan-level `<verification>`
command was re-run with the results in the table above.

---
*Phase: 03-media-pipeline-member-profiles*
*Completed: 2026-09-22*
