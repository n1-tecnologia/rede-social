import { cn } from '@rede-social/ui';

/**
 * The school's progress bar (08.5-06, UI-D-426, UI-D-443, accent item P-08.5), ported from the
 * prototype's `ProgressBar`: a `bg-brand` fill on a neutral track — `bg-bg-tertiary` on a page,
 * `bg-white/25` over media (a card's poster) — at `h-1` (rows), `h-2` (the course page and the
 * player) or, since 2026-10-22, `h-[3px]` (`strip`: the poster's band, the prototype's 3px).
 *
 * **Motion (2026-10-22, the courses area redesign on the social-igoralves prototype).** The fill
 * grows from zero to its value in 0.8 s, the prototype's `ProgressBar`, as the CSS
 * `animate-progress-fill` so a server-rendered bar animates with no hydration; under "reduzir
 * movimento" it rests at its value (`motion-reduce:animate-none`, and the token's own reduced-motion
 * rule). The width stays the inline FINAL value, so a static render is exact.
 *
 * Props only, no words (PWA-03, MOD-02): the host passes the "{percent}% concluído" name. `pinned`
 * glues the bar to the bottom edge of a `relative` box with square ends (the poster's rule).
 *
 * **Member skin (2026-10-26).** The track carries `ms-bar-track` with its `data-size` and
 * `data-over-media`, the fill `ms-bar`: inside `[data-member-skin]` the fill turns into the brand's
 * gradient with a glow and a sheen running over it (its `::after`, so the fill's own animation stays
 * `progress-fill`), and the poster's strip into a plain 2px line. Inert anywhere else.
 */
export interface ProgressBarProps {
  /** 0–100; clamped here so a stray value cannot draw outside the track. */
  percent: number;
  /** The progressbar's accessible name, composed by the host. */
  label: string;
  /** `strip` → `h-[3px]` (poster) · `sm` → `h-1` (rows) · `md` → `h-2` (pages). */
  size?: 'strip' | 'sm' | 'md';
  /** Over a cover: the `bg-white/25` track. */
  overMedia?: boolean;
  /** `absolute inset-x-0 bottom-0`, square ends. */
  pinned?: boolean;
  className?: string;
}

const HEIGHT = { strip: 'h-[3px]', sm: 'h-1', md: 'h-2' } as const;

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
      data-size={size}
      data-over-media={overMedia ? '' : undefined}
      className={cn(
        'ms-bar-track overflow-hidden',
        HEIGHT[size],
        overMedia ? 'bg-white/25' : 'bg-bg-tertiary',
        pinned ? 'absolute inset-x-0 bottom-0' : 'rounded-full',
        className,
      )}
    >
      <div
        data-testid="progress-bar-fill"
        className={cn(
          'ms-bar h-full animate-progress-fill bg-brand motion-reduce:animate-none',
          pinned ? '' : 'rounded-full',
        )}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}
