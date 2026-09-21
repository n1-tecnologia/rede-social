import sharp from 'sharp';
import { MEDIA_MAX_INPUT_PIXELS } from './limits';

/**
 * WebP ladder derivation (MEDIA-02). Pure sharp: no database, no env, no Storage — this runs ONLY
 * in the `ROLE=worker` process through `kernel.media-derive-variants`, never in the request path
 * (T-03-04, the 02-13 prohibition). Every `sharp()` carries `limitInputPixels`.
 *
 * Supabase's image transformations are a Pro-plan feature and the pilot is on Free, so the ladder is
 * produced here once and stored under immutable keys rather than rendered per request.
 */

export type MediaVariant = { width: number; body: Buffer };

/**
 * One decoded base, cloned per width. `.rotate()` applies EXIF orientation server-side — the second
 * line of defence behind the browser re-encode, so a portrait phone photo is never stored sideways.
 * `withoutEnlargement` clamps a width above the source, so a 900 px original asked for 1080 yields a
 * 900 px WebP rather than an upscaled blur.
 */
export async function deriveVariants(
  buf: Buffer,
  widths: readonly number[],
): Promise<MediaVariant[]> {
  const base = sharp(buf, { limitInputPixels: MEDIA_MAX_INPUT_PIXELS }).rotate();
  const out: MediaVariant[] = [];
  for (const width of widths) {
    const body = await base
      .clone()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    out.push({ width, body });
  }
  return out;
}

/**
 * A JPEG re-encode of `input` at its natural size, EXIF orientation applied. The server-side twin of
 * R-12's browser re-encode, and the helper the api integration suite builds its upload fixtures with:
 * that package has no `sharp` dependency and must not gain one (the 02-13 `deriveIconSet` /
 * `readPixel` precedent).
 */
export async function encodeJpeg(input: Buffer, quality = 80): Promise<Buffer> {
  return sharp(input, { limitInputPixels: MEDIA_MAX_INPUT_PIXELS })
    .rotate()
    .jpeg({ quality })
    .toBuffer();
}

export type ProbedSize = { width: number; height: number; format: string };

/** Dimensions + decoded format of a buffer — the helper the unit and integration tests probe with. */
export async function probeSize(buf: Buffer): Promise<ProbedSize> {
  const metadata = await sharp(buf, { limitInputPixels: MEDIA_MAX_INPUT_PIXELS }).metadata();
  return {
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    format: metadata.format ?? '',
  };
}
