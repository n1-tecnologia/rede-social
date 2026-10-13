import { RowSkeleton } from '@rede-social/module-courses/ui';
import { Skeleton } from '@rede-social/ui';

const TABS = [56, 56, 48];
const CHIPS = [56, 88, 92, 92];
const ROWS = [0, 1, 2, 3, 4, 5];

/**
 * `/cursos/loading.tsx` (UI-D-401, E02/E03 loading): the h1 and subtitle bars, the tabs row, the
 * title row with the create control's shape, the chips and 6 row skeletons, at the page's final
 * geometry so nothing shifts when the hub swaps in. A chip or tab switch is a navigation, so it shows
 * these same skeletons while pending. No words: the skeleton says nothing about the list it waits for.
 */
export default function CoursesLoading() {
  return (
    <div aria-busy className="mx-auto flex w-full max-w-[680px] flex-col">
      <div className="flex flex-col gap-2 px-4 pt-4 pb-3">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <div className="mb-4 flex gap-2 border-b border-divider px-4">
        {TABS.map((width, index) => (
          <Skeleton
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, static placeholder row.
            key={index}
            variant="text"
            width={width}
            className="my-3 h-4 shrink-0"
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 px-4 pb-3">
        <Skeleton className="h-5 w-20" />
        <Skeleton variant="rect" className="h-11 w-28 shrink-0 rounded-xl" />
      </div>
      <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-none">
        {CHIPS.map((width, index) => (
          <Skeleton
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, static placeholder row.
            key={index}
            variant="rect"
            width={width}
            className="h-[30px] shrink-0 rounded-full"
          />
        ))}
      </div>
      <div className="flex min-h-11 items-center gap-3 px-4 py-2">
        <Skeleton variant="rect" className="h-5 w-5 shrink-0 rounded-md" />
        <Skeleton variant="text" width="30%" />
      </div>
      <div className="flex flex-col divide-y divide-divider">
        {ROWS.map((index) => (
          <RowSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}
