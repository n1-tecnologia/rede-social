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
  classifyStatus: (kind: 'read' | 'write-invalid', status: number) => string;
  PROBE_PLAN: Array<{ op: string; method: string; path: string; kind: string }>;
  parseArgs: (argv: string[]) => {
    ref: string | null;
    fake: boolean;
    exerciseKeys: boolean;
    scoped: boolean;
  };
  hostShape: (host: string) => string;
};
const { runProbe, parseArgs, hostShape, classifyStatus, PROBE_PLAN } = (await import(
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

type StubRequest = {
  method: string;
  path: string;
  search: string;
  authorization: string | undefined;
  rawBody: string;
};
type StubReply = { status: number; body?: unknown; headers?: Record<string, string> };

async function startStub(handler: (request: StubRequest) => StubReply) {
  const requests: StubRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://stub.local');
      const recorded: StubRequest = {
        method: req.method ?? 'GET',
        path: url.pathname,
        search: url.search,
        authorization: req.headers.authorization,
        rawBody: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(recorded);
      const reply = handler(recorded);
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

/**
 * 09.4-01 task 2 (CTK-07, D-569, D-570, D-578): the full operation table, the listing and organisation blocks and
 * the permission identifiers of a refusal.
 */
type Scoped = {
  mode: string;
  organisationLearned: boolean;
  operations: Array<{
    op: string;
    result: string;
    status: number;
    missingPermissions?: string[];
    unexpectedSuccess?: boolean;
  }>;
  listing: {
    status: number | null;
    projectsTotal: number | null;
    projectsOtherThanTarget: number | null;
  };
  organisationRead: { status: number | null };
  responseHeaderNames: string[];
};

const P = `/v1/projects/${REF}`;
const isRead = (r: StubRequest) =>
  r.method === 'GET' || (r.method === 'POST' && r.path === `${P}/database/query/read-only`);

/** A stub that answers 200 to every read and 400 to every write; `override` replaces an answer. */
const permissive =
  (override: (r: StubRequest) => StubReply | undefined = () => undefined) =>
  (r: StubRequest): StubReply =>
    override(r) ??
    (r.method === 'GET' && r.path === '/v1/projects'
      ? { status: 200, body: [{ ref: REF }, { ref: 'zzzzzzzzzzzzzzzzzzzz' }, { id: 'other' }] }
      : r.method === 'GET' && r.path === P
        ? {
            status: 200,
            body: { ref: REF, organization_slug: ORG },
            headers: { 'x-ratelimit-limit': '120' },
          }
        : isRead(r)
          ? { status: 200, body: [] }
          : { status: 400, body: { message: 'validation' } });

const runScoped = async (handler: (r: StubRequest) => StubReply) => {
  const stub = await startStub(handler);
  const report = (await runProbe(['--scoped', '--ref', REF], {
    readSecret: async () => FAKE_TOKEN,
    baseUrl: stub.baseUrl,
  })) as unknown as Scoped;
  return { report, requests: stub.requests };
};

describe('platform:probe --scoped, the 21 operations', () => {
  it('a stub that answers 200 to reads and 400 to writes gives 21 allowed rows and no unexpectedSuccess', async () => {
    const { report, requests } = await runScoped(permissive());
    expect(report.operations).toHaveLength(21);
    expect(report.operations.every((o) => o.result === 'allowed')).toBe(true);
    expect(report.operations.some((o) => o.unexpectedSuccess === true)).toBe(false);
    expect(report.operations[0]?.op).toBe('GET /v1/projects/{ref}');
    expect(report.operations[20]?.op).toBe('GET /v1/projects');
    expect(PROBE_PLAN).toHaveLength(20);
    expect(PROBE_PLAN.filter((row) => row.kind === 'write-invalid')).toHaveLength(8);
    // Nothing but GET, POST and PATCH is ever sent, and every request carries the token as a bearer.
    expect([...new Set(requests.map((r) => r.method))].sort()).toEqual(['GET', 'PATCH', 'POST']);
    expect(requests.every((r) => r.authorization === `Bearer ${FAKE_TOKEN}`)).toBe(true);
    expectNoSecrets(report);
  });

  it('sends the reads for real and every write as an invalid body that cannot change a project', async () => {
    const { requests } = await runScoped(permissive());
    const sent = (r: StubRequest) => `${r.method} ${r.path.replace(REF, '{ref}')}`;
    const body = (method: string, path: string) =>
      JSON.parse(
        requests.find((r) => r.method === method && r.path === `${P}${path}`)?.rawBody ?? 'null',
      );
    const health = requests.find((r) => r.path === `${P}/health`);
    expect(new URLSearchParams(health?.search).get('services')).toBe(
      'auth,db,db_postgres_user,pooler,realtime,rest,storage',
    );
    expect(
      new URLSearchParams(requests.find((r) => r.path === `${P}/api-keys`)?.search).get('reveal'),
    ).toBe('true');
    expect(body('POST', '/database/query/read-only')).toEqual({ query: 'select 1' });
    expect(body('POST', '/api-keys')).toEqual({ type: 'not-a-key-type' });
    expect(body('PATCH', '/database/password')).toEqual({ password: 'x' });
    expect(body('PATCH', '/config/auth')).toEqual({ site_url: 12345 });
    expect(body('POST', '/config/auth/signing-keys')).toEqual({ algorithm: 'NOT-AN-ALGORITHM' });
    expect(body('PATCH', '/config/auth/signing-keys/00000000-0000-0000-0000-000000000000')).toEqual(
      {
        status: 'not-a-status',
      },
    );
    expect(body('PATCH', '/postgrest')).toEqual({ max_rows: 'not-a-number' });
    expect(body('PATCH', '/config/storage')).toEqual({ fileSizeLimit: 'not-a-number' });
    expect(body('PATCH', '/config/realtime')).toEqual({ private_only: 'not-a-boolean' });
    expect(requests.map(sent)).toContain('GET /v1/projects');
    expect(requests.map(sent)).toContain(`GET /v1/organizations/${ORG}`);
  });

  it('keeps only the missing_permissions identifiers that match the strict pattern (at most 20)', async () => {
    const many = Array.from({ length: 25 }, (_, i) => `perm_${i}`);
    const { report } = await runScoped(
      permissive((r) =>
        r.path === `${P}/config/realtime`
          ? {
              status: 403,
              body: {
                message: `x ${FAKE_TOKEN}`,
                missing_permissions:
                  r.method === 'GET'
                    ? ['realtime_config_write', 'BAD ID', 'a'.repeat(80), 42]
                    : many,
              },
            }
          : undefined,
      ),
    );
    const rows = report.operations.filter((o) => o.op.endsWith('/config/realtime'));
    expect(rows).toHaveLength(2);
    const get = rows.find((o) => o.op.startsWith('GET'));
    const patch = rows.find((o) => o.op.startsWith('PATCH'));
    expect(get).toMatchObject({
      result: 'denied',
      status: 403,
      missingPermissions: ['realtime_config_write'],
    });
    expect(patch?.result).toBe('denied');
    expect(patch?.missingPermissions).toEqual(many.slice(0, 20));
    expectNoSecrets(report);
  });

  it('flags a 2xx on a write row as unexpectedSuccess so Igor sees it', async () => {
    const { report } = await runScoped(
      permissive((r) =>
        r.method === 'PATCH' && r.path === `${P}/postgrest` ? { status: 200, body: {} } : undefined,
      ),
    );
    const row = report.operations.find((o) => o.op === 'PATCH /v1/projects/{ref}/postgrest');
    expect(row).toMatchObject({ result: 'allowed', status: 200, unexpectedSuccess: true });
    expect(report.operations.filter((o) => o.unexpectedSuccess === true)).toHaveLength(1);
  });

  it('classifies a write row: validation is allowed, 401 and 403 denied, 2xx allowed, the rest other', () => {
    for (const status of [400, 404, 409, 422])
      expect(classifyStatus('write-invalid', status)).toBe('allowed');
    for (const status of [401, 403]) expect(classifyStatus('write-invalid', status)).toBe('denied');
    expect(classifyStatus('write-invalid', 204)).toBe('allowed');
    for (const status of [0, 429, 500, 502])
      expect(classifyStatus('write-invalid', status)).toBe('other');
    expect(classifyStatus('read', 200)).toBe('allowed');
    expect(classifyStatus('read', 400)).toBe('other');
    expect(classifyStatus('read', 403)).toBe('denied');
  });

  it('counts the listing as numbers only, null-fills it on 403, and reads the organisation by the learned slug', async () => {
    const counted = await runScoped(permissive());
    expect(counted.report.listing).toEqual({
      status: 200,
      projectsTotal: 3,
      projectsOtherThanTarget: 2,
    });
    expect(counted.report.organisationRead).toEqual({ status: 200 });
    expect(counted.report.organisationLearned).toBe(true);

    const refused = await runScoped(
      permissive((r) =>
        r.path === '/v1/projects' ? { status: 403, body: { message: 'no' } } : undefined,
      ),
    );
    expect(refused.report.listing).toEqual({
      status: 403,
      projectsTotal: null,
      projectsOtherThanTarget: null,
    });
    expect(refused.report.operations[20]).toMatchObject({
      op: 'GET /v1/projects',
      result: 'denied',
      status: 403,
    });

    // No slug learned (row 1 refused): the organisation is not read at all and its status is null.
    const unlearned = await runScoped(
      permissive((r) =>
        r.path === P && r.method === 'GET' ? { status: 403, body: {} } : undefined,
      ),
    );
    expect(unlearned.report.organisationLearned).toBe(false);
    expect(unlearned.report.organisationRead).toEqual({ status: null });
    expect(unlearned.requests.some((r) => r.path.startsWith('/v1/organizations'))).toBe(false);
  });

  it('prints the response header NAMES of the first row, sorted and filtered, never their values', async () => {
    const { report } = await runScoped(
      permissive((r) =>
        r.method === 'GET' && r.path === P
          ? {
              status: 200,
              body: { ref: REF, organization_slug: ORG },
              headers: { 'X-Plan-Expiry': FAKE_TOKEN, 'x-ratelimit-limit': '120' },
            }
          : undefined,
      ),
    );
    const names = report.responseHeaderNames;
    expect(names).toEqual([...names].sort());
    expect(names).toEqual(
      expect.arrayContaining(['content-type', 'x-plan-expiry', 'x-ratelimit-limit']),
    );
    expect(names.every((name) => /^[a-z0-9-]{1,64}$/.test(name))).toBe(true);
    expectNoSecrets(report);
  });

  it('puts the token, a JWT, a secret key and a connection string in every body and header: none reaches the report', async () => {
    const leak = `${FAKE_TOKEN} eyJhbGciOi.payload.sig sb_secret_abc postgres://u:p@h/db`;
    const { report } = await runScoped((r) => {
      const answer = permissive()(r);
      return {
        ...answer,
        body: {
          ...(answer.body as object),
          message: leak,
          name: leak,
          db_host: leak,
          missing_permissions: [leak],
        },
        headers: { ...answer.headers, 'x-leak': leak },
      };
    });
    const text = JSON.stringify(report);
    for (const shape of [
      FAKE_TOKEN,
      'eyJ',
      'sb_secret_',
      'postgres://',
      'sbp_',
      'Bearer',
      'payload',
    ]) {
      expect(text).not.toContain(shape);
    }
    expect(report.responseHeaderNames).toContain('x-leak');
  });
});
