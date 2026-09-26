'use client';

import {
  StoriesStrip,
  type StoriesStripProps,
  type StoryStripCircle,
} from '@tria/module-stories/ui';
import { Pencil } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadHighlightItemsAction } from '@/app/(app)/stories/highlight-actions';
import type { likeStoryAction, unlikeStoryAction } from '@/app/(app)/stories/story-actions';
import type {
  RowCircleView,
  StoryGroupView,
  StoryViewerItemView,
  StoryViewerLabelsView,
} from '@/lib/story-view';
import {
  type StoryCommentsBinding,
  type StoryGroupState,
  StoryViewerHost,
} from './StoryViewerHost';

/**
 * A place's stories row and the viewer it opens (05-05, 05-06; grouped since 05.2-05).
 *
 * **Why this shell exists.** `lib/registry.tsx` (and the community page) compose the row on the
 * SERVER: which data, which labels, which circles and where they point are all decided there and
 * passed straight through. The circle's OPEN handler cannot be — it drives the viewer, which is
 * client state, and a server component cannot hold a hook. So the composition splits exactly the
 * way the feed's does, and every decision still lives on the server.
 *
 * **The viewer plays the row's OWN groups** (D-107, UI-D-65). `viewer.groups` are built from the
 * same reads the circles were, in the same order — circle `(g, 0)` opens `groups[g]` — so the two
 * can never disagree about which circle opens what. A group with items (the tenant circle, the
 * pinned row) costs no round trip; a HIGHLIGHT group arrives with `items: null` and is read lazily
 * through `loadHighlightItemsAction` when the member enters it, or just before (the viewer asks at
 * the previous group's last story). `/inicio`'s server render therefore never carries N×M items.
 * What this shell loads it KEEPS for the page's life, and it never asks twice for the same group
 * at once (T-05.2-24). Loaded groups are then FROZEN for the viewing session (UI partial/E04).
 *
 * **The modal is a shallow history entry, not an intercepting route.** Next 16 supports
 * `window.history.pushState` natively — it updates the URL and syncs the router WITHOUT rendering
 * another route — so the back gesture pops straight back to the page with the feed still mounted
 * underneath, and `app/(app)/stories/[storyId]/page.tsx` is what a deep link or a refresh resolves
 * to. Opening a group of the TENANT's stories pushes `/stories/{id}` of the story it opens on;
 * opening a HIGHLIGHT pushes the current URL unchanged, so back still closes and a refresh never
 * lands on a route that cannot rebuild the row (05.2-05 planning decision 3).
 */
export type StoriesSurfaceProps = Omit<StoriesStripProps, 'circles'> & {
  /**
   * The row as the server composed it. A `{ kind: 'manage' }` disc (05.2-09, UI-D-63) is plain data
   * because a React node cannot cross the server/client boundary; it is drawn HERE as the module's
   * `glyph` disc with the Pencil — "edit" whether or not highlights exist.
   */
  circles: readonly RowCircleView[];
  /**
   * Absent (a place with nothing to open) leaves every circle INERT — `StoryCircle` renders a plain
   * span rather than a button that does nothing, the 04-09 `createHref` posture.
   */
  viewer?: {
    /** One group per openable circle, in the circles' order. Highlights arrive with `items: null`. */
    groups: readonly StoryGroupView[];
    labels: StoryViewerLabelsView;
    onLike: typeof likeStoryAction;
    onUnlike: typeof unlikeStoryAction;
    /** D-82's sheet, composed on the server in `lib/registry.tsx` and passed straight through. */
    comments?: StoryCommentsBinding;
    /** `stories.story.manage` from the bootstrap: the viewer's "Destacar" pill (UI-D-66). */
    canCurate?: boolean;
  };
};

type Opened = { group: number; index: number };

/** The manage circle's glyph (UI-D-63 a): `Pencil` 20, on the module's tertiary disc. */
function toStripCircle(circle: RowCircleView): StoryStripCircle {
  if (circle.disc.kind !== 'manage') return circle as StoryStripCircle;
  return { ...circle, disc: { kind: 'glyph', icon: <Pencil aria-hidden size={20} /> } };
}

export function StoriesSurface({ viewer, circles: rowCircles, ...strip }: StoriesSurfaceProps) {
  const circles = useMemo(() => rowCircles.map(toStripCircle), [rowCircles]);
  const [opened, setOpened] = useState<Opened | null>(null);
  /** Highlight items read so far, by group key — kept for the page's life. */
  const [loaded, setLoaded] = useState<Record<string, StoryViewerItemView[]>>({});
  /** Group keys whose last read failed; cleared by the retry. */
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  /** Reads in flight, by group key: the in-flight dedupe (T-05.2-24). */
  const inFlight = useRef(new Set<string>());
  /** A mirror of `loaded` for the request path, which must not close over a stale render. */
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  /** The circle that opened the viewer: focus returns to it on close (UI-SPEC §Accessibility). */
  const originRef = useRef<HTMLElement | null>(null);
  /** True while THIS component owns the pushed entry, so a close can pop exactly the one it added. */
  const pushedRef = useRef(false);

  /**
   * The server's groups with what the client has learned since: a highlight's loaded items, or
   * that its read failed. A group object is re-created ONLY when its own state changed, so the
   * host's per-group cache keeps every other group's media functions (and so its mounted media).
   */
  const mergedRef = useRef(
    new Map<
      string,
      {
        source: StoryGroupView;
        items: StoryViewerItemView[] | null;
        failed: boolean;
        merged: StoryGroupState;
      }
    >(),
  );
  const groups = useMemo<StoryGroupState[]>(
    () =>
      (viewer?.groups ?? []).map((source) => {
        const items = source.items ?? loaded[source.key] ?? null;
        const isFailed = items === null && failed[source.key] === true;
        const cached = mergedRef.current.get(source.key);
        if (
          cached &&
          cached.source === source &&
          cached.items === items &&
          cached.failed === isFailed
        )
          return cached.merged;
        const merged: StoryGroupState =
          items === source.items && !isFailed ? source : { ...source, items, failed: isFailed };
        mergedRef.current.set(source.key, { source, items, failed: isFailed, merged });
        return merged;
      }),
    [viewer?.groups, loaded, failed],
  );

  /**
   * The lazy read (R-P6). Only a HIGHLIGHT group that has no items yet is ever requested, at most
   * once at a time; a failure marks the group for the viewer's error frame and is retried only on
   * the member's own tap.
   */
  const requestGroup = useCallback(
    async (g: number) => {
      const group = viewer?.groups[g];
      if (!group || group.items !== null || group.highlightId === null) return;
      const key = group.key;
      if (loadedRef.current[key] || inFlight.current.has(key)) return;
      inFlight.current.add(key);
      let items: StoryViewerItemView[] | null = null;
      try {
        const result = await loadHighlightItemsAction(group.highlightId);
        if (result.ok) items = result.items;
      } catch (error) {
        // A transport failure is the same group error as a refusal; shape only in the log.
        console.error('stories.highlight_group_failed', { error: String(error) });
      } finally {
        inFlight.current.delete(key);
      }
      if (items) {
        const read = items;
        setLoaded((state) => ({ ...state, [key]: read }));
      } else {
        setFailed((state) => ({ ...state, [key]: true }));
      }
    },
    [viewer?.groups],
  );

  const retryGroup = useCallback(
    (g: number) => {
      const key = viewer?.groups[g]?.key;
      if (key === undefined) return;
      // Back to the loading frame first, then the read — so the retry is visibly doing something.
      setFailed((state) => ({ ...state, [key]: false }));
      void requestGroup(g);
    },
    [viewer?.groups, requestGroup],
  );

  const close = useCallback(() => {
    if (pushedRef.current) {
      pushedRef.current = false;
      // Popping is what restores the page's URL; the `popstate` listener below then clears the
      // state, so closing by gesture and closing by back button take the IDENTICAL path.
      window.history.back();
      return;
    }
    setOpened(null);
  }, []);

  const open = useCallback(
    (group: number, index: number) => {
      const target = groups[group];
      if (!target) return;
      originRef.current = document.activeElement as HTMLElement | null;
      const story = target.items?.[index];
      // A group of the tenant's stories names the story it opens on; a highlight keeps the URL
      // (planning decision 3) — either way back pops exactly this entry.
      const url =
        target.kind !== 'highlight' && story ? `/stories/${story.id}` : window.location.href;
      window.history.pushState(null, '', url);
      pushedRef.current = true;
      setOpened({ group, index });
    },
    [groups],
  );

  useEffect(() => {
    const onPopState = () => {
      pushedRef.current = false;
      setOpened(null);
      // The focus return has to wait for the viewer's own focus trap to restore first, or the trap
      // would move focus back out from under it as it unmounts.
      queueMicrotask(() => originRef.current?.focus?.({ preventScroll: true }));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return (
    <>
      <StoriesStrip
        {...strip}
        circles={circles}
        onOpen={viewer && groups.length > 0 ? open : undefined}
      />
      {viewer && opened !== null ? (
        <StoryViewerHost
          groups={groups}
          initialGroup={opened.group}
          initialIndex={opened.index}
          onNeedGroup={(g) => void requestGroup(g)}
          onRetryGroup={retryGroup}
          labels={viewer.labels}
          onLike={viewer.onLike}
          onUnlike={viewer.onUnlike}
          comments={viewer.comments}
          canCurate={viewer.canCurate}
          onClose={close}
        />
      ) : null}
    </>
  );
}
