import pngToIco from 'png-to-ico';
import sharp, { type Metadata, type Sharp, type SharpOptions } from 'sharp';
import { svgLooksUnsafe } from './upload';

/**
 * Icon derivation (D-28, CLAUDE.md "sharp for branding assets only"). Pure sharp + png-to-ico: no
 * database, no env, no Storage — the worker's `kernel.branding-derive-icons` job and the seed call
 * `deriveIconSet`, the request path calls only `inspectBrandingImage` (header decode) and never
 * derives (prohibition: derivation runs off the request path).
 *
 * Every `sharp()` here carries `limitInputPixels` (T-02-80): a decompression bomb dies at the
 * decoder, and `inspectBrandingImage` refuses any side above `MAX_INPUT_SIDE` from the header alone.
 */

export const ICON_SIZES = { i192: 192, i512: 512, apple180: 180, maskable512: 512 } as const;
export const FAVICON_SIZES = [32, 48] as const;
/** Maskable icons: the logo sits in the central 80 % (the safe zone) over the tenant's primary colour. */
export const MASKABLE_SAFE_ZONE = 0.8;
export const MAX_INPUT_SIDE = 4096;
export const MAX_INPUT_PIXELS = MAX_INPUT_SIDE * MAX_INPUT_SIDE;
/** SVGs are rasterised so their longer side is at least this many px — no 512 output is upscaled from 72 dpi. */
export const SVG_RASTER_TARGET = 1024;
const MAX_SVG_DENSITY = 2400;

export type BrandingImageReason = 'not_an_image' | 'format_mismatch' | 'svg_unsafe' | 'too_large';

export class BrandingImageError extends Error {
  readonly reason: BrandingImageReason;
  constructor(reason: BrandingImageReason, message?: string) {
    super(message ?? `branding image rejected: ${reason}`);
    this.name = 'BrandingImageError';
    this.reason = reason;
  }
}

export type BrandingImageInfo = { format: string; width: number; height: number };

const MIME_TO_FORMAT: Record<string, string> = {
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/jpeg': 'jpeg',
};

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 } as const;

/**
 * Header-only inspection: the format must match the declared mime, the dimensions must be sane and
 * an SVG must pass the textual safety scan. Throws `BrandingImageError` with the `details.upload`
 * reason the API answers (T-02-81, T-02-82).
 */
export async function inspectBrandingImage(
  buf: Buffer,
  declaredMime: string,
): Promise<BrandingImageInfo> {
  if (declaredMime === 'image/svg+xml' && svgLooksUnsafe(buf.toString('utf8'))) {
    throw new BrandingImageError('svg_unsafe');
  }
  let metadata: Metadata;
  try {
    metadata = await sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new BrandingImageError('not_an_image');
  }
  const format = metadata.format ?? '';
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!format || width <= 0 || height <= 0) throw new BrandingImageError('not_an_image');
  const expected = MIME_TO_FORMAT[declaredMime];
  if (!expected || format !== expected) throw new BrandingImageError('format_mismatch');
  if (width > MAX_INPUT_SIDE || height > MAX_INPUT_SIDE) throw new BrandingImageError('too_large');
  return { format, width, height };
}

export type IconSet = {
  favicon: Buffer;
  i192: Buffer;
  i512: Buffer;
  maskable512: Buffer;
  apple180: Buffer;
};

export type DeriveIconSetOptions = {
  /** The tenant's primary colour — the maskable icon's background (`#rrggbb`). */
  primaryHex: string;
  /** Declared mime of `input`; SVGs are rasterised at a density that avoids upscaling. */
  mime: string;
};

/** The base pipeline: an SVG gets a density so its longer side rasterises to ≥ SVG_RASTER_TARGET px. */
async function basePipeline(input: Buffer, mime: string): Promise<Sharp> {
  const options: SharpOptions = { limitInputPixels: MAX_INPUT_PIXELS };
  if (mime === 'image/svg+xml') {
    const meta = await sharp(input, options).metadata();
    const longest = Math.max(meta.width ?? 0, meta.height ?? 0);
    if (longest > 0) {
      options.density = Math.min(MAX_SVG_DENSITY, Math.ceil((72 * SVG_RASTER_TARGET) / longest));
    }
  }
  return sharp(input, options);
}

/**
 * favicon.ico (32 + 48), icon-192, icon-512, maskable-512 (logo centred in the 80 % safe zone over
 * `primaryHex`) and apple-touch-icon-180 — the D-28 set, every PNG a transparent `contain` fit.
 */
export async function deriveIconSet(input: Buffer, opts: DeriveIconSetOptions): Promise<IconSet> {
  const base = await basePipeline(input, opts.mime);
  const contain = (size: number): Promise<Buffer> =>
    base.clone().resize(size, size, { fit: 'contain', background: TRANSPARENT }).png().toBuffer();

  const [i192, i512, apple180, png32, png48, safe] = await Promise.all([
    contain(ICON_SIZES.i192),
    contain(ICON_SIZES.i512),
    contain(ICON_SIZES.apple180),
    contain(FAVICON_SIZES[0]),
    contain(FAVICON_SIZES[1]),
    contain(Math.round(ICON_SIZES.maskable512 * MASKABLE_SAFE_ZONE)),
  ]);

  const maskable512 = await sharp({
    create: {
      width: ICON_SIZES.maskable512,
      height: ICON_SIZES.maskable512,
      channels: 4,
      background: opts.primaryHex,
    },
  })
    .composite([{ input: safe, gravity: 'centre' }])
    .png()
    .toBuffer();

  const favicon = await pngToIco([png32, png48]);

  return { favicon, i192, i512, maskable512, apple180 };
}

export type Pixel = { r: number; g: number; b: number; a: number };

/** One RGBA pixel of a PNG — the verification helper the unit and integration tests probe with. */
export async function readPixel(png: Buffer, x: number, y: number): Promise<Pixel> {
  const raw = await sharp(png, { limitInputPixels: MAX_INPUT_PIXELS })
    .extract({ left: x, top: y, width: 1, height: 1 })
    .ensureAlpha()
    .raw()
    .toBuffer();
  return { r: raw[0] ?? 0, g: raw[1] ?? 0, b: raw[2] ?? 0, a: raw[3] ?? 0 };
}
