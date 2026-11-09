'use server';

import { priceCentsSchema } from '@rede-social/contracts/money';
import {
  type ProductCommunity,
  type ProductFilter,
  type ProductUnlockCourse,
  type ProductUnlockLive,
  productListQuerySchema,
  STORE_PERMISSIONS,
} from '@rede-social/module-store/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { ApiClientError, bootstrapRedirectPath, requireBootstrap } from '@/lib/bootstrap';
import { getProducts, type PurchaseRefusal, purchaseProduct } from '@/lib/store';
import { type ProductCardView, productCardView, productManageView } from '@/lib/store-view';

/**
 * The store lists' paging and refresh (08.2-07, STORE-05), in the `comunidades/actions.ts`
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
 * **2026-10-24 (the Loja area): two surfaces.** The BROWSE actions page Produtos (`all`) and Comprados
 * (`owned`) as a member sees them, for a manager too: never the archived pill, never the manager-only
 * "no payment link" pill (before, a manager's page 2 of the old one-screen grid carried it). The
 * MANAGE actions page Gerenciar's rows (`all` as the active list, `archived`) for a caller holding
 * `store.product.manage`, read from the server-side bootstrap; anyone else is refused BEFORE any read.
 * Each surface answers only its own filters; another is the generic failure.
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

export type ProductsPageResult =
  | { ok: true; items: ProductCardView[]; nextCursor: string | null }
  | { ok: false; code: 'generic' };

/** Which list asks: the member's screens (`browse`) or the manager's Gerenciar (`manage`). */
type Surface = 'browse' | 'manage';

/** The filters each surface may read. */
const SURFACE_FILTERS: Record<Surface, ReadonlyArray<ProductFilter>> = {
  browse: ['all', 'owned'],
  manage: ['all', 'archived'],
};

async function readPage(
  surface: Surface,
  filter: ProductFilter,
  cursor?: string,
): Promise<ProductsPageResult> {
  if (!SURFACE_FILTERS[surface].includes(filter)) return { ok: false, code: 'generic' };
  const query = productListQuerySchema.safeParse(
    cursor === undefined ? { filter } : { filter, cursor },
  );
  if (!query.success) return { ok: false, code: 'generic' };

  // 09.1-17 (UI-D-525, A-P31, T-09.1-82): whether the viewer manages the store is read HERE from the
  // server-side bootstrap, never taken from an argument, so a forged call cannot reveal the
  // manager-only "no payment link" pill. `requireBootstrap` navigates (`redirect()` throws), so it
  // runs OUTSIDE the try/catch below.
  const bootstrap = await requireBootstrap();
  const canManage = bootstrap.permissions.includes(STORE_PERMISSIONS.manage);
  // Gerenciar's rows are a manager's: refused before the API is asked anything.
  if (surface === 'manage' && !canManage) return { ok: false, code: 'generic' };

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
    const archived = query.data.filter === 'archived';
    result = {
      ok: true,
      items: page.items.map((product) =>
        surface === 'manage'
          ? productManageView(product, t, { archived, canManage })
          : productCardView(product, t, { managerArchived: false }),
      ),
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

/** One more page of Produtos or Comprados, APPENDED by the client (never replaces, P21). */
export async function loadMoreProductsAction(
  filter: ProductFilter,
  cursor: string,
): Promise<ProductsPageResult> {
  return readPage('browse', filter, cursor);
}

/** Page 1 again: what `PullToRefresh` and the first-load retry call. */
export async function refreshProductsAction(filter: ProductFilter): Promise<ProductsPageResult> {
  return readPage('browse', filter);
}

/** 2026-10-24: one more page of Gerenciar's rows (a manager's only). */
export async function loadMoreManagedProductsAction(
  filter: ProductFilter,
  cursor: string,
): Promise<ProductsPageResult> {
  return readPage('manage', filter, cursor);
}

/** 2026-10-24: Gerenciar's page 1 again (a manager's only). */
export async function refreshManagedProductsAction(
  filter: ProductFilter,
): Promise<ProductsPageResult> {
  return readPage('manage', filter);
}

export type PurchaseActionResult =
  | {
      status: 'ok';
      communities: ProductCommunity[];
      courses: ProductUnlockCourse[];
      lives: ProductUnlockLive[];
    }
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
