import { sql } from 'drizzle-orm';
import { withPlatformTx } from '../../db/platform-tx';

/**
 * Serialises every allow-list read-modify-write of ONE project across API instances and the worker (RESEARCH
 * Pattern 5, T-02-53; 09.2-11 DBT-42, T-09.2-54): one transaction-scoped advisory lock keyed on
 * `allow_list:<projectRef>`, held while `fn` runs. Two tenants bound to one project share one list and so one
 * lock; two projects never wait for each other. Shared by `platform/domains.ts` (verify / detach) and
 * `platform/reconcile-allow-list.ts` (worker start of each project). Lives under `platform/` because the
 * platform and admin lanes are confined to `tenancy/`, `platform/` and `media/` (root biome.json override;
 * 02-09 keeps `domains/*` DB-free).
 */
export async function withAllowListLock(
  projectRef: string,
  fn: () => Promise<void>,
): Promise<void> {
  await withPlatformTx(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`allow_list:${projectRef}`}))`);
    await fn();
  });
}
