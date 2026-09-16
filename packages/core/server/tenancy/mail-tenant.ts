import { normalizeHost, type ResolvedBranding, resolveBranding } from '@tria/contracts';
import { and, eq, isNotNull } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { tenantDomains, tenants } from '../../db/schema';
import { membershipForUser } from './membership';

/**
 * Which brand an auth e-mail carries (D-37, T-02-24). Lives under `tenancy/` because it opens the
 * admin lane (Biome allows `withAdminTx` only here and under `platform/`).
 *
 * Resolution order — membership first, always:
 *   1. the user's membership → that tenant (D-23: membership is the authority);
 *   2. no membership, `platform_admins` → neutral TRIA;
 *   3. no membership, `redirect_to` host resolves to a VERIFIED tenant host → that tenant (the
 *      first-admin invite: GoTrue calls the hook BEFORE 02-05 inserts the invited membership);
 *   4. otherwise neutral TRIA.
 * A membership tenant that differs from the verified tenant of the `redirect_to` host is REFUSED —
 * the mail must carry neither brand.
 */
export type MailTenantResolution =
  | {
      kind: 'tenant';
      via: 'membership' | 'redirect_host';
      tenantId: string;
      slug: string;
      displayName: string;
      status: string;
      branding: ResolvedBranding;
      primaryHost: string | null;
    }
  | { kind: 'neutral'; via: 'platform_admin' | 'no_tenant' }
  | { kind: 'refused'; reason: 'tenant_host_mismatch' };

/** The host part of `redirect_to`, normalised; `null` when it does not parse. */
export function redirectHostOf(redirectTo: string): string | null {
  try {
    return normalizeHost(new URL(redirectTo).hostname);
  } catch {
    return null;
  }
}

export async function resolveMailTenant(input: {
  userId: string;
  redirectTo: string;
}): Promise<MailTenantResolution> {
  const membership = await membershipForUser(input.userId);

  if (membership) {
    // ONE admin-lane select: the tenant row plus its verified primary host (for the logo URL).
    const row = await withAdminTx(async (tx) => {
      const rows = await tx
        .select({
          slug: tenants.slug,
          displayName: tenants.displayName,
          status: tenants.status,
          branding: tenants.branding,
          primaryHost: tenantDomains.host,
        })
        .from(tenants)
        .leftJoin(
          tenantDomains,
          and(
            eq(tenantDomains.tenantId, tenants.id),
            eq(tenantDomains.isPrimary, true),
            isNotNull(tenantDomains.verifiedAt),
          ),
        )
        .where(eq(tenants.id, membership.tenantId))
        .limit(1);
      return rows[0] ?? null;
    });
    if (!row) return { kind: 'neutral', via: 'no_tenant' };
    // `status` is carried, not consulted: whether a suspended tenant's user may recover is GoTrue's
    // / 02-08's concern — the brand is still that tenant's (D-32).
    return {
      kind: 'tenant',
      via: 'membership',
      tenantId: membership.tenantId,
      slug: row.slug,
      displayName: row.displayName,
      status: row.status,
      branding: resolveBranding(row.branding),
      primaryHost: row.primaryHost ?? null,
    };
  }

  return { kind: 'neutral', via: 'no_tenant' };
}
