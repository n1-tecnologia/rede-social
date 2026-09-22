'use client';

import type { ReactNode } from 'react';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';

export interface InfiniteScrollProps {
  hasMore: boolean;
  onLoadMore: () => void | Promise<void>;
  skeleton?: ReactNode;
  enabled?: boolean;
  rootMargin?: string;
  root?: Element | null;
  className?: string;
}

/** RED stub — the no-next-page early return and the single skeleton land in GREEN. */
export function InfiniteScroll({ hasMore, onLoadMore }: InfiniteScrollProps) {
  const { sentinelRef } = useInfiniteScroll({ hasMore, onLoadMore });
  return <div ref={sentinelRef} />;
}
