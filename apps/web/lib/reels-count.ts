import type { CountTemplates } from '@rede-social/module-feed/ui';

/**
 * The accessible count a Reel's rail announces (UI-D-87, E05 zero-one-many).
 *
 * The rail DRAWS the compact number ("8 mil", `compactCount` in `@rede-social/module-reels/ui`) and hides
 * it from assistive technology; this is what the polite live region reads instead: the feed's own
 * full-number template, "8.000 curtidas" rather than "8 mil curtidas". The plural form is chosen from
 * the ORIGINAL count through `Intl.PluralRules`, exactly as the feed card's `formatCountLabel` does,
 * and zero (or anything that is not a finite positive number) is `null`, i.e. nothing announced.
 *
 * It lives in its own module, free of any server import, because the overlay that calls it is a
 * client component: `lib/reels.ts` re-exports it for the server side, but a client component must
 * import it from HERE, since `lib/reels.ts` reaches `lib/api` and `next/headers`.
 */
export function announcedCount(
  count: number,
  templates: CountTemplates,
  locale: string,
): string | null {
  if (!Number.isFinite(count) || count < 1) return null;

  const value = new Intl.NumberFormat(locale, { notation: 'standard' }).format(count);
  const form = new Intl.PluralRules(locale).select(count);
  const template = form === 'one' ? templates.one : templates.other;

  return template.replace('{count}', value);
}
