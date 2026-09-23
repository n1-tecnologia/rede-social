'use client';

import {
  CommentsList,
  type CommentsListProps,
  type LikeOutcome,
  PostCard,
  type PostCardLabels,
  type PostCardView,
} from '@tria/module-feed/ui';
import { useToast } from '@tria/ui';
import { useCallback } from 'react';

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
  comments: Omit<CommentsListProps, 'postId' | 'variant'>;
};

export function PostDetail({
  post,
  captionTruncateAt,
  locale,
  labels,
  onLike,
  onUnlike,
  genericErrorLabel,
  comments,
}: PostDetailProps) {
  const toast = useToast();

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
      />
      {/* No `onOpenComments` and no sheet: the comments ARE the screen below. Wiring the card's
          comment control to a second surface here would open a bottom sheet over a list the member
          is already looking at — D-59's one-implementation rule read literally. */}
      <CommentsList {...comments} postId={post.id} variant="inline" />
    </>
  );
}
