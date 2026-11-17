import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { GET } from './route';

/**
 * 12.5-11 (VOICE-19, D-871): `GET /v1/media/{assetId}/{variant}`, the same-origin path the first tap of a voice
 * message (an `<audio>` element) and every image goes through. The handler has had no test until now.
 *
 * What it really does (read at planning time, pinned here): it never reads the browser's request headers, calls
 * the API with `redirect: 'manual'` and, on a 302 with a `location`, forwards ONLY that `location` and the API's
 * `cache-control`; every other answer becomes the status (a 5xx as 502) with `no-store`. So a `Range` header is
 * neither needed nor dropped here: the browser repeats it on the redirect target, the signed Storage URL, which
 * answers the partial content. The claims:
 *
 *  - M1: `original` answers the identical 302 (same `Location`, same cache header) with and without `Range`;
 *  - M2: the API call carries no `Range` and goes out with `redirect: 'manual'` on the exact path;
 *  - M3: a ladder width behaves the same;
 *  - M4: a 404 passes through, a 500 is 502, both `no-store`; a thrown transport is 502 `no-store`;
 *  - M5: a non-uuid asset and an unknown variant are 404 with ZERO API calls.
 *
 * What is stubbed: the transport (`apiFetch`). What is real: the handler and the media contract.
 */

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

const ID = '0b000000-0000-4000-8000-0000000000b1';
const SIGNED = 'https://storage.test/signed';
const CACHE = 'private, max-age=1500';

const redirectAnswer = () =>
  new Response(null, { status: 302, headers: { location: SIGNED, 'cache-control': CACHE } });

const call = (assetId: string, variant: string, headers: Record<string, string> = {}) =>
  GET(new Request(`http://web.test/v1/media/${assetId}/${variant}`, { headers }), {
    params: Promise.resolve({ assetId, variant }),
  });

beforeEach(() => {
  vi.resetAllMocks();
});

describe('GET /v1/media/{assetId}/{variant}', () => {
  it('M1 + M2: original is the same 302 with and without a Range header, and the API never sees Range', async () => {
    vi.mocked(apiFetch).mockImplementation(async () => redirectAnswer());

    const plain = await call(ID, 'original');
    const ranged = await call(ID, 'original', { Range: 'bytes=0-' });

    for (const res of [plain, ranged]) {
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(SIGNED);
      expect(res.headers.get('cache-control')).toBe(CACHE);
    }
    expect(Object.fromEntries(ranged.headers)).toEqual(Object.fromEntries(plain.headers));

    expect(apiFetch).toHaveBeenCalledTimes(2);
    for (const [path, init] of vi.mocked(apiFetch).mock.calls) {
      expect(path).toBe(`/v1/media/${ID}/original`);
      expect(init).toEqual({ redirect: 'manual' });
      expect(JSON.stringify(init)).not.toMatch(/range/i);
    }
  });

  it('M3: a ladder width is the same redirect', async () => {
    vi.mocked(apiFetch).mockResolvedValue(redirectAnswer());
    const res = await call(ID, 'w640');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(SIGNED);
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe(`/v1/media/${ID}/w640`);
  });

  it('a 302 without a cache-control keeps the answer private', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      new Response(null, { status: 302, headers: { location: SIGNED } }),
    );
    const res = await call(ID, 'original');
    expect(res.status).toBe(302);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('M4: a 404 passes through and a 500 is 502, both no-store', async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(null, { status: 404 }));
    const notFound = await call(ID, 'original');
    expect(notFound.status).toBe(404);
    expect(notFound.headers.get('cache-control')).toBe('no-store');
    expect(notFound.headers.get('location')).toBeNull();

    vi.mocked(apiFetch).mockResolvedValue(new Response(null, { status: 500 }));
    const failed = await call(ID, 'original');
    expect(failed.status).toBe(502);
    expect(failed.headers.get('cache-control')).toBe('no-store');
  });

  it('M4: a thrown transport is 502 no-store', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(apiFetch).mockRejectedValue(new Error('connect ECONNREFUSED'));
    const res = await call(ID, 'original');
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
    spy.mockRestore();
  });

  it('M5: a non-uuid asset and an unknown variant are 404 with zero API calls', async () => {
    for (const [assetId, variant] of [
      ['not-a-uuid', 'original'],
      [ID, 'w999'],
      [ID, '../original'],
      [ID, 'w640x'],
    ] as const) {
      const res = await call(assetId, variant);
      expect(res.status).toBe(404);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
