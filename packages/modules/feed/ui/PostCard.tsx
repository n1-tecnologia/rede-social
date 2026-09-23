import { Card } from '@tria/ui';
import type { ReactNode } from 'react';
import type { AttachmentDescriptor } from './AttachmentRow';
import type { LinkPreviewCardProps } from './LinkPreviewCard';
import { PostCaption } from './PostCaption';
import { PostHeader } from './PostHeader';
import { PostMedia, type PostMediaImage, type PostMediaLabels } from './PostMedia';

/**
 * One post, ready to render. The module's UI is PRESENTATIONAL: it fetches nothing, formats no date
 * and resolves no URL — the host (`apps/web/lib/registry.tsx`) turns a `FeedPost` from the contracts
 * into this view, because only the host knows the tenant's time zone, the media URL shape and the
 * route table.
 *
 * D-51: there is no title and no type chip, so the largest type inside a card is its 16px caption.
 */
/**
 * The media band as the HOST has already resolved it (04-04): the discriminator the renderer
 * branches on, the gallery in `position` order, the attachment rows with their formatted sizes, and
 * — for the video branch only — the ALREADY-CREATED player element. The module cannot build that
 * element itself: `VideoPlayer` binds an app-scoped server action for its per-request playback token
 * (D-44), so it is injected rather than imported (MOD-02).
 */
export type PostCardMediaView = {
  mediaKind: 'none' | 'gallery' | 'video';
  images: PostMediaImage[];
  attachments: AttachmentDescriptor[];
  video?: ReactNode;
  /** MEDIA-04: present only for a RESOLVED preview — the host projects nothing else (UI-D-11). */
  linkPreview?: LinkPreviewCardProps;
};

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
  media: PostCardMediaView;
};

export type PostCardProps = {
  post: PostCardView;
  captionTruncateAt: number;
  moreLabel: string;
  /** The carousel role description and the attachment failure message (never literals here). */
  mediaLabels: PostMediaLabels;
};

/**
 * `[proto]` `feed/PostCard.tsx` minus `useBookmark`/`onSave` and the mock hooks. The shipped `Card`
 * supplies the surface (`bg-card`, 12px radius, the dark hairline), media is full-bleed inside it and
 * text keeps the `px-4` inner gutter.
 *
 * The action + meta row (likes, comments, share) is 04-03's; the media band is 04-04's and sits
 * between the header and the caption, full-bleed inside the card (UI-SPEC card anatomy).
 */
export function PostCard({ post, captionTruncateAt, moreLabel, mediaLabels }: PostCardProps) {
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
      <PostMedia
        mediaKind={post.media.mediaKind}
        images={post.media.images}
        video={post.media.video}
        attachments={post.media.attachments}
        linkPreview={post.media.linkPreview}
        labels={mediaLabels}
      />
      <PostCaption caption={post.caption} truncateAt={captionTruncateAt} moreLabel={moreLabel} />
    </Card>
  );
}
