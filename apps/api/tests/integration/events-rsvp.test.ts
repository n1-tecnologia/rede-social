import { subscribe } from '@tria/core/server/events/bus';
import type {
  EventDetail,
  EventPage,
  EventRsvp,
  EventSummary,
  RsvpResult,
} from '@tria/module-events/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * EVENT-02 detail and EVENT-03 RSVP end to end against the live local stack and the real seed
 * (06-03): the database is the only authority on WHEN an answer is still allowed.
 *
 * Every event this file needs is created through the ADMIN API (a wall clock in the tenant's zone)
 * and then moved in time through `adminSql`, the planning-decision-4 time-travel sequence: the guard
 * trigger applies to every writer, so a fixture that needs a check-in or a started event first writes
 * what the event allowed at the time, then moves the event. Both hooks sweep this file's own events by
 * title prefix (their attendance rows cascade), so a crashed run cannot poison the next one.
 *
 * What is proved here, each against the real guard:
 *  - the toggle, the repeat answer that writes nothing and emits nothing, and the exact
 *    `event.rsvp` payload (collected through the REAL bus);
 *  - `rsvp_closed` once `starts_at` is in the past, `cancelled`, `attendance_locked`, and the bare
 *    404 (no `details`) for an unknown or foreign id;
 *  - the D-219 counts on the list and the detail for a mixed fixture, and the detail carrying no
 *    other member's identity (its key set, asserted);
 *  - EVENT-01 concurrency, the RSVP-versus-cancel half: a held cancel lock makes the RSVP wait, and
 *    the RSVP then answers 409 `cancelled` with no row written;
 *  - EVENT-03 precision: a created event's `startsAt` ends in `:00.000000Z`.
 *
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order).
 */

type Envelope = {
  error: { code: string; message?: string; details?: unknown; requestId?: string };
};

const tokens = { demoAdmin: '', demoMember: '', labMember: '' };
const tenantIds = { demo: '', lab: '' };
const userIds = { demoMember: '' };

/** The prefix every event THIS FILE writes carries, so the sweep can be exact. */
const TEST_TITLE_PREFIX = 'Evento de presenca';

/** 06-01's seeded upcoming event #1 in each tenant (`scripts/seed.ts` SEED_EVENT_IDS). */
const SEEDED_UPCOMING = {
  demo: '0d000000-0000-4000-8000-000000000e01',
  lab: '0e000000-0000-4000-8000-000000000e01',
};

/** The one member-facing detail key set (D-206, D-207): no URL, no code, no other member. */
const DETAIL_KEYS = [
  'address',
  'confirmedCount',
  'coverAssetId',
  'coverVariantWidths',
  'description',
  'endsAt',
  'format',
  'id',
  'presentCount',
  'startsAt',
  'status',
  'title',
  'venueName',
  'viewerCheckedInAt',
  'viewerRespondedAt',
  'viewerStatus',
];

const request = (path: string, token?: string, init: RequestInit = {}, host = HOSTS.demo) =>
  api.request(path, {
    ...init,
    headers: {
      'x-tenant-host': host,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });

const envelope = async (res: Response) => ((await res.json()) as Envelope).error;

/** `YYYY-MM-DD` of the tenant-local calendar day `offsetDays` from now (the `en-CA` trick). */
function tenantDate(offsetDays: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

/** Creates an in-person event `days` from now at 19:00 through the admin API. */
async function createEvent(suffix: string, days = 3): Promise<EventSummary> {
  const date = tenantDate(days);
  const res = await request('/v1/events', tokens.demoAdmin, {
    method: 'POST',
    body: JSON.stringify({
      title: `${TEST_TITLE_PREFIX} ${suffix}`,
      format: 'in_person',
      venueName: 'Auditorio da sede',
      address: 'Rua das Flores, 100',
      start: { date, time: '19:00' },
      end: { date, time: '21:00' },
    }),
  });
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return (await res.json()) as EventSummary;
}

const rsvp = (eventId: string, answer: string, token = tokens.demoMember, host = HOSTS.demo) =>
  request(
    `/v1/events/${eventId}/rsvp`,
    token,
    { method: 'PUT', body: JSON.stringify({ answer }) },
    host,
  );

async function detail(eventId: string, token = tokens.demoMember): Promise<EventDetail> {
  const res = await request(`/v1/events/${eventId}`, token);
  expect(res.status, `GET /v1/events/${eventId}`).toBe(200);
  return (await res.json()) as EventDetail;
}

/** Every item of one period, walked with the returned cursors. */
async function walk(period: 'upcoming' | 'past'): Promise<EventSummary[]> {
  const seen: EventSummary[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 40; guard++) {
    const query: string = cursor
      ? `?period=${period}&limit=25&cursor=${encodeURIComponent(cursor)}`
      : `?period=${period}&limit=25`;
    const res = await request(`/v1/events${query}`, tokens.demoMember);
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventPage;
    seen.push(...body.items);
    cursor = body.nextCursor;
    if (cursor === null) break;
  }
  return seen;
}

async function attendanceRows(eventId: string) {
  return adminSql<{ user_id: string; status: string; updated_at: string }[]>`
    select user_id, status, updated_at::text from public.event_attendances
     where event_id = ${eventId}::uuid order by user_id`;
}

async function sweep(): Promise<void> {
  await adminSql`delete from public.events where title like ${`${TEST_TITLE_PREFIX}%`}`;
}

/** Every `event.rsvp` this file observed, collected through the REAL bus. */
const received: EventRsvp[] = [];
let unsubscribe: () => void = () => {};

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  tokens.demoAdmin = await signInAs('admin@tria-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@tria-demo.local', SEED_PASSWORD);
  tokens.labMember = await signInAs('member@tria-lab.local', SEED_PASSWORD);
  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('tria-demo', 'tria-lab')`;
  for (const row of rows) {
    if (row.slug === 'tria-demo') tenantIds.demo = row.id;
    if (row.slug === 'tria-lab') tenantIds.lab = row.id;
  }
  const [member] = await adminSql<{ id: string }[]>`
    select id from public.users where email = 'member@tria-demo.local'`;
  userIds.demoMember = member?.id ?? '';
  await sweep();
  unsubscribe = subscribe('event.rsvp', async (payload) => {
    received.push(payload);
  });
});

afterAll(async () => {
  unsubscribe();
  await sweep();
});

describe('events rsvp', () => {
  it('1. Vou, Vou again, Não vou: a repeat writes nothing and emits nothing; each change emits one exact event.rsvp', async () => {
    const event = await createEvent('alternancia');
    const before = received.length;

    const first = await rsvp(event.id, 'going');
    expect(first.status).toBe(200);
    expect((await first.json()) as RsvpResult).toEqual({ status: 'going' });
    const [afterFirst] = await attendanceRows(event.id);
    expect(afterFirst?.status).toBe('going');

    // The same answer again: 200, the row untouched (updated_at), no event.
    const repeat = await rsvp(event.id, 'going');
    expect(repeat.status).toBe(200);
    expect((await repeat.json()) as RsvpResult).toEqual({ status: 'going' });
    const [afterRepeat] = await attendanceRows(event.id);
    expect(afterRepeat?.updated_at).toBe(afterFirst?.updated_at);

    const change = await rsvp(event.id, 'not_going');
    expect(change.status).toBe(200);
    expect((await change.json()) as RsvpResult).toEqual({ status: 'not_going' });

    const mine = received.slice(before).filter((payload) => payload.eventId === event.id);
    expect(mine).toHaveLength(2);
    for (const payload of mine) {
      expect(Object.keys(payload).sort()).toEqual([
        'eventId',
        'previousStatus',
        'startsAt',
        'status',
        'tenantId',
        'userId',
      ]);
    }
    expect(mine[0]).toEqual({
      tenantId: tenantIds.demo,
      eventId: event.id,
      userId: userIds.demoMember,
      status: 'going',
      previousStatus: null,
      startsAt: event.startsAt,
    });
    expect(mine[1]).toMatchObject({ status: 'not_going', previousStatus: 'going' });

    // The detail reflects the viewer's own answer and when it was given.
    const read = await detail(event.id);
    expect(read.viewerStatus).toBe('not_going');
    expect(read.viewerRespondedAt).not.toBeNull();
    expect(read.confirmedCount).toBe(0);
  });

  it('2. rsvp_closed: once starts_at is in the past, the DATABASE refuses the answer (D-204)', async () => {
    const event = await createEvent('encerrada');
    await adminSql`
      update public.events set starts_at = now() - interval '1 minute'
       where id = ${event.id}::uuid`;
    const before = received.length;
    const res = await rsvp(event.id, 'going');
    expect(res.status).toBe(409);
    const error = await envelope(res);
    expect(error.code).toBe('CONFLICT');
    expect(error.details).toEqual({ event: 'rsvp_closed' });
    expect(await attendanceRows(event.id)).toHaveLength(0);
    expect(received.length).toBe(before);
  });

  it('3. cancelled: an answer on a cancelled event is 409 cancelled (D-201)', async () => {
    const event = await createEvent('cancelada');
    await adminSql`
      update public.events set status = 'cancelled', cancelled_at = now()
       where id = ${event.id}::uuid`;
    const res = await rsvp(event.id, 'going');
    expect(res.status).toBe(409);
    expect((await envelope(res)).details).toEqual({ event: 'cancelled' });
    expect(await attendanceRows(event.id)).toHaveLength(0);
  });

  it('4. attendance_locked: once checked in, neither answer rewrites the row', async () => {
    const event = await createEvent('travada');
    // Time travel: the member answered Vou, the event moved into its check-in window, and the member
    // checked in (the 06-05 write, done here as the service would).
    expect((await rsvp(event.id, 'going')).status).toBe(200);
    await adminSql`
      update public.events
         set starts_at = now() + interval '30 minutes', ends_at = now() + interval '2 hours'
       where id = ${event.id}::uuid`;
    await adminSql`
      update public.event_attendances
         set status = 'checked_in', checked_in_at = now(), checkin_via = 'code'
       where event_id = ${event.id}::uuid and user_id = ${userIds.demoMember}::uuid`;

    for (const answer of ['not_going', 'going']) {
      const res = await rsvp(event.id, answer);
      expect(res.status, answer).toBe(409);
      expect((await envelope(res)).details).toEqual({ event: 'attendance_locked' });
    }
    const [row] = await attendanceRows(event.id);
    expect(row?.status).toBe('checked_in');
    const read = await detail(event.id);
    expect(read.viewerStatus).toBe('checked_in');
    expect(read.viewerCheckedInAt).not.toBeNull();
  });

  it('5. an unknown or foreign event is ONE bare 404 on both routes; a malformed id is a 400', async () => {
    const unknown = '0d000000-0000-4000-8000-00000000ffff';
    for (const id of [unknown, SEEDED_UPCOMING.lab]) {
      const read = await request(`/v1/events/${id}`, tokens.demoMember);
      expect(read.status, `GET ${id}`).toBe(404);
      const readError = await envelope(read);
      expect(readError.code).toBe('NOT_FOUND');
      expect(readError.details).toBeUndefined();

      const write = await rsvp(id, 'going');
      expect(write.status, `PUT ${id}`).toBe(404);
      const writeError = await envelope(write);
      expect(writeError.code).toBe('NOT_FOUND');
      expect(writeError.details).toBeUndefined();
    }
    // Nothing was written on the lab's event by the demo member.
    const [lab] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.event_attendances
       where event_id = ${SEEDED_UPCOMING.lab}::uuid and user_id = ${userIds.demoMember}::uuid`;
    expect(lab?.n).toBe(0);

    expect((await request('/v1/events/not-a-uuid', tokens.demoMember)).status).toBe(400);
    expect((await rsvp('not-a-uuid', 'going')).status).toBe(400);
    // A forged status is not an answer.
    const seeded = await createEvent('forjada');
    expect((await rsvp(seeded.id, 'checked_in')).status).toBe(400);
  });

  it('6. D-219: confirmed = going + checked_in, present = checked_in + walk_in, on the list and the detail', async () => {
    const event = await createEvent('contagem');
    const people = await adminSql<{ id: string }[]>`
      select u.id from public.users u
        join public.memberships m on m.user_id = u.id
       where m.tenant_id = ${tenantIds.demo}::uuid
         and u.email <> 'member@tria-demo.local'
       order by u.email
       limit 4`;
    expect(people).toHaveLength(4);
    const [u1, u2, u3, u4] = people.map((row) => row.id);
    // Before the start: two Vou (one of them staff, if the order put the admin here, which counts
    // like anyone's) and one Não vou.
    await adminSql`
      insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at)
      values (${tenantIds.demo}::uuid, ${event.id}::uuid, ${u1 ?? ''}::uuid, 'going', now()),
             (${tenantIds.demo}::uuid, ${event.id}::uuid, ${u2 ?? ''}::uuid, 'going', now()),
             (${tenantIds.demo}::uuid, ${event.id}::uuid, ${u3 ?? ''}::uuid, 'not_going', now())`;
    // Inside the window: u1 checks in, u4 walks in.
    await adminSql`
      update public.events
         set starts_at = now() + interval '30 minutes', ends_at = now() + interval '2 hours'
       where id = ${event.id}::uuid`;
    await adminSql`
      update public.event_attendances
         set status = 'checked_in', checked_in_at = now(), checkin_via = 'code'
       where event_id = ${event.id}::uuid and user_id = ${u1 ?? ''}::uuid`;
    await adminSql`
      insert into public.event_attendances
        (tenant_id, event_id, user_id, status, checked_in_at, checkin_via)
      values (${tenantIds.demo}::uuid, ${event.id}::uuid, ${u4 ?? ''}::uuid, 'walk_in', now(), 'code')`;

    const upcoming = (await walk('upcoming')).find((item) => item.id === event.id);
    expect(upcoming).toMatchObject({ confirmedCount: 2, presentCount: 2, viewerStatus: null });
    const read = await detail(event.id);
    expect(read).toMatchObject({ confirmedCount: 2, presentCount: 2, viewerStatus: null });

    // Once past, the same two numbers ride the past list.
    await adminSql`
      update public.events
         set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour'
       where id = ${event.id}::uuid`;
    const past = (await walk('past')).find((item) => item.id === event.id);
    expect(past).toMatchObject({ confirmedCount: 2, presentCount: 2 });

    // The seeded mix (scripts/seed.ts): #1 has member@ + two named Vou and one Não vou.
    const seeded = await detail(SEEDED_UPCOMING.demo);
    expect(seeded).toMatchObject({ viewerStatus: 'going', confirmedCount: 3, presentCount: 0 });
  });

  it('7. D-206: the detail carries the viewer state and counts, never another member (key set)', async () => {
    const read = await detail(SEEDED_UPCOMING.demo);
    expect(Object.keys(read).sort()).toEqual(DETAIL_KEYS);
    const others = await adminSql<{ user_id: string }[]>`
      select user_id from public.event_attendances
       where event_id = ${SEEDED_UPCOMING.demo}::uuid and user_id <> ${userIds.demoMember}::uuid`;
    expect(others.length).toBeGreaterThan(0);
    const text = JSON.stringify(read);
    for (const row of others) expect(text).not.toContain(row.user_id);
    // The list item has the same member-facing surface minus the detail-only keys.
    const item = (await walk('upcoming')).find((entry) => entry.id === SEEDED_UPCOMING.demo);
    expect(Object.keys(item ?? {}).sort()).toEqual(
      DETAIL_KEYS.filter((key) => !['address', 'description', 'viewerRespondedAt'].includes(key)),
    );
  });

  it('8. EVENT-01 concurrency: an RSVP racing a held cancel waits for it, then answers 409 cancelled with no row', async () => {
    const event = await createEvent('corrida');
    let settledBeforeCommit = false;
    const race: { pending?: Promise<Response> } = {};
    await adminSql.begin(async (tx) => {
      await tx`
        update public.events set status = 'cancelled', cancelled_at = now()
         where id = ${event.id}::uuid`;
      const pending = Promise.resolve(rsvp(event.id, 'going'));
      race.pending = pending;
      void pending.then(() => {
        settledBeforeCommit = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      // The guard's FOR SHARE is waiting on this transaction's row lock.
      expect(settledBeforeCommit).toBe(false);
    });
    if (!race.pending) throw new Error('the RSVP request was never started');
    const res = await race.pending;
    expect(res.status).toBe(409);
    expect((await envelope(res)).details).toEqual({ event: 'cancelled' });
    expect(await attendanceRows(event.id)).toHaveLength(0);
  });

  it('9. EVENT-03 precision: starts_at comes from a minute-precision wall clock, so its seconds are :00.000000', async () => {
    const event = await createEvent('precisao');
    expect(event.startsAt).toMatch(/T\d{2}:\d{2}:00\.000000Z$/);
    const read = await detail(event.id);
    expect(read.startsAt).toBe(event.startsAt);
  });
});
