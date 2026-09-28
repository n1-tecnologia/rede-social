import {
  BRANDING_UPLOAD_ID_RE,
  type BrandingUploadKind,
  type BrandingUploadMime,
  mimeToExtension,
} from '@rede-social/contracts';

/**
 * Object-key and upload-id helpers for the public `branding` bucket (D-27, CLAUDE.md §4). Pure: no
 * database, no env, no Storage client — `platform/branding.ts` is the only caller that talks to
 * Storage, and it runs `assertTenantKey` before EVERY call (T-02-83/T-02-84).
 *
 * Layout: uploads at `<tenant_id>/branding/<uuid>.<ext>`, derived icons at
 * `<tenant_id>/branding/icons/<iconVersion>/<file>` (immutable, versioned — a year-long cache is
 * correct because a new set always gets a new URL).
 */

export const BRANDING_BUCKET = 'branding';
const BRANDING_PREFIX = '/branding/';
const ICON_FILES = {
  favicon: 'favicon.ico',
  i192: 'icon-192.png',
  i512: 'icon-512.png',
  maskable512: 'maskable-512.png',
  apple180: 'apple-touch-icon-180.png',
} as const;

const EXTENSION_TO_MIME: Record<string, BrandingUploadMime> = Object.fromEntries(
  (Object.entries(mimeToExtension) as [BrandingUploadMime, string][]).map(([mime, ext]) => [
    ext,
    mime,
  ]),
);

export type ParsedUploadId = {
  kind: BrandingUploadKind;
  uuid: string;
  ext: 'png' | 'svg' | 'webp' | 'jpg';
  mime: BrandingUploadMime;
};

/** `<kind>-<uuid>.<ext>` — stateless: `complete` needs nothing else (the object under the prefix is the proof). */
export function buildUploadId(kind: BrandingUploadKind, ext: string): string {
  return `${kind}-${crypto.randomUUID()}.${ext}`;
}

/** The inverse of `buildUploadId`; `null` for anything the id regex refuses (path separators included). */
export function parseUploadId(id: string): ParsedUploadId | null {
  const match = BRANDING_UPLOAD_ID_RE.exec(id);
  if (!match) return null;
  const kind = match[1] as BrandingUploadKind;
  const ext = match[2] as ParsedUploadId['ext'];
  const uuid = id.slice(kind.length + 1, id.length - ext.length - 1);
  const mime = EXTENSION_TO_MIME[ext];
  if (!mime) return null;
  return { kind, uuid, ext, mime };
}

/** `<tenant_id>/branding/<uuid>.<ext>` */
export function brandingObjectKey(tenantId: string, uuid: string, ext: string): string {
  return `${tenantId}${BRANDING_PREFIX}${uuid}.${ext}`;
}

export type IconObjectKeys = Record<keyof typeof ICON_FILES, string>;

/** The five derived keys under `<tenant_id>/branding/icons/<iconVersion>/`. */
export function iconObjectKeys(tenantId: string, iconVersion: number): IconObjectKeys {
  const base = `${tenantId}${BRANDING_PREFIX}icons/${iconVersion}/`;
  return {
    favicon: `${base}${ICON_FILES.favicon}`,
    i192: `${base}${ICON_FILES.i192}`,
    i512: `${base}${ICON_FILES.i512}`,
    maskable512: `${base}${ICON_FILES.maskable512}`,
    apple180: `${base}${ICON_FILES.apple180}`,
  };
}

/**
 * Throws unless `key` sits under the tenant's own `<tenant_id>/branding/` prefix with no `..` or
 * `//` segment. Called before every Storage call: an object of another tenant can never be read,
 * written or removed through this lane (T-02-83, T-02-84).
 */
export function assertTenantKey(key: string, tenantId: string): void {
  const prefix = `${tenantId}${BRANDING_PREFIX}`;
  if (
    !tenantId ||
    !key.startsWith(prefix) ||
    key.length === prefix.length ||
    key.includes('..') ||
    key.includes('//') ||
    key.includes('\\')
  ) {
    throw new Error(`branding key outside the tenant prefix: ${key}`);
  }
}

/**
 * The object key behind a public URL of THIS tenant in THIS Storage origin, else `null`: seed logos
 * are root-relative (`/seed-logos/x.svg`), foreign origins/buckets/tenants answer null so the job
 * never downloads anything it does not own.
 */
export function objectKeyFromPublicUrl(
  url: string | null | undefined,
  tenantId: string,
  storageOrigin: string,
): string | null {
  if (!url) return null;
  let parsed: URL;
  let origin: URL;
  try {
    parsed = new URL(url);
    origin = new URL(storageOrigin);
  } catch {
    return null;
  }
  if (parsed.origin !== origin.origin) return null;
  const publicPrefix = `/storage/v1/object/public/${BRANDING_BUCKET}/`;
  if (!parsed.pathname.startsWith(publicPrefix)) return null;
  let key: string;
  try {
    key = decodeURIComponent(parsed.pathname.slice(publicPrefix.length));
  } catch {
    return null;
  }
  try {
    assertTenantKey(key, tenantId);
  } catch {
    return null;
  }
  return key;
}

/**
 * Defence in depth for the logo served through `<img>` (T-02-81): script, foreignObject, event
 * handlers, `javascript:` and external / data-text references are refused. Icons are rasterised
 * PNG/ICO regardless, so only the logo itself is ever served as SVG.
 */
export function svgLooksUnsafe(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes('<script') || lower.includes('<foreignobject')) return true;
  if (lower.includes('javascript:')) return true;
  if (/\son[a-z]+\s*=/.test(lower)) return true;
  if (/(?:xlink:)?href\s*=\s*["']?\s*(?:https?:)?\/\//.test(lower)) return true;
  if (/(?:xlink:)?href\s*=\s*["']?\s*data:text/.test(lower)) return true;
  return false;
}
