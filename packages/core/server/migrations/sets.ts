import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGERS, MigrationError } from './runner';

/**
 * The two migration sets of Phase 09.2 (D-547). Two directories, two drizzle configs, two ledgers:
 *
 * - `tenant`  `supabase/migrations`          every project (the local stack, the central project and each
 *                                            tenant's own project). Ledger: the CLI's own table.
 * - `central` `supabase/central/migrations`  the platform registry (schema `platform`). NEVER applied to a
 *                                            tenant project. Ledger: `supabase_migrations.central_migrations`.
 *
 * A file name is `<14-digit version>_<snake name>.sql`; anything else in the directory (drizzle's `meta/`,
 * a README, an editor backup) is not a migration and is ignored.
 */

export type MigrationSetName = 'tenant' | 'central';

export type MigrationFile = {
  set: MigrationSetName;
  /** The 14-digit prefix: the ledger key and the sort key. */
  version: string;
  name: string;
  text: string;
  /** sha256 (hex) of the exact bytes on disk. */
  sha256: string;
};

export const MIGRATION_SETS = {
  tenant: { relativeDir: 'supabase/migrations', ledger: LEDGERS.tenant },
  central: { relativeDir: 'supabase/central/migrations', ledger: LEDGERS.central },
} as const satisfies Record<MigrationSetName, { relativeDir: string; ledger: string }>;

const FILE_NAME = /^(\d{14})_([a-z0-9_]+)\.sql$/;

/** Repo root, from this file: packages/core/server/migrations -> four levels up. */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** The repository directory of a set (the Job image passes its own `--dir` instead). */
export const defaultMigrationDir = (set: MigrationSetName): string =>
  join(REPO_ROOT, MIGRATION_SETS[set].relativeDir);

/**
 * Read one set's directory: only files that match the naming rule, sorted by version, each with the
 * sha256 of its exact bytes (a byte-order mark changes the hash). An empty CENTRAL set is legitimate
 * (nothing to do); an empty or missing TENANT set is a mistake that would otherwise "succeed" by
 * applying nothing to a project, so it throws `empty_set`.
 */
export async function readMigrationDir(
  dir: string,
  set: MigrationSetName,
): Promise<MigrationFile[]> {
  let entries: import('node:fs').Dirent[] = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const files: MigrationFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = FILE_NAME.exec(entry.name);
    if (!match) continue;
    const bytes = await readFile(join(dir, entry.name));
    files.push({
      set,
      version: match[1] as string,
      name: match[2] as string,
      text: bytes.toString('utf8'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  files.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));

  if (set === 'tenant' && files.length === 0) throw new MigrationError('empty_set');
  return files;
}

/**
 * The repository's runtime-role block (`supabase/roles.sql`), the same idempotent statements the
 * `app_helpers` migration repeats: creates `api_user` when absent and grants it `authenticated` and
 * `service_role`. The bootstrap's `roles` step (09.2-13) runs it as `postgres` BEFORE the tenant set, so the
 * set's `alter default privileges` already sees the role. It carries no password. `root` is the repository
 * root (a Job image passes its own).
 */
export async function readRolesSql(root: string = REPO_ROOT): Promise<string> {
  const text = await readFile(join(root, 'supabase', 'roles.sql'), 'utf8');
  if (text.trim().length === 0) throw new MigrationError('empty_set');
  return text;
}
