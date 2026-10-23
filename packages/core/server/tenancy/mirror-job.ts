import { withPlatformTx } from '../../db/platform-tx';
import { enqueueInTx, registerJobQueues } from '../jobs/boss';
import { moduleLogger } from '../logging';
import type { JobDefinition } from '../modules/manifest';
import { reconcileAllMirrors } from './mirror';

/**
 * `platform.mirror-reconcile` (09.2-09, D-537, D-546, DBT-05): the periodic healing of the central mirror of
 * every tenant that lives in another project. A push after a commit is best effort (a failed push is a log
 * line, never a failed request); this job is what makes the two copies converge: `reconcileAllMirrors` reads
 * both sides, copies the central-owned columns down and the tenant-owned brand up, and reports counts.
 *
 * A PLATFORM-scope job (it works across projects, so it belongs to the control plane, not to any tenant's
 * queue): it lives in `pgboss_platform` of the central project, is enqueued from the platform lane and is
 * worked by the supervisor's central instance.
 *
 * **No scheduler, on purpose.** Like the media sweeper, the domain poller and the daily dispatcher, it paces
 * itself: every run ends by queueing the next one 600 s out under a CONSTANT singleton key, which the `short`
 * queue policy turns into "at most one waiting run". The worker opens the cadence at boot under a DIFFERENT
 * key (`armMirrorReconcile`), so a pending re-arm can never swallow the boot run.
 *
 * Never throws (the sweeper rule): pg-boss would retry a crashing job and park it, leaving the cadence
 * stopped. A failed pass is logged and the re-arm happens whatever the outcome. Logs carry counts only.
 */

/** The job's queue, a platform-scope queue. */
export const MIRROR_RECONCILE_QUEUE = 'platform.mirror-reconcile';

/** The constant singleton key of the re-arm. */
export const MIRROR_RECONCILE_SINGLETON = 'mirror-reconcile';

/** The boot arm's singleton key: never the re-arm's, so a pending re-arm cannot swallow the boot run. */
export const MIRROR_RECONCILE_BOOT_SINGLETON = 'mirror-reconcile:boot';

/** Seconds between two runs. */
export const MIRROR_RECONCILE_INTERVAL_S = 600;

registerJobQueues([MIRROR_RECONCILE_QUEUE], 'platform');

const log = moduleLogger('kernel-jobs');

/** Queues the next run; a `null` id is the dropped duplicate (a success). */
async function rearm(): Promise<void> {
  await withPlatformTx((tx) =>
    enqueueInTx(
      tx,
      MIRROR_RECONCILE_QUEUE,
      {},
      { singletonKey: MIRROR_RECONCILE_SINGLETON, startAfter: MIRROR_RECONCILE_INTERVAL_S },
    ),
  );
}

export const mirrorReconcileJob: JobDefinition<Record<string, never>> = {
  name: MIRROR_RECONCILE_QUEUE,
  scope: 'platform',
  handler: async () => {
    try {
      const result = await reconcileAllMirrors();
      log.info(
        {
          event: 'platform.mirror_reconcile.ran',
          tenants: result.tenants,
          healed: result.healed,
          failed: result.failed,
        },
        'mirror reconcile ran',
      );
    } catch (err) {
      log.error(
        {
          event: 'platform.mirror_reconcile.failed',
          err: err instanceof Error ? err.message : String(err),
        },
        'mirror reconcile failed; the next run retries',
      );
    }
    try {
      await rearm();
    } catch (err) {
      log.error(
        {
          event: 'platform.mirror_reconcile.rearm_failed',
          err: err instanceof Error ? err.message : String(err),
        },
        'could not re-arm the mirror reconcile; the next worker start re-opens it',
      );
    }
  },
};

/**
 * Queues ONE immediate run under the boot singleton, called best-effort by the worker at start. Returns
 * whether THIS call queued it (a `null` id is the dropped duplicate of a boot run still waiting).
 */
export async function armMirrorReconcile(): Promise<boolean> {
  const id = await withPlatformTx((tx) =>
    enqueueInTx(tx, MIRROR_RECONCILE_QUEUE, {}, { singletonKey: MIRROR_RECONCILE_BOOT_SINGLETON }),
  );
  return id !== null;
}
