import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { env } from '../server/env';
import { moduleLogger } from '../server/logging';
import { open } from '../server/secrets/sealed';
import { ProjectUnavailableError } from '../server/tenancy/project-errors';
import type { ProjectRecord } from '../server/tenancy/project-registry';
import { db, sqlClient } from './client';
import * as schema from './schema';

export { ProjectUnavailableError };

/**
 * The connection of ONE project (09.2-03, D-538, DBT-09). `kind: 'central'` is project 0 (the process-wide
 * `sqlClient`/`db` pool, never closed here); `kind: 'tenant'` is a pooled connection to another project,
 * opened from its sealed `database_url_tx`. Carried explicitly: a lane receives the handle of the project it
 * resolved from the tenant id, and a transaction carries its handle (`project-handle.ts`). There is no
 * ambient "current project" anywhere (D-538).
 */
export type ProjectHandle = {
  projectId: string;
  ref: string;
  kind: 'central' | 'tenant';
  credentialVersion: number;
  sql: Sql;
  db: PostgresJsDatabase<typeof schema>;
};

/** What the cache needs of a project: the record, so the injected `connect` reads whatever it must. */
export type PoolConnection = { handle: ProjectHandle; end: () => Promise<void> };

/** A hold on a pooled handle. While it is held the pool is in flight and is never closed under the holder. */
export type Lease = { handle: ProjectHandle; release: () => void };

export type PoolCacheOptions = {
  /** How many tenant projects may be held open at once. Project 0 is never counted. */
  capacity: number;
  /** Opens the connection of a tenant project. Rejects when it cannot; the cache wraps any rejection. */
  connect: (project: ProjectRecord) => Promise<PoolConnection>;
  /** The handle of a `credential_source = 'env'` project (project 0). */
  central?: (project: ProjectRecord) => ProjectHandle;
  /** Monotonic clock in WHOLE milliseconds (P20). Default `performance.now()` truncated. */
  now?: () => number;
  /** Consecutive failures that open the breaker (default 3). */
  breakerThreshold?: number;
  /** How long an open breaker refuses before it admits one probe (default 15 000 ms). */
  breakerOpenMs?: number;
  /** Called once when a breaker opens, with the project id only. */
  onBreakerOpen?: (projectId: string) => void;
};

export type PoolCache = {
  /** Holds the project's handle, creating its pool once however many callers arrive together. */
  lease: (project: ProjectRecord) => Promise<Lease>;
  /** `lease`, `fn`, `release`; a connection-level failure of `fn` counts toward the breaker. */
  run: <T>(project: ProjectRecord, fn: (handle: ProjectHandle) => Promise<T>) => Promise<T>;
  /** Ends every pool, in flight or not (process shutdown, tests). */
  closeAll: () => Promise<void>;
  /** Tenant pools currently held (never more than `capacity` once nothing is in flight). */
  readonly size: number;
  /** Pools still draining after eviction or a credential rotation. */
  readonly draining: number;
};

type Entry = {
  key: string;
  projectId: string;
  version: number;
  ready: Promise<PoolConnection>;
  connection: PoolConnection | undefined;
  inFlight: number;
  retired: boolean;
  ended: boolean;
};

type Breaker = {
  failures: number;
  /** When the breaker opened; `null` while closed. */
  openedAt: number | null;
  /** When the single probe was admitted; `null` when none is out. */
  probeAt: number | null;
};

const CONNECTION_ERROR_CODES = new Set([
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EPIPE',
]);

/** A failure of the link to the database (the project is down or paused), not of the query. */
export function isConnectionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CONNECTION_ERROR_CODES.has(code);
}

const noop = () => undefined;

/**
 * The bounded LRU of tenant-project connections (DBT-09, P19-P21), with the breaker (D-537's sibling for
 * the data plane). A factory with injected `connect` and clock so the tests never open a socket.
 *
 *  - Keyed `${projectId}:${credentialVersion}`. A new version opens a new pool and drains the old one
 *    after its in-flight work; a request that still carries an older version uses the newest pool.
 *  - Single-flight creation: N concurrent first requests share ONE `connect`.
 *  - Eviction never ends a pool with work in flight: it takes the least recently used IDLE entry, and when
 *    none is idle the cache runs over capacity until a lease is released.
 *  - Three consecutive failures open the breaker for 15 s (`ProjectUnavailableError` without touching the
 *    network); then exactly one probe is admitted, a success closes it and a failure re-opens it.
 *  - `credential_source = 'env'` (project 0) is served by `central` and is never created, counted or evicted.
 */
export function createPoolCache(options: PoolCacheOptions): PoolCache {
  const capacity = options.capacity;
  if (!Number.isInteger(capacity) || capacity < 1)
    throw new Error('pool cache: capacity must be >= 1');
  const now = options.now ?? (() => Math.trunc(performance.now()));
  const threshold = options.breakerThreshold ?? 3;
  const openMs = options.breakerOpenMs ?? 15_000;

  /** Live entries, least recently used first (a lease re-inserts). Retired entries leave the map. */
  const map = new Map<string, Entry>();
  /** Every entry not yet ended, retired or not, so `closeAll` reaches the draining ones too. */
  const all = new Set<Entry>();
  const breakers = new Map<string, Breaker>();

  const keyOf = (projectId: string, version: number) => `${projectId}:${version}`;

  function breakerOf(projectId: string): Breaker {
    let b = breakers.get(projectId);
    if (!b) {
      b = { failures: 0, openedAt: null, probeAt: null };
      breakers.set(projectId, b);
    }
    return b;
  }

  /** Throws when the breaker refuses; admits the single probe once the open window has passed. */
  function admit(projectId: string): void {
    const b = breakers.get(projectId);
    if (!b || b.openedAt === null) return;
    const at = now();
    if (at - b.openedAt < openMs) throw new ProjectUnavailableError();
    // The window passed. One caller goes through; a probe that never reported back (its holder never ran
    // `run`) stops blocking after another full window, so a lease taken outside `run` cannot wedge it.
    if (b.probeAt !== null && at - b.probeAt < openMs) throw new ProjectUnavailableError();
    b.probeAt = at;
  }

  function success(projectId: string): void {
    const b = breakers.get(projectId);
    if (!b) return;
    b.failures = 0;
    b.openedAt = null;
    b.probeAt = null;
  }

  function failure(projectId: string): void {
    const b = breakerOf(projectId);
    b.failures += 1;
    const wasProbe = b.probeAt !== null;
    if (b.failures >= threshold || wasProbe) {
      const reopening = b.openedAt !== null;
      b.openedAt = now();
      b.probeAt = null;
      if (!reopening) options.onBreakerOpen?.(projectId);
    }
  }

  async function endEntry(entry: Entry): Promise<void> {
    if (entry.ended || !entry.connection) return;
    entry.ended = true;
    all.delete(entry);
    try {
      await entry.connection.end();
    } catch {
      // A pool that fails to close has nothing left to protect; the error would carry nothing we may log.
    }
  }

  function maybeEnd(entry: Entry): void {
    if (entry.retired && entry.inFlight === 0 && entry.connection) void endEntry(entry);
  }

  function retire(entry: Entry): void {
    if (map.get(entry.key) === entry) map.delete(entry.key);
    entry.retired = true;
    if (entry.connection) maybeEnd(entry);
    else entry.ready.then(() => maybeEnd(entry), noop);
  }

  function trim(): void {
    while (map.size > capacity) {
      let victim: Entry | undefined;
      for (const entry of map.values()) {
        if (entry.inFlight === 0 && entry.connection) {
          victim = entry;
          break;
        }
      }
      if (!victim) return; // everything is in flight or still connecting: run over until a release
      retire(victim);
    }
  }

  function pick(project: ProjectRecord): Entry | undefined {
    const exact = map.get(keyOf(project.id, project.credentialVersion));
    if (exact) return exact;
    let newest: Entry | undefined;
    for (const entry of map.values()) {
      if (entry.projectId !== project.id || entry.version <= project.credentialVersion) continue;
      if (!newest || entry.version > newest.version) newest = entry;
    }
    return newest;
  }

  function create(project: ProjectRecord): Entry {
    const entry: Entry = {
      key: keyOf(project.id, project.credentialVersion),
      projectId: project.id,
      version: project.credentialVersion,
      ready: undefined as unknown as Promise<PoolConnection>,
      connection: undefined,
      inFlight: 0,
      retired: false,
      ended: false,
    };
    all.add(entry);
    entry.ready = options.connect(project).then(
      (connection) => {
        entry.connection = connection;
        success(project.id);
        return connection;
      },
      (error: unknown) => {
        if (map.get(entry.key) === entry) map.delete(entry.key);
        all.delete(entry);
        failure(project.id);
        throw error instanceof ProjectUnavailableError ? error : new ProjectUnavailableError();
      },
    );
    map.set(entry.key, entry);
    // A new credential version supersedes the older pools of the same project: drain them.
    for (const other of [...map.values()]) {
      if (other !== entry && other.projectId === project.id && other.version < entry.version) {
        retire(other);
      }
    }
    return entry;
  }

  async function lease(project: ProjectRecord): Promise<Lease> {
    if (project.credentialSource === 'env') {
      const central = options.central;
      if (!central) throw new ProjectUnavailableError();
      return { handle: central(project), release: noop };
    }
    admit(project.id);
    const entry = pick(project) ?? create(project);
    entry.inFlight += 1;
    // Most recently used goes last in iteration order.
    if (map.get(entry.key) === entry) {
      map.delete(entry.key);
      map.set(entry.key, entry);
    }
    trim();
    let connection: PoolConnection;
    try {
      connection = await entry.ready;
    } catch (error) {
      entry.inFlight -= 1;
      throw error;
    }
    let released = false;
    return {
      handle: connection.handle,
      release: () => {
        if (released) return;
        released = true;
        entry.inFlight -= 1;
        maybeEnd(entry);
        trim();
      },
    };
  }

  async function run<T>(
    project: ProjectRecord,
    fn: (handle: ProjectHandle) => Promise<T>,
  ): Promise<T> {
    const held = await lease(project);
    try {
      const out = await fn(held.handle);
      if (project.credentialSource !== 'env') success(project.id);
      return out;
    } catch (error) {
      if (project.credentialSource !== 'env' && isConnectionError(error)) failure(project.id);
      throw error;
    } finally {
      held.release();
    }
  }

  async function closeAll(): Promise<void> {
    const entries = [...all];
    map.clear();
    for (const entry of entries) entry.retired = true;
    await Promise.allSettled(
      entries.map(async (entry) => {
        await entry.ready.catch(noop);
        await endEntry(entry);
      }),
    );
  }

  return {
    lease,
    run,
    closeAll,
    get size() {
      return map.size;
    },
    get draining() {
      return [...all].filter((entry) => entry.retired).length;
    },
  };
}

/** Project 0: the process-wide pool, never closed or evicted from here (`sqlClient.end()` is the shutdown). */
export function centralHandle(
  project?: Pick<ProjectRecord, 'id' | 'ref' | 'credentialVersion'>,
): ProjectHandle {
  return {
    projectId: project?.id ?? 'project-0',
    ref: project?.ref ?? 'project-0',
    kind: 'central',
    credentialVersion: project?.credentialVersion ?? 1,
    sql: sqlClient,
    db,
  };
}

/**
 * Opens the pool of a tenant project from its SEALED transaction-pooler URL (AAD `<id>:database_url_tx`,
 * D-539) and proves it with one `select 1`, because postgres.js connects lazily and the breaker must see a
 * dead project at creation, not on the first tenant query. Never logs or throws the URL: every failure is
 * the content-free `ProjectUnavailableError`.
 */
async function connectProject(project: ProjectRecord): Promise<PoolConnection> {
  if (!project.databaseUrlTxSealed) throw new ProjectUnavailableError();
  let url: string;
  try {
    url = open(project.databaseUrlTxSealed, `${project.id}:database_url_tx`);
  } catch {
    throw new ProjectUnavailableError();
  }
  const sql = postgres(url, {
    prepare: false,
    max: env.PROJECT_POOL_MAX,
    idle_timeout: env.PROJECT_POOL_IDLE_S,
    max_lifetime: 1800,
    connect_timeout: 10,
  });
  try {
    await sql`select 1`;
  } catch {
    await sql.end({ timeout: 0 }).catch(noop);
    throw new ProjectUnavailableError();
  }
  const handle: ProjectHandle = {
    projectId: project.id,
    ref: project.ref,
    kind: 'tenant',
    credentialVersion: project.credentialVersion,
    sql,
    db: drizzle(sql, { schema }),
  };
  return { handle, end: () => sql.end({ timeout: 5 }) };
}

const log = moduleLogger('project-pools');

const poolCache = createPoolCache({
  capacity: env.PROJECT_POOL_CACHE_MAX,
  connect: connectProject,
  central: (project) => centralHandle(project),
  onBreakerOpen: (projectId) => log.warn({ projectId }, 'project.breaker_open'),
});

/**
 * Runs `fn` with the handle of `project`, holding its pool in flight for the duration. This is what the
 * lanes use. A `credential_source = 'env'` project is served by the central handle, no pool involved.
 */
export const withHandle = <T>(
  project: ProjectRecord,
  fn: (handle: ProjectHandle) => Promise<T>,
): Promise<T> => poolCache.run(project, fn);

/**
 * The handle of `project` WITHOUT holding it: the pool may be evicted right after. For one-shot callers that
 * open their own work immediately (plan 09's enqueue); prefer `withHandle` for anything that awaits.
 */
export async function handleFor(project: ProjectRecord): Promise<ProjectHandle> {
  const held = await poolCache.lease(project);
  held.release();
  return held.handle;
}

/** Ends every tenant pool (process shutdown). Project 0's `sqlClient` is ended by its owner. */
export const closeAllPools = (): Promise<void> => poolCache.closeAll();
