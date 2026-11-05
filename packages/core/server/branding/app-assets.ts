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

/** The splash is one square image for light and dark (UI-D-602); the OS fits it to the screen. */
export const SPLASH_SIZE = 1024;
/**
 * The logo's larger side as a fraction of the splash's short side (UI-D-602: "one third of the short side").
 * The "never above 160dp" ceiling of the same decision is a size the native shell enforces on the device
 * (a 1024 asset has no dp); the asset itself never exceeds this third and sits inside the 80 % safe zone.
 */
export const SPLASH_LOGO_FRACTION = 1 / 3;
/** Android adaptive icons keep the artwork inside the central 66 % (the rest is cropped by the mask). */
export const ADAPTIVE_SAFE_ZONE = 0.66;
export const ADAPTIVE_FOREGROUND_SIZE = 1024;
export const NOTIFICATION_ICON_SIZE = 96;

/** Splash name: 24/700 on the shell's scale, in asset pixels, wrapped to at most three lines. */
const SPLASH_NAME_FONT_SIZE = 64;
const SPLASH_NAME_LINE_HEIGHT = 80;
const SPLASH_NAME_FONT_FAMILY = 'Manrope, sans-serif';
const SPLASH_NAME_MAX_LINES = 3;
const SPLASH_NAME_MAX_CHARS = 14;

export type SplashOptions = {
  /** The tenant's primary colour, `#rrggbb`: the splash background. */
  primary: string;
  /** The readable colour on `primary`, `#rrggbb`: the name when there is no logo. */
  onPrimary: string;
  /** The tenant's display name, drawn only when there is no logo. */
  displayName: string;
  /** Declared mime of the logo; sniffed from the bytes when absent. */
  mime?: string;
};
export type SplashMode = 'logo' | 'name';
export type SplashResult = { png: Buffer; mode: SplashMode };
export type NotificationIconResult = {
  png: Buffer;
  /** `fallback`: the logo had no transparency to make a silhouette from, so a plain white disc stands in. */
  quality: 'ok' | 'fallback';
};

const graphemes = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' });

function splitGraphemes(text: string): string[] {
  return Array.from(graphemes.segment(text), (part) => part.segment);
}

/**
 * Word-wraps `name` into at most `maxLines` lines of at most `maxCharsPerLine` characters. Counting and
 * cutting work on grapheme clusters, so an emoji (even a joined family) or an accented letter, composed or
 * not, is never split. A word longer than a line is broken at the line width; when text remains after the
 * last line, that line ends with an ellipsis (still within the width).
 */
export function wrapName(name: string, maxLines = 3, maxCharsPerLine = 14): string[] {
  const words = name
    .normalize('NFC')
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map(splitGraphemes);
  const lines: string[][] = [];
  let current: string[] = [];
  let truncated = false;

  const push = (): void => {
    if (current.length > 0) lines.push(current);
    current = [];
  };

  outer: for (const word of words) {
    let rest = word;
    while (rest.length > 0) {
      const spacer = current.length > 0 ? 1 : 0;
      if (current.length + spacer + rest.length <= maxCharsPerLine) {
        current = current.length > 0 ? [...current, ' ', ...rest] : [...rest];
        rest = [];
        break;
      }
      if (current.length > 0) {
        push();
      } else {
        current = rest.slice(0, maxCharsPerLine);
        rest = rest.slice(maxCharsPerLine);
        push();
      }
      if (lines.length >= maxLines) {
        truncated = true;
        break outer;
      }
    }
    if (lines.length >= maxLines) {
      truncated = true;
      break;
    }
  }
  if (!truncated) push();
  if (lines.length > maxLines) {
    lines.length = maxLines;
    truncated = true;
  }
  if (truncated && lines.length > 0) {
    const last = lines[lines.length - 1] ?? [];
    while (last.length > 0 && last.length >= maxCharsPerLine) last.pop();
    while (last.length > 0 && last[last.length - 1] === ' ') last.pop();
    lines[lines.length - 1] = [...last, '…'];
  }
  return lines.map((line) => line.join(''));
}

/** XML-escape tenant text before it enters an SVG (`&`, `<`, `>`, quotes) and drop characters XML forbids. */
function escapeXml(text: string): string {
  let clean = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const forbidden =
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      code === 0xfffe ||
      code === 0xffff;
    if (!forbidden) clean += char;
  }
  return clean
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function nameSvg(lines: string[], onPrimary: string): Buffer {
  const first = SPLASH_SIZE / 2 - ((lines.length - 1) * SPLASH_NAME_LINE_HEIGHT) / 2;
  // The baseline sits about a third of the font size below the optical middle of its line.
  const baseline = Math.round(SPLASH_NAME_FONT_SIZE * 0.35);
  const text = lines
    .map(
      (line, i) =>
        `<text x="${SPLASH_SIZE / 2}" y="${Math.round(first + i * SPLASH_NAME_LINE_HEIGHT + baseline)}">${escapeXml(line)}</text>`,
    )
    .join('');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SPLASH_SIZE}" height="${SPLASH_SIZE}" viewBox="0 0 ${SPLASH_SIZE} ${SPLASH_SIZE}">` +
      `<g fill="${onPrimary}" font-family="${SPLASH_NAME_FONT_FAMILY}" font-size="${SPLASH_NAME_FONT_SIZE}" font-weight="700" text-anchor="middle">${text}</g></svg>`,
  );
}

/**
 * The splash (UI-D-602): `primary` background, the same picture for light and dark. With a logo, the logo
 * sits centred with its larger side at one third of the short side; without one, the tenant's own
 * `displayName` is drawn in `onPrimary`, centred, up to three lines (never a platform placeholder).
 */
export async function deriveSplash(
  input: Buffer | null,
  opts: SplashOptions,
): Promise<SplashResult> {
  const primary = parseAssetColor(opts.primary, 'primary');
  const onPrimary = parseAssetColor(opts.onPrimary, 'onPrimary');
  const canvas = (): Sharp =>
    sharp({
      create: { width: SPLASH_SIZE, height: SPLASH_SIZE, channels: 3, background: primary },
    });

  if (input) {
    const logo = await openLogo(input, opts.mime);
    const fitted = await fitLogo(logo, Math.round(SPLASH_SIZE * SPLASH_LOGO_FRACTION));
    const png = await canvas()
      .composite([{ input: fitted, gravity: 'centre' }])
      .removeAlpha()
      .png()
      .toBuffer();
    return { png, mode: 'logo' };
  }

  const lines = wrapName(opts.displayName, SPLASH_NAME_MAX_LINES, SPLASH_NAME_MAX_CHARS);
  if (lines.length === 0) throw new AppAssetError('bad_name', 'displayName is empty');
  const overlay = sharp(nameSvg(lines, onPrimary), { limitInputPixels: MAX_INPUT_PIXELS });
  const png = await canvas()
    .composite([{ input: await overlay.png().toBuffer(), gravity: 'centre' }])
    .removeAlpha()
    .png()
    .toBuffer();
  return { png, mode: 'name' };
}

/**
 * The Android adaptive-icon foreground: the logo on a transparent 1024 square, inside the central 66 %.
 * The background layer is the tenant's `primary` as a plain colour the build writes (no image).
 */
export async function deriveAdaptiveForeground(
  input: Buffer,
  opts: { mime?: string } = {},
): Promise<Buffer> {
  const logo = await openLogo(input, opts.mime);
  const fitted = await fitLogo(logo, Math.round(ADAPTIVE_FOREGROUND_SIZE * ADAPTIVE_SAFE_ZONE));
  return sharp({
    create: {
      width: ADAPTIVE_FOREGROUND_SIZE,
      height: ADAPTIVE_FOREGROUND_SIZE,
      channels: 4,
      background: TRANSPARENT,
    },
  })
    .composite([{ input: fitted, gravity: 'centre' }])
    .png()
    .toBuffer();
}

const WHITE_DISC = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${NOTIFICATION_ICON_SIZE}" height="${NOTIFICATION_ICON_SIZE}" viewBox="0 0 96 96"><circle cx="48" cy="48" r="44" fill="#ffffff"/></svg>`,
);

/**
 * The Android status-bar icon: a white silhouette cut from the logo's alpha channel at 96x96. A logo with
 * no transparent pixel (or no visible pixel at all) has no silhouette, and would become a white square; it
 * gets a plain white disc and `quality: 'fallback'` so the release script can tell the tenant.
 */
export async function deriveNotificationIcon(
  input: Buffer,
  opts: { mime?: string } = {},
): Promise<NotificationIconResult> {
  const logo = await openLogo(input, opts.mime);
  const disc = async (): Promise<NotificationIconResult> => ({
    png: await sharp(WHITE_DISC, { limitInputPixels: MAX_INPUT_PIXELS }).png().toBuffer(),
    quality: 'fallback',
  });

  if ((await logo.clone().stats()).isOpaque) return disc();

  const fitted = await fitLogo(logo, NOTIFICATION_ICON_SIZE);
  const mask = await sharp(fitted, { limitInputPixels: MAX_INPUT_PIXELS })
    .extractChannel('alpha')
    .toBuffer();
  const visible = (await sharp(mask, { limitInputPixels: MAX_INPUT_PIXELS }).stats()).channels[0];
  if (!visible || visible.max === 0) return disc();

  const png = await sharp({
    create: {
      width: NOTIFICATION_ICON_SIZE,
      height: NOTIFICATION_ICON_SIZE,
      channels: 3,
      background: '#ffffff',
    },
  })
    .joinChannel(mask)
    .png()
    .toBuffer();
  return { png, quality: 'ok' };
}
