import { moduleLogger } from '../logging';
import type { JobDefinition } from '../modules/manifest';
import { deriveTenantIcons, requeueIconDerivation } from '../platform/branding';
import {
  BRANDING_DERIVE_ICONS_QUEUE,
  BRANDING_DERIVE_MAX_ATTEMPTS,
  type DeriveIconsPayload,
  deriveIconsPayloadSchema,
} from './index';

/**
 * `kernel.branding-derive-icons` (D-28) — icon derivation is CPU work (rasterise, resize,
 * composite, ICO packing, five uploads) and runs in the api image under `ROLE=worker` only;
 * `apps/api/src/worker.ts` lists it next to `domainVerifyJob`, and the queue registers itself in
 * `branding/index.ts`. The request path (`complete`, `colors`) bumps `iconVersion` and enqueues
 * with `singletonKey = tenantId`; this handler derives from the CURRENT row and writes only if the
 * version it read is still current (a newer upload supersedes it silently, T-02-88).
 *
 * Never throws: a malformed payload is logged and dropped; an unexpected error is logged and, while
 * `attempt < BRANDING_DERIVE_MAX_ATTEMPTS`, one deferred job is re-armed through the platform lane.
 * Import direction is service -> job only: `platform/branding.ts` takes the queue name from
 * `./index`, never from this file, so there is no cycle.
 */
const log = moduleLogger('kernel-jobs');

/** Log-only actor id — nothing writes it to a `created_by` column. */
export const SYSTEM_ACTOR = 'system:branding-derive-icons';

export const deriveIconsJob: JobDefinition<DeriveIconsPayload> = {
  name: BRANDING_DERIVE_ICONS_QUEUE,
  handler: async (payload) => {
    const parsed = deriveIconsPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      log.error(
        { event: 'branding.derive_icons_job.bad_payload', issues: parsed.error.issues.length },
        'kernel.branding-derive-icons received a malformed payload; dropped',
      );
      return;
    }
    const { tenantId, attempt } = parsed.data;
    const t0 = Date.now();

    try {
      const result = await deriveTenantIcons(tenantId, { actor: { userId: SYSTEM_ACTOR } });
      log.info(
        {
          event: 'branding.derive_icons_job.done',
          tenantId,
          outcome: result.outcome,
          iconVersion: result.iconVersion,
          ms: Date.now() - t0,
        },
        'kernel.branding-derive-icons ran',
      );
    } catch (error) {
      log.error(
        {
          event: 'branding.derive_icons_job.failed',
          tenantId,
          attempt,
          err: error instanceof Error ? error.message : String(error),
        },
        'kernel.branding-derive-icons failed unexpectedly',
      );
      if (attempt >= BRANDING_DERIVE_MAX_ATTEMPTS) {
        log.error(
          { event: 'branding.derive_icons_job.gave_up', tenantId, attempt },
          'icon derivation gave up; the next brand mutation re-opens it',
        );
        return;
      }
      try {
        await requeueIconDerivation(tenantId, attempt + 1);
        log.info(
          { event: 'branding.derive_icons_job.rearmed', tenantId, attempt: attempt + 1 },
          'icon derivation re-armed after a crash',
        );
      } catch (rearmError) {
        log.error(
          {
            event: 'branding.derive_icons_job.rearm_failed',
            tenantId,
            err: rearmError instanceof Error ? rearmError.message : String(rearmError),
          },
          'could not re-arm icon derivation; the next brand mutation re-opens it',
        );
      }
    }
  },
};
