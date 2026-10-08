'use client';

import {
  type LikeOutcome,
  PostCard,
  type PostCardLabels,
  type PostCardView,
} from '@rede-social/module-feed/ui';
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
 * **08.2-09 — `locked` (UI-D-373, P85).** A locked community's page shows only the sample the feed
 * API answered, read-only. Under `locked` this renders that column statically: the same edge-to-edge
 * `PostCard`s with `readOnly`, and NEITHER `InfiniteScroll` NOR `PullToRefresh`, so scrolling or
 * pulling a locked page never issues a second feed request (the API's `nextCursor` is null there
 * anyway; not mounting the sentinel makes that a property of the page rather than of the answer).
 *
 * Everything else — which data, which label, which server action, the share origin — is decided on
 * the server by `page.tsx` and passed straight through, exactly as `lib/registry.tsx` does for
 * `/inicio`. This shell chooses nothing.
 */
export type CommunityPostsLockedProps = {
  locked: true;
  /** The sample (zero or one post) as the feed view built it. */
  items: PostCardView[];
  captionTruncateAt: number;
  locale: string;
  /** The landmark's name: the community's post list. */
  region: string;
  labels: PostCardLabels;
};

export type CommunityPostsProps =
  | (Omit<FeedSurfaceProps, 'suppressCommunity'> & { locked?: false })
  | CommunityPostsLockedProps;

/** Never reached: a read-only card renders no like control and takes no double tap. */
const refused = async (): Promise<LikeOutcome> => ({ ok: false });

export function CommunityPosts(props: CommunityPostsProps) {
  if (props.locked) {
    return (
      <section aria-label={props.region} data-community-posts-locked className="flex flex-col">
        <div className="flex flex-col gap-6">
          {props.items.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              readOnly
              suppressCommunity
              captionTruncateAt={props.captionTruncateAt}
              locale={props.locale}
              labels={props.labels}
              onLike={refused}
              onUnlike={refused}
            />
          ))}
        </div>
      </section>
    );
  }
  const { locked: _unlocked, ...list } = props;
  return <FeedSurface {...list} suppressCommunity />;
}
