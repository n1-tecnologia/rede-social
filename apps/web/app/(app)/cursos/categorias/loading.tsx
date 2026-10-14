import { RowSkeleton } from '@rede-social/module-courses/ui';
import { Skeleton } from '@rede-social/ui';

const ROWS = [0, 1, 2, 3, 4, 5];

/**
 * `/cursos/categorias/loading.tsx` (UI-D-401, E11 loading): the header's back circle, title bar and
 * create control shape, then 6 row skeletons at the list's final geometry. No words.
 */
export default function CategoriesLoading() {
  return (
    <div aria-busy className="mx-auto flex w-full max-w-[680px] flex-col">
      <div className="flex items-center gap-1 px-2 py-1">
        <Skeleton variant="circle" className="h-11 w-11" />
        <Skeleton className="h-5 w-28" />
        <div className="flex-1" />
        <Skeleton variant="rect" className="h-9 w-32 shrink-0 rounded-xl" />
      </div>
      <div className="flex flex-col divide-y divide-divider pt-2">
        {ROWS.map((index) => (
          <RowSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}
