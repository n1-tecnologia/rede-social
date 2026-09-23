'use client';

import { FeedSurface, type FeedSurfaceProps } from '@/components/feed/FeedSurface';

/**
 * The community page's post list (COMM-03, UI-D-36, D-71).
 *
 * **It is the feed's own list, not a second one.** `FeedSurface` → `FeedList` → `PostCard` is the
 * identical column `/inicio` renders, at identical geometry, over the identical keyset envelope —
 * `GET /v1/feed?communityId=` returns the same projection and the same cursor (05-03), so the
 * shipped `InfiniteScroll` sentinel, the append-never-replace paging, `PullToRefresh`, the comment
 * sheet, the overflow menu and the four list states all arrive already built and already tested. A
 * "community variant" of any of them would drift from the feed the first time either changed, which
 * is the whole of D-56/D-59's argument applied to a third container.
 *
 * **The one thing this file adds is `suppressCommunity`.** On a community's own page the D-71
 * "em {Comunidade}" segment would restate the page the reader is standing on, so it is suppressed
 * (UI-D-36). It is fixed HERE rather than passed by the page because there is no correct `false` on
 * this surface: a caller that could pass either would eventually pass the wrong one.
 *
 * Everything else — which data, which label, which server action, the share origin — is decided on
 * the server by `page.tsx` and passed straight through, exactly as `lib/registry.tsx` does for
 * `/inicio`. This shell chooses nothing.
 */
export type CommunityPostsProps = Omit<FeedSurfaceProps, 'suppressCommunity'>;

export function CommunityPosts(props: CommunityPostsProps) {
  return <FeedSurface {...props} suppressCommunity />;
}
