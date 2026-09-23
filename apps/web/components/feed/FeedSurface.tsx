'use client';

import { FeedList, type FeedListProps } from '@tria/module-feed/ui';
import { useSharePost } from './useSharePost';

/**
 * `/inicio`'s feed, with FEED-07's share handler bound (04-08).
 *
 * **Why this shell exists.** `lib/registry.tsx` composes the feed on the SERVER, and the share
 * handler is a hook — it needs `useToast` for the copied and the failed branches. A server
 * component cannot hold one, and the module must not own the branch table (that would put a
 * decision about what a share OUTCOME means inside a package that ships no language). So the
 * composition splits: every prop is still built on the server and passed straight through, and this
 * file adds exactly one thing — `onShare`.
 *
 * It renders `FeedList` unchanged and adds no state, no branch and no label of its own.
 */
export type FeedSurfaceProps = Omit<FeedListProps, 'onShare'> & {
  /**
   * `title` is the tenant's display name — the OS share sheet names the COMMUNITY, never a caption
   * (T-04-52). The two toast strings are the host's catalog, as every string in this app is.
   */
  share: { title: string; copied: string; error: string };
};

export function FeedSurface({ share, ...list }: FeedSurfaceProps) {
  const onShare = useSharePost(share.title, { copied: share.copied, error: share.error });
  return <FeedList {...list} onShare={onShare} />;
}
