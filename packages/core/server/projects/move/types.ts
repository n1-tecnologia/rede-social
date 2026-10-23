import type postgres from 'postgres';

/**
 * Shared shapes of the move engine (09.2-22, D-534, D-536). The engine copies ONE tenant from a source
 * project's database into a target project's database. It is a pipeline of stages that share one `MovePlan`:
 * `planMove` (dry run) -> `copyAuth` -> `copyRows` -> `copyStorage` -> `requeueJobs` -> `verifyCopy`.
 *
 * Plan 23 wraps the pipeline in the state machine (suspend, quiesce, cutover, rollback, audit, the command);
 * nothing here suspends a tenant, repoints a binding or deletes from the source.
 *
 * Every report is built from table names, counts and md5 digests: never a row, an e-mail, a password hash,
 * a key or a connection string (T-09.2-98).
 */

/** A connection to one project's database (a pool, or a transaction of one). The engine never imports a driver. */
export type Db = postgres.Sql | postgres.TransactionSql;

/**
 * One side of a move: the database, the tenant being moved and the registry id of the project. The SOURCE is
 * only ever read inside a `read only` transaction; the engine has no statement that writes to it (planning
 * decision 3: deletion belongs to plan 23's explicit `--confirm-delete`).
 */
export type MoveSide = { sql: postgres.Sql; tenantId: string; projectId: string };

/**
 * The closed set of error codes of the move: the ones the copy engine raises (09.2-22) and the ones the
 * state machine, the rollback and the deletion add (09.2-23). A code is all a log line or a stored reason may
 * carry; never a message from a driver.
 */
export type MoveErrorCode =
  | 'usage'
  | 'tenant_not_found'
  | 'tenant_unbound'
  | 'already_on_target'
  | 'move_in_progress'
  | 'lease_held'
  | 'move_conflict'
  | 'target_not_ready'
  | 'schema_mismatch'
  | 'uncovered_tables'
  | 'unsortable_tables'
  | 'not_quiescent'
  | 'jobs_active'
  | 'verify_failed'
  | 'source_changed'
  | 'email_conflict'
  | 'origin_leftover'
  | 'account_missing'
  | 'writes_since_cutover'
  | 'source_deleted'
  | 'not_done'
  | 'confirm_mismatch'
  | 'unknown';

/**
 * The one error of the engine. The message is the code and, at most, table names or counts; it never holds a
 * row, an e-mail, a hash or a connection string, so a log line or a stored reason cannot leak one.
 */
export class MoveError extends Error {
  readonly code: MoveErrorCode;
  /** Table names (or `table.column` pairs) the failure is about. Names only. */
  readonly tables: readonly string[];
  /** The report that was being built when the check failed (counts, names and digests only). */
  readonly report: unknown;

  constructor(code: MoveErrorCode, tables: readonly string[] = [], report?: unknown) {
    super(tables.length > 0 ? `${code}: ${tables.join(', ')}` : code);
    this.name = 'MoveError';
    this.code = code;
    this.tables = tables;
    this.report = report;
  }
}

export type ColumnInfo = { name: string; type: string; generated: boolean };

/** What the engine reads about one `public` table from a catalog (never from a hand-written list). */
export type TableInfo = {
  name: string;
  /** The table has a `tenant_id uuid` column. */
  hasTenantId: boolean;
  columns: ColumnInfo[];
  /** Primary-key columns in key order (empty when the table has none). */
  pk: string[];
  /** The table carries user triggers (counters, signals, guards) the copy must not fire. */
  userTriggers: boolean;
};

export type TableCount = { name: string; rows: number };

/** The dry-run plan (D-536): per-table counts, accounts, files and everything the engine cannot classify. */
export type MovePlan = {
  tenantId: string;
  /** False when `planMove` ran without a target (the schema-equality check is skipped). */
  targetChecked: boolean;
  /** The copy set with the tenant's row count, in no particular order. */
  tables: TableCount[];
  /** Catalog-derived copy order, flattened. */
  order: string[];
  /** The same order as groups: a group of more than one table is a deferrable cycle (one transaction). */
  groups: string[][];
  /** Special tables handled by hand (the target row is updated, not inserted). */
  special: string[];
  /** Distinct accounts to copy: members (any status) plus invitees. */
  authUsers: number;
  storageObjects: number;
  storageBytes: number;
  /** Tables the engine cannot classify, and tables the target lacks. A non-empty list refuses the move. */
  uncovered: string[];
  /** Tables the target holds with a different column set. */
  schemaMismatch: string[];
  /**
   * `table.column` pairs where a row of the tenant references a user that is NOT one of its accounts
   * (memberships and invitees). Such a row would fail its foreign key mid-copy; the engine never widens the
   * account set to cover it (PR-7: no account is copied for a person without a membership or an invite).
   */
  danglingUsers: string[];
  /** The catalog facts the copy stages reuse (so they never read the catalog twice). */
  info: Record<string, TableInfo>;
};

export type CopyTableReport = { name: string; read: number; inserted: number };

/** What `copyRows` did: counts only. */
export type CopyReport = {
  tables: CopyTableReport[];
  groups: number;
  tenantUpdated: boolean;
  modulesUpdated: number;
};

export type AuthCopyReport = {
  accounts: number;
  usersWritten: number;
  identitiesWritten: number;
};

export type TableVerify = {
  name: string;
  source: number;
  target: number;
  /** `match` (all rows hashed), `sampled` (a fixed fraction hashed), `mismatch`. */
  checksum: 'match' | 'sampled' | 'mismatch';
};

export type LeftoverOrigin = { table: string; column: string; count: number };

export type StorageTotals = { objects: number; bytes: number };

/** What `verifyCopy` found: table names, counts and verdicts. */
export type VerifyReport = {
  ok: boolean;
  tables: TableVerify[];
  /** `table:check` pairs that failed, e.g. `feed_posts:checksum`. */
  failures: string[];
  accounts: { count: number; passwords: 'match' | 'mismatch' };
  storage: { source: StorageTotals; target: StorageTotals } | null;
  leftovers: LeftoverOrigin[];
};

/** Run one parameterised statement. Identifiers are quoted from the catalog by the caller, never from input. */
export async function run<T extends object = Record<string, unknown>>(
  db: Db,
  query: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const rows = await db.unsafe(query, params as never[]);
  return rows as unknown as T[];
}

/** A quoted identifier. The names come from `pg_catalog`, but quoting keeps a weird one a name, not SQL. */
export const quoteIdent = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/** `public."table"`. */
export const publicTable = (name: string): string => `public.${quoteIdent(name)}`;

/** A list of ids sent as one text parameter (cast server-side), so no driver array typing is involved. */
export const idsParam = (ids: readonly string[]): string => JSON.stringify(ids);

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function assertUuid(value: string): string {
  if (!UUID_RE.test(value)) throw new Error('invalid tenant id');
  return value;
}
