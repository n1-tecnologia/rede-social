import { slugSchema } from '@rede-social/contracts';
import { LIGHT_BG, NEUTRAL_BRAND, type ResolvedBranding } from '@rede-social/contracts/branding';
import type { MetadataRoute } from 'next';

/**
 * Web-app manifest builder (PWA-01, D-25/D-28). Pure and server-side: the route handler
 * `app/m/[slug]/manifest.webmanifest/route.ts` and the root layout's `generateMetadata` both read from
 * here so the `<link rel="manifest">`, the icons and the manifest body can never disagree.
 *
 * `id` is `'/?tenant=<slug>'` (CONTEXT "id per tenant", CLAUDE.md PWA §1): `start_url` and `scope`
 * stay `/` on every tenant origin (D-35), and the id keeps two tenants installed on one device apart.
 * Neither value ever derives from request input (T-02-73): the slug reaching `buildManifest` has
 * passed `slugSchema` or equals the reserved neutral slug.
 */

/** Reserved slug of the platform's neutral manifest: an underscore cannot pass `slugSchema`, so no tenant collides. */
export const NEUTRAL_MANIFEST_SLUG = '_rede';
export const MANIFEST_FILE = 'manifest.webmanifest';
export const NEUTRAL_DISPLAY_NAME = 'Rede Social';
/** UI-SPEC §PWA: `short_name` is the display name cut at 12 characters. */
export const SHORT_NAME_MAX = 12;
/** Where 02-13 writes the derived icon set inside the public bucket (keep in step with derive-icons). */
export const BRANDING_BUCKET_PREFIX = '/storage/v1/object/public/branding/';

export type IconSet = {
  favicon: string;
  i192: string;
  i512: string;
  maskable512: string;
  apple180: string;
};

/** the platform's own mark (apps/web/public/icons): Rede Social hosts, and tenants without derived icons yet. */
export const NEUTRAL_ICONS: IconSet = {
  favicon: '/icons/rede-social-48.png',
  i192: '/icons/rede-social-192.png',
  i512: '/icons/rede-social-512.png',
  maskable512: '/icons/rede-social-maskable-512.png',
  apple180: '/icons/rede-social-apple-180.png',
};

/** `/m/<slug>/manifest.webmanifest`; `null` → the neutral manifest. */
export function manifestPath(slug: string | null): string {
  return `/m/${slug ?? NEUTRAL_MANIFEST_SLUG}/${MANIFEST_FILE}`;
}

/** A tenant slug (`slugSchema`) or the reserved neutral slug — the only path segments the route serves. */
export function isManifestSlug(raw: string): boolean {
  return raw === NEUTRAL_MANIFEST_SLUG || slugSchema.safeParse(raw).success;
}

/**
 * Icon URL allow-list (T-02-72): either root-relative under `/icons/` (no `..`, no scheme, no
 * protocol-relative `//`) or an absolute URL on `publicOrigin` (the Supabase project) whose path
 * starts with the public branding bucket prefix. Anything else — foreign hosts, other buckets,
 * `javascript:`/`data:` schemes, unparsable values — is refused.
 */
export function isAllowedIconUrl(url: string, publicOrigin: string): boolean {
  if (typeof url !== 'string' || url.length === 0) return false;
  if (url.startsWith('/icons/')) return !url.includes('..') && !url.startsWith('//');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.origin === publicOrigin && parsed.pathname.startsWith(BRANDING_BUCKET_PREFIX);
}

/**
 * The icon set a brand renders: the four derived URLs (02-13) when EVERY one passes the allow-list —
 * plus the favicon when it passes too, else the 192 icon — or the WHOLE neutral set. Never mixed
 * (T-02-72): one foreign value cannot smuggle itself in next to three legitimate ones.
 */
export function iconsFor(branding: ResolvedBranding, publicOrigin: string): IconSet {
  const derived = branding.iconUrls;
  if (!derived) return NEUTRAL_ICONS;
  const four = [derived.i192, derived.i512, derived.maskable512, derived.apple180];
  if (!four.every((url) => isAllowedIconUrl(url, publicOrigin))) return NEUTRAL_ICONS;
  const favicon =
    branding.faviconUrl && isAllowedIconUrl(branding.faviconUrl, publicOrigin)
      ? branding.faviconUrl
      : derived.i192;
  return {
    favicon,
    i192: derived.i192,
    i512: derived.i512,
    maskable512: derived.maskable512,
    apple180: derived.apple180,
  };
}

/** Display name cut at 12 characters without a trailing space (UI-SPEC §PWA). */
export function shortName(displayName: string): string {
  const trimmed = displayName.trim();
  if (trimmed.length <= SHORT_NAME_MAX) return trimmed;
  return trimmed.slice(0, SHORT_NAME_MAX).trimEnd();
}

export type ManifestInput = {
  slug: string;
  displayName: string;
  themeColor: string;
  icons: IconSet;
};

export function buildManifest({
  slug,
  displayName,
  themeColor,
  icons,
}: ManifestInput): MetadataRoute.Manifest {
  return {
    id: `/?tenant=${slug}`,
    name: displayName,
    short_name: shortName(displayName),
    description: displayName,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'pt-BR',
    dir: 'ltr',
    background_color: LIGHT_BG,
    theme_color: themeColor,
    icons: [
      { src: icons.i192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: icons.i512, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: icons.maskable512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

/** the platform's manifest for the platform and generic hosts. */
export function neutralManifest(): MetadataRoute.Manifest {
  return buildManifest({
    slug: NEUTRAL_MANIFEST_SLUG,
    displayName: NEUTRAL_DISPLAY_NAME,
    themeColor: NEUTRAL_BRAND.primary,
    icons: NEUTRAL_ICONS,
  });
}
