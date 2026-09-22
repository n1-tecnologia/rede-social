# API Coverage — Phase 3 external integrations

> Full coverage by default. Opt-outs are explicit, reasoned decisions. One section per external
> service; each service starts from its own full-coverage baseline. Capability surfaces are taken
> from `03-RESEARCH.md` §Standard Stack / §Decision R-01..R-05 and from the vendors' published
> type definitions cited there (`@mux/mux-node@15.2.0`, `@supabase/storage-js@2.116.0`).
>
> This file promotes and completes the API coverage table drafted in `03-06-PLAN.md`
> §"API coverage decision", reconciled against the code that actually shipped. Two rows moved
> as a result of that reconciliation and are marked **[reconciled]** below.

## Mux Video API — server (`03-06-PLAN.md`, adapter `packages/core/server/media/video/mux.ts`)

The adapter is the ONLY file in the repository that imports `@mux/mux-node`; every other caller
talks to the `VideoProvider` interface in `video/types.ts`, whose doc comment states the same
closed surface this table decides ("never live streaming, never static renditions, never DRM,
never analytics").

| capability | decision | reason |
|---|---|---|
| `video.uploads.create` (direct upload target) | INTEGRATE | MEDIA-03's ingest path; pinned `playback_policies: ['signed']`, `video_quality: 'basic'`, `max_resolution_tier: '1080p'`, `passthrough: assetId`, `timeout: VIDEO_UPLOAD_TTL_S` |
| `new_asset_settings.test` + upload `test` (throwaway assets outside production) | INTEGRATE | RESEARCH Pitfall 7 — both flags set on purpose; either one alone leaves a real asset behind |
| `video.assets.retrieve` (`getAsset`) | INTEGRATE | built, and deliberately called by no route yet — declared on the interface so a future reconciliation job needs no adapter change (recorded as a known gap in `03-06-SUMMARY.md`) |
| `video.assets.delete` | INTEGRATE | the duration-cap rejection path; `not_found` is treated as success so the path is idempotent |
| `jwt.signPlaybackId` (playback/thumbnail/storyboard tokens) | INTEGRATE | D-44's signed playback. **[reconciled]** 03-06 said "built in 03-07"; 03-07 delivered it — `media/service.ts:729` backs `GET /v1/media/{assetId}/playback` |
| `webhooks.unwrap` (HMAC-SHA256 signature verification) | INTEGRATE | the webhook route's ONLY authentication; the `await` is load-bearing (v15 made `unwrap` async) |
| Static renditions / MP4 downloads (`mp4_support`) | OPT-OUT | explicitly out of scope — HLS only in V1 (CLAUDE.md "What NOT to Use"); the SDK marks `mp4_support` deprecated |
| Live streaming, simulcast targets, spaces | OPT-OUT | not applicable — the product has no live surface in V1 or V2 |
| Mux Data / analytics (`data.*`, monitoring, metrics) | OPT-OUT | not needed — no analytics requirement; its absence is the main reason Cloudflare Stream stays the documented cheaper alternative (D-43) |
| Playback restrictions / DRM (`playback_restrictions`, `drm_configurations`) | OPT-OUT | not needed — a 2 h signed playback token is the V1 control (D-44); DRM is not a pilot requirement |
| Asset captions / subtitles / text tracks | OPT-OUT | not needed yet — no V1 accessibility requirement names captions; revisit in Phase 8 hardening |
| Thumbnail / storyboard image endpoints | INTEGRATE | reached through the signed `thumbnail` / `storyboard` tokens minted above; the poster on a `ready` row |
| `video.assets.update` / asset metadata edits | OPT-OUT | not needed — an asset is immutable once ready; a correction is a new upload |
| Signing-key management (`system.signing_keys.*`) | OPT-OUT | explicitly out of scope — the signing key is a GCP Secret Manager secret provisioned once by the Phase 01.1 runbook, never rotated from application code |
| Direct-upload cancel / list (`video.uploads.cancel`, `.list`) | OPT-OUT | not needed — an abandoned upload expires on its own after `VIDEO_UPLOAD_TTL_S` and is reaped by the 03-08 sweeper |

## Mux Webhooks — inbound (`03-06-PLAN.md`, route `apps/api/src/routes/webhooks/mux.ts`, normaliser `video/wire.ts`)

Unknown event types are NOT an error: `wire.ts` normalises every unrecognised delivery to
`kind: 'ignored'`, which is still recorded and still deduplicated but applies nothing. That is
what keeps this table honest as the vendor adds types.

| capability | decision | reason |
|---|---|---|
| `video.asset.ready` | INTEGRATE | writes `playback_id`, `duration`, `aspect_ratio` and flips the row to ready |
| `video.asset.errored` | INTEGRATE | flips the row to failed; `failureReason` is the event TYPE, never the vendor's message (T-03-41) |
| `video.upload.errored` | INTEGRATE | passthrough read from `new_asset_settings` — a upload delivery carries no top-level `passthrough` |
| Signature tolerance (5 min) + timing-safe compare over the RAW body | INTEGRATE | verified before any body parsing; the route is deliberately not an OpenAPI route so no zod parsing precedes verification |
| Replay / duplicate delivery defence | INTEGRATE | two independent layers — `media_provider_events.id` PK with `on conflict do nothing`, plus pg-boss `singletonKey = event.id` (T-03-38) |
| Fast 2xx + async apply | INTEGRATE | Mux retries for 24 h on anything else; the state change runs in `kernel.media-provider-event` |
| All other `video.*` event types (`asset.created`, `asset.deleted`, …) | OPT-OUT | not needed — none changes asset state; they normalise to `ignored`, are recorded and deduplicated, and apply nothing |
| `video.live_stream.*`, `video.space.*` events | OPT-OUT | not applicable — no live surface (mirrors the server table) |
| Webhook management API (create/update/list webhook endpoints) | OPT-OUT | explicitly out of scope — the delivery URL is configured once in the Mux dashboard by the Phase 01.1 runbook (`docs/DEPLOY.md`), never from application code |

## Mux browser SDKs (`03-06`/`03-07`, `apps/web/lib/upload.ts`, `apps/web/components/media/VideoPlayer.tsx`)

| capability | decision | reason |
|---|---|---|
| `@mux/upchunk` chunked resumable upload to the direct-upload URL | INTEGRATE | 5 MiB slices; a dropped mobile connection resumes instead of restarting a 100 MB video |
| `@mux/mux-player-react` `<MuxPlayer playbackId tokens={...} />` | INTEGRATE | HLS with poster; loaded via `next/dynamic` with `ssr: false` because it registers a custom element at import |
| `tokens.drm` on the player | OPT-OUT | follows the server-side DRM opt-out above |
| Mux Data / player analytics props (`envKey`, `metadata.*`) | OPT-OUT | follows the Mux Data opt-out above |

## Supabase Storage (`03-01-PLAN.md`, adapter `packages/core/server/media/storage.ts`)

The private `media` bucket carries ZERO `storage.objects` policies (R-15, pinned by
`supabase/tests/070-media-bucket.sql`): the browser never holds a Supabase JWT for Storage, so a
policy would grant nothing that is used while creating a latent widening. Every function here
takes an already-`assertTenantKey`-checked key.

| capability | decision | reason |
|---|---|---|
| `createSignedUploadUrl` | INTEGRATE | MEDIA-01's ingest; returns `{ signedUrl, token, path }` — the `token` is what TUS needs in `x-signature` |
| `createSignedUrl` (single, 1 h TTL) | INTEGRATE | memoised in-process well under the signed TTL; behind the `GET /v1/media/{assetId}/{variant}` 302 |
| `info` | INTEGRATE | size + content type re-read at `complete` time |
| `download` | INTEGRATE | the worker's variant derivation; `Blob.bytes()` so the broker contains no body-parsing call at all |
| `upload` (upsert) | INTEGRATE | writes the immutable `w<width>.webp` rungs with a 1-year `Cache-Control` |
| `remove` | INTEGRATE | rejection cleanup and the 03-08 sweeper's purge |
| `list` | INTEGRATE | **[reconciled]** 03-06 said "not applicable"; 03-08's sweeper needs it — storage-js has no delete-a-prefix call, so `listObjects` lists the folder for `remove`. Admin lane, R-15 holds |
| `createSignedUrls` (batch) | OPT-OUT | not needed yet — the documented escape hatch if Phase 4 measures the 302 hop as a hotspot (R-05) |
| Image transformations (`/render/image`, `transform` on signed URLs) | OPT-OUT | not applicable on the Supabase Free plan (PROJECT.md constraint); worker-produced `sharp` variants replace them (MEDIA-02) |
| `move`, `copy` | OPT-OUT | not needed — keys are derived from `(tenantId, assetId, variant)` and immutable; there is nothing to rename |
| `getPublicUrl` | OPT-OUT | explicitly out of scope — the bucket is private; a public URL would contradict TENANT-04 |
| Bucket administration (`createBucket`, `emptyBucket`, `listBuckets`) | OPT-OUT | explicitly out of scope — the `media` bucket is created by a migration (03-01), never from application code |
| Storage Analytics / S3-compatible endpoint | OPT-OUT | not needed — no requirement reads either |

## TUS resumable protocol (`03-03`, `apps/web/lib/upload.ts` via `tus-js-client@4.3.1`)

| capability | decision | reason |
|---|---|---|
| Resumable `PUT` above 6 MiB with the fixed 6 MiB chunk + `x-signature: token` | INTEGRATE | Supabase documents TUS as the only resumable path; `tus-js-client` is imported dynamically |
| Plain signed `PUT` at or below 6 MiB | INTEGRATE | the non-resumable branch of the same router |
| Upload URL persistence across page loads (`urlStorage`) | OPT-OUT | not needed yet — a resume within the session covers the mobile-connection case the feature exists for; cross-reload resume is a Phase 8 item |
| Parallel chunk uploads (`parallelUploads`) | OPT-OUT | not applicable — Supabase requires the fixed 6 MiB sequential chunk |

## Local development stand-ins (not external integrations — recorded for completeness)

| stand-in | replaces | decision | reason |
|---|---|---|---|
| `packages/core/server/media/video/fake.ts` (`VIDEO_PROVIDER=fake`) | Mux | INTEGRATE | D-43: upload → webhook → ready is e2e-testable without a Mux account; it normalises through the SAME `wire.ts` the real adapter uses |
