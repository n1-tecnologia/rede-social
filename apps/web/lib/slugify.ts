/** Longest slug the schema accepts (`slugSchema`, `^[a-z0-9-]{3,40}$`). */
const SLUG_MAX_LENGTH = 40;

/**
 * Suggests a tenant slug from a display name (D-31: suggested while the field is untouched,
 * editable, immutable after creation). Pure and client-safe: NFD-normalise, drop the combining
 * marks (`ção` → `cao`), lower-case, collapse every run outside `[a-z0-9]` into one `-`, trim the
 * hyphens, cut at 40 characters and trim again. Same character family as `slugSchema`; a result
 * shorter than 3 characters is returned as-is — the form lets the schema flag it on submit.
 */
export function slugify(input: string): string {
  const trimmed = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return trimmed.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, '');
}
