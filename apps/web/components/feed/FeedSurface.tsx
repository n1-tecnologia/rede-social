'use client';

import {
  FeedList,
  type FeedListProps,
  type FeedPageOutcome,
  type PostCardOverride,
  type PostMenuLabels,
} from '@rede-social/module-feed/ui';
import { useToast } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { deletePostAction } from '@/app/(app)/inicio/feed-actions';
import type { ReelInteractionReport } from '@/components/reels/ReelsHost';
import type { ReelsOverlayBinding } from '@/components/reels/ReelsOverlay';
import { useReelsOverlay } from '@/components/reels/useReelsOverlay';
import { isCommunityLockedCode, useCommunityLockedRefusal } from './community-locked';
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
 * It renders `FeedList` unchanged and adds no label of its own, and no branch except the 08.2-09
 * `community_locked` reaction (UI-D-376, `community-locked.ts`), which refreshes the route. The only
 * state it holds is the Reels overlay's (below).
 *
 * 04-09 adds a SECOND such thing for the same reason: the overflow menu's delete ends in a toast,
 * so the promise `PostMenu` awaits is composed here from the server action the registry passed in.
 *
 * **2026-10-09 adds the Reels overlay** (`useReelsOverlay`, the product owner's request reversing
 * D-124): with Reels on (`reels`, composed on the server), one tap on a video opens Reels OVER this
 * list at that video, and its return arrow closes it onto the same post at the same scroll position.
 * Besides the overlay itself, that needs two pieces of client state, kept here beside the list:
 *  - the cursor of the feed page that brought each post (`onLoadMore` is wrapped to record it; the
 *    server-rendered first page has none), so the overlay reads the Reels page from the same place
 *    in the same order (`?media=video` shares the feed's ordering and cursor);
 *  - what the member did in Reels (`overrides`, by post, ABSOLUTE, with a revision per report), which
 *    `FeedList` applies over its cards, so a like or a comment made there shows here on return;
 *  - both are dropped when the server hands a new first page (a refresh or a navigation), whose
 *    counts are the truth again.
 */
export type FeedSurfaceProps = Omit<
  FeedListProps,
  'onShare' | 'menu' | 'onOpenVideo' | 'itemOverrides'
> & {
  /**
   * 2026-10-09: the Reels overlay a single tap on a video opens, composed on the server
   * (`reelsOverlayProps`). `null` or absent when the tenant has no Reels: the tap keeps pausing.
   */
  reels?: ReelsOverlayBinding | null;
  /** The community whose page this list is: the overlay continues in its lane ("Todos" without). */
  communityId?: string;
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

export function FeedSurface({ share, menu, reels, communityId, ...list }: FeedSurfaceProps) {
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

  /** Post id → the cursor of the feed page that brought it; a first-page post has none. */
  const cursors = useRef(new Map<string, string>());
  /** Post id → what the member did to it in Reels (2026-10-09). */
  const [overrides, setOverrides] = useState<Record<string, PostCardOverride>>({});
  /** Never reset, so a new report always carries a revision the list has not seen. */
  const revision = useRef(0);

  // A new first page from the server (a navigation): its counts are the truth again, and its posts
  // were brought by no cursor. Adjusting state during render, the list's own re-seed rule.
  const [seed, setSeed] = useState(list.initialItems);
  if (seed !== list.initialItems) {
    setSeed(list.initialItems);
    setOverrides({});
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: a NEW first page is the trigger
  useEffect(() => {
    cursors.current.clear();
  }, [list.initialItems]);

  const { onLoadMore, onRefresh } = list;
  const loadMore = useCallback(
    async (cursor: string): Promise<FeedPageOutcome> => {
      const page = await onLoadMore(cursor);
      if (page.ok) for (const item of page.items) cursors.current.set(item.id, cursor);
      return page;
    },
    [onLoadMore],
  );
  const refresh = useCallback(async (): Promise<FeedPageOutcome> => {
    const page = await onRefresh();
    if (page.ok) {
      cursors.current.clear();
      setOverrides({});
    }
    return page;
  }, [onRefresh]);

  const onInteraction = useCallback((postId: string, shown: ReelInteractionReport) => {
    revision.current += 1;
    const next: PostCardOverride = { ...shown, revision: revision.current };
    setOverrides((map) => ({ ...map, [postId]: next }));
  }, []);

  const { open, overlay } = useReelsOverlay({
    reels,
    communityId: communityId ?? null,
    cursorOf: (postId) => cursors.current.get(postId) ?? null,
    onInteraction,
  });

  return (
    <>
      <FeedList
        {...list}
        onLoadMore={loadMore}
        onRefresh={refresh}
        onShare={onShare}
        menu={menu ? { labels: menu.labels, onDelete } : undefined}
        onLikeError={onLikeError}
        onCommentsLocked={locked}
        onOpenVideo={open}
        itemOverrides={overrides}
      />
      {overlay}
    </>
  );
}
