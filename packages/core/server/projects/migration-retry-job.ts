import { and, eq, inArray } from 'drizzle-orm';
import { projectSchemaState, projects } from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import { enqueueInTx, registerJobQueues } from '../jobs/boss';
import { moduleLogger } from '../logging';
import type { JobDefinition } from '../modules/manifest';
import { type MigrateDeps, migrateAll } from './migrate';

/**
 * `platform.migration-retry` (09.2-15, D-545, DBT-25): the self-heal between deploys. The deploy runs the
 * fan-out once (`ROLE=migrate`); a project that was unreachable at that moment, or whose file failed for a
 * transient reason, stays `failed` or `behind` in `platform.project_schema_state` and its tenants wait behind the
 * branded "updating" screen. This job re-runs the SAME `migrateAll` for exactly those projects every 300 s, so a
 * transient failure heals without a deploy; the runner's per-project advisory lock serialises it against the
 * deploy Job and against a hand run.
 *
 * A PLATFORM-scope job (it crosses projects), paced like the mirror reconcile and the health sweep: no scheduler,
 * every run ends by queueing the next one 300 s out under a CONSTANT singleton key (the `short` queue policy
 * keeps at most one waiting run), and the worker opens the cadence at boot under a DIFFERENT key
 * (`armMigrationRetry`), so a pending re-arm can never swallow the boot run.
 *
 * Never throws: pg-boss would retry a crashing job and park it, leaving the cadence stopped. Project 0 is
 * retried only where the worker holds the `postgres` connection for it (`MIGRATION_DATABASE_URL`); a worker
 * without it leaves project 0 to the deploy Job. Logs carry counts only.
 */

export const MIGRATION_RETRY_QUEUE = 'platform.migration-retry';

/** The constant singleton key of the re-arm. */
export const MIGRATION_RETRY_SINGLETON = 'migration-retry';

/** The boot arm's singleton key: never the re-arm's. */
export const MIGRATION_RETRY_BOOT_SINGLETON = 'migration-retry:boot';

/** Seconds between two runs. */
export const MIGRATION_RETRY_INTERVAL_S = 300;

/** Projects migrated at the same time by a retry run (the deploy Job uses 4). */
export const MIGRATION_RETRY_CONCURRENCY = 2;

registerJobQueues([MIGRATION_RETRY_QUEUE], 'platform');

const log = moduleLogger('migration-retry');

async function rearm(): Promise<void> {
  await withPlatformTx((tx) =>
    enqueueInTx(
      tx,
      MIGRATION_RETRY_QUEUE,
      {},
      { singletonKey: MIGRATION_RETRY_SINGLETON, startAfter: MIGRATION_RETRY_INTERVAL_S },
    ),
  );
}

/** The ready projects whose stored state says `behind` or `failed`. */
export async function projectsToRetry(): Promise<string[]> {
  const rows = await withPlatformTx((tx) =>
    tx
      .select({ id: projects.id, isCentral: projects.isCentral })
      .from(projectSchemaState)
      .innerJoin(projects, eq(projects.id, projectSchemaState.projectId))
      .where(
        and(eq(projects.state, 'ready'), inArray(projectSchemaState.status, ['behind', 'failed'])),
      ),
  );
  const reachesCentral =
    Boolean(process.env.MIGRATION_DATABASE_URL) || process.env.NODE_ENV !== 'production';
  return rows.filter((row) => reachesCentral || !row.isCentral).map((row) => row.id);
}

export type MigrationRetryResult = { retried: number; failed: number; healed: number };

/** One pass: re-run the fan-out for the projects that are behind or failed. Exposed for tests. */
export async function runMigrationRetry(
  options: { deps?: Partial<MigrateDeps> } = {},
): Promise<MigrationRetryResult> {
  const ids = await projectsToRetry();
  if (ids.length === 0) return { retried: 0, failed: 0, healed: 0 };
  const result = await migrateAll({
    projectIds: ids,
    concurrency: MIGRATION_RETRY_CONCURRENCY,
    ...(options.deps ? { deps: options.deps } : {}),
  });
  const projectLines = result.lines.filter((line) => line.kind === 'project');
  const failed = projectLines.filter((line) => line.status === 'failed').length;
  const healed = projectLines.filter((line) => line.status === 'current').length;
  return { retried: ids.length, failed, healed };
}

export const migrationRetryJob: JobDefinition<Record<string, never>> = {
  name: MIGRATION_RETRY_QUEUE,
  scope: 'platform',
  handler: async () => {
    try {
      const result = await runMigrationRetry();
      if (result.retried > 0) {
        log.info(
          {
            event: 'platform.migration_retry.ran',
            retried: result.retried,
            healed: result.healed,
            failed: result.failed,
          },
          'migration retry ran',
        );
      }
    } catch (err) {
      log.error(
        {
          event: 'platform.migration_retry.failed',
          errorName: err instanceof Error ? err.name : 'unknown',
        },
        'migration retry failed; the next run retries',
      );
    }
    try {
      await rearm();
    } catch (err) {
      log.error(
        {
          event: 'platform.migration_retry.rearm_failed',
          errorName: err instanceof Error ? err.name : 'unknown',
        },
        'could not re-arm the migration retry; the next worker start re-opens it',
      );
    }
  },
};

/**
 * Queues ONE immediate run under the boot singleton, called best-effort by the worker at start. Returns whether
 * THIS call queued it (a `null` id is the dropped duplicate of a boot run still waiting).
 */
export async function armMigrationRetry(): Promise<boolean> {
  const id = await withPlatformTx((tx) =>
    enqueueInTx(tx, MIGRATION_RETRY_QUEUE, {}, { singletonKey: MIGRATION_RETRY_BOOT_SINGLETON }),
  );
  return id !== null;
}
