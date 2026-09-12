import { type PublicTenant, slugSchema, TRIA_TERMS_VERSION } from '@tria/contracts';
import { and, eq } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { tenants } from '../../db/schema';
import { ApiError } from '../http/api-error';

/**
 * Everything the public sign-up page may know about a tenant, by slug (AUTH-01). Unauthenticated, so
 * the answer is limited to what the page renders: display name, the rules text the person must accept
 * and the two version numbers the consents are bound to.
 *
 * Adjacency rule (T-04-07): the slug is matched EXACTLY. `Tria-Demo` fails `slugSchema` and gets the
 * same 404 as an unknown slug — no lower-casing, no trimming, nothing that could alias two tenants.
 * A suspended tenant is a 404 as well: its public link stops working.
 */
export async function getPublicTenant(slug: string): Promise<PublicTenant> {
  if (!slugSchema.safeParse(slug).success) throw new ApiError(404, 'TENANT_NOT_FOUND');

  const row = await withAdminTx(async (tx) => {
    const rows = await tx
      .select({
        slug: tenants.slug,
        displayName: tenants.displayName,
        rulesText: tenants.rulesText,
        rulesVersion: tenants.rulesVersion,
      })
      .from(tenants)
      .where(and(eq(tenants.slug, slug), eq(tenants.status, 'active')))
      .limit(1);
    return rows[0] ?? null;
  });
  if (!row) throw new ApiError(404, 'TENANT_NOT_FOUND');

  return { ...row, termsVersion: TRIA_TERMS_VERSION };
}

/** Internal helper for `signupMember`: the tenant id is needed for the inserts but never published. */
export async function getTenantIdBySlug(slug: string): Promise<string> {
  const rows = await withAdminTx(async (tx) =>
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
