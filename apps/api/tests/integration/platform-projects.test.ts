import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  databaseOverviewSchema,
  platformTenantDetailSchema,
  precheckAnswerSchema,
} from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { runBootstrap } from '@rede-social/core/server/projects/bootstrap';
import { PROJECT_BOOTSTRAP_QUEUE } from '@rede-social/core/server/projects/bootstrap-job';
import {
  createFakeProjectProvider,
  type FakeProjectProvider,
  type FakeProjectProviderOptions,
} from '@rede-social/core/server/projects/fake';
import { precheckProject } from '@rede-social/core/server/projects/precheck';
import { setProjectProviderForTests } from '@rede-social/core/server/projects/provider-access';
import { BOOTSTRAP_STEPS } from '@rede-social/core/server/projects/reasons';
import { defaultSecrets } from '@rede-social/core/server/projects/steps';
import { open } from '@rede-social/core/server/secrets/sealed';
import { closeAllPools } from '@rede-social/core/server/tenancy/project-registry';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { adminSql, api, SEED_PASSWORD, signInAs } from './setup';

/**
 * Phase 09.2-14 (DBT-01, DBT-21, DBT-50, DBT-51, D-541, D-540), the panel API for a tenant's Supabase project.
 * Every case drives the REAL routes, kernel, registry, sealing and bootstrap engine against the FAKE project
 * provider mapped to the second local database `rede_tenant_b`; nothing touches a hosted project.
 *
 * `rede_tenant_b` is reset to an EMPTY database (`--reset --bare`) where a case needs a fresh project, exactly
 * like a new hosted project, and restored to the usual migrated state at the end.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const B_ADMIN_URL = 'postgres://postgres:postgres@127.0.0.1:54322/rede_tenant_b';
const API_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const RUN = Date.now().toString(36);
const QUEUE = PROJECT_BOOTSTRAP_QUEUE;

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';

function resetB(): void {
  execFileSync('bash', ['scripts/db-two-databases.sh', '--reset', '--bare'], {
    cwd: ROOT,
    timeout: 120_000,
    stdio: 'pipe',
  });
}

async function onB<T>(fn: (b: postgres.Sql) => Promise<T>): Promise<T> {
  const b = postgres(B_ADMIN_URL, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    return await fn(b);
  } finally {
    await b.end({ timeout: 5 });
  }
}

// ---------------------------------------------------------------------------------------------------------
// The fake provider: one instance, several refs that all map to B (the registry keys on the ref)
// ---------------------------------------------------------------------------------------------------------

const target = (extra: Record<string, unknown> = {}) => ({
  apiUrl: API_URL,
  databaseUrl: B_ADMIN_URL,
  host: '127.0.0.1',
  port: 54322,
  txPort: 54322,
  dbName: 'rede_tenant_b',
  buckets: [
    { id: 'branding', name: 'branding', public: true },
    { id: 'media', name: 'media', public: false },
  ],
  ...extra,
});

let counter = 0;
const newRef = (tag: string): string => {
  counter += 1;
  return `pp-${tag}-${RUN}-${counter}`.slice(0, 40);
};

const REFS = {
  /** An empty healthy project. */
  fresh: newRef('fresh'),
  /** The same, for the manual-access case. */
  manual: newRef('manual'),
  /** A project that already ran migrations. */
  migrated: newRef('migr'),
  /** A project whose Storage holds a bucket the tenant set does not create. */
  bucketed: newRef('bkt'),
  /** `paused` in the ref makes the fake answer INACTIVE. */
  paused: newRef('paused'),
  /** A project with a table in B. */
  tabled: newRef('tbl'),
  /** Never registered with the provider. */
  unknown: newRef('nope'),
};

function makeProvider(extra: Partial<FakeProjectProviderOptions> = {}) {
  const t = target();
  return createFakeProjectProvider({
    targets: {
      [REFS.fresh]: t,
      [REFS.manual]: t,
      [REFS.migrated]: target({ migrations: [{ version: '20260101000000', name: 'x' }] }),
      [REFS.bucketed]: target({ buckets: [{ id: 'avatars', name: 'avatars', public: true }] }),
      [REFS.paused]: t,
      [REFS.tabled]: t,
    },
    ...extra,
  });
}

const provider: FakeProjectProvider = makeProvider();

// ---------------------------------------------------------------------------------------------------------
// HTTP helpers and fixtures
// ---------------------------------------------------------------------------------------------------------

const tokens = { superAdmin: '', tenantAdmin: '', member: '' };

async function platform(
  path: string,
  init: { method?: string; token?: string | null; body?: unknown } = {},
) {
  const token = init.token === undefined ? tokens.superAdmin : init.token;
  return api.request(`/v1/platform${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

type Envelope = { error: { code: string; details?: Record<string, unknown> } };
const envelope = async (res: Response) => ((await res.json()) as Envelope).error;
const errorOf = (made: { text: string }) => (JSON.parse(made.text) as Envelope).error;

const created: { tenantId: string; projectId: string | null; ref: string | null }[] = [];

const createBody = (slug: string, overrides: Record<string, unknown> = {}) => ({
  displayName: 'Comunidade Projeto',
  slug,
  colors: { primary: '#7c3aed', secondary: '#a78bfa' },
  modules: ['feed', 'events'],
  adminEmail: `admin-${slug}@rede-social-test.local`,
  ...overrides,
});

let slugCounter = 0;
const newSlug = () => {
  slugCounter += 1;
  return `pp-${RUN}-${slugCounter}`.slice(0, 40);
};

/** Creates through the route and remembers the rows for the cleanup. */
async function createViaRoute(ref: string | undefined, overrides: Record<string, unknown> = {}) {
  const slug = newSlug();
  const res = await platform('/tenants', {
    method: 'POST',
    body: createBody(slug, { ...(ref ? { projectRef: ref } : {}), ...overrides }),
  });
  const text = await res.text();
  if (res.status === 201) {
    const detail = platformTenantDetailSchema.parse(JSON.parse(text));
    const [row] = await adminSql<{ project_id: string; ref: string }[]>`
      select tp.project_id, p.ref from platform.tenant_projects tp
        join platform.projects p on p.id = tp.project_id
       where tp.tenant_id = ${detail.tenant.id}::uuid`;
    created.push({
      tenantId: detail.tenant.id,
      projectId: row?.project_id ?? null,
      ref: row?.ref ?? null,
    });
    return { res, text, detail, slug, projectId: row?.project_id ?? '' };
  }
  return { res, text, detail: null, slug, projectId: '' };
}

async function cleanupAll(): Promise<void> {
  // Tenants first (the binding cascades), then the projects this file registered, then the jobs.
  await adminSql`delete from public.tenants where slug like ${`pp-${RUN}-%`}`;
  await adminSql`
    delete from pgboss_platform.job
     where name = ${QUEUE}
       and data->>'projectId' in (select id::text from platform.projects where ref like ${`pp-%-${RUN}-%`})`;
  await adminSql`delete from platform.projects where ref like ${`pp-%-${RUN}-%`}`;
  await adminSql`
    delete from public.access_grants where email like ${`admin-pp-${RUN}-%@rede-social-test.local`}`;
  created.length = 0;
}

function bootstrapDeps(overrides: Record<string, unknown> = {}) {
  return {
    provider,
    // The fake never applies the `postgres` password it records: the DDL connection goes to the local
    // superuser; the `api_user` URLs are used exactly as stored.
    connect: (kind: 'ddl' | 'api', url: string) =>
      postgres(kind === 'ddl' ? B_ADMIN_URL : url, {
        max: 1,
        prepare: false,
        connect_timeout: 10,
        idle_timeout: 2,
        onnotice: () => undefined,
      }),
    secrets: {
      ...defaultSecrets,
      ddlPassword: () => `DDL${randomBytes(18).toString('hex')}`,
      // The local cluster shares its roles: a generated password would lock project 0 out of `api_user`.
      apiUserPassword: () => 'postgres',
    },
    config: () => ({
      platformOrigin: 'https://app.example.test',
      apiPublicUrl: 'https://api.example.test',
      mailDomain: 'mail.example.test',
      smtpPass: `SMTP${randomBytes(12).toString('hex')}`,
    }),
    sendInvites: vi.fn(async () => undefined),
    ...overrides,
  };
}

beforeAll(async () => {
  if (!SEED_PASSWORD || !SUPER_ADMIN_PASSWORD) {
    throw new Error(
      'SEED_PASSWORD and SUPER_ADMIN_PASSWORD are required (same values as the seed)',
    );
  }
  await cleanupAll();
  resetB();
  setProjectProviderForTests(provider);
  tokens.superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  tokens.tenantAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.member = await signInAs('member@rede-demo.local', SEED_PASSWORD);
}, 180_000);

afterEach(async () => {
  provider.forbidReveal(false);
  await cleanupAll();
});

afterAll(async () => {
  setProjectProviderForTests(undefined);
  await cleanupAll();
  await adminSql`alter role api_user with login password 'postgres'`;
  await stopBoss();
  await closeAllPools();
  await adminSql.end();
  await sqlClient.end();
  // Leave `rede_tenant_b` as the other suites expect it: the tenant set applied and no fixtures.
  execFileSync('bash', ['scripts/db-two-databases.sh', '--reset'], {
    cwd: ROOT,
    timeout: 120_000,
    stdio: 'pipe',
  });
});

// ---------------------------------------------------------------------------------------------------------
// Pre-check (DBT-50, UI-D-533)
// ---------------------------------------------------------------------------------------------------------

describe('POST /v1/platform/projects/precheck', () => {
  const precheck = async (projectRef: string, token?: string | null) => {
    const res = await platform('/projects/precheck', {
      method: 'POST',
      body: { projectRef },
      ...(token !== undefined ? { token } : {}),
    });
    const text = await res.text();
    return {
      res,
      text,
      answer: res.status === 200 ? precheckAnswerSchema.parse(JSON.parse(text)) : null,
    };
  };

  it('an empty healthy project is ok and needs no manual access', async () => {
    const { res, answer } = await precheck(REFS.fresh);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(answer).toEqual({ ok: true, manualAccess: false });
  });

  it('a ref the form should not have sent is an ANSWER (invalid), never a 400 or a provider call', async () => {
    const before = structuredClone(provider.calls.describes);
    for (const bad of ['', '   ', 'Not A Ref!', 'https://example.com', 'x', 'a'.repeat(41)]) {
      const { res, answer } = await precheck(bad);
      expect(res.status, bad).toBe(200);
      expect(answer, bad).toEqual({ ok: false, reason: 'invalid' });
    }
    expect(provider.calls.describes).toEqual(before);
  });

  it('an unknown project is not_found and a project the provider will not show is not_found too', async () => {
    expect((await precheck(REFS.unknown)).answer).toEqual({ ok: false, reason: 'not_found' });
  });

  it('a paused project is paused', async () => {
    expect((await precheck(REFS.paused)).answer).toEqual({ ok: false, reason: 'paused' });
  });

  it('a project that already ran migrations, holds a foreign bucket or a table is not_empty', async () => {
    expect((await precheck(REFS.migrated)).answer).toEqual({ ok: false, reason: 'not_empty' });
    expect((await precheck(REFS.bucketed)).answer).toEqual({ ok: false, reason: 'not_empty' });

    await onB((b) => b`create table public.pp_leftover (id int)`);
    try {
      expect((await precheck(REFS.tabled)).answer).toEqual({ ok: false, reason: 'not_empty' });
    } finally {
      await onB((b) => b`drop table public.pp_leftover`);
    }
    expect((await precheck(REFS.tabled)).answer).toEqual({ ok: true, manualAccess: false });
  });

  it('a check that could not run is the answer `unchecked` with a 200', async () => {
    setProjectProviderForTests(makeProvider({ failAt: { step: 'verify', times: 'always' } }));
    try {
      const { res, answer } = await precheck(REFS.fresh);
      expect(res.status).toBe(200);
      expect(answer).toEqual({ ok: false, reason: 'unchecked' });
    } finally {
      setProjectProviderForTests(provider);
    }
  });

  it('a platform token that cannot reveal the secrets makes the answer manualAccess (D-541)', async () => {
    provider.forbidReveal(true);
    expect((await precheck(REFS.manual)).answer).toEqual({ ok: true, manualAccess: true });
  });

  it('the answer never carries provider text, a key or the ref back', async () => {
    const { text } = await precheck(REFS.fresh);
    expect(text).not.toContain(REFS.fresh);
    expect(text).not.toMatch(/fake_(secret|publishable)|postgres:\/\//);
  });

  it('refuses a body that is not exactly { projectRef } and a caller that is not a super_admin', async () => {
    const extra = await platform('/projects/precheck', {
      method: 'POST',
      body: { projectRef: REFS.fresh, url: 'https://169.254.169.254/' },
    });
    expect(extra.status).toBe(400);
    expect((await envelope(extra)).code).toBe('VALIDATION_FAILED');

    for (const token of [tokens.tenantAdmin, tokens.member]) {
      const res = await platform('/projects/precheck', {
        method: 'POST',
        body: { projectRef: REFS.fresh },
        token,
      });
      expect(res.status).toBe(403);
    }
    const anonymous = await platform('/projects/precheck', {
      method: 'POST',
      body: { projectRef: REFS.fresh },
      token: null,
    });
    expect(anonymous.status).toBe(401);
  });

  it('outside production a project bound to another tenant is still ok (D-540); in production it is in_use', async () => {
    resetB();
    const made = await createViaRoute(REFS.fresh);
    expect(made.res.status).toBe(201);
    // The same ref again, as the form would ask for a second tenant: only the production rule differs (the
    // project is still empty, its bootstrap has not run).
    expect(await precheckProject(REFS.fresh, { provider, production: false })).toEqual({
      ok: true,
      manualAccess: false,
    });
    expect(await precheckProject(REFS.fresh, { provider, production: true })).toEqual({
      ok: false,
      reason: 'in_use',
    });
    // The tenant's own binding is not "another tenant".
    expect(
      await precheckProject(REFS.fresh, {
        provider,
        production: true,
        tenantId: made.detail?.tenant.id ?? '',
      }),
    ).toEqual({ ok: true, manualAccess: false });
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------------------
// The tracer (DBT-50, DBT-51, D-541, D-542): from a pasted ref to a ready project
// ---------------------------------------------------------------------------------------------------------

describe('the tracer: a pasted ref becomes a registered project, a durable bootstrap and a readable overview', () => {
  it('tracer: precheck ok, create with the ref, the overview follows the run to ready, no answer holds a credential', async () => {
    resetB();
    const ref = REFS.fresh;

    // 1. The pre-check.
    const pre = await platform('/projects/precheck', { method: 'POST', body: { projectRef: ref } });
    expect(precheckAnswerSchema.parse(await pre.json())).toEqual({ ok: true, manualAccess: false });

    // 2. The create call carrying the ref.
    const made = await createViaRoute(ref);
    expect(made.res.status).toBe(201);
    expect(made.res.headers.get('cache-control')).toBe('no-store');
    const tenantId = made.detail?.tenant.id ?? '';
    const projectId = made.projectId;
    expect(projectId).toMatch(/^[0-9a-f-]{36}$/);

    // The registry: the project is `preparing`, from the fake provider, with its API origin; the binding
    // carries the first-admin input and no creator; eight pending steps; ONE job whose payload is the id.
    const [project] = await adminSql<
      {
        ref: string;
        state: string;
        provider: string;
        api_url: string;
        credential_source: string;
        service_key_sealed: string | null;
        ddl_url_sealed: string | null;
      }[]
    >`select ref, state, provider, api_url, credential_source, service_key_sealed, ddl_url_sealed
        from platform.projects where id = ${projectId}::uuid`;
    expect(project).toMatchObject({
      ref,
      state: 'preparing',
      provider: 'fake',
      api_url: API_URL,
      credential_source: 'sealed',
      service_key_sealed: null,
      ddl_url_sealed: null,
    });
    const [binding] = await adminSql<{ pending_invite: unknown }[]>`
      select pending_invite from platform.tenant_projects where tenant_id = ${tenantId}::uuid`;
    expect(binding?.pending_invite).toEqual({
      email: `admin-${made.slug}@rede-social-test.local`,
      createdBy: null,
    });
    const steps = await adminSql<{ step: string; status: string }[]>`
      select step, status from platform.project_bootstrap_steps
       where project_id = ${projectId}::uuid`;
    expect(steps.map((row) => row.step).sort()).toEqual([...BOOTSTRAP_STEPS].sort());
    expect(steps.every((row) => row.status === 'pending')).toBe(true);
    const jobs = await adminSql<{ data: unknown; singleton_key: string }[]>`
      select data, singleton_key from pgboss_platform.job_common
       where name = ${QUEUE} and data->>'projectId' = ${projectId}`;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({ projectId });

    // 3. The overview while preparing.
    const during = await platform(`/tenants/${tenantId}/database`);
    expect(during.status).toBe(200);
    expect(during.headers.get('cache-control')).toBe('no-store');
    const duringBody = databaseOverviewSchema.parse(await during.json());
    expect(duringBody).toMatchObject({
      ref,
      state: 'preparing',
      otherTenants: 0,
      moving: false,
      lastErrorCode: null,
      preparationFinishedAt: null,
      credentials: { held: false },
    });
    expect(duringBody.steps.map((row) => [row.step, row.status])).toEqual(
      BOOTSTRAP_STEPS.map((step) => [step, 'pending']),
    );

    // 4. The bootstrap runs (the job's own function; the worker is not started here).
    expect(await runBootstrap(projectId, bootstrapDeps())).toEqual({ status: 'ready' });

    const after = databaseOverviewSchema.parse(
      await (await platform(`/tenants/${tenantId}/database`)).json(),
    );
    expect(after.steps.map((row) => [row.step, row.status])).toEqual(
      BOOTSTRAP_STEPS.map((step) => [step, 'done']),
    );
    expect(after.steps.every((row) => row.attempt === 1 && row.reasonCode === null)).toBe(true);
    expect(after.preparationFinishedAt).toEqual(expect.any(String));
    expect(after.credentials.held).toBe(true);
    // Ready, but the health job has not looked yet: the honest state is `unchecked` (precedence).
    expect(after.state).toBe('unchecked');

    // The job's first check writes `healthy`, and the state ends `ready`.
    await adminSql`
      insert into platform.project_health (project_id, status, checked_at)
      values (${projectId}::uuid, 'healthy', now())`;
    const ready = databaseOverviewSchema.parse(
      await (await platform(`/tenants/${tenantId}/database`)).json(),
    );
    expect(ready.state).toBe('ready');
    expect(ready.lastCheckedAt).toEqual(expect.any(String));

    // 5. No answer, and nothing the registry holds in the clear, appears in the create answer or the overview.
    const [sealed] = await adminSql<
      {
        ddl: string;
        tx: string;
        session: string;
        service: string;
        hook: string;
        pub: string;
      }[]
    >`select ddl_url_sealed as ddl, database_url_tx_sealed as tx, database_url_session_sealed as session,
             service_key_sealed as service, hook_secret_sealed as hook, publishable_key as pub
        from platform.projects where id = ${projectId}::uuid`;
    const plain = [
      open(sealed?.ddl ?? '', `${projectId}:ddl_url`),
      open(sealed?.tx ?? '', `${projectId}:database_url_tx`),
      open(sealed?.session ?? '', `${projectId}:database_url_session`),
      open(sealed?.service ?? '', `${projectId}:service_key`),
      open(sealed?.hook ?? '', `${projectId}:hook_secret`),
    ];
    const everything = [
      made.text,
      JSON.stringify(duringBody),
      JSON.stringify(after),
      JSON.stringify(ready),
    ].join('\n');
    for (const secret of [...plain, sealed?.pub ?? '', ...Object.values(sealed ?? {})]) {
      expect(secret.length).toBeGreaterThan(0);
      expect(everything).not.toContain(secret);
    }
    expect(everything).not.toMatch(
      /postgres:\/\/|sb_secret_|v1:\d+:|service_key|ddl_url|hook_secret/,
    );
  }, 180_000);

  it('a tenant created without a ref is served from the default project exactly as before', async () => {
    const made = await createViaRoute(undefined);
    expect(made.res.status).toBe(201);
    const tenantId = made.detail?.tenant.id ?? '';
    const [binding] = await adminSql<{ is_central: boolean }[]>`
      select p.is_central from platform.tenant_projects tp
        join platform.projects p on p.id = tp.project_id
       where tp.tenant_id = ${tenantId}::uuid`;
    expect(binding?.is_central).toBe(true);
    const overview = databaseOverviewSchema.parse(
      await (await platform(`/tenants/${tenantId}/database`)).json(),
    );
    expect(overview).toMatchObject({ steps: [], credentials: { held: true }, moving: false });
    // No bootstrap steps for project 0; ready or not yet checked, never preparing.
    expect(['ready', 'unchecked']).toContain(overview.state);
  });
});

// ---------------------------------------------------------------------------------------------------------
// The overview route itself
// ---------------------------------------------------------------------------------------------------------

describe('GET /v1/platform/tenants/{id}/database', () => {
  it('an unknown tenant is the bare 404, a malformed id a 400, and no other caller is served', async () => {
    const unknown = await platform(`/tenants/${crypto.randomUUID()}/database`);
    expect(unknown.status).toBe(404);
    expect((await envelope(unknown)).code).toBe('NOT_FOUND');
    expect((await platform('/tenants/not-a-uuid/database')).status).toBe(400);

    const [demo] = await adminSql<
      { id: string }[]
    >`select id from public.tenants where slug = 'rede-demo'`;
    for (const token of [tokens.tenantAdmin, tokens.member]) {
      expect((await platform(`/tenants/${demo?.id}/database`, { token })).status).toBe(403);
    }
    expect((await platform(`/tenants/${demo?.id}/database`, { token: null })).status).toBe(401);
  });

  it('the seeded tenant of project 0 reads as a prepared project with credentials held in the environment', async () => {
    const [demo] = await adminSql<
      { id: string }[]
    >`select id from public.tenants where slug = 'rede-demo'`;
    const res = await platform(`/tenants/${demo?.id}/database`);
    expect(res.status).toBe(200);
    const body = databaseOverviewSchema.parse(await res.json());
    expect(body.steps).toEqual([]);
    expect(body.credentials.held).toBe(true);
    expect(body.otherTenants).toBeGreaterThanOrEqual(1); // rede-lab shares project 0 (D-540)
  });
});

// ---------------------------------------------------------------------------------------------------------
// Manual access (DBT-21, P44)
// ---------------------------------------------------------------------------------------------------------

describe('manual access (D-541, DBT-21, P44)', () => {
  const GOOD = () => ({
    databasePassword: 'postgres',
    serviceKey: process.env.SUPABASE_SERVICE_KEY ?? '',
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
  });

  async function rowsOf(slug: string) {
    const [tenants] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.tenants where slug = ${slug}`;
    const [projects] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from platform.projects where ref = ${REFS.manual}`;
    return { tenants: tenants?.n ?? 0, projects: projects?.n ?? 0 };
  }

  it('required ONLY when the pre-check says manualAccess: without the three fields the create names each one', async () => {
    resetB();
    provider.forbidReveal(true);
    const made = await createViaRoute(REFS.manual);
    expect(made.res.status).toBe(400);
    const error = errorOf(made);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details).toEqual({
      databasePassword: 'required',
      serviceKey: 'required',
      publishableKey: 'required',
    });
    expect(await rowsOf(made.slug)).toEqual({ tenants: 0, projects: 0 });

    // One supplied, two still required.
    const partial = await createViaRoute(REFS.manual, {
      access: { serviceKey: GOOD().serviceKey },
    });
    expect(errorOf(partial).details).toEqual({
      databasePassword: 'required',
      publishableKey: 'required',
    });

    // Not needed (the token reveals): the create takes no access at all.
    provider.forbidReveal(false);
    const plain = await createViaRoute(REFS.manual);
    expect(plain.res.status).toBe(201);
  }, 120_000);

  it('VALIDATED against the project before anything is stored: a wrong value of each kind stores nothing', async () => {
    resetB();
    provider.forbidReveal(true);
    for (const bad of [
      { ...GOOD(), databasePassword: 'wrong-password' },
      { ...GOOD(), serviceKey: 'wrong-service-key' },
      { ...GOOD(), publishableKey: 'wrong-publishable-key' },
    ]) {
      const made = await createViaRoute(REFS.manual, { access: bad });
      expect(made.res.status).toBe(400);
      const error = errorOf(made);
      expect(error.details).toEqual({ access: 'invalid' });
      // The refusal names no value and stores nothing: no tenant, no project, no job.
      expect(made.text).not.toContain('wrong-');
      expect(await rowsOf(made.slug)).toEqual({ tenants: 0, projects: 0 });
    }
  }, 120_000);

  it('correct values are sealed into the registry and the bootstrap uses them as found', async () => {
    resetB();
    provider.forbidReveal(true);
    const good = GOOD();
    const made = await createViaRoute(REFS.manual, { access: good });
    expect(made.res.status).toBe(201);
    // Never echoed.
    for (const secret of Object.values(good)) expect(made.text).not.toContain(secret);

    const [row] = await adminSql<
      {
        ddl: string;
        service: string;
        pub: string;
        key_id: number;
        kind: string;
      }[]
    >`select ddl_url_sealed as ddl, service_key_sealed as service, publishable_key as pub,
             secret_key_id as key_id, service_key_kind as kind
        from platform.projects where id = ${made.projectId}::uuid`;
    expect(row?.pub).toBe(good.publishableKey);
    expect(row?.ddl).toMatch(/^v1:/);
    expect(open(row?.service ?? '', `${made.projectId}:service_key`)).toBe(good.serviceKey);
    expect(open(row?.ddl ?? '', `${made.projectId}:ddl_url`)).toContain(
      ':postgres@127.0.0.1:54322/',
    );
    expect(row?.key_id).toBeGreaterThanOrEqual(1);

    // The platform token cannot reveal, so a run that tried to would fail access_denied; with the access
    // stored it passes and never asks the provider for a key or a password.
    expect(await runBootstrap(made.projectId, bootstrapDeps())).toEqual({ status: 'ready' });
    expect(provider.calls.ensureKeys[REFS.manual] ?? 0).toBe(0);
    expect(provider.calls.passwords.filter((p) => p.ref === REFS.manual)).toHaveLength(0);
  }, 180_000);

  it('a create that supplies access the pre-check did not ask for stores it only after the same validation', async () => {
    resetB();
    const bad = await createViaRoute(REFS.fresh, { access: { ...GOOD(), serviceKey: 'nope' } });
    expect(bad.res.status).toBe(400);
    expect(errorOf(bad).details).toEqual({ access: 'invalid' });

    const good = await createViaRoute(REFS.fresh, { access: { serviceKey: GOOD().serviceKey } });
    expect(good.res.status).toBe(201);
    const [row] = await adminSql<{ service: string | null; ddl: string | null }[]>`
      select service_key_sealed as service, ddl_url_sealed as ddl
        from platform.projects where id = ${good.projectId}::uuid`;
    expect(row?.service).toMatch(/^v1:/);
    expect(row?.ddl).toBeNull();
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------------------
// The tenant admin and the member never reach the project routes (T-09.2-68)
// ---------------------------------------------------------------------------------------------------------

describe('only a super_admin reaches the project routes (T-09.2-68)', () => {
  it('creating a tenant with a ref as a tenant admin or a member is a 403 and creates nothing', async () => {
    for (const token of [tokens.tenantAdmin, tokens.member]) {
      const res = await platform('/tenants', {
        method: 'POST',
        token,
        body: createBody(newSlug(), { projectRef: REFS.fresh }),
      });
      expect(res.status).toBe(403);
    }
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from platform.projects where ref = ${REFS.fresh}`;
    expect(row?.n).toBe(0);
  });
});
