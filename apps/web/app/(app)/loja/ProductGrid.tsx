'use client';

import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import type { ProductFilter } from '@rede-social/module-store/contracts';
import { ProductCard, ProductCardSkeleton } from '@rede-social/module-store/ui';
import { Button, EmptyState, InfiniteScroll, PullToRefresh } from '@rede-social/ui';
import { Archive, CircleAlert, ShoppingBag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useState } from 'react';
import type { ProductCardView } from '@/lib/store-view';
import { loadMoreProductsAction, refreshProductsAction } from './actions';

export interface ProductGridProps {
  /** Which list this is; the PAGE decides it on the server and remounts the grid per filter. */
  filter: ProductFilter;
  /** The composed `store.product.manage` permission (the manager empty state's CTA). */
  canManage: boolean;
  /** The tenant's display name (the grid region and the member empty state). */
  tenantName: string;
  /** The first page the SERVER rendered, as finished views. */
  initialItems: ProductCardView[];
  initialCursor: string | null;
  /** `true` when the server could not read the first page (E02 error). */
  initialError?: boolean;
}

/** The poster's `sizes`: two columns at every width, 322px each in the 680px column (D-351). */
const CARD_SIZES = '(min-width: 768px) 322px, 50vw';

/** The first row of posters loads eagerly; the rest are lazy. */
const EAGER_CARDS = 2;

const LINK_BRAND =
  'inline-flex h-11 items-center justify-center rounded-xl bg-button bg-(image:--button-image) px-5 text-sm font-bold text-on-button transition-colors hover:bg-button-hover hover:bg-(image:--button-image-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

const LINK_OUTLINE =
  'inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** One grid row of skeletons: what the load-more sentinel shows (UI-D-384). */
function NextRowSkeleton() {
  return (
    <div aria-busy className="grid grid-cols-2 gap-3 px-4">
      <ProductCardSkeleton />
      <ProductCardSkeleton />
    </div>
  );
}

/**
 * The `/loja` grid body (08.2-07, UI-D-367, UI-D-384), `CommunitiesList`'s state machine:
 * append-never-replace paging through the shipped `InfiniteScroll` sentinel, `PullToRefresh` on
 * mobile, and four states only: an unreadable first page (the error card with a retry), an empty
 * first page (the filter's own empty state, P19: never rendered from a failed page), the grid, and a
 * LOAD-MORE failure (an inline danger line plus a retry AT the sentinel; the loaded cards stay).
 *
 * Every card arrives as a finished view (price through `formatBrl`, the pill, the accessible name),
 * so nothing here formats or sorts (P21, P22): pages are appended in the API's order. The poster's
 * image is the host's `MediaImage` on the `cover` ladder; a failed image falls back to the plain
 * `bg-bg-tertiary` box under the same veil and text (E03 media).
 */
export function ProductGrid({
  filter,
  canManage,
  tenantName,
  initialItems,
  initialCursor,
  initialError,
}: ProductGridProps) {
  const t = useTranslations('store');

  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [firstLoadFailed, setFirstLoadFailed] = useState(Boolean(initialError));
  const [pageFailed, setPageFailed] = useState(false);

  // The SERVER sent a different first page (a navigation, not a refresh): re-seed rather than merge.
  const [seed, setSeed] = useState(initialItems);
  if (seed !== initialItems) {
    setSeed(initialItems);
    setItems(initialItems);
    setCursor(initialCursor);
    setFirstLoadFailed(Boolean(initialError));
    setPageFailed(false);
  }

  /** Page 1 again; the cards never become skeletons, so a pull shows only the brand loader. */
  const refresh = useCallback(async () => {
    try {
      const page = await refreshProductsAction(filter);
      if (!page.ok) {
        setFirstLoadFailed(items.length === 0);
        return;
      }
      setItems(page.items);
      setCursor(page.nextCursor);
      setFirstLoadFailed(false);
      setPageFailed(false);
    } catch (error) {
      console.error('store.refresh_failed', { error: String(error) });
      setFirstLoadFailed(items.length === 0);
    }
  }, [filter, items.length]);

  /** APPEND: every card already on screen keeps its order and its DOM position. */
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    try {
      const page = await loadMoreProductsAction(filter, cursor);
      if (!page.ok) {
        setPageFailed(true);
        return;
      }
      setPageFailed(false);
      setItems((previous) => {
        // A product can never show twice, even if a page boundary moved under a concurrent write.
        const seen = new Set(previous.map((item) => item.id));
        return [...previous, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setCursor(page.nextCursor);
    } catch (error) {
      // The sentinel hook swallows a rejection; without this catch a dead network would spin forever.
      console.error('store.load_more_failed', { error: String(error) });
      setPageFailed(true);
    }
  }, [cursor, filter]);

  /** Re-arms the sentinel (which is on screen under the retry) rather than fetching twice. */
  const retryPage = useCallback(() => setPageFailed(false), []);

  const retryFirst = useCallback(() => {
    setFirstLoadFailed(false);
    void refresh();
  }, [refresh]);

  let body: ReactNode;
  if (firstLoadFailed && items.length === 0) {
    body = (
      <div className="px-4">
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
      <div className="px-4">
        <EmptyState
          variant="card"
          icon={Archive}
          data-testid="store-empty-archived"
          title={t('list.archivedEmpty.title')}
          body={t('list.archivedEmpty.body')}
        />
      </div>
    );
  } else if (items.length === 0 && filter === 'owned') {
    body = (
      <div className="px-4">
        <EmptyState
          variant="card"
          icon={ShoppingBag}
          data-testid="store-empty-owned"
          title={t('list.ownedEmpty.title')}
          body={t('list.ownedEmpty.body')}
          action={
            <a href="/loja" className={LINK_OUTLINE}>
              {t('list.ownedEmpty.cta')}
            </a>
          }
        />
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className="px-4">
        <EmptyState
          variant="card"
          icon={ShoppingBag}
          data-testid="store-empty"
          title={t('list.empty.title')}
          body={
            canManage ? t('list.empty.bodyManager') : t('list.empty.body', { tenant: tenantName })
          }
          action={
            canManage ? (
              <a href="/loja/novo" className={LINK_BRAND}>
                {t('form.create')}
              </a>
            ) : undefined
          }
        />
      </div>
    );
  } else {
    body = (
      <>
        <ul
          aria-label={t('list.region', { tenant: tenantName })}
          data-testid="store-grid"
          className="grid grid-cols-2 gap-3 px-4"
        >
          {items.map((item, index) => (
            <li key={item.id}>
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

        {/* The sentinel stands down while a page is refused, so a failed page cannot spin. */}
        <InfiniteScroll
          hasMore={cursor !== null}
          enabled={!pageFailed}
          onLoadMore={loadMore}
          skeleton={<NextRowSkeleton />}
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
