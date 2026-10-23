import { deriveBrandColors } from '@rede-social/contracts';
import {
  localAllowListByProject,
  localAllowListEntries,
} from '@rede-social/core/server/domains/auth-allow-list';
import { allowListEntry } from '@rede-social/core/server/domains/types';
import { checkDomain } from '@rede-social/core/server/platform/domains';
import { reconcileAuthAllowList } from '@rede-social/core/server/platform/reconcile-allow-list';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { adminSql, provisionTenantOnB, type TenantOnB } from './setup';

/**
 * `reconcileAuthAllowList` (quick 261012-s0v; 09.2-11, DBT-42, D-538) against the live local stack with the
 * LOCAL allow-list ledger, one ledger per project. Pins: only VERIFIED `tenant_domains` rows get an
 * `https://<host>/auth/confirm**` entry — a pending host never does; the counts are the verified rows of the
 * ready projects, in total and per project; a second call is idempotent; and, per project (09.2-11), two
 * tenants of one project share ONE list under ONE lock, two projects' lists never cross, a project with no
 * verified host makes no adapter call, hosts are visited in ascending order, an unreachable project counts
 * `failed` without stopping the others, and the domain-verification flow writes the TENANT'S project list.
 *
 * The recording wrapper below sits between the reconcile and the adapter chosen by `authAllowListFor`: it
 * logs every `add` (project, host, order), can make one project fail, and measures how many `add`s of one
 * project ever ran at the same time (the lock makes that 1).
 */

const spy = vi.hoisted(() => ({
  adds: [] as Array<{ projectId: string; host: string }>,
  failFor: new Set<string>(),
  delayMs: 0,
  active: new Map<string, number>(),
  maxActive: new Map<string, number>(),
}));

vi.mock('@rede-social/core/server/domains/index', async (importOriginal) => {
  const original = await importOriginal<typeof import('@rede-social/core/server/domains/index')>();
  return {
    ...original,
    authAllowListFor: ((project: Parameters<typeof original.authAllowListFor>[0]) => {
      const inner = original.authAllowListFor(project);
      return {
        name: inner.name,
        async add(host: string) {
          spy.adds.push({ projectId: project.id, host });
          if (spy.failFor.has(project.id)) throw new Error('management api unreachable');
          const now = (spy.active.get(project.id) ?? 0) + 1;
          spy.active.set(project.id, now);
          spy.maxActive.set(project.id, Math.max(spy.maxActive.get(project.id) ?? 0, now));
          try {
            if (spy.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, spy.delayMs));
            await inner.add(host);
          } finally {
            spy.active.set(project.id, (spy.active.get(project.id) ?? 1) - 1);
          }
        },
        remove: inner.remove.bind(inner),
      };
    }) as typeof original.authAllowListFor,
  };
});

const RUN = Date.now();
const SLUG = `alr-${RUN}`;
const OK_HOST = `alr-${RUN}-ok.cliente.test`;
const PENDING_HOST = `alr-${RUN}-pending.cliente.test`;

let tenantId: string;
let b: TenantOnB;
let c: TenantOnB;
let emptyProjectId = '';
const extraTenants: string[] = [];
const extraDomains: string[] = [];

const resetSpy = () => {
  spy.adds.length = 0;
  spy.failFor.clear();
  spy.delayMs = 0;
  spy.active.clear();
  spy.maxActive.clear();
};

/** Verified hosts of tenants bound to a READY project: what an all-projects reconcile must visit. */
async function verifiedHostCount(): Promise<number> {
  const [row] = await adminSql<{ n: string }[]>`
    select count(*)::text as n
      from public.tenant_domains d
      join platform.tenant_projects tp on tp.tenant_id = d.tenant_id
      join platform.projects p on p.id = tp.project_id and p.state = 'ready'
     where d.verified_at is not null`;
  return Number(row?.n ?? 0);
}

const branding = {
  logoUrl: null,
  faviconUrl: null,
  iconUrl: null,
  iconUrls: null,
  iconVersion: 0,
  colors: deriveBrandColors({ primary: '#1d4ed8', secondary: '#60a5fa' }),
};

/** A central-only tenant with one verified host, bound to `projectId` (it needs no data in the project). */
async function tenantOn(projectId: string, slug: string, host: string): Promise<string> {
  const id = await adminSql.begin(async (tx) => {
    const [tenant] = await tx<{ id: string }[]>`
      insert into public.tenants (slug, display_name, branding)
      values (${slug}, ${`Allow-list ${slug}`}, ${tx.json(branding)})
      returning id`;
    if (!tenant) throw new Error('could not create the throwaway tenant');
    await tx`
      insert into public.tenant_domains (tenant_id, host, is_primary, verified_at, verification_status)
      values (${tenant.id}::uuid, ${host}, true, now(), 'verified')`;
    await tx`
      insert into platform.tenant_projects (tenant_id, project_id)
      values (${tenant.id}::uuid, ${projectId}::uuid)
      on conflict (tenant_id) do update set project_id = excluded.project_id`;
    return tenant.id;
  });
  extraTenants.push(id);
  return id;
}

beforeAll(async () => {
  const [tenant] = await adminSql<{ id: string }[]>`
    insert into public.tenants (slug, display_name, branding)
    values (${SLUG}, ${'Allow-list Reconcile'}, ${adminSql.json(branding)})
    returning id`;
  if (!tenant) throw new Error('could not create the throwaway tenant');
  tenantId = tenant.id;
  await adminSql`
    insert into public.tenant_domains (tenant_id, host, is_primary, verified_at, verification_status)
    values (${tenantId}::uuid, ${OK_HOST}, true, now(), 'verified'),
           (${tenantId}::uuid, ${PENDING_HOST}, false, null, 'pending')`;
  b = await provisionTenantOnB({ slug: `alr-b-${RUN}`.slice(0, 40) });
  c = await provisionTenantOnB({ slug: `alr-c-${RUN}`.slice(0, 40) });
}, 60_000);

afterAll(async () => {
  for (const id of extraDomains)
    await adminSql`delete from public.tenant_domains where id = ${id}::uuid`;
  for (const id of extraTenants) await adminSql`delete from public.tenants where id = ${id}::uuid`;
  if (emptyProjectId)
    await adminSql`delete from platform.projects where id = ${emptyProjectId}::uuid`;
  await b?.cleanup();
  await c?.cleanup();
  // The tenant cascades its domains.
  if (tenantId) await adminSql`delete from public.tenants where id = ${tenantId}::uuid`;
  await adminSql.end();
});

describe('reconcileAuthAllowList', () => {
  it('ensures one entry per VERIFIED host, none for a pending one, and counts every verified row', async () => {
    resetSpy();
    const expectedHosts = await verifiedHostCount();
    expect(expectedHosts).toBeGreaterThanOrEqual(1);

    const result = await reconcileAuthAllowList();

    expect(result).toMatchObject({ hosts: expectedHosts, added: expectedHosts, failed: 0 });
    expect(localAllowListEntries.has(allowListEntry(OK_HOST))).toBe(true);
    expect(localAllowListEntries.has(allowListEntry(PENDING_HOST))).toBe(false);
  });

  it('is idempotent: a second call returns the same counts and the ledger is unchanged', async () => {
    resetSpy();
    const expectedHosts = await verifiedHostCount();
    const before = new Set(localAllowListEntries);

    const result = await reconcileAuthAllowList();

    expect(result).toMatchObject({ hosts: expectedHosts, added: expectedHosts, failed: 0 });
    expect(new Set(localAllowListEntries)).toEqual(before);
    expect(localAllowListEntries.has(allowListEntry(OK_HOST))).toBe(true);
    expect(localAllowListEntries.has(allowListEntry(PENDING_HOST))).toBe(false);
  });
});

describe('one list per project (09.2-11, DBT-42)', () => {
  it('tracer: the hosts of the tenants bound to a project land in THAT project’s list only', async () => {
    resetSpy();
    const result = await reconcileAuthAllowList({ projectId: b.projectId });
    expect(result.projects).toHaveLength(1);
    expect(result).toMatchObject({ hosts: 1, added: 1, failed: 0 });
    const own = localAllowListByProject.get(b.projectId);
    expect(own?.has(allowListEntry(b.host))).toBe(true);
    // Nothing of project B went into project 0's list or into another project's.
    expect(localAllowListByProject.get(c.projectId)?.has(allowListEntry(b.host)) ?? false).toBe(
      false,
    );
    for (const [projectId, set] of localAllowListByProject) {
      if (projectId !== b.projectId) expect(set.has(allowListEntry(b.host))).toBe(false);
    }
  });

  it('two projects’ lists never cross, and a full run reports each project on its own', async () => {
    resetSpy();
    const result = await reconcileAuthAllowList();
    const ofB = result.projects.find((p) => p.projectId === b.projectId);
    const ofC = result.projects.find((p) => p.projectId === c.projectId);
    expect(ofB).toMatchObject({ hosts: 1, added: 1, failed: 0 });
    expect(ofC).toMatchObject({ hosts: 1, added: 1, failed: 0 });
    expect(localAllowListByProject.get(c.projectId)?.has(allowListEntry(c.host))).toBe(true);
    expect(localAllowListByProject.get(c.projectId)?.has(allowListEntry(b.host))).toBe(false);
    expect(localAllowListByProject.get(b.projectId)?.has(allowListEntry(c.host))).toBe(false);
    // The projects are visited in ascending ref order.
    const refs = result.projects.map((p) => p.ref);
    expect([...refs].sort()).toEqual(refs);
  });

  it('two tenants of ONE project share one list, and concurrent reconciles of it never overlap', async () => {
    resetSpy();
    const second = `alr-b2-${RUN}.cliente.test`;
    await tenantOn(b.projectId, `alr-b2-${RUN}`.slice(0, 40), second);

    spy.delayMs = 40;
    const [first, again] = await Promise.all([
      reconcileAuthAllowList({ projectId: b.projectId }),
      reconcileAuthAllowList({ projectId: b.projectId }),
    ]);
    expect(first).toMatchObject({ hosts: 2, failed: 0 });
    expect(again).toMatchObject({ hosts: 2, failed: 0 });
    const own = localAllowListByProject.get(b.projectId);
    expect(own?.has(allowListEntry(b.host))).toBe(true);
    expect(own?.has(allowListEntry(second))).toBe(true);
    // Four adds ran (two hosts, two runs) and the project's lock let exactly one run at a time.
    expect(spy.adds.filter((a) => a.projectId === b.projectId)).toHaveLength(4);
    expect(spy.maxActive.get(b.projectId)).toBe(1);
    // The other project’s list does not hold B's second host.
    expect(localAllowListByProject.get(c.projectId)?.has(allowListEntry(second)) ?? false).toBe(
      false,
    );
  });

  it('visits hosts in ascending order and a second run changes nothing', async () => {
    resetSpy();
    const beforeSets = new Map(
      [...localAllowListByProject].map(([id, set]) => [id, new Set(set)] as const),
    );
    await reconcileAuthAllowList({ projectId: b.projectId });
    const order = spy.adds.filter((a) => a.projectId === b.projectId).map((a) => a.host);
    expect(order).toEqual([...order].sort());
    expect(order.length).toBeGreaterThanOrEqual(2);

    const afterFirst = new Set(localAllowListByProject.get(b.projectId));
    await reconcileAuthAllowList({ projectId: b.projectId });
    expect(new Set(localAllowListByProject.get(b.projectId))).toEqual(afterFirst);
    for (const [id, set] of beforeSets) {
      if (id !== b.projectId) expect(new Set(localAllowListByProject.get(id))).toEqual(set);
    }
  });

  it('a project with no verified host makes no adapter call and reports zeros', async () => {
    resetSpy();
    emptyProjectId = crypto.randomUUID();
    await adminSql`
      insert into platform.projects (id, ref, provider, credential_source, state, api_url, secret_key_id)
      values (${emptyProjectId}::uuid, ${`fk-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`},
              'fake', 'sealed', 'ready', 'http://127.0.0.1:54321', 1)`;
    // A tenant bound to it with only a pending host contributes nothing either.
    const pendingTenant = await tenantOn(
      emptyProjectId,
      `alr-e-${RUN}`.slice(0, 40),
      `alr-e-${RUN}.cliente.test`,
    );
    await adminSql`
      update public.tenant_domains set verified_at = null, verification_status = 'pending'
       where tenant_id = ${pendingTenant}::uuid`;

    const result = await reconcileAuthAllowList({ projectId: emptyProjectId });
    expect(result).toMatchObject({ hosts: 0, added: 0, failed: 0 });
    expect(spy.adds).toHaveLength(0);
    expect(localAllowListByProject.get(emptyProjectId)?.size ?? 0).toBe(0);
  });

  it('an unreachable project counts failed and the other projects are still reconciled', async () => {
    resetSpy();
    localAllowListByProject.delete(b.projectId);
    spy.failFor.add(c.projectId);
    const result = await reconcileAuthAllowList();
    expect(result.projects.find((p) => p.projectId === c.projectId)).toMatchObject({
      hosts: 1,
      added: 0,
      failed: 1,
    });
    expect(result.projects.find((p) => p.projectId === b.projectId)).toMatchObject({
      failed: 0,
    });
    expect(result.failed).toBe(1);
    expect(localAllowListByProject.get(b.projectId)?.has(allowListEntry(b.host))).toBe(true);
  });

  it('an unknown project id reconciles nothing and a project that is not ready is skipped by the full run', async () => {
    resetSpy();
    const none = await reconcileAuthAllowList({ projectId: crypto.randomUUID() });
    expect(none).toMatchObject({ hosts: 0, added: 0, failed: 0 });
    expect(none.projects).toEqual([]);
    expect(spy.adds).toHaveLength(0);

    await adminSql`update platform.projects set state = 'preparing' where id = ${c.projectId}::uuid`;
    try {
      const result = await reconcileAuthAllowList();
      expect(result.projects.some((p) => p.projectId === c.projectId)).toBe(false);
    } finally {
      await adminSql`update platform.projects set state = 'ready' where id = ${c.projectId}::uuid`;
    }
  });

  it('the verification flow of a tenant in another project writes THAT project’s list', async () => {
    resetSpy();
    const host = `alr-verify-${RUN}.cliente.test`;
    const [row] = await adminSql<{ id: string }[]>`
      insert into public.tenant_domains (tenant_id, host, is_primary, verified_at, verification_status)
      values (${c.tenantId}::uuid, ${host}, false, null, 'pending')
      returning id`;
    if (!row) throw new Error('could not insert the pending domain');
    extraDomains.push(row.id);

    const outcome = await checkDomain(row.id, { userId: 'test' }, { source: 'manual' });
    expect(outcome.outcome).toBe('verified');
    expect(localAllowListByProject.get(c.projectId)?.has(allowListEntry(host))).toBe(true);
    expect(localAllowListByProject.get(b.projectId)?.has(allowListEntry(host)) ?? false).toBe(
      false,
    );
    expect(spy.adds.filter((a) => a.host === host).map((a) => a.projectId)).toEqual([c.projectId]);
  });
});
