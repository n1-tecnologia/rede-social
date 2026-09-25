'use client';

import { MediaImage } from '@tria/core/ui';
import {
  CommentSheet,
  type CommentSheetProps,
  LikeButton,
  useOptimisticLike,
} from '@tria/module-feed/ui';
import {
  type StoryMediaControls,
  StoryViewer,
  type StoryViewerGroup,
  type StoryViewerItem,
} from '@tria/module-stories/ui';
import { Avatar, IconButton, useToast } from '@tria/ui';
import { MessageCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
 *
 * **D-82's comment sheet is composed here for the same boundary reason** (05-07): `CommentSheet`
 * belongs to `@tria/module-feed`, the viewer to `@tria/module-stories`, and a `module -> module`
 * package edge is denied. The viewer takes the sheet as an `overlay` NODE and its open state feeds
 * the `externallyPaused` prop 05-06 left wired and unfed — so "the story waits while you type" is
 * one prop at the composition point rather than a second pause mechanism.
 */

/**
 * Everything the shipped `CommentSheet` needs EXCEPT the three things only this component knows:
 * whether it is open, how to close it, and WHICH story it is showing.
 *
 * It is `Omit<CommentSheetProps, …>` rather than a restatement, so the sheet the story surface
 * renders and the sheet the feed renders cannot drift apart in their props either (D-82).
 */
export type StoryCommentsBinding = Omit<
  CommentSheetProps,
  'open' | 'onClose' | 'targetId' | 'variant' | 'onCountChange' | 'onDeleteComment'
> & {
  /**
   * The ONE handler whose shape differs from the feed's, because the route does:
   * `DELETE /v1/stories/{storyId}/comments/{commentId}` scopes the removal to the story as well as
   * to the member, so a comment id belonging to another story answers the same bare 404 instead of
   * being removed from a conversation nobody was looking at. This component binds the story it has
   * open, so the LIST still sees the `(commentId) => …` shape it expects and needs no branch.
   */
  onDeleteComment: (storyId: string, commentId: string) => Promise<{ ok: boolean }>;
};

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
  comments,
  onClose,
  closeHref = '/inicio',
}: StoryViewerHostProps) {
  const toast = useToast();

  /**
   * THE story whose comments are open, or null. It is the story ID rather than a boolean because
   * the sheet reads and writes THAT story's comments — and because `externallyPaused` is then
   * derived from it rather than tracked separately, which is one fewer thing to keep in step.
   */
  const [commentsFor, setCommentsFor] = useState<string | null>(null);

  /**
   * Per-story comment-count bumpers, registered by the action rows that own them.
   *
   * The alternative — holding the deltas in THIS component's state — would change the identity of
   * the memoised `viewerItems` array on every comment, which re-creates every media render function
   * and re-mounts the image the member is looking at while the sheet is open. Registering a setter
   * is the same shape `bindPlay` uses for the video's `play()` — neither is the other's exception.
   */
  const countBumpRef = useRef<Record<string, (delta: number) => void>>({});
  const bindCountBump = useCallback((storyId: string, bump: ((delta: number) => void) | null) => {
    if (bump) countBumpRef.current[storyId] = bump;
    else delete countBumpRef.current[storyId];
  }, []);

  /**
   * Per-story play callbacks, registered by the `StoryVideo` bridges that own them — the play badge
   * calls the CURRENT story's one, synchronously inside the member's gesture.
   *
   * **Keyed by story id, because the viewer mounts THREE of these at once.** `StoryViewer` renders a
   * 3-wide neighbour window (`Math.abs(k - index) <= 1`) as its pre-buffer, so with the middle story
   * active both neighbours are mounted and all three bridges register. A single unkeyed slot was
   * simply overwritten by whichever element attached LAST — and attach order follows token
   * resolution rather than screen position, so that was usually an offscreen neighbour: the badge
   * started a video the member could not see while the one in front of them stayed frozen. The same
   * slot was nulled by ANY bridge unmounting, so a neighbour leaving the window also cleared the
   * ACTIVE story's registration (CR-02).
   *
   * Deliberately byte-for-byte the shape `bindCountBump` uses above: the asymmetry between the two
   * WAS the bug, so the fix is the existing idiom rather than a second one. It stays a
   * `useCallback([], …)` because `StoryVideo`'s listener effect takes it as a dependency (WR-01) —
   * a fresh inline callback per render would be an unbounded attach/detach loop.
   */
  const playRefs = useRef<Record<string, () => void>>({});
  const bindPlay = useCallback((storyId: string, play: (() => void) | null) => {
    if (play) playRefs.current[storyId] = play;
    // Only the OWNER clears its own slot: a neighbour unmounting must not silence the active story.
    else delete playRefs.current[storyId];
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
        onRequestPlay: () => playRefs.current[item.id]?.(),
        media: (controls: StoryMediaControls) =>
          item.mediaKind === 'video' ? (
            <StoryVideo
              assetId={item.mediaAssetId}
              storyId={item.id}
              controls={controls}
              onPlayRef={bindPlay}
            />
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
            // Absent keeps the affordance INERT rather than giving it a handler that does nothing
            // — the posture 05-06 shipped it with, now with a destination.
            onOpenComments={comments ? () => setCommentsFor(item.id) : undefined}
            bindCountBump={bindCountBump}
          />
        ),
      })),
    [items, author, labels, onLike, onUnlike, toast, bindPlay, comments, bindCountBump],
  );

  /**
   * The viewer plays a ROW of groups (05.2-05); this host still hands it ONE sequence, so it is one
   * group whose header is the author — every caller behaves exactly as before.
   */
  const groups = useMemo<StoryViewerGroup[]>(
    () => [
      {
        key: 'sequence',
        items: viewerItems,
        header: { name: author.name, avatar: <Avatar src={author.avatarUrl} alt="" size="sm" /> },
      },
    ],
    [viewerItems, author],
  );

  return (
    <StoryViewer
      groups={groups}
      initialIndex={initialIndex}
      onClose={close}
      // The third source of the viewer's single pause boolean, beside the hold gesture and document
      // visibility. Closing it resumes from the STORED elapsed, because the clock never restarted.
      externallyPaused={commentsFor !== null}
      overlay={
        comments ? (
          <CommentSheet
            {...comments}
            variant="flat"
            open={commentsFor !== null}
            onClose={() => setCommentsFor(null)}
            onDeleteComment={(commentId) => comments.onDeleteComment(commentsFor ?? '', commentId)}
            // `''` is only ever read while the sheet is closed, and `BottomSheet` renders nothing
            // then — the list never mounts with an empty target.
            targetId={commentsFor ?? ''}
            onCountChange={(delta) => {
              if (commentsFor) countBumpRef.current[commentsFor]?.(delta);
            }}
          />
        ) : null
      }
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
        // One LOADED group: the loading and group-error frames are unreachable from this host, so
        // these two borrow the nearest existing copy until the host passes real groups.
        loadingGroup: labels.dialog,
        groupError: labels.mediaError,
        position: (_group, current, total) => fill(labels.position, { current, total }),
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
  onOpenComments,
  bindCountBump,
}: {
  item: StoryViewerItemView;
  labels: StoryViewerLabelsView;
  onLike: typeof likeStoryAction;
  onUnlike: typeof unlikeStoryAction;
  onError: () => void;
  onOpenComments?: () => void;
  bindCountBump: (storyId: string, bump: ((delta: number) => void) | null) => void;
}) {
  // The SERVER's count plus whatever this session has added or removed through the sheet. It is a
  // delta rather than an absolute so the count never claims to be authoritative: the next strip
  // read replaces it with the trigger-maintained column.
  const [commentDelta, setCommentDelta] = useState(0);
  useEffect(() => {
    bindCountBump(item.id, (delta) => setCommentDelta((value) => value + delta));
    return () => bindCountBump(item.id, null);
  }, [bindCountBump, item.id]);
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
  const commentLabel = plural(
    Math.max(0, item.commentCount + commentDelta),
    labels.commentsOne,
    labels.commentsOther,
  );

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
      {/* D-82. With no binding it stays INERT rather than carrying a handler that does nothing —
          the posture 05-06 shipped it with, and the 04-09 `createHref` rule. */}
      <IconButton
        icon={MessageCircle}
        size={20}
        label={labels.comment}
        className="text-white"
        disabled={!onOpenComments}
        onClick={onOpenComments}
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
