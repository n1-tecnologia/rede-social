import { serve } from '@hono/node-server';
import { createBoss, createQueues } from '@tria/core/server/jobs/boss';
import type { AnyJobDefinition } from '@tria/core/server/modules/manifest';
import { Hono } from 'hono';
import { env } from './env';
import { rootLogger } from './http/logger';
import { MODULE_REGISTRY } from './modules/registry';

/**
 * `ROLE=worker` entry point (D-18: the SAME image as the API, a different `ROLE`; there is no
 * `apps/worker`). It owns everything long-running about pg-boss — polling, supervision, archiving —
 * so the request-serving role stays stateless and scale-to-zero friendly.
 *
 * Queue creation happens HERE at start, for every `JobDefinition` any registered module declares.
 * `createQueues` is idempotent, which is what makes the concurrent cases safe: two worker instances
 * booting together, or a worker booting while the API performs its first lazy enqueue, all converge
 * on the same queue row.
 *
 * The worker is deployed as a Cloud Run SERVICE (`deploy-api.yml`, `--min-instances=1
 * --no-cpu-throttling`), and a service must accept TCP connections on `PORT` during the startup
 * probe window or the revision is marked failed. So once pg-boss is up the worker binds a minimal
 * probe listener: `GET /v1/health` answers `{ ok, service: 'worker', role }` and nothing else. It is
 * bound AFTER `boss.start()` on purpose — a 200 means "the worker really started", not "the process
 * exists". `tests/integration/worker.test.ts` boots this branch in a fresh process and asserts it.
 */
export async function startWorker(): Promise<void> {
  const jobs: AnyJobDefinition[] = Object.values(MODULE_REGISTRY).flatMap(
    (manifest) => manifest?.jobs ?? [],
  );

  // Session-mode connection in production (A6): the worker polls continuously, the API does not.
  const boss = createBoss({
    connectionString: env.BOSS_DATABASE_URL ?? env.DATABASE_URL,
    max: 2,
  });
  boss.on('error', (err) => rootLogger.error({ err }, 'pg-boss error'));

  await boss.start();

  await createQueues(
    boss,
    jobs.map((job) => job.name),
  );
  for (const job of jobs) {
    await boss.work(job.name, async (batch) => {
      for (const item of batch) await job.handler(item.data);
    });
  }

  const probe = new Hono().get('/v1/health', (c) =>
    c.json({ ok: true, service: 'worker', role: env.ROLE }, 200),
  );
  const server = serve({ fetch: probe.fetch, port: env.PORT }, (info) => {
    rootLogger.info(
      { port: info.port, queues: jobs.map((job) => job.name), role: env.ROLE },
      'worker.started',
    );
  });

  // Cloud Run sends SIGTERM before shutdown: stop answering probes, finish in-flight jobs, then exit.
  process.on('SIGTERM', () => {
    rootLogger.info('SIGTERM received, stopping worker');
    server.close();
    boss
      .stop({ graceful: true, timeout: 20_000 })
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        rootLogger.error({ err }, 'error while stopping worker');
        process.exit(1);
      });
  });
}
