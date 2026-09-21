import sharp, { type Metadata } from 'sharp';
import { MEDIA_MAX_INPUT_PIXELS, MEDIA_MAX_INPUT_SIDE } from './limits';

/**
 * Header-only inspection of member-supplied bytes. Pure sharp: no database, no env, no Storage —
 * the request path (`complete`) calls this and NOTHING else that touches the decoder, so derivation
 * (resize, five uploads) stays in the worker (T-03-04, the 02-13 prohibition).
 *
 * Vector input is absent from `MIME_TO_FORMAT` on purpose: unlike the admin-only brand logo path
 * there is no safety-scan escape hatch here, because member photos are jpeg/png/webp only
 * (RESEARCH §Anti-Patterns, T-03-09).
 */

export const MEDIA_IMAGE_REASONS = [
  'not_an_image',
  'format_mismatch',
  'heic_unsupported',
  'too_large',
] as const;
export type MediaImageReason = (typeof MEDIA_IMAGE_REASONS)[number];

export class MediaImageError extends Error {
  readonly reason: MediaImageReason;
  constructor(reason: MediaImageReason, message?: string) {
    super(message ?? `media image rejected: ${reason}`);
    this.name = 'MediaImageError';
    this.reason = reason;
  }
}

export type MediaImageInfo = { format: string; width: number; height: number };

/** Declared mime -> the format sharp must report. No HEIC entry, no vector entry (see the docblock). */
const MIME_TO_FORMAT: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** `%PDF-` — the five magic bytes that make the `file` kind need no decoder and no `file-type` package. */
const PDF_MAGIC = '%PDF-';

/**
 * The decoded truth about `buf`, or `MediaImageError` with the machine code the API answers.
 *
 * ORDER MATTERS (RESEARCH Pitfall 2, VERIFIED against this repo's sharp 0.35.4 / libvips 8.18.6):
 * `heif` is checked FIRST, before the declared-mime comparison, so an iPhone photo always answers
 * `heic_unsupported` and never the generic `format_mismatch`. libvips parses the ISO-BMFF container
 * without the HEVC decoder, so `metadata()` SUCCEEDS on a HEIC while any operation touching pixels
 * dies with `bad seek` — a check that only compared the declared mime would accept the file and let
 * the worker fail after the member was told the upload succeeded.
 */
export async function inspectMediaImage(
  buf: Buffer,
  declaredMime: string,
): Promise<MediaImageInfo> {
  let metadata: Metadata;
  try {
    metadata = await sharp(buf, { limitInputPixels: MEDIA_MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new MediaImageError('not_an_image');
  }
  const format = metadata.format ?? '';
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!format || width <= 0 || height <= 0) throw new MediaImageError('not_an_image');
  if (format === 'heif') throw new MediaImageError('heic_unsupported');
  const expected = MIME_TO_FORMAT[declaredMime];
  if (!expected || format !== expected) throw new MediaImageError('format_mismatch');
  if (width > MEDIA_MAX_INPUT_SIDE || height > MEDIA_MAX_INPUT_SIDE) {
    throw new MediaImageError('too_large');
  }
  return { format, width, height };
}

/** The whole `file`-kind validation: five magic bytes, no decoder, no extra dependency. */
export function inspectPdf(buf: Buffer): void {
  if (buf.subarray(0, PDF_MAGIC.length).toString('latin1') !== PDF_MAGIC) {
    throw new MediaImageError('format_mismatch');
  }
}
