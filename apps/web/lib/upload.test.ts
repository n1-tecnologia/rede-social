// @vitest-environment happy-dom
import { BRANDING_MAX_BYTES, BRANDING_UPLOAD_MIMES } from '@rede-social/contracts/branding';
import { RESUMABLE_THRESHOLD_BYTES } from '@rede-social/contracts/media';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BRANDING_UPLOAD_ACCEPT,
  classifyFile,
  normaliseImage,
  resolveMime,
  uploadBytes,
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
  signedUrl: 'http://storage.test/object/upload/sign/media/x',
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
