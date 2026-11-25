import { FEED_MEDIA_ISSUES, FEED_MEMBER_ISSUES } from '@rede-social/module-feed/contracts';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const { ApiClientError } = await import('@/lib/bootstrap');
const { asMemberIssue, attemptPostWrite, isRefusedWrite, postWriteIssue } = await import(
  '@/lib/feed-write'
);

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

/**
 * 11.1-17 (UI-D-893, D-888): `attemptPostWrite` maps a bare 403 to the word 'refused' ONLY when the caller
 * asks for it (the create action of the pinned composer); the edit path and every other caller keep
 * today's generic answer and its log line.
 */
describe('attemptPostWrite - the refused word (11.1-17)', () => {
  const failing = (error: unknown) => () => Promise.reject(error);

  it('is refused for a bare 403 when asked, from the status alone', async () => {
    for (const error of [
      new ApiClientError(403, 'FORBIDDEN'),
      new ApiClientError(403, 'OTHER', { reason: 'refund' }),
    ]) {
      const out = await attemptPostWrite(failing(error), { mapRefused: true });
      expect(out).toEqual({ result: { ok: false, code: 'refused' }, refusal: null });
    }
  });

  it('keeps the generic answer for the same 403 when not asked (the edit path is unchanged)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const out = await attemptPostWrite(failing(new ApiClientError(403, 'FORBIDDEN')));
    expect(out).toEqual({ result: { ok: false, code: 'generic' }, refusal: null });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('a 403 with a bootstrap redirect is the redirect, never refused', async () => {
    const out = await attemptPostWrite(failing(new ApiClientError(403, 'NO_MEMBERSHIP')), {
      mapRefused: true,
    });
    expect(out).toEqual({ result: { ok: false, code: 'generic' }, refusal: '/sem-comunidade' });
  });

  it('any other status is not refused', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const status of [400, 404, 429, 500]) {
      const out = await attemptPostWrite(failing(new ApiClientError(status, 'X')), {
        mapRefused: true,
      });
      expect(out.result).not.toEqual({ ok: false, code: 'refused' });
    }
    spy.mockRestore();
  });
});

/**
 * 11.1-20 (WR-02, D-888, UI-D-893, T-11.1-72, T-11.1-74): `mapRefused` also takes a predicate, the caller's
 * lane. It is awaited ONLY on a bare 403 (after the named-issue and bootstrap-redirect checks); true gives
 * the neutral word with no log line, false or a rejection falls to the generic result and its log line.
 * These cases were written against the committed helper (plan 11.1-20 Task 1).
 */
describe('attemptPostWrite - the lane predicate of mapRefused (11.1-20)', () => {
  const failing = (error: unknown) => () => Promise.reject(error);
  const bare403 = () => new ApiClientError(403, 'FORBIDDEN');

  it('H1. a predicate resolving true with a bare 403 is refused, silent, and called once', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const lane = vi.fn(async () => true);

    const out = await attemptPostWrite(failing(bare403()), { mapRefused: lane });

    expect(out).toEqual({ result: { ok: false, code: 'refused' }, refusal: null });
    expect(lane).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('H2. a predicate resolving false is generic and logs once, with the error text and no caption', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const lane = vi.fn(async () => false);

    const out = await attemptPostWrite(failing(bare403()), { mapRefused: lane });

    expect(out).toEqual({ result: { ok: false, code: 'generic' }, refusal: null });
    expect(lane).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
    const args = spy.mock.calls[0] ?? [];
    expect(args[0]).toBe('feed.post.write_failed');
    expect(JSON.stringify(args)).toContain('FORBIDDEN');
    expect(JSON.stringify(args)).not.toContain('Preparei um resumo');
    spy.mockRestore();
  });

  it('H3. a predicate that rejects fails safe: generic and one log line', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const lane = vi.fn(async () => {
      throw new Error('bootstrap down');
    });

    const out = await attemptPostWrite(failing(bare403()), { mapRefused: lane });

    expect(out).toEqual({ result: { ok: false, code: 'generic' }, refusal: null });
    expect(lane).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('H4. the predicate is never called for a success, a 404, a 429, a 500, a named media issue or a redirect', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const lane = vi.fn(async () => true);

    const ok = await attemptPostWrite(async () => ({ id: 'P1' }) as never, { mapRefused: lane });
    expect(ok.result).toEqual({ ok: true, postId: 'P1' });

    for (const error of [
      new ApiClientError(404, 'NOT_FOUND'),
      new ApiClientError(429, 'RATE_LIMITED'),
      new ApiClientError(500, 'INTERNAL'),
      new ApiClientError(400, 'VALIDATION_FAILED', { media: FEED_MEDIA_ISSUES[0] }),
    ]) {
      const out = await attemptPostWrite(failing(error), { mapRefused: lane });
      expect(out.result).not.toEqual({ ok: false, code: 'refused' });
    }

    const redirected = await attemptPostWrite(failing(new ApiClientError(403, 'NO_MEMBERSHIP')), {
      mapRefused: lane,
    });
    expect(redirected).toEqual({
      result: { ok: false, code: 'generic' },
      refusal: '/sem-comunidade',
    });

    expect(lane).not.toHaveBeenCalled();

    // positive control: a bare 403 is the one outcome that reads the lane.
    await attemptPostWrite(failing(bare403()), { mapRefused: lane });
    expect(lane).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('H5. the boolean forms are unchanged: true maps a bare 403, false and absent do not', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await attemptPostWrite(failing(bare403()), { mapRefused: true })).result).toEqual({
      ok: false,
      code: 'refused',
    });
    expect((await attemptPostWrite(failing(bare403()), { mapRefused: false })).result).toEqual({
      ok: false,
      code: 'generic',
    });
    expect((await attemptPostWrite(failing(bare403()))).result).toEqual({
      ok: false,
      code: 'generic',
    });
    spy.mockRestore();
  });
});
