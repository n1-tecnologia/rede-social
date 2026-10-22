import { sql } from 'drizzle-orm';
import type { ProjectRecord } from '../server/tenancy/project-registry';
import type { LaneTarget } from './lane-target';
import { projectOfTx } from './project-handle';
import type { ProjectHandle } from './project-pools';
import type { Tx } from './tenant-tx';

/**
 * The service-role lanes behind one factory (09.2-04, D-538). `admin-tx.ts` and `platform-tx.ts` stay the
 * thin, Biome-restricted entry points; this file holds the behavior so a unit test can inject fakes and open
 * no socket. It is not exported from the package: a module cannot reach it.
 *
 * Every lane runs `set local role service_role` on the handle of the project it resolved, and registers the
 * transaction in `projectOfTx` so a later step can find the database the transaction belongs to. Nothing is
 * ambient: the project comes from the target the caller passed.
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

/** `set local role service_role` on `handle`, registering the transaction with its project. */
function runOn<T>(handle: ProjectHandle, fn: TxFn<T>): Promise<T> {
  return handle.db.transaction(async (tx) => {
    await tx.execute(sql`set local role service_role`);
    projectOfTx.set(tx, handle);
    return fn(tx);
  });
}

export function createPlatformLane(deps: PlatformLaneDeps) {
  return {
    /** A transaction on the CENTRAL project under `service_role`, for the registry and the host mirror. */
    withPlatformTx<T>(fn: TxFn<T>): Promise<T> {
      return runOn(deps.centralHandle(), fn);
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
   * Overloaded: `(target, fn)` opens on that target's project; the legacy `(fn)` form means project 0 and
   * exists only so the 119+ call sites migrate plan by plan (09.2-04 planning decision 2, removed by plan 10).
   */
  function withAdminTx<T>(target: LaneTarget, fn: TxFn<T>): Promise<T>;
  function withAdminTx<T>(fn: TxFn<T>): Promise<T>;
  async function withAdminTx<T>(first: LaneTarget | TxFn<T>, second?: TxFn<T>): Promise<T> {
    if (typeof first === 'function') return runOn(deps.centralHandle(), first);
    if (typeof second !== 'function')
      throw new TypeError('withAdminTx requires a transaction function');
    const target = targetOf(first);
    const project =
      'tenantId' in target
        ? await deps.resolveProject(target.tenantId)
        : await deps.resolveProjectById(target.projectId);
    if (!project) throw deps.unbound();
    return deps.withHandle(project, (handle) => runOn(handle, second));
  }

  return { withAdminTx, withPlatformTx: platform.withPlatformTx };
}
