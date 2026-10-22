import { sql } from 'drizzle-orm';
import { projectOfTx } from './project-handle';
import { centralHandle } from './project-pools';
import type { Tx } from './tenant-tx';

/**
 * Platform lane (09.2-03, D-538): a transaction on the CENTRAL project (project 0) under `service_role`,
 * for the registry (`platform.*`) and nothing else. Only `service_role` holds a privilege on `platform`
 * (the hardening migration of the central set), so this is the one door to it.
 *
 * Like `withAdminTx`, this file is the ONLY definition and the ONLY export of `withPlatformTx` (phase-1
 * review CR-03). `@rede-social/core/db/platform-tx` is import-restricted by Biome `noRestrictedImports`
 * to `packages/core/server/{tenancy,platform}` and `scripts/`; nothing may re-export it from an
 * unrestricted entry point such as `@rede-social/core/db/tenant-tx`. Plan 04 wraps it in the
 * `LaneTarget` admin signature.
 */
export async function withPlatformTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const handle = centralHandle();
  return handle.db.transaction(async (tx) => {
    await tx.execute(sql`set local role service_role`);
    projectOfTx.set(tx, handle);
    return fn(tx);
  });
}
