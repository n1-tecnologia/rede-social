import { ProductCardSkeleton, ProductRowSkeleton } from '@rede-social/module-store/ui';
import { cn, MemberSkin, Skeleton } from '@rede-social/ui';
import { LIST_CARD_GRID, LIST_GRID_ITEM } from '../cursos/admin-styles';
import { ScreenHeaderSkeleton } from '../cursos/ScreenHeader';
import {
  PRODUCT_GRID,
  PRODUCT_GRID_FRAME,
  ROW_FIFTH,
  ROW_SIXTH,
  STORE_COLUMNS,
} from './store-styles';

/**
 * 2026-10-24 — the Loja's placeholders (the store redesign on the "área de membros"), each at its
 * screen's final geometry so nothing shifts when the content lands (UI-D-384). Wordless and hidden
 * from the tree. The wide screens' (`data-shell-wide`) carry the flag too, so the shell's column does
 * not jump from 680px to 1280px when the page replaces its loading view.
 */

/** The room from which the `index`-th card placeholder is drawn (2, 3, 4, 5 columns). */
function shownFrom(index: number, rows: number): string | undefined {
  if (index < rows * 2) return undefined;
  if (index < rows * 3) return 'hidden @min-[600px]:block';
  if (index < rows * 4) return 'hidden @min-[880px]:block';
  return 'hidden @min-[1200px]:block';
}

/**
 * `rows` whole rows of cards at EVERY width: the grid has 2, 3, 4 and then 5 columns by the room it
 * has (`PRODUCT_GRID`, inside its `@container` frame), so it draws `rows × 5` and hides the ones past
 * its rows.
 */
export function ProductGridSkeleton({ rows }: { rows: number }) {
  const cells = Array.from({ length: rows * 5 }, (_, index) => index);
  return (
    <div aria-hidden data-testid="store-grid-skeleton" className={PRODUCT_GRID_FRAME}>
      <div className={PRODUCT_GRID}>
        {cells.map((index) => (
          <ProductCardSkeleton key={index} className={shownFrom(index, rows)} />
        ))}
      </div>
    </div>
  );
}

/** `count` Gerenciar rows: in the outlined list card on a phone, one card each from `lg`. */
export function ProductRowsSkeleton({ count }: { count: number }) {
  const rows = Array.from({ length: count }, (_, index) => index);
  return (
    <div aria-hidden data-testid="store-rows-skeleton" className={LIST_CARD_GRID}>
      {rows.map((index) => (
        <div key={index} className={LIST_GRID_ITEM}>
          <ProductRowSkeleton />
        </div>
      ))}
    </div>
  );
}

/**
 * Produtos and Comprados while they load: the header, then the storefront's hero, tiles and one
 * shelf (`front`, Produtos since 2026-10-27) or two rows of posters (Comprados).
 */
export function StoreBrowseSkeleton({ front = false }: { front?: boolean }) {
  return (
    <MemberSkin>
      <div aria-busy data-shell-full className="mx-auto flex w-full flex-col">
        <ScreenHeaderSkeleton withAction={front} />
        {front ? (
          <StoreFrontSkeleton />
        ) : (
          <div className="pt-1 pb-6">
            <ProductGridSkeleton rows={2} />
          </div>
        )}
      </div>
    </MemberSkin>
  );
}

const SHELF_SKELETONS = [0, 1, 2, 3, 4, 5];
const TILE_SKELETONS = [0, 1, 2, 3, 4, 5];

/**
 * The storefront while it loads (2026-10-27, `StoreFront`): "Em destaque" (the large card and two
 * posters), the category tiles and one shelf, at their own geometry. No words.
 */
export function StoreFrontSkeleton() {
  return (
    <div
      aria-hidden
      data-testid="store-front-skeleton"
      className="flex flex-col gap-9 pt-2 pb-10 md:gap-12"
    >
      <div className="flex flex-col gap-2.5">
        <Skeleton className="mx-4 h-4 w-28" />
        <div className="@container px-4">
          <div className={cn('grid grid-cols-2 gap-3 @3xl:gap-4', STORE_COLUMNS)}>
            <Skeleton variant="rect" className="col-span-2 aspect-[7/4] w-full rounded-3xl" />
            <ProductCardSkeleton />
            <ProductCardSkeleton />
            <ProductCardSkeleton className="hidden @min-[1500px]:block" />
            <ProductCardSkeleton className="hidden @min-[1850px]:block" />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <Skeleton className="mx-4 h-4 w-24" />
        <div className="flex gap-3 overflow-hidden px-4">
          {TILE_SKELETONS.map((index) => (
            <Skeleton key={index} variant="rect" className="h-[104px] w-36 shrink-0 rounded-2xl" />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <Skeleton className="mx-4 h-4 w-24" />
        <div className="@container">
          <div
            className={cn('flex gap-3 overflow-hidden px-4 @3xl:grid @3xl:gap-4', STORE_COLUMNS)}
          >
            {SHELF_SKELETONS.map((index) => (
              <ProductCardSkeleton
                key={index}
                className={cn(
                  'w-[62%] shrink-0 @md:w-[40%] @3xl:w-auto',
                  index === 4 && ROW_FIFTH,
                  index === 5 && ROW_SIXTH,
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Gerenciar while it loads: the header with its filter and "Novo produto", then six rows. */
export function StoreManageSkeleton() {
  return (
    <div aria-busy data-shell-wide className="mx-auto flex w-full flex-col">
      <ScreenHeaderSkeleton withAction />
      <div className="px-4 pb-6">
        <ProductRowsSkeleton count={6} />
      </div>
    </div>
  );
}

/**
 * The product form while it loads (`/loja/novo`, `/loja/{id}/editar`): the 680px column the form
 * keeps (it is not a wide page), the header bar with the close control and the submit, the 4:5 image
 * box and the first fields. `data-shell-hide="nav"`, like the form, so the bar does not blink.
 */
export function ProductFormSkeleton() {
  return (
    <div aria-busy data-shell-hide="nav" className="mx-auto flex w-full max-w-[680px] flex-col">
      <div aria-hidden className="flex min-h-[52px] items-center justify-between gap-3 px-2">
        <Skeleton variant="circle" className="h-11 w-11" />
        <Skeleton variant="rect" width={140} className="h-5 rounded-md" />
        <Skeleton variant="rect" width={112} className="h-9 rounded-xl" />
      </div>
      <div aria-hidden className="flex flex-col gap-6 px-4 pt-4 pb-6">
        <Skeleton variant="rect" className="aspect-[4/5] h-auto w-full max-w-[240px] rounded-xl" />
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton variant="rect" width={96} className="h-3.5 rounded-md" />
            <Skeleton variant="rect" className="h-12 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
