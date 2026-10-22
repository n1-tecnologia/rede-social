import { and, eq, ne, or } from 'drizzle-orm';
import { projects } from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import { env } from '../env';
import { invalidateProject } from './project-registry';

/** The shape the table's `projects_ref_chk` accepts. Checked here too so the failure is a clear message. */
const REF_SHAPE = /^[a-z][a-z0-9-]{2,39}$/;
const URL_SHAPE = /^https?:\/\//;

/**
 * Makes the central registry row describe the running environment (09.2-04, D-539): `ref` from
 * `SUPABASE_PROJECT_REF` (or `local` on a development stack) and `api_url` from `SUPABASE_URL`, so the
 * bootstrap and the operator commands can read project 0's public coordinates from the registry like any
 * other project's. Idempotent: it writes only when a value differs and reports whether it did.
 *
 * Touches exactly the `is_central` row and exactly two columns: never a sealed column, never `state`,
 * `is_default` or the credential version, and never a row that is not central (T-09.2-22). The callers are
 * the seed, the worker boot (plan 09) and the migrate command (plan 15); nothing on a request path.
 */
export async function ensureProjectZero(): Promise<{ changed: boolean }> {
  const ref = env.SUPABASE_PROJECT_REF ?? 'local';
  const apiUrl = env.SUPABASE_URL;
  if (!REF_SHAPE.test(ref)) {
    throw new Error(
      'ensureProjectZero: SUPABASE_PROJECT_REF must be 3-40 characters of lowercase letters, digits and hyphens, starting with a letter',
    );
  }
  if (!URL_SHAPE.test(apiUrl)) {
    throw new Error('ensureProjectZero: SUPABASE_URL must start with http:// or https://');
  }
  const updated = await withPlatformTx((tx) =>
    tx
      .update(projects)
      .set({ ref, apiUrl, updatedAt: new Date() })
      .where(
        and(eq(projects.isCentral, true), or(ne(projects.ref, ref), ne(projects.apiUrl, apiUrl))),
      )
      .returning({ id: projects.id }),
  );
  const changed = updated.length > 0;
  // Bindings cache the project record; a changed row must not be served stale to the next lane.
  if (changed) invalidateProject();
  return { changed };
}
