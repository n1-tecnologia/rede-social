'use server';

import { buyersQuerySchema } from '@rede-social/module-store/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { ApiClientError, bootstrapRedirectPath, getBootstrap } from '@/lib/bootstrap';
import { listBuyers, revokeAccess } from '@/lib/store-admin';
import { type BuyerRowView, buyerRowView } from '@/lib/store-view';

/**
 * The "Compradores" screen's server actions (08.2-11, D-359, D-360, UI-D-380/381), in the
 * `loja/actions.ts` conventions:
 *
 * - a server action is a PUBLIC endpoint, so every id is validated as a uuid (and the cursor with the
 *   API's own `buyersQuerySchema` bounds) BEFORE any request; a malformed one never reaches the API;
 * - a refusal the bootstrap knows (401, blocked, suspended…) navigates OUTSIDE the try/catch (Next 16:
 *   `redirect()` throws); anything else answers a code the client maps to catalog copy;
 * - the API is the authority: `store.product.manage` and the tenant are re-checked on every route and
 *   inside the definers (08.2-06), so nothing here is a gate;
 * - rows come back FINISHED (`buyerRowView`, dates in the tenant's timezone), so the client list
 *   formats no instant;
 * - logs carry the shape only: a member's name, e-mail or a search term never reaches a log line.
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

const uuid = z.uuid();

export type BuyersPageResult =
  | { ok: true; items: BuyerRowView[]; nextCursor: string | null; total: number }
  | { ok: false; code: 'not_found' | 'generic' };

/**
 * One keyset page of the product's holders. `cursor` null asks for page 1 (what the pull-to-refresh
 * and the first-load retry call); otherwise it is OPAQUE and forwarded untouched.
 */
export async function loadMoreBuyersAction(
  productId: string,
  cursor: string | null,
): Promise<BuyersPageResult> {
  if (!uuid.safeParse(productId).success) return { ok: false, code: 'generic' };
  const query = buyersQuerySchema.safeParse(cursor === null ? {} : { cursor });
  if (!query.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: BuyersPageResult = { ok: false, code: 'generic' };
  try {
    const [read, bootstrap, t] = await Promise.all([
      listBuyers(productId, query.data.cursor),
      getBootstrap(),
      getTranslations(),
    ]);
    if (read.status === 'ok') {
      const timezone = bootstrap.tenant.timezone;
      result = {
        ok: true,
        items: read.page.items.map((buyer) => buyerRowView(buyer, { timezone }, t)),
        nextCursor: read.page.nextCursor,
        total: read.page.total,
      };
    } else if (read.status === 'redirect') {
      refusal = read.path;
    } else if (read.status === 'not-found') {
      result = { ok: false, code: 'not_found' };
    }
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) console.error('store.buyers_page_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

export type RevokeActionResult = { status: 'revoked' | 'gone' | 'error' };

/**
 * Revokes one holder's access (D-359): the entitlement and, for a purchase, its order become
 * `revoked` and stay as history; the member may buy again. `gone` is the API's bare 404 (already
 * revoked in another tab, or not an active entitlement of THIS product).
 */
export async function revokeAccessAction(
  productId: string,
  entitlementId: string,
): Promise<RevokeActionResult> {
  if (!uuid.safeParse(productId).success || !uuid.safeParse(entitlementId).success) {
    return { status: 'error' };
  }
  const outcome = await revokeAccess(productId, entitlementId);
  if (outcome.status === 'redirect') redirect(outcome.path);
  return { status: outcome.status };
}
