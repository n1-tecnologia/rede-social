import {
  FEED_PAGE_SIZE,
  type FeedPage,
  type FeedPost,
  feedPageSchema,
  feedPostSchema,
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

/** The query `/inicio` and the load-more action send; `cursor` is OPAQUE and forwarded verbatim. */
export type FeedQueryInput = { cursor?: string; limit?: number };

/**
 * `GET /v1/feed` (FEED-02).
 *
 * `limit` defaults to `FEED_PAGE_SIZE`; the API clamps it anyway. The cursor is passed through
 * untouched: its encoding is an implementation detail of the API, and nothing on the web side
 * parses, rebuilds or validates it.
 */
export async function getFeed(query: FeedQueryInput = {}): Promise<FeedPage> {
  const search = new URLSearchParams();
  if (query.cursor) search.set('cursor', query.cursor);
  search.set('limit', String(query.limit ?? FEED_PAGE_SIZE));

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
