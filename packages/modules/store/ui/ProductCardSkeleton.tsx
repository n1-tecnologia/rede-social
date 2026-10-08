import { Skeleton } from '@rede-social/ui';

/**
 * The poster's loading shape (UI-D-384): one `Skeleton` rect in the SAME 4:5 box and radius as
 * `ProductCard`, so a loaded card replaces it without a layout shift. Used by `/loja/loading.tsx`
 * (4 of them), a filter change (4) and the load-more sentinel (2, one grid row).
 */
export function ProductCardSkeleton() {
  return (
    <div data-testid="product-card-skeleton">
      <Skeleton variant="rect" className="aspect-[4/5] h-auto rounded-xl" />
    </div>
  );
}
