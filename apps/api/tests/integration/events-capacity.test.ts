import { subscribe } from '@rede-social/core/server/events/bus';
import type {
  EventDetail,
  EventEdit,
  EventPage,
  EventSummary,
  EventUpdated,
} from '@rede-social/module-events/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * 2026-10-03 — the event's `category` and `capacity` ("Últimas N vagas") end to end against the live
 * local stack and the real seed: the create and the whole-event replacement carry both, the list
 * item, the detail and the edit read return them (with the list's new `address`), and the guard
 * trigger's step 7 refuses a NEW Vou once the event is full, for every writer, under concurrency.
 *
 * What is proved here:
 *  - create/edit/list/detail: a trimmed category (blank = null), a limit (null = none), a generic 400
 *    for a category over 40 characters or a limit outside 1..100000, and nothing written then;
 *  - the replacement: both are part of the no-op comparison (an identical PUT moves no
 *    `updated_at`), a limit-only change is a change, and an absent key clears the stored value;
 *  - `409 { event: 'event_full' }` for a new Vou on a full event (with no row written), a Não vou is
 *    never judged, a member already going answering Vou again is unchanged even when the limit was
 *    lowered under the confirmations, and lowering it keeps every answer;
 *  - concurrency, twice: a Vou waits for a held transaction that took the last seat and is then
 *    refused, and racing answers for the last seat leave exactly ONE confirmation.
 *
 * Every event this file writes carries `TEST_TITLE_PREFIX` and is swept by both hooks (attendance and
 * secrets cascade). Test ORDER is load-bearing (`fileParallelism: false`, declaration order).
 */

type Envelope = {
  error: { code: string; message?: string; details?: unknown; requestId?: string };
};

const tokens = { demoAdmin: '', demoMember: '', demoSupport: '' };
const tenantIds = { demo: '' };
const userIds = { demoMember: '', demoAdmin: '', demoSupport: '' };

const TEST_TITLE_PREFIX = 'Evento de vagas';

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

type Body = {
  title: string;
  description?: string;
  category?: string | null;
  capacity?: number | string | null;
  format: 'in_person' | 'online';
  venueName?: string | null;
  address?: string | null;
  meetingUrl?: string | null;
  start: { date: string; time: string };
  end: { date: string; time: string };
};

/** An in-person body `days` from now at 19:00-21:00 tenant time, with a COMPOSED address. */
function body(suffix: string, extra: Partial<Body> = {}, days = 4): Body {
  const date = tenantDate(days);
  return {
    title: `${TEST_TITLE_PREFIX} ${suffix}`,
    format: 'in_person',
    venueName: 'Auditorio da sede',
    address: 'Avenida Paulista, 1578\nBela Vista, São Paulo - SP\nCEP 01310-200',
    start: { date, time: '19:00' },
    end: { date, time: '21:00' },
    ...extra,
  };
}

const post = (payload: unknown, token = tokens.demoAdmin) =>
  request('/v1/events', token, { method: 'POST', body: JSON.stringify(payload) });

const put = (eventId: string, payload: unknown, token = tokens.demoAdmin) =>
  request(`/v1/events/${eventId}`, token, { method: 'PUT', body: JSON.stringify(payload) });

const rsvp = (eventId: string, answer: string, token = tokens.demoMember) =>
  request(`/v1/events/${eventId}/rsvp`, token, {
    method: 'PUT',
    body: JSON.stringify({ answer }),
  });

async function create(payload: Body): Promise<EventSummary> {
  const res = await post(payload);
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return (await res.json()) as EventSummary;
}

async function detail(eventId: string, token = tokens.demoMember): Promise<EventDetail> {
  const res = await request(`/v1/events/${eventId}`, token);
  expect(res.status).toBe(200);
  return (await res.json()) as EventDetail;
}

/** Every upcoming item the MEMBER sees, walked with the returned cursors. */
async function memberUpcoming(): Promise<EventSummary[]> {
  const seen: EventSummary[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 40; guard++) {
    const query: string = cursor
      ? `?period=upcoming&limit=25&cursor=${encodeURIComponent(cursor)}`
      : '?period=upcoming&limit=25';
    const res = await request(`/v1/events${query}`, tokens.demoMember);
    expect(res.status).toBe(200);
    const page = (await res.json()) as EventPage;
    seen.push(...page.items);
    cursor = page.nextCursor;
    if (cursor === null) break;
  }
  return seen;
}

async function stored(eventId: string) {
  const [row] = await adminSql<
    { category: string | null; capacity: number | null; updated_at: string }[]
  >`select category, capacity, updated_at::text from public.events where id = ${eventId}::uuid`;
  return row;
}

async function answers(eventId: string) {
  return adminSql<{ user_id: string; status: string }[]>`
    select user_id, status from public.event_attendances
     where event_id = ${eventId}::uuid order by user_id`;
}

/** Another demo member's `going`, written straight into the table (the guard still judges it). */
async function othersGoing(eventId: string, count: number): Promise<string[]> {
  const people = await adminSql<{ id: string }[]>`
    select u.id from public.users u
      join public.memberships m on m.user_id = u.id
     where m.tenant_id = ${tenantIds.demo}::uuid
       and u.id not in (${userIds.demoMember}::uuid, ${userIds.demoAdmin}::uuid,
                        ${userIds.demoSupport}::uuid)
     order by u.email
     limit ${count}`;
  expect(people).toHaveLength(count);
  for (const person of people) {
    await adminSql`
      insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at)
      values (${tenantIds.demo}::uuid, ${eventId}::uuid, ${person.id}::uuid, 'going', now())`;
  }
  return people.map((person) => person.id);
}

async function sweep(): Promise<void> {
  await adminSql`delete from public.events where title like ${`${TEST_TITLE_PREFIX}%`}`;
}

const updates: EventUpdated[] = [];
let stop: () => void = () => {};
/** Waits for the after-commit bus to deliver (subscribers run after the response). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.demoSupport = await signInAs('support@rede-demo.local', SEED_PASSWORD);
  const [tenant] = await adminSql<{ id: string }[]>`
    select id from public.tenants where slug = 'rede-demo'`;
  tenantIds.demo = tenant?.id ?? '';
  const users = await adminSql<{ id: string; email: string }[]>`
    select id, email from public.users
     where email in ('member@rede-demo.local', 'admin@rede-demo.local', 'support@rede-demo.local')`;
  for (const user of users) {
    if (user.email.startsWith('member@')) userIds.demoMember = user.id;
    if (user.email.startsWith('admin@')) userIds.demoAdmin = user.id;
    if (user.email.startsWith('support@')) userIds.demoSupport = user.id;
  }
  await sweep();
  stop = subscribe('event.updated', async (payload) => {
    updates.push(payload);
  });
});

afterAll(async () => {
  stop();
  await sweep();
});

describe('events category and capacity', () => {
  it('1. the create carries both; the list item, the detail and the edit read return them, the list with the address', async () => {
    const created = await create(
      body('com categoria', { category: '  Imersão presencial  ', capacity: 40 }),
    );
    expect(created).toMatchObject({ category: 'Imersão presencial', capacity: 40 });
    expect(created.address).toBe(
      'Avenida Paulista, 1578\nBela Vista, São Paulo - SP\nCEP 01310-200',
    );
    expect(await stored(created.id)).toMatchObject({
      category: 'Imersão presencial',
      capacity: 40,
    });

    const listed = (await memberUpcoming()).find((item) => item.id === created.id);
    expect(listed).toMatchObject({
      category: 'Imersão presencial',
      capacity: 40,
      address: created.address,
      confirmedCount: 0,
    });
    expect(await detail(created.id)).toMatchObject({
      category: 'Imersão presencial',
      capacity: 40,
    });

    const edit = await request(`/v1/events/${created.id}/edit`, tokens.demoAdmin);
    expect(edit.status).toBe(200);
    expect((await edit.json()) as EventEdit).toMatchObject({
      category: 'Imersão presencial',
      capacity: 40,
    });

    // An online event carries both too, and has no address in the list.
    const online = await create({
      title: `${TEST_TITLE_PREFIX} online`,
      format: 'online',
      meetingUrl: 'https://meet.example.test/vagas',
      category: 'Live',
      capacity: 300,
      start: { date: tenantDate(5), time: '19:00' },
      end: { date: tenantDate(5), time: '21:00' },
    });
    expect(online).toMatchObject({ category: 'Live', capacity: 300, address: null });
  });

  it('2. blank, null or absent: no category and no limit, stored as null (never "" or 0)', async () => {
    for (const [suffix, extra] of [
      ['vazia', { category: '   ', capacity: null }],
      ['nula', { category: null }],
      ['ausente', {}],
    ] as const) {
      const created = await create(body(`sem ${suffix}`, extra));
      expect(created).toMatchObject({ category: null, capacity: null });
      expect(await stored(created.id)).toMatchObject({ category: null, capacity: null });
    }
  });

  it('3. a category over 40 characters or a limit outside 1..100000 is a generic 400, and nothing is written', async () => {
    const cases: Partial<Body>[] = [
      { category: 'x'.repeat(41) },
      { capacity: 0 },
      { capacity: -3 },
      { capacity: 100_001 },
      { capacity: 1.5 },
      { capacity: '10' },
    ];
    for (const extra of cases) {
      const res = await post(body('recusada', extra));
      expect(res.status, JSON.stringify(extra)).toBe(400);
      const error = await envelope(res);
      expect(error.code).toBe('VALIDATION_FAILED');
      // Not one of the closed machine codes: the generic issue list.
      expect(Object.keys((error.details ?? {}) as object)).toEqual(['issues']);
    }
    // The bounds themselves are accepted.
    expect((await post(body('limite minimo', { capacity: 1 }))).status).toBe(201);
    expect((await post(body('limite maximo', { capacity: 100_000 }))).status).toBe(201);
    expect((await post(body('categoria cheia', { category: 'x'.repeat(40) }))).status).toBe(201);
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.events where title = ${`${TEST_TITLE_PREFIX} recusada`}`;
    expect(row?.n).toBe(0);
  });

  it('4. the replacement: an identical PUT writes nothing, a limit-only change is a change, an absent key clears it', async () => {
    const payload = body('edicao', { category: 'Workshop', capacity: 20 });
    const created = await create(payload);
    const before = await stored(created.id);
    const seen = updates.length;

    expect((await put(created.id, payload)).status).toBe(200);
    await settle();
    expect((await stored(created.id))?.updated_at).toBe(before?.updated_at);
    expect(updates.slice(seen).filter((u) => u.eventId === created.id)).toHaveLength(0);

    const limited = await put(created.id, { ...payload, capacity: 25 });
    expect(limited.status).toBe(200);
    expect(((await limited.json()) as EventSummary).capacity).toBe(25);
    await settle();
    const mine = updates.slice(seen).filter((u) => u.eventId === created.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.timesChanged).toBe(false);

    // The PUT is a whole-event replacement: an absent category and limit clear both.
    const { category: _category, capacity: _capacity, ...bare } = payload;
    const cleared = await put(created.id, bare);
    expect(cleared.status).toBe(200);
    expect((await cleared.json()) as EventSummary).toMatchObject({
      category: null,
      capacity: null,
    });
    expect(await stored(created.id)).toMatchObject({ category: null, capacity: null });

    // A member cannot set either (the manage guard).
    expect((await put(created.id, payload, tokens.demoMember)).status).toBe(403);
  });
});

describe('events capacity: a full event takes no new Vou (guard step 7)', () => {
  it('5. a new Vou on a full event is 409 event_full with no row; Não vou is never judged', async () => {
    const event = await create(body('lotado', { capacity: 2 }));
    await othersGoing(event.id, 2);
    expect((await detail(event.id)).confirmedCount).toBe(2);

    const refused = await rsvp(event.id, 'going');
    expect(refused.status).toBe(409);
    const error = await envelope(refused);
    expect(error.code).toBe('CONFLICT');
    expect(error.details).toEqual({ event: 'event_full' });
    expect((await answers(event.id)).map((row) => row.user_id)).not.toContain(userIds.demoMember);

    // A Não vou is an answer on any event, full or not.
    const declined = await rsvp(event.id, 'not_going');
    expect(declined.status).toBe(200);
    expect(await declined.json()).toEqual({ status: 'not_going' });
    // …and moving from it to Vou is a NEW confirmation, refused while full.
    const again = await rsvp(event.id, 'going');
    expect(again.status).toBe(409);
    expect((await envelope(again)).details).toEqual({ event: 'event_full' });
    const mine = (await answers(event.id)).find((row) => row.user_id === userIds.demoMember);
    expect(mine?.status).toBe('not_going');
  });

  it('6. lowering the limit under the confirmations keeps every answer; the confirmed member repeats Vou unchanged; a freed seat lets the next Vou in', async () => {
    const payload = body('reduzido', { capacity: 5 });
    const event = await create(payload);
    expect((await rsvp(event.id, 'going')).status).toBe(200);
    const [other] = await othersGoing(event.id, 1);
    expect((await detail(event.id)).confirmedCount).toBe(2);

    // Lowered to ONE under two confirmations: accepted, and both answers stay.
    const lowered = await put(event.id, { ...payload, capacity: 1 });
    expect(lowered.status).toBe(200);
    expect((await answers(event.id)).every((row) => row.status === 'going')).toBe(true);
    const read = await detail(event.id);
    expect(read).toMatchObject({ capacity: 1, confirmedCount: 2, viewerStatus: 'going' });

    // The member already going answers Vou again: the repeat it always was (200, nothing written).
    const [before] = await adminSql<{ updated_at: string }[]>`
      select updated_at::text from public.event_attendances
       where event_id = ${event.id}::uuid and user_id = ${userIds.demoMember}::uuid`;
    const repeat = await rsvp(event.id, 'going');
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toEqual({ status: 'going' });
    const [after] = await adminSql<{ updated_at: string }[]>`
      select updated_at::text from public.event_attendances
       where event_id = ${event.id}::uuid and user_id = ${userIds.demoMember}::uuid`;
    expect(after?.updated_at).toBe(before?.updated_at);

    // The member steps out; the other still holds the one seat, so the way back is refused.
    expect((await rsvp(event.id, 'not_going')).status).toBe(200);
    expect((await rsvp(event.id, 'going')).status).toBe(409);
    // The other member steps out too: the seat is free, and the member's Vou lands.
    await adminSql`
      update public.event_attendances set status = 'not_going', responded_at = now()
       where event_id = ${event.id}::uuid and user_id = ${other ?? ''}::uuid`;
    expect((await rsvp(event.id, 'going')).status).toBe(200);
    expect((await detail(event.id)).confirmedCount).toBe(1);
  });

  it('7. concurrency: a Vou waits for a transaction holding the last seat, then is refused with no row', async () => {
    const event = await create(body('corrida segurada', { capacity: 1 }));
    const [other] = await adminSql<{ id: string }[]>`
      select u.id from public.users u
        join public.memberships m on m.user_id = u.id
       where m.tenant_id = ${tenantIds.demo}::uuid
         and u.id not in (${userIds.demoMember}::uuid, ${userIds.demoAdmin}::uuid,
                          ${userIds.demoSupport}::uuid)
       order by u.email limit 1`;
    let settledBeforeCommit = false;
    const race: { pending?: Promise<Response> } = {};
    await adminSql.begin(async (tx) => {
      // This writer takes the last seat: the guard holds the event's advisory lock until commit.
      await tx`
        insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at)
        values (${tenantIds.demo}::uuid, ${event.id}::uuid, ${other?.id ?? ''}::uuid, 'going', now())`;
      const pending = Promise.resolve(rsvp(event.id, 'going'));
      race.pending = pending;
      void pending.then(() => {
        settledBeforeCommit = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      // The member's guard is waiting on this transaction's lock, not counting a stale snapshot.
      expect(settledBeforeCommit).toBe(false);
    });
    if (!race.pending) throw new Error('the RSVP request was never started');
    const res = await race.pending;
    expect(res.status).toBe(409);
    expect((await envelope(res)).details).toEqual({ event: 'event_full' });
    const rows = await answers(event.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe(other?.id);
  });

  it('8. concurrency: racing Vou answers for the last seat leave exactly ONE confirmation, every time', async () => {
    for (let round = 1; round <= 4; round++) {
      const event = await create(body(`corrida ${round}`, { capacity: 1 }));
      const results = await Promise.all([
        rsvp(event.id, 'going', tokens.demoMember),
        rsvp(event.id, 'going', tokens.demoAdmin),
        rsvp(event.id, 'going', tokens.demoSupport),
      ]);
      const statuses = results.map((res) => res.status).sort();
      expect(statuses, `round ${round}`).toEqual([200, 409, 409]);
      for (const res of results.filter((r) => r.status === 409)) {
        expect((await envelope(res)).details).toEqual({ event: 'event_full' });
      }
      const going = (await answers(event.id)).filter((row) => row.status === 'going');
      expect(going, `round ${round}`).toHaveLength(1);
      expect((await detail(event.id)).confirmedCount).toBe(1);
    }
  });
});
