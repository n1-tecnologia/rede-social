// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_ICON_SETTINGS } from './app-icon';
import {
  AppIconError,
  composeAppIconFile,
  encodeAppIcon,
  loadIconImage,
  sizedSvg,
} from './app-icon-image';

/**
 * 2026-10-09 — the app icon's browser half, through its DOM seams (happy-dom has no 2D context and
 * its own `<img>` cannot decode a blob URL, so both are stand-ins of our choosing, as in
 * `upload.test.ts`):
 *
 *  1. a picked file decodes into a canvas no larger than the composition needs, and its object URL
 *     is revoked;
 *  2. an SVG without width and height gets them from its viewBox, the longer side 1024;
 *  3. a URL that cannot be read (network, CORS, an error status) is `unreachable`, a source over
 *     15 MiB `tooLarge`, an image the browser cannot read `decode`;
 *  4. the encode takes the PNG when it fits, falls back to a JPEG when it does not, and says `size`
 *     when nothing fits (a browser that answers a PNG for the JPEG does not count as a JPEG);
 *  5. the composition draws the settings on a 1024 square and returns the file the upload sends.
 */

type Stub = {
  width: number;
  height: number;
  decodes?: boolean;
  /** What `toBlob` answers, by requested type and quality. */
  encode?: (type: string, quality?: number) => Blob | null;
};

function stubDom({ width, height, decodes = true, encode }: Stub) {
  const created: Blob[] = [];
  const revoked: string[] = [];
  const canvases: { width: number; height: number; drawn: unknown[][] }[] = [];
  const realCreate = document.createElement.bind(document);

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn((blob: Blob) => {
      created.push(blob);
      return `blob:stub-${created.length}`;
    }),
    revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
  });

  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'img') {
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
      const record = { width: 0, height: 0, drawn: [] as unknown[][] };
      canvases.push(record);
      canvas.getContext = (() => ({
        fillStyle: '',
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        fillRect: (...args: unknown[]) => record.drawn.push(['fillRect', ...args]),
        drawImage: (...args: unknown[]) => record.drawn.push(['drawImage', ...args]),
      })) as unknown as HTMLCanvasElement['getContext'];
      canvas.toBlob = ((callback: (blob: Blob | null) => void, type: string, quality?: number) => {
        record.width = canvas.width;
        record.height = canvas.height;
        callback(encode ? encode(type, quality) : new Blob([new Uint8Array(64)], { type }));
      }) as HTMLCanvasElement['toBlob'];
      return canvas;
    }
    return realCreate(tag);
  });

  return { created, revoked, canvases };
}

const sized = (bytes: number, type: string) => new Blob([new Uint8Array(bytes)], { type });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('loadIconImage', () => {
  it('1. decodes a picked file into a canvas at most 1024 on its shorter side, and revokes its URL', async () => {
    const { canvases, revoked } = stubDom({ width: 4000, height: 3000 });
    const file = new File([new Uint8Array(32)], 'foto.jpg', { type: 'image/jpeg' });

    const image = await loadIconImage({ file });

    expect(image.width).toBe(1365);
    expect(image.height).toBe(1024);
    expect(canvases[0]?.drawn[0]?.[0]).toBe('drawImage');
    expect(revoked).toEqual(['blob:stub-1']);
  });

  it('1. keeps a small image at its own size', async () => {
    stubDom({ width: 320, height: 96 });
    const image = await loadIconImage({
      file: new File([new Uint8Array(32)], 'logo.png', { type: 'image/png' }),
    });
    expect([image.width, image.height]).toEqual([320, 96]);
  });

  it('2. sizes an SVG without width and height from its viewBox, the longer side 1024', async () => {
    const { created } = stubDom({ width: 1024, height: 307 });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 96"><rect/></svg>';

    await loadIconImage({ file: new File([svg], 'logo.svg', { type: '' }) });

    const decoded = await (created[0] as Blob).text();
    expect(created[0]?.type).toBe('image/svg+xml');
    expect(decoded).toContain('<svg width="1024" height="307" ');
    expect(decoded).toContain('viewBox="0 0 320 96"');
  });

  it('2. sizes a fetched SVG answered with a charset, or as untyped bytes', async () => {
    const { created } = stubDom({ width: 1024, height: 1024 });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect/></svg>';
    for (const type of ['image/svg+xml; charset=utf-8', 'application/octet-stream']) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(svg, { headers: { 'content-type': type } })),
      );
      await loadIconImage({ url: 'https://bucket.test/branding/logo.svg?v=2' });
    }
    expect(created).toHaveLength(2);
    for (const blob of created) {
      expect(blob.type).toBe('image/svg+xml');
      expect(await blob.text()).toContain('<svg width="1024" height="1024" ');
    }
  });

  it('3. a URL whose bytes cannot be read is unreachable, never a decode', async () => {
    stubDom({ width: 320, height: 96 });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(loadIconImage({ url: 'https://bucket.test/logo.svg' })).rejects.toMatchObject({
      code: 'unreachable',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 403 })));
    await expect(loadIconImage({ url: 'https://bucket.test/logo.svg' })).rejects.toBeInstanceOf(
      AppIconError,
    );
  });

  it('3. reads a URL with CORS, no credentials, no cache and no referrer', async () => {
    stubDom({ width: 320, height: 96 });
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(sized(64, 'image/png'), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const image = await loadIconImage({ url: '/seed-logos/rede-demo.png' });

    expect(image.width).toBe(320);
    expect(fetchSpy).toHaveBeenCalledWith('/seed-logos/rede-demo.png', {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  });

  it('3. a source over 15 MiB is tooLarge, and an image the browser cannot read is decode', async () => {
    stubDom({ width: 0, height: 0, decodes: false });
    const big = new File([new Uint8Array(15 * 1024 * 1024 + 1)], 'arte.png', { type: 'image/png' });
    await expect(loadIconImage({ file: big })).rejects.toMatchObject({ code: 'tooLarge' });
    const broken = new File([new Uint8Array(8)], 'arte.png', { type: 'image/png' });
    await expect(loadIconImage({ file: broken })).rejects.toMatchObject({ code: 'decode' });
  });
});

describe('sizedSvg', () => {
  it('scales plain width and height together, keeping the viewBox', () => {
    const out = sizedSvg('<svg width="32px" height="16" viewBox="0 0 64 32"><path/></svg>');
    expect(out).toBe('<svg width="1024" height="512" viewBox="0 0 64 32"><path/></svg>');
  });

  it('adds the viewBox a sized SVG lacks, so the drawing follows the new size', () => {
    expect(sizedSvg("<svg width='48' height='48'><circle r='4'/></svg>")).toBe(
      `<svg width="1024" height="1024" viewBox="0 0 48 48"><circle r='4'/></svg>`,
    );
  });

  it('leaves an SVG with neither as it was, and never touches stroke-width', () => {
    const plain = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    expect(sizedSvg(plain)).toBe(plain);
    expect(sizedSvg('<svg stroke-width="2" width="100%" viewBox="0 0 10 20"><rect/></svg>')).toBe(
      '<svg width="512" height="1024" stroke-width="2" viewBox="0 0 10 20"><rect/></svg>',
    );
  });
});

describe('encodeAppIcon', () => {
  it('4. takes the PNG when it fits', async () => {
    stubDom({ width: 1, height: 1, encode: (type) => sized(1024, type) });
    const blob = await encodeAppIcon(document.createElement('canvas'));
    expect(blob.type).toBe('image/png');
  });

  it('4. falls back to a JPEG when the PNG is too big', async () => {
    const asked: (number | undefined)[] = [];
    stubDom({
      width: 1,
      height: 1,
      encode: (type, quality) => {
        asked.push(quality);
        if (type === 'image/png') return sized(3 * 1024 * 1024, type);
        return sized(quality === 0.92 ? 2.5 * 1024 * 1024 : 900 * 1024, type);
      },
    });
    const blob = await encodeAppIcon(document.createElement('canvas'));
    expect(blob.type).toBe('image/jpeg');
    expect(blob.size).toBe(900 * 1024);
    expect(asked).toEqual([undefined, 0.92, 0.85]);
  });

  it('4. says size when nothing fits', async () => {
    stubDom({ width: 1, height: 1, encode: (type) => sized(3 * 1024 * 1024, type) });
    await expect(encodeAppIcon(document.createElement('canvas'))).rejects.toMatchObject({
      code: 'size',
    });
  });

  it('4. never counts a PNG answered for a JPEG', async () => {
    stubDom({
      width: 1,
      height: 1,
      encode: (type) => sized(type === 'image/png' ? 4 * 1024 * 1024 : 10, 'image/png'),
    });
    await expect(encodeAppIcon(document.createElement('canvas'))).rejects.toMatchObject({
      code: 'size',
    });
  });
});

describe('composeAppIconFile', () => {
  it('5. draws the art on a 1024 square, ground first, and returns the PNG the upload sends', async () => {
    const { canvases } = stubDom({ width: 1600, height: 900 });
    const art = new File([new Uint8Array(32)], 'arte.jpg', { type: 'image/jpeg' });

    const file = await composeAppIconFile({
      settings: { ...DEFAULT_APP_ICON_SETTINGS, mode: 'art', art },
      primary: '#7C3AED',
      logo: null,
    });

    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe('image/png');
    expect(file.name).toBe('icone-do-app.png');
    // The art's own raster first, then the icon: 1024 × 1024, the ground over it all, then the art.
    const icon = canvases.at(-1);
    expect([icon?.width, icon?.height]).toEqual([1024, 1024]);
    expect(icon?.drawn[0]).toEqual(['fillRect', 0, 0, 1024, 1024]);
    expect(icon?.drawn[1]?.[0]).toBe('drawImage');
  });

  it('5. refuses to compose without what the mode draws', async () => {
    stubDom({ width: 10, height: 10 });
    await expect(
      composeAppIconFile({ settings: DEFAULT_APP_ICON_SETTINGS, primary: '#7c3aed', logo: null }),
    ).rejects.toThrow();
  });
});
