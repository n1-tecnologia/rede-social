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

/** A database failure reduced to what is safe to log: identifiers of the failure, never a value. */
export type RedactedDbError = {
  type: 'DatabaseError';
  /** The five-character SQLSTATE of the underlying driver error, when it carries one. */
  sqlstate: string | null;
  constraint: string | null;
  table: string | null;
  column: string | null;
};

const SQLSTATE = /^[0-9A-Z]{5}$/;
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : null;

/**
 * Whether `error` is a failed statement. drizzle-orm 0.45 wraps every driver failure in a
 * `DrizzleQueryError` whose MESSAGE is `Failed query: <sql>\nparams: <every bound parameter>` and which
 * carries `query` and `params` as own properties; postgres.js errors carry `query` and `parameters`.
 * Either way, printing the error prints the values (a buyer e-mail, an amount), so it is never logged whole.
 */
function isStatementFailure(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  if (error.message.startsWith('Failed query:')) return true;
  return ('query' in error && 'params' in error) || ('query' in error && 'parameters' in error);
}

/**
 * Returns `error` itself unless it is a failed database statement; then returns a plain object holding
 * the SQLSTATE and the constraint, table and column names (identifiers, never values: not the message,
 * not `detail`, not the stack, not the SQL, not the parameters). Pass the result as the `err` of a log
 * call. The driver error sits in `cause`, so the chain is walked for the first SQLSTATE.
 */
export function redactDbError<T>(error: T): T | RedactedDbError {
  if (!isStatementFailure(error)) return error;
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && SQLSTATE.test(code)) {
      const fields = current as unknown as Record<string, unknown>;
      return {
        type: 'DatabaseError',
        sqlstate: code,
        constraint: text(fields.constraint_name ?? fields.constraint),
        table: text(fields.table_name ?? fields.table),
        column: text(fields.column_name ?? fields.column),
      };
    }
    current = current.cause;
  }
  return { type: 'DatabaseError', sqlstate: null, constraint: null, table: null, column: null };
}

export type { Logger };
