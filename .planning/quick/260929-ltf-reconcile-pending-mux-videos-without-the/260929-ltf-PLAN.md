---
phase: quick-260929-ltf
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/core/server/media/video/types.ts
  - packages/core/server/media/video/mux.ts
  - packages/core/server/media/video/fake.ts
  - packages/core/server/media/video/reconcile.ts
  - packages/core/server/media/service.ts
  - apps/api/tests/integration/media-reconcile.test.ts
  - apps/web/app/(app)/criar/ComposerForm.tsx
  - apps/web/app/(app)/criar/ComposerForm.test.tsx
  - apps/web/messages/pt-BR/feed.json
  - apps/web/components/media/useAssetReadiness.ts
  - packages/core/tests/media-video-mux.test.ts
  - packages/core/server/media/sweep-job.ts
  - apps/api/tests/integration/media-sweeper.test.ts
autonomous: true
requirements: [MEDIA-03, FEED-01, FEED-03]
tags: [mux, video, reconciliation, drizzle, pg-boss, nextjs, react-hooks, next-intl, vitest]

estimate:
  tokens: 130000
  raw_tokens: 130000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "GET /v1/media/{assetId} on a video the caller may read (uploader or admin_tenant) that is pending or processing, brokered by the ACTIVE provider, carrying a provider upload id and older than 15 s asks the provider directly. When the provider reports the asset ready, that same response already says ready, and the row holds the provider ASSET id, playback id, duration and aspect ratio, exactly what the webhook path writes"
    - "When the provider reports the asset errored or the upload errored, the row becomes failed with failure_reason equal to the event type (video.asset.errored / video.upload.errored). A ready video longer than the purpose cap becomes rejected with duration_too_long and its provider asset is deleted. Both are the same transitions the kernel.media-provider-event job applies, because reconciliation runs that job's own handler on a synthesized normalized event"
    - "Reconciliation and the webhook are idempotent in both orders: a late webhook after reconciliation changes nothing (same playback id, same ready_at), and a video the webhook already made ready causes zero provider lookups on GET"
    - "Provider lookups are throttled to at most one per asset per API instance per 10 s. There are none inside the 15 s grace, none for a caller refused with 404, and none for images, terminal rows, rows of another provider or rows without a provider upload id"
    - "A provider error or timeout during reconciliation never fails the GET: it answers 200 with the current row and logs media.reconcile.lookup_failed carrying only the error kind and status"
    - "In the feed composer (/criar), a video handed to the provider is polled with useAssetReadiness. While it is not ready, the player shows its processing card, the helper 'Aguarde o vídeo terminar de processar para publicar.' is shown, and Publicar is disabled. At ready the helper disappears and Publicar sends that video's asset id. A failed or rejected video shows the player's failed state and Publicar stays disabled, so submitting sends nothing"
    - "In edit mode (/post/[postId]/editar), a post whose video is already ready does not poll and does not block Salvar alterações"
    - "The hourly kernel.media-sweep-orphans run reconciles pending/processing videos older than 5 min BEFORE it collects orphans, so a video the provider finished is never purged as an abandoned upload"
    - "No database migration is added. The webhook route, its signature verification, the Mux upload creation, event-job.ts, wire.ts, inbox.ts, the feed API rule (validateAssets) and the stories publish rule are unchanged"
  artifacts:
    - path: "packages/core/server/media/video/types.ts"
      provides: "VideoUploadState union + VideoProvider.getUploadState(providerUploadId)"
      contains: "getUploadState"
    - path: "packages/core/server/media/video/mux.ts"
      provides: "getUploadState via video.uploads.retrieve → asset_id → video.assets.retrieve, bounded request options"
      contains: "uploads.retrieve"
    - path: "packages/core/server/media/video/fake.ts"
      provides: "getUploadState driven by fakeVideoInternals.uploadState (default waiting) with a call recorder"
      contains: "uploadStateCalls"
    - path: "packages/core/server/media/video/reconcile.ts"
      provides: "reconcileVideoAsset(row), eventFromUploadState(...), grace/throttle constants, reconcileInternals clock seam"
      contains: "export async function reconcileVideoAsset"
    - path: "packages/core/server/media/service.ts"
      provides: "getAsset reconciles an eligible stale video after authorization, then re-reads the row"
      contains: "reconcileVideoAsset("
    - path: "apps/api/tests/integration/media-reconcile.test.ts"
      provides: "Integration matrix L1-L9 for reconcile-on-read through the fake provider"
    - path: "apps/web/app/(app)/criar/ComposerForm.tsx"
      provides: "Video readiness poll, live player status, Publicar gated on a ready video, helper copy"
      contains: "useAssetReadiness("
    - path: "apps/web/app/(app)/criar/ComposerForm.test.tsx"
      provides: "Composer cases C1-C6 (waiting, ready, failed, rejected, edit-ready, edit-failed, remove)"
    - path: "apps/web/messages/pt-BR/feed.json"
      provides: "composer.videoWaiting and composer.videoWaitingEdit copy"
      contains: "Aguarde o vídeo terminar de processar para publicar."
    - path: "packages/core/tests/media-video-mux.test.ts"
      provides: "Unit pin of the Mux adapter's getUploadState mapping with the SDK mocked"
    - path: "packages/core/server/media/sweep-job.ts"
      provides: "Reconcile pass over stale pending/processing videos before collecting orphans"
      contains: "reconcileVideoAsset("
  key_links:
    - from: "packages/core/server/media/service.ts"
      to: "packages/core/server/media/video/reconcile.ts"
      via: "getAsset calls reconcileVideoAsset(row) after isOwnerOrAdmin, re-reads via loadOwnAsset when it returns true"
      pattern: "reconcileVideoAsset\\("
    - from: "packages/core/server/media/video/reconcile.ts"
      to: "packages/core/server/media/video/event-job.ts"
      via: "mediaProviderEventJob.handler(synthesized VideoProviderEvent): the webhook's own transition code"
      pattern: "mediaProviderEventJob\\.handler\\("
    - from: "packages/core/server/media/video/reconcile.ts"
      to: "packages/core/server/media/video/types.ts"
      via: "videoProvider.getUploadState(row.providerAssetId)"
      pattern: "getUploadState\\("
    - from: "apps/web/app/(app)/criar/ComposerForm.tsx"
      to: "apps/web/components/media/useAssetReadiness.ts"
      via: "useAssetReadiness(video asset id while its status is pending/processing, else null)"
      pattern: "useAssetReadiness\\("
    - from: "packages/core/server/media/sweep-job.ts"
      to: "packages/core/server/media/video/reconcile.ts"
      via: "reconcile pass before collectable()"
      pattern: "reconcileVideoAsset\\("
---

<objective>
Fix the 2026-09-29 production follow-up to quick 260929-ka5.

1. **The webhook is fragile.** A Cloud Run revision swap closed Mux's pooled connections. Webhook deliveries failed for 14 minutes, and two videos Mux already had `ready` sat `pending` in `media_assets`.
2. **The feed composer spins forever.** It sets the picked video to `processing` once and never re-reads it.
3. **The feed API refuses the post.** It accepts only `ready` (or `processing`), but a Mux video is `pending` until it becomes ready. So "Publicar" stayed enabled and the API answered 400 `asset_not_usable` three times.

This plan:
- **(A) Reconciles on read, with no webhook.** `GET /v1/media/{assetId}` asks the provider about a stale pending video, through the `VideoProvider` seam. It applies the answer through the SAME `kernel.media-provider-event` handler the webhook uses. The call is throttled and idempotent against a late webhook.
- **(B) Makes the feed composer poll.** It uses `useAssetReadiness` and disables Publicar until the video is `ready`. This is the user's locked option (b): the API rule stays.
- **(C) Adds a cheap hourly sweeper pass.** A video nobody polls still converges, and a finished video is never purged as an abandoned upload.

**NO DATABASE MIGRATION IS ADDED.** The Mux upload id is ALREADY persisted at upload start: `startVideoUpload` writes `upload.providerUploadId` into `media_assets.provider_asset_id` (service.ts ~lines 287-292), and `mux-webhook.test.ts` ~line 279 asserts it is set right after start. The ready transition later overwrites it with the Mux ASSET id. So while a video is `pending`/`processing`, `provider_asset_id` IS the upload id. The problem statement assumed the column was empty on a pending row, and that is not what the code does. Deploying this needs only the API image (API + worker, same image) and the Vercel web build. There is no `supabase db push`.

Purpose:
- An admin's video becomes usable as soon as the provider finishes, even when the webhook is late.
- The feed composer tells the truth about the video and never offers a publish the API will refuse.

Output:
- a provider seam method (fake + mux) and a reconcile module;
- `getAsset` wiring and an integration matrix;
- composer wiring, copy and unit tests;
- a Mux adapter unit pin and the sweeper pass with integration cases.
</objective>

<execution_context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/workflows/execute-plan.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@.planning/quick/260929-ka5-story-composer-polls-video-readiness-ins/260929-ka5-SUMMARY.md

Live observations at planning time (HEAD e5a0047). These are the edit-scope authority.

**The provider seam** (`packages/core/server/media/video/`)
- `types.ts`: `VideoProvider` has `createDirectUpload`, `getAsset`, `deleteAsset`, `signPlayback` and `verifyWebhook`.
  - `VideoAssetInfo` (`providerAssetId`, `status: 'preparing'|'ready'|'errored'`, `playbackId`, `durationSeconds`, `aspectRatio`) is documented as "used by a future reconciliation job". Nothing calls `videoProvider.getAsset` today.
  - The `VideoDirectUpload.providerUploadId` doc says it is "stored as `media_assets.provider_asset_id`".
- `mux.ts` is the ONLY file importing `@mux/mux-node` (grep-verified).
  - `getAsset` maps `mux.video.assets.retrieve` (rounds `duration`, first `playback_ids[0].id`, status ready/errored else preparing).
  - `toProviderError` maps 401/403 → unauthorized, 404 → not_found, 429 → rate_limited, else unavailable. It never reads a body.
  - SDK 15.2.0: `video.uploads.retrieve(uploadID, options?)` returns `Upload { id, status: 'waiting'|'asset_created'|'errored'|'cancelled'|'timed_out', asset_id?: string }`. `RequestOptions` has `timeout?` (ms) and `maxRetries?`.
- `fake.ts`:
  - `fakeVideoInternals` holds `durationSeconds`, `aspectRatio`, `deletedAssetIds`, `failDeleteAsset`, `signUpload` and `scheduleReady`, and `resetFakeVideoInternals()` restores them.
  - `createDirectUpload` returns `providerUploadId = fake-<assetId>` and schedules a deferred synthetic ready job 2 s later.
- `event-job.ts`:
  - `mediaProviderEventJob.handler(payload)` zod-parses a `VideoProviderEvent` (`durationSeconds` must be an int or null).
  - It returns early on `ignored`, resolves the row by `event.assetId` and then by `providerAssetId`, and runs `applyReady` / `applyErrored`.
  - `applyReady`: when the duration cap is exceeded it deletes the provider asset and sets `rejected` + `duration_too_long`. Otherwise it writes the playback id, `providerAssetId` (the asset id), duration, aspect ratio, `ready` and `ready_at`, under `status not in ('ready','deleted')`.
  - `applyErrored`: `failed` with `failureReason` equal to the event type, under the same predicate.
  - The handler never throws. `mux-webhook.test.ts` and `media-playback.test.ts` already call `mediaProviderEventJob.handler(event)` directly.
- `wire.ts` exports `VIDEO_EVENT_TYPES = { ready: 'video.asset.ready', assetErrored: 'video.asset.errored', uploadErrored: 'video.upload.errored' }`. Upload cancelled / timed_out normalize to `ignored`, which applies nothing.

**The media broker** (`packages/core/server/media/service.ts`)
- `AssetRow` (~92-111) and `ASSET_COLUMNS` (~113-131) do NOT include `provider` or `providerAssetId`.
- `assetView(row)` builds the payload field by field, so extra row fields never reach the API.
- `loadOwnAsset` (~460) is the RLS tenant-lane select. `isOwnerOrAdmin` (~472).
- `getAsset(ctx, assetId)` (~522-539): load, 404 on miss, 404 plus a `media.read_refused` log for a non-owner non-admin, then `assetView(row)`.

**The sweeper** (`packages/core/server/media/sweep-job.ts`)
- `collectable()` selects `pending` rows older than 24 h, and `deleted`/`rejected` rows older than 1 h, `MEDIA_SWEEP_BATCH = 100`.
- `purgeAsset` then calls `videoProvider.deleteAsset(row.providerAssetId)`. For a pending Mux row that is the UPLOAD id, so Mux answers 404, the adapter treats that as success, and a finished Mux asset would be orphaned. The reconcile pass closes this.
- The sweeper re-arms hourly.

**The feed composer** (`apps/web/app/(app)/criar/ComposerForm.tsx`, 988 lines)
- Docblock ~76-79 says a transcoding video IS publishable. `PickedVideo = { assetId, status: MediaStatus }` (~130).
- `onHandedToProvider` sets `status: 'processing'` once (~252-255). The `uploading` comment is at ~288-291.
- `publishable` (~301). The submit Button is `disabled={!publishable || busy}` (~537-548).
- The video block is `<VideoPlayer assetId status>` plus "Remover vídeo" (~821-839).
- Edit mode receives `initial.video = { assetId, status }` from `lib/feed-view.tsx` `composerDraft`.
- The create body carries `videoAssetId`. There is NO ComposerForm unit test today.
- `apps/web/e2e/feed-composer.spec.ts` never publishes a video, so no e2e change is needed.

**Feed API** (`packages/modules/feed/server/service.ts` `validateAssets` ~618-621): a video is usable only when `ready` or `processing`. It stays UNCHANGED (locked decision b).

**Web helpers**
- `apps/web/components/media/useAssetReadiness.ts` (ka5) returns `idle | waiting | ready | failed{issue}`, with a 2 s → 10 s backoff. Its docblock says publishing is allowed while waiting, which is true for stories only.
- `StoryComposer.test.tsx` mocks `@/components/media/useAssetReadiness` and `@/components/media/useSignedUpload` at their seams, and reads the real catalogs through `vi.hoisted`. It is the harness pattern to copy.
- `VideoPlayer` renders the failed card for `failed`/`rejected` and the processing card for any other non-ready status.

**Catalog**
- `apps/web/messages/pt-BR/feed.json` has the `composer` block at ~130-167.
- `media.json` has `errors.duration` / `errors.transcode`.

**Local environment**
- The local DB still carries the pre-rename seed (tenants `tria-demo`/`tria-lab`, verified with psql). Integration files that sign in seeded users must run through a throwaway copy with `rede-`→`tria-` swapped (the ka5 procedure). Do NOT run `pnpm db:reset` or `pnpm db:seed`.
- The disk has about 2 GiB free: no `next build`, no full turbo build, no Playwright. If ENOSPC appears, `rm -rf .turbo/cache`.
- `apps/api/vitest.config.ts` forces `VIDEO_PROVIDER=fake`, `fileParallelism: false`. `api` in `tests/integration/setup.ts` is the in-process app, so `fakeVideoInternals` is shared with the server under test.

**Locked decisions** (from the user, via the orchestrator)
1. A no-webhook fallback.
2. The feed composer polls.
3. Option (b): a feed post REQUIRES a ready video. Keep the API rule, and disable Publicar with an explanation. Failed or rejected blocks. Stories keep publish-while-processing.
4. The webhook stays primary. Do NOT change the webhook route, its signature verification, or the Mux upload creation.

**Choice justification (A):** read the upload through the id we already persist. The chain is `uploads.retrieve(uploadId)` → `asset_id` → `assets.retrieve(assetId)`. It needs no migration and no new column. It is robust to a missing `passthrough` echo, and it is the SDK's documented lookup. Listing assets and filtering by passthrough would be O(assets) and unindexed.

The transition is applied by calling `mediaProviderEventJob.handler` with a synthesized normalized event, rather than by extracting a function. That leaves `event-job.ts` byte-identical, and the zod payload schema validates the synthesized event exactly as it validates a webhook's. The synthesized event id is NEVER inserted into `media_provider_events`, the webhook's replay ledger of PROVIDER event ids. Idempotency comes from the row predicate `status not in ('ready','deleted')` that both paths share.

Commits: `feat(quick-260929-ltf): …` / `fix(quick-260929-ltf): …`, one per task, with NO Co-Authored-By trailer (user rule for this public repo).
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Reconcile-on-read end to end: provider seam getUploadState → reconcile.ts → mediaProviderEventJob.handler → getAsset → GET /v1/media/{assetId}</name>
  <files>packages/core/server/media/video/types.ts, packages/core/server/media/video/mux.ts, packages/core/server/media/video/fake.ts, packages/core/server/media/video/reconcile.ts, packages/core/server/media/service.ts, apps/api/tests/integration/media-reconcile.test.ts</files>
  <read_first>
    - packages/core/server/media/video/types.ts (whole file, 142 lines)
    - packages/core/server/media/video/mux.ts (whole file, 166 lines)
    - packages/core/server/media/video/fake.ts (lines 60-145: fakeVideoInternals, reset, syntheticReadyEvent, createDirectUpload, getAsset)
    - packages/core/server/media/video/event-job.ts (whole file: the handler you will call, NOT edit)
    - packages/core/server/media/video/wire.ts (lines 20-30: VIDEO_EVENT_TYPES)
    - packages/core/server/media/service.ts (lines 83-131 log/Ctx/AssetRow/ASSET_COLUMNS; 287-292 upload id persisted; 460-539 loadOwnAsset, isOwnerOrAdmin, getAsset)
    - apps/api/tests/integration/media-playback.test.ts (lines 1-136: imports, seedVideo, cleanup, beforeAll/afterAll; lines 454-470: GET case shape)
  </read_first>
  <behavior>
    A new file, `apps/api/tests/integration/media-reconcile.test.ts`, copies the harness of `media-playback.test.ts`: sign in `admin@rede-demo.local` and `member@rede-demo.local`, resolve the `rede-demo` tenant id, keep a `createdAssetIds` cleanup, and in `afterAll` call `resetFakeVideoInternals()`, `resetReconcileInternals()`, `stopBoss()` and `adminSql.end()`.
    Its `seedVideo` inserts through `adminSql` with these parameters:
    - `status`, default `pending`;
    - `purpose`, `post` or `story`;
    - `provider`, default `fake`;
    - `providerAssetId`, default `fake-up-<uuid>`, nullable;
    - `ageSeconds`, with `created_at = now() - make_interval(secs => ageSeconds)`;
    - the owner email.
    `beforeEach` resets both internals. `fakeVideoInternals.uploadState` is set per case, and `fakeVideoInternals.uploadStateCalls` is asserted.
    - L1 (tracer): a pending post video 60 s old, where the seam answers `{ state: 'asset', asset: { providerAssetId: 'fake-asset-<uuid>', status: 'ready', playbackId: 'fake-pb-<uuid>', durationSeconds: 12, aspectRatio: '9:16' } }`. The admin GET answers 200, `mediaAssetSchema`-valid, `status === 'ready'`, `durationSeconds === 12`, `aspectRatio === '9:16'`. The DB row has `status 'ready'`, `provider_asset_id` equal to the ASSET id (not the upload id), `playback_id 'fake-pb-…'`, `ready_at` not null and `failure_reason` null. `uploadStateCalls` equals `[the upload id]`.
    - L2 (late webhook is a no-op): after L1's reconciliation, run `mediaProviderEventJob.handler` with a ready event for the same asset: a different event id, `playbackId 'webhook-pb'`, `durationSeconds 30`. The row keeps `playback_id 'fake-pb-…'`, `duration_seconds 12` and the SAME `ready_at`.
    - L3 (webhook first → no lookup): a pending video 60 s old. Run `mediaProviderEventJob.handler` with a ready event first, then GET. The answer is ready, and `uploadStateCalls` is empty.
    - L4 (grace): a pending video 0 s old, with the seam answering ready. GET answers pending, and `uploadStateCalls` is empty.
    - L5 (throttle): a pending video 60 s old, with the seam answering `{ state: 'waiting' }`.
      - GET twice: both answer pending, and `uploadStateCalls.length === 1`.
      - Set `reconcileInternals.now` to real time + 10_001 ms, then GET: `uploadStateCalls.length === 2`.
      - An asset preparing answer (`{ state: 'asset', asset: { status: 'preparing', … } }`) also leaves the row pending.
    - L6 (provider error): the seam throws `new VideoProviderError('unavailable', 503)`. GET answers 200, is `mediaAssetSchema`-valid, and says `status === 'pending'`.
    - L7 (errored): the seam answers an asset with `status: 'errored'`, so the row becomes `failed` with `failure_reason 'video.asset.errored'`. On another row the seam answers `{ state: 'errored' }`, so the row becomes `failed` with `failure_reason 'video.upload.errored'`. Both GETs answer the failed status.
    - L8 (duration cap = webhook rule): a pending STORY video, where the seam answers ready with `durationSeconds 61` (story cap is 60). GET answers `status 'rejected'` and `failureReason 'duration_too_long'`, and `fakeVideoInternals.deletedAssetIds` equals `[the ASSET id]`.
    - L9 (eligibility and authorization before any lookup), each case asserting `uploadStateCalls` stays empty:
      - a pending video 60 s old with `provider 'mux'` (not the active fake), read by the admin → pending;
      - a pending video with `provider_asset_id` null → pending;
      - a `failed` video → failed;
      - a stale pending video owned by the ADMIN, read by the MEMBER → bare 404 NOT_FOUND.
  </behavior>
  <action>
    This task implements requirement A. It follows the user's locked decisions 1 (no-webhook fallback) and 4 (webhook stays primary: do not touch the webhook route, signature verification or upload creation).
    Write `media-reconcile.test.ts` first. It must fail (RED). Then implement:

    (1) `types.ts`
    - Add the exported union `VideoUploadState`:
      - `{ state: 'waiting' }`, which also covers a cancelled or timed-out upload (the webhook path applies nothing for those either, and the 24 h sweeper collects them);
      - `{ state: 'errored' }`, the upload itself failed;
      - `{ state: 'asset'; asset: VideoAssetInfo }`.
    - Add `getUploadState(providerUploadId: string): Promise<VideoUploadState>` to the `VideoProvider` interface. Its doc says:
      - the id is the one `startUpload` recorded in `provider_asset_id` while the asset is pending;
      - the method must throw only a `VideoProviderError`;
      - it exists for reconciliation when a webhook is late (quick-260929-ltf).
    - Update the interface docblock's capability list (read an upload's state) and the `VideoAssetInfo` comment (now used by reconciliation). Name no vendor in new prose.

    (2) `mux.ts`
    - Move the body of `getAsset` into a local `retrieveAsset(id, options?)`. `getAsset` delegates to it unchanged.
    - Add a module constant for the lookup request options: `timeout` 4_000 ms, `maxRetries` 0. The GET path must stay fast, and the poller retries on its own.
    - `getUploadState` calls `mux.video.uploads.retrieve(id, LOOKUP)`. Then:
      - a non-empty `asset_id` → `{ state: 'asset', asset: await retrieveAsset(asset_id, LOOKUP) }`;
      - else `status === 'errored'` → `{ state: 'errored' }`;
      - else → `{ state: 'waiting' }`.
    - Errors: rethrow a `VideoProviderError` as is, and map anything else through `toProviderError`.
    - Do not touch `createDirectUpload`, `verifyWebhook`, `signPlayback` or `deleteAsset`.

    (3) `fake.ts`
    - Add two fields to `fakeVideoInternals`:
      - `uploadState: (providerUploadId: string) => Promise<VideoUploadState>`, defaulting to an async function answering `{ state: 'waiting' }`;
      - `uploadStateCalls: string[]`, defaulting to empty.
    - Restore both in `resetFakeVideoInternals`.
    - The fake's `getUploadState(id)` pushes `id` onto `uploadStateCalls`, then returns `await fakeVideoInternals.uploadState(id)`.
    - Docblock: the default is `waiting` on purpose. The fake's transcode is the deferred synthetic ready job, so a reconciliation that nobody configured must be a no-op, and no existing suite changes behaviour.

    (4) NEW `packages/core/server/media/video/reconcile.ts`
    Imports:
    - `videoProvider` from `./index`;
    - `mediaProviderEventJob` from `./event-job`;
    - `VIDEO_EVENT_TYPES` from `./wire`;
    - the `VideoProviderEvent` / `VideoUploadState` types;
    - `moduleLogger` from `../../logging`.
    It must not import the admin lane or the vendor SDK.
    Exports:
    - `RECONCILE_GRACE_MS = 15_000` and `RECONCILE_MIN_INTERVAL_MS = 10_000`.
    - `type ReconcilableVideo = { id; tenantId; kind; status; provider; providerAssetId: string | null; createdAt: Date }`.
    - `reconcileInternals = { now: () => Date.now() }` and `resetReconcileInternals()`. The reset restores `now` and clears the throttle map.
    - The pure function `eventFromUploadState(assetId, providerUploadId, state): VideoProviderEvent | null`:
      - `waiting` → null;
      - asset `preparing` → null;
      - asset `ready` → `{ id: 'reconcile:<assetId>:ready', kind 'ready', rawType VIDEO_EVENT_TYPES.ready, assetId, providerAssetId: asset.providerAssetId, playbackId, durationSeconds, aspectRatio, failureReason null }`;
      - asset `errored` → kind `errored`, rawType `VIDEO_EVENT_TYPES.assetErrored`, `providerAssetId` = the asset id, `failureReason` = that rawType, nulls elsewhere;
      - `errored` → kind `errored`, rawType `VIDEO_EVENT_TYPES.uploadErrored`, `providerAssetId` = the upload id, `failureReason` = that rawType.
    - `async function reconcileVideoAsset(row: ReconcilableVideo): Promise<boolean>`, which returns true only when an event was applied:
      1. Eligible only when ALL hold: `kind === 'video'`; `status` is `pending` or `processing`; `provider === videoProvider.name`; `providerAssetId` is non-null; and `reconcileInternals.now() - row.createdAt.getTime() >= RECONCILE_GRACE_MS`. Otherwise return false with no log.
      2. Throttle: a module-level `Map<assetId, lastLookupMs>`, checked and set SYNCHRONOUSLY before any await, so two concurrent polls on one instance make one lookup. Skip (return false) when the last lookup is under `RECONCILE_MIN_INTERVAL_MS` ago. When the map holds more than 1_000 entries, prune the entries older than the interval.
      3. Call `videoProvider.getUploadState(row.providerAssetId)` inside try/catch. On error, log a warn with event `media.reconcile.lookup_failed` (tenantId, assetId, provider, `err` = the error message; a `VideoProviderError` message carries only its kind and status, per T-03-41) and return false.
      4. Build the event with `eventFromUploadState`. If it is null, return false.
      5. `await mediaProviderEventJob.handler(event)`, wrapped in try/catch; on error, log a warn with `media.reconcile.apply_failed` and return false. The handler writes under `status not in ('ready','deleted')`, so a racing webhook converges on one outcome.
      6. Log info `media.reconcile.applied` (tenantId, assetId, kind, provider) and return true.
    - Docblock: why reconciliation exists (the 2026-09-29 Cloud Run revision swap delayed Mux deliveries about 14 min). Also document:
      - the webhook stays primary;
      - `provider_asset_id` holds the UPLOAD id while pending;
      - the event runs through the job's own handler, so the transition is literally the same code;
      - the synthetic id never enters `media_provider_events`;
      - the throttle is per instance.

    (5) `service.ts`
    - Add `provider` and `providerAssetId` to `AssetRow` and `ASSET_COLUMNS`. `assetView` stays byte-identical, so the API payload does not grow.
    - In `getAsset`, AFTER the `isOwnerOrAdmin` gate: if `await reconcileVideoAsset(row)` is true, re-read with `loadOwnAsset(ctx, assetId)` and return `assetView(fresh ?? row)`. Otherwise return `assetView(row)`.
    - Extend `getAsset`'s docblock with one paragraph on reconciliation.
    - Fix any typecheck fallout from the widened `AssetRow`. Every construction site already selects `ASSET_COLUMNS`.
    - Do not touch the route file `apps/api/src/routes/media.ts`.
  </action>
  <precondition>The local Supabase stack is running (psql on 127.0.0.1:54322 answers). apps/api/.env.local carries SEED_PASSWORD. The seeded tenants are tria-demo/tria-lab (pre-rename drift), which is why the integration run uses the throwaway tria copy.</precondition>
  <verify>
    <automated>cd /Users/igorvboas/Library/Developer/TRIA/rede_social/apps/api && for f in media-reconcile media-playback; do sed -e 's/rede-demo/tria-demo/g' -e 's/rede-lab/tria-lab/g' tests/integration/$f.test.ts > tests/integration/zz-tria-$f.test.ts; done && TENANT_DEMO_HOST=tria-demo.localhost TENANT_LAB_HOST=tria-lab.localhost pnpm exec vitest run tests/integration/zz-tria-media-reconcile.test.ts tests/integration/zz-tria-media-playback.test.ts; rc=$?; rm -f tests/integration/zz-tria-*.test.ts; [ $rc -eq 0 ] && cd /Users/igorvboas/Library/Developer/TRIA/rede_social && pnpm --filter @rede-social/core typecheck && pnpm --filter @rede-social/api typecheck && pnpm --filter @rede-social/core lint && pnpm --filter @rede-social/api lint && pnpm --filter @rede-social/core test && [ "$(grep -rln '@mux/mux-node' packages apps --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v /dist/)" = "packages/core/server/media/video/mux.ts" ] && [ -z "$(git diff --name-only e5a0047 -- apps/api/src/routes/webhooks apps/api/src/routes/media.ts packages/core/server/media/video/event-job.ts packages/core/server/media/video/wire.ts packages/core/server/media/video/inbox.ts packages/modules/feed supabase/migrations)" ] && MUXDIFF=$(git diff e5a0047 -- packages/core/server/media/video/mux.ts) && ! printf '%s\n' "$MUXDIFF" | grep -qE '^[-+][^-+].*(uploads\.create|webhooks\.unwrap|new_asset_settings|cors_origin|passthrough)'</automated>
  </verify>
  <done>
    - `media-reconcile.test.ts` L1-L9 pass through the tria copy, and RED was observed before the implementation.
    - `media-playback.test.ts` (the ka5 GET cases plus the playback cases) is still green.
    - The core unit suite (including `media-video.test.ts`) is green. core/api typecheck and Biome are clean.
    - `@mux/mux-node` is imported only by `mux.ts`.
    - The webhook route, `media.ts` route, `event-job.ts`, `wire.ts`, `inbox.ts`, the feed module and `supabase/migrations` are unchanged since e5a0047. The upload creation and webhook unwrap lines in `mux.ts` are untouched.
    - Committed as `feat(quick-260929-ltf): …` with no Co-Authored-By trailer.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Feed composer polls the picked video and gates Publicar on a ready video, with pt-BR helper copy</name>
  <files>apps/web/app/(app)/criar/ComposerForm.tsx, apps/web/app/(app)/criar/ComposerForm.test.tsx, apps/web/messages/pt-BR/feed.json, apps/web/components/media/useAssetReadiness.ts</files>
  <read_first>
    - apps/web/app/(app)/criar/ComposerForm.tsx (lines 1-50 imports; 51-83 docblock; 123-146 PickedVideo/EMPTY_DRAFT; 165-302 state, uploads, publishable; 420-494 submit/submitLabel/busy; 521-549 header Button; 718-741 helper and alerts; 821-839 video block)
    - apps/web/app/(app)/stories/publicar/StoryComposer.tsx (lines 221-250: the ka5 readiness mapping to copy)
    - apps/web/app/(app)/stories/publicar/StoryComposer.test.tsx (lines 1-145: vi.hoisted catalogs, next-intl/next/navigation/@rede-social/ui mocks, useSignedUpload + useAssetReadiness mocks, MotionGlobalConfig)
    - apps/web/lib/feed-view.tsx (lines 278-310: ComposerDraft and composerDraft video status)
    - apps/web/components/media/useAssetReadiness.ts (whole file)
    - apps/web/messages/pt-BR/feed.json (lines 128-168, composer block)
  </read_first>
  <behavior>
    The new `ComposerForm.test.tsx` starts with `// @vitest-environment happy-dom`. It follows the `StoryComposer.test.tsx` harness:
    - It reads the REAL `feed`, `media` and `communities` catalogs through `vi.hoisted` + `node:fs`, and mocks `next-intl` and `next/navigation` (push, refresh).
    - It mocks `@/app/(app)/criar/actions` with `createPostAction = vi.fn()` and `@/app/(app)/inicio/feed-actions` with `updatePostAction = vi.fn()`.
    - It mocks `@/components/media/useSignedUpload`, keeping a real-shaped `formatMediaLimit` export and capturing each call's handlers by `kind`.
    - It mocks `@/components/media/VideoPlayer` with a stub that renders `data-testid='video-player-stub' data-status={status}`.
    - It mocks `@/components/media/useAssetReadiness` with a hoisted controllable value plus a recorded `ids` list. A test can flip the value inside `act()`, for example through a tiny external store read with `useSyncExternalStore`, or by setting the value and forcing a re-render.
    - It mocks any other heavy import (MediaImage, the communities picker) only if rendering needs it.
    - `MotionGlobalConfig.skipAnimations = true`.
    Cases:
    - C1: create mode. Type a caption, then call the captured video handler `onHandedToProvider('VIDEO_ID')` inside act. The readiness mock receives `'VIDEO_ID'`. With readiness `waiting`: the stub has `data-status='processing'`; the text of `composer.videoWaiting` ("Aguarde o vídeo terminar de processar para publicar.") is visible; the Publicar button (name from the `composer.publish` catalog value) is disabled; and submitting the form calls `createPostAction` zero times.
    - C2: flip readiness to `ready`. The stub shows `'ready'`, the helper text is gone and Publicar is enabled. Clicking it calls `createPostAction` once with a body whose `videoAssetId === 'VIDEO_ID'`.
    - C3: flip readiness to `{ phase: 'failed', issue: 'transcode_failed' }`. The stub shows `'failed'`, Publicar is disabled and `createPostAction` is not called on submit. With `{ phase: 'failed', issue: 'duration_too_long' }` the stub shows `'rejected'`. With `{ phase: 'failed', issue: null }` it shows `'failed'`.
    - C4: edit mode with `initial.video = { assetId: 'OLD', status: 'ready' }` (build `initial` as a full `ComposerDraft`). Every readiness call receives `null` (no poll). The stub shows `'ready'`, the `composer.videoWaitingEdit` text is absent, and the "Salvar alterações" button is enabled after the caption changes.
    - C5: edit mode with `initial.video = { assetId: 'OLD', status: 'failed' }`. Readiness receives `null`, the stub shows `'failed'` and Salvar alterações is disabled.
    - C6: create mode with a waiting video; click "Remover vídeo". Readiness then receives `null`, the helper is gone, and Publicar is enabled again, since the typed caption alone is publishable.
  </behavior>
  <action>
    This task implements requirement B. It follows the user's locked decisions 2 (the post composer polls) and 3 (option b: a feed post requires a ready video; failed or rejected blocks; the API rule in `validateAssets` stays; stories are untouched).
    Write `ComposerForm.test.tsx` first. It must fail (RED). Then:

    (1) `feed.json`, `composer` block: add two keys next to `mediaHelper`.
    - `videoWaiting`: "Aguarde o vídeo terminar de processar para publicar."
    - `videoWaitingEdit`: "Aguarde o vídeo terminar de processar para salvar."
    Neither key may collide with an existing leaf path.

    (2) `ComposerForm.tsx`
    - Import `useAssetReadiness` from `@/components/media/useAssetReadiness`.
    - Derive `pollId`: the video's asset id when `video` exists and `video.status` is `pending` or `processing`, else null. An edit-mode video that is already `ready` or terminal never polls.
    - `const readiness = useAssetReadiness(pollId)`.
    - Derive `videoStatus: MediaStatus | null`:
      - null without a video;
      - `video.status` when `pollId` is null;
      - otherwise `ready` for phase `ready`;
      - `rejected` for phase `failed` with issue `duration_too_long`, and `failed` for any other failed phase (the StoryComposer mapping);
      - `processing` for everything else.
    - `videoWaiting` = `videoStatus` is `pending` or `processing`. `videoBlocksSubmit` = `video !== null && videoStatus !== 'ready'`.
    - Pass `status={videoStatus}` to `<VideoPlayer>`. Under the player, and above "Remover vídeo", render the helper only while `videoWaiting`:
      - a `<p>` with `role="status"`, `data-composer-video-wait` and `className="text-xs font-normal text-text-secondary"`;
      - its text is `t('composer.videoWaiting')` in create mode and `t('composer.videoWaitingEdit')` in edit mode.
      A failed or rejected video needs no new copy: the player's failed card is the message.
    - Add `videoBlocksSubmit` to the submit Button's `disabled` expression. Keep `loading={busy}` unchanged, so there is no spinner for a transcode wait.
    - Guard `submit()` itself: return before `startTransition` when `videoBlocksSubmit`.
    - Rewrite the comments that state the old rule: the file docblock paragraph "Publish rules while media is in flight" (~76-79), the `onHandedToProvider` comment (~249-251) and the `uploading` comment (~288-291). They must now state:
      - a feed post needs a ready video, because the API's `validateAssets` refuses a `pending` provider video (the 2026-09-29 `asset_not_usable` refusals);
      - the composer polls with `useAssetReadiness` and explains the wait;
      - stories still publish while processing.
    - Keep every JSX string in the catalog (`scripts/check-ui-literals.sh` fails on pt-BR JSX text).

    (3) `useAssetReadiness.ts`: docblock-only edit. Where it says publishing is allowed while waiting, state that this is the story composer's rule. The feed composer (quick-260929-ltf) uses the same hook but blocks Publicar until ready. Also note that the server now reconciles a stale video on this read. Change no code.
  </action>
  <verify>
    <automated>cd /Users/igorvboas/Library/Developer/TRIA/rede_social && pnpm --filter @rede-social/web exec vitest run "app/(app)/criar/ComposerForm.test.tsx" && pnpm --filter @rede-social/web test && pnpm --filter @rede-social/web typecheck && pnpm --filter @rede-social/web lint && bash scripts/check-ui-literals.sh && [ "$(grep -c 'Aguarde o vídeo terminar de processar para publicar.' apps/web/messages/pt-BR/feed.json)" = "1" ] && [ -z "$(git diff --name-only e5a0047 -- 'apps/web/app/(app)/stories' packages/modules/feed)" ] && HOOKDIFF=$(git diff e5a0047 -- apps/web/components/media/useAssetReadiness.ts) && [ -z "$(printf '%s\n' "$HOOKDIFF" | grep -E '^[-+][^-+/*]' | grep -vE '^[-+][[:space:]]*(\*|//)')" ]</automated>
  </verify>
  <done>
    - C1-C6 pass, and RED was observed first.
    - The full web unit suite (including StoryComposer and useAssetReadiness) is green. web typecheck, Biome and check-ui-literals are clean.
    - The new copy exists exactly once. The stories route and the feed module are untouched, and the `useAssetReadiness` diff is comment-only.
    - Committed as `fix(quick-260929-ltf): …` with no Co-Authored-By trailer.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Converge without a poller: pin the Mux lookup mapping and reconcile stale videos in the hourly sweeper before collecting</name>
  <files>packages/core/tests/media-video-mux.test.ts, packages/core/server/media/sweep-job.ts, apps/api/tests/integration/media-sweeper.test.ts</files>
  <read_first>
    - packages/core/server/media/video/mux.ts (after Task 1: getUploadState, retrieveAsset, the LOOKUP options constant)
    - packages/core/server/media/video/reconcile.ts (after Task 1: ReconcilableVideo, reconcileVideoAsset, resetReconcileInternals)
    - packages/core/tests/media-video.test.ts (lines 1-45: unit-suite import and afterEach style)
    - packages/core/server/media/sweep-job.ts (whole file, 163 lines)
    - apps/api/tests/integration/media-sweeper.test.ts (lines 1-60 imports/constants; 84-186 helpers seedAsset/drain/cleanup/beforeAll; 245-257 the safety block; 316-362 the provider-path block)
  </read_first>
  <behavior>
    Unit, in the new `packages/core/tests/media-video-mux.test.ts`. It uses `vi.mock('@mux/mux-node', …)` exporting a `Mux` class whose instances expose `video.uploads.retrieve` and `video.assets.retrieve` as hoisted `vi.fn()`s, then builds the adapter with `createMuxVideoProvider(dummy config)`.
    - M1: the upload has `asset_id 'as1'` and the asset is `{ id: 'as1', status: 'ready', duration: 12.4, aspect_ratio: '9:16', playback_ids: [{ id: 'pb1' }] }`. The answer is `{ state: 'asset', asset: { providerAssetId: 'as1', status: 'ready', playbackId: 'pb1', durationSeconds: 12, aspectRatio: '9:16' } }`. Both retrieves were called with a second argument deep-equal to `{ timeout: 4000, maxRetries: 0 }`.
    - M2: an upload with status `waiting`, `timed_out` or `cancelled` and no `asset_id` → `{ state: 'waiting' }`, and `assets.retrieve` is not called.
    - M3: an upload with status `errored` and no `asset_id` → `{ state: 'errored' }`.
    - M4: an asset with status `preparing` → `asset.status 'preparing'`. An asset with status `errored` → `asset.status 'errored'`.
    - M5: an SDK rejection with `{ status: 404 }` → a `VideoProviderError` of kind `not_found`. `{ status: 500 }` → kind `unavailable`, and the error message contains no `'body'`/token text.
    Integration, a new describe `'convergence — a finished video is reconciled, never purged (quick-260929-ltf)'` in `media-sweeper.test.ts`. Its `beforeEach`/`afterEach` call `resetFakeVideoInternals()` + `resetReconcileInternals()`.
    - S1: a pending video 25 h old (`seedAsset({ status: 'pending', kind: 'video', ageHours: 25, providerAssetId: 'fake-up-<uuid>' })`), where the seam answers ready with asset id `fake-asset-<uuid>`. After `sweepOrphansJob.handler({})` the row STILL EXISTS with `status 'ready'` and `provider_asset_id` equal to the asset id. `fakeVideoInternals.deletedAssetIds` contains neither id.
    - S2: a pending video 1 h old with the seam answering ready. After one run the row is `ready`.
    - S3: a pending video 1 h old with the default seam (`waiting`). After one run it is still `pending`, and `uploadStateCalls` contains its upload id. The pre-existing provider-path case (a 25 h pending video IS collected and its provider id deleted) must stay green unchanged.
  </behavior>
  <action>
    This task implements requirement A's optional convergence pass. It is kept because it is cheap and it closes two gaps: a published story video that nobody polls, and the 24 h purge that would orphan a finished Mux asset by calling `deleteAsset` with the upload id. It also adds the unit pin of the real adapter's lookup, because production runs Mux, not the fake.
    Write the M and S cases first. They must fail (RED). Then:

    (1) `media-video-mux.test.ts`: implement M1-M5 exactly as in the behavior block. Import `createMuxVideoProvider` from `../server/media/video/mux` and `VideoProviderError` from `../server/media/video/types`. Pass dummy strings for the five config values. No network.

    (2) `sweep-job.ts`
    - Add a local constant `RECONCILE_SWEEP_MIN_AGE_S = 300`.
    - Add `async function reconcilable(): Promise<ReconcilableVideo[]>`. It reads through `withAdminTx`:
      - selects id, tenantId, kind, status, provider, providerAssetId, createdAt;
      - where `kind = 'video'`, `status in ('pending','processing')`, `provider = videoProvider.name` (import from `./video/index`), `provider_asset_id is not null`, `deleted_at is null`;
      - and `created_at < now() - make_interval(secs => RECONCILE_SWEEP_MIN_AGE_S)`, using the database clock and the same `make_interval` idiom as `collectable()`;
      - ordered by `createdAt`, limited to `MEDIA_SWEEP_BATCH`.
    - In the handler, BEFORE the existing collect-and-purge try block, add its own try/catch:
      - for each row, sequentially, `if (await reconcileVideoAsset(row)) reconciled += 1`;
      - on a thrown error, log error `media.sweep.reconcile_failed` and continue to the purge.
      Add `reconciled` to the final `media.sweep.done` log line.
    - Update the file docblock with one paragraph:
      - the pass runs first, so a video the provider finished while its webhook was lost becomes `ready` and falls out of the pending window instead of being purged;
      - it applies the webhook's own transition through `reconcileVideoAsset`;
      - the two windows and their by-construction exclusions are unchanged.
    - The reconcile pass never deletes anything.

    (3) `media-sweeper.test.ts`: add the S1-S3 describe block. Import `fakeVideoInternals`/`resetFakeVideoInternals` (the file already imports from `fake.ts`) and `resetReconcileInternals` from `@rede-social/core/server/media/video/reconcile`. Reuse `seedAsset` (its `providerAssetId` argument already makes the row `provider 'fake'` and `kind 'video'`/`purpose 'post'`). Read rows back through `adminSql`. Change no pre-existing case.

    Keep `event-job.ts`, the sweeper's two collect windows, `purgeAsset` and `apps/api/src/worker.ts` unchanged.
  </action>
  <precondition>Task 1 is committed: reconcile.ts, getUploadState and the fake seam exist. The local stack is running, with tria-* seed drift.</precondition>
  <verify>
    <automated>cd /Users/igorvboas/Library/Developer/TRIA/rede_social && pnpm --filter @rede-social/core exec vitest run tests/media-video-mux.test.ts tests/media-video.test.ts && cd apps/api && sed -e 's/rede-demo/tria-demo/g' -e 's/rede-lab/tria-lab/g' tests/integration/media-sweeper.test.ts > tests/integration/zz-tria-media-sweeper.test.ts && TENANT_DEMO_HOST=tria-demo.localhost TENANT_LAB_HOST=tria-lab.localhost pnpm exec vitest run tests/integration/zz-tria-media-sweeper.test.ts -t "quick-260929-ltf|the provider path|safety"; rc=$?; rm -f tests/integration/zz-tria-*.test.ts; [ $rc -eq 0 ] && cd /Users/igorvboas/Library/Developer/TRIA/rede_social && pnpm --filter @rede-social/core typecheck && pnpm --filter @rede-social/api typecheck && pnpm --filter @rede-social/core lint && pnpm --filter @rede-social/api lint && [ -z "$(git diff --name-only e5a0047 -- packages/core/server/media/video/event-job.ts apps/api/src/worker.ts supabase/migrations)" ]</automated>
  </verify>
  <done>
    - M1-M5 and S1-S3 pass, and RED was observed first.
    - The pre-existing safety and provider-path sweeper cases stay green.
    - core/api typecheck and Biome are clean. `event-job.ts`, `worker.ts` and the migrations are untouched.
    - The whole media-sweeper file is deliberately NOT run: every run of it sweeps the local DB globally.
    - Committed as `feat(quick-260929-ltf): …` with no Co-Authored-By trailer.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser → API `GET /v1/media/{assetId}` | An authenticated caller controls only the asset id and the polling rate |
| API/worker → video provider REST API | Our credentials; the answers are trusted provider state but may be slow or erroring |
| reconciliation ↔ webhook job | Two writers of the same `media_assets` row, in any order |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-ltf-01 | Denial of Service | reconcile.ts provider lookups driven by polling clients | medium | mitigate | Per-asset per-instance throttle of 10 s, checked and set synchronously before any await. 15 s grace from `created_at`. Reconciliation runs only AFTER the tenant-lane load and `isOwnerOrAdmin`, and only for eligible rows (video, pending/processing, active provider, upload id present). Proven by L4, L5 and L9 |
| T-ltf-02 | Denial of Service | GET latency when the provider is slow | medium | mitigate | Mux lookups use `timeout` 4 s and `maxRetries` 0, and every error is caught and logged. The GET answers the current row (L6), and the poller retries on its own backoff |
| T-ltf-03 | Tampering | reconciliation vs a late or duplicate webhook | high | mitigate | Both paths run the SAME `mediaProviderEventJob.handler`, whose writes carry `id` + `tenant_id` and `status not in ('ready','deleted')`. The second writer is a stale no-op, and a deleted asset is never resurrected. Proven by L2 and L3 |
| T-ltf-04 | Spoofing | the synthesized provider event | medium | mitigate | The event is built only from the provider's own authenticated API answer, keyed by the upload id stored server-side at upload start. No request field besides the authorized asset id feeds it. The synthetic id never enters `media_provider_events`, so the webhook's replay ledger stays provider-only |
| T-ltf-05 | Information Disclosure | logs and the GET payload | medium | mitigate | Log lines carry the `VideoProviderError` message (kind + status only, T-03-41) and never a provider body. `failure_reason` stays the event TYPE. `assetView` is unchanged, so the new `provider`/`providerAssetId` row fields never reach the API payload |
| T-ltf-06 | Elevation of Privilege | cross-tenant trigger of a lookup or write | high | mitigate | The row comes from the RLS tenant lane (`loadOwnAsset`), and a refused caller gets the bare 404 before any lookup (L9). The handler's writes are scoped by the resolved row's `tenant_id` |
| T-ltf-07 | Denial of Service | hourly sweeper reconcile pass | low | mitigate | It is sequential, bounded by `MEDIA_SWEEP_BATCH` and throttled by the same map. A failure is caught and the purge still runs |
| T-ltf-08 | Tampering | feed composer Publicar gate | low | accept | The client gate is UX only. The API's `validateAssets` (unchanged) remains the authority that refuses a non-ready video |
</threat_model>

<verification>
- Task 1 gate: reconcile integration L1-L9 plus the ka5/playback regression through the tria copy; core unit suite; typecheck and Biome for core and api; the `@mux/mux-node` confinement grep; the no-diff gate on the webhook route, the media route, event-job/wire/inbox, the feed module and the migrations; the upload-creation and unwrap lines in mux.ts untouched.
- Task 2 gate: ComposerForm C1-C6; full web unit suite; web typecheck and Biome; check-ui-literals; the copy grep; the stories route and feed module untouched; a comment-only diff in useAssetReadiness.
- Task 3 gate: Mux adapter unit M1-M5; sweeper S1-S3 plus the pre-existing safety and provider-path cases; typecheck and Biome for core and api.
- NO migration: `git diff --name-only e5a0047 -- supabase/migrations` prints nothing.
- No Playwright, no `next build`, no full turbo build (disk has about 2 GiB free).
</verification>

<success_criteria>
- A late Mux webhook no longer leaves a polled video `pending`: the next `GET /v1/media/{assetId}` after the 15 s grace applies the provider's state, with the same transition the webhook would apply, and a later webhook is a no-op.
- The feed composer never shows "Processando o vídeo…" forever. It never lets the admin publish a video the API would refuse, and it says why Publicar is disabled.
- Edit mode with a ready video behaves exactly as before.
- An unpolled video converges within an hour, and a finished video is never purged as an orphan.
- Deploy needs only the API image (API + worker) and the Vercel web build. There is no database migration to push first.
- After deploy, check the Cloud Run logs for `media.reconcile.applied` and `media.reconcile.lookup_failed`. `unauthorized` would mean the Mux token lacks Video read access; the GET still degrades to webhook-only.
</success_criteria>

<output>
Create `.planning/quick/260929-ltf-reconcile-pending-mux-videos-without-the/260929-ltf-SUMMARY.md` when done. The SUMMARY must:
- state "No database migration";
- list the three commits;
- record the RED-then-GREEN counts per task and the tria-copy procedure used for integration runs;
- note that the story composer also benefits, because it polls the same GET.
</output>
