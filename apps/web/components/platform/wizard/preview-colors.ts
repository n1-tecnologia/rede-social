import { DARK_BG, LIGHT_BG, NAVY, WHITE } from '@rede-social/contracts/branding';
import { useEffect, useState } from 'react';
import {
  type DarkTone,
  darkToneOrNull,
  hexOrNull,
  type LightTone,
  type LookFields,
  lightToneOrNull,
  readButtonColors,
} from '@/lib/bg-tone';

/*
 * The colours of the look beyond the pair (the grounds, the dark mode's primary and secondary, the
 * titles' and the app name's inks per theme, the buttons' own colours per theme and their style):
 * what their fields start from and measure against, and what the summary and the confirmation
 * list. Saved with the tenant since 2026-10-03 (the creation sends them, the Marca tab edits them);
 * the fields carry `null` for "the system's own colour", and this module says what that is.
 */

/**
 * `DEFAULT_TEXT_COLORS` mirrors `--theme-text` of the light and the dark block of
 * packages/ui/src/styles/tokens.css (`#16233b`, `#f2f5fa`): what a title and the app name are drawn
 * in until the tenant picks another ink. tokens.css is the only home of colour literals, so the light
 * one comes from the contracts (`NAVY`, the same ink) and the dark one is the single deliberate copy,
 * here in a `.ts` module that scripts/check-ui-literals.sh never scans (it reads `.tsx` only).
 * preview-colors.test.ts pins both to the tokens, so a token change fails there instead of drifting.
 */
export const DEFAULT_TEXT_COLORS = { light: NAVY, dark: '#f2f5fa' } as const;

export type PreviewMode = 'light' | 'dark';

/** The screen's ground and its raised surface (the top bar, the cards) as `#rrggbb`. */
export type ThemeSurfaces = { ground: string; surface: string };

/**
 * Until the browser answers (the server render, a test without the stylesheet): the system's own
 * neutrals. The dark surface falls back to the dark ground, the one the contracts spell.
 */
const FALLBACK: Record<PreviewMode, ThemeSurfaces> = {
  light: { ground: LIGHT_BG, surface: WHITE },
  dark: { ground: DARK_BG, surface: DARK_BG },
};

const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/;

/**
 * A computed colour (`rgb(245, 239, 229)`, the form `getComputedStyle` hands back whatever the
 * stylesheet wrote) as `#f5efe5`; `null` for anything that is not an opaque sRGB colour (an undefined
 * variable computes to transparent), so the caller keeps its fallback.
 */
export function rgbToHex(value: string): string | null {
  const match = RGB.exec(value.trim());
  if (!match) return null;
  const alpha = match[4] === undefined ? 1 : Number(match[4]) / (match[5] ? 100 : 1);
  if (!(alpha >= 1)) return null;
  const channels = [match[1], match[2], match[3]].map(Number);
  if (channels.some((c) => !Number.isFinite(c) || c < 0 || c > 255)) return null;
  return `#${channels.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The ground and the raised surface of the tenant's app in `mode` with the background `tone` (`null`
 * for the default), read from the stylesheet itself: a hidden probe declares the theme and the tone
 * exactly as the preview's screen does (`data-theme` plus `data-bg-tone` or `data-dark-tone`), so
 * tokens.css's own tone layers resolve `--theme-bg` and `--theme-bg-secondary` on it, and the probe
 * leaves the document in the same tick. The palette therefore lives in tokens.css alone (no hex is
 * copied into TypeScript), and a contrast hint always measures the colours the preview paints.
 * Both are read as a BACKGROUND (the surface on a child, which inherits the probe's variables): an
 * unresolved background computes to transparent and keeps the fallback, where an inherited property
 * such as `color` would silently hand back the page's ink. Re-read when the mode or the tone
 * changes; the fallbacks stand in until then.
 */
export function useThemeSurfaces(mode: PreviewMode, tone: string | null): ThemeSurfaces {
  const [surfaces, setSurfaces] = useState<ThemeSurfaces>(FALLBACK[mode]);

  useEffect(() => {
    const probe = document.createElement('span');
    probe.hidden = true;
    probe.setAttribute('data-theme', mode);
    if (tone) probe.setAttribute(mode === 'light' ? 'data-bg-tone' : 'data-dark-tone', tone);
    probe.style.backgroundColor = 'var(--theme-bg)';
    const raised = document.createElement('span');
    raised.style.backgroundColor = 'var(--theme-bg-secondary)';
    probe.append(raised);
    document.body.append(probe);
    const ground = rgbToHex(getComputedStyle(probe).backgroundColor) ?? FALLBACK[mode].ground;
    const surface = rgbToHex(getComputedStyle(raised).backgroundColor) ?? FALLBACK[mode].surface;
    probe.remove();
    setSurfaces((prev) =>
      prev.ground === ground && prev.surface === surface ? prev : { ground, surface },
    );
  }, [mode, tone]);

  return surfaces;
}

/** The four inks of `fontColors`, in the order the summary lists them (and their catalog keys). */
export const INK_KEYS = [
  'titleColorLight',
  'titleColorDark',
  'appNameColorLight',
  'appNameColorDark',
] as const;
export type InkKey = (typeof INK_KEYS)[number];

/**
 * The six colours of `buttonColors`, by mode (the button, a gradient's last colour, then the text),
 * in the order the summary lists them; the "Botões" card's field ids, and but for a gradient's
 * first colour (`ButtonRowKey`) the catalog keys of their rows.
 */
export const BUTTON_KEYS = [
  'buttonFillLight',
  'buttonFillEndLight',
  'buttonInkLight',
  'buttonFillDark',
  'buttonFillEndDark',
  'buttonInkDark',
] as const;
export type ButtonKey = (typeof BUTTON_KEYS)[number];

/**
 * The summary's row of a button colour (`summary.fields.*`): the colour's own key, but a gradient's
 * first colour is its "Cor inicial" (`buttonFillStartLight`, `buttonFillStartDark`).
 */
export type ButtonRowKey = ButtonKey | 'buttonFillStartLight' | 'buttonFillStartDark';

const GRADIENT_ROW: Partial<Record<ButtonKey, ButtonRowKey>> = {
  buttonFillLight: 'buttonFillStartLight',
  buttonFillDark: 'buttonFillStartDark',
};

/** What the tenant changed among the look's colours: `null` (or absent) is the system's. */
export type LookChanges = {
  lightTone: LightTone | null;
  dark: { primary: string | null; secondary: string | null; tone: DarkTone | null };
  inks: ReadonlyArray<{ key: InkKey; hex: string }>;
  /** `'gradient'` when the buttons are one, `null` for the solid default. */
  buttonStyle: 'gradient' | null;
  /**
   * Only the button colours set for a mode (what the dark mode inherits is not its own), a
   * gradient's last colour only for a gradient, each with the summary's row it goes in.
   */
  buttons: ReadonlyArray<{ key: ButtonKey; row: ButtonRowKey; hex: string }>;
};

/** The listed values that are set, in their keys' order. */
function changed<K extends string>(keys: readonly K[], values: Record<K, string | null>) {
  return keys.flatMap((key) => {
    const hex = values[key];
    return hex ? [{ key, hex }] : [];
  });
}

/**
 * The look's colours of a draft as the summary and the confirmation show them: ONLY what the tenant
 * changed (a default tone, an unset colour or anything malformed is `null`, an unset ink or button
 * colour is left out, the solid style is `null`; a solid button's stored last colour is ignored, as
 * the phone ignores it), so a draft that kept the system's colours adds no row at all. The creation
 * sends these values, checked the same way (`lookBodyOf` drops the same malformed ones), plus a
 * solid button's last colours, which it keeps aside unseen.
 */
export function lookChanges(
  draft: Pick<LookFields, 'lightTone' | 'darkColors' | 'fontColors' | 'buttonColors'>,
): LookChanges {
  const { lightTone, darkColors, fontColors } = draft;
  const buttons = readButtonColors(draft.buttonColors);
  const gradient = buttons.style === 'gradient';
  return {
    lightTone: lightToneOrNull(lightTone),
    dark: {
      primary: hexOrNull(darkColors.primary),
      secondary: hexOrNull(darkColors.secondary),
      tone: darkToneOrNull(darkColors.tone),
    },
    inks: changed(INK_KEYS, {
      titleColorLight: hexOrNull(fontColors.title.light),
      titleColorDark: hexOrNull(fontColors.title.dark),
      appNameColorLight: hexOrNull(fontColors.appName.light),
      appNameColorDark: hexOrNull(fontColors.appName.dark),
    }),
    buttonStyle: gradient ? 'gradient' : null,
    buttons: changed(BUTTON_KEYS, {
      buttonFillLight: buttons.fill.light,
      buttonFillEndLight: gradient ? buttons.fillEnd.light : null,
      buttonInkLight: buttons.ink.light,
      buttonFillDark: buttons.fill.dark,
      buttonFillEndDark: gradient ? buttons.fillEnd.dark : null,
      buttonInkDark: buttons.ink.dark,
    }).map(({ key, hex }) => ({ key, row: (gradient && GRADIENT_ROW[key]) || key, hex })),
  };
}
