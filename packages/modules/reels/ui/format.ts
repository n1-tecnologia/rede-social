/**
 * The number the Reels rail DRAWS under the like and comment glyphs (UI-D-87): "8 mil" for the
 * print's "8.0K", "1,2 mil", "40".
 *
 * **Drawn, never announced.** "8 mil" is a glyph, not a sentence: the slot that shows it is
 * `aria-hidden`, and the accessible count is the host's full template ("8.000 curtidas") in the
 * like button's polite live region (plan 07). The plural form belongs to that template and is chosen
 * from the real count there, never from this abbreviation.
 *
 * `null` below 1 and for anything that is not a finite number, so a zero count draws nothing (UI-D-21)
 * while the rail keeps the slot. Rounding is `Intl`'s own (half-expand, one fraction digit), and so is
 * the U+00A0 separator before "mil"/"mi" — nothing here re-spaces or re-rounds it, which is also what
 * `formatCountLabel` in the feed does for its meta row.
 */
export function compactCount(n: number, locale: string): string | null {
  if (!Number.isFinite(n) || n < 1) return null;
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
