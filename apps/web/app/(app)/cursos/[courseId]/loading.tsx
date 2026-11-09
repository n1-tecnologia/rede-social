import { Skeleton } from '@rede-social/ui';

const BANDS = [0, 1];

/**
 * `/cursos/[courseId]/loading.tsx` (08.5-07, UI E05 loading; was UI-D-401): ONE skeleton valid for
 * both roles of the split route, at the 2026-10-22 geometry (the social-igoralves course page, whose
 * full-bleed hero the member and the admin pages now share): the header bar, the 16:10 hero edge to
 * edge, the tagline, the action block, the facts strip, a section title and two 16:6 module bands.
 * No words.
 *
 * 2026-10-23 (the wide desktop pages): a WIDE page like the two course pages it stands for
 * (`data-shell-full`): from `md` the hero is inset and rounded, panoramic (21:9) from `lg`, and from
 * `lg` the action block and the facts sit in the right column beside the sections. The lesson route
 * has its own skeleton (`aulas/[lessonId]/loading.tsx`, the player's frame).
 */
export default function CourseLoading() {
  return (
    <div
      aria-busy
      data-testid="course-loading"
      data-shell-full
      className="mx-auto flex w-full flex-col pb-6"
    >
      <div className="flex min-h-14 items-center gap-2 px-2 md:px-0">
        <Skeleton variant="circle" className="h-11 w-11 shrink-0" />
        <Skeleton className="h-4 w-1/2 md:w-1/3" />
      </div>
      <div className="md:px-4 md:pt-1">
        <Skeleton
          variant="rect"
          className="aspect-[16/10] w-full rounded-none md:rounded-2xl lg:aspect-[21/9]"
        />
      </div>
      <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr] lg:items-start xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-2 px-4 pt-4 lg:col-start-1 lg:row-start-1 lg:pt-6">
          <Skeleton className="h-4 w-3/4" />
        </div>
        <div className="flex flex-col lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:pt-2">
          <div className="flex flex-col gap-2 px-4 pt-4">
            <Skeleton variant="rect" className="h-2 w-full rounded-full" />
            <Skeleton variant="rect" className="h-11 w-full rounded-xl" />
          </div>
          <div className="px-4 pt-4">
            <Skeleton variant="rect" className="h-16 w-full rounded-xl" />
          </div>
        </div>
        <div className="flex flex-col gap-3 px-4 pt-7 lg:col-start-1 lg:row-start-2">
          <Skeleton className="h-4 w-1/3" />
          {BANDS.map((band) => (
            <Skeleton
              key={band}
              variant="rect"
              className="aspect-[16/6] w-full rounded-xl lg:aspect-[4/1]"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
