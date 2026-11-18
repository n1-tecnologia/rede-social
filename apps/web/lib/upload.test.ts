// @vitest-environment happy-dom
import { BRANDING_MAX_BYTES, BRANDING_UPLOAD_MIMES } from '@rede-social/contracts/branding';
import { RESUMABLE_THRESHOLD_BYTES } from '@rede-social/contracts/media';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BRANDING_UPLOAD_ACCEPT,
  CHUNKED_CHUNK_BYTES,
  CHUNKED_MAX_FAILURES,
  CHUNKED_STALL_MS,
  classifyFile,
  normaliseImage,
  resolveMime,
  tusEndpointFor,
  type UploadOutcome,
  uploadBytes,
  uploadChunked,
  uploadToSignedUrl,
} from './upload';

function file(name: string, type: string, bytes = 10): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/**
 * A file of a DECLARED size without allocating it: the router and the pick-time gate read `size`, and
 * a real 12 MiB buffer per case would make this suite cost seconds for nothing.
 */
function sizedFile(name: string, type: string, size: number): File {
  const f = file(name, type, 1);
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('upload helper (02-14, D-27 — client-side UX gate only)', () => {
  it('BRANDING_UPLOAD_ACCEPT is the contracts allow-list joined for <input accept>', () => {
    expect(BRANDING_UPLOAD_ACCEPT).toBe(BRANDING_UPLOAD_MIMES.join(','));
  });

  it('classifyFile: an accepted mime within the cap → null (no error)', () => {
    expect(classifyFile(file('a.png', 'image/png'))).toBeNull();
    expect(classifyFile(file('a.webp', 'image/webp'))).toBeNull();
    expect(classifyFile(file('a.jpg', 'image/jpeg'))).toBeNull();
  });

  it("classifyFile: a mime outside the allow-list → 'type'", () => {
    expect(classifyFile(file('anim.gif', 'image/gif'))).toBe('type');
    expect(classifyFile(file('doc.pdf', 'application/pdf'))).toBe('type');
  });

  it('classifyFile: an empty type falls back to the extension (browsers leave SVG blank)', () => {
    expect(classifyFile(file('logo.svg', ''))).toBeNull();
    expect(resolveMime(file('logo.svg', ''))).toBe('image/svg+xml');
    expect(classifyFile(file('x.bin', ''))).toBe('type');
    expect(resolveMime(file('x.bin', ''))).toBeNull();
  });

  it("classifyFile: above BRANDING_MAX_BYTES → 'size'; exactly the cap → null", () => {
    expect(classifyFile(file('big.png', 'image/png', BRANDING_MAX_BYTES + 1))).toBe('size');
    expect(classifyFile(file('cap.png', 'image/png', BRANDING_MAX_BYTES))).toBeNull();
  });

  it('uploadToSignedUrl is a function (its XHR body is exercised by the e2e, not here)', () => {
    expect(typeof uploadToSignedUrl).toBe('function');
  });
});

/** A `tus.Upload` double: records the options it was constructed with and succeeds on `start()`. */
const tusState = vi.hoisted(() => ({
  constructed: [] as { file: File; options: Record<string, unknown> }[],
}));

vi.mock('tus-js-client', () => ({
  Upload: class {
    options: Record<string, unknown>;
    constructor(uploadFile: File, options: Record<string, unknown>) {
      this.options = options;
      tusState.constructed.push({ file: uploadFile, options });
    }
    findPreviousUploads() {
      return Promise.resolve([]);
    }
    resumeFromPreviousUpload() {}
    start() {
      (this.options.onProgress as (sent: number, total: number) => void)?.(50, 100);
      (this.options.onSuccess as () => void)?.();
    }
    abort() {
      return Promise.resolve();
    }
  },
}));

/** An `XMLHttpRequest` double for the plain-PUT branch: records the URL and answers 200. */
function stubXhr(): { urls: string[] } {
  const urls: string[] = [];
  class FakeXhr {
    upload: Record<string, unknown> = {};
    status = 200;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;
    open(_method: string, url: string) {
      urls.push(url);
    }
    setRequestHeader() {}
    send() {
      this.onload?.();
    }
    abort() {}
  }
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  return { urls };
}

const started = {
  provider: 'supabase',
  signedUrl: 'http://127.0.0.1:54321/storage/v1/object/upload/sign/media/x?token=t',
  token: 'signed-token',
  path: 'tenant/media/asset/original',
  resumableThresholdBytes: RESUMABLE_THRESHOLD_BYTES,
};

describe('uploadBytes — the 6 MiB threshold router (MEDIA-01, RESEARCH Pitfall 3)', () => {
  beforeEach(() => {
    tusState.constructed.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a 1 MiB file takes the plain PUT', async () => {
    const xhr = stubXhr();
    await expect(
      uploadBytes(started, sizedFile('small.jpg', 'image/jpeg', 1024 * 1024), {
        mime: 'image/jpeg',
      }),
    ).resolves.toEqual({ ok: true });
    expect(xhr.urls).toEqual([started.signedUrl]);
    expect(tusState.constructed).toHaveLength(0);
  });

  it('EXACTLY the threshold still takes the plain PUT; one byte more takes TUS', async () => {
    const xhr = stubXhr();
    await uploadBytes(started, sizedFile('cap.jpg', 'image/jpeg', RESUMABLE_THRESHOLD_BYTES), {
      mime: 'image/jpeg',
    });
    expect(xhr.urls).toHaveLength(1);
    expect(tusState.constructed).toHaveLength(0);

    await expect(
      uploadBytes(started, sizedFile('over.jpg', 'image/jpeg', RESUMABLE_THRESHOLD_BYTES + 1), {
        mime: 'image/jpeg',
      }),
    ).resolves.toEqual({ ok: true });
    expect(xhr.urls).toHaveLength(1);
    expect(tusState.constructed).toHaveLength(1);
  });

  it('the TUS upload carries the 6 MiB chunk, the x-signature token and the object metadata', async () => {
    stubXhr();
    const progress: number[] = [];
    await uploadBytes(started, sizedFile('big.jpg', 'image/jpeg', 7 * 1024 * 1024), {
      mime: 'image/jpeg',
      onProgress: (percent) => progress.push(percent),
    });

    const options = tusState.constructed[0]?.options as {
      chunkSize: number;
      headers: Record<string, string>;
      metadata: Record<string, string>;
      uploadDataDuringCreation: boolean;
      removeFingerprintOnSuccess: boolean;
    };
    expect(options.chunkSize).toBe(6 * 1024 * 1024);
    expect(options.headers).toEqual({ 'x-signature': 'signed-token', 'x-upsert': 'false' });
    expect(options.metadata).toMatchObject({
      bucketName: 'media',
      objectName: started.path,
      contentType: 'image/jpeg',
    });
    expect(options.uploadDataDuringCreation).toBe(true);
    expect(options.removeFingerprintOnSuccess).toBe(true);
    expect(progress).toEqual([50]);
  });

  it('a provider that hands out no Storage target fails as a transfer, never as a crash', async () => {
    await expect(
      uploadBytes(
        { ...started, token: null, path: null },
        sizedFile('big.jpg', 'image/jpeg', 7 * 1024 * 1024),
        { mime: 'image/jpeg' },
      ),
    ).resolves.toEqual({ ok: false, reason: 'transfer' });
  });
});

/**
 * 09.2-17 (D-538, T-09.2-86): the TUS endpoint is the origin of the signed URL the API minted from the
 * tenant's own project, never a build-time constant, and a hostile origin is refused.
 */
describe('tusEndpointFor — the endpoint follows the signed URL (09.2-17)', () => {
  const REF = 'abcdefghijklmnopqrst';

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    tusState.constructed.length = 0;
  });

  it('a hosted project: the /sign endpoint on the same origin', () => {
    expect(
      tusEndpointFor(`https://${REF}.supabase.co/storage/v1/object/upload/sign/media/x?token=t`),
    ).toBe(`https://${REF}.supabase.co/storage/v1/upload/resumable/sign`);
  });

  it('the local stack keeps its port, outside production only', () => {
    expect(tusEndpointFor('http://127.0.0.1:54321/storage/v1/object/upload/sign/media/x')).toBe(
      'http://127.0.0.1:54321/storage/v1/upload/resumable/sign',
    );
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => tusEndpointFor('http://127.0.0.1:54321/storage/v1/x')).toThrow();
  });

  it('refuses a hostile or malformed signed URL', () => {
    for (const url of [
      'https://evil.example.com/storage/v1/object/upload/sign/media/x',
      'https://x.supabase.co.evil.com/storage/v1/x',
      `https://${REF}.supabase.co@evil.example.com/storage/v1/x`,
      `http://${REF}.supabase.co/storage/v1/x`,
      'javascript:alert(1)',
      '/storage/v1/object/upload/sign/media/x',
      '',
    ]) {
      expect(() => tusEndpointFor(url), url).toThrow();
    }
  });

  it('the TUS upload is addressed to the signed URL origin', async () => {
    stubXhr();
    const hosted = {
      ...started,
      signedUrl: `https://${REF}.supabase.co/storage/v1/object/upload/sign/media/x?token=t`,
    };
    await uploadBytes(hosted, sizedFile('big.jpg', 'image/jpeg', 7 * 1024 * 1024), {
      mime: 'image/jpeg',
    });
    const options = tusState.constructed[0]?.options as { endpoint: string } | undefined;
    expect(options?.endpoint).toBe(`https://${REF}.supabase.co/storage/v1/upload/resumable/sign`);
  });

  it('a hostile signed URL fails as a transfer and no byte is queued', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      uploadBytes(
        { ...started, signedUrl: 'https://evil.example.com/storage/v1/object/upload/sign/x' },
        sizedFile('big.jpg', 'image/jpeg', 7 * 1024 * 1024),
        { mime: 'image/jpeg' },
      ),
    ).resolves.toEqual({ ok: false, reason: 'transfer' });
    expect(tusState.constructed).toHaveLength(0);
    errorSpy.mockRestore();
  });
});

/** Drives `normaliseImage`'s DOM seams: a decodable image of `size` px and a canvas of our choosing. */
function stubImagePipeline(options: {
  width: number;
  height: number;
  decodes?: boolean;
  blob?: Blob | null;
}) {
  const { width, height, decodes = true, blob = new Blob([new Uint8Array(64)]) } = options;
  const canvases: { width: number; height: number }[] = [];
  const realCreate = document.createElement.bind(document);

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:stub'),
    revokeObjectURL: vi.fn(),
  });

  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'img') {
      // A plain stand-in, not a real element: happy-dom's own `<img>` fires `error` synchronously
      // when `src` is assigned (it cannot fetch a blob: URL), which would settle the decode before
      // the case under test ever runs. The setter below is the ONLY thing that resolves it.
      const img = {
        decoding: 'auto',
        naturalWidth: width,
        naturalHeight: height,
        onload: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
      };
      Object.defineProperty(img, 'src', {
        set() {
          setTimeout(
            () => (decodes ? img.onload?.(new Event('load')) : img.onerror?.(new Event('error'))),
            0,
          );
        },
      });
      return img as unknown as HTMLImageElement;
    }
    if (tag === 'canvas') {
      const canvas = realCreate('canvas') as HTMLCanvasElement;
      canvas.getContext = (() => ({
        drawImage: vi.fn(),
      })) as unknown as HTMLCanvasElement['getContext'];
      canvas.toBlob = ((callback: (result: Blob | null) => void) => {
        canvases.push({ width: canvas.width, height: canvas.height });
        callback(blob);
      }) as HTMLCanvasElement['toBlob'];
      return canvas;
    }
    return realCreate(tag);
  });

  return { canvases };
}

describe('normaliseImage — the invisible HEIC/oversize re-encode (R-12)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('an allow-listed JPEG under the cap and under 2048 px is returned UNTOUCHED (same instance)', async () => {
    const { canvases } = stubImagePipeline({ width: 1024, height: 768 });
    const picked = sizedFile('photo.jpg', 'image/jpeg', 1024 * 1024);

    await expect(normaliseImage(picked, { maxBytes: 8 * 1024 * 1024 })).resolves.toBe(picked);
    expect(canvases).toHaveLength(0);
  });

  it('a HEIC photo becomes a NEW image/jpeg File named .jpg, scaled to the 2048 px box', async () => {
    const { canvases } = stubImagePipeline({ width: 4032, height: 3024 });
    const picked = sizedFile('IMG_0042.HEIC', 'image/heic', 2 * 1024 * 1024);

    const out = await normaliseImage(picked, { maxBytes: 8 * 1024 * 1024 });
    expect(out).not.toBe(picked);
    expect(out.type).toBe('image/jpeg');
    expect(out.name.endsWith('.jpg')).toBe(true);
    expect(canvases[0]).toEqual({ width: 2048, height: 1536 });
  });

  it('an allow-listed photo ABOVE the cap is re-encoded rather than refused', async () => {
    stubImagePipeline({ width: 2048, height: 2048 });
    const picked = sizedFile('huge.jpg', 'image/jpeg', 12 * 1024 * 1024);

    const out = await normaliseImage(picked, { maxBytes: 8 * 1024 * 1024 });
    expect(out).not.toBe(picked);
    expect(out.type).toBe('image/jpeg');
  });

  it('a canvas that yields no blob REJECTS, so the caller can render the prepare-failed copy', async () => {
    stubImagePipeline({ width: 4032, height: 3024, blob: null });
    await expect(
      normaliseImage(sizedFile('IMG_0042.HEIC', 'image/heic', 2 * 1024 * 1024), {
        maxBytes: 8 * 1024 * 1024,
      }),
    ).rejects.toThrow();
  });

  it('a photo the browser cannot decode REJECTS — never resolves with the original', async () => {
    stubImagePipeline({ width: 0, height: 0, decodes: false });
    await expect(
      normaliseImage(sizedFile('IMG_0042.HEIC', 'image/heic', 2 * 1024 * 1024), {
        maxBytes: 8 * 1024 * 1024,
      }),
    ).rejects.toThrow();
  });
});

/**
 * The chunked direct-upload (quick 261118-mst): a resumable in-repo uploader behind `uploadChunked`.
 * A scripted fake `XMLHttpRequest` stands in for the provider; a fake `File` fakes `size` and hands out
 * a NEW Blob per `slice` call so a test can prove every attempt re-slices. Waits run on fake timers.
 */
type ProgressEvent_ = { lengthComputable: boolean; loaded: number; total: number };
type Step =
  | { status: number; range?: string; loaded?: number[]; effect?: () => void }
  | { fail: 'error' | 'timeout' | 'hang'; loaded?: number[]; effect?: () => void };
type Recorded = {
  method: string;
  url: string;
  headers: [string, string][];
  body: unknown;
  kind: 'data' | 'query';
  at: number;
};
type Script = { data?: Step[]; dataRest?: Step; query?: Step[]; queryRest?: Step };
type FakeXhrInstance = {
  upload: { onprogress: ((event: ProgressEvent_) => void) | null };
  abort: ReturnType<typeof vi.fn>;
};

const r = (status: number, range?: string, loaded?: number[]): Step => ({ status, range, loaded });
const rng = (lastByte: number) => `bytes=0-${lastByte}`;
const ERR: Step = { fail: 'error' };
const HANG: Step = { fail: 'hang' };

const C = CHUNKED_CHUNK_BYTES;
const UPLOAD_URL = 'https://direct-uploads.example/put?sig=SECRET-TOKEN';
const SECRET_NAME = 'secret-holiday.mp4';

function chunkFile(size: number, type = 'video/mp4') {
  const f = new File([new Uint8Array(1)], SECRET_NAME, { type });
  Object.defineProperty(f, 'size', { value: size });
  const slice = vi.fn((_start?: number, _end?: number) => new Blob([new Uint8Array(1)]));
  Object.defineProperty(f, 'slice', { value: slice });
  return { file: f, slice };
}

function installXhr(script: Script) {
  const reqs: Recorded[] = [];
  const xhrs: FakeXhrInstance[] = [];
  let dataN = 0;
  let queryN = 0;
  class FakeXhr {
    upload: FakeXhrInstance['upload'] = { onprogress: null };
    status = 0;
    range: string | null = null;
    dead = false;
    rec!: Recorded;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;
    abort = vi.fn(() => {
      this.dead = true;
      this.onabort?.();
    });
    constructor() {
      xhrs.push(this);
    }
    open(method: string, url: string) {
      this.rec = { method, url, headers: [], body: undefined, kind: 'data', at: 0 };
      reqs.push(this.rec);
    }
    setRequestHeader(name: string, value: string) {
      this.rec.headers.push([name, value]);
    }
    getResponseHeader(name: string) {
      return name.toLowerCase() === 'range' ? this.range : null;
    }
    send(body?: unknown) {
      this.rec.body = body;
      this.rec.at = Date.now();
      const contentRange =
        this.rec.headers.find(([n]) => n.toLowerCase() === 'content-range')?.[1] ?? '';
      this.rec.kind = contentRange.startsWith('bytes */') ? 'query' : 'data';
      const step =
        this.rec.kind === 'query'
          ? (script.query?.[queryN++] ?? script.queryRest ?? { status: 308 })
          : (script.data?.[dataN++] ?? script.dataRest);
      Promise.resolve().then(() => {
        if (!step) throw new Error(`unscripted ${this.rec.kind} request #${reqs.length}`);
        if (this.dead) return;
        for (const loaded of step.loaded ?? []) {
          this.upload.onprogress?.({ lengthComputable: true, loaded, total: loaded });
        }
        step.effect?.();
        if ('fail' in step) {
          if (step.fail === 'error') this.onerror?.();
          else if (step.fail === 'timeout') this.ontimeout?.();
          return;
        }
        this.status = step.status;
        this.range = step.range ?? null;
        this.onload?.();
      });
    }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  return { reqs, xhrs };
}

const headerNames = (rec: Recorded) => rec.headers.map(([n]) => n.toLowerCase()).sort();
const header = (rec: Recorded, name: string) =>
  rec.headers.find(([n]) => n.toLowerCase() === name)?.[1];
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

function begin(
  f: File,
  opts: { signal?: AbortSignal; url?: string } = {},
): { p: Promise<UploadOutcome>; percents: number[] } {
  const percents: number[] = [];
  const p = uploadChunked(opts.url ?? UPLOAD_URL, f, {
    onProgress: (percent) => percents.push(percent),
    signal: opts.signal,
  });
  return { p, percents };
}

async function finish(p: Promise<UploadOutcome>, ms = 3_600_000) {
  await tick(ms);
  return p;
}

describe('uploadChunked — resumable direct upload (quick 261118-mst)', () => {
  let online = true;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const loggedReason = (call: number): string =>
    ((errorSpy.mock.calls[call] ?? [])[1] as { error?: string } | undefined)?.error ?? '';

  beforeEach(() => {
    vi.useFakeTimers();
    online = true;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'onLine');
    Reflect.deleteProperty(navigator, 'wakeLock');
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('B01 a small file is ONE PUT with exactly two request headers and ends at 100', async () => {
    const { reqs } = installXhr({ data: [r(200)] });
    const { file: f, slice } = chunkFile(1024 * 1024);
    const { p, percents } = begin(f);
    await expect(finish(p)).resolves.toEqual({ ok: true });
    expect(reqs).toHaveLength(1);
    expect(reqs[0]?.method).toBe('PUT');
    expect(reqs[0]?.url).toBe(UPLOAD_URL);
    expect(headerNames(reqs[0] as Recorded)).toEqual(['content-range', 'content-type']);
    expect(header(reqs[0] as Recorded, 'content-type')).toBe('video/mp4');
    expect(header(reqs[0] as Recorded, 'content-range')).toBe('bytes 0-1048575/1048576');
    expect(slice.mock.calls).toEqual([[0, 1048576]]);
    expect(reqs[0]?.body).toBe(slice.mock.results[0]?.value);
    expect(percents.at(-1)).toBe(100);
  });

  it('B02 chunks of 32 MiB (a multiple of 256 KiB) continue on a 308 with Range', async () => {
    expect(CHUNKED_CHUNK_BYTES).toBe(32 * 1024 * 1024);
    expect(CHUNKED_CHUNK_BYTES % (256 * 1024)).toBe(0);
    const total = 2.5 * C;
    const { reqs } = installXhr({ data: [r(308, rng(C - 1)), r(308, rng(2 * C - 1)), r(200)] });
    const { file: f, slice } = chunkFile(total);
    await expect(finish(begin(f).p)).resolves.toEqual({ ok: true });
    expect(reqs.map((x) => header(x, 'content-range'))).toEqual([
      `bytes 0-${C - 1}/${total}`,
      `bytes ${C}-${2 * C - 1}/${total}`,
      `bytes ${2 * C}-${total - 1}/${total}`,
    ]);
    expect(slice.mock.calls).toEqual([
      [0, C],
      [C, 2 * C],
      [2 * C, total],
    ]);
  });

  it('B03 a Range behind the chunk resends from it; a Range ahead of the chunk skips ahead', async () => {
    const behind = installXhr({
      data: [r(308, rng(C / 2 - 1)), r(308, rng(1.5 * C - 1)), r(200)],
    });
    const f1 = chunkFile(2 * C);
    await expect(finish(begin(f1.file).p)).resolves.toEqual({ ok: true });
    expect(behind.reqs.map((x) => header(x, 'content-range'))).toEqual([
      `bytes 0-${C - 1}/${2 * C}`,
      `bytes ${C / 2}-${1.5 * C - 1}/${2 * C}`,
      `bytes ${1.5 * C}-${2 * C - 1}/${2 * C}`,
    ]);
    expect(f1.slice.mock.calls.map((c) => c[0])).toEqual([0, C / 2, 1.5 * C]);

    const ahead = installXhr({ data: [r(308, rng(2 * C - 1)), r(200)] });
    await expect(finish(begin(chunkFile(3 * C).file).p)).resolves.toEqual({ ok: true });
    expect(header(ahead.reqs[1] as Recorded, 'content-range')).toBe(
      `bytes ${2 * C}-${3 * C - 1}/${3 * C}`,
    );
  });

  it('B04 a 308 without a readable Range: a data chunk advances by the chunk, a query keeps the offset', async () => {
    const data = installXhr({ data: [r(308), r(200)] });
    await expect(finish(begin(chunkFile(2 * C).file).p)).resolves.toEqual({ ok: true });
    expect(header(data.reqs[1] as Recorded, 'content-range')).toBe(
      `bytes ${C}-${2 * C - 1}/${2 * C}`,
    );

    const query = installXhr({ data: [r(308, rng(C - 1)), ERR, r(200)], query: [r(308)] });
    await expect(finish(begin(chunkFile(2 * C).file).p)).resolves.toEqual({ ok: true });
    expect(query.reqs.map((x) => x.kind)).toEqual(['data', 'data', 'query', 'data']);
    expect(header(query.reqs[3] as Recorded, 'content-range')).toBe(
      `bytes ${C}-${2 * C - 1}/${2 * C}`,
    );
  });

  it('B05 a network failure waits 1 s, asks the committed offset, then re-slices and resends', async () => {
    const { reqs } = installXhr({
      data: [r(308, rng(C - 1)), ERR, r(200)],
      query: [r(308, rng(C - 1))],
    });
    const { file: f, slice } = chunkFile(2 * C);
    const { p } = begin(f);
    await tick(999);
    expect(reqs).toHaveLength(2);
    await tick(1);
    expect(reqs.map((x) => x.kind)).toEqual(['data', 'data', 'query', 'data']);
    await expect(finish(p)).resolves.toEqual({ ok: true });

    const query = reqs[2] as Recorded;
    expect(query.method).toBe('PUT');
    expect(headerNames(query)).toEqual(['content-range', 'content-type']);
    expect(header(query, 'content-range')).toBe(`bytes */${2 * C}`);
    expect(query.body).toBeUndefined();
    expect(slice.mock.calls).toEqual([
      [0, C],
      [C, 2 * C],
      [C, 2 * C],
    ]);
    expect(slice.mock.results[1]?.value).not.toBe(slice.mock.results[2]?.value);
    expect(reqs[1]?.body).toBe(slice.mock.results[1]?.value);
    expect(reqs[3]?.body).toBe(slice.mock.results[2]?.value);
    expect(reqs[1]?.body).not.toBe(reqs[3]?.body);
  });

  it.each([408, 429, 500, 502, 503, 504])('B06 status %i is retried after 1 s', async (status) => {
    const { reqs } = installXhr({ data: [r(status), r(200)] });
    const { p } = begin(chunkFile(1024 * 1024).file);
    await tick(999);
    expect(reqs).toHaveLength(1);
    await tick(1);
    expect(reqs.map((x) => x.kind)).toEqual(['data', 'query', 'data']);
    await expect(finish(p)).resolves.toEqual({ ok: true });
  });

  it('B07 the status query resumes from its Range; a 2xx answer means already complete', async () => {
    const resume = installXhr({
      data: [r(308, rng(C - 1)), ERR, r(200)],
      query: [r(308, rng(1.5 * C - 1))],
    });
    await expect(finish(begin(chunkFile(2 * C).file).p)).resolves.toEqual({ ok: true });
    expect(resume.reqs).toHaveLength(4);
    expect(header(resume.reqs[3] as Recorded, 'content-range')).toBe(
      `bytes ${1.5 * C}-${2 * C - 1}/${2 * C}`,
    );

    for (const status of [200, 201]) {
      const done = installXhr({ data: [r(308, rng(C - 1)), ERR], query: [r(status)] });
      await expect(finish(begin(chunkFile(2 * C).file).p)).resolves.toEqual({ ok: true });
      expect(done.reqs.map((x) => x.kind)).toEqual(['data', 'data', 'query']);
    }
  });

  it.each([
    ['503', r(503)],
    ['a network error', ERR],
    ['404', r(404)],
  ] as [string, Step][])(
    'B08 an inconclusive status query (%s) resends from the last offset with no extra wait',
    async (_name, answer) => {
      const { reqs } = installXhr({ data: [ERR, r(200)], query: [answer] });
      await expect(finish(begin(chunkFile(1024 * 1024).file).p)).resolves.toEqual({ ok: true });
      expect(reqs.map((x) => x.kind)).toEqual(['data', 'query', 'data']);
      expect(reqs[2]?.at).toBe(reqs[1]?.at);
      expect(header(reqs[2] as Recorded, 'content-range')).toBe('bytes 0-1048575/1048576');
    },
  );

  it.each([400, 401, 403, 404, 410])('B09 status %i is fatal at once', async (status) => {
    const { reqs } = installXhr({ data: [r(status)] });
    const { p } = begin(chunkFile(1024 * 1024).file);
    await tick(0);
    await expect(p).resolves.toEqual({ ok: false, reason: 'transfer' });
    expect(reqs).toHaveLength(1);
    expect(reqs.some((x) => x.kind === 'query')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toBe('media.chunked_failed');
    expect(loggedReason(0)).toContain(`status ${status}`);
  });

  it('B10 413 is too_large', async () => {
    const { reqs } = installXhr({ data: [r(413)] });
    const { p } = begin(chunkFile(1024 * 1024).file);
    await tick(0);
    await expect(p).resolves.toEqual({ ok: false, reason: 'too_large' });
    expect(reqs).toHaveLength(1);
  });

  describe('B11 abort', () => {
    it('aborting a hung request aborts the XHR and leaves nothing behind', async () => {
      const { reqs, xhrs } = installXhr({ data: [HANG] });
      const ctrl = new AbortController();
      const { p } = begin(chunkFile(1024 * 1024).file, { signal: ctrl.signal });
      await tick(0);
      ctrl.abort();
      await expect(p).resolves.toEqual({ ok: false, reason: 'aborted' });
      expect(xhrs[0]?.abort).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      await tick(3_600_000);
      expect(reqs).toHaveLength(1);
    });

    it('aborting during a backoff wait clears the timer and sends nothing more', async () => {
      const { reqs } = installXhr({ data: [ERR, r(200)] });
      const ctrl = new AbortController();
      const { p } = begin(chunkFile(1024 * 1024).file, { signal: ctrl.signal });
      await tick(500);
      ctrl.abort();
      await expect(p).resolves.toEqual({ ok: false, reason: 'aborted' });
      expect(vi.getTimerCount()).toBe(0);
      await tick(3_600_000);
      expect(reqs).toHaveLength(1);
    });

    it('an already-aborted signal resolves at once: no request, no slice, no wake lock', async () => {
      const { reqs } = installXhr({ data: [r(200)] });
      const request = vi.fn();
      Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
      const ctrl = new AbortController();
      ctrl.abort();
      const { file: f, slice } = chunkFile(1024 * 1024);
      await expect(begin(f, { signal: ctrl.signal }).p).resolves.toEqual({
        ok: false,
        reason: 'aborted',
      });
      expect(reqs).toHaveLength(0);
      expect(slice).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    });
  });

  describe('B12 offline', () => {
    it('an offline failure is not counted, waits for `online`, then queries and resends', async () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      const { reqs } = installXhr({
        data: [
          {
            fail: 'error',
            effect: () => {
              online = false;
            },
          },
          r(200),
        ],
      });
      const { p } = begin(chunkFile(1024 * 1024).file);
      await tick(600_000);
      expect(reqs).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
      online = true;
      window.dispatchEvent(new Event('online'));
      await tick(0);
      expect(reqs.map((x) => x.kind)).toEqual(['data', 'query', 'data']);
      await expect(p).resolves.toEqual({ ok: true });
      expect(removeSpy.mock.calls.some((c) => c[0] === 'online')).toBe(true);
    });

    it('starting offline sends nothing until `online`', async () => {
      online = false;
      const { reqs } = installXhr({ data: [r(200)] });
      const { p } = begin(chunkFile(1024 * 1024).file);
      await tick(600_000);
      expect(reqs).toHaveLength(0);
      online = true;
      window.dispatchEvent(new Event('online'));
      await expect(finish(p)).resolves.toEqual({ ok: true });
      expect(reqs.map((x) => x.kind)).toEqual(['data']);
    });

    it('aborting while paused offline resolves aborted and removes the listener', async () => {
      online = false;
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      installXhr({ data: [r(200)] });
      const ctrl = new AbortController();
      const { p } = begin(chunkFile(1024 * 1024).file, { signal: ctrl.signal });
      await tick(1000);
      ctrl.abort();
      await expect(p).resolves.toEqual({ ok: false, reason: 'aborted' });
      expect(removeSpy.mock.calls.some((c) => c[0] === 'online')).toBe(true);
    });
  });

  it('B13 progress never walks back across a retry and reaches 100 only at success', async () => {
    installXhr({
      data: [
        { fail: 'error', loaded: [0.75 * C] },
        r(308, rng(1.5 * C - 1), [C / 4, C / 2]),
        r(200),
      ],
      query: [r(308, rng(C / 2 - 1))],
    });
    const { p, percents } = begin(chunkFile(2 * C).file);
    await expect(finish(p)).resolves.toEqual({ ok: true });
    expect(percents).toEqual([37, 50, 75, 100]);
  });

  it('B14 the budget: 12 failed data requests, 1/2/4/8/16/30 s backoff, then a short reason', async () => {
    expect(CHUNKED_MAX_FAILURES).toBe(12);
    const { reqs } = installXhr({ dataRest: r(503) });
    const { p } = begin(chunkFile(1024 * 1024).file);
    await expect(finish(p)).resolves.toEqual({ ok: false, reason: 'transfer' });
    const data = reqs.filter((x) => x.kind === 'data');
    expect(data).toHaveLength(12);
    const gaps = data.slice(1).map((x, i) => x.at - (data[i] as Recorded).at);
    expect(gaps).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000, 30000]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toBe('media.chunked_failed');
    const reason = loggedReason(0);
    expect(reason).toContain('status 503');
    expect(reason).toContain('committed=0');
    expect(reason).toContain('attempts=12');
  });

  it('B15 a newly committed byte resets the failure counter', async () => {
    const failures = (n: number) => Array.from({ length: n }, () => r(503));
    installXhr({ data: [...failures(11), r(308, rng(C - 1)), ...failures(11), r(200)] });
    await expect(finish(begin(chunkFile(2 * C).file).p)).resolves.toEqual({ ok: true });
  });

  it('B16 a server that repeats the same Range cannot spin the loop', async () => {
    const { reqs } = installXhr({ data: [r(308, rng(C - 1))], dataRest: r(308, rng(C - 1)) });
    await expect(finish(begin(chunkFile(3 * C).file).p)).resolves.toEqual({
      ok: false,
      reason: 'transfer',
    });
    expect(reqs.filter((x) => x.kind === 'data').length).toBeLessThanOrEqual(13);
  });

  describe('B17 stall watchdog', () => {
    it('a request with no progress is aborted at CHUNKED_STALL_MS and retried', async () => {
      const { reqs, xhrs } = installXhr({ data: [HANG, r(200)] });
      const { p } = begin(chunkFile(1024 * 1024).file);
      await tick(CHUNKED_STALL_MS - 1);
      expect(xhrs[0]?.abort).not.toHaveBeenCalled();
      await tick(1);
      expect(xhrs[0]?.abort).toHaveBeenCalledTimes(1);
      await tick(1000);
      expect(reqs.map((x) => x.kind)).toEqual(['data', 'query', 'data']);
      await expect(finish(p)).resolves.toEqual({ ok: true });
    });

    it('a progress event postpones the deadline by a full CHUNKED_STALL_MS', async () => {
      const { xhrs } = installXhr({ data: [HANG, r(200)] });
      const { p } = begin(chunkFile(1024 * 1024).file);
      await tick(100_000);
      xhrs[0]?.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 100 });
      await tick(CHUNKED_STALL_MS - 1);
      expect(xhrs[0]?.abort).not.toHaveBeenCalled();
      await tick(1);
      expect(xhrs[0]?.abort).toHaveBeenCalledTimes(1);
      await expect(finish(p)).resolves.toEqual({ ok: true });
    });
  });

  it('B18 the console line never carries the URL or the file name', async () => {
    installXhr({ data: [r(403)] });
    await expect(finish(begin(chunkFile(1024 * 1024).file).p)).resolves.toEqual({
      ok: false,
      reason: 'transfer',
    });
    installXhr({ dataRest: r(503) });
    await expect(finish(begin(chunkFile(1024 * 1024).file).p)).resolves.toEqual({
      ok: false,
      reason: 'transfer',
    });
    expect(errorSpy).toHaveBeenCalledTimes(2);
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain('SECRET-TOKEN');
    expect(logged).not.toContain('direct-uploads');
    expect(logged).not.toContain('secret-holiday');
  });

  it('B19 an empty file fails as a transfer with no request and one log line', async () => {
    const { reqs } = installXhr({ data: [r(200)] });
    await expect(begin(chunkFile(0).file).p).resolves.toEqual({ ok: false, reason: 'transfer' });
    expect(reqs).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  describe('B20 wake lock', () => {
    function stubWakeLock(impl?: () => Promise<unknown>) {
      const sentinel = {
        released: false,
        release: vi.fn(async () => {
          sentinel.released = true;
        }),
      };
      const request = vi.fn(impl ?? (async () => sentinel));
      Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
      return { request, sentinel };
    }

    it('is requested at start and released when the upload settles (success, failure, abort)', async () => {
      const ok = stubWakeLock();
      installXhr({ data: [r(200)] });
      await expect(finish(begin(chunkFile(1024 * 1024).file).p)).resolves.toEqual({ ok: true });
      expect(ok.request).toHaveBeenCalledTimes(1);
      expect(ok.request).toHaveBeenCalledWith('screen');
      expect(ok.sentinel.release).toHaveBeenCalledTimes(1);

      const failed = stubWakeLock();
      installXhr({ data: [r(403)] });
      await finish(begin(chunkFile(1024 * 1024).file).p);
      expect(failed.sentinel.release).toHaveBeenCalledTimes(1);

      const aborted = stubWakeLock();
      installXhr({ data: [HANG] });
      const ctrl = new AbortController();
      const { p } = begin(chunkFile(1024 * 1024).file, { signal: ctrl.signal });
      await tick(0);
      ctrl.abort();
      await expect(p).resolves.toEqual({ ok: false, reason: 'aborted' });
      await tick(0);
      expect(aborted.sentinel.release).toHaveBeenCalledTimes(1);
    });

    it('is re-requested when the page becomes visible again', async () => {
      const lock = stubWakeLock();
      installXhr({ data: [HANG] });
      const ctrl = new AbortController();
      const { p } = begin(chunkFile(1024 * 1024).file, { signal: ctrl.signal });
      await tick(0);
      expect(lock.request).toHaveBeenCalledTimes(1);
      lock.sentinel.released = true;
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
      await tick(0);
      expect(lock.request).toHaveBeenCalledTimes(2);
      ctrl.abort();
      await p;
    });

    it('a request that rejects or throws never breaks the upload', async () => {
      stubWakeLock(async () => {
        throw new Error('NotAllowedError');
      });
      installXhr({ data: [r(200)] });
      await expect(finish(begin(chunkFile(1024 * 1024).file).p)).resolves.toEqual({ ok: true });

      stubWakeLock(() => {
        throw new Error('sync throw');
      });
      installXhr({ data: [r(200)] });
      await expect(finish(begin(chunkFile(1024 * 1024).file).p)).resolves.toEqual({ ok: true });
    });

    it('works with no wake lock API at all', async () => {
      Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
      installXhr({ data: [r(200)] });
      await expect(finish(begin(chunkFile(1024 * 1024).file).p)).resolves.toEqual({ ok: true });
    });
  });

  it('B21 uploadBytes sends every non-supabase provider through the chunked uploader', async () => {
    tusState.constructed.length = 0;
    const { reqs } = installXhr({ data: [r(200)] });
    const p = uploadBytes(
      {
        provider: 'mux',
        signedUrl: 'https://direct-uploads.example/put?sig=abc',
        token: null,
        path: null,
        resumableThresholdBytes: RESUMABLE_THRESHOLD_BYTES,
      },
      chunkFile(1024 * 1024).file,
      { mime: 'video/mp4' },
    );
    await expect(finish(p)).resolves.toEqual({ ok: true });
    expect(reqs).toHaveLength(1);
    expect(header(reqs[0] as Recorded, 'content-range')).toBe('bytes 0-1048575/1048576');
    expect(tusState.constructed).toHaveLength(0);
  });
});
