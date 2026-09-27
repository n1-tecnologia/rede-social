'use client';

import {
  type CountTemplates,
  LikeButton,
  type LikeOutcome,
  type LikeState,
  linkify,
  type PostShareTarget,
  useOptimisticLike,
} from '@tria/module-feed/ui';
import { compactCount, ReelCaption, ReelRail } from '@tria/module-reels/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReelView } from '@/lib/reels';
import { announcedCount } from '@/lib/reels-count';

/**
 * One Reel's actions (05.3-08, REELS-07, D-128..D-131, UI-D-87, UI-D-88, UI-D-91) — the rail and the
 * caption block over ONE page, with that page's like engine.
 *
 * **The feed's own like** (D-128). The engine is the feed card's, fed the feed's server actions, so
 * a like here is the same like Início shows on the same post: optimistic, then the server's pair,
 * and a refusal reverts and raises the generic toast (UI-D-93d). The rail's heart and the page's
 * double tap share this ONE engine, so there is one request in flight per page.
 *
 * **The settled pair is the host's, not this page's** (CR-01). The pager unmounts this component
 * whenever its page leaves the ±1 window, so the engine here is only the in-flight optimistic
 * layer: `onLike`/`onUnlike` are the host's wrappers, which record the server's pair in the host's
 * per-post map, and `view` arrives already carrying that pair. A remounted page therefore starts
 * from the last known state, and the heart and the double tap act on it. The engine's re-seed on a
 * changed seed (`useOptimisticLike`) is a no-op on a page that stays mounted, because the host
 * records the same pair the engine has just accepted.
 *
 * **The binder.** The pager's double tap reaches the host, not this component, so the page
 * registers a binder through `bind` that carries ONLY the like-only double tap: `likeOnly` calls
 * the engine's toggle ONLY while the post is not liked — a double tap never unlikes. The binder
 * reads refs, so it always sees the latest state without re-registering on every render. The
 * comment count is not this page's: it is the host's per-post value (CR-01), already merged into
 * `view`, so it outlives the page and a lane change.
 *
 * **Share** (D-130, UI-D-91) is offered only when the server composed a `shareUrl` from the verified
 * primary host (FEED-07, T-04-51); the host's handler owns the result table. The video does not
 * pause for it.
 *
 * **The caption** goes through the feed's one `linkify` sink (D-54, T-05.3-21). Its expansion is
 * per page, resets when the page stops being current, and never pauses the video (D-131).
 *
 * The client-safe `announcedCount` is imported from `lib/reels-count`: `lib/reels` reaches the
 * server-only API client.
 */

export type ReelOverlayLabels = {
  /** RAW "Ver o perfil de {name}". */
  railAuthor: string;
  captionMore: string;
  captionLess: string;
  like: string;
  unlike: string;
  comment: string;
  share: string;
  /** RAW `feed.meta.likes.*`. */
  likes: CountTemplates;
};

/** What a page registers with its host: the like-only double tap. */
export type ReelBinder = { likeOnly: () => void };

export type ReelOverlayProps = {
  view: ReelView;
  current: boolean;
  locale: string;
  labels: ReelOverlayLabels;
  onLike: (postId: string) => Promise<LikeOutcome>;
  onUnlike: (postId: string) => Promise<LikeOutcome>;
  onComment: (postId: string) => void;
  onShare: (target: PostShareTarget) => void;
  /** The generic toast (a refused like). */
  onError: () => void;
  bind: (postId: string, binder: ReelBinder | null) => void;
};

export function ReelOverlay({
  view,
  current,
  locale,
  labels,
  onLike,
  onUnlike,
  onComment,
  onShare,
  onError,
  bind,
}: ReelOverlayProps) {
  // The refusal envelope becomes a rejection — the one signal the engine reverts on (the card's rule).
  const toggleRequest = useCallback(
    async (nextLiked: boolean): Promise<LikeState> => {
      const outcome = nextLiked ? await onLike(view.id) : await onUnlike(view.id);
      if (!outcome.ok) throw new Error('like_refused');
      return { liked: outcome.liked, likeCount: outcome.likeCount };
    },
    [onLike, onUnlike, view.id],
  );

  const { state, toggle, pulseKey } = useOptimisticLike({
    liked: view.viewerLiked,
    likeCount: view.likeCount,
    onToggle: toggleRequest,
    onError,
  });

  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!current) setExpanded(false);
  }, [current]);

  const likedRef = useRef(state.liked);
  likedRef.current = state.liked;
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  useEffect(() => {
    bind(view.id, {
      likeOnly: () => {
        if (likedRef.current) return;
        // Marked at once, so a second double tap before the next render sends nothing either.
        likedRef.current = true;
        toggleRef.current();
      },
    });
    return () => bind(view.id, null);
  }, [bind, view.id]);

  const shareUrl = view.shareUrl;
  const authorName = view.author.displayName;
  /** The host already merged this visit's sheet deltas into `view` (CR-01). */
  const commentCount = Math.max(0, view.commentCount);

  return (
    <>
      <ReelCaption
        author={{ name: authorName, href: view.author.profileHref }}
        community={view.community}
        moreLabel={labels.captionMore}
        lessLabel={labels.captionLess}
        expanded={expanded}
        onExpandedChange={setExpanded}
      >
        {view.caption.length > 0 ? linkify(view.caption) : null}
      </ReelCaption>
      <ReelRail
        author={{
          href: view.author.profileHref,
          avatarUrl: view.author.avatarUrl,
          name: authorName,
          // A function replacement, so a `$` pattern in a display name is never interpreted.
          label: labels.railAuthor.replace('{name}', () => authorName),
        }}
        like={
          <LikeButton
            tone="overMedia"
            glyphSize={28}
            liked={state.liked}
            countLabel={announcedCount(state.likeCount, labels.likes, locale)}
            likeLabel={labels.like}
            unlikeLabel={labels.unlike}
            pulseKey={pulseKey}
            onToggle={toggle}
          />
        }
        likeCount={compactCount(state.likeCount, locale)}
        commentLabel={labels.comment}
        commentCount={compactCount(commentCount, locale)}
        onComment={() => onComment(view.id)}
        shareLabel={labels.share}
        onShare={shareUrl ? () => onShare({ postId: view.id, url: shareUrl }) : undefined}
      />
    </>
  );
}
