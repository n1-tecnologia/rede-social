import { withPlatformTx } from '../../db/platform-tx';
import { enqueueInTx, registerJobQueues } from '../jobs/boss';
import { moduleLogger } from '../logging';
import type { JobDefinition } from '../modules/manifest';
import { checkAllProjects } from './health';

/**
 * `platform.project-health` (09.2-14, D-543, DBT-27): the periodic look at every ready project. Each run checks
 * the ready projects with bounded concurrency (`checkAllProjects`), stores one `platform.project_health` row per
 * project and drops the caches of a project whose state changed, so a paused or unreachable project is held out
 * of the shell within a run instead of when somebody notices.
 *
 * A PLATFORM-scope job (it crosses projects): it lives in `pgboss_platform` of the central project, is enqueued
 * from the platform lane and is worked by the supervisor's central instance. **No scheduler, on purpose**: like
 * the mirror reconcile, the domain poller and the sweeper it paces itself: every run ends by queueing the next
 * one 300 s out under a CONSTANT singleton key, which the `short` queue policy turns into "at most one waiting
 * run". The worker opens the cadence at boot under a DIFFERENT key (`armProjectHealth`), so a pending re-arm can
 * never swallow the boot run.
 *
 * Never throws (the sweeper rule): pg-boss would retry a crashing job and park it, leaving the cadence stopped.
 * A failed sweep is logged and the re-arm happens whatever the outcome. Logs carry counts only.
 */

/** The job's queue, a platform-scope queue. */
export const PROJECT_HEALTH_QUEUE = 'platform.project-health';

/** The constant singleton key of the re-arm. */
export const PROJECT_HEALTH_SINGLETON = 'project-health';

/** The boot arm's singleton key: never the re-arm's. */
export const PROJECT_HEALTH_BOOT_SINGLETON = 'project-health:boot';

/** Seconds between two runs. */
export const PROJECT_HEALTH_INTERVAL_S = 300;

registerJobQueues([PROJECT_HEALTH_QUEUE], 'platform');

const log = moduleLogger('project-health');

async function rearm(): Promise<void> {
  await withPlatformTx((tx) =>
    enqueueInTx(
      tx,
      PROJECT_HEALTH_QUEUE,
      {},
      { singletonKey: PROJECT_HEALTH_SINGLETON, startAfter: PROJECT_HEALTH_INTERVAL_S },
    ),
  );
}

export const projectHealthJob: JobDefinition<Record<string, never>> = {
  name: PROJECT_HEALTH_QUEUE,
  scope: 'platform',
  handler: async () => {
    try {
      const result = await checkAllProjects();
      log.info(
        {
          event: 'platform.project_health.ran',
          checked: result.checked,
          changed: result.changed,
          failed: result.failed,
        },
        'project health ran',
      );
    } catch (err) {
      log.error(
        {
          event: 'platform.project_health.failed',
          errorName: err instanceof Error ? err.name : 'unknown',
        },
        'project health failed; the next run retries',
      );
    }
    try {
      await rearm();
    } catch (err) {
      log.error(
        {
          event: 'platform.project_health.rearm_failed',
          errorName: err instanceof Error ? err.name : 'unknown',
        },
        'could not re-arm the project health; the next worker start re-opens it',
      );
    }
  },
};

/**
 * Queues ONE immediate run under the boot singleton, called best-effort by the worker at start. Returns whether
 * THIS call queued it (a `null` id is the dropped duplicate of a boot run still waiting).
 */
export async function armProjectHealth(): Promise<boolean> {
  const id = await withPlatformTx((tx) =>
    enqueueInTx(tx, PROJECT_HEALTH_QUEUE, {}, { singletonKey: PROJECT_HEALTH_BOOT_SINGLETON }),
  );
  return id !== null;
}
