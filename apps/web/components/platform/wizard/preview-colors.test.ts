// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DARK_BG, LIGHT_BG, NAVY, WHITE } from '@rede-social/contracts/branding';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BUTTON_KEYS,
  DEFAULT_TEXT_COLORS,
  lookChanges,
  rgbToHex,
  useThemeSurfaces,
} from './preview-colors';
import type { TenantDraft } from './TenantDraftProvider';

/**
 * The pure half of the look's colours (`preview-colors.ts`), shared by Personalização and the
 * Marca tab.
 *
 *  1. `DEFAULT_TEXT_COLORS` is the tokens' `--theme-text`, light and dark: the one hex this module
 *     copies out of tokens.css is pinned to it here, so a token change fails instead of drifting.
 *  2. `rgbToHex` turns what `getComputedStyle` hands back into `#rrggbb`, and refuses anything that is
 *     not an opaque sRGB colour (an undefined variable computes to transparent).
 *  3. `useThemeSurfaces` reads the ground and the raised surface off a probe that carries the theme
 *     and the tone the way the device screen does, leaves nothing behind, and keeps the system's
 *     neutrals when the browser has no answer. A light tone repaints the raised surface too since
 *     2026-10-03 (a tone is a whole family), so its surface is read like its ground, and the light
 *     fallbacks are what tokens.css resolves without a tone (the gray ground, the white surface).
 *  4. `lookChanges` keeps only what the tenant changed: a default tone, an unset or malformed
 *     colour and an unset ink or button colour add no row; the button colours are listed by mode,
 *     the button before its text, and what the dark mode inherits is not listed as its own. The
 *     gradient is listed as such, its first colour in the "Cor inicial" row and its last colour
 *     after it; a solid button's stored last colour is not listed (the phone ignores it).
 */

// Vitest runs from `apps/web` (the `NotificationsSurface.test.tsx` precedent); under happy-dom
// `import.meta.url` is not a file URL.
const TOKENS = readFileSync(
  join(process.cwd(), '..', '..', 'packages', 'ui', 'src', 'styles', 'tokens.css'),
  'utf8',
);

/** The body of the first block whose selector list starts with `selector`. */
function block(selector: string): string {
  const start = TOKENS.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in tokens.css`);
  return TOKENS.slice(start, TOKENS.indexOf('}', start));
}

type ButtonColors = TenantDraft['buttonColors'];

/** Button colours with only what is given set, solid unless said otherwise. */
const buttons = (
  fill: Partial<ButtonColors['fill']> = {},
  ink: Partial<ButtonColors['ink']> = {},
  fillEnd: Partial<ButtonColors['fillEnd']> = {},
  style: ButtonColors['style'] = 'solid',
): ButtonColors => ({
  style,
  fill: { light: null, dark: null, ...fill },
  fillEnd: { light: null, dark: null, ...fillEnd },
  ink: { light: null, dark: null, ...ink },
});

const EMPTY: Pick<TenantDraft, 'lightTone' | 'darkColors' | 'fontColors' | 'buttonColors'> = {
  lightTone: null,
  darkColors: { primary: null, secondary: null, tone: null },
  fontColors: { title: { light: null, dark: null }, appName: { light: null, dark: null } },
  buttonColors: buttons(),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DEFAULT_TEXT_COLORS', () => {
  it('is the light and the dark --theme-text of tokens.css', () => {
    expect(block('[data-theme="light"]')).toContain(`--theme-text: ${DEFAULT_TEXT_COLORS.light};`);
    expect(block('[data-theme="dark"]')).toContain(`--theme-text: ${DEFAULT_TEXT_COLORS.dark};`);
    expect(DEFAULT_TEXT_COLORS.light).toBe(NAVY);
  });
});

describe('rgbToHex', () => {
  it('reads the computed forms, opaque only', () => {
    expect(rgbToHex('rgb(245, 239, 229)')).toBe('#f5efe5');
    expect(rgbToHex('rgb(15 17 24)')).toBe('#0f1118');
    expect(rgbToHex('rgba(255, 255, 255, 1)')).toBe('#ffffff');
    expect(rgbToHex(' rgb(0, 0, 0) ')).toBe('#000000');
  });

  it('refuses transparency, other notations and garbage', () => {
    expect(rgbToHex('rgba(0, 0, 0, 0)')).toBeNull();
    expect(rgbToHex('rgba(24, 28, 38, 0.82)')).toBeNull();
    expect(rgbToHex('rgb(0 0 0 / 50%)')).toBeNull();
    expect(rgbToHex('#f5efe5')).toBeNull();
    expect(rgbToHex('var(--theme-bg)')).toBeNull();
    expect(rgbToHex('rgb(300, 0, 0)')).toBeNull();
    expect(rgbToHex('')).toBeNull();
  });
});

describe('useThemeSurfaces', () => {
  it('keeps the system neutrals when the stylesheet has no answer', async () => {
    const { result } = renderHook(() => useThemeSurfaces('light', null));
    expect(result.current).toEqual({ ground: LIGHT_BG, surface: WHITE });
    const dark = renderHook(() => useThemeSurfaces('dark', 'cafe'));
    await waitFor(() => expect(dark.result.current).toEqual({ ground: DARK_BG, surface: DARK_BG }));
  });

  it('probes with the theme and the tone of the device screen, and removes the probe', async () => {
    const seen: Array<{ theme: string | null; light: string | null; dark: string | null }> = [];
    // What tokens.css resolves per theme: the cafe family in dark and, in light, the amarelado one,
    // the reference's whole family (2026-10-03): its raised surface is its warm white, not white.
    const paint = {
      dark: { ground: 'rgb(24, 16, 4)', surface: 'rgb(36, 27, 12)' },
      light: { ground: 'rgb(245, 239, 229)', surface: 'rgb(255, 252, 246)' },
    };
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
      // The probe carries the theme and paints the ground; its child paints the raised surface.
      const probe = el.hasAttribute('data-theme');
      if (probe) {
        seen.push({
          theme: el.getAttribute('data-theme'),
          light: el.getAttribute('data-bg-tone'),
          dark: el.getAttribute('data-dark-tone'),
        });
      }
      const theme = (probe ? el : el.parentElement)?.getAttribute('data-theme');
      return {
        backgroundColor: paint[theme === 'light' ? 'light' : 'dark'][probe ? 'ground' : 'surface'],
      } as CSSStyleDeclaration;
    });
    const { result, rerender } = renderHook(({ tone }) => useThemeSurfaces('dark', tone), {
      initialProps: { tone: 'cafe' as string | null },
    });
    await waitFor(() => expect(result.current).toEqual({ ground: '#181004', surface: '#241b0c' }));
    expect(seen.at(-1)).toEqual({ theme: 'dark', light: null, dark: 'cafe' });
    expect(document.body.querySelector('[data-dark-tone]')).toBeNull();

    rerender({ tone: null });
    await waitFor(() => expect(seen.at(-1)).toEqual({ theme: 'dark', light: null, dark: null }));

    // A light tone's raised surface is read off the probe like its ground, never assumed white.
    const light = renderHook(() => useThemeSurfaces('light', 'amarelado'));
    await waitFor(() =>
      expect(light.result.current).toEqual({ ground: '#f5efe5', surface: '#fffcf6' }),
    );
    expect(seen.at(-1)).toEqual({ theme: 'light', light: 'amarelado', dark: null });
    expect(document.body.querySelector('[data-bg-tone]')).toBeNull();
  });

  it('falls back on what a light scope without a tone resolves: the gray ground, the white surface', () => {
    // The light fallbacks stand in for the stylesheet, so they are the light block's own values,
    // which the tone layer's rebinding also falls back to (an unknown id keeps them).
    const light = block('[data-theme="light"]');
    expect(light).toContain(`--theme-bg: ${LIGHT_BG};`);
    expect(light).toContain(`--theme-bg-secondary: ${WHITE};`);
    const rebinding = block('[data-bg-tone][data-theme="light"]');
    expect(rebinding).toContain(`--theme-bg: var(--tone-ground, ${LIGHT_BG});`);
    expect(rebinding).toContain(`--theme-bg-secondary: var(--tone-surface, ${WHITE});`);
  });
});

describe('lookChanges', () => {
  it('adds nothing for a draft that kept the system colours', () => {
    expect(lookChanges(EMPTY)).toEqual({
      lightTone: null,
      dark: { primary: null, secondary: null, tone: null },
      inks: [],
      buttonStyle: null,
      buttons: [],
    });
  });

  it('treats the default tones as unchanged and drops malformed values', () => {
    expect(
      lookChanges({
        lightTone: 'cinza',
        darkColors: { primary: '#12', secondary: 'red', tone: 'grafite' },
        fontColors: { title: { light: 'nope', dark: null }, appName: { light: null, dark: '#1' } },
        buttonColors: buttons(
          { light: '#e3a', dark: 'gold' },
          { light: 'var(--x)', dark: '' },
          { light: '#ffd', dark: 'url(x)' },
          'gradient',
        ),
      }),
    ).toEqual({
      lightTone: null,
      dark: { primary: null, secondary: null, tone: null },
      inks: [],
      // The style is a change of its own, even with every colour automatic.
      buttonStyle: 'gradient',
      buttons: [],
    });
  });

  it('keeps what changed, the inks in the summary order', () => {
    expect(
      lookChanges({
        lightTone: 'amarelado',
        darkColors: { primary: '#ffb4a8', secondary: null, tone: 'azul-noite' },
        fontColors: {
          title: { light: '#7c2d12', dark: '#ffd27a' },
          appName: { light: null, dark: '#a7f3d0' },
        },
        buttonColors: buttons({ light: '#E3AF3F', dark: '#1a237e' }, { dark: '#FFFFFF' }),
      }),
    ).toEqual({
      lightTone: 'amarelado',
      dark: { primary: '#ffb4a8', secondary: null, tone: 'azul-noite' },
      inks: [
        { key: 'titleColorLight', hex: '#7c2d12' },
        { key: 'titleColorDark', hex: '#ffd27a' },
        { key: 'appNameColorDark', hex: '#a7f3d0' },
      ],
      buttonStyle: null,
      buttons: [
        { key: 'buttonFillLight', row: 'buttonFillLight', hex: '#e3af3f' },
        { key: 'buttonFillDark', row: 'buttonFillDark', hex: '#1a237e' },
        { key: 'buttonInkDark', row: 'buttonInkDark', hex: '#ffffff' },
      ],
    });
  });

  it('lists the button colours by mode, the button before its text, never the inherited', () => {
    expect(BUTTON_KEYS).toEqual([
      'buttonFillLight',
      'buttonFillEndLight',
      'buttonInkLight',
      'buttonFillDark',
      'buttonFillEndDark',
      'buttonInkDark',
    ]);
    // The reference: a light gold button with chocolate text, which the dark mode inherits.
    expect(
      lookChanges({
        ...EMPTY,
        buttonColors: buttons({ light: '#e3af3f' }, { light: '#382317' }),
      }).buttons,
    ).toEqual([
      { key: 'buttonFillLight', row: 'buttonFillLight', hex: '#e3af3f' },
      { key: 'buttonInkLight', row: 'buttonInkLight', hex: '#382317' },
    ]);
    // A text alone is a change of its own.
    expect(
      lookChanges({ ...EMPTY, buttonColors: buttons({}, { dark: '#F2F5FA' }) }).buttons,
    ).toEqual([{ key: 'buttonInkDark', row: 'buttonInkDark', hex: '#f2f5fa' }]);
    expect(
      lookChanges({ ...EMPTY, buttonColors: buttons({}, { light: '#382317' }) }).buttons,
    ).toEqual([{ key: 'buttonInkLight', row: 'buttonInkLight', hex: '#382317' }]);
  });

  it('lists a gradient: the style, its first colour as "Cor inicial", then its last colour', () => {
    const extra = lookChanges({
      ...EMPTY,
      buttonColors: buttons(
        { light: '#E3AF3F', dark: '#1a237e' },
        { light: '#382317' },
        { light: '#FFD27A', dark: '#e3af3f' },
        'gradient',
      ),
    });
    expect(extra.buttonStyle).toBe('gradient');
    expect(extra.buttons).toEqual([
      { key: 'buttonFillLight', row: 'buttonFillStartLight', hex: '#e3af3f' },
      { key: 'buttonFillEndLight', row: 'buttonFillEndLight', hex: '#ffd27a' },
      { key: 'buttonInkLight', row: 'buttonInkLight', hex: '#382317' },
      { key: 'buttonFillDark', row: 'buttonFillStartDark', hex: '#1a237e' },
      { key: 'buttonFillEndDark', row: 'buttonFillEndDark', hex: '#e3af3f' },
    ]);
  });

  it('leaves a solid button’s stored last colour out, as the phone does', () => {
    const extra = lookChanges({
      ...EMPTY,
      buttonColors: buttons({ light: '#e3af3f' }, {}, { light: '#ffd27a', dark: '#1a237e' }),
    });
    expect(extra.buttonStyle).toBeNull();
    expect(extra.buttons).toEqual([
      { key: 'buttonFillLight', row: 'buttonFillLight', hex: '#e3af3f' },
    ]);
  });

  it('reads a draft stored before the gradient (no style, no last colour) as solid', () => {
    const roundOne = {
      fill: { light: '#e3af3f', dark: null },
      ink: { light: null, dark: null },
    } as unknown as ButtonColors;
    const extra = lookChanges({ ...EMPTY, buttonColors: roundOne });
    expect(extra.buttonStyle).toBeNull();
    expect(extra.buttons).toEqual([
      { key: 'buttonFillLight', row: 'buttonFillLight', hex: '#e3af3f' },
    ]);
  });
});
