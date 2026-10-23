import { eq } from 'drizzle-orm';
import type { Sql } from 'postgres';
import { projectSchemaState, tenantProjects } from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import { tenantDomains } from '../../db/schema';
import {
  type AppliedTenantSchema,
  isBehind,
  type RequiredTenantSchema,
} from '../migrations/required';
import { invalidateTenantHost } from '../tenancy/tenant-host';

/**
 * Where each project stands against the image's tenant schema (09.2-15, D-544, D-545, DBT-24): one
 * `platform.project_schema_state` row per migrated project, written by the fan-out (`migrateAll`) and read by
 * the host answer (`updating`), the panel overview and the list filter. Nothing here carries a connection
 * string, a statement or a driver message: counts, 14-digit versions and a content-free error code.
 */

export type SchemaStatus = 'current' | 'behind' | 'failed' | 'unknown';

export type AppliedCounts = { appliedCount: number | null; appliedHead: string | null };

/**
 * `current` / `behind` / `unknown` from what a project has applied against what the image requires.
 *
 *  - no requirement (no manifest) or nothing known about the project (never touched) is `unknown`, never `behind`;
 *  - a count BELOW the required one, or a head BELOW the required head, is `behind` (the off-by-one included, and
 *    an equal head with a lower count is a gap);
 *  - equal, or ABOVE (an image older than the database), is `current`.
 *
 * Heads are 14-digit strings and compare as text, which orders them as numbers at equal length.
 */
export function stateOf(
  applied: AppliedCounts | null | undefined,
  required: RequiredTenantSchema | null | undefined,
): 'current' | 'behind' | 'unknown' {
  if (!required || !applied) return 'unknown';
  if (applied.appliedCount === null && applied.appliedHead === null) return 'unknown';
  const view: AppliedTenantSchema = { count: applied.appliedCount, head: applied.appliedHead };
  return isBehind(view, required) ? 'behind' : 'current';
}

/** What the project's own ledger holds right now: how many files and the greatest version (null when empty). */
export async function readAppliedSchema(client: Sql): Promise<AppliedCounts> {
  const [present] = await client<{ present: boolean }[]>`
    select to_regclass('supabase_migrations.schema_migrations') is not null as present`;
  if (!present?.present) return { appliedCount: 0, appliedHead: null };
  const [row] = await client<{ n: number; head: string | null }[]>`
    select count(*)::int as n, max(version) as head from supabase_migrations.schema_migrations`;
  return { appliedCount: row?.n ?? 0, appliedHead: row?.head ?? null };
}

export type SchemaStateInput = {
  /** What the ledger holds; omitted (left as stored) when the project could not be read. */
  applied?: AppliedCounts;
  required: RequiredTenantSchema | null;
  status: SchemaStatus;
  failedVersion?: string | null;
  errorCode?: string | null;
};

export type StoredSchemaState = {
  appliedCount: number | null;
  appliedHead: string | null;
  status: string;
};

/** The stored row of a project, `null` when the runner never touched it. */
export async function readSchemaState(projectId: string): Promise<StoredSchemaState | null> {
  const rows = await withPlatformTx((tx) =>
    tx
      .select({
        appliedCount: projectSchemaState.appliedCount,
        appliedHead: projectSchemaState.appliedHead,
        status: projectSchemaState.status,
      })
      .from(projectSchemaState)
      .where(eq(projectSchemaState.projectId, projectId))
      .limit(1),
  );
  return rows[0] ?? null;
}

/**
 * Upserts the project's row. `changed` says whether what the host answer reads (applied numbers) or the status
 * moved, so the caller drops the host caches only then. The row is written even when nothing changed
 * (`checked_at` says when the fan-out last looked).
 */
export async function recordSchemaState(
  projectId: string,
  input: SchemaStateInput,
): Promise<{ changed: boolean }> {
  const before = await readSchemaState(projectId);
  const applied = input.applied;
  const values = {
    projectId,
    status: input.status,
    requiredCount: input.required?.count ?? null,
    requiredHead: input.required?.head ?? null,
    failedVersion: input.status === 'failed' ? (input.failedVersion ?? null) : null,
    errorCode: input.status === 'failed' ? (input.errorCode ?? null) : null,
    checkedAt: new Date(),
    updatedAt: new Date(),
    ...(applied ? { appliedCount: applied.appliedCount, appliedHead: applied.appliedHead } : {}),
  };
  const { projectId: _id, ...update } = values;
  await withPlatformTx((tx) =>
    tx
      .insert(projectSchemaState)
      .values(values)
      .onConflictDoUpdate({ target: projectSchemaState.projectId, set: update }),
  );
  const changed =
    !before ||
    before.status !== input.status ||
    (applied !== undefined &&
      (before.appliedCount !== applied.appliedCount || before.appliedHead !== applied.appliedHead));
  return { changed };
}

/** Drops the cached host answers of every tenant bound to the project, so a lifted hold-out shows at once. */
export async function invalidateProjectHosts(projectId: string): Promise<void> {
  const rows = await withPlatformTx((tx) =>
    tx
      .select({ host: tenantDomains.host })
      .from(tenantProjects)
      .innerJoin(tenantDomains, eq(tenantDomains.tenantId, tenantProjects.tenantId))
      .where(eq(tenantProjects.projectId, projectId)),
  );
  for (const row of rows) invalidateTenantHost(row.host);
}
