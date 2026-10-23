import { createHash } from 'node:crypto';
import { MoveError, type MovePlan, type MoveSide, publicTable, quoteIdent, run } from './types';

/**
 * Quiescence (09.2-23, D-535, T-09.2-102): a tenant that is suspended still has work in flight, so the copy
 * waits until nothing moves.
 *
 *  1. wait `waitMs` (production default 65 s = the 60 s by-host cache plus 5 s for in-flight requests): by then
 *     every instance serves the branded "indisponivel" screen and refuses the tenant's requests;
 *  2. sample the tenant's footprint twice, `gapMs` apart (per copied table: the row count and `max(updated_at)`
 *     where the table has one), and require the two samples to be equal (`not_quiescent`);
 *  3. wait up to `jobsWaitMs` for the tenant's `pgboss.job` rows to leave `active` (`jobs_active`).
 *
 * The clock is injectable (`sleep`), so a test passes instant sleeps. Every sample is one repeatable-read read
 * only transaction on the SOURCE; nothing here writes anywhere.
 */

export type Fingerprint = {
  /** A stable digest of the whole footprint. */
  digest: string;
  /** `table -> "<count>|<max updated_at>"`, for naming the tables that moved (never a row). */
  tables: Record<string, string>;
};

const hasColumn = (plan: MovePlan, table: string, column: string): boolean =>
  plan.info[table]?.columns.some((c) => c.name === column) ?? false;

/** The footprint of the tenant in the source: counts and the newest update stamp per copied table. */
export async function fingerprintOf(source: MoveSide, plan: MovePlan): Promise<Fingerprint> {
  const tables: Record<string, string> = {};
  await source.sql.begin('isolation level repeatable read read only', async (tx) => {
    for (const { name } of [...plan.tables].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const stamp = hasColumn(plan, name, 'updated_at')
        ? `max(${quoteIdent('updated_at')})::text`
        : 'null::text';
      const [row] = await run<{ n: number; m: string | null }>(
        tx,
        `select count(*)::int as n, ${stamp} as m from ${publicTable(name)} where tenant_id = $1::uuid`,
        [plan.tenantId],
      );
      tables[name] = `${row?.n ?? 0}|${row?.m ?? ''}`;
    }
  });
  const digest = createHash('sha256')
    .update(JSON.stringify(Object.entries(tables)))
    .digest('hex');
  return { digest, tables };
}

/** The tables whose footprint differs between two samples, ascending. */
export function changedTables(a: Fingerprint, b: Fingerprint): string[] {
  const names = new Set([...Object.keys(a.tables), ...Object.keys(b.tables)]);
  return [...names].filter((name) => a.tables[name] !== b.tables[name]).sort();
}

/** Active jobs of the tenant in the source project's pg-boss schema (0 when the schema is absent). */
export async function activeJobsOf(source: MoveSide): Promise<number> {
  const [present] = await run<{ ok: boolean }>(
    source.sql,
    `select to_regclass('pgboss.job') is not null as ok`,
  );
  if (!present?.ok) return 0;
  const [row] = await run<{ n: number }>(
    source.sql,
    `select count(*)::int as n from pgboss.job where state = 'active' and data ->> 'tenantId' = $1`,
    [source.tenantId],
  );
  return row?.n ?? 0;
}

export type QuiesceOptions = {
  source: MoveSide;
  plan: MovePlan;
  waitMs: number;
  gapMs?: number;
  /** How long the tenant's active jobs may take to finish. Default 5 minutes. */
  jobsWaitMs?: number;
  /** How often the active jobs are looked at. Default 1 second. */
  jobsPollMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export const DEFAULT_QUIESCE_MS = 65_000;
export const DEFAULT_GAP_MS = 5_000;
export const DEFAULT_JOBS_WAIT_MS = 300_000;
const DEFAULT_JOBS_POLL_MS = 1_000;

const realSleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

export async function quiesce(
  options: QuiesceOptions,
): Promise<{ fingerprint: Fingerprint; jobsWaitedMs: number }> {
  const sleep = options.sleep ?? realSleep;
  const gap = options.gapMs ?? DEFAULT_GAP_MS;
  await sleep(options.waitMs);

  const first = await fingerprintOf(options.source, options.plan);
  await sleep(gap);
  const second = await fingerprintOf(options.source, options.plan);
  if (first.digest !== second.digest) {
    throw new MoveError('not_quiescent', changedTables(first, second));
  }

  const limit = options.jobsWaitMs ?? DEFAULT_JOBS_WAIT_MS;
  const poll = options.jobsPollMs ?? DEFAULT_JOBS_POLL_MS;
  let waited = 0;
  while ((await activeJobsOf(options.source)) > 0) {
    if (waited >= limit) throw new MoveError('jobs_active');
    await sleep(poll);
    waited += poll;
  }
  return { fingerprint: second, jobsWaitedMs: waited };
}
