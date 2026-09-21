import { and, eq, inArray } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { mediaAssets } from '../../db/schema';
import { enqueueInTx } from '../jobs/boss';
import { moduleLogger } from '../logging';
import type { JobDefinition } from '../modules/manifest';
import {
  type DeriveVariantsPayload,
  deriveVariantsPayloadSchema,
  MEDIA_DERIVE_MAX_ATTEMPTS,
  MEDIA_DERIVE_QUEUE,
} from './index';
import { deriveAssetVariants } from './service';

/**
 * `kernel.media-derive-variants` (MEDIA-02) — deriving a width ladder is CPU work (download, decode,
 * N resizes, N uploads) and runs in the api image under `ROLE=worker` only;
 * `apps/api/src/worker.ts` lists it next to `deriveIconsJob`, and the queue registers itself in
 * `media/index.ts`. The request path (`complete`) decodes the header and enqueues with
 * `singletonKey = assetId`; this handler does everything else.
 *
 * Never throws: a malformed payload is logged and dropped; an unexpected error is logged and, while
 * `attempt < MEDIA_DERIVE_MAX_ATTEMPTS`, one deferred job is re-armed. When the attempts are
 * exhausted the row is flipped to a terminal `status='failed', failure_reason='derive_failed'` —
 * AN ASSET IS NEVER LEFT IN `processing` FOREVER, so a poison file cannot loop and the UI always has
 * something definite to show. The two failure writes below are the only reason this file opens the
 * admin lane: they are job lifecycle, not broker behaviour, so they live with the job.
 *
 * Import direction is service -> job only: `media/service.ts` takes the queue name from `./index`,
 * never from this file, so there is no cycle.
 */
const log = moduleLogger('kernel-jobs');

/** Log-only actor id — nothing writes it to a `created_by` column. */
export const SYSTEM_ACTOR = 'system:media-derive-variants';

/** Terminal state after the bounded re-arm. Conditional, so a deleted or rejected row is untouched. */
async function markDerivationFailed(tenantId: string, assetId: string): Promise<void> {
  await withAdminTx(async (tx) => {
    await tx
      .update(mediaAssets)
      .set({ status: 'failed', failureReason: 'derive_failed' })
      .where(
        and(
          eq(mediaAssets.id, assetId),
          eq(mediaAssets.tenantId, tenantId),
          inArray(mediaAssets.status, ['pending', 'processing']),
        ),
      );
  });
}

/** One deferred re-arm, same `singletonKey` (the 02-13 `requeueIconDerivation` shape). */
async function requeueVariantDerivation(
  tenantId: string,
  assetId: string,
  attempt: number,
): Promise<void> {
  await withAdminTx(async (tx) => {
    await enqueueInTx(
      tx,
      MEDIA_DERIVE_QUEUE,
      { tenantId, assetId, attempt },
      { singletonKey: assetId, startAfter: 30 * attempt },
    );
  });
}

export const deriveVariantsJob: JobDefinition<DeriveVariantsPayload> = {
  name: MEDIA_DERIVE_QUEUE,
  handler: async (payload) => {
    const parsed = deriveVariantsPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      log.error(
        { event: 'media.derive_job.bad_payload', issues: parsed.error.issues.length },
        'kernel.media-derive-variants received a malformed payload; dropped',
      );
      return;
    }
    const { tenantId, assetId, attempt } = parsed.data;
    const t0 = Date.now();

    try {
      const result = await deriveAssetVariants(tenantId, assetId);
      log.info(
        {
          event: 'media.derive_job.done',
          tenantId,
          assetId,
          actor: SYSTEM_ACTOR,
          outcome: result.outcome,
          widths: result.widths,
          ms: Date.now() - t0,
        },
        'kernel.media-derive-variants ran',
      );
    } catch (error) {
      log.error(
        {
          event: 'media.derive_job.failed',
          tenantId,
          assetId,
          attempt,
          err: error instanceof Error ? error.message : String(error),
        },
        'kernel.media-derive-variants failed unexpectedly',
      );
      if (attempt >= MEDIA_DERIVE_MAX_ATTEMPTS) {
        try {
          await markDerivationFailed(tenantId, assetId);
        } catch (markError) {
          log.error(
            {
              event: 'media.derive_job.mark_failed_failed',
              tenantId,
              assetId,
              err: markError instanceof Error ? markError.message : String(markError),
            },
            'could not mark the asset terminally failed',
          );
        }
        log.error(
          { event: 'media.derive_job.gave_up', tenantId, assetId, attempt },
          'variant derivation gave up; the asset is terminally failed with derive_failed',
        );
        return;
      }
      try {
        await requeueVariantDerivation(tenantId, assetId, attempt + 1);
        log.info(
          { event: 'media.derive_job.rearmed', tenantId, assetId, attempt: attempt + 1 },
          'variant derivation re-armed after a crash',
        );
      } catch (rearmError) {
        log.error(
          {
            event: 'media.derive_job.rearm_failed',
            tenantId,
            assetId,
            err: rearmError instanceof Error ? rearmError.message : String(rearmError),
          },
          'could not re-arm variant derivation',
        );
      }
    }
  },
};
