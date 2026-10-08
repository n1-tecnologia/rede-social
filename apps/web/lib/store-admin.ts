import {
  type BuyersPage,
  buyersPageSchema,
  grantResultSchema,
  revokeResultSchema,
  STORE_PAGE_SIZE,
} from '@rede-social/module-store/contracts';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * The store's ADMIN web client (08.2-11, D-359, D-360, STORE-09, STORE-10): the "Compradores" list,
 * the manual grant and the revoke. SERVER-ONLY like `lib/store.ts`: every call goes through `apiFetch`
 * with the session's Bearer and the tenant host, so the browser never talks to the API and never
 * holds a token.
 *
 * The API is the authority (08.2-06): each route sits behind `requirePermission('store.product.manage')`
 * and the two writes run tenant-pinned SECURITY DEFINER functions that re-check the admin claim
 * themselves. An unknown, another tenant's, a blocked or a removed membership, and an entitlement
 * that is already revoked or belongs to another product, are all ONE bare 404 (D-23): this client
 * maps it to `gone` and never tries to tell them apart.
 *
 * Every function answers a discriminated outcome and never throws. Logs carry the status and the
 * code only: a member's name or e-mail is tenant content and never reaches a log line.
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
const MODULE_DISABLED = 'MODULE_DISABLED';

/**
 * `listBuyers`'s answer: one keyset page with the exact `total`, the ONE not-found (an unknown or
 * foreign product, a malformed id or cursor, or the store switched off since the bootstrap), a
 * navigation the bootstrap knows (401, blocked, suspended…), the permission lost since the bootstrap
 * (403 `FORBIDDEN`), or a read failure.
 */
export type BuyersResult =
  | { status: 'ok'; page: BuyersPage }
  | { status: 'not-found' }
  | { status: 'forbidden' }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

/**
 * `GET /v1/store/products/{productId}/buyers?cursor=&limit=` (08.2-06, STORE-10): the product's
 * ACTIVE holders, newest first (`created_at desc, id desc`), with `total` = the exact count. The
 * cursor is OPAQUE: forwarded exactly as the previous page returned it (the API refuses a tampered
 * one with 400, which reads as `not-found` here, never as a widened read).
 */
export async function listBuyers(productId: string, cursor?: string): Promise<BuyersResult> {
  const search = new URLSearchParams();
  if (cursor) search.set('cursor', cursor);
  search.set('limit', String(STORE_PAGE_SIZE));
  try {
    const res = await apiFetch(
      `/v1/store/products/${encodeURIComponent(productId)}/buyers?${search.toString()}`,
    );
    if (res.ok) return { status: 'ok', page: buyersPageSchema.parse(await res.json()) };
    const error = await apiError(res);
    if (res.status === 404 || res.status === 400) return { status: 'not-found' };
    const path = bootstrapRedirectPath(error);
    if (path) return { status: 'redirect', path };
    if (res.status === 403 && error.code === 'FORBIDDEN') return { status: 'forbidden' };
    console.error('store.buyers_read_failed', { status: res.status, code: error.code });
    return { status: 'error' };
  } catch (error) {
    console.error('store.buyers_read_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/**
 * A grant's answer (D-360, UI-D-381): `granted` wrote a new entitlement (`source: 'grant'`, no order);
 * `already_active` wrote nothing because the member already holds the product; `gone` is the bare
 * 404 (the membership is not a live one of THIS tenant, or the product is unknown); a navigation the
 * bootstrap knows; or anything else.
 */
export type GrantOutcome =
  | { status: 'granted' | 'already_active'; entitlementId: string }
  | { status: 'gone' }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

/**
 * `POST /v1/store/products/{productId}/grants { membershipId }` (08.2-06). The definer resolves the
 * membership in the caller's tenant only, so another tenant's id is the bare 404 (T-08.2-50).
 */
export async function grantAccess(productId: string, membershipId: string): Promise<GrantOutcome> {
  try {
    const res = await apiFetch(`/v1/store/products/${encodeURIComponent(productId)}/grants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ membershipId }),
    });
    if (res.ok) {
      const result = grantResultSchema.parse(await res.json());
      return { status: result.outcome, entitlementId: result.entitlementId };
    }
    const error = await apiError(res);
    if (res.status === 404 && error.code !== MODULE_DISABLED) return { status: 'gone' };
    const path = bootstrapRedirectPath(error);
    if (path) return { status: 'redirect', path };
    console.error('store.grant_failed', { status: res.status, code: error.code });
    return { status: 'error' };
  } catch (error) {
    console.error('store.grant_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/**
 * A revoke's answer (D-359): `revoked` (the entitlement and, for a purchase, its order are now
 * `revoked`, kept as history), `gone` (the bare 404: already revoked, or not an active entitlement of
 * THIS product), a navigation the bootstrap knows, or anything else.
 */
export type RevokeOutcome =
  | { status: 'revoked' }
  | { status: 'gone' }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

/** `DELETE /v1/store/products/{productId}/entitlements/{entitlementId}` (08.2-06). */
export async function revokeAccess(
  productId: string,
  entitlementId: string,
): Promise<RevokeOutcome> {
  try {
    const res = await apiFetch(
      `/v1/store/products/${encodeURIComponent(productId)}/entitlements/${encodeURIComponent(entitlementId)}`,
      { method: 'DELETE' },
    );
    if (res.ok) {
      revokeResultSchema.parse(await res.json());
      return { status: 'revoked' };
    }
    const error = await apiError(res);
    if (res.status === 404 && error.code !== MODULE_DISABLED) return { status: 'gone' };
    const path = bootstrapRedirectPath(error);
    if (path) return { status: 'redirect', path };
    console.error('store.revoke_failed', { status: res.status, code: error.code });
    return { status: 'error' };
  } catch (error) {
    console.error('store.revoke_failed', { error: String(error) });
    return { status: 'error' };
  }
}
