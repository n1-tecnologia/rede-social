'use client';

import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import type { ProductFilter } from '@rede-social/module-store/contracts';
import { ProductCard } from '@rede-social/module-store/ui';
import { Button, InfiniteScroll, PullToRefresh } from '@rede-social/ui';
import { CircleAlert, ShoppingBag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { STORE_PATH } from '@/lib/store-area';
import type { ProductCardView } from '@/lib/store-view';
import { OUTLINE_LINK } from '../cursos/admin-styles';
import { MEMBER_EMPTY_WIDE, MemberEmptyCard } from '../cursos/MemberEmptyCard';
import { loadMoreProductsAction, refreshProductsAction } from './actions';
import { ProductGridSkeleton } from './StoreSkeletons';
import { CARD_SIZES, PRODUCT_GRID, PRODUCT_GRID_FRAME } from './store-styles';
import { type ProductPagesActions, useProductPages } from './useProductPages';

export interface ProductGridProps {
  /** Which list this is: Produtos (`all`) or Comprados (`owned`); the SCREEN remounts the grid per filter. */
  filter: Extract<ProductFilter, 'all' | 'owned'>;
  /** The tenant's display name (the grid region and the empty state). */
  tenantName: string;
  /** The first page the SERVER rendered, as finished views. */
  initialItems: ProductCardView[];
  initialCursor: string | null;
  /** `true` when the server could not read the first page (E02 error). */
  initialError?: boolean;
}

/** The browse screens' paging: the member's view, for a manager too (`actions.ts`). */
const BROWSE_ACTIONS: ProductPagesActions = {
  refresh: refreshProductsAction,
  loadMore: loadMoreProductsAction,
};

/** The first row of cards (up to five in the wide frame) loads eagerly; the rest are lazy. */
const EAGER_CARDS = 5;

/**
 * The poster grid of Produtos and Comprados (08.2-07, UI-D-367, UI-D-384), on the shared paging
 * machine (`useProductPages`): append-never-replace paging through the `InfiniteScroll` sentinel,
 * `PullToRefresh` on mobile, and four states only: an unreadable first page (the error card with a
 * retry), an empty first page (the screen's own empty card, P19: never rendered from a failed page),
 * the grid, and a LOAD-MORE failure (an inline danger line plus a retry AT the sentinel; the loaded
 * cards stay).
 *
 * Every card arrives as a finished view (price through `formatBrl`, the pill, the accessible name),
 * so nothing here formats or sorts (P21, P22): pages are appended in the API's order.
 *
 * **2026-10-24 (the Loja redesign on the "área de membros", then the e-commerce card).** Two cards a
 * row on a phone and three, four and five as the room grows (`PRODUCT_GRID` reads its own width, a
 * container, so the rail never squeezes a card), entering with the area's swap; each card prints the
 * product tile (the image with its glass panel: the name and the price). The empty and error
 * states are the area's
 * `MemberEmptyCard`. Browse only: Gerenciar's rows are `ProductsManageList`, so this grid never draws
 * a manager's pill (no create call to action either, the screen is the member's for everyone).
 */
export function ProductGrid({
  filter,
  tenantName,
  initialItems,
  initialCursor,
  initialError,
}: ProductGridProps) {
  const t = useTranslations('store');
  const { items, cursor, firstLoadFailed, pageFailed, refresh, loadMore, retryPage, retryFirst } =
    useProductPages({ filter, initialItems, initialCursor, initialError, actions: BROWSE_ACTIONS });

  let body: ReactNode;
  if (firstLoadFailed && items.length === 0) {
    body = (
      <div className="px-4 pt-2">
        <MemberEmptyCard
          icon={CircleAlert}
          tone="error"
          data-testid="store-error"
          className={MEMBER_EMPTY_WIDE}
          title={t('errors.title')}
          body={t('errors.list')}
          action={
            <Button variant="outline" onClick={retryFirst}>
              {t('errors.retry')}
            </Button>
          }
        />
      </div>
    );
  } else if (items.length === 0 && filter === 'owned') {
    body = (
      <div className="px-4 pt-2">
        <MemberEmptyCard
          icon={ShoppingBag}
          data-testid="store-empty-owned"
          className={MEMBER_EMPTY_WIDE}
          title={t('list.ownedEmpty.title')}
          body={t('list.ownedEmpty.body')}
          action={
            <a href={STORE_PATH} className={OUTLINE_LINK}>
              {t('list.ownedEmpty.cta')}
            </a>
          }
        />
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className="px-4 pt-2">
        <MemberEmptyCard
          icon={ShoppingBag}
          data-testid="store-empty"
          className={MEMBER_EMPTY_WIDE}
          title={t('list.empty.title')}
          body={t('list.empty.body', { tenant: tenantName })}
        />
      </div>
    );
  } else {
    body = (
      <>
        <div className={`${PRODUCT_GRID_FRAME} pt-1`}>
          <ul
            aria-label={t('list.region', { tenant: tenantName })}
            data-testid="store-grid"
            className={`${PRODUCT_GRID} animate-swap-in motion-reduce:animate-none`}
          >
            {items.map((item, index) => (
              <li key={item.id} className="min-w-0">
                <ProductCard
                  href={item.href}
                  ariaLabel={item.ariaLabel}
                  name={item.name}
                  priceLabel={item.priceLabel}
                  pill={item.pill}
                  imageSlot={
                    item.imageAssetId ? (
                      <MediaImage
                        assetId={item.imageAssetId}
                        widths={PURPOSE_WIDTHS.cover}
                        alt={item.imageAlt}
                        sizes={CARD_SIZES}
                        eager={index < EAGER_CARDS}
                        ratio=""
                        className="h-full w-full"
                      />
                    ) : undefined
                  }
                />
              </li>
            ))}
          </ul>
        </div>

        {/* The sentinel stands down while a page is refused, so a failed page cannot spin. */}
        <InfiniteScroll
          hasMore={cursor !== null}
          enabled={!pageFailed}
          onLoadMore={loadMore}
          skeleton={<ProductGridSkeleton rows={1} />}
          className="mt-3"
        />

        {pageFailed ? (
          <div
            role="alert"
            data-store-page-error
            className="mt-3 flex flex-col items-center gap-3 px-4 text-center"
          >
            <p className="text-sm font-normal text-danger">{t('errors.loadMore')}</p>
            <Button variant="outline" onClick={retryPage}>
              {t('errors.retry')}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <PullToRefresh onRefresh={refresh}>
      <section className="flex flex-col pb-6">{body}</section>
    </PullToRefresh>
  );
}
