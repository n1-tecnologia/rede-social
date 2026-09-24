'use client';

import {
  CommentsList,
  type CommentsListProps,
  type LikeOutcome,
  PostCard,
  type PostCardLabels,
  type PostCardView,
  PostMenu,
  type PostMenuLabels,
} from '@tria/module-feed/ui';
import { useToast } from '@tria/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { deletePostAction } from '@/app/(app)/inicio/feed-actions';
import { useDeletePost } from './useDeletePost';
import { useSharePost } from './useSharePost';

/**
 * The body of `/post/[postId]` (D-56): the FULL `PostCard` — the identical component the feed
 * renders, never a "detail variant" — with the SAME `CommentsList` inline beneath it (D-59).
 *
 * **Why this client component exists at all.** The page is a server component and the card needs a
 * few things a server component cannot hand it: the generic toast a failed like raises
 * (`useToast` is a hook) and, from 04-08's share task, the four-branch share handler. Everything
 * else — the view, every label, every server action — is composed on the server and passed through
 * untouched, so this file decides nothing about what a post looks like.
 *
 * **The card is never withheld behind its comments** (UI-SPEC E10/E13 partial): the comment list
 * carries its own error and loading branches inside itself, so a comment page that failed renders
 * an inline retry WHERE THE ROWS WOULD BE and the post above it is unaffected.
 */
export type PostDetailProps = {
  post: PostCardView;
  captionTruncateAt: number;
  locale: string;
  labels: PostCardLabels;
  onLike: (postId: string) => Promise<LikeOutcome>;
  onUnlike: (postId: string) => Promise<LikeOutcome>;
  /** The one toast a failed like raises; never an inline message (UI-SPEC E09). */
  genericErrorLabel: string;
  /**
   * FEED-07. `title` is the tenant's display name: the OS share sheet names the COMMUNITY, never a
   * caption (T-04-52). The url itself rides `post.shareUrl`, composed on the server.
   */
  share: { title: string; copied: string };
  /**
   * FEED-03's overflow menu (04-09). The page hosts its own rather than reaching for `FeedList`'s:
   * there is ONE card here, and a delete has nowhere to leave a column from — it navigates back to
   * `/inicio`, because the screen the member is standing on has just stopped existing (UI-D-16).
   */
  menu: { labels: PostMenuLabels; deletedLabel: string; onDelete: typeof deletePostAction };
  comments: Omit<CommentsListProps, 'targetId' | 'variant'>;
};

export function PostDetail({
  post,
  captionTruncateAt,
  locale,
  labels,
  onLike,
  onUnlike,
  genericErrorLabel,
  share,
  menu,
  comments,
}: PostDetailProps) {
  const toast = useToast();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const onShare = useSharePost(share.title, {
    copied: share.copied,
    error: genericErrorLabel,
  });
  const deletePost = useDeletePost(menu.onDelete, {
    deleted: menu.deletedLabel,
    error: genericErrorLabel,
  });

  /**
   * The delete leaves the page only on a CONFIRMED removal: `useDeletePost` rejects on a refusal,
   * so the navigation below is unreachable unless the API really stamped the row. Staying put after
   * a refusal is the same "no optimistic removal" rule the feed column follows.
   */
  const confirmDelete = useCallback(
    async (postId: string) => {
      await deletePost(postId);
      router.push('/inicio');
    },
    [deletePost, router],
  );

  const failToast = useCallback(() => {
    toast.show({ tone: 'error', message: genericErrorLabel });
  }, [toast, genericErrorLabel]);

  return (
    <>
      <PostCard
        post={post}
        captionTruncateAt={captionTruncateAt}
        locale={locale}
        labels={labels}
        onLike={onLike}
        onUnlike={onUnlike}
        onLikeError={failToast}
        onShare={onShare}
        // The control renders only when the menu behind it would carry a row (04-06's rule): a
        // member on a shell with no share url has nothing to copy and nothing to manage.
        onMore={post.canManage || post.shareUrl ? () => setMenuOpen(true) : undefined}
      />
      <PostMenu
        open={menuOpen}
        target={{
          postId: post.id,
          shareUrl: post.shareUrl,
          canManage: post.canManage,
          editHref: post.editHref,
        }}
        onClose={() => setMenuOpen(false)}
        onSharePost={onShare}
        onDelete={confirmDelete}
        labels={menu.labels}
      />
      {/* No `onOpenComments` and no sheet: the comments ARE the screen below. Wiring the card's
          comment control to a second surface here would open a bottom sheet over a list the member
          is already looking at — D-59's one-implementation rule read literally. */}
      <CommentsList {...comments} targetId={post.id} variant="inline" />
    </>
  );
}
