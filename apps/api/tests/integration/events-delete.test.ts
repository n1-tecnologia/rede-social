import type { EventPage, EventSummary } from '@rede-social/module-events/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * Deleting an event end to end against the live local stack and the real seed (09.3, PEND-01,
 * PEND-02, PEND-03, D-548..D-551): `DELETE /v1/events/{eventId}` is a SOFT delete by one guarded
 * UPDATE, guarded by the literal `events.event.manage`, answering 204 with `cache-control: no-store`.
 *
 * Every event this file writes is created through the admin API and carries `TEST_TITLE_PREFIX`, so
 * both hooks sweep exactly this file's rows (attendance and secrets cascade). A look-alike rede-lab
 * event is inserted with `adminSql` and removed after.
 *
 * What is proved here:
 *  - the tracer: one admin DELETE answers 204, the event leaves the lists and the next-event card and
 *    answers the bare 404 on every read and write surface, while its secrets and attendance stay;
 *  - a member is 403, an anonymous caller 401, and the event stays live;
 *  - an unknown id, another tenant's id and an already deleted id are one byte-identical bare 404.
 *
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order).
 */

type Envelope = {
  error: { code: string; message?: string; details?: unknown; requestId?: string };
};

const tokens = { demoAdmin: '', demoMember: '' };
const tenantIds = { demo: '', lab: '' };

/** The prefix every event THIS FILE writes carries, so the sweep can be exact. */
const TEST_TITLE_PREFIX = 'Evento de exclusao';

/** 06-01's seeded upcoming event #1 in rede-lab (`scripts/seed.ts` SEED_EVENT_IDS). */
const LAB_EVENT = '0e000000-0000-4000-8000-000000000e01';

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

/** The error body without the per-request id, so two answers compare byte for byte. */
function sansRequestId(raw: string): string {
  const parsed = JSON.parse(raw) as Envelope;
  const { requestId: _requestId, ...rest } = parsed.error;
  return JSON.stringify({ error: rest });
}

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
  format: 'in_person' | 'online';
  venueName?: string | null;
  address?: string | null;
  start: { date: string; time: string };
  end: { date: string; time: string };
};

/** An in-person body `days` from now at 19:00-21:00 tenant time. */
function inPerson(suffix: string, days = 3): Body {
  const date = tenantDate(days);
  return {
    title: `${TEST_TITLE_PREFIX} ${suffix}`,
    description: 'Descricao do encontro',
    format: 'in_person',
    venueName: 'Auditorio da sede',
    address: 'Rua das Flores, 100',
    start: { date, time: '19:00' },
    end: { date, time: '21:00' },
  };
}

async function create(body: Body): Promise<EventSummary> {
  const res = await request('/v1/events', tokens.demoAdmin, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return (await res.json()) as EventSummary;
}

const del = (eventId: string, token = tokens.demoAdmin, host = HOSTS.demo) =>
  request(`/v1/events/${eventId}`, token, { method: 'DELETE' }, host);

const answer = (eventId: string, token = tokens.demoMember) =>
  request(`/v1/events/${eventId}/rsvp`, token, {
    method: 'PUT',
    body: JSON.stringify({ answer: 'going' }),
  });

async function deletedAtOf(eventId: string): Promise<string | null | undefined> {
  const [row] = await adminSql<{ deleted_at: string | null }[]>`
    select deleted_at::text from public.events where id = ${eventId}::uuid`;
  return row?.deleted_at;
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

/** Asserts the bare 404: the `NOT_FOUND` code and no `details` key (D-23). */
async function expectBare404(res: Response, label: string): Promise<string> {
  const raw = await res.clone().text();
  expect(res.status, `${label}: ${raw}`).toBe(404);
  const error = await envelope(res);
  expect(error.code, label).toBe('NOT_FOUND');
  expect(Object.hasOwn(error, 'details'), label).toBe(false);
  return raw;
}

async function sweep(): Promise<void> {
  await adminSql`delete from public.events where title like ${`${TEST_TITLE_PREFIX}%`}`;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('rede-demo', 'rede-lab')`;
  for (const row of rows) {
    if (row.slug === 'rede-demo') tenantIds.demo = row.id;
    if (row.slug === 'rede-lab') tenantIds.lab = row.id;
  }
  await sweep();
});

afterAll(async () => {
  await sweep();
});

describe('events delete', () => {
  it('1. tracer: one admin DELETE is 204, the event vanishes from every surface, its rows stay', async () => {
    const created = await create(inPerson('tracer'));
    const answered = await answer(created.id);
    expect(answered.status).toBe(200);

    // Positive control: the member lists it before the delete.
    expect((await memberUpcoming()).map((e) => e.id)).toContain(created.id);

    const res = await del(created.id);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await deletedAtOf(created.id)).not.toBeNull();

    const id = created.id;
    const admin = (path: string, init: RequestInit = {}) => request(path, tokens.demoAdmin, init);
    const member = (path: string, init: RequestInit = {}) => request(path, tokens.demoMember, init);
    await expectBare404(await admin(`/v1/events/${id}`), 'admin detail');
    await expectBare404(await admin(`/v1/events/${id}/edit`), 'admin edit read');
    await expectBare404(await admin(`/v1/events/${id}/attendance`), 'attendance');
    await expectBare404(await admin(`/v1/events/${id}/attendance/summary`), 'summary');
    await expectBare404(
      await admin(`/v1/events/${id}/checkin-code`, { method: 'POST' }),
      'door code',
    );
    await expectBare404(await admin(`/v1/events/${id}/photos`), 'photos');
    await expectBare404(await member(`/v1/events/${id}`), 'member detail');
    await expectBare404(await answer(id), 'member rsvp');
    await expectBare404(
      await member(`/v1/events/${id}/check-in`, {
        method: 'POST',
        body: JSON.stringify({ code: 'ABC123' }),
      }),
      'member check-in',
    );
    await expectBare404(await member(`/v1/events/${id}/enter`, { method: 'POST' }), 'member enter');

    expect((await memberUpcoming()).map((e) => e.id)).not.toContain(id);
    const next = await member('/v1/events/next');
    expect(next.status).toBe(200);
    expect(((await next.json()) as { event: { id: string } | null }).event?.id).not.toBe(id);

    // The rows are still there (D-214, D-550).
    const [kept] = await adminSql<{ events: number; secrets: number; answers: number }[]>`
      select (select count(*)::int from public.events where id = ${id}::uuid) as events,
             (select count(*)::int from public.event_secrets where event_id = ${id}::uuid) as secrets,
             (select count(*)::int from public.event_attendances where event_id = ${id}::uuid) as answers`;
    expect(kept).toEqual({ events: 1, secrets: 1, answers: 1 });
  });

  it('2. permissions: a member is 403, an anonymous caller 401, and the event stays live', async () => {
    const created = await create(inPerson('permissoes'));

    const member = await del(created.id, tokens.demoMember);
    expect(member.status).toBe(403);
    expect((await envelope(member)).code).toBe('FORBIDDEN');
    const anonymous = await request(`/v1/events/${created.id}`, undefined, { method: 'DELETE' });
    expect(anonymous.status).toBe(401);

    expect(await deletedAtOf(created.id)).toBeNull();
    expect((await memberUpcoming()).map((e) => e.id)).toContain(created.id);
  });

  it('3. one bare 404: an unknown id, another tenant’s id and an already deleted id are byte-identical', async () => {
    const created = await create(inPerson('um 404'));
    expect((await del(created.id)).status).toBe(204);

    const unknown = await expectBare404(await del(crypto.randomUUID()), 'unknown');
    const foreign = await expectBare404(await del(LAB_EVENT), 'lab event');
    const again = await expectBare404(await del(created.id), 'already deleted');
    expect(sansRequestId(foreign)).toEqual(sansRequestId(unknown));
    expect(sansRequestId(again)).toEqual(sansRequestId(unknown));
    for (const text of [foreign, again]) {
      expect(text).not.toContain(tenantIds.lab);
      expect(text).not.toContain(LAB_EVENT);
    }

    // The lab event is still live.
    const [lab] = await adminSql<{ deleted_at: string | null }[]>`
      select deleted_at::text from public.events where id = ${LAB_EVENT}::uuid`;
    expect(lab?.deleted_at).toBeNull();
  });
});
