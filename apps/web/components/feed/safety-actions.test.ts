import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 11-20 (MODER-05, T-11-03, T-11-16): `reportContent` is the report sheet's server action. It parses the body with
 * the API's own schema BEFORE the request, calls `POST /v1/reports` through `apiFetch` and answers a CLOSED code,
 * never an API message.
 */

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => api.apiFetch(...args) }));

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => cache.revalidatePath(...args),
}));

const { reportContent, blockMember, unblockMember, unblockBlocked } = await import(
  './safety-actions'
);

const SUBJECT = '0b9a3c2e-5d1f-4e7a-9c3b-2f6d8e1a4b70';
const valid = { subjectType: 'post_comment', subjectId: SUBJECT, reason: 'spam' };

function answer(status: number) {
  api.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: SUBJECT }), { status }));
}

beforeEach(() => {
  api.apiFetch.mockReset();
  cache.revalidatePath.mockReset();
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

describe('blockMember, unblockMember and unblockBlocked (CHAT-07, D-722, D-724)', () => {
  const answerJson = (status: number, body: unknown) =>
    api.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

  it('blocks by MEMBERSHIP id on the membership route, once, and revalidates the lists on a real change', async () => {
    answerJson(200, { changed: true });
    expect(await blockMember(SUBJECT)).toEqual({ ok: true, code: 'ok', changed: true });
    expect(api.apiFetch).toHaveBeenCalledTimes(1);
    expect(api.apiFetch).toHaveBeenCalledWith(`/v1/blocks/members/${SUBJECT}`, { method: 'POST' });
    expect(cache.revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('a repeat is the plain success with nothing to revalidate', async () => {
    answerJson(200, { changed: false });
    expect(await blockMember(SUBJECT)).toEqual({ ok: true, code: 'ok', changed: false });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'failed'],
    [429, 'rate_limited'],
    [401, 'unauthenticated'],
    [500, 'failed'],
  ])('maps the API status %i to the closed code %s', async (status, code) => {
    answerJson(status, { error: { code: 'CANNOT_BLOCK', message: 'secret reason' } });
    const result = await blockMember(SUBJECT);
    expect(result).toEqual({ ok: false, code, changed: false });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses anything but a uuid before any request (a user id or a name is never sent)', async () => {
    for (const bad of ['Carla', '', null, undefined, 42]) {
      expect(await blockMember(bad)).toEqual({ ok: false, code: 'failed', changed: false });
      expect(await unblockMember(bad)).toEqual({ ok: false, code: 'failed', changed: false });
    }
    expect(api.apiFetch).not.toHaveBeenCalled();
  });

  it('a lost network and a malformed answer are the plain failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    api.apiFetch.mockRejectedValueOnce(new Error('offline'));
    expect(await blockMember(SUBJECT)).toEqual({ ok: false, code: 'failed', changed: false });
    answerJson(200, { changed: 'yes' });
    expect(await blockMember(SUBJECT)).toEqual({ ok: false, code: 'failed', changed: false });
  });

  it('unblocks on the membership route, and the list unblock uses the user-id route', async () => {
    answerJson(200, { changed: true });
    await unblockMember(SUBJECT);
    expect(api.apiFetch).toHaveBeenLastCalledWith(`/v1/blocks/members/${SUBJECT}`, {
      method: 'DELETE',
    });
    answerJson(200, { changed: true });
    expect(await unblockBlocked(SUBJECT)).toEqual({ ok: true, code: 'ok', changed: true });
    expect(api.apiFetch).toHaveBeenLastCalledWith(`/v1/blocks/${SUBJECT}`, { method: 'DELETE' });
  });
});
