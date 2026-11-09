'use client';

import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import type { ProductFilter } from '@rede-social/module-store/contracts';
import { ProductRow } from '@rede-social/module-store/ui';
import { Button, EmptyState, InfiniteScroll, PullToRefresh } from '@rede-social/ui';
import { Archive, CircleAlert, ShoppingBag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { ProductCardView } from '@/lib/store-view';
import { LIST_CARD_GRID, LIST_GRID_ITEM, OUTLINE_LINK, WIDE_EMPTY } from '../cursos/admin-styles';
import { loadMoreManagedProductsAction, refreshManagedProductsAction } from './actions';
import { ProductRowsSkeleton } from './StoreSkeletons';
import { type ProductPagesActions, useProductPages } from './useProductPages';

export interface ProductsManageListProps {
  /** Gerenciar's list: the active products (`all`) or the archived ones; the screen remounts per list. */
  filter: Extract<ProductFilter, 'all' | 'archived'>;
  /** The tenant's display name (the list region's name). */
  tenantName: string;
  /** The first page the SERVER rendered, as finished views. */
  initialItems: ProductCardView[];
  initialCursor: string | null;
  /** `true` when the server could not read the first page. */
  initialError?: boolean;
}

/** Gerenciar's paging: a manager's rows only, refused to anyone else on the server (`actions.ts`). */
const MANAGE_ACTIONS: ProductPagesActions = {
  refresh: refreshManagedProductsAction,
  loadMore: loadMoreManagedProductsAction,
};

/** The 48px thumb: one rung is enough, the ladder starts at 640. */
const THUMB_SIZES = '48px';

/** The first rows load eagerly; the rest are lazy. */
const EAGER_ROWS = 4;

/** The gradient thumb a failed image falls back to, the same size as the row's box (D-69). */
const GRADIENT_THUMB = (
  <span
    aria-hidden
    className="block h-full w-full"
    style={{ backgroundImage: 'var(--brand-gradient)' }}
  />
);

/**
 * 2026-10-24 — Gerenciar's rows (the courses admin lists' `CoursesList`, on the store's shared paging
 * machine `useProductPages`): one outlined list card with hairlines between the rows on a phone and
 * up to `lg`, then one outlined card per product in a grid (two columns, three from `2xl`,
 * `LIST_CARD_GRID`). Each row (`ProductRow`) is the product's 4:5 thumb, its name, its price and the
 * catalogue's pill ("Arquivado", "Sem link de pagamento") and opens the product page, whose
 * "Gerenciar produto" card leads to the buyers and the form (its "Voltar" returns here by history).
 *
 * The empty and error cards are the admin lists' `EmptyState` cards at a readable width
 * (`WIDE_EMPTY`): the active list's empty card offers "Criar produto" as an outline link (the
 * header's "Novo produto" is the screen's one brand fill).
 */
export function ProductsManageList({
  filter,
  tenantName,
  initialItems,
  initialCursor,
  initialError,
}: ProductsManageListProps) {
  const t = useTranslations('store');
  const { items, cursor, firstLoadFailed, pageFailed, refresh, loadMore, retryPage, retryFirst } =
    useProductPages({ filter, initialItems, initialCursor, initialError, actions: MANAGE_ACTIONS });

  let body: ReactNode;
  if (firstLoadFailed && items.length === 0) {
    body = (
      <div className={WIDE_EMPTY}>
        <EmptyState
          variant="card"
          icon={CircleAlert}
          data-testid="store-error"
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
  } else if (items.length === 0 && filter === 'archived') {
    body = (
      <div className={WIDE_EMPTY}>
        <EmptyState
          variant="card"
          icon={Archive}
          data-testid="store-empty-archived"
          title={t('list.archivedEmpty.title')}
          body={t('list.archivedEmpty.body')}
        />
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className={WIDE_EMPTY}>
        <EmptyState
          variant="card"
          icon={ShoppingBag}
          data-testid="store-empty"
          title={t('list.empty.title')}
          body={t('list.empty.bodyManager')}
          action={
            <a href="/loja/novo" className={OUTLINE_LINK}>
              {t('form.create')}
            </a>
          }
        />
      </div>
    );
  } else {
    body = (
      <>
        <ol
          aria-label={t('list.region', { tenant: tenantName })}
          data-testid="store-manage-list"
          className={LIST_CARD_GRID}
        >
          {items.map((item, index) => (
            <li key={item.id} className={LIST_GRID_ITEM}>
              <ProductRow
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
                      sizes={THUMB_SIZES}
                      eager={index < EAGER_ROWS}
                      ratio=""
                      className="h-full w-full"
                      fallback={GRADIENT_THUMB}
                    />
                  ) : undefined
                }
              />
            </li>
          ))}
        </ol>

        {/* The sentinel stands down while a page is refused, so a failed page cannot spin. */}
        <InfiniteScroll
          hasMore={cursor !== null}
          enabled={!pageFailed}
          onLoadMore={loadMore}
          skeleton={
            <div aria-busy className="mt-3">
              <ProductRowsSkeleton count={3} />
            </div>
          }
        />

        {pageFailed ? (
          <div
            role="alert"
            data-store-page-error
            className="mt-3 flex flex-col items-center gap-3 text-center"
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
      <div className="flex flex-col pb-6">{body}</div>
    </PullToRefresh>
  );
}
