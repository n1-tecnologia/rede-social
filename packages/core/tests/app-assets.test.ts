import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  AppAssetError,
  deriveAdaptiveForeground,
  deriveNotificationIcon,
  deriveSplash,
  deriveStoreIcon,
  wrapName,
} from '../server/branding/app-assets';
import { BrandingImageError, MASKABLE_SAFE_ZONE, readPixel } from '../server/branding/icons';

/**
 * Native app assets (Phase 13, D-607, UI-D-602): every image is proven by DECODING the output and
 * measuring it (size, alpha channel, a pixel, a bounding box). No binary fixture is committed: logos are
 * generated here with sharp. Pure: no env, no Storage, no platform lane.
 */

const PRIMARY = '#1d4ed8';
const PRIMARY_RGB = { r: 29, g: 78, b: 216, a: 255 };

type Box = { left: number; top: number; right: number; bottom: number };

/** A `w`x`h` fully transparent PNG with an opaque `colour` rectangle of `rw`x`rh` in the middle. */
async function transparentLogo(
  w: number,
  h: number,
  rw: number,
  rh: number,
  colour = { r: 220, g: 38, b: 38 },
): Promise<Buffer> {
  const rect = await sharp({
    create: { width: rw, height: rh, channels: 4, background: { ...colour, alpha: 1 } },
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: rect, gravity: 'centre' }])
    .png()
    .toBuffer();
}

/** An opaque white square with a red block: a logo that ships with a solid background. */
async function opaqueWhiteLogo(size: number): Promise<Buffer> {
  const block = await sharp({
    create: { width: size / 2, height: size / 2, channels: 3, background: '#dc2626' },
  })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background: '#ffffff' } })
    .composite([{ input: block, gravity: 'centre' }])
    .png()
    .toBuffer();
}

/** The bounding box of every pixel for which `visible` answers true. */
async function boundingBox(
  png: Buffer,
  visible: (r: number, g: number, b: number, a: number) => boolean,
): Promise<{ box: Box | null; width: number; height: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * 4;
      if (visible(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0)) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  return {
    box: right < 0 ? null : { left, top, right, bottom },
    width: info.width,
    height: info.height,
  };
}

const differsFromPrimary = (r: number, g: number, b: number) =>
  r !== PRIMARY_RGB.r || g !== PRIMARY_RGB.g || b !== PRIMARY_RGB.b;

describe('deriveStoreIcon — App Store 1024 and Google Play 512 (D-607)', () => {
  it('derives a 1024 opaque icon on the primary colour with the logo inside the 80 % safe zone', async () => {
    const logo = await transparentLogo(600, 300, 400, 200);
    const { appStore1024, play512 } = await deriveStoreIcon(logo, { primary: PRIMARY });

    const meta = await sharp(appStore1024).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 1024, 1024]);
    expect(meta.hasAlpha).toBe(false);

    expect(await readPixel(appStore1024, 0, 0)).toEqual(PRIMARY_RGB);
    expect(await readPixel(appStore1024, 1023, 1023)).toEqual(PRIMARY_RGB);
    const centre = await readPixel(appStore1024, 512, 512);
    expect([centre.r, centre.g, centre.b]).not.toEqual([
      PRIMARY_RGB.r,
      PRIMARY_RGB.g,
      PRIMARY_RGB.b,
    ]);

    const { box } = await boundingBox(appStore1024, differsFromPrimary);
    expect(box).not.toBeNull();
    const margin = Math.round((1024 * (1 - MASKABLE_SAFE_ZONE)) / 2);
    expect(box?.left).toBeGreaterThanOrEqual(margin - 1);
    expect(box?.top).toBeGreaterThanOrEqual(margin - 1);
    expect(box?.right).toBeLessThanOrEqual(1023 - margin + 1);
    expect(box?.bottom).toBeLessThanOrEqual(1023 - margin + 1);

    const play = await sharp(play512).metadata();
    expect([play.format, play.width, play.height]).toEqual(['png', 512, 512]);
  });

  it('keeps the icon opaque for a logo that ships with an opaque white background', async () => {
    const { appStore1024 } = await deriveStoreIcon(await opaqueWhiteLogo(400), {
      primary: PRIMARY,
    });
    expect((await sharp(appStore1024).metadata()).hasAlpha).toBe(false);
    expect(await readPixel(appStore1024, 4, 4)).toEqual(PRIMARY_RGB);
    expect(await readPixel(appStore1024, 512, 512)).toMatchObject({ r: 220, g: 38, b: 38 });
    // The white box of the logo itself is visible between the red block and the primary margin.
    expect(await readPixel(appStore1024, 512, 150)).toMatchObject({ r: 255, g: 255, b: 255 });
  });

  it('rasterises an SVG logo at the existing SVG target (a crisp edge, not an upscaled 72 dpi blur)', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#dc2626"/></svg>',
    );
    const { appStore1024 } = await deriveStoreIcon(svg, { primary: PRIMARY });
    expect(await readPixel(appStore1024, 512, 512)).toMatchObject({ r: 220, g: 38, b: 38 });
    // Just inside and just outside the 819 px logo square (102..921): no blended edge pixels.
    expect(await readPixel(appStore1024, 110, 512)).toMatchObject({ r: 220, g: 38, b: 38 });
    expect(await readPixel(appStore1024, 96, 512)).toEqual(PRIMARY_RGB);
  });

  it('refuses a 5000x5000 input and a 5000-px side from the header before decoding them', async () => {
    const bomb = await sharp({
      create: { width: 5000, height: 5000, channels: 3, background: '#000000' },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    // 25 M pixels is above `limitInputPixels`: the header decode itself refuses it.
    await expect(deriveStoreIcon(bomb, { primary: PRIMARY })).rejects.toBeInstanceOf(
      BrandingImageError,
    );
    const wide = await sharp({
      create: { width: 5000, height: 10, channels: 3, background: '#000000' },
    })
      .png()
      .toBuffer();
    await expect(deriveStoreIcon(wide, { primary: PRIMARY })).rejects.toMatchObject({
      name: 'BrandingImageError',
      reason: 'too_large',
    });
  });

  it('refuses an unsafe SVG and bytes that are not an image', async () => {
    await expect(
      deriveStoreIcon(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'),
        {
          primary: PRIMARY,
        },
      ),
    ).rejects.toMatchObject({ reason: 'svg_unsafe' });
    await expect(
      deriveStoreIcon(Buffer.from('<html>hi</html>'), { primary: PRIMARY }),
    ).rejects.toBeInstanceOf(BrandingImageError);
  });

  it('throws a typed error for a malformed colour and renders nothing', async () => {
    const logo = await transparentLogo(100, 100, 50, 50);
    for (const bad of ['blue', '#12345', '#gggggg', '1d4ed8', '']) {
      await expect(deriveStoreIcon(logo, { primary: bad })).rejects.toBeInstanceOf(AppAssetError);
      await expect(deriveStoreIcon(logo, { primary: bad })).rejects.toMatchObject({
        reason: 'bad_color',
      });
    }
  });

  it('is deterministic: two runs give byte-equal PNGs', async () => {
    const logo = await transparentLogo(600, 300, 400, 200);
    const a = await deriveStoreIcon(logo, { primary: PRIMARY });
    const b = await deriveStoreIcon(logo, { primary: PRIMARY });
    expect(a.appStore1024.equals(b.appStore1024)).toBe(true);
    expect(a.play512.equals(b.play512)).toBe(true);
  });
});

const ON_PRIMARY = '#ffffff';
const ON_PRIMARY_RGB = { r: 255, g: 255, b: 255 };

describe('wrapName — at most three lines, whole characters (UI-D-602, E01 long-text)', () => {
  it('returns one line for a short name', () => {
    expect(wrapName('Comunidade Ana')).toEqual(['Comunidade Ana']);
    expect(wrapName('Comunidade Alfa')).toEqual(['Comunidade', 'Alfa']);
    expect(wrapName('Rede')).toEqual(['Rede']);
  });

  it('returns at most three lines for a 120-character name and ends with an ellipsis', () => {
    const name = Array.from({ length: 20 }, (_, i) => `palavra${i}`)
      .join(' ')
      .slice(0, 120);
    expect(name.length).toBe(120);
    const lines = wrapName(name);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(Array.from(line).length).toBeLessThanOrEqual(14);
    expect(lines.at(-1)?.endsWith('…')).toBe(true);
  });

  it('breaks a word longer than a line and never splits an emoji or an accented letter', () => {
    const lines = wrapName(`Coração👩‍👩‍👧‍👦Comunidade${'ção'.repeat(12)}`, 3, 8);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines.join('')).toContain('👩‍👩‍👧‍👦');
    for (const line of lines) {
      expect(line).not.toMatch(/\p{Cs}/u);
      expect(
        Array.from(new Intl.Segmenter('pt', { granularity: 'grapheme' }).segment(line)).length,
      ).toBeLessThanOrEqual(8);
    }
    // A decomposed accent (letter + combining mark) is composed and never left alone at a line start.
    const decomposed = wrapName('Educac\u0327a\u0303o em Grupo', 3, 6);
    expect(decomposed.join('')).toContain('Educação');
    for (const line of decomposed) expect(line).not.toMatch(/^\p{M}/u);
  });

  it('returns no line for a blank name', () => {
    expect(wrapName('   ')).toEqual([]);
  });
});

describe('deriveSplash — primary background, logo or name (UI-D-602)', () => {
  it('centres the logo within one third of the short side and the 80 % safe zone', async () => {
    const logo = await transparentLogo(600, 300, 400, 200);
    const { png, mode } = await deriveSplash(logo, {
      primary: PRIMARY,
      onPrimary: ON_PRIMARY,
      displayName: 'Comunidade Alfa',
    });
    expect(mode).toBe('logo');
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([1024, 1024, false]);
    expect(await readPixel(png, 0, 0)).toEqual(PRIMARY_RGB);
    expect(await readPixel(png, 1023, 1023)).toEqual(PRIMARY_RGB);
    const { box } = await boundingBox(png, differsFromPrimary);
    expect(box).not.toBeNull();
    if (!box) return;
    const third = 1024 / 3;
    const width = box.right - box.left + 1;
    const height = box.bottom - box.top + 1;
    expect(Math.max(width, height)).toBeLessThanOrEqual(third + 2);
    expect(Math.max(width, height)).toBeGreaterThan(third * 0.5);
    const zone = Math.round((1024 * (1 - MASKABLE_SAFE_ZONE)) / 2);
    expect(box.left).toBeGreaterThanOrEqual(zone);
    expect(box.right).toBeLessThanOrEqual(1023 - zone);
    expect(Math.abs((box.left + box.right + 1) / 2 - 512)).toBeLessThanOrEqual(2);
    expect(Math.abs((box.top + box.bottom + 1) / 2 - 512)).toBeLessThanOrEqual(2);
  });

  it('shows the display name in onPrimary on the primary colour when there is no logo', async () => {
    const { png, mode } = await deriveSplash(null, {
      primary: PRIMARY,
      onPrimary: ON_PRIMARY,
      displayName: 'Comunidade Alfa',
    });
    expect(mode).toBe('name');
    expect(await readPixel(png, 0, 0)).toEqual(PRIMARY_RGB);
    const { box } = await boundingBox(
      png,
      (r, g, b) => r === ON_PRIMARY_RGB.r && g === ON_PRIMARY_RGB.g && b === ON_PRIMARY_RGB.b,
    );
    expect(box).not.toBeNull();
    if (!box) return;
    // Some onPrimary pixels sit near the centre, and nothing leaves the safe zone.
    expect(Math.abs((box.left + box.right + 1) / 2 - 512)).toBeLessThanOrEqual(24);
    expect(Math.abs((box.top + box.bottom + 1) / 2 - 512)).toBeLessThanOrEqual(24);
    const zone = Math.round((1024 * (1 - MASKABLE_SAFE_ZONE)) / 2);
    expect(box.left).toBeGreaterThanOrEqual(zone);
    expect(box.right).toBeLessThanOrEqual(1023 - zone);
  });

  it('escapes a display name with markup and still renders it', async () => {
    const { png, mode } = await deriveSplash(null, {
      primary: PRIMARY,
      onPrimary: ON_PRIMARY,
      displayName: 'Marca & <Co> "Teste"',
    });
    expect(mode).toBe('name');
    const { box } = await boundingBox(
      png,
      (r, g, b) => r === ON_PRIMARY_RGB.r && g === ON_PRIMARY_RGB.g && b === ON_PRIMARY_RGB.b,
    );
    expect(box).not.toBeNull();
  });

  it('refuses a malformed colour and a blank name with a typed error', async () => {
    await expect(
      deriveSplash(null, { primary: 'blue', onPrimary: ON_PRIMARY, displayName: 'X' }),
    ).rejects.toMatchObject({ reason: 'bad_color' });
    await expect(
      deriveSplash(null, { primary: PRIMARY, onPrimary: '#fff', displayName: 'X' }),
    ).rejects.toMatchObject({ reason: 'bad_color' });
    await expect(
      deriveSplash(null, { primary: PRIMARY, onPrimary: ON_PRIMARY, displayName: '   ' }),
    ).rejects.toMatchObject({ reason: 'bad_name' });
  });
});

describe('deriveAdaptiveForeground — transparent 1024 with the logo in the central 66 %', () => {
  it('has an alpha channel, transparent corners and the logo inside the adaptive safe zone', async () => {
    const logo = await transparentLogo(600, 300, 400, 200);
    const png = await deriveAdaptiveForeground(logo);
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([1024, 1024, true]);
    for (const [x, y] of [
      [0, 0],
      [1023, 0],
      [0, 1023],
      [1023, 1023],
    ] as [number, number][]) {
      expect((await readPixel(png, x, y)).a).toBe(0);
    }
    expect(await readPixel(png, 512, 512)).toMatchObject({ r: 220, g: 38, b: 38, a: 255 });
    const { box } = await boundingBox(png, (_r, _g, _b, a) => a > 0);
    expect(box).not.toBeNull();
    if (!box) return;
    const margin = Math.round((1024 * (1 - 0.66)) / 2);
    expect(box.left).toBeGreaterThanOrEqual(margin - 1);
    expect(box.top).toBeGreaterThanOrEqual(margin - 1);
    expect(box.right).toBeLessThanOrEqual(1023 - margin + 1);
    expect(box.bottom).toBeLessThanOrEqual(1023 - margin + 1);
  });
});

describe('deriveNotificationIcon — white silhouette from the logo alpha (96x96)', () => {
  it('turns a transparent logo into white pixels carrying the logo alpha', async () => {
    const logo = await transparentLogo(600, 300, 400, 200);
    const { png, quality } = await deriveNotificationIcon(logo);
    expect(quality).toBe('ok');
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([96, 96, true]);
    const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let visible = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i + 3] ?? 0) > 0) {
        visible += 1;
        expect([data[i], data[i + 1], data[i + 2]]).toEqual([255, 255, 255]);
      }
    }
    expect(visible).toBeGreaterThan(0);
    expect((await readPixel(png, 0, 0)).a).toBe(0);
    expect(await readPixel(png, 48, 48)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });

  it('falls back to a white disc and says so for a fully opaque logo', async () => {
    const { png, quality } = await deriveNotificationIcon(await opaqueWhiteLogo(400));
    expect(quality).toBe('fallback');
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([96, 96]);
    expect(await readPixel(png, 48, 48)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    // A disc, not a square: the corner is transparent.
    expect((await readPixel(png, 1, 1)).a).toBe(0);
  });
});

describe('every asset — deterministic and guarded like the store icon (T-13-28)', () => {
  it('gives byte-equal PNGs on two runs', async () => {
    const logo = await transparentLogo(600, 300, 400, 200);
    const opts = { primary: PRIMARY, onPrimary: ON_PRIMARY, displayName: 'Comunidade Alfa' };
    expect((await deriveSplash(logo, opts)).png.equals((await deriveSplash(logo, opts)).png)).toBe(
      true,
    );
    expect((await deriveSplash(null, opts)).png.equals((await deriveSplash(null, opts)).png)).toBe(
      true,
    );
    expect(
      (await deriveAdaptiveForeground(logo)).equals(await deriveAdaptiveForeground(logo)),
    ).toBe(true);
    expect(
      (await deriveNotificationIcon(logo)).png.equals((await deriveNotificationIcon(logo)).png),
    ).toBe(true);
  });

  it('rejects an oversized image, an unsafe SVG and non-image bytes in every function', async () => {
    const wide = await sharp({
      create: { width: 5000, height: 10, channels: 3, background: '#000000' },
    })
      .png()
      .toBuffer();
    const unsafe = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
    const junk = Buffer.from('<html>hi</html>');
    const opts = { primary: PRIMARY, onPrimary: ON_PRIMARY, displayName: 'Comunidade Alfa' };
    for (const bad of [wide, unsafe, junk]) {
      await expect(deriveSplash(bad, opts)).rejects.toBeInstanceOf(BrandingImageError);
      await expect(deriveAdaptiveForeground(bad)).rejects.toBeInstanceOf(BrandingImageError);
      await expect(deriveNotificationIcon(bad)).rejects.toBeInstanceOf(BrandingImageError);
    }
  });
});
