'use server';

import {
  commentsQuerySchema,
  createCommentSchema,
  type FeedComment,
  feedQuerySchema,
  repliesQuerySchema,
  updatePostSchema,
} from '@tria/module-feed/contracts';
import type { CommentView, PostCardView } from '@tria/module-feed/ui';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { ApiClientError, bootstrapRedirectPath, getBootstrap } from '@/lib/bootstrap';
import {
  createComment,
  deleteComment,
  getComments,
  getFeed,
  getReplies,
  likeComment,
  likePost,
  softDeletePost,
  unlikeComment,
  unlikePost,
  updatePost,
} from '@/lib/feed';
import { commentView, postCardView } from '@/lib/feed-view';
import {
  asMediaIssue,
  attemptPostWrite,
  type PostDeleteResult,
  type PostWriteResult,
} from '@/lib/feed-write';
import { primaryHostOrigin } from '@/lib/tenant-host';

/**
 * The feed's four write/read actions (FEED-02, FEED-04), in the `membros/actions.ts` conventions —
 * the three rules every server action in this app encodes:
 *
 *  1. **The SAME Zod the API validates with runs BEFORE the request.** A server action is a public
 *     endpoint and its argument is untrusted (T-04-38); a forged cursor or a post id that is not a
 *     uuid is refused here and never reaches SQL, and the API re-authorises independently anyway.
 *  2. **A refusal is a catalog KEY, never pt-BR copy** (T-04-42). The client translates, so no
 *     server-controlled string reaches the DOM and the message catalog stays the one source of copy.
 *  3. **`redirect()` is called OUTSIDE the try/catch.** It throws in Next 16, and a catch would
 *     swallow the navigation.
 *
 * Every one of them goes through `lib/feed.ts`, which is the single fetch implementation the home
 * slot also uses (D-58, Pitfall 9) — the first page and the next page therefore cannot disagree
 * about the page size, the cursor encoding or the tenant the request is scoped to.
 */

export type FeedPageResult =
  | { ok: true; items: PostCardView[]; nextCursor: string | null }
  | { ok: false; code: 'generic' };

export type { PostDeleteResult, PostWriteResult };

export type LikeActionResult =
  | { ok: true; liked: boolean; likeCount: number }
  | { ok: false; code: 'generic' };

/** The post id every like action takes. A uuid or nothing — the API answers a bare 404 for a miss. */
const postIdSchema = z.uuid();

/**
 * One page of the feed, already mapped to the view the card renders.
 *
 * The mapping runs HERE rather than in the client because only the server knows the tenant's time
 * zone, the media URL shape and the route table — and because the already-created `VideoPlayer`
 * element has to be built on the server side of the boundary in both directions (04-04's decision).
 */
async function loadPage(cursor?: string): Promise<FeedPageResult> {
  const query = feedQuerySchema.safeParse(cursor ? { cursor } : {});
  if (!query.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: FeedPageResult = { ok: false, code: 'generic' };
  try {
    // The share origin is resolved HERE too, not inherited from page 1: a server action runs in its
    // own request, and a card appended by the sentinel must carry the same `https://{primaryHost}`
    // link the server-rendered cards do (FEED-07). Reading it in the browser instead is what
    // T-04-51 bans. The tenant's zone comes from the bootstrap (cached per request), so a card
    // appended by the sentinel prints its absolute time on the same clock as the first page.
    const [page, tf, shareOrigin, bootstrap] = await Promise.all([
      getFeed({ cursor: query.data.cursor, limit: query.data.limit }),
      getTranslations('feed'),
      primaryHostOrigin(),
      getBootstrap(),
    ]);
    const now = Date.now();
    const timeZone = bootstrap.tenant.timezone;
    result = {
      ok: true,
      items: page.items.map((post) => postCardView(post, now, tf, shareOrigin, timeZone)),
      nextCursor: page.nextCursor,
    };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) console.error('feed.load_more_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

/**
 * The infinite-scroll sentinel's page.
 *
 * The cursor is OPAQUE: it is forwarded exactly as the previous page returned it and is never
 * parsed, decoded or rebuilt here — its encoding belongs to the API. `limit` is never taken from
 * the caller: `feedQuerySchema`'s default is `FEED_PAGE_SIZE`, and the API REFUSES an oversized
 * `limit` with a 400 rather than clamping it, so the sentinel must never ask for a bigger page
 * than the first one got.
 */
export async function loadMoreFeedAction(cursor: string): Promise<FeedPageResult> {
  return loadPage(cursor);
}

/** Pull-to-refresh: page 1 again, through the same implementation the server-rendered page used. */
export async function refreshFeedAction(): Promise<FeedPageResult> {
  return loadPage();
}

/** Shared by like and unlike: the only difference is which client they call. */
async function toggle(
  postId: string,
  run: (id: string) => Promise<{ liked: boolean; likeCount: number }>,
): Promise<LikeActionResult> {
  const id = postIdSchema.safeParse(postId);
  if (!id.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: LikeActionResult = { ok: false, code: 'generic' };
  try {
    const outcome = await run(id.data);
    result = { ok: true, liked: outcome.liked, likeCount: outcome.likeCount };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    // Shape only: the log carries no caption and no member, so a refusal cannot leak post content
    // into the server log (T-04-40).
    if (!refusal) console.error('feed.like_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

export async function likePostAction(postId: string): Promise<LikeActionResult> {
  return toggle(postId, likePost);
}

export async function unlikePostAction(postId: string): Promise<LikeActionResult> {
  return toggle(postId, unlikePost);
}

/* ── The admin write paths (FEED-03) ───────────────────────────────────────────────────────────── */

/**
 * Save an edit (FEED-03). The SAME Zod the API validates with runs BEFORE the request, so a body
 * the composer could not have produced is refused here and never reaches SQL; the API re-authorises
 * independently anyway, and its `author_user_id` predicate — not this action — is what decides
 * whether the post is this admin's to touch.
 *
 * The result vocabulary, the refusal mapping and the revalidation live in `lib/feed-write.ts`,
 * shared verbatim with the create action: a `'use server'` module may export only async functions,
 * so keeping them here would mean two copies of "which envelope field carries the refusal".
 */
export async function updatePostAction(postId: string, input: unknown): Promise<PostWriteResult> {
  const id = postIdSchema.safeParse(postId);
  if (!id.success) return { ok: false, code: 'not_found' };

  const body = updatePostSchema.safeParse(input);
  if (!body.success) {
    const media = body.error.issues.map((issue) => asMediaIssue(issue.message)).find(Boolean);
    if (media) return { ok: false, code: media };
    const empty = body.error.issues.some((issue) => issue.message === 'empty_post');
    return { ok: false, code: empty ? 'empty_post' : 'generic' };
  }

  const { result, refusal } = await attemptPostWrite(() => updatePost(id.data, body.data));
  // The edited caption has to reach every server-rendered read of it, including the post's own
  // page, which a member may already be holding a share link to.
  if (result.ok) {
    revalidatePath('/inicio');
    revalidatePath(`/post/${result.postId}`);
  }

  if (refusal) redirect(refusal);
  return result;
}

/**
 * Soft-delete the caller's OWN post (FEED-03), from the card's overflow menu.
 *
 * Nothing is removed: the row keeps its `deleted_at` stamp for Phase 8's moderation and the Phase 3
 * sweeper. A repeat on an already-removed post answers the same bare 404 an unknown id gets, which
 * reads as `not_found` here — so a double tap produces one stamp and one toast.
 */
export async function deletePostAction(postId: string): Promise<PostDeleteResult> {
  const id = postIdSchema.safeParse(postId);
  if (!id.success) return { ok: false, code: 'not_found' };

  let refusal: string | null = null;
  let result: PostDeleteResult = { ok: false, code: 'generic' };
  try {
    await softDeletePost(id.data);
    // The card has to leave every feed read, not just the column the member is looking at.
    revalidatePath('/inicio');
    revalidatePath(`/post/${id.data}`);
    result = { ok: true };
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      result = { ok: false, code: 'not_found' };
    } else {
      if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
      if (!refusal) console.error('feed.post.delete_failed', { error: String(error) });
    }
  }

  if (refusal) redirect(refusal);
  return result;
}

/* ── Comments, replies and their writes (FEED-05, FEED-06, D-59..D-62) ──────────────────────────── */

/**
 * The six comment actions (04-07), in the same three conventions as everything above: the API's own
 * Zod runs BEFORE the request, a refusal is a catalog KEY and never pt-BR copy, and every one of
 * them goes through `lib/feed.ts` — the ONE fetch implementation the sheet and the inline list on
 * `/post/[id]` both read (D-59).
 *
 * `now` is read HERE rather than in the client so a comment's relative time is formatted on the
 * server exactly as a post's is (UI-D-14); the only clock the client touches is for the optimistic
 * row it has not sent yet.
 */

export type CommentPageResult =
  | { ok: true; items: CommentView[]; nextCursor: string | null }
  | { ok: false; code: 'generic' };

export type CommentCreateResult =
  | { ok: true; comment: CommentView }
  /** `reply_depth_exceeded` is the API's translation of the database's one-level refusal (D-60). */
  | { ok: false; code: 'generic' | 'reply_depth_exceeded' };

export type CommentDeleteResult = { ok: true } | { ok: false; code: 'generic' };

/** A comment id: a uuid or nothing. The API answers a bare 404 for every miss (T-04-21). */
const commentIdSchema = z.uuid();

/** Reads the comment issue the API put in `details.comment`, and nothing else from the envelope. */
function commentIssue(error: unknown): 'reply_depth_exceeded' | null {
  if (!(error instanceof ApiClientError)) return null;
  const issue = (error.details as { comment?: unknown } | undefined)?.comment;
  return issue === 'reply_depth_exceeded' ? 'reply_depth_exceeded' : null;
}

/** Shared by the two page actions: the only difference is which client they call. */
async function commentPage(
  run: () => Promise<{ items: FeedComment[]; nextCursor: string | null }>,
  nowLabel: string,
): Promise<CommentPageResult> {
  let refusal: string | null = null;
  let result: CommentPageResult = { ok: false, code: 'generic' };
  try {
    // The tenant's zone for the absolute title, from the bootstrap (cached per request).
    const [page, bootstrap] = await Promise.all([run(), getBootstrap()]);
    const now = Date.now();
    const timeZone = bootstrap.tenant.timezone;
    result = {
      ok: true,
      items: page.items.map((comment) => commentView(comment, now, nowLabel, timeZone)),
      nextCursor: page.nextCursor,
    };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    // Shape only: a comment body is member content and never reaches a log line (T-04-19/T-04-40).
    if (!refusal) console.error('feed.comments.load_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

/**
 * One page of a post's ROOT comments, newest first (D-62).
 *
 * The cursor is OPAQUE: forwarded exactly as the previous page returned it, never parsed or rebuilt
 * here. `limit` is never taken from the caller — `commentsQuerySchema`'s default is
 * `COMMENTS_PAGE_SIZE` and the API REFUSES an oversized one rather than clamping it.
 */
export async function loadCommentsAction(
  postId: string,
  cursor?: string,
): Promise<CommentPageResult> {
  const id = postIdSchema.safeParse(postId);
  const query = commentsQuerySchema.safeParse(cursor ? { cursor } : {});
  if (!id.success || !query.success) return { ok: false, code: 'generic' };

  const tf = await getTranslations('feed');
  return commentPage(
    () => getComments(id.data, { cursor: query.data.cursor, limit: query.data.limit }),
    tf('comments.now'),
  );
}

/**
 * One page of ONE root's replies, oldest first (D-60, D-62).
 *
 * Its own schema, because its cursor walks the opposite direction over a different index and the
 * two are NOT interchangeable — feeding one to the other degrades to page 1 rather than erroring.
 */
export async function loadRepliesAction(
  commentId: string,
  cursor?: string,
): Promise<CommentPageResult> {
  const id = commentIdSchema.safeParse(commentId);
  const query = repliesQuerySchema.safeParse(cursor ? { cursor } : {});
  if (!id.success || !query.success) return { ok: false, code: 'generic' };

  const tf = await getTranslations('feed');
  return commentPage(
    () => getReplies(id.data, { cursor: query.data.cursor, limit: query.data.limit }),
    tf('comments.now'),
  );
}

/**
 * Create a comment, or a reply when `parentId` is present (FEED-05).
 *
 * A reply to a reply comes back from the API as a 400 carrying `details.comment =
 * 'reply_depth_exceeded'`; this maps it to its OWN result code so the client can show the catalog's
 * sentence for it. The raw machine code never crosses to the DOM (T-04-42), and it is deliberately
 * the one comment issue a client branches on — every other miss is a bare 404 that reads as
 * `generic`.
 */
export async function createCommentAction(
  postId: string,
  body: string,
  parentId?: string,
): Promise<CommentCreateResult> {
  const id = postIdSchema.safeParse(postId);
  const input = createCommentSchema.safeParse(parentId ? { body, parentId } : { body });
  if (!id.success || !input.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: CommentCreateResult = { ok: false, code: 'generic' };
  try {
    const [created, tf, bootstrap] = await Promise.all([
      createComment(id.data, input.data.body, input.data.parentId ?? undefined),
      getTranslations('feed'),
      getBootstrap(),
    ]);
    result = {
      ok: true,
      comment: commentView(created, Date.now(), tf('comments.now'), bootstrap.tenant.timezone),
    };
  } catch (error) {
    const issue = commentIssue(error);
    if (issue) {
      result = { ok: false, code: issue };
    } else {
      if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
      if (!refusal) console.error('feed.comment.create_failed', { error: String(error) });
    }
  }

  if (refusal) redirect(refusal);
  return result;
}

/**
 * Soft-delete the caller's OWN comment or reply (D-61).
 *
 * The authority lives in the API's predicate, not in the `canDelete` flag the row carried: someone
 * else's comment, an unknown id and an already-removed one are one bare 404 here, which reads as
 * `generic` (T-04-44).
 */
export async function deleteCommentAction(commentId: string): Promise<CommentDeleteResult> {
  const id = commentIdSchema.safeParse(commentId);
  if (!id.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: CommentDeleteResult = { ok: false, code: 'generic' };
  try {
    await deleteComment(id.data);
    result = { ok: true };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) console.error('feed.comment.delete_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

/** Shared by the comment like and unlike, exactly as `toggle` is by the post's (FEED-06). */
async function toggleComment(
  commentId: string,
  run: (id: string) => Promise<{ liked: boolean; likeCount: number }>,
): Promise<LikeActionResult> {
  const id = commentIdSchema.safeParse(commentId);
  if (!id.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: LikeActionResult = { ok: false, code: 'generic' };
  try {
    const outcome = await run(id.data);
    result = { ok: true, liked: outcome.liked, likeCount: outcome.likeCount };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) console.error('feed.comment.like_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

export async function likeCommentAction(commentId: string): Promise<LikeActionResult> {
  return toggleComment(commentId, likeComment);
}

export async function unlikeCommentAction(commentId: string): Promise<LikeActionResult> {
  return toggleComment(commentId, unlikeComment);
}
