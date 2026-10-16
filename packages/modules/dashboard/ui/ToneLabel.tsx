import { cn, StatusPill } from '@rede-social/ui';
import {
  Circle,
  CircleAlert,
  CircleCheck,
  Info,
  type LucideIcon,
  TriangleAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';

export type LabelTone = 'success' | 'warning' | 'danger' | 'neutral' | 'brand';

const TONE_ICON: Record<LabelTone, LucideIcon> = {
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
  neutral: Circle,
  brand: Info,
};

export interface ToneLabelProps {
  tone: LabelTone;
  children: ReactNode;
  className?: string;
}

/**
 * A status as icon + text, never colour alone: the warning orange and the danger red are nearly the
 * same hue for deutan colour blindness, so each tone carries its own shape.
 */
export function ToneLabel({ tone, children, className }: ToneLabelProps) {
  const Icon = TONE_ICON[tone];
  return (
    <StatusPill tone={tone} className={cn('gap-1', className)}>
      <Icon aria-hidden size={14} className="shrink-0" />
      <span>{children}</span>
    </StatusPill>
  );
}
