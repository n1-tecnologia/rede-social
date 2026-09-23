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

/** STUB — 04-06 RED. */
export function buildPostMeta(_input: PostMetaInput): string[] {
  return [];
}

/** STUB — 04-06 RED. */
export function formatCountLabel(
  _count: number,
  _templates: CountTemplates,
  _locale: string,
): string | null {
  return null;
}
