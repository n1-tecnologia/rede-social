import { VideoProviderError, type VideoProviderEvent, type VideoProviderEventKind } from './types';

/**
 * The provider's WIRE shape -> `VideoProviderEvent`. Pure: no SDK import, no env, no database.
 *
 * Why this is its own file rather than a private helper inside `mux.ts`: the fake verifies and
 * normalises a delivery through exactly the same code the real adapter does, so the integration
 * suite's synthetic webhook proves something about the REAL path instead of about a second,
 * hand-written translation that could silently drift. `mux.ts` runs it on the object
 * `mux.webhooks.unwrap` returned (already signature-verified by the SDK); `fake.ts` runs it on the
 * JSON it verified with its own HMAC. Neither the event job nor any route ever sees these keys.
 *
 * Only three event types change asset state (R-03). Everything else the provider delivers — and a
 * provider adds types over time — normalises to `ignored`: it is still recorded and still
 * deduplicated, it simply applies nothing. That is deliberate: an unknown event must never be a
 * crash, and never a silent state change either.
 */

const READY_TYPE = 'video.asset.ready';
const ASSET_ERRORED_TYPE = 'video.asset.errored';
const UPLOAD_ERRORED_TYPE = 'video.upload.errored';

/** The state-changing types, exported so the fake can build a delivery the job will act on. */
export const VIDEO_EVENT_TYPES = {
  ready: READY_TYPE,
  assetErrored: ASSET_ERRORED_TYPE,
  uploadErrored: UPLOAD_ERRORED_TYPE,
} as const;

/** The asset payload of a `video.asset.*` delivery, narrowed to the fields we read. */
type WireAsset = {
  id?: unknown;
  passthrough?: unknown;
  duration?: unknown;
  aspect_ratio?: unknown;
  playback_ids?: unknown;
  new_asset_settings?: unknown;
};

type WireEvent = {
  id?: unknown;
  type?: unknown;
  data?: unknown;
};

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/** Mux reports a float; the row stores whole seconds and every cap is compared in whole seconds. */
const asSeconds = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;

/** The FIRST playback id is the one we publish; a signed asset is created with exactly one. */
function firstPlaybackId(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const first = value[0] as { id?: unknown } | undefined;
  return asString(first?.id);
}

/**
 * Our asset id as the provider echoed it. A `video.asset.*` delivery carries it at the top level of
 * the asset (`passthrough`); a `video.upload.errored` delivery describes the UPLOAD, whose
 * passthrough lives under `new_asset_settings` — verified against
 * the vendor SDK's published `resources/webhooks/webhooks.d.ts` at v15.2.0 (`WebhookDirectUpload`
 * has no top-level `passthrough`). When it is absent the job falls back to `providerAssetId`.
 */
function passthroughOf(data: WireAsset): string | null {
  const direct = asString(data.passthrough);
  if (direct) return direct;
  const nested = data.new_asset_settings as { passthrough?: unknown } | undefined;
  return asString(nested?.passthrough);
}

function kindOf(type: string): VideoProviderEventKind {
  if (type === READY_TYPE) return 'ready';
  if (type === ASSET_ERRORED_TYPE || type === UPLOAD_ERRORED_TYPE) return 'errored';
  return 'ignored';
}

/**
 * Throws `VideoProviderError('invalid_signature')` when the envelope has no id or type: a delivery
 * we cannot deduplicate is worse than a refused one, because the whole replay defence is keyed on
 * `event.id`. The kind is reused rather than adding a sixth one — from the route's point of view an
 * unusable envelope and a bad signature are the same refusal (403), and it carries no body either.
 */
export function normaliseProviderEvent(raw: unknown): VideoProviderEvent {
  const event = (raw ?? {}) as WireEvent;
  const id = asString(event.id);
  const rawType = asString(event.type);
  if (!id || !rawType) throw new VideoProviderError('invalid_signature', 403);

  const data = (event.data ?? {}) as WireAsset;
  const kind = kindOf(rawType);

  return {
    id,
    kind,
    rawType,
    assetId: passthroughOf(data),
    providerAssetId: asString(data.id),
    playbackId: kind === 'ready' ? firstPlaybackId(data.playback_ids) : null,
    durationSeconds: kind === 'ready' ? asSeconds(data.duration) : null,
    aspectRatio: kind === 'ready' ? asString(data.aspect_ratio) : null,
    // The TYPE, never the provider's own error text (T-03-41).
    failureReason: kind === 'errored' ? rawType : null,
  };
}
