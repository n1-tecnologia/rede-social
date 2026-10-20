import { Skeleton } from '@rede-social/ui';

/** Eight rows: the loading shape of the directory on the first load and on every query change (E4/loading). */
const SKELETON_ROWS = Array.from({ length: 8 }, (_, index) => index);

/** The 8-row skeleton, shared with `loading.tsx` so both loads look identical. */
export function MembersSkeleton() {
  return (
    <div aria-busy data-testid="members-skeleton" className="flex flex-col">
      {SKELETON_ROWS.map((index) => (
        <div
          key={index}
          className="flex min-h-14 items-center gap-3 border-b border-divider px-4 py-3 last:border-0"
        >
          <Skeleton variant="circle" className="h-10 w-10" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton variant="text" width="45%" className="h-3.5" />
            <Skeleton variant="text" width="70%" className="h-3" />
          </div>
        </div>
      ))}
    </div>
  );
}
