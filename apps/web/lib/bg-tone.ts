import {
  type BrandLook,
  BUTTON_STYLES,
  type ButtonStyle,
  contrastRatio,
  DARK_TONES,
  type DarkTone,
  DEFAULT_DARK_TONE,
  DEFAULT_LIGHT_TONE,
  deriveBrandColors,
  isFontFamilyName,
  LIGHT_TONES,
  type LightTone,
  NEUTRAL_BRAND,
  normalizeBrandLook,
} from '@rede-social/contracts/branding';
import { BUTTON_COLOR_KEYS, buttonInk, buttonRampEnd, buttonThemeVars } from '@rede-social/core/ui';

export type { ButtonStyle, DarkTone, LightTone } from '@rede-social/contracts/branding';
export { DARK_TONES, DEFAULT_DARK_TONE, DEFAULT_LIGHT_TONE, LIGHT_TONES };

/**
 * The look of the tenant beyond the brand pair: the ground tone of the light screens (2026-10-02),
 * the dark mode's own colours (primary, secondary and ground tone), the colours of the titles and
 * of the app name in the top bar, and (2026-10-03) the filled action buttons' own colours, the
 * button and the text on it, each per theme, the button solid or a gradient of two colours. With
 * the title font (`lib/title-font.ts`) they are the six settings the tenant wizard used to show in
 * its preview only; since 2026-10-03 they are KEPT, in the brand contract's `look`
 * (`@rede-social/contracts/branding`, which owns the closed lists re-exported here): the wizard's
 * creation sends them, the Marca tab edits them, and the app paints them (`appBrandLook`), so the
 * preview's rules below are also the app's.
 *
 * The tones are FIXED palettes, never a free colour (the owner's rule): only ids travel, as
 * `data-bg-tone` / `data-dark-tone` on a scope, and their values live in tokens.css (Layers 1c and
 * 1d), the one file allowed colour literals. A swatch draws a tone with no hex either: an element
 * carrying `data-bg-tone="<id>"` and `bg-[var(--tone-ground)]` (light) or `data-dark-tone="<id>"`
 * and `bg-[var(--dtone-ground)]` (dark). The colours are hexes the owner types, so every one is
 * checked here (`isHexColor`) before it reaches a style; the guards use `includes`, never `in`, so
 * an inherited key like `constructor` is never an id.
 *
 * `null` always means the system's own value: the gray (cinza) and grafite grounds, the derived
 * dark primary, the light secondary, the theme's text colour, the automatic button (the theme's
 * accent with its ink; in dark, the light button when there is one; a gradient's, the theme's
 * primary to that colour moved 30% away from its text, `buttonRampEnd`, never a secondary). The
 * default ids therefore read back as `null` and never reach a screen (only their swatches carry
 * them), and a draft without any of this renders exactly as before.
 *
 * The buttons' rule lives here (`resolveButtonPairs`): the dark mode INHERITS the light button,
 * its text included, until it gets a button of its own (the reference's gold button is the same in
 * both themes), and a text left automatic is the white or navy that reads on its button. A gradient
 * follows the same rule colour by colour, and since CSS has no gradient to fall back to, it always
 * goes out complete. The kernel spells the result (`buttonThemeVars`, `@rede-social/core/ui`): raw
 * keys per theme that tokens.css reads into `bg-button` and the button image on the scope of that
 * theme, and nothing else (chips, tabs, switches, links) changes colour.
 */

export function isLightTone(value: unknown): value is LightTone {
  return typeof value === 'string' && (LIGHT_TONES as readonly string[]).includes(value);
}

export function isDarkTone(value: unknown): value is DarkTone {
  return typeof value === 'string' && (DARK_TONES as readonly string[]).includes(value);
}

/** One of the buttons' two looks (`'solid'`, `'gradient'`); anything else is neither. */
export function isButtonStyle(value: unknown): value is ButtonStyle {
  return typeof value === 'string' && (BUTTON_STYLES as readonly string[]).includes(value);
}

/** `#rrggbb`, either case: the only colour shape that reaches a style. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

/**
 * One colour per theme (the titles, the app name, a button or its text); `null` keeps that theme's
 * own colour.
 */
export type ThemeColors = { light: string | null; dark: string | null };

/** The dark mode's own colours; each `null` follows the system. */
export type DarkColors = {
  /** The accent on dark surfaces; `null` for the one derived from the light primary. */
  primary: string | null;
  /** `null` for the light secondary. */
  secondary: string | null;
  /** `null` for the grafite. */
  tone: DarkTone | null;
};

export type FontColors = {
  /** The titles (`data-preview-title`), the app name in the top bar apart. */
  title: ThemeColors;
  /** The app name in the top bar (`data-preview-app-name`), drawn when there is no logo. */
  appName: ThemeColors;
};

/** The filled action buttons' own colours ("Entrar", "Completar agora", the create buttons). */
export type ButtonColors = {
  /**
   * One look for both themes: `'solid'`, the default (one colour, today's button), or
   * `'gradient'` (two colours, at the brand gradient's 135deg).
   */
  style: ButtonStyle;
  /**
   * The button, a gradient's FIRST colour; `null`: the theme's accent (a gradient's: the theme's
   * primary), or in dark the light one when there is one.
   */
  fill: ThemeColors;
  /**
   * A gradient's LAST colour; `null`: automatic, the first colour moved 30% away from its text
   * (`buttonRampEnd`), never a secondary; in dark, the light one when there is one. A solid button
   * ignores it but keeps it, so going back to the gradient restores it.
   */
  fillEnd: ThemeColors;
  /** The text on it; `null`: the white or navy that reads on the button, or the light one's. */
  ink: ThemeColors;
};

export function emptyDarkColors(): DarkColors {
  return { primary: null, secondary: null, tone: null };
}

export function emptyFontColors(): FontColors {
  return { title: { light: null, dark: null }, appName: { light: null, dark: null } };
}

export function emptyButtonColors(): ButtonColors {
  return {
    style: 'solid',
    fill: { light: null, dark: null },
    fillEnd: { light: null, dark: null },
    ink: { light: null, dark: null },
  };
}

/** A valid hex, lower-cased (the API's canonical form), or `null`. */
export function hexOrNull(value: unknown): string | null {
  return isHexColor(value) ? value.toLowerCase() : null;
}

/** A light tone worth keeping: a known id other than the default, else `null`. */
export function lightToneOrNull(value: unknown): LightTone | null {
  return isLightTone(value) && value !== DEFAULT_LIGHT_TONE ? value : null;
}

/** A dark tone worth keeping: a known id other than the default, else `null`. */
export function darkToneOrNull(value: unknown): DarkTone | null {
  return isDarkTone(value) && value !== DEFAULT_DARK_TONE ? value : null;
}

function fields(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** The dark colours of a STORED draft (any shape): what is not valid comes back as `null`. */
export function readDarkColors(value: unknown): DarkColors {
  const saved = fields(value);
  return {
    primary: hexOrNull(saved.primary),
    secondary: hexOrNull(saved.secondary),
    tone: darkToneOrNull(saved.tone),
  };
}

/** One colour per theme of a STORED draft (any shape): what is not a valid hex is `null`. */
function readThemeColors(value: unknown): ThemeColors {
  const colors = fields(value);
  return { light: hexOrNull(colors.light), dark: hexOrNull(colors.dark) };
}

/** The font colours of a STORED draft (any shape): what is not valid comes back as `null`. */
export function readFontColors(value: unknown): FontColors {
  const saved = fields(value);
  return { title: readThemeColors(saved.title), appName: readThemeColors(saved.appName) };
}

/**
 * The button colours of a STORED draft (any shape): what is not valid comes back as `null`, and a
 * style that is not one of the two as solid, so a draft saved before the gradient (no style, no
 * last colour) reads back as the solid button it was.
 */
export function readButtonColors(value: unknown): ButtonColors {
  const saved = fields(value);
  return {
    style: isButtonStyle(saved.style) ? saved.style : 'solid',
    fill: readThemeColors(saved.fill),
    fillEnd: readThemeColors(saved.fillEnd),
    ink: readThemeColors(saved.ink),
  };
}

/**
 * The preview's copy of a colour being typed, as the draft keeps the brand pair: a valid hex
 * replaces it, `null` (the reset to the system's colour) clears it, anything else (a hex half
 * typed) keeps the last valid one, so the phone never flashes back to the default mid-word.
 */
function settle(next: string | null, previous: string | null): string | null {
  if (next === null) return null;
  return isHexColor(next) ? next.toLowerCase() : previous;
}

/** Both themes of one colour settled; `previous` itself when neither changed. */
function settleThemeColors(next: ThemeColors, previous: ThemeColors): ThemeColors {
  const light = settle(next.light, previous.light);
  const dark = settle(next.dark, previous.dark);
  return light === previous.light && dark === previous.dark ? previous : { light, dark };
}

/** `next` as the preview may show it; `previous` itself when nothing changed (a stable reference). */
export function settleDarkColors(next: DarkColors, previous: DarkColors): DarkColors {
  const primary = settle(next.primary, previous.primary);
  const secondary = settle(next.secondary, previous.secondary);
  const tone = next.tone === null || isDarkTone(next.tone) ? next.tone : previous.tone;
  return primary === previous.primary && secondary === previous.secondary && tone === previous.tone
    ? previous
    : { primary, secondary, tone };
}

/** `next` as the preview may show it; `previous` itself when nothing changed (a stable reference). */
export function settleFontColors(next: FontColors, previous: FontColors): FontColors {
  const title = settleThemeColors(next.title, previous.title);
  const appName = settleThemeColors(next.appName, previous.appName);
  return title === previous.title && appName === previous.appName ? previous : { title, appName };
}

/**
 * `next` as the preview may show it (an unknown style keeps the previous one); `previous` itself
 * when nothing changed (a stable reference).
 */
export function settleButtonColors(next: ButtonColors, previous: ButtonColors): ButtonColors {
  const style = isButtonStyle(next.style) ? next.style : previous.style;
  const fill = settleThemeColors(next.fill, previous.fill);
  const fillEnd = settleThemeColors(next.fillEnd, previous.fillEnd);
  const ink = settleThemeColors(next.ink, previous.ink);
  return style === previous.style &&
    fill === previous.fill &&
    fillEnd === previous.fillEnd &&
    ink === previous.ink
    ? previous
    : { style, fill, fillEnd, ink };
}

/** Button colours as a caller may hold them (a published preview, a draft): any of it missing. */
export type ButtonColorsInput = {
  style?: ButtonStyle | null;
  fill?: Partial<ThemeColors> | null;
  fillEnd?: Partial<ThemeColors> | null;
  ink?: Partial<ThemeColors> | null;
} | null;

/** A gradient button as it reaches a style: always both of its colours, with the text on them. */
export type GradientButton = { style: 'gradient'; fill: string; fillEnd: string; ink: string };

/**
 * One theme's buttons as they reach a style. Solid: the button with the text on it, or the text
 * alone (the button stays the theme's accent), never a button without its text. A gradient is
 * always whole (`GradientButton`).
 */
export type ResolvedButton = { style?: undefined; fill?: string; ink: string } | GradientButton;

export type ResolvedButtons = { light: ResolvedButton | null; dark: ResolvedButton | null };

/** The pair `deriveBrandColors` takes: the tenant's when both are valid hexes, else the neutral. */
function brandPair(colors: { primary: string; secondary: string }) {
  const primary = hexOrNull(colors.primary);
  const secondary = hexOrNull(colors.secondary);
  return primary && secondary
    ? { primary, secondary }
    : { primary: NEUTRAL_BRAND.primary, secondary: NEUTRAL_BRAND.secondary };
}

/** The dark mode takes the light mode's colour while it has none of its own. */
function takesLight(colors: ThemeColors): boolean {
  return !colors.dark && Boolean(colors.light);
}

/**
 * The dark mode takes the light gradient's text while its first colour is the light one's and its
 * last colour is not its own: then it is the very same gradient as the light one. A dark text of
 * its own replaces that text, and an automatic last colour moves away from it instead: from one on
 * the other side of the first colour, the other way, no longer the light one's colour.
 */
function darkTakesLightGradient(set: ButtonColors): boolean {
  return takesLight(set.fill) && !set.fillEnd.dark;
}

/**
 * A gradient's two themes. The FIRST colour is the theme's own, else (in dark) the light one's,
 * else the theme's accent: the tenant's primary in light, the dark mode's own primary (or the one
 * derived from the light primary) in dark. The LAST colour is the theme's own, else (in dark) the
 * light one's, else automatic: the first colour moved 30% away from the text that reads on it
 * (`buttonRampEnd`, the reference's ramp of one hue), never the secondary, whose distance from the
 * primary left any single text unreadable at one end (the neutral pair read 3.2:1 at worst). So
 * an untouched gradient reads exactly as well as the solid button of its first colour. The text
 * is the theme's own, else in a dark mode that is the light gradient (`darkTakesLightGradient`)
 * the light text, else the white or navy that reads best on both colours (`buttonInk`).
 */
function resolveGradient(
  set: ButtonColors,
  colors: { primary: string; secondary: string },
  darkColors: Partial<DarkColors> | null | undefined,
): { light: GradientButton; dark: GradientButton } {
  const derived = deriveBrandColors(brandPair(colors));
  const lightFill = set.fill.light ?? derived.primary;
  const lightEnd =
    set.fillEnd.light ??
    buttonRampEnd(lightFill, set.ink.light ?? buttonInk(lightFill)) ??
    lightFill;
  const light: GradientButton = {
    style: 'gradient',
    fill: lightFill,
    fillEnd: lightEnd,
    ink: set.ink.light ?? buttonInk(lightFill, lightEnd),
  };
  const darkFill =
    set.fill.dark ?? set.fill.light ?? hexOrNull(darkColors?.primary) ?? derived.primaryDark;
  const asLight = darkTakesLightGradient(set);
  const darkEnd =
    set.fillEnd.dark ??
    set.fillEnd.light ??
    buttonRampEnd(darkFill, set.ink.dark ?? (asLight ? light.ink : buttonInk(darkFill))) ??
    darkFill;
  const dark: GradientButton = {
    style: 'gradient',
    fill: darkFill,
    fillEnd: darkEnd,
    ink: set.ink.dark ?? (asLight ? light.ink : buttonInk(darkFill, darkEnd)),
  };
  return { light, dark };
}

/**
 * The buttons of each theme from the colours the tenant set, the rule of the "Botões" card:
 *
 * - solid, light: its own button, with its own text or else the white or navy that reads on it
 *   (`buttonInk`, exactly as `deriveBrandColors` picks it for any primary); a text alone stays
 *   alone;
 * - solid, dark: its own button, with its own text or the one that reads on it; WITHOUT its own
 *   button it inherits the light one, text included (unless it has its own text), since the
 *   reference's button is the same in both themes; a text alone stays alone;
 * - solid, a theme with nothing set: `null`, the accent and its ink, as today;
 * - gradient: BOTH themes, always whole, colour by colour by the same rule (`resolveGradient`),
 *   the automatic first colour the theme's primary (the tenant's; in dark, the dark mode's own or
 *   the derived one) and the automatic last colour its ramp (`buttonRampEnd`), never a secondary.
 *
 * Every value is re-checked (`readButtonColors`: any shape, valid hexes only, solid unless the
 * style says gradient), so a half-typed or foreign value counts as unset; a pair that is not two
 * valid hexes is replaced by the neutral one, so this never throws.
 */
export function resolveButtonPairs({
  buttonColors,
  colors,
  darkColors,
}: {
  buttonColors?: ButtonColorsInput;
  /**
   * The tenant's last valid pair: its primary is a gradient's automatic first colour (in dark,
   * once derived); its secondary only completes the pair `deriveBrandColors` takes. A solid
   * button falls back to the theme's accent in CSS and needs none of it.
   */
  colors: { primary: string; secondary: string };
  /**
   * The dark mode's own colours: its primary is a dark gradient's automatic first colour; its
   * secondary and its ground paint no button.
   */
  darkColors?: Partial<DarkColors> | null;
}): ResolvedButtons {
  const set = readButtonColors(buttonColors);
  if (set.style === 'gradient') return resolveGradient(set, colors, darkColors);
  const { fill, ink } = set;
  const light: ResolvedButton | null = fill.light
    ? { fill: fill.light, ink: ink.light ?? buttonInk(fill.light) }
    : ink.light
      ? { ink: ink.light }
      : null;
  const dark: ResolvedButton | null = fill.dark
    ? { fill: fill.dark, ink: ink.dark ?? buttonInk(fill.dark) }
    : light?.fill
      ? { fill: light.fill, ink: ink.dark ?? light.ink }
      : ink.dark
        ? { ink: ink.dark }
        : null;
  return { light, dark };
}

/** Where a colour the buttons show comes from: set for this theme, the light mode's, automatic. */
export type ButtonSource = 'own' | 'light' | 'auto';

/** What a theme's buttons show, every colour a valid hex, and where each one comes from. */
export type ButtonLook = {
  style: ButtonStyle;
  /** The button; a gradient's first colour. */
  fill: string;
  /** A gradient's last colour; a solid button's one colour again (a gradient of a single colour). */
  fillEnd: string;
  ink: string;
  from: { fill: ButtonSource; fillEnd: ButtonSource; ink: ButtonSource };
};

/**
 * The buttons as the phone paints them, per theme, for what the "Botões" card shows (its samples,
 * the automatic colours of its fields, the contrast of the text on the button): the resolved
 * buttons (`resolveButtonPairs`) completed with what the theme falls back to, the light primary
 * with its ink, and in dark the dark accent (the dark mode's own primary, or the one derived from
 * the light primary) with the ink that reads on it. A gradient is whole already. `from` says which
 * values are the tenant's, which the dark mode takes from the light one, and which are automatic,
 * and says "the light one's" only beside the very colour the light mode shows (a gradient's dark
 * text is the light one's while its first colour is and its last colour is not its own; its
 * automatic last colour, while the ramp comes out as the light one's: a dark text of its own on
 * the other side of the first colour turns it the other way).
 *
 * A pair that is not two valid hexes is replaced by the neutral one, so this never throws.
 */
export function effectiveButtonColors({
  colors,
  darkColors,
  buttonColors,
}: {
  /** The tenant's last VALID pair. */
  colors: { primary: string; secondary: string };
  darkColors?: Partial<DarkColors> | null;
  buttonColors?: ButtonColorsInput;
}): Record<'light' | 'dark', ButtonLook> {
  const pair = brandPair(colors);
  const derived = deriveBrandColors(pair);
  const set = readButtonColors(buttonColors);
  const source = (value: string | null, inherited: boolean): ButtonSource =>
    value ? 'own' : inherited ? 'light' : 'auto';
  // The dark mode takes the light button while it has none of its own (its text too, then).
  const takesFill = takesLight(set.fill);

  if (set.style === 'gradient') {
    const { light, dark } = resolveGradient(set, pair, darkColors);
    // The dark last colour is the light one's when inherited, and when it is the automatic ramp of
    // the inherited first colour that comes out as the very same colour: under the inherited text,
    // or a dark text of its own on the same side of it. One on the other side turns the ramp the
    // other way, a colour the light mode does not show: the dark mode's own automatic one, then.
    const asLight = darkTakesLightGradient(set);
    const takesEnd = takesLight(set.fillEnd) || (asLight && dark.fillEnd === light.fillEnd);
    return {
      light: {
        ...light,
        from: {
          fill: source(set.fill.light, false),
          fillEnd: source(set.fillEnd.light, false),
          ink: source(set.ink.light, false),
        },
      },
      dark: {
        ...dark,
        from: {
          fill: source(set.fill.dark, takesFill),
          fillEnd: source(set.fillEnd.dark, takesEnd),
          ink: source(set.ink.dark, asLight),
        },
      },
    };
  }

  const resolved = resolveButtonPairs({ buttonColors: set, colors: pair });
  const darkAccent = hexOrNull(darkColors?.primary) ?? derived.primaryDark;
  const lightFill = resolved.light?.fill ?? derived.primary;
  const darkFill = resolved.dark?.fill ?? darkAccent;
  const lightFrom = source(set.fill.light, false);
  const darkFrom = source(set.fill.dark, takesFill);
  return {
    light: {
      style: 'solid',
      fill: lightFill,
      fillEnd: lightFill,
      ink: resolved.light?.ink ?? derived.onPrimary,
      from: { fill: lightFrom, fillEnd: lightFrom, ink: source(set.ink.light, false) },
    },
    dark: {
      style: 'solid',
      fill: darkFill,
      fillEnd: darkFill,
      ink: resolved.dark?.ink ?? buttonInk(darkAccent),
      from: { fill: darkFrom, fillEnd: darkFrom, ink: source(set.ink.dark, takesFill) },
    },
  };
}

/**
 * The contrast of a button's text where it reads WORST: the lower of its two colours' (a
 * gradient's label crosses both; a solid button's two are one), the ratio the "Botões" card's pill
 * holds to AA. Valid hexes only, as `contrastRatio` (an `effectiveButtonColors` look always is).
 */
export function buttonTextContrast(look: Pick<ButtonLook, 'fill' | 'fillEnd' | 'ink'>): number {
  return Math.min(contrastRatio(look.fill, look.ink), contrastRatio(look.fillEnd, look.ink));
}

/** What the preview phone's screen element carries; an absent key is not rendered. */
export type PreviewScreenAttributes = {
  'data-bg-tone'?: LightTone;
  'data-dark-tone'?: DarkTone;
  /** The screen's style carries `--preview-title-color` (globals.css hands it to the titles). */
  'data-title-color'?: '';
  /** The screen's style carries `--preview-app-name-color` (the top bar's app name). */
  'data-app-name-color'?: '';
};

export type PreviewScreenLook = {
  attributes: PreviewScreenAttributes;
  /** Custom properties for the screen's inline style, spread AFTER the brand variables. */
  style: Record<string, string>;
};

/**
 * The preview phone's screen for the CURRENT preview theme (`TenantPreviewPanel`):
 *
 * - both tone ids whenever they are set, whatever the theme: tokens.css applies each one only
 *   under its own theme, so switching the theme never re-renders the attributes;
 * - in dark only, the dark primary with the ink that reads on it (`deriveBrandColors(...)
 *   .onPrimary`, white or navy as for any primary), and the dark secondary as `--brand-secondary`.
 *   The dark primary takes BOTH primaries: `--brand-primary-dark` (the accent a dark scope paints)
 *   and `--brand-primary` with `--brand-on-primary`, which a dark scope reads only through the
 *   brand gradient (its ink), the hover shade (`--brand-primary-hover`) and the preview art. Set
 *   on the accent alone, a dark screen would pair the dark accent with the LIGHT primary's
 *   gradient and art, and a brand button would flip to the light primary's hue on hover. In
 *   light the screen keeps the tenant's derived pair, so even the dark media scopes of a light
 *   screen (the reels stage, its nav) show what the app shows today;
 * - the title and app-name colours of THIS theme, each with its marker attribute, which is what
 *   globals.css keys on: no marker, no rule, so an unset colour leaves the inks alone;
 * - the buttons' raw keys of BOTH themes whatever the theme (`resolveButtonPairs`, spelled by the
 *   kernel's `buttonThemeVars`): tokens.css reads the one of each scope's own theme, so the dark
 *   media scopes of a light screen (the reels stage) show the dark buttons, as the app would. No
 *   marker is needed: without a key, `bg-button` falls back to the accent, exactly as today. One
 *   solid case needs the dark fill spelled out: a dark TEXT set alone, with the dark mode's own
 *   primary. A light screen keeps the DERIVED dark accent (above), so that text would land in the
 *   reels stage on a button the dark screen never shows; the stage gets the dark screen's button
 *   instead, the dark primary with today's hover shade over it. A gradient needs no such care: its
 *   dark keys are always whole, its automatic first colour the dark mode's own primary (or the
 *   derived one) and its last colour that one's ramp, so the stage of a light screen paints
 *   exactly the dark screen's gradient.
 *
 * Everything is re-checked here (ids by the guards, colours by `isHexColor`): a value that does
 * not pass is simply left out, never guessed.
 */
export function previewScreenLook({
  theme,
  colors,
  lightTone,
  darkColors,
  fontColors,
  buttonColors,
}: {
  theme: 'light' | 'dark';
  /** The tenant's valid light pair (`deriveBrandColors` takes one; a gradient falls back to it). */
  colors: { primary: string; secondary: string };
  lightTone?: unknown;
  darkColors?: Partial<DarkColors> | null;
  fontColors?: {
    title?: Partial<ThemeColors> | null;
    appName?: Partial<ThemeColors> | null;
  } | null;
  buttonColors?: ButtonColorsInput;
}): PreviewScreenLook {
  const attributes: PreviewScreenAttributes = {};
  const style: Record<string, string> = {};

  const light = lightToneOrNull(lightTone);
  if (light) attributes['data-bg-tone'] = light;
  const dark = darkToneOrNull(darkColors?.tone);
  if (dark) attributes['data-dark-tone'] = dark;

  if (theme === 'dark') {
    const primary = hexOrNull(darkColors?.primary);
    if (primary) {
      const pair = { primary, secondary: hexOrNull(colors.secondary) ?? primary };
      const ink = deriveBrandColors(pair).onPrimary;
      style['--brand-primary'] = primary;
      style['--brand-on-primary'] = ink;
      style['--brand-primary-dark'] = primary;
      style['--brand-on-primary-dark'] = ink;
    }
    const darkSecondary = hexOrNull(darkColors?.secondary);
    if (darkSecondary) style['--brand-secondary'] = darkSecondary;
  }

  const title = hexOrNull(fontColors?.title?.[theme]);
  if (title) {
    attributes['data-title-color'] = '';
    style['--preview-title-color'] = title;
  }
  const appName = hexOrNull(fontColors?.appName?.[theme]);
  if (appName) {
    attributes['data-app-name-color'] = '';
    style['--preview-app-name-color'] = appName;
  }

  Object.assign(style, buttonKeys({ buttonColors, colors, darkColors }, theme === 'light'));
  return { attributes, style };
}

/**
 * The buttons' raw keys of BOTH themes (`resolveButtonPairs`, spelled by the kernel's
 * `buttonThemeVars`). `spellDarkFill`: a dark TEXT set alone, with the dark mode's own primary, also
 * gets that primary as its fill and today's hover shade over it, for a scope whose dark islands (the
 * reels stage) would otherwise put that text on an accent hovering in the LIGHT primary's shade (see
 * `previewScreenLook` and `appBrandLook`).
 */
function buttonKeys(
  {
    buttonColors,
    colors,
    darkColors,
  }: {
    buttonColors?: ButtonColorsInput;
    colors: { primary: string; secondary: string };
    darkColors?: Partial<DarkColors> | null;
  },
  spellDarkFill: boolean,
): Record<string, string> {
  const buttons = resolveButtonPairs({ buttonColors, colors, darkColors });
  const keys = {
    ...buttonThemeVars('light', buttons.light),
    ...buttonThemeVars('dark', buttons.dark),
  };
  const darkPrimary = hexOrNull(darkColors?.primary);
  const darkKeys = BUTTON_COLOR_KEYS.dark;
  if (spellDarkFill && darkPrimary && keys[darkKeys.ink] && !keys[darkKeys.fill]) {
    keys[darkKeys.fill] = darkPrimary;
    keys[darkKeys.hover] = `color-mix(in oklch, ${darkPrimary}, black 12%)`;
  }
  return keys;
}

// ── The look as the panel edits it and as the app paints it (2026-10-03) ─────────────────────────

/**
 * The look in the shape the wizard's draft and the Marca tab edit it (the draft's own names: the
 * dark ground lives in `darkColors.tone`, beside the dark pair, as its card shows it). The contract
 * keeps the same values under `look` with the dark ground apart (`darkTone`); `lookFieldsOf` and
 * `lookBodyOf` translate.
 */
export type LookFields = {
  /** The Google Fonts family of the titles; `null` for Manrope. */
  titleFont: string | null;
  lightTone: LightTone | null;
  darkColors: DarkColors;
  fontColors: FontColors;
  buttonColors: ButtonColors;
};

/**
 * A stored look (any shape, or nothing) as the fields edit it: what is not valid is `null`. The
 * dark ground is read from `darkTone` (the contract's place) unless `darkColors` carries its own
 * (the fields' place), as `lookBodyOf` reads it, so either function takes either shape.
 */
export function lookFieldsOf(look: Partial<BrandLook> | null | undefined): LookFields {
  const saved = fields(look);
  return {
    titleFont: isFontFamilyName(saved.titleFont) ? saved.titleFont : null,
    lightTone: lightToneOrNull(saved.lightTone),
    darkColors: readDarkColors({ tone: saved.darkTone, ...fields(saved.darkColors) }),
    fontColors: readFontColors(saved.fontColors),
    buttonColors: readButtonColors(saved.buttonColors),
  };
}

/**
 * The fields (any shape: a draft holds what the owner TYPES, a hex half typed included) as the
 * look's route takes them: every value re-checked, so a half-typed hex, an unknown id or an unsafe
 * family is sent as `null` (the system's own value), never guessed, and the whole look always goes
 * out complete, in its canonical form (the default ids and Manrope as `null`). What the summary
 * lists is exactly this (`readButtonColors` and friends drop the same values). A contract look is
 * read too (its dark ground under `darkTone`), so this is also the canonical form of any look.
 */
export function lookBodyOf(value: unknown): BrandLook {
  const saved = fields(value);
  const dark = readDarkColors({ tone: saved.darkTone, ...fields(saved.darkColors) });
  const font = readFontColors(saved.fontColors);
  const buttons = readButtonColors(saved.buttonColors);
  return normalizeBrandLook({
    lightTone: lightToneOrNull(saved.lightTone),
    darkTone: dark.tone,
    darkColors: { primary: dark.primary, secondary: dark.secondary },
    titleFont: isFontFamilyName(saved.titleFont) ? saved.titleFont : null,
    fontColors: font,
    buttonColors: buttons,
  });
}

/** Two looks are the same when their canonical bodies are (the Marca tab's "nothing to save"). */
export function sameLook(a: unknown, b: unknown): boolean {
  return JSON.stringify(lookBodyOf(a)) === JSON.stringify(lookBodyOf(b));
}

/**
 * What the app's brand scope carries for its look (the AppShell root, the logged-out pages'
 * `<main>`): an absent key is not rendered. Every marker is an empty attribute that tokens.css or
 * globals.css keys on, so a look left at the system's value renders nothing at all.
 */
export type AppBrandAttributes = {
  'data-bg-tone'?: LightTone;
  'data-dark-tone'?: DarkTone;
  /** The dark theme takes the own dark primary for both of its primaries (tokens.css). */
  'data-dark-primary'?: '';
  /** The dark theme takes `--brand-secondary-dark` as its secondary (tokens.css). */
  'data-dark-secondary'?: '';
  /** The titles take `--brand-title-font` (globals.css). */
  'data-title-font'?: '';
  /** One marker per theme and per ink: the colour of that theme only (globals.css). */
  'data-title-color-light'?: '';
  'data-title-color-dark'?: '';
  'data-app-name-color-light'?: '';
  'data-app-name-color-dark'?: '';
};

export type AppBrandLook = {
  attributes: AppBrandAttributes;
  /** Custom properties for the scope's inline style, spread AFTER `brandStyleVars`. */
  style: Record<string, string>;
};

/**
 * The saved look as the APP paints it, on its brand scope, for BOTH themes at once: the theme is
 * per device and flips on the client (`ThemeToggle` rewrites `<html data-theme>` with no new
 * render), so nothing here may depend on it. What `previewScreenLook` does for the phone's one
 * theme, this does for both, keyed so tokens.css and globals.css pick the scope's own theme:
 *
 * - the two tone ids (tokens.css applies each under its own theme, Layers 1c and 1d);
 * - the own dark primary: `--brand-primary-dark` with the ink that reads on it (what
 *   `resolveBranding` already persists, spelled here too) and the `data-dark-primary` marker, on
 *   which tokens.css makes it the dark theme's `--brand-primary` and `--brand-on-primary` as well,
 *   as the phone does (the brand gradient, its ink and the hover shade follow it); the own dark
 *   secondary as `--brand-secondary-dark` with its marker;
 * - the title font (`titleFontStack`, the family's CSS stack once the catalogue confirmed it;
 *   `null` keeps Manrope) as `--brand-title-font` with its marker;
 * - each ink of each theme as `--brand-title-<theme>` / `--brand-app-name-<theme>` with a marker
 *   per theme, which is what globals.css keys on (no marker, no rule: the inks stay as they are);
 * - the buttons' raw keys of both themes, the dark fill spelled out for a dark text set alone with
 *   the own dark primary (`buttonKeys`), so the dark islands of a light page match the dark page.
 *
 * Every value is re-checked here (ids by the guards, colours by `isHexColor`): a value that does
 * not pass is simply left out, never guessed. The pair must be valid (the resolved brand's is).
 */
export function appBrandLook({
  colors,
  look,
  titleFontStack,
}: {
  colors: { primary: string; secondary: string };
  look: Partial<BrandLook> | null | undefined;
  titleFontStack?: string | null;
}): AppBrandLook {
  const fieldsOfLook = lookFieldsOf(look);
  const attributes: AppBrandAttributes = {};
  const style: Record<string, string> = {};

  if (fieldsOfLook.lightTone) attributes['data-bg-tone'] = fieldsOfLook.lightTone;
  const dark = fieldsOfLook.darkColors;
  const darkTone = darkToneOrNull(dark.tone);
  if (darkTone) attributes['data-dark-tone'] = darkTone;

  if (dark.primary) {
    const ink = deriveBrandColors({
      primary: dark.primary,
      secondary: hexOrNull(colors.secondary) ?? dark.primary,
    }).onPrimary;
    attributes['data-dark-primary'] = '';
    style['--brand-primary-dark'] = dark.primary;
    style['--brand-on-primary-dark'] = ink;
  }
  if (dark.secondary) {
    attributes['data-dark-secondary'] = '';
    style['--brand-secondary-dark'] = dark.secondary;
  }

  if (titleFontStack) {
    attributes['data-title-font'] = '';
    style['--brand-title-font'] = titleFontStack;
  }

  const inks = fieldsOfLook.fontColors;
  for (const theme of ['light', 'dark'] as const) {
    const title = inks.title[theme];
    if (title) {
      attributes[`data-title-color-${theme}`] = '';
      style[`--brand-title-${theme}`] = title;
    }
    const appName = inks.appName[theme];
    if (appName) {
      attributes[`data-app-name-color-${theme}`] = '';
      style[`--brand-app-name-${theme}`] = appName;
    }
  }

  Object.assign(
    style,
    buttonKeys({ buttonColors: fieldsOfLook.buttonColors, colors, darkColors: dark }, true),
  );
  return { attributes, style };
}
