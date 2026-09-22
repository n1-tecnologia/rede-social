import { EmptyState } from '@tria/ui';
import { Newspaper, TriangleAlert } from 'lucide-react';
import { PostCard, type PostCardView } from './PostCard';

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
  /** Rendered as the empty-state CTA when the caller may post AND the composer route exists. */
  createHref?: string;
  labels: {
    /** Accessible name of the widget's region. */
    region: string;
    /** The caption's "… mais" toggle. */
    more: string;
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

export function FeedList({ items, canPost, captionTruncateAt, createHref, labels }: FeedListProps) {
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
          moreLabel={labels.more}
        />
      ))}
    </section>
  );
}
