import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';
import { chipBase } from './chipBase';

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

/**
 * Non-interactive soft pill (tenant status, domain status, invite state, "Primário").
 *
 * Deliberately directive-less: Server Components render it (event header, community header,
 * platform tenant header, AdminsCard), so it must take the geometry from
 * the directive-less `chipBase.ts`. When it came from the 'use client' Chip.tsx, the geometry
 * reached the server as a client-reference function that `cn()` dropped, and every server-rendered
 * pill lost its round, padded shape (PDF item #9).
 */
export function StatusPill({ tone = 'neutral', className, children, ...props }: StatusPillProps) {
  return (
    <span className={cn(chipBase, toneStyles[tone], className)} {...props}>
      {children}
    </span>
  );
}
