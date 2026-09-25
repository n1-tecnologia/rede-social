'use client';

import { StoriesStrip, type StoriesStripProps } from '@tria/module-stories/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { likeStoryAction, unlikeStoryAction } from '@/app/(app)/stories/story-actions';
import type {
  StoryGroupView,
  StoryViewerAuthorView,
  StoryViewerItemView,
  StoryViewerLabelsView,
} from '@/lib/story-view';
import { type StoryCommentsBinding, StoryViewerHost } from './StoryViewerHost';

/**
 * `/inicio`'s stories strip and the viewer it opens (05-05, 05-06).
 *
 * **Why this shell exists.** `lib/registry.tsx` composes the strip on the SERVER: which data, which
 * labels, whether the own-circle renders, and where it points are all decided there and passed
 * straight through. The circle's OPEN handler cannot be — it drives the viewer, which is client
 * state, and a server component cannot hold a hook. So the composition splits exactly the way the
 * feed's does, and every decision still lives on the server.
 *
 * **The viewer reads the STRIP'S OWN ORDERED SEQUENCE, never a second fetch.** `viewer.items` is
 * built from the same page the circles were, in the same order, in the same request — so the two
 * can never disagree about which story the third circle opens, and opening the viewer costs no
 * round trip at all. The array is then FROZEN for the viewing session (UI partial/E04): a story
 * that expires or is deleted mid-view plays out its own segment and is absent only from the next
 * strip read.
 *
 * **The modal is a shallow history entry, not an intercepting route.** Next 16 supports
 * `window.history.pushState` natively — it updates the URL and syncs the router WITHOUT rendering
 * another route — so the back gesture pops straight back to `/inicio` with the feed still mounted
 * underneath, and `app/(app)/stories/[storyId]/page.tsx` is what a deep link or a refresh resolves
 * to. The alternative, `@modal` parallel slots plus `(.)` interception, would put a `default.tsx`
 * and a second render path into the app-group layout to buy the same two behaviours.
 */
export type StoriesSurfaceProps = StoriesStripProps & {
  /**
   * Absent (a member whose tenant has no active story, or a render before 05-06's route existed)
   * leaves every circle INERT — `StoryCircle` renders a plain span rather than a button that does
   * nothing, the 04-09 `createHref` posture.
   */
  viewer?: {
    items?: readonly StoryViewerItemView[];
    author?: StoryViewerAuthorView;
    /** 05.2-05 RED STUB — accepted but flattened to group 0. */
    groups?: readonly StoryGroupView[];
    labels: StoryViewerLabelsView;
    onLike: typeof likeStoryAction;
    onUnlike: typeof unlikeStoryAction;
    /** D-82's sheet, composed on the server in `lib/registry.tsx` and passed straight through. */
    comments?: StoryCommentsBinding;
  };
};

export function StoriesSurface({ viewer, ...strip }: StoriesSurfaceProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  /** The circle that opened the viewer: focus returns to it on close (UI-SPEC §Accessibility). */
  const originRef = useRef<HTMLElement | null>(null);
  /** True while THIS component owns the pushed entry, so a close can pop exactly the one it added. */
  const pushedRef = useRef(false);

  const close = useCallback(() => {
    if (pushedRef.current) {
      pushedRef.current = false;
      // Popping is what restores `/inicio` in the URL; the `popstate` listener below then clears
      // the state, so closing by gesture and closing by back button take the IDENTICAL path.
      window.history.back();
      return;
    }
    setOpenIndex(null);
  }, []);

  const open = useCallback(
    (index: number) => {
      const story = (viewer?.items ?? viewer?.groups?.[0]?.items ?? [])[index];
      if (!story) return;
      originRef.current = document.activeElement as HTMLElement | null;
      window.history.pushState(null, '', `/stories/${story.id}`);
      pushedRef.current = true;
      setOpenIndex(index);
    },
    [viewer],
  );

  /**
   * The strip speaks `(group, index)` (UI-D-59); this viewer still plays ONE sequence, so every
   * openable circle the host hands over belongs to group 0 and only its index matters. Plan 05
   * makes the viewer group-aware and this adapter disappears.
   */
  const openCircle = useCallback((_group: number, index: number) => open(index), [open]);

  useEffect(() => {
    const onPopState = () => {
      pushedRef.current = false;
      setOpenIndex(null);
      // The focus return has to wait for the viewer's own focus trap to restore first, or the trap
      // would move focus back out from under it as it unmounts.
      queueMicrotask(() => originRef.current?.focus?.({ preventScroll: true }));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return (
    <>
      <StoriesStrip {...strip} onOpen={viewer ? openCircle : undefined} />
      {viewer && openIndex !== null ? (
        <StoryViewerHost
          items={viewer.items ?? viewer.groups?.[0]?.items ?? []}
          initialIndex={openIndex}
          author={viewer.author ?? { name: viewer.groups?.[0]?.name ?? '', avatarUrl: null }}
          labels={viewer.labels}
          onLike={viewer.onLike}
          onUnlike={viewer.onUnlike}
          comments={viewer.comments}
          onClose={close}
        />
      ) : null}
    </>
  );
}
