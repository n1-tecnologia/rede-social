import { moduleLogger } from '../../logging';
import { mediaProviderEventJob } from './event-job';
import { videoProvider } from './index';
import type { VideoProviderEvent, VideoUploadState } from './types';
import { VIDEO_EVENT_TYPES } from './wire';

/**
 * Reconciliation of a stale video with its provider (quick-260929-ltf).
 *
 * Why it exists: on 2026-09-29 a Cloud Run revision swap closed the provider's pooled connections,
 * webhook deliveries failed for about 14 minutes, and two videos the provider already had `ready`
 * sat `pending` in `media_assets`. The webhook STAYS the primary path; this is the fallback that
 * makes a polled (or swept) video converge without it.
 *
 * How it works:
 *  - while a video is `pending`/`processing`, `provider_asset_id` holds the provider's UPLOAD id —
 *    `startVideoUpload` writes it at upload start, and the ready transition later overwrites it with
 *    the ASSET id — so `videoProvider.getUploadState` can ask about it with no new column;
 *  - the answer becomes a NORMALISED `VideoProviderEvent` and runs through
 *    `mediaProviderEventJob.handler`, the webhook's own job, so the transition (ready, errored,
 *    duration-cap rejection, provider-asset delete) is literally the same code. Its writes carry
 *    `status not in ('ready','deleted')`, so reconciliation and a late or duplicate webhook converge
 *    on one outcome in either order;
 *  - the synthetic event id (`reconcile:<assetId>:<kind>`) never enters `media_provider_events`:
 *    that table is the webhook's replay ledger of PROVIDER event ids and stays provider-only;
 *  - lookups are throttled to one per asset per `RECONCILE_MIN_INTERVAL_MS`, PER INSTANCE (an
 *    in-memory map, checked and set before any await), and never happen inside
 *    `RECONCILE_GRACE_MS` of the row's creation, where the webhook almost always wins.
 *
 * Never throws: a provider error or an apply failure is logged and answered `false`, so the GET
 * that called it still answers the current row. Log lines carry a `VideoProviderError` message,
 * which is a kind and a status and nothing else (T-03-41).
 */
const log = moduleLogger('media');

/** No lookup before a video is this old: the webhook normally lands well inside it. */
export const RECONCILE_GRACE_MS = 15_000;

/** At most one provider lookup per asset per this interval, per API/worker instance. */
export const RECONCILE_MIN_INTERVAL_MS = 10_000;

/** Above this many remembered assets, entries older than the interval are pruned. */
const THROTTLE_PRUNE_AT = 1_000;

export type ReconcilableVideo = {
  id: string;
  tenantId: string;
  kind: string;
  status: string;
  provider: string;
  providerAssetId: string | null;
  createdAt: Date;
};

/** Test seam (the `fakeVideoInternals` style): the clock the grace and the throttle read. */
export const reconcileInternals = {
  now: (): number => Date.now(),
};

const lastLookup = new Map<string, number>();

/** Restores the real clock and forgets every throttle entry. */
export function resetReconcileInternals(): void {
  reconcileInternals.now = () => Date.now();
  lastLookup.clear();
}

/**
 * The provider's answer as the event a webhook would have delivered, or `null` when there is
 * nothing to apply yet (`waiting`, or an asset still `preparing`).
 */
export function eventFromUploadState(
  assetId: string,
  providerUploadId: string,
  state: VideoUploadState,
): VideoProviderEvent | null {
  if (state.state === 'waiting') return null;

  if (state.state === 'errored') {
    return {
      id: `reconcile:${assetId}:errored`,
      kind: 'errored',
      rawType: VIDEO_EVENT_TYPES.uploadErrored,
      assetId,
      providerAssetId: providerUploadId,
      playbackId: null,
      durationSeconds: null,
      aspectRatio: null,
      failureReason: VIDEO_EVENT_TYPES.uploadErrored,
    };
  }

  const { asset } = state;
  if (asset.status === 'preparing') return null;

  if (asset.status === 'errored') {
    return {
      id: `reconcile:${assetId}:errored`,
      kind: 'errored',
      rawType: VIDEO_EVENT_TYPES.assetErrored,
      assetId,
      providerAssetId: asset.providerAssetId,
      playbackId: null,
      durationSeconds: null,
      aspectRatio: null,
      failureReason: VIDEO_EVENT_TYPES.assetErrored,
    };
  }

  return {
    id: `reconcile:${assetId}:ready`,
    kind: 'ready',
    rawType: VIDEO_EVENT_TYPES.ready,
    assetId,
    providerAssetId: asset.providerAssetId,
    playbackId: asset.playbackId,
    durationSeconds: asset.durationSeconds,
    aspectRatio: asset.aspectRatio,
    failureReason: null,
  };
}

function isEligible(
  row: ReconcilableVideo,
  now: number,
): row is ReconcilableVideo & {
  providerAssetId: string;
} {
  return (
    row.kind === 'video' &&
    (row.status === 'pending' || row.status === 'processing') &&
    row.provider === videoProvider.name &&
    row.providerAssetId !== null &&
    now - row.createdAt.getTime() >= RECONCILE_GRACE_MS
  );
}

/** Synchronous by design: two concurrent polls on one instance must make ONE lookup. */
function claimLookup(assetId: string, now: number): boolean {
  const last = lastLookup.get(assetId);
  if (last !== undefined && now - last < RECONCILE_MIN_INTERVAL_MS) return false;
  if (lastLookup.size > THROTTLE_PRUNE_AT) {
    for (const [id, at] of lastLookup) {
      if (now - at >= RECONCILE_MIN_INTERVAL_MS) lastLookup.delete(id);
    }
  }
  lastLookup.set(assetId, now);
  return true;
}

/**
 * Asks the provider about ONE stale video and applies the answer. Answers `true` only when an event
 * was applied (the caller then re-reads the row); every other path — ineligible, throttled, still
 * waiting, a provider error — answers `false` and changes nothing.
 */
export async function reconcileVideoAsset(row: ReconcilableVideo): Promise<boolean> {
  const now = reconcileInternals.now();
  if (!isEligible(row, now)) return false;
  if (!claimLookup(row.id, now)) return false;

  let state: VideoUploadState;
  try {
    state = await videoProvider.getUploadState(row.providerAssetId);
  } catch (error) {
    log.warn(
      {
        event: 'media.reconcile.lookup_failed',
        tenantId: row.tenantId,
        assetId: row.id,
        provider: row.provider,
        // A `VideoProviderError` message carries a kind and a status and nothing else (T-03-41).
        err: error instanceof Error ? error.message : String(error),
      },
      'could not read the upload state from the video provider; the webhook stays primary',
    );
    return false;
  }

  const event = eventFromUploadState(row.id, row.providerAssetId, state);
  if (!event) return false;

  try {
    await mediaProviderEventJob.handler(event);
  } catch (error) {
    log.warn(
      {
        event: 'media.reconcile.apply_failed',
        tenantId: row.tenantId,
        assetId: row.id,
        provider: row.provider,
        err: error instanceof Error ? error.message : String(error),
      },
      'could not apply the reconciled provider state',
    );
    return false;
  }

  log.info(
    {
      event: 'media.reconcile.applied',
      tenantId: row.tenantId,
      assetId: row.id,
      kind: event.kind,
      provider: row.provider,
    },
    'a stale video was reconciled with its provider',
  );
  return true;
}
