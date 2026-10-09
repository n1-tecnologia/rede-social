import { BRANDING_MAX_BYTES } from '@rede-social/contracts/branding';
import {
  APP_ICON_SIZE,
  APP_ICON_SOURCE_MAX_BYTES,
  type AppIconSettings,
  appIconSpec,
  drawAppIcon,
  type IconImage,
} from './app-icon';

/**
 * The browser half of the app icon (2026-10-09, "Ícone do app"): a source decoded into something a
 * canvas draws, and the composed square encoded for the `icon` upload. It touches `document`,
 * `fetch` and object URLs, so only client code calls it; the geometry and the drawing order are
 * `app-icon.ts`.
 *
 * A source is a picked FILE or a URL (the tenant's current logo: the public branding bucket, or a
 * root-relative path for a seed tenant). A URL is FETCHED (CORS, no credentials, no cache, no
 * referrer) and decoded from its bytes, never drawn from an `<img>` pointing at it: a cross-origin
 * image on a canvas taints it and the encode then throws, and so would a copy the browser cached
 * from a plain `<img>` without CORS. The bucket's CORS answer is not this app's to set, so ANY
 * failure to read the bytes is `unreachable`, which the editor answers by asking for the file. A
 * picked file never goes through `fetch`: the CSP's `connect-src` does not list `blob:`.
 *
 * The bytes are decoded by an `<img>` ELEMENT on an object URL, like `normaliseImage`
 * (`lib/upload.ts`), so the browser applies the EXIF rotation, then drawn once onto a canvas no
 * larger than the composition needs (the shorter side at most 1024 px). That copy is what the editor
 * redraws on every change (a 4000 px photo is not resampled each time the slider moves), and the
 * object URL is revoked as soon as it exists. An SVG first gets an intrinsic size of 1024 px on its
 * longer side (`sizedSvg`), so it rasterises crisp instead of at 300 × 150 or at its own tiny size.
 *
 * The encode keeps the branding limit (2 MiB, the bucket's): a PNG when it fits, else a JPEG at
 * falling qualities (the square is opaque, its ground is always painted first), else `size`.
 */

const PNG = 'image/png';
const JPEG = 'image/jpeg';
const SVG = 'image/svg+xml';
/** The JPEG qualities tried, in order, when the PNG does not fit. */
const JPEG_QUALITIES = [0.92, 0.85, 0.75] as const;

export type AppIconErrorCode =
  /** The URL's bytes could not be read (network, CORS, an error status). */
  | 'unreachable'
  /** The bytes are not an image the browser decodes. */
  | 'decode'
  /** The source is above `APP_ICON_SOURCE_MAX_BYTES`. */
  | 'tooLarge'
  /** No encoding of the composed icon fits the branding limit. */
  | 'size';

export class AppIconError extends Error {
  readonly code: AppIconErrorCode;
  constructor(code: AppIconErrorCode) {
    super(`app icon: ${code}`);
    this.name = 'AppIconError';
    this.code = code;
  }
}

/** A picked file, or the URL of an image this app may read (the tenant's current logo). */
export type IconSource = { file: File } | { url: string };

async function fetchBytes(url: string): Promise<Blob> {
  try {
    const response = await fetch(url, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new AppIconError('unreachable');
    return await response.blob();
  } catch {
    throw new AppIconError('unreachable');
  }
}

/**
 * An SVG by its type (parameters aside), or by its name when the type says nothing (a picked file
 * the browser left untyped, a server answering bytes): only then is it decoded as one, since a
 * browser never sniffs an SVG.
 */
function isSvg(blob: Blob, name: string): boolean {
  const type = (blob.type.split(';')[0] ?? '').trim().toLowerCase();
  if (type === SVG) return true;
  const untyped = type === '' || type === 'application/octet-stream';
  return untyped && /\.svg$/i.test(name.split(/[?#]/)[0] ?? '');
}

/** An attribute of the `<svg ...>` opening tag, quoted either way; `null` when absent. */
function attribute(tag: string, name: string): string | null {
  const found = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return found ? (found[1] ?? found[2] ?? '').trim() : null;
}

/** A length in user units (`320`, `320px`); anything relative (`100%`, `2em`) is no length here. */
function userLength(value: string | null): number | null {
  const found = value ? /^(\d+(?:\.\d+)?)(?:px)?$/i.exec(value) : null;
  const length = found ? Number(found[1]) : Number.NaN;
  return length > 0 ? length : null;
}

/**
 * The SVG with an intrinsic size whose longer side is 1024 px: from its own `width`/`height` when
 * both are plain lengths (scaled together, so it draws exactly as before, only larger; a `viewBox`
 * is added when it had none, or the drawing would not follow), else from its `viewBox`. With
 * neither, it is returned as it was. Only the root tag's `width` and `height` are rewritten.
 */
export function sizedSvg(svg: string): string {
  const open = /<svg\b[^>]*>/i.exec(svg);
  if (!open) return svg;
  const tag = open[0];
  const box = (attribute(tag, 'viewBox') ?? '').split(/[\s,]+/).map(Number);
  const boxWidth = box.length === 4 ? (box[2] ?? 0) : 0;
  const boxHeight = box.length === 4 ? (box[3] ?? 0) : 0;
  const hasBox = boxWidth > 0 && boxHeight > 0;
  const width = userLength(attribute(tag, 'width'));
  const height = userLength(attribute(tag, 'height'));
  const size =
    width && height ? { width, height } : hasBox ? { width: boxWidth, height: boxHeight } : null;
  if (!size) return svg;
  const scale = APP_ICON_SIZE / Math.max(size.width, size.height);
  const attributes = [
    `width="${Math.max(1, Math.round(size.width * scale))}"`,
    `height="${Math.max(1, Math.round(size.height * scale))}"`,
    ...(hasBox ? [] : [`viewBox="0 0 ${size.width} ${size.height}"`]),
  ].join(' ');
  const sized = tag
    .replace(/\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    .replace(/^<svg\b/i, `<svg ${attributes}`);
  return `${svg.slice(0, open.index)}${sized}${svg.slice(open.index + tag.length)}`;
}

function decode(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    // An <img> ELEMENT, never `createImageBitmap`: it applies the EXIF rotation (`normaliseImage`).
    const img = document.createElement('img');
    img.decoding = 'sync';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new AppIconError('decode'));
    img.src = url;
  });
}

/** The decoded image drawn once at the size the composition needs: the shorter side up to 1024. */
function raster(img: HTMLImageElement): IconImage {
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  if (!(width > 0 && height > 0)) throw new AppIconError('decode');
  const shorter = Math.min(width, height);
  const scale = shorter > APP_ICON_SIZE ? APP_ICON_SIZE / shorter : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  // No context (a canvas the device refused): the element itself, decoded and drawable as is.
  if (!context) return { source: img, width, height };
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { source: canvas, width: canvas.width, height: canvas.height };
}

/**
 * Decodes a source for the app icon: a file as it is, a URL by its bytes (`unreachable` when they
 * cannot be read). Rejects with an `AppIconError`: `tooLarge` above 15 MiB, `decode` when the
 * browser cannot read it as an image.
 */
export async function loadIconImage(source: IconSource): Promise<IconImage> {
  const picked = 'file' in source;
  const blob = picked ? source.file : await fetchBytes(source.url);
  if (blob.size > APP_ICON_SOURCE_MAX_BYTES) throw new AppIconError('tooLarge');
  const bytes = isSvg(blob, picked ? source.file.name : source.url)
    ? new Blob([sizedSvg(await blob.text())], { type: SVG })
    : blob;
  const url = URL.createObjectURL(bytes);
  try {
    return raster(await decode(url));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * The composed square as the upload takes it, at most `max` bytes: a PNG when it fits, else a JPEG
 * at 0.92, 0.85 and 0.75 (a browser that cannot write JPEG answers a PNG, so the type is checked),
 * else `AppIconError('size')`.
 */
export async function encodeAppIcon(
  canvas: HTMLCanvasElement,
  max: number = BRANDING_MAX_BYTES,
): Promise<Blob> {
  const png = await toBlob(canvas, PNG);
  if (png && png.type === PNG && png.size <= max) return png;
  for (const quality of JPEG_QUALITIES) {
    const jpeg = await toBlob(canvas, JPEG, quality);
    if (jpeg && jpeg.type === JPEG && jpeg.size <= max) return jpeg;
  }
  throw new AppIconError('size');
}

/**
 * The app icon the settings describe, as the file the `icon` upload sends (1024 × 1024, PNG or
 * JPEG). `logo` is the decoded logo a `'light'` or `'dark'` source points at (the caller holds it);
 * the picked files of the settings (a logo file, the ground image, the art) are decoded here.
 */
export async function composeAppIconFile({
  settings,
  primary,
  logo,
}: {
  settings: AppIconSettings;
  primary: string;
  logo: IconImage | null;
}): Promise<File> {
  const load = (file: File | null) => (file ? loadIconImage({ file }) : Promise.resolve(null));
  const art = settings.mode === 'art' ? await load(settings.art) : null;
  const logoMode = settings.mode === 'logo';
  const backgroundImage =
    logoMode && settings.backgroundKind === 'image' ? await load(settings.backgroundImage) : null;
  const logoImage = logoMode
    ? settings.logoSource === 'file'
      ? await load(settings.logoFile)
      : logo
    : null;
  if (logoMode ? !logoImage : !art) throw new Error('app icon: nothing to draw');

  const canvas = document.createElement('canvas');
  canvas.width = APP_ICON_SIZE;
  canvas.height = APP_ICON_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('app icon: canvas 2d context unavailable');
  drawAppIcon(
    context,
    appIconSpec(settings, primary, { logo: logoImage, backgroundImage, art }),
    APP_ICON_SIZE,
  );
  const blob = await encodeAppIcon(canvas);
  const name = blob.type === JPEG ? 'icone-do-app.jpg' : 'icone-do-app.png';
  return new File([blob], name, { type: blob.type });
}
