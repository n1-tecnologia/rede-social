import { createHmac, timingSafeEqual } from 'node:crypto';
import { withAdminTx } from '../../../db/admin-tx';
import { env } from '../../env';
import { enqueueInTx } from '../../jobs/boss';
import { assertTenantKey, mediaOriginalKey } from '../keys';
import { signUpload } from '../storage';
import {
  MEDIA_PROVIDER_EVENT_QUEUE,
  VIDEO_WEBHOOK_TOLERANCE_S,
  type VideoAssetInfo,
  type VideoDirectUpload,
  type VideoDirectUploadInput,
  type VideoPlaybackTokens,
  type VideoProvider,
  VideoProviderError,
  type VideoProviderEvent,
  type VideoUploadState,
} from './types';
import { normaliseProviderEvent, VIDEO_EVENT_TYPES } from './wire';

/**
 * `VIDEO_PROVIDER=fake` — the env default and what every non-production environment runs (RESEARCH
 * Pitfall 7: an e2e run must never ingest into a real Mux account and accumulate stored minutes).
 *
 * Two design choices make it a real proof rather than a stub:
 *
 *  1. **It mints a Supabase signed upload URL into the SAME private `media` bucket**, under the
 *     asset's own `<tenant_id>/media/<assetId>/original` key, instead of accepting bytes at a
 *     dev-only API route. A byte-accepting route would put a body parser in the API and quietly
 *     contradict MEDIA-01's structural rule ("file bytes never transit Cloud Run"), so no such route
 *     exists anywhere: every automated proof in this phase exercises the real browser -> Storage path.
 *  2. **`verifyWebhook` is a real HMAC-SHA256 check**, not a no-op — same header shape, same
 *     `timestamp.rawBody` message, same 5-minute tolerance, same timing-safe compare, and it feeds
 *     the SAME `normaliseProviderEvent` the Mux adapter uses. So the route's 403 branch and the
 *     job's ready/errored branches are all reachable locally and in CI.
 *
 * Transcoding is simulated by a DEFERRED `kernel.media-provider-event` job carrying a synthetic
 * ready event, so `pnpm dev` really shows "Processando" turning into a playable asset a couple of
 * seconds later, without a second code path.
 */

/** Local-stack throwaway; `FAKE_VIDEO_WEBHOOK_SECRET` overrides it. Never a real credential. */
const DEFAULT_FAKE_SECRET = 'rede-social-local-fake-video-webhook-secret';

const DEFAULT_DURATION_SECONDS = 12;
const DEFAULT_ASPECT_RATIO = '16:9';
/** How long the simulated transcode "takes" (seconds). Long enough to observe, short enough to wait. */
const FAKE_TRANSCODE_DELAY_S = 2;

const fakeSecret = (): Buffer =>
  Buffer.from(env.FAKE_VIDEO_WEBHOOK_SECRET ?? DEFAULT_FAKE_SECRET, 'utf8');

/** `t=<unix seconds>,v1=<hex hmac>` — the header shape Mux uses, reimplemented for the fake. */
export const FAKE_VIDEO_SIGNATURE_HEADER = 'mux-signature';

/** The signature the fake accepts: HMAC-SHA256 over `${timestamp}.${rawBody}`. Exported for tests. */
export function signFakeVideoWebhook(rawBody: string, timestampSeconds: number): string {
  const mac = createHmac('sha256', fakeSecret())
    .update(`${timestampSeconds}.${rawBody}`)
    .digest('hex');
  return `t=${timestampSeconds},v1=${mac}`;
}

/**
 * Test seam (the `mediaInternals` / `brandingInternals` style). `signUpload` and `scheduleReady` are
 * injectable so the PURE kernel unit suite can exercise the adapter's contract with no Storage call
 * and no database, while the integration suite keeps the real ones and therefore keeps the
 * "bytes go straight to Storage" invariant honest. `deletedAssetIds` records the duration-cap path
 * and the 03-08 sweeper's provider-delete path; `failDeleteAsset` is the forced-refusal switch that
 * proves the sweeper leaves a RE-COLLECTABLE row when a provider says no, rather than orphaning the
 * vendor-side asset behind a deleted row.
 *
 * `uploadState` drives `getUploadState`, the reconciliation lookup (quick-260929-ltf), and
 * `uploadStateCalls` records every id it was asked about. The default answer is `waiting` ON PURPOSE:
 * the fake's own transcode is the deferred synthetic ready job above, so a reconciliation nobody
 * configured must be a no-op, and no existing suite changes behaviour.
 */
const waitingUpload = async (_providerUploadId: string): Promise<VideoUploadState> => ({
  state: 'waiting',
});

export const fakeVideoInternals = {
  durationSeconds: DEFAULT_DURATION_SECONDS,
  aspectRatio: DEFAULT_ASPECT_RATIO,
  deletedAssetIds: [] as string[],
  failDeleteAsset: false,
  signUpload: (key: string): Promise<{ signedUrl: string }> => signUpload(key),
  scheduleReady: (event: VideoProviderEvent): Promise<void> => enqueueSyntheticReady(event),
  uploadState: waitingUpload as (providerUploadId: string) => Promise<VideoUploadState>,
  uploadStateCalls: [] as string[],
};

/** Restores the module defaults; every test that touches the seam calls this in a `finally`. */
export function resetFakeVideoInternals(): void {
  fakeVideoInternals.durationSeconds = DEFAULT_DURATION_SECONDS;
  fakeVideoInternals.aspectRatio = DEFAULT_ASPECT_RATIO;
  fakeVideoInternals.deletedAssetIds = [];
  fakeVideoInternals.failDeleteAsset = false;
  fakeVideoInternals.signUpload = (key) => signUpload(key);
  fakeVideoInternals.scheduleReady = (event) => enqueueSyntheticReady(event);
  fakeVideoInternals.uploadState = waitingUpload;
  fakeVideoInternals.uploadStateCalls = [];
}

/**
 * The simulated transcoder. A DEFERRED job under its own `singletonKey` (never the event id, so it
 * cannot collide with a real delivery of the same asset) — `short` policy makes a second schedule of
 * the same asset a no-op while the first is still waiting.
 */
async function enqueueSyntheticReady(event: VideoProviderEvent): Promise<void> {
  await withAdminTx(async (tx) => {
    await enqueueInTx(tx, MEDIA_PROVIDER_EVENT_QUEUE, event, {
      singletonKey: `fake-ready-${event.assetId ?? event.id}`,
      startAfter: FAKE_TRANSCODE_DELAY_S,
    });
  });
}

/** The synthetic delivery the fake's own "transcode" produces, already normalised. */
function syntheticReadyEvent(assetId: string, providerAssetId: string): VideoProviderEvent {
  return {
    id: `fake-evt-${assetId}`,
    kind: 'ready',
    rawType: VIDEO_EVENT_TYPES.ready,
    assetId,
    providerAssetId,
    playbackId: `fake-playback-${assetId}`,
    durationSeconds: fakeVideoInternals.durationSeconds,
    aspectRatio: fakeVideoInternals.aspectRatio,
    failureReason: null,
  };
}

export function createFakeVideoProvider(): VideoProvider {
  return {
    name: 'fake',

    async createDirectUpload(input: VideoDirectUploadInput): Promise<VideoDirectUpload> {
      // The asset's OWN key, asserted before the Storage call exactly like an image (T-03-01/T-03-02).
      const key = mediaOriginalKey(input.tenantId, input.assetId);
      assertTenantKey(key, input.tenantId);
      const { signedUrl } = await fakeVideoInternals.signUpload(key);
      const providerUploadId = `fake-${input.assetId}`;
      await fakeVideoInternals.scheduleReady(syntheticReadyEvent(input.assetId, providerUploadId));
      return { providerUploadId, uploadUrl: signedUrl };
    },

    async getUploadState(providerUploadId: string): Promise<VideoUploadState> {
      fakeVideoInternals.uploadStateCalls.push(providerUploadId);
      return await fakeVideoInternals.uploadState(providerUploadId);
    },

    async getAsset(providerAssetId: string): Promise<VideoAssetInfo> {
      return {
        providerAssetId,
        status: 'ready',
        playbackId: `fake-playback-${providerAssetId}`,
        durationSeconds: fakeVideoInternals.durationSeconds,
        aspectRatio: fakeVideoInternals.aspectRatio,
      };
    },

    async deleteAsset(providerAssetId: string): Promise<void> {
      // The refusal is raised BEFORE the recorder so a forced failure leaves no trace of a delete
      // that did not happen — otherwise a test could not tell "refused" from "deleted and retried".
      if (fakeVideoInternals.failDeleteAsset) throw new VideoProviderError('unavailable', 503);
      fakeVideoInternals.deletedAssetIds.push(providerAssetId);
    },

    async signPlayback(
      playbackId: string,
      opts: { expiresInSeconds: number },
    ): Promise<VideoPlaybackTokens> {
      // Deterministic, non-empty and obviously not a real JWT — 03-07 asserts presence, not contents.
      const stamp = `${playbackId}.${opts.expiresInSeconds}`;
      return {
        playback: `fake-playback-token.${stamp}`,
        thumbnail: `fake-thumbnail-token.${stamp}`,
        storyboard: `fake-storyboard-token.${stamp}`,
      };
    },

    async verifyWebhook(
      rawBody: string,
      headers: Record<string, string | undefined>,
    ): Promise<VideoProviderEvent> {
      const header = headers[FAKE_VIDEO_SIGNATURE_HEADER];
      if (!header) throw new VideoProviderError('invalid_signature', 403);

      const parts = new Map<string, string>();
      for (const pair of header.split(',')) {
        const [name, value] = pair.split('=', 2);
        if (name && value) parts.set(name.trim(), value.trim());
      }
      const timestamp = Number(parts.get('t'));
      const signature = parts.get('v1');
      if (!signature || !Number.isFinite(timestamp)) {
        throw new VideoProviderError('invalid_signature', 403);
      }
      // Replay window BEFORE the compare, so a captured-but-stale delivery is refused even with a
      // perfectly valid signature (the same 5-minute tolerance the real verifier applies).
      if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > VIDEO_WEBHOOK_TOLERANCE_S) {
        throw new VideoProviderError('invalid_signature', 403);
      }

      const expected = createHmac('sha256', fakeSecret())
        .update(`${timestamp}.${rawBody}`)
        .digest();
      let provided: Buffer;
      try {
        provided = Buffer.from(signature, 'hex');
      } catch {
        throw new VideoProviderError('invalid_signature', 403);
      }
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        throw new VideoProviderError('invalid_signature', 403);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        throw new VideoProviderError('invalid_signature', 403);
      }
      return normaliseProviderEvent(parsed);
    },
  };
}
