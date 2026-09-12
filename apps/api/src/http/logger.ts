import type { AppEnv } from '@tria/core/server/auth/context';
import { createMiddleware } from 'hono/factory';
import pino from 'pino';
import { env } from '../env';

/** pino level → Cloud Logging severity, so Cloud Run parses the JSON lines natively. */
const SEVERITY: Record<string, string> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

export const rootLogger = pino({
  level: env.LOG_LEVEL,
  messageKey: 'message',
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ severity: SEVERITY[label] ?? label.toUpperCase() }),
  },
});

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
