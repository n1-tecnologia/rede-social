import {
  databaseOverviewSchema,
  platformTenantDetailSchema,
  precheckAnswerSchema,
} from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { createTenant } from '@rede-social/core/server/platform/tenants';
import { listSteps, runBootstrap } from '@rede-social/core/server/projects/bootstrap';
import { PROJECT_BOOTSTRAP_QUEUE } from '@rede-social/core/server/projects/bootstrap-job';
import {
  createFakeProjectProvider,
  type FakeProjectProvider,
  type FakeProjectProviderOptions,
} from '@rede-social/core/server/projects/fake';
import { checkProject } from '@rede-social/core/server/projects/health';
import { precheckProject } from '@rede-social/core/server/projects/precheck';
import { setProjectProviderForTests } from '@rede-social/core/server/projects/provider-access';
import { BOOTSTRAP_STEPS } from '@rede-social/core/server/projects/reasons';
import { todayInSaoPaulo } from '@rede-social/core/server/projects/token';
import type { ProjectProvider } from '@rede-social/core/server/projects/types';
import { open } from '@rede-social/core/server/secrets/sealed';
import { closeAllPools } from '@rede-social/core/server/tenancy/project-registry';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_URL, bootstrapDeps, fakeTarget, onB, resetB, restoreB } from './projects-setup';
import * as customerSetup from './projects-setup';
import { adminSql, api, SEED_PASSWORD, signInAs } from './setup';

/**
 * Every line any logger writes in this file is captured, so the 09.4-09 token scan reads what a person tailing
 * the logs would see (T-09.4-31). The mock replaces the ONE root logger every kernel and API logger derives from.
 */
const captured = vi.hoisted(() => ({ lines: [] as string[] }));
vi.mock('@rede-social/core/server/logging', async (importOriginal) => {
  const real = await importOriginal<typeof import('@rede-social/core/server/logging')>();
  const text = (value: unknown) =>
    JSON.stringify(value, (_key, item) =>
      item instanceof Error ? { name: item.name, message: item.message, stack: item.stack } : item,
    );
  const make = (bindings: Record<string, unknown>): unknown => {
    const record = (...args: unknown[]) => {
      captured.lines.push(text([bindings, ...args]));
    };
    return {
      info: record,
      warn: record,
      error: record,
      debug: record,
      trace: record,
      fatal: record,
      level: 'trace',
      bindings: () => bindings,
      child: (extra: Record<string, unknown>) => make({ ...bindings, ...extra }),
    };
  };
  const rootLogger = make({});
  return {
    ...real,
    rootLogger,
    moduleLogger: (name: string) =>
      (rootLogger as { child: (b: object) => unknown }).child({ name }),
  };
});

/**
 * Phase 09.2-14 (DBT-01, DBT-21, DBT-50, DBT-51, D-541, D-540), the panel API for a tenant's Supabase project.
 * Every case drives the REAL routes, kernel, registry, sealing and bootstrap engine against the FAKE project
 * provider mapped to the second local database `rede_tenant_b`; nothing touches a hosted project.
 *
 * `rede_tenant_b` is reset to an EMPTY database (`--reset --bare`) where a case needs a fresh project, exactly
 * like a new hosted project, and restored to the usual migrated state at the end.
 */

const RUN = Date.now().toString(36);
const QUEUE = PROJECT_BOOTSTRAP_QUEUE;

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';

// ---------------------------------------------------------------------------------------------------------
// The fake provider: one instance, several refs that all map to B (the registry keys on the ref)
// ---------------------------------------------------------------------------------------------------------

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
  /** The production-refusal cases (P1). */
  prod: newRef('prod'),
  /** Two creates racing for one ref (P3). */
  race: newRef('race'),
  /** A shared project outside production (D-540). */
  shared: newRef('shared'),
  /** A registered project with no tenant bound. */
  empty: newRef('zero'),
  /** The verify and resume cases. */
  ops: newRef('ops'),
};

function makeProvider(extra: Partial<FakeProjectProviderOptions> = {}) {
  const t = fakeTarget();
  return createFakeProjectProvider({
    targets: {
      [REFS.fresh]: t,
      [REFS.manual]: t,
      [REFS.migrated]: fakeTarget({ migrations: [{ version: '20260101000000', name: 'x' }] }),
      [REFS.bucketed]: fakeTarget({ buckets: [{ id: 'avatars', name: 'avatars', public: true }] }),
      [REFS.paused]: t,
      [REFS.tabled]: t,
      [REFS.prod]: t,
      [REFS.race]: t,
      [REFS.shared]: t,
      [REFS.empty]: t,
      [REFS.ops]: t,
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

/** 20-letter refs this file made up for the supabase-shaped cases (they match no `pp-` pattern). */
const letterRefs = new Set<string>();

async function cleanupAll(): Promise<void> {
  // Tenants first (the binding cascades), then the projects this file registered, then the jobs.
  await adminSql`delete from public.tenants where slug like ${`pp-${RUN}-%`}`;
  await adminSql`
    delete from pgboss_platform.job
     where name = ${QUEUE}
       and data->>'projectId' in (select id::text from platform.projects where ref like ${`pp-%-${RUN}-%`})`;
  await adminSql`delete from platform.projects where ref like ${`pp-%-${RUN}-%`}`;
  for (const ref of letterRefs) {
    await adminSql`
      delete from pgboss_platform.job
       where name = ${QUEUE}
         and data->>'projectId' in (select id::text from platform.projects where ref = ${ref})`;
    await adminSql`delete from platform.projects where ref = ${ref}`;
  }
  letterRefs.clear();
  await adminSql`
    delete from public.access_grants where email like ${`admin-pp-${RUN}-%@rede-social-test.local`}`;
  created.length = 0;
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
  restoreB();
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
    expect(await runBootstrap(projectId, bootstrapDeps(provider))).toEqual({ status: 'ready' });

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
    expect(await runBootstrap(made.projectId, bootstrapDeps(provider))).toEqual({
      status: 'ready',
    });
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

// ---------------------------------------------------------------------------------------------------------
// Verify now and resume (D-542, D-543)
// ---------------------------------------------------------------------------------------------------------

describe('POST /tenants/{id}/database/verify and /bootstrap/resume', () => {
  const actor = { userId: crypto.randomUUID() };
  const body = (slug: string, ref: string) => ({
    ...createBody(slug, { projectRef: ref }),
    modules: ['feed'] as ('feed' | 'events')[],
  });

  async function newBootstrapped(ref: string, run = true) {
    const slug = newSlug();
    const made = await createTenant(
      { ...body(slug, ref), adminEmail: `admin-${slug}@rede-social-test.local` } as never,
      actor,
      { provider },
    );
    if (run)
      expect(await runBootstrap(made.projectId, bootstrapDeps(provider))).toEqual({
        status: 'ready',
      });
    return made;
  }

  it('verify: a project still being prepared has nothing to check (409); a ready one gets one check and ends `ready`', async () => {
    resetB();
    const preparing = await newBootstrapped(REFS.ops, false);
    const early = await platform(`/tenants/${preparing.id}/database/verify`, { method: 'POST' });
    expect(early.status).toBe(409);
    expect((await envelope(early)).code).toBe('CONFLICT');

    expect(await runBootstrap(preparing.projectId, bootstrapDeps(provider))).toEqual({
      status: 'ready',
    });
    const res = await platform(`/tenants/${preparing.id}/database/verify`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const overview = databaseOverviewSchema.parse(await res.json());
    expect(overview.state).toBe('ready');
    expect(overview.lastCheckedAt).toEqual(expect.any(String));
    const [health] = await adminSql<{ status: string; detail_code: string | null }[]>`
      select status, detail_code from platform.project_health where project_id = ${preparing.projectId}::uuid`;
    expect(health).toEqual({ status: 'healthy', detail_code: null });
  }, 180_000);

  it('verify: an unknown tenant is a 404 and nobody but a super_admin is served', async () => {
    expect(
      (await platform(`/tenants/${crypto.randomUUID()}/database/verify`, { method: 'POST' }))
        .status,
    ).toBe(404);
    const [demo] = await adminSql<
      { id: string }[]
    >`select id from public.tenants where slug = 'rede-demo'`;
    for (const token of [tokens.tenantAdmin, tokens.member]) {
      const res = await platform(`/tenants/${demo?.id}/database/verify`, { method: 'POST', token });
      expect(res.status).toBe(403);
    }
    expect(
      (await platform(`/tenants/${demo?.id}/database/verify`, { method: 'POST', token: null }))
        .status,
    ).toBe(401);
  });

  it('resume: answers 409 when no step has failed, whatever else is going on', async () => {
    resetB();
    const made = await newBootstrapped(REFS.ops, false);
    const pending = await platform(`/tenants/${made.id}/database/bootstrap/resume`, {
      method: 'POST',
    });
    expect(pending.status).toBe(409);
    expect((await envelope(pending)).code).toBe('CONFLICT');

    expect(await runBootstrap(made.projectId, bootstrapDeps(provider))).toEqual({
      status: 'ready',
    });
    const done = await platform(`/tenants/${made.id}/database/bootstrap/resume`, {
      method: 'POST',
    });
    expect(done.status).toBe(409);
  }, 180_000);

  it('resume: puts the failed step back, keeps the finished ones, queues one job, and the run completes', async () => {
    resetB();
    const made = await newBootstrapped(REFS.ops, false);
    const failing = fakeProviderWithFailure('buckets');
    const failed = await runBootstrap(made.projectId, bootstrapDeps(failing));
    expect(failed).toMatchObject({ status: 'failed', step: 'buckets' });

    const failedView = databaseOverviewSchema.parse(
      await (await platform(`/tenants/${made.id}/database`)).json(),
    );
    expect(failedView.state).toBe('preparation_failed');
    expect(failedView.lastErrorCode).not.toBeNull();
    expect(failedView.steps.find((row) => row.step === 'buckets')).toMatchObject({
      status: 'failed',
      attempt: 1,
    });

    // "Tentar de novo", twice (a double click): the first resumes, the second finds nothing failed (409), and at
    // most one job waits.
    const first = await platform(`/tenants/${made.id}/database/bootstrap/resume`, {
      method: 'POST',
    });
    const second = await platform(`/tenants/${made.id}/database/bootstrap/resume`, {
      method: 'POST',
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    const after = databaseOverviewSchema.parse(await first.json());
    expect(after.steps.map((row) => row.status)).toEqual(
      BOOTSTRAP_STEPS.map((step) => (BOOTSTRAP_STEPS.indexOf(step) < 4 ? 'done' : 'pending')),
    );
    expect(after.state).toBe('preparing');
    const jobs = await adminSql<{ n: number }[]>`
      select count(*)::int as n from pgboss_platform.job_common
       where name = ${QUEUE} and data->>'projectId' = ${made.projectId} and state in ('created', 'retry')`;
    expect(jobs[0]?.n).toBeLessThanOrEqual(1);

    expect(await runBootstrap(made.projectId, bootstrapDeps(failing))).toEqual({ status: 'ready' });
    const rows = await listSteps(made.projectId);
    expect(rows.map((row) => row.attempt)).toEqual(
      BOOTSTRAP_STEPS.map((step) => (step === 'buckets' ? 2 : 1)),
    );
  }, 180_000);

  it('resume: an unknown tenant is a 404 and nobody but a super_admin is served', async () => {
    expect(
      (
        await platform(`/tenants/${crypto.randomUUID()}/database/bootstrap/resume`, {
          method: 'POST',
        })
      ).status,
    ).toBe(404);
    const [demo] = await adminSql<
      { id: string }[]
    >`select id from public.tenants where slug = 'rede-demo'`;
    for (const token of [tokens.tenantAdmin, tokens.member]) {
      expect(
        (
          await platform(`/tenants/${demo?.id}/database/bootstrap/resume`, {
            method: 'POST',
            token,
          })
        ).status,
      ).toBe(403);
    }
  });
});

/** The same targets, with one step failing once. */
function fakeProviderWithFailure(step: (typeof BOOTSTRAP_STEPS)[number]): FakeProjectProvider {
  return makeProvider({ failAt: { step, times: 1 } });
}

// ---------------------------------------------------------------------------------------------------------
// One project, one tenant in production (DBT-01, D-540): P1 and P3
// ---------------------------------------------------------------------------------------------------------

describe('production refuses a second tenant on a project (D-540, DBT-01, T-09.2-69)', () => {
  const actor = { userId: crypto.randomUUID() };
  const input = (slug: string, ref?: string) =>
    ({
      ...createBody(slug, ref ? { projectRef: ref } : {}),
      modules: ['feed'],
    }) as never;

  const snapshot = async (projectId: string) => {
    const [project] = await adminSql<Record<string, unknown>[]>`
      select ref, state, provider, api_url, credential_version, ddl_url_sealed, service_key_sealed
        from platform.projects where id = ${projectId}::uuid`;
    const steps = await adminSql<Record<string, unknown>[]>`
      select step, status, attempt from platform.project_bootstrap_steps
       where project_id = ${projectId}::uuid order by step`;
    const bindings = await adminSql<Record<string, unknown>[]>`
      select tenant_id, pending_invite from platform.tenant_projects
       where project_id = ${projectId}::uuid order by tenant_id`;
    const jobs = await adminSql<{ n: number }[]>`
      select count(*)::int as n from pgboss_platform.job_common
       where name = ${QUEUE} and data->>'projectId' = ${projectId}`;
    return { project, steps, bindings, jobs: jobs[0]?.n };
  };

  it('P1: a project bound to zero tenants takes its first binding; in production the second is refused and the first is untouched', async () => {
    resetB();
    const first = await createTenant(input(newSlug(), REFS.prod), actor, {
      provider,
      production: true,
    });
    const before = await snapshot(first.projectId);
    expect(before.bindings).toHaveLength(1);
    expect(before.steps).toHaveLength(8);
    expect(before.jobs).toBe(1);

    const secondSlug = newSlug();
    let caught: unknown;
    try {
      await createTenant(input(secondSlug, REFS.prod), actor, { provider, production: true });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(400);
    expect((caught as ApiError).code).toBe('VALIDATION_FAILED');
    expect((caught as ApiError).details).toEqual({ projectRef: 'in_use' });

    // The first binding, its steps, its credentials and its job are exactly as they were; the loser left nothing.
    expect(await snapshot(first.projectId)).toEqual(before);
    const [loser] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.tenants where slug = ${secondSlug}`;
    expect(loser?.n).toBe(0);
  }, 120_000);

  it('P1: a registered project with no tenant bound accepts its first binding', async () => {
    resetB();
    await adminSql`
      insert into platform.projects (ref, provider, credential_source, state, api_url)
      values (${REFS.empty}, 'fake', 'sealed', 'preparing', ${API_URL})`;
    const made = await createTenant(input(newSlug(), REFS.empty), actor, {
      provider,
      production: true,
    });
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from platform.tenant_projects where project_id = ${made.projectId}::uuid`;
    expect(row?.n).toBe(1);
    expect((await listSteps(made.projectId)).map((r) => r.status)).toEqual(
      BOOTSTRAP_STEPS.map(() => 'pending'),
    );
  }, 120_000);

  it('P1: the ref shape — 19 and 21 letters are refused, 20 accepted, only for the supabase provider', async () => {
    resetB();
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const ref20 = Array.from({ length: 20 }, () => letters[Math.floor(Math.random() * 26)]).join(
      '',
    );
    letterRefs.add(ref20);
    const supa = { ...fakeProviderFor(ref20), name: 'supabase' as const };

    for (const bad of [
      ref20.slice(0, 19),
      `${ref20}a`,
      ref20.toUpperCase(),
      `${ref20.slice(0, 19)}1`,
    ]) {
      let caught: unknown;
      try {
        await createTenant(input(newSlug(), bad), actor, { provider: supa });
      } catch (error) {
        caught = error;
      }
      expect((caught as ApiError | undefined)?.details, bad).toEqual({ projectRef: 'invalid' });
    }
    // A ref is REQUIRED with the supabase provider.
    let missing: unknown;
    try {
      await createTenant(input(newSlug()), actor, { provider: supa });
    } catch (error) {
      missing = error;
    }
    expect((missing as ApiError | undefined)?.details).toEqual({ projectRef: 'required' });

    const made = await createTenant(input(newSlug(), ref20), actor, { provider: supa });
    const [project] = await adminSql<{ provider: string; api_url: string }[]>`
      select provider, api_url from platform.projects where id = ${made.projectId}::uuid`;
    expect(project).toEqual({ provider: 'supabase', api_url: `https://${ref20}.supabase.co` });

    // The fake provider takes the looser local form, the supabase provider does not.
    let local: unknown;
    try {
      await createTenant(input(newSlug(), REFS.race), actor, { provider: supa });
    } catch (error) {
      local = error;
    }
    expect((local as ApiError | undefined)?.details).toEqual({ projectRef: 'invalid' });
  }, 120_000);

  it('outside production any number of tenants bind one project, and the overview reports the others', async () => {
    resetB();
    const first = await createTenant(input(newSlug(), REFS.shared), actor, {
      provider,
      production: false,
    });
    expect(await runBootstrap(first.projectId, bootstrapDeps(provider))).toEqual({
      status: 'ready',
    });

    // A second and a third tenant on the same READY project: filled inline, no new bootstrap.
    const second = await createTenant(input(newSlug(), REFS.shared), actor, {
      provider,
      production: false,
    });
    const third = await createTenant(input(newSlug(), REFS.shared), actor, {
      provider,
      production: false,
    });
    expect(second.projectId).toBe(first.projectId);
    expect(third.projectId).toBe(first.projectId);
    const [binding] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from platform.tenant_projects where project_id = ${first.projectId}::uuid`;
    expect(binding?.n).toBe(3);
    const jobs = await adminSql<{ n: number }[]>`
      select count(*)::int as n from pgboss_platform.job_common
       where name = ${QUEUE} and data->>'projectId' = ${first.projectId}`;
    expect(jobs[0]?.n).toBe(1);

    // The inline tenants exist in the project itself, with their first-admin invite and no creator.
    await onB(async (b) => {
      const rows = await b<{ id: string; created_by: string | null }[]>`
        select t.id, i.created_by from public.tenants t
          join public.tenant_invites i on i.tenant_id = t.id
         where t.id in (${second.id}::uuid, ${third.id}::uuid)`;
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.created_by === null)).toBe(true);
    });

    const overview = databaseOverviewSchema.parse(
      await (await platform(`/tenants/${second.id}/database`)).json(),
    );
    expect(overview.otherTenants).toBe(2);
    expect(overview.state).toMatch(/^(ready|unchecked)$/);
  }, 180_000);

  it('P3: two creates racing for one ref in production leave exactly one tenant bound; the loser leaves no row', async () => {
    resetB();
    const slugs = [newSlug(), newSlug()] as const;
    const results = await Promise.allSettled(
      slugs.map((slug) =>
        createTenant(input(slug, REFS.race), actor, { provider, production: true }),
      ),
    );
    const winners = results.filter((r) => r.status === 'fulfilled');
    const losers = results.filter((r) => r.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(((losers[0] as PromiseRejectedResult).reason as ApiError).details).toEqual({
      projectRef: 'in_use',
    });

    const [project] = await adminSql<{ id: string }[]>`
      select id from platform.projects where ref = ${REFS.race}`;
    const state = await snapshot(project?.id ?? '');
    expect(state.bindings).toHaveLength(1);
    expect(state.steps).toHaveLength(8);
    expect(state.jobs).toBe(1);
    const [tenants] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.tenants where slug in (${slugs[0]}, ${slugs[1]})`;
    expect(tenants?.n).toBe(1);
    const [modules] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.tenant_modules
       where tenant_id in (select id from public.tenants where slug in (${slugs[0]}, ${slugs[1]}))`;
    expect(modules?.n).toBeGreaterThan(0);
    const [projects] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from platform.projects where ref = ${REFS.race}`;
    expect(projects?.n).toBe(1);
  }, 120_000);
});

function fakeProviderFor(ref: string): FakeProjectProvider {
  return createFakeProjectProvider({ targets: { [ref]: fakeTarget() } });
}

// ---------------------------------------------------------------------------------------------------------
// 09.4-09 Task 1 (tracer): the customer-token pre-check (CTK-01, D-566, D-570, D-571, D-572)
// ---------------------------------------------------------------------------------------------------------

describe('POST /v1/platform/projects/precheck with a customer token (09.4-09, CTK-01)', () => {
  const tokenOf = (name: string): string => `sbp_fc_fake_pre_${name}_${RUN}_zzzzzzzzzzzz`;
  const T = {
    fresh: tokenOf('fresh'),
    manual: tokenOf('manual'),
    migrated: tokenOf('migrated'),
    bucketed: tokenOf('bucketed'),
    paused: tokenOf('paused'),
    tabled: tokenOf('tabled'),
    unknown: tokenOf('unknown'),
    dead: tokenOf('dead'),
    forbidden: tokenOf('forbidden'),
    everything: tokenOf('everything'),
    never: tokenOf('never-issued'),
  };
  const tokenScopes = () => ({
    [T.fresh]: { refs: [REFS.fresh] },
    [T.manual]: { refs: [REFS.manual] },
    [T.migrated]: { refs: [REFS.migrated] },
    [T.bucketed]: { refs: [REFS.bucketed] },
    [T.paused]: { refs: [REFS.paused] },
    [T.tabled]: { refs: [REFS.tabled] },
    [T.unknown]: { refs: [REFS.unknown] },
    [T.dead]: { refs: [REFS.fresh], state: 'dead' as const },
    [T.forbidden]: { refs: [REFS.fresh], state: 'forbidden' as const },
    [T.everything]: { refs: 'all' as const },
  });
  const makeWorld = (extra: Partial<FakeProjectProviderOptions> = {}) =>
    makeProvider({ orgSlug: 'acme-pre', tokens: tokenScopes(), ...extra });

  let world: FakeProjectProvider = makeWorld();
  beforeEach(() => {
    captured.lines.length = 0;
    world = makeWorld();
    setProjectProviderForTests(world);
  });
  afterEach(() => {
    setProjectProviderForTests(provider);
  });

  const customer = async (
    projectRef: string,
    token: string,
    extra: Record<string, unknown> = {},
  ) => {
    const res = await platform('/projects/precheck', {
      method: 'POST',
      body: { projectRef, owner: 'customer', token, ...extra },
    });
    const text = await res.text();
    return {
      res,
      text,
      answer: res.status === 200 ? precheckAnswerSchema.parse(JSON.parse(text)) : null,
    };
  };

  it('CTK-01 customer: a good project-scoped token on an empty project is ok, no manual access', async () => {
    const { res, answer } = await customer(REFS.fresh, T.fresh);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(answer).toEqual({ ok: true, manualAccess: false });
    // Every provider call of the check went through the customer token, none through the platform's.
    expect(world.calls.tokenUses.filter((use) => use.kind === 'platform')).toEqual([]);
    expect(world.calls.tokenUses.some((use) => use.kind === 'customer')).toBe(true);
  });

  it('CTK-01 customer: a token the provider does not know answers token_invalid', async () => {
    expect((await customer(REFS.fresh, T.never)).answer).toEqual({
      ok: false,
      reason: 'token_invalid',
    });
    expect((await customer(REFS.fresh, T.dead)).answer).toEqual({
      ok: false,
      reason: 'token_invalid',
    });
  });

  it('CTK-01 customer: a token for another project, or one the provider forbids, answers token_forbidden', async () => {
    expect((await customer(REFS.fresh, T.manual)).answer).toEqual({
      ok: false,
      reason: 'token_forbidden',
    });
    expect((await customer(REFS.fresh, T.forbidden)).answer).toEqual({
      ok: false,
      reason: 'token_forbidden',
    });
  });

  it('CTK-01 customer: an account-wide token and a string without the scoped prefix answer token_account_wide', async () => {
    expect((await customer(REFS.fresh, T.everything)).answer).toEqual({
      ok: false,
      reason: 'token_account_wide',
    });
    expect((await customer(REFS.fresh, `sbp_0123456789abcdef_${RUN}`)).answer).toEqual({
      ok: false,
      reason: 'token_account_wide',
    });
  });

  it('CTK-01 customer: a past, malformed or too distant expiry answers token_expiry_invalid', async () => {
    for (const tokenExpiresAt of ['2020-01-01', '2026-13-45', 'amanha', '2099-01-01']) {
      expect(
        (await customer(REFS.fresh, T.fresh, { tokenExpiresAt })).answer,
        tokenExpiresAt,
      ).toEqual({ ok: false, reason: 'token_expiry_invalid' });
    }
  });

  it('CTK-01 customer: an unknown project is not_found and a check that could not run is unchecked', async () => {
    expect((await customer(REFS.unknown, T.unknown)).answer).toEqual({
      ok: false,
      reason: 'not_found',
    });
    setProjectProviderForTests(makeWorld({ failAt: { step: 'verify', times: 'always' } }));
    expect((await customer(REFS.fresh, T.fresh)).answer).toEqual({
      ok: false,
      reason: 'unchecked',
    });
  });

  it('CTK-01 customer: the emptiness and paused checks run through the customer provider', async () => {
    expect((await customer(REFS.paused, T.paused)).answer).toEqual({ ok: false, reason: 'paused' });
    expect((await customer(REFS.migrated, T.migrated)).answer).toEqual({
      ok: false,
      reason: 'not_empty',
    });
    expect((await customer(REFS.bucketed, T.bucketed)).answer).toEqual({
      ok: false,
      reason: 'not_empty',
    });
    await onB((b) => b`create table public.pp_customer_leftover (id int)`);
    try {
      expect((await customer(REFS.tabled, T.tabled)).answer).toEqual({
        ok: false,
        reason: 'not_empty',
      });
    } finally {
      await onB((b) => b`drop table public.pp_customer_leftover`);
    }
    expect(world.calls.tokenUses.filter((use) => use.kind === 'platform')).toEqual([]);
  });

  it('CTK-01 customer: a 403 on the key list is token_forbidden (D-569); keys listed without values still ask for manual access', async () => {
    world.forbidReveal(true);
    expect((await customer(REFS.manual, T.manual)).answer).toEqual({
      ok: false,
      reason: 'token_forbidden',
    });

    const masking = (inner: ProjectProvider): ProjectProvider => ({
      ...inner,
      async listApiKeys(ref) {
        return (await inner.listApiKeys(ref)).map(({ value: _value, ...key }) => key);
      },
    });
    const viewed = makeWorld().forToken(T.manual);
    expect(
      await precheckProject(REFS.manual, {
        provider: masking(viewed),
        production: false,
        owner: 'customer',
        token: T.manual,
      }),
    ).toMatchObject({ ok: true, manualAccess: true });
  });

  it('CTK-14 customer: no pre-check answer is ever token_other_project or not_pro (D-572)', async () => {
    const seen = new Set<string>();
    const cases: Array<[string, string, Record<string, unknown>?]> = [
      [REFS.fresh, T.fresh],
      [REFS.fresh, T.never],
      [REFS.fresh, T.manual],
      [REFS.fresh, T.everything],
      [REFS.fresh, T.fresh, { tokenExpiresAt: '2020-01-01' }],
      [REFS.unknown, T.unknown],
      [REFS.paused, T.paused],
      [REFS.migrated, T.migrated],
    ];
    for (const [ref, token, extra] of cases) {
      const { answer } = await customer(ref, token, extra);
      seen.add(answer && !answer.ok ? answer.reason : 'ok');
    }
    expect(seen.has('token_other_project')).toBe(false);
    expect(seen.has('not_pro')).toBe(false);
  });

  it('CTK-01 customer: a platform body is unchanged and a platform body carrying a token is a 400', async () => {
    const platformBody = await platform('/projects/precheck', {
      method: 'POST',
      body: { projectRef: REFS.fresh },
    });
    expect(platformBody.status).toBe(200);
    expect(precheckAnswerSchema.parse(await platformBody.json())).toEqual({
      ok: true,
      manualAccess: false,
    });
    for (const body of [
      { projectRef: REFS.fresh, token: T.fresh },
      { projectRef: REFS.fresh, owner: 'platform', token: T.fresh },
      { projectRef: REFS.fresh, tokenExpiresAt: '2027-01-01' },
    ]) {
      const res = await platform('/projects/precheck', { method: 'POST', body });
      expect(res.status).toBe(400);
      expect((await envelope(res)).code).toBe('VALIDATION_FAILED');
    }
    // A platform pre-check never used a customer token.
    expect(world.calls.tokenUses.filter((use) => use.kind === 'customer')).toEqual([]);
  });

  it('CTK-01 customer: the answer, every log line and the fake calls hold neither the token nor its first 8 characters', async () => {
    const outcomes = [
      await customer(REFS.fresh, T.fresh),
      await customer(REFS.fresh, T.dead),
      await customer(REFS.fresh, T.everything),
      await customer(REFS.migrated, T.migrated),
    ];
    const scanned = [
      ...outcomes.map((outcome) => outcome.text),
      ...captured.lines,
      JSON.stringify(world.calls),
    ].join('\n');
    for (const token of [T.fresh, T.dead, T.everything, T.migrated]) {
      expect(scanned).not.toContain(token);
      expect(scanned).not.toContain(token.slice(0, 8));
    }
    for (const outcome of outcomes) {
      const keys = Object.keys(JSON.parse(outcome.text) as Record<string, unknown>).sort();
      expect(['manualAccess,ok', 'ok,reason']).toContain(keys.join(','));
    }
  });
});

// ---------------------------------------------------------------------------------------------------------
// 09.4-09 Task 3: the platform path byte for byte, the reserved reasons, the disclosure sweep, atomicity
// ---------------------------------------------------------------------------------------------------------

describe('customer creation guarantees (09.4-09, CTK-01, CTK-14, D-566, D-572, T-09.4-31)', () => {
  const ORG = `acme-sweep-${RUN}`.slice(0, 40);
  const tokenOf = (name: string): string => `sbp_fc_fake_sw_${name}_${RUN}_wwwwwwwwwwwwww`;
  const SWEEP = `sbp_fc_fake_sweep_${RUN}_${'x'.repeat(40)}`.slice(0, 40);
  const T = {
    sweep: SWEEP,
    plan: tokenOf('plan'),
    atomic: tokenOf('atomic'),
    other: tokenOf('other'),
    everything: tokenOf('everything'),
  };
  const R = {
    sweep: newRef('sweep'),
    plan: newRef('plan'),
    atomic: newRef('atomic'),
    platform: newRef('plat'),
  };

  const makeWorld = (): FakeProjectProvider =>
    makeProvider({
      orgSlug: ORG,
      targets: Object.fromEntries(Object.values(R).map((ref) => [ref, fakeTarget()])) as never,
      tokens: {
        [T.sweep]: { refs: [R.sweep] },
        [T.plan]: { refs: [R.plan] },
        [T.atomic]: { refs: [R.atomic] },
        [T.other]: { refs: [REFS.fresh] },
        [T.everything]: { refs: 'all' },
      },
    });
  // The shared helper maps its own refs only; the refs of this block are added through `targets` above.
  let world: FakeProjectProvider = makeWorld();

  beforeEach(() => {
    captured.lines.length = 0;
    world = makeWorld();
    setProjectProviderForTests(world);
    resetB();
  }, 180_000);
  afterEach(async () => {
    setProjectProviderForTests(provider);
    await adminSql`delete from platform.project_token_events where project_ref like ${`pp-%-${RUN}-%`}`;
  });

  type Row = Record<string, unknown>;
  const projectOf = async (ref: string) => {
    const [row] = await adminSql<
      {
        id: string;
        owner: string;
        org_slug: string | null;
        mgmt_token_sealed: string | null;
        mgmt_token_expires_at: string | null;
        plan: string | null;
      }[]
    >`
      select id::text as id, owner, org_slug, mgmt_token_sealed,
             mgmt_token_expires_at::text as mgmt_token_expires_at, plan
        from platform.projects where ref = ${ref}`;
    return row ?? null;
  };
  const eventsOf = (ref: string) =>
    adminSql<Row[]>`select * from platform.project_token_events where project_ref = ${ref}`;
  const customerBody = (token: string, extra: Record<string, unknown> = {}) => ({
    owner: 'customer',
    token,
    ...extra,
  });

  it('CTK-01 platform: a platform pre-check and creation use only the platform token and leave no pin, token or expiry (D-566)', async () => {
    const check = await platform('/projects/precheck', {
      method: 'POST',
      body: { projectRef: R.platform },
    });
    expect(precheckAnswerSchema.parse(await check.json())).toEqual({
      ok: true,
      manualAccess: false,
    });
    const made = await createViaRoute(R.platform);
    expect(made.res.status).toBe(201);

    const uses = world.calls.tokenUses.filter((use) => use.ref === R.platform);
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.every((use) => use.kind === 'platform')).toBe(true);
    const row = await projectOf(R.platform);
    expect(row).toMatchObject({
      owner: 'platform',
      org_slug: null,
      mgmt_token_sealed: null,
      mgmt_token_expires_at: null,
    });
    expect(await eventsOf(R.platform)).toHaveLength(0);
  }, 180_000);

  it('CTK-14 reserved: token_other_project and not_pro are never emitted, and a customer project created here has no plan (D-572)', async () => {
    // A provider whose projects LOOK like a Free plan: the platform must still not read or claim a plan.
    const withPlan = (inner: ProjectProvider): ProjectProvider =>
      ({
        ...inner,
        async describe(ref: string) {
          return { ...(await inner.describe(ref)), plan: 'free' };
        },
      }) as ProjectProvider;
    const freeShaped = {
      ...world,
      forToken: (token: string, options?: { orgSlug?: string }) =>
        withPlan(world.forToken(token, options)),
    } as unknown as FakeProjectProvider;
    setProjectProviderForTests(freeShaped);

    const seen: string[] = [];
    const precheckCases: Array<[string, string, Record<string, unknown>?]> = [
      [R.plan, T.plan],
      [R.plan, T.sweep],
      [R.plan, T.everything],
      [R.plan, 'nao-e-um-token'],
      [R.plan, T.plan, { tokenExpiresAt: '2020-01-01' }],
    ];
    for (const [ref, token, extra] of precheckCases) {
      const res = await platform('/projects/precheck', {
        method: 'POST',
        body: { projectRef: ref, ...customerBody(token, extra) },
      });
      const answer = precheckAnswerSchema.parse(await res.json());
      seen.push(answer.ok ? 'ok' : answer.reason);
    }
    // Creation refusals carry their reason as the detail value.
    for (const [token, extra] of [
      [T.other, {}],
      [T.everything, {}],
      [T.plan, { tokenExpiresAt: '2020-01-01' }],
    ] as Array<[string, Record<string, unknown>]>) {
      const made = await createViaRoute(R.plan, customerBody(token, extra));
      expect(made.res.status).toBe(400);
      seen.push(...Object.values(errorOf(made).details ?? {}).map(String));
    }
    expect(seen).not.toContain('not_pro');
    expect(seen).not.toContain('token_other_project');
    expect(seen.length).toBeGreaterThan(5);

    const ok = await createViaRoute(R.plan, customerBody(T.plan));
    expect(ok.res.status).toBe(201);
    const row = await projectOf(R.plan);
    expect(row?.owner).toBe('customer');
    expect(row?.plan).toBeNull();
  }, 180_000);

  it('CTK-01 sweep: no response, log line, step row, audit row, health row or job holds the token or its first 8 characters', async () => {
    expect(SWEEP).toHaveLength(40);
    const bodies: string[] = [];

    const check = await platform('/projects/precheck', {
      method: 'POST',
      body: { projectRef: R.sweep, ...customerBody(SWEEP) },
    });
    bodies.push(await check.text());
    expect(check.status).toBe(200);

    const made = await createViaRoute(R.sweep, customerBody(SWEEP));
    bodies.push(made.text);
    expect(made.res.status).toBe(201);
    const project = await projectOf(R.sweep);
    expect(project?.owner).toBe('customer');
    const projectId = project?.id ?? '';

    const { provider: _given, ...deps } = bootstrapDeps(world);
    expect(await runBootstrap(projectId, deps)).toEqual({ status: 'ready' });
    await checkProject(projectId);

    bodies.push(await (await platform(`/tenants/${made.detail?.tenant.id}/database`)).text());
    bodies.push(await (await platform(`/tenants/${made.detail?.tenant.id}`)).text());

    const rows = JSON.stringify({
      project: await adminSql`
        select to_jsonb(p) - 'mgmt_token_sealed' as p from platform.projects p where id = ${projectId}::uuid`,
      steps: await adminSql`
        select * from platform.project_bootstrap_steps where project_id = ${projectId}::uuid`,
      events: await eventsOf(R.sweep),
      health: await adminSql`
        select * from platform.project_health where project_id = ${projectId}::uuid`,
      binding: await adminSql`
        select * from platform.tenant_projects where project_id = ${projectId}::uuid`,
      tenant: await adminSql`
        select * from public.tenants where id = ${made.detail?.tenant.id ?? ''}::uuid`,
      jobs: await adminSql`
        select data from pgboss_platform.job where data->>'projectId' = ${projectId}`,
    });
    const everything = [...bodies, rows, ...captured.lines, JSON.stringify(world.calls)].join('\n');
    // The corpus is real: the run wrote logs, step rows, a health row and an audit event to look through.
    expect(captured.lines.length).toBeGreaterThan(5);
    const parsed = JSON.parse(rows) as Record<string, unknown[]>;
    expect(parsed.steps?.length).toBeGreaterThan(0);
    expect(parsed.health?.length).toBeGreaterThan(0);
    expect(parsed.events).toHaveLength(1);
    expect(everything).not.toContain(SWEEP);
    expect(everything).not.toContain(SWEEP.slice(0, 8));
    // And the one place it IS: sealed, openable only with its own AAD.
    expect(open(project?.mgmt_token_sealed as string, `${projectId}:mgmt_token`)).toBe(SWEEP);
  }, 240_000);

  it('CTK-01 atomic: a creation that fails after the project insert leaves no project row and no event', async () => {
    // A tenant with this slug already exists, so the tenants insert (after the project row and the event were
    // written in the same transaction) hits the unique index and the whole transaction rolls back.
    const first = await createViaRoute(R.platform);
    expect(first.res.status).toBe(201);
    const taken = await createViaRoute(R.atomic, {
      ...customerBody(T.atomic),
      slug: first.slug,
    });
    expect(taken.res.status).toBe(400);
    expect(errorOf(taken).details).toEqual({ slug: 'taken' });
    expect(await projectOf(R.atomic)).toBeNull();
    expect(await eventsOf(R.atomic)).toHaveLength(0);
    const [steps] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from platform.project_bootstrap_steps
       where project_id in (select id from platform.projects where ref = ${R.atomic})`;
    expect(steps?.n).toBe(0);
  }, 180_000);
});

// ---------------------------------------------------------------------------------------------------------
// 09.4-13 Task 1 (tracer): the Banco overview names the owner, the pinned organisation and the token summary
// (CTK-34, CTK-14, D-571, D-572, UI-D-552)
// ---------------------------------------------------------------------------------------------------------

describe('GET /v1/platform/tenants/{id}/database for a customer project (09.4-13, CTK-34, CTK-14)', () => {
  const ORG = `acme-ovw-${RUN}`.slice(0, 40);
  const addDays = (day: string, n: number): string => {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  };

  /** A tenant bound to a throwaway project, built from central rows only (the overview reads the registry). */
  async function seedProject(opts: {
    owner: 'platform' | 'customer';
    check?: 'ok' | 'invalid' | 'forbidden' | 'org_mismatch' | null;
    expiresAt?: string | null;
    withHealth?: boolean;
  }) {
    const projectId = crypto.randomUUID();
    const tenantId = crypto.randomUUID();
    const ref = newRef('ovw');
    await adminSql.begin(async (tx) => {
      await tx`
        insert into platform.projects (id, ref, provider, credential_source, state, api_url)
        values (${projectId}::uuid, ${ref}, 'fake', 'sealed', 'ready', '')`;
      await tx`
        insert into public.tenants (id, slug, display_name, rules_text, rules_version)
        values (${tenantId}::uuid, ${newSlug()}, 'Comunidade Banco', 'Regras.', 1)`;
      await tx`
        insert into platform.tenant_projects (tenant_id, project_id)
        values (${tenantId}::uuid, ${projectId}::uuid)
        on conflict (tenant_id) do update set project_id = excluded.project_id`;
      if (opts.withHealth !== false) {
        await tx`
          insert into platform.project_health (project_id, status, checked_at, token_check, token_checked_at)
          values (${projectId}::uuid, 'healthy', now(), ${opts.check ?? null},
                  ${opts.check ? new Date() : null})`;
      }
    });
    if (opts.owner === 'customer') {
      await customerSetup.makeCustomerProject(projectId, `sbp_fc_fake_ovw_${RUN}`, ORG);
      if (opts.expiresAt) {
        await adminSql`
          update platform.projects set mgmt_token_expires_at = ${opts.expiresAt}::date
           where id = ${projectId}::uuid`;
      }
    }
    return { projectId, tenantId };
  }

  async function overviewOf(tenantId: string) {
    const res = await platform(`/tenants/${tenantId}/database`);
    expect(res.status).toBe(200);
    const raw = (await res.json()) as Record<string, unknown>;
    return { raw, body: databaseOverviewSchema.parse(raw) };
  }

  it('a checked token 12 days from its expiry reads expiring with the typed date, the pinned slug and the check time', async () => {
    const expiresAt = addDays(todayInSaoPaulo(), 12);
    const { tenantId } = await seedProject({ owner: 'customer', check: 'ok', expiresAt });
    const { body } = await overviewOf(tenantId);
    expect(body.owner).toBe('customer');
    expect(body.organization).toBe(ORG);
    expect(body.token?.state).toBe('expiring');
    expect(body.token?.expiresAt).toBe(expiresAt);
    const checkedAt = body.token?.checkedAt ?? '';
    expect(new Date(checkedAt).toISOString()).toBe(checkedAt);
  });

  it('a never-checked token with no date reads unchecked and has no check time', async () => {
    const { tenantId } = await seedProject({ owner: 'customer', check: null });
    const { body } = await overviewOf(tenantId);
    expect(body.token).toEqual({ state: 'unchecked', expiresAt: null, checkedAt: null });
    const noHealth = await seedProject({ owner: 'customer', withHealth: false });
    expect((await overviewOf(noHealth.tenantId)).body.token?.state).toBe('unchecked');
  });

  it('a stored invalid, forbidden or org_mismatch check reads invalid, no_permission, org_mismatch whatever the date', async () => {
    const dates = [null, addDays(todayInSaoPaulo(), 200), addDays(todayInSaoPaulo(), -3)];
    const expected = {
      invalid: 'invalid',
      forbidden: 'no_permission',
      org_mismatch: 'org_mismatch',
    } as const;
    for (const [check, state] of Object.entries(expected)) {
      for (const expiresAt of dates) {
        const { tenantId } = await seedProject({
          owner: 'customer',
          check: check as keyof typeof expected,
          expiresAt,
        });
        expect((await overviewOf(tenantId)).body.token?.state, `${check} ${expiresAt}`).toBe(state);
      }
    }
  });

  it('a platform project answers owner platform, no organisation and no token, and the rest of the shape is unchanged', async () => {
    const { tenantId } = await seedProject({ owner: 'platform', check: null });
    const { raw, body } = await overviewOf(tenantId);
    expect(body.owner).toBe('platform');
    expect(body.organization).toBeNull();
    expect(body.token).toBeNull();
    expect(Object.keys(raw).sort()).toEqual(
      [
        'credentials',
        'lastCheckedAt',
        'lastErrorCode',
        'moving',
        'organization',
        'otherTenants',
        'owner',
        'plan',
        'preparationFinishedAt',
        'ref',
        'schema',
        'state',
        'steps',
        'token',
      ].sort(),
    );
  });

  it('the plan stays information: null for a customer project; the strict schema refuses a token string key (D-572, UI-D-561)', async () => {
    const { tenantId } = await seedProject({ owner: 'customer', check: 'ok' });
    const { raw, body } = await overviewOf(tenantId);
    expect(body.plan).toBeNull();
    expect(databaseOverviewSchema.safeParse({ ...raw, token: 'sbp_fc_fake_token' }).success).toBe(
      false,
    );
    expect(databaseOverviewSchema.safeParse({ ...raw, tokenValue: 'sbp_x' }).success).toBe(false);
    const text = JSON.stringify(raw);
    expect(text).not.toContain(`sbp_fc_fake_ovw_${RUN}`);
  });

  it('a dead token with a working pool never becomes a database fact: state and lastErrorCode match a working token', async () => {
    const working = await seedProject({ owner: 'customer', check: 'ok' });
    const dead = await seedProject({ owner: 'customer', check: 'invalid' });
    const a = (await overviewOf(working.tenantId)).body;
    const b = (await overviewOf(dead.tenantId)).body;
    expect(b.token?.state).toBe('invalid');
    expect(b.state).toBe(a.state);
    expect(b.state).not.toBe('unreachable');
    expect(b.lastErrorCode).toBeNull();
    expect(a.lastErrorCode).toBeNull();
  });
});
