import { cn } from '@rede-social/ui';

/**
 * The school's progress bar (08.5-06, UI-D-426, UI-D-443, accent item P-08.5), ported from the
 * prototype's `ProgressBar`: a `bg-brand` fill on a neutral track — `bg-bg-tertiary` on a page,
 * `bg-white/25` over media (a card's poster) — at `h-1` (the card) or `h-2` (the course page and the
 * player).
 *
 * **No animation** (UI-D-443): the prototype's 0.8 s grow is dropped, so a server-rendered bar never
 * flashes from 0 on hydration. The width is an inline style because it is a runtime number.
 *
 * Props only, no words (PWA-03, MOD-02): the host passes the "{percent}% concluído" name. `pinned`
 * glues the bar to the bottom edge of a `relative` box with square ends (the poster's rule).
 */
export interface ProgressBarProps {
  /** 0–100; clamped here so a stray value cannot draw outside the track. */
  percent: number;
  /** The progressbar's accessible name, composed by the host. */
  label: string;
  /** `sm` → `h-1` (card) · `md` → `h-2` (pages). */
  size?: 'sm' | 'md';
  /** Over a cover: the `bg-white/25` track. */
  overMedia?: boolean;
  /** `absolute inset-x-0 bottom-0`, square ends. */
  pinned?: boolean;
  className?: string;
}

export function ProgressBar({
  percent,
  label,
  size = 'md',
  overMedia = false,
  pinned = false,
  className,
}: ProgressBarProps) {
  const value = Math.min(100, Math.max(0, Math.round(Number.isFinite(percent) ? percent : 0)));
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      data-testid="progress-bar"
      className={cn(
        'overflow-hidden',
        size === 'sm' ? 'h-1' : 'h-2',
        overMedia ? 'bg-white/25' : 'bg-bg-tertiary',
        pinned ? 'absolute inset-x-0 bottom-0' : 'rounded-full',
        className,
      )}
    >
      <div
        data-testid="progress-bar-fill"
        className={cn('h-full bg-brand', pinned ? '' : 'rounded-full')}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}
