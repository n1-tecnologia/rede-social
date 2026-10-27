import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createLimiter } from '../server/projects/limiter';
import {
  createSupabaseProjectProvider,
  pickKey,
  resetDelayMs,
} from '../server/projects/management-api';
import {
  BOOTSTRAP_REASONS,
  BOOTSTRAP_STEPS,
  reasonOf,
  STEP_REASON,
} from '../server/projects/reasons';
import {
  type ApiKey,
  ProjectProviderError,
  type ProjectProviderErrorKind,
} from '../server/projects/types';
import { allServicesHealthy, classifyStatus, waitUntilHealthy } from '../server/projects/wait';

/**
 * 09.2-12 (DBT-20, D-541): the real Management API client, proven against a LOCAL stub (a `node:http`
 * server on loopback). No test here reaches the real API, uses a real token or creates a project.
 */

const PAT = 'sbp_SECRET-platform-token-0001';
const ORG = 'acme-org';
const REF = 'abcdefghijklmnopqrst';

type Recorded = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  body: unknown;
};
type Reply = {
  status: number;
  body?: unknown;
  raw?: string;
  headers?: Record<string, string>;
};
type Handler = (request: Recorded) => Reply | undefined;

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

/** A stub of the Management API on 127.0.0.1:0. Unknown routes answer 404 with a body that names the PAT. */
async function startStub(handler: Handler) {
  const requests: Recorded[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://stub.local');
      const text = Buffer.concat(chunks).toString('utf8');
      const recorded: Recorded = {
        method: req.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
        body: text === '' ? undefined : JSON.parse(text),
      };
      requests.push(recorded);
      const reply = handler(recorded) ?? { status: 404, body: { message: `no route ${PAT}` } };
      const payload = reply.raw ?? (reply.body === undefined ? '' : JSON.stringify(reply.body));
      res.writeHead(reply.status, { 'Content-Type': 'application/json', ...reply.headers });
      res.end(payload);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, requests };
}

const projectBody = (overrides: Record<string, unknown> = {}) => ({
  id: REF,
  ref: REF,
  organization_id: 'org-id',
  organization_slug: ORG,
  name: 'Tenant A',
  region: 'sa-east-1',
  created_at: '2026-10-01T00:00:00Z',
  status: 'ACTIVE_HEALTHY',
  database: {
    host: `db.${REF}.supabase.co`,
    version: '17',
    postgres_engine: '17',
    release_channel: 'ga',
  },
  ...overrides,
});

const healthyBody = () =>
  ['auth', 'db', 'db_postgres_user', 'pooler', 'realtime', 'rest', 'storage'].map((name) => ({
    name,
    healthy: true,
    status: 'ACTIVE_HEALTHY',
  }));

const P = `/v1/projects/${REF}`;

/** The read endpoints of COVERAGE.md with canned answers shaped like the OpenAPI schemas. */
const readRoutes: Handler = (r) => {
  if (r.method !== 'GET') return undefined;
  switch (r.path) {
    case P:
      return { status: 200, body: projectBody() };
    case `${P}/health`:
      return { status: 200, body: healthyBody() };
    case `${P}/api-keys`:
      return {
        status: 200,
        body: [
          {
            type: 'legacy',
            name: 'anon',
            id: 'k-anon',
            api_key: 'eyJ.anon.jwt',
            inserted_at: '2026-01-01T00:00:00Z',
          },
          {
            type: 'publishable',
            name: 'default',
            id: 'k-pub',
            api_key: 'sb_publishable_AAA',
            inserted_at: '2026-02-01T00:00:00Z',
          },
          {
            type: 'secret',
            name: 'default',
            id: 'k-sec',
            api_key: 'sb_secret_BBB',
            inserted_at: '2026-02-01T00:00:00Z',
          },
        ],
      };
    case `${P}/config/database/pooler`:
      return {
        status: 200,
        body: [
          {
            identifier: REF,
            database_type: 'READ_REPLICA',
            is_using_scram_auth: true,
            db_user: 'postgres',
            db_host: 'replica.pooler.supabase.com',
            db_port: 6543,
            db_name: 'postgres',
            connection_string: 'x',
            connectionString: 'x',
            default_pool_size: 15,
            max_client_conn: 200,
            pool_mode: 'transaction',
          },
          {
            identifier: REF,
            database_type: 'PRIMARY',
            is_using_scram_auth: true,
            db_user: 'postgres',
            db_host: 'aws-0-sa-east-1.pooler.supabase.com',
            db_port: 6543,
            db_name: 'postgres',
            connection_string: 'x',
            connectionString: 'x',
            default_pool_size: 15,
            max_client_conn: 200,
            pool_mode: 'transaction',
          },
        ],
      };
    case `${P}/database/migrations`:
      return {
        status: 200,
        body: [{ version: '20260101000000', name: 'init' }, { version: '20260102000000' }],
      };
    case `${P}/storage/buckets`:
      return { status: 200, body: [] };
    default:
      return undefined;
  }
};

const provider = (
  baseUrl: string,
  extra: Partial<Parameters<typeof createSupabaseProjectProvider>[0]> = {},
) =>
  createSupabaseProjectProvider({
    pat: PAT,
    orgSlug: ORG,
    baseUrl,
    limiter: createLimiter({ perMinute: 10_000 }),
    jitter: () => 0,
    ...extra,
  });

describe('Management API client: the tracer (D-541)', () => {
  it('reads a project end to end', async () => {
    const stub = await startStub(readRoutes);
    const api = provider(stub.baseUrl);

    const described = await api.describe(REF);
    expect(described).toEqual({
      ref: REF,
      name: 'Tenant A',
      status: 'ACTIVE_HEALTHY',
      orgSlug: ORG,
    });

    const health = await api.health(REF);
    expect(Object.keys(health.services).sort()).toEqual([
      'auth',
      'db',
      'db_postgres_user',
      'pooler',
      'realtime',
      'rest',
      'storage',
    ]);
    expect(Object.values(health.services).every((s) => s === 'ACTIVE_HEALTHY')).toBe(true);

    const keys = await api.listApiKeys(REF);
    expect(keys.map((k) => [k.kind, k.id, k.value])).toEqual([
      ['legacy_anon', 'k-anon', 'eyJ.anon.jwt'],
      ['publishable', 'k-pub', 'sb_publishable_AAA'],
      ['secret', 'k-sec', 'sb_secret_BBB'],
    ]);

    const pooler = await api.poolerConfig(REF);
    expect(pooler).toMatchObject({
      host: 'aws-0-sa-east-1.pooler.supabase.com',
      txPort: 6543,
      sessionPort: 5432,
      dbName: 'postgres',
    });
    expect(pooler.userFor('postgres')).toBe(`postgres.${REF}`);

    expect(await api.listMigrations(REF)).toEqual([
      { version: '20260101000000', name: 'init' },
      { version: '20260102000000' },
    ]);
    expect(await api.listBuckets(REF)).toEqual([]);

    // The organisation is confirmed once per ref (the first guarded call after `describe` found it cached).
    expect(stub.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      `GET ${P}`,
      `GET ${P}/health`,
      `GET ${P}/api-keys`,
      `GET ${P}/config/database/pooler`,
      `GET ${P}/database/migrations`,
      `GET ${P}/storage/buckets`,
    ]);
    expect(stub.requests[1]?.query.get('services')).toBe(
      'auth,db,db_postgres_user,pooler,realtime,rest,storage',
    );
    expect(stub.requests[2]?.query.get('reveal')).toBe('true');
    for (const request of stub.requests) {
      expect(request.headers.authorization).toBe(`Bearer ${PAT}`);
      // Nothing else of the secret travels: no apikey header, no cookie, no PAT in the query string.
      for (const name of ['apikey', 'x-api-key', 'cookie', 'proxy-authorization']) {
        expect(request.headers[name]).toBeUndefined();
      }
      expect(request.query.toString()).not.toContain(PAT);
    }
  });

  it('never makes a request for a ref that is not 20 lower-case letters', async () => {
    const stub = await startStub(readRoutes);
    const api = provider(stub.baseUrl);
    const refs = [
      'abcdefghijklmnopqrs', // 19
      'abcdefghijklmnopqrstu', // 21
      'ABCDEFGHIJKLMNOPQRST',
      'abcdefghij/lmnopqrst',
      '../v1/organizations/x',
      'abcdefghijklmnopqrs1',
      '',
    ];
    for (const ref of refs) {
      await expect(api.describe(ref)).rejects.toMatchObject({ kind: 'invalid', status: 0 });
      await expect(api.listApiKeys(ref)).rejects.toMatchObject({ kind: 'invalid' });
      await expect(api.setDatabasePassword(ref, 'a-long-enough-password')).rejects.toMatchObject({
        kind: 'invalid',
      });
    }
    expect(stub.requests).toHaveLength(0);
  });

  it('refuses a project of another organisation as forbidden', async () => {
    const stub = await startStub((r) =>
      r.path === P
        ? { status: 200, body: projectBody({ organization_slug: 'someone-else' }) }
        : readRoutes(r),
    );
    const api = provider(stub.baseUrl);
    const failure = await api.describe(REF).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ProjectProviderError);
    expect(failure).toMatchObject({ kind: 'forbidden', status: 403, code: 'org_mismatch' });
    // The pin also covers the reads of secrets: no key is requested for a foreign project.
    await expect(api.listApiKeys(REF)).rejects.toMatchObject({ kind: 'forbidden' });
    expect(stub.requests.some((r) => r.path.endsWith('/api-keys'))).toBe(false);
  });

  it('follows no redirect: a 3xx is an error and the Location is never requested', async () => {
    const stub = await startStub((r) => {
      if (r.path === P) {
        return { status: 302, headers: { Location: '/v1/organizations/steal' }, body: {} };
      }
      return undefined;
    });
    const api = provider(stub.baseUrl);
    await expect(api.describe(REF)).rejects.toMatchObject({ kind: 'unavailable', status: 0 });
    expect(stub.requests.map((r) => r.path)).toEqual([P]);
  });

  it('every failure message is "<kind> <status>" and carries no body, token or key', async () => {
    const cases: Array<[number, string]> = [
      [401, 'forbidden'],
      [403, 'forbidden'],
      [404, 'not_found'],
      [409, 'conflict'],
      [400, 'invalid'],
      [422, 'invalid'],
      [500, 'unavailable'],
      [503, 'unavailable'],
    ];
    for (const [status, kind] of cases) {
      const stub = await startStub(() => ({
        status,
        body: { message: `leak ${PAT} sb_secret_LEAK select * from users`, host: 'db.internal' },
      }));
      const failure = (await provider(stub.baseUrl)
        .describe(REF)
        .catch((e: unknown) => e)) as ProjectProviderError;
      expect(failure).toBeInstanceOf(ProjectProviderError);
      expect(failure.kind).toBe(kind);
      expect(failure.status).toBe(status);
      expect(failure.message).toBe(`${kind} ${status}`);
      expect(failure.message).not.toMatch(/sbp_|sb_secret|select|internal|leak/);
    }
  });

  it('a 2xx with a body that does not match the schema is unavailable, not a crash', async () => {
    const stub = await startStub((r) =>
      r.path === P ? { status: 200, raw: '<html>not json</html>' } : undefined,
    );
    await expect(provider(stub.baseUrl).describe(REF)).rejects.toMatchObject({
      kind: 'unavailable',
      status: 200,
    });
    const stub2 = await startStub((r) =>
      r.path === P ? { status: 200, body: { name: 'x' } } : undefined,
    );
    await expect(provider(stub2.baseUrl).describe(REF)).rejects.toMatchObject({
      kind: 'unavailable',
      status: 200,
    });
  });

  it('a connection that cannot be made is unavailable with status 0', async () => {
    const stub = await startStub(readRoutes);
    const dead = stub.baseUrl;
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    const failure = await provider(dead)
      .describe(REF)
      .catch((e: unknown) => e);
    expect(failure).toMatchObject({ kind: 'unavailable', status: 0, message: 'unavailable 0' });
  });

  it('refuses a cleartext base URL unless it is loopback, and requires its credentials', () => {
    expect(() =>
      createSupabaseProjectProvider({ pat: PAT, orgSlug: ORG, baseUrl: 'http://api.supabase.com' }),
    ).toThrow(TypeError);
    expect(() =>
      createSupabaseProjectProvider({ pat: PAT, orgSlug: ORG, baseUrl: 'not a url' }),
    ).toThrow(TypeError);
    expect(() =>
      createSupabaseProjectProvider({
        pat: PAT,
        orgSlug: ORG,
        baseUrl: 'https://api.supabase.com',
      }),
    ).not.toThrow();
    expect(() => createSupabaseProjectProvider({ pat: '', orgSlug: ORG })).toThrow(TypeError);
    expect(() => createSupabaseProjectProvider({ pat: PAT, orgSlug: '' })).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------------------------------
// 09.2-12 Task 2: the write surface, the rate-limit and polling guarantees, key picking, reasons.
// ---------------------------------------------------------------------------------------------------

/** A manual clock: `sleep` records the request and advances the clock by exactly that much. */
function makeClock(start = 0) {
  let t = start;
  const sleeps: number[] = [];
  return {
    now: () => t,
    set: (value: number) => {
      t = value;
    },
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
  };
}

/** A fetch that stamps the clock at the instant a request is admitted (before any real I/O delay). */
function stampedFetch(clock: { now(): number }, stamps: number[]): typeof fetch {
  return (input, init) => {
    stamps.push(clock.now());
    return fetch(input, init);
  };
}

async function until(condition: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('until: condition not reached');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('Limiter and 429 handling (DBT-20, P38, P42, P43)', () => {
  it('P38: admits 100 calls in a rolling minute and queues the 101st until the window slides', async () => {
    const clock = makeClock();
    const limiter = createLimiter({ perMinute: 100, now: clock.now, sleep: clock.sleep });
    const times: number[] = [];
    await Promise.all(
      Array.from({ length: 101 }, () =>
        limiter.run(async () => {
          times.push(clock.now());
        }),
      ),
    );
    expect(times.slice(0, 100).every((t) => t === 0)).toBe(true);
    expect(times[100]).toBe(60_000);
    expect(clock.sleeps).toEqual([60_000]);
  });

  it('P38: the 101st is still blocked at 59.999 s and runs at 60.000 s', async () => {
    let t = 0;
    const sleeps: number[] = [];
    // The first sleep wakes one millisecond early: the limiter must re-check, not admit.
    const sleep = async (ms: number) => {
      sleeps.push(ms);
      t += sleeps.length === 1 ? ms - 1 : ms;
    };
    const limiter = createLimiter({ perMinute: 100, now: () => t, sleep });
    const times: number[] = [];
    await Promise.all(
      Array.from({ length: 101 }, () =>
        limiter.run(async () => {
          times.push(t);
        }),
      ),
    );
    expect(sleeps).toEqual([60_000, 1]);
    expect(times[100]).toBe(60_000);
  });

  it('P38: a 429 is retried at exactly the reset time and not earlier, then succeeds', async () => {
    const clock = makeClock();
    const stamps: number[] = [];
    let seen = 0;
    const stub = await startStub((r) => {
      if (r.path !== P) return undefined;
      seen += 1;
      return seen === 1
        ? { status: 429, headers: { 'X-RateLimit-Reset': '3' }, body: { message: PAT } }
        : { status: 200, body: projectBody() };
    });
    const api = provider(stub.baseUrl, {
      limiter: undefined,
      now: clock.now,
      sleep: clock.sleep,
      fetchImpl: stampedFetch(clock, stamps),
      jitter: () => 40,
    });
    expect((await api.describe(REF)).status).toBe('ACTIVE_HEALTHY');
    expect(stamps).toEqual([0, 3_040]);
    expect(clock.sleeps).toEqual([3_040]);
  });

  it('DBT-20: gives up after 5 attempts with rate_limited 429 and a message without the body', async () => {
    const clock = makeClock();
    const stub = await startStub((r) =>
      r.path === P
        ? {
            status: 429,
            headers: { 'X-RateLimit-Reset': '2' },
            body: { message: `slow down ${PAT}` },
          }
        : undefined,
    );
    const api = provider(stub.baseUrl, {
      limiter: undefined,
      now: clock.now,
      sleep: clock.sleep,
    });
    const failure = (await api.describe(REF).catch((e: unknown) => e)) as ProjectProviderError;
    expect(failure).toMatchObject({
      kind: 'rate_limited',
      status: 429,
      message: 'rate_limited 429',
    });
    expect(stub.requests).toHaveLength(5);
    expect(clock.sleeps).toEqual([2_000, 2_000, 2_000, 2_000]);
  });

  it('P42: X-RateLimit-Reset is rounded UP to whole seconds; fractional, zero, negative, missing and junk fall back to one second', () => {
    expect(resetDelayMs('1.2')).toBe(2_000);
    expect(resetDelayMs('0.2')).toBe(1_000);
    expect(resetDelayMs('2')).toBe(2_000);
    expect(resetDelayMs('0')).toBe(1_000);
    expect(resetDelayMs('-3')).toBe(1_000);
    expect(resetDelayMs(null)).toBe(1_000);
    expect(resetDelayMs('')).toBe(1_000);
    expect(resetDelayMs('abc')).toBe(1_000);
    expect(resetDelayMs('Infinity')).toBe(1_000);
  });

  it('P42: the jitter is added after the rounding, so the retry through the client is never early', async () => {
    const clock = makeClock();
    const stamps: number[] = [];
    let seen = 0;
    const stub = await startStub((r) => {
      if (r.path !== P) return undefined;
      seen += 1;
      return seen === 1
        ? { status: 429, headers: { 'X-RateLimit-Reset': '1.2' }, body: {} }
        : { status: 200, body: projectBody() };
    });
    const api = provider(stub.baseUrl, {
      limiter: undefined,
      now: clock.now,
      sleep: clock.sleep,
      fetchImpl: stampedFetch(clock, stamps),
      jitter: () => 17,
    });
    await api.describe(REF);
    expect((stamps[1] ?? 0) - (stamps[0] ?? 0)).toBe(2_017);
  });

  it('P43: 250 concurrent calls from two bootstraps sharing ONE limiter never exceed 100 in any minute', async () => {
    const clock = makeClock();
    const stamps: number[] = [];
    const stub = await startStub((r) =>
      r.path === P ? { status: 200, body: projectBody() } : undefined,
    );
    const limiter = createLimiter({ perMinute: 100, now: clock.now, sleep: clock.sleep });
    const fetchImpl = stampedFetch(clock, stamps);
    const one = provider(stub.baseUrl, { limiter, fetchImpl });
    const two = provider(stub.baseUrl, { limiter, fetchImpl });
    await Promise.all(
      Array.from({ length: 250 }, (_, i) => (i % 2 === 0 ? one : two).describe(REF)),
    );
    expect(stamps).toHaveLength(250);
    for (const start of stamps) {
      const inWindow = stamps.filter((s) => s >= start && s < start + 60_000).length;
      expect(inWindow).toBeLessThanOrEqual(100);
    }
  });

  it('P43: a 429 seen by one call holds back the others for the same window', async () => {
    const clock = makeClock();
    const pending: Array<{ ms: number; resolve: () => void }> = [];
    const sleep = (ms: number) => new Promise<void>((resolve) => pending.push({ ms, resolve }));
    const limiter = createLimiter({ now: clock.now, sleep });
    const arrivals: number[] = [];
    let seen = 0;
    const stub = await startStub((r) => {
      if (r.path !== P) return undefined;
      seen += 1;
      return seen === 1
        ? { status: 429, headers: { 'X-RateLimit-Reset': '5' }, body: {} }
        : { status: 200, body: projectBody() };
    });
    const fetchImpl = stampedFetch(clock, arrivals);
    const first = provider(stub.baseUrl, { limiter, fetchImpl }).describe(REF);
    await until(() => pending.length === 1);
    expect(pending[0]?.ms).toBe(5_000);

    // A second bootstrap starts while the window is closed: its request must not leave.
    const second = provider(stub.baseUrl, { limiter, fetchImpl }).describe(REF);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(stub.requests).toHaveLength(1);

    clock.set(5_000);
    pending[0]?.resolve();
    await Promise.all([first, second]);
    expect(stub.requests).toHaveLength(3);
    expect(arrivals).toEqual([0, 5_000, 5_000]);
  });
});

describe('waitUntilHealthy (DBT-20, P38, P39)', () => {
  const allHealthy = () => ({
    services: Object.fromEntries(
      ['auth', 'db', 'db_postgres_user', 'pooler', 'realtime', 'rest', 'storage'].map((n) => [
        n,
        'ACTIVE_HEALTHY' as const,
      ]),
    ),
  });

  function deps(status: () => string, health = allHealthy) {
    const clock = makeClock();
    return {
      clock,
      deps: {
        describe: async (ref: string) => ({
          ref,
          name: ref,
          status: status() as never,
          orgSlug: ORG,
        }),
        health: async () => health(),
        now: clock.now,
        sleep: clock.sleep,
      },
    };
  }

  it('P38: waits with growing delays (2 s, 4 s, 8 s, ... capped at 30 s) and throws not_ready exactly at 10 minutes', async () => {
    const { clock, deps: d } = deps(() => 'COMING_UP');
    const failure = await waitUntilHealthy(d, REF).catch((e: unknown) => e);
    expect(failure).toMatchObject({ kind: 'not_ready', message: 'not_ready 0' });
    expect(clock.sleeps.slice(0, 6)).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    expect(clock.now()).toBe(600_000);
  });

  it('P38: still waits at 599.999 s (a healthy answer there succeeds) and throws at 600.000 s', async () => {
    for (const [jumpTo, outcome] of [
      [599_999, 'resolves'],
      [600_000, 'not_ready'],
    ] as const) {
      const clock = makeClock();
      let healthy = false;
      const d = {
        describe: async (ref: string) => ({
          ref,
          name: ref,
          status: (healthy ? 'ACTIVE_HEALTHY' : 'COMING_UP') as never,
          orgSlug: ORG,
        }),
        health: async () => allHealthy(),
        now: clock.now,
        // The injected sleep jumps straight to the boundary under test and flips the project healthy.
        sleep: async () => {
          clock.set(jumpTo);
          healthy = true;
        },
      };
      const result = await waitUntilHealthy(d, REF).then(
        () => 'resolves',
        (e: ProjectProviderError) => e.kind,
      );
      expect(result).toBe(outcome);
    }
  });

  it('P39: ACTIVE_HEALTHY proceeds; transient statuses wait; paused-class fail as invalid; dead statuses as unavailable', async () => {
    expect(classifyStatus('ACTIVE_HEALTHY')).toBe('ready');
    for (const s of ['COMING_UP', 'UPGRADING', 'RESTARTING', 'ACTIVE_UNHEALTHY']) {
      expect(classifyStatus(s)).toBe('wait');
    }
    for (const s of ['INACTIVE', 'PAUSING', 'PAUSE_FAILED', 'GOING_DOWN']) {
      expect(classifyStatus(s)).toBe('paused');
    }
    for (const s of ['INIT_FAILED', 'REMOVED', 'RESTORE_FAILED', 'UNKNOWN', 'SOMETHING_NEW']) {
      expect(classifyStatus(s)).toBe('unavailable');
    }

    const { deps: ready } = deps(() => 'ACTIVE_HEALTHY');
    await expect(waitUntilHealthy(ready, REF)).resolves.toBeUndefined();
    for (const s of ['COMING_UP', 'UPGRADING', 'RESTARTING', 'ACTIVE_UNHEALTHY']) {
      const { deps: waiting } = deps(() => s);
      await expect(waitUntilHealthy(waiting, REF, { maxMs: 5_000 })).rejects.toMatchObject({
        kind: 'not_ready',
      });
    }
    for (const s of ['INACTIVE', 'PAUSING', 'PAUSE_FAILED', 'GOING_DOWN']) {
      const { deps: paused } = deps(() => s);
      await expect(waitUntilHealthy(paused, REF)).rejects.toMatchObject({ kind: 'invalid' });
    }
    for (const s of ['INIT_FAILED', 'REMOVED', 'RESTORE_FAILED', 'UNKNOWN']) {
      const { deps: dead } = deps(() => s);
      await expect(waitUntilHealthy(dead, REF)).rejects.toMatchObject({ kind: 'unavailable' });
    }
  });

  it('P39: a project whose db is healthy while auth is still COMING_UP is NOT healthy', async () => {
    const partial = () => {
      const h = allHealthy();
      return { services: { ...h.services, auth: 'COMING_UP' as const } };
    };
    expect(allServicesHealthy(partial())).toBe(false);
    expect(allServicesHealthy({ services: { db: 'ACTIVE_HEALTHY' } })).toBe(false);
    const { deps: d } = deps(() => 'ACTIVE_HEALTHY', partial);
    await expect(waitUntilHealthy(d, REF, { maxMs: 10_000 })).rejects.toMatchObject({
      kind: 'not_ready',
    });
  });

  it('through the real client: COMING_UP twice, then healthy, resolves after sleeps of 2 s and 4 s', async () => {
    const clock = makeClock();
    let describes = 0;
    const stub = await startStub((r) => {
      if (r.path === P) {
        describes += 1;
        return {
          status: 200,
          body: projectBody({ status: describes <= 2 ? 'COMING_UP' : 'ACTIVE_HEALTHY' }),
        };
      }
      if (r.path === `${P}/health`) return { status: 200, body: healthyBody() };
      return undefined;
    });
    const api = provider(stub.baseUrl, { limiter: undefined, now: clock.now, sleep: clock.sleep });
    await api.waitUntilHealthy(REF);
    expect(clock.sleeps).toEqual([2_000, 4_000]);
  });
});

describe('The write surface (D-541)', () => {
  it('P40: an empty key list creates a publishable and a secret key (two POSTs); an existing pair creates nothing', async () => {
    let created = 0;
    const stub = await startStub((r) => {
      if (r.path === P) return { status: 200, body: projectBody() };
      if (r.path === `${P}/api-keys` && r.method === 'GET') {
        return {
          status: 200,
          body:
            created === 0
              ? []
              : [
                  {
                    type: 'publishable',
                    id: 'p-new',
                    name: 'platform_publishable',
                    api_key: 'sb_publishable_NEW',
                    inserted_at: '2026-10-22T00:00:00Z',
                  },
                ],
        };
      }
      if (r.path === `${P}/api-keys` && r.method === 'POST') {
        created += 1;
        const type = (r.body as { type: string }).type;
        // The secret answer omits the value: the client must read it back from the list.
        return type === 'publishable'
          ? {
              status: 201,
              body: {
                type,
                id: 'p-new',
                name: 'platform_publishable',
                api_key: 'sb_publishable_NEW',
                inserted_at: '2026-10-22T00:00:00Z',
              },
            }
          : {
              status: 201,
              body: {
                type,
                id: 's-new',
                name: 'platform_secret',
                inserted_at: '2026-10-22T00:00:01Z',
              },
            };
      }
      return undefined;
    });
    const keys = await provider(stub.baseUrl).ensureKeys(REF);
    const posts = stub.requests.filter((r) => r.method === 'POST');
    expect(posts.map((r) => r.body)).toEqual([
      { type: 'publishable', name: 'platform_publishable' },
      { type: 'secret', name: 'platform_secret' },
    ]);
    expect(keys.publishable).toMatchObject({
      kind: 'publishable',
      id: 'p-new',
      value: 'sb_publishable_NEW',
    });
    expect(keys.service).toMatchObject({ kind: 'secret', id: 's-new' });

    const existing = await startStub(readRoutes);
    const pair = await provider(existing.baseUrl).ensureKeys(REF);
    expect(existing.requests.filter((r) => r.method === 'POST')).toHaveLength(0);
    expect(pair.publishable.id).toBe('k-pub');
    expect(pair.service.id).toBe('k-sec');
  });

  it('P40: an empty pooler answer is unavailable; empty buckets and migrations are valid; an empty 204 PATCH is success', async () => {
    const stub = await startStub((r) => {
      if (r.path === P) return { status: 200, body: projectBody() };
      if (r.path === `${P}/config/database/pooler`) return { status: 200, body: [] };
      if (r.path === `${P}/storage/buckets` || r.path === `${P}/database/migrations`)
        return { status: 200, body: [] };
      if (r.method === 'PATCH') return { status: 204 };
      return undefined;
    });
    const api = provider(stub.baseUrl);
    await expect(api.poolerConfig(REF)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(await api.listBuckets(REF)).toEqual([]);
    expect(await api.listMigrations(REF)).toEqual([]);
    await expect(
      api.patchAuthConfig(REF, { site_url: 'https://x.example' }),
    ).resolves.toBeUndefined();
    await expect(api.patchRealtime(REF, { private_only: true })).resolves.toBeUndefined();
  });

  it('P41: the newest non-disabled key wins by inserted_at then id, whatever order the API lists them', () => {
    const k = (id: string, insertedAt: string, disabled = false): ApiKey => ({
      id,
      kind: 'secret',
      name: id,
      value: `v-${id}`,
      insertedAt,
      disabled,
    });
    const keys = [
      k('a', '2026-01-01T00:00:00Z'),
      k('b', '2026-03-01T00:00:00Z'),
      k('c', '2026-03-01T00:00:00Z'),
      k('d', '2026-09-01T00:00:00Z', true),
    ];
    const orders = [keys, [...keys].reverse(), [2, 0, 3, 1].map((i) => keys[i] as ApiKey)];
    const picked = orders.map((order) => pickKey(order, ['secret'])?.id);
    expect(new Set(picked)).toEqual(new Set(['c']));
    expect(pickKey(keys, ['publishable'])).toBeUndefined();
    // The new-style kind is tried before the legacy one.
    const legacy: ApiKey = {
      id: 'l',
      kind: 'legacy_service_role',
      name: 'service_role',
      insertedAt: '2030-01-01T00:00:00Z',
      disabled: false,
    };
    expect(pickKey([legacy, ...keys], ['secret', 'legacy_service_role'])?.id).toBe('c');
    expect(pickKey([legacy], ['secret', 'legacy_service_role'])?.id).toBe('l');
  });

  it('writes the database password and the configurations verbatim; a short password or an empty body makes no request', async () => {
    const stub = await startStub((r) => {
      if (r.path === P) return { status: 200, body: projectBody() };
      if (r.method === 'PATCH') return { status: 200, body: { message: 'ok' } };
      return undefined;
    });
    const api = provider(stub.baseUrl);
    await expect(api.setDatabasePassword(REF, 'short')).rejects.toMatchObject({
      kind: 'invalid',
      message: 'invalid 0',
    });
    await expect(api.patchAuthConfig(REF, {})).rejects.toMatchObject({ kind: 'invalid' });
    await expect(api.patchStorage(REF, [] as never)).rejects.toMatchObject({ kind: 'invalid' });
    expect(stub.requests).toHaveLength(0);

    await api.setDatabasePassword(REF, 'a-generated-32-byte-password-value');
    const auth = {
      site_url: 'https://c.example',
      hook_send_email_enabled: false,
      smtp_pass: 'p@ss',
    };
    await api.patchAuthConfig(REF, auth);
    await api.patchPostgrest(REF, {
      db_schema: 'data_api_closed',
      db_extra_search_path: 'extensions',
    });
    await api.patchStorage(REF, { fileSizeLimit: 52_428_800 });
    await api.patchRealtime(REF, { private_only: true });
    const patches = stub.requests.filter((r) => r.method === 'PATCH').map((r) => [r.path, r.body]);
    expect(patches).toEqual([
      [`${P}/database/password`, { password: 'a-generated-32-byte-password-value' }],
      [`${P}/config/auth`, auth],
      [`${P}/postgrest`, { db_schema: 'data_api_closed', db_extra_search_path: 'extensions' }],
      [`${P}/config/storage`, { fileSizeLimit: 52_428_800 }],
      [`${P}/config/realtime`, { private_only: true }],
    ]);
  });

  it('reads the configurations; the PostgREST answer never hands back the project JWT secret', async () => {
    const stub = await startStub((r) => {
      if (r.path === P) return { status: 200, body: projectBody() };
      if (r.path === `${P}/postgrest`)
        return {
          status: 200,
          body: { db_schema: 'public', max_rows: 1000, jwt_secret: 'JWT-SECRET-VALUE' },
        };
      if (r.path === `${P}/config/auth`)
        return { status: 200, body: { site_url: 'https://c.example' } };
      if (r.path === `${P}/config/storage`) return { status: 200, body: { fileSizeLimit: 1 } };
      if (r.path === `${P}/config/realtime`) return { status: 200, body: { private_only: false } };
      return undefined;
    });
    const api = provider(stub.baseUrl);
    const postgrest = await api.getPostgrestConfig(REF);
    expect(postgrest).toEqual({ db_schema: 'public', max_rows: 1000 });
    expect(JSON.stringify(postgrest)).not.toContain('JWT-SECRET');
    expect(await api.getAuthConfig(REF)).toEqual({ site_url: 'https://c.example' });
    expect(await api.getStorageConfig(REF)).toEqual({ fileSizeLimit: 1 });
    expect(await api.getRealtimeConfig(REF)).toEqual({ private_only: false });
  });

  it('signing keys: lists both answer shapes, creates ES256 as standby, moves a key to in_use, refuses an unknown algorithm', async () => {
    const list = [
      {
        id: 'sk1',
        algorithm: 'ES256',
        status: 'in_use',
        public_jwk: {},
        created_at: 'x',
        updated_at: 'y',
      },
    ];
    for (const shape of [list, { keys: list }]) {
      const stub = await startStub((r) => {
        if (r.path === P) return { status: 200, body: projectBody() };
        if (r.path === `${P}/config/auth/signing-keys` && r.method === 'GET')
          return { status: 200, body: shape };
        return undefined;
      });
      expect(await provider(stub.baseUrl).signingKeys(REF)).toEqual([
        { id: 'sk1', algorithm: 'ES256', status: 'in_use' },
      ]);
    }
    const stub = await startStub((r) => {
      if (r.path === P) return { status: 200, body: projectBody() };
      if (r.path === `${P}/config/auth/signing-keys` && r.method === 'POST')
        return {
          status: 201,
          body: { id: 'sk2', algorithm: 'ES256', status: 'standby', public_jwk: {} },
        };
      if (r.path === `${P}/config/auth/signing-keys/sk2` && r.method === 'PATCH')
        return { status: 200, body: { id: 'sk2', algorithm: 'ES256', status: 'in_use' } };
      return undefined;
    });
    const api = provider(stub.baseUrl);
    expect(await api.createSigningKey(REF)).toEqual({
      id: 'sk2',
      algorithm: 'ES256',
      status: 'standby',
    });
    await api.patchSigningKey(REF, 'sk2', 'in_use');
    await expect(api.createSigningKey(REF, 'none')).rejects.toMatchObject({ kind: 'invalid' });
    await expect(api.patchSigningKey(REF, '../x', 'in_use')).rejects.toMatchObject({
      kind: 'invalid',
    });
    const sent = stub.requests
      .filter((r) => r.method !== 'GET')
      .map((r) => [r.method, r.path, r.body]);
    expect(sent).toEqual([
      ['POST', `${P}/config/auth/signing-keys`, { algorithm: 'ES256', status: 'standby' }],
      ['PATCH', `${P}/config/auth/signing-keys/sk2`, { status: 'in_use' }],
    ]);
  });

  it('readOnlyQuery returns the rows, or null on any non-2xx or unexpected answer', async () => {
    const answers: Array<[number, unknown, unknown[] | null]> = [
      [201, [{ n: 1 }], [{ n: 1 }]],
      [201, { not: 'an array' }, null],
      [500, { message: 'boom' }, null],
      [403, {}, null],
      [201, undefined, null],
    ];
    for (const [status, body, expected] of answers) {
      const stub = await startStub((r) => {
        if (r.path === P) return { status: 200, body: projectBody() };
        if (r.path === `${P}/database/query/read-only`) return { status, body };
        return undefined;
      });
      expect(await provider(stub.baseUrl).readOnlyQuery(REF, 'select 1')).toEqual(expected);
    }
  });
});

describe('The adapter reaches only the INTEGRATE list of COVERAGE.md (PR-9, T-09.2-56)', () => {
  const coverage = readFileSync(
    new URL(
      '../../../.planning/phases/09.2-banco-por-tenant-projeto-supabase-dedicado-por-tenant/COVERAGE.md',
      import.meta.url,
    ),
    'utf8',
  );
  const integrate = coverage
    .slice(coverage.indexOf('## INTEGRATE'), coverage.indexOf('## OPT-OUT groups'))
    .split('\n')
    .map((line) => /^\| (GET|POST|PATCH|PUT|DELETE) (\/v1\/\S+) \| INTEGRATE \|/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ method: m[1] as string, path: m[2] as string }));
  const source = readFileSync(
    new URL('../server/projects/management-api.ts', import.meta.url),
    'utf8',
  );

  it('COVERAGE.md lists 20 INTEGRATE operations', () => {
    expect(integrate).toHaveLength(20);
  });

  it('every call(...) literal and every /v1 path in the adapter is an INTEGRATE row, and every row is used', () => {
    const allowed = new Set(integrate.map((o) => `${o.method} ${o.path}`));
    const allowedPaths = new Set(integrate.map((o) => o.path));
    const calls = [...source.matchAll(/call(?:<[^>]*>)?\(\s*'([A-Z]+)',\s*'([^']+)'/g)].map(
      (m) => `${m[1]} ${m[2]}`,
    );
    expect(calls.length).toBe(12);
    for (const literal of calls) expect(allowed).toContain(literal);

    const paths = new Set([...source.matchAll(/'(\/v1\/[^']+)'/g)].map((m) => m[1] as string));
    for (const path of paths) expect(allowedPaths).toContain(path);
    for (const path of allowedPaths) expect(paths).toContain(path);

    // The four configuration paths are read and written through two shared helpers: both verbs are rows.
    for (const path of [
      '/v1/projects/{ref}/config/auth',
      '/v1/projects/{ref}/postgrest',
      '/v1/projects/{ref}/config/storage',
      '/v1/projects/{ref}/config/realtime',
    ]) {
      expect(allowed).toContain(`GET ${path}`);
      expect(allowed).toContain(`PATCH ${path}`);
    }
    // Every other row appears as a literal call.
    const viaHelpers = new Set([
      '/v1/projects/{ref}/config/auth',
      '/v1/projects/{ref}/postgrest',
      '/v1/projects/{ref}/config/storage',
      '/v1/projects/{ref}/config/realtime',
    ]);
    for (const op of integrate.filter((o) => !viaHelpers.has(o.path))) {
      expect(calls).toContain(`${op.method} ${op.path}`);
    }
  });

  it('has no DELETE, PUT, project lifecycle, billing, branch or restore path, and no lifecycle method', () => {
    expect(source).not.toMatch(/'DELETE'|'PUT'/);
    expect(source).not.toMatch(
      /\/pause|\/restore|\/billing|\/branches|\/restart|\/upgrade|\/read-replicas/,
    );
    expect(source).not.toMatch(/\b(create|delete|pause|restore|resize)Project\b/);
    const typesSource = readFileSync(
      new URL('../server/projects/types.ts', import.meta.url),
      'utf8',
    );
    expect(typesSource).not.toMatch(/\b(create|delete|pause|restore|resize)Project\b/);
  });
});

describe('Reason catalog (DBT-20, UI A-UI-10)', () => {
  const kinds: ProjectProviderErrorKind[] = [
    'not_found',
    'forbidden',
    'rate_limited',
    'unavailable',
    'invalid',
    'timeout',
    'conflict',
    'not_ready',
  ];

  it('the catalog is the ten closed codes', () => {
    expect([...BOOTSTRAP_REASONS]).toEqual([
      'unreachable',
      'access_denied',
      'not_empty',
      'migration_failed',
      'auth_config_failed',
      'storage_failed',
      'realtime_failed',
      'tenant_failed',
      'invite_failed',
      'unknown',
    ]);
  });

  it('every provider error kind at every step maps to exactly one code of the catalog', () => {
    for (const step of BOOTSTRAP_STEPS) {
      for (const kind of kinds) {
        expect(BOOTSTRAP_REASONS).toContain(reasonOf(new ProjectProviderError(kind, 500), step));
      }
      expect(BOOTSTRAP_REASONS).toContain(reasonOf(new Error('anything'), step));
    }
    expect(Object.keys(STEP_REASON).sort()).toEqual([...BOOTSTRAP_STEPS].sort());
  });

  it('forbidden is access_denied; timeout, unavailable and not_ready are unreachable; others are the step code', () => {
    for (const step of BOOTSTRAP_STEPS) {
      expect(reasonOf(new ProjectProviderError('forbidden', 403), step)).toBe('access_denied');
      for (const kind of ['timeout', 'unavailable', 'not_ready'] as const) {
        expect(reasonOf(new ProjectProviderError(kind, 0), step)).toBe('unreachable');
      }
    }
    expect(reasonOf(new ProjectProviderError('conflict', 409), 'auth')).toBe('auth_config_failed');
    expect(reasonOf(new ProjectProviderError('invalid', 422), 'buckets')).toBe('storage_failed');
    expect(reasonOf(new Error('relation x does not exist'), 'schema')).toBe('migration_failed');
    expect(reasonOf(new Error('x'), 'realtime')).toBe('realtime_failed');
    expect(reasonOf(new Error('x'), 'tenant')).toBe('tenant_failed');
    expect(reasonOf(new Error('x'), 'invite')).toBe('invite_failed');
    expect(reasonOf(new Error('x'), 'verify')).toBe('unreachable');
    expect(reasonOf(new Error('x'), 'roles')).toBe('unreachable');
  });

  it('an unknown step, a string or a missing error is unknown; the message is never forwarded', () => {
    expect(reasonOf(new Error('x'), 'nope')).toBe('unknown');
    expect(reasonOf('boom', '__proto__')).toBe('unknown');
    expect(reasonOf(undefined, 'constructor')).toBe('unknown');
    expect(reasonOf(new Error('secret sb_secret_X'), 'auth')).not.toContain('secret');
  });
});

describe('customer token provider (09.4-05, D-571, D-573, CTK-12, CTK-15, CTK-23)', () => {
  const CUSTOMER_PAT = 'sbp_CUSTOMER-scoped-token-0002';
  const REF2 = 'tsrqponmlkjihgfedcba';
  const customer = (
    baseUrl: string,
    extra: Partial<Parameters<typeof createSupabaseProjectProvider>[0]> = {},
  ) =>
    createSupabaseProjectProvider({
      pat: CUSTOMER_PAT,
      tokenKind: 'customer',
      baseUrl,
      limiter: createLimiter({ perMinute: 10_000 }),
      jitter: () => 0,
      ...extra,
    });

  it('learns the organisation from the first describe, pins it, and refuses another one', async () => {
    const stub = await startStub((r) => {
      if (r.path === P) return { status: 200, body: projectBody() };
      if (r.path === `/v1/projects/${REF2}`) {
        return {
          status: 200,
          body: projectBody({ ref: REF2, id: REF2, organization_slug: 'other-org' }),
        };
      }
      return undefined;
    });
    const api = customer(stub.baseUrl);

    expect(await api.describe(REF)).toMatchObject({ ref: REF, orgSlug: ORG });
    const failure = await api.describe(REF2).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ProjectProviderError);
    expect(failure).toMatchObject({
      kind: 'forbidden',
      status: 403,
      code: 'org_mismatch',
      customerToken: true,
    });
    expect((failure as Error).message).toBe('forbidden 403');
  });

  it('refuses the first describe of a project that reports another organisation than the given pin', async () => {
    const stub = await startStub(readRoutes);
    const api = customer(stub.baseUrl, { orgSlug: 'pinned-elsewhere' });
    await expect(api.describe(REF)).rejects.toMatchObject({
      kind: 'forbidden',
      status: 403,
      code: 'org_mismatch',
      customerToken: true,
    });
    await expect(api.listApiKeys(REF)).rejects.toMatchObject({ code: 'org_mismatch' });
    expect(stub.requests.some((r) => r.path.endsWith('/api-keys'))).toBe(false);
  });

  it('refines 401 and 403 into token codes on a customer provider only, keeping kind and message', async () => {
    for (const [status, code] of [
      [401, 'token_invalid'],
      [403, 'token_forbidden'],
    ] as const) {
      const stub = await startStub(() => ({ status, body: { message: `leak ${CUSTOMER_PAT}` } }));
      const failure = (await customer(stub.baseUrl)
        .describe(REF)
        .catch((e: unknown) => e)) as ProjectProviderError;
      expect(failure).toMatchObject({ kind: 'forbidden', status, code, customerToken: true });
      expect(failure.message).toBe(`forbidden ${status}`);
      expect(JSON.stringify({ ...failure, message: failure.message })).not.toContain('sbp_');

      const platformStub = await startStub(() => ({ status, body: {} }));
      const platformFailure = (await provider(platformStub.baseUrl)
        .describe(REF)
        .catch((e: unknown) => e)) as ProjectProviderError;
      expect(platformFailure).toMatchObject({
        kind: 'forbidden',
        status,
        code: undefined,
        customerToken: false,
      });
      expect(platformFailure.message).toBe(`forbidden ${status}`);
    }
  });

  it('marks every other non-2xx of a customer provider with customerToken but no code', async () => {
    for (const status of [404, 409, 500]) {
      const stub = await startStub(() => ({ status, body: {} }));
      const failure = (await customer(stub.baseUrl)
        .describe(REF)
        .catch((e: unknown) => e)) as ProjectProviderError;
      expect(failure.status).toBe(status);
      expect(failure.code).toBeUndefined();
      expect(failure.customerToken).toBe(true);
    }
  });

  it('still requires orgSlug of a platform provider, and a pat of a customer provider', () => {
    expect(() => createSupabaseProjectProvider({ pat: PAT, orgSlug: '' })).toThrow(
      new TypeError('project provider: orgSlug is required'),
    );
    expect(() =>
      createSupabaseProjectProvider({
        pat: PAT,
        tokenKind: 'platform',
        orgSlug: undefined as unknown as string,
      }),
    ).toThrow(new TypeError('project provider: orgSlug is required'));
    expect(() => createSupabaseProjectProvider({ pat: '', tokenKind: 'customer' })).toThrow(
      new TypeError('project provider: pat is required'),
    );
    expect(() =>
      createSupabaseProjectProvider({ pat: CUSTOMER_PAT, tokenKind: 'customer' }),
    ).not.toThrow();
  });

  it('owns its limiter: a 429 on one customer provider pauses only that provider', async () => {
    let clock = 0;
    const sleeps: number[] = [];
    let hits = 0;
    const stub = await startStub((r) => {
      if (r.path !== P) return undefined;
      hits += 1;
      return hits === 1
        ? { status: 429, headers: { 'X-RateLimit-Reset': '2' }, body: {} }
        : { status: 200, body: projectBody() };
    });
    let other: ReturnType<typeof customer> | undefined;
    let otherAnswer: unknown;
    const sleep = async (ms: number) => {
      sleeps.push(ms);
      // While the first provider is paused, the second one asks: it must not wait for the first one's window.
      if (sleeps.length === 1 && other) otherAnswer = await other.describe(REF);
      clock += ms;
    };
    const first = customer(stub.baseUrl, { limiter: undefined, now: () => clock, sleep });
    other = customer(stub.baseUrl, { limiter: undefined, now: () => clock, sleep });

    await first.describe(REF);
    expect(sleeps).toEqual([2000]);
    expect(otherAnswer).toMatchObject({ ref: REF });
  });
});
