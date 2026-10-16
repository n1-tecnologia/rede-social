import type { StoryLikeActionResult } from '@/app/(app)/stories/story-actions';
import type { StoryViewerItemView } from '@/lib/story-view';

/**
 * What the member did to each story while the page lives (CR-01 for stories, the Reels host's
 * per-post state one surface later): the settled like pair and the comment count, by story id.
 *
 * **Why it exists.** The viewer's stories are the page-load snapshot (`viewer.groups`, plus the
 * highlight reads `StoriesSurface` keeps in `loaded`), and `StoryViewerHost` unmounts on every
 * close. A like or a comment used to live only in the action row's own state, so closing and
 * reopening re-seeded the row from that snapshot: the heart came back empty and the count fell
 * back to the server's old number, or vanished at zero. This store outlives the host
 * (`StoriesSurface` creates it once for the page) and every row reads its story's entry over the
 * snapshot (`withStoryInteraction`): a reopen, a move to the next story and back, and the same
 * story in the tenant group and in a highlight all show the one state.
 *
 * **Why a store and not React state.** The host builds the viewer's items ONCE per group: a new
 * item would re-create the media render functions and re-mount the image the member is looking at,
 * so an entry held in the host's state would cost that remount on every like. Here only the action
 * row of the story that changed re-renders, through `useSyncExternalStore`.
 *
 * **The like (WR-04, `ReelsHost.trackLike` verbatim).** The row's like engine stays the in-flight
 * optimistic layer. The store keeps the last SERVER-confirmed pair per story, tagged with the
 * number of the request that produced it, and publishes it into the entry only when the story's
 * LATEST request settles (`ok`, refused or thrown): an older answer never re-seeds a row
 * mid-flight into a state the member left, an answer that lands after its row unmounted is still
 * recorded, and a refused latest request leaves the confirmed pair for the next row instead of the
 * stale snapshot. Only an `ok` answer is ever confirmed. The outcome goes back unchanged and a
 * rejection is rethrown, so the engine reverts and the host raises the toast exactly as before.
 *
 * **The comment count is ABSOLUTE** (`bumpCommentCount`): the first server-confirmed delta starts
 * from the count the member was shown, every later one from the entry, and it never drops below
 * zero, so a read made after the comment (which already counts it) is never added to twice.
 *
 * For the rest of the page's life an entry wins over any later read of the same story (a read can
 * predate the like). Nothing is persisted: it dies with the page, and the next server render is
 * the truth again.
 */

/** The server's authoritative like pair for one story, as the like action answers it. */
export type StoryLikePair = { liked: boolean; likeCount: number };

/** What the member did to one story during the page's life: the settled like pair, the count. */
export type StoryInteraction = { like?: StoryLikePair; commentCount?: number };

export type StoryInteractions = {
  /** `useSyncExternalStore`'s subscribe: every update notifies, each row's snapshot decides. */
  subscribe(listener: () => void): () => void;
  /** The story's entry (`undefined` while untouched): the SAME object until that story changes. */
  entry(storyId: string): StoryInteraction | undefined;
  /** One like or unlike request, kept by the WR-04 rule above; its outcome goes back as is. */
  trackLike(
    storyId: string,
    run: () => Promise<StoryLikeActionResult>,
  ): Promise<StoryLikeActionResult>;
  /** The sheet's server-confirmed delta, held as an absolute count seeded from `shownCount`. */
  bumpCommentCount(storyId: string, shownCount: number, delta: number): void;
};

export function createStoryInteractions(): StoryInteractions {
  const entries = new Map<string, StoryInteraction>();
  const listeners = new Set<() => void>();
  /** The number of the latest like request per story: it decides WHEN the pair is published. */
  const likeSeq = new Map<string, number>();
  /** The last server-confirmed pair per story, tagged with the seq of the request behind it. */
  const confirmed = new Map<string, { seq: number; like: StoryLikePair }>();

  /** Replaces ONLY this story's entry, so every other row's snapshot keeps its identity. */
  const update = (storyId: string, patch: StoryInteraction) => {
    entries.set(storyId, { ...entries.get(storyId), ...patch });
    for (const listener of [...listeners]) listener();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    entry(storyId) {
      return entries.get(storyId);
    },
    async trackLike(storyId, run) {
      const seq = (likeSeq.get(storyId) ?? 0) + 1;
      likeSeq.set(storyId, seq);
      const publish = () => {
        // A newer request is in flight: it publishes when it settles.
        if (likeSeq.get(storyId) !== seq) return;
        const pair = confirmed.get(storyId)?.like;
        if (pair === undefined) return;
        update(storyId, { like: pair });
      };
      try {
        const outcome = await run();
        if (outcome.ok) {
          const held = confirmed.get(storyId);
          // Next serialises server actions, so answers normally arrive in order; the seq guard
          // keeps an out-of-order older answer from replacing a newer one.
          if (held === undefined || held.seq < seq) {
            confirmed.set(storyId, {
              seq,
              like: { liked: outcome.liked, likeCount: outcome.likeCount },
            });
          }
        }
        publish();
        return outcome;
      } catch (error) {
        publish();
        throw error;
      }
    },
    bumpCommentCount(storyId, shownCount, delta) {
      const base = entries.get(storyId)?.commentCount ?? shownCount;
      update(storyId, { commentCount: Math.max(0, base + delta) });
    },
  };
}

/**
 * A story as the member last saw it: the SAME object when the page has no entry for it (a story
 * nobody touched re-renders nothing), else a copy carrying the entry's pair and count.
 */
export function withStoryInteraction(
  item: StoryViewerItemView,
  entry?: StoryInteraction,
): StoryViewerItemView {
  if (entry === undefined) return item;
  return {
    ...item,
    ...(entry.like ? { viewerLiked: entry.like.liked, likeCount: entry.like.likeCount } : {}),
    ...(entry.commentCount === undefined ? {} : { commentCount: entry.commentCount }),
  };
}
