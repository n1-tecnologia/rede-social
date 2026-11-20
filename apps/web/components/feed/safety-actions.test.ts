import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 11-20 (MODER-05, T-11-03, T-11-16): `reportContent` is the report sheet's server action. It parses the body with
 * the API's own schema BEFORE the request, calls `POST /v1/reports` through `apiFetch` and answers a CLOSED code,
 * never an API message.
 */

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => api.apiFetch(...args) }));

const { reportContent } = await import('./safety-actions');

const SUBJECT = '0b9a3c2e-5d1f-4e7a-9c3b-2f6d8e1a4b70';
const valid = { subjectType: 'post_comment', subjectId: SUBJECT, reason: 'spam' };

function answer(status: number) {
  api.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: SUBJECT }), { status }));
}

beforeEach(() => {
  api.apiFetch.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('reportContent', () => {
  it.each([
    [201, { ok: true, code: 'ok' }],
    [409, { ok: true, code: 'already_reported' }],
    [404, { ok: false, code: 'unavailable' }],
    [429, { ok: false, code: 'rate_limited' }],
    [401, { ok: false, code: 'unauthenticated' }],
    [403, { ok: false, code: 'failed' }],
    [500, { ok: false, code: 'failed' }],
  ])('maps the API status %i to the closed answer %j', async (status, expected) => {
    answer(status);
    expect(await reportContent(valid)).toEqual(expected);
  });

  it('sends the report once, with the note OMITTED when none was written', async () => {
    answer(201);
    await reportContent({ ...valid, note: '   ' });
    expect(api.apiFetch).toHaveBeenCalledTimes(1);
    const [path, init] = api.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/v1/reports');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(valid);
  });

  it('sends a trimmed note when there is one', async () => {
    answer(201);
    await reportContent({ ...valid, note: '  fora do assunto  ' });
    const [, init] = api.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ ...valid, note: 'fora do assunto' });
  });

  it('refuses an untrusted body before any request (unknown subject, reason, key, long note)', async () => {
    for (const bad of [
      { ...valid, subjectType: 'user' },
      { ...valid, reason: 'because' },
      { ...valid, subjectId: 'not-a-uuid' },
      { ...valid, authorUserId: SUBJECT },
      { ...valid, note: 'x'.repeat(501) },
      null,
    ]) {
      expect(await reportContent(bad)).toEqual({ ok: false, code: 'failed' });
    }
    expect(api.apiFetch).not.toHaveBeenCalled();
  });

  it('a lost network is the plain failure, not an exception', async () => {
    api.apiFetch.mockRejectedValueOnce(new Error('offline'));
    expect(await reportContent(valid)).toEqual({ ok: false, code: 'failed' });
  });

  it('never returns the API message', async () => {
    api.apiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'secret reason' } }), {
        status: 404,
      }),
    );
    expect(JSON.stringify(await reportContent(valid))).not.toContain('secret');
  });
});
