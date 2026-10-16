import { Skeleton } from '@rede-social/ui';

const BANDS = [0, 1];

/**
 * `/cursos/[courseId]/loading.tsx` (08.5-07, UI E05 loading; was UI-D-401): ONE skeleton valid for
 * both roles of the split route — the header bar, the 16:10 hero rect, two text bars (title,
 * tagline), the action block and two 16:6 module band rects. The member page's geometry; the admin
 * page swaps in over the same column. No words.
 */
export default function CourseLoading() {
  return (
    <div
      aria-busy
      data-testid="course-loading"
      className="mx-auto flex w-full max-w-[680px] flex-col pb-6"
    >
      <div className="flex min-h-14 items-center gap-2 px-2">
        <Skeleton variant="circle" className="h-11 w-11 shrink-0" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <Skeleton variant="rect" className="aspect-[16/10] w-full" />
      <div className="flex flex-col gap-2 px-4 pt-4">
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="px-4 pt-4">
        <Skeleton variant="rect" className="h-20 w-full rounded-xl" />
      </div>
      <div className="flex flex-col gap-3 px-4 pt-6">
        <Skeleton className="h-4 w-1/3" />
        {BANDS.map((band) => (
          <Skeleton key={band} variant="rect" className="aspect-[16/6] w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
