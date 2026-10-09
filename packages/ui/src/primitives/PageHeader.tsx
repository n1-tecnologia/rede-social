'use client';

import { ChevronLeft, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { BackLink } from './BackLink';
import { IconButton } from './IconButton';

/**
 * The leading control: `backHref` is the navigational back (a `BackLink`: the screen the member came
 * from, `backHref` itself only as the fallback for a direct entry), `onBack` a form's own action (the
 * composer's `X`), or neither.
 */
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
  /**
   * Glyph of the leading control. Defaults to the back chevron every navigational header uses; the
   * composer passes `X` because it CLOSES a full-screen form rather than stepping back through a
   * hierarchy, and the two read as different promises (UI-SPEC §Composer contract, "Chrome").
   */
  backIcon?: LucideIcon;
  /**
   * CSS `top` of the sticky header. The default, `-0.5rem`, pins it flush under the TopBar on every
   * device. A sticky offset counts from the scroll root's CONTENT edge (Blink and WebKit deflate the
   * sticky rectangle by the scroller's padding), and the shell's `main.app-scroll` is padded
   * `safe-top + 3.5rem` while the TopBar ends at `safe-top + 3rem` (plus its 1px hairline, which the
   * pinned header tucks under). `-0.5rem` is that difference, so `--safe-top` cancels out and no
   * notch or PWA inset can open a band. At rest the header stays in flow (a negative threshold never
   * pushes it down) and it pins after 8px of scroll. The old default `calc(var(--safe-top) + 3rem)`
   * counted the inset and the TopBar twice: a ~67px empty band over the scrolling content, and the
   * header pushed ~60px down over the page's first block. `0px` leaves a 7px seam instead.
   */
  stickyTop?: string;
  className?: string;
};

const backClasses =
  'relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-text transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * Sticky sub-header: optional 44×44 back control, 16/700 title, trailing slot. Static from `md` up:
 * the TopBar is hidden there, so there is nothing to pin under, and the header scrolls away with the
 * centred column. The screens keep the default `stickyTop` (no per-page override, the 03-05
 * `stickyTop="0px"` workaround is gone); one that passes its own value owns the geometry it implies.
 *
 * The `backHref` control is a `BackLink` (2026-10-09): a tap returns to the previous screen when the
 * shell recorded one behind this screen, and only otherwise follows `backHref`, so a screen's static
 * parent is its fallback rather than its destination. Its label therefore names no place ("Voltar").
 */
export function PageHeader({
  title,
  trailing,
  backIcon: BackIcon = ChevronLeft,
  stickyTop = '-0.5rem',
  className,
  ...back
}: PageHeaderProps) {
  const hasBack = back.onBack !== undefined || back.backHref !== undefined;

  return (
    <header
      className={cn(
        'sticky z-40 flex items-center gap-1 bg-bg/95 px-2 py-1 backdrop-blur-sm md:static',
        className,
      )}
      style={{ top: stickyTop }}
    >
      {back.backHref !== undefined ? (
        <BackLink href={back.backHref} aria-label={back.backLabel} className={backClasses}>
          <BackIcon aria-hidden size={22} />
        </BackLink>
      ) : back.onBack !== undefined ? (
        <IconButton icon={BackIcon} label={back.backLabel} onClick={back.onBack} />
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
