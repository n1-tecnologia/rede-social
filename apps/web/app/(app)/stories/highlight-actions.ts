'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { getHighlight } from '@/lib/stories';
import { type StoryViewerItemView, storyViewerItem } from '@/lib/story-view';

/**
 * The grouped viewer's LAZY group read (05.2-05, HIGHLIGHT-02, R-P6) — one Início highlight's
 * stories, fetched when the member enters its group or just before (the prefetch), never carried by
 * `/inicio`'s server render, which would ship every highlight's items with every page view (N×M).
 *
 * It follows the three conventions every server action in this app encodes (`story-actions.ts`):
 *
 *  1. **The argument is untrusted** (a server action is a public endpoint, T-05.2-23): an id that is
 *     not a uuid is refused HERE and never reaches the API, which re-authorises independently anyway.
 *  2. **A miss is ONE answer with no detail.** The API's bare 404 covers another tenant's highlight,
 *     a deleted one and an empty one a member may not open; all of them are `{ ok: false }`, which
 *     the viewer renders as the one group error with its retry.
 *  3. **`redirect()` is called OUTSIDE the try/catch.** A 401/403 is a navigation (`bootstrapRedirectPath`),
 *     and `redirect()` throws in Next 16 — a catch would swallow it.
 *
 * The items are mapped with the strip's own `storyViewerItem`, from the server's single clock read,
 * so a story looks identical whichever circle opened it (UI-D-14). **It never revalidates**: it is a
 * read, and the caller keeps what it loaded for the page's life.
 */
export type HighlightItemsResult = { ok: true; items: StoryViewerItemView[] } | { ok: false };

export async function loadHighlightItemsAction(highlightId: string): Promise<HighlightItemsResult> {
  const id = z.uuid().safeParse(highlightId);
  if (!id.success) return { ok: false };

  let refusal: string | null = null;
  let result: HighlightItemsResult = { ok: false };
  try {
    const detail = await getHighlight(id.data);
    const now = Date.now();
    result = { ok: true, items: detail.items.map((story) => storyViewerItem(story, now)) };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    // Shape only: a highlight TITLE and a story CAPTION are tenant content and never reach a log.
    if (!refusal) console.error('stories.highlight_items_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}
