import { serve } from '@hono/node-server';
import { assertManifestPresent } from '@rede-social/core/server/migrations/manifest';
import { app } from './app';
import { env } from './env';
import { rootLogger } from './http/logger';
import { runMigrateAll } from './migrate';
import { runMoveCli } from './move';
import { startWorker } from './worker';

/**
 * One image, four roles (D-18, D-544, D-536). `ROLE=migrate` runs the migration fan-out and exits with its code
 * (it binds no listener and starts no queue); `ROLE=move` runs the tenant-move tool the same way (09.2-23);
 * `ROLE=worker` runs pg-boss; anything else serves HTTP.
 *
 * The API branch deliberately touches NOTHING in `@rede-social/core/server/jobs/boss`: `serve()` binds the
 * port immediately and the queue is reached only through the lazy per-project sender (`senderFor`) on the first enqueue.
 * That is what keeps `GET /v1/health` answering 200 while the database is unreachable (01-09's
 * DB-free-boot property, re-verified by the Docker smoke in 01-08).
 */
// 09.2-15 (DBT-44, P85): a production process with no migrations manifest in its image stops here, before it can
// serve as if no schema were required. No database is involved, so `GET /v1/health` stays database-free.
assertManifestPresent();

if (env.ROLE === 'migrate') {
  process.exit(await runMigrateAll(process.argv.slice(2)));
} else if (env.ROLE === 'move') {
  process.exit(await runMoveCli(process.argv.slice(2)));
} else if (env.ROLE === 'worker') {
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
