import { databaseOverviewSchema } from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
import * as bossSenders from '@rede-social/core/server/jobs/boss';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import type { FakeProjectProvider } from '@rede-social/core/server/projects/fake';
import { checkAllProjects, checkProject } from '@rede-social/core/server/projects/health';
import {
  armProjectHealth,
  PROJECT_HEALTH_BOOT_SINGLETON,
  PROJECT_HEALTH_QUEUE,
  PROJECT_HEALTH_SINGLETON,
  projectHealthJob,
} from '@rede-social/core/server/projects/health-job';
import { setProjectProviderForTests } from '@rede-social/core/server/projects/provider-access';
import {
  type ProjectProvider,
  ProjectProviderError,
} from '@rede-social/core/server/projects/types';
import { REQUIRED_SERVICES } from '@rede-social/core/server/projects/wait';
import { seal } from '@rede-social/core/server/secrets/sealed';
import { centralProjectId, closeAllPools } from '@rede-social/core/server/tenancy/project-registry';
import { resolveTenantHost } from '@rede-social/core/server/tenancy/tenant-host';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as customerSetup from './projects-setup';
import { API_URL, fakeProvider, fakeTarget } from './projects-setup';
import { adminSql, api, ensureSecondDatabase, SEED_PASSWORD, signInAs } from './setup';

/**
 * Phase 09.2-14 (DBT-27, D-543, P58, T-09.2-72): the health of a project, one check and the sweep. Real registry,
 * pools, host cache and queue; the Management API is the FAKE provider (wrapped where a case needs a failure the
 * fake does not model). Nothing here needs `rede_tenant_b` to be anything but present: the ping is `select 1`.
 */

const RUN = Date.now().toString(36);
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';
const TX_B = 'postgres://api_user:postgres@127.0.0.1:54322/rede_tenant_b';
const TX_CLOSED = 'postgres://api_user:postgres@127.0.0.1:1/rede_tenant_b';

let counter = 0;
const refOf = (tag: string): string => {
  counter += 1;
  return `ph-${tag}-${RUN}-${counter}`.slice(0, 40);
};

type Fixture = { projectId: string; tenantId: string; ref: string; host: string };
const live: Fixture[] = [];

/** A project of the given state with a sealed transaction URL, one tenant bound to it and a verified host. */
async function project(
  tag: string,
  options: { state?: string; url?: string; tenant?: boolean } = {},
): Promise<Fixture> {
  const ref = refOf(tag);
  const projectId = crypto.randomUUID();
  const tenantId = crypto.randomUUID();
  const host = `${ref}.localhost`;
  await adminSql.begin(async (tx) => {
    await tx`
      insert into platform.projects
             (id, ref, provider, credential_source, state, api_url, secret_key_id, database_url_tx_sealed)
      values (${projectId}::uuid, ${ref}, 'fake', 'sealed', ${options.state ?? 'ready'}, ${API_URL}, 1,
              ${seal(options.url ?? TX_B, `${projectId}:database_url_tx`)})`;
    if (options.tenant !== false) {
      await tx`
        insert into public.tenants (id, slug, display_name, rules_text, rules_version)
        values (${tenantId}::uuid, ${ref}, 'Tenant health', 'Regras.', 1)`;
      await tx`
        insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
        values (${tenantId}::uuid, ${host}, true, now())`;
      await tx`
        insert into platform.tenant_projects (tenant_id, project_id)
        values (${tenantId}::uuid, ${projectId}::uuid)`;
    }
  });
  const fixture = { projectId, tenantId, ref, host };
  live.push(fixture);
  return fixture;
}

const healthOf = async (projectId: string) => {
  const [row] = await adminSql<
    { status: string; detail_code: string | null; checked_at: Date | null }[]
  >`
    select status, detail_code, checked_at from platform.project_health where project_id = ${projectId}::uuid`;
  return row ?? null;
};

/** A provider whose methods are the fake's, with some replaced. */
function wrap(base: FakeProjectProvider, patch: Partial<ProjectProvider>): ProjectProvider {
  return { ...base, ...patch } as ProjectProvider;
}

async function cleanup(): Promise<void> {
  while (live.length > 0) {
    const f = live.pop();
    if (!f) break;
    await adminSql`delete from public.tenants where id = ${f.tenantId}::uuid`;
    await adminSql`delete from platform.projects where id = ${f.projectId}::uuid`;
  }
  await adminSql`delete from pgboss_platform.job where name = ${PROJECT_HEALTH_QUEUE}`;
}

// A spy over the two invalidations, delegating to the real ones: the cache behaviour stays real.
const spies = vi.hoisted(() => ({
  host: vi.fn<(host: string) => void>(),
  project: vi.fn<(tenantId?: string) => void>(),
}));
vi.mock('@rede-social/core/server/tenancy/tenant-host', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('@rede-social/core/server/tenancy/tenant-host')>();
  return {
    ...real,
    invalidateTenantHost: (host: string) => {
      spies.host(host);
      real.invalidateTenantHost(host);
    },
  };
});
vi.mock('@rede-social/core/server/tenancy/project-registry', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('@rede-social/core/server/tenancy/project-registry')>();
  return {
    ...real,
    invalidateProject: (tenantId?: string) => {
      spies.project(tenantId);
      real.invalidateProject(tenantId);
    },
  };
});

let superAdmin = '';
let centralId = '';

beforeAll(async () => {
  if (!SEED_PASSWORD || !SUPER_ADMIN_PASSWORD) {
    throw new Error(
      'SEED_PASSWORD and SUPER_ADMIN_PASSWORD are required (same values as the seed)',
    );
  }
  await ensureSecondDatabase();
  await adminSql`delete from public.tenants where slug like ${'ph-%'}`;
  await adminSql`delete from platform.projects where ref like ${'ph-%'}`;
  superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  centralId = await centralProjectId();
});

afterEach(async () => {
  spies.host.mockClear();
  spies.project.mockClear();
  setProjectProviderForTests(undefined);
  await cleanup();
});

afterAll(async () => {
  // Project 0 had no health row before this file: leave it that way for the suites that read the host status.
  await adminSql`delete from platform.project_health where project_id = ${centralId}::uuid`;
  await stopBoss();
  await closeAllPools();
  await adminSql.end();
  await sqlClient.end();
});

// ---------------------------------------------------------------------------------------------------------
// One check: the five outcomes
// ---------------------------------------------------------------------------------------------------------

describe('checkProject: the outcomes (DBT-27, P58)', () => {
  it('healthy: the provider says every service is up and the project’s pool answers `select 1`', async () => {
    const f = await project('ok');
    const provider = fakeProvider({ [f.ref]: fakeTarget() });
    const result = await checkProject(f.projectId, { provider });
    expect(result).toMatchObject({
      status: 'healthy',
      detailCode: null,
      previous: null,
      changed: true,
    });
    const row = await healthOf(f.projectId);
    expect(row).toMatchObject({ status: 'healthy', detail_code: null });
    expect(row?.checked_at).toBeInstanceOf(Date);
  });

  it('paused: a paused-class status wins and the pool is not even asked', async () => {
    const f = await project('paused-x');
    const provider = fakeProvider({ [f.ref]: fakeTarget() });
    const ping = vi.fn(async () => undefined);
    const result = await checkProject(f.projectId, { provider, ping });
    expect(result).toMatchObject({ status: 'paused', detailCode: null });
    expect(ping).not.toHaveBeenCalled();
    expect(await healthOf(f.projectId)).toMatchObject({ status: 'paused', detail_code: null });
  });

  it('unreachable by the provider: a failing Management API is unreachable, a refused token is access_denied', async () => {
    const f = await project('prov');
    const base = fakeProvider(
      { [f.ref]: fakeTarget() },
      { failAt: { step: 'verify', times: 'always' } },
    );
    expect(await checkProject(f.projectId, { provider: base })).toMatchObject({
      status: 'unreachable',
      detailCode: 'unreachable',
    });

    const refused = wrap(fakeProvider({ [f.ref]: fakeTarget() }), {
      describe: async () => {
        throw new ProjectProviderError('forbidden', 403);
      },
    });
    expect(await checkProject(f.projectId, { provider: refused })).toMatchObject({
      status: 'unreachable',
      detailCode: 'access_denied',
    });
    expect(await healthOf(f.projectId)).toMatchObject({
      status: 'unreachable',
      detail_code: 'access_denied',
    });
  });

  it('unreachable by an unhealthy service, even when the pool answers', async () => {
    const f = await project('svc');
    const base = fakeProvider({ [f.ref]: fakeTarget() });
    const sick = wrap(base, {
      health: async () => ({
        services: Object.fromEntries(
          REQUIRED_SERVICES.map((name) => [
            name,
            name === 'realtime' ? ('UNHEALTHY' as const) : ('ACTIVE_HEALTHY' as const),
          ]),
        ),
      }),
    });
    expect(
      await checkProject(f.projectId, { provider: sick, ping: async () => undefined }),
    ).toMatchObject({
      status: 'unreachable',
      detailCode: 'unreachable',
    });
  });

  it('unreachable by a closed pool: the provider is fine, the project’s own connection is not', async () => {
    const f = await project('pool', { url: TX_CLOSED });
    const provider = fakeProvider({ [f.ref]: fakeTarget() });
    expect(await checkProject(f.projectId, { provider })).toMatchObject({
      status: 'unreachable',
      detailCode: 'unreachable',
    });
  });

  it('a call that hangs is bounded by the timeout and ends unreachable', async () => {
    const f = await project('hang');
    const hanging = wrap(fakeProvider({ [f.ref]: fakeTarget() }), {
      describe: () => new Promise(() => undefined),
    });
    const started = Date.now();
    const result = await checkProject(f.projectId, { provider: hanging, timeoutMs: 60 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result).toMatchObject({ status: 'unreachable', detailCode: 'unreachable' });
  });

  it('unknown is what a project never checked reads as: no row, `unchecked` in the overview, and a project not ready is not checked', async () => {
    const f = await project('new');
    expect(await healthOf(f.projectId)).toBeNull();
    const view = await api.request(`/v1/platform/tenants/${f.tenantId}/database`, {
      headers: { authorization: `Bearer ${superAdmin}` },
    });
    expect(databaseOverviewSchema.parse(await view.json())).toMatchObject({
      state: 'unchecked',
      lastCheckedAt: null,
    });

    const preparing = await project('prep', { state: 'preparing' });
    const provider = fakeProvider({ [preparing.ref]: fakeTarget() });
    const skipped = await checkProject(preparing.projectId, { provider });
    expect(skipped).toMatchObject({ status: 'unknown', changed: false });
    expect(await healthOf(preparing.projectId)).toBeNull();
    expect(provider.calls.describes[preparing.ref] ?? 0).toBe(0);
    expect(await checkProject(crypto.randomUUID(), { provider })).toBeNull();
  });

  it('project 0 is judged by its pool alone: the Management API is never asked', async () => {
    const calls: string[] = [];
    const strict = new Proxy({} as ProjectProvider, {
      get: (_target, name) => () => {
        calls.push(String(name));
        throw new Error('the central project has no Management API entry');
      },
    });
    const result = await checkProject(centralId, { provider: strict });
    expect(result).toMatchObject({ status: 'healthy' });
    expect(calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// A change drops the caches, a repeat does not
// ---------------------------------------------------------------------------------------------------------

describe('a state CHANGE drops the binding and the host answers of the project’s tenants', () => {
  it('invalidates on the first look and on a change, and only then', async () => {
    const f = await project('chg');
    const good = fakeProvider({ [f.ref]: fakeTarget() });
    const bad = wrap(good, {
      describe: async () => {
        throw new ProjectProviderError('unavailable', 503);
      },
    });

    await checkProject(f.projectId, { provider: good });
    expect(spies.host).toHaveBeenCalledWith(f.host);
    expect(spies.project).toHaveBeenCalled();

    // The same verdict again changes nothing and invalidates nothing.
    spies.host.mockClear();
    spies.project.mockClear();
    const again = await checkProject(f.projectId, { provider: good });
    expect(again).toMatchObject({ status: 'healthy', previous: 'healthy', changed: false });
    expect(spies.host).not.toHaveBeenCalled();
    expect(spies.project).not.toHaveBeenCalled();

    // A different verdict does, and the shell shows it on the very next request.
    expect(await resolveTenantHost(f.host)).toMatchObject({ kind: 'tenant', status: 'active' });
    spies.host.mockClear();
    const worse = await checkProject(f.projectId, { provider: bad });
    expect(worse).toMatchObject({ status: 'unreachable', previous: 'healthy', changed: true });
    expect(spies.host).toHaveBeenCalledWith(f.host);
    expect(await resolveTenantHost(f.host)).toMatchObject({
      kind: 'tenant',
      status: 'unavailable',
    });

    // And back.
    await checkProject(f.projectId, { provider: good });
    expect(await resolveTenantHost(f.host)).toMatchObject({ kind: 'tenant', status: 'active' });
  });
});

// ---------------------------------------------------------------------------------------------------------
// The sweep: order, bounded concurrency, isolation
// ---------------------------------------------------------------------------------------------------------

describe('checkAllProjects (T-09.2-72)', () => {
  it('visits the ready projects in ascending ref, four at a time, and a hanging project delays nobody else', async () => {
    const fixtures: Fixture[] = [];
    for (const tag of ['e', 'a', 'd', 'b', 'f', 'c']) fixtures.push(await project(`sweep-${tag}`));
    await project('sweep-notready', { state: 'preparing' });
    const mine = new Set(fixtures.map((f) => f.projectId));
    const hangRef = [...fixtures].sort((a, b) => (a.ref < b.ref ? -1 : 1))[1];

    let active = 0;
    let maxActive = 0;
    const started: string[] = [];
    const finishedAt = new Map<string, number>();
    const t0 = Date.now();
    const check = vi.fn(async (projectId: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      started.push(projectId);
      try {
        // One project hangs for 400 ms; the others answer at once.
        await new Promise((resolve) =>
          setTimeout(resolve, projectId === hangRef?.projectId ? 400 : 5),
        );
      } finally {
        active -= 1;
        finishedAt.set(projectId, Date.now() - t0);
      }
      return {
        projectId,
        status: 'healthy' as const,
        detailCode: null,
        previous: null,
        changed: false,
      };
    });

    const result = await checkAllProjects({ concurrency: 4, check });

    // Ascending `ref` order of the starts (project 0 and any other ready project are interleaved by ref).
    const ordered = started.filter((id) => mine.has(id));
    const expected = [...fixtures].sort((a, b) => (a.ref < b.ref ? -1 : 1)).map((f) => f.projectId);
    expect(ordered).toEqual(expected);
    // Never more than four checks at once, never the not-ready project.
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(maxActive).toBeGreaterThan(1);
    expect(started.length).toBe(result.checked);
    // The hanging project held ONE slot: every other project finished long before it did.
    const hangDone = finishedAt.get(hangRef?.projectId ?? '') ?? 0;
    const others = [...finishedAt.entries()].filter(([id]) => id !== hangRef?.projectId);
    expect(others.length).toBeGreaterThan(3);
    expect(others.filter(([, at]) => at < hangDone).length).toBe(others.length);
  });

  it('a check that throws counts as failed and never stops the others', async () => {
    const a = await project('iso-a');
    const b = await project('iso-b');
    const seen: string[] = [];
    const check = vi.fn(async (projectId: string) => {
      seen.push(projectId);
      if (projectId === a.projectId) throw new Error('boom');
      return {
        projectId,
        status: 'healthy' as const,
        detailCode: null,
        previous: null,
        changed: true,
      };
    });
    const result = await checkAllProjects({ concurrency: 2, check });
    expect(result.failed).toBe(1);
    expect(seen).toContain(a.projectId);
    expect(seen).toContain(b.projectId);
    expect(result.results.some((r) => r.projectId === b.projectId)).toBe(true);
    expect(result.checked).toBe(result.results.length);
    expect(result.changed).toBe(result.results.length);
  });
});

// ---------------------------------------------------------------------------------------------------------
// The job: re-arms itself every 300 s under a constant key, armed at boot under another
// ---------------------------------------------------------------------------------------------------------

describe('platform.project-health (D-543)', () => {
  const jobs = () =>
    adminSql<{ singleton_key: string | null; delay: number; state: string }[]>`
      select singleton_key,
             extract(epoch from (start_after - created_on))::int as delay,
             state::text as state
        from pgboss_platform.job_common
       where name = ${PROJECT_HEALTH_QUEUE}
       order by created_on`;

  it('is a platform queue named platform.project-health', () => {
    expect(PROJECT_HEALTH_QUEUE).toBe('platform.project-health');
    expect(projectHealthJob.scope).toBe('platform');
    expect(projectHealthJob.name).toBe(PROJECT_HEALTH_QUEUE);
  });

  it('a run checks the ready projects, never throws, and re-arms itself 300 s out under the constant key', async () => {
    const f = await project('job');
    setProjectProviderForTests(fakeProvider({ [f.ref]: fakeTarget() }));
    await expect(projectHealthJob.handler({})).resolves.toBeUndefined();

    expect(await healthOf(f.projectId)).toMatchObject({ status: 'healthy' });
    const queued = await jobs();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ singleton_key: PROJECT_HEALTH_SINGLETON, state: 'created' });
    expect(queued[0]?.delay).toBe(300);

    // A second run while a re-arm waits adds no second waiting job (the short policy keeps one).
    await expect(projectHealthJob.handler({})).resolves.toBeUndefined();
    expect((await jobs()).filter((job) => job.state === 'created')).toHaveLength(1);
  });

  it('the boot arm uses a key that is not the re-arm key, and a duplicate boot arm is dropped', async () => {
    expect(PROJECT_HEALTH_BOOT_SINGLETON).not.toBe(PROJECT_HEALTH_SINGLETON);
    expect(await armProjectHealth()).toBe(true);
    expect(await armProjectHealth()).toBe(false);
    const queued = await jobs();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ singleton_key: PROJECT_HEALTH_BOOT_SINGLETON });
    expect(queued[0]?.delay).toBe(0);
  });

  it('a sweep whose provider fails entirely still ends with rows and a re-arm', async () => {
    const f = await project('jobfail');
    setProjectProviderForTests(
      fakeProvider({ [f.ref]: fakeTarget() }, { failAt: { step: 'verify', times: 'always' } }),
    );
    await expect(projectHealthJob.handler({})).resolves.toBeUndefined();
    expect(await healthOf(f.projectId)).toMatchObject({ status: 'unreachable' });
    expect((await jobs()).some((job) => job.singleton_key === PROJECT_HEALTH_SINGLETON)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------
// 09.4-08 (D-573, D-574, UI-D-551, CTK-17, CTK-18): the token is its own axis, a dead token is not an outage
// ---------------------------------------------------------------------------------------------------------

const TOKEN = 'sbp_fc_fake_health_token';

const tokenRowOf = async (projectId: string) => {
  const [row] = await adminSql<
    {
      status: string;
      detail_code: string | null;
      token_check: string | null;
      token_checked_at: Date | null;
    }[]
  >`
    select status, detail_code, token_check, token_checked_at
      from platform.project_health where project_id = ${projectId}::uuid`;
  return row ?? null;
};

/** A CUSTOMER project (sealed token, pinned organisation) with the fake world that knows its token. */
async function customerProject(
  tag: string,
  options: { orgSlug?: string; url?: string } = {},
): Promise<{ fixture: Fixture; world: FakeProjectProvider }> {
  const fixture = await project(tag, options.url ? { url: options.url } : {});
  await customerSetup.makeCustomerProject(
    fixture.projectId,
    TOKEN,
    options.orgSlug ?? customerSetup.CUSTOMER_ORG,
  );
  const world = customerSetup.customerFakeProvider({ [fixture.ref]: fakeTarget() }, TOKEN);
  setProjectProviderForTests(world);
  return { fixture, world };
}

describe('a dead management token is a token state, never an outage (D-573, UI-D-551, CTK-17)', () => {
  it('a refused token (invalid) with a working pool stays healthy and records token_check invalid', async () => {
    const { fixture, world } = await customerProject('tok-dead');
    await checkProject(fixture.projectId);
    expect(await tokenRowOf(fixture.projectId)).toMatchObject({
      status: 'healthy',
      token_check: 'ok',
    });

    world.setTokenState(TOKEN, 'dead');
    const result = await checkProject(fixture.projectId);
    expect(result).toMatchObject({ status: 'healthy', detailCode: null, changed: false });
    const row = await tokenRowOf(fixture.projectId);
    expect(row).toMatchObject({ status: 'healthy', detail_code: null, token_check: 'invalid' });
    expect(row?.token_checked_at).toBeInstanceOf(Date);
  });

  it('a forbidden token and an organisation mismatch are recorded and stay healthy', async () => {
    const { fixture, world } = await customerProject('tok-forb');
    world.setTokenState(TOKEN, 'forbidden');
    expect(await checkProject(fixture.projectId)).toMatchObject({ status: 'healthy' });
    expect(await tokenRowOf(fixture.projectId)).toMatchObject({
      status: 'healthy',
      token_check: 'forbidden',
    });

    const other = await customerProject('tok-org', { orgSlug: 'another-organisation' });
    expect(await checkProject(other.fixture.projectId)).toMatchObject({ status: 'healthy' });
    expect(await tokenRowOf(other.fixture.projectId)).toMatchObject({
      status: 'healthy',
      detail_code: null,
      token_check: 'org_mismatch',
    });
  });

  it('a working token writes token_check ok, and a paused project with a working token is paused as today', async () => {
    const { fixture } = await customerProject('tok-ok');
    expect(await checkProject(fixture.projectId)).toMatchObject({ status: 'healthy' });
    expect(await tokenRowOf(fixture.projectId)).toMatchObject({ token_check: 'ok' });

    const paused = await customerProject('tok-paused-x');
    expect(await checkProject(paused.fixture.projectId)).toMatchObject({ status: 'paused' });
    expect(await tokenRowOf(paused.fixture.projectId)).toMatchObject({
      status: 'paused',
      token_check: 'ok',
    });
  });

  it('a describe TIMEOUT on a customer project is unreachable and leaves token_check as it was', async () => {
    const { fixture, world } = await customerProject('tok-slow');
    await checkProject(fixture.projectId);
    expect(await tokenRowOf(fixture.projectId)).toMatchObject({ token_check: 'ok' });

    world.setTokenState(TOKEN, 'dead');
    await checkProject(fixture.projectId);
    expect(await tokenRowOf(fixture.projectId)).toMatchObject({ token_check: 'invalid' });

    const hanging = wrap(world, { describe: () => new Promise(() => undefined) });
    const result = await checkProject(fixture.projectId, { provider: hanging, timeoutMs: 60 });
    expect(result).toMatchObject({ status: 'unreachable', detailCode: 'unreachable' });
    // A timeout is not a token verdict: the stored `invalid` is neither rewritten nor cleared.
    expect(await tokenRowOf(fixture.projectId)).toMatchObject({
      status: 'unreachable',
      token_check: 'invalid',
    });
  });

  it('a dead token AND a failing pool is unreachable with code unreachable, never access_denied', async () => {
    const { fixture, world } = await customerProject('tok-pool', { url: TX_CLOSED });
    world.setTokenState(TOKEN, 'dead');
    expect(await checkProject(fixture.projectId)).toMatchObject({
      status: 'unreachable',
      detailCode: 'unreachable',
    });
    expect(await tokenRowOf(fixture.projectId)).toMatchObject({
      status: 'unreachable',
      detail_code: 'unreachable',
      token_check: 'invalid',
    });
  });

  it('a PLATFORM project refused with a forbidden error is still access_denied and writes no token_check', async () => {
    const f = await project('tok-plat');
    const refused = wrap(fakeProvider({ [f.ref]: fakeTarget() }), {
      describe: async () => {
        throw new ProjectProviderError('forbidden', 403);
      },
    });
    expect(await checkProject(f.projectId, { provider: refused })).toMatchObject({
      status: 'unreachable',
      detailCode: 'access_denied',
    });
    expect(await tokenRowOf(f.projectId)).toMatchObject({
      detail_code: 'access_denied',
      token_check: null,
      token_checked_at: null,
    });
  });

  it('a token-only change invalidates neither the binding nor the host answer; a status change still does (D-574)', async () => {
    const { fixture, world } = await customerProject('tok-inval');
    await checkProject(fixture.projectId);
    spies.host.mockClear();
    spies.project.mockClear();

    world.setTokenState(TOKEN, 'dead');
    const result = await checkProject(fixture.projectId);
    expect(result).toMatchObject({ status: 'healthy', changed: false });
    expect(spies.host).not.toHaveBeenCalled();
    expect(spies.project).not.toHaveBeenCalled();
    expect(await resolveTenantHost(fixture.host)).toMatchObject({
      kind: 'tenant',
      status: 'active',
    });

    // The database state is what moves the shell: a failing ping is a status change and invalidates.
    const closed = async () => {
      throw new Error('closed');
    };
    const worse = await checkProject(fixture.projectId, { ping: closed });
    expect(worse).toMatchObject({ status: 'unreachable', changed: true });
    expect(spies.host).toHaveBeenCalledWith(fixture.host);
    expect(spies.project).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------------
// 09.4-08 (D-576, CTK-21): one structured line per change of the token state, ids and states only
// ---------------------------------------------------------------------------------------------------------

/** Every call any logger of the kernel makes in this file, so the scan reads what a person tailing logs sees. */
const logged = vi.hoisted(() => ({ calls: [] as Array<{ bindings: object; args: unknown[] }> }));
vi.mock('@rede-social/core/server/logging', async (importOriginal) => {
  const real = await importOriginal<typeof import('@rede-social/core/server/logging')>();
  const make = (bindings: Record<string, unknown>): unknown => {
    const record = (...args: unknown[]) => {
      logged.calls.push({ bindings, args });
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

const tokenLines = () =>
  logged.calls
    .map((call) => call.args[0] as Record<string, unknown> | undefined)
    .filter((fields) => fields?.event === 'project.token.state_changed');

describe('project.token.state_changed (D-576, CTK-21)', () => {
  it('a check that moves a customer project from ok to invalid writes ONE line of project id, from and to', async () => {
    const { fixture, world } = await customerProject('log-one');
    logged.calls.length = 0;
    await checkProject(fixture.projectId);
    // The first look of a never-checked project reads `unchecked` to the new state once; that is accepted.
    expect(tokenLines()).toEqual([
      {
        event: 'project.token.state_changed',
        projectId: fixture.projectId,
        from: 'unchecked',
        to: 'valid',
      },
    ]);

    logged.calls.length = 0;
    world.setTokenState(TOKEN, 'dead');
    const first = await checkProject(fixture.projectId);
    expect(tokenLines()).toEqual([
      {
        event: 'project.token.state_changed',
        projectId: fixture.projectId,
        from: 'valid',
        to: 'invalid',
      },
    ]);
    expect(first?.token).toEqual({ from: 'valid', to: 'invalid' });

    // The same verdict again changes nothing and says nothing.
    logged.calls.length = 0;
    const again = await checkProject(fixture.projectId);
    expect(tokenLines()).toEqual([]);
    expect(again?.token).toBeNull();
  });

  it('a platform project never writes a token line', async () => {
    logged.calls.length = 0;
    const f = await project('log-plat');
    const result = await checkProject(f.projectId, {
      provider: fakeProvider({ [f.ref]: fakeTarget() }),
    });
    expect(result?.token ?? null).toBeNull();
    expect(tokenLines()).toEqual([]);
  });

  it('nothing the health run logs holds the token, a prefix of it, the organisation or the ref', async () => {
    logged.calls.length = 0;
    const { fixture, world } = await customerProject('log-scan');
    await checkProject(fixture.projectId);
    world.setTokenState(TOKEN, 'dead');
    await checkProject(fixture.projectId);
    world.setTokenState(TOKEN, 'forbidden');
    await checkProject(fixture.projectId);
    expect(tokenLines().length).toBeGreaterThanOrEqual(3);

    const text = JSON.stringify(logged.calls);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('sbp_');
    expect(text).not.toContain(customerSetup.CUSTOMER_ORG);
    expect(text).not.toContain(fixture.ref);
    for (const fields of tokenLines()) {
      expect(Object.keys(fields ?? {}).sort()).toEqual(['event', 'from', 'projectId', 'to']);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------
// 09.4-08 (D-573, D-574, CTK-18, CTK-19): the sweep treats a dead token as a token state, members feel nothing
// ---------------------------------------------------------------------------------------------------------

describe('the sweep with a dead token (CTK-18, CTK-19, T-09.4-27)', () => {
  it('a platform project, a customer with a dead token and a customer with a working token: the dead one stays healthy and nothing is recycled', async () => {
    const platform = await project('sw-plat');
    const dead = await project('sw-dead');
    const live1 = await project('sw-live');
    await customerSetup.makeCustomerProject(dead.projectId, 'sbp_fc_fake_sweep_dead');
    await customerSetup.makeCustomerProject(live1.projectId, 'sbp_fc_fake_sweep_live');
    const world = fakeProvider(
      {
        [platform.ref]: fakeTarget(),
        [dead.ref]: fakeTarget(),
        [live1.ref]: fakeTarget(),
      },
      {
        orgSlug: customerSetup.CUSTOMER_ORG,
        tokens: {
          sbp_fc_fake_sweep_dead: { refs: 'all' },
          sbp_fc_fake_sweep_live: { refs: 'all' },
        },
      },
    );
    world.setTokenState('sbp_fc_fake_sweep_dead', 'dead');
    setProjectProviderForTests(world);

    const versionOf = async (projectId: string) => {
      const [row] = await adminSql<{ credential_version: number }[]>`
        select credential_version from platform.projects where id = ${projectId}::uuid`;
      return row?.credential_version;
    };
    const versionsBefore = [await versionOf(dead.projectId), await versionOf(live1.projectId)];
    const sendersBefore = bossSenders.activeSenders();
    spies.host.mockClear();
    spies.project.mockClear();

    const result = await checkAllProjects();
    expect(result.failed).toBe(0);
    const mine = new Map(
      result.results
        .filter((r) => [platform, dead, live1].some((f) => f.projectId === r.projectId))
        .map((r) => [r.projectId, r]),
    );
    expect(mine.size).toBe(3);
    expect(mine.get(platform.projectId)).toMatchObject({ status: 'healthy', tokenCheck: null });
    expect(mine.get(live1.projectId)).toMatchObject({ status: 'healthy', tokenCheck: 'ok' });
    // The dead token is a token verdict beside a healthy database.
    expect(mine.get(dead.projectId)).toMatchObject({
      status: 'healthy',
      detailCode: null,
      tokenCheck: 'invalid',
    });
    expect(await tokenRowOf(dead.projectId)).toMatchObject({
      status: 'healthy',
      token_check: 'invalid',
    });
    expect(await resolveTenantHost(dead.host)).toMatchObject({ kind: 'tenant', status: 'active' });

    // No credential version moved, so no per-project queue sender or pool was recycled.
    expect([await versionOf(dead.projectId), await versionOf(live1.projectId)]).toEqual(
      versionsBefore,
    );
    expect(bossSenders.activeSenders()).toEqual(sendersBefore);

    // A second sweep with the same dead token changes nothing at all.
    spies.host.mockClear();
    spies.project.mockClear();
    const again = await checkAllProjects();
    expect(again.failed).toBe(0);
    expect(again.results.find((r) => r.projectId === dead.projectId)).toMatchObject({
      changed: false,
      token: null,
    });
    expect(spies.host).not.toHaveBeenCalledWith(dead.host);
  });
});
