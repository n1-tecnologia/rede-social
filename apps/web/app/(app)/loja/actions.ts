'use server';

import { type ProductFilter, productListQuerySchema } from '@rede-social/module-store/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { getProducts } from '@/lib/store';
import { type ProductCardView, productCardView } from '@/lib/store-view';

/**
 * The `/loja` grid's paging and refresh (08.2-07, STORE-05), in the `comunidades/actions.ts`
 * conventions: the SAME Zod the API validates with runs BEFORE the request (a server action is a
 * public endpoint), a 401/403 refusal the bootstrap knows becomes a navigation OUTSIDE the try/catch
 * (Next 16: `redirect()` throws), and any other refusal is a code the client maps to catalog copy.
 *
 * Both return FINISHED card views (price through `formatBrl`, the pills, the accessible names), so
 * the client grid formats nothing and the first page and every next page share one formatter.
 *
 * The cursor is OPAQUE: forwarded exactly as the previous page returned it (the API refuses a
 * tampered one). `archived` asked without `store.product.manage` is the API's 403: the page never
 * sends it, and a crafted call lands on the generic failure.
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

export type ProductsPageResult =
  | { ok: true; items: ProductCardView[]; nextCursor: string | null }
  | { ok: false; code: 'generic' };

async function readPage(filter: ProductFilter, cursor?: string): Promise<ProductsPageResult> {
  const query = productListQuerySchema.safeParse(
    cursor === undefined ? { filter } : { filter, cursor },
  );
  if (!query.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: ProductsPageResult = { ok: false, code: 'generic' };
  try {
    const [page, t] = await Promise.all([
      getProducts({
        filter: query.data.filter,
        cursor: query.data.cursor,
        limit: query.data.limit,
      }),
      getTranslations(),
    ]);
    const managerArchived = query.data.filter === 'archived';
    result = {
      ok: true,
      items: page.items.map((product) => productCardView(product, t, { managerArchived })),
      nextCursor: page.nextCursor,
    };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    // Shape only: a product name is tenant content and never reaches a log line.
    if (!refusal) {
      console.error('store.page_failed', {
        ...(error instanceof ApiClientError
          ? { status: error.status, code: error.code }
          : { error: String(error) }),
      });
    }
  }

  if (refusal) redirect(refusal);
  return result;
}

/** One more page of the grid, APPENDED by the client (never replaces, P21). */
export async function loadMoreProductsAction(
  filter: ProductFilter,
  cursor: string,
): Promise<ProductsPageResult> {
  return readPage(filter, cursor);
}

/** Page 1 again: what `PullToRefresh` and the first-load retry call. */
export async function refreshProductsAction(filter: ProductFilter): Promise<ProductsPageResult> {
  return readPage(filter);
}
