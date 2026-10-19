import { describe, expect, it } from 'vitest';
import {
  ALLOWLIST_REJECTION_MESSAGE,
  ALLOWLIST_REJECTION_STATUS,
  isAllowlistRejection,
} from '../src/allowlist';

describe('isAllowlistRejection (quick 261018-owq)', () => {
  it('pins the sentinel the SQL hooks return', () => {
    expect(ALLOWLIST_REJECTION_MESSAGE).toBe('EMAIL_NOT_ALLOWED');
    expect(ALLOWLIST_REJECTION_STATUS).toBe(403);
  });

  it('is true for 403 with the sentinel message', () => {
    expect(isAllowlistRejection({ status: 403, message: 'EMAIL_NOT_ALLOWED' })).toBe(true);
  });

  it('is false for 403 with another message', () => {
    expect(isAllowlistRejection({ status: 403, message: 'Forbidden' })).toBe(false);
  });

  it('is false for a 500 carrying the sentinel', () => {
    expect(isAllowlistRejection({ status: 500, message: 'EMAIL_NOT_ALLOWED' })).toBe(false);
  });

  it('is false for null, undefined and a plain Error without status', () => {
    expect(isAllowlistRejection(null)).toBe(false);
    expect(isAllowlistRejection(undefined)).toBe(false);
    expect(isAllowlistRejection(new Error('EMAIL_NOT_ALLOWED'))).toBe(false);
  });
});
