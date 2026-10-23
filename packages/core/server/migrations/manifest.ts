import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { imageMigrationsDir } from './sets';

/**
 * The migration manifest of the image (09.2-15, D-547, DBT-44): `scripts/build-migrations-manifest.mjs` copies
 * `supabase/migrations`, `supabase/central/migrations` and `supabase/roles.sql` into one directory and writes
 * `manifest.json` next to them. The running API reads it to know which tenant schema it requires WITHOUT asking
 * a database, and the same directory is what `migrateAll` and the bootstrap apply.
 *
 *   <dir>/tenant/*.sql   <dir>/central/*.sql   <dir>/roles.sql   <dir>/manifest.json
 *
 * Nothing here logs and nothing here touches the network or a database.
 */

export type ManifestEntry = { version: string; name: string; sha256: string };
export type Manifest = {
  tenant: ManifestEntry[];
  central: ManifestEntry[];
  roles: { sha256: string };
};

/** A content-free failure: the message is a fixed phrase, never a path or a file's text. */
export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestError';
  }
}

export type MigrationDirs = { tenant: string; central: string; roles: string };

/** The repository root from the working directory: the first parent holding `supabase/migrations`. */
function findRepoRoot(from: string): string | null {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, 'supabase', 'migrations'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The three places the files live: `MIGRATIONS_DIR` in the image, else the repository (found by walking up
 * from the working directory, because a bundled `dist/main.js` cannot derive it from its own location).
 */
export function migrationDirs(): MigrationDirs {
  const image = imageMigrationsDir();
  if (image) {
    return {
      tenant: join(image, 'tenant'),
      central: join(image, 'central'),
      roles: join(image, 'roles.sql'),
    };
  }
  const root = findRepoRoot(process.cwd());
  if (!root) throw new ManifestError('migrations directory not found');
  return {
    tenant: join(root, 'supabase', 'migrations'),
    central: join(root, 'supabase', 'central', 'migrations'),
    roles: join(root, 'supabase', 'roles.sql'),
  };
}

const VERSION = /^\d{14}$/;
const SHA = /^[0-9a-f]{64}$/;

function entriesOf(value: unknown): ManifestEntry[] {
  if (!Array.isArray(value)) throw new ManifestError('migrations manifest invalid');
  return value.map((item) => {
    const entry = item as Partial<ManifestEntry> | null;
    if (
      !entry ||
      typeof entry.version !== 'string' ||
      !VERSION.test(entry.version) ||
      typeof entry.name !== 'string' ||
      typeof entry.sha256 !== 'string' ||
      !SHA.test(entry.sha256)
    ) {
      throw new ManifestError('migrations manifest invalid');
    }
    return { version: entry.version, name: entry.name, sha256: entry.sha256 };
  });
}

/** Parses `<dir>/manifest.json`. Missing, unreadable or malformed files are a `ManifestError`, never an ENOENT. */
export function loadManifest(dir: string): Manifest {
  let text: string;
  try {
    text = readFileSync(join(dir, 'manifest.json'), 'utf8');
  } catch {
    throw new ManifestError('migrations manifest empty');
  }
  let parsed: { tenant?: unknown; central?: unknown; roles?: { sha256?: unknown } };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ManifestError('migrations manifest invalid');
  }
  const roles = parsed.roles;
  if (!roles || typeof roles.sha256 !== 'string' || !SHA.test(roles.sha256)) {
    throw new ManifestError('migrations manifest invalid');
  }
  return {
    tenant: entriesOf(parsed.tenant),
    central: entriesOf(parsed.central),
    roles: { sha256: roles.sha256 },
  };
}

/** `{ count, head }` of a list of versions: how many files and the greatest version (14-digit strings compare as text). */
export function summarize(versions: readonly string[]): { count: number; head: string } | null {
  if (versions.length === 0) return null;
  let head = versions[0] as string;
  for (const version of versions) if (version > head) head = version;
  return { count: versions.length, head };
}

/** The tenant versions of a directory read synchronously (the development fallback when no manifest exists). */
export function tenantVersionsInDir(dir: string): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const versions: string[] = [];
  for (const name of names) {
    const match = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(name);
    if (match) versions.push(match[1] as string);
  }
  return versions;
}

/**
 * A production boot needs the manifest (P85): missing, unreadable or without a single tenant file it stops with
 * `migrations manifest empty`. Outside production nothing is asserted (a developer's tree is the source). Called
 * by `main.ts` at the top of the api, worker and migrate branches; it needs no database, so `GET /v1/health`
 * stays database-free.
 */
export function assertManifestPresent(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const image = imageMigrationsDir();
  if (!image) throw new ManifestError('migrations manifest empty');
  const manifest = loadManifest(image);
  if (manifest.tenant.length === 0) throw new ManifestError('migrations manifest empty');
}
