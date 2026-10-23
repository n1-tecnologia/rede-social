import { PLATFORM_TERMS_VERSION, type PublicTenant, slugSchema } from '@rede-social/contracts';
import { and, eq, isNotNull } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { projectHealth, projectSchemaState, projects, tenantProjects } from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import { tenantDomains, tenants } from '../../db/schema';
import { ApiError } from '../http/api-error';
import { accessCheckoutUrl } from './access';
import { hostStatusOf } from './tenant-host';

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
 *
 * 09.2-11 (DBT-15, D-538): the slug selects the project through the central mirror (tenant -> binding). The
 * tenant's project facts are ranked by the SAME `hostStatusOf` the host answer uses, and a tenant whose project
 * is `preparing`, `updating` or `unavailable` answers 503 (`TENANT_PREPARING` / `TENANT_UPDATING` /
 * `TENANT_UNAVAILABLE`) BEFORE any tenant lane opens, so nothing can be signed up to it. A non-central project
 * that has no publishable key yet is still being prepared. For a non-central project the record also carries
 * that project's public `supabaseUrl` and `publishableKey` (never a sealed value).
 *
 * 09.2-17 (D-36): the same non-central record also carries `primaryHost`, the tenant's verified primary host
 * (the web sends a generic-host sign-up there), and a non-central tenant with no verified primary host is a
 * 404 `TENANT_NOT_FOUND` (it has no entrance). A tenant of the central project is unchanged.
 */
export async function getPublicTenant(slug: string): Promise<PublicTenant> {
  if (!slugSchema.safeParse(slug).success) throw new ApiError(404, 'TENANT_NOT_FOUND');

  const identity = await withPlatformTx(async (tx) => {
    const [found] = await tx
      .select({
        id: tenants.id,
        slug: tenants.slug,
        displayName: tenants.displayName,
        projectId: projects.id,
        isCentral: projects.isCentral,
        projectState: projects.state,
        projectApiUrl: projects.apiUrl,
        projectPublishableKey: projects.publishableKey,
        healthStatus: projectHealth.status,
        appliedCount: projectSchemaState.appliedCount,
        appliedHead: projectSchemaState.appliedHead,
        schemaRow: projectSchemaState.projectId,
      })
      .from(tenants)
      .leftJoin(tenantProjects, eq(tenantProjects.tenantId, tenants.id))
      .leftJoin(projects, eq(projects.id, tenantProjects.projectId))
      .leftJoin(projectHealth, eq(projectHealth.projectId, projects.id))
      .leftJoin(projectSchemaState, eq(projectSchemaState.projectId, projects.id))
      .where(and(eq(tenants.slug, slug), eq(tenants.status, 'active')))
      .limit(1);
    if (!found) return null;
    // 09.2-17 (D-36): the tenant's verified PRIMARY host, read in the same central transaction. The web
    // sends a person who signs up from a generic host to it when the tenant lives in another project.
    const [primary] = await tx
      .select({ host: tenantDomains.host })
      .from(tenantDomains)
      .where(
        and(
          eq(tenantDomains.tenantId, found.id),
          eq(tenantDomains.isPrimary, true),
          isNotNull(tenantDomains.verifiedAt),
        ),
      )
      .limit(1);
    return { ...found, primaryHost: primary?.host ?? null };
  });
  if (!identity) throw new ApiError(404, 'TENANT_NOT_FOUND');

  const central = identity.isCentral !== false;
  const status = hostStatusOf(
    identity.projectId ? { state: identity.projectState ?? null } : null,
    identity.healthStatus ?? null,
    identity.schemaRow ? { count: identity.appliedCount, head: identity.appliedHead } : null,
    'active',
  );
  if (status === 'preparing' || (!central && !identity.projectPublishableKey)) {
    throw new ApiError(503, 'TENANT_PREPARING');
  }
  if (status === 'updating') throw new ApiError(503, 'TENANT_UPDATING');
  if (status === 'unavailable') throw new ApiError(503, 'TENANT_UNAVAILABLE');

  // 09.2-17 (D-36): a tenant of another project signs people in only on its own host, so with no verified
  // primary host it has no entrance at all: the same 404 as an unknown slug, before any tenant lane opens.
  if (!central && !identity.primaryHost) throw new ApiError(404, 'TENANT_NOT_FOUND');

  const coordinates =
    !central && identity.projectApiUrl && identity.projectPublishableKey
      ? {
          supabaseUrl: identity.projectApiUrl,
          publishableKey: identity.projectPublishableKey,
          ...(identity.primaryHost ? { primaryHost: identity.primaryHost } : {}),
        }
      : {};

  const row = await withAdminTx({ tenantId: identity.id }, async (tx) => {
    const [own] = await tx
      .select({ rulesText: tenants.rulesText, rulesVersion: tenants.rulesVersion })
      .from(tenants)
      .where(eq(tenants.id, identity.id))
      .limit(1);
    if (!own) return null;
    // 09.1-10 (D-493): the notice's "Assinar" link, from the one reader, in the same read.
    return {
      slug: identity.slug,
      displayName: identity.displayName,
      ...own,
      link: await accessCheckoutUrl(tx, identity.id),
    };
  });
  if (!row) throw new ApiError(404, 'TENANT_NOT_FOUND');

  const { link, ...record } = row;
  // The key is emitted only when there is a link, so an ungated tenant's record is unchanged.
  return {
    ...record,
    ...coordinates,
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
