import {
  type CreateTenantBody,
  contrastReport,
  type DomainStatus,
  deriveBrandColors,
  type InviteStatus,
  type ModuleKey,
  type PlatformTenantDetail,
  type PlatformTenantsQuery,
  REAL_TENANT_DEFAULT_MODULES,
  resolveBranding,
  type TenantBranding,
  type TenantStatus,
  TOGGLEABLE_MODULES,
  type UpdateTenantBody,
} from '@tria/contracts';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
} from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import {
  memberships,
  tenantDomains,
  tenantInvites,
  tenantModules,
  tenants,
  users,
} from '../../db/schema';
import { ApiError } from '../http/api-error';
import { invalidateTenantHost } from '../tenancy/tenant-host';
import { createPendingInvite, logFor, type PlatformActor, sendPendingInvites } from './invites';

export type { PlatformActor } from './invites';

export type PlatformTenantRow = {
  id: string;
  slug: string;
  displayName: string;
  status: string;
  createdAt: Date;
  enabledModules: ModuleKey[];
  /** The VERIFIED primary host (what the list's "Sem domínio" pill and the invite sender agree on); null otherwise. */
  primaryHost: string | null;
};

export type PlatformTenantsPage = { rows: PlatformTenantRow[]; nextCursor: string | null };

const DEFAULT_LIMIT = 25;

/** `%`/`_`/`\` in the search text are literal characters, not LIKE wildcards. */
const likeContains = (q: string): string => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/** Postgres `23505` (unique_violation), possibly wrapped by drizzle's `DrizzleQueryError`. */
function isUniqueViolation(error: unknown, constraintNeedle: string): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const e = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (e.code === '23505') {
      const name = typeof e.constraint_name === 'string' ? e.constraint_name : '';
      return name === '' || name.includes(constraintNeedle);
    }
    current = e.cause;
  }
  return false;
}

/**
 * ROLE-01 / ROLE-05: the cross-tenant read behind `GET /v1/platform/tenants`. It lives in the
 * kernel's platform lane because that is where the admin lane may be opened at all (Biome
 * `noRestrictedImports` confines `@tria/core/db/admin-tx` to `server/tenancy`, `server/platform`
 * and `scripts/`) — a route file in `apps/api` must never reach past RLS on its own.
 *
 * Search (`q`) matches the display name OR the slug, case-insensitive substring; `status` filters;
 * the page is ordered by slug ascending (unique, so equal display names never reorder rows) and
 * `nextCursor` is the last slug of a full page. Separate queries instead of joins so a tenant with
 * no enabled module (or no host yet) still appears, with an empty list / a null primary host.
 */
export async function listPlatformTenants(
  query: Partial<PlatformTenantsQuery> = {},
): Promise<PlatformTenantsPage> {
  const limit = query.limit ?? DEFAULT_LIMIT;
  const conditions: SQL[] = [];
  const q = query.q?.trim();
  if (q) {
    const needle = likeContains(q);
    const match = or(ilike(tenants.displayName, needle), ilike(tenants.slug, needle));
    if (match) conditions.push(match);
  }
  if (query.status) conditions.push(eq(tenants.status, query.status));
  if (query.cursor) conditions.push(gt(tenants.slug, query.cursor));

  const { tenantRows, moduleRows, hostRows } = await withAdminTx(async (tx) => {
    const tenantRows = await tx
      .select({
        id: tenants.id,
        slug: tenants.slug,
        displayName: tenants.displayName,
        status: tenants.status,
        createdAt: tenants.createdAt,
      })
      .from(tenants)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(tenants.slug))
      .limit(limit + 1);

    const pageIds = tenantRows.slice(0, limit).map((t) => t.id);
    if (pageIds.length === 0) return { tenantRows, moduleRows: [], hostRows: [] };

    const moduleRows = await tx
      .select({ tenantId: tenantModules.tenantId, moduleKey: tenantModules.moduleKey })
      .from(tenantModules)
      .where(and(inArray(tenantModules.tenantId, pageIds), eq(tenantModules.enabled, true)))
      .orderBy(asc(tenantModules.moduleKey));

    const hostRows = await tx
      .select({ tenantId: tenantDomains.tenantId, host: tenantDomains.host })
      .from(tenantDomains)
      .where(
        and(
          inArray(tenantDomains.tenantId, pageIds),
          eq(tenantDomains.isPrimary, true),
          isNotNull(tenantDomains.verifiedAt),
        ),
      );

    return { tenantRows, moduleRows, hostRows };
  });

  const byTenant = new Map<string, ModuleKey[]>();
  for (const row of moduleRows) {
    const list = byTenant.get(row.tenantId) ?? [];
    list.push(row.moduleKey as ModuleKey);
    byTenant.set(row.tenantId, list);
  }
  const primaryHosts = new Map(hostRows.map((row) => [row.tenantId, row.host]));

  const page = tenantRows.slice(0, limit);
  const rows = page.map((t) => ({
    ...t,
    enabledModules: byTenant.get(t.id) ?? [],
    primaryHost: primaryHosts.get(t.id) ?? null,
  }));
  const last = page[page.length - 1];
  const nextCursor = tenantRows.length > limit && last ? last.slug : null;
  return { rows, nextCursor };
}

/**
 * ROLE-03 (D-19, D-30, D-31): provisions a tenant in ONE admin transaction — the `tenants` row with
 * its derived brand colors, one `tenant_modules` row per TOGGLEABLE key (`enabled` per the checklist,
 * `example` always false) and the first admin's `pending` invite. A duplicate slug surfaces the unique
 * constraint as 400 `VALIDATION_FAILED { slug: 'taken' }` from inside the transaction, so a concurrent
 * loser leaves no partial rows. After commit the invites are sent — a no-op until a verified primary
 * host exists, which at creation is never.
 */
export async function createTenant(
  input: CreateTenantBody,
  actor: PlatformActor,
): Promise<{ id: string }> {
  const log = logFor(actor, 'platform.tenants');
  const branding: TenantBranding = {
    logoUrl: null,
    faviconUrl: null,
    iconUrl: null,
    iconUrls: null,
    iconVersion: 0,
    colors: deriveBrandColors(input.colors),
  };
  const wanted = new Set<ModuleKey>(input.modules);

  let tenantId: string;
  try {
    tenantId = await withAdminTx(async (tx) => {
      const [tenant] = await tx
        .insert(tenants)
        .values({ slug: input.slug, displayName: input.displayName, branding })
        .returning({ id: tenants.id });
      if (!tenant) throw new Error('tenants insert returned no row');

      await tx.insert(tenantModules).values(
        TOGGLEABLE_MODULES.map((key) => ({
          tenantId: tenant.id,
          moduleKey: key,
          enabled: key !== 'example' && wanted.has(key),
        })),
      );

      await createPendingInvite(tx, {
        tenantId: tenant.id,
        email: input.adminEmail,
        createdBy: actor.userId,
      });
      return tenant.id;
    });
  } catch (error) {
    if (isUniqueViolation(error, 'slug')) {
      throw new ApiError(400, 'VALIDATION_FAILED', { slug: 'taken' });
    }
    throw error;
  }

  log.info(
    {
      event: 'platform.tenants.create',
      userId: actor.userId,
      tenantId,
      slug: input.slug,
      modules: [...wanted],
    },
    'tenant created',
  );

  await sendPendingInvites(tenantId, actor);
  return { id: tenantId };
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/**
 * ROLE-05: everything the panel's tenant page shows — and the ONLY platform answer that carries a
 * tenant's domains, invites and admins (T-02-19 / T-06-07: no members, no content). `modules` is the
 * six real keys in their canonical order (a missing row reads as disabled; `example` never appears).
 * `null` for an unknown id; the route turns that into 404.
 */
export async function getTenantDetail(id: string): Promise<PlatformTenantDetail | null> {
  const data = await withAdminTx(async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    if (!tenant) return null;

    const moduleRows = await tx
      .select({ moduleKey: tenantModules.moduleKey, enabled: tenantModules.enabled })
      .from(tenantModules)
      .where(eq(tenantModules.tenantId, id));

    const domainRows = await tx
      .select()
      .from(tenantDomains)
      .where(eq(tenantDomains.tenantId, id))
      .orderBy(desc(tenantDomains.isPrimary), asc(tenantDomains.createdAt));

    const inviteRows = await tx
      .select()
      .from(tenantInvites)
      .where(eq(tenantInvites.tenantId, id))
      .orderBy(asc(tenantInvites.createdAt));

    const adminRows = await tx
      .select({
        userId: memberships.userId,
        email: users.email,
        name: users.name,
        joinedAt: memberships.joinedAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.tenantId, id),
          eq(memberships.role, 'admin_tenant'),
          eq(memberships.status, 'active'),
          isNull(memberships.deletedAt),
        ),
      )
      .orderBy(asc(memberships.joinedAt));

    return { tenant, moduleRows, domainRows, inviteRows, adminRows };
  });
  if (!data) return null;

  const { tenant, moduleRows, domainRows, inviteRows, adminRows } = data;
  const branding = resolveBranding(tenant.branding);
  const enabledByKey = new Map(moduleRows.map((m) => [m.moduleKey, m.enabled]));

  return {
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      displayName: tenant.displayName,
      status: (tenant.status === 'suspended' ? 'suspended' : 'active') as TenantStatus,
      timezone: tenant.timezone,
      createdAt: tenant.createdAt.toISOString(),
      branding,
      contrast: contrastReport(branding.colors),
    },
    modules: REAL_TENANT_DEFAULT_MODULES.map((key) => ({
      key,
      enabled: enabledByKey.get(key) ?? false,
    })),
    domains: domainRows.map((d) => ({
      id: d.id,
      host: d.host,
      isPrimary: d.isPrimary,
      verificationStatus: d.verificationStatus as DomainStatus,
      verifiedAt: iso(d.verifiedAt),
      dnsRecords: d.dnsRecords,
      lastCheckedAt: iso(d.lastCheckedAt),
      verifyDeadlineAt: iso(d.verifyDeadlineAt),
      lastError: d.lastError,
      createdAt: d.createdAt.toISOString(),
    })),
    invites: inviteRows.map((i) => ({
      id: i.id,
      email: i.email,
      role: 'admin_tenant' as const,
      status: i.status as InviteStatus,
      sentAt: iso(i.sentAt),
      acceptedAt: iso(i.acceptedAt),
      createdAt: i.createdAt.toISOString(),
    })),
    admins: adminRows.map((a) => ({
      userId: a.userId,
      email: a.email,
      name: a.name,
      joinedAt: a.joinedAt.toISOString(),
    })),
  };
}

/** Every host of the tenant leaves the in-process host cache, so the next resolution sees the new row. */
async function invalidateTenantHosts(tenantId: string): Promise<void> {
  const hosts = await withAdminTx(async (tx) =>
    tx
      .select({ host: tenantDomains.host })
      .from(tenantDomains)
      .where(eq(tenantDomains.tenantId, tenantId)),
  );
  for (const row of hosts) invalidateTenantHost(row.host);
}

/**
 * `PATCH /v1/platform/tenants/{id}` (D-31): display name and/or the two source colors. The slug is
 * immutable — the contract does not even accept it. New colors are re-derived with the same function
 * the seed and the preview use, and the rest of the branding jsonb (logo, icons) is kept as is.
 */
export async function updateTenant(
  id: string,
  body: UpdateTenantBody,
  actor: PlatformActor,
): Promise<void> {
  await withAdminTx(async (tx) => {
    const [current] = await tx
      .select({ branding: tenants.branding })
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);
    if (!current) throw new ApiError(404, 'NOT_FOUND');

    const set: Partial<typeof tenants.$inferInsert> = { updatedAt: new Date() };
    if (body.displayName !== undefined) set.displayName = body.displayName;
    if (body.colors !== undefined) {
      set.branding = { ...current.branding, colors: deriveBrandColors(body.colors) };
    }
    await tx.update(tenants).set(set).where(eq(tenants.id, id));
  });

  await invalidateTenantHosts(id);
  logFor(actor, 'platform.tenants').info(
    {
      event: 'platform.tenants.update',
      userId: actor.userId,
      tenantId: id,
      fields: Object.keys(body).filter((k) => body[k as keyof UpdateTenantBody] !== undefined),
    },
    'tenant updated',
  );
}

/**
 * `POST /v1/platform/tenants/{id}/status` (D-32): active <-> suspended. The host cache is dropped for
 * every host so the branded "indisponível" shell and `requireAuth`'s 403 TENANT_SUSPENDED agree on
 * the very next request of this instance.
 */
export async function setTenantStatus(
  id: string,
  status: TenantStatus,
  actor: PlatformActor,
): Promise<void> {
  const updated = await withAdminTx(async (tx) =>
    tx
      .update(tenants)
      .set({ status, updatedAt: new Date() })
      .where(eq(tenants.id, id))
      .returning({ id: tenants.id }),
  );
  if (updated.length === 0) throw new ApiError(404, 'NOT_FOUND');

  await invalidateTenantHosts(id);
  logFor(actor, 'platform.tenants').info(
    { event: 'platform.tenants.status', userId: actor.userId, tenantId: id, status },
    'tenant status set',
  );
}
