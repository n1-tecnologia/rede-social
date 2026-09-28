import { subscribe } from '@rede-social/core/server/events/bus';
import type {
  EventCancelled,
  EventEdit,
  EventPage,
  EventReactivated,
  EventSummary,
  EventUpdated,
} from '@rede-social/module-events/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * EVENT-01's admin half end to end against the live local stack and the real seed (06-04): the
 * manage-only edit read in the tenant's wall clock, the whole-event replacement `PUT` (format switch,
 * cover rule, no-op detection), the guarded cancel / reactivate `PATCH`, and the three Phase 7-facing
 * domain events, collected through the REAL bus.
 *
 * Every event this file writes is created through the admin API and carries `TEST_TITLE_PREFIX`, so
 * both hooks sweep exactly this file's rows (attendance and secrets cascade). The cover assets it
 * inserts are removed after the events that reference them. Instants that must be in the past are
 * reached with `adminSql` (the 06-03 time-travel pattern), because the API refuses nothing about a
 * start in the past but the guards read `now()`.
 *
 * What is proved here:
 *  - the edit read answers wall clock equal to what was posted, including a São Paulo 23:30 start
 *    that is 02:30Z the next day, and the admin's meeting URL; a member gets 403;
 *  - `event.updated` once per content change, `timesChanged` false for a title, true for a moved
 *    start; an identical PUT moves no `updated_at` and emits nothing;
 *  - the format switch both ways, checked on `event_secrets` through `adminSql`, the response
 *    carrying no URL, and an RSVP row surviving the edit;
 *  - the cover rule on edit: a foreign NEW cover is a bare 404, an unusable one `cover_invalid`, and
 *    a stored cover retired since reads back as NO cover everywhere (WR-04) and is self-healed to
 *    null by an unchanged PUT;
 *  - cancel twice = 200/200 with one `event.cancelled`; the cancelled event stays in the member's
 *    list (D-201); an RSVP on it is 409 `cancelled`; reactivate before the start = one
 *    `event.reactivated`; after the start `409 reactivate_started`; cancel after the end
 *    `409 event_ended`;
 *  - a member's PUT, PATCH and edit read are 403, and a lab event id is a bare 404 for the admin.
 *
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order).
 */

type Envelope = {
  error: { code: string; message?: string; details?: unknown; requestId?: string };
};

const tokens = { demoAdmin: '', demoMember: '' };
const tenantIds = { demo: '', lab: '' };

/** The prefix every event THIS FILE writes carries, so the sweep can be exact. */
const TEST_TITLE_PREFIX = 'Evento de gestao';

/** 06-01's seeded upcoming event #1 in rede-lab (`scripts/seed.ts` SEED_EVENT_IDS). */
const LAB_EVENT = '0e000000-0000-4000-8000-000000000e01';

const MEETING_URL = 'https://meet.example.test/gestao-sala';

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
  coverAssetId?: string | null;
  format: 'in_person' | 'online';
  venueName?: string | null;
  address?: string | null;
  meetingUrl?: string | null;
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

const put = (eventId: string, body: Body, token = tokens.demoAdmin, host = HOSTS.demo) =>
  request(`/v1/events/${eventId}`, token, { method: 'PUT', body: JSON.stringify(body) }, host);

const patch = (eventId: string, status: string, token = tokens.demoAdmin, host = HOSTS.demo) =>
  request(
    `/v1/events/${eventId}`,
    token,
    { method: 'PATCH', body: JSON.stringify({ status }) },
    host,
  );

const editRead = (eventId: string, token = tokens.demoAdmin, host = HOSTS.demo) =>
  request(`/v1/events/${eventId}/edit`, token, {}, host);

async function secretsOf(eventId: string) {
  const [row] = await adminSql<{ event_format: string; meeting_url: string | null }[]>`
    select event_format, meeting_url from public.event_secrets where event_id = ${eventId}::uuid`;
  return row;
}

async function updatedAtOf(eventId: string): Promise<string | undefined> {
  const [row] = await adminSql<{ updated_at: string }[]>`
    select updated_at::text from public.events where id = ${eventId}::uuid`;
  return row?.updated_at;
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
    const body = (await res.json()) as EventPage;
    seen.push(...body.items);
    cursor = body.nextCursor;
    if (cursor === null) break;
  }
  return seen;
}

/** The cover assets this file inserts, removed after the events that reference them. */
const coverAssets: string[] = [];

async function seedCover(label: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, width, height,
       variant_widths, filename, ready_at)
    select ${tenantIds.demo}::uuid, u.id, 'image', 'cover', 'ready', 'supabase', 'image/webp',
           262144, 1600, 1000, '{320,640,960,1280}'::int[], ${`06-04-${label}`}, now()
      from public.users u where u.email = 'admin@rede-demo.local'
    returning id`;
  if (!row) throw new Error(`could not seed the ${label} cover`);
  coverAssets.push(row.id);
  return row.id;
}

async function sweep(): Promise<void> {
  await adminSql`delete from public.events where title like ${`${TEST_TITLE_PREFIX}%`}`;
  if (coverAssets.length > 0) {
    await adminSql`delete from public.media_assets where id = any(${coverAssets}::uuid[])`;
  }
}

const updates: EventUpdated[] = [];
const cancels: EventCancelled[] = [];
const reactivations: EventReactivated[] = [];
let stops: (() => void)[] = [];

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
  stops = [
    subscribe('event.updated', async (payload) => {
      updates.push(payload);
    }),
    subscribe('event.cancelled', async (payload) => {
      cancels.push(payload);
    }),
    subscribe('event.reactivated', async (payload) => {
      reactivations.push(payload);
    }),
  ];
});

afterAll(async () => {
  for (const stop of stops) stop();
  await sweep();
});

/** Waits for the after-commit bus to deliver (subscribers run after the response). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('events admin', () => {
  it('1. the edit read answers the wall clock that was posted (23:30 SP = 02:30Z next day) and the URL; a member gets 403', async () => {
    const day = tenantDate(4);
    const next = tenantDate(5);
    const created = await create({
      title: `${TEST_TITLE_PREFIX} madrugada`,
      format: 'online',
      meetingUrl: MEETING_URL,
      start: { date: day, time: '23:30' },
      end: { date: next, time: '01:30' },
    });
    // Stored as UTC: 23:30 at -03:00 is 02:30Z on the next calendar day.
    expect(created.startsAt).toBe(`${next}T02:30:00.000000Z`);

    const res = await editRead(created.id);
    expect(res.status).toBe(200);
    const edit = (await res.json()) as EventEdit;
    expect(edit.start).toEqual({ date: day, time: '23:30' });
    expect(edit.end).toEqual({ date: next, time: '01:30' });
    expect(edit.format).toBe('online');
    expect(edit.meetingUrl).toBe(MEETING_URL);
    expect(edit.venueName).toBeNull();
    expect(edit.status).toBe('active');

    const member = await editRead(created.id, tokens.demoMember);
    expect(member.status).toBe(403);
    expect(JSON.stringify(await member.json())).not.toContain('meet.example.test');
  });

  it('2. a title change emits ONE event.updated with timesChanged false; a moved start emits true', async () => {
    const body = inPerson('titulo');
    const created = await create(body);
    const before = updates.length;

    const renamed = await put(created.id, { ...body, title: `${TEST_TITLE_PREFIX} titulo novo` });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as EventSummary).title).toBe(`${TEST_TITLE_PREFIX} titulo novo`);
    await settle();
    const mine = updates.slice(before).filter((u) => u.eventId === created.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.timesChanged).toBe(false);
    expect(Object.keys(mine[0] ?? {}).sort()).toEqual([
      'actorUserId',
      'endsAt',
      'eventId',
      'format',
      'startsAt',
      'tenantId',
      'timesChanged',
    ]);

    const moved = await put(created.id, {
      ...body,
      title: `${TEST_TITLE_PREFIX} titulo novo`,
      start: { ...body.start, time: '18:00' },
    });
    expect(moved.status).toBe(200);
    await settle();
    const after = updates.slice(before).filter((u) => u.eventId === created.id);
    expect(after).toHaveLength(2);
    expect(after[1]?.timesChanged).toBe(true);
    expect(after[1]?.startsAt).toBe(`${body.start.date}T21:00:00.000000Z`);
  });

  it('3. an identical PUT answers 200, moves no updated_at and emits nothing (EVENT-01 idempotency, edit half)', async () => {
    const body = inPerson('identico');
    const created = await create(body);
    const stamp = await updatedAtOf(created.id);
    const before = updates.length;

    const same = await put(created.id, body);
    expect(same.status).toBe(200);
    // Whitespace the schema trims is the same body after parsing.
    const trimmed = await put(created.id, { ...body, title: `  ${body.title}  ` });
    expect(trimmed.status).toBe(200);
    await settle();

    expect(await updatedAtOf(created.id)).toBe(stamp);
    expect(updates.slice(before).filter((u) => u.eventId === created.id)).toHaveLength(0);
  });

  it('4. the format switch persists both ways, the response carries no URL, and an RSVP survives the edit', async () => {
    const body = inPerson('formato');
    const created = await create(body);
    const answered = await request(`/v1/events/${created.id}/rsvp`, tokens.demoMember, {
      method: 'PUT',
      body: JSON.stringify({ answer: 'going' }),
    });
    expect(answered.status).toBe(200);

    const online: Body = {
      ...body,
      format: 'online',
      venueName: null,
      address: null,
      meetingUrl: MEETING_URL,
    };
    const toOnline = await put(created.id, online);
    expect(toOnline.status, JSON.stringify(await toOnline.clone().json())).toBe(200);
    const onlineText = await toOnline.text();
    expect(onlineText).not.toContain('meet.example.test');
    expect(Object.keys(JSON.parse(onlineText) as object)).not.toContain('meetingUrl');
    expect((JSON.parse(onlineText) as EventSummary).format).toBe('online');
    expect(await secretsOf(created.id)).toEqual({
      event_format: 'online',
      meeting_url: MEETING_URL,
    });

    const back = await put(created.id, body);
    expect(back.status).toBe(200);
    expect(((await back.json()) as EventSummary).venueName).toBe('Auditorio da sede');
    expect(await secretsOf(created.id)).toEqual({ event_format: 'in_person', meeting_url: null });

    // The member's answer is kept across both replacements (D-214, T-06-23).
    const [row] = await adminSql<{ status: string }[]>`
      select a.status from public.event_attendances a
        join public.users u on u.id = a.user_id
       where a.event_id = ${created.id}::uuid and u.email = 'member@rede-demo.local'`;
    expect(row?.status).toBe('going');
    const detail = await request(`/v1/events/${created.id}`, tokens.demoMember);
    expect(((await detail.json()) as EventSummary).confirmedCount).toBe(1);

    // The hidden side is refused, not silently stored: a URL on an in-person body is 400.
    const both = await put(created.id, { ...body, meetingUrl: MEETING_URL });
    expect(both.status).toBe(400);
    expect((await envelope(both)).details).toEqual({ event: 'location_required' });
  });

  it('5. cover on edit: a foreign NEW cover is a bare 404, a feed image is cover_invalid, a retired stored cover reads as none and self-heals', async () => {
    const cover = await seedCover('capa');
    const body = { ...inPerson('capa'), coverAssetId: cover };
    const created = await create(body);
    expect(created.coverAssetId).toBe(cover);

    const [foreign] = await adminSql<{ id: string }[]>`
      select id from public.media_assets where tenant_id = ${tenantIds.lab}::uuid limit 1`;
    const [postAsset] = await adminSql<{ id: string }[]>`
      select id from public.media_assets
       where tenant_id = ${tenantIds.demo}::uuid and purpose = 'post' and kind = 'image'
         and status = 'ready' and deleted_at is null limit 1`;
    expect(foreign?.id).toBeTruthy();
    expect(postAsset?.id).toBeTruthy();

    const miss = await put(created.id, { ...body, coverAssetId: foreign?.id ?? null });
    expect(miss.status).toBe(404);
    const missError = await envelope(miss);
    expect(missError.code).toBe('NOT_FOUND');
    expect(Object.hasOwn(missError, 'details')).toBe(false);

    const invalid = await put(created.id, { ...body, coverAssetId: postAsset?.id ?? null });
    expect(invalid.status).toBe(400);
    expect((await envelope(invalid)).details).toEqual({ event: 'cover_invalid' });

    // The admin retires the stored cover. WR-04: every read drops the dead reference at once (the
    // gradient branch, not a veil over an empty ladder), before any edit heals the row.
    await adminSql`update public.media_assets set deleted_at = now() where id = ${cover}::uuid`;
    const memberDetail = (await (
      await request(`/v1/events/${created.id}`, tokens.demoMember)
    ).json()) as EventSummary;
    expect(memberDetail.coverAssetId).toBeNull();
    expect(memberDetail.coverVariantWidths).toEqual([]);
    const retiredEdit = (await (await editRead(created.id)).json()) as EventEdit;
    expect(retiredEdit.coverAssetId).toBeNull();
    expect(retiredEdit.coverVariantWidths).toEqual([]);
    const [stored] = await adminSql<{ cover_asset_id: string | null }[]>`
      select cover_asset_id from public.events where id = ${created.id}::uuid`;
    expect(stored?.cover_asset_id).toBe(cover);

    // An unchanged PUT re-sending the dead id heals the row to null.
    const healed = await put(created.id, body);
    expect(healed.status, JSON.stringify(await healed.clone().json())).toBe(200);
    expect(((await healed.json()) as EventSummary).coverAssetId).toBeNull();
    // ...once: the next identical PUT finds nothing dangling.
    const stamp = await updatedAtOf(created.id);
    const again = await put(created.id, { ...body, coverAssetId: null });
    expect(again.status).toBe(200);
    expect(await updatedAtOf(created.id)).toBe(stamp);
  });

  it('6. cancel twice is 200/200 with ONE event.cancelled; the member still sees it, cancelled; an RSVP on it is 409 cancelled', async () => {
    const created = await create(inPerson('cancelado'));
    const before = cancels.length;

    const first = await patch(created.id, 'cancelled');
    expect(first.status).toBe(200);
    expect(((await first.json()) as EventSummary).status).toBe('cancelled');
    const second = await patch(created.id, 'cancelled');
    expect(second.status).toBe(200);
    await settle();
    const mine = cancels.slice(before).filter((c) => c.eventId === created.id);
    expect(mine).toHaveLength(1);
    expect(Object.keys(mine[0] ?? {}).sort()).toEqual([
      'actorUserId',
      'endsAt',
      'eventId',
      'startsAt',
      'tenantId',
    ]);

    // D-201: a cancelled event never vanishes from a member's list.
    const listed = (await memberUpcoming()).find((item) => item.id === created.id);
    expect(listed?.status).toBe('cancelled');

    const rsvp = await request(`/v1/events/${created.id}/rsvp`, tokens.demoMember, {
      method: 'PUT',
      body: JSON.stringify({ answer: 'going' }),
    });
    expect(rsvp.status).toBe(409);
    expect((await envelope(rsvp)).details).toEqual({ event: 'cancelled' });
  });

  it('7. reactivate before the start emits ONE event.reactivated; after the start it is 409 reactivate_started', async () => {
    const created = await create(inPerson('reativado'));
    expect((await patch(created.id, 'cancelled')).status).toBe(200);
    const before = reactivations.length;

    const back = await patch(created.id, 'active');
    expect(back.status).toBe(200);
    expect(((await back.json()) as EventSummary).status).toBe('active');
    const repeat = await patch(created.id, 'active');
    expect(repeat.status).toBe(200);
    await settle();
    expect(reactivations.slice(before).filter((r) => r.eventId === created.id)).toHaveLength(1);

    // Cancel again, then move the start into the past (the end stays ahead).
    expect((await patch(created.id, 'cancelled')).status).toBe(200);
    await adminSql`
      update public.events set starts_at = now() - interval '10 minutes',
                               ends_at = now() + interval '2 hours'
       where id = ${created.id}::uuid`;
    const started = await patch(created.id, 'active');
    expect(started.status).toBe(409);
    expect((await envelope(started)).details).toEqual({ event: 'reactivate_started' });
    const [row] = await adminSql<{ status: string }[]>`
      select status from public.events where id = ${created.id}::uuid`;
    expect(row?.status).toBe('cancelled');
  });

  it('8. cancelling an event that has ended is 409 event_ended', async () => {
    const created = await create(inPerson('encerrado'));
    await adminSql`
      update public.events set starts_at = now() - interval '3 hours',
                               ends_at = now() - interval '1 hour'
       where id = ${created.id}::uuid`;
    const res = await patch(created.id, 'cancelled');
    expect(res.status).toBe(409);
    expect((await envelope(res)).details).toEqual({ event: 'event_ended' });
    const [row] = await adminSql<{ status: string }[]>`
      select status from public.events where id = ${created.id}::uuid`;
    expect(row?.status).toBe('active');
  });

  it('9. a member PUT and PATCH are 403 and write nothing; a lab event id is a bare 404 for the demo admin', async () => {
    const body = inPerson('membro');
    const created = await create(body);
    const stamp = await updatedAtOf(created.id);

    const memberPut = await put(created.id, { ...body, title: 'invadido' }, tokens.demoMember);
    expect(memberPut.status).toBe(403);
    const memberPatch = await patch(created.id, 'cancelled', tokens.demoMember);
    expect(memberPatch.status).toBe(403);
    expect(await updatedAtOf(created.id)).toBe(stamp);

    for (const res of [
      await editRead(LAB_EVENT),
      await put(LAB_EVENT, body),
      await patch(LAB_EVENT, 'cancelled'),
    ]) {
      expect(res.status).toBe(404);
      const error = await envelope(res);
      expect(error.code).toBe('NOT_FOUND');
      expect(Object.hasOwn(error, 'details')).toBe(false);
    }
    const [lab] = await adminSql<{ status: string; title: string }[]>`
      select status, title from public.events where id = ${LAB_EVENT}::uuid`;
    expect(lab?.status).toBe('active');
    expect(lab?.title).not.toContain(TEST_TITLE_PREFIX);

    // The status write takes only `{ status }`.
    const crafted = await request(`/v1/events/${created.id}`, tokens.demoAdmin, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelled', title: 'x' }),
    });
    expect(crafted.status).toBe(400);
    // And there is no delete verb at all (D-214).
    const del = await request(`/v1/events/${created.id}`, tokens.demoAdmin, { method: 'DELETE' });
    expect([404, 405]).toContain(del.status);
    const [still] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.events where id = ${created.id}::uuid`;
    expect(still?.n).toBe(1);
  });
});
