import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  contrastRatio,
  deriveBrandColors,
  NAVY,
  relativeLuminance,
  WHITE,
} from '@rede-social/contracts/branding';
import { describe, expect, it } from 'vitest';
import {
  BUTTON_COLOR_KEYS,
  BUTTON_STYLES,
  type ButtonPair,
  type ButtonTheme,
  buttonGradient,
  buttonGradientHover,
  buttonHover,
  buttonInk,
  buttonRampEnd,
  buttonThemeVars,
} from '../ui';

/**
 * The filled buttons' own colours (2026-10-03): the raw keys a brand scope carries inline, the
 * automatic ink, the hover shade, a gradient's automatic last colour, the gradient and the
 * per-theme record (`ui/button-colors.ts`). The claims a later edit could quietly break:
 *
 *  1. The keys are exactly the ten of the token contract (five per theme: the fill, the ink, the
 *     hover and a gradient's image and hovered image), the very ones tokens.css reads (each into
 *     its own part's token, and never declared there), and none trips the token-name guards of
 *     tokens.test.ts.
 *  2. The automatic ink is white or navy: for one colour exactly the contracts' `onPrimary`, for a
 *     gradient the one that reads better where it reads worst.
 *  3. The hover moves the fill AWAY from its ink, 12% in oklch: towards white under a darker ink
 *     (the reference's gold under chocolate), towards black otherwise (today's hover); a gradient's
 *     hover moves each of its colours that way and blends them in sRGB, as the image's hexes blend,
 *     so the middle of the button keeps its hue under the pointer.
 *  4. A gradient's automatic last colour moves its first one 30% of the way AWAY from the text in
 *     sRGB, the hover's way (the reference's gold to a pale gold under chocolate), so the text
 *     never reads worse on it than on the first colour, and the automatic text of the two is the
 *     solid button's.
 *  5. A fill never goes out without its ink: the pair's own, else the automatic one; an ink alone
 *     goes alone (no fill, no hover); a gradient goes out complete, its image over its first colour.
 *  6. Only a hex the brand schema accepts reaches a style, lower-cased; anything else adds nothing,
 *     and nothing it is handed makes it throw.
 */

/** The reference (Reine): a gold button with chocolate text, the same in both themes. */
const GOLD = '#e3af3f';
const CHOCOLATE = '#382317';
/** A deep fill that takes white text. */
const DEEP = '#1a237e';
/** A pale gold that takes navy text. */
const PALE = '#ffd27a';

/** Shapes the brand schema refuses (a style must never see one). */
const NOT_HEX: unknown[] = [
  '#e3a',
  '#e3af3f00',
  'e3af3f',
  '#gggggg',
  '#e3af3f;color:red',
  'red',
  'var(--brand-primary)',
  'color-mix(in oklch, #e3af3f, white 12%)',
  '',
  null,
  undefined,
  42,
  {},
  ['#e3af3f'],
];

/**
 * Every value a record may hold: a lower-cased hex, the hover's colour-mix over one, a 135deg
 * gradient of two hexes (the image), or of two colour-mixes blended in sRGB (the hovered image).
 */
const HEX = '#[0-9a-f]{6}';
const MIX = `color-mix\\(in oklch, ${HEX}, (?:white|black) 12%\\)`;
const GRADIENT = (stop: string, method = '') =>
  `linear-gradient\\(135deg${method}, ${stop}, ${stop}\\)`;
const HOVER_GRADIENT = GRADIENT(MIX, ' in srgb');
const SAFE_VALUE = new RegExp(`^(?:${HEX}|${MIX}|${GRADIENT(HEX)}|${HOVER_GRADIENT})$`);

/** The token each part of the keys feeds, as tokens.css declares it. */
const TOKEN = {
  fill: '--button-fill',
  ink: '--button-ink',
  hover: '--button-hover',
  image: '--button-image',
  imageHover: '--button-image-hover',
} as const;

describe('BUTTON_COLOR_KEYS', () => {
  it('are the ten raw keys of the token contract, five per theme', () => {
    expect(BUTTON_COLOR_KEYS).toEqual({
      light: {
        fill: '--button-fill-light',
        ink: '--button-ink-light',
        hover: '--button-hover-light',
        image: '--button-image-light',
        imageHover: '--button-image-hover-light',
      },
      dark: {
        fill: '--button-fill-dark',
        ink: '--button-ink-dark',
        hover: '--button-hover-dark',
        image: '--button-image-dark',
        imageHover: '--button-image-hover-dark',
      },
    });
  });

  it('are the keys tokens.css reads, each into its own token, never declared there', () => {
    // The two sides of the contract live in two packages: `ui/button-colors.ts` spells the keys a
    // scope carries inline, `@rede-social/ui`'s tokens.css falls back from them. A key renamed on
    // one side only would leave every button on the primary without a single failing render.
    const css = readFileSync(
      fileURLToPath(new URL('../../ui/src/styles/tokens.css', import.meta.url)),
      'utf8',
    );
    const names = Object.values(BUTTON_COLOR_KEYS).flatMap((keys) => Object.values(keys));
    // Read anywhere in the file: exactly these ten, each with its fallback.
    const read = new Set(
      [...css.matchAll(/var\((--button-[a-z]+(?:-[a-z]+)*-(?:light|dark)),/g)].map((m) => m[1]),
    );
    expect(read).toEqual(new Set(names));
    // Each one into the token of its own part...
    for (const theme of ['light', 'dark'] as const) {
      for (const [part, key] of Object.entries(BUTTON_COLOR_KEYS[theme])) {
        expect(css, key).toContain(`${TOKEN[part as keyof typeof TOKEN]}: var(${key}, `);
      }
    }
    // ...and never into another part's (a fill key feeding the ink, say), in any rule.
    const into = /(--button-(?:fill|ink|hover|image|image-hover)): var\((--button-[a-z-]+?),/g;
    for (const m of css.matchAll(into)) {
      const part = Object.entries(TOKEN).find(([, token]) => token === m[1])?.[0] as
        | keyof typeof TOKEN
        | undefined;
      expect(part, m[0]).toBeDefined();
      if (!part) continue;
      expect([BUTTON_COLOR_KEYS.light[part], BUTTON_COLOR_KEYS.dark[part]], m[0]).toContain(m[2]);
    }
    // Only an inline style sets them: a default here would freeze every tenant's button.
    for (const name of names) {
      expect(css, name).not.toMatch(new RegExp(`^\\s*${name}\\s*:`, 'm'));
    }
  });

  it('never trip the token-name guards (no prototype palette or class word)', () => {
    const names = Object.values(BUTTON_COLOR_KEYS).flatMap((keys) => Object.values(keys));
    expect(new Set(names).size).toBe(10);
    for (const name of names) {
      expect(name, name).toMatch(/^--button-(fill|ink|hover|image|image-hover)-(light|dark)$/);
      expect(name, name).not.toMatch(/gold|emerald|forest|teal|sage|mist|pill-|btn-|cta/);
    }
  });

  it('come with the two styles, solid first (the default)', () => {
    expect([...BUTTON_STYLES]).toEqual(['solid', 'gradient']);
  });
});

describe('buttonInk', () => {
  it('is the contracts’ onPrimary for a single colour', () => {
    for (const fill of [GOLD, DEEP, CHOCOLATE, PALE, '#2e6fd0', '#5b9cf8', '#777777', '#ef4444']) {
      const expected = deriveBrandColors({ primary: fill, secondary: fill }).onPrimary;
      expect(buttonInk(fill), fill).toBe(expected);
      expect(buttonInk(fill, null), fill).toBe(expected);
      // A gradient of one colour twice is that colour.
      expect(buttonInk(fill, fill), fill).toBe(expected);
    }
  });

  it('holds a gradient’s text to the colour it reads worst on', () => {
    // Navy on the gold alone (7.8:1), but on the gold-to-deep gradient navy falls to 1.2:1 on the
    // deep end while white keeps 2:1 on the gold one: white is the better of the two worst.
    expect(buttonInk(GOLD)).toBe(NAVY);
    expect(buttonInk(GOLD, DEEP)).toBe(WHITE);
    const worst = (ink: string) => Math.min(contrastRatio(ink, GOLD), contrastRatio(ink, DEEP));
    expect(worst(WHITE)).toBeGreaterThan(worst(NAVY));
    // Two light colours keep navy, two deep ones white.
    expect(buttonInk(GOLD, PALE)).toBe(NAVY);
    expect(buttonInk(DEEP, CHOCOLATE)).toBe(WHITE);
  });

  it('does not depend on the order of the two colours', () => {
    for (const [a, b] of [
      [GOLD, DEEP],
      [GOLD, PALE],
      ['#2e6fd0', '#5b9cf8'],
      ['#7c3aed', '#f59e0b'],
    ] as const) {
      expect(buttonInk(a, b), `${a} ${b}`).toBe(buttonInk(b, a));
    }
  });

  it('takes valid hexes only, as deriveBrandColors does', () => {
    expect(buttonInk(' #E3AF3F ')).toBe(NAVY);
    expect(() => buttonInk('red')).toThrow();
    expect(() => buttonInk(GOLD, '#12')).toThrow();
  });
});

describe('buttonHover', () => {
  it('moves a light fill towards white under a darker ink (the reference gold)', () => {
    expect(buttonHover(GOLD, CHOCOLATE)).toBe(`color-mix(in oklch, ${GOLD}, white 12%)`);
    expect(buttonHover(GOLD, NAVY)).toBe(`color-mix(in oklch, ${GOLD}, white 12%)`);
  });

  it('moves a darker fill towards black under a lighter ink (today’s hover)', () => {
    expect(buttonHover(DEEP, WHITE)).toBe(`color-mix(in oklch, ${DEEP}, black 12%)`);
    // A fill darker than its ink, whatever the ink: the shade goes away from the text.
    expect(buttonHover(CHOCOLATE, GOLD)).toBe(`color-mix(in oklch, ${CHOCOLATE}, black 12%)`);
  });

  it('goes towards black when the two are equally light', () => {
    expect(buttonHover('#777777', '#777777')).toBe('color-mix(in oklch, #777777, black 12%)');
  });

  it('spells the fill as the brand schema does: trimmed and lower-cased', () => {
    expect(buttonHover(' #E3AF3F ', '#382317')).toBe(`color-mix(in oklch, ${GOLD}, white 12%)`);
    expect(buttonHover('#1A237E', '#FFFFFF')).toBe(`color-mix(in oklch, ${DEEP}, black 12%)`);
  });

  it('is null when either colour is not a #rrggbb', () => {
    for (const value of NOT_HEX) {
      expect(buttonHover(value as string, CHOCOLATE), String(value)).toBeNull();
      expect(buttonHover(GOLD, value as string), String(value)).toBeNull();
    }
  });
});

describe('buttonRampEnd', () => {
  /** A plain lower-cased `#rrggbb`, nothing around it. */
  const PLAIN_HEX = new RegExp(`^${HEX}$`);
  /** The three channels of a `#rrggbb`. */
  const channels = (hex: string) =>
    [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  /** A channel moved 30% of the way to `target` (255 white, 0 black), rounded. */
  const moved = (value: number, target: number) => Math.round(value + (target - value) * 0.3);

  it('is the reference gold’s pale gold under its chocolate text, a deeper blue under white', () => {
    expect(buttonRampEnd(GOLD, CHOCOLATE)).toBe('#ebc779');
    expect(buttonRampEnd('#2e6fd0', WHITE)).toBe('#204e92');
    // Spelled as the brand schema does: trimmed and lower-cased, whatever it was handed.
    expect(buttonRampEnd(' #E3AF3F ', '#382317')).toBe('#ebc779');
    expect(buttonRampEnd('#2E6FD0', '#FFFFFF ')).toBe('#204e92');
  });

  it('lets the text decide the way: towards white under a darker text, towards black otherwise', () => {
    // The gold brightens under its chocolate, or its navy, and deepens under white: the text
    // decides the way, never how far.
    expect(buttonRampEnd(GOLD, NAVY)).toBe(buttonRampEnd(GOLD, CHOCOLATE));
    const brighter = buttonRampEnd(GOLD, CHOCOLATE) as string;
    const deeper = buttonRampEnd(GOLD, WHITE) as string;
    expect(relativeLuminance(brighter)).toBeGreaterThan(relativeLuminance(GOLD));
    expect(relativeLuminance(deeper)).toBeLessThan(relativeLuminance(GOLD));
    // Always the hover's way (`buttonHover`), a tie included: two equally light colours go black.
    for (const [fill, ink] of [
      [GOLD, CHOCOLATE],
      [GOLD, WHITE],
      [DEEP, WHITE],
      [PALE, NAVY],
      [CHOCOLATE, GOLD],
      ['#777777', '#777777'],
    ] as const) {
      const end = buttonRampEnd(fill, ink) as string;
      const brightens = relativeLuminance(end) > relativeLuminance(fill);
      expect(buttonHover(fill, ink), `${fill} under ${ink}`).toContain(
        brightens ? 'white 12%' : 'black 12%',
      );
    }
  });

  it('moves the colour 30% of the way in sRGB, channel by channel', () => {
    for (const fill of [GOLD, DEEP, PALE, CHOCOLATE, '#2e6fd0', '#5b9cf8', '#ef4444', '#777777']) {
      // Under black, darker than any of them: 30% of the way to white.
      expect(channels(buttonRampEnd(fill, '#000000') as string), fill).toEqual(
        channels(fill).map((value) => moved(value, 255)),
      );
      // Under white, lighter than any of them: 30% of the way to black.
      expect(channels(buttonRampEnd(fill, WHITE) as string), fill).toEqual(
        channels(fill).map((value) => moved(value, 0)),
      );
    }
  });

  it('is null when either colour is not a #rrggbb', () => {
    for (const value of NOT_HEX) {
      expect(buttonRampEnd(value as string, CHOCOLATE), String(value)).toBeNull();
      expect(buttonRampEnd(GOLD, value as string), String(value)).toBeNull();
    }
  });

  it('never lets its automatic text read worse on the last colour than on the first', () => {
    // The sRGB cube in steps of 0x33, the greys where white and navy trade places (between 0x7f
    // and 0x80) and the colours above, each under the white or navy that reads on it.
    const levels = ['00', '33', '66', '99', 'cc', 'ff'];
    const cube = levels.flatMap((r) => levels.flatMap((g) => levels.map((b) => `#${r}${g}${b}`)));
    const greys = ['#7a7a7a', '#7e7e7e', '#7f7f7f', '#808080', '#818181', '#858585'];
    const named = [GOLD, DEEP, PALE, CHOCOLATE, NAVY, '#2e6fd0', '#5b9cf8', '#ef4444', '#7c3aed'];
    const fills = [...cube, ...greys, ...named];
    // Both texts show up, so both ways: the sweep crosses the line where the automatic text flips.
    expect(new Set(fills.map((fill) => buttonInk(fill)))).toEqual(new Set([WHITE, NAVY]));
    for (const fill of fills) {
      const ink = buttonInk(fill);
      const end = buttonRampEnd(fill, ink) as string;
      expect(end, fill).toMatch(PLAIN_HEX);
      expect(contrastRatio(ink, end), fill).toBeGreaterThanOrEqual(contrastRatio(ink, fill));
      // So the gradient's automatic text is the solid button's: it reads worst on the first colour.
      expect(buttonInk(fill, end), fill).toBe(ink);
    }
  });
});

describe('buttonGradient / buttonGradientHover', () => {
  it('goes from the first colour to the last at the brand gradient’s 135deg', () => {
    expect(buttonGradient(GOLD, PALE)).toBe(`linear-gradient(135deg, ${GOLD}, ${PALE})`);
    expect(buttonGradient(' #E3AF3F', '#FFD27A ')).toBe(
      `linear-gradient(135deg, ${GOLD}, ${PALE})`,
    );
    // The order is the button's: the first colour starts the gradient.
    expect(buttonGradient(PALE, GOLD)).toBe(`linear-gradient(135deg, ${PALE}, ${GOLD})`);
  });

  it('hovers each colour away from the text, as a solid button’s', () => {
    const [start, end] = [buttonHover(GOLD, CHOCOLATE), buttonHover(PALE, CHOCOLATE)];
    expect(buttonGradientHover(GOLD, PALE, CHOCOLATE)).toBe(
      `linear-gradient(135deg in srgb, ${start}, ${end})`,
    );
    // A text between the two colours: one end brightens, the other darkens, both away from it.
    const brighter = `color-mix(in oklch, ${PALE}, white 12%)`;
    const darker = `color-mix(in oklch, ${DEEP}, black 12%)`;
    expect(buttonGradientHover(PALE, DEEP, '#777777')).toBe(
      `linear-gradient(135deg in srgb, ${brighter}, ${darker})`,
    );
  });

  it('blends the hovered image in sRGB, as the image itself blends', () => {
    // The image's stops are hexes, legacy colours, which CSS blends in sRGB. The hover's stops are
    // colour-mixes, which CSS would blend in OKLab unless told otherwise: the middle of a pink to
    // teal button would turn from a greyish purple to a rose brown under the pointer. So the image
    // names no colour space at all (the plain string the e2e pins) and its hover names sRGB.
    for (const [fill, fillEnd, ink] of [
      [GOLD, PALE, CHOCOLATE],
      ['#c2185b', '#00796b', WHITE],
      [DEEP, GOLD, WHITE],
    ] as const) {
      const image = buttonGradient(fill, fillEnd) as string;
      const hovered = buttonGradientHover(fill, fillEnd, ink) as string;
      expect(image, fill).toMatch(/^linear-gradient\(135deg, #/);
      expect(image, fill).not.toMatch(/ in [a-z]/);
      expect(hovered, fill).toMatch(/^linear-gradient\(135deg in srgb, color-mix\(in oklch, #/);
      // Only the interpolation differs: the same two stops' hovers, in the same order.
      expect(hovered, fill).toBe(
        `linear-gradient(135deg in srgb, ${buttonHover(fill, ink)}, ${buttonHover(fillEnd, ink)})`,
      );
    }
  });

  it('is null when a colour is not a #rrggbb', () => {
    for (const value of NOT_HEX) {
      const v = value as string;
      expect(buttonGradient(v, PALE), String(value)).toBeNull();
      expect(buttonGradient(GOLD, v), String(value)).toBeNull();
      expect(buttonGradientHover(v, PALE, CHOCOLATE), String(value)).toBeNull();
      expect(buttonGradientHover(GOLD, v, CHOCOLATE), String(value)).toBeNull();
      expect(buttonGradientHover(GOLD, PALE, v), String(value)).toBeNull();
    }
  });
});

describe('buttonThemeVars', () => {
  it('spells the fill, its ink and its hover under the theme’s own keys, in that order', () => {
    const light = buttonThemeVars('light', { fill: '#E3AF3F', ink: '#382317' });
    expect(light).toEqual({
      '--button-fill-light': GOLD,
      '--button-ink-light': CHOCOLATE,
      '--button-hover-light': `color-mix(in oklch, ${GOLD}, white 12%)`,
    });
    expect(Object.keys(light)).toEqual([
      '--button-fill-light',
      '--button-ink-light',
      '--button-hover-light',
    ]);
    expect(buttonThemeVars('dark', { fill: DEEP, ink: WHITE })).toEqual({
      '--button-fill-dark': DEEP,
      '--button-ink-dark': WHITE,
      '--button-hover-dark': `color-mix(in oklch, ${DEEP}, black 12%)`,
    });
    // The reference pair reads (AA for the 12 to 16px bold labels).
    expect(contrastRatio(GOLD, CHOCOLATE)).toBeGreaterThanOrEqual(4.5);
  });

  it('completes a missing or refused ink with white or navy, as for any primary', () => {
    const gold = deriveBrandColors({ primary: GOLD, secondary: GOLD }).onPrimary;
    const deep = deriveBrandColors({ primary: DEEP, secondary: DEEP }).onPrimary;
    expect(gold).toBe(NAVY);
    expect(deep).toBe(WHITE);
    for (const ink of [undefined, null, '#38', 'chocolate', 42]) {
      expect(buttonThemeVars('light', { fill: GOLD, ink } as ButtonPair), String(ink)).toEqual({
        '--button-fill-light': GOLD,
        '--button-ink-light': NAVY,
        '--button-hover-light': buttonHover(GOLD, NAVY),
      });
      expect(buttonThemeVars('dark', { fill: DEEP, ink } as ButtonPair), String(ink)).toEqual({
        '--button-fill-dark': DEEP,
        '--button-ink-dark': WHITE,
        '--button-hover-dark': buttonHover(DEEP, WHITE),
      });
    }
  });

  it('sends an ink alone without a fill or a hover (the fill stays the theme’s accent)', () => {
    expect(buttonThemeVars('light', { ink: '#382317' })).toEqual({
      '--button-ink-light': CHOCOLATE,
    });
    expect(buttonThemeVars('dark', { fill: null, ink: '#F2F5FA' })).toEqual({
      '--button-ink-dark': '#f2f5fa',
    });
    expect(buttonThemeVars('dark', { fill: '#12', ink: CHOCOLATE })).toEqual({
      '--button-ink-dark': CHOCOLATE,
    });
  });

  it('spells a gradient whole: first colour, ink, hover, image and hovered image', () => {
    const light = buttonThemeVars('light', {
      style: 'gradient',
      fill: '#E3AF3F',
      fillEnd: '#FFD27A',
      ink: '#382317',
    });
    expect(light).toEqual({
      '--button-fill-light': GOLD,
      '--button-ink-light': CHOCOLATE,
      '--button-hover-light': buttonHover(GOLD, CHOCOLATE),
      '--button-image-light': `linear-gradient(135deg, ${GOLD}, ${PALE})`,
      '--button-image-hover-light': buttonGradientHover(GOLD, PALE, CHOCOLATE),
    });
    expect(Object.keys(light)).toEqual([
      '--button-fill-light',
      '--button-ink-light',
      '--button-hover-light',
      '--button-image-light',
      '--button-image-hover-light',
    ]);
    expect(
      buttonThemeVars('dark', { style: 'gradient', fill: DEEP, fillEnd: CHOCOLATE, ink: WHITE }),
    ).toEqual({
      '--button-fill-dark': DEEP,
      '--button-ink-dark': WHITE,
      '--button-hover-dark': buttonHover(DEEP, WHITE),
      '--button-image-dark': `linear-gradient(135deg, ${DEEP}, ${CHOCOLATE})`,
      '--button-image-hover-dark': buttonGradientHover(DEEP, CHOCOLATE, WHITE),
    });
  });

  it('chooses a gradient’s automatic ink for both of its colours', () => {
    // Navy reads on the gold alone, white on the gold-to-deep gradient.
    const vars = buttonThemeVars('light', { style: 'gradient', fill: GOLD, fillEnd: DEEP });
    expect(vars['--button-ink-light']).toBe(WHITE);
    expect(vars['--button-ink-light']).toBe(buttonInk(GOLD, DEEP));
    expect(vars['--button-hover-light']).toBe(buttonHover(GOLD, WHITE));
    expect(vars['--button-image-hover-light']).toBe(buttonGradientHover(GOLD, DEEP, WHITE));
  });

  it('is the solid button of what is left when a gradient misses a colour', () => {
    for (const fillEnd of [undefined, null, '#ffd', 'gold']) {
      expect(
        buttonThemeVars('light', { style: 'gradient', fill: GOLD, fillEnd } as ButtonPair),
        String(fillEnd),
      ).toEqual(buttonThemeVars('light', { fill: GOLD }));
    }
    // Without its first colour there is no button to paint: the ink alone, as for a solid one.
    expect(
      buttonThemeVars('dark', { style: 'gradient', fill: null, fillEnd: PALE, ink: CHOCOLATE }),
    ).toEqual({ '--button-ink-dark': CHOCOLATE });
  });

  it('ignores a last colour unless the style is gradient', () => {
    for (const style of [undefined, null, 'solid', 'Gradient', 'linear'] as const) {
      expect(
        buttonThemeVars('light', { style, fill: GOLD, fillEnd: PALE } as ButtonPair),
        String(style),
      ).toEqual(buttonThemeVars('light', { fill: GOLD }));
    }
  });

  it('adds nothing without a valid colour', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(buttonThemeVars(theme, null)).toEqual({});
      expect(buttonThemeVars(theme, undefined)).toEqual({});
      expect(buttonThemeVars(theme, {})).toEqual({});
      expect(buttonThemeVars(theme, { style: 'gradient' })).toEqual({});
      expect(buttonThemeVars(theme, { fill: null, ink: null })).toEqual({});
      for (const value of NOT_HEX) {
        expect(
          buttonThemeVars(theme, {
            style: 'gradient',
            fill: value,
            fillEnd: value,
            ink: value,
          } as ButtonPair),
          String(value),
        ).toEqual({});
      }
    }
  });

  it('never throws, whatever it is handed, and adds nothing for an unknown theme', () => {
    const odd: unknown[] = ['x', 42, true, [], ['#e3af3f'], Object.create(null), () => GOLD];
    for (const pair of odd) {
      expect(() => buttonThemeVars('light', pair as ButtonPair)).not.toThrow();
      expect(buttonThemeVars('light', pair as ButtonPair)).toEqual({});
    }
    for (const theme of ['sepia', 'constructor', '__proto__', '', 'LIGHT']) {
      expect(
        buttonThemeVars(theme as ButtonTheme, { style: 'gradient', fill: GOLD, fillEnd: PALE }),
        theme,
      ).toEqual({});
    }
  });

  it('keeps every key in its own theme and every value a colour', () => {
    const pairs: ButtonPair[] = [
      { fill: GOLD, ink: CHOCOLATE },
      { fill: DEEP },
      { ink: WHITE },
      { fill: '#E3AF3F;color:red', ink: '#382317' },
      { fill: ' #1A237E', ink: 'white' },
      { style: 'gradient', fill: GOLD, fillEnd: PALE, ink: CHOCOLATE },
      { style: 'gradient', fill: ' #1A237E', fillEnd: '#E3AF3F' },
      { style: 'gradient', fill: GOLD, fillEnd: 'url(x)', ink: CHOCOLATE },
    ];
    for (const pair of pairs) {
      for (const theme of ['light', 'dark'] as const) {
        const other = theme === 'light' ? 'dark' : 'light';
        for (const [key, value] of Object.entries(buttonThemeVars(theme, pair))) {
          expect(key.endsWith(`-${theme}`), key).toBe(true);
          expect(key.endsWith(`-${other}`), key).toBe(false);
          expect(value, key).toMatch(SAFE_VALUE);
        }
      }
    }
  });
});
