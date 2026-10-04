import {
  type ButtonStyle,
  contrastRatio,
  hexColorSchema,
  NAVY,
  relativeLuminance,
  WHITE,
} from '@rede-social/contracts/branding';

/**
 * The filled action buttons in a colour of their own, apart from the primary and the secondary
 * (2026-10-03; kept in the brand contract's `look` since the same day, so the app paints them too),
 * solid or, since the second round of that day, a gradient of two colours. The colours travel as RAW
 * custom properties, one set per theme, set INLINE on a brand scope (the app shell's
 * `[data-brand-root]`, the logged-out pages' `<main>`, the `BrandPreview` frames, the wizard's
 * phone screen) and never declared in CSS: tokens.css resolves `--button-fill`, `--button-ink`, `--button-hover`,
 * `--button-image` and `--button-image-hover` on every brand scope from the raw key of that scope's
 * theme, falling back to the brand accent, its ink, today's hover shade and no image at all. The
 * filled buttons read them through `bg-button`, `text-on-button`, `hover:bg-button-hover` and the
 * two image utilities, so a scope without the keys paints every button exactly as `bg-brand` does,
 * and the chips, switches, tabs, links and the focus ring stay on the primary whatever the keys say.
 *
 * A gradient goes from its first colour to its last at the brand gradient's angle (135deg, tokens.css
 * `--brand-gradient`), as an image over the fill, which carries the FIRST colour: whatever paints
 * the fill and not the image still shows the button's own colour. Its hover moves each colour away
 * from the text as a solid button's hover moves its one colour, blended in sRGB like the image.
 *
 * Only a hex the brand schema accepts reaches a style (T-02-63), lower-cased, and a fill never goes
 * out without the ink that reads on it. WHICH colours a theme gets (the dark mode inheriting the
 * light button, the automatic ink, a gradient's automatic first colour from the tenant's primary)
 * is the caller's rule (apps/web `resolveButtonPairs`); this module spells the keys and derives the
 * ink, the hover, the image and a gradient's automatic last colour (`buttonRampEnd`, the first one
 * moved away from its text, never a secondary). Pure (no hook, no DOM), so the server-rendered
 * `BrandPreview` and the web app's preview helpers share it.
 */

export type ButtonTheme = 'light' | 'dark';

/**
 * The buttons' two looks, one for both themes: one colour, or a gradient of two. The list is the
 * brand contract's (the look's `buttonColors.style` is validated against it), re-exported here.
 */
export { BUTTON_STYLES, type ButtonStyle } from '@rede-social/contracts/branding';

/** The raw keys of each theme: only ever inline, the one of the scope's own theme is read. */
export const BUTTON_COLOR_KEYS = {
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
} as const;

/**
 * One theme's buttons: the fill and its text, and for a gradient (`style: 'gradient'`) the last
 * colour (`fillEnd`), the fill being the first. Absent, `null` or invalid: the theme's own; any
 * other style is solid, and a solid button ignores `fillEnd`.
 */
export type ButtonPair = {
  style?: ButtonStyle | null;
  fill?: string | null;
  fillEnd?: string | null;
  ink?: string | null;
};

/** Both themes' buttons as the caller resolved them (the dark one carrying what it inherits). */
export type ButtonPairs = { light?: ButtonPair | null; dark?: ButtonPair | null };

/** How far the hover moves the fill, as tokens.css does the primary (`--brand-primary-hover`). */
const HOVER_MIX = '12%';

/** The gradient's direction: the brand gradient's (tokens.css `--brand-gradient`). */
const GRADIENT_ANGLE = '135deg';

function validHex(value: unknown): string | null {
  const parsed = hexColorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The automatic text of a button: white or navy, whichever reads better where it reads WORST. A
 * solid button has one colour, and the pick is exactly the contracts' `onPrimary` for it (white,
 * unless navy reads better); a gradient has two, and its label crosses both, so each candidate is
 * held to the colour it reads worst on and the better of the two worst wins (white on a tie, as
 * there). Like `deriveBrandColors`, it takes valid hexes and throws on anything else: validate
 * first (`buttonThemeVars` does).
 */
export function buttonInk(fill: string, fillEnd?: string | null): string {
  const stops = fillEnd ? [fill, fillEnd] : [fill];
  const worst = (ink: string) => Math.min(...stops.map((stop) => contrastRatio(ink, stop)));
  return worst(WHITE) >= worst(NAVY) ? WHITE : NAVY;
}

/**
 * The hover shade of a button `fill` under its `ink`: the fill moved 12% AWAY from the text, in
 * oklch like tokens.css's own shades. Towards white when the ink is the darker of the two (a dark
 * text on a light button, the reference's gold with its chocolate text, which brightens on hover),
 * towards black otherwise (a light text on a darker button, as `--brand-primary-hover` does today).
 * Either way the text keeps, or gains, contrast while the pointer is over it. `null` when either
 * colour is not a valid hex: nothing that is not a colour reaches a style.
 */
export function buttonHover(fill: string, ink: string): string | null {
  const base = validHex(fill);
  const text = validHex(ink);
  if (!base || !text) return null;
  const toward = relativeLuminance(text) < relativeLuminance(base) ? 'white' : 'black';
  return `color-mix(in oklch, ${base}, ${toward} ${HOVER_MIX})`;
}

/** How far a gradient's automatic last colour moves from its first one (`buttonRampEnd`). */
const RAMP_MIX = 0.3;

/**
 * A gradient's AUTOMATIC last colour (2026-10-03): its first colour moved 30% AWAY from the text,
 * in sRGB, the reference's ramp (its gold brightening towards a pale gold under a chocolate
 * label). Towards white when the text is the darker of the two, towards black otherwise, exactly
 * the hover's direction (`buttonHover`), so the label reads on the last colour at least as well as
 * on the first: the gradient never reads worse than the solid button of that colour. A plain hex,
 * because the card measures it and shows it as the field's automatic value. `null` when either
 * colour is not a valid hex.
 */
export function buttonRampEnd(fill: string, ink: string): string | null {
  const base = validHex(fill);
  const text = validHex(ink);
  if (!base || !text) return null;
  const target = relativeLuminance(text) < relativeLuminance(base) ? 255 : 0;
  const channels = [1, 3, 5].map((at) => Number.parseInt(base.slice(at, at + 2), 16));
  const moved = channels.map((value) => Math.round(value + (target - value) * RAMP_MIX));
  return `#${moved.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * A gradient button's image: from its first colour to its last at the brand gradient's 135deg,
 * each spelled as the brand schema does (trimmed, lower-cased). `null` when either is not a valid
 * hex.
 */
export function buttonGradient(fill: string, fillEnd: string): string | null {
  const start = validHex(fill);
  const end = validHex(fillEnd);
  return start && end ? `linear-gradient(${GRADIENT_ANGLE}, ${start}, ${end})` : null;
}

/**
 * A gradient button's image under the pointer: each of its two colours moved away from the text
 * exactly as a solid button's colour is (`buttonHover`), so each end keeps, or gains, contrast.
 * Blended `in srgb`, as the image is: the image's hex stops are legacy colours, which CSS blends in
 * sRGB, while these `color-mix()` stops are not and would blend in OKLab, so the middle of the
 * button would change hue under the pointer (a pink-to-teal one's turned from a greyish purple to
 * a rose brown). `null` when any of the three is not a valid hex.
 */
export function buttonGradientHover(fill: string, fillEnd: string, ink: string): string | null {
  const start = buttonHover(fill, ink);
  const end = buttonHover(fillEnd, ink);
  return start && end ? `linear-gradient(${GRADIENT_ANGLE} in srgb, ${start}, ${end})` : null;
}

/**
 * The raw keys of `theme` for `pair`, ready to spread into a scope's inline style:
 *
 * - a valid fill comes with its ink and its hover: the pair's ink when valid, else the white or
 *   navy that reads on the button (`buttonInk`, exactly as for any primary), so the theme's accent
 *   ink is never left on a fill it was not chosen for;
 * - a gradient (`style: 'gradient'`, a valid fill AND a valid `fillEnd`) adds its image and the
 *   image's hover, the fill standing for its first colour and the ink, when automatic, chosen for
 *   both colours; one with a colour missing is the solid button of what is left;
 * - a valid ink alone comes alone: the fill stays the theme's accent and the hover today's;
 * - anything else adds nothing (`{}`), so a scope renders exactly as before.
 *
 * Never throws: an unknown theme, a pair of any shape and any value the brand schema refuses are
 * simply left out.
 */
export function buttonThemeVars(
  theme: ButtonTheme,
  pair: ButtonPair | null | undefined,
): Record<string, string> {
  if (theme !== 'light' && theme !== 'dark') return {};
  const keys = BUTTON_COLOR_KEYS[theme];
  const fill = validHex(pair?.fill);
  const fillEnd = fill && pair?.style === 'gradient' ? validHex(pair.fillEnd) : null;
  const ink = validHex(pair?.ink) ?? (fill ? buttonInk(fill, fillEnd) : null);
  const vars: Record<string, string> = {};
  if (fill) vars[keys.fill] = fill;
  if (ink) vars[keys.ink] = ink;
  const hover = fill && ink ? buttonHover(fill, ink) : null;
  if (hover) vars[keys.hover] = hover;
  const image = fill && fillEnd ? buttonGradient(fill, fillEnd) : null;
  if (image) vars[keys.image] = image;
  const imageHover = fill && fillEnd && ink ? buttonGradientHover(fill, fillEnd, ink) : null;
  if (imageHover) vars[keys.imageHover] = imageHover;
  return vars;
}
