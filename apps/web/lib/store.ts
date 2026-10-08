import {
  type CommunityAccess,
  type CommunityAccessList,
  communityAccessListSchema,
  communityAccessSchema,
  type ProductCommunity,
  type ProductDetail,
  type ProductFilter,
  type ProductPage,
  type ProductStatus,
  productDetailSchema,
  productPageSchema,
  purchaseResultSchema,
  STORE_PAGE_SIZE,
} from '@rede-social/module-store/contracts';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * The ONE store fetch implementation (08.2-07, the `lib/events.ts` shape). The `/loja` RSC page, its
 * load-more action and the product page all read THIS, so the grid and its next page can never
 * disagree about the page size or the filter vocabulary.
 *
 * The browser never talks to Supabase for store data: every read goes through `apiFetch` to the Hono
 * API, which re-verifies the token, re-reads the membership and gates the module (`requireModule`):
 * with the store off every route answers 404 `MODULE_DISABLED`.
 *
 * **The web never sorts** (P21): the grid renders the API's order (newest first; `owned` newest
 * entitlement first) and appends pages in order. **The cursor is opaque**: forwarded exactly as the
 * previous page returned it, never parsed here (the API refuses a tampered one with 400).
 */

/** Reads the envelope's error code without ever throwing on a non-JSON body. */
async function apiError(res: Response): Promise<ApiClientError> {
  let code = 'HTTP_ERROR';
  let details: Record<string, unknown> | undefined;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; details?: Record<string, unknown> };
    };
    if (typeof body?.error?.code === 'string') code = body.error.code;
    details = body?.error?.details;
  } catch {
    // A non-JSON body keeps the generic code: every caller's refusal handling is the same.
  }
  return new ApiClientError(res.status, code, details);
}

/** The code every store route answers with the module off (`requireModule('store')`). */
export const STORE_MODULE_DISABLED = 'MODULE_DISABLED';

export type ProductQueryInput = { filter: ProductFilter; cursor?: string; limit?: number };

/**
 * `GET /v1/store/products?filter=&cursor=&limit=` (08.2-05). `filter` is always sent explicitly
 * (the API's closed enum); `limit` defaults to `STORE_PAGE_SIZE`. Throws an `ApiClientError` on any
 * refusal (a manager-only `archived` asked by a member is a 403, which the page never sends).
 */
export async function getProducts(query: ProductQueryInput): Promise<ProductPage> {
  const search = new URLSearchParams();
  search.set('filter', query.filter);
  if (query.cursor) search.set('cursor', query.cursor);
  search.set('limit', String(query.limit ?? STORE_PAGE_SIZE));

  const res = await apiFetch(`/v1/store/products?${search.toString()}`);
  if (!res.ok) throw await apiError(res);
  return productPageSchema.parse(await res.json());
}

/**
 * `getProduct`'s answer: the product, the ONE not-found (unknown, another tenant's, or archived for
 * a non-holder: the API answers one bare 404 for all of them), the store being off, a refusal path,
 * or a read failure.
 */
export type ProductResult =
  | { status: 'ok'; product: ProductDetail }
  | { status: 'not-found' }
  | { status: 'disabled' }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

/**
 * `GET /v1/store/products/{productId}` (08.2-05, STORE-06). A 400 (not a uuid) collapses into
 * `not-found` like the bare 404, so the page renders one screen for every miss. `MODULE_DISABLED` is
 * told apart: with the store off the app's generic not-found renders, never the store's card
 * (UI-D-387). The caller performs the redirect (`redirect()` throws, so it never runs here).
 */
export async function getProduct(productId: string): Promise<ProductResult> {
  try {
    const res = await apiFetch(`/v1/store/products/${encodeURIComponent(productId)}`);
    if (res.ok) return { status: 'ok', product: productDetailSchema.parse(await res.json()) };
    const error = await apiError(res);
    if (res.status === 404 && error.code === STORE_MODULE_DISABLED) return { status: 'disabled' };
    if (res.status === 404 || res.status === 400) return { status: 'not-found' };
    const path = bootstrapRedirectPath(error);
    if (path) return { status: 'redirect', path };
    console.error('store.read_failed', { status: res.status, code: error.code });
    return { status: 'error' };
  } catch (error) {
    console.error('store.read_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/**
 * `PUT /v1/store/products/{productId}/status { status }` (08.2-05): idempotent archive/reactivate.
 * It touches no link and no entitlement. Throws an `ApiClientError` on refusal (403 without
 * `store.product.manage`, the bare 404 for an unknown or foreign product).
 */
export async function setProductStatus(productId: string, status: ProductStatus): Promise<void> {
  const res = await apiFetch(`/v1/store/products/${encodeURIComponent(productId)}/status`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw await apiError(res);
}

/**
 * `purchaseProduct`'s answer (08.2-08, UI-D-371): the communities the product opens (a first
 * purchase and an `owned` replay are the same answer, P27), a 409 refusal by its `details.store`
 * reason, the bare 404 (`gone`: unknown, another tenant's, or archived for a non-holder), the store
 * being off, a navigation the bootstrap knows (401, blocked, suspended…), or anything else.
 */
export type PurchaseRefusal = 'unavailable' | 'price_changed';
export type PurchaseOutcome =
  | { status: 'ok'; communities: ProductCommunity[] }
  | { status: 'refused'; reason: PurchaseRefusal }
  | { status: 'gone' }
  | { status: 'disabled' }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

/**
 * `POST /v1/store/products/{productId}/purchase { expectedAmountCents }` (08.2-01, STORE-07/08).
 *
 * The body carries the price the member SAW, never an amount to charge (D-361, T-08.2-35): the API
 * copies the price from the product row and answers 409 `price_changed` when the two differ, so a
 * stale page can never buy at a number the member did not confirm. Idempotent: a second request
 * (double tap, a second tab) answers the same `{ owned: true, communities }`. Never throws.
 */
export async function purchaseProduct(
  productId: string,
  expectedAmountCents: number,
): Promise<PurchaseOutcome> {
  try {
    const res = await apiFetch(`/v1/store/products/${encodeURIComponent(productId)}/purchase`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedAmountCents }),
    });
    if (res.ok) {
      const result = purchaseResultSchema.parse(await res.json());
      return { status: 'ok', communities: result.communities };
    }
    const error = await apiError(res);
    if (res.status === 409) {
      const reason = error.details?.store;
      if (reason === 'unavailable' || reason === 'price_changed') {
        return { status: 'refused', reason };
      }
    }
    if (res.status === 404 && error.code === STORE_MODULE_DISABLED) return { status: 'disabled' };
    if (res.status === 404) return { status: 'gone' };
    const path = bootstrapRedirectPath(error);
    if (path) return { status: 'redirect', path };
    // Shape only: a product name is tenant content and never reaches a log line.
    console.error('store.purchase_failed', { status: res.status, code: error.code });
    return { status: 'error' };
  } catch (error) {
    console.error('store.purchase_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/**
 * `GET /v1/store/community-access` (08.2-05, STORE-12): one row per GATED community with the
 * caller's `locked`, `gated` and `archivedTag`. The Comunidades list draws its tags from it.
 *
 * `null` on ANY failure (transport, 5xx, the store switched off between the bootstrap and the read,
 * a refusal): UI-D-384 — a failed hint read degrades to NO tags, never to wrong ones, because the
 * gate itself is server-side and does not depend on this answer. Never throws.
 */
export async function getCommunityAccessList(): Promise<CommunityAccessList | null> {
  try {
    const res = await apiFetch('/v1/store/community-access');
    if (res.ok) return communityAccessListSchema.parse(await res.json());
    const error = await apiError(res);
    if (error.code !== STORE_MODULE_DISABLED) {
      console.error('store.access_read_failed', { status: res.status, code: error.code });
    }
    return null;
  } catch (error) {
    console.error('store.access_read_failed', { error: String(error) });
    return null;
  }
}

/**
 * `GET /v1/store/communities/{communityId}/access` (08.2-05, STORE-13/14): `locked` for the caller
 * (always false for staff), `gated`, `archivedTag` and the BUYABLE products (active, newest first)
 * the locked page's top section and choice sheet list.
 *
 * `null` on any failure, the bare 404 included (UI-D-384): the community page then renders its
 * unlocked chrome and relies on the feed API's gate, which still answers only the sample — the page
 * degrades to fewer hints, never to more content. Never throws.
 */
export async function getCommunityAccess(communityId: string): Promise<CommunityAccess | null> {
  try {
    const res = await apiFetch(`/v1/store/communities/${encodeURIComponent(communityId)}/access`);
    if (res.ok) return communityAccessSchema.parse(await res.json());
    const error = await apiError(res);
    if (error.code !== STORE_MODULE_DISABLED && res.status !== 404) {
      console.error('store.access_read_failed', { status: res.status, code: error.code });
    }
    return null;
  } catch (error) {
    console.error('store.access_read_failed', { error: String(error) });
    return null;
  }
}
