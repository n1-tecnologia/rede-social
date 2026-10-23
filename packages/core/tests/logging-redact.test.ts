import { readFileSync } from 'node:fs';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { LOG_REDACT, redactDbError } from '../server/logging';

/**
 * WR-02: drizzle's `DrizzleQueryError` message is `Failed query: <sql>\nparams: <every bound parameter>`,
 * so logging it whole prints a buyer e-mail and an amount. `redactDbError` keeps identifiers only.
 */

const EMAIL = 'ana@exemplo.com.br';

function failure(cause: Record<string, unknown>) {
  return new DrizzleQueryError(
    'insert into access_grants (email, amount) values ($1, $2)',
    [EMAIL, 4990],
    Object.assign(new Error(`invalid input syntax: "${EMAIL}"`), cause),
  );
}

describe('redactDbError', () => {
  it('reduces a failed statement to the SQLSTATE and the identifiers of the failure', () => {
    const redacted = redactDbError(
      failure({ code: '23505', constraint_name: 'access_grants_uq', table_name: 'access_grants' }),
    );
    expect(redacted).toEqual({
      type: 'DatabaseError',
      sqlstate: '23505',
      constraint: 'access_grants_uq',
      table: 'access_grants',
      column: null,
    });
    expect(JSON.stringify(redacted)).not.toContain(EMAIL);
    expect(JSON.stringify(redacted)).not.toContain('4990');
  });

  it('still redacts a statement failure whose cause has no SQLSTATE', () => {
    const redacted = redactDbError(failure({}));
    expect(redacted).toEqual({
      type: 'DatabaseError',
      sqlstate: null,
      constraint: null,
      table: null,
      column: null,
    });
  });

  it('returns any other error untouched', () => {
    const error = new Error('plain failure');
    expect(redactDbError(error)).toBe(error);
    expect(redactDbError('text')).toBe('text');
    expect(redactDbError(undefined)).toBeUndefined();
  });
});

/**
 * 09.2-14 (T-09.2-67): a credential never reaches a log line, whichever field it travels in and whether the
 * caller logs a field or a whole error.
 */
describe('credential redaction', () => {
  const URL_WITH_PASSWORD = 'postgres://api_user:hunter2-secret@db.example.co:6543/postgres';

  function logged(object: Record<string, unknown>): string {
    const lines: string[] = [];
    const logger = pino(
      { redact: { paths: [...LOG_REDACT.paths], censor: LOG_REDACT.censor } },
      { write: (line: string) => lines.push(line) },
    );
    logger.info(object, 'x');
    return lines.join('');
  }

  it('the root logger is built with the exported redaction', () => {
    const source = readFileSync(new URL('../server/logging.ts', import.meta.url), 'utf8');
    expect(source).toContain('redact: { paths: [...LOG_REDACT.paths], censor: LOG_REDACT.censor }');
  });

  it('every credential-shaped field is censored at the top level and one level down', () => {
    const line = logged({
      databaseUrl: URL_WITH_PASSWORD,
      ddlUrl: URL_WITH_PASSWORD,
      serviceKey: 'service-key-value',
      publishableKey: 'publishable-key-value',
      databasePassword: 'db-password-value',
      password: 'password-value',
      smtpPass: 'smtp-value',
      secret: 'secret-value',
      secrets: 'secrets-value',
      hookSecret: 'hook-secret-value',
      nested: {
        databaseUrl: URL_WITH_PASSWORD,
        serviceKey: 'nested-service-key',
        ddlUrl: URL_WITH_PASSWORD,
        password: 'nested-password',
        secret: 'nested-secret',
      },
      keep: 'visible',
    });
    for (const value of [
      'hunter2-secret',
      'service-key-value',
      'publishable-key-value',
      'db-password-value',
      'password-value',
      'smtp-value',
      'secret-value',
      'secrets-value',
      'hook-secret-value',
      'nested-service-key',
      'nested-password',
      'nested-secret',
    ]) {
      expect(line, value).not.toContain(value);
    }
    expect(line).toContain('"keep":"visible"');
    expect(line).toContain('[redacted]');
  });

  it('redactDbError strips a connection string out of a plain error, its stack and its cause', () => {
    const inner = new Error(`connect failed for ${URL_WITH_PASSWORD}`);
    const outer = new Error(`could not open ${URL_WITH_PASSWORD} (retry)`, { cause: inner });
    outer.name = 'ConnectError';
    const cleaned = redactDbError(outer) as Error;
    expect(cleaned).not.toBe(outer);
    expect(cleaned.name).toBe('ConnectError');
    expect(cleaned.message).toBe('could not open postgres://[redacted] (retry)');
    expect(String(cleaned.stack)).not.toContain('hunter2-secret');
    expect((cleaned.cause as Error).message).toBe('connect failed for postgres://[redacted]');
    expect(
      JSON.stringify([cleaned.message, cleaned.stack, (cleaned.cause as Error).stack]),
    ).not.toContain('hunter2-secret');
    // The original is left alone, and the postgresql:// form is covered too.
    expect(outer.message).toContain('hunter2-secret');
    expect(redactDbError(new Error('x postgresql://u:p@h/db y')) as Error).toMatchObject({
      message: 'x postgres://[redacted] y',
    });
    expect(redactDbError(`dsn=${URL_WITH_PASSWORD}`)).toBe('dsn=postgres://[redacted]');
  });

  it('an error that carries no connection string is returned as it is', () => {
    const plain = new Error('connect ECONNREFUSED 10.0.0.1:5432');
    expect(redactDbError(plain)).toBe(plain);
    const wrapped = new Error('outer', { cause: new Error('inner') });
    expect(redactDbError(wrapped)).toBe(wrapped);
  });
});
