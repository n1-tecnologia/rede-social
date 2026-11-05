import { cn, Skeleton } from '@rede-social/ui';
import { THUMB_SHAPE } from './ListRow';

export interface RowSkeletonProps {
  /**
   * `poster` is the 3:4 course thumb rect, `wide` the 16:10 live thumb rect, `cover` the track's
   * whole 16:10 cover card (2026-10-22).
   */
  variant?: 'poster' | 'wide' | 'cover';
}

/**
 * One list-row placeholder (UI-D-401) in the row's own geometry, so nothing shifts when the rows swap
 * in. Hidden from the tree (`aria-hidden`) and wordless: the skeleton says nothing about the list it
 * is waiting for. The list draws 3 on load more, the screen's skeleton 6.
 *
 * 2026-10-22 (the courses area redesign): it follows the new `ListRow` — the 48px poster or 80px
 * wide thumb, the two text bars and the pill bar UNDER them (the pills moved under the meta) — and
 * gains the `cover` variant, the track's cover card as one rounded 16:10 block.
 */
export function RowSkeleton({ variant = 'poster' }: RowSkeletonProps) {
  if (variant === 'cover') {
    return (
      <div aria-hidden data-testid="row-skeleton" data-variant="cover">
        <Skeleton variant="rect" className="aspect-[16/10] h-auto w-full rounded-2xl" />
      </div>
    );
  }
  return (
    <div
      aria-hidden
      data-testid="row-skeleton"
      data-variant={variant}
      className="flex min-h-14 items-center gap-3 px-4 py-3"
    >
      <Skeleton variant="rect" className={cn('h-auto shrink-0 rounded-lg', THUMB_SHAPE[variant])} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton variant="text" width="60%" />
        <Skeleton variant="text" width="35%" className="h-3" />
        <Skeleton variant="rect" className="h-5 w-16 rounded-full" />
      </div>
    </div>
  );
}
