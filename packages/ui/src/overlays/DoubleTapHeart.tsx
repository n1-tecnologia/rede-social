'use client';

import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface DoubleTapHeartProps {
  children: ReactNode;
  onDoubleTap?: () => void;
  className?: string;
}

/** RED stub — the 300 ms window, the burst overlay and the reduced-motion branch land in GREEN. */
export function DoubleTapHeart({ children, className }: DoubleTapHeartProps) {
  return <div className={cn('relative select-none', className)}>{children}</div>;
}
