import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  classifyMediaFile,
  MEDIA_PURPOSES,
  mediaAcceptFor,
  PURPOSE_WIDTHS,
  VARIANT_WIDTHS,
} from '@tria/contracts/media';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  inspectMediaImage,
  inspectPdf,
  MEDIA_IMAGE_REASONS,
  MediaImageError,
} from '../server/media/inspect';
import {
  assertTenantKey,
  mediaAssetPrefix,
  mediaKeyFor,
  mediaOriginalKey,
  mediaVariantKey,
  parseVariant,
} from '../server/media/keys';
import {
  limitFor,
  MEDIA_MAX_INPUT_SIDE,
  MediaLimitError,
  widthsForPurpose,
} from '../server/media/limits';
import { deriveVariants, encodeJpeg, probeSize } from '../server/media/variants';

/**
 * The PURE half of the media broker (MEDIA-01/MEDIA-02/TENANT-04): key construction and its
 * traversal guards, the limit table's own invariants, header-only inspection refusals and the WebP
 * ladder maths. No database, no env, no Storage, no service — `service.ts` and `storage.ts` are
 * deliberately never imported here; their behaviour lives in `apps/api/tests/integration/media.test.ts`.
 *
 * One base JPEG is derived once and reused, so the file stays far under the 15 s budget.
 */

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const ASSET = '0a1b2c3d-4e5f-4a6b-8c7d-9e8f7a6b5c4d';

/** A REAL HEVC-compressed HEIC (RESEARCH Pitfall 2): libvips reads its header and dies on its pixels. */
const HEIC = readFileSync(fileURLToPath(new URL('./fixtures/iphone.heic', import.meta.url)));

const PHOTO_SVG = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600"><rect width="900" height="600" fill="#0ea5e9"/><circle cx="450" cy="300" r="180" fill="#f59e0b"/></svg>`,
);

let PHOTO_JPEG: Buffer;
let PHOTO_PNG: Buffer;

beforeAll(async () => {
  PHOTO_JPEG = await encodeJpeg(PHOTO_SVG);
  PHOTO_PNG = await sharp(PHOTO_SVG).png().toBuffer();
});

describe('keys — the whole key space is a pure function of (tenantId, assetId, variant)', () => {
  it('builds the extension-less original and the immutable variant keys', () => {
    expect(mediaAssetPrefix(TENANT_A, ASSET)).toBe(`${TENANT_A}/media/${ASSET}/`);
    expect(mediaOriginalKey(TENANT_A, ASSET)).toBe(`${TENANT_A}/media/${ASSET}/original`);
    expect(mediaVariantKey(TENANT_A, ASSET, 320)).toBe(`${TENANT_A}/media/${ASSET}/w320.webp`);
    expect(mediaKeyFor(TENANT_A, ASSET, 'original')).toBe(mediaOriginalKey(TENANT_A, ASSET));
    expect(mediaKeyFor(TENANT_A, ASSET, 'w128')).toBe(mediaVariantKey(TENANT_A, ASSET, 128));
    expect(mediaKeyFor(TENANT_A, ASSET, 'w321')).toBeNull();
  });

  it('parseVariant accepts only `original` and the declared widths', () => {
    expect(parseVariant('original')).toEqual({ kind: 'original' });
    expect(parseVariant('w320')).toEqual({ kind: 'variant', width: 320 });
    expect(parseVariant('w321')).toBeNull();
    expect(parseVariant('../x')).toBeNull();
    expect(parseVariant('w320.webp')).toBeNull();
    expect(parseVariant('')).toBeNull();
  });

  it('assertTenantKey accepts the tenant own prefix and refuses every escape', () => {
    expect(() => assertTenantKey(`${TENANT_A}/media/${ASSET}/original`, TENANT_A)).not.toThrow();

    // T-03-01: another tenant's prefix — the whole isolation argument in one assertion.
    expect(() => assertTenantKey(`${TENANT_B}/media/${ASSET}/original`, TENANT_A)).toThrow();
    // T-03-02: the three traversal classes a fresh implementation forgets, plus an empty suffix.
    expect(() => assertTenantKey(`${TENANT_A}/media/../${ASSET}`, TENANT_A)).toThrow();
    expect(() => assertTenantKey(`${TENANT_A}/media//x`, TENANT_A)).toThrow();
    expect(() => assertTenantKey(`${TENANT_A}/media/x\\y`, TENANT_A)).toThrow();
    expect(() => assertTenantKey(`${TENANT_A}/media/`, TENANT_A)).toThrow();
    // An empty tenant id would make every key "valid" — refused explicitly.
    expect(() => assertTenantKey(`${TENANT_A}/media/${ASSET}/original`, '')).toThrow();
  });
});

describe('limits — the table invariants the ladder depends on', () => {
  it('every purpose ladder is a sorted subset of VARIANT_WIDTHS', () => {
    for (const purpose of MEDIA_PURPOSES) {
      const ladder = PURPOSE_WIDTHS[purpose];
      expect(ladder.every((w) => (VARIANT_WIDTHS as readonly number[]).includes(w))).toBe(true);
      expect([...ladder]).toEqual([...ladder].sort((a, b) => a - b));
    }
  });

  it('widthsForPurpose clamps to the original and never yields an empty ladder for an image', () => {
    expect(widthsForPurpose('post', 500)).toEqual([320]);
    // A tiny source still produces the smallest entry: a `ready` asset always has something to render.
    expect(widthsForPurpose('post', 40)).toEqual([320]);
    expect(widthsForPurpose('avatar', 5000)).toEqual([128, 320]);
    // An attachment derives nothing at all.
    expect(widthsForPurpose('attachment', 5000)).toEqual([]);
  });

  it('limitFor refuses an unknown (kind, purpose) pair instead of defaulting', () => {
    expect(limitFor('image', 'avatar').maxBytes).toBe(8 * 1024 * 1024);
    expect(() => limitFor('file', 'avatar')).toThrow(MediaLimitError);
    expect(() => limitFor('image', 'attachment')).toThrow(MediaLimitError);
  });

  it('the client-side pick gate agrees with the same table', () => {
    expect(classifyMediaFile({ type: 'image/jpeg', size: 10 }, 'image', 'avatar')).toBeNull();
    expect(classifyMediaFile({ type: 'image/gif', size: 10 }, 'image', 'avatar')).toBe('type');
    expect(classifyMediaFile({ type: 'image/jpeg', size: 9e6 }, 'image', 'avatar')).toBe('size');
    // `heic` is a SIGNAL to re-encode in the browser, not a refusal.
    expect(classifyMediaFile({ type: 'image/heic', size: 10 }, 'image', 'avatar')).toBe('heic');
    expect(mediaAcceptFor('image', 'avatar')).toBe('image/jpeg,image/png,image/webp');
    expect(mediaAcceptFor('file', 'attachment')).toBe('application/pdf');
  });
});

describe('inspect — the bytes are judged, never the declared mime alone (T-03-03/T-03-05)', () => {
  it('non-image bytes answer not_an_image', async () => {
    await expect(inspectMediaImage(Buffer.from('<html>hi</html>'), 'image/jpeg')).rejects.toThrow(
      expect.objectContaining({ reason: 'not_an_image' }),
    );
  });

  it('a PNG declared image/jpeg answers format_mismatch', async () => {
    await expect(inspectMediaImage(PHOTO_PNG, 'image/jpeg')).rejects.toThrow(
      expect.objectContaining({ reason: 'format_mismatch' }),
    );
  });

  it('a real HEVC-compressed HEIC answers heic_unsupported, NOT the generic format_mismatch', async () => {
    // The fixture must really be HEVC-in-HEIF: libvips parses this header and then dies on the
    // pixels (RESEARCH Pitfall 2). If sharp ever gains an HEIF decoder, or the fixture is silently
    // replaced by a re-encoded JPEG/AVIF, these two assertions fail loudly.
    const probe = await sharp(HEIC).metadata();
    expect(probe.format).toBe('heif');
    expect(probe.compression).toBe('hevc');

    await expect(inspectMediaImage(HEIC, 'image/jpeg')).rejects.toThrow(
      expect.objectContaining({ reason: 'heic_unsupported' }),
    );
  });

  it('a side above MEDIA_MAX_INPUT_SIDE answers too_large', async () => {
    const wide = await sharp({
      create: {
        width: MEDIA_MAX_INPUT_SIDE + 808,
        height: 10,
        channels: 3,
        background: '#000000',
      },
    })
      .png()
      .toBuffer();
    await expect(inspectMediaImage(wide, 'image/png')).rejects.toThrow(
      expect.objectContaining({ reason: 'too_large' }),
    );
  });

  it('accepts a well-formed JPEG and reports its decoded size', async () => {
    await expect(inspectMediaImage(PHOTO_JPEG, 'image/jpeg')).resolves.toEqual({
      format: 'jpeg',
      width: 900,
      height: 600,
    });
  });

  it('inspectPdf is the whole `file` kind validation: five magic bytes', () => {
    expect(() => inspectPdf(Buffer.from('%PDF-1.7 something'))).not.toThrow();
    expect(() => inspectPdf(Buffer.from('GIF89a'))).toThrow(MediaImageError);
  });

  it('MEDIA_IMAGE_REASONS is the closed vocabulary the API answers with', () => {
    expect([...MEDIA_IMAGE_REASONS]).toEqual([
      'not_an_image',
      'format_mismatch',
      'heic_unsupported',
      'too_large',
    ]);
  });
});

describe('variants — the WebP ladder, clamped to the source (MEDIA-02)', () => {
  it('derives one WebP per requested width and never upscales', async () => {
    const derived = await deriveVariants(PHOTO_JPEG, [320, 640, 1080]);
    expect(derived.map((v) => v.width)).toEqual([320, 640, 1080]);

    const probed = await Promise.all(derived.map((v) => probeSize(v.body)));
    // `withoutEnlargement` clamps the 1080 request to the 900 px source.
    expect(probed.map((p) => p.width)).toEqual([320, 640, 900]);
    expect(probed.every((p) => p.format === 'webp')).toBe(true);
  });
});
