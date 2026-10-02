'use client';

import { MediaImage } from '@rede-social/core/ui';
import {
  type CommentDeleteOutcome,
  CommentSheet,
  type CommentSheetProps,
  LikeButton,
  useOptimisticLike,
} from '@rede-social/module-feed/ui';
import { STORY_HIGHLIGHT_MAX_ITEMS } from '@rede-social/module-stories/contracts';
import {
  HighlightSheet,
  type HighlightSheetPlace,
  type StoryMediaControls,
  StoryMonogram,
  StoryViewer,
  type StoryViewerGroup,
  type StoryViewerItem,
} from '@rede-social/module-stories/ui';
import { Avatar, IconButton, useToast } from '@rede-social/ui';
import { BookmarkPlus, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addStoryToHighlightAction,
  loadHighlightSheetAction,
  removeStoryFromHighlightAction,
} from '@/app/(app)/stories/highlight-actions';
import type { likeStoryAction, unlikeStoryAction } from '@/app/(app)/stories/story-actions';
import type {
  HighlightPlaceView,
  StoryGroupView,
  StoryViewerItemView,
  StoryViewerLabelsView,
} from '@/lib/story-view';
import { StoryVideo } from './StoryVideo';

/**
 * The app-tier shell around `StoryViewer` (05-06) — the `FeedSurface` split, one module later.
 *
 * **Why this file exists at all.** Three of the viewer's parts cannot live in a module: the
 * `LikeButton` belongs to `@rede-social/module-feed` and `turbo boundaries` denies a `module -> module`
 * package edge; the playback token comes from an app-scoped server action; and the failure toast
 * needs `useToast`, which is a hook a server component cannot hold. So the viewer takes the media
 * and the action row as NODES and this file builds them. Every decision that can be made on the
 * server still is: the sequence, the labels and the relative times all arrive as props.
 *
 * **The header is the GROUP's identity** (05.2-05, UI-D-65). The viewer plays a row of groups, and
 * every story in a group is headed by that group's name and disc: the TENANT (display name over its
 * logo) for Início's tenant circle, the community pinned row and a deep link — deliberate for V1,
 * where only the tenant's admin publishes and `storySummarySchema` carries no author profile — and
 * the highlight's TITLE over its cover for a highlight. When V2 hands publishing to members this
 * becomes a per-story field on the payload.
 *
 * **Every per-segment registry is keyed `${group.key}:${story.id}`** (Pitfall 4): the same story can
 * be mounted twice at a group boundary (the tenant group's last story and a highlight's first), and
 * a registry keyed by story id alone would let one copy's unmount clear the other's play callback.
 *
 * **The playback token is never cached.** There is no `"use cache"`, no `unstable_cache` and no
 * `revalidate` in this file or in `StoryVideo`: the credential is minted when the viewer opens, for
 * the one element that asked, and never rides in the strip's payload (D-44, T-05-34).
 *
 * **D-82's comment sheet is composed here for the same boundary reason** (05-07): `CommentSheet`
 * belongs to `@rede-social/module-feed`, the viewer to `@rede-social/module-stories`, and a `module -> module`
 * package edge is denied. The viewer takes the sheet as an `overlay` NODE and its open state feeds
 * the `externallyPaused` prop 05-06 left wired and unfed — so "the story waits while you type" is
 * one prop at the composition point rather than a second pause mechanism.
 *
 * **"Destacar" is D-110's first door** (05.2-06, UI-D-66). A curator — `canCurate`, which every
 * caller computes from the bootstrap's `stories.story.manage` PERMISSION, never a role — gets a
 * labelled pill at the end of every story's action row; members never get the node. Tapping it
 * reads the CURRENT story's sheet in one server action (catalogue, memberships and place names,
 * composed on the server) and opens the module's `HighlightSheet` in checklist mode as a second
 * overlay beside the comment sheet. The clock stays paused from the tap until the sheet closes (the
 * D-82 rule, fed through the same `externallyPaused`), and each switch is one immediate write with
 * `revalidate: false` — re-rendering `/inicio` behind an open viewer would rebuild the row under the
 * curator's finger (the like-action rule). The API's literal `requirePermission` is the boundary;
 * this gate is UX (T-05.2-26). The sheet's words are read here with `useTranslations('stories')`,
 * so the three composition points pass only `canCurate`.
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
  onDeleteComment: (storyId: string, commentId: string) => Promise<CommentDeleteOutcome>;
};

/** A group as the host receives it: the server's view plus the client's own "the read failed". */
export type StoryGroupState = StoryGroupView & { failed?: boolean };

export type StoryViewerHostProps = {
  /**
   * The row, in circle order. A single-sequence caller (a deep link, the community pinned row)
   * passes ONE group; Início passes its tenant group and one lazily-loaded group per highlight.
   */
  groups: readonly StoryGroupState[];
  initialGroup?: number;
  initialIndex?: number;
  /** The viewer needs group `g`'s items (entering it, or the prefetch). The caller dedupes. */
  onNeedGroup?: (group: number) => void;
  /** The retry in a failed group's error frame. */
  onRetryGroup?: (group: number) => void;
  /**
   * 05.2-10 (R-D-I): the viewer SHOWED this story in this group — current segment, media ready.
   * `StoriesSurface` turns it into the session seen set and the buffered seen write.
   */
  onSegmentShown?: (storyId: string, groupKey: string) => void;
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
  /**
   * `stories.story.manage` from the bootstrap (a permission, never a role): the "Destacar" pill and
   * its sheet exist only when true (UI-D-66). Absent is false.
   */
  canCurate?: boolean;
  /**
   * The community whose page opened this viewer; absent/null = Início or a deep link. It only
   * chooses where the empty highlight sheet's "Criar destaque" goes (05.2-UI-REVIEW warning 2):
   * that community's manage screen, else `/stories/destaques`.
   */
  originCommunityId?: string | null;
};

/**
 * The highlight sheet's state. `target` is the story the curator tapped "Destacar" on — set from
 * the tap until the sheet closes, so the clock is paused through the read too, and the sheet always
 * describes the story it was opened for. `sheet` is the last composed read; it OUTLIVES the close so
 * the sheet's exit animation keeps its rows instead of flashing the empty state.
 */
type HighlightTarget = { storyId: string };
type HighlightSheetState = {
  storyId: string;
  places: HighlightPlaceView[];
  selectedIds: string[];
  open: boolean;
};

/** `{group}: story {current} de {total}` and the two plural templates, resolved on the client. */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
}

/**
 * A group's header disc at the viewer's avatar slot (32px): the shipped `Avatar` for the tenant
 * (unchanged since 05-06), the highlight's cover through `MediaImage` BY ASSET ID (no URL is built
 * from tenant content, T-05.2-21), or the one monogram shape (UI-D-62).
 */
function groupAvatar(avatar: StoryGroupView['avatar']): ReactNode {
  switch (avatar.kind) {
    case 'avatar':
    case 'logo':
      return <Avatar src={avatar.src} alt="" size="sm" />;
    case 'monogram':
      return <StoryMonogram text={avatar.text} size={32} />;
    case 'asset':
      return (
        <span className="block h-8 w-8 shrink-0 overflow-hidden rounded-full bg-bg-tertiary">
          <MediaImage
            assetId={avatar.assetId}
            widths={avatar.variantWidths}
            alt=""
            sizes="32px"
            ratio="aspect-square"
            className="h-8 w-8 rounded-full object-cover"
          />
        </span>
      );
  }
}

export function StoryViewerHost({
  groups,
  initialGroup = 0,
  initialIndex = 0,
  onNeedGroup,
  onRetryGroup,
  onSegmentShown,
  labels,
  onLike,
  onUnlike,
  comments,
  onClose,
  closeHref = '/inicio',
  canCurate = false,
  originCommunityId = null,
}: StoryViewerHostProps) {
  const toast = useToast();
  const t = useTranslations('stories');

  /**
   * THE story whose comments are open, or null. It names the story rather than being a boolean
   * because the sheet reads and writes THAT story's comments — and because `externallyPaused` is
   * then derived from it rather than tracked separately, which is one fewer thing to keep in step.
   * The SEGMENT rides along so the count bump reaches the copy the member is looking at.
   */
  const [commentsFor, setCommentsFor] = useState<{ storyId: string; segment: string } | null>(null);

  /**
   * Per-story comment-count bumpers, registered by the action rows that own them.
   *
   * The alternative — holding the deltas in THIS component's state — would change the identity of
   * the memoised `viewerItems` array on every comment, which re-creates every media render function
   * and re-mounts the image the member is looking at while the sheet is open. Registering a setter
   * is the same shape `bindPlay` uses for the video's `play()` — neither is the other's exception.
   */
  const countBumpRef = useRef<Record<string, (delta: number) => void>>({});
  const bindCountBump = useCallback((segment: string, bump: ((delta: number) => void) | null) => {
    if (bump) countBumpRef.current[segment] = bump;
    else delete countBumpRef.current[segment];
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
  const bindPlay = useCallback((segment: string, play: (() => void) | null) => {
    if (play) playRefs.current[segment] = play;
    // Only the OWNER clears its own slot: a neighbour unmounting must not silence the active story.
    else delete playRefs.current[segment];
  }, []);

  /**
   * `StoryVideo` registers under its STORY id; the registry is keyed by SEGMENT (Pitfall 4). One
   * binder per segment bridges the two, cached for the host's life so its identity is as stable as
   * `bindPlay`'s — `StoryVideo`'s listener effect takes it as a dependency (WR-01).
   */
  const segmentBinders = useRef(
    new Map<string, (storyId: string, play: (() => void) | null) => void>(),
  );
  const bindPlayFor = useCallback(
    (segment: string) => {
      const cached = segmentBinders.current.get(segment);
      if (cached) return cached;
      const binder = (_storyId: string, play: (() => void) | null) => bindPlay(segment, play);
      segmentBinders.current.set(segment, binder);
      return binder;
    },
    [bindPlay],
  );

  /**
   * D-110 route 1. `highlightFor` is non-null from the tap until the sheet closes — the pause source
   * `externallyPaused` reads — and a second tap while the read is in flight is a no-op.
   */
  const [highlightFor, setHighlightFor] = useState<HighlightTarget | null>(null);
  const [highlightSheet, setHighlightSheet] = useState<HighlightSheetState | null>(null);
  const highlightReading = useRef(false);
  const genericError = labels.genericError;

  const openHighlight = useCallback(
    async (storyId: string) => {
      if (highlightReading.current) return;
      highlightReading.current = true;
      setHighlightFor({ storyId });
      let opened = false;
      try {
        const result = await loadHighlightSheetAction(storyId);
        if (result.ok) {
          setHighlightSheet({
            storyId,
            places: result.places,
            selectedIds: result.selectedIds,
            open: true,
          });
          opened = true;
        }
      } catch {
        // The same answer as `{ ok: false }`: nothing opens and the generic toast says so.
      } finally {
        highlightReading.current = false;
      }
      if (!opened) {
        setHighlightFor(null);
        toast.show({ tone: 'error', message: genericError });
      }
    },
    [toast, genericError],
  );

  // STABLE: `BottomSheet`'s focus trap re-arms (and refocuses) whenever its `onClose` identity changes.
  const closeHighlight = useCallback(() => {
    setHighlightSheet((current) => (current ? { ...current, open: false } : current));
    setHighlightFor(null);
  }, []);

  const highlightStoryId = highlightSheet?.storyId ?? null;
  const toggleHighlight = useCallback(
    async (highlightId: string, next: boolean, place: HighlightSheetPlace): Promise<boolean> => {
      if (highlightStoryId === null) return false;
      const write = next ? addStoryToHighlightAction : removeStoryFromHighlightAction;
      let result: Awaited<ReturnType<typeof write>>;
      try {
        // `revalidate: false` — the viewer never re-renders the row under an open viewer.
        result = await write(highlightStoryId, highlightId, {
          communityId: place.communityId,
          revalidate: false,
        });
      } catch {
        result = { ok: false, code: 'generic' };
      }
      if (result.ok) {
        toast.show({
          tone: 'success',
          message: t(next ? 'highlights.toasts.added' : 'highlights.toasts.removed'),
        });
        return true;
      }
      toast.show({
        tone: 'error',
        message:
          result.code === 'archived'
            ? t('highlights.errors.archived')
            : result.code === 'full'
              ? t('highlights.errors.full', { limit: STORY_HIGHLIGHT_MAX_ITEMS })
              : t('highlights.errors.generic'),
      });
      // `false` is what makes the sheet's machine REVERT the switch in place.
      return false;
    },
    [highlightStoryId, toast, t],
  );

  /** A plain string, so `buildItem` does not change identity with the translator. */
  const highlightLabel = canCurate ? t('viewer.highlight') : null;

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

  /** One story of one group, as the viewer plays it. Every registry key is the SEGMENT's. */
  const buildItem = useCallback(
    (group: StoryGroupState, header: ReactNode, item: StoryViewerItemView): StoryViewerItem => {
      const segment = `${group.key}:${item.id}`;
      return {
        id: item.id,
        mediaKind: item.mediaKind,
        caption: item.caption,
        authorName: group.name,
        timeLabel: item.timeLabel,
        avatar: header,
        onRequestPlay: () => playRefs.current[segment]?.(),
        media: (controls: StoryMediaControls) =>
          item.mediaKind === 'video' ? (
            <StoryVideo
              assetId={item.mediaAssetId}
              storyId={item.id}
              controls={controls}
              onPlayRef={bindPlayFor(segment)}
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
            segment={segment}
            labels={labels}
            onLike={onLike}
            onUnlike={onUnlike}
            onError={() => toast.show({ message: labels.genericError, tone: 'error' })}
            // Absent keeps the affordance INERT rather than giving it a handler that does nothing
            // — the posture 05-06 shipped it with, now with a destination.
            onOpenComments={
              comments ? () => setCommentsFor({ storyId: item.id, segment }) : undefined
            }
            bindCountBump={bindCountBump}
            // UI-D-66: the node exists only for a curator. Members never get it.
            highlightLabel={highlightLabel ?? undefined}
            onHighlight={highlightLabel === null ? undefined : () => void openHighlight(item.id)}
          />
        ),
      };
    },
    [
      labels,
      onLike,
      onUnlike,
      toast,
      bindPlayFor,
      comments,
      bindCountBump,
      highlightLabel,
      openHighlight,
    ],
  );

  /**
   * The viewer's groups, built ONCE per group object: a group that did not change keeps its item
   * array, so a highlight loading elsewhere in the row never re-creates the media functions of the
   * story the member is watching. The cache resets when the builder does.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `buildItem` is the cache's KEY, not an input — a new builder must start a new cache
  const built = useMemo(() => new WeakMap<StoryGroupState, StoryViewerGroup>(), [buildItem]);
  const viewerGroups = useMemo<StoryViewerGroup[]>(
    () =>
      groups.map((group) => {
        const cached = built.get(group);
        if (cached) return cached;
        const header = groupAvatar(group.avatar);
        const next: StoryViewerGroup = {
          key: group.key,
          items: group.items ? group.items.map((item) => buildItem(group, header, item)) : null,
          failed: group.failed === true,
          header: { name: group.name, avatar: header },
        };
        built.set(group, next);
        return next;
      }),
    [groups, built, buildItem],
  );

  return (
    <StoryViewer
      groups={viewerGroups}
      initialGroup={initialGroup}
      initialIndex={initialIndex}
      onNeedGroup={onNeedGroup}
      onRetryGroup={onRetryGroup}
      onSegmentShown={onSegmentShown}
      onClose={close}
      // The third source of the viewer's single pause boolean, beside the hold gesture and document
      // visibility. Closing it resumes from the STORED elapsed, because the clock never restarted.
      // D-82, twice: the comment sheet and the highlight sheet (from the tap until it closes).
      externallyPaused={commentsFor !== null || highlightFor !== null}
      overlay={
        <>
          {comments ? (
            <CommentSheet
              {...comments}
              variant="flat"
              open={commentsFor !== null}
              onClose={() => setCommentsFor(null)}
              onDeleteComment={(commentId) =>
                comments.onDeleteComment(commentsFor?.storyId ?? '', commentId)
              }
              // `''` is only ever read while the sheet is closed, and `BottomSheet` renders nothing
              // then — the list never mounts with an empty target.
              targetId={commentsFor?.storyId ?? ''}
              onCountChange={(delta) => {
                if (commentsFor) countBumpRef.current[commentsFor.segment]?.(delta);
              }}
            />
          ) : null}
          {canCurate && highlightSheet ? (
            <HighlightSheet
              mode="checklist"
              open={highlightSheet.open}
              onClose={closeHighlight}
              title={t('highlights.sheet.title')}
              helper={t('highlights.sheet.helper')}
              places={highlightSheet.places}
              selectedIds={highlightSheet.selectedIds}
              rowLabel={(row, place) =>
                t('highlights.sheet.row', { title: row.title, place: place.label })
              }
              onToggle={toggleHighlight}
              empty={
                // UI-D-67 empty: no highlight anywhere. Curation has ONE door (D-109), so the CTA
                // leaves for the manage screen rather than creating inline — the one of the PLACE
                // the viewer was opened from (05.2-UI-REVIEW warning 2): a community page's own
                // manage screen, else Início's. A client-side `Link`, not a full reload.
                <div className="flex flex-col items-start gap-2 py-4">
                  <p className="text-sm font-normal text-text-secondary">
                    {t('highlights.sheet.emptyTitle')}
                  </p>
                  <p className="text-sm font-normal text-text-tertiary">
                    {t('highlights.sheet.emptyBody')}
                  </p>
                  <Link
                    href={
                      originCommunityId
                        ? `/comunidades/${originCommunityId}/destaques`
                        : '/stories/destaques'
                    }
                    className="rounded text-sm font-bold text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    {t('highlights.sheet.emptyCta')}
                  </Link>
                </div>
              }
            />
          ) : null}
        </>
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
        loadingGroup: labels.loadingGroup,
        groupError: labels.groupError,
        position: (group, current, total) => fill(labels.positionGroup, { group, current, total }),
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
  segment,
  labels,
  onLike,
  onUnlike,
  onError,
  onOpenComments,
  bindCountBump,
  highlightLabel,
  onHighlight,
}: {
  item: StoryViewerItemView;
  /** `${group.key}:${story.id}` — the count bump is registered per segment (Pitfall 4). */
  segment: string;
  labels: StoryViewerLabelsView;
  onLike: typeof likeStoryAction;
  onUnlike: typeof unlikeStoryAction;
  onError: () => void;
  onOpenComments?: () => void;
  bindCountBump: (segment: string, bump: ((delta: number) => void) | null) => void;
  /** UI-D-66: present only for a curator. */
  highlightLabel?: string;
  onHighlight?: () => void;
}) {
  // The SERVER's count plus whatever this session has added or removed through the sheet. It is a
  // delta rather than an absolute so the count never claims to be authoritative: the next strip
  // read replaces it with the trigger-maintained column.
  const [commentDelta, setCommentDelta] = useState(0);
  useEffect(() => {
    bindCountBump(segment, (delta) => setCommentDelta((value) => value + delta));
    return () => bindCountBump(segment, null);
  }, [bindCountBump, segment]);
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
      {/* UI-D-66: a LABELLED pill at the right end of the row, out of the like/comment grammar. Its
          ground is the mute toggle's `bg-black/35`, so no brand ink enters the viewer (UI-D-39). */}
      {onHighlight && highlightLabel ? (
        <button
          type="button"
          onClick={onHighlight}
          className="ml-auto inline-flex h-11 items-center gap-2 rounded-full bg-black/35 px-4 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <BookmarkPlus aria-hidden size={16} />
          {highlightLabel}
        </button>
      ) : null}
    </>
  );
}

/** Zero DROPS the segment entirely (UI-D-21, inherited) — the bare glyph is the whole control. */
function plural(count: number, one: string, other: string): string | null {
  if (count <= 0) return null;
  return fill(count === 1 ? one : other, { count });
}
