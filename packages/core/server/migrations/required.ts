import {
  loadManifest,
  ManifestError,
  migrationDirs,
  summarize,
  tenantVersionsInDir,
} from './manifest';
import { imageMigrationsDir } from './sets';

/**
 * The tenant schema this image requires (09.2-08, 09.2-15, D-545, DBT-25, DBT-44): how many tenant migrations
 * the image ships and the newest one's 14-digit version. A project whose applied schema is BELOW it is held
 * out (`updating`) until the fan-out catches it up; one AHEAD of it (a rolled-back image) is never held out.
 *
 * Where the answer comes from, in order, with NO database round trip:
 *  1. the test override (`setRequiredTenantSchemaForTests`);
 *  2. the image manifest at `MIGRATIONS_DIR` (`{ count: tenant.length, head: last version }`);
 *  3. outside production, the repository's `supabase/migrations/*.sql`, so a developer's stack behaves like the
 *     image;
 *  4. in production anything else is `ManifestError('migrations manifest empty')`: a deployed instance with no
 *     manifest must not serve as if nothing were required (P85). `{ count: 0 }` is never an answer.
 */
export type RequiredTenantSchema = { count: number; head: string };
export type AppliedTenantSchema = { count: number | null; head: string | null };

let override: RequiredTenantSchema | null | undefined;

/** The manifest and the repository do not change while a process runs: read each directory once. */
const memo = new Map<string, RequiredTenantSchema | null>();

function fromImage(dir: string): RequiredTenantSchema {
  const cached = memo.get(dir);
  if (cached) return cached;
  const summary = summarize(loadManifest(dir).tenant.map((entry) => entry.version));
  if (!summary) throw new ManifestError('migrations manifest empty');
  memo.set(dir, summary);
  return summary;
}

function fromRepository(): RequiredTenantSchema | null {
  let dir: string;
  try {
    dir = migrationDirs().tenant;
  } catch {
    return null;
  }
  if (memo.has(dir)) return memo.get(dir) ?? null;
  const summary = summarize(tenantVersionsInDir(dir));
  memo.set(dir, summary);
  return summary;
}

export function getRequiredTenantSchema(): RequiredTenantSchema | null {
  if (override !== undefined) return override;
  const image = imageMigrationsDir();
  if (image) return fromImage(image);
  if (process.env.NODE_ENV === 'production') throw new ManifestError('migrations manifest empty');
  return fromRepository();
}

/** Test seam: pin (or clear with `undefined`) the required schema. Refuses to run outside `NODE_ENV=test`. */
export function setRequiredTenantSchemaForTests(
  value: RequiredTenantSchema | null | undefined,
): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('setRequiredTenantSchemaForTests is a test seam');
  }
  override = value;
}

/**
 * `behind` means the applied count OR the applied head is strictly below the required one (14-digit
 * heads compare as strings, which orders them the same as numbers at equal length). Equal or ahead is not
 * behind. Unknown is not behind either: a null `required` (gate off) or a missing/partial `applied`
 * (never probed) holds nothing out.
 */
export function isBehind(
  applied: AppliedTenantSchema | null | undefined,
  required: RequiredTenantSchema | null | undefined,
): boolean {
  if (!required || !applied) return false;
  const countBehind = applied.count !== null && applied.count < required.count;
  const headBehind = applied.head !== null && applied.head < required.head;
  return countBehind || headBehind;
}
