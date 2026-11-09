import { Skeleton } from '@rede-social/ui';

const ROWS = [0, 1, 2];

/**
 * `/cursos/[courseId]/aulas/[lessonId]/loading.tsx` (2026-10-23): the member player's frame while the
 * lesson loads (`MemberLessonPage`), a WIDE page like it (`data-shell-full`): the header bar, the 16:9
 * stage (edge to edge on the phone, inset and rounded from `md`), the title and the meta line, the
 * description's lines, and "Neste módulo" (below on the phone, the right column from `xl`). No words.
 * The admin's lesson form shares the route and lands narrower; the player is what members open.
 */
export default function LessonLoading() {
  return (
    <div
      aria-busy
      data-testid="lesson-loading"
      data-shell-full
      className="mx-auto flex w-full flex-col pb-6"
    >
      <div className="flex min-h-14 items-center gap-2 px-2 md:px-0">
        <Skeleton variant="circle" className="h-11 w-11 shrink-0" />
        <Skeleton className="h-4 w-1/2 md:w-1/3" />
      </div>
      <div className="md:px-4 md:pt-1">
        <Skeleton variant="rect" className="aspect-video w-full rounded-none md:rounded-2xl" />
      </div>
      <div className="flex flex-col xl:grid xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
        <div className="flex flex-col gap-3 px-4 pt-4 md:pt-6">
          <Skeleton className="h-6 w-3/4 md:w-1/2" />
          <Skeleton className="h-4 w-1/2 md:w-1/4" />
          <Skeleton className="h-3 w-full md:max-w-3xl" />
          <Skeleton className="h-3 w-5/6 md:max-w-2xl" />
        </div>
        <div className="flex flex-col gap-2 px-4 pt-7 xl:pt-6">
          <Skeleton className="h-4 w-1/3" />
          {ROWS.map((row) => (
            <Skeleton key={row} variant="rect" className="h-16 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
