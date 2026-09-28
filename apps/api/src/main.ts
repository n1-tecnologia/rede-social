import { serve } from '@hono/node-server';
import { app } from './app';
import { env } from './env';
import { rootLogger } from './http/logger';
import { startWorker } from './worker';

/**
 * One image, two roles (D-18). `ROLE=worker` runs pg-boss; anything else serves HTTP.
 *
 * The API branch deliberately touches NOTHING in `@rede-social/core/server/jobs/boss`: `serve()` binds the
 * port immediately and the queue is reached only through the lazy `getBoss()` on the first enqueue.
 * That is what keeps `GET /v1/health` answering 200 while the database is unreachable (01-09's
 * DB-free-boot property, re-verified by the Docker smoke in 01-08).
 */
if (env.ROLE === 'worker') {
  await startWorker();
} else {
  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    rootLogger.info({ port: info.port, role: env.ROLE }, 'api listening');
  });

  // Cloud Run sends SIGTERM before shutdown: stop accepting connections, drain, then exit.
  process.on('SIGTERM', () => {
    rootLogger.info('SIGTERM received, closing server');
    server.close((err) => {
      if (err) {
        rootLogger.error({ err }, 'error while closing server');
        process.exit(1);
      }
      process.exit(0);
    });
  });
}
