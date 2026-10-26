import { readFileSync } from 'node:fs';
import { subscribe } from '@rede-social/core/server/events/bus';
import type { EventPage, EventSummary } from '@rede-social/module-events/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, notificationJobsOf, SEED_PASSWORD, signInAs } from './setup';

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

const tokens = { demoAdmin: '', demoMember: '', labMember: '' };
const tenantIds = { demo: '', lab: '' };
const userIds = { demoAdmin: '', demoMember: '' };

/** Media assets this file inserts for photo fixtures, removed after the events that use them. */
const createdAssets: string[] = [];
const LOOK_ALIKE = '1e000000-0000-4000-8000-0000000000a1';

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
async function memberUpcoming(
  token = tokens.demoMember,
  host = HOSTS.demo,
): Promise<EventSummary[]> {
  const seen: EventSummary[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 40; guard++) {
    const query: string = cursor
      ? `?period=upcoming&limit=25&cursor=${encodeURIComponent(cursor)}`
      : '?period=upcoming&limit=25';
    const res = await request(`/v1/events${query}`, token, {}, host);
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
  const rows = await adminSql<{ id: string }[]>`
    select id::text as id from public.events where title like ${`${TEST_TITLE_PREFIX}%`}`;
  const eventIds = rows.map((row) => row.id);
  if (eventIds.length > 0) {
    await adminSql`delete from public.notifications where subject_id = any(${eventIds}::uuid[])`;
    await adminSql`delete from public.event_photos where event_id = any(${eventIds}::uuid[])`;
    await adminSql`
      delete from pgboss.job_common
       where name = 'events.reminder' and data->>'eventId' = any(${eventIds}::text[])`;
  }
  await adminSql`delete from public.events where title like ${`${TEST_TITLE_PREFIX}%`}`;
  if (createdAssets.length > 0) {
    await adminSql`delete from public.media_assets where id = any(${createdAssets}::uuid[])`;
    createdAssets.length = 0;
  }
}

/** Every row the delete must leave alone, as jsonb, so before and after compare byte for byte. */
async function keptRows(eventId: string) {
  const [row] = await adminSql<{ snapshot: unknown }[]>`
    select jsonb_build_object(
      'secrets', coalesce((select jsonb_agg(to_jsonb(s) order by s.event_id)
                             from public.event_secrets s where s.event_id = ${eventId}::uuid), '[]'),
      'attendances', coalesce((select jsonb_agg(to_jsonb(a) order by a.user_id)
                                 from public.event_attendances a where a.event_id = ${eventId}::uuid), '[]'),
      'photos', coalesce((select jsonb_agg(to_jsonb(p) order by p.id)
                            from public.event_photos p where p.event_id = ${eventId}::uuid), '[]'),
      'attempts', coalesce((select jsonb_agg(to_jsonb(t) order by t.user_id)
                              from public.event_checkin_attempts t where t.event_id = ${eventId}::uuid), '[]')
    ) as snapshot`;
  return row?.snapshot;
}

async function seedAsset(): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, width, height,
       variant_widths, filename, ready_at)
    values (${tenantIds.demo}::uuid, ${userIds.demoAdmin}::uuid, 'image', 'post', 'ready',
            'supabase', 'image/webp', 262144, 1600, 1200, '{320,640,1080,1600}'::int[],
            'evento-excluido.webp', now())
    returning id`;
  if (!row) throw new Error('could not seed an asset');
  createdAssets.push(row.id);
  return row.id;
}

/** A bell row about an event for the shared demo member, as the events module writes it. */
async function bellRow(eventId: string, title: string, ageSeconds: number): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.notifications
      (tenant_id, user_id, kind, dedupe_key, subject_type, subject_id, payload, created_at)
    values (${tenantIds.demo}::uuid, ${userIds.demoMember}::uuid, 'events.event',
            ${`events.event:${eventId}`}, 'event', ${eventId}::uuid,
            ${adminSql.json({ eventId, title, startsAt: new Date().toISOString(), previewAssetId: null })},
            now() - make_interval(secs => ${ageSeconds}))
    returning id::text as id`;
  if (!row) throw new Error('could not insert a bell row');
  return row.id;
}

type BellItem = {
  id: string;
  kind: string;
  subject: { type: string; id: string };
  removed: boolean;
};

async function memberBell(): Promise<BellItem[]> {
  const res = await request('/v1/notifications?section=unread&limit=50', tokens.demoMember);
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { items: BellItem[] }).items;
}

/** Waits for the after-commit bus to deliver (subscribers run after the response). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

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
  const users = await adminSql<{ id: string; email: string }[]>`
    select id::text as id, email::text as email from public.users
     where email in ('admin@rede-demo.local', 'member@rede-demo.local')`;
  userIds.demoAdmin = users.find((u) => u.email === 'admin@rede-demo.local')?.id ?? '';
  userIds.demoMember = users.find((u) => u.email === 'member@rede-demo.local')?.id ?? '';
  tokens.labMember = await signInAs('member@rede-lab.local', SEED_PASSWORD);
  await sweep();
});

afterAll(async () => {
  await adminSql`delete from public.events where id = ${LOOK_ALIKE}::uuid`;
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

  it('4. silent and preserved: no bus event, no row, no job, every kept row identical, the old bell row stays (D-549, D-550, D-551)', async () => {
    const created = await create(inPerson('silencio'));
    const id = created.id;
    // A member answer, a real check-in (the window opened by moving the start), a photo and an
    // attempts row: every table a delete could be tempted to touch.
    expect((await answer(id)).status).toBe(200);
    await adminSql`
      update public.events
         set starts_at = date_trunc('second', now()) + interval '30 minutes',
             ends_at = date_trunc('second', now()) + interval '2 hours 30 minutes'
       where id = ${id}::uuid`;
    const [secret] = await adminSql<{ checkin_code: string }[]>`
      select checkin_code from public.event_secrets where event_id = ${id}::uuid`;
    const checkedIn = await request(`/v1/events/${id}/check-in`, tokens.demoMember, {
      method: 'POST',
      body: JSON.stringify({ code: secret?.checkin_code }),
    });
    expect(checkedIn.status, await checkedIn.clone().text()).toBe(200);
    await adminSql`
      insert into public.event_photos (tenant_id, event_id, media_asset_id, created_by_user_id)
      values (${tenantIds.demo}::uuid, ${id}::uuid, ${await seedAsset()}::uuid,
              ${userIds.demoAdmin}::uuid)`;
    await adminSql`
      insert into public.event_checkin_attempts (tenant_id, event_id, user_id, failed_count)
      values (${tenantIds.demo}::uuid, ${id}::uuid, ${userIds.demoMember}::uuid, 1)`;
    const bell = await bellRow(id, created.title, 5);
    await settle();

    const counts = async () => {
      const [row] = await adminSql<{ notifications: number; reminders: number; fanouts: number }[]>`
        select (select count(*)::int from public.notifications
                 where tenant_id = ${tenantIds.demo}::uuid) as notifications,
               (select count(*)::int from pgboss.job_common
                 where name = 'events.reminder' and data->>'eventId' = ${id}) as reminders,
               (select count(*)::int from pgboss.job_common
                 where name = 'notifications.fanout') as fanouts`;
      return { ...row, tenantJobs: (await notificationJobsOf(tenantIds.demo)).length };
    };
    const rowsBefore = await keptRows(id);
    const countsBefore = await counts();
    const [attendance] = await adminSql<{ status: string }[]>`
      select status from public.event_attendances
       where event_id = ${id}::uuid and user_id = ${userIds.demoMember}::uuid`;
    expect(attendance?.status).toBe('checked_in');

    const seen: string[] = [];
    const stops = [
      subscribe('event.published', async (p) => void seen.push(`published:${p.eventId}`)),
      subscribe('event.updated', async (p) => void seen.push(`updated:${p.eventId}`)),
      subscribe('event.cancelled', async (p) => void seen.push(`cancelled:${p.eventId}`)),
      subscribe('event.reactivated', async (p) => void seen.push(`reactivated:${p.eventId}`)),
      subscribe('event.rsvp', async (p) => void seen.push(`rsvp:${p.eventId}`)),
      subscribe('event.checked_in', async (p) => void seen.push(`checked_in:${p.eventId}`)),
    ];
    try {
      expect((await del(id)).status).toBe(204);
      await settle();
    } finally {
      for (const stop of stops) stop();
    }

    expect(seen).toEqual([]);
    expect(await keptRows(id)).toEqual(rowsBefore);
    expect(await counts()).toEqual(countsBefore);
    // The reminder jobs still exist (they are no-ops at fire time).
    expect(countsBefore.reminders).toBeGreaterThan(0);

    // The old bell row survives, in the member's list, while its link is the bare 404 (D-551).
    const items = await memberBell();
    const mine = items.find((item) => item.id === bell);
    expect(mine?.subject).toEqual({ type: 'event', id });
    expect(mine?.removed).toBe(false);
    await expectBare404(await request(`/v1/events/${id}`, tokens.demoMember), 'the bell link');

    // Only the two columns the delete owns moved on the event row.
    const [event] = await adminSql<{ title: string; status: string }[]>`
      select title, status from public.events where id = ${id}::uuid`;
    expect(event).toEqual({ title: created.title, status: 'active' });
  });

  it('5. boundary (P1): over, cancelled, active in the future and ending right now all delete the same way', async () => {
    const over = await create(inPerson('encerrado'));
    await adminSql`
      update public.events
         set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour'
       where id = ${over.id}::uuid`;
    const cancelled = await create(inPerson('cancelado'));
    const cancel = await request(`/v1/events/${cancelled.id}`, tokens.demoAdmin, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelled' }),
    });
    expect(cancel.status).toBe(200);
    const future = await create(inPerson('futuro', 20));
    const ending = await create(inPerson('terminando'));
    await adminSql`
      update public.events
         set starts_at = now() - interval '1 hour', ends_at = now()
       where id = ${ending.id}::uuid`;

    const statuses = await Promise.all([over, cancelled, future, ending].map((e) => del(e.id)));
    expect(statuses.map((res) => res.status)).toEqual([204, 204, 204, 204]);
    for (const e of [over, cancelled, future, ending]) {
      expect(await deletedAtOf(e.id), e.title).not.toBeNull();
    }
    const listed = (await memberUpcoming()).map((e) => e.id);
    for (const e of [over, cancelled, future, ending]) expect(listed).not.toContain(e.id);
  });

  it('6. empty (P2): an event with no answers, photos, schedule or cover deletes and leaves every list', async () => {
    const created = await create(inPerson('vazio'));
    expect(await keptRows(created.id)).toMatchObject({ attendances: [], photos: [], attempts: [] });
    expect((await memberUpcoming()).map((e) => e.id)).toContain(created.id);
    expect((await del(created.id)).status).toBe(204);
    expect((await memberUpcoming()).map((e) => e.id)).not.toContain(created.id);
    const past = await request('/v1/events?period=past&limit=25', tokens.demoMember);
    expect(((await past.json()) as EventPage).items.map((e) => e.id)).not.toContain(created.id);
  });

  it('7. ordering (P3, P7, P9): a tied neighbour keeps its place, a cursor pages on, the bell keeps its order', async () => {
    // Two events with the SAME starts_at, far enough ahead to sit at the end of the list.
    const a = await create(inPerson('empate a', 40));
    const b = await create(inPerson('empate b', 40));
    expect(a.startsAt).toBe(b.startsAt);
    const [first, second] = a.id < b.id ? [a, b] : [b, a];
    const bellFirst = await bellRow(first.id, first.title, 20);
    const bellSecond = await bellRow(second.id, second.title, 10);

    const before = (await memberUpcoming()).map((e) => e.id);
    const bellBefore = (await memberBell()).map((item) => item.id);
    expect(bellBefore).toEqual(expect.arrayContaining([bellFirst, bellSecond]));

    // A cursor issued before the delete: walk at limit=1 until `first` has been seen.
    let cursor: string | null = null;
    let afterFirst: string | null = null;
    for (let guard = 0; guard < 60; guard++) {
      const query: string = cursor
        ? `?period=upcoming&limit=1&cursor=${encodeURIComponent(cursor)}`
        : '?period=upcoming&limit=1';
      const page = (await (
        await request(`/v1/events${query}`, tokens.demoMember)
      ).json()) as EventPage;
      cursor = page.nextCursor;
      if (page.items[0]?.id === first.id) {
        afterFirst = cursor;
        break;
      }
      if (cursor === null) break;
    }
    expect(afterFirst).not.toBeNull();

    expect((await del(first.id)).status).toBe(204);

    const after = (await memberUpcoming()).map((e) => e.id);
    expect(after).toEqual(before.filter((id) => id !== first.id));
    // The cursor from before the delete resumes at the neighbour: nothing skipped, nothing repeated.
    const resumed: string[] = [];
    let next: string | null = afterFirst;
    for (let guard = 0; guard < 60 && next !== null; guard++) {
      const page = (await (
        await request(
          `/v1/events?period=upcoming&limit=1&cursor=${encodeURIComponent(next)}`,
          tokens.demoMember,
        )
      ).json()) as EventPage;
      resumed.push(...page.items.map((e) => e.id));
      next = page.nextCursor;
    }
    expect(resumed).toEqual(before.slice(before.indexOf(first.id) + 1));
    expect(resumed[0]).toBe(second.id);

    // The next-event card never names the deleted id; the neighbour stays reachable (P7).
    const card = await request('/v1/events/next', tokens.demoMember);
    expect(((await card.json()) as { event: { id: string } | null }).event?.id).not.toBe(first.id);
    expect((await request(`/v1/events/${second.id}`, tokens.demoMember)).status).toBe(200);
    await expectBare404(await request(`/v1/events/${first.id}`, tokens.demoMember), 'deleted tie');

    // The bell keeps its order and both rows, each still pointing at its own event (P7, P9).
    const bellAfter = await memberBell();
    expect(bellAfter.map((item) => item.id)).toEqual(bellBefore);
    expect(bellAfter.find((item) => item.id === bellFirst)?.subject.id).toBe(first.id);
    expect(bellAfter.find((item) => item.id === bellSecond)?.subject.id).toBe(second.id);
  });

  it('8. idempotency (P4): a second DELETE is the bare 404 and does not move deleted_at', async () => {
    const created = await create(inPerson('duas vezes'));
    expect((await del(created.id)).status).toBe(204);
    const stamp = await deletedAtOf(created.id);
    const [row] = await adminSql<{ updated_at: string }[]>`
      select updated_at::text from public.events where id = ${created.id}::uuid`;
    await expectBare404(await del(created.id), 'second delete');
    expect(await deletedAtOf(created.id)).toBe(stamp);
    const [after] = await adminSql<{ updated_at: string }[]>`
      select updated_at::text from public.events where id = ${created.id}::uuid`;
    expect(after?.updated_at).toBe(row?.updated_at);
  });

  it('9. races (P5, P10): one 204 and one 404; a PUT racing a DELETE never leaves a live event; no answer is lost', async () => {
    const twice = await create(inPerson('corrida dupla'));
    const both = await Promise.all([del(twice.id), del(twice.id)]);
    expect(both.map((res) => res.status).sort()).toEqual([204, 404]);

    const body = inPerson('corrida put');
    const racing = await create(body);
    const [put, gone] = await Promise.all([
      request(`/v1/events/${racing.id}`, tokens.demoAdmin, {
        method: 'PUT',
        body: JSON.stringify({ ...body, title: `${body.title} novo` }),
      }),
      del(racing.id),
    ]);
    expect([200, 404]).toContain(put.status);
    expect(gone.status).toBe(204);
    expect(await deletedAtOf(racing.id)).not.toBeNull();

    // A member opening the event while the admin deletes it: the full detail or the bare 404.
    const opened = await create(inPerson('corrida leitura'));
    const [read, removed] = await Promise.all([
      request(`/v1/events/${opened.id}`, tokens.demoMember),
      del(opened.id),
    ]);
    expect(removed.status).toBe(204);
    expect([200, 404]).toContain(read.status);
    if (read.status === 200) {
      const detail = (await read.json()) as { id: string; title: string };
      expect(detail.id).toBe(opened.id);
      expect(detail.title).toBe(opened.title);
    } else {
      await expectBare404(read, 'the racing read');
    }

    // An answer racing the delete: the row that was there stays, and the new one exists only if
    // its call was accepted.
    const answered = await create(inPerson('corrida resposta'));
    expect((await answer(answered.id)).status).toBe(200);
    const [late, last] = await Promise.all([
      answer(answered.id, tokens.demoAdmin),
      del(answered.id),
    ]);
    expect(last.status).toBe(204);
    expect([200, 404]).toContain(late.status);
    const [kept] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.event_attendances where event_id = ${answered.id}::uuid`;
    expect(kept?.n).toBe(late.status === 200 ? 2 : 1);
  });

  it('10. look-alike (P37, PEND-13): deleting the demo event leaves the lab twin byte-identical and listed', async () => {
    const demo = await create(inPerson('gemeo', 6));
    const [creator] = await adminSql<{ id: string }[]>`
      select created_by_user_id::text as id from public.events
       where tenant_id = ${tenantIds.lab}::uuid limit 1`;
    await adminSql`
      with e as (
        insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name,
                                   address, starts_at, ends_at)
        select ${LOOK_ALIKE}::uuid, ${tenantIds.lab}::uuid, ${creator?.id ?? ''}::uuid, title, format,
               venue_name, address, starts_at, ends_at
          from public.events where id = ${demo.id}::uuid
        returning id, tenant_id, format
      )
      insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code)
      select id, tenant_id, format, 'K7QM' from e`;
    const twin = async () => {
      const [row] = await adminSql<{ event: unknown; secret: unknown }[]>`
        select (select to_jsonb(e) from public.events e where e.id = ${LOOK_ALIKE}::uuid) as event,
               (select to_jsonb(s) from public.event_secrets s where s.event_id = ${LOOK_ALIKE}::uuid) as secret`;
      return row;
    };
    const before = await twin();
    expect(before?.event).toBeTruthy();
    const labList = async () =>
      (await memberUpcoming(tokens.labMember, HOSTS.lab)).map((e) => e.id);
    expect(await labList()).toContain(LOOK_ALIKE);

    expect((await del(demo.id)).status).toBe(204);
    expect(await twin()).toEqual(before);
    expect(await labList()).toContain(LOOK_ALIKE);

    // The demo admin holding the twin's id gets the bare 404 and changes nothing.
    await expectBare404(await del(LOOK_ALIKE), 'the lab twin');
    expect(await twin()).toEqual(before);
  });

  it('11. the log is ids only: the events.deleted call carries no title key and follows the 404 guard', () => {
    const source = readFileSync(
      new URL('../../../../packages/modules/events/server/service.ts', import.meta.url),
      'utf8',
    );
    const start = source.indexOf('export async function deleteEvent');
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf('\n}\n', start));
    const guard = body.indexOf("throw new ApiError(404, 'NOT_FOUND')");
    const call = body.indexOf('log.info(');
    expect(guard).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(guard);
    const logged = body.slice(call);
    expect(logged).toContain("event: 'events.deleted'");
    expect(logged).not.toMatch(/\btitle\b/);
    expect(body).not.toContain('emit(');
  });
});
