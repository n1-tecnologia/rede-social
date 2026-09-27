import { type EventPage, type EventSummary } from '@tria/module-events/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * `@tria/module-events` end to end against the live local stack and the real seed (06-01) — the
 * Phase 6 tracer, proved rather than asserted.
 *
 * `events tracer`: an admin's `POST /v1/events` (a wall-clock start in the TENANT's timezone) answers
 * 201, and the SAME event is on a member's `GET /v1/events?period=upcoming` walked to the end. That
 * one path crosses the module package, the registry, the guard chain, the wall-clock to UTC
 * conversion inside Postgres, both tables in one transaction (the deferred FKs are checked at its
 * commit) and the keyset read.
 *
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order), and both hooks sweep this
 * file's own rows by title prefix so a crashed run cannot poison the next one.
 */

type Envelope = {
  error: { code: string; message?: string; details?: unknown; requestId?: string };
};

const tokens = { demoAdmin: '', demoMember: '' };
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
  tokens.demoAdmin = await signInAs('admin@tria-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@tria-demo.local', SEED_PASSWORD);
  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('tria-demo', 'tria-lab')`;
  for (const row of rows) {
    if (row.slug === 'tria-demo') tenantIds.demo = row.id;
    if (row.slug === 'tria-lab') tenantIds.lab = row.id;
  }
  await sweep();
});

afterAll(async () => {
  await sweep();
});

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
