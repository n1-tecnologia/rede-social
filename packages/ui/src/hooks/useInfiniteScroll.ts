'use client';

import { type RefObject, useRef, useState } from 'react';

export interface UseInfiniteScrollOptions {
  onLoadMore: () => void | Promise<void>;
  hasMore: boolean;
  rootMargin?: string;
  threshold?: number;
  root?: Element | null;
  enabled?: boolean;
}

export interface UseInfiniteScrollResult {
  sentinelRef: RefObject<HTMLDivElement | null>;
  isLoading: boolean;
}

/** RED stub — the observer, the root resolution and the re-entrancy guard land in GREEN. */
export function useInfiniteScroll(_options: UseInfiniteScrollOptions): UseInfiniteScrollResult {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [isLoading] = useState(false);
  return { sentinelRef, isLoading };
}
