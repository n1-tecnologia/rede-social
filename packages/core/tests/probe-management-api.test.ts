import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createLimiter } from '../server/projects/limiter';
import { createSupabaseProjectProvider } from '../server/projects/management-api';

/**
 * 09.2-12 (DBT-20, T-09.2-60): the read-only probe of hosted proof H1/S2. It prints shapes and booleans
 * only. The script lives in the repo's `scripts/`, outside this package, so it is loaded by URL.
 */

type Probe = {
  runProbe: (
    argv: string[],
    deps?: {
      provider?: unknown;
      fetchImpl?: typeof fetch;
      env?: Record<string, string | undefined>;
      apiUrlFor?: (ref: string) => string;
      readSecret?: (label: string) => Promise<string>;
      baseUrl?: string;
    },
  ) => Promise<Record<string, unknown> & { recommendation: string }>;
  parseArgs: (argv: string[]) => {
    ref: string | null;
    fake: boolean;
    exerciseKeys: boolean;
    scoped: boolean;
  };
  hostShape: (host: string) => string;
};
const { runProbe, parseArgs, hostShape } = (await import(
  /* @vite-ignore */ new URL('../../../scripts/probe-management-api.ts', import.meta.url).href
)) as Probe;

const PAT = 'sbp_SECRET-platform-token-0001';
const ORG = 'acme-org';
const REF = 'abcdefghijklmnopqrst';
const SECRET_SHAPES = [
  'sb_secret_',
  'sb_publishable_',
  'eyJ',
  'postgres://',
  'postgresql://',
  'fake_publishable_',
  'fake_secret_',
  PAT,
  'SECRETVALUE',
  'sbp_',
  'Bearer',
];

const expectNoSecrets = (report: unknown) => {
  const text = JSON.stringify(report);
  for (const shape of SECRET_SHAPES) expect(text).not.toContain(shape);
};

describe('platform:probe --fake', () => {
  it('prints the shapes and booleans, a recommendation, and no secret-shaped string', async () => {
    const report = await runProbe(['--fake']);
    expect(Object.keys(report).sort()).toEqual(
      [
        'buckets',
        'health',
        'keys',
        'migrations',
        'mode',
        'pooler',
        'project',
        'readOnlyQuery',
        'recommendation',
        'signingKeys',
      ].sort(),
    );
    expect(report).toMatchObject({
      mode: 'fake',
      project: { status: 'ACTIVE_HEALTHY', organisationMatches: true },
      keys: { kinds: ['publishable', 'secret'], count: 2, secretReveal: 'revealed' },
      pooler: { hostShape: 'local', txPort: 54322, sessionPort: 54322, dbNameIsPostgres: true },
      migrations: { count: 0 },
      buckets: { count: 0 },
      signingKeys: { algorithms: [], inUse: false },
      readOnlyQuery: { answered: false },
      recommendation: 'automatic',
    });
    expectNoSecrets(report);
  });

  it('--exercise-keys issues only GET requests (auth admin list, storage list, realtime) with the key, and reports only pass or fail', async () => {
    const seen: Array<{ method: string; path: string; apikey: string | null }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      seen.push({
        method: init?.method ?? 'GET',
        path: `${url.pathname}${url.search}`,
        apikey: new Headers(init?.headers).get('apikey'),
      });
      return new Response('{}', { status: 200 });
    };
    const report = await runProbe(['--fake', '--exercise-keys'], { fetchImpl });
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      'GET /auth/v1/admin/users?per_page=1',
      'GET /storage/v1/bucket',
      'GET /realtime/v1/api/ping',
    ]);
    // The key reached the request (the test knows the fake's deterministic value) and nowhere in the output.
    expect(seen.every((s) => s.apikey === 'fake_secret_fake-probe')).toBe(true);
    expect(report.exerciseKeys).toEqual({
      secret: { auth: 'pass', storage: 'pass', realtime: 'pass' },
      legacy_service_role: 'absent',
      serviceKeyKind: 'secret',
    });
    expectNoSecrets(report);
  });

  it('--exercise-keys reports fail, never the response, when the key is rejected', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('{"message":"SECRETVALUE rejected"}', { status: 401 });
    const report = await runProbe(['--fake', '--exercise-keys'], { fetchImpl });
    expect(report.exerciseKeys).toMatchObject({
      secret: { auth: 'fail', storage: 'fail', realtime: 'fail' },
      serviceKeyKind: 'undecided',
    });
    expectNoSecrets(report);
  });
});

describe('platform:probe against the real adapter (stubbed transport)', () => {
  const realProvider = (handler: (path: string) => Response) =>
    createSupabaseProjectProvider({
      pat: PAT,
      orgSlug: ORG,
      limiter: createLimiter({ perMinute: 1000 }),
      fetchImpl: async (input) =>
        handler(
          new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
            .pathname,
        ),
    });
  const project = (slug: string) =>
    new Response(
      JSON.stringify({
        id: REF,
        ref: REF,
        name: 'T',
        status: 'ACTIVE_HEALTHY',
        organization_slug: slug,
      }),
      { status: 200 },
    );
  const P = `/v1/projects/${REF}`;

  it('a token that cannot reveal secrets (403 on the keys) recommends manualAccess and prints no body', async () => {
    const provider = realProvider((path) => {
      if (path === P) return project(ORG);
      if (path === `${P}/api-keys`)
        return new Response('{"message":"SECRETVALUE no scope"}', { status: 403 });
      if (path === `${P}/health`)
        return new Response('[{"name":"db","healthy":true,"status":"ACTIVE_HEALTHY"}]', {
          status: 200,
        });
      if (path === `${P}/config/database/pooler`) {
        return new Response(
          '[{"database_type":"PRIMARY","db_host":"aws-0-sa-east-1.pooler.supabase.com","db_name":"postgres"}]',
          { status: 200 },
        );
      }
      if (path.endsWith('/migrations') || path.endsWith('/buckets'))
        return new Response('[]', { status: 200 });
      if (path.endsWith('/signing-keys'))
        return new Response('{"keys":[{"id":"k","algorithm":"ES256","status":"in_use"}]}', {
          status: 200,
        });
      return new Response('{}', { status: 404 });
    });
    const report = await runProbe(['--ref', REF], { provider });
    expect(report).toMatchObject({
      mode: 'real',
      project: { status: 'ACTIVE_HEALTHY', organisationMatches: true },
      recommendation: 'manualAccess',
    });
    expect(report.keys).toEqual({ error: 'forbidden 403', secretReveal: 'forbidden' });
    expect(report.pooler).toEqual({
      hostShape: 'aws-<n>-<region>.pooler.supabase.com',
      txPort: 6543,
      sessionPort: 5432,
      dbNameIsPostgres: true,
    });
    expect(report.signingKeys).toEqual({ algorithms: ['ES256'], inUse: true });
    expectNoSecrets(report);
  });

  it('a project of another organisation reports organisationMatches false', async () => {
    const provider = realProvider((path) =>
      path === P ? project('someone-else') : new Response('{}', { status: 404 }),
    );
    const report = await runProbe(['--ref', REF], { provider });
    expect(report.project).toEqual({
      status: 'error',
      organisationMatches: false,
      error: 'forbidden 403',
    });
    expect(report.recommendation).toBe('manualAccess');
    expectNoSecrets(report);
  });
});

describe('platform:probe arguments', () => {
  it('needs exactly one of --ref or --fake, rejects unknown flags and a --ref without a value', () => {
    expect(parseArgs(['--fake'])).toEqual({
      ref: null,
      fake: true,
      exerciseKeys: false,
      scoped: false,
    });
    expect(parseArgs(['--ref', REF, '--exercise-keys'])).toEqual({
      ref: REF,
      fake: false,
      exerciseKeys: true,
      scoped: false,
    });
    expect(() => parseArgs([])).toThrow(/exactly one/);
    expect(() => parseArgs(['--fake', '--ref', REF])).toThrow(/exactly one/);
    expect(() => parseArgs(['--ref'])).toThrow(/--ref needs a value/);
    expect(() => parseArgs(['--ref', '--fake'])).toThrow(/--ref needs a value/);
    expect(() => parseArgs(['--wat'])).toThrow(/unknown argument/);
  });

  it('--ref without the token or the organisation in the environment fails naming only the variable', async () => {
    await expect(runProbe(['--ref', REF], { env: {} })).rejects.toThrow(
      'SUPABASE_PAT is required for --ref',
    );
    await expect(runProbe(['--ref', REF], { env: { SUPABASE_PAT: PAT } })).rejects.toThrow(
      'SUPABASE_ORG_SLUG is required for --ref',
    );
  });

  it('classifies a pooler host by shape and never echoes it', () => {
    expect(hostShape('aws-0-sa-east-1.pooler.supabase.com')).toBe(
      'aws-<n>-<region>.pooler.supabase.com',
    );
    expect(hostShape('aws-1-us-west-1.pooler.supabase.com')).toBe(
      'aws-<n>-<region>.pooler.supabase.com',
    );
    expect(hostShape('127.0.0.1')).toBe('local');
    expect(hostShape('db.internal.example')).toBe('other');
  });
});

/**
 * 09.4-01 (CTK-07, D-578, T-09.4-01..04): the scoped mode. The token comes only from the hidden prompt (here a
 * fake), the requests go to a loopback stub, and the report carries codes and statuses only.
 */
const FAKE_TOKEN = 'sbp_fc_FAKE-scoped-token-0002';
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

type StubRequest = { method: string; path: string; authorization: string | undefined };
type StubReply = { status: number; body?: unknown; headers?: Record<string, string> };

async function startStub(handler: (request: StubRequest & { rawBody: string }) => StubReply) {
  const requests: StubRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://stub.local');
      const recorded = {
        method: req.method ?? 'GET',
        path: url.pathname,
        authorization: req.headers.authorization,
      };
      requests.push(recorded);
      const reply = handler({ ...recorded, rawBody: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(reply.status, { 'Content-Type': 'application/json', ...reply.headers });
      res.end(reply.body === undefined ? '' : JSON.stringify(reply.body));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, requests };
}

describe('platform:probe --scoped (tracer: fake terminal, fake token, loopback stub)', () => {
  it('takes the token only from the hidden prompt, reports the first row, and prints no part of the token', async () => {
    const stub = await startStub((request) =>
      request.path === `/v1/projects/${REF}`
        ? {
            status: 200,
            body: { ref: REF, organization_slug: ORG, name: FAKE_TOKEN },
            headers: { 'x-ratelimit-limit': '120' },
          }
        : { status: 404, body: { message: `no route ${FAKE_TOKEN}` } },
    );
    const labels: string[] = [];
    const report = (await runProbe(['--scoped', '--ref', REF], {
      readSecret: async (label) => {
        labels.push(label);
        return FAKE_TOKEN;
      },
      baseUrl: stub.baseUrl,
    })) as unknown as {
      mode: string;
      organisationLearned: boolean;
      operations: Array<{ op: string; result: string; status: number }>;
      responseHeaderNames: string[];
    };
    expect(labels).toHaveLength(1);
    expect(report.mode).toBe('scoped');
    expect(report.organisationLearned).toBe(true);
    expect(report.operations[0]).toMatchObject({
      op: 'GET /v1/projects/{ref}',
      result: 'allowed',
      status: 200,
    });
    expect(report.responseHeaderNames).toContain('x-ratelimit-limit');
    // The stub saw the token as a bearer; the report holds none of it.
    expect(stub.requests[0]?.authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    const text = JSON.stringify(report);
    expect(text).not.toContain(FAKE_TOKEN);
    expect(text).not.toContain('FAKE-scoped');
    expect(text).not.toContain('Bearer');
    expectNoSecrets(report);
  });

  it('parses --scoped: it needs --ref, a 20-letter ref, and rejects --fake and --exercise-keys', () => {
    expect(parseArgs(['--scoped', '--ref', REF])).toEqual({
      ref: REF,
      fake: false,
      exerciseKeys: false,
      scoped: true,
    });
    expect(() => parseArgs(['--scoped'])).toThrow(/--scoped/);
    expect(() => parseArgs(['--scoped', '--fake'])).toThrow(/--scoped/);
    expect(() => parseArgs(['--scoped', '--ref', REF, '--exercise-keys'])).toThrow(/--scoped/);
    expect(() => parseArgs(['--scoped', '--ref', 'Not-A-Ref'])).toThrow(/ref/);
  });

  it('a network failure on the first row is other/0, never a thrown token', async () => {
    const report = (await runProbe(['--scoped', '--ref', REF], {
      readSecret: async () => FAKE_TOKEN,
      baseUrl: 'http://127.0.0.1:1',
    })) as unknown as { operations: Array<{ result: string; status: number }> };
    expect(report.operations[0]).toMatchObject({ result: 'other', status: 0 });
    expectNoSecrets(report);
  });
});
