import { subscribe } from '@rede-social/core/server/events/bus';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { encodeCursor } from '@rede-social/core/server/paging';
import {
  EVENT_MAX_PAGE_SIZE,
  type EventPage,
  type EventPublished,
  type EventSummary,
  type NextEvent,
} from '@rede-social/module-events/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, authAdmin, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * `@rede-social/module-events` end to end against the live local stack and the real seed (06-01) — the
 * Phase 6 tracer, proved rather than asserted.
 *
 * `events tracer`: an admin's `POST /v1/events` (a wall-clock start in the TENANT's timezone) answers
 * 201, and the SAME event is on a member's `GET /v1/events?period=upcoming` walked to the end. That
 * one path crosses the module package, the registry, the guard chain, the wall-clock to UTC
 * conversion inside Postgres, both tables in one transaction (the deferred FKs are checked at its
 * commit) and the keyset read.
 *
 * `events list and create` is the battery around it: both keysets walked one row at a time (with a
 * deliberate `starts_at` tie broken by `id`), the in-progress and cancelled seeded events in the right
 * list, the clamps and the closed `period` enum, the permission guard, every input refusal on the
 * wire, the secrets table holding the URL, the wall clock converted in the TENANT's zone (and
 * following it when it changes), idempotency's create half, the cover rule, the after-commit event
 * and the module flag.
 *
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order), and both hooks sweep this
 * file's own rows by title prefix so a crashed run cannot poison the next one.
 */

type Envelope = {
  error: { code: string; message?: string; details?: unknown; requestId?: string };
};

const tokens = { demoAdmin: '', demoMember: '', labMember: '' };
const tenantIds = { demo: '', lab: '' };

/** The prefix every event THIS FILE writes carries, so the sweep can be exact. */
const TEST_TITLE_PREFIX = 'Evento de teste';

const request = (path: string, token?: string, init: RequestInit = {}) =>
  api.request(path, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });

/** One page, parsed. Fails loudly on a non-200 so a broken page never reads as an empty one. */
async function page(token: string, query = '', host = HOSTS.demo): Promise<EventPage> {
  const res = await request(`/v1/events${query}`, token, { headers: { 'x-tenant-host': host } });
  expect(res.status, `GET /v1/events${query}`).toBe(200);
  return (await res.json()) as EventPage;
}

/** Walk every page of one period with the returned cursors, in the server's order. */
async function walk(
  token: string,
  period: 'upcoming' | 'past',
  limit: number,
  host = HOSTS.demo,
): Promise<EventSummary[]> {
  const seen: EventSummary[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 80; guard++) {
    const query: string = cursor
      ? `?period=${period}&limit=${limit}&cursor=${encodeURIComponent(cursor)}`
      : `?period=${period}&limit=${limit}`;
    const body = await page(token, query, host);
    seen.push(...body.items);
    cursor = body.nextCursor;
    if (cursor === null) break;
  }
  expect(cursor, 'the walk terminated').toBeNull();
  return seen;
}

/** `YYYY-MM-DD` of the tenant-local calendar day `offsetDays` from now (the `en-CA` trick). */
function tenantDate(offsetDays: number, timeZone = 'America/Sao_Paulo'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

/** Removes everything this file wrote, by title prefix. The secrets row goes with it (cascade). */
async function sweep(): Promise<void> {
  await adminSql`delete from public.events where title like ${`${TEST_TITLE_PREFIX}%`}`;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.labMember = await signInAs('member@rede-lab.local', SEED_PASSWORD);
  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('rede-demo', 'rede-lab')`;
  for (const row of rows) {
    if (row.slug === 'rede-demo') tenantIds.demo = row.id;
    if (row.slug === 'rede-lab') tenantIds.lab = row.id;
  }
  await sweep();
  unsubscribe = subscribe('event.published', async (payload) => {
    published.push(payload);
  });
});

afterAll(async () => {
  unsubscribe();
  await sweep();
});

/** Every `event.published` this file observed, collected through the REAL bus. */
const published: EventPublished[] = [];
let unsubscribe: () => void = () => {};

describe('events tracer', () => {
  it('an admin creates an event and a member of the tenant sees it in the upcoming list', async () => {
    const tomorrow = tenantDate(1);
    const res = await request('/v1/events', tokens.demoAdmin, {
      method: 'POST',
      headers: { 'x-tenant-host': HOSTS.demo },
      body: JSON.stringify({
        title: `${TEST_TITLE_PREFIX} tracer`,
        format: 'in_person',
        venueName: 'Auditorio da sede',
        address: 'Rua das Flores, 100',
        start: { date: tomorrow, time: '19:00' },
        end: { date: tomorrow, time: '21:00' },
      }),
    });
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    const created = (await res.json()) as EventSummary;

    // 19:00 in America/Sao_Paulo (UTC-3, no DST) is 22:00Z, converted by Postgres, not by JS.
    expect(created.startsAt).toBe(`${tomorrow}T22:00:00.000000Z`);
    expect(created.status).toBe('active');
    expect(Object.keys(created)).not.toContain('meetingUrl');
    expect(Object.keys(created)).not.toContain('checkinCode');

    // Both halves were written: the secrets row exists, with a code in the CHECKed shape.
    const [secret] = await adminSql<{ checkin_code: string; meeting_url: string | null }[]>`
      select checkin_code, meeting_url from public.event_secrets where event_id = ${created.id}::uuid`;
    expect(secret?.checkin_code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
    expect(secret?.meeting_url).toBeNull();

    // The member's upcoming list, walked to the end, contains the SAME event.
    const upcoming = await walk(tokens.demoMember, 'upcoming', 5);
    const seen = upcoming.find((event) => event.id === created.id);
    expect(seen).toEqual(created);
  });
});

/** `POST /v1/events` on the demo host. */
const post = (token: string, body: unknown) =>
  request('/v1/events', token, {
    method: 'POST',
    headers: { 'x-tenant-host': HOSTS.demo },
    body: JSON.stringify(body),
  });

/** A valid in-person body, `days` tenant-local days from today at 19:00–21:00. */
const inPerson = (suffix: string, days = 10) => ({
  title: `${TEST_TITLE_PREFIX} ${suffix}`,
  format: 'in_person',
  venueName: 'Auditorio da sede',
  address: 'Rua das Flores, 100',
  start: { date: tenantDate(days), time: '19:00' },
  end: { date: tenantDate(days), time: '21:00' },
});

const envelope = async (res: Response) => ((await res.json()) as Envelope).error;

/** The demo tenant's live events of one period, in the order the statement orders them. */
async function dbOrder(period: 'upcoming' | 'past'): Promise<string[]> {
  const rows =
    period === 'upcoming'
      ? await adminSql<{ id: string }[]>`
          select id from public.events
           where tenant_id = ${tenantIds.demo}::uuid and deleted_at is null and ends_at > now()
           order by starts_at asc, id asc`
      : await adminSql<{ id: string }[]>`
          select id from public.events
           where tenant_id = ${tenantIds.demo}::uuid and deleted_at is null and ends_at <= now()
           order by ends_at desc, id desc`;
  return rows.map((row) => row.id);
}

/** What `scripts/seed.ts` writes (`SEED_EVENTS`), by title, for both tenants. */
const SEEDED = {
  inProgress: 'Semana de integracao',
  upcomingCancelled: 'Oficina de fotografia',
  pastCancelled: 'Cafe com a diretoria',
  pastInPerson: 'Mutirao de primavera',
} as const;

describe('events list and create', () => {
  it('1. the upcoming walk at limit=1 visits every event once, in (starts_at, id) order, a tie broken by id', async () => {
    // A deliberate tie the test owns: two events with the SAME starts_at, both halves in one
    // statement each (the deferred keys are checked at the autocommit).
    const tieAt = new Date(Date.now() + 20 * 86_400_000).toISOString();
    for (const n of [1, 2]) {
      await adminSql`
        with e as (
          insert into public.events (tenant_id, created_by_user_id, title, format, venue_name, address,
                                     starts_at, ends_at)
          select ${tenantIds.demo}::uuid, created_by_user_id, ${`${TEST_TITLE_PREFIX} empate ${n}`},
                 'in_person', 'Sede', 'Rua A, 1', ${tieAt}::timestamptz,
                 ${tieAt}::timestamptz + interval '2 hours'
            from public.events where tenant_id = ${tenantIds.demo}::uuid limit 1
          returning id, tenant_id, format
        )
        insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code)
        select id, tenant_id, format, 'K7QM' from e`;
    }

    const walked = await walk(tokens.demoMember, 'upcoming', 1);
    const ids = walked.map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(await dbOrder('upcoming'));

    const tie = walked.filter((event) => event.title.startsWith(`${TEST_TITLE_PREFIX} empate`));
    expect(tie).toHaveLength(2);
    expect(tie[0]?.startsAt).toBe(tie[1]?.startsAt);
    const [first, second] = tie.map((event) => event.id);
    expect((first ?? '') < (second ?? '')).toBe(true);
    // Adjacent in the walk: the page boundary fell between them and neither was skipped or repeated.
    expect(ids.indexOf(second ?? '') - ids.indexOf(first ?? '')).toBe(1);
  });

  it('2. the past walk runs most recently ended first', async () => {
    const walked = await walk(tokens.demoMember, 'past', 1);
    const ids = walked.map((event) => event.id);
    expect(ids).toEqual(await dbOrder('past'));
    const ends = walked.map((event) => event.endsAt);
    expect([...ends].sort().reverse()).toEqual(ends);
    expect(walked.map((event) => event.title)).toContain(SEEDED.pastInPerson);
  });

  it('3. the in-progress event is upcoming, never past; both cancelled events stay in their lists', async () => {
    const upcoming = await walk(tokens.demoMember, 'upcoming', 25);
    const past = await walk(tokens.demoMember, 'past', 25);
    const titles = (list: EventSummary[]) => list.map((event) => event.title);

    expect(titles(upcoming)).toContain(SEEDED.inProgress);
    expect(titles(past)).not.toContain(SEEDED.inProgress);

    const upcomingCancelled = upcoming.find((event) => event.title === SEEDED.upcomingCancelled);
    expect(upcomingCancelled?.status).toBe('cancelled');
    const pastCancelled = past.find((event) => event.title === SEEDED.pastCancelled);
    expect(pastCancelled?.status).toBe('cancelled');
  });

  it('4. limit clamps both ways, a hostile cursor degrades to page 1, and period is a closed enum', async () => {
    expect((await page(tokens.demoMember, '?period=upcoming&limit=0')).items).toHaveLength(1);
    const wide = await page(tokens.demoMember, '?period=upcoming&limit=100000');
    expect(wide.items.length).toBeLessThanOrEqual(EVENT_MAX_PAGE_SIZE);
    expect(wide.items.length).toBeGreaterThan(1);

    const first = await page(tokens.demoMember, '?period=upcoming&limit=2');
    for (const hostile of [
      'not-a-cursor',
      Buffer.from('{"v":9}').toString('base64url'),
      encodeCursor({ n: '2026-01-01T00:00:00.000000Z', id: 'not-a-uuid' }),
      // WR-01: a well-formed envelope whose `n` is not an instant would fail the ::timestamptz cast.
      encodeCursor({ n: 'not-a-date', id: '0e000000-0000-4000-8000-000000000e01' }),
      encodeCursor({
        n: '2026-02-30T00:00:00.000000Z',
        id: '0e000000-0000-4000-8000-000000000e01',
      }),
      encodeCursor({
        n: '2026-01-01T99:00:00.000000Z',
        id: '0e000000-0000-4000-8000-000000000e01',
      }),
    ]) {
      const again = await page(
        tokens.demoMember,
        `?period=upcoming&limit=2&cursor=${encodeURIComponent(hostile)}`,
      );
      expect(again.items.map((event) => event.id)).toEqual(first.items.map((event) => event.id));
    }

    for (const bad of ['PAST', 'soon', 'passados']) {
      const res = await request(`/v1/events?period=${bad}`, tokens.demoMember, {
        headers: { 'x-tenant-host': HOSTS.demo },
      });
      expect(res.status, bad).toBe(400);
      expect((await envelope(res)).code).toBe('VALIDATION_FAILED');
    }
  });

  it('5. creating is a permission: a member is 403, the admin is 201', async () => {
    const member = await post(tokens.demoMember, inPerson('membro'));
    expect(member.status).toBe(403);
    expect((await envelope(member)).code).toBe('FORBIDDEN');
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.events where title = ${`${TEST_TITLE_PREFIX} membro`}`;
    expect(row?.n).toBe(0);

    const admin = await post(tokens.demoAdmin, inPerson('admin'));
    expect(admin.status).toBe(201);
  });

  it('6. every input refusal reaches the wire as its details.event code', async () => {
    const online = {
      title: `${TEST_TITLE_PREFIX} recusa`,
      format: 'online',
      meetingUrl: 'https://meet.example.test/x',
      start: { date: tenantDate(10), time: '19:00' },
      end: { date: tenantDate(10), time: '21:00' },
    };
    const cases: [unknown, string][] = [
      [{ ...inPerson('recusa'), title: '   ' }, 'name_required'],
      [{ ...inPerson('recusa'), end: { date: tenantDate(10), time: '19:00' } }, 'end_before_start'],
      [{ ...inPerson('recusa'), venueName: '' }, 'location_required'],
      [{ ...inPerson('recusa'), meetingUrl: 'https://meet.example.test/x' }, 'location_required'],
      [{ ...online, meetingUrl: null }, 'url_required'],
      [{ ...online, venueName: 'Sede' }, 'url_required'],
      [{ ...online, meetingUrl: 'http://meet.example.test/x' }, 'url_invalid'],
      [{ ...online, meetingUrl: 'javascript:alert(1)' }, 'url_invalid'],
    ];
    for (const [body, expected] of cases) {
      const res = await post(tokens.demoAdmin, body);
      expect(res.status, expected).toBe(400);
      const error = await envelope(res);
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details).toEqual({ event: expected });
    }
    // An unknown key (a forged tenant) fails loudly, never as a machine code.
    const forged = await post(tokens.demoAdmin, { ...inPerson('recusa'), tenantId: tenantIds.lab });
    expect(forged.status).toBe(400);
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.events where title = ${`${TEST_TITLE_PREFIX} recusa`}`;
    expect(row?.n).toBe(0);
  });

  it('7. an online create stores the URL in event_secrets only, and the response carries none', async () => {
    const res = await post(tokens.demoAdmin, {
      title: `${TEST_TITLE_PREFIX} online`,
      format: 'online',
      meetingUrl: 'https://meet.example.test/segredo',
      start: { date: tenantDate(10), time: '19:00' },
      end: { date: tenantDate(10), time: '21:00' },
    });
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain('meet.example.test');
    const created = JSON.parse(text) as EventSummary;
    expect(created.format).toBe('online');
    expect(created.venueName).toBeNull();

    const [secret] = await adminSql<{ meeting_url: string | null; event_format: string }[]>`
      select meeting_url, event_format from public.event_secrets where event_id = ${created.id}::uuid`;
    expect(secret).toEqual({
      meeting_url: 'https://meet.example.test/segredo',
      event_format: 'online',
    });

    // …and the member's list item for it carries no URL either.
    const listed = (await walk(tokens.demoMember, 'upcoming', 25)).find((e) => e.id === created.id);
    expect(JSON.stringify(listed)).not.toContain('meet.example.test');
  });

  it('8. the wall clock is converted in the TENANT zone, and follows the zone when it changes', async () => {
    const date = tenantDate(12);
    const saoPaulo = (await (
      await post(tokens.demoAdmin, inPerson('fuso sp', 12))
    ).json()) as EventSummary;
    expect(saoPaulo.startsAt).toBe(`${date}T22:00:00.000000Z`);

    try {
      await adminSql`update public.tenants set timezone = 'America/Manaus' where id = ${tenantIds.demo}::uuid`;
      const manaus = (await (
        await post(tokens.demoAdmin, inPerson('fuso manaus', 12))
      ).json()) as EventSummary;
      expect(manaus.startsAt).toBe(`${date}T23:00:00.000000Z`);
    } finally {
      await adminSql`update public.tenants set timezone = 'America/Sao_Paulo' where id = ${tenantIds.demo}::uuid`;
    }
  });

  it('9. a start already in the past is accepted and lands in Passados (planning decision 7)', async () => {
    const res = await post(tokens.demoAdmin, {
      ...inPerson('passado'),
      start: { date: tenantDate(-3), time: '19:00' },
      end: { date: tenantDate(-3), time: '21:00' },
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as EventSummary;
    const past = await walk(tokens.demoMember, 'past', 25);
    expect(past.map((event) => event.id)).toContain(created.id);
    const upcoming = await walk(tokens.demoMember, 'upcoming', 25);
    expect(upcoming.map((event) => event.id)).not.toContain(created.id);
  });

  it('10. idempotency, create half: two identical bodies create two events with two codes', async () => {
    const body = inPerson('duplicado');
    const a = await post(tokens.demoAdmin, body);
    const b = await post(tokens.demoAdmin, body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const ids = [((await a.json()) as EventSummary).id, ((await b.json()) as EventSummary).id];
    expect(ids[0]).not.toBe(ids[1]);
    const rows = await adminSql<{ event_id: string }[]>`
      select event_id from public.event_secrets where event_id = any(${ids}::uuid[])`;
    expect(rows).toHaveLength(2);
  });

  it('11. a foreign cover is a bare 404; a feed post image of this tenant is cover_invalid', async () => {
    const [foreign] = await adminSql<{ id: string }[]>`
      select id from public.media_assets where tenant_id = ${tenantIds.lab}::uuid limit 1`;
    const [postAsset] = await adminSql<{ id: string }[]>`
      select id from public.media_assets
       where tenant_id = ${tenantIds.demo}::uuid and purpose = 'post' and kind = 'image'
         and status = 'ready' and deleted_at is null limit 1`;
    expect(foreign?.id).toBeTruthy();
    expect(postAsset?.id).toBeTruthy();

    const miss = await post(tokens.demoAdmin, { ...inPerson('capa'), coverAssetId: foreign?.id });
    expect(miss.status).toBe(404);
    const missError = await envelope(miss);
    expect(missError.code).toBe('NOT_FOUND');
    expect(Object.hasOwn(missError, 'details')).toBe(false);

    const invalid = await post(tokens.demoAdmin, {
      ...inPerson('capa'),
      coverAssetId: postAsset?.id,
    });
    expect(invalid.status).toBe(400);
    expect((await envelope(invalid)).details).toEqual({ event: 'cover_invalid' });

    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.events where title = ${`${TEST_TITLE_PREFIX} capa`}`;
    expect(row?.n).toBe(0);
  });

  it('12. event.published is delivered exactly once per create, with the exact key set', async () => {
    const before = published.length;
    const res = await post(tokens.demoAdmin, inPerson('evento publicado'));
    expect(res.status).toBe(201);
    const created = (await res.json()) as EventSummary;
    const mine = published.slice(before).filter((payload) => payload.eventId === created.id);
    expect(mine).toHaveLength(1);
    expect(Object.keys(mine[0] ?? {}).sort()).toEqual([
      'actorUserId',
      'endsAt',
      'eventId',
      'format',
      'startsAt',
      'tenantId',
    ]);
    expect(mine[0]).toMatchObject({
      tenantId: tenantIds.demo,
      format: 'in_person',
      startsAt: created.startsAt,
      endsAt: created.endsAt,
    });
    // A refused create publishes nothing.
    const refusedBefore = published.length;
    await post(tokens.demoAdmin, { ...inPerson('evento publicado'), title: '' });
    expect(published.length).toBe(refusedBefore);
  });

  it('13. MOD-04: with events off for rede-lab, the routes are 404 MODULE_DISABLED and the tab is gone', async () => {
    const lab = async () =>
      request('/v1/events', tokens.labMember, { headers: { 'x-tenant-host': HOSTS.lab } });
    const labKeys = async () => {
      const res = await request('/v1/me/bootstrap', tokens.labMember, {
        headers: { 'x-tenant-host': HOSTS.lab },
      });
      return ((await res.json()) as { modules: { key: string }[] }).modules.map((m) => m.key);
    };

    // Positive control: seeded, the lab member lists and has the tab.
    expect((await lab()).status).toBe(200);
    expect(await labKeys()).toContain('events');

    try {
      await adminSql`
        update public.tenant_modules set enabled = false
         where tenant_id = ${tenantIds.lab}::uuid and module_key = 'events'`;
      moduleFlags.invalidate(tenantIds.lab);
      const off = await lab();
      expect(off.status).toBe(404);
      expect((await envelope(off)).code).toBe('MODULE_DISABLED');
      expect(await labKeys()).not.toContain('events');
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = true
         where tenant_id = ${tenantIds.lab}::uuid and module_key = 'events'`;
      moduleFlags.invalidate(tenantIds.lab);
    }
    expect((await lab()).status).toBe(200);
  });
});

/**
 * 06-08 (D-202, UI-D-214): `GET /v1/events/next`, the Início card's read. The ordering cases run in a
 * THROWAWAY tenant with `events` on and one member, so no seeded row moves (other files count the
 * seed). The seeded tenants are only READ: each lane's answer must equal the database's own
 * "soonest active not-ended" row for THAT tenant, which is also the cross-tenant proof (T-06-53).
 */
describe('next', () => {
  const SLUG = `e2e-next-${Date.now()}`.slice(0, 40);
  const MEMBER = `member-${SLUG}@rede-social-test.local`;
  const PASSWORD = 'Segredo123';
  let tenantId = '';
  let userId = '';
  let token = '';

  const next = async (bearer: string, host?: string): Promise<NextEvent> => {
    const res = await request(
      '/v1/events/next',
      bearer,
      host ? { headers: { 'x-tenant-host': host } } : {},
    );
    expect(res.status, 'GET /v1/events/next').toBe(200);
    return (await res.json()) as NextEvent;
  };

  /** One event of the throwaway tenant, relative to the DATABASE's now(), with its secrets row. */
  async function insert(
    title: string,
    startsInMinutes: number,
    endsInMinutes: number,
    status: 'active' | 'cancelled' = 'active',
  ): Promise<string> {
    const rows = await adminSql<{ id: string }[]>`
      with e as (
        insert into public.events (tenant_id, created_by_user_id, title, format, venue_name,
                                   address, starts_at, ends_at, status, cancelled_at)
        values (${tenantId}::uuid, ${userId}::uuid, ${title}, 'in_person', 'Sala', 'Rua 1',
                now() + make_interval(mins => ${startsInMinutes}),
                now() + make_interval(mins => ${endsInMinutes}),
                ${status}, ${status === 'cancelled' ? adminSql`now()` : null})
        returning id, tenant_id, format
      )
      insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code, meeting_url)
      select id, tenant_id, format, 'K7QM', null from e
      returning event_id as id`;
    const id = rows[0]?.id;
    if (!id) throw new Error(`could not insert ${title}`);
    return id;
  }

  /** The database's own answer for one tenant: the rule the endpoint must mirror exactly. */
  async function dbNext(forTenant: string): Promise<string | null> {
    const [row] = await adminSql<{ id: string }[]>`
      select id from public.events
       where tenant_id = ${forTenant}::uuid and deleted_at is null
         and status = 'active' and ends_at > now()
       order by starts_at asc, id asc
       limit 1`;
    return row?.id ?? null;
  }

  beforeAll(async () => {
    const created = await adminSql<{ id: string }[]>`
      insert into public.tenants (slug, display_name, rules_text, rules_version)
      values (${SLUG}, 'Comunidade Proximo Evento', 'Regras de teste.', 1)
      returning id`;
    tenantId = created[0]?.id ?? '';
    await adminSql`
      insert into public.tenant_modules (tenant_id, module_key, enabled)
      values (${tenantId}::uuid, 'events', true)`;
    const { data, error } = await authAdmin().createUser({
      email: MEMBER,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name: 'Proximo Evento' },
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    userId = data.user.id;
    await adminSql`
      insert into public.memberships (tenant_id, user_id, role, status)
      values (${tenantId}::uuid, ${userId}::uuid, 'member', 'active')`;
    token = await signInAs(MEMBER, PASSWORD);
  });

  afterAll(async () => {
    // Events first (their tenant key does not cascade), then the user (its membership goes with
    // it), then the tenant: the modules.test teardown order.
    await adminSql`delete from public.events where tenant_id = ${tenantId}::uuid`;
    await adminSql`delete from public.memberships where tenant_id = ${tenantId}::uuid`;
    if (userId) await authAdmin().deleteUser(userId);
    await adminSql`delete from public.tenants where slug = ${SLUG}`;
  });

  it('1. no upcoming event answers { event: null }, and an ended one does not count', async () => {
    expect(await next(token)).toEqual({ event: null });
    await insert('Ja terminou', -300, -60);
    expect(await next(token)).toEqual({ event: null });
  });

  it('2. the soonest active event is returned, with the viewer state and the two counts', async () => {
    const later = await insert('Mais tarde', 3 * 24 * 60, 3 * 24 * 60 + 120);
    const sooner = await insert('Mais cedo', 24 * 60, 24 * 60 + 120);
    const body = await next(token);
    expect(body.event?.id).toBe(sooner);
    expect(body.event?.id).not.toBe(later);
    expect(body.event).toMatchObject({
      status: 'active',
      viewerStatus: null,
      viewerCheckedInAt: null,
      confirmedCount: 0,
      presentCount: 0,
    });
    // The same shape as a list item: no meeting URL and no check-in code key (D-207, D-208).
    expect(JSON.stringify(body)).not.toMatch(/meeting|checkin_?code|K7QM/i);
  });

  it('3. a cancelled SOONER event is skipped', async () => {
    const expected = (await next(token)).event?.id;
    const cancelled = await insert('Cancelado antes', 60, 180, 'cancelled');
    const body = await next(token);
    expect(body.event?.id).not.toBe(cancelled);
    expect(body.event?.id).toBe(expected);
  });

  it('4. an event in progress is returned while it runs', async () => {
    const running = await insert('Acontecendo', -30, 90);
    expect((await next(token)).event?.id).toBe(running);
    expect(await dbNext(tenantId)).toBe(running);
  });

  it("5. each seeded lane gets ITS tenant's next event only (a lab member never sees the demo's)", async () => {
    const [demoExpected, labExpected] = [await dbNext(tenantIds.demo), await dbNext(tenantIds.lab)];
    const demo = await next(tokens.demoMember, HOSTS.demo);
    const lab = await next(tokens.labMember, HOSTS.lab);
    expect(demo.event?.id ?? null).toBe(demoExpected);
    expect(lab.event?.id ?? null).toBe(labExpected);
    if (demo.event) expect(demo.event.id).not.toBe(lab.event?.id);
    if (lab.event) {
      const [owner] = await adminSql<{ tenant_id: string }[]>`
        select tenant_id from public.events where id = ${lab.event.id}::uuid`;
      expect(owner?.tenant_id).toBe(tenantIds.lab);
    }
    // The demo's next event, asked for through the lab's lane, is a bare 404.
    if (demo.event) {
      const crossed = await request(`/v1/events/${demo.event.id}`, tokens.labMember, {
        headers: { 'x-tenant-host': HOSTS.lab },
      });
      expect(crossed.status).toBe(404);
    }
    // A demo session presented on the lab host is refused before any read.
    const mismatch = await request('/v1/events/next', tokens.demoMember, {
      headers: { 'x-tenant-host': HOSTS.lab },
    });
    expect(mismatch.status).toBe(403);
    expect((await envelope(mismatch)).code).toBe('TENANT_HOST_MISMATCH');
  });
});
