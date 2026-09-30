import { cn } from '../cn';

export interface BadgeProps {
  count: number;
  /** Counts above this render as `${max}+` (default 99). */
  max?: number;
  /**
   * `count` (default): the 18px numeral badge. `dot` (07-09, UI-D-253, D-237): a 12px mark with no
   * numeral, for the member's chat slot ("the team answered", never a queue size). Both render
   * nothing for a non-positive count, and neither ever animates.
   */
  variant?: 'count' | 'dot';
  className?: string;
}

/** 18px count badge (`bg-danger`, 10px/700 numerals), or the 12px dot; nothing for a count of 0. */
export function Badge({ count, max = 99, variant = 'count', className }: BadgeProps) {
  if (count <= 0) return null;

  if (variant === 'dot') {
    return (
      <span
        aria-hidden
        data-badge-dot
        className={cn('block h-3 w-3 rounded-full bg-danger ring-2 ring-bg-secondary', className)}
      />
    );
  }

  const display = count > max ? `${max}+` : String(count);

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full bg-danger font-bold leading-none text-white',
        display.length <= 1
          ? 'h-[18px] w-[18px] text-[10px]'
          : display.length === 2
            ? 'h-[18px] min-w-[18px] px-1 text-[10px]'
            : 'h-[18px] min-w-[22px] px-1 text-[9px]',
        className,
      )}
    >
      {display}
    </span>
  );
}
