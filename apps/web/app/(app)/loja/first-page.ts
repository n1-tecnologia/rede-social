import {
  type ProductCard,
  type ProductFilter,
  type ProductPage,
  STORE_MAX_PAGE_SIZE,
} from '@rede-social/module-store/contracts';
import { notFound, redirect } from 'next/navigation';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { getProducts, STORE_MODULE_DISABLED } from '@/lib/store';

/**
 * 2026-10-24 — the first page of a store list, server-side (what `/loja/page.tsx` did inline before
 * the store became an area): a refusal the bootstrap knows navigates OUTSIDE the try/catch
 * (`redirect()` throws); a flag flip between the bootstrap and this read (`MODULE_DISABLED`) is the
 * store being off (UI-D-387, `notFound()`); anything else is the first-load error card (`null`).
 */
export async function readFirstProductPage(
  filter: ProductFilter,
  limit?: number,
): Promise<ProductPage | null> {
  let page: ProductPage | null = null;
  let path: string | null = null;
  let disabled = false;
  try {
    page = await getProducts({ filter, ...(limit ? { limit } : {}) });
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.status === 404 && error.code === STORE_MODULE_DISABLED) disabled = true;
      else path = bootstrapRedirectPath(error);
    }
    // Shape only: a product name is tenant content and never reaches a log line.
    if (!disabled && !path) {
      console.error('store.list_failed', {
        ...(error instanceof ApiClientError
          ? { status: error.status, code: error.code }
          : { error: String(error) }),
      });
    }
  }
  if (path) redirect(path);
  if (disabled) notFound();
  return page;
}

/** The storefront reads every active product, up to this many pages of 50. */
const CATALOG_PAGES = 4;

/**
 * 2026-10-27 — the storefront's whole catalogue (its hero, categories and shelves group and order
 * the products on the server, so it reads them all, not a first page): the `all` list page after
 * page, newest first, with the first page's refusals as `readFirstProductPage` answers them. A
 * failed LATER page keeps what already arrived.
 */
export async function readStoreCatalog(): Promise<ProductCard[] | null> {
  const first = await readFirstProductPage('all', STORE_MAX_PAGE_SIZE);
  if (first === null) return null;
  const items = [...first.items];
  let cursor = first.nextCursor;
  for (let page = 1; page < CATALOG_PAGES && cursor; page += 1) {
    // Keyset pages, one after the other: each needs the cursor the previous one answered.
    const next: ProductPage | null = await getProducts({
      filter: 'all',
      limit: STORE_MAX_PAGE_SIZE,
      cursor,
    }).catch(() => null);
    if (!next) break;
    items.push(...next.items);
    cursor = next.nextCursor;
  }
  return items.filter((item) => item.status === 'active');
}
