import {
  type CreateTenantBody,
  contrastReport,
  type DomainStatus,
  deriveBrandColors,
  emptyBrandLook,
  type InviteStatus,
  type ModuleKey,
  normalizeBrandLook,
  type PlatformTenantDetail,
  type PlatformTenantsQuery,
  resolveBranding,
  type TenantBranding,
  type TenantStatus,
  TOGGLEABLE_MODULES,
  type UpdateTenantBody,
  withDarkPrimary,
} from '@rede-social/contracts';
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
import { projects, tenantProjects } from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import {
  memberProfiles,
  memberships,
  tenantDomains,
  tenantInvites,
  tenantModules,
  tenants,
  users,
} from '../../db/schema';
import { ApiError } from '../http/api-error';
import { pushToCentral, pushToTenant } from '../tenancy/mirror';
import { ProjectUnavailableError, ProjectUnboundError } from '../tenancy/project-errors';
import { invalidateProject } from '../tenancy/project-registry';
import { invalidateTenantHost } from '../tenancy/tenant-host';
import { applyBrandColors } from './branding';
import {
  createPendingInvite,
  identityKind,
  logFor,
  type PlatformActor,
  sendPendingInvites,
} from './invites';

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
 * ROLE-01 / ROLE-05: the cross-tenant read behind `GET /v1/platform/tenants`. It reads ONLY central
 * tables (the `tenants` mirror, `tenant_modules`, `tenant_domains`) through the platform lane
 * (09.2-07, D-537), so it answers with every tenant project's database closed. It lives in the
 * kernel because Biome `noRestrictedImports` confines the service lanes to `server/tenancy`,
 * `server/platform` and `scripts/` — a route file in `apps/api` must never reach past RLS on its own.
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

  const { tenantRows, moduleRows, hostRows } = await withPlatformTx(async (tx) => {
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
 * ROLE-03 (D-19, D-30, D-31, D-538): provisions a tenant as a two-step saga. Step 1 (one platform
 * transaction): the `tenants` row with its derived brand colors, one `tenant_modules` row per TOGGLEABLE key
 * (`enabled` per the checklist, `example` always false) and the explicit binding to the default project.
 * Step 2 (one transaction in the tenant's project): the first admin's `pending` invite. When step 2 fails the
 * rows of step 1 are deleted (`compensateCreate`), so the slug is free for a retry and no half-created tenant
 * survives. A duplicate slug surfaces the unique constraint as 400 `VALIDATION_FAILED { slug: 'taken' }` from
 * inside step 1, so a concurrent loser leaves no partial rows. The first admin may be anyone EXCEPT a
 * platform account (D-316): `identityKind` runs inside step 1 before the `tenants` insert and refuses a
 * `platform_admin` with 400 `VALIDATION_FAILED` carrying `adminEmail: in_use` as a field error, so
 * the form is where the super_admin corrects it. An existing member of another community is
 * accepted (D-314): the invite adds a membership for that identity instead of refusing it, and the
 * send mails the tokenless "use a senha que você já tem" invite. After commit the invites are sent —
 * a no-op until a verified primary host exists, which at creation is never.
 *
 * The wizard's look (2026-10-03, `input.look`, already the complete parsed look) is stored in its
 * canonical form, the persisted dark accent following its own dark primary (`withDarkPrimary`), as
 * `setBrandingLook` would store it; without one the tenant starts on the system's look.
 */
export async function createTenant(
  input: CreateTenantBody,
  actor: PlatformActor,
): Promise<{ id: string }> {
  const log = logFor(actor, 'platform.tenants');
  const adminEmail = input.adminEmail.trim().toLowerCase();
  const look = normalizeBrandLook(input.look ?? emptyBrandLook());
  const branding: TenantBranding = {
    logoUrl: null,
    faviconUrl: null,
    iconUrl: null,
    iconUrls: null,
    iconVersion: 0,
    colors: withDarkPrimary(deriveBrandColors(input.colors), look.darkColors.primary),
    look,
  };
  const wanted = new Set<ModuleKey>(input.modules);

  // Step 1, the CONTROL PLANE (one platform transaction): the tenant row with its derived brand, one module
  // row per toggleable key and the explicit binding to the default project. Committed before step 2 so the
  // tenant's project can be resolved from the tenant id.
  let tenantId: string;
  try {
    tenantId = await withPlatformTx(async (tx) => {
      // Only a platform account is refused (D-316); a member of another tenant may administer this
      // one (D-314). Nothing was inserted yet, so the throw rolls back nothing.
      const identity = await identityKind(tx, adminEmail);
      if (identity.kind === 'platform_admin') {
        throw new ApiError(400, 'VALIDATION_FAILED', { adminEmail: 'in_use' });
      }
      // The first admin is staff and staff never depend on an access (D-492); the manual row that
      // `createPendingInvite` writes in step 2 is what lets the creation hook pass at send time.

      // The default project must exist BEFORE anything is written: no default is a refusal, never a guess.
      const [defaultProject] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.isDefault, true))
        .limit(1);
      if (!defaultProject) throw new ProjectUnboundError();

      const [tenant] = await tx
        .insert(tenants)
        .values({ slug: input.slug, displayName: input.displayName, branding })
        .returning({ id: tenants.id });
      if (!tenant) throw new Error('tenants insert returned no row');

      await tx.insert(tenantModules).values(
        TOGGLEABLE_MODULES.map((key) => ({
          tenantId: tenant.id,
          moduleKey: key,
          enabled: wanted.has(key),
        })),
      );
      await tx
        .insert(tenantProjects)
        .values({ tenantId: tenant.id, projectId: defaultProject.id });
      return tenant.id;
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (isUniqueViolation(error, 'slug')) {
      throw new ApiError(400, 'VALIDATION_FAILED', { slug: 'taken' });
    }
    throw error;
  }

  // Step 2, the TENANT'S project (its own transaction): the first admin's pending invite. When it fails, the
  // rows of step 1 are deleted so the slug is free for a retry and no half-created tenant survives (T-09.2-31).
  try {
    await withAdminTx({ tenantId }, (tx) =>
      createPendingInvite(tx, { tenantId, email: adminEmail, createdBy: actor.userId }),
    );
  } catch (error) {
    await compensateCreate(tenantId, log);
    throw error;
  }

  log.info(
    {
      event: 'platform.tenants.create',
      userId: actor.userId,
      tenantId,
      slug: input.slug,
      modules: [...wanted],
      look: input.look !== undefined,
    },
    'tenant created',
  );

  await sendPendingInvites(tenantId, actor);
  return { id: tenantId };
}

/**
 * The compensation of `createTenant` step 2 (D-538): deletes the binding, the module rows and the tenant row
 * of step 1 (they also cascade from the tenant row), then forgets the cached binding. A failure here is
 * logged, not thrown: the caller rethrows the error that made the saga fail.
 */
async function compensateCreate(tenantId: string, log: ReturnType<typeof logFor>): Promise<void> {
  try {
    await withPlatformTx(async (tx) => {
      await tx.delete(tenantProjects).where(eq(tenantProjects.tenantId, tenantId));
      await tx.delete(tenantModules).where(eq(tenantModules.tenantId, tenantId));
      await tx.delete(tenants).where(eq(tenants.id, tenantId));
    });
    log.warn(
      { event: 'platform.tenants.create_compensated', tenantId },
      'tenant creation compensated',
    );
  } catch {
    log.error(
      { event: 'platform.tenants.create_compensation_failed', tenantId },
      'tenant creation could not be compensated',
    );
  } finally {
    invalidateProject(tenantId);
  }
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/**
 * ROLE-05: everything the panel's tenant page shows — and the ONLY platform answer that carries a
 * tenant's domains, invites and admins (T-02-19 / T-06-07: no members, no content). `modules` is the
 * six real keys in their canonical order (a missing row reads as disabled; `example` never appears).
 * `invites` are ordered OLDEST first (`asc(createdAt)`), so the newest invite is the LAST element;
 * the Admins tab reads `invites.at(-1)` (02-REVIEW IN-05, fixed in 08-08).
 * `null` for an unknown id; the route turns that into 404.
 */
export async function getTenantDetail(
  id: string,
  opts: { tolerateTenantDown?: boolean } = {},
): Promise<PlatformTenantDetail | null> {
  // The control plane first: the tenant, its modules and its domains are central facts. A tenant id that
  // does not exist centrally is the 404, and no tenant lane is opened for it (T-09.2-32).
  const central = await withPlatformTx(async (tx) => {
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

    return { tenant, moduleRows, domainRows };
  });
  if (!central) return null;

  // Then the tenant's own project, after the first transaction has closed (never nested): invites and the
  // admins' names are tenant data. Merged in memory below.
  type TenantSide = {
    inviteRows: (typeof tenantInvites.$inferSelect)[];
    adminRows: { userId: string; email: string; name: string; joinedAt: Date }[];
  };
  let side: TenantSide;
  try {
    side = await withAdminTx({ tenantId: id }, async (tx) => {
      const inviteRows = await tx
        .select()
        .from(tenantInvites)
        .where(eq(tenantInvites.tenantId, id))
        .orderBy(asc(tenantInvites.createdAt));

      // D-310: an admin's name is the profile of THIS tenant's admin membership (joined by the
      // membership id, inside the tenant filter), so a person who administers two tenants shows each
      // tenant's own name. `users` stays joined for the e-mail only.
      const adminRows = await tx
        .select({
          userId: memberships.userId,
          email: users.email,
          name: memberProfiles.displayName,
          joinedAt: memberships.joinedAt,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .innerJoin(memberProfiles, eq(memberProfiles.membershipId, memberships.id))
        .where(
          and(
            eq(memberships.tenantId, id),
            eq(memberships.role, 'admin_tenant'),
            eq(memberships.status, 'active'),
            isNull(memberships.deletedAt),
          ),
        )
        .orderBy(asc(memberships.joinedAt));
      return { inviteRows, adminRows };
    });
  } catch (error) {
    // A mutation's answer must not depend on the tenant's project being up (the central write already
    // committed): its invites and admins read empty. A plain read of the detail still fails with 503.
    if (opts.tolerateTenantDown && error instanceof ProjectUnavailableError) {
      side = { inviteRows: [], adminRows: [] };
    } else {
      throw error;
    }
  }
  const { tenant, moduleRows, domainRows } = central;
  const { inviteRows, adminRows } = side;
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
    // Every toggleable key, `store` included (08.2-05): the panel's Módulos tab draws one row per
    // key from this list, so a key turned on must be reported on, whatever the new-tenant default.
    modules: TOGGLEABLE_MODULES.map((key) => ({
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
  const hosts = await withPlatformTx(async (tx) =>
    tx
      .select({ host: tenantDomains.host })
      .from(tenantDomains)
      .where(eq(tenantDomains.tenantId, tenantId)),
  );
  for (const row of hosts) invalidateTenantHost(row.host);
}

/**
 * `PATCH /v1/platform/tenants/{id}` (D-31): display name and/or the two source colors. The slug is
 * immutable — the contract does not even accept it. The two halves live in two places (D-537): the
 * display name is CENTRAL-owned (written in the control plane, then pushed to the tenant's copy), the brand
 * colors are TENANT-owned (written in the tenant's project, then copied to the central mirror). Colors go
 * through `applyBrandColors` — the ONE persistence path shared with `PUT …/branding/colors` (02-13) — so a
 * primary change also bumps `iconVersion` and re-derives the maskable icon whichever door changed it; the
 * rest of the branding jsonb (logo, icons) is kept as is. No contrast gate here (the 02-03 contract has no
 * confirmation field); the detail answer carries `tenant.contrast` for the caller to read.
 */
export async function updateTenant(
  id: string,
  body: UpdateTenantBody,
  actor: PlatformActor,
): Promise<void> {
  // The control plane: the tenant must exist centrally (404 before any tenant lane), the display name is written.
  await withPlatformTx(async (tx) => {
    const [current] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);
    if (!current) throw new ApiError(404, 'NOT_FOUND');

    if (body.displayName !== undefined) {
      await tx
        .update(tenants)
        .set({ displayName: body.displayName, updatedAt: new Date() })
        .where(eq(tenants.id, id));
    }
  });

  // The tenant's project: the brand colors live in its own `tenants.branding`.
  if (body.colors !== undefined) {
    const colors = body.colors;
    await withAdminTx({ tenantId: id }, async (tx) => {
      const [current] = await tx
        .select({ id: tenants.id, branding: tenants.branding })
        .from(tenants)
        .where(eq(tenants.id, id))
        .limit(1);
      if (!current) throw new ApiError(404, 'NOT_FOUND');
      await applyBrandColors(tx, current, colors, actor);
    });
    await pushToCentral(id, ['branding']);
  }
  if (body.displayName !== undefined) await pushToTenant(id, ['displayName']);

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
 * `POST /v1/platform/tenants/{id}/status` (D-32): active <-> suspended. The status is CENTRAL-owned (D-537):
 * it is decided in the control plane, which is what `requireAuth` and the by-host answer read, and a copy is
 * pushed to the tenant's own row afterwards. A push that cannot reach the tenant's project is logged and
 * healed by the reconcile function; it never fails the request, because the authority already changed. The
 * host cache is dropped for every host so the branded "indisponível" shell and `requireAuth`'s 403
 * TENANT_SUSPENDED agree on the very next request of this instance.
 */
export async function setTenantStatus(
  id: string,
  status: TenantStatus,
  actor: PlatformActor,
): Promise<void> {
  const updated = await withPlatformTx(async (tx) =>
    tx
      .update(tenants)
      .set({ status, updatedAt: new Date() })
      .where(eq(tenants.id, id))
      .returning({ id: tenants.id }),
  );
  if (updated.length === 0) throw new ApiError(404, 'NOT_FOUND');

  await invalidateTenantHosts(id);
  await pushToTenant(id, ['status']);
  logFor(actor, 'platform.tenants').info(
    { event: 'platform.tenants.status', userId: actor.userId, tenantId: id, status },
    'tenant status set',
  );
}
