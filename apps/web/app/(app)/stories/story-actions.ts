'use server';

import type { CommentView } from '@rede-social/module-feed/ui';
import {
  createStoryCommentSchema,
  publishStorySchema,
  storyCommentsQuerySchema,
  storyQuerySchema,
} from '@rede-social/module-stories/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { parseSeenBatch } from '@/lib/seen-batch';
import {
  asStoryHighlightIssue,
  asStoryIssue,
  attemptStoryPublish,
  createStoryComment,
  deleteStory,
  deleteStoryComment,
  getStoryComments,
  likeStory,
  loadOwnStories,
  markStoriesSeen,
  type StoryWriteResult,
  storyCommentIssue,
  unlikeStory,
} from '@/lib/stories';
import { type StoryHistoryItemView, storyCommentView, storyHistoryView } from '@/lib/story-view';

/**
 * The publish screen's own server action (STORY-01), in the three conventions every server action in
 * this app encodes:
 *
 *  1. **The SAME Zod the API validates with runs BEFORE the request.** A server action is a public
 *     endpoint and its argument is untrusted (T-05-25): `publishStorySchema` is the identical schema
 *     the Hono route validates the body with, so the screen's "publishable" rule and the API's
 *     refusal are literally one definition. The API re-authorises and re-validates the asset id
 *     against the caller's own tenant anyway (T-05-26).
 *  2. **A refusal is a catalog KEY, never pt-BR copy**, so nothing server-controlled reaches the DOM
 *     and the message catalog stays the one source of copy.
 *  3. **`redirect()` is called OUTSIDE the try/catch.** It throws in Next 16, and a catch would
 *     swallow the navigation — which is why `attemptStoryPublish` returns the path instead of taking
 *     it.
 *
 * **The landing place comes from the composer** (05.2-08, D-115): `landing.communityId` is the
 * community whose highlight the story was published into (or null for Início and "Nenhum"). The
 * action always revalidates `/inicio` — every story is in the tenant circle for its 24 h (D-111) —
 * and, for a community landing, `/comunidades/{id}`, whose highlight row must carry the story. The
 * landing id is uuid-validated and chooses a revalidation path, nothing else (T-05.2-36).
 *
 * **No file byte ever passes through here.** The composer uploads straight to Storage (or to the
 * streaming vendor) with a brokered signed target (Phase 3), and this action carries an asset ID
 * only — which is also why Cloud Run's 32 MiB body cap is irrelevant to publishing a 400 MB video.
 */
export async function publishStoryAction(
  input: unknown,
  landing: { communityId: string | null } = { communityId: null },
): Promise<StoryWriteResult> {
  const body = publishStorySchema.safeParse(input);
  if (!body.success) {
    const messages = body.error.issues.map((issue) => issue.message);
    const code =
      messages.map(asStoryIssue).find(Boolean) ?? messages.map(asStoryHighlightIssue).find(Boolean);
    return { ok: false, code: code ?? 'generic' };
  }
  // Untrusted like the body: a landing that is not a uuid (or null) is refused before any request.
  const landingId = z
    .uuid()
    .nullable()
    .safeParse(landing?.communityId ?? null);
  if (!landingId.success) return { ok: false, code: 'generic' };

  const { result, refusal } = await attemptStoryPublish(body.data);
  // The new circle has to appear on the server-rendered home slot the admin lands back on; without
  // this they would read a cached page 1 that does not carry what they just published.
  if (result.ok) revalidatePath('/inicio');
  // A story published into a community's highlight LANDS on that community (D-115), whose row must
  // carry it — so that page is invalidated too (Pitfall 8). One write carried the story, any new
  // highlight and the item (D-99): nothing here, or in the composer, runs a second request after it.
  if (result.ok && landingId.data !== null) {
    revalidatePath(`/comunidades/${landingId.data}`);
  }

  if (refusal) redirect(refusal);
  return result;
}

/**
 * STORY-05's toggle, in the `likePostAction` shape it is a copy of.
 *
 * **It deliberately does NOT revalidate.** The authoritative `{ liked, likeCount }` comes back in
 * the response and `useOptimisticLike` writes it straight into the button that asked; a
 * `revalidatePath('/inicio')` would additionally re-render the whole home screen — and the strip
 * above it — on every tap of a heart, which is both wasteful and visible.
 *
 * A 401/403 becomes a NAVIGATION, outside the try/catch: `redirect()` throws in Next 16 and a catch
 * would swallow it. Everything else is the generic code, which the viewer turns into the shared
 * error toast with no inline message (UI-SPEC §Like).
 */
export type StoryLikeActionResult =
  | { ok: true; liked: boolean; likeCount: number }
  | { ok: false; code: 'generic' };

async function toggleStoryLikeAction(
  storyId: string,
  run: (id: string) => Promise<{ liked: boolean; likeCount: number }>,
): Promise<StoryLikeActionResult> {
  // A server action is a public endpoint and its argument is untrusted (T-05-33): an id that is not
  // a uuid is refused here and never reaches the API, which re-authorises independently anyway.
  const id = z.uuid().safeParse(storyId);
  if (!id.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: StoryLikeActionResult = { ok: false, code: 'generic' };
  try {
    const outcome = await run(id.data);
    result = { ok: true, liked: outcome.liked, likeCount: outcome.likeCount };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    // Shape only: no caption and no member, so a refusal cannot leak story content into a log.
    if (!refusal) console.error('stories.like_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

export async function likeStoryAction(storyId: string): Promise<StoryLikeActionResult> {
  return toggleStoryLikeAction(storyId, likeStory);
}

export async function unlikeStoryAction(storyId: string): Promise<StoryLikeActionResult> {
  return toggleStoryLikeAction(storyId, unlikeStory);
}

/* ── Comments (STORY-05, D-82, D-83) ──────────────────────────────────────────────────────────── */

/**
 * The three comment actions, in the SAME three conventions as everything above: the API's own Zod
 * runs BEFORE the request (a server action is a public endpoint and its argument is untrusted,
 * T-05-45), a refusal is a catalog KEY and never pt-BR copy, and every one goes through
 * `lib/stories.ts` — the ONE fetch implementation.
 *
 * `now` is read HERE rather than in the client, so a story comment's relative time is formatted on
 * the server exactly as a post comment's is (UI-D-14). The only clock the client touches is for the
 * optimistic row it has not sent yet.
 */

export type StoryCommentPageResult =
  | { ok: true; items: CommentView[]; nextCursor: string | null }
  | { ok: false; code: 'generic' };

export type StoryCommentCreateResult =
  | { ok: true; comment: CommentView }
  /**
   * `story_comment_no_reply` is the API's TRANSLATION of the database's refusal — the flat list
   * draws no reply affordance, so a member only reaches it by calling the endpoint directly, and
   * they still get a sentence written for them rather than a generic failure.
   */
  | { ok: false; code: 'generic' | 'story_comment_no_reply' };

/** 08-03 (UI-D-276): `gone` is the bare 404 (already removed) — see `CommentDeleteResult`. */
export type StoryCommentDeleteResult = { ok: true } | { ok: false; code: 'generic' | 'gone' };

/**
 * One page of a story's comments, OLDEST first (D-83).
 *
 * The cursor is OPAQUE: forwarded exactly as the previous page returned it, never parsed or rebuilt
 * here. `limit` is never taken from the caller — `storyCommentsQuerySchema`'s default is the page
 * size and the API REFUSES an oversized one rather than clamping it.
 */
export async function loadStoryCommentsAction(
  storyId: string,
  cursor?: string,
): Promise<StoryCommentPageResult> {
  const id = z.uuid().safeParse(storyId);
  const query = storyCommentsQuerySchema.safeParse(cursor ? { cursor } : {});
  if (!id.success || !query.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: StoryCommentPageResult = { ok: false, code: 'generic' };
  try {
    const [page, tf] = await Promise.all([
      getStoryComments(id.data, { cursor: query.data.cursor, limit: query.data.limit }),
      getTranslations('feed'),
    ]);
    const now = Date.now();
    const nowLabel = tf('comments.now');
    result = {
      ok: true,
      items: page.items.map((comment) => storyCommentView(comment, now, nowLabel)),
      nextCursor: page.nextCursor,
    };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    // Shape only: a comment body is member content and never reaches a log line (T-05-43).
    if (!refusal) console.error('stories.comments.load_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

/**
 * Create a comment on a story.
 *
 * **It deliberately does NOT revalidate.** The created row comes back in the response and the sheet
 * reconciles its optimistic row against it; a `revalidatePath('/inicio')` would additionally
 * re-render the home screen and the strip above it on every comment sent, which is both wasteful
 * and visible behind an open sheet. The strip's next natural read carries the new count.
 */
export async function createStoryCommentAction(
  storyId: string,
  body: string,
  parentId?: string,
): Promise<StoryCommentCreateResult> {
  const id = z.uuid().safeParse(storyId);
  // The API's own schema, which ACCEPTS a parentId on purpose — the database is the arbiter of
  // whether a story comment may be a parent, not this function and not that schema.
  const input = createStoryCommentSchema.safeParse(parentId ? { body, parentId } : { body });
  if (!id.success || !input.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: StoryCommentCreateResult = { ok: false, code: 'generic' };
  try {
    const [created, tf] = await Promise.all([
      createStoryComment(id.data, input.data.body, input.data.parentId ?? undefined),
      getTranslations('feed'),
    ]);
    result = {
      ok: true,
      comment: storyCommentView(created, Date.now(), tf('comments.now')),
    };
  } catch (error) {
    const issue = storyCommentIssue(error);
    if (issue === 'story_comment_no_reply') {
      result = { ok: false, code: 'story_comment_no_reply' };
    } else {
      if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
      if (!refusal) console.error('stories.comment.create_failed', { error: String(error) });
    }
  }

  if (refusal) redirect(refusal);
  return result;
}

/**
 * Soft-delete a story comment: the member's OWN (D-61's rule, restated for stories) or, since 08-03
 * (D-336), anyone's for a holder of `moderation.manage` — the API decides, under a row lock.
 *
 * Someone else's comment without the permission, an unknown id and an already-removed one are ONE
 * branch at the API — a bare 404 — so this action cannot be used to probe whether a comment exists
 * (T-04-16).
 */
export async function deleteStoryCommentAction(
  storyId: string,
  commentId: string,
): Promise<StoryCommentDeleteResult> {
  const id = z.uuid().safeParse(storyId);
  const comment = z.uuid().safeParse(commentId);
  if (!id.success || !comment.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: StoryCommentDeleteResult = { ok: false, code: 'generic' };
  try {
    await deleteStoryComment(id.data, comment.data);
    result = { ok: true };
  } catch (error) {
    if (error instanceof ApiClientError) {
      refusal = bootstrapRedirectPath(error);
      if (!refusal && error.status === 404) result = { ok: false, code: 'gone' };
    }
    if (!refusal && result.ok === false && result.code === 'generic') {
      console.error('stories.comment.delete_failed', { error: String(error) });
    }
  }

  if (refusal) redirect(refusal);
  return result;
}

/**
 * The three handlers a FLAT list never calls, wired to a refusal rather than to a resolved no-op.
 *
 * A story comment cannot have replies and cannot be liked — `feed_comments_parent_fk` and
 * `feed_likes_comment_fk` make both rows unrepresentable — so if either of these ever RUNS, the
 * flat variant has stopped suppressing a control, and the list showing its error branch is the
 * honest outcome. A resolved no-op would render an empty thread as though it were real.
 *
 * They live HERE, as server actions, rather than beside the composition in `lib/registry.tsx`: a
 * plain function cannot cross the RSC boundary at all — Next refuses to serialise it and the whole
 * home slot fails with it.
 */
export async function refuseStoryRepliesAction(): Promise<StoryCommentPageResult> {
  return { ok: false, code: 'generic' };
}

export async function refuseStoryCommentLikeAction(): Promise<{ ok: false }> {
  return { ok: false };
}

/* ── Delete and the history pager (D-84) ─────────────────────────────────────────────────────── */

/**
 * The admin actions "Seus stories" still owns once its highlight toggles moved to
 * `highlight-actions.ts` (05.2-07, D-110 route 2 — the pin actions are retired with the pin model,
 * UI-D-79). They follow the SAME three conventions as everything above: the arguments are untrusted
 * and validated here (a server action is a public endpoint, T-05-48), a refusal is a closed code and
 * never pt-BR copy, and every one goes through `lib/stories.ts` — the ONE fetch implementation.
 *
 * **A DELETE changes everything at once** — the strip, the history and every highlight that held the
 * story — so it revalidates `/inicio` and the history. The community pages are left to their own
 * next read rather than enumerated: the action does not know which places held the story, and asking
 * would cost a round trip to invalidate caches that expire anyway.
 */

/**
 * Soft-delete one of the tenant's stories (D-84), behind the API's own
 * `requirePermission('stories.story.manage')` — the history's affordances are UX, never the gate.
 *
 * A miss is the API's single bare 404 (unknown, another tenant's, already removed), so the screen
 * says ONE thing for all of them and the dialog closes on the generic error toast either way.
 */
export type StoryDeleteResult = { ok: true } | { ok: false; code: 'generic' };

export async function deleteStoryAction(storyId: string): Promise<StoryDeleteResult> {
  const id = z.uuid().safeParse(storyId);
  if (!id.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: StoryDeleteResult = { ok: false, code: 'generic' };
  try {
    await deleteStory(id.data);
    result = { ok: true };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) console.error('stories.delete_failed', { error: String(error) });
  }

  // The story leaves the strip, the history and every community's Destaques at once (T-05-52).
  if (result.ok) {
    revalidatePath('/inicio');
    revalidatePath('/stories/meus');
  }
  if (refusal) redirect(refusal);
  return result;
}

/**
 * One more page of the admin history (D-84), mapped into the SERVER-composed row view-model.
 *
 * The cursor is OPAQUE: forwarded exactly as the previous page returned it, never parsed or rebuilt
 * here. With NO cursor it reads the FIRST page — the manage screen's "Adicionar stories" picker
 * (05.2-09, UI-D-76) opens on it, reusing this pager rather than growing a second one.
 * The rows are composed with the page's own translators for the reason `storyHistoryView`
 * gives — the meta line and the plural-aware pin indicator need numbers interpolated under pt-BR's
 * plural rules, which is a server concern.
 */
export type StoryHistoryPageResult =
  | { ok: true; items: StoryHistoryItemView[]; nextCursor: string | null }
  | { ok: false };

export async function loadMoreOwnStoriesAction(cursor?: string): Promise<StoryHistoryPageResult> {
  const query = storyQuerySchema.safeParse({ cursor });
  if (!query.success) return { ok: false };

  const [page, ts, tm] = await Promise.all([
    loadOwnStories({ cursor: query.data.cursor, limit: query.data.limit }),
    getTranslations('stories'),
    getTranslations('media'),
  ]);
  if (page === null) return { ok: false };

  return {
    ok: true,
    items: page.items.map((story) => storyHistoryView(story, ts, tm)),
    nextCursor: page.nextCursor,
  };
}

/**
 * The seen-state write (HIGHLIGHT-06, D-105, R-P5) — what `StoriesSurface` flushes its buffer of
 * shown story ids through, on close, on a group change, at 10 ids and on unmount. The page-hide
 * flush does NOT come here: a server action may be aborted on unload, so that one is sent with
 * `sendSeenBeacon` to `POST /api/stories/views` (review WR-07).
 *
 * - **`parseSeenBatch` runs first** (`lib/seen-batch.ts`: dedupe, then the contract's own
 *   `markStoriesSeenSchema`): the list is untrusted, so an empty list, a non-uuid or more than
 *   `STORY_SEEN_BATCH_MAX` UNIQUE ids sends NO request. An oversized list is REFUSED, not chunked
 *   (review WR-04, T-05.2-48): the surface never sends more than `SEEN_FLUSH_AT` = 10, so a bigger
 *   list is not a real client and must not amplify one call into many API calls. An accepted list
 *   is exactly ONE `POST /v1/stories/views`. The page-hide route (`/api/stories/views`) applies the
 *   same helper, so the two doors cannot drift apart on the cap.
 * - **It is SILENT (planning decision 4).** A refusal, an expired session or a transport failure
 *   answers `false` and is logged by SHAPE only (status and code, never an id — a log of "who saw
 *   what" is the record V8 forbids). It deliberately does NOT `redirect()`: a background write must
 *   never bounce a member out of the viewer; an expired session is handled by their next real
 *   navigation. And it does NOT revalidate: the ring is re-derived on the client from the session
 *   set, and re-rendering `/inicio` on every flush would be the like actions' waste, repeated.
 */
export async function markStoriesSeenAction(storyIds: string[]): Promise<boolean> {
  const ids = parseSeenBatch(storyIds);
  if (ids === null) return false;

  try {
    await markStoriesSeen(ids);
    return true;
  } catch (error) {
    console.error('stories.seen_write_failed', {
      status: error instanceof ApiClientError ? error.status : null,
      code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
    });
    return false;
  }
}
