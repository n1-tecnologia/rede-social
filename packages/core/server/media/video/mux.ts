import { Mux } from '@mux/mux-node';
import {
  VIDEO_UPLOAD_TTL_S,
  type VideoAssetInfo,
  type VideoDirectUpload,
  type VideoDirectUploadInput,
  type VideoPlaybackTokens,
  type VideoProvider,
  VideoProviderError,
  type VideoProviderEvent,
  type VideoUploadState,
} from './types';
import { normaliseProviderEvent } from './wire';

/**
 * `VIDEO_PROVIDER=mux` (D-43). The ONLY file in the repository that imports `@mux/mux-node` —
 * grep-pinned, which is what keeps the seam real: every other caller talks to `VideoProvider`.
 *
 * Guard rails baked into every asset, not left to a call site (R-01/R-02):
 *  - `playback_policies: ['signed']` — NEVER `public` (D-44). A public playback id would make video
 *    the one media kind TENANT-04 cannot defend, and flipping an already-published asset to public
 *    later would silently widen access;
 *  - `video_quality: 'basic'` — encoding is free at this level, which is what makes the pilot's cost
 *    model hold;
 *  - `max_resolution_tier: '1080p'` — Mux's own default, pinned explicitly so a default change is not
 *    a silent bill change;
 *  - `test: true` outside production, on BOTH the upload and its new asset — test assets are
 *    watermarked, capped at 10 seconds and deleted by Mux after 24 h, so a hosted smoke cannot
 *    accumulate stored minutes (RESEARCH Pitfall 7);
 *  - `passthrough: assetId` — our correlation key, max 255 characters (a uuid fits).
 *
 * Mux enforces NO duration limit at ingest; a video is only measurable once ready, so the per-purpose
 * duration cap lives in the event job, not here.
 *
 * Every SDK error is re-thrown as a `VideoProviderError` carrying a kind and an HTTP status and
 * NOTHING else: a Mux response body may echo the access token or another customer's data, and these
 * messages end up in logs (T-03-41, the T-02-51 rule from the domains adapter).
 */

export type MuxVideoProviderConfig = {
  tokenId: string;
  tokenSecret: string;
  signingKeyId: string;
  /** base64-encoded PEM private key, straight out of Secret Manager. */
  signingKeyPrivate: string;
  webhookSecret: string;
};

/** Maps a Mux SDK failure onto the closed adapter vocabulary. Never reads the response body. */
function toProviderError(error: unknown): VideoProviderError {
  const status = (error as { status?: unknown } | null)?.status;
  const code = typeof status === 'number' ? status : undefined;
  if (code === 401) return new VideoProviderError('unauthorized', code);
  if (code === 403) return new VideoProviderError('unauthorized', code);
  if (code === 404) return new VideoProviderError('not_found', code);
  if (code === 429) return new VideoProviderError('rate_limited', code);
  return new VideoProviderError('unavailable', code);
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/**
 * Request options for the reconciliation lookups (quick-260929-ltf). They run inside
 * `GET /v1/media/{assetId}`, so they must stay fast: a 4 s ceiling and no SDK retry — the browser's
 * readiness poll already retries on its own backoff, and the hourly sweeper retries too.
 */
const LOOKUP = { timeout: 4_000, maxRetries: 0 } as const;

export function createMuxVideoProvider(config: MuxVideoProviderConfig): VideoProvider {
  const mux = new Mux({ tokenId: config.tokenId, tokenSecret: config.tokenSecret });

  async function retrieveAsset(
    providerAssetId: string,
    options?: typeof LOOKUP,
  ): Promise<VideoAssetInfo> {
    const asset = await mux.video.assets.retrieve(providerAssetId, options);
    const playbackIds = asset.playback_ids ?? [];
    return {
      providerAssetId: asset.id,
      status: asset.status === 'ready' || asset.status === 'errored' ? asset.status : 'preparing',
      playbackId: asString(playbackIds[0]?.id),
      durationSeconds: typeof asset.duration === 'number' ? Math.round(asset.duration) : null,
      aspectRatio: asString(asset.aspect_ratio),
    };
  }

  return {
    name: 'mux',

    async createDirectUpload(input: VideoDirectUploadInput): Promise<VideoDirectUpload> {
      try {
        const upload = await mux.video.uploads.create({
          cors_origin: input.corsOrigin,
          timeout: VIDEO_UPLOAD_TTL_S,
          // The upload itself is a test upload outside production; `new_asset_settings.test` marks
          // the asset it creates. Both are set on purpose — either one alone leaves a real asset
          // behind on one of the two objects (verified against `UploadCreateParams` /
          // `AssetOptions` in @mux/mux-node@15.2.0).
          ...(input.test ? { test: true } : {}),
          new_asset_settings: {
            playback_policies: ['signed'],
            video_quality: 'basic',
            max_resolution_tier: '1080p',
            passthrough: input.assetId,
            ...(input.test ? { test: true } : {}),
          },
        });
        const uploadUrl = asString(upload.url);
        if (!uploadUrl) throw new VideoProviderError('unavailable');
        return { providerUploadId: upload.id, uploadUrl };
      } catch (error) {
        if (error instanceof VideoProviderError) throw error;
        throw toProviderError(error);
      }
    },

    async getUploadState(providerUploadId: string): Promise<VideoUploadState> {
      try {
        // The upload id is what `startUpload` persisted; the upload names its asset once Mux has
        // created one. Two documented reads, no listing, no reliance on the correlation echo.
        const upload = await mux.video.uploads.retrieve(providerUploadId, LOOKUP);
        const assetId = asString(upload.asset_id);
        if (assetId) return { state: 'asset', asset: await retrieveAsset(assetId, LOOKUP) };
        if (upload.status === 'errored') return { state: 'errored' };
        // `waiting`, and also `cancelled`/`timed_out`: the webhook path applies nothing for those.
        return { state: 'waiting' };
      } catch (error) {
        if (error instanceof VideoProviderError) throw error;
        throw toProviderError(error);
      }
    },

    async getAsset(providerAssetId: string): Promise<VideoAssetInfo> {
      try {
        return await retrieveAsset(providerAssetId);
      } catch (error) {
        throw toProviderError(error);
      }
    },

    async deleteAsset(providerAssetId: string): Promise<void> {
      try {
        await mux.video.assets.delete(providerAssetId);
      } catch (error) {
        const mapped = toProviderError(error);
        // Already gone is success: the duration-cap path must be idempotent (the `removeDomain`
        // not-found-is-success rule from the domains adapter).
        if (mapped.kind === 'not_found') return;
        throw mapped;
      }
    },

    async signPlayback(
      playbackId: string,
      opts: { expiresInSeconds: number },
    ): Promise<VideoPlaybackTokens> {
      try {
        const tokens = await mux.jwt.signPlaybackId(playbackId, {
          keyId: config.signingKeyId,
          keySecret: config.signingKeyPrivate,
          expiration: `${opts.expiresInSeconds}s`,
          type: ['video', 'thumbnail', 'storyboard'],
        });
        // `Tokens` is keyed by the TypeToken enum VALUES — `playback-token`, `thumbnail-token`,
        // `storyboard-token` — NOT by `playback`/`thumbnail`/`storyboard`. Verified against
        // @mux/mux-node@15.2.0 `lib/jwt.d.ts` (`Tokens = Partial<Record<TypeTokenValues, string>>`);
        // 03-RESEARCH §Code Example 6 shows the PLAYER's shape (@mux/playback-core), which differs.
        const playback = asString(tokens['playback-token']);
        const thumbnail = asString(tokens['thumbnail-token']);
        const storyboard = asString(tokens['storyboard-token']);
        if (!playback || !thumbnail || !storyboard) throw new VideoProviderError('unavailable');
        return { playback, thumbnail, storyboard };
      } catch (error) {
        if (error instanceof VideoProviderError) throw error;
        throw toProviderError(error);
      }
    },

    async verifyWebhook(
      rawBody: string,
      headers: Record<string, string | undefined>,
    ): Promise<VideoProviderEvent> {
      let event: unknown;
      try {
        // The `await` is LOAD-BEARING: `unwrap` is async in v15, so dropping it would resolve to a
        // Promise and silently accept every unverified delivery. HMAC-SHA256 over
        // `timestamp.rawBody`, timing-safe compare, 5-minute tolerance — all inside the SDK.
        event = await mux.webhooks.unwrap(rawBody, headers, config.webhookSecret);
      } catch {
        throw new VideoProviderError('invalid_signature', 403);
      }
      return normaliseProviderEvent(event);
    },
  };
}
