import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { registeredSweepFunctions } from '@rede-social/core/server/jobs/sweep-functions';
import {
  armDailyTenantDispatch,
  DAILY_TENANT_DISPATCH_BOOT_SINGLETON,
  DAILY_TENANT_DISPATCH_QUEUE,
  DAILY_TENANT_DISPATCH_SINGLETON,
  runDailyTenantDispatch,
} from '@rede-social/core/server/tenancy/daily-dispatch';
import {
  type OwnerOverviewAnswer,
  ownerOverviewAnswerSchema,
} from '@rede-social/module-dashboard/contracts';
import { runSnapshotBuild } from '@rede-social/module-dashboard/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dashboardDay,
  insertMembershipAt,
  rebuildDashboard,
  removeDashboardFixtures,
  tenantIdOf,
} from './dashboard-fixture';
import {
  adminSql,
  api,
  createSharedIdentity,
  dashboardJobsOf,
  HOSTS,
  runDashboardJobs,
  SEED_PASSWORD,
  signInAs,
} from './setup';

// The app tier's composition: registers `dashboard.snapshot-build` with the kernel dispatcher.
await import('../../src/modules/registry');

/**
 * Phase 08.7 — the dashboard snapshot pipe (D-464, D-462, INSIGHT-06, INSIGHT-07, INSIGHT-15):
 * job body → definer → `dashboard_snapshots` → `GET /v1/dashboard/owner/overview`, on ONE number
 * (the members KPI) before any area builds on it.
 *
 * The numbers are compared with an INDEPENDENT `adminSql` count over the same definitions (08.7-01
 * planning decision 5), and the window edges with memberships dated at explicit tenant-local instants
 * (R-Pitfall 13): the seed writes everything "now", so it cannot tell D-29 from D-30.
 */

const PREFIX = `dash87-${Date.now()}`;
const PATH = '/v1/dashboard/owner/overview';
const tokens = { demoAdmin: '', demoMember: '', demoSupport: '', labAdmin: '' };
const tenants = { demo: '', lab: '' };

type Envelope = { error: { code: string } };

const overviewRequest = (token: string | undefined, host: string) =>
  api.request(PATH, {
    headers: {
      [TENANT_HOST_HEADER]: host,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });

async function readyOverview(token: string, host: string) {
  const res = await overviewRequest(token, host);
  expect(res.status).toBe(200);
  const body = ownerOverviewAnswerSchema.parse(await res.json()) as OwnerOverviewAnswer;
  if (body.state !== 'ready') throw new Error('expected a ready overview');
  return body;
}

/** The members KPI of `tenantId` for day `day`, computed independently of the builder. */
async function independentMembers(tenantId: string, day: string) {
  const [row] = await adminSql<{ count: number; new_members: number; previous: number }[]>`
    with b as (
      select ((${day}::date - 29)::timestamp at time zone t.timezone) as from30,
             ((${day}::date + 1)::timestamp at time zone t.timezone) as until
        from public.tenants t where t.id = ${tenantId}::uuid)
    select
      (select count(*)::int from public.memberships m, b
        where m.tenant_id = ${tenantId}::uuid and m.role = 'member' and m.status = 'active'
          and m.blocked_at is null and m.deleted_at is null and m.joined_at < b.until) as count,
      (select count(*)::int from public.memberships m, b
        where m.tenant_id = ${tenantId}::uuid and m.role = 'member' and m.status = 'active'
          and m.blocked_at is null and m.deleted_at is null
          and m.joined_at >= b.from30 and m.joined_at < b.until) as new_members,
      (select count(*)::int from public.memberships m, b
        where m.tenant_id = ${tenantId}::uuid and m.role = 'member' and m.status <> 'invited'
          and m.deleted_at is null and m.joined_at < b.from30
          and (m.blocked_at is null or m.blocked_at >= b.from30)) as previous`;
  if (!row) throw new Error('independent count failed');
  return { count: row.count, newMembers: row.new_members, previous: row.previous };
}

beforeAll(async () => {
  await removeDashboardFixtures(PREFIX.replace(/-\d+$/, ''));
  tenants.demo = await tenantIdOf('rede-demo');
  tenants.lab = await tenantIdOf('rede-lab');
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.demoSupport = await signInAs('support@rede-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
});

afterAll(async () => {
  await removeDashboardFixtures(PREFIX);
  await stopBoss();
  await adminSql.end();
});

describe('08.7 tracer', () => {
  it('EP-15: with no snapshot the admin reads 200 { state: preparing } with no number key, no-store', async () => {
    await adminSql`delete from public.dashboard_snapshots where tenant_id = ${tenants.demo}::uuid`;
    const res = await overviewRequest(tokens.demoAdmin, HOSTS.demo);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ state: 'preparing' });
  });

  it('INSIGHT-07: after one build for the tenant-local yesterday the read is ready, with the independent counts', async () => {
    const day = await dashboardDay(tenants.demo);
    expect(await rebuildDashboard(tenants.demo)).toBe('built');
    const body = await readyOverview(tokens.demoAdmin, HOSTS.demo);
    expect(body.snapshot.day).toBe(day);
    expect(Number.isFinite(Date.parse(body.snapshot.builtAt))).toBe(true);
    expect(body.snapshot.windows.day).toBe(day);
    expect(body.members).toEqual(await independentMembers(tenants.demo, day));
    expect(body.members.count).toBeGreaterThan(0);
    // EP-19: raw non-negative integers, no delta and no other key.
    expect(Object.keys(body.members).sort()).toEqual(['count', 'newMembers', 'previous']);
    for (const value of Object.values(body.members)) expect(Number.isInteger(value)).toBe(true);
  });

  it('EP-50: a member joined at 02:30Z today (23:30 of D in São Paulo) counts; one joined at local 00:30 today does not', async () => {
    const day = await dashboardDay(tenants.demo);
    expect(await rebuildDashboard(tenants.demo)).toBe('built');
    const before = (await readyOverview(tokens.demoAdmin, HOSTS.demo)).members;

    const late = await insertMembershipAt({
      prefix: `${PREFIX}-late`,
      host: 'demo',
      daysAgo: 1,
      localTime: '23:30',
    });
    // The seed tenants are São Paulo (UTC-3 all year): 23:30 local of D is 02:30Z.
    expect(late.joinedAtUtc.slice(11, 16)).toBe('02:30');
    await insertMembershipAt({
      prefix: `${PREFIX}-today`,
      host: 'demo',
      daysAgo: 0,
      localTime: '00:30',
    });

    expect(await rebuildDashboard(tenants.demo)).toBe('built');
    const after = (await readyOverview(tokens.demoAdmin, HOSTS.demo)).members;
    expect(after.count).toBe(before.count + 1);
    expect(after.newMembers).toBe(before.newMembers + 1);
    expect(after.previous).toBe(before.previous);
    expect(after).toEqual(await independentMembers(tenants.demo, day));
  });

  it('EP-51: Window30 is D-29..D — joined at local 00:00 of D-29 is new; 23:59 of D-30 is not new and is in previous', async () => {
    expect(await rebuildDashboard(tenants.demo)).toBe('built');
    const before = (await readyOverview(tokens.demoAdmin, HOSTS.demo)).members;

    // D = today - 1, so D-29 = today - 30 and D-30 = today - 31.
    await insertMembershipAt({
      prefix: `${PREFIX}-d29`,
      host: 'demo',
      daysAgo: 30,
      localTime: '00:00',
    });
    await insertMembershipAt({
      prefix: `${PREFIX}-d30`,
      host: 'demo',
      daysAgo: 31,
      localTime: '23:59',
    });

    expect(await rebuildDashboard(tenants.demo)).toBe('built');
    const after = (await readyOverview(tokens.demoAdmin, HOSTS.demo)).members;
    expect(after.count).toBe(before.count + 2);
    expect(after.newMembers).toBe(before.newMembers + 1);
    expect(after.previous).toBe(before.previous + 1);
  });

  it('staff never count, and a member blocked before D-29 is out of count and previous', async () => {
    expect(await rebuildDashboard(tenants.demo)).toBe('built');
    const before = (await readyOverview(tokens.demoAdmin, HOSTS.demo)).members;
    await insertMembershipAt({
      prefix: `${PREFIX}-staff`,
      host: 'demo',
      daysAgo: 40,
      localTime: '10:00',
      role: 'support_tenant',
    });
    await insertMembershipAt({
      prefix: `${PREFIX}-blocked`,
      host: 'demo',
      daysAgo: 50,
      localTime: '10:00',
      blockedDaysAgo: 45,
      blockedLocalTime: '10:00',
    });
    // Blocked inside the window: out of count, still in previous (the base 30 days before).
    await insertMembershipAt({
      prefix: `${PREFIX}-blocked-late`,
      host: 'demo',
      daysAgo: 50,
      localTime: '10:00',
      blockedDaysAgo: 5,
      blockedLocalTime: '10:00',
    });
    expect(await rebuildDashboard(tenants.demo)).toBe('built');
    const after = (await readyOverview(tokens.demoAdmin, HOSTS.demo)).members;
    expect(after.count).toBe(before.count);
    expect(after.newMembers).toBe(before.newMembers);
    expect(after.previous).toBe(before.previous + 1);
  });

  it('EP-53: a second build of the same (tenant, day) is skipped and leaves built_at and payload unchanged', async () => {
    const day = await dashboardDay(tenants.demo);
    expect(await rebuildDashboard(tenants.demo)).toBe('built');
    const [first] = await adminSql<{ built_at: Date; payload: unknown }[]>`
      select built_at, payload from public.dashboard_snapshots
       where tenant_id = ${tenants.demo}::uuid and snapshot_day = ${day}::date`;
    expect(await runSnapshotBuild({ tenantId: tenants.demo, day })).toBe('skipped');
    const [second] = await adminSql<{ built_at: Date; payload: unknown }[]>`
      select built_at, payload from public.dashboard_snapshots
       where tenant_id = ${tenants.demo}::uuid and snapshot_day = ${day}::date`;
    expect(second?.built_at.toISOString()).toBe(first?.built_at.toISOString());
    expect(second?.payload).toEqual(first?.payload);
  });

  it('EP-53: the API always reads the row with the newest snapshot_day', async () => {
    const day = await dashboardDay(tenants.demo);
    expect(await rebuildDashboard(tenants.demo)).toBe('built');
    // An older day (a failed night kept for diagnostics) must never win over the newest.
    await adminSql`
      insert into public.dashboard_snapshots
             (tenant_id, snapshot_day, payload_version, built_at, windows, payload)
      select tenant_id, snapshot_day - 3, payload_version, built_at - interval '3 days', windows,
             jsonb_build_object('overview', jsonb_build_object('members',
               jsonb_build_object('count', 999999, 'newMembers', 0, 'previous', 0)))
        from public.dashboard_snapshots
       where tenant_id = ${tenants.demo}::uuid and snapshot_day = ${day}::date`;
    const body = await readyOverview(tokens.demoAdmin, HOSTS.demo);
    expect(body.snapshot.day).toBe(day);
    expect(body.members.count).not.toBe(999999);
  });

  it('the builder refuses the tenant-local today (22023): the job raises so pg-boss retries, and nothing is written', async () => {
    const [today] = await adminSql<{ day: string }[]>`
      select (now() at time zone t.timezone)::date::text as day
        from public.tenants t where t.id = ${tenants.demo}::uuid`;
    const error = await runSnapshotBuild({ tenantId: tenants.demo, day: today?.day ?? '' }).then(
      () => null,
      (err: unknown) => err as { code?: string; cause?: { code?: string } },
    );
    expect(error?.cause?.code ?? error?.code).toBe('22023');
    const rows = await adminSql`
      select 1 from public.dashboard_snapshots
       where tenant_id = ${tenants.demo}::uuid and snapshot_day = ${today?.day ?? ''}::date`;
    expect(rows).toHaveLength(0);
  });

  it('EP-13: the rede-demo member and support team get 403 FORBIDDEN, no session 401', async () => {
    for (const token of [tokens.demoMember, tokens.demoSupport]) {
      const res = await overviewRequest(token, HOSTS.demo);
      expect(res.status).toBe(403);
      expect(((await res.json()) as Envelope).error.code).toBe('FORBIDDEN');
    }
    const anonymous = await overviewRequest(undefined, HOSTS.demo);
    expect(anonymous.status).toBe(401);
  });

  it('EP-14: a shared identity, admin in rede-demo and member in rede-lab, reads 200 on the demo host and 403 on the lab host; the demo admin on the lab host is TENANT_HOST_MISMATCH', async () => {
    expect(await rebuildDashboard(tenants.demo)).toBe('built');
    const shared = await createSharedIdentity({
      prefix: `${PREFIX}-shared`,
      memberships: [
        { host: 'demo', role: 'admin_tenant' },
        { host: 'lab', role: 'member' },
      ],
    });
    const token = await signInAs(shared.email, shared.password);
    const demo = await overviewRequest(token, HOSTS.demo);
    expect(demo.status).toBe(200);
    expect(((await demo.json()) as { state: string }).state).toBe('ready');

    const lab = await overviewRequest(token, HOSTS.lab);
    expect(lab.status).toBe(403);
    expect(((await lab.json()) as Envelope).error.code).toBe('FORBIDDEN');

    const wrongHost = await overviewRequest(tokens.demoAdmin, HOSTS.lab);
    expect(wrongHost.status).toBe(403);
    expect(((await wrongHost.json()) as Envelope).error.code).toBe('TENANT_HOST_MISMATCH');
  });

  it('EP-15: the lab admin’s answer is its own tenant’s (preparing without a lab snapshot, never the demo row)', async () => {
    await adminSql`delete from public.dashboard_snapshots where tenant_id = ${tenants.lab}::uuid`;
    expect(await rebuildDashboard(tenants.demo)).toBe('built');
    const res = await overviewRequest(tokens.labAdmin, HOSTS.lab);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'preparing' });
  });
});

/** Every job of the two queues the dispatcher touches is removed, so each case starts clean. */
async function clearDispatchJobs(): Promise<void> {
  await adminSql`
    delete from pgboss.job_common
     where name in ('dashboard.snapshot-build', ${DAILY_TENANT_DISPATCH_QUEUE})`;
}

type DispatchJobRow = { state: string; singleton_key: string | null; start_after: Date };

async function dispatchJobs(): Promise<DispatchJobRow[]> {
  return adminSql<DispatchJobRow[]>`
    select state::text as state, singleton_key, start_after
      from pgboss.job_common
     where name = ${DAILY_TENANT_DISPATCH_QUEUE}
     order by created_on`;
}

describe('08.7 dispatch', () => {
  const FIXTURE_SLUG = `dash87-${Date.now()}`;
  const fixtureTenants = { mars: '', suspended: '', tokyo: '' };

  beforeAll(async () => {
    await clearDispatchJobs();
    await adminSql`delete from public.tenants where slug like 'dash87-%'`;
    const insertTenant = async (suffix: string, status: string, timezone: string) => {
      const [row] = await adminSql<{ id: string }[]>`
        insert into public.tenants (slug, display_name, rules_text, rules_version, status, timezone)
        values (${`${FIXTURE_SLUG}-${suffix}`.slice(0, 40)}, 'Painel de teste', 'Regras.', 1,
                ${status}, ${timezone})
        returning id::text as id`;
      return row?.id ?? '';
    };
    fixtureTenants.mars = await insertTenant('mars', 'active', 'Mars/Olympus');
    fixtureTenants.suspended = await insertTenant('susp', 'suspended', 'America/Sao_Paulo');
    fixtureTenants.tokyo = await insertTenant('tokyo', 'active', 'Asia/Tokyo');
  });

  afterAll(async () => {
    await clearDispatchJobs();
    await adminSql`delete from public.dashboard_snapshots where tenant_id in (
      select id from public.tenants where slug like 'dash87-%')`;
    await adminSql`delete from public.tenants where slug like 'dash87-%'`;
  });

  it('EP-57: one build job per active tenant for its own SQL yesterday, keyed <tenantId>:<day>, plus one deferred re-arm', async () => {
    await clearDispatchJobs();
    const result = await runDailyTenantDispatch();
    expect(result.enqueued).toBeGreaterThanOrEqual(3);
    for (const tenantId of [tenants.demo, tenants.lab, fixtureTenants.tokyo]) {
      const day = await dashboardDay(tenantId);
      const jobs = await dashboardJobsOf(tenantId);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.state).toBe('created');
      expect(jobs[0]?.singleton_key).toBe(`${tenantId}:${day}`);
      expect(jobs[0]?.data).toEqual({ tenantId, day });
    }
    // The Tokyo tenant's day is Tokyo's yesterday, whatever São Paulo's is.
    const [tokyo] = await adminSql<{ day: string }[]>`
      select ((now() at time zone 'Asia/Tokyo')::date - 1)::text as day`;
    expect((await dashboardJobsOf(fixtureTenants.tokyo))[0]?.data.day).toBe(tokyo?.day);

    const rearm = await dispatchJobs();
    expect(rearm).toHaveLength(1);
    expect(rearm[0]?.state).toBe('created');
    expect(rearm[0]?.singleton_key).toBe(DAILY_TENANT_DISPATCH_SINGLETON);
    const aheadS = ((rearm[0]?.start_after.getTime() ?? 0) - Date.now()) / 1000;
    expect(aheadS).toBeGreaterThan(3300);
    expect(aheadS).toBeLessThan(3700);
  });

  it('EP-56: a tenant with an invalid timezone or a suspended one gets no job, while the seed tenants still do', async () => {
    expect(await dashboardJobsOf(fixtureTenants.mars)).toHaveLength(0);
    expect(await dashboardJobsOf(fixtureTenants.suspended)).toHaveLength(0);
    expect(await dashboardJobsOf(tenants.demo)).toHaveLength(1);
    expect(await dashboardJobsOf(tenants.lab)).toHaveLength(1);
  });

  it('EP-55: a second dispatch while the builds are still created leaves exactly one job per tenant and day', async () => {
    const result = await runDailyTenantDispatch();
    expect(result.skipped).toBeGreaterThanOrEqual(2);
    expect(await dashboardJobsOf(tenants.demo)).toHaveLength(1);
    expect(await dashboardJobsOf(tenants.lab)).toHaveLength(1);
    expect(await dashboardJobsOf(fixtureTenants.tokyo)).toHaveLength(1);
    const pending = (await dispatchJobs()).filter((row) => row.state === 'created');
    expect(pending).toHaveLength(1);
  });

  it('EP-53: the dispatched job builds the row, and a dispatch plus run after it reports the build skipped', async () => {
    const day = await dashboardDay(tenants.demo);
    await adminSql`
      delete from public.dashboard_snapshots
       where tenant_id = ${tenants.demo}::uuid and snapshot_day = ${day}::date`;
    expect(await runDashboardJobs(tenants.demo)).toEqual(['built']);
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.dashboard_snapshots
       where tenant_id = ${tenants.demo}::uuid and snapshot_day = ${day}::date`;
    expect(row?.n).toBe(1);

    await runDailyTenantDispatch();
    expect(await runDashboardJobs(tenants.demo)).toEqual(['skipped']);
  });

  it('EP-55: the boot arm queues its own job even while the hourly re-arm is pending', async () => {
    expect(
      (await dispatchJobs()).some((row) => row.singleton_key === DAILY_TENANT_DISPATCH_SINGLETON),
    ).toBe(true);
    expect(await armDailyTenantDispatch()).toBe(true);
    const created = (await dispatchJobs()).filter((row) => row.state === 'created');
    expect(created.map((row) => row.singleton_key).sort()).toEqual(
      [DAILY_TENANT_DISPATCH_BOOT_SINGLETON, DAILY_TENANT_DISPATCH_SINGLETON].sort(),
    );
    // A second boot arm while the first is still waiting is the dropped duplicate.
    expect(await armDailyTenantDispatch()).toBe(false);
  });
});

/**
 * 08.7-12 (D-464 retention, INSIGHT-19, EP-63, T-08.7-25): `app.dashboard_snapshots_prune` is a
 * REGISTERED sweep function, so the kernel's hourly sweeper runs it in the admin lane. The calls
 * below go through the registered name exactly as the sweeper does (`select app.<name>(<batch>)` as
 * `service_role`), with a batch of 4 instead of 500 so the batching is visible.
 */
describe('08.7 retention', () => {
  const NAME = 'dashboard_snapshots_prune';

  /** One sweeper-shaped call of the registered name, as `service_role` (the admin lane). */
  async function sweepOnce(batch: number): Promise<number> {
    const name = registeredSweepFunctions().find((entry) => entry === NAME);
    if (!name) throw new Error(`${NAME} is not registered`);
    return adminSql.begin(async (tx) => {
      await tx`set local role service_role`;
      const [row] = await tx.unsafe<{ n: number | null }[]>(`select app.${name}($1::int) as n`, [
        batch,
      ]);
      return Number(row?.n ?? 0);
    });
  }

  /** Every snapshot older than its tenant's cut is swept first (a previous run's leftovers). */
  async function drain(): Promise<void> {
    for (let call = 0; call < 50; call += 1) {
      if ((await sweepOnce(500)) < 500) return;
    }
  }

  /** The lab's snapshot days, as days before its local today. */
  async function labAges(): Promise<number[]> {
    const rows = await adminSql<{ age: number }[]>`
      select ((now() at time zone t.timezone)::date - s.snapshot_day)::int as age
        from public.dashboard_snapshots s join public.tenants t on t.id = s.tenant_id
       where s.tenant_id = ${tenants.lab}::uuid
       order by 1`;
    return rows.map((row) => row.age);
  }

  afterAll(async () => {
    await adminSql`delete from public.dashboard_snapshots where tenant_id = ${tenants.lab}::uuid`;
  });

  it('the app registry registered dashboard_snapshots_prune for the hourly sweeper', () => {
    expect(registeredSweepFunctions()).toContain(NAME);
  });

  it('EP-63: with no old snapshot the sweep returns 0 and deletes nothing', async () => {
    await drain();
    expect(await rebuildDashboard(tenants.lab)).toBe('built');
    const [before] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.dashboard_snapshots`;
    expect(await sweepOnce(500)).toBe(0);
    const [after] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.dashboard_snapshots`;
    expect(after?.n).toBe(before?.n);
  });

  it('EP-63: ten old rows and a batch of 4 — successive calls return 4, 4, 2, 0; a week of diagnostics stays', async () => {
    await drain();
    await adminSql`delete from public.dashboard_snapshots where tenant_id = ${tenants.lab}::uuid`;
    // Ten rows 9..18 days before the lab's local today, and the rows of 8 days ago and of yesterday.
    await adminSql`
      insert into public.dashboard_snapshots (tenant_id, snapshot_day, payload_version, windows, payload)
      select ${tenants.lab}::uuid, (now() at time zone t.timezone)::date - g, 1, '{}', '{}'
        from public.tenants t, generate_series(8, 18) as g
       where t.id = ${tenants.lab}::uuid`;
    expect(await rebuildDashboard(tenants.lab)).toBe('built');
    expect(await labAges()).toEqual([1, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);

    expect([
      await sweepOnce(4),
      await sweepOnce(4),
      await sweepOnce(4),
      await sweepOnce(4),
    ]).toEqual([4, 4, 2, 0]);
    expect(await labAges()).toEqual([1, 8]);

    // The overview still reads the newest row: the sweep never touches the day being served.
    expect((await readyOverview(tokens.labAdmin, HOSTS.lab)).state).toBe('ready');
  });
});
