import type { CSSProperties } from 'react';

export { DEFAULT_TITLE_FONT, isFontFamilyName } from '@rede-social/contracts/branding';

/**
 * The PURE rules of the tenant's title font (`lib/title-font.ts` has the browser half): what a
 * catalogue entry is, which weight the titles are drawn in, the Google Fonts URLs and the CSS stack.
 * No React hook, no DOM and no catalogue here, so a server component may import it (the app's
 * layouts resolve the saved family with `lib/title-font-catalogue.ts`) and the client bundle never
 * pulls the 1,600-family catalogue in through it.
 *
 * The family name rule (`isFontFamilyName`: ASCII letters and digits in single-spaced words, 60 at
 * most) is the brand contract's, the very one the API holds a saved `look.titleFont` to, so a name
 * reaching CSS or a URL here has passed it and has been looked up in the catalogue first.
 */

export type FontCategory = 'sans' | 'serif' | 'display' | 'handwriting' | 'mono';

export const FONT_CATEGORIES: readonly FontCategory[] = [
  'sans',
  'serif',
  'display',
  'handwriting',
  'mono',
];

/** One catalogue entry: the family, its category and the upright weights it ships, ascending. */
export type GoogleFont = readonly [
  family: string,
  category: FontCategory,
  weights: readonly number[],
];

/** The weight in `weights` closest to `target` (the heavier one on a tie). */
function closestWeight(weights: readonly number[], target: number): number {
  let best = weights[0] ?? 400;
  for (const weight of weights) {
    const gap = Math.abs(weight - target);
    const bestGap = Math.abs(best - target);
    if (gap < bestGap || (gap === bestGap && weight > best)) best = weight;
  }
  return best;
}

/**
 * The weight the titles are drawn in: they are bold (700), so 700 or the closest weight the family
 * ships. Only that one is requested; the titles never synthesize bold, so a family that ships one
 * regular weight shows as it was drawn.
 */
export function titleWeight(weights: readonly number[]): number {
  return closestWeight(weights, 700);
}

/** The weight the picker's list shows a family in: the closest to 400 (its regular). */
export function sampleWeight(weights: readonly number[]): number {
  return closestWeight(weights, 400);
}

const CSS2 = 'https://fonts.googleapis.com/css2';

function familyParam(family: string, weight: number): string {
  return `family=${family.replaceAll(' ', '+')}:wght@${weight}`;
}

/** Google's stylesheet of a family in its title weight (`display=swap`: Manrope until it loads). */
export function titleFontHref([family, , weights]: GoogleFont): string {
  return `${CSS2}?${familyParam(family, titleWeight(weights))}&display=swap`;
}

/**
 * One stylesheet for several families of the picker's list, each in its regular weight and with only
 * the letters of the names (`text=`): a few kilobytes per family instead of a whole font.
 */
export function sampleFontsHref(fonts: readonly GoogleFont[]): string {
  const families = fonts
    .map(([family, , weights]) => familyParam(family, sampleWeight(weights)))
    .join('&');
  const letters = [...new Set(fonts.flatMap(([family]) => [...family]))].sort().join('');
  return `${CSS2}?${families}&text=${encodeURIComponent(letters)}&display=swap`;
}

/** The `font-family` of a title: the family, then the app's Manrope while it loads or if it fails. */
export function titleFontStack(family: string): string {
  return `"${family}", var(--font-manrope), system-ui, sans-serif`;
}

/**
 * The inline style of a title drawn in the font outside the phone (the picker's sample, the
 * summary): the stack and, like the phone's titles, no synthesized bold. Nothing for the default.
 */
export function titleFontStyle(stack: string | null): CSSProperties | undefined {
  return stack ? { fontFamily: stack, fontSynthesis: 'none' } : undefined;
}

/** Case, spaces and accents never matter in a search ("playfair", "Open sans", "lóra"). */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replaceAll(' ', '')
    .toLowerCase();
}

/** The catalogue entries of `category` (or all) whose name contains `query`, in catalogue order. */
export function filterFonts(
  fonts: readonly GoogleFont[],
  query: string,
  category: FontCategory | 'all',
): GoogleFont[] {
  const wanted = fold(query.trim());
  return fonts.filter(
    ([family, kind]) =>
      (category === 'all' || kind === category) && (!wanted || fold(family).includes(wanted)),
  );
}
