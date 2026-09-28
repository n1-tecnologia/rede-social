import { subscribe } from '@rede-social/core/server/events/bus';
import type {
  CheckinResult,
  EnterResult,
  EventCheckedIn,
  EventDetail,
  EventSummary,
} from '@rede-social/module-events/contracts';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * EVENT-04 in person end to end against the live local stack and the real seed (06-05): a member at
 * the venue types the code the organiser reads aloud, and `app.events_check_in` (SECURITY DEFINER)
 * decides everything inside Postgres.
 *
 * Every event this file needs is created through the ADMIN API and then moved in time through
 * `adminSql` (the 06-03 time-travel sequence), so the check-in window is open NOW. The venue code is
 * read ONLY through `adminSql` (planning decision 3): no member-facing route can return it. Both hooks
 * sweep this file's own events by title prefix (their attendance and attempts rows cascade).
 *
 * What is proved here:
 *  - after `Vou`, 200 `checked_in`, and the detail then carries `viewerCheckedInAt`;
 *  - with no answer, and after `Não vou`, 200 `walk_in` (D-216);
 *  - a repeat answers `already` with the SAME `checkedInAt` and emits nothing;
 *  - PITFALL 1, INVERTED: five wrong codes in FIVE SEPARATE requests each answer 409 `wrong_code`,
 *    the right code then answers 409 `too_many_attempts`, and `failed_count` reads 5 through
 *    `adminSql`. Each request is its own transaction, so the counter only reaches 5 if every refused
 *    guess committed;
 *  - `checkin_not_open`, `checkin_closed`, `cancelled`, and a bare 404 for an ONLINE event and for a
 *    lab event id (nothing written on the lab's side);
 *  - `event.checked_in` exactly once per first check-in, with the exact six-key payload;
 *  - two concurrent right-code requests by the same member record ONE row: one `checked_in` and one
 *    `already` (T-06-34);
 *  - CR-01 (06 code review): with the member's FIRST wrong guess held open on its own connection
 *    (no attempts row committed), twenty PARALLEL wrong codes from the same member are serialised
 *    by the function's advisory lock: four more `wrong_code`, sixteen `too_many_attempts`, the
 *    counter stops at 5, and the right code is then refused;
 *  - WR-05 (06 code review): 20 wrong codes against the CURRENT code refuse the right one even in a
 *    fresh window, and "Gerar novo código" restores the budget.
 *
 * 06-06 adds the describe `enter` (EVENT-04 ONLINE, `app.events_enter`): every outcome over online
 * events created here and moved in time through `adminSql`, the URL present EXACTLY on `forward`,
 * `recorded` and `already` (null on `confirm_first`, `ended`, `cancelled`), `event.checked_in` once
 * with `via: 'online'`, the concurrent pair recording one row, and a bare 404 for the lab's ONLINE
 * event, an in-person event and an unknown id.
 *
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order).
 */

type Envelope = {
  error: { code: string; message?: string; details?: unknown; requestId?: string };
};

const tokens = { demoAdmin: '', demoMember: '', joao: '', iris: '', rafael: '', sofia: '' };
const userIds: Record<string, string> = {};
let demoTenantId = '';

/** The prefix every event THIS FILE writes carries, so the sweep can be exact. */
const TEST_TITLE_PREFIX = 'Evento de check-in';

/** 06-01's seeded upcoming event #1 in the LAB tenant (`scripts/seed.ts` SEED_EVENT_IDS). */
const LAB_UPCOMING = '0e000000-0000-4000-8000-000000000e01';

/** The LAB tenant's seeded ONLINE event (#2 in `SEED_EVENTS`). */
const LAB_ONLINE = '0e000000-0000-4000-8000-000000000e02';

/** The meeting URL `createEvent(…, 'online')` stores. */
const MEETING_URL = 'https://meet.example.test/checkin';

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

/** Creates an event 3 days from now at 19:00 through the admin API. */
async function createEvent(suffix: string, format: 'in_person' | 'online' = 'in_person') {
  const date = tenantDate(3);
  const where =
    format === 'in_person'
      ? { venueName: 'Auditorio da sede', address: 'Rua das Flores, 100' }
      : { meetingUrl: 'https://meet.example.test/checkin' };
  const res = await request('/v1/events', tokens.demoAdmin, {
    method: 'POST',
    body: JSON.stringify({
      title: `${TEST_TITLE_PREFIX} ${suffix}`,
      format,
      ...where,
      start: { date, time: '19:00' },
      end: { date, time: '21:00' },
    }),
  });
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return (await res.json()) as EventSummary;
}

/** Moves an event so its check-in window is open now: it starts in 30 minutes. */
async function openWindow(eventId: string): Promise<void> {
  await adminSql`
    update public.events
       set starts_at = date_trunc('second', now()) + interval '30 minutes',
           ends_at = date_trunc('second', now()) + interval '2 hours 30 minutes'
     where id = ${eventId}::uuid`;
}

/** The venue code, read the only way a test may: through the superuser connection. */
async function codeOf(eventId: string): Promise<string> {
  const [row] = await adminSql<{ checkin_code: string }[]>`
    select checkin_code from public.event_secrets where event_id = ${eventId}::uuid`;
  if (!row) throw new Error(`no secrets row for ${eventId}`);
  return row.checkin_code;
}

/** A code of the right shape that is NOT this event's code. */
function wrongCode(code: string): string {
  return code === 'ZZZZ' ? 'YYYY' : 'ZZZZ';
}

const checkIn = (eventId: string, code: string, token: string, host = HOSTS.demo) =>
  request(
    `/v1/events/${eventId}/check-in`,
    token,
    { method: 'POST', body: JSON.stringify({ code }) },
    host,
  );

const rsvp = (eventId: string, answer: string, token: string) =>
  request(`/v1/events/${eventId}/rsvp`, token, {
    method: 'PUT',
    body: JSON.stringify({ answer }),
  });

async function attendance(eventId: string, userId: string) {
  const rows = await adminSql<{ status: string; checked_in_at: string | null }[]>`
    select status, to_char(checked_in_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as checked_in_at
      from public.event_attendances
     where event_id = ${eventId}::uuid and user_id = ${userId}::uuid`;
  return rows;
}

async function sweep(): Promise<void> {
  await adminSql`delete from public.events where title like ${`${TEST_TITLE_PREFIX}%`}`;
}

/** Every `event.checked_in` this file observed, collected through the REAL bus. */
const received: EventCheckedIn[] = [];
let unsubscribe: () => void = () => {};

const EMAILS = {
  demoMember: 'member@rede-demo.local',
  joao: 'joao.goncalves@rede-demo.local',
  iris: 'iris.munoz@rede-demo.local',
  rafael: 'rafael.teixeira@rede-demo.local',
  sofia: 'sofia.davila@rede-demo.local',
} as const;

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  for (const [key, email] of Object.entries(EMAILS)) {
    tokens[key as keyof typeof EMAILS] = await signInAs(email, SEED_PASSWORD);
  }
  const users = await adminSql<{ id: string; email: string }[]>`
    select id, email::text from public.users where email in ${adminSql(Object.values(EMAILS))}`;
  for (const [key, email] of Object.entries(EMAILS)) {
    userIds[key] = users.find((row) => row.email === email)?.id ?? '';
  }
  const [tenant] = await adminSql<{ id: string }[]>`
    select id from public.tenants where slug = 'rede-demo'`;
  demoTenantId = tenant?.id ?? '';
  await sweep();
  unsubscribe = subscribe('event.checked_in', async (payload) => {
    received.push(payload);
  });
});

afterAll(async () => {
  unsubscribe();
  await sweep();
});

describe('events check-in (in person, by code)', () => {
  let main: EventSummary;
  let mainCode = '';
  let firstStamp = '';

  it('1. after Vou, the right code (typed loosely) is 200 checked_in, the detail shows it, and ONE exact event.checked_in', async () => {
    main = await createEvent('principal');
    await openWindow(main.id);
    mainCode = await codeOf(main.id);
    expect((await rsvp(main.id, 'going', tokens.demoMember)).status).toBe(200);
    const before = received.length;

    // Lowercase with a hyphen: the database normalises the guess.
    const typed = `${mainCode.slice(0, 2)}-${mainCode.slice(2)}`.toLowerCase();
    const res = await checkIn(main.id, typed, tokens.demoMember);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    const body = (await res.json()) as CheckinResult;
    expect(Object.keys(body).sort()).toEqual(['checkedInAt', 'outcome']);
    expect(body.outcome).toBe('checked_in');
    firstStamp = body.checkedInAt;

    const [row] = await attendance(main.id, userIds.demoMember ?? '');
    expect(row?.status).toBe('checked_in');
    expect(row?.checked_in_at).toBe(firstStamp);

    const read = await request(`/v1/events/${main.id}`, tokens.demoMember);
    const detail = (await read.json()) as EventDetail;
    expect(detail.viewerStatus).toBe('checked_in');
    expect(detail.viewerCheckedInAt).toBe(firstStamp);
    expect(detail.viewerRespondedAt).not.toBeNull();

    const mine = received.slice(before).filter((payload) => payload.eventId === main.id);
    expect(mine).toHaveLength(1);
    expect(Object.keys(mine[0] ?? {}).sort()).toEqual([
      'eventId',
      'startsAt',
      'tenantId',
      'userId',
      'via',
      'walkIn',
    ]);
    const [starts] = await adminSql<{ s: string }[]>`
      select to_char(starts_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as s
        from public.events where id = ${main.id}::uuid`;
    expect(mine[0]).toEqual({
      tenantId: demoTenantId,
      eventId: main.id,
      userId: userIds.demoMember,
      walkIn: false,
      via: 'code',
      startsAt: starts?.s,
    });
  });

  it('2. with no answer, and after Não vou, the right code is a walk-in (D-216)', async () => {
    const before = received.length;
    const none = await checkIn(main.id, mainCode, tokens.joao);
    expect(none.status).toBe(200);
    expect(((await none.json()) as CheckinResult).outcome).toBe('walk_in');
    expect((await attendance(main.id, userIds.joao ?? ''))[0]?.status).toBe('walk_in');

    expect((await rsvp(main.id, 'not_going', tokens.iris)).status).toBe(200);
    const declined = await checkIn(main.id, mainCode, tokens.iris);
    expect(declined.status).toBe(200);
    expect(((await declined.json()) as CheckinResult).outcome).toBe('walk_in');
    expect((await attendance(main.id, userIds.iris ?? ''))[0]?.status).toBe('walk_in');

    const mine = received.slice(before).filter((payload) => payload.eventId === main.id);
    expect(mine).toHaveLength(2);
    expect(mine.every((payload) => payload.walkIn && payload.via === 'code')).toBe(true);
  });

  it('3. a repeat (even with a wrong code) answers already with the SAME checkedInAt and emits nothing', async () => {
    const before = received.length;
    for (const code of [mainCode, wrongCode(mainCode)]) {
      const res = await checkIn(main.id, code, tokens.demoMember);
      expect(res.status, code).toBe(200);
      expect((await res.json()) as CheckinResult).toEqual({
        outcome: 'already',
        checkedInAt: firstStamp,
      });
    }
    expect(await attendance(main.id, userIds.demoMember ?? '')).toHaveLength(1);
    const [attempts] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.event_checkin_attempts
       where event_id = ${main.id}::uuid and user_id = ${userIds.demoMember ?? ''}::uuid`;
    expect(attempts?.n).toBe(0);
    expect(received.length).toBe(before);
  });

  it('4. Pitfall 1: five wrong codes in five requests are each 409 wrong_code, then the RIGHT code is 409 too_many_attempts', async () => {
    const wrong = wrongCode(mainCode);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await checkIn(main.id, wrong, tokens.rafael);
      expect(res.status, `attempt ${attempt}`).toBe(409);
      const error = await envelope(res);
      expect(error.code).toBe('CONFLICT');
      expect(error.details).toEqual({ event: 'wrong_code' });
    }
    // Five separate transactions: the count is 5 only if every refused guess committed.
    const [counter] = await adminSql<{ failed_count: number }[]>`
      select failed_count from public.event_checkin_attempts
       where event_id = ${main.id}::uuid and user_id = ${userIds.rafael ?? ''}::uuid`;
    expect(counter?.failed_count).toBe(5);

    const right = await checkIn(main.id, mainCode, tokens.rafael);
    expect(right.status).toBe(409);
    expect((await envelope(right)).details).toEqual({ event: 'too_many_attempts' });
    expect(await attendance(main.id, userIds.rafael ?? '')).toHaveLength(0);

    // The bound resets 15 minutes after the window started.
    await adminSql`
      update public.event_checkin_attempts set window_started_at = now() - interval '16 minutes'
       where event_id = ${main.id}::uuid and user_id = ${userIds.rafael ?? ''}::uuid`;
    const later = await checkIn(main.id, mainCode, tokens.rafael);
    expect(later.status).toBe(200);
    expect(((await later.json()) as CheckinResult).outcome).toBe('walk_in');
  });

  it('5. the refusals name the event state: checkin_not_open, checkin_closed, cancelled', async () => {
    const early = await createEvent('cedo');
    const notOpen = await checkIn(early.id, await codeOf(early.id), tokens.sofia);
    expect(notOpen.status).toBe(409);
    expect((await envelope(notOpen)).details).toEqual({ event: 'checkin_not_open' });

    const late = await createEvent('tarde');
    await adminSql`
      update public.events
         set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 minute'
       where id = ${late.id}::uuid`;
    const closed = await checkIn(late.id, await codeOf(late.id), tokens.sofia);
    expect(closed.status).toBe(409);
    expect((await envelope(closed)).details).toEqual({ event: 'checkin_closed' });

    const off = await createEvent('cancelado');
    await openWindow(off.id);
    await adminSql`
      update public.events set status = 'cancelled', cancelled_at = now()
       where id = ${off.id}::uuid`;
    const cancelled = await checkIn(off.id, await codeOf(off.id), tokens.sofia);
    expect(cancelled.status).toBe(409);
    expect((await envelope(cancelled)).details).toEqual({ event: 'cancelled' });

    for (const id of [early.id, late.id, off.id]) {
      expect(await attendance(id, userIds.sofia ?? ''), id).toHaveLength(0);
    }
  });

  it('6. an ONLINE event, a lab event, an unknown id: ONE bare 404; a malformed id or an empty code is a 400', async () => {
    const online = await createEvent('online', 'online');
    await openWindow(online.id);
    const [labBefore] = await adminSql<{ a: number; t: number }[]>`
      select (select count(*)::int from public.event_attendances where event_id = ${LAB_UPCOMING}::uuid) as a,
             (select count(*)::int from public.event_checkin_attempts where event_id = ${LAB_UPCOMING}::uuid) as t`;

    const targets: [string, string][] = [
      [online.id, await codeOf(online.id)],
      [LAB_UPCOMING, await codeOf(LAB_UPCOMING)],
      ['0d000000-0000-4000-8000-00000000ffff', 'K7QM'],
    ];
    for (const [id, code] of targets) {
      const res = await checkIn(id, code, tokens.sofia);
      expect(res.status, id).toBe(404);
      const error = await envelope(res);
      expect(error.code).toBe('NOT_FOUND');
      expect(error.details).toBeUndefined();
    }
    const [labAfter] = await adminSql<{ a: number; t: number }[]>`
      select (select count(*)::int from public.event_attendances where event_id = ${LAB_UPCOMING}::uuid) as a,
             (select count(*)::int from public.event_checkin_attempts where event_id = ${LAB_UPCOMING}::uuid) as t`;
    expect(labAfter).toEqual(labBefore);
    expect(await attendance(online.id, userIds.sofia ?? '')).toHaveLength(0);

    expect((await checkIn('not-a-uuid', 'K7QM', tokens.sofia)).status).toBe(400);
    expect((await checkIn(online.id, '   ', tokens.sofia)).status).toBe(400);
    const forged = await request(`/v1/events/${online.id}/check-in`, tokens.sofia, {
      method: 'POST',
      body: JSON.stringify({ code: 'K7QM', userId: userIds.joao }),
    });
    expect(forged.status).toBe(400);
  });

  it('7. two concurrent right-code requests by the same member record ONE row: one checked_in, one already', async () => {
    const race = await createEvent('corrida');
    await openWindow(race.id);
    expect((await rsvp(race.id, 'going', tokens.sofia)).status).toBe(200);
    const code = await codeOf(race.id);
    const before = received.length;

    const [a, b] = await Promise.all([
      checkIn(race.id, code, tokens.sofia),
      checkIn(race.id, code, tokens.sofia),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const outcomes = [(await a.json()) as CheckinResult, (await b.json()) as CheckinResult];
    expect(outcomes.map((body) => body.outcome).sort()).toEqual(['already', 'checked_in']);
    expect(outcomes[0]?.checkedInAt).toBe(outcomes[1]?.checkedInAt);

    const rows = await attendance(race.id, userIds.sofia ?? '');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('checked_in');
    expect(received.slice(before).filter((payload) => payload.eventId === race.id)).toHaveLength(1);
  });

  it('8. CR-01: a first guess held open plus twenty PARALLEL wrong codes from the same member are serialised: the counter stops at 5 and the right code is refused', async () => {
    const burst = await createEvent('rajada');
    await openWindow(burst.id);
    const code = await codeOf(burst.id);
    const wrong = wrongCode(code);
    const claims = JSON.stringify({
      sub: userIds.joao,
      role: 'authenticated',
      tenant_id: demoTenantId,
      tenant_role: 'member',
    });

    // The member's FIRST guess, in the member lane on its own connection, held open: no attempts
    // row is committed yet, which is exactly the case `for update` never locked. The burst below
    // starts while it is open, so without the per-member advisory lock all twenty would pass the
    // bound (no committed row) and compare their code; with it, they wait and then read the counter.
    const lane = postgres('postgres://postgres:postgres@127.0.0.1:54322/postgres', {
      prepare: false,
      max: 1,
    });
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => {};
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    try {
      const first = lane.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${claims}, true)`;
        await tx`set local role authenticated`;
        const [row] = await tx<{ outcome: string }[]>`
          select outcome from app.events_check_in(${burst.id}::uuid, ${wrong})`;
        entered();
        await held;
        return row?.outcome;
      });
      await inside;
      const responses = Promise.all(
        Array.from({ length: 20 }, () => checkIn(burst.id, wrong, tokens.joao)),
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      release();
      expect(await first).toBe('wrong_code');

      const refusals: unknown[] = [];
      for (const res of await responses) {
        expect(res.status).toBe(409);
        refusals.push((await envelope(res)).details);
      }
      const count = (event: string) =>
        refusals.filter((details) => JSON.stringify(details) === JSON.stringify({ event })).length;
      // 1 held + 4 from the burst reach the bound; the other 16 are refused without a comparison.
      expect(count('wrong_code')).toBe(4);
      expect(count('too_many_attempts')).toBe(16);
    } finally {
      release();
      await lane.end();
    }

    const [counter] = await adminSql<{ failed_count: number }[]>`
      select failed_count from public.event_checkin_attempts
       where event_id = ${burst.id}::uuid and user_id = ${userIds.joao ?? ''}::uuid`;
    expect(counter?.failed_count).toBe(5);

    const right = await checkIn(burst.id, code, tokens.joao);
    expect(right.status).toBe(409);
    expect((await envelope(right)).details).toEqual({ event: 'too_many_attempts' });
    expect(await attendance(burst.id, userIds.joao ?? '')).toHaveLength(0);
  });

  it('9. WR-05: at 20 wrong codes against the current code the right one is refused in a fresh window, and a regeneration restores the budget', async () => {
    const long = await createEvent('teto');
    await openWindow(long.id);
    // 20 wrong codes recorded against THIS code (after its rotation stamp), none in the current
    // window: only the per-code ceiling can refuse now.
    await adminSql`
      insert into public.event_checkin_attempts
             (tenant_id, event_id, user_id, failed_count, window_started_at, total_failed, total_since)
      values (${demoTenantId}::uuid, ${long.id}::uuid, ${userIds.iris ?? ''}::uuid,
              0, now() - interval '1 day', 20, now())`;
    const refused = await checkIn(long.id, await codeOf(long.id), tokens.iris);
    expect(refused.status).toBe(409);
    expect((await envelope(refused)).details).toEqual({ event: 'too_many_attempts' });
    expect(await attendance(long.id, userIds.iris ?? '')).toHaveLength(0);

    // "Gerar novo código": code_rotated_at now post-dates total_since, so the total restarts.
    const rotated = await request(`/v1/events/${long.id}/checkin-code`, tokens.demoAdmin, {
      method: 'POST',
    });
    expect(rotated.status).toBe(200);
    const fresh = await checkIn(long.id, await codeOf(long.id), tokens.iris);
    expect(fresh.status, JSON.stringify(await fresh.clone().json())).toBe(200);
    expect(((await fresh.json()) as CheckinResult).outcome).toBe('walk_in');
  });
});

describe('enter (online, EVENT-04, D-207, D-210, D-218)', () => {
  const enter = (eventId: string, token: string, host = HOSTS.demo) =>
    request(`/v1/events/${eventId}/enter`, token, { method: 'POST' }, host);

  async function enterBody(eventId: string, token: string) {
    const res = await enter(eventId, token);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    const body = (await res.json()) as EnterResult;
    expect(Object.keys(body).sort()).toEqual(['meetingUrl', 'outcome']);
    return body;
  }

  async function onlineRow(eventId: string, userId: string) {
    return adminSql<{ status: string; checked_in: boolean; checkin_via: string | null }[]>`
      select status, checked_in_at is not null as checked_in, checkin_via
        from public.event_attendances
       where event_id = ${eventId}::uuid and user_id = ${userId}::uuid`;
  }

  let live: EventSummary;

  it('1. before the window: Vou is forwarded WITH the URL and nothing is recorded; no answer is confirm_first with meetingUrl null', async () => {
    const early = await createEvent('online cedo', 'online');
    expect((await rsvp(early.id, 'going', tokens.joao)).status).toBe(200);
    const before = received.length;

    expect(await enterBody(early.id, tokens.joao)).toEqual({
      outcome: 'forward',
      meetingUrl: MEETING_URL,
    });
    const rows = await onlineRow(early.id, userIds.joao ?? '');
    expect(rows).toEqual([{ status: 'going', checked_in: false, checkin_via: null }]);

    expect(await enterBody(early.id, tokens.iris)).toEqual({
      outcome: 'confirm_first',
      meetingUrl: null,
    });
    expect(await onlineRow(early.id, userIds.iris ?? '')).toHaveLength(0);
    expect(received.length).toBe(before);
  });

  it('2. inside the window: no answer records a walk-in, Vou records checked_in, both via online, ONE event.checked_in each', async () => {
    live = await createEvent('online ao vivo', 'online');
    expect((await rsvp(live.id, 'going', tokens.iris)).status).toBe(200);
    await openWindow(live.id);
    const before = received.length;

    expect(await enterBody(live.id, tokens.rafael)).toEqual({
      outcome: 'recorded',
      meetingUrl: MEETING_URL,
    });
    expect(await onlineRow(live.id, userIds.rafael ?? '')).toEqual([
      { status: 'walk_in', checked_in: true, checkin_via: 'online' },
    ]);

    expect(await enterBody(live.id, tokens.iris)).toEqual({
      outcome: 'recorded',
      meetingUrl: MEETING_URL,
    });
    expect(await onlineRow(live.id, userIds.iris ?? '')).toEqual([
      { status: 'checked_in', checked_in: true, checkin_via: 'online' },
    ]);

    const mine = received.slice(before).filter((payload) => payload.eventId === live.id);
    expect(mine).toHaveLength(2);
    const [starts] = await adminSql<{ s: string }[]>`
      select to_char(starts_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as s
        from public.events where id = ${live.id}::uuid`;
    expect(mine).toEqual([
      {
        tenantId: demoTenantId,
        eventId: live.id,
        userId: userIds.rafael,
        walkIn: true,
        via: 'online',
        startsAt: starts?.s,
      },
      {
        tenantId: demoTenantId,
        eventId: live.id,
        userId: userIds.iris,
        walkIn: false,
        via: 'online',
        startsAt: starts?.s,
      },
    ]);
  });

  it('3. a repeat answers already WITH the URL (rejoin), writes no second row and emits nothing', async () => {
    const before = received.length;
    expect(await enterBody(live.id, tokens.rafael)).toEqual({
      outcome: 'already',
      meetingUrl: MEETING_URL,
    });
    expect(await onlineRow(live.id, userIds.rafael ?? '')).toHaveLength(1);
    expect(received.length).toBe(before);
  });

  it('4. ended and cancelled answer 200 with meetingUrl null and record nothing', async () => {
    const past = await createEvent('online encerrado', 'online');
    await adminSql`
      update public.events
         set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 minute'
       where id = ${past.id}::uuid`;
    expect(await enterBody(past.id, tokens.sofia)).toEqual({ outcome: 'ended', meetingUrl: null });

    const off = await createEvent('online cancelado', 'online');
    await openWindow(off.id);
    await adminSql`
      update public.events set status = 'cancelled', cancelled_at = now()
       where id = ${off.id}::uuid`;
    expect(await enterBody(off.id, tokens.sofia)).toEqual({
      outcome: 'cancelled',
      meetingUrl: null,
    });

    for (const id of [past.id, off.id]) {
      expect(await onlineRow(id, userIds.sofia ?? ''), id).toHaveLength(0);
    }
  });

  it('5. two concurrent enters by the same member record ONE row: one recorded, one already', async () => {
    const race = await createEvent('online corrida', 'online');
    await openWindow(race.id);
    const before = received.length;

    const [a, b] = await Promise.all([enter(race.id, tokens.sofia), enter(race.id, tokens.sofia)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const outcomes = [(await a.json()) as EnterResult, (await b.json()) as EnterResult];
    expect(outcomes.map((body) => body.outcome).sort()).toEqual(['already', 'recorded']);
    expect(outcomes.every((body) => body.meetingUrl === MEETING_URL)).toBe(true);

    expect(await onlineRow(race.id, userIds.sofia ?? '')).toHaveLength(1);
    expect(received.slice(before).filter((payload) => payload.eventId === race.id)).toHaveLength(1);
  });

  it('6. the lab ONLINE event, an in-person event and an unknown id: ONE bare 404; a malformed id is a 400', async () => {
    // The lab event stays where the seed put it (untouched, so no other file's counts drift): from
    // the demo lane it must be a bare 404, never the lab's own `confirm_first`.
    const [lab] = await adminSql<{ format: string }[]>`
      select format from public.events where id = ${LAB_ONLINE}::uuid`;
    expect(lab?.format).toBe('online');
    const [labBefore] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.event_attendances where event_id = ${LAB_ONLINE}::uuid`;

    const inPerson = await createEvent('presencial via entrar');
    await openWindow(inPerson.id);

    for (const id of [LAB_ONLINE, inPerson.id, '0d000000-0000-4000-8000-00000000ffff']) {
      const res = await enter(id, tokens.sofia);
      expect(res.status, id).toBe(404);
      const error = await envelope(res);
      expect(error.code).toBe('NOT_FOUND');
      expect(error.details).toBeUndefined();
      expect(JSON.stringify(error)).not.toContain('meet.example.test');
    }
    const [labAfter] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.event_attendances where event_id = ${LAB_ONLINE}::uuid`;
    expect(labAfter).toEqual(labBefore);
    expect(await onlineRow(inPerson.id, userIds.sofia ?? '')).toHaveLength(0);

    expect((await enter('not-a-uuid', tokens.sofia)).status).toBe(400);
  });
});
