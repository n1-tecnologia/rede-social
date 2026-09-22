'use client';

import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { IconButton } from './IconButton';

type BackProps =
  | { onBack: () => void; backHref?: undefined; backLabel: string }
  | { backHref: string; onBack?: undefined; backLabel: string }
  | { onBack?: undefined; backHref?: undefined; backLabel?: undefined };

export type PageHeaderProps = BackProps & {
  /**
   * The screen's `h1`. OMITTED only when the screen's single `h1` lives in its own body — the member
   * profile `/membros/[membershipId]`, where the display name IS the heading (UI-SPEC §Member
   * profile). With no title the header is the back control alone and renders no heading element at
   * all, so the one-h1 rule still holds.
   */
  title?: string;
  /** Trailing slot (actions). */
  trailing?: ReactNode;
  /** CSS `top` of the sticky header — defaults to just below the TopBar. */
  stickyTop?: string;
  className?: string;
};

const backClasses =
  'relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-text transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** Sticky sub-header: optional 44×44 back control, 16/700 title, trailing slot. */
export function PageHeader({
  title,
  trailing,
  stickyTop = 'calc(var(--safe-top) + 3rem)',
  className,
  ...back
}: PageHeaderProps) {
  const hasBack = back.onBack !== undefined || back.backHref !== undefined;

  return (
    <header
      className={cn(
        'sticky z-40 flex items-center gap-1 bg-bg/95 px-2 py-1 backdrop-blur-sm',
        className,
      )}
      style={{ top: stickyTop }}
    >
      {back.backHref !== undefined ? (
        <a href={back.backHref} aria-label={back.backLabel} className={backClasses}>
          <ChevronLeft aria-hidden size={22} />
        </a>
      ) : back.onBack !== undefined ? (
        <IconButton icon={ChevronLeft} label={back.backLabel} onClick={back.onBack} />
      ) : null}
      {title === undefined ? (
        <div className="flex-1" />
      ) : (
        <h1 className={cn('flex-1 truncate text-base font-bold text-text', !hasBack && 'px-2')}>
          {title}
        </h1>
      )}
      {trailing ? <div className="flex items-center gap-1">{trailing}</div> : null}
    </header>
  );
}
