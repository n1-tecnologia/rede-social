import { Card, cn } from '@rede-social/ui';

/**
 * A hidden post's static stand-in on a locked community page (UI-D-373): the feed's
 * `FeedCardSkeleton` geometry (a 40px circle, bars at 14px/40% and 12px/20%, a 240px media block,
 * two text bars) drawn from PLAIN `bg-bg-tertiary` blocks rather than `Skeleton`, so it never
 * shimmers and never reads as "loading". Flat `Card rounded-none shadow-none`, like a real post.
 *
 * `index` 0, 1, 2 → opacity 100 %, 70 %, 40 %, so the column fades into the count block. It carries
 * no content and no words: it is `aria-hidden` (the host also wraps the run in one `aria-hidden`
 * element), and the count line carries the information (UI-D-386). This package must not import
 * the feed module's skeleton (MOD-02), hence the copied geometry.
 */
export interface LockedPostPlaceholderProps {
  index: number;
}

const OPACITY = ['opacity-100', 'opacity-70', 'opacity-40'] as const;

/** The 0-based index clamped into the three steps; anything past the third keeps the faintest. */
export function placeholderOpacity(index: number): (typeof OPACITY)[number] {
  const step = Number.isFinite(index) ? Math.min(Math.max(Math.trunc(index), 0), 2) : 2;
  return OPACITY[step] as (typeof OPACITY)[number];
}

const BLOCK = 'block bg-bg-tertiary';

export function LockedPostPlaceholder({ index }: LockedPostPlaceholderProps) {
  return (
    <Card
      aria-hidden
      data-testid="locked-post-placeholder"
      data-index={index}
      className={cn(
        'flex flex-col overflow-hidden rounded-none pb-4 shadow-none dark:border-0',
        placeholderOpacity(index),
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span className={cn(BLOCK, 'h-10 w-10 shrink-0 rounded-full')} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span className={cn(BLOCK, 'h-3.5 w-[40%] rounded-md')} />
          <span className={cn(BLOCK, 'h-3 w-[20%] rounded-md')} />
        </div>
      </div>
      <span className={cn(BLOCK, 'h-60 w-full')} />
      <div className="flex flex-col gap-2 px-4 pt-3">
        <span className={cn(BLOCK, 'h-3.5 w-[90%] rounded-md')} />
        <span className={cn(BLOCK, 'h-3.5 w-[60%] rounded-md')} />
      </div>
    </Card>
  );
}
