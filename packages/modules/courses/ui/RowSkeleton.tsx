import { cn, Skeleton } from '@rede-social/ui';
import { THUMB_SHAPE } from './ListRow';

export interface RowSkeletonProps {
  /** `poster` is the 3:4 course thumb rect, `wide` the 16:10 track/live rect. */
  variant?: 'poster' | 'wide';
}

/**
 * One list-row placeholder (UI-D-401): `min-h-14` with the thumb rect in the row's own geometry and
 * two text bars, so nothing shifts when the rows swap in. Hidden from the tree (`aria-hidden`) and
 * wordless: the skeleton says nothing about the list it is waiting for. `loading.tsx` draws 6 on
 * first load, the list draws 3 on load more.
 */
export function RowSkeleton({ variant = 'poster' }: RowSkeletonProps) {
  return (
    <div
      aria-hidden
      data-testid="row-skeleton"
      className="flex min-h-14 items-center gap-3 px-4 py-2"
    >
      <Skeleton variant="rect" className={cn('h-auto shrink-0 rounded-lg', THUMB_SHAPE[variant])} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton variant="text" width="60%" />
        <Skeleton variant="text" width="35%" className="h-3" />
      </div>
      <Skeleton variant="rect" className="h-6 w-16 shrink-0 rounded-full" />
    </div>
  );
}
