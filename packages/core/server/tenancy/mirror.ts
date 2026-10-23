import type { TenantBranding } from '@rede-social/contracts';
import { eq, inArray } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { projects, tenantProjects } from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import { tenantDomains, tenantModules, tenants } from '../../db/schema';
import type { Tx } from '../../db/tenant-tx';
import { moduleLogger, redactDbError } from '../logging';
import { ProjectUnavailableError, ProjectUnboundError } from './project-errors';
import { resolveProject } from './project-registry';
import { invalidateTenantHost } from './tenant-host';

/**
 * The central/tenant split of the `tenants` and `tenant_modules` rows (09.2-07, D-537).
 *
 * A tenant has two copies of those rows: one in the CENTRAL project (the mirror the shell, the panel and the
 * auth gate read, so they work while the tenant's project is down) and one in the tenant's OWN project (what
 * the tenant's own queries join against). Each column has exactly ONE owner, the side that is allowed to edit
 * it; the other side holds a copy, written after the owner's commit. For a tenant on project 0 both copies are
 * the SAME row, so every push is skipped and behaviour is unchanged.
 *
 *   CENTRAL owns  slug, status, display_name, timezone, plan of `tenants`; `enabled` of `tenant_modules`
 *                 (the `super_admin` edits them centrally; the system pushes a copy to the tenant's project)
 *   TENANT owns   `branding` of `tenants` (copied back to the central mirror so the by-host answer works while
 *                 the tenant's project is down); `rules_text`, `rules_version` of `tenants` and `settings` of
 *                 `tenant_modules` (the `admin_tenant` edits them in the tenant's project; NOT mirrored: the
 *                 control plane never needs them)
 *   LOCAL         identifiers and timestamps, never copied
 *   `tenant_domains` exist only centrally and are not part of this table at all.
 *
 * `mirror-fields.test.ts` asserts every column of both tables is in exactly one list, so a column a later
 * phase adds fails the test until somebody decides its owner.
 *
 * A push runs AFTER the owner's commit, is best effort and never throws into the request: a failure is logged
 * as `platform.mirror.push_failed` with a reason code (never a value, a URL or a driver message) and the
 * reconcile function heals the drift. The reconcile NEVER writes a tenant-owned column from the central copy,
 * except when the tenant's row is missing altogether (then the central copy is the only copy that exists).
 */

export type OwnedColumn = { table: 'tenants' | 'tenant_modules'; column: string };

/** What a caller names when it pushes a central-owned value to the tenant's copy. */
export type CentralField = 'slug' | 'status' | 'displayName' | 'timezone' | 'plan' | 'modules';
/** What a caller names when it copies a tenant-owned value back to the central mirror. */
export type TenantField = 'branding';

/** The one source of the central-owned list: field name -> the column it covers. */
export const CENTRAL_FIELD_COLUMN: Readonly<Record<CentralField, OwnedColumn>> = {
  slug: { table: 'tenants', column: 'slug' },
  status: { table: 'tenants', column: 'status' },
  displayName: { table: 'tenants', column: 'display_name' },
  timezone: { table: 'tenants', column: 'timezone' },
  plan: { table: 'tenants', column: 'plan' },
  modules: { table: 'tenant_modules', column: 'enabled' },
};

export const CENTRAL_OWNED: readonly OwnedColumn[] = Object.values(CENTRAL_FIELD_COLUMN);

export const TENANT_OWNED: readonly OwnedColumn[] = [
  { table: 'tenants', column: 'branding' },
  { table: 'tenants', column: 'rules_text' },
  { table: 'tenants', column: 'rules_version' },
  { table: 'tenant_modules', column: 'settings' },
];

/** Identifiers and timestamps: neither side owns them, nobody copies them. */
export const LOCAL_COLUMNS: readonly OwnedColumn[] = [
  { table: 'tenants', column: 'id' },
  { table: 'tenants', column: 'created_at' },
  { table: 'tenants', column: 'updated_at' },
  { table: 'tenant_modules', column: 'tenant_id' },
  { table: 'tenant_modules', column: 'module_key' },
  { table: 'tenant_modules', column: 'updated_at' },
];

const log = moduleLogger('mirror');
/** Test seam: the logger the push and reconcile events go through, so a spec can assert an event was emitted. */
export const mirrorInternals = { log };

export type PushResult =
  | { pushed: true }
  | { pushed: false; reason: 'central_project' | 'tenant_not_found' | string };

/** A short, value-free reason for a log line and a result. */
function reasonOf(error: unknown): string {
  if (error instanceof ProjectUnavailableError) return 'project_unavailable';
  if (error instanceof ProjectUnboundError) return 'project_unbound';
  const redacted = redactDbError(error);
  if (
    redacted &&
    typeof redacted === 'object' &&
    'sqlstate' in redacted &&
    typeof redacted.sqlstate === 'string'
  ) {
    return `sqlstate_${redacted.sqlstate}`;
  }
  return 'error';
}

type RowCopy = {
  row: {
    id: string;
    slug: string;
    displayName: string;
    timezone: string;
    plan: string;
    status: string;
    branding: TenantBranding;
  };
  modules: { moduleKey: string; enabled: boolean }[];
};

/** The `tenants` row and its `tenant_modules` flags as they are in the database `tx` is open on. */
async function readCopy(tx: Tx, tenantId: string): Promise<RowCopy | null> {
  const [row] = await tx
    .select({
      id: tenants.id,
      slug: tenants.slug,
      displayName: tenants.displayName,
      timezone: tenants.timezone,
      plan: tenants.plan,
      status: tenants.status,
      branding: tenants.branding,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!row) return null;
  const modules = await tx
    .select({ moduleKey: tenantModules.moduleKey, enabled: tenantModules.enabled })
    .from(tenantModules)
    .where(eq(tenantModules.tenantId, tenantId));
  return { row, modules };
}

/** Key-order independent text of a json value, so two jsonb reads of one value compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Every host of the tenant leaves the in-process host cache, so the next by-host answer sees the new brand. */
async function dropHostCache(tenantId: string): Promise<void> {
  const hosts = await withPlatformTx((tx) =>
    tx
      .select({ host: tenantDomains.host })
      .from(tenantDomains)
      .where(eq(tenantDomains.tenantId, tenantId)),
  );
  for (const row of hosts) invalidateTenantHost(row.host);
}

/**
 * Copies the named CENTRAL-owned values to the tenant's own copy, after the central commit. A tenant on the
 * central project is skipped (`central_project`: the mirror and the tenant copy are one row). A missing tenant
 * row is created from the central values, brand included (the central copy is then the only one). Never throws.
 */
export async function pushToTenant(
  tenantId: string,
  fields: readonly CentralField[],
): Promise<PushResult> {
  let projectId: string | undefined;
  try {
    const project = await resolveProject(tenantId);
    projectId = project.id;
    if (project.isCentral) return { pushed: false, reason: 'central_project' };

    const central = await withPlatformTx((tx) => readCopy(tx, tenantId));
    if (!central) return { pushed: false, reason: 'tenant_not_found' };

    const wantsRow = fields.some((f) => f !== 'modules');
    const wantsModules = fields.includes('modules');
    const { row } = central;

    await withAdminTx({ tenantId }, async (tx) => {
      // The row first: `tenant_modules` references it. Only the requested columns are overwritten.
      const insert = tx.insert(tenants).values({
        id: row.id,
        slug: row.slug,
        displayName: row.displayName,
        timezone: row.timezone,
        plan: row.plan,
        status: row.status,
        branding: row.branding,
      });
      if (wantsRow) {
        await insert.onConflictDoUpdate({
          target: tenants.id,
          set: {
            ...(fields.includes('slug') ? { slug: row.slug } : {}),
            ...(fields.includes('displayName') ? { displayName: row.displayName } : {}),
            ...(fields.includes('timezone') ? { timezone: row.timezone } : {}),
            ...(fields.includes('plan') ? { plan: row.plan } : {}),
            ...(fields.includes('status') ? { status: row.status } : {}),
            updatedAt: new Date(),
          },
        });
      } else {
        await insert.onConflictDoNothing({ target: tenants.id });
      }
      if (wantsModules) {
        for (const m of central.modules) {
          await tx
            .insert(tenantModules)
            .values({ tenantId, moduleKey: m.moduleKey, enabled: m.enabled })
            .onConflictDoUpdate({
              target: [tenantModules.tenantId, tenantModules.moduleKey],
              set: { enabled: m.enabled, updatedAt: new Date() },
            });
        }
      }
    });
    log.info({ event: 'platform.mirror.push', tenantId, projectId, fields }, 'mirror pushed');
    return { pushed: true };
  } catch (error) {
    const reason = reasonOf(error);
    log.warn(
      {
        event: 'platform.mirror.push_failed',
        tenantId,
        projectId,
        fields,
        direction: 'to_tenant',
        code: reason,
      },
      'mirror push failed',
    );
    return { pushed: false, reason };
  }
}

/**
 * Copies the TENANT-owned `branding` of the tenant's own row to the central mirror, after the tenant's commit,
 * and drops the host cache of every host of the tenant. Skipped for a tenant on the central project (one row).
 * Never throws.
 */
export async function pushToCentral(
  tenantId: string,
  fields: readonly TenantField[],
): Promise<PushResult> {
  let projectId: string | undefined;
  try {
    const project = await resolveProject(tenantId);
    projectId = project.id;
    if (project.isCentral) return { pushed: false, reason: 'central_project' };

    const own = await withAdminTx({ tenantId }, (tx) => readCopy(tx, tenantId));
    if (!own) return { pushed: false, reason: 'tenant_not_found' };

    const updated = await withPlatformTx((tx) =>
      tx
        .update(tenants)
        .set({
          ...(fields.includes('branding') ? { branding: own.row.branding } : {}),
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, tenantId))
        .returning({ id: tenants.id }),
    );
    if (updated.length === 0) return { pushed: false, reason: 'tenant_not_found' };

    await dropHostCache(tenantId);
    log.info({ event: 'platform.mirror.push', tenantId, projectId, fields }, 'mirror pushed');
    return { pushed: true };
  } catch (error) {
    const reason = reasonOf(error);
    log.warn(
      {
        event: 'platform.mirror.push_failed',
        tenantId,
        projectId,
        fields,
        direction: 'to_central',
        code: reason,
      },
      'mirror push failed',
    );
    return { pushed: false, reason };
  }
}

export type ReconcileResult = {
  tenantId: string;
  /** What was written, as `table.column` names (never a value). Empty when both copies agree. */
  healed: string[];
  /** Set when nothing was compared: the tenant is on the central project, or the reason the compare failed. */
  skipped?: 'central_project' | 'tenant_not_found';
  failed?: string;
};

/**
 * Aligns the two copies of one tenant and writes only what differs: every CENTRAL-owned column flows
 * central -> tenant, `branding` flows tenant -> central, and nothing crosses an ownership line the other way.
 * A tenant whose row is missing in its own project is re-created from the central values (its module rows
 * too, and the brand from the central copy: the only one). A tenant on the central project is skipped.
 * An unreachable project is reported as `failed` and never throws.
 */
export async function reconcileTenantMirror(tenantId: string): Promise<ReconcileResult> {
  const healed: string[] = [];
  try {
    const project = await resolveProject(tenantId);
    if (project.isCentral) return { tenantId, healed, skipped: 'central_project' };

    const central = await withPlatformTx((tx) => readCopy(tx, tenantId));
    if (!central) return { tenantId, healed, skipped: 'tenant_not_found' };
    const own = await withAdminTx({ tenantId }, (tx) => readCopy(tx, tenantId));

    if (!own) {
      // The only copy that exists is the central one: seed the whole row from it, brand included.
      await withAdminTx({ tenantId }, async (tx) => {
        const { row } = central;
        await tx.insert(tenants).values({
          id: row.id,
          slug: row.slug,
          displayName: row.displayName,
          timezone: row.timezone,
          plan: row.plan,
          status: row.status,
          branding: row.branding,
        });
        for (const m of central.modules) {
          await tx
            .insert(tenantModules)
            .values({ tenantId, moduleKey: m.moduleKey, enabled: m.enabled });
        }
      });
      healed.push('tenants.row');
      if (central.modules.length > 0) healed.push('tenant_modules.rows');
    } else {
      // central -> tenant: only the central-owned columns that differ.
      const set: Partial<Record<'slug' | 'displayName' | 'timezone' | 'plan' | 'status', string>> =
        {};
      const differs = (field: CentralField, a: string, b: string, key: keyof typeof set) => {
        if (a !== b) {
          set[key] = a;
          healed.push(`tenants.${CENTRAL_FIELD_COLUMN[field].column}`);
        }
      };
      differs('slug', central.row.slug, own.row.slug, 'slug');
      differs('displayName', central.row.displayName, own.row.displayName, 'displayName');
      differs('timezone', central.row.timezone, own.row.timezone, 'timezone');
      differs('plan', central.row.plan, own.row.plan, 'plan');
      differs('status', central.row.status, own.row.status, 'status');

      const ownByKey = new Map(own.modules.map((m) => [m.moduleKey, m.enabled]));
      const moduleWrites = central.modules.filter((m) => ownByKey.get(m.moduleKey) !== m.enabled);

      if (Object.keys(set).length > 0 || moduleWrites.length > 0) {
        await withAdminTx({ tenantId }, async (tx) => {
          if (Object.keys(set).length > 0) {
            await tx
              .update(tenants)
              .set({ ...set, updatedAt: new Date() })
              .where(eq(tenants.id, tenantId));
          }
          for (const m of moduleWrites) {
            await tx
              .insert(tenantModules)
              .values({ tenantId, moduleKey: m.moduleKey, enabled: m.enabled })
              .onConflictDoUpdate({
                target: [tenantModules.tenantId, tenantModules.moduleKey],
                set: { enabled: m.enabled, updatedAt: new Date() },
              });
            healed.push(`tenant_modules.enabled:${m.moduleKey}`);
          }
        });
      }

      // tenant -> central: the brand, only when it differs.
      if (canonical(own.row.branding) !== canonical(central.row.branding)) {
        await withPlatformTx((tx) =>
          tx
            .update(tenants)
            .set({ branding: own.row.branding, updatedAt: new Date() })
            .where(eq(tenants.id, tenantId)),
        );
        await dropHostCache(tenantId);
        healed.push('tenants.branding');
      }
    }

    if (healed.length > 0) {
      log.info(
        { event: 'platform.mirror.reconcile', tenantId, projectId: project.id, healed },
        'mirror reconciled',
      );
    }
    return { tenantId, healed };
  } catch (error) {
    const failed = reasonOf(error);
    log.warn(
      { event: 'platform.mirror.reconcile', tenantId, healed, failed },
      'mirror reconcile failed',
    );
    return { tenantId, healed, failed };
  }
}

export type ReconcileAllResult = {
  /** Tenants of non-central projects that were examined. */
  tenants: number;
  /** Total number of healed items across all tenants. */
  healed: number;
  /** Tenants whose project could not be compared. */
  failed: number;
  results: ReconcileResult[];
};

/**
 * Reconciles every tenant that lives outside the central project, `concurrency` at a time (default 4). A
 * tenant whose project cannot be reached counts as `failed`; the loop goes on. With no such tenant the answer
 * is `{ tenants: 0, healed: 0, failed: 0 }`. `tenantIds` narrows the set (a test, an operator command).
 */
export async function reconcileAllMirrors(
  opts: { concurrency?: number; tenantIds?: readonly string[] } = {},
): Promise<ReconcileAllResult> {
  const concurrency = Math.max(1, Math.trunc(opts.concurrency ?? 4));
  if (opts.tenantIds && opts.tenantIds.length === 0) {
    return { tenants: 0, healed: 0, failed: 0, results: [] };
  }
  const rows = await withPlatformTx((tx) =>
    tx
      .select({ tenantId: tenantProjects.tenantId })
      .from(tenantProjects)
      .innerJoin(projects, eq(projects.id, tenantProjects.projectId))
      .where(
        opts.tenantIds
          ? inArray(tenantProjects.tenantId, [...opts.tenantIds])
          : eq(projects.isCentral, false),
      ),
  );
  const ids = rows.map((r) => r.tenantId);

  const results: ReconcileResult[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < ids.length) {
      const id = ids[next];
      next += 1;
      if (id === undefined) return;
      results.push(await reconcileTenantMirror(id));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));

  const examined = results.filter((r) => r.skipped !== 'central_project');
  return {
    tenants: examined.length,
    healed: examined.reduce((n, r) => n + r.healed.length, 0),
    failed: examined.filter((r) => r.failed !== undefined).length,
    results,
  };
}
