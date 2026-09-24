'use client';

import { MediaImage } from '@tria/core/ui';
import { type CommentSheetProps, LikeButton, useOptimisticLike } from '@tria/module-feed/ui';
import {
  type StoryMediaControls,
  StoryViewer,
  type StoryViewerItem,
} from '@tria/module-stories/ui';
import { Avatar, IconButton, useToast } from '@tria/ui';
import { MessageCircle } from 'lucide-react';
import { useCallback, useMemo, useRef } from 'react';
import type { likeStoryAction, unlikeStoryAction } from '@/app/(app)/stories/story-actions';
import type {
  StoryViewerAuthorView,
  StoryViewerItemView,
  StoryViewerLabelsView,
} from '@/lib/story-view';
import { StoryVideo } from './StoryVideo';

/**
 * The app-tier shell around `StoryViewer` (05-06) — the `FeedSurface` split, one module later.
 *
 * **Why this file exists at all.** Three of the viewer's parts cannot live in a module: the
 * `LikeButton` belongs to `@tria/module-feed` and `turbo boundaries` denies a `module -> module`
 * package edge; the playback token comes from an app-scoped server action; and the failure toast
 * needs `useToast`, which is a hook a server component cannot hold. So the viewer takes the media
 * and the action row as NODES and this file builds them. Every decision that can be made on the
 * server still is: the sequence, the labels and the relative times all arrive as props.
 *
 * **The author row is the TENANT, and that is deliberate for V1.** `storySummarySchema` carries an
 * `authorUserId` and no profile — the strip never needed one — and in V1 only the tenant's admin
 * publishes, so the identity a member should read on a story is their organisation's. When V2 hands
 * publishing to members this becomes a per-story field on the payload rather than a prop here.
 *
 * **The playback token is never cached.** There is no `"use cache"`, no `unstable_cache` and no
 * `revalidate` in this file or in `StoryVideo`: the credential is minted when the viewer opens, for
 * the one element that asked, and never rides in the strip's payload (D-44, T-05-34).
 */

/**
 * Everything the shipped `CommentSheet` needs EXCEPT the three things only this component knows:
 * whether it is open, how to close it, and WHICH story it is showing.
 *
 * It is `Omit<CommentSheetProps, …>` rather than a restatement, so the sheet the story surface
 * renders and the sheet the feed renders cannot drift apart in their props either (D-82).
 */
export type StoryCommentsBinding = Omit<CommentSheetProps, 'open' | 'onClose' | 'targetId'>;

export type StoryViewerHostProps = {
  items: readonly StoryViewerItemView[];
  initialIndex?: number;
  author: StoryViewerAuthorView;
  labels: StoryViewerLabelsView;
  onLike: typeof likeStoryAction;
  onUnlike: typeof unlikeStoryAction;
  /**
   * D-82's comment surface. Absent means the affordance is drawn but inert — which is what 05-06
   * shipped, deliberately, rather than a handler that did nothing.
   */
  comments?: StoryCommentsBinding;
  /** Modal mode: the strip owns the history entry, so it also owns the dismissal. */
  onClose?: () => void;
  /** Page mode (a deep link or a refresh): where "close" navigates when there is nothing to pop. */
  closeHref?: string;
};

/** `Story {current} de {total}` and the two plural templates, resolved on the client. */
function fill(template: string, values: Record<string, number>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
}

export function StoryViewerHost({
  items,
  initialIndex = 0,
  author,
  labels,
  onLike,
  onUnlike,
  onClose,
  closeHref = '/inicio',
}: StoryViewerHostProps) {
  const toast = useToast();

  /** Set by `StoryVideo` while a video is mounted; the play badge calls it inside the gesture. */
  const playRef = useRef<(() => void) | null>(null);
  const bindPlay = useCallback((play: (() => void) | null) => {
    playRef.current = play;
  }, []);

  const close = useCallback(() => {
    if (onClose) {
      onClose();
      return;
    }
    // Page mode. `assign` rather than `router.push` so a member who landed here from outside the
    // app (a shared link, a notification) gets a real navigation to a screen that exists, instead
    // of a client-side push onto a history stack with nothing under it.
    window.location.assign(closeHref);
  }, [onClose, closeHref]);

  const viewerItems = useMemo<StoryViewerItem[]>(
    () =>
      items.map((item) => ({
        id: item.id,
        mediaKind: item.mediaKind,
        caption: item.caption,
        authorName: author.name,
        timeLabel: item.timeLabel,
        avatar: <Avatar src={author.avatarUrl} alt="" size="sm" />,
        onRequestPlay: () => playRef.current?.(),
        media: (controls: StoryMediaControls) =>
          item.mediaKind === 'video' ? (
            <StoryVideo assetId={item.mediaAssetId} controls={controls} onPlayRef={bindPlay} />
          ) : (
            <MediaImage
              assetId={item.mediaAssetId}
              widths={item.mediaVariantWidths}
              alt=""
              sizes="100vw"
              // The widest rung: the viewer is full-bleed, so the narrowest would be a blurred
              // story on every phone with a 3x screen.
              baseWidth={item.mediaVariantWidths[item.mediaVariantWidths.length - 1]}
              eager={controls.active}
              ratio=""
              fit="contain"
              className="h-full w-full bg-transparent"
              onReady={controls.onLoad}
              onFailed={controls.onError}
            />
          ),
        actions: (
          <StoryActions
            item={item}
            labels={labels}
            onLike={onLike}
            onUnlike={onUnlike}
            onError={() => toast.show({ message: labels.genericError, tone: 'error' })}
          />
        ),
      })),
    [items, author, labels, onLike, onUnlike, toast, bindPlay],
  );

  return (
    <StoryViewer
      items={viewerItems}
      initialIndex={initialIndex}
      onClose={close}
      labels={{
        dialog: labels.dialog,
        close: labels.close,
        mute: labels.mute,
        unmute: labels.unmute,
        previous: labels.previous,
        next: labels.next,
        play: labels.play,
        mediaError: labels.mediaError,
        retry: labels.retry,
        position: (current, total) => fill(labels.position, { current, total }),
      }}
    />
  );
}

/**
 * UI-D-32's bottom row: the SHIPPED `LikeButton` in its over-media variant, its count, and the
 * comment affordance — and **no share control** (STORY-05 does not include one).
 *
 * The like is the feed's engine verbatim, so the two like controls in the product reconcile the
 * same way: the value flips immediately, the server's authoritative `{ liked, likeCount }` replaces
 * it, and a rejection restores the exact pair that was on screen and raises the GENERIC toast —
 * never an inline message on a full-screen surface that has nowhere to put one.
 *
 * **There is no `DoubleTapHeart` here and there must not be one** (UI-D-31): a tap on this surface
 * already means "advance".
 */
function StoryActions({
  item,
  labels,
  onLike,
  onUnlike,
  onError,
}: {
  item: StoryViewerItemView;
  labels: StoryViewerLabelsView;
  onLike: typeof likeStoryAction;
  onUnlike: typeof unlikeStoryAction;
  onError: () => void;
}) {
  const { state, toggle, pulseKey } = useOptimisticLike({
    liked: item.viewerLiked,
    likeCount: item.likeCount,
    onToggle: async (nextLiked) => {
      const result = await (nextLiked ? onLike(item.id) : onUnlike(item.id));
      // A refusal REJECTS so the engine reverts; resolving would let a failed like stand.
      if (!result.ok) throw new Error('story_like_failed');
      return { liked: result.liked, likeCount: result.likeCount };
    },
    onError,
  });

  const likeLabel = plural(state.likeCount, labels.likesOne, labels.likesOther);
  const commentLabel = plural(item.commentCount, labels.commentsOne, labels.commentsOther);

  return (
    <>
      <span className="text-white [&_button]:text-white [&_svg]:size-5">
        <LikeButton
          liked={state.liked}
          countLabel={likeLabel}
          likeLabel={labels.like}
          unlikeLabel={labels.unlike}
          pulseKey={pulseKey}
          onToggle={toggle}
        />
      </span>
      {likeLabel === null ? null : (
        <span
          data-testid="story-like-count"
          className="mr-3 text-xs font-bold text-white tabular-nums"
        >
          {likeLabel}
        </span>
      )}
      {/* 05-07 binds the comment sheet to this control and feeds its open state back into the
          viewer's `externallyPaused`. Until then it is the affordance with no destination — which
          is why it carries no handler rather than a handler that does nothing. */}
      <IconButton
        icon={MessageCircle}
        size={20}
        label={labels.comment}
        className="text-white"
        disabled
      />
      {commentLabel === null ? null : (
        <span className="mr-3 text-xs font-bold text-white tabular-nums">{commentLabel}</span>
      )}
    </>
  );
}

/** Zero DROPS the segment entirely (UI-D-21, inherited) — the bare glyph is the whole control. */
function plural(count: number, one: string, other: string): string | null {
  if (count <= 0) return null;
  return fill(count === 1 ? one : other, { count });
}
