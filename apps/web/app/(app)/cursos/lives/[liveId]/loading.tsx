import { Skeleton } from '@rede-social/ui';

/**
 * `/cursos/lives/[liveId]/loading.tsx` (2026-10-23): the member's live page while it loads
 * (`MemberLivePage`), a WIDE page like it (`data-shell-full`): the header bar, the media (16:10 edge
 * to edge on the phone; inset and rounded from `md`, 16:9 from `lg`), then the title, the date line
 * and the description's lines, and the state card (below on the phone, the right column from `lg`).
 * No words. The admin's live form shares the route and lands narrower; the page is what members open.
 */
export default function LiveLoading() {
  return (
    <div
      aria-busy
      data-testid="live-loading"
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
          className="aspect-[16/10] w-full rounded-none md:rounded-2xl lg:aspect-video"
        />
      </div>
      <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="flex flex-col gap-2 px-4 pt-4 md:pt-6">
          <Skeleton className="h-6 w-3/4 md:w-1/2" />
          <Skeleton className="h-4 w-1/2 md:w-1/3" />
          <Skeleton className="h-3 w-full md:max-w-2xl" />
        </div>
        <div className="px-4 pt-4 lg:pt-6">
          <Skeleton variant="rect" className="h-24 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
