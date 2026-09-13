import { createBoss } from '@tria/core/server/jobs/boss';
import type { JobDefinition } from '@tria/core/server/modules/manifest';
import { env } from './env';
import { rootLogger } from './http/logger';
import { MODULE_REGISTRY } from './modules/registry';

/**
 * `ROLE=worker` entry point (D-18: the SAME image as the API, a different `ROLE`; there is no
 * `apps/worker`). It owns everything long-running about pg-boss — polling, supervision, archiving —
 * so the request-serving role stays stateless and scale-to-zero friendly.
 *
 * Queue creation happens HERE at start, for every `JobDefinition` any registered module declares.
 * `createQueue` is idempotent, which is what makes the concurrent cases safe: two worker instances
 * booting together, or a worker booting while the API performs its first lazy enqueue, all converge
 * on the same queue row.
 */
export async function startWorker(): Promise<void> {
  const jobs: JobDefinition[] = Object.values(MODULE_REGISTRY).flatMap(
    (manifest) => manifest?.jobs ?? [],
  );

  // Session-mode connection in production (A6): the worker polls continuously, the API does not.
  const boss = createBoss({
    connectionString: env.BOSS_DATABASE_URL ?? env.DATABASE_URL,
    max: 2,
  });
  boss.on('error', (err) => rootLogger.error({ err }, 'pg-boss error'));

  await boss.start();

  for (const job of jobs) {
    await boss.createQueue(job.name);
    await boss.work(job.name, async (batch) => {
      for (const item of batch) await job.handler(item.data);
    });
  }

  rootLogger.info({ queues: jobs.map((job) => job.name), role: env.ROLE }, 'worker.started');

  // Cloud Run sends SIGTERM before shutdown: finish in-flight jobs, then exit.
  process.on('SIGTERM', () => {
    rootLogger.info('SIGTERM received, stopping worker');
    boss
      .stop({ graceful: true, timeout: 20_000 })
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        rootLogger.error({ err }, 'error while stopping worker');
        process.exit(1);
      });
  });
}
