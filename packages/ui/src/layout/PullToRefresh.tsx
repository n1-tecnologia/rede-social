'use client';

import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { usePullToRefresh } from '../hooks/usePullToRefresh';

export interface PullToRefreshProps {
  children: ReactNode;
  onRefresh: () => Promise<void> | void;
  className?: string;
}

/** Mobile-only pull-to-refresh: the brand loader rotates with the pull, the content shifts with it. */
export function PullToRefresh({ children, onRefresh, className }: PullToRefreshProps) {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const { containerRef, isRefreshing, pullDistance } = usePullToRefresh({
    onRefresh,
    enabled: isMobile,
  });

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 z-10 flex items-center justify-center transition-transform"
        style={{
          transform: `translateY(${Math.min(pullDistance - 40, 40)}px)`,
          opacity: pullDistance > 10 || isRefreshing ? 1 : 0,
        }}
      >
        <Loader2
          size={24}
          className={cn('text-brand', isRefreshing && 'animate-spin')}
          style={{ transform: isRefreshing ? undefined : `rotate(${pullDistance * 3}deg)` }}
        />
      </div>
      <div
        className="transition-transform"
        style={{
          transform: pullDistance > 0 ? `translateY(${pullDistance * 0.4}px)` : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
