import {
  createBoundedTtlCache,
  type HostTenantStatus,
  isRegistrableHost,
  normalizeHost,
  type ResolvedBranding,
  resolveBranding,
  type TenantStatus,
} from '@rede-social/contracts';
import { and, eq, isNotNull } from 'drizzle-orm';
import { projectHealth, projectSchemaState, projects, tenantProjects } from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import { tenantDomains, tenants } from '../../db/schema';
import { env } from '../env';
import {
  getRequiredTenantSchema,
  isBehind,
  type RequiredTenantSchema,
} from '../migrations/required';

/**
 * Everything the public shell may know about the tenant behind a host (D-20, D-25, D-32, D-35):
 * identity, status (a suspended tenant's host still resolves so its screens stay branded), whether
 * this host is the tenant's primary and which host is, and the resolved brand.
 */
export type TenantHostResolution =
  | {
      kind: 'tenant';
      tenantId: string;
      slug: string;
      displayName: string;
      /** 09.2-08: five values, precedence suspended > preparing > unavailable > updating > active. */
      status: HostTenantStatus;
      isPrimary: boolean;
      primaryHost: string;
      branding: ResolvedBranding;
      /** 09.2-08 (D-538): the project the host selects; `''` for a tenant with no binding (it fails closed later). */
      projectId: string;
      /**
       * The registry's `api_url` of that project, or `env.SUPABASE_URL` for the central project: the ONLY input
       * to key selection (`jwksFor`/`issuerFor`). Never taken from a token.
       */
      apiUrl: string;
      /** Public coordinates of the tenant's own project, ONLY for a tenant of a non-central project. */
      supabaseUrl?: string;
      publishableKey?: string;
    }
  | { kind: 'unknown' };

/** The control-plane facts `hostStatus` ranks (09.2-08). `null` means the row does not exist (unknown). */
export type HostStatusFacts = {
  tenantStatus: TenantStatus;
  /** `platform.projects.state`; `null` for a tenant with no binding. */
  projectState: string | null;
  /** `platform.project_health.status`; `null` or `'unknown'` holds nothing out. */
  health: string | null;
  /** `platform.project_schema_state` applied side; `null` when no row. */
  applied: { count: number | null; head: string | null } | null;
  required: RequiredTenantSchema | null;
};

/**
 * D-542 / D-545 / D-537 precedence, highest first: suspended > preparing (the project is not `ready`) >
 * unavailable (paused or unreachable per the last probe) > updating (applied schema below the image's required
 * schema) > active. A missing health row, a `'unknown'` probe or a missing schema-state row is NOT held out:
 * unknown is not behind and not down.
 */
export function hostStatus(facts: HostStatusFacts): HostTenantStatus {
  if (facts.tenantStatus === 'suspended') return 'suspended';
  if (facts.projectState !== null && facts.projectState !== 'ready') return 'preparing';
  if (facts.health === 'paused' || facts.health === 'unreachable') return 'unavailable';
  if (isBehind(facts.applied, facts.required)) return 'updating';
  return 'active';
}

/**
 * 09.2-11: the one status computation, shared by `resolveTenantHost` (a host) and `getPublicTenant` (a slug), so
 * the two entries can never disagree about whether a tenant may be reached. `project` is `null` for a tenant
 * with no binding (held out by nothing here: it fails closed later, on the first lane it opens), `health` is
 * the last probe's status, `schema` the applied side of `platform.project_schema_state` (`null` when no row).
 */
export function hostStatusOf(
  project: { state: string | null } | null,
  health: string | null,
  schema: { count: number | null; head: string | null } | null,
  tenantStatus: TenantStatus,
): HostTenantStatus {
  return hostStatus({
    tenantStatus,
    projectState: project ? (project.state ?? null) : null,
    health,
    applied: schema,
    required: getRequiredTenantSchema(),
  });
}

const TTL_MS = 60_000;
/**
 * Hard bound (WR-06): `GET /v1/public/tenants/by-host` is unauthenticated and the key is whatever
 * host the client sent, negative answers included. 1,000 entries is far above any real number of
 * tenant domains and keeps a random-hostname storm at a fixed memory cost; the LRU eviction means a
 * storm can at worst evict the real hosts' cached answers, never grow the map.
 */
const MAX_ENTRIES = 1_000;
const cache = createBoundedTtlCache<TenantHostResolution>(MAX_ENTRIES);

/**
 * host -> tenant (D-20/D-23). Cached in-process for 60 s for BOTH outcomes: negative caching keeps an
 * unknown-host storm off the database; a domain attached later becomes visible within a minute or at
 * once via `invalidateTenantHost`. Caches the host mapping and the public brand only — never anything
 * about a membership.
 *
 * Only a VERIFIED host resolves (D-36, T-02-02): `verified_at is null` is `unknown` on both tiers,
 * so an attached-but-unproven domain exposes no tenant fact. The tenant's status is NOT a filter —
 * it is returned (D-32) so the shell can show a branded "indisponível" screen; `requireAuth` still
 * refuses members of a suspended tenant on its own.
 *
 * A host that cannot possibly be registered (`isRegistrableHost`, the `tenant_domains_host_chk`
 * predicate) is answered `unknown` before the cache and before the platform-lane query.
 *
 * 09.2-04 (D-537): `tenant_domains` and `tenants` are read from the CENTRAL project through the platform
 * lane, never from the tenant's own database, so the shell resolves a host, brand and status even while the
 * tenant's project is down.
 */
export async function resolveTenantHost(rawHost: string): Promise<TenantHostResolution> {
  const host = normalizeHost(rawHost);
  if (!host || !isRegistrableHost(host)) return { kind: 'unknown' };

  const hit = cache.get(host);
  if (hit) return hit;

  const value = await withPlatformTx<TenantHostResolution>(async (tx) => {
    const rows = await tx
      .select({
        tenantId: tenants.id,
        slug: tenants.slug,
        displayName: tenants.displayName,
        status: tenants.status,
        branding: tenants.branding,
        isPrimary: tenantDomains.isPrimary,
        projectId: projects.id,
        isCentral: projects.isCentral,
        projectApiUrl: projects.apiUrl,
        projectPublishableKey: projects.publishableKey,
        projectState: projects.state,
        healthStatus: projectHealth.status,
        appliedCount: projectSchemaState.appliedCount,
        appliedHead: projectSchemaState.appliedHead,
        schemaRow: projectSchemaState.projectId,
      })
      .from(tenantDomains)
      .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
      .leftJoin(tenantProjects, eq(tenantProjects.tenantId, tenants.id))
      .leftJoin(projects, eq(projects.id, tenantProjects.projectId))
      .leftJoin(projectHealth, eq(projectHealth.projectId, projects.id))
      .leftJoin(projectSchemaState, eq(projectSchemaState.projectId, projects.id))
      .where(and(eq(tenantDomains.host, host), isNotNull(tenantDomains.verifiedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return { kind: 'unknown' };

    // D-35: the alias answer names the primary so proxy.ts can 308 to it. When the tenant has no
    // verified primary (a mid-migration state), the matched host stands in for it.
    let primaryHost = host;
    if (!row.isPrimary) {
      const primaries = await tx
        .select({ host: tenantDomains.host })
        .from(tenantDomains)
        .where(
          and(
            eq(tenantDomains.tenantId, row.tenantId),
            eq(tenantDomains.isPrimary, true),
            isNotNull(tenantDomains.verifiedAt),
          ),
        )
        .limit(1);
      primaryHost = primaries[0]?.host ?? host;
    }

    // 09.2-08: the project facts come from the same platform-lane read as the host itself.
    const central = row.isCentral !== false;
    const publicCoordinates =
      !central && row.projectApiUrl && row.projectPublishableKey
        ? { supabaseUrl: row.projectApiUrl, publishableKey: row.projectPublishableKey }
        : {};
    return {
      kind: 'tenant',
      tenantId: row.tenantId,
      slug: row.slug,
      displayName: row.displayName,
      status: hostStatusOf(
        row.projectId ? { state: row.projectState ?? null } : null,
        row.healthStatus ?? null,
        row.schemaRow ? { count: row.appliedCount, head: row.appliedHead } : null,
        row.status === 'suspended' ? 'suspended' : 'active',
      ),
      isPrimary: row.isPrimary,
      primaryHost,
      branding: resolveBranding(row.branding),
      projectId: row.projectId ?? '',
      apiUrl: central ? env.SUPABASE_URL : (row.projectApiUrl ?? ''),
      ...publicCoordinates,
    };
  });

  cache.set(host, value, TTL_MS);
  return value;
}

/** Used by the Phase 2 attach flow (TENANT-07) so a freshly registered host resolves immediately. */
export function invalidateTenantHost(rawHost: string): void {
  const host = normalizeHost(rawHost);
  if (host) cache.delete(host);
}

/** Test seam: how many hosts are cached right now (never more than the bound). */
export function cachedTenantHostCount(): number {
  return cache.size;
}
