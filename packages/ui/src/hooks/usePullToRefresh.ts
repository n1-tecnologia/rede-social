'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useScrollContainer } from '../layout/ScrollContainerContext';

export interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void> | void;
  /** Pull distance (px) that triggers a refresh. */
  threshold?: number;
  /** Disable the gesture (e.g. on desktop) without unmounting the content. */
  enabled?: boolean;
}

const MAX_PULL = 150;

/**
 * Touch pull-to-refresh armed only when the scroll root (from ScrollContainerContext, falling back
 * to the wrapped container) sits at the top, so it never fires mid-feed.
 */
export function usePullToRefresh({
  onRefresh,
  threshold = 80,
  enabled = true,
}: UsePullToRefreshOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRoot = useScrollContainer();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startY = useRef(0);
  const pulling = useRef(false);
  const distance = useRef(0);

  const onTouchStart = useCallback(
    (event: TouchEvent) => {
      const container = containerRef.current;
      const scroller = scrollRoot?.current ?? container;
      if (!container || (scroller && scroller.scrollTop > 0)) return;
      const touch = event.touches[0];
      if (!touch) return;
      startY.current = touch.clientY;
      pulling.current = true;
    },
    [scrollRoot],
  );

  const onTouchMove = useCallback((event: TouchEvent) => {
    if (!pulling.current) return;
    const touch = event.touches[0];
    if (!touch) return;
    const delta = touch.clientY - startY.current;
    const next = delta > 0 ? Math.min(delta, MAX_PULL) : 0;
    distance.current = next;
    setPullDistance(next);
  }, []);

  const onTouchEnd = useCallback(async () => {
    if (!pulling.current) return;
    pulling.current = false;
    if (distance.current >= threshold) {
      setIsRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
      }
    }
    distance.current = 0;
    setPullDistance(0);
  }, [threshold, onRefresh]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: true });
    container.addEventListener('touchend', onTouchEnd);
    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
    };
  }, [enabled, onTouchStart, onTouchMove, onTouchEnd]);

  return { containerRef, isRefreshing, pullDistance };
}
