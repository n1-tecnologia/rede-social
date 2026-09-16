import { cn } from '../cn';

export interface BadgeProps {
  count: number;
  /** Counts above this render as `${max}+` (default 99). */
  max?: number;
  className?: string;
}

/** 18px count badge (`bg-danger`, 10px/700 numerals); renders nothing for a non-positive count. */
export function Badge({ count, max = 99, className }: BadgeProps) {
  if (count <= 0) return null;

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
