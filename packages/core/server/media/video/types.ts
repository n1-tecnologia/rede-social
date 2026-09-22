/**
 * Video provider adapter contracts (MEDIA-03, D-43/D-44). This file knows no database, no env and
 * no vendor: it is the seam between the media broker (`media/service.ts`), the unauthenticated
 * webhook route (`apps/api/src/routes/webhooks/mux.ts`), the kernel event job
 * (`media/video/event-job.ts`) and the two implementations of the contract — `fake` for every
 * non-production environment and `mux` for the hosted ones (`media/video/index.ts` selects by the
 * kernel env, defaulting to `fake`).
 *
 * The vendor appears in this file exactly once, as a member of the `name` union. Everything the
 * rest of the codebase consumes is NORMALISED: `VideoProviderEvent` is OUR shape, not a Mux
 * payload, so the event job, the asset row and every later surface (Phase 4's feed, Phase 5's
 * stories) are already written against the interface rather than against Mux. Swapping in the
 * documented Cloudflare Stream alternative is a new file next to `mux.ts` plus a re-ingest of
 * existing assets — never a rewrite of the call sites (D-43).
 */

/** The kernel-owned pg-boss queue every provider event is applied through. Registered in `./index.ts`. */
export const MEDIA_PROVIDER_EVENT_QUEUE = 'kernel.media-provider-event';

/** How long a direct-upload target stays valid (seconds). Mux marks the upload `timed_out` after it. */
export const VIDEO_UPLOAD_TTL_S = 3600;

/** Signature tolerance shared by both implementations: a delivery older than this is refused. */
export const VIDEO_WEBHOOK_TOLERANCE_S = 300;

/**
 * What `startUpload` hands the provider. `tenantId` is here because the FAKE mints its target under
 * the asset's own `<tenant_id>/media/<assetId>/original` key in the private `media` bucket — the same
 * path an image takes, so no byte-accepting route has to exist anywhere for the fake to work. The
 * real implementation ignores it: the vendor owns its own storage.
 */
export type VideoDirectUploadInput = {
  assetId: string;
  tenantId: string;
  /** The tenant's own browser-facing origin; the provider's CORS rule for the direct PUT. */
  corsOrigin: string;
  /** Outside production every asset is created as a throwaway test asset (RESEARCH Pitfall 7). */
  test: boolean;
};

export type VideoDirectUpload = {
  /** The provider's own id for the upload session — stored as `media_assets.provider_asset_id`. */
  providerUploadId: string;
  /** Where the BROWSER puts the bytes. They never transit Cloud Run (MEDIA-01, CLAUDE.md §4). */
  uploadUrl: string;
};

/** A provider asset as the provider currently sees it — used by a future reconciliation job. */
export type VideoAssetInfo = {
  providerAssetId: string;
  status: 'preparing' | 'ready' | 'errored';
  playbackId: string | null;
  durationSeconds: number | null;
  aspectRatio: string | null;
};

/** The three tokens a signed playback needs. 03-07 wraps them in `GET /v1/media/{id}/playback`. */
export type VideoPlaybackTokens = {
  playback: string;
  thumbnail: string;
  storyboard: string;
};

/**
 * `ready` and `errored` are the only two kinds that change asset state; everything else the provider
 * delivers is `ignored` (recorded once, applied as a no-op). Keeping `ignored` explicit rather than
 * dropping it at the route means a duplicate of an uninteresting event is still deduplicated.
 */
export type VideoProviderEventKind = 'ready' | 'errored' | 'ignored';

/**
 * The NORMALISED event. Nothing downstream ever sees a vendor field name: the job reads these keys,
 * so a second implementation only has to fill them in.
 *
 * `id` is the PROVIDER's own event id — the primary key of `media_provider_events` and the
 * `singletonKey` of the job, which is what makes a replayed delivery free (T-03-38).
 * `assetId` is OUR asset id (Mux carries it as `passthrough`); when the provider cannot echo it the
 * job falls back to `providerAssetId`, which `startUpload` recorded.
 * `failureReason` is the event TYPE and never the provider's own message (T-03-41).
 */
export interface VideoProviderEvent {
  id: string;
  kind: VideoProviderEventKind;
  rawType: string;
  assetId: string | null;
  providerAssetId: string | null;
  playbackId: string | null;
  durationSeconds: number | null;
  aspectRatio: string | null;
  failureReason: string | null;
}

/**
 * Streaming-vendor side of a member video: create a direct upload, read an asset, delete an asset,
 * mint playback tokens, verify an inbound webhook. Nothing else (API coverage decision, 03-06):
 * never live streaming, never static renditions, never DRM, never analytics.
 *
 * `verifyWebhook` is the only authentication of `POST /v1/webhooks/mux`, so it must THROW on a bad,
 * tampered or stale signature — a resolved promise means "this really came from the provider".
 */
export interface VideoProvider {
  readonly name: 'fake' | 'mux';
  createDirectUpload(input: VideoDirectUploadInput): Promise<VideoDirectUpload>;
  getAsset(providerAssetId: string): Promise<VideoAssetInfo>;
  deleteAsset(providerAssetId: string): Promise<void>;
  signPlayback(
    playbackId: string,
    opts: { expiresInSeconds: number },
  ): Promise<VideoPlaybackTokens>;
  verifyWebhook(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): Promise<VideoProviderEvent>;
}

export type VideoProviderName = VideoProvider['name'];

export type VideoProviderErrorKind =
  | 'unauthorized'
  | 'not_found'
  | 'rate_limited'
  | 'invalid_signature'
  | 'unavailable';

/**
 * The ONLY error shape an adapter raises. The message carries the kind and the HTTP status and
 * nothing else — never a response body, a header or a provider id (the T-02-51 rule from the domains
 * adapter, applied verbatim: a provider answer may echo the bearer token or another customer's data,
 * and this message ends up in logs). The constructor deliberately accepts NO message argument, so
 * there is no way to smuggle a provider body into it.
 */
export class VideoProviderError extends Error {
  readonly kind: VideoProviderErrorKind;
  readonly status: number | undefined;

  constructor(kind: VideoProviderErrorKind, status?: number) {
    super(status === undefined ? `video provider: ${kind}` : `video provider: ${kind} (${status})`);
    this.name = 'VideoProviderError';
    this.kind = kind;
    this.status = status;
  }
}
