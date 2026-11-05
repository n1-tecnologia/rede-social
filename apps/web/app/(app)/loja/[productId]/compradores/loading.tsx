import { Skeleton } from '@rede-social/ui';
import { ScreenHeaderSkeleton } from '../../../cursos/ScreenHeader';
import { BuyersSkeleton } from './BuyersList';

/**
 * `/loja/[productId]/compradores/loading.tsx` (UI-D-384, E14 loading). 2026-10-24 (the wide admin
 * look): the back row and the "Compradores" header, the toolbar's shape (two bars beside the 44px
 * "Conceder acesso" block) and 8 rows in the outlined list card, at the page's final geometry so
 * nothing shifts when the list swaps in. Wide (`data-shell-wide`), like the page. No words.
 */
export default function BuyersLoading() {
  return (
    <div aria-busy data-shell-wide className="mx-auto flex w-full flex-col pb-6">
      <ScreenHeaderSkeleton withBack />
      <div className="flex items-center justify-between gap-3 px-4 pb-4">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton variant="text" className="w-1/2" />
          <Skeleton variant="text" className="h-3 w-1/3" />
        </div>
        <Skeleton variant="rect" className="h-11 w-40 shrink-0 rounded-xl" />
      </div>
      <div className="px-4">
        <BuyersSkeleton count={8} />
      </div>
    </div>
  );
}
