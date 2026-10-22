import { describe, expect, it, vi } from 'vitest';
import { errorEnvelope } from '../server/http/api-error';
import {
  BINDING_RETRY_BACKOFF_MS,
  createProjectResolver,
  type ProjectRecord,
  ProjectUnavailableError,
  ProjectUnboundError,
} from '../server/tenancy/project-registry';

/**
 * D-537 / D-538 (09.2-03): the resolver that turns a tenant id into a project. `load` and the clock are
 * injected, so no test opens a database. P88 (boundary), P89 (concurrency), P90 (empty) and P91 (no binding)
 * are explicit cases; every boundary is pinned to the millisecond.
 */

const TTL = 15_000;
const STALE = 600_000;

const record = (n: number): ProjectRecord => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  ref: `proj-${n}`,
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
});

function harness(options: { max?: number } = {}) {
  let clock = 0;
  const load = vi.fn<(tenantId: string) => Promise<ProjectRecord | null>>(async () => record(1));
  const resolver = createProjectResolver({ load, now: () => clock, ...options });
  return {
    load,
    resolver,
    at: (ms: number) => {
      clock = ms;
    },
  };
}

describe('the binding cache: 15 s without reading the registry (P88)', () => {
  it('a binding last read less than 15 s ago is served without calling load', async () => {
    const h = harness();
    h.at(0);
    await h.resolver.resolve('t1');
    h.at(TTL - 1); // 14.999 s
    await h.resolver.resolve('t1');
    await h.resolver.resolve('t1');
    expect(h.load).toHaveBeenCalledTimes(1);
  });

  it('from 15.000 s on the registry is read again', async () => {
    const h = harness();
    h.at(0);
    await h.resolver.resolve('t1');
    h.at(TTL);
    await h.resolver.resolve('t1');
    expect(h.load).toHaveBeenCalledTimes(2);
  });

  it('one tenant never serves another: the cache is keyed by tenant id', async () => {
    const h = harness();
    h.load.mockImplementation(async (id) => record(id === 't1' ? 1 : 2));
    expect((await h.resolver.resolve('t1')).ref).toBe('proj-1');
    expect((await h.resolver.resolve('t2')).ref).toBe('proj-2');
    expect((await h.resolver.resolve('t1')).ref).toBe('proj-1');
  });

  it('invalidate(tenantId) forces a re-read of that tenant only, invalidate() of all', async () => {
    const h = harness();
    await h.resolver.resolve('t1');
    await h.resolver.resolve('t2');
    expect(h.load).toHaveBeenCalledTimes(2);
    h.resolver.invalidate('t1');
    await h.resolver.resolve('t1');
    await h.resolver.resolve('t2');
    expect(h.load).toHaveBeenCalledTimes(3);
    h.resolver.invalidate();
    await h.resolver.resolve('t1');
    await h.resolver.resolve('t2');
    expect(h.load).toHaveBeenCalledTimes(5);
  });

  it('a rebinding is seen on the next read: the new project replaces the cached one', async () => {
    const h = harness();
    h.at(0);
    expect((await h.resolver.resolve('t1')).ref).toBe('proj-1');
    h.load.mockResolvedValue(record(7));
    h.at(TTL);
    expect((await h.resolver.resolve('t1')).ref).toBe('proj-7');
  });
});

describe('stale-while-error: the central project is not a single point of failure (P88-P90)', () => {
  it('P88: a binding read 9 min 59.999 s ago is served when the central read fails; at 10 min 0.000 s it fails closed', async () => {
    const h = harness();
    h.at(0);
    const good = await h.resolver.resolve('t1');
    h.load.mockRejectedValue(new Error('central down'));

    h.at(STALE - 1); // 599_999
    expect(await h.resolver.resolve('t1')).toBe(good);

    h.at(STALE); // 600_000
    await expect(h.resolver.resolve('t1')).rejects.toBeInstanceOf(ProjectUnavailableError);
  });

  it('P89: with the central project unreachable, 50 concurrent calls trigger ONE refresh and all get the last good value', async () => {
    const h = harness();
    h.at(0);
    const good = await h.resolver.resolve('t1');
    h.load.mockClear();
    h.load.mockRejectedValue(new Error('central down'));

    h.at(TTL + 1);
    const results = await Promise.all(Array.from({ length: 50 }, () => h.resolver.resolve('t1')));
    expect(h.load).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r).toBe(good);
  });

  it('P90: a cold process with the central project unreachable throws TENANT_UNAVAILABLE and never guesses a project', async () => {
    const h = harness();
    h.load.mockRejectedValue(new Error('central down'));
    await expect(h.resolver.resolve('t1')).rejects.toBeInstanceOf(ProjectUnavailableError);
    await expect(h.resolver.resolve('t1')).rejects.toBeInstanceOf(ProjectUnavailableError);
    expect(h.resolver.size).toBe(0);
  });

  it('after a failed refresh the stale value is served without hammering the registry for the backoff window', async () => {
    const h = harness();
    h.at(0);
    await h.resolver.resolve('t1');
    h.load.mockClear();
    h.load.mockRejectedValue(new Error('central down'));

    h.at(TTL + 1_000);
    await h.resolver.resolve('t1');
    expect(h.load).toHaveBeenCalledTimes(1);
    h.at(TTL + 1_000 + BINDING_RETRY_BACKOFF_MS - 1);
    await h.resolver.resolve('t1');
    expect(h.load).toHaveBeenCalledTimes(1);
    h.at(TTL + 1_000 + BINDING_RETRY_BACKOFF_MS);
    await h.resolver.resolve('t1');
    expect(h.load).toHaveBeenCalledTimes(2);
  });

  it('a recovered central read replaces the stale value and restarts the clock', async () => {
    const h = harness();
    h.at(0);
    await h.resolver.resolve('t1');
    h.load.mockRejectedValueOnce(new Error('central down'));
    h.at(TTL);
    await h.resolver.resolve('t1'); // stale served
    h.load.mockResolvedValue(record(9));
    h.at(TTL + BINDING_RETRY_BACKOFF_MS);
    expect((await h.resolver.resolve('t1')).ref).toBe('proj-9');
    // read at 20 s: the stale window counts from here, not from t = 0.
    h.load.mockRejectedValue(new Error('central down'));
    h.at(TTL + BINDING_RETRY_BACKOFF_MS + STALE - 1);
    expect((await h.resolver.resolve('t1')).ref).toBe('proj-9');
  });
});

describe('fail closed: no binding is never a default (P91, PR-3)', () => {
  it('a load that returns no row throws ProjectUnboundError', async () => {
    const h = harness();
    h.load.mockResolvedValue(null);
    await expect(h.resolver.resolve('t1')).rejects.toBeInstanceOf(ProjectUnboundError);
  });

  it('the negative answer is not cached: a binding added afterwards is seen at once', async () => {
    const h = harness();
    h.load.mockResolvedValueOnce(null);
    await expect(h.resolver.resolve('t1')).rejects.toBeInstanceOf(ProjectUnboundError);
    expect(h.resolver.size).toBe(0);
    h.load.mockResolvedValue(record(1));
    expect((await h.resolver.resolve('t1')).ref).toBe('proj-1');
  });

  it('a binding that vanishes from the registry stops being served, even inside the 10 minutes', async () => {
    const h = harness();
    h.at(0);
    await h.resolver.resolve('t1');
    h.load.mockResolvedValue(null);
    h.at(TTL);
    await expect(h.resolver.resolve('t1')).rejects.toBeInstanceOf(ProjectUnboundError);
    expect(h.resolver.size).toBe(0);
  });

  it('the two refusals map to the stable 503 envelope and name no project or tenant', () => {
    for (const [error, code] of [
      [new ProjectUnboundError(), 'TENANT_PROJECT_UNBOUND'],
      [new ProjectUnavailableError(), 'TENANT_UNAVAILABLE'],
    ] as const) {
      const { body, status } = errorEnvelope(error, 'req-1');
      expect(status).toBe(503);
      expect(body.error.code).toBe(code);
      expect(body.error.details).toBeUndefined();
      expect(JSON.stringify(body)).not.toMatch(/proj-|postgres|tenant_projects/);
    }
  });
});

describe('the bound (WR-06)', () => {
  it('the cache never exceeds 1,000 entries under 5,000 distinct tenant ids', async () => {
    const h = harness();
    for (let i = 0; i < 5_000; i++) await h.resolver.resolve(`tenant-${i}`);
    expect(h.resolver.size).toBe(1_000);
    expect(h.load).toHaveBeenCalledTimes(5_000);
  });

  it('eviction is least recently used: a tenant that keeps being hit survives the storm', async () => {
    const h = harness({ max: 3 });
    await h.resolver.resolve('keep');
    for (let i = 0; i < 20; i++) {
      await h.resolver.resolve(`other-${i}`);
      await h.resolver.resolve('keep');
    }
    expect(h.resolver.size).toBe(3);
    h.load.mockClear();
    await h.resolver.resolve('keep');
    expect(h.load).not.toHaveBeenCalled();
  });
});
