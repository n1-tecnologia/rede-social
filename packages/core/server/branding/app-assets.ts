import { hexColorSchema } from '@rede-social/contracts';
import sharp, { type Sharp, type SharpOptions } from 'sharp';
import {
  inspectBrandingImage,
  MASKABLE_SAFE_ZONE,
  MAX_INPUT_PIXELS,
  SVG_RASTER_TARGET,
} from './icons';

/**
 * Native app assets (Phase 13, D-607, UI-D-602): the images of a tenant's store app, derived from its
 * branding. This module EXTENDS `icons.ts` and never modifies it (D-603 additive: the browser PWA icon
 * pipeline stays byte for byte as it was). Pure sharp over buffers and colours: no database, no env, no
 * Storage, no fetching. The release script (plan 29) reads the logo, calls these functions and writes the
 * files.
 *
 * What is NOT derived here: the store name and the icon label (`deriveStoreName` / `deriveIconLabel` in
 * `@rede-social/contracts/native`). This module imports nothing from the web.
 *
 * Every `sharp()` that decodes tenant input carries `limitInputPixels` (T-02-80) and the input is refused
 * by `inspectBrandingImage` first (a decompression bomb, a mismatching format or an unsafe SVG die with the
 * existing `BrandingImageError`). Every pixel of colour comes from the tenant's own branding: there is no
 * platform logo, colour or placeholder anywhere in this file.
 */

/** The App Store icon is a 1024 square; the Google Play high-resolution icon is a 512 square. */
export const APP_STORE_ICON_SIZE = 1024;
export const PLAY_ICON_SIZE = 512;

const MAX_SVG_DENSITY = 2400;
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 } as const;

export type AppAssetErrorReason = 'bad_color' | 'bad_name';

/** A typed refusal for a malformed colour or name; nothing is rendered when it is thrown. */
export class AppAssetError extends Error {
  readonly reason: AppAssetErrorReason;
  constructor(reason: AppAssetErrorReason, message?: string) {
    super(message ?? `app asset rejected: ${reason}`);
    this.name = 'AppAssetError';
    this.reason = reason;
  }
}

/** The same `#rrggbb` shape the branding contract uses, normalised to lower case. */
export function parseAssetColor(value: string, field: string): string {
  const parsed = hexColorSchema.safeParse(value);
  if (!parsed.success) throw new AppAssetError('bad_color', `${field} is not a #rrggbb colour`);
  return parsed.data;
}

/** Declared mime of a buffer by its magic bytes; anything else is left to `inspectBrandingImage` to refuse. */
function sniffMime(buf: Buffer): string {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF') {
    return buf.toString('latin1', 8, 12) === 'WEBP' ? 'image/webp' : 'image/png';
  }
  if (buf.toString('utf8', 0, 512).includes('<svg')) return 'image/svg+xml';
  return 'image/png';
}

/**
 * Inspect the logo (header only) and open it for rendering. An SVG gets a density so its longer side
 * rasterises to at least `SVG_RASTER_TARGET` px, exactly like `deriveIconSet` (that private helper is
 * re-stated here because `icons.ts` must stay untouched).
 */
export async function openLogo(input: Buffer, mime?: string): Promise<Sharp> {
  const declared = mime ?? sniffMime(input);
  await inspectBrandingImage(input, declared);
  const options: SharpOptions = { limitInputPixels: MAX_INPUT_PIXELS };
  if (declared === 'image/svg+xml') {
    const meta = await sharp(input, options).metadata();
    const longest = Math.max(meta.width ?? 0, meta.height ?? 0);
    if (longest > 0) {
      options.density = Math.min(MAX_SVG_DENSITY, Math.ceil((72 * SVG_RASTER_TARGET) / longest));
    }
  }
  return sharp(input, options);
}

/** The logo fitted (never cropped) inside a `box` x `box` transparent square. */
export function fitLogo(logo: Sharp, box: number): Promise<Buffer> {
  return logo
    .clone()
    .resize(box, box, { fit: 'contain', background: TRANSPARENT })
    .ensureAlpha()
    .png()
    .toBuffer();
}

export type StoreIconOptions = {
  /** The tenant's primary colour, `#rrggbb`: the icon background. */
  primary: string;
  /** Declared mime of the logo; sniffed from the bytes when absent. */
  mime?: string;
};

export type StoreIcons = {
  /** 1024x1024 PNG, no alpha channel, no rounded corners (the OS rounds). */
  appStore1024: Buffer;
  /** 512x512 PNG (32-bit, fully opaque) for the Google Play listing. */
  play512: Buffer;
};

/**
 * The store icons (D-607): the logo centred inside the 80 % safe zone over the tenant's `primary`,
 * flattened so the App Store file carries no transparency. The Play file is the same picture at 512.
 */
export async function deriveStoreIcon(input: Buffer, opts: StoreIconOptions): Promise<StoreIcons> {
  const primary = parseAssetColor(opts.primary, 'primary');
  const logo = await openLogo(input, opts.mime);
  const safe = await fitLogo(logo, Math.round(APP_STORE_ICON_SIZE * MASKABLE_SAFE_ZONE));

  const appStore1024 = await sharp({
    create: {
      width: APP_STORE_ICON_SIZE,
      height: APP_STORE_ICON_SIZE,
      channels: 3,
      background: primary,
    },
  })
    .composite([{ input: safe, gravity: 'centre' }])
    .removeAlpha()
    .png()
    .toBuffer();

  const play512 = await sharp(appStore1024, { limitInputPixels: MAX_INPUT_PIXELS })
    .resize(PLAY_ICON_SIZE, PLAY_ICON_SIZE)
    .ensureAlpha()
    .png()
    .toBuffer();

  return { appStore1024, play512 };
}

// ---- RED stubs (plan 13-24 task 2): deliberately inert, fully replaced in GREEN ----------------------
const INERT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==',
  'base64',
);

export type SplashOptions = {
  primary: string;
  onPrimary: string;
  displayName: string;
  mime?: string;
};
export type SplashMode = 'logo' | 'name';
export type SplashResult = { png: Buffer; mode: SplashMode };
export type NotificationIconResult = { png: Buffer; quality: 'ok' | 'fallback' };

export function wrapName(_name: string, _maxLines = 3, _maxCharsPerLine = 14): string[] {
  return [];
}
export async function deriveSplash(
  _input: Buffer | null,
  _opts: SplashOptions,
): Promise<SplashResult> {
  return { png: INERT_PNG, mode: 'logo' };
}
export async function deriveAdaptiveForeground(
  _input: Buffer,
  _opts: { mime?: string } = {},
): Promise<Buffer> {
  return INERT_PNG;
}
export async function deriveNotificationIcon(
  _input: Buffer,
  _opts: { mime?: string } = {},
): Promise<NotificationIconResult> {
  return { png: INERT_PNG, quality: 'ok' };
}
