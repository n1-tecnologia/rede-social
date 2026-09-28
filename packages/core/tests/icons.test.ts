import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  BrandingImageError,
  deriveIconSet,
  inspectBrandingImage,
  readPixel,
} from '../server/branding/icons';
import {
  assertTenantKey,
  brandingObjectKey,
  buildUploadId,
  iconObjectKeys,
  objectKeyFromPublicUrl,
  parseUploadId,
  svgLooksUnsafe,
} from '../server/branding/upload';

/**
 * D-28 derivation maths and the D-27 key/id helpers (RESEARCH validation map, PWA-01 row): sizes,
 * the maskable icon's primary background and 80 % safe zone, the ICO header, the header-only
 * inspection rejections and the tenant-prefix guards. Pure: no env, no Storage, no platform lane.
 * One derived set per fixture is reused across assertions to keep the file well under 10 s.
 */

const PRIMARY = '#7c3aed';
const PRIMARY_RGB = { r: 124, g: 58, b: 237, a: 255 };
const RED = { r: 255, g: 0, b: 0, a: 255 };
const UUID = '0a1b2c3d-4e5f-4a6b-8c7d-9e8f7a6b5c4d';
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const ORIGIN = 'http://127.0.0.1:54321';

/** A 300×120 wordmark whose pixels are all the same amber (text is drawn in the same colour). */
const WORDMARK_SVG = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120" viewBox="0 0 300 120"><rect width="300" height="120" fill="#f59e0b"/><text x="20" y="80" font-size="56" fill="#f59e0b">Rede Social</text></svg>`,
);
const AMBER = { r: 245, g: 158, b: 11, a: 255 };

async function solidSquarePng(size: number, color: { r: number; g: number; b: number }) {
  return sharp({
    create: { width: size, height: size, channels: 4, background: { ...color, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

describe('deriveIconSet — sizes, maskable background and safe zone, favicon container', () => {
  it('derives 192, 512, 180 and maskable 512 PNGs from an SVG wordmark', async () => {
    const set = await deriveIconSet(WORDMARK_SVG, { primaryHex: PRIMARY, mime: 'image/svg+xml' });
    expect(await inspectBrandingImage(set.i192, 'image/png')).toEqual({
      format: 'png',
      width: 192,
      height: 192,
    });
    expect(await inspectBrandingImage(set.i512, 'image/png')).toEqual({
      format: 'png',
      width: 512,
      height: 512,
    });
    expect(await inspectBrandingImage(set.apple180, 'image/png')).toEqual({
      format: 'png',
      width: 180,
      height: 180,
    });
    expect(await inspectBrandingImage(set.maskable512, 'image/png')).toEqual({
      format: 'png',
      width: 512,
      height: 512,
    });
  });

  it('paints the maskable corners with the primary colour and keeps the logo in the centre', async () => {
    const set = await deriveIconSet(WORDMARK_SVG, { primaryHex: PRIMARY, mime: 'image/svg+xml' });
    expect(await readPixel(set.maskable512, 2, 2)).toEqual(PRIMARY_RGB);
    expect(await readPixel(set.maskable512, 509, 509)).toEqual(PRIMARY_RGB);
    expect(await readPixel(set.maskable512, 256, 256)).toEqual(AMBER);
  });

  it('keeps a fully opaque square logo inside the 80 % safe zone of the maskable icon', async () => {
    const square = await solidSquarePng(400, { r: 255, g: 0, b: 0 });
    const set = await deriveIconSet(square, { primaryHex: PRIMARY, mime: 'image/png' });
    // The logo box is 410 px wide inside 512: ≥ 51 px of primary-coloured margin on every side.
    expect(await readPixel(set.maskable512, 40, 256)).toEqual(PRIMARY_RGB);
    expect(await readPixel(set.maskable512, 256, 40)).toEqual(PRIMARY_RGB);
    expect(await readPixel(set.maskable512, 256, 256)).toEqual(RED);
  });

  it('renders the plain icons with a transparent contain fit (no background)', async () => {
    const square = await solidSquarePng(400, { r: 255, g: 0, b: 0 });
    const set = await deriveIconSet(square, { primaryHex: PRIMARY, mime: 'image/png' });
    expect(await readPixel(set.i512, 256, 256)).toEqual(RED);
    // A square fills the whole 512 box, so probe the corner of a non-square input instead.
    const wide = await deriveIconSet(WORDMARK_SVG, { primaryHex: PRIMARY, mime: 'image/svg+xml' });
    expect((await readPixel(wide.i512, 2, 2)).a).toBe(0);
    expect(await readPixel(wide.i512, 256, 256)).toEqual(AMBER);
  });

  it('packs the favicon as an ICO with two frames', async () => {
    const set = await deriveIconSet(WORDMARK_SVG, { primaryHex: PRIMARY, mime: 'image/svg+xml' });
    expect([...set.favicon.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
    expect(set.favicon[4]).toBe(2);
  });

  it('derives from a JPEG input without throwing', async () => {
    const jpeg = await sharp({
      create: { width: 300, height: 200, channels: 3, background: '#0f766e' },
    })
      .jpeg()
      .toBuffer();
    const set = await deriveIconSet(jpeg, { primaryHex: PRIMARY, mime: 'image/jpeg' });
    expect(await inspectBrandingImage(set.i512, 'image/png')).toMatchObject({
      width: 512,
      height: 512,
    });
  });
});

describe('inspectBrandingImage — header-only rejections', () => {
  const reasonOf = async (buf: Buffer, mime: string) => {
    try {
      await inspectBrandingImage(buf, mime);
    } catch (error) {
      expect(error).toBeInstanceOf(BrandingImageError);
      return (error as BrandingImageError).reason;
    }
    return 'accepted';
  };

  it('refuses bytes that are not an image', async () => {
    expect(await reasonOf(Buffer.from('<html>hi</html>'), 'image/png')).toBe('not_an_image');
  });

  it('refuses a format that does not match the declared mime', async () => {
    const png = await solidSquarePng(10, { r: 1, g: 2, b: 3 });
    expect(await reasonOf(png, 'image/jpeg')).toBe('format_mismatch');
    expect(await reasonOf(WORDMARK_SVG, 'image/png')).toBe('format_mismatch');
  });

  it('refuses SVGs with script, event handlers, javascript: urls or foreignObject', async () => {
    expect(await reasonOf(Buffer.from('<svg><script>1</script></svg>'), 'image/svg+xml')).toBe(
      'svg_unsafe',
    );
    expect(await reasonOf(Buffer.from('<svg onload="x()"></svg>'), 'image/svg+xml')).toBe(
      'svg_unsafe',
    );
    expect(
      await reasonOf(Buffer.from('<svg><a href="javascript:alert(1)"/></svg>'), 'image/svg+xml'),
    ).toBe('svg_unsafe');
    expect(await reasonOf(Buffer.from('<svg><foreignObject/></svg>'), 'image/svg+xml')).toBe(
      'svg_unsafe',
    );
    expect(await reasonOf(WORDMARK_SVG, 'image/svg+xml')).toBe('accepted');
  });

  it('refuses a side above 4096 px', async () => {
    const wide = await sharp({
      create: { width: 5000, height: 10, channels: 4, background: '#000000' },
    })
      .png()
      .toBuffer();
    expect(await reasonOf(wide, 'image/png')).toBe('too_large');
  });
});

describe('upload helpers — ids, keys and the tenant-prefix guard', () => {
  it('parseUploadId round-trips a built id and refuses foreign shapes', () => {
    const id = buildUploadId('logo', 'png');
    expect(parseUploadId(id)).toMatchObject({ kind: 'logo', ext: 'png', mime: 'image/png' });
    expect(parseUploadId(`logo-${UUID}.png`)).toEqual({
      kind: 'logo',
      uuid: UUID,
      ext: 'png',
      mime: 'image/png',
    });
    expect(parseUploadId(`icon-${UUID}.webp`)?.mime).toBe('image/webp');
    expect(parseUploadId('../x')).toBeNull();
    expect(parseUploadId(`logo-${UUID}.gif`)).toBeNull();
    expect(parseUploadId(`avatar-${UUID}.png`)).toBeNull();
  });

  it('builds keys under <tenant>/branding/ and the versioned icons folder', () => {
    expect(brandingObjectKey(TENANT_A, UUID, 'svg')).toBe(`${TENANT_A}/branding/${UUID}.svg`);
    const keys = iconObjectKeys(TENANT_A, 3);
    expect(keys.favicon).toBe(`${TENANT_A}/branding/icons/3/favicon.ico`);
    expect(keys.i192).toBe(`${TENANT_A}/branding/icons/3/icon-192.png`);
    expect(keys.i512).toBe(`${TENANT_A}/branding/icons/3/icon-512.png`);
    expect(keys.maskable512).toBe(`${TENANT_A}/branding/icons/3/maskable-512.png`);
    expect(keys.apple180).toBe(`${TENANT_A}/branding/icons/3/apple-touch-icon-180.png`);
  });

  it('assertTenantKey passes the own prefix and throws on other tenants or traversal', () => {
    expect(() => assertTenantKey(`${TENANT_A}/branding/x.png`, TENANT_A)).not.toThrow();
    expect(() => assertTenantKey(`${TENANT_B}/branding/x.png`, TENANT_A)).toThrow();
    expect(() => assertTenantKey(`${TENANT_A}/branding/../x`, TENANT_A)).toThrow();
    expect(() => assertTenantKey(`${TENANT_A}/branding//x`, TENANT_A)).toThrow();
    expect(() => assertTenantKey(`${TENANT_A}/media/x.png`, TENANT_A)).toThrow();
  });

  it('objectKeyFromPublicUrl answers the key for own public URLs only', () => {
    const key = `${TENANT_A}/branding/x.png`;
    expect(
      objectKeyFromPublicUrl(
        `${ORIGIN}/storage/v1/object/public/branding/${key}`,
        TENANT_A,
        ORIGIN,
      ),
    ).toBe(key);
    expect(objectKeyFromPublicUrl('/seed-logos/x.svg', TENANT_A, ORIGIN)).toBeNull();
    expect(
      objectKeyFromPublicUrl(
        `${ORIGIN}/storage/v1/object/public/branding/${TENANT_B}/branding/x.png`,
        TENANT_A,
        ORIGIN,
      ),
    ).toBeNull();
    expect(
      objectKeyFromPublicUrl(
        `https://evil.example/storage/v1/object/public/branding/${key}`,
        TENANT_A,
        ORIGIN,
      ),
    ).toBeNull();
    expect(
      objectKeyFromPublicUrl(`${ORIGIN}/storage/v1/object/public/media/${key}`, TENANT_A, ORIGIN),
    ).toBeNull();
    expect(objectKeyFromPublicUrl(null, TENANT_A, ORIGIN)).toBeNull();
  });

  it('svgLooksUnsafe flags external and data:text references, not plain markup', () => {
    expect(svgLooksUnsafe('<svg><image href="https://x/y.png"/></svg>')).toBe(true);
    expect(svgLooksUnsafe('<svg><image xlink:href="data:text/html,x"/></svg>')).toBe(true);
    expect(svgLooksUnsafe('<svg><rect fill="#000"/></svg>')).toBe(false);
  });
});
