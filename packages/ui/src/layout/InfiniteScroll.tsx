'use client';

import type { ReactNode } from 'react';
import { cn } from '../cn';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import { Skeleton } from '../primitives/Skeleton';

export interface InfiniteScrollProps {
  /** `false` once there is no next cursor — the component then renders nothing at all. */
  hasMore: boolean;
  onLoadMore: () => void | Promise<void>;
  /** Overrides the default one-card placeholder shown while a page is in flight. */
  skeleton?: ReactNode;
  enabled?: boolean;
  rootMargin?: string;
  root?: Element | null;
  className?: string;
}

/** One fixed-height placeholder card: avatar + two meta lines, a media block, two caption lines. */
function DefaultSkeleton() {
  return (
    <div
      aria-hidden
      data-infinite-scroll-skeleton
      className="flex max-w-full flex-col gap-4 overflow-hidden p-4"
    >
      <div className="flex items-center gap-3">
        <Skeleton variant="circle" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton variant="text" width="40%" />
          <Skeleton variant="text" width="20%" />
        </div>
      </div>
      <Skeleton variant="rect" height={240} className="rounded-xl" />
      <div className="flex flex-col gap-2">
        <Skeleton variant="text" width="30%" />
        <Skeleton variant="text" width="80%" />
      </div>
    </div>
  );
}

/**
 * Cursor-paging sentinel. It carries no copy of its own: with no next page it renders NOTHING — no
 * terminal spacer and no end-of-list line — and while a page is in flight exactly one placeholder
 * block, never two. A consumer that wants a retry line renders it itself.
 */
export function InfiniteScroll({
  hasMore,
  onLoadMore,
  skeleton,
  enabled,
  rootMargin,
  root,
  className,
}: InfiniteScrollProps) {
  const { sentinelRef, isLoading } = useInfiniteScroll({
    onLoadMore,
    hasMore,
    enabled,
    rootMargin,
    root,
  });

  if (!hasMore) return null;

  return (
    <div className={cn('flex w-full flex-col', className)}>
      <div ref={sentinelRef} aria-hidden className="h-px w-full shrink-0" />
      {isLoading ? (skeleton ?? <DefaultSkeleton />) : null}
    </div>
  );
}
