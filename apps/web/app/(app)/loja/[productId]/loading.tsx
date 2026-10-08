import { Skeleton } from '@rede-social/ui';

/**
 * `/loja/[productId]/loading.tsx` (UI-D-384, E04 loading): a `PageHeader`-height bar, the 4:5 image
 * rect capped at 400px, a 24px bar for the price and a 44px `rounded-xl` block for the action, at
 * the page's final geometry so nothing shifts when the product swaps in. No words.
 */
export default function ProductLoading() {
  return (
    <div className="mx-auto w-full max-w-[680px] pb-6" aria-busy>
      <div className="flex h-[52px] items-center gap-2 px-2">
        <Skeleton variant="circle" className="h-11 w-11" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="flex flex-col gap-6 px-4 pt-4">
        <Skeleton
          variant="rect"
          className="mx-auto aspect-[4/5] h-auto w-full max-w-[400px] rounded-xl"
        />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-6 w-28" />
          <Skeleton variant="rect" className="h-11 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
