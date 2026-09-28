'use server';

import {
  createStoryHighlightSchema,
  reorderHighlightsSchema,
  updateHighlightSchema,
} from '@rede-social/module-stories/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { listAllCommunities } from '@/lib/communities';
import {
  createHighlight,
  deleteHighlight,
  getHighlight,
  getHighlightCatalog,
  getStoryHighlightIds,
  highlightWriteIssue,
  reorderHighlights,
  setHighlightMembership,
  updateHighlight,
} from '@/lib/stories';
import {
  type HighlightEditStoryView,
  type HighlightManageRowView,
  type HighlightPlaceView,
  highlightEditStoryView,
  highlightManageRowView,
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

/* ── 05.2-09: the manage screen's curation actions (HIGHLIGHT-01, D-109) ──────────────────── */

/**
 * The place a curation write belongs to — `communityId: null` is Início. It picks WHICH path is
 * revalidated (planning decision 4: the row the admin returns to must show the change) and, for
 * create and reorder, which place the API writes. It authorises nothing: the API resolves the
 * highlight's real place itself and re-checks `stories.story.manage` on every call (T-05.2-39).
 */
export type HighlightPlace = { communityId: string | null };

/**
 * The closed answer of a curation write. `archived`, `title_invalid`, `order_stale` and `full` are
 * the API's `details.highlight` vocabulary, each with its own copy; everything else — the bare 404
 * (unknown, another tenant's, a cover asset not `ready` yet), a 403, a transport failure — is
 * `generic`, and the admin retries.
 */
export type HighlightCurationCode =
  | 'archived'
  | 'title_invalid'
  | 'order_stale'
  | 'full'
  | 'generic';

export type HighlightCurationResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; code: HighlightCurationCode };

const placeSchema = z.object({ communityId: z.uuid().nullable() }).strict();

/** `/inicio` or the community page — the place's row is what the admin returns to. */
function placePath(place: HighlightPlace): string {
  return place.communityId === null ? '/inicio' : `/comunidades/${place.communityId}`;
}

/** A Zod refusal of the TITLE is its own code (the step states the rule); any other is generic. */
function inputRefusal(error: z.ZodError): HighlightCurationCode {
  return error.issues.some((issue) => issue.message === 'title_invalid')
    ? 'title_invalid'
    : 'generic';
}

/**
 * Runs ONE curation write with the conventions every action in this file shares:
 * the refusal is mapped through `highlightWriteIssue` into the closed vocabulary; the place is
 * revalidated only on success; a bootstrap refusal (401/403 of the session) is a NAVIGATION taken
 * OUTSIDE the try/catch (`redirect()` throws in Next 16); and the log line carries the action, the
 * ids and the issue code only — never a title (T-05.2-28).
 */
async function curate<T extends object>(
  action: string,
  ids: Record<string, string | null>,
  place: HighlightPlace,
  write: () => Promise<T>,
): Promise<HighlightCurationResult<T>> {
  let refusal: string | null = null;
  let result: HighlightCurationResult<T> = { ok: false, code: 'generic' };
  try {
    result = { ok: true, ...(await write()) };
  } catch (error) {
    const issue = highlightWriteIssue(error);
    if (issue !== null && issue !== 'not_found') result = { ok: false, code: issue };
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) {
      console.error('stories.highlight_curation_failed', {
        action,
        ...ids,
        issue,
        error: String(error),
      });
    }
  }

  if (result.ok) revalidatePath(placePath(place));
  if (refusal) redirect(refusal);
  return result;
}

/**
 * "Criar destaque" (UI-D-72): `POST /v1/stories/highlights`. The title is trimmed and checked by the
 * contract's own schema BEFORE any request, so a blank title is `title_invalid` with no round trip;
 * Início is the ABSENCE of `communityId` in the body. The answer is the new row view — appended at
 * the end of the list, where the API put it (R-D-C).
 */
export async function createHighlightAction(
  place: HighlightPlace,
  title: string,
): Promise<HighlightCurationResult<{ highlight: HighlightManageRowView }>> {
  const where = placeSchema.safeParse(place);
  if (!where.success) return { ok: false, code: 'generic' };
  const { communityId } = where.data;
  const input = createStoryHighlightSchema.safeParse(
    communityId === null ? { title } : { communityId, title },
  );
  if (!input.success) return { ok: false, code: inputRefusal(input.error) };

  return curate('create', { communityId }, where.data, async () => {
    const [summary, t] = await Promise.all([
      createHighlight(input.data),
      getTranslations('stories'),
    ]);
    return { highlight: highlightManageRowView(summary, t) };
  });
}

/** "Salvar nome" (UI-D-74): `PATCH { title }` — trimmed, 1..15, else `title_invalid`. */
export async function renameHighlightAction(
  highlightId: string,
  title: string,
  place: HighlightPlace,
): Promise<HighlightCurationResult<{ highlight: HighlightManageRowView }>> {
  const id = z.uuid().safeParse(highlightId);
  const where = placeSchema.safeParse(place);
  if (!id.success || !where.success) return { ok: false, code: 'generic' };
  const patch = updateHighlightSchema.safeParse({ title });
  if (!patch.success) return { ok: false, code: inputRefusal(patch.error) };

  return curate('rename', { highlightId: id.data }, where.data, async () => {
    const [summary, t] = await Promise.all([
      updateHighlight(id.data, patch.data),
      getTranslations('stories'),
    ]);
    return { highlight: highlightManageRowView(summary, t) };
  });
}

/**
 * The cover step (UI-D-75): `PATCH { cover }` with a story frame, an UPLOADED image (`assetId`, the
 * Phase 3 `cover`/`image` tuple — T-05.2-40) or `null` for automatic. An upload whose asset is not
 * `ready` yet answers the bare 404, which is `generic` here and the admin retries — the
 * `CommunityForm` cover posture. **Nothing in this path deletes an asset** (R-D-E).
 */
export async function setHighlightCoverAction(
  highlightId: string,
  cover: { storyId: string } | { assetId: string } | null,
  place: HighlightPlace,
): Promise<HighlightCurationResult<{ highlight: HighlightManageRowView }>> {
  const id = z.uuid().safeParse(highlightId);
  const where = placeSchema.safeParse(place);
  const patch = updateHighlightSchema.safeParse({ cover });
  if (!id.success || !where.success || !patch.success) return { ok: false, code: 'generic' };

  return curate('cover', { highlightId: id.data }, where.data, async () => {
    const [summary, t] = await Promise.all([
      updateHighlight(id.data, patch.data),
      getTranslations('stories'),
    ]);
    return { highlight: highlightManageRowView(summary, t) };
  });
}

/**
 * "Excluir destaque" (UI-D-74, behind its confirm): `DELETE` → 204. A take-down, so an archived
 * community allows it (R-D-F); the stories stay in "Seus stories".
 */
export async function deleteHighlightAction(
  highlightId: string,
  place: HighlightPlace,
): Promise<HighlightCurationResult> {
  const id = z.uuid().safeParse(highlightId);
  const where = placeSchema.safeParse(place);
  if (!id.success || !where.success) return { ok: false, code: 'generic' };

  return curate('delete', { highlightId: id.data }, where.data, async () => {
    await deleteHighlight(id.data);
    return {};
  });
}

/**
 * Reorder (UI-D-73): ONE `PUT …/highlights/order` per drop, keypress or move button, with the
 * place's FULL permutation. Every id is uuid-checked and the list is capped at the place's own limit
 * by the contract BEFORE any request (T-05.2-43). `order_stale` — the set changed under the admin —
 * is its own code: the screen refreshes and says so.
 */
export async function reorderHighlightsAction(
  place: HighlightPlace,
  highlightIds: string[],
): Promise<HighlightCurationResult<{ items: HighlightManageRowView[] }>> {
  const where = placeSchema.safeParse(place);
  if (!where.success) return { ok: false, code: 'generic' };
  const { communityId } = where.data;
  const input = reorderHighlightsSchema.safeParse(
    communityId === null ? { highlightIds } : { communityId, highlightIds },
  );
  if (!input.success) return { ok: false, code: 'generic' };

  return curate('reorder', { communityId }, where.data, async () => {
    const [list, t] = await Promise.all([
      reorderHighlights(input.data),
      getTranslations('stories'),
    ]);
    return { items: list.items.map((summary) => highlightManageRowView(summary, t)) };
  });
}

/**
 * The edit sheet's ONE read (UI-D-74): `GET /v1/stories/highlights/{id}` as a curator — EVERY live
 * story of the highlight, oldest first by publish time (D-103), with its media status — composed on
 * the server into the row view and the story rows (dates, pills, `isCover`). A read: it never
 * revalidates. Every miss is `{ ok: false }` (the bare 404); a bootstrap refusal navigates.
 */
export type HighlightEditResult =
  | { ok: true; highlight: HighlightManageRowView; items: HighlightEditStoryView[] }
  | { ok: false };

export async function loadHighlightEditAction(highlightId: string): Promise<HighlightEditResult> {
  const id = z.uuid().safeParse(highlightId);
  if (!id.success) return { ok: false };

  let refusal: string | null = null;
  let result: HighlightEditResult = { ok: false };
  try {
    const [detail, t, tm] = await Promise.all([
      getHighlight(id.data),
      getTranslations('stories'),
      getTranslations('media'),
    ]);
    const coverAssetId = detail.highlight.coverAssetId;
    result = {
      ok: true,
      highlight: highlightManageRowView(detail.highlight, t),
      items: detail.items.map((story) => highlightEditStoryView(story, coverAssetId, t, tm)),
    };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    // Ids only: titles and captions are tenant content (T-05.2-28).
    if (!refusal) {
      console.error('stories.highlight_edit_failed', {
        highlightId: id.data,
        error: String(error),
      });
    }
  }

  if (refusal) redirect(refusal);
  return result;
}
