import { createPlatformLane } from './lanes';
import { centralHandle } from './project-pools';
import type { Tx } from './tenant-tx';

/**
 * Platform lane (09.2-03, D-538): a transaction on the CENTRAL project (project 0) under `service_role`,
 * for the registry (`platform.*`), the host mirror and the control plane, and nothing else. Only
 * `service_role` holds a privilege on `platform` (the hardening migration of the central set), so this is the
 * one door to it. 09.2-04 moved the behavior into `./lanes` (`createPlatformLane`); this file stays the thin,
 * restricted entry point and takes no registry import, because the registry itself reads through this lane.
 *
 * Like `withAdminTx`, this file is the ONLY definition and the ONLY export of `withPlatformTx` (phase-1
 * review CR-03). `@rede-social/core/db/platform-tx` is import-restricted by Biome `noRestrictedImports`
 * to the kernel (`packages/core/server/{tenancy,platform,projects,migrations,secrets}`) and `scripts/`;
 * nothing may re-export it from an unrestricted entry point such as `@rede-social/core/db/tenant-tx`.
 */
const lane = createPlatformLane({ centralHandle: () => centralHandle() });

export function withPlatformTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return lane.withPlatformTx(fn);
}
