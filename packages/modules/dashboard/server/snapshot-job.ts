import { withTenantTx } from '@rede-social/core/db/tenant-tx';
import { moduleLogger } from '@rede-social/core/server/logging';
import type { JobDefinition } from '@rede-social/core/server/modules/manifest';
import { sql } from 'drizzle-orm';
import {
  DASHBOARD_QUEUES,
  type SnapshotBuildJob,
  snapshotBuildPayloadSchema,
} from '../contracts/index';
import { dashboardSystemCtx } from './system-context';

// A child of the kernel root (WR-12): severity-formatted, LOG_LEVEL-aware — never a bare pino().
const log = moduleLogger('module-dashboard');

/** What one build run did: built the row, found it already built, or dropped a bad payload. */
export type SnapshotBuildOutcome = 'built' | 'skipped' | 'dropped';

/**
 * The `dashboard.snapshot-build` handler body (08.7-01, D-464): build tenant `tenantId`'s snapshot of
 * its local day `day`.
 *
 * - A malformed payload is DROPPED with a shape-only warning, never raised: pg-boss would retry a
 *   raise forever against a shape that can never become valid (the reminder rule).
 * - The build runs in `dashboardSystemCtx(tenantId)` (the zero user, the builder's only accepted
 *   lane) with a 120 s statement timeout (R-A8, T-08.7-06), as ONE call of the definer: it answers
 *   `true` when it wrote the row, `false` when the row was already built at the current payload
 *   version (idempotent: a duplicate dispatch costs one cheap check).
 * - A database error (an invalid tenant timezone, a timeout) PROPAGATES so pg-boss retries; it
 *   affects that tenant's job only.
 * - Log lines carry ids and timings only, never a name or a number of the payload (PR-1).
 */
export async function runSnapshotBuild(raw: unknown): Promise<SnapshotBuildOutcome> {
  const parsed = snapshotBuildPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    log.warn({ event: 'dashboard.snapshot.bad_payload' }, 'snapshot build payload rejected');
    return 'dropped';
  }
  const { tenantId, day } = parsed.data;
  const started = Date.now();
  const built = await withTenantTx(dashboardSystemCtx(tenantId), async (tx) => {
    await tx.execute(sql`set local statement_timeout = '120s'`);
    const rows = await tx.execute<{ built: boolean }>(
      sql`select app.dashboard_build_snapshot(${day}::date) as built`,
    );
    return rows[0]?.built === true;
  });
  const event = built ? 'dashboard.snapshot.built' : 'dashboard.snapshot.skipped';
  log.info({ event, tenantId, day, ms: Date.now() - started }, 'snapshot build');
  return built ? 'built' : 'skipped';
}

/** `dashboard.snapshot-build` (08.7-01): one tenant at a time per worker instance (T-08.7-06). */
export const snapshotBuildJob: JobDefinition<SnapshotBuildJob> = {
  name: DASHBOARD_QUEUES.snapshotBuild,
  handler: (payload) => runSnapshotBuild(payload).then(() => undefined),
  concurrency: 1,
};
