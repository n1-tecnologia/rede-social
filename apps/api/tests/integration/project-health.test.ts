import { databaseOverviewSchema } from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
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
