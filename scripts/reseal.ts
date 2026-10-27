/**
 * Re-seal the project registry under the CURRENT master key (Phase 09.2-03, D-539, DBT-03).
 *
 *   pnpm platform:reseal              # re-seal every row that still carries an older key id
 *   pnpm platform:reseal --dry-run    # open everything, report, write nothing
 *
 * Rotation, in order: (1) add the new key to `PLATFORM_MASTER_KEYS` next to the old one and deploy,
 * (2) set `PLATFORM_MASTER_KEY_ID` to the new id and deploy, (3) run this command, (4) once it reports
 * `resealed: 0` and `failed: 0`, drop the old key. Rows stay readable the whole time because the ring
 * holds both keys; the command is resumable (a second run reports 0) and idempotent.
 *
 * The six sealed columns are the five a platform project holds plus `mgmt_token_sealed`, the management token
 * of a customer-owned project (09.4-07, AAD `<id>:mgmt_token`); a platform row holds none and is skipped for it.
 *
 * For each `platform.projects` row, in ASCENDING `id` order and inside ONE transaction (`select ... for
 * update`), it opens each non-null sealed column under the key id written in the string (AAD
 * `<id>:<column without _sealed>`), seals it again under the current id, checks the new string opens, and
 * updates the columns together with `secret_key_id`. `credential_version` is NOT touched, so pools keyed on
 * it stay valid. A row that fails to open aborts that row's transaction (its columns stay as they were)
 * and the command exits 1 after trying the rest. `payment_integrations` is out of scope: the payments key
 * keeps its own variable (assumption A-03-3).
 *
 * Output is ids and numbers only, never a value (T-09.2-11): one JSON line per row
 * `{ id, columns, from, to }` then `{ rows, resealed, skipped, failed, byColumn }`.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Keyring } from '@rede-social/core/server/secrets/sealed';

/** The sealed columns in the fixed order the report uses. The AAD is the part before `_sealed`. */
export const SEALED_COLUMNS = [
  'database_url_tx_sealed',
  'database_url_session_sealed',
  'ddl_url_sealed',
  'service_key_sealed',
  'hook_secret_sealed',
  'mgmt_token_sealed',
] as const;

type SealedColumn = (typeof SEALED_COLUMNS)[number];
type ProjectRow = { id: string } & Record<SealedColumn, string | null>;

export type ResealRowReport = {
  id: string;
  /** Columns re-sealed in this row (0 when the row was already current or holds nothing sealed). */
  columns: number;
  /** The key ids that were replaced, ascending. */
  from: number[];
  to: number;
};

export type ResealSummary = {
  rows: number;
  /** Rows with at least one column re-sealed (or that would be, under `--dry-run`). */
  resealed: number;
  skipped: number;
  failed: number;
  /** Columns re-sealed, in the fixed column order. */
  byColumn: Record<SealedColumn, number>;
  perRow: ResealRowReport[];
  /** Ids of the rows that could not be opened. */
  failedIds: string[];
};

const aadOf = (id: string, column: SealedColumn) => `${id}:${column.replace(/_sealed$/, '')}`;

/**
 * Re-seals every row of `platform.projects` under `currentId`. The ring must hold `currentId` and every
 * key id still present in the table. Exported so the integration test drives it with its own ring.
 */
export async function resealAll(
  ring: Keyring,
  currentId: number,
  options: { dryRun?: boolean } = {},
): Promise<ResealSummary> {
  const { sql } = await import('drizzle-orm');
  const { withPlatformTx } = await import('@rede-social/core/db/platform-tx');
  const { keyIdOf, resealWith } = await import('@rede-social/core/server/secrets/sealed');

  if (!ring.has(currentId)) throw new Error('platform master keys invalid');

  const ids = await withPlatformTx(async (tx) => {
    const rows = await tx.execute<{ id: string }>(
      sql`select id::text as id from platform.projects order by id asc`,
    );
    return Array.from(rows, (row) => row.id);
  });

  const summary: ResealSummary = {
    rows: ids.length,
    resealed: 0,
    skipped: 0,
    failed: 0,
    byColumn: Object.fromEntries(SEALED_COLUMNS.map((column) => [column, 0])) as Record<
      SealedColumn,
      number
    >,
    perRow: [],
    failedIds: [],
  };

  for (const id of ids) {
    try {
      const report = await withPlatformTx(async (tx) => {
        const found = await tx.execute<ProjectRow>(sql`
          select id::text as id, database_url_tx_sealed, database_url_session_sealed,
                 ddl_url_sealed, service_key_sealed, hook_secret_sealed, mgmt_token_sealed
            from platform.projects
           where id = ${id}::uuid
             for update`);
        const row = found[0];
        if (!row) return null; // deleted between the listing and the lock: nothing to do

        const next: Partial<Record<SealedColumn, string>> = {};
        const replaced = new Set<number>();
        for (const column of SEALED_COLUMNS) {
          const value = row[column];
          if (value === null || value === undefined) continue;
          const had = keyIdOf(value);
          if (had === currentId) continue;
          next[column] = resealWith(ring, currentId, value, aadOf(row.id, column));
          replaced.add(had);
        }
        const columns = Object.keys(next).length;
        if (columns > 0 && !options.dryRun) {
          await tx.execute(sql`
            update platform.projects set
              database_url_tx_sealed = coalesce(${next.database_url_tx_sealed ?? null}::text, database_url_tx_sealed),
              database_url_session_sealed = coalesce(${next.database_url_session_sealed ?? null}::text, database_url_session_sealed),
              ddl_url_sealed = coalesce(${next.ddl_url_sealed ?? null}::text, ddl_url_sealed),
              service_key_sealed = coalesce(${next.service_key_sealed ?? null}::text, service_key_sealed),
              hook_secret_sealed = coalesce(${next.hook_secret_sealed ?? null}::text, hook_secret_sealed),
              mgmt_token_sealed = coalesce(${next.mgmt_token_sealed ?? null}::text, mgmt_token_sealed),
              secret_key_id = ${currentId}::smallint,
              updated_at = now()
            where id = ${id}::uuid`);
        }
        return {
          report: { id, columns, from: [...replaced].sort((a, b) => a - b), to: currentId },
          columnsDone: Object.keys(next) as SealedColumn[],
        };
      });
      if (!report) {
        summary.rows -= 1;
        continue;
      }
      summary.perRow.push(report.report);
      if (report.report.columns > 0) {
        summary.resealed += 1;
        for (const column of SEALED_COLUMNS) {
          if (report.columnsDone.includes(column)) summary.byColumn[column] += 1;
        }
      } else {
        summary.skipped += 1;
      }
    } catch {
      // Content-free on purpose: the error of a row that does not open must not reach the output.
      summary.failed += 1;
      summary.failedIds.push(id);
    }
  }
  return summary;
}

async function main(): Promise<void> {
  // Same skeleton as scripts/seed.ts: load the local stack values before any kernel module reads env.
  const envFile = resolve(process.cwd(), 'apps/api/.env.local');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const dryRun = process.argv.slice(2).includes('--dry-run');
  const { processKeyring } = await import('@rede-social/core/server/secrets/sealed');
  const { ring, currentId } = processKeyring();
  const summary = await resealAll(ring, currentId, { dryRun });

  for (const line of summary.perRow) console.log(JSON.stringify(line));
  for (const id of summary.failedIds) console.log(JSON.stringify({ id, failed: true }));
  console.log(
    JSON.stringify({
      dryRun,
      rows: summary.rows,
      resealed: summary.resealed,
      skipped: summary.skipped,
      failed: summary.failed,
      byColumn: summary.byColumn,
    }),
  );

  const { sqlClient } = await import('@rede-social/core/db');
  await sqlClient.end({ timeout: 5 });
  process.exitCode = summary.failed > 0 ? 1 : 0;
}

// Run only as a command; importing this file (the integration test does) executes nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    // Content-free: a connection string or a sealed value may sit in a driver error.
    console.error('platform:reseal failed');
    process.exit(1);
  });
}
