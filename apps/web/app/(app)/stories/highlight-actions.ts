'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { listAllCommunities } from '@/lib/communities';
import {
  getHighlight,
  getHighlightCatalog,
  getStoryHighlightIds,
  highlightWriteIssue,
  setHighlightMembership,
} from '@/lib/stories';
import {
  type HighlightPlaceView,
  highlightPlacesView,
  type StoryViewerItemView,
  storyViewerItem,
} from '@/lib/story-view';

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

/* ── The highlight sheet (05.2-06, D-110, HIGHLIGHT-02) ─────────────────────────────────────── */

/**
 * The sheet's ONE opening read (05.2-06 planning decision 1): the catalogue, the story's memberships
 * and the active communities list, **in parallel**, composed on the SERVER into place groups with
 * their labels — so the client never assembles a place name, and the sheet never opens on a state
 * nobody verified (UI E09 loading).
 *
 * The same three conventions as above: the id is untrusted and uuid-checked before any request;
 * every miss or refusal is ONE `{ ok: false }` (a member's 403 on the manage-only catalogue included,
 * T-05.2-26 — the host then fires the generic toast and opens nothing); a bootstrap refusal is a
 * navigation taken OUTSIDE the try/catch. `listAllCommunities` never throws — with the communities
 * module off it answers `[]`, and the catalogue already carries only Início then.
 */
export type HighlightSheetResult =
  | { ok: true; places: HighlightPlaceView[]; selectedIds: string[] }
  | { ok: false };

export async function loadHighlightSheetAction(storyId: string): Promise<HighlightSheetResult> {
  const id = z.uuid().safeParse(storyId);
  if (!id.success) return { ok: false };

  let refusal: string | null = null;
  let result: HighlightSheetResult = { ok: false };
  try {
    const [catalog, memberships, communities, t] = await Promise.all([
      getHighlightCatalog(),
      getStoryHighlightIds(id.data),
      listAllCommunities(),
      getTranslations('stories'),
    ]);
    result = {
      ok: true,
      places: highlightPlacesView(catalog.items, communities, {
        homeLabel: t('highlights.place.home'),
      }),
      selectedIds: memberships.highlightIds,
    };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    // Shape only: highlight titles and community names never reach a log line (T-05.2-28).
    if (!refusal) console.error('stories.highlight_sheet_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

/**
 * Where the toggled highlight lives, and whether the caller wants that place re-rendered.
 *
 * `revalidate` is the caller's (planning decision 2): the VIEWER passes `false` — re-rendering
 * `/inicio` behind an open viewer would rebuild the row under the curator's finger, the like-action
 * rule — while "Seus stories" (plan 07) passes `true`. `communityId` only ever picks WHICH path to
 * revalidate; it authorises nothing (the API resolves the highlight's real place itself, T-05.2-27).
 */
export type HighlightTogglePlace = { communityId: string | null; revalidate: boolean };

/**
 * The closed answer of one toggle. `highlightCount` is how many highlights the story is in AFTER the
 * write ("Seus stories" draws it, UI-D-77). `archived` and `full` have their own toasts; every other
 * refusal — the bare 404, a member's 403, `order_stale`, a transport failure — is `generic`.
 */
export type HighlightToggleResult =
  | { ok: true; highlightCount: number }
  | { ok: false; code: 'archived' | 'full' | 'generic' };

/** Put a story into a highlight — `PUT /v1/stories/highlights/{h}/stories/{s}`. */
export async function addStoryToHighlightAction(
  storyId: string,
  highlightId: string,
  place: HighlightTogglePlace,
): Promise<HighlightToggleResult> {
  return toggleHighlightMembership(storyId, highlightId, place, true);
}

/** Take a story out of a highlight — `DELETE /v1/stories/highlights/{h}/stories/{s}`. */
export async function removeStoryFromHighlightAction(
  storyId: string,
  highlightId: string,
  place: HighlightTogglePlace,
): Promise<HighlightToggleResult> {
  return toggleHighlightMembership(storyId, highlightId, place, false);
}

const toggleArgs = z.object({
  storyId: z.uuid(),
  highlightId: z.uuid(),
  place: z.object({ communityId: z.uuid().nullable(), revalidate: z.boolean() }).strict(),
});

async function toggleHighlightMembership(
  storyId: string,
  highlightId: string,
  place: HighlightTogglePlace,
  next: boolean,
): Promise<HighlightToggleResult> {
  // T-05.2-27: every id and the place are untrusted — refused here, before any request.
  const args = toggleArgs.safeParse({ storyId, highlightId, place });
  if (!args.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: HighlightToggleResult = { ok: false, code: 'generic' };
  try {
    const written = await setHighlightMembership(args.data.highlightId, args.data.storyId, next);
    result = { ok: true, highlightCount: written.highlightCount };
  } catch (error) {
    const issue = highlightWriteIssue(error);
    if (issue === 'archived' || issue === 'full') result = { ok: false, code: issue };
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    // Ids and the issue code only — never a title or a caption (T-05.2-28).
    if (!refusal) {
      console.error('stories.highlight_toggle_failed', {
        storyId: args.data.storyId,
        highlightId: args.data.highlightId,
        issue,
        next,
        error: String(error),
      });
    }
  }

  if (result.ok && args.data.place.revalidate) {
    const { communityId } = args.data.place;
    revalidatePath(communityId === null ? '/inicio' : `/comunidades/${communityId}`);
  }
  if (refusal) redirect(refusal);
  return result;
}
