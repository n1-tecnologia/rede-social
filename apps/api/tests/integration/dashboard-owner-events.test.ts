import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import {
  type OwnerEventsReady,
  ownerEventsAnswerSchema,
} from '@rede-social/module-dashboard/contracts';
import { runSnapshotBuild } from '@rede-social/module-dashboard/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dashboardDay,
  insertEventAt,
  insertMembershipAt,
  rebuildDashboard,
  removeDashboardFixtures,
  tenantIdOf,
} from './dashboard-fixture';
import { adminSql, api, createSharedIdentity, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * Phase 08.7 — the owner's Eventos on real data (08.7-08, D-455, D-460, D-461, UI-D-489 c,
 * INSIGHT-06, INSIGHT-11, EP-16, EP-32..EP-36). The seed's events sit in the current window, so the
 * exact cases build rede-lab for an OLD day L = D-60, whose window and whose next six events hold
 * only crafted rows: L's "today" (L+1) is D-59, its Window30 is D-89..D-60, its Prev30 D-119..D-90.
 * Every attendee row is dated from its event's own start (`insertEventAt`), so the band each
 * presence is counted under — the member's band on the day before the event — is fixed:
 * a member whose only action in X-29..X is an RSVP is `occasional`, one with no action `inactive`,
 * one who joined within 30 days of X `new`.
 */

const PREFIX = `dash87e-${Date.now()}`;
const EVENTS = '/v1/dashboard/owner/events';

const tokens = { demoAdmin: '', demoMember: '', demoSupport: '', labAdmin: '' };
const tenants = { demo: '', lab: '' };
const users = {
  labStaff: '',
  demoStaff: '',
  m1: '',
  m2: '',
  m3: '',
  m4: '',
  m5: '',
  m6: '',
  n1: '',
};
const ids = {
  ua: '',
  ub: '',
  uc: '',
  ud: '',
  ue: '',
  uf: '',
  ug: '',
  pa: '',
  pb: '',
  pt1: '',
  pt2: '',
  pc: '',
  px: '',
  live: '',
};
/** L = D-60 as an ISO date, the old day rede-lab is built for. */
let labDay = '';

const request = (path: string, token: string | undefined, host: string) =>
  api.request(path, {
    headers: {
      [TENANT_HOST_HEADER]: host,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });

async function eventsOf(token: string, host: string): Promise<OwnerEventsReady> {
  const res = await request(EVENTS, token, host);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  const body = ownerEventsAnswerSchema.parse(await res.json());
  if (body.state !== 'ready') throw new Error('expected a ready events answer');
  return body;
}

async function codeOf(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { error?: { code?: string } }).error?.code;
}

/** `day` (an ISO date) minus `k` days. */
function dayMinus(day: string, k: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() - k);
  return at.toISOString().slice(0, 10);
}

/** Rebuilds rede-lab for the explicit OLD day `day` (its newest snapshot afterwards). */
async function buildLabFor(day: string): Promise<void> {
  await adminSql`delete from public.dashboard_snapshots where tenant_id = ${tenants.lab}::uuid`;
  expect(await runSnapshotBuild({ tenantId: tenants.lab, day })).toBe('built');
}

/** Turns `events` OFF for rede-demo; the returned function restores the previous state. */
async function withDemoEventsOff() {
  const [previous] = await adminSql<{ enabled: boolean }[]>`
    select enabled from public.tenant_modules
     where tenant_id = ${tenants.demo}::uuid and module_key = 'events'`;
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${tenants.demo}::uuid, 'events', false)
    on conflict (tenant_id, module_key) do update set enabled = false, updated_at = now()`;
  moduleFlags.invalidate(tenants.demo);
  return async () => {
    if (previous) {
      await adminSql`
        update public.tenant_modules set enabled = ${previous.enabled}, updated_at = now()
         where tenant_id = ${tenants.demo}::uuid and module_key = 'events'`;
    } else {
      await adminSql`
        delete from public.tenant_modules
         where tenant_id = ${tenants.demo}::uuid and module_key = 'events'`;
    }
    moduleFlags.invalidate(tenants.demo);
  };
}

beforeAll(async () => {
  await removeDashboardFixtures(PREFIX.replace(/-\d+$/, ''));
  tenants.demo = await tenantIdOf('rede-demo');
  tenants.lab = await tenantIdOf('rede-lab');
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.demoSupport = await signInAs('support@rede-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  labDay = dayMinus(await dashboardDay(tenants.lab), 60);

  // The events' author is staff: its own walk-in is an attendee row, never a member presence.
  users.labStaff = (
    await createSharedIdentity({
      prefix: `${PREFIX}-labstaff`,
      memberships: [{ host: 'lab', role: 'support_tenant' }],
    })
  ).userId;
  users.demoStaff = (
    await createSharedIdentity({
      prefix: `${PREFIX}-demostaff`,
      memberships: [{ host: 'demo', role: 'support_tenant' }],
    })
  ).userId;
  for (const name of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'] as const) {
    const member = await insertMembershipAt({
      prefix: `${PREFIX}-${name}`,
      host: 'lab',
      daysAgo: 200,
      localTime: '10:00',
    });
    users[name] = member.userId;
  }
  // n1 joined at L-10 (today - 71): `new` on the day before L's events.
  users.n1 = (
    await insertMembershipAt({
      prefix: `${PREFIX}-n1`,
      host: 'lab',
      daysAgo: 71,
      localTime: '10:00',
    })
  ).userId;

  const lab = (
    title: string,
    k: number,
    localTime: string,
    extra: Partial<Parameters<typeof insertEventAt>[0]> = {},
  ) =>
    insertEventAt({
      tenantId: tenants.lab,
      authorUserId: users.labStaff,
      title,
      format: 'in_person',
      capacity: 10,
      k,
      localTime,
      minutes: 120,
      ...extra,
    });

  // Upcoming for L (L+1 = D-59 is "today"): UA at its local 00:00 (EP-32), full with 2 of 2 (EP-33);
  // UB online with no capacity (EP-34) and a "não vou" that never counts; UC and UD at the same
  // instant (EP-35: id asc); UE, UF; UG is the seventh and is not listed (EP-32).
  ids.ua = await lab('Evento UA', 59, '00:00', {
    capacity: 2,
    attendances: [
      { userId: users.m1, status: 'going' },
      { userId: users.m2, status: 'going' },
    ],
  });
  ids.ub = await lab('Evento UB', 59, '10:00', {
    format: 'online',
    capacity: null,
    minutes: 60,
    attendances: [
      { userId: users.m3, status: 'going' },
      { userId: users.m4, status: 'not_going' },
    ],
  });
  ids.uc = await lab('Evento UC', 58, '12:00');
  ids.ud = await lab('Evento UD', 58, '12:00');
  ids.ue = await lab('Evento UE', 57, '12:00');
  ids.uf = await lab('Evento UF', 56, '12:00');
  ids.ug = await lab('Evento UG', 55, '12:00');

  // Past for L (Window30 = D-89..D-60): PA at L 23:59 (EP-32), 3 confirmed of 3 (two check-ins and
  // a no-show), three walk-ins (m5, n1 and the staff author); PB online at 00:00 of L-29 (EP-32 in);
  // PT1 and PT2 at the same instant (EP-35: id desc); PC cancelled; PX at 23:59 of L-30 (Prev30).
  ids.pa = await lab('Evento PA', 60, '23:59', {
    capacity: 3,
    attendances: [
      { userId: users.m1, status: 'checked_in' },
      { userId: users.m2, status: 'checked_in' },
      { userId: users.m3, status: 'going' },
      { userId: users.m5, status: 'walk_in' },
      { userId: users.n1, status: 'walk_in' },
      { userId: users.labStaff, status: 'walk_in' },
    ],
  });
  ids.pb = await lab('Evento PB', 89, '00:00', {
    format: 'online',
    capacity: null,
    minutes: 90,
    attendances: [{ userId: users.m6, status: 'checked_in' }],
  });
  ids.pt1 = await lab('Evento PT1', 75, '12:00', { capacity: null });
  ids.pt2 = await lab('Evento PT2', 75, '12:00', { capacity: null });
  ids.pc = await lab('Evento PC', 70, '12:00', { cancelled: true });
  ids.px = await lab('Evento PX', 90, '23:59', {
    capacity: 5,
    attendances: [{ userId: users.m4, status: 'checked_in' }],
  });
});

afterAll(async () => {
  await removeDashboardFixtures(PREFIX);
});

describe('08.7 events', () => {
  it('INSIGHT-11: the next events, soonest first, at most six, with confirmed at build time and the live titles (EP-32, EP-33, EP-34, EP-35)', async () => {
    await buildLabFor(labDay);
    const body = await eventsOf(tokens.labAdmin, HOSTS.lab);
    const [first, second] = [ids.uc, ids.ud].sort();
    expect(body.upcoming.map((event) => event.id)).toEqual([
      ids.ua,
      ids.ub,
      first,
      second,
      ids.ue,
      ids.uf,
    ]);
    expect(body.upcoming.map((event) => event.id)).not.toContain(ids.ug);
    const [ua, ub] = body.upcoming;
    expect(ua).toMatchObject({
      title: 'Evento UA',
      format: 'in_person',
      capacity: 2,
      confirmed: 2,
      durationMinutes: 120,
      coverAssetId: null,
      ticketCents: { measured: false, reason: 'needs_event_tickets' },
      revenue: { measured: false, reason: 'needs_event_tickets' },
    });
    // EP-33: confirmed = capacity leaves no seat; EP-34: no capacity, no seats-left figure.
    expect((ua?.capacity ?? 0) - (ua?.confirmed ?? 0)).toBe(0);
    expect(ub).toMatchObject({
      format: 'online',
      capacity: null,
      confirmed: 1,
      durationMinutes: 60,
    });
    // EP-32: the event at local 00:00 of L+1 starts exactly at the snapshot's untilAt.
    expect(Date.parse(ua?.startsAt ?? '')).toBe(Date.parse(body.snapshot.windows.untilAt));
    expect(body.waitlist).toEqual({ measured: false, reason: 'needs_waitlist' });
  });

  it("INSIGHT-11: the window's past events, most recent first, with check-ins and walk-ins; a cancelled event and one of Prev30 are not listed (EP-32, EP-33, EP-35, EP-36)", async () => {
    await buildLabFor(labDay);
    const body = await eventsOf(tokens.labAdmin, HOSTS.lab);
    const [later, earlier] = [ids.pt1, ids.pt2].sort().reverse();
    expect(body.past.map((event) => event.id)).toEqual([ids.pa, later, earlier, ids.pb]);
    expect(body.past.map((event) => event.id)).not.toContain(ids.pc);
    expect(body.past.map((event) => event.id)).not.toContain(ids.px);
    const pa = body.past[0];
    const pb = body.past[3];
    // EP-33: walk-ins are presences, never confirmed; the full event has confirmed = capacity.
    expect(pa).toMatchObject({
      title: 'Evento PA',
      capacity: 3,
      confirmed: 3,
      checkIns: 2,
      walkIns: 3,
      durationMinutes: 120,
    });
    expect(pb).toMatchObject({
      format: 'online',
      capacity: null,
      confirmed: 1,
      checkIns: 1,
      walkIns: 0,
      durationMinutes: 90,
    });
    // EP-32: 23:59 of L is the last minute before untilAt; 00:00 of L-29 is the window's first.
    expect(Date.parse(body.snapshot.windows.untilAt) - Date.parse(pa?.startsAt ?? '')).toBe(60_000);
    expect(Date.parse(pb?.startsAt ?? '')).toBe(Date.parse(body.snapshot.windows.from30At));
  });

  it("planning decision 3: the totals of the window and of Prev30, and UI-D-489 c: presences by the member's band on the day before the event", async () => {
    await buildLabFor(labDay);
    const body = await eventsOf(tokens.labAdmin, HOSTS.lab);
    expect(body.attendanceTotals).toEqual({
      current: { confirmed: 4, present: 6, walkIns: 3 },
      previous: { confirmed: 1, present: 1, walkIns: 0 },
    });
    // PA: m1 and m2 (an RSVP the day before → occasional), m5 (no action → inactive), n1 (joined
    // 9 days before → new); the staff walk-in has no band. PB: m6 (its RSVP → occasional).
    expect(body.attendanceByBand).toEqual({
      new: 1,
      superfan: 0,
      engaged: 0,
      occasional: 3,
      at_risk: 0,
      inactive: 1,
    });
  });

  it('EP-35: two reads of one snapshot answer the same rows in the same order', async () => {
    await buildLabFor(labDay);
    const one = await eventsOf(tokens.labAdmin, HOSTS.lab);
    const two = await eventsOf(tokens.labAdmin, HOSTS.lab);
    expect(two.upcoming).toEqual(one.upcoming);
    expect(two.past).toEqual(one.past);
  });

  it('EP-34: a window with no event answers past [], every band 0 and zero totals', async () => {
    await buildLabFor(dayMinus(labDay, 200));
    const body = await eventsOf(tokens.labAdmin, HOSTS.lab);
    expect(body.past).toEqual([]);
    expect(body.attendanceByBand).toEqual({
      new: 0,
      superfan: 0,
      engaged: 0,
      occasional: 0,
      at_risk: 0,
      inactive: 0,
    });
    expect(body.attendanceTotals).toEqual({
      current: { confirmed: 0, present: 0, walkIns: 0 },
      previous: { confirmed: 0, present: 0, walkIns: 0 },
    });
  });

  it('PR-1: titles are joined live, and an event cancelled since the build leaves the answer', async () => {
    ids.live = await insertEventAt({
      tenantId: tenants.demo,
      authorUserId: users.demoStaff,
      title: 'Evento ao vivo',
      format: 'in_person',
      capacity: null,
      k: -1,
      localTime: '00:00',
      minutes: 60,
    });
    expect(await rebuildDashboard(tenants.demo)).toBe('built');
    const [stored] = await adminSql<{ payload: string }[]>`
      select (payload -> 'events')::text as payload from public.dashboard_snapshots
       where tenant_id = ${tenants.demo}::uuid order by snapshot_day desc limit 1`;
    expect(stored?.payload).toContain(ids.live);
    expect(stored?.payload).not.toContain('Evento ao vivo');

    expect((await eventsOf(tokens.demoAdmin, HOSTS.demo)).upcoming[0]).toMatchObject({
      id: ids.live,
      title: 'Evento ao vivo',
    });
    await adminSql`update public.events set title = 'Evento renomeado' where id = ${ids.live}::uuid`;
    expect((await eventsOf(tokens.demoAdmin, HOSTS.demo)).upcoming[0]?.title).toBe(
      'Evento renomeado',
    );
    await adminSql`
      update public.events set status = 'cancelled', cancelled_at = now()
       where id = ${ids.live}::uuid`;
    const after = await eventsOf(tokens.demoAdmin, HOSTS.demo);
    expect(after.upcoming.map((event) => event.id)).not.toContain(ids.live);
  });

  it('EP-16 / D-460: with events off the module gate answers first — 404 MODULE_DISABLED for the admin and the support team alike', async () => {
    const restore = await withDemoEventsOff();
    try {
      for (const token of [tokens.demoAdmin, tokens.demoSupport, tokens.demoMember]) {
        const res = await request(EVENTS, token, HOSTS.demo);
        expect(res.status).toBe(404);
        expect(await codeOf(res)).toBe('MODULE_DISABLED');
      }
    } finally {
      await restore();
    }
  });

  it('EP-16: with events on the role gate answers — 403 FORBIDDEN for the support team and a member, 401 with no session, 200 for the admin', async () => {
    for (const token of [tokens.demoSupport, tokens.demoMember]) {
      const res = await request(EVENTS, token, HOSTS.demo);
      expect(res.status).toBe(403);
      expect(await codeOf(res)).toBe('FORBIDDEN');
    }
    const anonymous = await request(EVENTS, undefined, HOSTS.demo);
    expect(anonymous.status).toBe(401);
    expect(await rebuildDashboard(tenants.demo)).toBe('built');
    await eventsOf(tokens.demoAdmin, HOSTS.demo);
  });

  it('preparing before the first build of the tenant', async () => {
    await adminSql`delete from public.dashboard_snapshots where tenant_id = ${tenants.lab}::uuid`;
    const res = await request(EVENTS, tokens.labAdmin, HOSTS.lab);
    expect(res.status).toBe(200);
    expect(ownerEventsAnswerSchema.parse(await res.json())).toEqual({ state: 'preparing' });
  });
});
