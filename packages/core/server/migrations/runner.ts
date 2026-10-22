import type { Sql } from 'postgres';
import type { MigrationFile, MigrationSetName } from './sets';

/**
 * The in-house migration runner (Phase 09.2-02, DBT-22, DBT-32, D-547).
 *
 * It applies ONE directory of SQL files to ONE Postgres, exactly the way the Supabase CLI does (one
 * transaction per file, the CLI's own ledger `supabase_migrations.schema_migrations`, version = the
 * 14-digit file prefix), so production's existing rows are the baseline with no backfill and
 * `supabase migration list` / `db push --db-url` stay a working manual path. It exists because the CLI
 * can only target the project it is linked to, while the platform now owns N projects.
 *
 * The runner imports NO kernel module (no env, no logger): the operator command, the CI step and the
 * future bootstrap Job all hand it a connection and a list of files. Errors carry a CODE and a version,
 * never SQL text, a value or a connection string (T-09.2-04).
 *
 * Contract of the connection: ONE postgres.js connection (`max: 1`), opened as the `postgres` role,
 * through a SESSION-mode endpoint (the advisory lock is session-scoped, so a transaction pooler would
 * hand the lock to another backend).
 */

export type MigrationErrorCode =
  | 'wrong_role'
  | 'lock_timeout'
  | 'checksum_changed'
  | 'out_of_order'
  | 'file_failed'
  | 'empty_set'
  | 'not_empty';

/** The message is `<code>` or `<code>:<version>` on purpose: nothing a statement could echo. */
export class MigrationError extends Error {
  readonly code: MigrationErrorCode;
  readonly version: string | null;

  constructor(code: MigrationErrorCode, version?: string) {
    super(version ? `${code}:${version}` : code);
    this.name = 'MigrationError';
    this.code = code;
    this.version = version ?? null;
  }
}

/** The two ledgers (D-547). The tenant one is the CLI's own table; the central one is ours. */
export const LEDGERS = {
  tenant: 'supabase_migrations.schema_migrations',
  central: 'supabase_migrations.central_migrations',
} as const satisfies Record<MigrationSetName, string>;

/** The runner-owned checksum side table, shared by both sets (primary key `(set, version)`). */
export const CHECKSUM_TABLE = 'supabase_migrations.rede_checksums';

const DEFAULT_LOCK_TIMEOUT_MS = 15_000;
const LOCK_POLL_MS = 100;
const STATEMENT_LOCK_TIMEOUT = '15s';

export type FileEvent = {
  set: MigrationSetName;
  version: string;
  status: 'applied' | 'failed' | 'pending';
};

export type ApplyOptions = {
  set: MigrationSetName;
  /** Report what would be applied; execute nothing, create nothing, take no lock. */
  dryRun?: boolean;
  /** Apply a pending file whose version is below the applied head (the CLI's `--include-all`). */
  includeAll?: boolean;
  /** How long to wait for the set's advisory lock before `lock_timeout`. Default 15 s. */
  lockTimeoutMs?: number;
  onFile?: (event: FileEvent) => void;
};

export type ApplyResult = {
  applied: string[];
  skipped: number;
  /** Versions NOT applied when the call returned (all pending ones for a dry run; the failed one and its successors after a failure). */
  pending: string[];
  failedVersion?: string;
  errorCode?: MigrationErrorCode;
  /** SQLSTATE of the statement that failed, when the driver reported one. */
  sqlstate?: string;
  /** The content-free error for a failed file (`file_failed:<version>`). */
  error?: MigrationError;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `rede.migrate:<set>`: one lock per set, so the central and tenant sets of one stack never block each other. */
const lockKey = (set: MigrationSetName) => `rede.migrate:${set}`;

async function takeLock(sql: Sql, set: MigrationSetName, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [row] = await sql<{ locked: boolean }[]>`
      select pg_try_advisory_lock(hashtext(${lockKey(set)})) as locked`;
    if (row?.locked) return;
    if (Date.now() >= deadline) throw new MigrationError('lock_timeout');
    await sleep(LOCK_POLL_MS);
  }
}

async function ensureLedgers(sql: Sql, set: MigrationSetName): Promise<void> {
  await sql.unsafe('create schema if not exists supabase_migrations');
  if (set === 'tenant') {
    await sql.unsafe(
      `create table if not exists ${LEDGERS.tenant} (version text primary key, statements text[], name text)`,
    );
  } else {
    await sql.unsafe(
      `create table if not exists ${LEDGERS.central} (
         version text primary key,
         name text not null,
         sha256 text not null,
         applied_at timestamptz not null default now()
       )`,
    );
  }
  await sql.unsafe(
    `create table if not exists ${CHECKSUM_TABLE} (
       set text not null,
       version text not null,
       sha256 text not null,
       recorded_at timestamptz not null default now(),
       primary key (set, version)
     )`,
  );
}

async function tableExists(sql: Sql, qualified: string): Promise<boolean> {
  const [row] = await sql<{ present: boolean }[]>`
    select to_regclass(${qualified}) is not null as present`;
  return row?.present === true;
}

/** The versions the ledger holds and the checksums recorded for this set. Absent tables read as empty. */
async function readState(
  sql: Sql,
  set: MigrationSetName,
): Promise<{ applied: Set<string>; checksums: Map<string, string> }> {
  const applied = new Set<string>();
  const checksums = new Map<string, string>();
  if (await tableExists(sql, LEDGERS[set])) {
    const rows = await sql.unsafe<{ version: string }[]>(`select version from ${LEDGERS[set]}`);
    for (const row of rows) applied.add(row.version);
  }
  if (await tableExists(sql, CHECKSUM_TABLE)) {
    const rows = await sql<{ version: string; sha256: string }[]>`
      select version, sha256 from supabase_migrations.rede_checksums where set = ${set}`;
    for (const row of rows) checksums.set(row.version, row.sha256);
  }
  return { applied, checksums };
}

/**
 * Apply the pending files of one set, in ascending version order.
 *
 * 1. Refuse any role but `postgres` (objects must be owned by it: `alter default privileges` in the
 *    tenant set is per creating role, and the platform's own objects expect `postgres`).
 * 2. Take the set's session advisory lock (waiting at most `lockTimeoutMs`).
 * 3. Create the ledger(s) for THIS set only.
 * 4. Refuse a run when an applied file's recorded checksum differs from the file on disk; adopt the
 *    current hash for rows applied before the runner existed (the CLI wrote no checksum).
 * 5. Refuse a pending file below the applied head unless `includeAll`.
 * 6. One transaction per file, together with its ledger row and checksum row. The first failure rolls
 *    that file back and STOPS: earlier files stay committed, later ones may depend on the failed one.
 */
export async function applyDirectory(
  sql: Sql,
  files: MigrationFile[],
  opts: ApplyOptions,
): Promise<ApplyResult> {
  const { set, dryRun = false, includeAll = false, onFile } = opts;
  const lockTimeoutMs = opts.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;

  if ((sql.options as { max?: number }).max !== 1) {
    throw new Error('applyDirectory needs a single-connection client (postgres(url, { max: 1 }))');
  }

  const [who] = await sql<{ u: string }[]>`select current_user as u`;
  if (who?.u !== 'postgres') throw new MigrationError('wrong_role');

  const ordered = [...files].sort((a, b) => (a.version < b.version ? -1 : 1));

  if (!dryRun) await takeLock(sql, set, lockTimeoutMs);
  try {
    if (!dryRun) await ensureLedgers(sql, set);

    const { applied, checksums } = await readState(sql, set);

    // Guard first, write nothing until every applied file has been compared.
    const toAdopt: MigrationFile[] = [];
    for (const file of ordered) {
      if (!applied.has(file.version)) continue;
      const recorded = checksums.get(file.version);
      if (recorded === undefined) toAdopt.push(file);
      else if (recorded !== file.sha256) throw new MigrationError('checksum_changed', file.version);
    }

    const pendingFiles = ordered.filter((f) => !applied.has(f.version));
    const head = [...applied].sort().at(-1) ?? '';
    if (!includeAll) {
      const behind = pendingFiles.find((f) => f.version < head);
      if (behind) throw new MigrationError('out_of_order', behind.version);
    }

    if (dryRun) {
      for (const f of pendingFiles) onFile?.({ set, version: f.version, status: 'pending' });
      return {
        applied: [],
        skipped: ordered.length - pendingFiles.length,
        pending: pendingFiles.map((f) => f.version),
      };
    }

    for (const file of toAdopt) {
      await sql`
        insert into supabase_migrations.rede_checksums (set, version, sha256)
        values (${set}, ${file.version}, ${file.sha256})
        on conflict (set, version) do nothing`;
    }

    const done: string[] = [];
    for (const [index, file] of pendingFiles.entries()) {
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(`set local lock_timeout = '${STATEMENT_LOCK_TIMEOUT}'`);
          await tx.unsafe(file.text);
          if (set === 'tenant') {
            await tx.unsafe(`insert into ${LEDGERS.tenant} (version, name) values ($1, $2)`, [
              file.version,
              file.name,
            ]);
          } else {
            await tx.unsafe(
              `insert into ${LEDGERS.central} (version, name, sha256) values ($1, $2, $3)`,
              [file.version, file.name, file.sha256],
            );
          }
          await tx.unsafe(
            `insert into ${CHECKSUM_TABLE} (set, version, sha256) values ($1, $2, $3)
             on conflict (set, version) do update set sha256 = excluded.sha256, recorded_at = now()`,
            [set, file.version, file.sha256],
          );
        });
      } catch (cause) {
        onFile?.({ set, version: file.version, status: 'failed' });
        const code = (cause as { code?: unknown }).code;
        return {
          applied: done,
          skipped: ordered.length - pendingFiles.length,
          pending: pendingFiles.slice(index).map((f) => f.version),
          failedVersion: file.version,
          errorCode: 'file_failed',
          ...(typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? { sqlstate: code } : {}),
          error: new MigrationError('file_failed', file.version),
        };
      }
      done.push(file.version);
      onFile?.({ set, version: file.version, status: 'applied' });
    }

    return { applied: done, skipped: ordered.length - pendingFiles.length, pending: [] };
  } finally {
    if (!dryRun) {
      await sql`select pg_advisory_unlock(hashtext(${lockKey(set)}))`.catch(() => undefined);
    }
  }
}

/**
 * Whether a project is empty enough to receive the tenant set: the tenant ledger is absent or has no
 * row AND no ordinary table exists in `public` (extension-owned objects excluded). The bootstrap
 * (plan 13) and the move (plan 22) call it and surface `not_empty`; the tenant set is plain
 * `create table`, so applying it on top of data is never safe.
 */
export async function projectIsEmpty(sql: Sql): Promise<boolean> {
  if (await tableExists(sql, LEDGERS.tenant)) {
    const [row] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from ${LEDGERS.tenant}`,
    );
    if ((row?.n ?? 0) > 0) return false;
  }
  const [tables] = await sql<{ n: number }[]>`
    select count(*)::int as n
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and not exists (
         select 1 from pg_depend d
          where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')`;
  return (tables?.n ?? 0) === 0;
}
