import { serve } from '@hono/node-server';
import { app } from './app';
import { env } from './env';
import { rootLogger } from './http/logger';

// Plan 01-07 adds the `ROLE=worker` branch (pg-boss) here; both roles run from the same image.
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
