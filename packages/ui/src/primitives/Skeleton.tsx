import type { CSSProperties } from 'react';
import { cn } from '../cn';

export interface SkeletonProps {
  variant?: 'text' | 'circle' | 'rect';
  width?: string | number;
  height?: string | number;
  className?: string;
}

/** Shimmering placeholder (tokenised gradient so it reads in both themes; still under reduced motion). */
export function Skeleton({ variant = 'text', width, height, className }: SkeletonProps) {
  const style: CSSProperties = { width, height };

  return (
    <div
      aria-hidden
      style={style}
      className={cn(
        'animate-shimmer bg-gradient-to-r from-bg-tertiary via-bg-secondary to-bg-tertiary bg-[length:200%_100%]',
        variant === 'text' && 'h-4 w-full rounded-md',
        variant === 'circle' && 'h-10 w-10 shrink-0 rounded-full',
        variant === 'rect' && 'h-24 w-full rounded-xl',
        className,
      )}
    />
  );
}
