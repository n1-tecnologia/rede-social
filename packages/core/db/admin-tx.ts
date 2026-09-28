import { sql } from 'drizzle-orm';
import { db } from './client';
import type { Tx } from './tenant-tx';

/**
 * Admin lane: `service_role` bypasses RLS for this transaction only.
 *
 * This file is the ONLY definition and the ONLY export of `withAdminTx` (phase-1 review CR-03).
 * `@rede-social/core/db/admin-tx` is import-restricted by Biome `noRestrictedImports` to
 * `packages/core/server/{tenancy,platform}` and `scripts/`; nothing may re-export it from an
 * unrestricted entry point such as `@rede-social/core/db/tenant-tx`, or the single lint rule that keeps
 * `service_role` out of module code becomes a one-line import change away from bypassed.
 * `packages/boundary-fixture` imports it through BOTH entry points so `pnpm boundaries:negative`
 * proves the restriction still bites — and would catch a re-export creeping back into `tenant-tx`.
 */
export async function withAdminTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role service_role`);
    return fn(tx);
  });
}
