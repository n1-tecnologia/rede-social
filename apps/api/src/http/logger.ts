import type { AppEnv } from '@rede-social/core/server/auth/context';
import { rootLogger } from '@rede-social/core/server/logging';
import { createMiddleware } from 'hono/factory';

/**
 * The kernel owns the one configured root (`severity` formatter, `LOG_LEVEL`); the API re-exports it
 * for `main.ts`/`worker.ts` and derives the per-request child below (WR-12).
 */
export { rootLogger };

/**
 * 09.2-11 (T-09.2-51): a project's Send Email Hook reference is a path segment that selects a project; it is
 * not a secret, but nothing needs it in a log line, so the access log writes the route pattern instead.
 */
const HOOK_REF_PATH = /^(\/v1\/hooks\/auth\/send-email\/)[^/]*/;
export const loggedPath = (path: string): string => path.replace(HOOK_REF_PATH, '$1:hookRef');

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
        path: loggedPath(c.req.path),
        status: c.res.status,
        durationMs: Math.round(performance.now() - started),
      },
      'request',
    );
  });
