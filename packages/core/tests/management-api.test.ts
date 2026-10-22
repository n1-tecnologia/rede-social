import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createLimiter } from '../server/projects/limiter';
import { createSupabaseProjectProvider } from '../server/projects/management-api';
import { ProjectProviderError } from '../server/projects/types';

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
