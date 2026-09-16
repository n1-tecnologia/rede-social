import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export interface SafeAreaWrapperProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** Pads the device safe areas from the `--safe-*` tokens (never `env()` directly). */
export function SafeAreaWrapper({ className, children, ...props }: SafeAreaWrapperProps) {
  return (
    <div className={cn('pt-[var(--safe-top)] pb-[var(--safe-bottom)]', className)} {...props}>
      {children}
    </div>
  );
}
