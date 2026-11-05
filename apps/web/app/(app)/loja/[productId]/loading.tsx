import { MemberSkin, Skeleton } from '@rede-social/ui';
import type { CSSProperties } from 'react';

/** The page's image column cap from `xl` (`page.tsx`), so the placeholder lands where the image will. */
const IMAGE_COLUMN = {
  '--product-image-col': 'min(560px, calc((var(--screen-h) - 8rem) * 0.8))',
} as CSSProperties;

/**
 * `/loja/[productId]/loading.tsx` (UI-D-384, E04 loading). 2026-10-24 (the "Imagem ao lado" product
 * page): the header bar, then the page's grid at its final geometry so nothing shifts when the
 * product swaps in. On a phone the 4:5 image rect (up to 440px) over the overline, name and price
 * bars and the 52px action block; from `lg` the image on the left and the bars on the right. At
 * the member area's full width (`data-shell-full`, 2026-10-27), like the page. No words.
 */
export default function ProductLoading() {
  return (
    <MemberSkin>
      <div aria-busy data-shell-full className="mx-auto flex w-full flex-col pb-6">
        <div className="flex min-h-[52px] items-center gap-2 border-b border-border px-2 md:px-0">
          <Skeleton variant="circle" className="h-11 w-11" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <div
          style={IMAGE_COLUMN}
          className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-x-8 lg:px-4 lg:pt-2 xl:grid-cols-[minmax(0,var(--product-image-col))_minmax(0,1fr)] xl:gap-x-12"
        >
          <div className="px-4 pt-4 lg:px-0 lg:pt-0">
            <Skeleton
              variant="rect"
              className="mx-auto aspect-[4/5] h-auto w-full max-w-[440px] rounded-3xl lg:max-w-none"
            />
          </div>
          <div className="flex flex-col gap-4 px-4 pt-5 lg:px-0 lg:pt-1">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-7 w-3/4" />
            <Skeleton className="h-7 w-28" />
            <Skeleton variant="rect" className="h-13 rounded-xl" />
          </div>
        </div>
      </div>
    </MemberSkin>
  );
}
