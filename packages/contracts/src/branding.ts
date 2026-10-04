import { z } from 'zod';

/**
 * Tenant brand contract (TENANT-02, D-25/D-26/D-28/D-41).
 *
 * Pure module — no node imports — so client components may import it through
 * `@rede-social/contracts/branding` without pulling `legal.ts` (`node:fs`) into the bundle.
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

// ── The tenant's look beyond the pair (2026-10-03) ───────────────────────────────────────────────
//
// Six settings the tenant wizard used to show in its preview only, persisted since 2026-10-03 in
// the same `tenants.branding` jsonb, under `look` (no migration: the column is jsonb):
//
//  1. the filled action buttons' own colours, the button (`fill`) and its text (`ink`), per theme;
//  2. their style, one for both themes (`'solid'` or `'gradient'`), and a gradient's last colour
//     (`fillEnd`), per theme;
//  3. the ground tone of each theme (`lightTone`, `darkTone`), two CLOSED lists of ids whose
//     colours live in tokens.css alone (Layers 1c and 1d), never a free colour;
//  4. the dark theme's own primary and secondary (`darkColors`);
//  5. the titles' Google Fonts family (`titleFont`);
//  6. the colours of the titles and of the top bar's app name (`fontColors`), per theme.
//
// `null` ALWAYS means the system's own value (the gray and grafite grounds, the derived dark
// primary, the light secondary, Manrope, the theme's text colour, the automatic button), so a brand
// stored before any of this (`{}`, or no `look` key) parses into the all-`null` look and renders
// exactly as before. The rules that turn these values into what a screen paints (which button a
// theme gets, what a gradient's automatic last colour is) are the web app's (`lib/bg-tone.ts`) and
// the kernel's (`@rede-social/core/ui` `button-colors.ts`); this module only says what may be kept.

/** The light theme's ground tones (tokens.css Layer 1c), the system's gray first. */
export const LIGHT_TONES = [
  'cinza',
  'amarelado',
  'laranjado',
  'avermelhado',
  'lilas',
  'azulado',
  'agua',
  'esverdeado',
] as const;
export type LightTone = (typeof LIGHT_TONES)[number];

/** The dark twins of `LIGHT_TONES` (Layer 1d), in the same order (cinza ↔ grafite, amarelado ↔ cafe, …). */
export const DARK_TONES = [
  'grafite',
  'cafe',
  'terracota',
  'vinho',
  'berinjela',
  'azul-noite',
  'petroleo',
  'musgo',
] as const;
export type DarkTone = (typeof DARK_TONES)[number];

/** Today's grounds, the light gray and the dark grafite: kept as `null` (`normalizeBrandLook`). */
export const DEFAULT_LIGHT_TONE: LightTone = 'cinza';
export const DEFAULT_DARK_TONE: DarkTone = 'grafite';

/** The filled buttons' two looks, one for both themes: one colour, or a gradient of two. */
export const BUTTON_STYLES = ['solid', 'gradient'] as const;
export type ButtonStyle = (typeof BUTTON_STYLES)[number];

/** The app's own typeface (self-hosted by the web app): the titles' default, kept as `null`. */
export const DEFAULT_TITLE_FONT = 'Manrope';

/**
 * A title font's family name as it may reach a quoted CSS `font-family` and a Google Fonts URL
 * parameter: words of ASCII letters and digits joined by single spaces, at most 60 characters
 * (Google's longest family is 32). No quote, semicolon, `&`, `=`, parenthesis, slash or accent can
 * pass, so the name can never leave the quoted value or the parameter. Whether it is one of
 * Google's families is the panel's check (the catalogue lives in the web app, `lib/google-fonts.ts`,
 * and the member app falls back to Manrope for a family it does not know); the API holds every
 * name to this shape.
 */
export const FONT_FAMILY_NAME_RE = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/;
export const FONT_FAMILY_NAME_MAX = 60;

export function isFontFamilyName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= FONT_FAMILY_NAME_MAX &&
    FONT_FAMILY_NAME_RE.test(value)
  );
}

export const fontFamilyNameSchema = z
  .string()
  .max(FONT_FAMILY_NAME_MAX)
  .regex(FONT_FAMILY_NAME_RE, 'expected a font family name (letters, digits, single spaces)');

/** One look colour: a `#rrggbb` (lower-cased like every brand hex) or `null` for the system's own. */
const lookHexSchema = hexColorSchema.nullable().default(null);
const lightToneSchema = z.enum(LIGHT_TONES).nullable().default(null);
const darkToneSchema = z.enum(DARK_TONES).nullable().default(null);
const titleFontSchema = fontFamilyNameSchema.nullable().default(null);
const buttonStyleSchema = z.enum(BUTTON_STYLES).default('solid');

/** One colour per theme (the titles, the app name, a button or its text). */
const themeColorsSchema = z.object({ light: lookHexSchema, dark: lookHexSchema });

/**
 * The look as STORED and as every answer carries it (the bootstrap, the public by-host answer, the
 * platform detail): every key optional with its default, so `{}` (or no `look` at all) is the
 * all-`null` look, and unknown keys are dropped rather than refused. Dropped on purpose: a newer
 * API adding a key must never fail an older web's parse of the bootstrap (the rule
 * `bootstrapSchema` states for every additive field). A malformed VALUE (a bad hex, an unknown tone
 * id, an unsafe family name) still throws, like a malformed brand colour (`resolveBranding`): the
 * API validates before writing, so only a hand-edited row can hold one.
 */
export const brandLookSchema = z.object({
  lightTone: lightToneSchema,
  darkTone: darkToneSchema,
  /** The dark theme's own primary (`null`: derived from the light one) and secondary (`null`: the light one). */
  darkColors: z.object({ primary: lookHexSchema, secondary: lookHexSchema }).prefault({}),
  titleFont: titleFontSchema,
  fontColors: z
    .object({ title: themeColorsSchema.prefault({}), appName: themeColorsSchema.prefault({}) })
    .prefault({}),
  /**
   * `style` is both themes'; per theme the button (a gradient's first colour), a gradient's last
   * colour and the text. A solid button ignores `fillEnd` but keeps it, so turning the gradient
   * back on restores it.
   */
  buttonColors: z
    .object({
      style: buttonStyleSchema,
      fill: themeColorsSchema.prefault({}),
      fillEnd: themeColorsSchema.prefault({}),
      ink: themeColorsSchema.prefault({}),
    })
    .prefault({}),
});
/** A complete look: every key present, each `null` (or `'solid'`) where the system's value holds. */
export type BrandLook = z.output<typeof brandLookSchema>;
export type BrandThemeColors = BrandLook['fontColors']['title'];

/** The all-default look (a fresh object each call). */
export function emptyBrandLook(): BrandLook {
  return brandLookSchema.parse({});
}

/**
 * The canonical form of a look: the default ids (`cinza`, `grafite`) and the default family
 * (`Manrope`) read as `null`, so "the system's own" has ONE spelling in storage and on the wire.
 */
export function normalizeBrandLook(look: BrandLook): BrandLook {
  return {
    ...look,
    lightTone: look.lightTone === DEFAULT_LIGHT_TONE ? null : look.lightTone,
    darkTone: look.darkTone === DEFAULT_DARK_TONE ? null : look.darkTone,
    titleFont: look.titleFont === DEFAULT_TITLE_FONT ? null : look.titleFont,
  };
}

/**
 * The public brand facts carried by `GET /v1/public/tenants/by-host` (T-02-04): logo, favicon, the
 * icon set, the five colors and, since 2026-10-03, the look (so the logged-out pages show the
 * tenant's grounds, buttons and title font before any session exists). Strict at the top level —
 * nothing beyond brand facts may leak into the public answer; the look is built by the API from the
 * resolved brand (`toHostBranding`), so it carries its known keys only. Optional for the reader: an
 * answer without it (an API older than the web) still parses, and `resolveBranding` reads the
 * missing look as the all-default one.
 */
export const hostBrandingSchema = z
  .object({
    logoUrl: z.string().nullable(),
    faviconUrl: z.string().nullable(),
    iconUrls: brandIconUrlsSchema.nullable(),
    colors: brandColorsSchema,
    look: brandLookSchema.optional(),
  })
  .strict();
export type HostBranding = z.infer<typeof hostBrandingSchema>;

/**
 * The `tenants.branding` jsonb. Every field is optional with a default so `{}` (a tenant created
 * before its brand was configured, edge TENANT-02/empty) parses; `iconUrl` is the optional square
 * override (D-28) and `iconVersion` busts icon caches when the set is re-derived. `look` (2026-10-03)
 * is the all-default look when absent (`brandLookSchema`).
 */
export const tenantBrandingSchema = z.object({
  logoUrl: z.string().nullable().default(null),
  faviconUrl: z.string().nullable().default(null),
  iconUrl: z.string().nullable().default(null),
  iconUrls: brandIconUrlsSchema.nullable().default(null),
  iconVersion: z.number().int().nonnegative().default(0),
  colors: brandColorsSchema.partial().default({}),
  look: brandLookSchema.prefault({}),
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
  /**
   * The five colours. `primaryDark` / `onPrimaryDark` are the accent the dark theme paints: the dark
   * mode's own primary with the ink that reads on it when the look has one, else the derivation.
   */
  colors: BrandColors;
  /** The look beyond the pair, canonical (`normalizeBrandLook`); all `null` for an older brand. */
  look: BrandLook;
};

/** the platform's neutral fallback — visible only on generic hosts and on tenants with no brand yet. */
export const NEUTRAL_BRAND = { primary: '#2e6fd0', secondary: '#5b9cf8' } as const;
/** Neutral surfaces the contrast report checks against (prototype light/dark `--theme-bg`). */
export const LIGHT_BG = '#f5f7fb';
export const DARK_BG = '#0f1118';
/** The dark text candidate for `onPrimary` (prototype `--theme-text`, light mode). */
export const NAVY = '#16233b';
export const WHITE = '#ffffff';
/** Per-device theme preference cookie (D-41), readable by the server for the first HTML. */
export const THEME_COOKIE = 'rede_theme';

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

/**
 * `colors` with the dark theme's accent replaced by the tenant's own dark primary (the look's
 * `darkColors.primary`), with the white or navy that reads on it exactly as for any primary;
 * `colors` itself when there is none, so the derivation stands. The ONE place the persisted
 * `primaryDark` / `onPrimaryDark` follow the look: the look's save, a pair save (an own dark primary
 * survives a new light primary, an automatic one follows it), the creation and `resolveBranding`.
 */
export function withDarkPrimary(
  colors: BrandColors,
  darkPrimary: string | null | undefined,
): BrandColors {
  if (!darkPrimary) return colors;
  const own = deriveBrandColors({ primary: darkPrimary, secondary: colors.secondary });
  return { ...colors, primaryDark: own.primary, onPrimaryDark: own.onPrimary };
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
 * neutral platform brand. Throws on a MALFORMED value (a bad hex): silently substituting the neutral
 * brand for a configured tenant is the one thing the prohibition forbids, so a corrupt row must be
 * loud, not blue. The panel validates with the same schema before saving, so this only fires on
 * hand-edited data.
 *
 * The look (2026-10-03) comes out canonical (`normalizeBrandLook`), and its own dark primary wins
 * over the persisted dark accent (`withDarkPrimary`): the API keeps the two in step on every write,
 * and a row where they disagree still renders the look it says.
 */
export function resolveBranding(raw: unknown): ResolvedBranding {
  const parsed = tenantBrandingSchema.parse(raw ?? {});
  const stored = parsed.colors;
  const derived = deriveBrandColors({
    primary: stored.primary ?? NEUTRAL_BRAND.primary,
    secondary: stored.secondary ?? NEUTRAL_BRAND.secondary,
  });
  const look = normalizeBrandLook(parsed.look);
  return {
    logoUrl: parsed.logoUrl,
    faviconUrl: parsed.faviconUrl,
    iconUrl: parsed.iconUrl,
    iconUrls: parsed.iconUrls,
    iconVersion: parsed.iconVersion,
    colors: withDarkPrimary(
      {
        primary: derived.primary,
        secondary: derived.secondary,
        onPrimary: stored.onPrimary ?? derived.onPrimary,
        primaryDark: stored.primaryDark ?? derived.primaryDark,
        onPrimaryDark: stored.onPrimaryDark ?? derived.onPrimaryDark,
      },
      look.darkColors.primary,
    ),
    look,
  };
}

/**
 * The public subset of a resolved brand (drops `iconUrl`/`iconVersion`, which are panel facts). The
 * look goes out whole: every value in it is a brand fact the logged-out pages paint.
 */
export function toHostBranding(branding: ResolvedBranding): HostBranding {
  return {
    logoUrl: branding.logoUrl,
    faviconUrl: branding.faviconUrl,
    iconUrls: branding.iconUrls,
    colors: branding.colors,
    look: branding.look,
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

// ── Branding uploads and colours (02-13, D-27/D-28/D-41) ─────────────────────────────────────────
//
// The platform's brand mutations: `POST …/branding/uploads` (a signed Storage URL for the browser),
// `POST …/branding/uploads/{uploadId}/complete`, `PUT …/branding/colors` and
// `DELETE …/branding/icon`. Pure like the rest of this file — the panel imports it through
// `@rede-social/contracts/branding` for its client-side size/mime pre-checks.

/** D-27: the four accepted logo/icon formats. Storage enforces the same allow-list at PUT time. */
export const BRANDING_UPLOAD_MIMES = [
  'image/png',
  'image/svg+xml',
  'image/webp',
  'image/jpeg',
] as const;
export const brandingUploadMimeSchema = z.enum(BRANDING_UPLOAD_MIMES);
export type BrandingUploadMime = z.infer<typeof brandingUploadMimeSchema>;

/** D-27: "order of 2 MB" — the bucket's `file_size_limit` and the 413 threshold agree on this value. */
export const BRANDING_MAX_BYTES = 2 * 1024 * 1024;

/** `logo` (the wordmark shown everywhere) or `icon` (the optional square override of the derived set, D-28). */
export const BRANDING_UPLOAD_KINDS = ['logo', 'icon'] as const;
export type BrandingUploadKind = (typeof BRANDING_UPLOAD_KINDS)[number];

/** The object-key extension of each accepted mime (one canonical extension per format). */
export const mimeToExtension: Record<BrandingUploadMime, 'png' | 'svg' | 'webp' | 'jpg'> = {
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
};

/**
 * Body of `POST /v1/platform/tenants/{id}/branding/uploads`. No maximum on `size` here on purpose:
 * an oversized file is answered 413 by the route (a size problem, not a shape problem), so the
 * validator only requires a positive integer.
 */
export const brandingUploadBodySchema = z
  .object({
    kind: z.enum(BRANDING_UPLOAD_KINDS),
    mime: brandingUploadMimeSchema,
    size: z.number().int().positive(),
  })
  .strict();
export type BrandingUploadBody = z.infer<typeof brandingUploadBodySchema>;

/** 201 answer of the upload start: the browser PUTs the file to `signedUrl`, then completes with `uploadId`. */
export const brandingUploadSchema = z
  .object({
    uploadId: z.string(),
    signedUrl: z.url(),
    path: z.string(),
    maxBytes: z.number().int(),
    expiresInSeconds: z.number().int(),
  })
  .strict();
export type BrandingUpload = z.infer<typeof brandingUploadSchema>;

/**
 * The stateless upload id: `<kind>-<uuid>.<ext>`. Everything `complete` needs is in the id, and the
 * object's existence under the tenant's own prefix is the proof of a legitimate upload (T-02-83:
 * no path separators can ever pass).
 */
export const BRANDING_UPLOAD_ID_RE =
  /^(logo|icon)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|svg|webp|jpg)$/;
export const brandingUploadIdSchema = z.string().regex(BRANDING_UPLOAD_ID_RE);
export const brandingUploadParamsSchema = z.object({
  id: z.uuid(),
  uploadId: brandingUploadIdSchema,
});
export type BrandingUploadParams = z.infer<typeof brandingUploadParamsSchema>;

/** The `details.upload` vocabulary of a refused `complete` (400) or a missing object (404). */
export const BRANDING_UPLOAD_ISSUES = [
  'not_an_image',
  'format_mismatch',
  'svg_unsafe',
  'too_large',
  'object_missing',
] as const;
export type BrandingUploadIssue = (typeof BRANDING_UPLOAD_ISSUES)[number];

/**
 * Body of `PUT /v1/platform/tenants/{id}/branding/colors` (D-25/D-41). A low-contrast pair is never
 * refused outright: without `confirmLowContrast: true` the API answers 400
 * `{ confirmLowContrast: 'required', contrastReport }` so the panel can warn and ask.
 */
export const brandingColorsBodySchema = z
  .object({
    primary: hexColorSchema,
    secondary: hexColorSchema,
    confirmLowContrast: z.boolean().optional(),
  })
  .strict();
export type BrandingColorsBody = z.infer<typeof brandingColorsBodySchema>;

/** `themeColorsSchema`, strict: a body naming a third theme is refused, not trimmed. */
const themeColorsBodySchema = z.object({ light: lookHexSchema, dark: lookHexSchema }).strict();

/**
 * Body of `PUT /v1/platform/tenants/{id}/branding/look` (2026-10-03) and the optional `look` of
 * `POST /v1/platform/tenants` (the wizard's "Criar tenant"): the WHOLE look, which replaces the
 * stored one (PUT semantics). Strict at every level, so a misspelt key is a 400 instead of a value
 * silently dropped; a key left out takes its default (the system's own value), so `{}` resets the
 * whole look. The values are checked exactly as `brandLookSchema` reads them back: `#rrggbb`
 * colours (lower-cased), tone ids from the two closed lists, `'solid'` or `'gradient'`, and a
 * family name safe for CSS and a URL (`fontFamilyNameSchema`).
 *
 * The look never gates on contrast: the pair keeps its own confirmation (`brandingColorsBodySchema`
 * on `PUT …/branding/colors`), and the look's colours are measured where they are chosen, as in the
 * wizard. Nothing here touches the logo, the icons or the pair.
 */
export const brandingLookBodySchema = z
  .object({
    lightTone: lightToneSchema,
    darkTone: darkToneSchema,
    darkColors: z
      .object({ primary: lookHexSchema, secondary: lookHexSchema })
      .strict()
      .prefault({}),
    titleFont: titleFontSchema,
    fontColors: z
      .object({
        title: themeColorsBodySchema.prefault({}),
        appName: themeColorsBodySchema.prefault({}),
      })
      .strict()
      .prefault({}),
    buttonColors: z
      .object({
        style: buttonStyleSchema,
        fill: themeColorsBodySchema.prefault({}),
        fillEnd: themeColorsBodySchema.prefault({}),
        ink: themeColorsBodySchema.prefault({}),
      })
      .strict()
      .prefault({}),
  })
  .strict();
/** What a client sends (any key may be left out); the route works on the parsed, complete look. */
export type BrandingLookBody = z.input<typeof brandingLookBodySchema>;

/** True when every check of a `contrastReport()` passes (the API gate and the panel share it). */
export function contrastPasses(report: ContrastReport): boolean {
  return report.onPrimary.ok && report.lightSurface.ok && report.darkSurface.ok;
}

/**
 * True when the persisted icon set was derived for the CURRENT `iconVersion` (derived keys live
 * under `/icons/<iconVersion>/`). False right after an upload or a primary-colour change until the
 * worker's `kernel.branding-derive-icons` job writes the new set — the panel shows "gerando ícones…".
 */
export function iconsUpToDate(branding: {
  iconUrls: BrandIconUrls | null;
  iconVersion: number;
}): boolean {
  return branding.iconUrls?.i512.includes(`/icons/${branding.iconVersion}/`) ?? false;
}
