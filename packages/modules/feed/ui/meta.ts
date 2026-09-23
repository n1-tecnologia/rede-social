/**
 * The post card's meta row, as DATA (UI-D-21).
 *
 * Two functions, both pure and both free of React:
 *
 *  - `buildPostMeta` drops the segments that are absent and keeps the rest in order. It returns the
 *    SEGMENTS rather than a joined string on purpose: the separator between them is an
 *    `aria-hidden` element, not a character, so joining here would either lose that attribute or
 *    force HTML into a string. A stray leading, trailing or doubled separator is therefore
 *    structurally impossible — the component renders one separator BETWEEN two present segments and
 *    there is nothing else it could render.
 *  - `formatCountLabel` turns a count plus the host's two catalog templates into the one string the
 *    reader sees, and returns `null` at zero — which is what makes the "a brand-new post announces
 *    no engagement" rule (UI-D-21) a property of the data rather than a conditional in JSX.
 *
 * The module ships NO language (PWA-03): the templates and the locale both arrive from the host's
 * catalog layer, and nothing here knows the word "curtida".
 */

/** The one/other catalog templates for a count segment; `{count}` is the only placeholder. */
export type CountTemplates = { one: string; other: string };

export type PostMetaInput = {
  /** The already-pluralised like segment, or `null` when the count is zero (UI-D-21). */
  likeLabel: string | null;
  /** The already-pluralised comment segment, or `null` when the count is zero. */
  commentLabel: string | null;
  /** Always present: a post always has a time (UI-D-14 — formatted by the host, never a clock here). */
  relativeTime: string;
  /** "editado" when `edited_at` is set, `null` otherwise (UI-D-15). */
  editedLabel: string | null;
};

/** The only placeholder a count template may carry; the host catalog writes it verbatim. */
const COUNT_PLACEHOLDER = '{count}';

/**
 * The present segments, in reading order: the counts, then the time, then the edited marker.
 *
 * A segment that is `null`, empty or whitespace-only is DROPPED rather than rendered blank — which
 * is what makes a leading, trailing or doubled separator impossible downstream: the component puts
 * one separator between two segments it actually has, and there is no third thing it could emit.
 */
export function buildPostMeta(input: PostMetaInput): string[] {
  return [input.likeLabel, input.commentLabel, input.relativeTime, input.editedLabel].filter(
    (segment): segment is string => typeof segment === 'string' && segment.trim().length > 0,
  );
}

/**
 * `1` with the one/other templates → the singular segment; `0` (and anything below it, or a count
 * that is not a finite number) → `null`, i.e. NO segment at all (UI-D-21).
 *
 * The number itself is formatted compactly for the reader's locale, so a post with 1 234 likes
 * reads "1,2 mil curtidas" in a 12px row instead of blowing the row open — the plural form is still
 * chosen from the ORIGINAL count through `Intl.PluralRules`, never from the abbreviated text.
 */
export function formatCountLabel(
  count: number,
  templates: CountTemplates,
  locale: string,
): string | null {
  if (!Number.isFinite(count) || count < 1) return null;

  const value = new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(count);
  const form = new Intl.PluralRules(locale).select(count);
  const template = form === 'one' ? templates.one : templates.other;

  return template.replace(COUNT_PLACEHOLDER, value);
}
