import {
  COMMENTS_PAGE_SIZE,
  type CreatePost,
  commentPageSchema,
  commentSchema,
  FEED_PAGE_SIZE,
  type FeedComment,
  type FeedCommentPage,
  type FeedPage,
  type FeedPost,
  feedPageSchema,
  feedPostSchema,
  type LikeResult,
  likeResultSchema,
  REPLIES_PAGE_SIZE,
  type UpdatePost,
} from '@tria/module-feed/contracts';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * The ONE feed fetch implementation (D-58, Pitfall 9). The `/inicio` home slot, 04-02's infinite
 * scroll sentinel, 04-05's composer redirect and 04-06's post page all read THIS — the 03-05
 * `getMembers` rule — so the page and its pagination can never disagree about the page size or the
 * tenant the request is scoped to.
 *
 * The browser never talks to Supabase for feed data: every read goes through `apiFetch` to the Hono
 * API, which re-verifies the token and re-reads the membership row on every request.
 */

/** Reads the envelope's error code without ever throwing on a non-JSON body. */
async function apiError(res: Response): Promise<ApiClientError> {
  let code = 'HTTP_ERROR';
  let details: Record<string, unknown> | undefined;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; details?: Record<string, unknown> };
    };
    if (typeof body?.error?.code === 'string') code = body.error.code;
    details = body?.error?.details;
  } catch {
    // A non-JSON body keeps the generic code — every caller's refusal handling is the same.
  }
  return new ApiClientError(res.status, code, details);
}

/**
 * The query `/inicio` and the load-more action send; `cursor` is OPAQUE and forwarded verbatim.
 *
 * `communityId` (05-03, COMM-03) narrows the SAME endpoint to one community's posts — the same
 * projection, the same cursor envelope, the same page size. It is a parameter rather than a second
 * fetch function precisely so the merged feed and a community's own list cannot drift on any of the
 * three.
 */
export type FeedQueryInput = { cursor?: string; limit?: number; communityId?: string };

/**
 * `GET /v1/feed` (FEED-02) and, with `communityId`, `GET /v1/feed?communityId=` (COMM-03).
 *
 * `limit` defaults to `FEED_PAGE_SIZE`; the API clamps it anyway. The cursor is passed through
 * untouched: its encoding is an implementation detail of the API, and nothing on the web side
 * parses, rebuilds or validates it.
 */
export async function getFeed(query: FeedQueryInput = {}): Promise<FeedPage> {
  const search = new URLSearchParams();
  if (query.cursor) search.set('cursor', query.cursor);
  search.set('limit', String(query.limit ?? FEED_PAGE_SIZE));
  if (query.communityId) search.set('communityId', query.communityId);

  const res = await apiFetch(`/v1/feed?${search.toString()}`);
  if (!res.ok) throw await apiError(res);
  return feedPageSchema.parse(await res.json());
}

/**
 * One page of the feed, or `null` when the API could not answer — the widget then renders its own
 * error card (UI-SPEC E4/error) rather than taking the whole `/inicio` down. A refusal
 * `bootstrapRedirectPath` knows (401, blocked, suspended, host mismatch, no membership) becomes a
 * navigation, performed OUTSIDE the try/catch: `redirect()` throws in Next 16 and a catch would
 * swallow it.
 *
 * A 404 `MODULE_DISABLED` also lands here as `null`. It cannot happen through the home slot — a
 * module without an enabled flag never reaches `bootstrap.modules`, so its renderer is never called —
 * but a direct call during a flag flip must degrade to the error card, not to a crash.
 */
export async function loadFeed(query: FeedQueryInput = {}): Promise<FeedPage | null> {
  let path: string | null = null;
  let page: FeedPage | null = null;
  try {
    page = await getFeed(query);
  } catch (error) {
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    if (!path) console.error('feed.list_failed', { error: String(error) });
  }

  if (path) redirect(path);
  return page;
}

/** The outcome of reading ONE post: the post, a bare miss, or an answer we could not read. */
export type FeedPostResult =
  | { status: 'ok'; post: FeedPost }
  | { status: 'not-found' }
  | { status: 'error' };

/**
 * `GET /v1/feed/posts/{postId}` (FEED-07 groundwork).
 *
 * The API answers ONE indistinguishable bare 404 for every miss — unknown id, another tenant's post,
 * soft-deleted (D-23/T-04-01) — and a 400 for an id that is not a uuid at all. This helper collapses
 * ALL of them to a single `not-found`, so the screen renders one "Publicação não encontrada" for
 * every reason a member can fail to reach a post (UI-D-16).
 *
 * A transport or 5xx failure is `error`, which is a DIFFERENT screen: "Algo deu errado" must never be
 * mistaken for "this post is not in your community", nor the other way round.
 */
export async function loadPost(postId: string): Promise<FeedPostResult> {
  let path: string | null = null;
  let result: FeedPostResult = { status: 'error' };
  try {
    const res = await apiFetch(`/v1/feed/posts/${encodeURIComponent(postId)}`);
    if (res.ok) {
      result = { status: 'ok', post: feedPostSchema.parse(await res.json()) };
    } else if (res.status === 404 || res.status === 400) {
      result = { status: 'not-found' };
    } else {
      const error = await apiError(res);
      path = bootstrapRedirectPath(error);
      if (!path) console.error('feed.read_failed', { status: res.status, code: error.code });
    }
  } catch (error) {
    console.error('feed.read_failed', { error: String(error) });
  }

  if (path) redirect(path);
  return result;
}

/**
 * `POST` / `DELETE /v1/feed/posts/{postId}/like` (FEED-04).
 *
 * These are the ONLY feed mutation clients: the like server actions go through them exactly as the
 * page and the load-more action go through `getFeed`, so nothing in the feed opens a second request
 * path that could drift on the tenant header or on how a refusal is read.
 *
 * The toggle is IDEMPOTENT at the API: liking an already-liked post returns the same body with a
 * 200, never a 409, so a double tap that also lands as two taps cannot produce two rows. Both
 * helpers answer the CURRENT `{ liked, likeCount }` read back in the writing transaction, which is
 * the value that replaces the client's optimistic pair.
 */
async function toggleLike(postId: string, method: 'POST' | 'DELETE'): Promise<LikeResult> {
  const res = await apiFetch(`/v1/feed/posts/${encodeURIComponent(postId)}/like`, { method });
  if (!res.ok) throw await apiError(res);
  return likeResultSchema.parse(await res.json());
}

export async function likePost(postId: string): Promise<LikeResult> {
  return toggleLike(postId, 'POST');
}

export async function unlikePost(postId: string): Promise<LikeResult> {
  return toggleLike(postId, 'DELETE');
}

/* ── The admin write paths (FEED-01, FEED-03) ──────────────────────────────────────────────────── */

/**
 * `POST /v1/feed/posts` (FEED-01) — the composer's publish.
 *
 * Through the SAME `apiFetch` every read above uses, so the composer cannot drift on the tenant
 * header or on how a refusal is read. The body is already validated by `createPostSchema` in the
 * action; the API re-validates it independently, and the asset ids inside it are re-checked against
 * the caller's own tenant inside the writing transaction (T-04-56).
 */
export async function createPost(input: CreatePost): Promise<FeedPost> {
  const res = await apiFetch('/v1/feed/posts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await apiError(res);
  return feedPostSchema.parse(await res.json());
}

/**
 * `PATCH /v1/feed/posts/{postId}` (FEED-03) — the edit screen's save.
 *
 * Every miss is the SAME bare 404 the detail read gives: someone else's post, an unknown id,
 * another tenant's, and — the race this predicate exists for — one that was soft-deleted between
 * the form loading and the save (T-04-57). The authority is the API's own `author_user_id`
 * predicate; nothing here decides it.
 */
export async function updatePost(postId: string, input: UpdatePost): Promise<FeedPost> {
  const res = await apiFetch(`/v1/feed/posts/${encodeURIComponent(postId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await apiError(res);
  return feedPostSchema.parse(await res.json());
}

/**
 * `DELETE /v1/feed/posts/{postId}` (FEED-03) — a SOFT delete; nothing is removed from the database.
 *
 * A repeat on an already-removed post answers the same bare 404 an unknown id gets, which is what
 * makes the menu's delete idempotent from the member's side: a double tap produces one stamp, one
 * event and one toast.
 */
export async function softDeletePost(postId: string): Promise<void> {
  const res = await apiFetch(`/v1/feed/posts/${encodeURIComponent(postId)}`, { method: 'DELETE' });
  if (!res.ok) throw await apiError(res);
}

/* ── Comments, replies and their writes (FEED-05, FEED-06, D-59..D-62) ──────────────────────────── */

/**
 * The comment clients (04-07). Same module, same `apiFetch`, same refusal reading as everything
 * above — the sheet over the feed and the inline list on `/post/[id]` are ONE implementation
 * (D-59), so giving them two request paths would reintroduce exactly the drift the component
 * structure removes.
 *
 * Every page here is parsed with the SAME contract schema the API answers with, so a field the API
 * stops sending (`authorRemoved`, say) fails loudly at the boundary instead of rendering as
 * `undefined` three components deeper.
 */

/** The query both comment lists send; `cursor` is OPAQUE and forwarded verbatim (03-03). */
export type CommentQueryInput = { cursor?: string; limit?: number };

function pageSearch(query: CommentQueryInput, fallbackLimit: number): string {
  const search = new URLSearchParams();
  if (query.cursor) search.set('cursor', query.cursor);
  search.set('limit', String(query.limit ?? fallbackLimit));
  return search.toString();
}

/**
 * `GET /v1/feed/posts/{postId}/comments` (D-62) — ROOT comments, newest first.
 *
 * Replies are deliberately NOT in this page: `replyCount` tells the toggle how many there are and
 * `getReplies` fetches them when the member expands that root (D-60). A foreign-tenant or removed
 * post answers the same bare 404 the detail read gives.
 */
export async function getComments(
  postId: string,
  query: CommentQueryInput = {},
): Promise<FeedCommentPage> {
  const res = await apiFetch(
    `/v1/feed/posts/${encodeURIComponent(postId)}/comments?${pageSearch(query, COMMENTS_PAGE_SIZE)}`,
  );
  if (!res.ok) throw await apiError(res);
  return commentPageSchema.parse(await res.json());
}

/**
 * `GET /v1/feed/comments/{commentId}/replies` (D-60, D-62) — ONE root's replies, OLDEST first.
 *
 * Its cursor is NOT interchangeable with the root list's: the two walk opposite directions over
 * different indexes, and feeding one to the other degrades to page 1 rather than erroring.
 */
export async function getReplies(
  commentId: string,
  query: CommentQueryInput = {},
): Promise<FeedCommentPage> {
  const res = await apiFetch(
    `/v1/feed/comments/${encodeURIComponent(commentId)}/replies?${pageSearch(query, REPLIES_PAGE_SIZE)}`,
  );
  if (!res.ok) throw await apiError(res);
  return commentPageSchema.parse(await res.json());
}

/**
 * `POST /v1/feed/posts/{postId}/comments` (FEED-05).
 *
 * `parentId` present means "this is a reply". Whether that parent may HAVE children is the
 * database's decision, not this function's: a reply to a reply comes back as a 400 carrying
 * `details.comment = 'reply_depth_exceeded'`, which the action maps to its own catalog key.
 */
export async function createComment(
  postId: string,
  body: string,
  parentId?: string,
): Promise<FeedComment> {
  const res = await apiFetch(`/v1/feed/posts/${encodeURIComponent(postId)}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parentId ? { body, parentId } : { body }),
  });
  if (!res.ok) throw await apiError(res);
  return commentSchema.parse(await res.json());
}

/**
 * `DELETE /v1/feed/comments/{commentId}` (D-61) — a member removes their OWN comment or reply.
 *
 * The authority is in the API's own predicate (`author_user_id = caller`), so someone else's
 * comment, an unknown id and an already-removed one are ONE bare 404 (T-04-44). `canDelete` on the
 * row is a convenience for the UI; it is never what decides the outcome.
 */
export async function deleteComment(commentId: string): Promise<void> {
  const res = await apiFetch(`/v1/feed/comments/${encodeURIComponent(commentId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw await apiError(res);
}

/**
 * `POST` / `DELETE /v1/feed/comments/{commentId}/like` (FEED-06) — the post toggle's twin.
 *
 * Idempotent at the API exactly as the post's is: a repeated like returns the same body with a 200,
 * never a 409, and both answer the CURRENT `{ liked, likeCount }` read back inside the writing
 * transaction — the value that replaces the row's optimistic pair.
 */
async function toggleCommentLike(
  commentId: string,
  method: 'POST' | 'DELETE',
): Promise<LikeResult> {
  const res = await apiFetch(`/v1/feed/comments/${encodeURIComponent(commentId)}/like`, { method });
  if (!res.ok) throw await apiError(res);
  return likeResultSchema.parse(await res.json());
}

export async function likeComment(commentId: string): Promise<LikeResult> {
  return toggleCommentLike(commentId, 'POST');
}

export async function unlikeComment(commentId: string): Promise<LikeResult> {
  return toggleCommentLike(commentId, 'DELETE');
}

/** One page of a post's root comments, or `null` when the API could not answer (UI-D-22). */
export type FeedCommentPageResult = FeedCommentPage | null;

/**
 * The post page's FIRST page of root comments (D-59, 04-08).
 *
 * `null` is "we could not read them", which the inline list renders as its own error-with-retry
 * WHERE THE ROWS WOULD BE — the post itself still renders in full above it (UI-SPEC E10/E13
 * partial: the card is never withheld behind its comments). A refusal `bootstrapRedirectPath` knows
 * becomes a navigation, performed OUTSIDE the try/catch because `redirect()` throws in Next 16.
 *
 * It goes through the SAME `getComments` the sheet uses: one implementation for both containers,
 * so the seeded page and the sheet's page can never disagree about ordering or page size.
 */
export async function loadPostComments(
  postId: string,
  query: CommentQueryInput = {},
): Promise<FeedCommentPageResult> {
  let path: string | null = null;
  let page: FeedCommentPage | null = null;
  try {
    page = await getComments(postId, query);
  } catch (error) {
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    // Shape only: a comment body is member content and never reaches a log line (T-04-19/T-04-40).
    if (!path) console.error('feed.comments.load_failed', { error: String(error) });
  }

  if (path) redirect(path);
  return page;
}
