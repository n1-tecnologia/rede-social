import { asc, eq } from 'drizzle-orm';
import { projects, tenantProjects } from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import { moduleLogger } from '../logging';
import { ProjectUnavailableError, ProjectUnboundError } from './project-errors';

export { closeAllPools } from '../../db/project-pools';
export { ProjectUnavailableError, ProjectUnboundError };

/**
 * The registry in the process (09.2-03, D-537, D-538): which project holds a tenant's data and how to
 * reach it. Reads `platform.tenant_projects` joined to `platform.projects` through the platform lane (the
 * central project, `service_role`); every call site resolves FROM the tenant id it was handed, never from
 * ambient context.
 */

/** The `platform.projects` columns the pools and the operator commands need. */
export type ProjectRecord = {
  id: string;
  ref: string;
  isCentral: boolean;
  isDefault: boolean;
  credentialSource: string;
  credentialVersion: number;
  apiUrl: string;
  publishableKey: string | null;
  state: string;
  secretKeyId: number | null;
  databaseUrlTxSealed: string | null;
  databaseUrlSessionSealed: string | null;
  ddlUrlSealed: string | null;
  serviceKeySealed: string | null;
  serviceKeyKind: string | null;
  hookRef: string | null;
  hookSecretSealed: string | null;
};

const columns = {
  id: projects.id,
  ref: projects.ref,
  isCentral: projects.isCentral,
  isDefault: projects.isDefault,
  credentialSource: projects.credentialSource,
  credentialVersion: projects.credentialVersion,
  apiUrl: projects.apiUrl,
  publishableKey: projects.publishableKey,
  state: projects.state,
  secretKeyId: projects.secretKeyId,
  databaseUrlTxSealed: projects.databaseUrlTxSealed,
  databaseUrlSessionSealed: projects.databaseUrlSessionSealed,
  ddlUrlSealed: projects.ddlUrlSealed,
  serviceKeySealed: projects.serviceKeySealed,
  serviceKeyKind: projects.serviceKeyKind,
  hookRef: projects.hookRef,
  hookSecretSealed: projects.hookSecretSealed,
} as const;

/** A binding is served without reading the registry for this long (D-537). */
export const BINDING_TTL_MS = 15_000;
/** The last good binding is served this long, ONLY while the central read fails (D-537, DBT-45). */
export const BINDING_STALE_MS = 600_000;
/** After a failed refresh the stale value is served without retrying for this long. */
export const BINDING_RETRY_BACKOFF_MS = 5_000;
/**
 * Hard bound (the WR-06 rule of `tenant-host.ts`): the key is a tenant id, which comes from a verified
 * host or membership, but a bound costs nothing and keeps memory fixed whatever reaches it.
 */
const MAX_ENTRIES = 1_000;

type Entry = { record: ProjectRecord; readAt: number; retryAt: number };

export type ProjectResolverOptions = {
  /** The registry read for one tenant: the record, `null` when the tenant has no binding, a rejection when the read fails. */
  load: (tenantId: string) => Promise<ProjectRecord | null>;
  /** Monotonic clock in WHOLE milliseconds (P20). Default `performance.now()` truncated. */
  now?: () => number;
  ttlMs?: number;
  staleMs?: number;
  retryBackoffMs?: number;
  max?: number;
  /** Called when a stale binding is served because the central read failed. */
  onStale?: (tenantId: string) => void;
};

export type ProjectResolver = {
  resolve: (tenantId: string) => Promise<ProjectRecord>;
  invalidate: (tenantId?: string) => void;
  readonly size: number;
};

/**
 * `resolve(tenantId)`:
 *  - a binding read less than 15 s ago is returned WITHOUT reading the registry (P88);
 *  - past that it is re-read, ONE read however many callers arrive together (P89);
 *  - when the read FAILS the last good binding is served while it is younger than 10 minutes (the central
 *    project is then not a single point of failure for tenants already seen), and from 10 minutes on, or
 *    with no last-good entry at all (a cold process), it throws `ProjectUnavailableError` (P88, P90);
 *  - no binding row is `ProjectUnboundError`, never cached, never a default (P91, PR-3).
 */
export function createProjectResolver(options: ProjectResolverOptions): ProjectResolver {
  const now = options.now ?? (() => Math.trunc(performance.now()));
  const ttl = options.ttlMs ?? BINDING_TTL_MS;
  const stale = options.staleMs ?? BINDING_STALE_MS;
  const backoff = options.retryBackoffMs ?? BINDING_RETRY_BACKOFF_MS;
  const max = options.max ?? MAX_ENTRIES;

  /** Insertion order is the LRU order: a hit re-inserts. */
  const cache = new Map<string, Entry>();
  const inflight = new Map<string, Promise<ProjectRecord>>();

  function remember(tenantId: string, record: ProjectRecord, at: number): void {
    cache.delete(tenantId);
    if (cache.size >= max) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(tenantId, { record, readAt: at, retryAt: 0 });
  }

  async function refresh(tenantId: string): Promise<ProjectRecord> {
    let record: ProjectRecord | null;
    try {
      record = await options.load(tenantId);
    } catch {
      // The central read failed. Serve the last good value if it is young enough; never guess.
      const at = now();
      const last = cache.get(tenantId);
      if (last && at - last.readAt < stale) {
        last.retryAt = at + backoff;
        options.onStale?.(tenantId);
        return last.record;
      }
      throw new ProjectUnavailableError();
    }
    if (!record) {
      cache.delete(tenantId);
      throw new ProjectUnboundError();
    }
    remember(tenantId, record, now());
    return record;
  }

  async function resolve(tenantId: string): Promise<ProjectRecord> {
    const at = now();
    const hit = cache.get(tenantId);
    if (hit) {
      if (at - hit.readAt < ttl) {
        cache.delete(tenantId);
        cache.set(tenantId, hit);
        return hit.record;
      }
      // Just failed to refresh: keep serving the last good value without hammering a project that is down.
      if (at < hit.retryAt && at - hit.readAt < stale) return hit.record;
    }
    const pending = inflight.get(tenantId);
    if (pending) return pending;
    const started = refresh(tenantId).finally(() => {
      if (inflight.get(tenantId) === started) inflight.delete(tenantId);
    });
    inflight.set(tenantId, started);
    return started;
  }

  return {
    resolve,
    invalidate(tenantId) {
      if (tenantId === undefined) cache.clear();
      else cache.delete(tenantId);
    },
    get size() {
      return cache.size;
    },
  };
}

/** The real read: `platform.tenant_projects` joined to `platform.projects`, through the platform lane. */
async function loadBinding(tenantId: string): Promise<ProjectRecord | null> {
  const rows = await withPlatformTx((tx) =>
    tx
      .select(columns)
      .from(tenantProjects)
      .innerJoin(projects, eq(projects.id, tenantProjects.projectId))
      .where(eq(tenantProjects.tenantId, tenantId))
      .limit(1),
  );
  return rows[0] ?? null;
}

const log = moduleLogger('project-registry');

const resolver = createProjectResolver({
  load: loadBinding,
  onStale: (tenantId) => log.warn({ tenantId }, 'project.binding_served_stale'),
});

/** The project that holds `tenantId`'s data. Throws `ProjectUnboundError` / `ProjectUnavailableError`, never a default. */
export const resolveProject = (tenantId: string): Promise<ProjectRecord> =>
  resolver.resolve(tenantId);

/** Drops the cached binding of one tenant (or all): a bind, a move or a test changed it. */
export const invalidateProject = (tenantId?: string): void => resolver.invalidate(tenantId);

/** One project by id, read through (no cache): for the bootstrap and the operator commands. */
export async function resolveProjectById(id: string): Promise<ProjectRecord | null> {
  const rows = await withPlatformTx((tx) =>
    tx.select(columns).from(projects).where(eq(projects.id, id)).limit(1),
  );
  return rows[0] ?? null;
}

/** Every project whose state is `ready`, ascending `ref`: the fan-out of migrations, jobs and health checks. */
export async function listReadyProjects(): Promise<ProjectRecord[]> {
  return withPlatformTx((tx) =>
    tx.select(columns).from(projects).where(eq(projects.state, 'ready')).orderBy(asc(projects.ref)),
  );
}
