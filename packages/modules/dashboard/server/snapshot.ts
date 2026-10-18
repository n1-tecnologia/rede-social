import type { Tx } from '@rede-social/core/db/tenant-tx';
import { desc, eq } from 'drizzle-orm';
import { type SnapshotMeta, type SnapshotWindows, snapshotWindowsSchema } from '../contracts/index';
import { dashboardSnapshots } from '../db/schema';

/** One `dashboard_snapshots` row as the owner reads read it. */
export type SnapshotRow = typeof dashboardSnapshots.$inferSelect;

/**
 * The tenant's newest snapshot (the greatest `snapshot_day`, EP-53), read in the CALLER's lane so the
 * admin-only select policy applies (D-462): a member or `support_tenant` lane reads nothing, even if
 * a route forgot `requireRole`. The explicit tenant predicate repeats RLS's (defense in depth).
 * `null` before the first build.
 */
export async function readLatestSnapshot(tx: Tx, tenantId: string): Promise<SnapshotRow | null> {
  const rows = await tx
    .select()
    .from(dashboardSnapshots)
    .where(eq(dashboardSnapshots.tenantId, tenantId))
    .orderBy(desc(dashboardSnapshots.snapshotDay))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The snapshot's meta for an answer: its day, its build instant as ISO and its windows. `null` when
 * the stored `windows` fail the contract (a shape from another version): the caller answers
 * `preparing`, never a half-valid meta (R-Pitfall 3).
 */
export function snapshotMetaOf(row: SnapshotRow): SnapshotMeta | null {
  const windows = snapshotWindowsSchema.safeParse(row.windows);
  if (!windows.success) return null;
  const parsed: SnapshotWindows = windows.data;
  return { day: row.snapshotDay, builtAt: row.builtAt.toISOString(), windows: parsed };
}
