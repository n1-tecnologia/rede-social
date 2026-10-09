'use client';

import { FeedList, type FeedListProps, type PostMenuLabels } from '@rede-social/module-feed/ui';
import { useToast } from '@rede-social/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
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
 * It renders `FeedList` unchanged and adds no state, no branch and no label of its own — except the
 * 08.2-09 `community_locked` reaction (UI-D-376), which needs `useRouter` for the refresh.
 *
 * 04-09 adds a SECOND such thing for the same reason: the overflow menu's delete ends in a toast,
 * so the promise `PostMenu` awaits is composed here from the server action the registry passed in.
 */
/**
 * UI-D-376 (08.2-09): the ONE reaction to a feed action the API refused with `community_locked` —
 * the viewer lost access to the post's community mid-session (a revoke, or a product was just
 * linked). The caller has already reverted its optimistic state and closed any comment sheet; this
 * toasts "Esta comunidade agora é exclusiva…" and refreshes the route, so the post page lands on the
 * locked community page and Início, Reels and the community page re-render without the post (or as
 * the locked variant). No polling and no push: the refresh is the only re-read.
 *
 * Shared by every host of the feed actions (this surface, `PostDetail`, `ReelsHost`), so the
 * behaviour cannot drift between them; each passes the catalog's `feed.errors.communityLocked`.
 * `refresh: false` (2026-10-09) is the Reels overlay over a feed: it toasts only, because a refresh
 * would hand the list underneath a new first page and lose the place the member scrolled to.
 */
export function useCommunityLockedRefusal(
  message: string,
  { refresh = true }: { refresh?: boolean } = {},
): () => void {
  const toast = useToast();
  const router = useRouter();
  return useCallback(() => {
    toast.show({ tone: 'info', message });
    if (refresh) router.refresh();
  }, [message, toast, router, refresh]);
}

/** The like refusal's code read by every host: the locked reaction, or the generic toast. */
export function isCommunityLockedCode(code: string | undefined): boolean {
  return code === 'community_locked';
}

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

  const toast = useToast();
  const t = useTranslations();
  const locked = useCommunityLockedRefusal(t('feed.errors.communityLocked'));
  const genericError = share.error;
  // UI-D-376: the card has reverted and the list has closed the sheet; the code picks the toast.
  const onLikeError = useCallback(
    (code?: string) => {
      if (isCommunityLockedCode(code)) locked();
      else toast.show({ tone: 'error', message: genericError });
    },
    [locked, toast, genericError],
  );

  return (
    <FeedList
      {...list}
      onShare={onShare}
      menu={menu ? { labels: menu.labels, onDelete } : undefined}
      onLikeError={onLikeError}
      onCommentsLocked={locked}
    />
  );
}
