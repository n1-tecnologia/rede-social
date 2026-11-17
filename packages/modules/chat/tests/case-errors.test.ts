import { ApiError } from '@rede-social/core/server/http/api-error';
import { describe, expect, it } from 'vitest';
import { mapCaseError } from '../server/cases';

/**
 * The one SQLSTATE mapper of the case routes (Phase 12.4, plan 08, CASE-24, EP-078, T-12.4-39). The mapping is exact
 * and one-to-one, and no raw SQLSTATE or message ever reaches a client: the returned `ApiError` is built from the closed
 * vocabulary only, never from the input error's text.
 */

const SECRET = 'relation "chat_conversations" violates something internal: tenant 7f3c';

/** A driver error as drizzle wraps it: the SQLSTATE sits on `cause`. */
function dbError(code: string, extra: Record<string, unknown> = {}, message = SECRET): Error {
  const driver = Object.assign(new Error(message), { code, ...extra });
  return new Error(`Failed query: ${message}`, { cause: driver });
}

function mapped(code: string, extra: Record<string, unknown> = {}): ApiError {
  const out = mapCaseError(dbError(code, extra));
  expect(out).toBeInstanceOf(ApiError);
  return out as ApiError;
}

describe('mapCaseError', () => {
  it('CS001 is the bare 404 with no details (no oracle)', () => {
    const out = mapped('CS001');
    expect(out.status).toBe(404);
    expect(out.code).toBe('NOT_FOUND');
    expect(out.details).toBeUndefined();
  });

  it('CS002 is 409 CONFLICT case_stale', () => {
    const out = mapped('CS002');
    expect([out.status, out.code, out.details]).toEqual([409, 'CONFLICT', { chat: 'case_stale' }]);
  });

  it('CS003 is 409 CONFLICT transition_not_allowed, distinguishable from case_stale', () => {
    const out = mapped('CS003');
    expect([out.status, out.code, out.details]).toEqual([
      409,
      'CONFLICT',
      { chat: 'transition_not_allowed' },
    ]);
    expect(out.details).not.toEqual(mapped('CS002').details);
  });

  it('CS004 is 409 CONFLICT case_closed', () => {
    const out = mapped('CS004');
    expect([out.status, out.code, out.details]).toEqual([409, 'CONFLICT', { chat: 'case_closed' }]);
  });

  it('CS005 is 400 VALIDATION_FAILED assignee_invalid', () => {
    const out = mapped('CS005');
    expect([out.status, out.code, out.details]).toEqual([
      400,
      'VALIDATION_FAILED',
      { chat: 'assignee_invalid' },
    ]);
  });

  it('42501 is 403 FORBIDDEN and never a 404', () => {
    const out = mapped('42501');
    expect([out.status, out.code]).toEqual([403, 'FORBIDDEN']);
    expect(out.status).not.toBe(404);
  });

  it('CS001 is never a 403', () => {
    expect(mapped('CS001').status).not.toBe(403);
  });

  it('22023 is 400 VALIDATION_FAILED with no chat code', () => {
    const out = mapped('22023');
    expect([out.status, out.code]).toEqual([400, 'VALIDATION_FAILED']);
    expect(out.details).toBeUndefined();
  });

  it('the subject CHECK violation (23514) is 400 subject_too_long, any other CHECK passes through', () => {
    const out = mapped('23514', { constraint_name: 'chat_conversations_subject_chk' });
    expect([out.status, out.code, out.details]).toEqual([
      400,
      'VALIDATION_FAILED',
      { chat: 'subject_too_long' },
    ]);
    const other = dbError('23514', { constraint_name: 'chat_conversations_case_coherence_chk' });
    expect(mapCaseError(other)).toBe(other);
  });

  it('never echoes a message, a SQLSTATE or any text of the input error', () => {
    for (const code of ['CS001', 'CS002', 'CS003', 'CS004', 'CS005', '42501', '22023', '23514']) {
      const out = mapped(code, { constraint_name: 'chat_conversations_subject_chk' });
      const shown = JSON.stringify({
        status: out.status,
        code: out.code,
        message: out.message,
        details: out.details,
      });
      expect(shown).not.toContain(SECRET);
      expect(shown).not.toContain('chat_conversations');
      expect(shown).not.toContain(code === '22023' ? 'never-matches' : `"${code}"`);
    }
  });

  it('passes an unknown error through untouched', () => {
    const unknown = dbError('XX000');
    expect(mapCaseError(unknown)).toBe(unknown);
    const plain = new Error('boom');
    expect(mapCaseError(plain)).toBe(plain);
  });

  it('passes an ApiError through untouched', () => {
    const own = new ApiError(404, 'NOT_FOUND');
    expect(mapCaseError(own)).toBe(own);
  });
});
