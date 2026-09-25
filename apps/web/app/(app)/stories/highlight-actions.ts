'use server';

/**
 * 05.2-05 RED STUB — deliberately INERT: it answers `{ ok: false }` for everything and makes no
 * request. The GREEN commit replaces it with the real lazy highlight read.
 */
export async function loadHighlightItemsAction(
  _highlightId: string,
): Promise<{ ok: true; items: never[] } | { ok: false }> {
  return { ok: false };
}
