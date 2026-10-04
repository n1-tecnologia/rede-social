import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type BrandLook,
  brandingLookBodySchema,
  contrastRatio,
  deriveBrandColors,
  emptyBrandLook,
  NAVY,
  NEUTRAL_BRAND,
  WHITE,
} from '@rede-social/contracts/branding';
import {
  buttonGradient,
  buttonGradientHover,
  buttonHover,
  buttonInk,
  buttonRampEnd,
  buttonThemeVars,
} from '@rede-social/core/ui';
import { describe, expect, it } from 'vitest';
import {
  appBrandLook,
  type ButtonColors,
  buttonTextContrast,
  DARK_TONES,
  type DarkColors,
  DEFAULT_DARK_TONE,
  DEFAULT_LIGHT_TONE,
  darkToneOrNull,
  effectiveButtonColors,
  emptyButtonColors,
  emptyDarkColors,
  emptyFontColors,
  type FontColors,
  hexOrNull,
  isButtonStyle,
  isDarkTone,
  isHexColor,
  isLightTone,
  LIGHT_TONES,
  lightToneOrNull,
  lookBodyOf,
  lookFieldsOf,
  previewScreenLook,
  readButtonColors,
  readDarkColors,
  readFontColors,
  resolveButtonPairs,
  sameLook,
  settleButtonColors,
  settleDarkColors,
  settleFontColors,
  type ThemeColors,
} from './bg-tone';

/**
 * The wizard's preview-only look (2026-10-02): the tone ids, the colour guards, the stored-draft
 * readers, the typed-colour settling and the preview screen's attributes and variables; and the
 * buttons' own colours (2026-10-03), solid or a gradient. The claims a later edit could quietly
 * break:
 *
 *  1. Only the sixteen ids pass the guards, never an inherited key, a hex or a CSS fragment, and
 *     every id has its row in tokens.css (and tokens.css no other).
 *  2. A colour reaches a style only as a valid `#rrggbb`, lower-cased.
 *  3. A stored draft of any shape reads back as valid values or `null` (the system's), and the
 *     default ids read back as `null` too; a button style other than the gradient reads as solid,
 *     so a draft stored before the gradient restores as the solid button it was.
 *  4. A half-typed hex keeps the last valid colour, a reset clears it, and nothing changed keeps
 *     the same reference (the draft publishes on a new one).
 *  5. The screen carries the tone ids whatever the theme, the dark colours only in dark, and a
 *     font colour of the CURRENT theme only with its marker attribute.
 *  6. The solid buttons: the light ones are the light mode's own; the dark mode inherits the light
 *     button, text included, until it has a button of its own; a text left automatic is the white
 *     or navy that reads on its button; a text alone stays alone; never a button without its
 *     text; and the screen carries the raw keys of BOTH themes, whatever its theme.
 *  7. The gradient: both themes always whole; the automatic first colour is the theme's accent (the
 *     light primary; the dark mode's own primary, or the derived one) and the automatic last colour
 *     that first colour moved 30% away from its text (`buttonRampEnd`), never the secondary, so an
 *     untouched gradient reads exactly as well as the solid button of its first colour; the dark
 *     mode inherits each light colour on its own, and the WHOLE light gradient (its automatic last
 *     colour and its text) while its first colour is the light one's and its last colour is not
 *     its own, unless it has a text of its own, which its automatic last colour then moves away
 *     from; an automatic text reads on both colours; a solid button ignores a stored last colour.
 *  8. What the "Botões" card shows completes the unset colours with the theme's own (the light
 *     primary, the dark accent, a gradient's automatic colours), says where each comes from (never
 *     "the light one's" beside a colour the light mode does not show), and measures the text where
 *     it reads worst.
 */

const LIGHT_IDS = [
  'cinza',
  'amarelado',
  'laranjado',
  'avermelhado',
  'lilas',
  'azulado',
  'agua',
  'esverdeado',
];
const DARK_IDS = [
  'grafite',
  'cafe',
  'terracota',
  'vinho',
  'berinjela',
  'azul-noite',
  'petroleo',
  'musgo',
];
const NOT_IDS = [
  'constructor',
  'toString',
  '__proto__',
  'hasOwnProperty',
  '',
  'Cinza',
  ' amarelado',
  'amarelado;color:red',
  '#f5efe5',
  'var(--tone-ground)',
  null,
  undefined,
  42,
  {},
  ['amarelado'],
];

/** The reference (Reine): a gold button with chocolate text. */
const GOLD = '#e3af3f';
const CHOCOLATE = '#382317';
/** A deep button that takes white text, and a pale gold that takes navy. */
const DEEP = '#1a237e';
const PALE = '#ffd27a';

/** Button colours with only what is given set, solid unless said otherwise. */
const buttons = (
  fill: Partial<ThemeColors> = {},
  ink: Partial<ThemeColors> = {},
  fillEnd: Partial<ThemeColors> = {},
  style: ButtonColors['style'] = 'solid',
): ButtonColors => ({
  style,
  fill: { light: null, dark: null, ...fill },
  fillEnd: { light: null, dark: null, ...fillEnd },
  ink: { light: null, dark: null, ...ink },
});

/** The same, as a gradient. */
const gradient = (
  fill: Partial<ThemeColors> = {},
  fillEnd: Partial<ThemeColors> = {},
  ink: Partial<ThemeColors> = {},
): ButtonColors => buttons(fill, ink, fillEnd, 'gradient');

/**
 * A gradient's automatic last colour as the kernel computes it (`buttonRampEnd`): `fill` moved 30%
 * away from `ink`, by default the white or navy that reads on it.
 */
const rampOf = (fill: string, ink: string = buttonInk(fill)): string => {
  const end = buttonRampEnd(fill, ink);
  if (!end) throw new Error(`no ramp for ${fill} under ${ink}`);
  return end;
};

describe('the tone ids', () => {
  it('are the two fixed palettes, the defaults first', () => {
    expect([...LIGHT_TONES]).toEqual(LIGHT_IDS);
    expect([...DARK_TONES]).toEqual(DARK_IDS);
    expect(DEFAULT_LIGHT_TONE).toBe('cinza');
    expect(DEFAULT_DARK_TONE).toBe('grafite');
  });

  it('pass their own guard only', () => {
    for (const id of LIGHT_IDS) {
      expect(isLightTone(id), id).toBe(true);
      expect(isDarkTone(id), id).toBe(false);
    }
    for (const id of DARK_IDS) {
      expect(isDarkTone(id), id).toBe(true);
      expect(isLightTone(id), id).toBe(false);
    }
  });

  it('refuse an inherited key, a hex, a CSS fragment and anything not a string', () => {
    for (const value of NOT_IDS) {
      expect(isLightTone(value), String(value)).toBe(false);
      expect(isDarkTone(value), String(value)).toBe(false);
    }
  });

  it('each have their row in tokens.css, and tokens.css no other', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(resolve(here, '../../../packages/ui/src/styles/tokens.css'), 'utf8');
    const ids = (attribute: string) => [
      ...new Set(
        [...css.matchAll(new RegExp(`\\[${attribute}="([^"]+)"\\]`, 'g'))].map((m) => m[1]),
      ),
    ];
    expect(ids('data-bg-tone')).toEqual(LIGHT_IDS);
    expect(ids('data-dark-tone')).toEqual(DARK_IDS);
  });

  it('keep a known id other than the default, and read everything else as the default (null)', () => {
    expect(lightToneOrNull('amarelado')).toBe('amarelado');
    expect(lightToneOrNull('cinza')).toBeNull();
    expect(lightToneOrNull('grafite')).toBeNull();
    expect(darkToneOrNull('azul-noite')).toBe('azul-noite');
    expect(darkToneOrNull('grafite')).toBeNull();
    expect(darkToneOrNull('amarelado')).toBeNull();
    for (const value of NOT_IDS) {
      expect(lightToneOrNull(value)).toBeNull();
      expect(darkToneOrNull(value)).toBeNull();
    }
  });
});

describe('isHexColor / hexOrNull / isButtonStyle', () => {
  it('accept #rrggbb in either case, and lower-case it', () => {
    for (const value of ['#aabbcc', '#AABBCC', '#a1B2c3', '#000000']) {
      expect(isHexColor(value), value).toBe(true);
    }
    expect(hexOrNull('#A1B2C3')).toBe('#a1b2c3');
  });

  it('refuse every other shape', () => {
    for (const value of [
      '#abc',
      '#aabbccdd',
      'aabbcc',
      ' #aabbcc',
      '#aabbcc ',
      '#gggggg',
      '#aabbcc;color:red',
      'red',
      'var(--brand-primary)',
      '',
      null,
      undefined,
      42,
    ]) {
      expect(isHexColor(value), String(value)).toBe(false);
      expect(hexOrNull(value)).toBeNull();
    }
  });

  it('know the two button styles and nothing else', () => {
    expect(isButtonStyle('solid')).toBe(true);
    expect(isButtonStyle('gradient')).toBe(true);
    for (const value of ['Gradient', 'degrade', 'linear', 'constructor', '', null, 42, {}]) {
      expect(isButtonStyle(value), String(value)).toBe(false);
    }
  });
});

describe('a stored draft read back', () => {
  it('keeps the valid values (lower-cased) and drops the rest to null', () => {
    expect(
      readDarkColors({ primary: '#AA00CC', secondary: '#12', tone: 'cafe', extra: 'x' }),
    ).toEqual({ primary: '#aa00cc', secondary: null, tone: 'cafe' });
    expect(readDarkColors({ primary: 'red', secondary: '#123456', tone: 'grafite' })).toEqual({
      primary: null,
      secondary: '#123456',
      tone: null,
    });
    expect(
      readFontColors({
        title: { light: '#16233B', dark: 'white' },
        appName: { light: null, dark: '#F2F5FA' },
        logo: { light: '#000000' },
      }),
    ).toEqual({
      title: { light: '#16233b', dark: null },
      appName: { light: null, dark: '#f2f5fa' },
    });
    expect(
      readButtonColors({
        style: 'gradient',
        fill: { light: '#E3AF3F', dark: 'gold' },
        fillEnd: { light: '#FFD27A', dark: '#ffd' },
        ink: { light: '#382317', dark: '#12' },
        hover: { light: '#000000' },
      }),
    ).toEqual(gradient({ light: GOLD }, { light: PALE }, { light: CHOCOLATE }));
  });

  it('restores a draft stored before the gradient as the solid button it was', () => {
    // Round 1 stored the fill and the ink only: no style, no last colour.
    expect(
      readButtonColors({
        fill: { light: '#E3AF3F', dark: null },
        ink: { light: '#382317', dark: null },
      }),
    ).toEqual(buttons({ light: GOLD }, { light: CHOCOLATE }));
    // A style it does not know is solid too.
    for (const style of ['Gradient', 'linear', 42, null, ['gradient']]) {
      expect(readButtonColors({ style, fill: { light: GOLD } }).style, String(style)).toBe('solid');
    }
  });

  it('reads any other shape as the system colours', () => {
    for (const value of [
      undefined,
      null,
      'x',
      42,
      [],
      { title: 'x', appName: [1] },
      { fill: 'x', ink: [1] },
      { fill: { light: 'var(--x)' }, ink: { dark: ' #382317' } },
      { style: 'constructor', fillEnd: 'x' },
    ]) {
      expect(readDarkColors(value)).toEqual(emptyDarkColors());
      expect(readFontColors(value)).toEqual(emptyFontColors());
      expect(readButtonColors(value)).toEqual(emptyButtonColors());
    }
    expect(emptyButtonColors()).toEqual(buttons());
  });
});

describe('settling a colour being typed', () => {
  const dark = (patch: Partial<DarkColors>): DarkColors => ({ ...emptyDarkColors(), ...patch });
  const fonts = (title: Partial<FontColors['title']>): FontColors => ({
    ...emptyFontColors(),
    title: { light: null, dark: null, ...title },
  });

  it('takes a valid hex, keeps the last valid one over a half-typed hex, clears on null', () => {
    const before = dark({ primary: '#112233', tone: 'vinho' });
    expect(settleDarkColors(dark({ primary: '#AABBCC', tone: 'vinho' }), before)).toEqual(
      dark({ primary: '#aabbcc', tone: 'vinho' }),
    );
    expect(settleDarkColors(dark({ primary: '#aab', tone: 'vinho' }), before)).toBe(before);
    expect(settleDarkColors(dark({ primary: null, tone: 'vinho' }), before)).toEqual(
      dark({ tone: 'vinho' }),
    );
    expect(settleDarkColors(dark({ secondary: '#445566' }), before)).toEqual(
      dark({ primary: null, secondary: '#445566' }),
    );
  });

  it('keeps the previous tone over an unknown id, and the same reference when nothing changed', () => {
    const before = dark({ tone: 'musgo' });
    expect(settleDarkColors(dark({ tone: 'nope' as DarkColors['tone'] }), before)).toBe(before);
    expect(settleDarkColors(dark({ tone: 'musgo' }), before)).toBe(before);
    expect(settleDarkColors(dark({ tone: null }), before)).toEqual(dark({}));
  });

  it('settles each font colour on its own and keeps untouched pairs by reference', () => {
    const before = fonts({ light: '#101010' });
    const typed = settleFontColors(fonts({ light: '#10', dark: '#FAFAFA' }), before);
    expect(typed).toEqual(fonts({ light: '#101010', dark: '#fafafa' }));
    expect(typed.appName).toBe(before.appName);
    expect(settleFontColors(fonts({ light: '#101010' }), before)).toBe(before);
    expect(settleFontColors(fonts({}), before)).toEqual(emptyFontColors());
  });

  it('settles each button colour on its own and keeps untouched pairs by reference', () => {
    const before = buttons({ light: GOLD }, { light: CHOCOLATE });
    // A half-typed fill keeps the last valid one; a new valid ink is lower-cased.
    const typed = settleButtonColors(
      buttons({ light: '#e3' }, { light: CHOCOLATE, dark: '#FFF8E7' }),
      before,
    );
    expect(typed).toEqual(buttons({ light: GOLD }, { light: CHOCOLATE, dark: '#fff8e7' }));
    expect(typed.fill).toBe(before.fill);
    expect(typed.fillEnd).toBe(before.fillEnd);
    // Nothing changed (the same values, a half-typed one): the very same object.
    expect(settleButtonColors(buttons({ light: GOLD }, { light: CHOCOLATE }), before)).toBe(before);
    expect(settleButtonColors(buttons({ light: '#e3a' }, { light: CHOCOLATE }), before)).toBe(
      before,
    );
    // "Usar a cor automática": null clears it, the rest stays.
    const cleared = settleButtonColors(buttons({}, { light: CHOCOLATE }), before);
    expect(cleared).toEqual(buttons({}, { light: CHOCOLATE }));
    expect(cleared.ink).toBe(before.ink);
    expect(settleButtonColors(emptyButtonColors(), before)).toEqual(emptyButtonColors());
  });

  it('settles the style and a gradient’s last colour like the rest', () => {
    const before = buttons({ light: GOLD }, { light: CHOCOLATE });
    // The style switches on its own, every colour kept by reference.
    const switched = settleButtonColors({ ...before, style: 'gradient' }, before);
    expect(switched.style).toBe('gradient');
    expect(switched.fill).toBe(before.fill);
    expect(switched.ink).toBe(before.ink);
    // A last colour typed: valid lower-cased, half typed kept back, null cleared.
    const end = settleButtonColors(
      { ...switched, fillEnd: { light: '#FFD27A', dark: null } },
      switched,
    );
    expect(end.fillEnd).toEqual({ light: PALE, dark: null });
    expect(settleButtonColors({ ...end, fillEnd: { light: '#ffd2', dark: null } }, end)).toBe(end);
    expect(
      settleButtonColors({ ...end, fillEnd: { light: null, dark: null } }, end).fillEnd,
    ).toEqual({ light: null, dark: null });
    // An unknown style keeps the previous one, and the same object when nothing else moved.
    const odd = { ...end, style: 'linear' as ButtonColors['style'] };
    expect(settleButtonColors(odd, end)).toBe(end);
    // Back to solid: the last colour stays aside for the next gradient.
    const solid = settleButtonColors({ ...end, style: 'solid' }, end);
    expect(solid.style).toBe('solid');
    expect(solid.fillEnd).toBe(end.fillEnd);
  });
});

describe('resolveButtonPairs (the "Botões" card’s rule), solid', () => {
  const colors = NEUTRAL_BRAND;
  const resolve = (fill: Partial<ThemeColors> = {}, ink: Partial<ThemeColors> = {}) =>
    resolveButtonPairs({ buttonColors: buttons(fill, ink), colors });

  it('is the accent of both themes (null) while nothing is set', () => {
    expect(resolve()).toEqual({ light: null, dark: null });
    for (const buttonColors of [null, undefined, {}, emptyButtonColors()]) {
      expect(resolveButtonPairs({ buttonColors, colors })).toEqual({ light: null, dark: null });
    }
  });

  it('gives a light button its automatic text, and the dark mode the very same button', () => {
    expect(buttonInk(GOLD)).toBe(NAVY);
    expect(resolve({ light: GOLD })).toEqual({
      light: { fill: GOLD, ink: NAVY },
      dark: { fill: GOLD, ink: NAVY },
    });
    expect(buttonInk(DEEP)).toBe(WHITE);
    expect(resolve({ light: DEEP })).toEqual({
      light: { fill: DEEP, ink: WHITE },
      dark: { fill: DEEP, ink: WHITE },
    });
    // Exactly the white or navy `deriveBrandColors` picks for any primary.
    for (const fill of [GOLD, DEEP, PALE, '#ef4444']) {
      expect(resolve({ light: fill }).light?.ink, fill).toBe(
        deriveBrandColors({ primary: fill, secondary: colors.secondary }).onPrimary,
      );
    }
  });

  it('lets the dark mode inherit the light text too (the reference: gold and chocolate)', () => {
    expect(resolve({ light: GOLD }, { light: CHOCOLATE })).toEqual({
      light: { fill: GOLD, ink: CHOCOLATE },
      dark: { fill: GOLD, ink: CHOCOLATE },
    });
  });

  it('gives an inheriting dark mode its own text when it has one', () => {
    expect(resolve({ light: GOLD }, { light: CHOCOLATE, dark: '#000000' })).toEqual({
      light: { fill: GOLD, ink: CHOCOLATE },
      dark: { fill: GOLD, ink: '#000000' },
    });
  });

  it('stops inheriting once the dark mode has its own button (its text automatic again)', () => {
    expect(resolve({ light: GOLD, dark: DEEP }, { light: CHOCOLATE })).toEqual({
      light: { fill: GOLD, ink: CHOCOLATE },
      dark: { fill: DEEP, ink: WHITE },
    });
    expect(resolve({ dark: GOLD })).toEqual({ light: null, dark: { fill: GOLD, ink: NAVY } });
    expect(resolve({ dark: GOLD }, { dark: CHOCOLATE })).toEqual({
      light: null,
      dark: { fill: GOLD, ink: CHOCOLATE },
    });
  });

  it('sends a text alone, per theme, without inheriting it across themes', () => {
    expect(resolve({}, { light: CHOCOLATE })).toEqual({ light: { ink: CHOCOLATE }, dark: null });
    expect(resolve({}, { dark: '#F2F5FA' })).toEqual({ light: null, dark: { ink: '#f2f5fa' } });
    expect(resolve({}, { light: CHOCOLATE, dark: WHITE })).toEqual({
      light: { ink: CHOCOLATE },
      dark: { ink: WHITE },
    });
    // A light text on the light accent says nothing about the dark mode's own button.
    expect(resolve({ dark: DEEP }, { light: CHOCOLATE })).toEqual({
      light: { ink: CHOCOLATE },
      dark: { fill: DEEP, ink: WHITE },
    });
  });

  it('counts a value that is not a #rrggbb as unset, and lower-cases the rest', () => {
    expect(resolve({ light: '#E3A', dark: 'red' }, { light: '#38', dark: 'var(--x)' })).toEqual({
      light: null,
      dark: null,
    });
    expect(resolve({ light: '#E3AF3F' }, { light: '#382317;color:red' })).toEqual({
      light: { fill: GOLD, ink: NAVY },
      dark: { fill: GOLD, ink: NAVY },
    });
  });

  it('ignores a stored last colour: a solid button is its one colour', () => {
    const solid = resolveButtonPairs({
      buttonColors: buttons({ light: GOLD }, {}, { light: PALE, dark: DEEP }),
      colors,
    });
    expect(solid).toEqual(resolve({ light: GOLD }));
    expect(solid.light).not.toHaveProperty('fillEnd');
  });

  it('needs no pair at all: one it cannot derive with changes nothing', () => {
    for (const pair of [
      { primary: 'oops', secondary: '' },
      { primary: NEUTRAL_BRAND.primary, secondary: '#12' },
    ]) {
      expect(
        resolveButtonPairs({ buttonColors: buttons({ light: DEEP, dark: GOLD }), colors: pair }),
      ).toEqual({ light: { fill: DEEP, ink: WHITE }, dark: { fill: GOLD, ink: NAVY } });
    }
  });

  it('never gives a theme a button without its text', () => {
    const fills = [null, GOLD, DEEP, '#e3'];
    const combos = fills.flatMap((light) =>
      fills.flatMap((dark) =>
        [null, CHOCOLATE].flatMap((inkLight) =>
          [null, WHITE].map((inkDark) =>
            resolve({ light, dark }, { light: inkLight, dark: inkDark }),
          ),
        ),
      ),
    );
    expect(combos).toHaveLength(64);
    for (const resolved of combos) {
      for (const pair of [resolved.light, resolved.dark]) {
        // Whatever is set, a theme with buttons always carries a valid text.
        if (pair) expect(hexOrNull(pair.ink)).toBe(pair.ink);
      }
    }
  });
});

describe('resolveButtonPairs, the gradient', () => {
  const colors = { primary: '#7C3AED', secondary: '#F59E0B' };
  const derived = deriveBrandColors(colors);
  const resolve = (
    fill: Partial<ThemeColors> = {},
    fillEnd: Partial<ThemeColors> = {},
    ink: Partial<ThemeColors> = {},
    darkColors: Partial<DarkColors> | null = null,
  ) => resolveButtonPairs({ buttonColors: gradient(fill, fillEnd, ink), colors, darkColors });

  it('is whole in both themes even with nothing set: each accent to its own ramp', () => {
    // CSS has no gradient to fall back to, so the automatic one goes out spelled: the theme's
    // accent, ending on that accent moved away from the text that reads on it.
    const lightEnd = rampOf(derived.primary);
    const darkEnd = rampOf(derived.primaryDark);
    expect(resolve()).toEqual({
      light: {
        style: 'gradient',
        fill: derived.primary,
        fillEnd: lightEnd,
        ink: buttonInk(derived.primary, lightEnd),
      },
      dark: {
        style: 'gradient',
        fill: derived.primaryDark,
        fillEnd: darkEnd,
        ink: buttonInk(derived.primaryDark, darkEnd),
      },
    });
    // Never the secondary: from the violet to the amber, no text read at both ends.
    expect([lightEnd, darkEnd]).not.toContain(derived.secondary);
  });

  it('takes the dark mode’s own primary for its automatic gradient, never its secondary', () => {
    const own = { primary: '#FFB4A8', secondary: '#A7F3D0' };
    const end = rampOf('#ffb4a8');
    expect(resolve({}, {}, {}, own).dark).toEqual({
      style: 'gradient',
      fill: '#ffb4a8',
      fillEnd: end,
      ink: buttonInk('#ffb4a8', end),
    });
    expect(end).not.toBe('#a7f3d0');
    // The dark secondary plays no part in the button: with it or without it, the same gradient.
    expect(resolve({}, {}, {}, { primary: '#FFB4A8' }).dark).toEqual(resolve({}, {}, {}, own).dark);
    // A malformed one is the derived accent, with its own ramp.
    expect(resolve({}, {}, {}, { primary: 'red', secondary: '#12' }).dark).toEqual(resolve().dark);
  });

  it('chooses an automatic text that reads on both colours', () => {
    // Navy reads on the gold alone; the gold-to-deep gradient takes white.
    const { light } = resolve({ light: GOLD }, { light: DEEP });
    expect(light).toEqual({ style: 'gradient', fill: GOLD, fillEnd: DEEP, ink: WHITE });
    expect(buttonInk(GOLD)).toBe(NAVY);
  });

  it('lets the dark mode inherit each light colour on its own', () => {
    // The first colour only: the dark gradient starts on it and ends on ITS ramp, never on the
    // dark accent's (the whole light gradient, text included: see below).
    expect(resolve({ light: GOLD }).dark).toEqual({
      style: 'gradient',
      fill: GOLD,
      fillEnd: rampOf(GOLD),
      ink: buttonInk(GOLD),
    });
    // With a last colour of its own, the light first colour still comes on its own.
    expect(resolve({ light: GOLD }, { dark: DEEP }).dark).toEqual({
      style: 'gradient',
      fill: GOLD,
      fillEnd: DEEP,
      ink: buttonInk(GOLD, DEEP),
    });
    // The last colour only: it starts on the dark accent.
    expect(resolve({}, { light: PALE }).dark).toEqual({
      style: 'gradient',
      fill: derived.primaryDark,
      fillEnd: PALE,
      ink: buttonInk(derived.primaryDark, PALE),
    });
  });

  it('gives the dark mode the WHOLE light gradient when only the light first colour is set', () => {
    // Its first colour, its automatic last colour (the ramp of that colour under the light text)
    // and that text: the reference's button, the same in both themes.
    for (const fill of [GOLD, DEEP, PALE]) {
      const { light, dark } = resolve({ light: fill });
      const ink = buttonInk(fill);
      expect(light, fill).toEqual({ style: 'gradient', fill, fillEnd: rampOf(fill, ink), ink });
      expect(dark, fill).toEqual(light);
    }
    // With the light text set, the ramp moves away from THAT text, in both themes alike: brighter
    // under the chocolate, deeper under white (the gold's own automatic text would brighten it).
    for (const ink of [CHOCOLATE, WHITE]) {
      const set = resolve({ light: GOLD }, {}, { light: ink });
      expect(set.light, ink).toEqual({
        style: 'gradient',
        fill: GOLD,
        fillEnd: rampOf(GOLD, ink),
        ink,
      });
      expect(set.dark, ink).toEqual(set.light);
    }
    expect(rampOf(GOLD, WHITE)).not.toBe(rampOf(GOLD));
    // The dark mode's own colours never reach a button that is the light one.
    expect(resolve({ light: GOLD }, {}, {}, { primary: '#ffb4a8', secondary: '#a7f3d0' })).toEqual(
      resolve({ light: GOLD }),
    );
  });

  it('gives the dark mode the light text while it is the very same gradient', () => {
    // Both light colours, nothing of its own: the very same gradient, the very same text.
    expect(resolve({ light: GOLD }, { light: PALE }, { light: CHOCOLATE })).toEqual({
      light: { style: 'gradient', fill: GOLD, fillEnd: PALE, ink: CHOCOLATE },
      dark: { style: 'gradient', fill: GOLD, fillEnd: PALE, ink: CHOCOLATE },
    });
    // A last colour of its own, or a first colour that is not the light one: its text is the
    // automatic one of its own gradient.
    expect(
      resolve({ light: GOLD }, { light: PALE, dark: DEEP }, { light: CHOCOLATE }).dark,
    ).toEqual({ style: 'gradient', fill: GOLD, fillEnd: DEEP, ink: buttonInk(GOLD, DEEP) });
    expect(resolve({}, { light: PALE }, { light: CHOCOLATE }).dark?.ink).toBe(
      buttonInk(derived.primaryDark, PALE),
    );
    expect(
      resolve({ light: GOLD, dark: DEEP }, { light: PALE }, { light: CHOCOLATE }).dark?.ink,
    ).toBe(buttonInk(DEEP, PALE));
    // Its own text wins either way, and an automatic last colour moves away from THAT text.
    expect(
      resolve({ light: GOLD }, { light: PALE }, { light: CHOCOLATE, dark: WHITE }).dark?.ink,
    ).toBe(WHITE);
    expect(resolve({ light: GOLD }, {}, { light: CHOCOLATE, dark: WHITE }).dark).toEqual({
      style: 'gradient',
      fill: GOLD,
      fillEnd: rampOf(GOLD, WHITE),
      ink: WHITE,
    });
  });

  it('keeps a text alone in its own theme, on the automatic gradient', () => {
    const { light, dark } = resolve({}, {}, { light: CHOCOLATE });
    // The light primary, its ramp moving away from THAT text.
    expect(light).toEqual({
      style: 'gradient',
      fill: derived.primary,
      fillEnd: rampOf(derived.primary, CHOCOLATE),
      ink: CHOCOLATE,
    });
    // The dark mode's automatic gradient, untouched by it.
    expect(dark).toEqual(resolve().dark);
  });

  it('counts a value that is not a #rrggbb as unset, and stands the neutral pair in', () => {
    expect(resolve({ light: '#E3A' }, { light: 'gold' }, { light: '#38' })).toEqual(resolve());
    const neutral = deriveBrandColors(NEUTRAL_BRAND);
    const end = rampOf(neutral.primary);
    expect(
      resolveButtonPairs({
        buttonColors: gradient(),
        colors: { primary: 'oops', secondary: NEUTRAL_BRAND.secondary },
      }).light,
    ).toEqual({
      style: 'gradient',
      fill: neutral.primary,
      fillEnd: end,
      ink: buttonInk(neutral.primary, end),
    });
  });

  it('never gives a theme a gradient without both colours and its text', () => {
    const values = [null, GOLD, '#e3'];
    for (const fillLight of values) {
      for (const fillDark of values) {
        for (const endLight of values) {
          for (const endDark of values) {
            for (const inkLight of [null, CHOCOLATE]) {
              const resolved = resolve(
                { light: fillLight, dark: fillDark },
                { light: endLight, dark: endDark },
                { light: inkLight },
              );
              for (const pair of [resolved.light, resolved.dark]) {
                expect(pair?.style).toBe('gradient');
                if (pair?.style !== 'gradient') continue;
                for (const value of [pair.fill, pair.fillEnd, pair.ink]) {
                  expect(hexOrNull(value)).toBe(value);
                }
              }
            }
          }
        }
      }
    }
  });
});

describe('effectiveButtonColors (what the "Botões" card shows)', () => {
  const colors = NEUTRAL_BRAND;
  const derived = deriveBrandColors(colors);

  it('is the theme’s own look while nothing is set: the primary, the derived dark accent', () => {
    expect(effectiveButtonColors({ colors, buttonColors: emptyButtonColors() })).toEqual({
      light: {
        style: 'solid',
        fill: derived.primary,
        fillEnd: derived.primary,
        ink: derived.onPrimary,
        from: { fill: 'auto', fillEnd: 'auto', ink: 'auto' },
      },
      dark: {
        style: 'solid',
        fill: derived.primaryDark,
        fillEnd: derived.primaryDark,
        ink: derived.onPrimaryDark,
        from: { fill: 'auto', fillEnd: 'auto', ink: 'auto' },
      },
    });
    expect(effectiveButtonColors({ colors })).toEqual(
      effectiveButtonColors({ colors, buttonColors: null }),
    );
  });

  it('follows the dark mode’s own primary while the dark button is automatic', () => {
    const look = effectiveButtonColors({
      colors,
      darkColors: { primary: '#FFB4A8', secondary: null, tone: null },
    });
    expect(look.dark).toEqual({
      style: 'solid',
      fill: '#ffb4a8',
      fillEnd: '#ffb4a8',
      ink: deriveBrandColors({ primary: '#ffb4a8', secondary: colors.secondary }).onPrimary,
      from: { fill: 'auto', fillEnd: 'auto', ink: 'auto' },
    });
    expect(look.light.fill).toBe(derived.primary);
  });

  it('says the dark mode takes the light button, text included', () => {
    const look = effectiveButtonColors({
      colors,
      darkColors: { primary: '#ffb4a8' },
      buttonColors: buttons({ light: GOLD }, { light: CHOCOLATE }),
    });
    expect(look.light).toEqual({
      style: 'solid',
      fill: GOLD,
      fillEnd: GOLD,
      ink: CHOCOLATE,
      from: { fill: 'own', fillEnd: 'own', ink: 'own' },
    });
    expect(look.dark).toEqual({
      style: 'solid',
      fill: GOLD,
      fillEnd: GOLD,
      ink: CHOCOLATE,
      from: { fill: 'light', fillEnd: 'light', ink: 'light' },
    });
    // The automatic text inherits as well.
    const auto = effectiveButtonColors({ colors, buttonColors: buttons({ light: GOLD }) }).dark;
    expect(auto).toMatchObject({ fill: GOLD, ink: NAVY, from: { fill: 'light', ink: 'light' } });
  });

  it('says what is the dark mode’s own once it has a button', () => {
    const look = effectiveButtonColors({
      colors,
      buttonColors: buttons({ light: GOLD, dark: '#1A237E' }, { light: CHOCOLATE }),
    });
    expect(look.dark).toMatchObject({ fill: DEEP, ink: WHITE, from: { fill: 'own', ink: 'auto' } });
    expect(
      effectiveButtonColors({ colors, buttonColors: buttons({ light: GOLD }, { dark: WHITE }) })
        .dark,
    ).toMatchObject({ fill: GOLD, ink: WHITE, from: { fill: 'light', ink: 'own' } });
  });

  it('keeps the theme’s button under a text alone', () => {
    const look = effectiveButtonColors({ colors, buttonColors: buttons({}, { light: CHOCOLATE }) });
    expect(look.light).toMatchObject({
      fill: derived.primary,
      ink: CHOCOLATE,
      from: { fill: 'auto', ink: 'own' },
    });
    expect(look.dark.from).toEqual({ fill: 'auto', fillEnd: 'auto', ink: 'auto' });
    expect(look.dark.fill).toBe(derived.primaryDark);
  });

  it('agrees with what the phone gets for every set colour', () => {
    const buttonColors = buttons({ light: GOLD, dark: '#1a237e' }, { light: CHOCOLATE });
    const look = effectiveButtonColors({ colors, buttonColors });
    const resolved = resolveButtonPairs({ buttonColors, colors });
    expect({ fill: look.light.fill, ink: look.light.ink }).toEqual(resolved.light);
    expect({ fill: look.dark.fill, ink: look.dark.ink }).toEqual(resolved.dark);
  });

  it('shows a gradient exactly as the phone gets it, both colours and the text', () => {
    const darkColors = { primary: '#ffb4a8', secondary: null, tone: null };
    for (const buttonColors of [
      gradient(),
      gradient({ light: GOLD }, { light: PALE }, { light: CHOCOLATE }),
      gradient({ light: GOLD, dark: DEEP }, { dark: PALE }, { dark: WHITE }),
    ]) {
      const look = effectiveButtonColors({ colors, darkColors, buttonColors });
      const resolved = resolveButtonPairs({ buttonColors, colors, darkColors });
      for (const theme of ['light', 'dark'] as const) {
        const { from, ...painted } = look[theme];
        expect(painted, theme).toEqual(resolved[theme]);
        expect(from, theme).toBeDefined();
      }
    }
  });

  it('says where each colour of a gradient comes from', () => {
    // Nothing set: all automatic.
    expect(effectiveButtonColors({ colors, buttonColors: gradient() }).dark.from).toEqual({
      fill: 'auto',
      fillEnd: 'auto',
      ink: 'auto',
    });
    // Both light colours: the dark mode takes them, and the text with them.
    const both = effectiveButtonColors({
      colors,
      buttonColors: gradient({ light: GOLD }, { light: PALE }, { light: CHOCOLATE }),
    });
    expect(both.light.from).toEqual({ fill: 'own', fillEnd: 'own', ink: 'own' });
    expect(both.dark.from).toEqual({ fill: 'light', fillEnd: 'light', ink: 'light' });
    expect(both.dark.ink).toBe(CHOCOLATE);
    // The first light colour only: the dark mode takes the whole light gradient, its last colour
    // and its text along with it, both automatic on the light side.
    const first = effectiveButtonColors({ colors, buttonColors: gradient({ light: GOLD }) });
    expect(first.light.from).toEqual({ fill: 'own', fillEnd: 'auto', ink: 'auto' });
    expect(first.dark.from).toEqual({ fill: 'light', fillEnd: 'light', ink: 'light' });
    expect(first.dark.fillEnd).toBe(first.light.fillEnd);
    expect(first.dark.ink).toBe(first.light.ink);
    // The last light colour only: that one comes on its own, the first colour and the text
    // automatic.
    const last = effectiveButtonColors({ colors, buttonColors: gradient({}, { light: PALE }) });
    expect(last.dark.from).toEqual({ fill: 'auto', fillEnd: 'light', ink: 'auto' });
    // A dark colour of its own stops that colour's inheritance only.
    const own = effectiveButtonColors({
      colors,
      buttonColors: gradient({ light: GOLD }, { light: PALE, dark: DEEP }),
    });
    expect(own.dark.from).toEqual({ fill: 'light', fillEnd: 'own', ink: 'auto' });
    // A dark text of its own on the other side of the inherited first colour turns its automatic
    // last colour the other way (the gold deepens under white where it brightens under chocolate):
    // a colour the light mode does not show, so the dark mode's own automatic one.
    for (const ink of [{ light: CHOCOLATE, dark: WHITE }, { dark: WHITE }]) {
      const turned = effectiveButtonColors({
        colors,
        buttonColors: gradient({ light: GOLD }, {}, ink),
      });
      expect(turned.light.fillEnd, ink.light).toBe(rampOf(GOLD));
      expect(turned.dark.fillEnd, ink.light).toBe(rampOf(GOLD, WHITE));
      expect(turned.dark.fillEnd, ink.light).not.toBe(turned.light.fillEnd);
      expect(turned.dark.from, ink.light).toEqual({ fill: 'light', fillEnd: 'auto', ink: 'own' });
    }
    // On the same side, the ramp comes out as the very colour of the light one, and says so.
    const same = effectiveButtonColors({
      colors,
      buttonColors: gradient({ light: GOLD }, {}, { dark: CHOCOLATE }),
    });
    expect(same.dark.fillEnd).toBe(same.light.fillEnd);
    expect(same.dark.from).toEqual({ fill: 'light', fillEnd: 'light', ink: 'own' });
  });

  it('never says "the light one’s" next to a colour the light mode does not show', () => {
    // Every mix of light and dark colours, set or not, solid or gradient, with and without the
    // dark mode's own primary: a dark colour said to come from the light mode IS the light one.
    const both = (light: (string | null)[], dark: (string | null)[]): ThemeColors[] =>
      light.flatMap((one) => dark.map((other) => ({ light: one, dark: other })));
    const ownDark = { primary: '#ffd400', secondary: '#7c3aed', tone: null };
    const lies: string[] = [];
    let said = 0;
    for (const style of ['solid', 'gradient'] as const) {
      for (const darkColors of [null, ownDark]) {
        for (const fill of both([null, GOLD, DEEP, WHITE], [null, PALE])) {
          for (const fillEnd of both([null, PALE], [null, DEEP])) {
            for (const ink of both([null, CHOCOLATE, WHITE], [null, WHITE, CHOCOLATE])) {
              const buttonColors = buttons(fill, ink, fillEnd, style);
              const look = effectiveButtonColors({ colors, darkColors, buttonColors });
              for (const part of ['fill', 'fillEnd', 'ink'] as const) {
                if (look.dark.from[part] !== 'light') continue;
                said += 1;
                if (look.dark[part] !== look.light[part]) {
                  lies.push(`${part} of ${JSON.stringify(buttonColors)}`);
                }
              }
            }
          }
        }
      }
    }
    // Not a vacuous sweep: the dark mode says it takes a light colour hundreds of times.
    expect(said).toBeGreaterThan(100);
    expect(lies, lies.slice(0, 3).join(' | ')).toEqual([]);
  });

  it('never throws on a pair it cannot derive from: the neutral pair stands in', () => {
    const neutral = effectiveButtonColors({ colors: NEUTRAL_BRAND });
    const neutralGradient = effectiveButtonColors({
      colors: NEUTRAL_BRAND,
      buttonColors: gradient(),
    });
    for (const pair of [
      { primary: 'oops', secondary: NEUTRAL_BRAND.secondary },
      { primary: NEUTRAL_BRAND.primary, secondary: '#12' },
    ]) {
      expect(effectiveButtonColors({ colors: pair })).toEqual(neutral);
      expect(effectiveButtonColors({ colors: pair, buttonColors: gradient() })).toEqual(
        neutralGradient,
      );
    }
    // A malformed dark primary is the derived accent.
    expect(effectiveButtonColors({ colors, darkColors: { primary: 'red' } }).dark.fill).toBe(
      derived.primaryDark,
    );
  });
});

describe('buttonTextContrast (the card’s pill)', () => {
  it('is the text on the one colour of a solid button', () => {
    const look = effectiveButtonColors({
      colors: NEUTRAL_BRAND,
      buttonColors: buttons({ light: GOLD }, { light: CHOCOLATE }),
    });
    expect(buttonTextContrast(look.light)).toBe(contrastRatio(GOLD, CHOCOLATE));
  });

  it('is the lower of a gradient’s two, where the text reads worst', () => {
    const look = { fill: GOLD, fillEnd: DEEP, ink: WHITE };
    expect(contrastRatio(GOLD, WHITE)).toBeLessThan(contrastRatio(DEEP, WHITE));
    expect(buttonTextContrast(look)).toBe(contrastRatio(GOLD, WHITE));
    expect(buttonTextContrast({ ...look, fill: DEEP, fillEnd: GOLD })).toBe(
      contrastRatio(GOLD, WHITE),
    );
  });

  it('reads an untouched gradient exactly as the solid button of its first colour', () => {
    // The neutral pair, and a chocolate primary beside the reference's gold. The automatic last
    // colour moves away from the text, so the text reads worst on the first colour, the solid one.
    for (const colors of [NEUTRAL_BRAND, { primary: CHOCOLATE, secondary: GOLD }]) {
      const solid = effectiveButtonColors({ colors, buttonColors: emptyButtonColors() });
      const untouched = effectiveButtonColors({ colors, buttonColors: gradient() });
      for (const theme of ['light', 'dark'] as const) {
        const at = `${colors.primary}, ${theme}`;
        expect(untouched[theme].fill, at).toBe(solid[theme].fill);
        expect(untouched[theme].ink, at).toBe(solid[theme].ink);
        expect(untouched[theme].fillEnd, at).not.toBe(untouched[theme].fill);
        expect(buttonTextContrast(untouched[theme]), at).toBe(buttonTextContrast(solid[theme]));
      }
      // The pair's own gradient, the primary to the secondary, left no text readable at both ends.
      const pair = { fill: colors.primary, fillEnd: colors.secondary };
      expect(
        buttonTextContrast({ ...pair, ink: buttonInk(pair.fill, pair.fillEnd) }),
        colors.primary,
      ).toBeLessThan(4.5);
    }
  });
});

describe('previewScreenLook', () => {
  const colors = NEUTRAL_BRAND;
  const { secondary } = colors;

  it('adds nothing when nothing is set, in either theme', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(previewScreenLook({ theme, colors })).toEqual({ attributes: {}, style: {} });
      expect(
        previewScreenLook({
          theme,
          colors,
          lightTone: null,
          darkColors: emptyDarkColors(),
          fontColors: emptyFontColors(),
          buttonColors: emptyButtonColors(),
        }),
      ).toEqual({ attributes: {}, style: {} });
    }
  });

  it('carries both tone ids whatever the theme, never a default or unknown one', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(
        previewScreenLook({
          theme,
          colors,
          lightTone: 'amarelado',
          darkColors: { tone: 'petroleo' },
        }).attributes,
      ).toEqual({ 'data-bg-tone': 'amarelado', 'data-dark-tone': 'petroleo' });
      expect(
        previewScreenLook({ theme, colors, lightTone: 'cinza', darkColors: { tone: 'grafite' } })
          .attributes,
      ).toEqual({});
      expect(
        previewScreenLook({
          theme,
          colors,
          lightTone: 'amarelado;color:red',
          darkColors: { tone: 'constructor' as DarkColors['tone'] },
        }).attributes,
      ).toEqual({});
    }
  });

  it('applies the dark primary (with the ink that reads on it) and secondary in dark only', () => {
    const darkColors = { primary: '#F5D76E', secondary: '#7C3AED', tone: null };
    expect(previewScreenLook({ theme: 'light', colors, darkColors }).style).toEqual({});
    // Both primaries: the accent, and the one the gradient, the hover shade and the art read, so a
    // dark screen never mixes the dark accent with the light primary's hue.
    expect(previewScreenLook({ theme: 'dark', colors, darkColors }).style).toEqual({
      '--brand-primary': '#f5d76e',
      '--brand-on-primary': NAVY,
      '--brand-primary-dark': '#f5d76e',
      '--brand-on-primary-dark': NAVY,
      '--brand-secondary': '#7c3aed',
    });
    // A deep primary takes white, exactly as `deriveBrandColors` decides for any primary.
    const deep = previewScreenLook({
      theme: 'dark',
      colors,
      darkColors: { primary: '#1a237e' },
    });
    expect(deep.style['--brand-on-primary-dark']).toBe(WHITE);
    expect(deep.style['--brand-on-primary']).toBe(WHITE);
    expect(deep.style['--brand-on-primary-dark']).toBe(
      deriveBrandColors({ primary: '#1a237e', secondary }).onPrimary,
    );
    // Never throws on a pair it cannot derive from: the secondary only completes the call.
    expect(
      previewScreenLook({
        theme: 'dark',
        colors: { primary: colors.primary, secondary: 'oops' },
        darkColors: { primary: '#1a237e' },
      }).style['--brand-primary-dark'],
    ).toBe('#1a237e');
  });

  it('leaves an invalid dark colour out instead of guessing', () => {
    expect(
      previewScreenLook({
        theme: 'dark',
        colors,
        darkColors: { primary: '#12', secondary: 'red;x:y', tone: null },
      }),
    ).toEqual({ attributes: {}, style: {} });
  });

  it('gives the screen the font colours of the CURRENT theme, each with its marker', () => {
    const fontColors: FontColors = {
      title: { light: '#AA0000', dark: '#00AA00' },
      appName: { light: null, dark: '#0000AA' },
    };
    expect(previewScreenLook({ theme: 'light', colors, fontColors })).toEqual({
      attributes: { 'data-title-color': '' },
      style: { '--preview-title-color': '#aa0000' },
    });
    expect(previewScreenLook({ theme: 'dark', colors, fontColors })).toEqual({
      attributes: { 'data-title-color': '', 'data-app-name-color': '' },
      style: { '--preview-title-color': '#00aa00', '--preview-app-name-color': '#0000aa' },
    });
    expect(
      previewScreenLook({
        theme: 'light',
        colors,
        fontColors: { title: { light: 'blue' }, appName: { light: '#1' } },
      }),
    ).toEqual({ attributes: {}, style: {} });
  });

  it('gives the screen the buttons’ raw keys of BOTH themes whatever its theme, no marker', () => {
    // The reference: a gold button with chocolate text in the light mode, inherited by the dark.
    const buttonColors = buttons({ light: '#E3AF3F' }, { light: '#382317' });
    const pair = { fill: GOLD, ink: CHOCOLATE };
    for (const theme of ['light', 'dark'] as const) {
      expect(previewScreenLook({ theme, colors, buttonColors })).toEqual({
        attributes: {},
        style: {
          '--button-fill-light': GOLD,
          '--button-ink-light': CHOCOLATE,
          '--button-hover-light': 'color-mix(in oklch, #e3af3f, white 12%)',
          '--button-fill-dark': GOLD,
          '--button-ink-dark': CHOCOLATE,
          '--button-hover-dark': 'color-mix(in oklch, #e3af3f, white 12%)',
        },
      });
      expect(previewScreenLook({ theme, colors, buttonColors }).style).toEqual({
        ...buttonThemeVars('light', pair),
        ...buttonThemeVars('dark', pair),
      });
    }
  });

  it('gives a dark button of its own only to the dark keys, with the text that reads on it', () => {
    const style = previewScreenLook({
      theme: 'light',
      colors,
      buttonColors: buttons({ dark: '#1A237E' }),
    }).style;
    expect(style).toEqual({
      '--button-fill-dark': DEEP,
      '--button-ink-dark': WHITE,
      '--button-hover-dark': buttonHover(DEEP, WHITE),
    });
    // A text alone reaches its own theme's ink key alone: the button stays the accent.
    expect(
      previewScreenLook({
        theme: 'dark',
        colors,
        buttonColors: { ink: { light: '#382317' } },
      }).style,
    ).toEqual({ '--button-ink-light': CHOCOLATE });
  });

  it('keeps the buttons beside the dark colours, each under its own keys', () => {
    const look = previewScreenLook({
      theme: 'dark',
      colors,
      darkColors: { primary: '#F5D76E' },
      buttonColors: { fill: { light: '#1a237e' } },
    });
    expect(look.style['--brand-primary-dark']).toBe('#f5d76e');
    expect(look.style['--button-fill-dark']).toBe(DEEP);
    expect(look.style['--button-fill-light']).toBe(DEEP);
    expect(look.attributes).toEqual({});
  });

  it('gives the reels stage of a light screen the dark screen’s button under a dark text alone', () => {
    const draft = {
      colors,
      darkColors: { primary: '#FFD400' },
      buttonColors: { ink: { dark: '#000000' } },
    };
    // A light screen keeps the derived dark accent, so the stage gets the dark primary as its fill,
    // with today's hover shade over it: the very button the dark screen paints.
    expect(previewScreenLook({ theme: 'light', ...draft }).style).toEqual({
      '--button-fill-dark': '#ffd400',
      '--button-ink-dark': '#000000',
      '--button-hover-dark': 'color-mix(in oklch, #ffd400, black 12%)',
    });
    // The dark screen already paints that primary as its accent: the text alone stays alone.
    const dark = previewScreenLook({ theme: 'dark', ...draft }).style;
    expect(dark['--brand-primary-dark']).toBe('#ffd400');
    expect(dark['--button-ink-dark']).toBe('#000000');
    expect(dark['--button-fill-dark']).toBeUndefined();
    expect(dark['--button-hover-dark']).toBeUndefined();
    // Without a dark primary of its own the derived accent is what both screens show.
    expect(
      previewScreenLook({ theme: 'light', colors, buttonColors: { ink: { dark: '#000000' } } })
        .style,
    ).toEqual({ '--button-ink-dark': '#000000' });
    // A dark fill of its own, or one inherited from the light button, is never replaced.
    expect(
      previewScreenLook({
        theme: 'light',
        ...draft,
        buttonColors: { fill: { light: '#e3af3f' }, ink: { dark: '#000000' } },
      }).style['--button-fill-dark'],
    ).toBe(GOLD);
  });

  it('gives a gradient both themes’ keys whole, image and hovered image, whatever the theme', () => {
    const buttonColors = gradient({ light: GOLD }, { light: PALE }, { light: CHOCOLATE });
    for (const theme of ['light', 'dark'] as const) {
      const { attributes, style } = previewScreenLook({ theme, colors, buttonColors });
      expect(attributes).toEqual({});
      expect(style).toEqual({
        '--button-fill-light': GOLD,
        '--button-ink-light': CHOCOLATE,
        '--button-hover-light': buttonHover(GOLD, CHOCOLATE),
        '--button-image-light': buttonGradient(GOLD, PALE),
        '--button-image-hover-light': buttonGradientHover(GOLD, PALE, CHOCOLATE),
        // The dark mode takes both colours, so the very same gradient with the very same text.
        '--button-fill-dark': GOLD,
        '--button-ink-dark': CHOCOLATE,
        '--button-hover-dark': buttonHover(GOLD, CHOCOLATE),
        '--button-image-dark': buttonGradient(GOLD, PALE),
        '--button-image-hover-dark': buttonGradientHover(GOLD, PALE, CHOCOLATE),
      });
    }
  });

  it('spells the automatic gradient too: nothing in CSS stands in for it', () => {
    const style = previewScreenLook({ theme: 'light', colors, buttonColors: gradient() }).style;
    const resolved = resolveButtonPairs({ buttonColors: gradient(), colors });
    expect(style).toEqual({
      ...buttonThemeVars('light', resolved.light),
      ...buttonThemeVars('dark', resolved.dark),
    });
    const derived = deriveBrandColors(colors);
    // Each theme's accent to its ramp, away from the text that reads on it.
    expect(style['--button-image-light']).toBe(
      buttonGradient(derived.primary, rampOf(derived.primary)),
    );
    expect(style['--button-image-dark']).toBe(
      buttonGradient(derived.primaryDark, rampOf(derived.primaryDark)),
    );
  });

  it('gives the reels stage of a light screen the dark screen’s gradient, whole', () => {
    const draft = {
      colors,
      darkColors: { primary: '#FFD400', secondary: '#7C3AED' },
      buttonColors: gradient({}, {}, { dark: '#000000' }),
    };
    const darkKeys = (style: Record<string, string>) =>
      Object.fromEntries(Object.entries(style).filter(([name]) => /^--button-.*-dark$/.test(name)));
    const light = previewScreenLook({ theme: 'light', ...draft }).style;
    const dark = previewScreenLook({ theme: 'dark', ...draft }).style;
    // The dark mode's own primary to its ramp under the dark text, on both screens alike.
    expect(darkKeys(light)).toEqual(darkKeys(dark));
    expect(light['--button-fill-dark']).toBe('#ffd400');
    expect(light['--button-image-dark']).toBe(
      buttonGradient('#ffd400', rampOf('#ffd400', '#000000')),
    );
    expect(light['--button-ink-dark']).toBe('#000000');
    // Its own secondary plays no part in the button.
    expect(
      darkKeys(
        previewScreenLook({ theme: 'light', ...draft, darkColors: { primary: '#FFD400' } }).style,
      ),
    ).toEqual(darkKeys(light));
    // The solid text-alone repair never touches a gradient: its hover moves away from the text.
    expect(light['--button-hover-dark']).toBe(buttonHover('#ffd400', '#000000'));
  });

  it('leaves an invalid button colour out, and never throws on the pair', () => {
    expect(
      previewScreenLook({
        theme: 'light',
        colors,
        buttonColors: { fill: { light: '#12', dark: 'red' }, ink: { light: 'x', dark: '#1' } },
      }),
    ).toEqual({ attributes: {}, style: {} });
    expect(
      previewScreenLook({
        theme: 'light',
        colors: { primary: colors.primary, secondary: 'oops' },
        buttonColors: { fill: { light: '#1a237e' } },
      }).style['--button-ink-light'],
    ).toBe(WHITE);
    const neutral = deriveBrandColors(NEUTRAL_BRAND);
    expect(
      previewScreenLook({
        theme: 'light',
        colors: { primary: 'oops', secondary: 'oops' },
        buttonColors: gradient(),
      }).style['--button-image-light'],
    ).toBe(buttonGradient(neutral.primary, rampOf(neutral.primary)));
  });
});

/**
 * The look kept with the tenant (2026-10-03): the translation between the fields the cards edit
 * (the draft's names, the dark ground inside `darkColors`) and the contract's `look` (the dark ground
 * apart, `darkTone`), and the look as the APP paints it on its brand scope (`appBrandLook`), for both
 * themes at once since the theme flips on the client.
 */
const LOOK: BrandLook = {
  lightTone: 'amarelado',
  darkTone: 'cafe',
  darkColors: { primary: '#ffb4a8', secondary: '#7dd3fc' },
  titleFont: 'Playfair Display',
  fontColors: {
    title: { light: '#7c2d12', dark: '#ffd27a' },
    appName: { light: '#0f766e', dark: null },
  },
  buttonColors: gradient({ light: GOLD }, { light: PALE }, { light: CHOCOLATE }),
};

describe('lookFieldsOf / lookBodyOf (the cards’ fields and the contract’s look)', () => {
  it('reads nothing (an older brand) as the system look, in the fields’ shape', () => {
    for (const nothing of [null, undefined, {}]) {
      expect(lookFieldsOf(nothing)).toEqual({
        titleFont: null,
        lightTone: null,
        darkColors: emptyDarkColors(),
        fontColors: emptyFontColors(),
        buttonColors: emptyButtonColors(),
      });
    }
  });

  it('moves the dark ground into the fields’ darkColors and back out, losslessly', () => {
    const fields = lookFieldsOf(LOOK);
    expect(fields.darkColors).toEqual({ primary: '#ffb4a8', secondary: '#7dd3fc', tone: 'cafe' });
    expect(fields.lightTone).toBe('amarelado');
    expect(fields.titleFont).toBe('Playfair Display');
    expect(lookBodyOf(fields)).toEqual(LOOK);
    expect(lookFieldsOf(lookBodyOf(fields))).toEqual(fields);
  });

  it('sends only what the API accepts: a strict, complete, canonical look', () => {
    const body = lookBodyOf({
      ...lookFieldsOf(LOOK),
      lightTone: DEFAULT_LIGHT_TONE,
      titleFont: 'Manrope',
      darkColors: { primary: '#ffb4', secondary: 'red', tone: DEFAULT_DARK_TONE },
      fontColors: { title: { light: '#7C2D12' }, appName: 'oops' },
    });
    expect(brandingLookBodySchema.safeParse(body).success).toBe(true);
    expect(body.lightTone).toBeNull();
    expect(body.darkTone).toBeNull();
    expect(body.titleFont).toBeNull();
    expect(body.darkColors).toEqual({ primary: null, secondary: null });
    expect(body.fontColors).toEqual({
      title: { light: '#7c2d12', dark: null },
      appName: { light: null, dark: null },
    });
    expect(lookBodyOf('nothing at all')).toEqual(emptyBrandLook());
    expect(lookBodyOf({ titleFont: 'Pop"pins' }).titleFont).toBeNull();
  });

  it('keeps a solid button’s last colours aside, as the cards do', () => {
    const solid = lookBodyOf({ buttonColors: buttons({ light: GOLD }, {}, { light: PALE }) });
    expect(solid.buttonColors.style).toBe('solid');
    expect(solid.buttonColors.fillEnd.light).toBe(PALE);
  });

  it('sameLook compares what would be saved', () => {
    expect(sameLook(lookFieldsOf(LOOK), LOOK)).toBe(true);
    expect(sameLook({}, emptyBrandLook())).toBe(true);
    expect(sameLook({ lightTone: DEFAULT_LIGHT_TONE }, {})).toBe(true);
    expect(sameLook({ lightTone: 'lilas' }, {})).toBe(false);
    expect(sameLook(LOOK, { ...LOOK, titleFont: null })).toBe(false);
  });
});

describe('appBrandLook (the saved look on the app’s brand scope)', () => {
  const colors = { primary: '#7c3aed', secondary: '#a78bfa' };
  const keysOf = (style: Record<string, string>, prefix: string) =>
    Object.fromEntries(Object.entries(style).filter(([key]) => key.startsWith(prefix)));

  it('renders nothing at all for the system look (every older tenant)', () => {
    for (const look of [null, undefined, {}, emptyBrandLook()]) {
      expect(appBrandLook({ colors, look })).toEqual({ attributes: {}, style: {} });
    }
    expect(
      appBrandLook({
        colors,
        look: { lightTone: DEFAULT_LIGHT_TONE, darkTone: DEFAULT_DARK_TONE },
      }),
    ).toEqual({ attributes: {}, style: {} });
  });

  it('carries both tone ids, whatever the theme (tokens.css picks each under its own)', () => {
    const { attributes } = appBrandLook({ colors, look: LOOK });
    expect(attributes['data-bg-tone']).toBe('amarelado');
    expect(attributes['data-dark-tone']).toBe('cafe');
  });

  it('marks the own dark pair and spells it, the primary with the ink that reads on it', () => {
    const { attributes, style } = appBrandLook({ colors, look: LOOK });
    expect(attributes['data-dark-primary']).toBe('');
    expect(attributes['data-dark-secondary']).toBe('');
    expect(style['--brand-primary-dark']).toBe('#ffb4a8');
    expect(style['--brand-on-primary-dark']).toBe(NAVY);
    expect(style['--brand-secondary-dark']).toBe('#7dd3fc');
    // Never the light keys: those stay `brandStyleVars`', which tokens.css swaps under dark.
    expect(style).not.toHaveProperty('--brand-primary');
    expect(style).not.toHaveProperty('--brand-secondary');
    const automatic = appBrandLook({ colors, look: { darkTone: 'musgo' } });
    expect(automatic.attributes).not.toHaveProperty('data-dark-primary');
    expect(automatic.style).not.toHaveProperty('--brand-primary-dark');
  });

  it('marks the title font only once its stack is known (the catalogue confirmed it)', () => {
    expect(appBrandLook({ colors, look: LOOK }).attributes).not.toHaveProperty('data-title-font');
    const stack = '"Playfair Display", var(--font-manrope), system-ui, sans-serif';
    const { attributes, style } = appBrandLook({ colors, look: LOOK, titleFontStack: stack });
    expect(attributes['data-title-font']).toBe('');
    expect(style['--brand-title-font']).toBe(stack);
  });

  it('carries each ink of each theme with its own marker, and no marker for an unset one', () => {
    const { attributes, style } = appBrandLook({ colors, look: LOOK });
    expect(attributes['data-title-color-light']).toBe('');
    expect(attributes['data-title-color-dark']).toBe('');
    expect(attributes['data-app-name-color-light']).toBe('');
    expect(attributes).not.toHaveProperty('data-app-name-color-dark');
    expect(style['--brand-title-light']).toBe('#7c2d12');
    expect(style['--brand-title-dark']).toBe('#ffd27a');
    expect(style['--brand-app-name-light']).toBe('#0f766e');
    expect(style).not.toHaveProperty('--brand-app-name-dark');
  });

  it('paints the buttons of both themes exactly as the phone does', () => {
    for (const buttonColors of [
      buttons({ light: GOLD }, { light: CHOCOLATE }),
      buttons({ dark: DEEP }),
      gradient({ light: GOLD }, { light: PALE }, { light: CHOCOLATE }),
      gradient(),
    ]) {
      const app = appBrandLook({ colors, look: { buttonColors } }).style;
      const phone = previewScreenLook({ theme: 'light', colors, buttonColors }).style;
      expect(keysOf(app, '--button-')).toEqual(keysOf(phone, '--button-'));
    }
    const solid = appBrandLook({ colors, look: { buttonColors: buttons({ light: GOLD }) } });
    // The dark theme inherits the light button, its text included.
    expect(solid.style['--button-fill-dark']).toBe(GOLD);
    expect(solid.style['--button-ink-dark']).toBe(buttonInk(GOLD));
  });

  it('spells the dark fill for a dark text set alone with the own dark primary', () => {
    const { style } = appBrandLook({
      colors,
      look: {
        darkColors: { primary: '#ffb4a8', secondary: null },
        buttonColors: buttons({}, { dark: '#3a0d05' }),
      },
    });
    expect(style['--button-ink-dark']).toBe('#3a0d05');
    expect(style['--button-fill-dark']).toBe('#ffb4a8');
    expect(style['--button-hover-dark']).toBe('color-mix(in oklch, #ffb4a8, black 12%)');
  });

  it('leaves out what does not pass, never guessing', () => {
    const look = {
      lightTone: 'rosa',
      darkTone: '#000000',
      darkColors: { primary: 'red', secondary: '#12' },
      fontColors: { title: { light: 'navy' } },
      buttonColors: { fill: { light: '#12', dark: 'red' } },
    } as unknown as Partial<BrandLook>;
    expect(appBrandLook({ colors, look })).toEqual({ attributes: {}, style: {} });
  });
});
