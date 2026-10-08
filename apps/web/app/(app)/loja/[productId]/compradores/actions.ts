'use server';

import { adminMemberListQuerySchema } from '@rede-social/contracts/moderation';
import { buyersQuerySchema, grantBodySchema } from '@rede-social/module-store/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { getAdminMembers } from '@/lib/admin-members';
import { ApiClientError, bootstrapRedirectPath, getBootstrap } from '@/lib/bootstrap';
import { grantAccess, listBuyers, revokeAccess } from '@/lib/store-admin';
import { type BuyerRowView, buyerMeta, buyerRowView } from '@/lib/store-view';

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

/** One member the grant search found (UI-D-381): what the row shows and what the grant sends. */
export interface GrantCandidate {
  membershipId: string;
  /** The profile name, or the e-mail when there is none (the Membros row rule). */
  name: string;
  email: string;
  avatarAssetId: string | null;
}

export type MemberSearchResult =
  | { ok: true; items: GrantCandidate[]; nextCursor: string | null }
  | { ok: false; code: 'generic' };

/**
 * The grant sheet's member search (D-360, UI-D-381): `getAdminMembers({ q, status: 'active' })`, the
 * SAME read and permission as the Membros admin search (T-08.2-48), validated with its own query
 * schema (trimmed, capped at 80) before any request. Only ACTIVE memberships are offered: the grant
 * definer refuses a blocked or invited one anyway (the bare 404). `cursor` is OPAQUE.
 */
export async function searchMembersAction(
  q: string,
  cursor: string | null = null,
): Promise<MemberSearchResult> {
  const query = adminMemberListQuerySchema.safeParse({
    q,
    status: 'active',
    ...(cursor === null ? {} : { cursor }),
  });
  if (!query.success || !query.data.q) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: MemberSearchResult = { ok: false, code: 'generic' };
  try {
    const page = await getAdminMembers({
      q: query.data.q,
      status: 'active',
      cursor: query.data.cursor,
    });
    result = {
      ok: true,
      items: page.items.map((member) => ({
        membershipId: member.membershipId,
        name: member.displayName ?? member.email,
        email: member.email,
        avatarAssetId: member.avatarAssetId,
      })),
      nextCursor: page.nextCursor,
    };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    // Shape only: the search term is the admin's own words and never reaches a log line.
    if (!refusal) {
      console.error('store.grant_search_failed', {
        ...(error instanceof ApiClientError
          ? { status: error.status, code: error.code }
          : { error: String(error) }),
      });
    }
  }

  if (refusal) redirect(refusal);
  return result;
}

export type GrantActionResult =
  | { status: 'granted'; entitlementId: string; meta: string }
  | { status: 'already_active' | 'gone' | 'error' };

/**
 * Grants the product to one member of THIS community, without a purchase (D-360). Both ids are
 * validated (the membership with the API's own `grantBodySchema`) before the request. The definer
 * resolves the membership in the caller's tenant only, so another tenant's id answers the bare 404
 * and this action `gone` (T-08.2-50), never a success.
 *
 * `granted` carries the new row's meta line, formatted HERE in the tenant's timezone from the
 * server's clock (UI-D-386: the client never formats an instant); `already_active` wrote nothing.
 */
export async function grantAccessAction(
  productId: string,
  membershipId: string,
): Promise<GrantActionResult> {
  const body = grantBodySchema.safeParse({ membershipId });
  if (!uuid.safeParse(productId).success || !body.success) return { status: 'error' };

  const outcome = await grantAccess(productId, body.data.membershipId);
  if (outcome.status === 'redirect') redirect(outcome.path);
  if (outcome.status !== 'granted') return { status: outcome.status };

  let meta = '';
  try {
    const [bootstrap, t] = await Promise.all([getBootstrap(), getTranslations()]);
    meta = buyerMeta('grant', new Date().toISOString(), bootstrap.tenant.timezone, t);
  } catch (error) {
    // The grant is written: a meta line that cannot be built must not turn it into a failure.
    console.error('store.grant_meta_failed', { error: String(error) });
  }
  return { status: 'granted', entitlementId: outcome.entitlementId, meta };
}
