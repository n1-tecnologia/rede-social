import { Skeleton } from '@rede-social/ui';
import { BuyersSkeleton } from './BuyersList';

/**
 * `/loja/[productId]/compradores/loading.tsx` (UI-D-384, E14 loading): a `PageHeader`-height bar,
 * the toolbar's shape (two bars beside the 36px "Conceder acesso" block) and 8 rows in the
 * `AttendeeRow` geometry, at the page's final geometry so nothing shifts when the list swaps in.
 * No words.
 */
export default function BuyersLoading() {
  return (
    <div className="mx-auto w-full max-w-[680px] pb-6" aria-busy>
      <div className="flex h-[52px] items-center gap-2 px-2">
        <Skeleton variant="circle" className="h-11 w-11" />
        <Skeleton className="h-4 w-1/3" />
      </div>
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton variant="text" className="w-1/2" />
          <Skeleton variant="text" className="h-3 w-1/3" />
        </div>
        <Skeleton variant="rect" className="h-9 w-36 shrink-0 rounded-xl" />
      </div>
      <BuyersSkeleton count={8} />
    </div>
  );
}
