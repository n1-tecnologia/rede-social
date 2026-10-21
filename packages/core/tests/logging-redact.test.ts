import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it } from 'vitest';
import { redactDbError } from '../server/logging';

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
