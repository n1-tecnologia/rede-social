import { sql } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';

/**
 * Serialises every allow-list read-modify-write across API instances and the worker (RESEARCH
 * Pattern 5, T-02-53): one transaction-scoped advisory lock keyed on `tenant_domains.allow_list`,
 * held while `fn` runs. Shared by `platform/domains.ts` (verify / detach) and
 * `platform/reconcile-allow-list.ts` (worker boot, quick 261012-s0v). Lives under `platform/` because
 * the admin lane is confined to `tenancy/`, `platform/` and `media/` (root biome.json override; 02-09
 * keeps `domains/*` DB-free).
 */
export async function withAllowListLock(fn: () => Promise<void>): Promise<void> {
  await withAdminTx(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tenant_domains.allow_list'))`);
    await fn();
  });
}
