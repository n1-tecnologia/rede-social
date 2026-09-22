import { Card } from '@tria/ui';
import { PostCaption } from './PostCaption';
import { PostHeader } from './PostHeader';

/**
 * One post, ready to render. The module's UI is PRESENTATIONAL: it fetches nothing, formats no date
 * and resolves no URL — the host (`apps/web/lib/registry.tsx`) turns a `FeedPost` from the contracts
 * into this view, because only the host knows the tenant's time zone, the media URL shape and the
 * route table.
 *
 * D-51: there is no title and no type chip, so the largest type inside a card is its 16px caption.
 */
export type PostCardView = {
  id: string;
  caption: string;
  author: {
    displayName: string;
    /** `/membros/{membershipId}` (D-52). */
    profileHref: string;
    avatarUrl: string | null;
  };
  createdAtIso: string;
  createdAtRelative: string;
  createdAtAbsolute: string;
  /** The card's accessible name, already interpolated by the host's catalog. */
  ariaLabel: string;
};

export type PostCardProps = {
  post: PostCardView;
  captionTruncateAt: number;
  moreLabel: string;
};

/**
 * `[proto]` `feed/PostCard.tsx` minus `useBookmark`/`onSave` and the mock hooks. The shipped `Card`
 * supplies the surface (`bg-card`, 12px radius, the dark hairline), media is full-bleed inside it and
 * text keeps the `px-4` inner gutter.
 *
 * The action + meta row (likes, comments, share) is 04-03's; the media band is 04-04's. Both land
 * between the header and the caption without changing this component's contract.
 */
export function PostCard({ post, captionTruncateAt, moreLabel }: PostCardProps) {
  return (
    // `role="article"` on the shipped `Card` surface rather than a nested `<article>`: the card IS
    // the post, and one element with an accessible name reads better than a div wrapping a landmark.
    <Card role="article" aria-label={post.ariaLabel} className="pb-3">
      <PostHeader
        displayName={post.author.displayName}
        profileHref={post.author.profileHref}
        avatarUrl={post.author.avatarUrl}
        createdAtIso={post.createdAtIso}
        createdAtRelative={post.createdAtRelative}
        createdAtAbsolute={post.createdAtAbsolute}
      />
      <PostCaption caption={post.caption} truncateAt={captionTruncateAt} moreLabel={moreLabel} />
    </Card>
  );
}
