'use client';

import { type RefObject, useEffect, useRef, useState } from 'react';
import { useScrollContainer } from '../layout/ScrollContainerContext';

export interface UseInfiniteScrollOptions {
  /** Called once per intersection while a page is not already in flight. */
  onLoadMore: () => void | Promise<void>;
  /** With no next cursor the observer is never created and `onLoadMore` never runs. */
  hasMore: boolean;
  /** How far ahead of the sentinel to start the next page. */
  rootMargin?: string;
  threshold?: number;
  /**
   * Observer root override. Omitted (`undefined`) the root comes from `useScrollContainer()`, which
   * is `null` outside the app shell — i.e. the document scrolls. Pass `null` to force the document.
   */
  root?: Element | null;
  /** Arm/disarm without unmounting the list (mirrors `usePullToRefresh`). */
  enabled?: boolean;
}

export interface UseInfiniteScrollResult {
  sentinelRef: RefObject<HTMLDivElement | null>;
  isLoading: boolean;
}

/**
 * IntersectionObserver sentinel for cursor paging. Two things it has to get right:
 *
 *  1. **The root comes from `ScrollContainerContext`**, never from a document lookup. The prototype
 *     hardcoded a lookup of the shell's scroll element by id, which is the exact coupling the context
 *     was introduced to remove: a primitive that reaches for a global element cannot be reused by a
 *     second consumer, and Phase 5's community list and Phase 7's notification list need this one.
 *  2. **One page at a time.** The guard is a ref, not the `isLoading` state, because an observer
 *     callback can fire again before React commits the state update — a fast scroll would otherwise
 *     issue a burst of identical requests.
 */
export function useInfiniteScroll({
  onLoadMore,
  hasMore,
  rootMargin = '200px',
  threshold = 0,
  root,
  enabled = true,
}: UseInfiniteScrollOptions): UseInfiniteScrollResult {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const scrollRoot = useScrollContainer();

  // Keep the latest callback in a ref so a new function identity per render does not tear down and
  // rebuild the observer (which would re-fire on a sentinel that is already on screen).
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  const observerRoot = root !== undefined ? root : (scrollRoot?.current ?? null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || !enabled) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || loadingRef.current) return;
        loadingRef.current = true;
        setIsLoading(true);
        void (async () => {
          try {
            await onLoadMoreRef.current();
          } catch {
            // The consumer owns the retry line (UI-SPEC "Error state — load more"); a rejection here
            // must not reach render, and the already-loaded content stays in place.
          } finally {
            loadingRef.current = false;
            setIsLoading(false);
          }
        })();
      },
      { root: observerRoot, rootMargin, threshold },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [observerRoot, rootMargin, threshold, hasMore, enabled]);

  return { sentinelRef, isLoading };
}
