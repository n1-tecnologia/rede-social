import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';
import { chipBase } from './Chip';

const toneStyles = {
  brand: 'bg-brand/10 text-brand',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  neutral: 'bg-bg-tertiary text-text-secondary',
} as const;

export type StatusTone = keyof typeof toneStyles;

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  children: ReactNode;
}

/** Non-interactive soft pill (tenant status, domain status, invite state, "Primário"). */
export function StatusPill({ tone = 'neutral', className, children, ...props }: StatusPillProps) {
  return (
    <span className={cn(chipBase, toneStyles[tone], className)} {...props}>
      {children}
    </span>
  );
}
