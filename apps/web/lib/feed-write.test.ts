import { FEED_MEMBER_ISSUES } from '@rede-social/module-feed/contracts';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const { ApiClientError } = await import('@/lib/bootstrap');
const { asMemberIssue, isRefusedWrite, postWriteIssue } = await import('@/lib/feed-write');

/**
 * 09-09 (UI-D-504 h, T-04-42, T-09-35): the composer's refusal vocabulary gains the CLOSED member
 * codes, read from `details.member`. Anything outside the closed set is `null`, so no server string
 * can reach the DOM through this path and the composer's switch stays exhaustive.
 */
describe('postWriteIssue - the member codes (09-09)', () => {
  it.each(FEED_MEMBER_ISSUES)('maps details.member = %s to the same code', (code) => {
    const error = new ApiClientError(422, 'VALIDATION_FAILED', { member: code });
    expect(postWriteIssue(error)).toBe(code);
  });

  it('answers null for an unknown member string, so the composer shows the generic sentence', () => {
    const error = new ApiClientError(422, 'VALIDATION_FAILED', { member: 'something_new' });
    expect(postWriteIssue(error)).toBeNull();
  });

  it('answers null for a non-string member value', () => {
    const error = new ApiClientError(422, 'VALIDATION_FAILED', { member: { code: 1 } });
    expect(postWriteIssue(error)).toBeNull();
  });

  it('still reads the media and community vocabularies and the bare 404', () => {
    expect(
      postWriteIssue(new ApiClientError(422, 'VALIDATION_FAILED', { media: 'too_many_images' })),
    ).toBe('too_many_images');
    expect(postWriteIssue(new ApiClientError(404, 'NOT_FOUND'))).toBe('not_found');
  });
});

describe('asMemberIssue', () => {
  it('accepts exactly the closed set', () => {
    for (const code of FEED_MEMBER_ISSUES) expect(asMemberIssue(code)).toBe(code);
    expect(asMemberIssue('too_many_images')).toBeNull();
    expect(asMemberIssue(undefined)).toBeNull();
    expect(asMemberIssue(42)).toBeNull();
  });
});

/**
 * 11.1-15 (UI-D-893, D-888): the screen's reaction to a write the server refused is NEUTRAL. The one
 * word it branches on is "refused" - a bare 403 - and never a reason: the helper reads the status
 * and nothing else (no code, no body detail), so a refusal for a missing flag, a revoked purchase or
 * a turned-off module is the same answer to the screen.
 */
describe('isRefusedWrite (11.1-15)', () => {
  it('is true for a 403, whatever its code or details say', () => {
    expect(isRefusedWrite(new ApiClientError(403, 'FORBIDDEN'))).toBe(true);
    expect(isRefusedWrite(new ApiClientError(403, 'SOMETHING_ELSE', { anything: 'x' }))).toBe(true);
    expect(isRefusedWrite(new ApiClientError(403, 'FORBIDDEN', { reason: 'refund' }))).toBe(true);
  });

  it('reads nothing but the status: the SAME answer for two different bodies', () => {
    const a = isRefusedWrite(new ApiClientError(403, 'FORBIDDEN', { a: 1 }));
    const b = isRefusedWrite(new ApiClientError(403, 'OTHER', undefined));
    expect(a).toBe(b);
  });

  it('is false for any other status and for anything that is not an API error', () => {
    expect(isRefusedWrite(new ApiClientError(404, 'NOT_FOUND'))).toBe(false);
    expect(isRefusedWrite(new ApiClientError(400, 'VALIDATION_FAILED'))).toBe(false);
    expect(isRefusedWrite(new ApiClientError(500, 'INTERNAL'))).toBe(false);
    expect(isRefusedWrite(new ApiClientError(401, 'UNAUTHENTICATED'))).toBe(false);
    expect(isRefusedWrite(new Error('403'))).toBe(false);
    expect(isRefusedWrite(null)).toBe(false);
  });
});
