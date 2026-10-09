import {
  type FeedPost,
  type VideoCommunities,
  videoCommunitiesSchema,
} from '@rede-social/module-feed/contracts';
import { REELS_PAGE_SIZE } from '@rede-social/module-reels/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { getFeed, loadPost } from '@/lib/feed';
import { postCardBase } from '@/lib/feed-view';
import { primaryHostOrigin } from '@/lib/tenant-host';

export { announcedCount } from '@/lib/reels-count';

/**
 * The web data path of Reels (05.3-07, REELS-03 web half, REELS-05, FEED-07). Server-side only: it
 * reaches the API through `lib/api` and has no `'use server'` of its own. `reels-actions.ts` exposes
 * the two calls the client needs.
 *
 * **One fetch implementation.** A Reels page is `getFeed` with `media: 'video'`, the same function
 * Início and a community's own list call (D-58, Pitfall 9), so the page size, the cursor envelope and
 * the tenant scope can never drift between them.
 *
 * **One mapping.** `reelView` is built on the feed card's own `postCardBase` for the author link, the
 * counts, the liked state and the FEED-07 share link (`null` without a verified primary host,
 * T-04-51), so a Reel and its card can never disagree about any of them.
 *
 * **No credential.** Nothing here mints or reads a playback token (D-44, T-05.3-15): a page carries
 * the asset id and dimensions only, and the host mints through the batched action.
 */

type Translator = Awaited<ReturnType<typeof getTranslations>>;

/** One Reel, ready to render: the rail, the caption block and the video's asset. */
export type ReelView = {
  id: string;
  caption: string;
  shareUrl: string | null;
  author: { displayName: string; profileHref: string; avatarUrl: string | null };
  community: { name: string; href: string; ariaLabel: string } | null;
  likeCount: number;
  commentCount: number;
  viewerLiked: boolean;
  video: { assetId: string; width: number | null; height: number | null };
};

/**
 * `FeedPost` → `ReelView`, or `null` for a post that carries no `ready` video. The API already
 * filters those out of `?media=video` (plan 01's `READY_VIDEO_POST`); the drop here is defensive, so
 * a page can never hold a Reel with nothing to play.
 */
export function reelView(
  post: FeedPost,
  tf: Translator,
  shareOrigin: string | null,
): ReelView | null {
  const video = post.media.find((item) => item.kind === 'video' && item.status === 'ready');
  if (!video) return null;

  // `postCardBase`, not `postCardView`: a Reel shows no absolute date, so it needs no zone.
  const card = postCardBase(post, Date.now(), tf, shareOrigin);
  return {
    id: card.id,
    caption: card.caption,
    shareUrl: card.shareUrl,
    author: {
      displayName: card.author.displayName,
      profileHref: card.author.profileHref,
      avatarUrl: card.author.avatarUrl,
    },
    // The chip shows the community's NAME (not the card's "em {Comunidade}" label); the href and the
    // accessible name are the card's own.
    community:
      post.community === null || !card.community
        ? null
        : {
            name: post.community.name,
            href: card.community.href,
            ariaLabel: card.community.ariaLabel,
          },
    likeCount: card.likeCount,
    commentCount: card.commentCount,
    viewerLiked: card.viewerLiked,
    video: { assetId: video.assetId, width: video.width, height: video.height },
  };
}

/** The failure's shape for the log: a status and a code, or an error name. Never content. */
function failureOf(error: unknown): Record<string, unknown> {
  if (error instanceof ApiClientError) return { status: error.status, code: error.code };
  return { name: error instanceof Error ? error.name : typeof error };
}

export type ReelsPageQuery = { communityId?: string | null; cursor?: string | null };

/**
 * One page of Reels for a lane (`communityId` null = "Todos"), or `null` when the API could not
 * answer. `loadFeed`'s error rule: a refusal the bootstrap knows (401, blocked, suspended, host
 * mismatch, no membership) is a navigation performed OUTSIDE the try/catch, because `redirect()`
 * throws in Next 16; anything else is `null` and a log line with no content.
 */
export async function loadReelsPage(
  query: ReelsPageQuery,
): Promise<{ items: ReelView[]; nextCursor: string | null } | null> {
  let path: string | null = null;
  let result: { items: ReelView[]; nextCursor: string | null } | null = null;
  try {
    // The share origin is resolved per request: a server action runs in its own request, and a Reel
    // appended by the next page must carry the same `https://{primaryHost}` link as the first page.
    const [page, tf, shareOrigin] = await Promise.all([
      getFeed({
        media: 'video',
        limit: REELS_PAGE_SIZE,
        communityId: query.communityId ?? undefined,
        cursor: query.cursor ?? undefined,
      }),
      getTranslations('feed'),
      primaryHostOrigin(),
    ]);
    const items: ReelView[] = [];
    for (const post of page.items) {
      const view = reelView(post, tf, shareOrigin);
      if (view) items.push(view);
    }
    result = { items, nextCursor: page.nextCursor };
  } catch (error) {
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    if (!path) console.error('reels.list_failed', failureOf(error));
  }

  if (path) redirect(path);
  return result;
}

/**
 * ONE post as a Reel (2026-10-09: the start of the overlay a feed video opens, when its feed page's
 * cursor did not find it), or `null` when it is not one: deleted or unreachable (`loadPost`'s one
 * miss), unreadable, or with no ready video. `loadPost`'s navigations hold, so a post of a community
 * the viewer has just lost lands on that community's locked page, as its link would.
 */
export async function loadReel(postId: string): Promise<ReelView | null> {
  const [result, tf, shareOrigin] = await Promise.all([
    loadPost(postId),
    getTranslations('feed'),
    primaryHostOrigin(),
  ]);
  return result.status === 'ok' ? reelView(result.post, tf, shareOrigin) : null;
}

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
    // A non-JSON body keeps the generic code.
  }
  return new ApiClientError(res.status, code, details);
}

/**
 * `GET /v1/feed/video-communities` (plan 02, REELS-04): the lanes, the active communities that hold
 * a ready video, in the Comunidades order.
 */
export async function getVideoCommunities(): Promise<VideoCommunities> {
  const res = await apiFetch('/v1/feed/video-communities');
  if (!res.ok) throw await apiError(res);
  return videoCommunitiesSchema.parse(await res.json());
}

/**
 * The lanes, or `[]` on any failure other than a navigation. A failed lanes read degrades to the
 * D-120 "Todos only" view (the row simply hides) rather than taking the Reels page down: the lanes
 * are a filter, and the videos themselves are still one tap away.
 */
export async function loadVideoCommunities(): Promise<VideoCommunities['items']> {
  let path: string | null = null;
  let items: VideoCommunities['items'] = [];
  try {
    items = (await getVideoCommunities()).items;
  } catch (error) {
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    if (!path) console.error('reels.lanes_failed', failureOf(error));
  }

  if (path) redirect(path);
  return items;
}
