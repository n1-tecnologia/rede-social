'use client';

import type { ProductFilter } from '@rede-social/module-store/contracts';
import { useCallback, useState } from 'react';
import type { ProductCardView } from '@/lib/store-view';
import type { ProductsPageResult } from './actions';

/** The two server actions a list pages through (browse or manage, `actions.ts`). */
export interface ProductPagesActions {
  refresh: (filter: ProductFilter) => Promise<ProductsPageResult>;
  loadMore: (filter: ProductFilter, cursor: string) => Promise<ProductsPageResult>;
}

/**
 * 2026-10-24 — the store lists' paging machine, moved unchanged out of `ProductGrid` so the posters
 * of Produtos and Comprados and the rows of Gerenciar share it (`CommunitiesList`'s machine):
 * append-never-replace paging, a pull to refresh that never turns the cards into skeletons, and the
 * four states (an unreadable first page, an empty one, the list, a LOAD-MORE failure that keeps the
 * loaded items). A new first page from the SERVER (a navigation, not a refresh) re-seeds instead of
 * merging; a product can never show twice. `actions` must be a stable object (a module constant).
 */
export function useProductPages({
  filter,
  initialItems,
  initialCursor,
  initialError,
  actions,
}: {
  filter: ProductFilter;
  initialItems: ProductCardView[];
  initialCursor: string | null;
  initialError?: boolean;
  actions: ProductPagesActions;
}) {
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

  /** Page 1 again; the items never become skeletons, so a pull shows only the brand loader. */
  const refresh = useCallback(async () => {
    try {
      const page = await actions.refresh(filter);
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
  }, [actions, filter, items.length]);

  /** APPEND: every item already on screen keeps its order and its DOM position. */
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    try {
      const page = await actions.loadMore(filter, cursor);
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
  }, [actions, cursor, filter]);

  /** Re-arms the sentinel (which is on screen under the retry) rather than fetching twice. */
  const retryPage = useCallback(() => setPageFailed(false), []);

  const retryFirst = useCallback(() => {
    setFirstLoadFailed(false);
    void refresh();
  }, [refresh]);

  return { items, cursor, firstLoadFailed, pageFailed, refresh, loadMore, retryPage, retryFirst };
}
