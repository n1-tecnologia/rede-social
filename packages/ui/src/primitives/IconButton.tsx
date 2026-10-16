'use client';

import type { LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from '../cn';
import { Badge } from './Badge';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  /** Accessible name — required: an icon-only control has no other text. */
  label: string;
  /** Icon glyph size (22 per UI-SPEC). */
  size?: number;
  /** Optional count badge at the top-right corner. */
  count?: number;
  /** Overrides the badge's fill/text tone (merged by `cn`, so it replaces the default danger fill). */
  badgeClassName?: string;
  // React 19 passes `ref` as a plain prop and the rest-spread forwards it; this only types it.
  ref?: Ref<HTMLButtonElement>;
}

/** 44×44 minimum touch target, circular, icon-only control with an optional count `Badge`. */
export function IconButton({
  icon: Icon,
  label,
  size = 22,
  count,
  badgeClassName,
  className,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cn(
        'relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-text transition-colors',
        'hover:bg-bg-hover active:bg-bg-tertiary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <Icon aria-hidden size={size} />
      {count !== undefined && count > 0 ? (
        <span className="absolute -top-0.5 -right-0.5">
          <Badge count={count} className={badgeClassName} />
        </span>
      ) : null}
    </button>
  );
}
