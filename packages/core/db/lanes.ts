import { sql } from 'drizzle-orm';
import type { ProjectRecord } from '../server/tenancy/project-registry';
import type { LaneTarget } from './lane-target';
import { projectOfTx, type TxLane } from './project-handle';
import type { ProjectHandle } from './project-pools';
import type { Tx } from './tenant-tx';

/**
 * The service-role lanes behind one factory (09.2-04, D-538). `admin-tx.ts` and `platform-tx.ts` stay the
 * thin, Biome-restricted entry points; this file holds the behavior so a unit test can inject fakes and open
 * no socket. It is not exported from the package: a module cannot reach it.
 *
 * Every lane runs `set local role service_role` on the handle of the project it resolved, and registers the
 * transaction in `projectOfTx` (with the lane that opened it, 09.2-09) so a later step can find the database
 * the transaction belongs to and which kind of queue it may write to. Nothing is ambient: the project comes
 * from the target the caller passed.
 */

export type PlatformLaneDeps = {
  /** The central project (project 0). */
  centralHandle: () => ProjectHandle;
};

export type LaneDeps = PlatformLaneDeps & {
  /** The project registered for a tenant. Throws `ProjectUnboundError` / `ProjectUnavailableError`. */
  resolveProject: (tenantId: string) => Promise<ProjectRecord>;
  /** One project by id, `null` when it does not exist. */
  resolveProjectById: (projectId: string) => Promise<ProjectRecord | null>;
  /** Runs `fn` with the project's handle, holding its pool in flight for the duration. */
  withHandle: <T>(project: ProjectRecord, fn: (handle: ProjectHandle) => Promise<T>) => Promise<T>;
  /** What an unknown project id surfaces as. Injected so this file imports no database code. */
  unbound: () => Error;
};

type TxFn<T> = (tx: Tx) => Promise<T>;

/** `set local role service_role` on `handle`, registering the transaction with its project and its lane. */
function runOn<T>(handle: ProjectHandle, lane: TxLane, fn: TxFn<T>): Promise<T> {
  return handle.db.transaction(async (tx) => {
    await tx.execute(sql`set local role service_role`);
    projectOfTx.set(tx, { handle, lane });
    return fn(tx);
  });
}

export function createPlatformLane(deps: PlatformLaneDeps) {
  return {
    /** A transaction on the CENTRAL project under `service_role`, for the registry and the host mirror. */
    withPlatformTx<T>(fn: TxFn<T>): Promise<T> {
      return runOn(deps.centralHandle(), 'platform', fn);
    },
  };
}

/** Narrows a first argument to a target; refuses anything that names no project or names two. */
function targetOf(value: unknown): LaneTarget {
  const t = value as { tenantId?: unknown; projectId?: unknown } | null;
  const hasTenant = typeof t?.tenantId === 'string' && t.tenantId.length > 0;
  const hasProject = typeof t?.projectId === 'string' && t.projectId.length > 0;
  if (hasTenant === hasProject) {
    throw new TypeError('lane target must name exactly one of tenantId or projectId');
  }
  return hasTenant
    ? { tenantId: (t as { tenantId: string }).tenantId }
    : { projectId: (t as { projectId: string }).projectId };
}

export function createLanes(deps: LaneDeps) {
  const platform = createPlatformLane(deps);

  /**
   * `(target, fn)`: opens on the project the target names. There is no other form (09.2-10 removed the
   * legacy `(fn)` one, which meant "project 0"): a caller always says where.
   */
  async function withAdminTx<T>(target: LaneTarget, fn: TxFn<T>): Promise<T> {
    if (typeof fn !== 'function')
      throw new TypeError('withAdminTx requires a transaction function');
    const resolved = targetOf(target);
    const project =
      'tenantId' in resolved
        ? await deps.resolveProject(resolved.tenantId)
        : await deps.resolveProjectById(resolved.projectId);
    if (!project) throw deps.unbound();
    return deps.withHandle(project, (handle) => runOn(handle, 'admin', fn));
  }

  return { withAdminTx, withPlatformTx: platform.withPlatformTx };
}
