import { ProjectUnboundError } from '../server/tenancy/project-errors';
import { resolveProject, resolveProjectById } from '../server/tenancy/project-registry';
import type { LaneTarget } from './lane-target';
import { createLanes } from './lanes';
import { centralHandle, withHandle } from './project-pools';
import type { Tx } from './tenant-tx';

/**
 * Admin lane: `service_role` bypasses RLS for this transaction only, on the project the caller NAMES
 * (09.2-04, D-538): `{ tenantId }` opens on the project registered for that tenant, `{ projectId }` on that
 * project directly (project-wide work such as the daily dispatcher). The target is explicit data; there is no
 * ambient "current project".
 *
 * This file is the ONLY definition and the ONLY export of `withAdminTx` (phase-1 review CR-03).
 * `@rede-social/core/db/admin-tx` is import-restricted by Biome `noRestrictedImports` to
 * `packages/core/server/{tenancy,platform,projects,migrations,secrets}` and `scripts/`; nothing may
 * re-export it from an unrestricted entry point such as `@rede-social/core/db/tenant-tx`, or the single lint
 * rule that keeps `service_role` out of module code becomes a one-line import change away from bypassed.
 * `packages/boundary-fixture` imports it through BOTH entry points so `pnpm boundaries:negative`
 * proves the restriction still bites — and would catch a re-export creeping back into `tenant-tx`.
 */
const lanes = createLanes({
  // Lambdas, not bare references: the registry module reads the central project through the platform lane,
  // and a live binding captured at load time would sit in the temporal dead zone of a module cycle.
  centralHandle: () => centralHandle(),
  resolveProject: (tenantId) => resolveProject(tenantId),
  resolveProjectById: (projectId) => resolveProjectById(projectId),
  withHandle: (project, fn) => withHandle(project, fn),
  unbound: () => new ProjectUnboundError(),
});

export function withAdminTx<T>(target: LaneTarget, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return lanes.withAdminTx(target, fn);
}
