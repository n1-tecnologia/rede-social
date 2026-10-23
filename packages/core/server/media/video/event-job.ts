import type { MediaPurpose } from '@rede-social/contracts/media';
import { and, eq, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { withAdminTx } from '../../../db/admin-tx';
import { mediaAssets } from '../../../db/schema';
import { moduleLogger } from '../../logging';
import type { JobDefinition } from '../../modules/manifest';
import { centralProjectId } from '../../tenancy/project-registry';
import { limitFor } from '../limits';
import { judgeDuration } from './duration-verdict';
import { videoProvider } from './index';
import { setVideoRouteProviderId } from './routes';
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

/**
 * WR-06: the reason of a member video the provider reported ready WITHOUT a duration. A member of the
 * closed `MEDIA_ISSUES` set, so the web already has copy for it; `failed`, not `rejected`, because the
 * member did nothing they can act on.
 */
export const DURATION_UNMEASURABLE = 'transcode_failed';

/** A zod mirror of `VideoProviderEvent`: a job payload arrives as JSON from pg-boss, never typed. */
const payloadSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['ready', 'errored', 'ignored']),
  rawType: z.string().min(1),
  assetId: z.string().nullable(),
  // 09.2-10: absent on a job queued before the passthrough carried the tenant.
  tenantId: z.string().nullable().optional(),
  providerAssetId: z.string().nullable(),
  playbackId: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
  aspectRatio: z.string().nullable(),
  failureReason: z.string().nullable(),
});

type Resolved = {
  id: string;
  tenantId: string;
  purpose: string;
  providerAssetId: string | null;
  /** 09-06: the cap snapshotted at `start` for a member's `post` video; null = the static cap. */
  durationCapSeconds: number | null;
};

/**
 * The row this event is about. By OUR asset id when the provider echoed it (Mux `passthrough`),
 * otherwise by the provider's own id, which `startUpload` recorded as `provider_asset_id` — that is
 * the only handle a `video.upload.errored` delivery gives us.
 *
 * WHICH DATABASE (09.2-10): the webhook recorded the event AND enqueued this job inside the tenant's own
 * project, so every `media_assets` row of the project the job runs in belongs to one of ITS tenants, and the
 * lookup opens that project (`{ projectId }`, handed over by the worker). A tenant named by the event that is
 * not the row's tenant is no match (T-09.2-47): a forged tenant half cannot reach another tenant's asset.
 */
async function resolveAsset(
  event: VideoProviderEvent,
  projectId: string,
): Promise<Resolved | undefined> {
  const found = await lookupAsset(event, projectId);
  if (found && event.tenantId && found.tenantId !== event.tenantId) return undefined;
  return found;
}

async function lookupAsset(
  event: VideoProviderEvent,
  projectId: string,
): Promise<Resolved | undefined> {
  return withAdminTx({ projectId }, async (tx) => {
    const columns = {
      id: mediaAssets.id,
      tenantId: mediaAssets.tenantId,
      purpose: mediaAssets.purpose,
      providerAssetId: mediaAssets.providerAssetId,
      durationCapSeconds: mediaAssets.durationCapSeconds,
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

/** Best effort: the route's provider id is a safety net, never a reason to fail the event. */
async function learnProviderId(
  assetId: string,
  tenantId: string,
  providerAssetId: string,
): Promise<void> {
  try {
    await setVideoRouteProviderId(assetId, tenantId, providerAssetId);
  } catch (error) {
    log.warn(
      {
        event: 'media.provider_event.route_update_failed',
        assetId,
        err: error instanceof Error ? error.message : String(error),
      },
      'could not record the provider asset id on the video route',
    );
  }
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

type Outcome = 'done' | 'ignored' | 'gone' | 'stale' | 'rejected' | 'failed';

async function applyReady(event: VideoProviderEvent, row: Resolved): Promise<Outcome> {
  const limit = limitFor('video', row.purpose as MediaPurpose);
  const duration = event.durationSeconds;
  // 09-06 (D-474): a member upload carries the cap its tenant had when the upload STARTED, so a limit
  // lowered mid-flight judges only later uploads; everything else (null) uses the static cap.
  // Mux enforces no duration at ingest, so a video is only measurable once ready (R-02).
  const verdict = judgeDuration({
    memberCapSeconds: row.durationCapSeconds,
    staticCapSeconds: limit.maxDurationSeconds,
    durationSeconds: duration,
  });

  if (verdict === 'too_long') {
    const providerAssetId = event.providerAssetId ?? row.providerAssetId;
    if (providerAssetId) await deleteProviderAsset(providerAssetId);
    const updated = await withAdminTx({ tenantId: row.tenantId }, async (tx) =>
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

  if (verdict === 'unmeasurable') {
    // WR-06: fail closed. The duration stays null and the provider asset is deleted best effort.
    const providerAssetId = event.providerAssetId ?? row.providerAssetId;
    if (providerAssetId) await deleteProviderAsset(providerAssetId);
    const updated = await withAdminTx({ tenantId: row.tenantId }, async (tx) =>
      tx
        .update(mediaAssets)
        .set({ status: 'failed', failureReason: DURATION_UNMEASURABLE })
        .where(
          and(
            eq(mediaAssets.id, row.id),
            eq(mediaAssets.tenantId, row.tenantId),
            // Same Pitfall 6 predicate: a ready or soft-deleted row is never touched.
            notInArray(mediaAssets.status, ['ready', 'deleted']),
          ),
        )
        .returning({ id: mediaAssets.id }),
    );
    return updated.length === 0 ? 'stale' : 'failed';
  }

  const updated = await withAdminTx({ tenantId: row.tenantId }, async (tx) =>
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
  const updated = await withAdminTx({ tenantId: row.tenantId }, async (tx) =>
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
  handler: async (payload, ctx) => {
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

      // The worker names the project whose queue delivered the job; a direct call (a test, an operator
      // command) means the central project.
      const row = await resolveAsset(providerEvent, ctx?.projectId ?? (await centralProjectId()));
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

      // The first event that carries both ids teaches the route the provider's own id (best effort).
      if (providerEvent.providerAssetId && row.providerAssetId !== providerEvent.providerAssetId) {
        await learnProviderId(row.id, row.tenantId, providerEvent.providerAssetId);
      }

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
