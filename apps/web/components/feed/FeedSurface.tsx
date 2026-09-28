'use client';

import { FeedList, type FeedListProps, type PostMenuLabels } from '@rede-social/module-feed/ui';
import type { deletePostAction } from '@/app/(app)/inicio/feed-actions';
import { useDeletePost } from './useDeletePost';
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
 *
 * 04-09 adds a SECOND such thing for the same reason: the overflow menu's delete ends in a toast,
 * so the promise `PostMenu` awaits is composed here from the server action the registry passed in.
 */
export type FeedSurfaceProps = Omit<FeedListProps, 'onShare' | 'menu'> & {
  /**
   * `title` is the tenant's display name — the OS share sheet names the COMMUNITY, never a caption
   * (T-04-52). The two toast strings are the host's catalog, as every string in this app is.
   */
  share: { title: string; copied: string; error: string };
  /**
   * FEED-03's menu. Every DECISION still arrives from the server — the label block, the success
   * toast's copy and the action itself — and this shell only binds them to `useToast`.
   */
  menu?: {
    labels: PostMenuLabels;
    deletedLabel: string;
    onDelete: typeof deletePostAction;
  };
};

/**
 * The hook below must be called unconditionally (rules of hooks), and a surface rendered without a
 * menu has no action to bind — this stands in and is never reachable, because `menu` being absent
 * is also what stops `FeedList` from rendering the menu at all.
 */
const noDelete = async () => ({ ok: false, code: 'generic' }) as const;

export function FeedSurface({ share, menu, ...list }: FeedSurfaceProps) {
  const onShare = useSharePost(share.title, { copied: share.copied, error: share.error });
  const onDelete = useDeletePost(menu?.onDelete ?? noDelete, {
    deleted: menu?.deletedLabel ?? '',
    error: share.error,
  });

  return (
    <FeedList
      {...list}
      onShare={onShare}
      menu={menu ? { labels: menu.labels, onDelete } : undefined}
    />
  );
}
