import { cn, Skeleton } from '@rede-social/ui';

/**
 * The product tile's loading shape (UI-D-384), so a loaded tile replaces it without a layout shift.
 *
 * 2026-10-27 ("Vitrine de loja", the companion of `ProductCard`): the same card step for step, the
 * card with its hairline (16px, 24px from 260px), the inset 4:5 stage, then the name's two lines and
 * the price row with the arrow's circle at the foot, every size read from the tile's own width
 * (`@container`), as the tile does. A `className` for the host's grid (a placeholder hidden at one
 * width keeps the grid's rows whole). The bars carry `aria-hidden`; the frames announce nothing.
 */
export function ProductCardSkeleton({ className }: { className?: string } = {}) {
  return (
    <div data-testid="product-card-skeleton" className={cn('@container', className)}>
      <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card @min-[260px]:rounded-3xl">
        <div className="flex flex-1 flex-col p-[5px] @min-[200px]:p-1.5 @min-[260px]:p-2">
          <Skeleton
            variant="rect"
            className="aspect-[4/5] h-auto rounded-[10px] @min-[200px]:rounded-[9px] @min-[260px]:rounded-[15px]"
          />
          <div
            aria-hidden
            className="flex flex-1 flex-col px-1.5 pt-2.5 pb-1.5 @min-[200px]:px-2 @min-[200px]:pt-3 @min-[200px]:pb-2 @min-[260px]:px-2.5 @min-[260px]:pt-3.5 @min-[260px]:pb-2.5"
          >
            <div className="mt-auto flex flex-col gap-1.5 pt-1.5 @min-[200px]:gap-2 @min-[200px]:pt-2">
              <div className="flex flex-col gap-1.5">
                <Skeleton variant="text" className="h-3 w-4/5" />
                <Skeleton variant="text" className="h-3 w-1/2" />
              </div>
              <div className="flex h-6 items-center justify-between @min-[200px]:h-8 @min-[260px]:h-9">
                <Skeleton variant="text" className="h-4 w-2/5 @min-[200px]:h-5" />
                <Skeleton
                  variant="circle"
                  className="hidden size-7 @min-[150px]:block @min-[200px]:size-8 @min-[260px]:size-9"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
