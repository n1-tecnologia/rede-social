import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/tenant-tx';

/**
 * COMPATIBILITY FUNCTION (09.1-03, D-487): does `email` have an ACTIVE access row in ANY tenant? It is
 * the same coarse question the two auth hooks ask first, and it replaces the old "is the e-mail
 * `liberado` on the global allowlist" question. The old list is read by nothing after plan 03 except
 * the one-off `migrate_email_allowlist_to_access_grants()` function.
 *
 * The one remaining caller is `createTenant` (`packages/core/server/platform/tenants.ts`), which
 * pre-checks the first admin's e-mail before the tenant exists. Plan 04 makes that path write a manual
 * access when the invite is created (the tenant does not exist yet at pre-check time, D-492) and
 * DELETES this file; do not add callers.
 *
 * The normalisation happens in SQL (`lower(btrim())`), so it has exactly the semantics of the table
 * CHECK and of the hooks. Run it in the admin lane (`withAdminTx`): `access_grants` has zero policies.
 */
export async function isEmailAllowed(tx: Tx, email: string): Promise<boolean> {
  const rows = await tx.execute<{ allowed: boolean }>(sql`
    select exists (
      select 1 from public.access_grants ag
       where ag.email = lower(btrim(${email})) and ag.status = 'active'
    ) as allowed`);
  return rows[0]?.allowed === true;
}
