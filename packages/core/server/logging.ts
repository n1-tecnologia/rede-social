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
 * The names under which a credential can sit in a log object (09.2-14, T-09.2-67). A key is matched at the top
 * level and one level down (`*.key`), which is how every call in the kernel nests its fields. pino's redaction
 * takes whole path segments, not prefixes, so the family `secret*` is spelled out.
 */
const CREDENTIAL_KEYS = [
  'databaseUrl',
  'ddlUrl',
  'connectionString',
  'serviceKey',
  'publishableKey',
  'databasePassword',
  'password',
  'smtpPass',
  'secret',
  'secrets',
  'secretKey',
  'hookSecret',
  'hookSecrets',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
] as const;

/** The pino `redact` option of the root logger; exported so a test can build a logger with the same one. */
export const LOG_REDACT = {
  paths: CREDENTIAL_KEYS.flatMap((key) => [key, `*.${key}`]),
  censor: '[redacted]',
} as const;

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
  redact: { paths: [...LOG_REDACT.paths], censor: LOG_REDACT.censor },
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

const CONNECTION_STRING_SOURCE = 'postgres(?:ql)?:\\/\\/[^\\s\'"`)>]+';
const HAS_CONNECTION_STRING = new RegExp(CONNECTION_STRING_SOURCE, 'i');
const scrub = (text: string): string =>
  text.replace(new RegExp(CONNECTION_STRING_SOURCE, 'gi'), 'postgres://[redacted]');

/**
 * A driver or URL-parsing failure can quote the connection string it was handed (user, password, host). The
 * error is returned untouched when it carries none; otherwise a COPY with the string replaced, so the credential
 * never reaches a log even when the caller logs the whole error (09.2-14, T-09.2-67).
 */
function scrubConnectionStrings<T>(error: T, depth = 0): T {
  if (typeof error === 'string') {
    return (HAS_CONNECTION_STRING.test(error) ? scrub(error) : error) as T;
  }
  if (!(error instanceof Error) || depth > 3) return error;
  const cause = (error as { cause?: unknown }).cause;
  const cleanCause = cause === undefined ? undefined : scrubConnectionStrings(cause, depth + 1);
  const dirty =
    HAS_CONNECTION_STRING.test(error.message) ||
    HAS_CONNECTION_STRING.test(error.stack ?? '') ||
    cleanCause !== cause;
  if (!dirty) return error;
  const copy = new Error(
    scrub(error.message),
    cleanCause === undefined ? undefined : { cause: cleanCause },
  );
  copy.name = error.name;
  if (error.stack) copy.stack = scrub(error.stack);
  return copy as unknown as T;
}

/**
 * Returns `error` itself unless it is a failed database statement; then returns a plain object holding
 * the SQLSTATE and the constraint, table and column names (identifiers, never values: not the message,
 * not `detail`, not the stack, not the SQL, not the parameters). Pass the result as the `err` of a log
 * call. The driver error sits in `cause`, so the chain is walked for the first SQLSTATE.
 */
export function redactDbError<T>(error: T): T | RedactedDbError {
  if (!isStatementFailure(error)) return scrubConnectionStrings(error);
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
