import pino, { type Logger } from 'pino';
import { env } from './env';

/** pino level -> Cloud Logging severity, so Cloud Run parses the JSON lines natively. */
const SEVERITY: Record<string, string> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

/**
 * The ONE root logger (phase-1 review WR-12). Every logger in the kernel, the apps and the modules
 * is a child of this instance, so all of them carry the `severity` formatter and honour
 * `LOG_LEVEL`. A bare `pino()` elsewhere would emit `"level":50` lines that Cloud Logging files as
 * DEFAULT severity — exactly the operational errors (`signup.compensated`,
 * `domain_event.handler_failed`, job failures) alerting must see.
 *
 * Request-scoped context (`requestId`, then `tenantId`/`userId` once `requireAuth` ran) lives on
 * the per-request child the API creates (`c.get('logger')`); kernel functions that run inside a
 * request accept that child as a parameter and fall back to their module child otherwise.
 */
export const rootLogger: Logger = pino({
  level: env.LOG_LEVEL,
  messageKey: 'message',
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ severity: SEVERITY[label] ?? label.toUpperCase() }),
  },
});

/** A named child of the root logger for module-level (non-request) lines. */
export const moduleLogger = (name: string): Logger => rootLogger.child({ name });

export type { Logger };
