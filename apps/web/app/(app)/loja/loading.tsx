import { ProductCardSkeleton } from '@rede-social/module-store/ui';
import { Skeleton } from '@rede-social/ui';

const CARDS = [0, 1, 2, 3];

/**
 * `/loja/loading.tsx` (UI-D-384, E02 loading): the title-row and chip-row shapes, then 4 poster
 * skeletons in the two-column grid, at the page's final geometry so nothing shifts when the cards
 * swap in. A chip switch is a navigation, so it shows these same 4 skeletons while it is pending.
 * No words: the skeleton says nothing about the list it is waiting for.
 */
export default function StoreLoading() {
  return (
    <div aria-busy className="mx-auto flex w-full max-w-[680px] flex-col">
      <div className="flex flex-col gap-2 px-4 pt-4 pb-3">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <div className="flex gap-2 px-4 pb-3">
        <Skeleton className="h-[30px] w-16 rounded-full" />
        <Skeleton className="h-[30px] w-24 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 px-4 pb-6">
        {CARDS.map((index) => (
          <ProductCardSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}
