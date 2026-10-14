import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `storage.ts` — the one media file that touches `supabaseAdmin` (08.3-03, COURSE-07, T-08.3-06).
 *
 * `tests/media.test.ts` deliberately never imports `storage.ts` (it is the PURE half), so the signing
 * helpers get their own file: the admin client is replaced by a recorder, and what is proved is the
 * CONTRACT each helper has with Storage — which key, which TTL, how many calls, which error shape.
 *
 *  - `signReadFor(key, ttl)` passes the caller's TTL through verbatim, keeps NO memo (two calls are
 *    two signatures — a cached 600 s link would be exactly the replay T-08.3-06 forbids) and throws
 *    the `signRead` error shape when Storage has nothing to sign;
 *  - `signRead(key)` is unchanged: a one-hour URL, memoised, so a feed of twenty images costs twenty
 *    sign calls per instance per fifty minutes and not one per render.
 */

const { createSignedUrl } = vi.hoisted(() => ({ createSignedUrl: vi.fn() }));

vi.mock('../server/supabase-admin', () => ({
  supabaseAdmin: { storage: { from: () => ({ createSignedUrl }) } },
}));

const { downloadObjectPrefix, MEDIA_SIGNED_READ_TTL_S, signRead, signReadFor } = await import(
  '../server/media/storage'
);

const TENANT = '11111111-1111-4111-8111-111111111111';
const KEY = `${TENANT}/media/0a1b2c3d-4e5f-4a6b-8c7d-9e8f7a6b5c4d/original`;

beforeEach(() => {
  createSignedUrl.mockReset();
  createSignedUrl.mockImplementation(async (key: string, ttl: number) => ({
    data: {
      signedUrl: `https://storage.test/sign/${key}?ttl=${ttl}&n=${createSignedUrl.mock.calls.length}`,
    },
    error: null,
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('signReadFor — a short signed read with no memo (COURSE-07)', () => {
  it('passes the caller TTL as the second argument, verbatim', async () => {
    const url = await signReadFor(KEY, 600);
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    expect(createSignedUrl).toHaveBeenCalledWith(KEY, 600);
    expect(url).toContain('ttl=600');

    await signReadFor(KEY, 42);
    expect(createSignedUrl).toHaveBeenLastCalledWith(KEY, 42);
  });

  it('two consecutive calls for the same key hit Storage twice — nothing is remembered', async () => {
    const first = await signReadFor(KEY, 600);
    const second = await signReadFor(KEY, 600);
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
    expect(first).not.toBe(second);
  });

  it('rejects with the signRead error shape when Storage has no such object', async () => {
    createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'Object not found' } });
    await expect(signReadFor(KEY, 600)).rejects.toThrow(
      'could not sign a read url: Object not found',
    );
    createSignedUrl.mockResolvedValueOnce({ data: null, error: null });
    await expect(signReadFor(KEY, 600)).rejects.toThrow('could not sign a read url: no data');
  });
});

describe('signRead — the memoised hour-long read is untouched', () => {
  it('signs with MEDIA_SIGNED_READ_TTL_S once and answers the memo on the second call', async () => {
    const key = `${TENANT}/media/${crypto.randomUUID()}/w320.webp`;
    const first = await signRead(key);
    const second = await signRead(key);
    expect(MEDIA_SIGNED_READ_TTL_S).toBe(3600);
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    expect(createSignedUrl).toHaveBeenCalledWith(key, MEDIA_SIGNED_READ_TTL_S);
    expect(second).toBe(first);
  });

  it('signReadFor neither reads nor fills the signRead memo', async () => {
    const key = `${TENANT}/media/${crypto.randomUUID()}/original`;
    await signReadFor(key, 600);
    await signRead(key);
    // The memo was empty for this key, so signRead had to sign for itself: two calls, two TTLs.
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
    expect(createSignedUrl.mock.calls.map((call) => call[1])).toEqual([600, 3600]);
  });
});

describe('downloadObjectPrefix — only the signature bytes reach API memory (WR-10)', () => {
  /** A body that hands out `chunks` one read at a time and records whether it was cancelled. */
  function streamOf(chunks: Uint8Array[]) {
    let cancelled = false;
    let reads = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks[reads];
        reads += 1;
        if (next) controller.enqueue(next);
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    return { body, cancelled: () => cancelled, reads: () => reads };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GETs a one-shot signed read with Range bytes=0-(n-1) and answers exactly the first n bytes', async () => {
    const fetchMock = vi.fn(
      async () => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), { status: 206 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const buf = await downloadObjectPrefix(KEY, 16);
    expect(createSignedUrl).toHaveBeenCalledWith(KEY, 60);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(KEY);
    expect((init.headers as Record<string, string>).Range).toBe('bytes=0-15');
    expect(buf?.toString('latin1')).toBe('%PDF-');
  });

  it('a Storage that IGNORES the Range header (200, the whole object) is read only until n bytes arrived, then cancelled', async () => {
    const chunk = () => new Uint8Array(64 * 1024).fill(0x41);
    const stream = streamOf([chunk(), chunk(), chunk(), chunk(), chunk()]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream.body, { status: 200 })),
    );
    const buf = await downloadObjectPrefix(KEY, 16);
    expect(buf?.length).toBe(16);
    expect(stream.cancelled()).toBe(true);
    // One chunk was enough: the other four were never pulled into memory.
    expect(stream.reads()).toBeLessThanOrEqual(2);
  });

  it('a missing object (no signature) or a refused GET is null; a 416 (an empty object) is the empty buffer', async () => {
    createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'Object not found' } });
    expect(await downloadObjectPrefix(KEY, 16)).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 })),
    );
    expect(await downloadObjectPrefix(KEY, 16)).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 416 })),
    );
    expect((await downloadObjectPrefix(KEY, 16))?.length).toBe(0);
  });
});
