import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { AppAssetError, deriveStoreIcon } from '../server/branding/app-assets';
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
