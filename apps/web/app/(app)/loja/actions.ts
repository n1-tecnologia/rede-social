'use server';

import { priceCentsSchema } from '@rede-social/contracts/money';
import {
  type ProductCommunity,
  type ProductFilter,
  productListQuerySchema,
} from '@rede-social/module-store/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { getProducts, type PurchaseRefusal, purchaseProduct } from '@/lib/store';
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

export type PurchaseActionResult =
  | { status: 'ok'; communities: ProductCommunity[] }
  | { status: 'refused'; reason: PurchaseRefusal }
  | { status: 'gone' }
  | { status: 'disabled' }
  | { status: 'error' };

/** What the client may send: the product and the price the page showed it, nothing else. */
const purchaseInputSchema = z
  .object({ productId: z.uuid(), expectedAmountCents: priceCentsSchema })
  .strict();

/**
 * The product page's purchase (08.2-08, D-358, STORE-07/08, UI-D-371). A server action is a public
 * endpoint, so both arguments are validated BEFORE any request: the id must be a uuid and the
 * amount an integer price (`priceCentsSchema`, the API's own). `expectedAmountCents` is the
 * `priceCents` the page rendered (P26): a staleness check the API compares with the product row,
 * never an amount to charge (T-08.2-35); a mismatch is the 409 `price_changed` refusal, which buys
 * nothing.
 *
 * A first purchase and an `owned` replay both answer `ok` with the product's active communities
 * (P27). A refusal the bootstrap knows (401, blocked, suspended…) navigates OUTSIDE the try/catch
 * (Next 16: `redirect()` throws); every other outcome is a code the client maps to catalog copy.
 */
export async function purchaseProductAction(
  productId: string,
  expectedAmountCents: number,
): Promise<PurchaseActionResult> {
  const input = purchaseInputSchema.safeParse({ productId, expectedAmountCents });
  if (!input.success) return { status: 'error' };

  const outcome = await purchaseProduct(input.data.productId, input.data.expectedAmountCents);
  if (outcome.status === 'redirect') redirect(outcome.path);
  // No `revalidatePath` here: it would re-render the product page inside this action's response,
  // replacing "Comprar" (and the dialog it owns) with the owned block before the success step can
  // show. The store pages are dynamic (no router cache for them), and the control refreshes the
  // page itself when the success step closes.
  return outcome;
}
