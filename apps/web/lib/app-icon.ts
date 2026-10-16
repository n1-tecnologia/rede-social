import { hexColorSchema, NEUTRAL_BRAND } from '@rede-social/contracts/branding';

/**
 * The tenant's app icon as the panel composes it (2026-10-09, "Ícone do app"): how the installed app
 * shows on a phone's home screen. Pure and client-safe: geometry, the drawing order and the editor's
 * settings, with no DOM at import (the decoding and the encoding live in `app-icon-image.ts`), so a
 * node test drives `drawAppIcon` with a recording context.
 *
 * What is composed is ONE opaque square (no rounded corners: each system cuts its own shape), sent
 * through the existing `icon` upload (the square override, D-28). The worker derives the set from it
 * exactly as from any override: the plain icons are it as is, and the maskable one is it at 80% over
 * the PRIMARY colour. Two ways to make it:
 *
 * - "Logo e fundo" (`mode: 'logo'`): a ground, a colour (the primary unless one is picked) or an
 *   image covering the square, with the logo contained in a centred box of 30% to 100% of the side;
 * - "Arte única" (`mode: 'art'`): one image covering the whole square, cropped in its centre.
 *
 * The ground is always painted first, so a transparent pixel never reaches iOS, which paints it black.
 */

/** The composed square's side: the worker's largest output is 512, and 1024 keeps a vector crisp. */
export const APP_ICON_SIZE = 1024;

/**
 * Android's maskable safe zone: the worker draws the icon at 80% over the primary
 * (`MASKABLE_SAFE_ZONE` in `packages/core/server/branding/icons.ts`, which the web may not import).
 */
export const ANDROID_SAFE_ZONE = 0.8;

/** The logo's box as a share of the side: 30% to 100%, 70% by default. */
export const LOGO_SCALE = { min: 0.3, max: 1, default: 0.7 } as const;

/**
 * The largest file the editor takes as a SOURCE (a phone photo for the art). The composed icon is
 * what is uploaded, and it is held to the branding limit (2 MiB) by `encodeAppIcon`.
 */
export const APP_ICON_SOURCE_MAX_BYTES = 15 * 1024 * 1024;

/** The manifest's `short_name` length (`SHORT_NAME_MAX` in `lib/manifest.ts`). */
export const HOME_SCREEN_LABEL_MAX = 12;

export type Size = { width: number; height: number };
export type Rect = Size & { x: number; y: number };

/** A decoded image as the drawing reads it: what a canvas draws, with its size in pixels. */
export type IconImage = Size & { source: CanvasImageSource };

/** What one composition draws: every colour a valid hex, every image already decoded. */
export type AppIconSpec =
  | {
      mode: 'logo';
      background: string;
      /** Covers the square over `background`; `null` for the colour alone. */
      backgroundImage: IconImage | null;
      /** `null` while it loads: the ground alone is drawn. */
      logo: IconImage | null;
      logoScale: number;
    }
  | { mode: 'art'; background: string; art: IconImage | null };

/** The part of `CanvasRenderingContext2D` the drawing uses (a test records it). */
export interface IconContext {
  fillStyle: CanvasRenderingContext2D['fillStyle'];
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
  fillRect(x: number, y: number, width: number, height: number): void;
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

/**
 * Where `src` lands fitted whole (CSS `contain`) in a centred box of `scale` times the side of a
 * `size` square. An empty source lands as an empty rect in the centre.
 */
export function containRect(src: Size, size: number, scale: number): Rect {
  if (src.width <= 0 || src.height <= 0) return { x: size / 2, y: size / 2, width: 0, height: 0 };
  const box = size * scale;
  const ratio = Math.min(box / src.width, box / src.height);
  const width = src.width * ratio;
  const height = src.height * ratio;
  return { x: (size - width) / 2, y: (size - height) / 2, width, height };
}

/** The centred square of `src` that a cover fit shows (CSS `cover` on a square), in its pixels. */
export function coverCrop(src: Size): Rect {
  const side = Math.max(0, Math.min(src.width, src.height));
  return { x: (src.width - side) / 2, y: (src.height - side) / 2, width: side, height: side };
}

/** The logo's share of the side, kept between 30% and 100% (not a number: the default, 70%). */
export function clampLogoScale(value: number): number {
  if (Number.isNaN(value)) return LOGO_SCALE.default;
  return Math.min(LOGO_SCALE.max, Math.max(LOGO_SCALE.min, value));
}

function drawCover(ctx: IconContext, image: IconImage, size: number): void {
  const crop = coverCrop(image);
  if (crop.width <= 0) return;
  ctx.drawImage(image.source, crop.x, crop.y, crop.width, crop.height, 0, 0, size, size);
}

/**
 * Draws the icon on a `size` square: the ground colour over the WHOLE square first (iOS never shows
 * black through it), then the ground image covering it, then the logo contained in its box; or, for
 * the art, the art covering the square over the ground. The output is the square itself, never
 * pre-rounded.
 */
export function drawAppIcon(ctx: IconContext, spec: AppIconSpec, size: number): void {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = spec.background;
  ctx.fillRect(0, 0, size, size);
  if (spec.mode === 'art') {
    if (spec.art) drawCover(ctx, spec.art, size);
    return;
  }
  if (spec.backgroundImage) drawCover(ctx, spec.backgroundImage, size);
  const { logo } = spec;
  if (!logo) return;
  const rect = containRect(logo, size, clampLogoScale(spec.logoScale));
  if (rect.width <= 0 || rect.height <= 0) return;
  ctx.drawImage(
    logo.source,
    0,
    0,
    logo.width,
    logo.height,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
  );
}

export type AppIconMode = 'logo' | 'art';
/** The tenant's light-mode logo, its dark-mode one, or a file picked for the icon alone. */
export type AppIconLogoSource = 'light' | 'dark' | 'file';
export type AppIconBackgroundKind = 'color' | 'image';

/** The editor's choices; the files stay in this browser (nothing but the composed icon is sent). */
export type AppIconSettings = {
  mode: AppIconMode;
  backgroundKind: AppIconBackgroundKind;
  /** The ground colour; `null` follows the tenant's primary. */
  backgroundColor: string | null;
  backgroundImage: File | null;
  logoSource: AppIconLogoSource;
  /** The logo when `logoSource` is `'file'`. */
  logoFile: File | null;
  /** The logo's box, a share of the side (`LOGO_SCALE`). */
  logoScale: number;
  art: File | null;
};

export const DEFAULT_APP_ICON_SETTINGS: AppIconSettings = {
  mode: 'logo',
  backgroundKind: 'color',
  backgroundColor: null,
  backgroundImage: null,
  logoSource: 'light',
  logoFile: null,
  logoScale: LOGO_SCALE.default,
  art: null,
};

/** A colour of its own paints the ground only while it IS the ground: logo mode, colour ground. */
function ownColor(settings: AppIconSettings): string | null {
  if (settings.mode !== 'logo' || settings.backgroundKind !== 'color') return null;
  const parsed = hexColorSchema.safeParse(settings.backgroundColor);
  return parsed.success ? parsed.data : null;
}

/**
 * The icon's ground follows the primary: always, unless a colour of its own is the ground. An image
 * (a ground image, the art) sits on the primary too, which shows through its transparent pixels, so
 * a composed icon is redone when the primary changes (the wizard's draft does it on its own).
 */
export function followsPrimary(settings: AppIconSettings): boolean {
  return ownColor(settings) === null;
}

/** The ground colour drawn under everything: the own colour, else the primary (else the neutral). */
export function resolveBackground(settings: AppIconSettings, primary: string): string {
  const parsed = hexColorSchema.safeParse(primary);
  return ownColor(settings) ?? (parsed.success ? parsed.data : NEUTRAL_BRAND.primary);
}

/** The images a composition needs, decoded (`null` while one loads or when it is not used). */
export type AppIconImages = {
  logo: IconImage | null;
  backgroundImage: IconImage | null;
  art: IconImage | null;
};

/** The drawing the settings describe, over the decoded images. */
export function appIconSpec(
  settings: AppIconSettings,
  primary: string,
  images: AppIconImages,
): AppIconSpec {
  const background = resolveBackground(settings, primary);
  if (settings.mode === 'art') return { mode: 'art', background, art: images.art };
  return {
    mode: 'logo',
    background,
    backgroundImage: settings.backgroundKind === 'image' ? images.backgroundImage : null,
    logo: images.logo,
    logoScale: clampLogoScale(settings.logoScale),
  };
}

/**
 * The name under the icon on Android: the manifest's `short_name`, the display name cut at 12
 * characters without a trailing space. The rule of `shortName` in `lib/manifest.ts`, copied rather
 * than imported: that module pulls the contracts root, which reaches `node:fs`, so no client bundle
 * may import it (a unit test pins the two together).
 */
export function homeScreenLabel(displayName: string): string {
  const trimmed = displayName.trim();
  if (trimmed.length <= HOME_SCREEN_LABEL_MAX) return trimmed;
  return trimmed.slice(0, HOME_SCREEN_LABEL_MAX).trimEnd();
}
