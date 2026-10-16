'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { loadReelStartAction, loadReelsPageAction } from '@/app/(app)/reels/reels-actions';
import { suspendFeedVideos } from '@/components/media/FeedVideo';
import { REELS_ALL_LANE, type ReelInteractionReport } from './ReelsHost';
import { ReelsOverlay, type ReelsOverlayBinding, type ReelsOverlayStart } from './ReelsOverlay';

/**
 * Opening Reels OVER a feed at the video the member tapped (2026-10-09, the product owner's request,
 * reversing D-124), and coming back to the same post at the same place in the feed. `FeedSurface`
 * (Início, a community's page) and `PostDetail` (the post page) host it.
 *
 * **A shallow history entry, not a route** (`StoriesSurface`'s technique). Opening pushes the SAME
 * address with `?reel={postId}`: Next 16 syncs its router with a native `pushState` without
 * rendering anything, and because the PATHNAME does not change, the shell's scroll root keeps its
 * position (it scrolls to the top only on a pathname change). The feed stays mounted under the
 * overlay with its pages, so there is nothing to restore. Every way back is the browser's: the
 * return arrow and Escape pop the entry (`history.back()`), and the `popstate` that follows closes
 * the overlay, so the system back gesture, the arrow and Escape take ONE path. A `?reel=` found on
 * arrival through history (a reload, a back/forward load) reopens the overlay in place on that same
 * entry; one found any other way (a typed or shared link) is dropped in place (`replaceState`) and
 * the page opens as itself.
 *
 * **At that video, in the feed's order** (`cursorOf`). The feed and `?media=video` share one
 * ordering and one opaque cursor, so the Reels page read with the cursor of the feed page that
 * brought the post (null for the server-rendered first page) holds it, in this feed's lane: the
 * community's on its page, "Todos" on Início. When that page does not hold it (the post stopped
 * being a ready video) or there is no feed page to read from (the post page, no `cursorOf`), the
 * start is `loadReelStartAction`: that video first, then its lane's newest page. The overlay opens
 * at once on its loading state with the way back; a start that lands after the overlay closed or was
 * retried is dropped (`seq`).
 *
 * **While it is open the feed's videos stand down** (`suspendFeedVideos`), and on close they get
 * their turn back and the focus returns to the tapped video's frame (after the overlay's own focus
 * trap restored its opener, the same order `StoriesSurface` keeps). What the member did in Reels
 * reaches the host through `onInteraction`.
 *
 * Without a binding (the tenant has no Reels) there is no `open`, and one tap keeps pausing.
 */

/** The query parameter the overlay's history entry carries: the post it was opened on. */
export const REEL_PARAM = 'reel';

export type UseReelsOverlayOptions = {
  /** Composed on the server (`reelsOverlayProps`); `null` or absent when the tenant has no Reels. */
  reels: ReelsOverlayBinding | null | undefined;
  /** The community whose page hosts the feed (its lane), or `null` for "Todos". */
  communityId: string | null;
  /**
   * The cursor of the feed page that brought a post (`null` for the first page), read when it is
   * tapped. Absent: there is no feed page to read from, and the start is the fallback.
   */
  cursorOf?: (postId: string) => string | null;
  /** What the member did in Reels, post by post, as the overlay showed it. */
  onInteraction?: (postId: string, shown: ReelInteractionReport) => void;
};

export type ReelsOverlayControls = {
  /** Opens the overlay at a post's video; absent without Reels. */
  open: ((postId: string) => void) | undefined;
  /** The overlay while it is open, else `null`: render it beside the feed. */
  overlay: ReactNode;
};

type Opened = { postId: string; seq: number; start: ReelsOverlayStart };

/**
 * This document was loaded by a reload or a back/forward step: a `?reel=` it carries is then the
 * overlay's own entry, and the entry behind it is this same page without it (only `open` makes them).
 */
function arrivedThroughHistory(): boolean {
  try {
    const entry = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    return entry?.type === 'reload' || entry?.type === 'back_forward';
  } catch {
    return false;
  }
}

/** The current address without `?reel=`, as `replaceState` takes it; `null` when there is none. */
function withoutReelParam(): string | null {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(REEL_PARAM)) return null;
  url.searchParams.delete(REEL_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The tapped video's frame (`FeedVideo`), found through its card's post id. */
function focusVideoOf(postId: string): void {
  const card = Array.from(document.querySelectorAll<HTMLElement>('[data-post-id]')).find(
    (node) => node.dataset.postId === postId,
  );
  card?.querySelector<HTMLElement>('[data-feed-video]')?.focus({ preventScroll: true });
}

/**
 * The page the overlay opens on. Each read is caught on its own: a failed first read still tries the
 * fallback, and only when neither answers is the start an error (the stage error, with a retry).
 */
async function readStart(
  postId: string,
  communityId: string | null,
  cursorOf: ((postId: string) => string | null) | undefined,
): Promise<ReelsOverlayStart> {
  if (cursorOf) {
    try {
      const page = await loadReelsPageAction(communityId, cursorOf(postId));
      if (page.ok) {
        const index = page.items.findIndex((item) => item.id === postId);
        if (index !== -1) {
          return { status: 'ready', items: page.items, nextCursor: page.nextCursor, index };
        }
      }
    } catch (error) {
      console.error('reels.overlay_page_failed', { error: String(error) });
    }
  }
  try {
    const start = await loadReelStartAction(postId, communityId);
    if (start.ok) {
      return { status: 'ready', items: start.items, nextCursor: start.nextCursor, index: 0 };
    }
  } catch (error) {
    console.error('reels.overlay_start_failed', { error: String(error) });
  }
  return { status: 'error' };
}

export function useReelsOverlay({
  reels,
  communityId,
  cursorOf,
  onInteraction,
}: UseReelsOverlayOptions): ReelsOverlayControls {
  const [opened, setOpened] = useState<Opened | null>(null);
  /** The post the overlay is open on, synchronously: `open` and the `popstate` listener read it. */
  const openFor = useRef<string | null>(null);
  /** Bumped by every open, retry and close: a start that lands for an older one is dropped. */
  const seq = useRef(0);
  /** Gives the feed's videos their turn back (`suspendFeedVideos`). */
  const release = useRef<(() => void) | null>(null);
  const cursorOfRef = useRef(cursorOf);
  cursorOfRef.current = cursorOf;

  const load = useCallback(
    async (postId: string, attempt: number) => {
      const start = await readStart(postId, communityId, cursorOfRef.current);
      if (seq.current !== attempt) return;
      setOpened((current) => (current?.seq === attempt ? { ...current, start } : current));
    },
    [communityId],
  );

  // A `?reel=` on arrival (review of 2026-10-09). A reload or a back/forward load landed on the
  // overlay's own entry: it reopens in place, without a new entry, so the arrow, Escape and the
  // system back pop that entry as they would have (dropping the param left two entries of one page,
  // and "Voltar" reloaded the same page). A typed or shared link, or a page without Reels, has no
  // such entry behind it: the param is dropped in place and the page opens as itself. Arrival only.
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once, on the page's arrival.
  useEffect(() => {
    const postId = new URL(window.location.href).searchParams.get(REEL_PARAM);
    if (postId === null) return;
    if (reels && arrivedThroughHistory()) {
      openFor.current = postId;
      release.current ??= suspendFeedVideos();
      seq.current += 1;
      const attempt = seq.current;
      setOpened({ postId, seq: attempt, start: { status: 'loading' } });
      void load(postId, attempt);
      return;
    }
    const clean = withoutReelParam();
    if (clean !== null) window.history.replaceState(null, '', clean);
  }, []);

  const open = useCallback(
    (postId: string) => {
      if (openFor.current !== null) return;
      openFor.current = postId;
      const url = new URL(window.location.href);
      url.searchParams.set(REEL_PARAM, postId);
      // The SAME pathname: the shell's scroll root keeps the feed where it is.
      window.history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
      release.current ??= suspendFeedVideos();
      seq.current += 1;
      const attempt = seq.current;
      setOpened({ postId, seq: attempt, start: { status: 'loading' } });
      void load(postId, attempt);
    },
    [load],
  );

  const retry = useCallback(() => {
    const postId = openFor.current;
    if (postId === null) return;
    seq.current += 1;
    const attempt = seq.current;
    setOpened({ postId, seq: attempt, start: { status: 'loading' } });
    void load(postId, attempt);
  }, [load]);

  const back = useCallback(() => window.history.back(), []);

  useEffect(() => {
    const onPopState = () => {
      const postId = openFor.current;
      if (postId === null) {
        // Forward into an old overlay entry: there is no overlay to show, so the address is tidied.
        const clean = withoutReelParam();
        if (clean !== null) window.history.replaceState(null, '', clean);
        return;
      }
      openFor.current = null;
      seq.current += 1;
      setOpened(null);
      release.current?.();
      release.current = null;
      // After the overlay's focus trap has restored its own opener as it unmounts.
      queueMicrotask(() => focusVideoOf(postId));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Unmounted while open (a link inside the overlay navigated away): the videos must not stay held.
  useEffect(
    () => () => {
      release.current?.();
      release.current = null;
    },
    [],
  );

  const overlay =
    reels && opened ? (
      <ReelsOverlay
        binding={reels}
        lane={communityId ?? REELS_ALL_LANE}
        start={opened.start}
        onBack={back}
        onRetry={retry}
        onInteraction={onInteraction}
      />
    ) : null;

  return { open: reels ? open : undefined, overlay };
}
