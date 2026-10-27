import { describe, expect, it, vi } from 'vitest';
import {
  createPoolCache,
  isConnectionError,
  type PoolCacheOptions,
  type ProjectHandle,
  ProjectUnavailableError,
} from '../db/project-pools';
import { env } from '../server/env';
import type { ProjectRecord } from '../server/tenancy/project-registry';

/**
 * DBT-09 (09.2-03): the bounded LRU of tenant-project connections and its breaker. Everything is injected:
 * `connect` is a fake that opens nothing and the clock is a number the test moves, in whole milliseconds
 * (P20). P19 (capacity boundary, breaker boundary) and P21 (single-flight, eviction under an open
 * transaction) are explicit cases.
 */

const project = (n: number, overrides: Partial<ProjectRecord> = {}): ProjectRecord => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  ref: `proj-${n}`,
  provider: 'fake',
  isCentral: false,
  isDefault: false,
  credentialSource: 'sealed',
  credentialVersion: 1,
  apiUrl: 'https://example.test',
  publishableKey: null,
  state: 'ready',
  secretKeyId: 1,
  databaseUrlTxSealed: 'v1:1:a:b:c',
  databaseUrlSessionSealed: null,
  ddlUrlSealed: null,
  serviceKeySealed: null,
  serviceKeyKind: null,
  hookRef: null,
  hookSecretSealed: null,
  owner: 'platform',
  orgSlug: null,
  mgmtTokenSealed: null,
  mgmtTokenExpiresAt: null,
  ...overrides,
});

const envProject = (n: number) =>
  project(n, { credentialSource: 'env', isCentral: true, credentialVersion: 1 });

function harness(options: Partial<PoolCacheOptions> = {}) {
  let clock = 0;
  const ends = new Map<string, ReturnType<typeof vi.fn>>();
  const connect = vi.fn(async (p: ProjectRecord) => {
    const end = vi.fn(async () => undefined);
    ends.set(`${p.ref}:${p.credentialVersion}`, end);
    const handle = {
      projectId: p.id,
      ref: p.ref,
      kind: 'tenant',
      credentialVersion: p.credentialVersion,
    } as unknown as ProjectHandle;
    return { handle, end };
  });
  const central = vi.fn(
    (p: ProjectRecord) =>
      ({
        projectId: p.id,
        ref: p.ref,
        kind: 'central',
        credentialVersion: p.credentialVersion,
      }) as unknown as ProjectHandle,
  );
  const cache = createPoolCache({
    capacity: 3,
    connect,
    central,
    now: () => clock,
    ...options,
  });
  return {
    cache,
    connect,
    central,
    ends,
    at: (ms: number) => {
      clock = ms;
    },
    endOf: (ref: string, version = 1) => ends.get(`${ref}:${version}`),
  };
}

const failing = (h: ReturnType<typeof harness>) =>
  h.connect.mockImplementation(async () => {
    throw new Error('connect ECONNREFUSED postgres://u:secret@host/db');
  });

describe('capacity and eviction (P19)', () => {
  it('the C-th distinct project fits and the (C+1)-th evicts the least recently used IDLE entry', async () => {
    const h = harness();
    for (const n of [1, 2, 3]) (await h.cache.lease(project(n))).release();
    expect(h.cache.size).toBe(3);
    expect(h.endOf('proj-1')).not.toHaveBeenCalled();

    (await h.cache.lease(project(4))).release();
    expect(h.cache.size).toBe(3);
    expect(h.endOf('proj-1')).toHaveBeenCalledTimes(1);
    expect(h.endOf('proj-2')).not.toHaveBeenCalled();
    expect(h.endOf('proj-3')).not.toHaveBeenCalled();
  });

  it('uses recency, not creation order: touching the oldest entry spares it', async () => {
    const h = harness();
    for (const n of [1, 2, 3]) (await h.cache.lease(project(n))).release();
    (await h.cache.lease(project(1))).release(); // proj-1 is now the most recently used
    (await h.cache.lease(project(4))).release();
    expect(h.endOf('proj-2')).toHaveBeenCalledTimes(1);
    expect(h.endOf('proj-1')).not.toHaveBeenCalled();
  });

  it('never ends an in-flight entry: the least recently used IDLE one goes instead', async () => {
    const h = harness();
    const held = await h.cache.lease(project(1)); // oldest, but in flight
    (await h.cache.lease(project(2))).release();
    (await h.cache.lease(project(3))).release();
    (await h.cache.lease(project(4))).release();
    expect(h.endOf('proj-1')).not.toHaveBeenCalled();
    expect(h.endOf('proj-2')).toHaveBeenCalledTimes(1);
    held.release();
    expect(h.endOf('proj-1')).not.toHaveBeenCalled(); // within capacity again, still cached
  });

  it('P21: with everything in flight the cache runs over capacity, and an entry ends only after its release', async () => {
    const h = harness();
    const leases = [];
    for (const n of [1, 2, 3, 4]) leases.push(await h.cache.lease(project(n)));
    expect(h.cache.size).toBe(4);
    for (const n of [1, 2, 3, 4]) expect(h.endOf(`proj-${n}`)).not.toHaveBeenCalled();

    leases[0]?.release();
    expect(h.cache.size).toBe(3);
    expect(h.endOf('proj-1')).toHaveBeenCalledTimes(1);
    for (const l of leases.slice(1)) l.release();
    expect(h.endOf('proj-2')).not.toHaveBeenCalled();
  });

  it('project 0 (credential_source env) is never connected, counted or evicted', async () => {
    const h = harness({ capacity: 1 });
    for (const n of [100, 101, 102]) (await h.cache.lease(envProject(n))).release();
    expect(h.connect).not.toHaveBeenCalled();
    expect(h.central).toHaveBeenCalledTimes(3);
    expect(h.cache.size).toBe(0);

    (await h.cache.lease(project(1))).release();
    (await h.cache.lease(envProject(100))).release();
    expect(h.cache.size).toBe(1);
    expect(h.endOf('proj-1')).not.toHaveBeenCalled();
  });
});

describe('single-flight creation (P21)', () => {
  it('20 concurrent first requests for a cold project create exactly ONE pool', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = harness();
    h.connect.mockImplementation(async (p: ProjectRecord) => {
      await gate;
      return {
        handle: { projectId: p.id, ref: p.ref, kind: 'tenant' } as unknown as ProjectHandle,
        end: vi.fn(async () => undefined),
      };
    });
    const pending = Array.from({ length: 20 }, () => h.cache.lease(project(1)));
    release();
    const leases = await Promise.all(pending);
    expect(h.connect).toHaveBeenCalledTimes(1);
    expect(new Set(leases.map((l) => l.handle)).size).toBe(1);
    for (const l of leases) l.release();
  });

  it('a failed shared connect rejects every waiter, counts ONE failure and leaves nothing cached', async () => {
    const h = harness();
    failing(h);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => h.cache.lease(project(1))),
    );
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(h.connect).toHaveBeenCalledTimes(1);
    expect(h.cache.size).toBe(0);
    // One failure so far: the next attempt reaches connect again (the breaker is still closed).
    await expect(h.cache.lease(project(1))).rejects.toBeInstanceOf(ProjectUnavailableError);
    expect(h.connect).toHaveBeenCalledTimes(2);
  });

  it('a connect failure is the content-free error, whatever the driver said', async () => {
    const h = harness();
    failing(h);
    try {
      await h.cache.lease(project(1));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectUnavailableError);
      expect((error as Error).message).toBe('tenant project unavailable');
      expect((error as Error).message).not.toContain('secret');
    }
  });
});

describe('the breaker (P19, P20)', () => {
  it('stays closed after 2 consecutive failures, opens at the 3rd, refuses at 14.999 s and admits ONE probe at 15.000 s', async () => {
    const h = harness();
    failing(h);
    h.at(1_000);
    await expect(h.cache.lease(project(1))).rejects.toBeInstanceOf(ProjectUnavailableError);
    await expect(h.cache.lease(project(1))).rejects.toBeInstanceOf(ProjectUnavailableError);
    expect(h.connect).toHaveBeenCalledTimes(2);
    // 2 failures: still closed, the 3rd call reaches the network.
    await expect(h.cache.lease(project(1))).rejects.toBeInstanceOf(ProjectUnavailableError);
    expect(h.connect).toHaveBeenCalledTimes(3);

    // Open since t = 1 000. At 14.999 s after, refused without touching the network.
    h.at(1_000 + 14_999);
    await expect(h.cache.lease(project(1))).rejects.toBeInstanceOf(ProjectUnavailableError);
    expect(h.connect).toHaveBeenCalledTimes(3);

    // At exactly 15.000 s ONE probe goes through; a second caller meanwhile is still refused.
    h.at(1_000 + 15_000);
    let succeed: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      succeed = resolve;
    });
    h.connect.mockImplementation(async (p: ProjectRecord) => {
      await gate;
      return {
        handle: { projectId: p.id, ref: p.ref, kind: 'tenant' } as unknown as ProjectHandle,
        end: vi.fn(async () => undefined),
      };
    });
    const probe = h.cache.lease(project(1));
    await expect(h.cache.lease(project(1))).rejects.toBeInstanceOf(ProjectUnavailableError);
    succeed();
    (await probe).release();
    expect(h.connect).toHaveBeenCalledTimes(4);

    // The probe succeeded: the breaker is closed, ordinary traffic flows.
    (await h.cache.lease(project(1))).release();
    expect(h.connect).toHaveBeenCalledTimes(4);
  });

  it('a failed probe re-opens the breaker for another full window', async () => {
    const h = harness();
    failing(h);
    h.at(0);
    for (let i = 0; i < 3; i++) await h.cache.lease(project(1)).catch(() => undefined);
    expect(h.connect).toHaveBeenCalledTimes(3);

    h.at(15_000);
    await expect(h.cache.lease(project(1))).rejects.toBeInstanceOf(ProjectUnavailableError);
    expect(h.connect).toHaveBeenCalledTimes(4); // the probe

    h.at(15_000 + 14_999);
    await expect(h.cache.lease(project(1))).rejects.toBeInstanceOf(ProjectUnavailableError);
    expect(h.connect).toHaveBeenCalledTimes(4); // refused again, no network

    h.at(15_000 + 15_000);
    await h.cache.lease(project(1)).catch(() => undefined);
    expect(h.connect).toHaveBeenCalledTimes(5); // the next probe
  });

  it('the breaker is per project: one project down does not refuse another', async () => {
    const h = harness();
    h.connect.mockImplementation(async (p: ProjectRecord) => {
      if (p.ref === 'proj-1') throw new Error('down');
      return {
        handle: { projectId: p.id, ref: p.ref, kind: 'tenant' } as unknown as ProjectHandle,
        end: vi.fn(async () => undefined),
      };
    });
    for (let i = 0; i < 3; i++) await h.cache.lease(project(1)).catch(() => undefined);
    await expect(h.cache.lease(project(1))).rejects.toBeInstanceOf(ProjectUnavailableError);
    (await h.cache.lease(project(2))).release();
    expect(h.cache.size).toBe(1);
  });

  it('run() counts a connection-level failure of the work toward the breaker, and a query error not', async () => {
    const h = harness();
    const code = (c: string) => Object.assign(new Error('boom'), { code: c });
    for (let i = 0; i < 5; i++) {
      await expect(
        h.cache.run(project(1), async () => {
          throw code('23505');
        }),
      ).rejects.toThrow('boom');
    }
    // 5 query errors (a unique violation): the breaker never opened.
    await h.cache.run(project(1), async () => 'ok');

    for (let i = 0; i < 3; i++) {
      await expect(
        h.cache.run(project(1), async () => {
          throw code('ECONNREFUSED');
        }),
      ).rejects.toThrow('boom');
    }
    await expect(h.cache.run(project(1), async () => 'ok')).rejects.toBeInstanceOf(
      ProjectUnavailableError,
    );
  });

  it('classifies connection errors by driver code only', () => {
    expect(isConnectionError({ code: 'CONNECT_TIMEOUT' })).toBe(true);
    expect(isConnectionError({ code: 'ECONNREFUSED' })).toBe(true);
    expect(isConnectionError({ code: '23505' })).toBe(false);
    expect(isConnectionError(new Error('connect ECONNREFUSED'))).toBe(false);
    expect(isConnectionError(null)).toBe(false);
  });

  it('P20: the idle and lifetime options reaching postgres.js are whole seconds', () => {
    for (const seconds of [
      env.PROJECT_POOL_IDLE_S,
      env.PROJECT_POOL_MAX,
      env.PROJECT_POOL_CACHE_MAX,
    ]) {
      expect(Number.isInteger(seconds)).toBe(true);
      expect(seconds).toBeGreaterThan(0);
    }
  });
});

describe('credential rotation', () => {
  it('a new credentialVersion opens a new pool and drains the old one after its in-flight work', async () => {
    const h = harness();
    const old = await h.cache.lease(project(1, { credentialVersion: 1 }));
    const fresh = await h.cache.lease(project(1, { credentialVersion: 2 }));
    expect(h.connect).toHaveBeenCalledTimes(2);
    expect(fresh.handle).not.toBe(old.handle);
    expect(h.cache.size).toBe(1);
    expect(h.cache.draining).toBe(1);
    expect(h.endOf('proj-1', 1)).not.toHaveBeenCalled(); // still serving the holder
    old.release();
    expect(h.endOf('proj-1', 1)).toHaveBeenCalledTimes(1);
    expect(h.cache.draining).toBe(0);
    fresh.release();
    expect(h.endOf('proj-1', 2)).not.toHaveBeenCalled();
  });

  it('a request still carrying an older version is served by the newest pool, not a revived old one', async () => {
    const h = harness();
    (await h.cache.lease(project(1, { credentialVersion: 2 }))).release();
    const stale = await h.cache.lease(project(1, { credentialVersion: 1 }));
    expect(h.connect).toHaveBeenCalledTimes(1);
    expect(stale.handle.credentialVersion).toBe(2);
    stale.release();
  });

  it('closeAll ends every pool, draining ones included', async () => {
    const h = harness();
    const a = await h.cache.lease(project(1, { credentialVersion: 1 }));
    await h.cache.lease(project(1, { credentialVersion: 2 })).then((l) => l.release());
    (await h.cache.lease(project(2))).release();
    await h.cache.closeAll();
    expect(h.endOf('proj-1', 1)).toHaveBeenCalledTimes(1);
    expect(h.endOf('proj-1', 2)).toHaveBeenCalledTimes(1);
    expect(h.endOf('proj-2')).toHaveBeenCalledTimes(1);
    expect(h.cache.size).toBe(0);
    a.release();
    expect(h.endOf('proj-1', 1)).toHaveBeenCalledTimes(1);
  });
});
