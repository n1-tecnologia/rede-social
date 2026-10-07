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
 * 2026-10-07 (quick 261007-n1g) — the event's programme ("Cronograma") end to end against the live
 * local stack and the real seed: `schedule` rides the create and the whole-event replacement, is
 * stored NORMALISED in `events.schedule`, and comes back on the member's detail and the admin's edit
 * read, never on the list or the write answers.
 *
 * What is proved here:
 *  - the tracer: an out-of-order schedule with a duplicate and a multi-line title is stored sorted,
 *    deduplicated and on one line, and the MEMBER's detail returns exactly that array;
 *  - the list items and the write answers carry no `schedule`; the edit read does, manage-only;
 *  - the replacement: a changed schedule is a change (one `event.updated`, `timesChanged` false), an
 *    identical PUT writes nothing, an absent key clears the stored array;
 *  - validation on the wire: every malformed shape is a 400 VALIDATION_FAILED and nothing is written
 *    (a refused PUT leaves the stored schedule alone);
 *  - permissions: a member's POST and PUT are 403 and change nothing;
 *  - tenant isolation: another tenant's member reads a bare 404, another tenant's admin cannot
 *    replace it (bare 404) and the stored schedule is unchanged;
 *  - the database is the last line of defence: a direct write of a non-array is 23514
 *    `events_schedule_chk`.
 *
 * Every event this file writes carries `TEST_TITLE_PREFIX` and is swept by both hooks. Test ORDER is
 * load-bearing (`fileParallelism: false`, declaration order).
 */

type Envelope = {
  error: { code: string; message?: string; details?: unknown; requestId?: string };
};

const tokens = { demoAdmin: '', demoMember: '', labMember: '', labAdmin: '' };

const TEST_TITLE_PREFIX = 'Evento de cronograma';

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

type Moment = { day: number; time: string; title: string };

type Body = {
  title: string;
  description?: string;
  schedule?: unknown;
  format: 'in_person' | 'online';
  venueName?: string | null;
  address?: string | null;
  start: { date: string; time: string };
  end: { date: string; time: string };
};

/** An in-person body `days` from now at 19:00-21:00 tenant time. */
function body(suffix: string, extra: Partial<Body> = {}, days = 4): Body {
  const date = tenantDate(days);
  return {
    title: `${TEST_TITLE_PREFIX} ${suffix}`,
    format: 'in_person',
    venueName: 'Auditorio da sede',
    address: 'Avenida Paulista, 1578, São Paulo - SP',
    start: { date, time: '19:00' },
    end: { date, time: '21:00' },
    ...extra,
  };
}

const post = (payload: unknown, token = tokens.demoAdmin) =>
  request('/v1/events', token, { method: 'POST', body: JSON.stringify(payload) });

const put = (eventId: string, payload: unknown, token = tokens.demoAdmin, host = HOSTS.demo) =>
  request(`/v1/events/${eventId}`, token, { method: 'PUT', body: JSON.stringify(payload) }, host);

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

async function stored(eventId: string) {
  const [row] = await adminSql<{ schedule: unknown; updated_at: string }[]>`
    select schedule, updated_at::text from public.events where id = ${eventId}::uuid`;
  return row;
}

async function countByTitle(title: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.events where title = ${title}`;
  return row?.n ?? 0;
}

async function sweep(): Promise<void> {
  await adminSql`delete from public.events where title like ${`${TEST_TITLE_PREFIX}%`}`;
}

const updates: EventUpdated[] = [];
let stop: () => void = () => {};
/** Waits for the after-commit bus to deliver (subscribers run after the response). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

/** The messy list every case starts from, and the stored form it must become. */
const messy: Moment[] = [
  { day: 2, time: '09:00', title: '  Abertura\n do   dia ' },
  { day: 1, time: '19:00', title: 'Jantar' },
  { day: 1, time: '08:00', title: 'Credenciamento' },
  { day: 1, time: '19:00', title: 'Jantar' },
];
const normalised: Moment[] = [
  { day: 1, time: '08:00', title: 'Credenciamento' },
  { day: 1, time: '19:00', title: 'Jantar' },
  { day: 2, time: '09:00', title: 'Abertura do dia' },
];

let tracerId = '';

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.labMember = await signInAs('member@rede-lab.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  await sweep();
  stop = subscribe('event.updated', async (payload) => {
    updates.push(payload);
  });
});

afterAll(async () => {
  stop();
  await sweep();
});

describe('events schedule', () => {
  it('1. tracer: the admin POSTs a messy schedule, the row holds the normalised array, the member reads it', async () => {
    const res = await post(body('tracer', { schedule: messy }));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    const created = (await res.json()) as EventSummary;
    // The write answer is the summary shape: no schedule key.
    expect('schedule' in created).toBe(false);
    tracerId = created.id;

    expect((await stored(tracerId))?.schedule).toEqual(normalised);
    expect((await detail(tracerId, tokens.demoMember)).schedule).toEqual(normalised);
  });

  it('2. the list items of the member carry no schedule key', async () => {
    const res = await request('/v1/events?period=upcoming&limit=25', tokens.demoMember);
    expect(res.status).toBe(200);
    const page = (await res.json()) as EventPage;
    const mine = page.items.find((item) => item.id === tracerId);
    expect(mine, 'the tracer event is in the list').toBeDefined();
    for (const item of page.items) expect('schedule' in item).toBe(false);
  });

  it('3. the admin edit read returns the schedule; a member is 403', async () => {
    const edit = await request(`/v1/events/${tracerId}/edit`, tokens.demoAdmin);
    expect(edit.status).toBe(200);
    expect(((await edit.json()) as EventEdit).schedule).toEqual(normalised);

    const refused = await request(`/v1/events/${tracerId}/edit`, tokens.demoMember);
    expect(refused.status).toBe(403);
  });

  it('4. the replacement: identical PUT writes nothing, a schedule-only change is one event.updated, an absent key clears', async () => {
    const payload = body('tracer', { schedule: messy });
    const before = await stored(tracerId);
    const seen = updates.length;

    // Identical body (the same messy list normalises to the stored one): nothing written, nothing emitted.
    expect((await put(tracerId, payload)).status).toBe(200);
    await settle();
    expect((await stored(tracerId))?.updated_at).toBe(before?.updated_at);
    expect(updates.slice(seen).filter((u) => u.eventId === tracerId)).toHaveLength(0);

    // Only the schedule changes.
    const next: Moment[] = [{ day: 1, time: '10:00', title: 'Workshop' }];
    const changed = await put(tracerId, { ...payload, schedule: next });
    expect(changed.status).toBe(200);
    expect('schedule' in ((await changed.json()) as object)).toBe(false);
    await settle();
    expect((await stored(tracerId))?.schedule).toEqual(next);
    expect((await detail(tracerId)).schedule).toEqual(next);
    const mine = updates.slice(seen).filter((u) => u.eventId === tracerId);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.timesChanged).toBe(false);

    // A PUT that omits the key clears it (the whole-event replacement rule).
    const { schedule: _schedule, ...bare } = payload;
    expect((await put(tracerId, bare)).status).toBe(200);
    expect((await stored(tracerId))?.schedule).toEqual([]);
    expect((await detail(tracerId)).schedule).toEqual([]);

    // Put it back for the cases below.
    expect((await put(tracerId, payload)).status).toBe(200);
    expect((await stored(tracerId))?.schedule).toEqual(normalised);
  });

  it('5. validation on the wire: every malformed schedule is a 400 and nothing is written', async () => {
    const moment: Moment = { day: 1, time: '09:00', title: 'Abertura' };
    const thirtyOne = Array.from({ length: 31 }, (_, i) => ({ ...moment, title: `Momento ${i}` }));
    const bad: Array<[string, unknown]> = [
      ['31 items', thirtyOne],
      ['time 24:00', [{ ...moment, time: '24:00' }]],
      ['time 8:00', [{ ...moment, time: '8:00' }]],
      ['day 0', [{ ...moment, day: 0 }]],
      ['day 32', [{ ...moment, day: 32 }]],
      ['day 1.5', [{ ...moment, day: 1.5 }]],
      ['empty title', [{ ...moment, title: '' }]],
      ['81-character title', [{ ...moment, title: 'x'.repeat(81) }]],
      ['unknown item key', [{ ...moment, room: 'A' }]],
      ['not an array', { day: 1 }],
    ];
    const kept = await stored(tracerId);
    for (const [name, schedule] of bad) {
      const created = await post(body('recusado', { schedule }));
      expect(created.status, name).toBe(400);
      const error = await envelope(created);
      expect(error.code, name).toBe('VALIDATION_FAILED');
      expect(Object.keys((error.details ?? {}) as object), name).toEqual(['issues']);

      const replaced = await put(tracerId, body('tracer', { schedule }));
      expect(replaced.status, name).toBe(400);
      expect((await envelope(replaced)).code, name).toBe('VALIDATION_FAILED');
    }
    // Nothing was written by the whole battery.
    expect(await countByTitle(`${TEST_TITLE_PREFIX} recusado`)).toBe(0);
    expect(await stored(tracerId)).toEqual(kept);
    // Positive control: the edges of the rules are accepted.
    const edge = await post(
      body('limite', {
        schedule: [{ day: 31, time: '23:59', title: 'x'.repeat(80) }],
      }),
    );
    expect(edge.status).toBe(201);
  });

  it('6. a member cannot write a schedule: POST and PUT are 403 and change nothing', async () => {
    const kept = await stored(tracerId);
    const posted = await post(body('do membro', { schedule: messy }), tokens.demoMember);
    expect(posted.status).toBe(403);
    expect(await countByTitle(`${TEST_TITLE_PREFIX} do membro`)).toBe(0);

    const replaced = await put(
      tracerId,
      body('tracer', { schedule: [{ day: 1, time: '10:00', title: 'Intruso' }] }),
      tokens.demoMember,
    );
    expect(replaced.status).toBe(403);
    expect(await stored(tracerId)).toEqual(kept);
  });

  it('7. tenant isolation: another tenant reads a bare 404 and cannot replace the schedule', async () => {
    const kept = await stored(tracerId);

    const read = await request(`/v1/events/${tracerId}`, tokens.labMember, {}, HOSTS.lab);
    expect(read.status).toBe(404);
    expect((await envelope(read)).details).toBeUndefined();

    const replaced = await put(
      tracerId,
      body('tracer', { schedule: [{ day: 1, time: '10:00', title: 'De outro tenant' }] }),
      tokens.labAdmin,
      HOSTS.lab,
    );
    expect(replaced.status).toBe(404);
    expect((await envelope(replaced)).details).toBeUndefined();
    expect(await stored(tracerId)).toEqual(kept);
    expect((await stored(tracerId))?.schedule).toEqual(normalised);
  });

  it('8. an event created without any schedule key reads back an empty array', async () => {
    const created = await create(body('sem cronograma'));
    expect((await stored(created.id))?.schedule).toEqual([]);
    expect((await detail(created.id)).schedule).toEqual([]);
    const edit = await request(`/v1/events/${created.id}/edit`, tokens.demoAdmin);
    expect(((await edit.json()) as EventEdit).schedule).toEqual([]);
  });

  it('9. the database is the last line of defence: a direct non-array write is 23514 events_schedule_chk', async () => {
    let caught: { code?: string; constraint_name?: string } | undefined;
    try {
      await adminSql`
        update public.events set schedule = '{"day":1}'::jsonb where id = ${tracerId}::uuid`;
    } catch (error) {
      caught = error as { code?: string; constraint_name?: string };
    }
    expect(caught?.code).toBe('23514');
    expect(caught?.constraint_name).toBe('events_schedule_chk');
    expect((await stored(tracerId))?.schedule).toEqual(normalised);
  });
});
