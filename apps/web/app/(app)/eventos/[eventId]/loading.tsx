import { Card, Skeleton } from '@tria/ui';

/**
 * `/eventos/[eventId]/loading.tsx` (UI-D-216, UI E04/loading): a `PageHeader`-height bar, the 16/10
 * hero rect inside a `Card` and three 14px text bars, at the page's final geometry so nothing shifts
 * when the event swaps in. No words: the skeleton says nothing about the event it is waiting for.
 */
export default function EventLoading() {
  return (
    <div className="mx-auto w-full max-w-[680px] pb-6" aria-busy>
      <div className="flex h-[52px] items-center gap-2 px-2">
        <Skeleton variant="circle" className="h-11 w-11" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="px-4 pt-4">
        <Card>
          <Skeleton variant="rect" className="aspect-[16/10] h-auto rounded-none" />
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-11/12" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        </Card>
      </div>
    </div>
  );
}
