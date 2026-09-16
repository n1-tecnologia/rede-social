import { z } from 'zod';

/**
 * Tenant brand contract (TENANT-02, D-25/D-26/D-28/D-41).
 *
 * Pure module — no node imports — so client components may import it through
 * `@tria/contracts/branding` without pulling `legal.ts` (`node:fs`) into the bundle.
 *
 * A brand is primary + secondary color + logo + display name (D-25). Everything else is derived:
 * `onPrimary` (white or navy by contrast), `primaryDark` (the D-41 dark-surface variant) and
 * `onPrimaryDark`. The derivations are PERSISTED next to the two source colors at save time so that
 * non-CSS consumers (e-mail templates, manifest `theme_color`) read them without recomputing.
 */

/** `#rrggbb`, case-insensitive on input, always lower-case after parsing (one canonical form). */
export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'expected a #rrggbb color')
  .transform((value) => value.toLowerCase());
export type HexColor = z.infer<typeof hexColorSchema>;

/** D-25 fixed keys plus the persisted derivations (D-25/D-41). */
export const brandColorsSchema = z.object({
  primary: hexColorSchema,
  secondary: hexColorSchema,
  onPrimary: hexColorSchema,
  primaryDark: hexColorSchema,
  onPrimaryDark: hexColorSchema,
});
export type BrandColors = z.infer<typeof brandColorsSchema>;

/**
 * The derived icon set (D-28). A fixed-key object, never an array: consumers must not depend on
 * ordering (edge TENANT-02/ordering).
 */
export const brandIconUrlsSchema = z.object({
  i192: z.string(),
  i512: z.string(),
  maskable512: z.string(),
  apple180: z.string(),
});
export type BrandIconUrls = z.infer<typeof brandIconUrlsSchema>;

/**
 * The public brand facts carried by `GET /v1/public/tenants/by-host` (T-02-04): logo, favicon, the
 * icon set and the five colors. Strict — nothing beyond brand facts may leak into the public answer.
 */
export const hostBrandingSchema = z
  .object({
    logoUrl: z.string().nullable(),
    faviconUrl: z.string().nullable(),
    iconUrls: brandIconUrlsSchema.nullable(),
    colors: brandColorsSchema,
  })
  .strict();
export type HostBranding = z.infer<typeof hostBrandingSchema>;

/**
 * The `tenants.branding` jsonb. Every field is optional with a default so `{}` (a tenant created
 * before its brand was configured, edge TENANT-02/empty) parses; `iconUrl` is the optional square
 * override (D-28) and `iconVersion` busts icon caches when the set is re-derived.
 */
export const tenantBrandingSchema = z.object({
  logoUrl: z.string().nullable().default(null),
  faviconUrl: z.string().nullable().default(null),
  iconUrl: z.string().nullable().default(null),
  iconUrls: brandIconUrlsSchema.nullable().default(null),
  iconVersion: z.number().int().nonnegative().default(0),
  colors: brandColorsSchema.partial().default({}),
});
/** What is stored: loose, anything may be missing. Use `resolveBranding()` before rendering. */
export type TenantBranding = z.input<typeof tenantBrandingSchema>;

/** A brand with every gap filled: what layouts, e-mails and the manifest render from. */
export type ResolvedBranding = {
  logoUrl: string | null;
  faviconUrl: string | null;
  iconUrl: string | null;
  iconUrls: BrandIconUrls | null;
  iconVersion: number;
  colors: BrandColors;
};

/** TRIA's neutral fallback — visible only on generic hosts and on tenants with no brand yet. */
export const NEUTRAL_BRAND = { primary: '#2e6fd0', secondary: '#5b9cf8' } as const;
/** Neutral surfaces the contrast report checks against (prototype light/dark `--theme-bg`). */
export const LIGHT_BG = '#f5f7fb';
export const DARK_BG = '#0f1118';
/** The dark text candidate for `onPrimary` (prototype `--theme-text`, light mode). */
export const NAVY = '#16233b';
export const WHITE = '#ffffff';
/** Per-device theme preference cookie (D-41), readable by the server for the first HTML. */
export const THEME_COOKIE = 'tria_theme';

/** D-41: how far `primary` is mixed towards white for the dark-surface variant (RESEARCH A11). */
const PRIMARY_DARK_MIX = 0.3;
/** WCAG 2.x AA: normal text and UI components. */
const AA_TEXT = 4.5;
const AA_UI = 3;

type Rgb = readonly [number, number, number];

function hexToRgb(hex: string): Rgb {
  const value = hexColorSchema.parse(hex).slice(1);
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function rgbToHex([r, g, b]: Rgb): string {
  const channel = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** WCAG 2.x relative luminance of an sRGB color (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2.x contrast ratio between two colors, 1..21, independent of argument order. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

/** White or navy, whichever reads better on `background`. */
function textOn(background: string): string {
  return contrastRatio(WHITE, background) >= contrastRatio(NAVY, background) ? WHITE : NAVY;
}

/** sRGB mix of `hex` towards white by `amount` (0..1). */
function lighten(hex: string, amount: number): string {
  const mix = (c: number) => c + (255 - c) * amount;
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([mix(r), mix(g), mix(b)]);
}

/**
 * The full color set from the two D-25 source colors. Deterministic and pure: the panel preview, the
 * API save path and the seed all call this one function, so the persisted derivations can never
 * disagree with what a live computation would give.
 */
export function deriveBrandColors(source: { primary: string; secondary: string }): BrandColors {
  const primary = hexColorSchema.parse(source.primary);
  const secondary = hexColorSchema.parse(source.secondary);
  const primaryDark = lighten(primary, PRIMARY_DARK_MIX);
  return {
    primary,
    secondary,
    onPrimary: textOn(primary),
    primaryDark,
    onPrimaryDark: textOn(primaryDark),
  };
}

export type ContrastCheck = { ratio: number; ok: boolean };
export type ContrastReport = {
  /** Text on the primary CTA (AA normal text, 4.5:1). */
  onPrimary: ContrastCheck;
  /** Primary against the light neutral background (UI component, 3:1). */
  lightSurface: ContrastCheck;
  /** The dark-surface variant against the dark neutral background (UI component, 3:1). */
  darkSurface: ContrastCheck;
};

const contrastCheckSchema = z.object({ ratio: z.number().nonnegative(), ok: z.boolean() });
/** Wire shape of `contrastReport()` — carried by the platform tenant detail (D-41 warnings). */
export const contrastReportSchema: z.ZodType<ContrastReport> = z.object({
  onPrimary: contrastCheckSchema,
  lightSurface: contrastCheckSchema,
  darkSurface: contrastCheckSchema,
});

/** The three checks the panel shows as warnings (never blocking) when saving a brand (D-41). */
export function contrastReport(
  colors: Pick<BrandColors, 'primary' | 'onPrimary' | 'primaryDark'>,
): ContrastReport {
  const check = (ratio: number, min: number): ContrastCheck => ({ ratio, ok: ratio >= min });
  return {
    onPrimary: check(contrastRatio(colors.primary, colors.onPrimary), AA_TEXT),
    lightSurface: check(contrastRatio(colors.primary, LIGHT_BG), AA_UI),
    darkSurface: check(contrastRatio(colors.primaryDark, DARK_BG), AA_UI),
  };
}

/**
 * `tenants.branding` (any shape the jsonb may hold, `{}` included) → a complete brand. Missing
 * derivations are recomputed from the two source colors; a missing source color falls back to the
 * neutral TRIA brand. Throws on a MALFORMED value (a bad hex): silently substituting the neutral
 * brand for a configured tenant is the one thing the prohibition forbids, so a corrupt row must be
 * loud, not blue. The panel validates with the same schema before saving, so this only fires on
 * hand-edited data.
 */
export function resolveBranding(raw: unknown): ResolvedBranding {
  const parsed = tenantBrandingSchema.parse(raw ?? {});
  const stored = parsed.colors;
  const derived = deriveBrandColors({
    primary: stored.primary ?? NEUTRAL_BRAND.primary,
    secondary: stored.secondary ?? NEUTRAL_BRAND.secondary,
  });
  return {
    logoUrl: parsed.logoUrl,
    faviconUrl: parsed.faviconUrl,
    iconUrl: parsed.iconUrl,
    iconUrls: parsed.iconUrls,
    iconVersion: parsed.iconVersion,
    colors: {
      primary: derived.primary,
      secondary: derived.secondary,
      onPrimary: stored.onPrimary ?? derived.onPrimary,
      primaryDark: stored.primaryDark ?? derived.primaryDark,
      onPrimaryDark: stored.onPrimaryDark ?? derived.onPrimaryDark,
    },
  };
}

/** The public subset of a resolved brand (drops `iconUrl`/`iconVersion`, which are panel facts). */
export function toHostBranding(branding: ResolvedBranding): HostBranding {
  return {
    logoUrl: branding.logoUrl,
    faviconUrl: branding.faviconUrl,
    iconUrls: branding.iconUrls,
    colors: branding.colors,
  };
}

/** The five CSS custom properties every brand-aware layout sets on its wrapper (T-02-03: fixed keys). */
export const BRAND_STYLE_VARS = [
  '--brand-primary',
  '--brand-secondary',
  '--brand-on-primary',
  '--brand-primary-dark',
  '--brand-on-primary-dark',
] as const;

/**
 * Inline `style` for a layout wrapper: `<div style={brandStyleVars(branding)}>`. Only the five known
 * keys, only validated hex values — the brand never reaches the HTML through any other channel.
 */
export function brandStyleVars(branding: Pick<ResolvedBranding, 'colors'>): Record<string, string> {
  const { colors } = branding;
  return {
    '--brand-primary': colors.primary,
    '--brand-secondary': colors.secondary,
    '--brand-on-primary': colors.onPrimary,
    '--brand-primary-dark': colors.primaryDark,
    '--brand-on-primary-dark': colors.onPrimaryDark,
  };
}

/**
 * Resolves a stored brand URL against an origin: seed fixtures are root-relative (`/seed-logos/x.svg`,
 * served by the web app), uploads are absolute (public `branding` bucket) and pass through unchanged.
 * `null` stays `null` (D-26: the display name renders in place of a missing logo).
 */
export function absoluteBrandUrl(url: string | null | undefined, origin: string): string | null {
  if (!url) return null;
  return new URL(url, origin).toString();
}
