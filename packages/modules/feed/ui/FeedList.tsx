'use client';

import { EmptyState } from '@tria/ui';
import { Newspaper, TriangleAlert } from 'lucide-react';
import type { CountTemplates } from './meta';
import { type LikeOutcome, PostCard, type PostCardView } from './PostCard';

/**
 * The D-55 home-slot widget: the feed is the main content of `/inicio`, below the branded welcome and
 * the D-02 nudge, and it adds NO navigation tab.
 *
 * Presentational only, the `ExampleWidget` posture: it fetches nothing, imports nothing from the
 * kernel server or db, and every string arrives as a prop so the module ships no language (PWA-03).
 * Authorisation also arrives as a prop — `canPost` is `bootstrap.permissions.includes(
 * 'feed.post.create')` computed server-side, never a role comparison here (FEED-08, R-P8).
 *
 * UI-D-20: an empty feed renders THIS card, not `HomeSlots`' "Em breve" — those are two different
 * truths ("the community has published nothing" vs "no module contributed anything") and must not
 * share one card. `items: null` is the load-error branch (UI-SPEC E4/error).
 *
 * Infinite scroll and pull-to-refresh (D-58) attach here in 04-02; the composer CTA's `createHref`
 * is supplied by 04-05 once `/criar` exists, which is why the slot is optional rather than a link to
 * a route that would 404 today.
 */
export type FeedListProps = {
  /** The page's posts, or `null` when the feed could not be read. */
  items: PostCardView[] | null;
  canPost: boolean;
  captionTruncateAt: number;
  /** BCP-47 tag from the host: the module formats numbers for it but ships no words (PWA-03). */
  locale: string;
  onLike: (postId: string) => Promise<LikeOutcome>;
  onUnlike: (postId: string) => Promise<LikeOutcome>;
  /** Raised after a failed like has already reverted; the host shows the generic error toast. */
  onLikeError?: () => void;
  onOpenComments?: (postId: string) => void;
  onShare?: (postId: string) => void;
  onMore?: (postId: string) => void;
  /** Rendered as the empty-state CTA when the caller may post AND the composer route exists. */
  createHref?: string;
  labels: {
    /** Accessible name of the widget's region. */
    region: string;
    /** The caption's "more" toggle. */
    more: string;
    /** The three action labels plus the overflow control's, all `aria-label`s. */
    like: string;
    unlike: string;
    comment: string;
    share: string;
    moreOptions: string;
    /** The meta row's count templates and the edited marker (UI-D-15, UI-D-21). */
    likes: CountTemplates;
    comments: CountTemplates;
    edited: string;
    /** `aria-roledescription` of the gallery strip — "carrossel" (UI-SPEC §Gallery). */
    carousel: string;
    /** The GENERIC message a failed attachment download raises as a toast (UI-D-23). */
    attachmentError: string;
    emptyTitle: string;
    /** Shown to a member: the community's posts will appear here. */
    emptyBody: string;
    /** Shown to someone who may publish: be the first. */
    emptyBodyAuthor: string;
    emptyCta: string;
    errorTitle: string;
    errorBody: string;
    errorRetry: string;
  };
};

export function FeedList({
  items,
  canPost,
  captionTruncateAt,
  createHref,
  locale,
  labels,
  onLike,
  onUnlike,
  onLikeError,
  onOpenComments,
  onShare,
  onMore,
}: FeedListProps) {
  if (items === null) {
    return (
      <section aria-label={labels.region}>
        <EmptyState
          variant="card"
          icon={TriangleAlert}
          title={labels.errorTitle}
          body={labels.errorBody}
          action={
            <a href="/inicio" className="text-sm font-bold text-brand">
              {labels.errorRetry}
            </a>
          }
        />
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section aria-label={labels.region}>
        <EmptyState
          variant="card"
          icon={Newspaper}
          title={labels.emptyTitle}
          body={canPost ? labels.emptyBodyAuthor : labels.emptyBody}
          action={
            canPost && createHref ? (
              <a href={createHref} className="text-sm font-bold text-brand">
                {labels.emptyCta}
              </a>
            ) : undefined
          }
        />
      </section>
    );
  }

  return (
    <section aria-label={labels.region} className="flex flex-col gap-3">
      {items.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          captionTruncateAt={captionTruncateAt}
          locale={locale}
          labels={{
            more: labels.more,
            like: labels.like,
            unlike: labels.unlike,
            comment: labels.comment,
            share: labels.share,
            moreOptions: labels.moreOptions,
            likes: labels.likes,
            comments: labels.comments,
            edited: labels.edited,
            media: { carousel: labels.carousel, attachmentError: labels.attachmentError },
          }}
          onLike={onLike}
          onUnlike={onUnlike}
          onLikeError={onLikeError}
          onOpenComments={onOpenComments}
          onShare={onShare}
          onMore={onMore}
        />
      ))}
    </section>
  );
}
