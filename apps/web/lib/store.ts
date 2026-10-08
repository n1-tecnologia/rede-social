import {
  type CommunityAccess,
  type CommunityAccessList,
  communityAccessListSchema,
  communityAccessSchema,
  type LockPreview,
  type LockPreviewBody,
  lockPreviewSchema,
  type ProductCommunity,
  type ProductDetail,
  type ProductFilter,
  type ProductInput,
  type ProductPage,
  type ProductPatch,
  type ProductStatus,
  productDetailSchema,
  productPageSchema,
  purchaseResultSchema,
  STORE_ISSUE_SET,
  STORE_PAGE_SIZE,
  type StoreIssue,
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

/**
 * A product write's answer (08.2-10, D-362/D-363): the saved product, a closed `details.store`
 * refusal (a field issue the form draws under its field, or `unavailable`), the bare 404 (`gone`:
 * an unknown or foreign product on an edit, or an unknown or foreign IMAGE asset on either write,
 * which the API answers identically on purpose, D-23), the store being off, a navigation the
 * bootstrap knows (401, blocked, suspended…), or anything else. Never throws.
 */
export type ProductWriteOutcome =
  | { status: 'ok'; product: ProductDetail }
  | { status: 'issue'; issue: StoreIssue }
  | { status: 'gone' }
  | { status: 'disabled' }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

/** The shared refusal mapping of the two product writes; shape-only logging (never a name). */
async function productWriteRefusal(res: Response, op: string): Promise<ProductWriteOutcome> {
  const error = await apiError(res);
  const issue = error.details?.store;
  if (typeof issue === 'string' && STORE_ISSUE_SET.has(issue)) {
    return { status: 'issue', issue: issue as StoreIssue };
  }
  if (res.status === 404 && error.code === STORE_MODULE_DISABLED) return { status: 'disabled' };
  if (res.status === 404) return { status: 'gone' };
  const path = bootstrapRedirectPath(error);
  if (path) return { status: 'redirect', path };
  console.error(`store.${op}_failed`, { status: res.status, code: error.code });
  return { status: 'error' };
}

/**
 * `POST /v1/store/products` (08.2-05, STORE-02): the body is the create contract the action has
 * already parsed (`productInputSchema`); the API re-validates it and answers the product (201).
 */
export async function createProduct(input: ProductInput): Promise<ProductWriteOutcome> {
  try {
    const res = await apiFetch('/v1/store/products', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (res.ok) return { status: 'ok', product: productDetailSchema.parse(await res.json()) };
    return await productWriteRefusal(res, 'create');
  } catch (error) {
    console.error('store.create_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/**
 * `PATCH /v1/store/products/{productId}` (08.2-05, D-363): ONLY the keys the admin changed. The
 * patch contract has no defaults, so an omitted key leaves its column alone (a price-only patch
 * never wipes the description, the image or the links). `communityIds`, when present, REPLACES the
 * product's whole link set: the product form is the only link writer.
 */
export async function updateProduct(
  productId: string,
  patch: ProductPatch,
): Promise<ProductWriteOutcome> {
  try {
    const res = await apiFetch(`/v1/store/products/${encodeURIComponent(productId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) return { status: 'ok', product: productDetailSchema.parse(await res.json()) };
    return await productWriteRefusal(res, 'update');
  } catch (error) {
    console.error('store.update_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/** The lock preview's answer: the rows, a navigation the bootstrap knows, or a failure. */
export type LockPreviewOutcome =
  | { status: 'ok'; preview: LockPreview }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

/**
 * `POST /v1/store/products/lock-preview` (08.2-05, D-364, STORE-04): which of the communities about
 * to be linked would NEWLY lock (they have no product today) and how many live members would lose
 * access to each. ANY failure is `error`, and the form then saves nothing (the D-364 prohibition):
 * a link must never lock members out without the admin having seen this answer. Never throws.
 */
export async function lockPreview(body: LockPreviewBody): Promise<LockPreviewOutcome> {
  try {
    const res = await apiFetch('/v1/store/products/lock-preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return { status: 'ok', preview: lockPreviewSchema.parse(await res.json()) };
    const error = await apiError(res);
    const path = bootstrapRedirectPath(error);
    if (path) return { status: 'redirect', path };
    console.error('store.lock_preview_failed', { status: res.status, code: error.code });
    return { status: 'error' };
  } catch (error) {
    console.error('store.lock_preview_failed', { error: String(error) });
    return { status: 'error' };
  }
}
