'use client';

import { type AdminIconId, Card } from '@rede-social/ui';
import { Fragment, type ReactNode, useCallback } from 'react';
import type { AttachmentDescriptor } from './AttachmentRow';
import { type LikeState, useOptimisticLike } from './LikeButton';
import type { LinkPreviewCardProps } from './LinkPreviewCard';
import { buildPostMeta, type CountTemplates, formatCountLabel } from './meta';
import { PostActions } from './PostActions';
import { PostCaption } from './PostCaption';
import { PostHeader } from './PostHeader';
import { PostMedia, type PostMediaImage, type PostMediaLabels } from './PostMedia';

/**
 * One post, ready to render. The module's UI is PRESENTATIONAL: it fetches nothing, formats no date
 * and resolves no URL — the host (`apps/web/lib/feed-view.tsx`) turns a `FeedPost` from the
 * contracts into this view, because only the host knows the tenant's time zone, the media URL shape
 * and the route table.
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
    /** 2026-10-06: the mark's accessible name when the author is an administrator; else absent. */
    adminLabel?: string | null;
    /** The icon the administrator picked (the crown when absent). */
    adminIcon?: AdminIconId;
  };
  createdAtIso: string;
  createdAtRelative: string;
  createdAtAbsolute: string;
  /**
   * D-71 — the "em {Comunidade}" segment of the header's meta row, already interpolated and already
   * routed by the host (`apps/web/lib/feed-view.tsx`). `null` is the tenant-wide post and renders
   * nothing; the community's own page suppresses it with `suppressCommunity` on the LIST, because
   * the whole list there shares one community and the label would restate the page (UI-D-36).
   */
  community?: { label: string; href: string; ariaLabel: string } | null;
  /**
   * `https://{primaryHost}/post/{id}` — composed on the SERVER from the tenant's VERIFIED primary
   * host (FEED-07, T-04-51). `null` wherever there is no such host to name (the platform and
   * generic shells), and the card then hands the share control no handler: an inert glyph is a far
   * better answer than a link carrying whichever alias origin the browser happened to be on.
   *
   * The card never BUILDS this and the module never reads a location of its own — this is the only
   * way a post URL reaches the UI at all.
   */
  shareUrl: string | null;
  /** UI-D-15: `edited_at` set by ANY persisted change, rendered as a marker with no date of its own. */
  edited: boolean;
  /**
   * FEED-03. The API's OWN answer to "may this viewer manage this post" — the same author predicate
   * `updatePost`/`softDeletePost` carry in their `where` clause — copied straight through and never
   * recomputed here by comparing ids. It selects the overflow menu's variant (04-09); it is not what
   * decides the outcome, which stays the API's predicate (the `canDelete` rule 04-07 set).
   */
  canManage: boolean;
  /** `/post/{id}/editar` when the viewer may edit it, else null. Built by the host (MOD-02). */
  editHref: string | null;
  likeCount: number;
  commentCount: number;
  viewerLiked: boolean;
  /** The card's accessible name, already interpolated by the host's catalog. */
  ariaLabel: string;
  media: PostCardMediaView;
  /**
   * UI-D-374 (08.2): set by the host's view builder for a locked community's SAMPLE (the feed's
   * `access: 'sample'`), so every surface that renders it — the community page, the post page —
   * gets the read-only card without a per-host flag. The `readOnly` prop, when given, wins.
   */
  readOnly?: boolean;
};

/**
 * What a like/unlike server action answers. The module models the refusal as a FLAG rather than a
 * message: the action returns a catalog key and the host owns the copy, so nothing server-controlled
 * reaches the DOM through this path (T-04-42).
 */
export type LikeOutcome =
  | { ok: true; liked: boolean; likeCount: number }
  /** `code` (08.2-09): the action's refusal code (`community_locked`), handed to `onLikeError`. */
  | { ok: false; code?: string };

/**
 * What the share control hands its host: the post it is on, and the already-composed url.
 *
 * The URL travels WITH the event rather than being looked up by the handler, so the share control
 * and 04-09's "copiar link" row cannot disagree about what they resolve to — there is one value and
 * both read it from the same view.
 */
export type PostShareTarget = { postId: string; url: string };

export type PostCardLabels = {
  /** The caption's "more" toggle. */
  more: string;
  like: string;
  unlike: string;
  comment: string;
  share: string;
  /** Accessible name of the overflow control; the menu itself is 04-09's. */
  moreOptions: string;
  likes: CountTemplates;
  comments: CountTemplates;
  edited: string;
  media: PostMediaLabels;
};

export type PostCardProps = {
  post: PostCardView;
  captionTruncateAt: number;
  /** BCP-47 tag from the host: the module formats numbers for it but ships no words (PWA-03). */
  locale: string;
  labels: PostCardLabels;
  onLike: (postId: string) => Promise<LikeOutcome>;
  onUnlike: (postId: string) => Promise<LikeOutcome>;
  /**
   * Raised after a failed toggle has already reverted — the widget shows the generic toast. `code`
   * (08.2-09) is the refusal's code when the action answered one (`community_locked`, UI-D-376).
   */
  onLikeError?: (code?: string) => void;
  onOpenComments?: (postId: string) => void;
  /** Fires only when the post HAS a share url; see `PostCardView.shareUrl`. */
  onShare?: (target: PostShareTarget) => void;
  onMore?: (postId: string) => void;
  /** UI-D-36: the community page passes this for EVERY card it renders (D-71's suppression). */
  suppressCommunity?: boolean;
  /**
   * UI-D-374 (08.2): the sample post of a locked community. The host sets it from the feed's
   * `access: 'sample'` marker. The like/comment/share row is NOT rendered (absent, not inert), the
   * meta segments become plain left-aligned text (the comment count is never a button), the gallery
   * gets no double-tap like and the "…" menu is absent. Media, caption, attachments and link
   * previews are untouched: the server already decided this post may be read.
   */
  readOnly?: boolean;
};

/**
 * `[proto]` `feed/PostCard.tsx` minus the mock hooks. The post is a FLAT full-bleed block (the REINE
 * timeline, 2026-10-02, over the Phase 4 rounded card): the shipped `Card` supplies the `bg-card`
 * surface and the `role`, with its 12px radius, shadow and dark hairline turned off, so the white
 * runs to both sides of the column and the page ground between posts does the separating. Media is
 * full-bleed inside it and text keeps the `px-4` inner gutter. Its host leaves no side gutter
 * around it (Início, the community page, the post page).
 *
 * **One toggle, three entry points.** The like button, the double tap on the gallery and the count
 * in the meta row all read and write the SAME optimistic state, because a double tap that took a
 * second code path would be a second request and a second row (FEED-04).
 *
 * **No clock is read here** (UI-D-14): the relative string, the absolute title and the ISO value all
 * arrive as props, already formatted on the server.
 */
export function PostCard({
  post,
  captionTruncateAt,
  locale,
  labels,
  onLike,
  onUnlike,
  onLikeError,
  onOpenComments,
  onShare,
  onMore,
  suppressCommunity,
  readOnly: readOnlyProp,
}: PostCardProps) {
  const readOnly = readOnlyProp ?? post.readOnly === true;
  // The refusal envelope becomes a rejection, which is the one signal the optimistic engine reverts
  // on — so a refused like and a failed request behave identically, as they must.
  const toggleRequest = useCallback(
    async (nextLiked: boolean): Promise<LikeState> => {
      const outcome = nextLiked ? await onLike(post.id) : await onUnlike(post.id);
      if (!outcome.ok) throw Object.assign(new Error('like_refused'), { code: outcome.code });
      return { liked: outcome.liked, likeCount: outcome.likeCount };
    },
    [onLike, onUnlike, post.id],
  );

  const { state, toggle, pulseKey } = useOptimisticLike({
    liked: post.viewerLiked,
    likeCount: post.likeCount,
    onToggle: toggleRequest,
    onError: onLikeError,
  });

  // A post with no share url hands the control NO handler: it stays present but inert (04-06's
  // "the action row is always present" contract), which is what "omit the affordance rather than
  // emit a link to the wrong origin" means for a row whose geometry is fixed at three controls.
  const shareUrl = post.shareUrl;
  const share = onShare;
  const shareTarget =
    share && shareUrl ? () => share({ postId: post.id, url: shareUrl }) : undefined;

  const likeLabel = formatCountLabel(state.likeCount, labels.likes, locale);
  const commentLabel = formatCountLabel(post.commentCount, labels.comments, locale);
  const segments = buildPostMeta({
    likeLabel,
    commentLabel,
    relativeTime: post.createdAtRelative,
    editedLabel: post.edited ? labels.edited : null,
  });

  return (
    // `role="article"` on the shipped `Card` surface rather than a nested `<article>`: the card IS
    // the post, and one element with an accessible name reads better than a div wrapping a landmark.
    // Flat: no radius, no shadow, no dark hairline (it would draw at the screen's edges).
    <Card
      role="article"
      aria-label={post.ariaLabel}
      className="rounded-none pb-1 shadow-none dark:border-0"
    >
      <PostHeader
        displayName={post.author.displayName}
        profileHref={post.author.profileHref}
        avatarUrl={post.author.avatarUrl}
        adminLabel={post.author.adminLabel}
        adminIcon={post.author.adminIcon}
        createdAtIso={post.createdAtIso}
        createdAtRelative={post.createdAtRelative}
        createdAtAbsolute={post.createdAtAbsolute}
        community={post.community ?? null}
        suppressCommunity={suppressCommunity}
        onMore={onMore && !readOnly ? () => onMore(post.id) : undefined}
        moreLabel={onMore && !readOnly ? labels.moreOptions : undefined}
      />
      <PostMedia
        mediaKind={post.media.mediaKind}
        images={post.media.images}
        video={post.media.video}
        attachments={post.media.attachments}
        linkPreview={post.media.linkPreview}
        onDoubleTapLike={readOnly ? undefined : toggle}
        labels={labels.media}
      />
      <PostCaption caption={post.caption} truncateAt={captionTruncateAt} moreLabel={labels.more} />

      {readOnly ? (
        // UI-D-374: the same row and gutter, no controls at all, the segments as plain text on the
        // left. The relative time stays a segment exactly as on the normal card (whose header also
        // shows it): the sample reads as an ordinary post with its controls taken away (sketch 008
        // finding 2, resolved in 08.2-09 by the UI-SPEC's own meta list and E08 "only the time").
        <div className="flex items-center gap-2 px-4 pt-2 pb-3">
          <div
            data-post-meta
            data-read-only
            className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs font-normal text-text-tertiary tabular-nums"
          >
            {segments.map((segment, index) => (
              <Fragment key={segment}>
                {index > 0 ? <span aria-hidden>·</span> : null}
                <span>{segment}</span>
              </Fragment>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 px-4 pt-2 pb-3">
          <PostActions
            liked={state.liked}
            countLabel={likeLabel}
            pulseKey={pulseKey}
            onToggleLike={toggle}
            onComment={onOpenComments ? () => onOpenComments(post.id) : undefined}
            onShare={shareTarget}
            labels={{
              like: labels.like,
              unlike: labels.unlike,
              comment: labels.comment,
              share: labels.share,
            }}
          />

          {/* Wraps rather than clips: at 320px an abbreviated four-digit count plus the edited marker
              has to stay readable, and a clipped number is a wrong number (UI-SPEC E02/overflow). */}
          <div
            data-post-meta
            className="flex min-w-0 flex-wrap items-center justify-end gap-x-1 text-xs font-normal text-text-tertiary tabular-nums"
          >
            {segments.map((segment, index) => (
              <Fragment key={segment}>
                {index > 0 ? <span aria-hidden>·</span> : null}
                {commentLabel !== null && segment === commentLabel && onOpenComments ? (
                  <button
                    type="button"
                    onClick={() => onOpenComments(post.id)}
                    className="font-bold text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    {segment}
                  </button>
                ) : (
                  <span>{segment}</span>
                )}
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
