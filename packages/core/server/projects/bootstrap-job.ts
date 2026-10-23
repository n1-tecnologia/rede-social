import { z } from 'zod';
import type { Tx } from '../../db/tenant-tx';
import { enqueueInTx, registerJobQueues } from '../jobs/boss';
import { moduleLogger } from '../logging';
import type { JobDefinition } from '../modules/manifest';
import { runBootstrap } from './bootstrap';

/**
 * `platform.project-bootstrap` (09.2-13, D-542, DBT-17): the durable job behind "Criar" and "Tentar de novo".
 * A PLATFORM-scope queue: it lives in `pgboss_platform` of the central project (enqueued from `withPlatformTx`,
 * worked by the supervisor's platform instance), because it drives a project that has no queue of its own yet.
 *
 * The payload is `{ projectId }` and nothing else (T-09.2-61): every credential the run uses is read from the
 * sealed registry by the step that needs it. `retryLimit: 0` because the step rows ARE the retry mechanism
 * ("Tentar de novo" resumes at the first step that is not done); `expireInSeconds: 3600` bounds a stuck run,
 * after which the 15-minute step lease lets the next job reclaim the step. `singletonKey: projectId` under the
 * `short` policy keeps at most one WAITING job per project, so a double click queues one.
 *
 * The handler never throws: a failed step is data (a row with a reason code), not a job failure to retry.
 */
export const PROJECT_BOOTSTRAP_QUEUE = 'platform.project-bootstrap';

registerJobQueues([PROJECT_BOOTSTRAP_QUEUE], 'platform');

const log = moduleLogger('project-bootstrap');

export type ProjectBootstrapPayload = { projectId: string };

const payloadSchema = z.object({ projectId: z.uuid() });

/** Enqueue inside the caller's PLATFORM transaction (the lane guard refuses any other). */
export function enqueueBootstrap(tx: Tx, projectId: string): Promise<string | null> {
  return enqueueInTx(tx, PROJECT_BOOTSTRAP_QUEUE, { projectId } satisfies ProjectBootstrapPayload, {
    singletonKey: projectId,
    retryLimit: 0,
    expireInSeconds: 3600,
  });
}

export const projectBootstrapJob: JobDefinition<ProjectBootstrapPayload> = {
  name: PROJECT_BOOTSTRAP_QUEUE,
  scope: 'platform',
  handler: async (payload) => {
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) {
      log.error(
        { event: 'project.bootstrap.bad_payload', issues: parsed.error.issues.length },
        'platform.project-bootstrap received a malformed payload; dropped',
      );
      return;
    }
    const { projectId } = parsed.data;
    try {
      const outcome = await runBootstrap(projectId);
      log.info(
        {
          event: 'project.bootstrap.job_done',
          projectId,
          outcome: outcome.status,
          ...(outcome.status === 'failed' ? { step: outcome.step, reason: outcome.reason } : {}),
        },
        'platform.project-bootstrap ran',
      );
    } catch (error) {
      // The engine records step failures itself; reaching here is an infrastructure fault (the registry
      // unreachable). Name the class, never the message: a driver message can carry a host.
      log.error(
        {
          event: 'project.bootstrap.job_failed',
          projectId,
          errorName: error instanceof Error ? error.name : 'unknown',
        },
        'platform.project-bootstrap failed unexpectedly',
      );
    }
  },
};
