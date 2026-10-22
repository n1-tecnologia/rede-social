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

/**
 * 09.2-05 (D-539, T-09.2-23): every call picks the Supabase project that owns the key from the key's first path
 * segment (the tenant uuid). The registry and the admin clients are replaced by recorders: one Storage double
 * per project, so a test can say WHICH project a call reached.
 */
const h = vi.hoisted(() => {
  const makeStore = () => ({
    createSignedUrl: vi.fn(),
    createSignedUploadUrl: vi.fn(),
    info: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
    list: vi.fn(),
    remove: vi.fn(),
  });
  return {
    stores: { p0: makeStore(), pb: makeStore() } as Record<string, ReturnType<typeof makeStore>>,
    makeStore,
    resolveProject: vi.fn(),
  };
});
const createSignedUrl = h.stores.p0?.createSignedUrl as ReturnType<typeof vi.fn>;

vi.mock('../server/supabase-admin', () => ({
  supabaseAdminFor: (project: { id: string }) => ({
    storage: { from: () => h.stores[project.id] },
  }),
}));

vi.mock('../server/tenancy/project-registry', () => ({
  resolveProject: h.resolveProject,
}));

const {
  downloadObject,
  downloadObjectPrefix,
  listObjects,
  MEDIA_SIGNED_READ_TTL_S,
  objectInfo,
  putObject,
  removeObjects,
  signRead,
  signReadFor,
  signUpload,
} = await import('../server/media/storage');
const keys = await import('../server/media/keys');

const TENANT = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const KEY = `${TENANT}/media/0a1b2c3d-4e5f-4a6b-8c7d-9e8f7a6b5c4d/original`;

beforeEach(() => {
  for (const store of Object.values(h.stores))
    for (const fn of Object.values(store)) fn.mockReset();
  // TENANT lives in project 0; TENANT_B in project B. Anything else is unbound (never a default).
  h.resolveProject.mockReset();
  h.resolveProject.mockImplementation(async (tenantId: string) => {
    if (tenantId === TENANT) return { id: 'p0' };
    if (tenantId === TENANT_B) return { id: 'pb' };
    throw new Error('unbound');
  });
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

describe('routes by the key — Storage follows the tenant (D-539, T-09.2-23)', () => {
  const KEY_B = `${TENANT_B}/media/0a1b2c3d-4e5f-4a6b-8c7d-9e8f7a6b5c4d/original`;
  const p0 = h.stores.p0 as (typeof h.stores)[string];
  const pb = h.stores.pb as (typeof h.stores)[string];
  const calls = (store: typeof p0) =>
    Object.values(store).reduce((n, fn) => n + fn.mock.calls.length, 0);

  beforeEach(() => {
    for (const store of [p0, pb]) {
      store.createSignedUrl.mockResolvedValue({
        data: { signedUrl: 'https://s.test/x' },
        error: null,
      });
      store.createSignedUploadUrl.mockResolvedValue({
        data: { signedUrl: 'https://s.test/up', token: 't', path: 'p' },
        error: null,
      });
      store.info.mockResolvedValue({ data: { size: 3, contentType: 'image/png' }, error: null });
      store.download.mockResolvedValue({
        data: { bytes: async () => new Uint8Array([1]) },
        error: null,
      });
      store.upload.mockResolvedValue({ error: null });
      store.list.mockResolvedValue({ data: [{ id: 'a', name: 'original' }], error: null });
      store.remove.mockResolvedValue({ error: null });
    }
  });

  it('a key of the project-0 tenant reaches project 0 and a key of the tenant on B reaches B, for every function', async () => {
    const exercise = async (key: string, prefix: string) => {
      await signUpload(key);
      await signRead(`${key}-memo-${Math.random()}`);
      await signReadFor(key, 60);
      await objectInfo(key);
      await downloadObject(key);
      await putObject(key, Buffer.from('x'), { contentType: 'image/png' });
      await listObjects(prefix);
      await removeObjects([key]);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(new Uint8Array([1]), { status: 206 })),
      );
      await downloadObjectPrefix(key, 1);
      vi.unstubAllGlobals();
    };
    await exercise(KEY, `${TENANT}/media/asset/`);
    expect(calls(p0)).toBeGreaterThanOrEqual(9);
    expect(calls(pb)).toBe(0);

    for (const store of [p0, pb]) for (const fn of Object.values(store)) fn.mockClear();
    await exercise(KEY_B, `${TENANT_B}/media/asset/`);
    expect(calls(pb)).toBeGreaterThanOrEqual(9);
    expect(calls(p0)).toBe(0);
    expect(h.resolveProject).toHaveBeenCalledWith(TENANT_B);
  });

  it('a key whose first segment is not a uuid is refused before the resolver is called', async () => {
    for (const bad of [
      'not a uuid/media/x/original',
      '../x',
      '',
      '/media/x',
      'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA/media/x/original',
    ]) {
      await expect(signRead(bad)).rejects.toThrow('invalid media key');
      await expect(signUpload(bad)).rejects.toThrow('invalid media key');
      await expect(objectInfo(bad)).rejects.toThrow('invalid media key');
      await expect(listObjects(bad)).rejects.toThrow('invalid media key');
      await expect(removeObjects([bad])).rejects.toThrow('invalid media key');
    }
    expect(h.resolveProject).not.toHaveBeenCalled();
    expect(calls(p0) + calls(pb)).toBe(0);
  });

  it('removeObjects of keys naming two tenants is refused before anything is resolved or removed', async () => {
    await expect(removeObjects([KEY, KEY_B])).rejects.toThrow(
      'media keys span more than one tenant',
    );
    expect(h.resolveProject).not.toHaveBeenCalled();
    expect(p0.remove).not.toHaveBeenCalled();
    expect(pb.remove).not.toHaveBeenCalled();
    // The same tenant twice is one batch to one project; an empty batch touches nothing.
    await removeObjects([KEY, `${TENANT}/media/other/original`]);
    expect(p0.remove).toHaveBeenCalledTimes(1);
    await removeObjects([]);
    expect(p0.remove).toHaveBeenCalledTimes(1);
  });

  it('an unbound tenant never falls back to project 0: the call fails and no Storage is touched', async () => {
    const stranger = '33333333-3333-4333-8333-333333333333';
    await expect(signReadFor(`${stranger}/media/x/original`, 60)).rejects.toThrow('unbound');
    expect(calls(p0) + calls(pb)).toBe(0);
  });

  it('every builder of keys.ts returns a string whose first segment is the tenant id passed in', () => {
    const asset = '0a1b2c3d-4e5f-4a6b-8c7d-9e8f7a6b5c4d';
    const built = [
      keys.mediaAssetPrefix(TENANT_B, asset),
      keys.mediaOriginalKey(TENANT_B, asset),
      keys.mediaVariantKey(TENANT_B, asset, 320),
      keys.mediaKeyFor(TENANT_B, asset, 'original'),
      keys.mediaKeyFor(TENANT_B, asset, 'w320'),
    ];
    for (const key of built) {
      expect(key).not.toBeNull();
      expect((key as string).split('/', 1)[0]).toBe(TENANT_B);
    }
  });
});
