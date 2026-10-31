import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 12-17 Task 1 (D-595, PFORM-21; T-12-37, T-12-38) — the BFF relay of the answers CSV. The handler is a
 * pipe: same origin and session first, ONE forward, the attachment passed through UNREAD (a spy stream
 * proves nobody reads it), `no-store`, a status-only log on failure and nothing logged on success.
 */

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  claims: { sub: 'u1' } as object | null,
}));

vi.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => mocks.apiFetch(...args) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: mocks.claims } }) },
  }),
}));

const { GET, dynamic } = await import('./route');

/** A browser same-origin `fetch()`: the only caller (`startCsvDownload`) always sends this header. */
const request = (site: string | null = 'same-origin') =>
  new Request('http://localhost/api/profile-form/export', {
    headers: site === null ? {} : { 'sec-fetch-site': site },
  });
const DISPOSITION = 'attachment; filename="respostas-perfil-2026-10-30.csv"';

/** A stream that records whether anybody pulled from it, to prove the relay does not read the body. */
function spyStream(text: string) {
  const state = { pulled: 0 };
  // highWaterMark 0: nothing is pulled until a consumer reads (the default would prefill one chunk).
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pulled += 1;
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, state };
}

let errorLog: ReturnType<typeof vi.spyOn>;
let infoLogs: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.claims = { sub: 'u1' };
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  infoLogs = [
    vi.spyOn(console, 'log').mockImplementation(() => undefined),
    vi.spyOn(console, 'info').mockImplementation(() => undefined),
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
  ];
});

describe('GET /api/profile-form/export: the relay', () => {
  it('is dynamic, never static', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('answers 200 with the CSV headers, the API’s Content-Disposition verbatim and no-store', async () => {
    const { stream } = spyStream('﻿Nome;E-mail\r\n');
    mocks.apiFetch.mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': DISPOSITION },
      }),
    );
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe(DISPOSITION);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
    expect(mocks.apiFetch).toHaveBeenCalledWith('/v1/profile_form/export');
  });

  it('passes the body through unread: the stream is the API’s own and nobody pulls from it here', async () => {
    const { stream, state } = spyStream('Nome;E-mail\r\nAna;ana@x.test\r\n');
    const upstream = new Response(stream, {
      status: 200,
      headers: { 'content-disposition': DISPOSITION },
    });
    const text = vi.spyOn(upstream, 'text');
    const json = vi.spyOn(upstream, 'json');
    const buffer = vi.spyOn(upstream, 'arrayBuffer');
    mocks.apiFetch.mockResolvedValueOnce(upstream);

    const res = await GET(request());
    // Headers are out and the web tier has read zero chunks of the personal data.
    expect(state.pulled).toBe(0);
    expect(text).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(buffer).not.toHaveBeenCalled();

    // The consumer (the browser) is the first to read it, and gets the bytes untouched.
    expect(await res.text()).toBe('Nome;E-mail\r\nAna;ana@x.test\r\n');
    expect(state.pulled).toBeGreaterThan(0);
  });

  it('logs nothing on success', async () => {
    mocks.apiFetch.mockResolvedValueOnce(
      new Response('a;b\r\n', { status: 200, headers: { 'content-disposition': DISPOSITION } }),
    );
    await GET(request());
    expect(errorLog).not.toHaveBeenCalled();
    for (const log of infoLogs) expect(log).not.toHaveBeenCalled();
  });
});

describe('GET /api/profile-form/export: the refusals', () => {
  it.each([
    ['cross-site', 'cross-site'],
    ['same-site', 'same-site'],
    ['none (typed URL or bookmark)', 'none'],
    ['missing (no Sec-Fetch-Site, no Origin)', null],
  ])(
    'answers an empty 403 without calling the API when Sec-Fetch-Site is %s',
    async (_label, site) => {
      const res = await GET(request(site));
      expect(res.status).toBe(403);
      expect(await res.text()).toBe('');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(mocks.apiFetch).not.toHaveBeenCalled();
    },
  );

  it('refuses a header-less request even when it carries a same-host Origin', async () => {
    const res = await GET(
      new Request('http://localhost/api/profile-form/export', {
        headers: { origin: 'http://localhost' },
      }),
    );
    expect(res.status).toBe(403);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('answers an empty 401 without calling the API when there is no session', async () => {
    mocks.claims = null;
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('');
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('returns the API’s 403 as 403 with an empty body (T-12-38: only the API’s guard decides)', async () => {
    mocks.apiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), { status: 403 }),
    );
    const res = await GET(request());
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(errorLog).toHaveBeenCalledWith('profile_form.export_failed', { status: 403 });
  });

  it('keeps a 404 (module off) and maps a 5xx to 502, each with an empty no-store body', async () => {
    mocks.apiFetch.mockResolvedValueOnce(new Response('x', { status: 404 }));
    const notFound = await GET(request());
    expect(notFound.status).toBe(404);
    expect(await notFound.text()).toBe('');

    mocks.apiFetch.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const failed = await GET(request());
    expect(failed.status).toBe(502);
    expect(await failed.text()).toBe('');
    expect(failed.headers.get('cache-control')).toBe('no-store');
  });

  it('maps a thrown forward to 502 and logs the error name, never a message', async () => {
    mocks.apiFetch.mockRejectedValueOnce(new Error('connect to ana@x.test failed'));
    const res = await GET(request());
    expect(res.status).toBe(502);
    expect(errorLog).toHaveBeenCalledWith('profile_form.export_failed', {
      status: null,
      code: 'Error',
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('ana@x.test');
  });
});
