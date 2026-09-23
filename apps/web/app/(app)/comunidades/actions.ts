'use server';

import { type CommunitySummary, communityQuerySchema } from '@tria/module-communities/contracts';
import { feedQuerySchema } from '@tria/module-feed/contracts';
import type { PostCardView } from '@tria/module-feed/ui';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { getCommunities } from '@/lib/communities';
import { getFeed } from '@/lib/feed';
import { postCardView } from '@/lib/feed-view';
import { primaryHostOrigin } from '@/lib/tenant-host';

/**
 * The community list's pagination action (COMM-03, D-76), in the `membros/actions.ts` conventions:
 * the SAME Zod the API validates with runs BEFORE the request (a server action is a public
 * endpoint), a 401/403 becomes a navigation OUTSIDE the try/catch (Next 16: `redirect()` throws),
 * and every refusal is answered with a catalog KEY rather than pt-BR copy — the client component
 * translates.
 *
 * The request itself goes through `getCommunities` in `lib/communities.ts`, which is the ONE place
 * that builds the query string and runs `apiFetch('/v1/communities?…')`. Duplicating the call here
 * would let the sentinel and the first page drift apart on page size.
 *
 * **This module must not re-export anything.** Turbopack drops re-exports from a `'use server'`
 * module and the build fails with "The module has no exports at all" — so an action that lives
 * elsewhere is IMPORTED from its defining file by the component, never forwarded through here.
 */

export type LoadMoreCommunitiesResult =
  | { ok: true; items: CommunitySummary[]; nextCursor: string | null }
  | { ok: false; code: 'generic' };

/**
 * One more page of the community list.
 *
 * The cursor is OPAQUE: it is forwarded exactly as the previous page returned it and is never
 * parsed, decoded or rebuilt here (T-05-05) — its encoding belongs to
 * `packages/core/server/paging.ts`, and the API degrades a stale or tampered value to the first page
 * on its own rather than raising.
 */
export async function loadMoreCommunitiesAction(
  cursor: string,
): Promise<LoadMoreCommunitiesResult> {
  const query = communityQuerySchema.safeParse({ cursor });
  if (!query.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: LoadMoreCommunitiesResult = { ok: false, code: 'generic' };
  try {
    const page = await getCommunities({ cursor: query.data.cursor, limit: query.data.limit });
    result = { ok: true, items: page.items, nextCursor: page.nextCursor };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) console.error('communities.load_more_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

/**
 * Page 1 again — what `PullToRefresh` calls. It is the SAME `getCommunities` the RSC page called, so
 * a refresh and a first paint can never return differently shaped pages.
 */
export async function refreshCommunitiesAction(): Promise<LoadMoreCommunitiesResult> {
  let refusal: string | null = null;
  let result: LoadMoreCommunitiesResult = { ok: false, code: 'generic' };
  try {
    const page = await getCommunities();
    result = { ok: true, items: page.items, nextCursor: page.nextCursor };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) console.error('communities.refresh_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

/* ── The community PAGE's post list (COMM-03, 05-04) ──────────────────────────────────────────── */

/**
 * One page of a community's posts, already mapped to the view `PostCard` renders — the SAME shape
 * `/inicio`'s own sentinel returns, because it is the same `postCardView` over the same endpoint
 * (`GET /v1/feed?communityId=`, 05-03). A community page that built its own view would drift from
 * the feed on the time zone, the media node or the profile route the first time either changed.
 */
export type CommunityPostsPageResult =
  | { ok: true; items: PostCardView[]; nextCursor: string | null }
  | { ok: false; code: 'generic' };

/**
 * The shared body of both community-post actions. `communityId` is the BOUND first argument (the
 * page calls `.bind(null, id)`), so the client never chooses which community it is paging — the
 * API re-checks visibility on every request regardless, and answers one bare 404 for a miss.
 */
async function communityPostsPage(
  communityId: string,
  cursor?: string,
): Promise<CommunityPostsPageResult> {
  const query = feedQuerySchema.safeParse(cursor ? { communityId, cursor } : { communityId });
  if (!query.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: CommunityPostsPageResult = { ok: false, code: 'generic' };
  try {
    // The share origin is resolved HERE too, not inherited from page 1: a server action runs in its
    // own request, and a card appended by the sentinel must carry the same `https://{primaryHost}`
    // link the server-rendered cards do (FEED-07, T-04-51).
    const [page, tf, shareOrigin] = await Promise.all([
      getFeed({
        communityId: query.data.communityId,
        cursor: query.data.cursor,
        limit: query.data.limit,
      }),
      getTranslations('feed'),
      primaryHostOrigin(),
    ]);
    const now = Date.now();
    result = {
      ok: true,
      items: page.items.map((post) => postCardView(post, now, tf, shareOrigin)),
      nextCursor: page.nextCursor,
    };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    // Shape only: a community NAME is member-facing content and never reaches a log line (T-05-06).
    if (!refusal) console.error('communities.posts_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

/**
 * The community page's infinite-scroll sentinel.
 *
 * The cursor is OPAQUE: it is forwarded exactly as the previous page returned it and is never
 * parsed, decoded or rebuilt here (T-05-05).
 */
export async function loadMoreCommunityPostsAction(
  communityId: string,
  cursor: string,
): Promise<CommunityPostsPageResult> {
  return communityPostsPage(communityId, cursor);
}

/** Page 1 again — what `PullToRefresh` calls, through the SAME read the RSC page performed. */
export async function refreshCommunityPostsAction(
  communityId: string,
): Promise<CommunityPostsPageResult> {
  return communityPostsPage(communityId);
}
