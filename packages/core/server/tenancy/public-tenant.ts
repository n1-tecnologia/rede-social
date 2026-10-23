import { PLATFORM_TERMS_VERSION, type PublicTenant, slugSchema } from '@rede-social/contracts';
import { and, eq } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { withPlatformTx } from '../../db/platform-tx';
import { tenants } from '../../db/schema';
import { ApiError } from '../http/api-error';
import { accessCheckoutUrl } from './access';

/**
 * Everything the public sign-up page may know about a tenant, by slug (AUTH-01). Unauthenticated, so
 * the answer is limited to what the page renders: display name, the rules text the person must accept
 * and the two version numbers the consents are bound to.
 *
 * Adjacency rule (T-04-07): the slug is matched EXACTLY. `Rede-Demo` fails `slugSchema` and gets the
 * same 404 as an unknown slug — no lower-casing, no trimming, nothing that could alias two tenants.
 * A suspended tenant is a 404 as well: its public link stops working.
 *
 * 09.2-07 (D-537): the identity (id, slug, display name, status) is answered by the CENTRAL mirror through the
 * platform lane; the rules text and its version are TENANT-owned and are read from the tenant's own project
 * (`withAdminTx({ tenantId })`), together with the checkout link. An unreachable tenant project makes this call
 * fail with `TENANT_UNAVAILABLE` while `GET /v1/public/tenants/by-host` (the mirror alone) keeps answering.
 */
export async function getPublicTenant(slug: string): Promise<PublicTenant> {
  if (!slugSchema.safeParse(slug).success) throw new ApiError(404, 'TENANT_NOT_FOUND');

  const [identity] = await withPlatformTx((tx) =>
    tx
      .select({ id: tenants.id, slug: tenants.slug, displayName: tenants.displayName })
      .from(tenants)
      .where(and(eq(tenants.slug, slug), eq(tenants.status, 'active')))
      .limit(1),
  );
  if (!identity) throw new ApiError(404, 'TENANT_NOT_FOUND');

  const row = await withAdminTx({ tenantId: identity.id }, async (tx) => {
    const [own] = await tx
      .select({ rulesText: tenants.rulesText, rulesVersion: tenants.rulesVersion })
      .from(tenants)
      .where(eq(tenants.id, identity.id))
      .limit(1);
    if (!own) return null;
    // 09.1-10 (D-493): the notice's "Assinar" link, from the one reader, in the same read.
    return { ...identity, ...own, link: await accessCheckoutUrl(tx, identity.id) };
  });
  if (!row) throw new ApiError(404, 'TENANT_NOT_FOUND');

  const { id: _id, link, ...record } = row;
  // The key is emitted only when there is a link, so an ungated tenant's record is unchanged.
  return {
    ...record,
    termsVersion: PLATFORM_TERMS_VERSION,
    ...(link === null ? {} : { accessCheckoutUrl: link }),
  };
}

/** Internal helper for `signupMember`: the tenant id is needed for the inserts but never published. */
export async function getTenantIdBySlug(slug: string): Promise<string> {
  const rows = await withPlatformTx(async (tx) =>
    tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.slug, slug), eq(tenants.status, 'active')))
      .limit(1),
  );
  const row = rows[0];
  if (!row) throw new ApiError(404, 'TENANT_NOT_FOUND');
  return row.id;
}
