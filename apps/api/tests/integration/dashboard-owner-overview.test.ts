import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import {
  type OwnerOverviewReady,
  ownerContentAnswerSchema,
  ownerEventsAnswerSchema,
  ownerFinanceAnswerSchema,
  ownerOverviewAnswerSchema,
  ownerSupportAnswerSchema,
} from '@rede-social/module-dashboard/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dashboardDay,
  insertEventAt,
  insertFixturePost,
  insertLikeAt,
  insertMembershipAt,
  rebuildDashboard,
  removeDashboardFixtures,
  tenantIdOf,
} from './dashboard-fixture';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * Phase 08.7 — the owner's Visão geral, complete (08.7-12, D-459, D-460, D-461, UI-D-472, UI-D-489
 * a/d, INSIGHT-07, INSIGHT-16, EP-18). The overview COMPOSES its numbers from the area keys of the
 * same snapshot (planning decision 1), so its cards and the areas can never disagree:
 *  - rede-demo (every module on): `attendance`, `orderValue`, `awaiting` and `perPost` equal the
 *    events, finance, support and content answers of the same build; the account is read live;
 *  - rede-lab (feed and events on; store, chat and notifications off): no `orderValue`, no
 *    `awaiting`, no support alert, and the at-risk alert carries no `withPush`;
 *  - EP-18 on four crafted lab events of capacity 100 (90, 89 and 100 confirmed, and one with no
 *    capacity): the bell raises `event_soon` exactly once, for the 90 one, with its live title;
 *  - a crafted lab member whose last action was 33 days ago enters the at-risk alert;
 *  - INSIGHT-16: with the stored `events` key removed, the overview (events on) is `preparing` while
 *    Membros still reads ready.
 */

const PREFIX = `dash87o-${Date.now()}`;
const OVERVIEW = '/v1/dashboard/owner/overview';
const tokens = { demoAdmin: '', labAdmin: '' };
const tenants = { demo: '', lab: '' };
const users = { author: '', risk: '' };
const events = { at90: '', at89: '', at100: '', open: '' };

const request = (path: string, token: string, host: string) =>
  api.request(path, { headers: { [TENANT_HOST_HEADER]: host, authorization: `Bearer ${token}` } });

async function overviewOf(token: string, host: string): Promise<OwnerOverviewReady> {
  const res = await request(OVERVIEW, token, host);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  const body = ownerOverviewAnswerSchema.parse(await res.json());
  if (body.state !== 'ready') throw new Error('expected a ready overview');
  return body;
}

async function readyOf<T extends { state: string }>(
  path: string,
  token: string,
  host: string,
  parse: (body: unknown) => T,
): Promise<Extract<T, { state: 'ready' }>> {
  const res = await request(path, token, host);
  expect(res.status, path).toBe(200);
  const body = parse(await res.json());
  if (body.state !== 'ready') throw new Error(`expected a ready ${path}`);
  return body as Extract<T, { state: 'ready' }>;
}

/** The live account of `tenantId`, counted independently of the service. */
async function independentAccount(tenantId: string) {
  const [row] = await adminSql<{ plan: string; admins: number; staff: number }[]>`
    select t.plan,
           (select count(*)::int from public.memberships m where m.tenant_id = t.id
               and m.role = 'admin_tenant' and m.status = 'active' and m.blocked_at is null
               and m.deleted_at is null) as admins,
           (select count(*)::int from public.memberships m where m.tenant_id = t.id
               and m.role = 'support_tenant' and m.status = 'active' and m.blocked_at is null
               and m.deleted_at is null) as staff
      from public.tenants t where t.id = ${tenantId}::uuid`;
  return row;
}

/**
 * EP-18: the build's `confirmed` is the attendee count at build time (pgTAP 199 pins it). Here the
 * stored `upcoming` list is set to the four crafted events with the boundary counts, so the bell's
 * rule (seats left ≤ 10% of the capacity and ≥ 1) meets exactly these numbers.
 */
async function setLabUpcoming(day: string): Promise<void> {
  const rows = await adminSql<{ id: string; starts_at: string; ends_at: string }[]>`
    select id::text as id,
           to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as starts_at,
           to_char(ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as ends_at
      from public.events
     where id = any (${[events.open, events.at89, events.at100, events.at90]}::uuid[])
     order by starts_at, id`;
  const confirmed: Record<string, number> = {
    [events.open]: 95,
    [events.at89]: 89,
    [events.at100]: 100,
    [events.at90]: 90,
  };
  const upcoming = rows.map((row) => ({
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    format: 'in_person',
    capacity: row.id === events.open ? null : 100,
    confirmed: confirmed[row.id] ?? 0,
    durationMinutes: 120,
  }));
  await adminSql`
    update public.dashboard_snapshots
       set payload = jsonb_set(payload, '{events,upcoming}', ${adminSql.json(upcoming)})
     where tenant_id = ${tenants.lab}::uuid and snapshot_day = ${day}::date`;
}

beforeAll(async () => {
  await removeDashboardFixtures(PREFIX.replace(/-\d+$/, ''));
  tenants.demo = await tenantIdOf('rede-demo');
  tenants.lab = await tenantIdOf('rede-lab');
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);

  users.author = (
    await insertMembershipAt({
      prefix: `${PREFIX}-author`,
      host: 'lab',
      daysAgo: 300,
      localTime: '10:00',
      role: 'support_tenant',
    })
  ).userId;
  // The crafted at-risk member: joined 200 days ago, one like 33 days ago (D-32).
  users.risk = (
    await insertMembershipAt({
      prefix: `${PREFIX}-risk`,
      host: 'lab',
      daysAgo: 200,
      localTime: '10:00',
    })
  ).userId;
  const post = await insertFixturePost({ tenantId: tenants.lab, authorUserId: users.author });
  await insertLikeAt({ tenantId: tenants.lab, userId: users.risk, postId: post, k: 32 });

  // Four upcoming lab events in two days (k = -3), an hour apart.
  const lab = (title: string, localTime: string, capacity: number | null) =>
    insertEventAt({
      tenantId: tenants.lab,
      authorUserId: users.author,
      title,
      format: 'in_person',
      capacity,
      k: -3,
      localTime,
      minutes: 120,
    });
  events.open = await lab(`Sem limite ${PREFIX}`, '09:00', null);
  events.at89 = await lab(`Onze vagas ${PREFIX}`, '10:00', 100);
  events.at100 = await lab(`Lotado ${PREFIX}`, '11:00', 100);
  events.at90 = await lab(`Dez vagas ${PREFIX}`, '12:00', 100);
});

afterAll(async () => {
  await removeDashboardFixtures(PREFIX);
});

describe('08.7 overview', () => {
  it('INSIGHT-07: with every module on, attendance, orderValue, awaiting and perPost equal the area answers of the same snapshot, and the account is live', async () => {
    expect(await rebuildDashboard(tenants.demo)).toBe('built');
    const host = HOSTS.demo;
    const overview = await overviewOf(tokens.demoAdmin, host);
    const eventsArea = await readyOf('/v1/dashboard/owner/events', tokens.demoAdmin, host, (b) =>
      ownerEventsAnswerSchema.parse(b),
    );
    const finance = await readyOf('/v1/dashboard/owner/finance', tokens.demoAdmin, host, (b) =>
      ownerFinanceAnswerSchema.parse(b),
    );
    const support = await readyOf('/v1/dashboard/owner/support', tokens.demoAdmin, host, (b) =>
      ownerSupportAnswerSchema.parse(b),
    );
    const content = await readyOf('/v1/dashboard/owner/content', tokens.demoAdmin, host, (b) =>
      ownerContentAnswerSchema.parse(b),
    );
    for (const area of [eventsArea, finance, support, content]) {
      expect(area.snapshot.day).toBe(overview.snapshot.day);
    }

    expect(overview.attendance).toEqual(eventsArea.attendanceTotals);
    expect(overview.orderValue).toEqual({
      current: finance.totals.current.cents,
      previous: finance.totals.previous.cents,
    });
    expect(overview.awaiting).toEqual(support.awaiting);
    expect(overview.perPost).toEqual({
      posts: content.kpis?.posts.current,
      interactions: content.kpis?.interactions.current,
      previousPosts: content.kpis?.posts.previous,
      previousInteractions: content.kpis?.interactions.previous,
    });

    const account = await independentAccount(tenants.demo);
    expect(overview.account).toEqual(account);
    // The support alert follows the queue exactly (chat on).
    const waiting = overview.alerts.filter((alert) => alert.kind === 'support_waiting');
    expect(waiting).toEqual(
      support.awaiting.count > 0
        ? [
            {
              kind: 'support_waiting',
              conversations: support.awaiting.count,
              oldestHours: support.awaiting.oldestHours,
            },
          ]
        : [],
    );
  });

  it('D-460: with store and chat off (rede-lab) the answer has no orderValue, no awaiting and no support alert', async () => {
    expect(await rebuildDashboard(tenants.lab)).toBe('built');
    const overview = await overviewOf(tokens.labAdmin, HOSTS.lab);
    expect('orderValue' in overview).toBe(false);
    expect('awaiting' in overview).toBe(false);
    expect(overview.alerts.some((alert) => alert.kind === 'support_waiting')).toBe(false);
    // feed and events are on: their keys are present.
    expect(overview.perPost).toBeDefined();
    expect(overview.attendance).toBeDefined();
    expect(overview.account).toEqual(await independentAccount(tenants.lab));
  });

  it('EP-18 (INSIGHT-07 boundary): 90 of 100 confirmed raises event_soon, 89 and 100 do not, an event with no capacity never does — exactly once, with the live title', async () => {
    expect(await rebuildDashboard(tenants.lab)).toBe('built');
    await setLabUpcoming(await dashboardDay(tenants.lab));
    const overview = await overviewOf(tokens.labAdmin, HOSTS.lab);
    const soon = overview.alerts.filter((alert) => alert.kind === 'event_soon');
    expect(soon).toHaveLength(1);
    expect(soon[0]).toMatchObject({
      kind: 'event_soon',
      eventId: events.at90,
      title: `Dez vagas ${PREFIX}`,
      confirmed: 90,
      capacity: 100,
    });

    // The event renamed since the build: the title is read live (PR-1).
    await adminSql`update public.events set title = ${`Renomeado ${PREFIX}`} where id = ${events.at90}::uuid`;
    const renamed = await overviewOf(tokens.labAdmin, HOSTS.lab);
    expect(renamed.alerts.find((alert) => alert.kind === 'event_soon')).toMatchObject({
      title: `Renomeado ${PREFIX}`,
    });

    // Cancelled since the build: no alert names it, and no other event takes its place.
    await adminSql`
      update public.events set status = 'cancelled', cancelled_at = now()
       where id = ${events.at90}::uuid`;
    const cancelled = await overviewOf(tokens.labAdmin, HOSTS.lab);
    expect(cancelled.alerts.some((alert) => alert.kind === 'event_soon')).toBe(false);
  });

  it('UI-D-489 d: a member whose last action was 33 days ago enters the at-risk alert, with no withPush while notifications is off', async () => {
    expect(await rebuildDashboard(tenants.lab)).toBe('built');
    const day = await dashboardDay(tenants.lab);
    const [row] = await adminSql<{ n: number; mine: number }[]>`
      select count(*)::int as n,
             count(*) filter (where s.user_id = ${users.risk}::uuid)::int as mine
        from public.dashboard_member_snapshots s join public.tenants t on t.id = s.tenant_id
       where s.tenant_id = ${tenants.lab}::uuid and s.band = 'at_risk'
         and (s.last_active_at at time zone t.timezone)::date between ${day}::date - 36 and ${day}::date - 30`;
    expect(row?.mine).toBe(1);
    const overview = await overviewOf(tokens.labAdmin, HOSTS.lab);
    const atRisk = overview.alerts.find((alert) => alert.kind === 'entered_at_risk');
    expect(atRisk).toEqual({ kind: 'entered_at_risk', members: row?.n });
  });

  it('INSIGHT-16: with the stored events key removed, the overview is preparing (events on) while Membros still reads ready', async () => {
    expect(await rebuildDashboard(tenants.demo)).toBe('built');
    const day = await dashboardDay(tenants.demo);
    await adminSql`
      update public.dashboard_snapshots set payload = payload - 'events'
       where tenant_id = ${tenants.demo}::uuid and snapshot_day = ${day}::date`;
    const res = await request(OVERVIEW, tokens.demoAdmin, HOSTS.demo);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'preparing' });
    const members = await request('/v1/dashboard/owner/members', tokens.demoAdmin, HOSTS.demo);
    expect(((await members.json()) as { state: string }).state).toBe('ready');
  });
});
