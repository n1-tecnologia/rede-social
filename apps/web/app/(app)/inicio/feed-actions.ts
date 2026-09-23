'use server';

import { feedQuerySchema } from '@tria/module-feed/contracts';
import type { PostCardView } from '@tria/module-feed/ui';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { getFeed, likePost, unlikePost } from '@/lib/feed';
import { postCardView } from '@/lib/feed-view';

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
    const [page, tf] = await Promise.all([
      getFeed({ cursor: query.data.cursor, limit: query.data.limit }),
      getTranslations('feed'),
    ]);
    const now = Date.now();
    result = {
      ok: true,
      items: page.items.map((post) => postCardView(post, now, tf)),
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
