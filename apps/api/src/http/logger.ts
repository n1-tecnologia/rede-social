import type { AppEnv } from '@rede-social/core/server/auth/context';
import { rootLogger } from '@rede-social/core/server/logging';
import { createMiddleware } from 'hono/factory';

/**
 * The kernel owns the one configured root (`severity` formatter, `LOG_LEVEL`); the API re-exports it
 * for `main.ts`/`worker.ts` and derives the per-request child below (WR-12).
 */
export { rootLogger };

/** Child logger per request; later plans add `tenantId`/`userId` once `requireAuth` has run. */
export const logger = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    const requestId = c.get('requestId');
    const log = rootLogger.child({ requestId });
    c.set('logger', log);
    const started = performance.now();
    await next();
    log.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - started),
      },
      'request',
    );
  });
