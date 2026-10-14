import { Skeleton } from '@rede-social/ui';

const MODULES = [0, 1];
const LESSONS = [0, 1];

/**
 * `/cursos/[courseId]/loading.tsx` (UI-D-401, E05 loading): the header bar, the 16:10 hero rect, two
 * text bars (title, tagline), the action block and two module cards with two lesson rows each, at
 * the page's final geometry so nothing shifts when the course swaps in. No words.
 */
export default function CourseLoading() {
  return (
    <div aria-busy className="mx-auto flex w-full max-w-[680px] flex-col pb-6">
      <div className="flex min-h-14 items-center gap-2 px-2">
        <Skeleton variant="circle" className="h-11 w-11 shrink-0" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="flex flex-col gap-4 px-4 pt-2">
        <Skeleton variant="rect" className="aspect-[16/10] w-full rounded-xl" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <div className="flex gap-2">
          <Skeleton variant="rect" className="h-6 w-20 rounded-full" />
          <Skeleton variant="rect" className="h-6 w-20 rounded-full" />
        </div>
        <Skeleton variant="rect" className="h-20 w-full rounded-xl" />
        <div className="flex items-center justify-between gap-3 pt-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton variant="rect" className="h-9 w-28 rounded-xl" />
        </div>
        {MODULES.map((module) => (
          <div key={module} className="overflow-hidden rounded-xl bg-card">
            <div className="flex min-h-14 items-center gap-3 px-3 py-2">
              <Skeleton variant="rect" className="h-8 w-8 shrink-0 rounded-lg" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
            <div className="flex flex-col divide-y divide-divider border-t border-divider">
              {LESSONS.map((lesson) => (
                <div key={lesson} className="flex min-h-14 items-center gap-3 px-3 py-2">
                  <Skeleton variant="rect" className="w-16 shrink-0 rounded-lg aspect-video" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
