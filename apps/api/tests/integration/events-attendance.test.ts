import type {
  AttendancePage,
  AttendanceSummary,
  Attendee,
  CheckinCode,
  EventSummary,
} from '@rede-social/module-events/contracts';
import { EVENT_CHECKIN_CODE_ALPHABET } from '@rede-social/module-events/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * EVENT-05 end to end against the live local stack and the real seed (06-07): the organiser's
 * `Participantes` reads (the three chips, the summary with the door code) and the D-217 code
 * regeneration.
 *
 * Every event this file needs is created through the ADMIN API; the answers are written through the
 * MEMBER APIs (`PUT /rsvp`, `POST /check-in`), and time moves only through `adminSql` (the 06-03
 * time-travel sequence). The venue code is read through `adminSql` only. Both hooks sweep this file's
 * own events by title prefix (their attendance and attempts rows cascade), and the one membership
 * this file soft-deletes is restored in `afterAll` as well as in its own `finally`.
 *
 * The fixture (event "fixture", in person, window open): joao `going`, iris `going`, rafael `going`
 * then checked in (`checked_in`), sofia checked in with no answer (`walk_in`), member@ `not_going`.
 *
 * What is proved here:
 *  - T-06-44 / T-06-45: a member is 403 on the list, the summary and the regeneration;
 *  - the three chips return exactly the fixture rows, with `walkIn` only on the walk-in;
 *  - Pitfall 11: pending 2 / present 2 / notGoing 1 / confirmed 3 on the same fixture;
 *  - EVENT-05 adjacency: a forced `responded_at` tie walked with `limit=1` yields each row exactly
 *    once, adjacent, `id desc`;
 *  - EVENT-05 ordering: two identical requests answer deep-equal bodies;
 *  - EVENT-05 empty: no answers gives `{ items: [], nextCursor: null }` on every chip, and so does a
 *    cursor past the end;
 *  - a member who has left is `removed: true` with a null name, and still counts (D-219/A5);
 *  - the summary's code is `event_secrets.checkin_code` in person and null online;
 *  - D-217: regeneration gives a new code; the old one is then `409 wrong_code`, the new one checks in,
 *    and existing check-ins are kept;
 *  - T-06-47: a lab event id is a bare 404 on all three routes, and the lab code is untouched;
 *  - T-06-48: `list=PRESENT` is 400; `limit=0` clamps to 1.
 *
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order).
 */

type Envelope = {
  error: { code: string; message?: string; details?: unknown; requestId?: string };
};

const tokens = { demoAdmin: '', demoMember: '', joao: '', iris: '', rafael: '', sofia: '' };
const userIds: Record<string, string> = {};

/** The prefix every event THIS FILE writes carries, so the sweep can be exact. */
const TEST_TITLE_PREFIX = 'Evento de participantes';

/** 06-01's seeded upcoming event #1 in the LAB tenant (`scripts/seed.ts` SEED_EVENT_IDS). */
const LAB_UPCOMING = '0e000000-0000-4000-8000-000000000e01';

const EMAILS = {
  demoMember: 'member@rede-demo.local',
  joao: 'joao.goncalves@rede-demo.local',
  iris: 'iris.munoz@rede-demo.local',
  rafael: 'rafael.teixeira@rede-demo.local',
  sofia: 'sofia.davila@rede-demo.local',
} as const;

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
      : { meetingUrl: 'https://meet.example.test/participantes' };
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

const rsvp = async (eventId: string, answer: string, token: string) => {
  const res = await request(`/v1/events/${eventId}/rsvp`, token, {
    method: 'PUT',
    body: JSON.stringify({ answer }),
  });
  expect(res.status).toBe(200);
};

const checkIn = (eventId: string, code: string, token: string) =>
  request(`/v1/events/${eventId}/check-in`, token, {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

const listPath = (eventId: string, query = '') => `/v1/events/${eventId}/attendance${query}`;

async function chip(eventId: string, query: string, token = tokens.demoAdmin) {
  const res = await request(listPath(eventId, query), token);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as AttendancePage;
}

async function summary(eventId: string) {
  const res = await request(`/v1/events/${eventId}/attendance/summary`, tokens.demoAdmin);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as AttendanceSummary;
}

/** Attendance row id -> user id, for the fixture event. */
async function rowOwners(eventId: string): Promise<Map<string, string>> {
  const rows = await adminSql<{ id: string; user_id: string }[]>`
    select id, user_id from public.event_attendances where event_id = ${eventId}::uuid`;
  return new Map(rows.map((row) => [row.id, row.user_id]));
}

const owners = (page: AttendancePage, map: Map<string, string>) =>
  page.items.map((item) => map.get(item.id));

const soften = (email: string, on: boolean) => adminSql`
  update public.memberships m set deleted_at = ${on ? new Date() : null}
    from public.users u, public.tenants t
   where u.id = m.user_id and u.email = ${email} and t.id = m.tenant_id and t.slug = 'rede-demo'`;

async function sweep(): Promise<void> {
  await adminSql`delete from public.events where title like ${`${TEST_TITLE_PREFIX}%`}`;
}

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
  await sweep();
});

afterAll(async () => {
  await soften(EMAILS.sofia, false);
  await sweep();
});

describe('events attendance (Participantes)', () => {
  let fixture: EventSummary;
  let empty: EventSummary;
  let online: EventSummary;
  let fixtureCode = '';

  it('0. builds the fixture through the member APIs: 2 going, 1 checked_in, 1 walk_in, 1 not_going', async () => {
    fixture = await createEvent('fixture');
    empty = await createEvent('vazio');
    online = await createEvent('online', 'online');
    await rsvp(fixture.id, 'going', tokens.joao);
    await rsvp(fixture.id, 'going', tokens.iris);
    await rsvp(fixture.id, 'going', tokens.rafael);
    await rsvp(fixture.id, 'not_going', tokens.demoMember);
    await openWindow(fixture.id);
    fixtureCode = await codeOf(fixture.id);
    const rafael = await checkIn(fixture.id, fixtureCode, tokens.rafael);
    expect(rafael.status).toBe(200);
    expect(((await rafael.json()) as { outcome: string }).outcome).toBe('checked_in');
    const sofia = await checkIn(fixture.id, fixtureCode, tokens.sofia);
    expect(sofia.status).toBe(200);
    expect(((await sofia.json()) as { outcome: string }).outcome).toBe('walk_in');
  });

  it('1. T-06-44 / T-06-45: a member is 403 on the list, the summary and the regeneration', async () => {
    const list = await request(listPath(fixture.id), tokens.demoMember);
    expect(list.status).toBe(403);
    const sum = await request(`/v1/events/${fixture.id}/attendance/summary`, tokens.demoMember);
    expect(sum.status).toBe(403);
    const sumText = await sum.text();
    expect(sumText).not.toContain(fixtureCode);
    const regen = await request(`/v1/events/${fixture.id}/checkin-code`, tokens.joao, {
      method: 'POST',
    });
    expect(regen.status).toBe(403);
    expect(await codeOf(fixture.id)).toBe(fixtureCode);
  });

  it('2. the three chips return exactly the fixture rows, with walkIn only on the walk-in', async () => {
    const map = await rowOwners(fixture.id);
    const confirmed = await chip(fixture.id, '');
    expect(new Set(owners(confirmed, map))).toEqual(new Set([userIds.joao, userIds.iris]));
    expect(confirmed.items.every((item) => item.status === 'going' && !item.walkIn)).toBe(true);
    expect(confirmed.items.every((item) => item.checkedInAt === null && item.respondedAt)).toBe(
      true,
    );
    expect(confirmed.nextCursor).toBeNull();

    const present = await chip(fixture.id, '?list=present');
    expect(new Set(owners(present, map))).toEqual(new Set([userIds.rafael, userIds.sofia]));
    const byOwner = new Map(present.items.map((item) => [map.get(item.id), item]));
    expect(byOwner.get(userIds.rafael)).toMatchObject({ status: 'checked_in', walkIn: false });
    expect(byOwner.get(userIds.rafael)?.respondedAt).not.toBeNull();
    expect(byOwner.get(userIds.sofia)).toMatchObject({
      status: 'walk_in',
      walkIn: true,
      respondedAt: null,
    });

    const notGoing = await chip(fixture.id, '?list=not_going');
    expect(owners(notGoing, map)).toEqual([userIds.demoMember]);
    expect(notGoing.items[0]?.status).toBe('not_going');

    // Names come from the member join; no row carries an email or a role (T-06-46).
    for (const item of [...confirmed.items, ...present.items, ...notGoing.items]) {
      expect(item.removed).toBe(false);
      expect(typeof item.displayName).toBe('string');
      const text = JSON.stringify(item);
      expect(text).not.toContain('@rede-demo.local');
      expect(Object.keys(item)).not.toContain('role');
    }
  });

  it('3. Pitfall 11: pending 2 / present 2 / notGoing 1 / confirmed 3, and the code is event_secrets.checkin_code', async () => {
    await expect(summary(fixture.id)).resolves.toEqual({
      format: 'in_person',
      pendingConfirmedCount: 2,
      presentCount: 2,
      notGoingCount: 1,
      confirmedCount: 3,
      checkinCode: fixtureCode,
    });
    // The member-facing number is the same one the detail prints (D-219).
    const detail = await request(`/v1/events/${fixture.id}`, tokens.demoMember);
    expect(((await detail.json()) as EventSummary).confirmedCount).toBe(3);
  });

  it('4. EVENT-05 adjacency: a forced responded_at tie walked with limit=1 lists each row once, adjacent, id desc', async () => {
    await adminSql`
      update public.event_attendances
         set responded_at = date_trunc('second', now()) - interval '1 hour'
       where event_id = ${fixture.id}::uuid
         and user_id in ${adminSql([userIds.joao ?? '', userIds.iris ?? ''])}`;
    const seen: Attendee[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = `?list=confirmed&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = await chip(fixture.id, query);
      expect(page.items.length).toBeLessThanOrEqual(1);
      seen.push(...page.items);
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 5);
    expect(pages).toBe(2);
    expect(seen).toHaveLength(2);
    expect(seen[0]?.respondedAt).toBe(seen[1]?.respondedAt);
    const ids = seen.map((item) => item.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toEqual([...ids].sort().reverse());
  });

  it('5. EVENT-05 ordering: two identical requests answer deep-equal bodies on every chip', async () => {
    for (const query of ['?list=confirmed', '?list=present', '?list=not_going', '?limit=1']) {
      const first = await request(listPath(fixture.id, query), tokens.demoAdmin);
      const second = await request(listPath(fixture.id, query), tokens.demoAdmin);
      expect(await second.text(), query).toBe(await first.text());
    }
  });

  it('6. EVENT-05 empty: no answers gives { items: [], nextCursor: null } on every chip, and so does a cursor past the end', async () => {
    for (const list of ['confirmed', 'present', 'not_going']) {
      await expect(chip(empty.id, `?list=${list}`), list).resolves.toEqual({
        items: [],
        nextCursor: null,
      });
    }
    const pastTheEnd = Buffer.from(
      JSON.stringify({ v: 1, n: '1970-01-01T00:00:00.000000Z', id: fixture.id }),
    ).toString('base64url');
    for (const list of ['confirmed', 'present', 'not_going']) {
      await expect(chip(fixture.id, `?list=${list}&cursor=${pastTheEnd}`), list).resolves.toEqual({
        items: [],
        nextCursor: null,
      });
    }
    await expect(summary(empty.id)).resolves.toMatchObject({
      pendingConfirmedCount: 0,
      presentCount: 0,
      notGoingCount: 0,
      confirmedCount: 0,
    });
  });

  it('7. a member who has left is removed: true with a null name, and still counts (D-219/A5)', async () => {
    await soften(EMAILS.sofia, true);
    try {
      const map = await rowOwners(fixture.id);
      const present = await chip(fixture.id, '?list=present');
      const sofia = present.items.find((item) => map.get(item.id) === userIds.sofia);
      expect(sofia).toMatchObject({
        removed: true,
        displayName: null,
        avatarAssetId: null,
        walkIn: true,
      });
      const rafael = present.items.find((item) => map.get(item.id) === userIds.rafael);
      expect(rafael?.removed).toBe(false);
      await expect(summary(fixture.id)).resolves.toMatchObject({ presentCount: 2 });
    } finally {
      await soften(EMAILS.sofia, false);
    }
  });

  it('8. the summary code is null online', async () => {
    await expect(summary(online.id)).resolves.toEqual({
      format: 'online',
      pendingConfirmedCount: 0,
      presentCount: 0,
      notGoingCount: 0,
      confirmedCount: 0,
      checkinCode: null,
    });
  });

  it('9. D-217: regeneration gives a new code; the old one is wrong_code, the new one checks in, check-ins are kept', async () => {
    const res = await request(`/v1/events/${fixture.id}/checkin-code`, tokens.demoAdmin, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CheckinCode;
    expect(Object.keys(body)).toEqual(['checkinCode']);
    expect(body.checkinCode).toMatch(new RegExp(`^[${EVENT_CHECKIN_CODE_ALPHABET}]{4}$`));
    expect(body.checkinCode).not.toBe(fixtureCode);
    expect(await codeOf(fixture.id)).toBe(body.checkinCode);
    const [rotated] = await adminSql<{ fresh: boolean }[]>`
      select code_rotated_at > now() - interval '1 minute' as fresh
        from public.event_secrets where event_id = ${fixture.id}::uuid`;
    expect(rotated?.fresh).toBe(true);
    await expect(summary(fixture.id)).resolves.toMatchObject({ checkinCode: body.checkinCode });

    const old = await checkIn(fixture.id, fixtureCode, tokens.iris);
    expect(old.status).toBe(409);
    expect((await envelope(old)).details).toEqual({ event: 'wrong_code' });

    const fresh = await checkIn(fixture.id, body.checkinCode, tokens.iris);
    expect(fresh.status).toBe(200);
    expect(((await fresh.json()) as { outcome: string }).outcome).toBe('checked_in');

    // The earlier check-ins survived the rotation.
    const map = await rowOwners(fixture.id);
    const present = await chip(fixture.id, '?list=present');
    expect(new Set(owners(present, map))).toEqual(
      new Set([userIds.rafael, userIds.sofia, userIds.iris]),
    );

    // An online event has no door code to rotate.
    const onlineRegen = await request(`/v1/events/${online.id}/checkin-code`, tokens.demoAdmin, {
      method: 'POST',
    });
    expect(onlineRegen.status).toBe(404);
    expect((await envelope(onlineRegen)).details).toBeUndefined();
  });

  it('10. T-06-47: a lab event id is a bare 404 on all three routes, and the lab code is untouched', async () => {
    const labBefore = await codeOf(LAB_UPCOMING);
    for (const [path, method] of [
      [listPath(LAB_UPCOMING), 'GET'],
      [`/v1/events/${LAB_UPCOMING}/attendance/summary`, 'GET'],
      [`/v1/events/${LAB_UPCOMING}/checkin-code`, 'POST'],
    ] as const) {
      const res = await request(path, tokens.demoAdmin, { method });
      expect(res.status, path).toBe(404);
      const text = await res.text();
      const error = (JSON.parse(text) as Envelope).error;
      expect(error.code).toBe('NOT_FOUND');
      expect(error.details).toBeUndefined();
      expect(text).not.toContain(labBefore);
    }
    expect(await codeOf(LAB_UPCOMING)).toBe(labBefore);
    // The regeneration POST presented on the lab's registered host is refused before any read.
    const mismatch = await request(
      `/v1/events/${fixture.id}/checkin-code`,
      tokens.demoAdmin,
      { method: 'POST' },
      HOSTS.lab,
    );
    expect(mismatch.status).toBe(403);
    expect((await envelope(mismatch)).code).toBe('TENANT_HOST_MISMATCH');
  });

  it('11. T-06-48: list=PRESENT is 400, limit=0 clamps to 1, and a malformed id is 400', async () => {
    const upper = await request(listPath(fixture.id, '?list=PRESENT'), tokens.demoAdmin);
    expect(upper.status).toBe(400);
    expect((await envelope(upper)).code).toBe('VALIDATION_FAILED');
    const clamped = await chip(fixture.id, '?list=present&limit=0');
    expect(clamped.items).toHaveLength(1);
    expect(clamped.nextCursor).not.toBeNull();
    const malformed = await request(listPath('not-a-uuid'), tokens.demoAdmin);
    expect(malformed.status).toBe(400);
  });
});
