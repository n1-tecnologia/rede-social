import type { MediaPurpose } from '@rede-social/contracts/media';
import { and, eq, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { withAdminTx } from '../../../db/admin-tx';
import { mediaAssets } from '../../../db/schema';
import { moduleLogger } from '../../logging';
import type { JobDefinition } from '../../modules/manifest';
import { limitFor } from '../limits';
import { videoProvider } from './index';
import { MEDIA_PROVIDER_EVENT_QUEUE, type VideoProviderEvent } from './types';

/**
 * `kernel.media-provider-event` (MEDIA-03) — applies ONE normalised provider event to ONE
 * `media_assets` row. Runs in the api image under `ROLE=worker` (D-18); `apps/api/src/worker.ts`
 * lists it next to the other kernel jobs and the queue registers itself in `media/video/index.ts`.
 *
 * The route does the fast, safe part (verify the signature, record the event id, enqueue) and
 * answers 2xx immediately, because Mux retries for 24 h on anything else. This handler does the
 * state change, and it is written for a world where deliveries arrive TWICE and OUT OF ORDER
 * (RESEARCH Pitfall 6, T-03-38/T-03-39):
 *
 *  - every write carries `id = $asset and tenant_id = $tenant` explicitly (the admin lane bypasses
 *    RLS, so the tenant predicate is the code's job);
 *  - `ready` writes under `status not in ('ready','deleted')` — replaying a ready event is a no-op,
 *    and a deleted asset is never resurrected;
 *  - `errored` writes under `status <> 'ready'` — an errored event that overtook a successful
 *    re-upload cannot clobber a good row. The predicate excludes ONLY `ready`, so a failed asset
 *    that later succeeds can still flip forward: recovery stays possible.
 *
 * Never throws: a malformed payload is logged and dropped (pg-boss would otherwise retry a crashing
 * job twice and then park it), and `deleteAsset` failures are logged without failing the job — the
 * row's terminal state matters more than the provider-side cleanup, which the 03-08 sweeper retries.
 *
 * Nothing here logs a provider body: `failure_reason` is the event TYPE (T-03-41).
 */
const log = moduleLogger('kernel-jobs');

/** Log-only actor id — nothing writes it to a `created_by` column. */
export const SYSTEM_ACTOR = 'system:media-provider-event';

/** The machine code `03-07`'s screen renders as "Recusado" rather than "Falhou". */
export const DURATION_TOO_LONG = 'duration_too_long';

/** A zod mirror of `VideoProviderEvent`: a job payload arrives as JSON from pg-boss, never typed. */
const payloadSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['ready', 'errored', 'ignored']),
  rawType: z.string().min(1),
  assetId: z.string().nullable(),
  providerAssetId: z.string().nullable(),
  playbackId: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
  aspectRatio: z.string().nullable(),
  failureReason: z.string().nullable(),
});

type Resolved = { id: string; tenantId: string; purpose: string; providerAssetId: string | null };

/**
 * The row this event is about. By OUR asset id when the provider echoed it (Mux `passthrough`),
 * otherwise by the provider's own id, which `startUpload` recorded as `provider_asset_id` — that is
 * the only handle a `video.upload.errored` delivery gives us.
 */
async function resolveAsset(event: VideoProviderEvent): Promise<Resolved | undefined> {
  return withAdminTx(async (tx) => {
    const columns = {
      id: mediaAssets.id,
      tenantId: mediaAssets.tenantId,
      purpose: mediaAssets.purpose,
      providerAssetId: mediaAssets.providerAssetId,
    };
    if (event.assetId) {
      const [byAssetId] = await tx
        .select(columns)
        .from(mediaAssets)
        .where(eq(mediaAssets.id, event.assetId))
        .limit(1);
      if (byAssetId) return byAssetId;
    }
    if (!event.providerAssetId) return undefined;
    const [byProvider] = await tx
      .select(columns)
      .from(mediaAssets)
      .where(eq(mediaAssets.providerAssetId, event.providerAssetId))
      .limit(1);
    return byProvider;
  });
}

/** Best effort: a provider asset we could not delete is cost, not corruption. */
async function deleteProviderAsset(providerAssetId: string): Promise<void> {
  try {
    await videoProvider.deleteAsset(providerAssetId);
  } catch (error) {
    log.warn(
      {
        event: 'media.provider_event.delete_failed',
        providerAssetId,
        // A `VideoProviderError` message carries a kind and a status and nothing else (T-03-41).
        err: error instanceof Error ? error.message : String(error),
      },
      'could not delete the provider asset; the 03-08 sweeper retries it',
    );
  }
}

type Outcome = 'done' | 'ignored' | 'gone' | 'stale' | 'rejected';

async function applyReady(event: VideoProviderEvent, row: Resolved): Promise<Outcome> {
  const limit = limitFor('video', row.purpose as MediaPurpose);
  const cap = limit.maxDurationSeconds;
  const duration = event.durationSeconds;

  // Mux enforces no duration at ingest, so a video is only measurable once ready (R-02). Strictly
  // `>`: a video exactly at the cap is accepted.
  if (cap !== undefined && duration !== null && duration > cap) {
    const providerAssetId = event.providerAssetId ?? row.providerAssetId;
    if (providerAssetId) await deleteProviderAsset(providerAssetId);
    const updated = await withAdminTx(async (tx) =>
      tx
        .update(mediaAssets)
        .set({ status: 'rejected', failureReason: DURATION_TOO_LONG, durationSeconds: duration })
        .where(
          and(
            eq(mediaAssets.id, row.id),
            eq(mediaAssets.tenantId, row.tenantId),
            // Same Pitfall 6 predicate: `status not in ('ready', 'deleted')`.
            notInArray(mediaAssets.status, ['ready', 'deleted']),
          ),
        )
        .returning({ id: mediaAssets.id }),
    );
    return updated.length === 0 ? 'stale' : 'rejected';
  }

  const updated = await withAdminTx(async (tx) =>
    tx
      .update(mediaAssets)
      .set({
        playbackId: event.playbackId,
        ...(event.providerAssetId ? { providerAssetId: event.providerAssetId } : {}),
        durationSeconds: duration,
        aspectRatio: event.aspectRatio,
        status: 'ready',
        failureReason: null,
        readyAt: new Date(),
      })
      .where(
        and(
          eq(mediaAssets.id, row.id),
          eq(mediaAssets.tenantId, row.tenantId),
          // Pitfall 6 — emits `status not in ('ready', 'deleted')`: a replayed ready is a no-op and
          // a soft-deleted asset is never resurrected.
          notInArray(mediaAssets.status, ['ready', 'deleted']),
        ),
      )
      .returning({ id: mediaAssets.id }),
  );
  return updated.length === 0 ? 'stale' : 'done';
}

async function applyErrored(event: VideoProviderEvent, row: Resolved): Promise<Outcome> {
  const updated = await withAdminTx(async (tx) =>
    tx
      .update(mediaAssets)
      .set({ status: 'failed', failureReason: event.failureReason ?? event.rawType })
      .where(
        and(
          eq(mediaAssets.id, row.id),
          eq(mediaAssets.tenantId, row.tenantId),
          // Pitfall 6 — emits `status not in ('ready', 'deleted')`. The failure predicate is
          // `<> 'ready'` (a late failure must never clobber an asset that already went ready), plus
          // the `deleted` guard: `status = 'deleted'` is the handle the 03-08 sweeper collects by,
          // so flipping a soft-deleted row to `failed` would strand its provider asset forever.
          // `failed` itself is NOT excluded, so a failed asset still recovers on a later ready.
          notInArray(mediaAssets.status, ['ready', 'deleted']),
        ),
      )
      .returning({ id: mediaAssets.id }),
  );
  return updated.length === 0 ? 'stale' : 'done';
}

export const mediaProviderEventJob: JobDefinition<VideoProviderEvent> = {
  name: MEDIA_PROVIDER_EVENT_QUEUE,
  handler: async (payload) => {
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) {
      log.error(
        {
          event: 'media.provider_event.bad_payload',
          issues: parsed.error.issues.length,
        },
        'kernel.media-provider-event received a malformed payload; dropped',
      );
      return;
    }
    const providerEvent = parsed.data as VideoProviderEvent;
    const t0 = Date.now();

    try {
      if (providerEvent.kind === 'ignored') {
        log.info(
          {
            event: 'media.provider_event.ignored',
            eventId: providerEvent.id,
            rawType: providerEvent.rawType,
            outcome: 'ignored',
            ms: Date.now() - t0,
          },
          'provider event carries no state change',
        );
        return;
      }

      const row = await resolveAsset(providerEvent);
      if (!row) {
        log.warn(
          {
            event: 'media.provider_event.gone',
            eventId: providerEvent.id,
            rawType: providerEvent.rawType,
            assetId: providerEvent.assetId,
            outcome: 'gone',
            ms: Date.now() - t0,
          },
          'provider event names no asset of ours; dropped',
        );
        return;
      }

      const outcome =
        providerEvent.kind === 'ready'
          ? await applyReady(providerEvent, row)
          : await applyErrored(providerEvent, row);

      log.info(
        {
          event: 'media.provider_event.done',
          eventId: providerEvent.id,
          rawType: providerEvent.rawType,
          tenantId: row.tenantId,
          assetId: row.id,
          outcome,
          actor: SYSTEM_ACTOR,
          ms: Date.now() - t0,
        },
        'kernel.media-provider-event ran',
      );
    } catch (error) {
      log.error(
        {
          event: 'media.provider_event.failed',
          eventId: providerEvent.id,
          rawType: providerEvent.rawType,
          assetId: providerEvent.assetId,
          outcome: 'failed',
          err: error instanceof Error ? error.message : String(error),
          ms: Date.now() - t0,
        },
        'kernel.media-provider-event failed unexpectedly; the provider retries the delivery',
      );
    }
  },
};
