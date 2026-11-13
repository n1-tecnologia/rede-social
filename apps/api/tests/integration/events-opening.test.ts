import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { removeTicketEvents, ticketMapping } from './payments-apply-fixtures';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  SEED_PASSWORD,
  signInAs,
} from './setup';

/**
 * Phase 10.2-06 (OPEN-03, OPEN-04, OPEN-16, OPEN-22, OPEN-24; D-780, D-781, D-783, D-792, D-793) against
 * the live local stack: the WRITE half of the registration opening, through the real admin PUT and POST.
 *
 *  - `the opening write` (the tracer): a create and an update carry an optional wall-clock pair, stored in
 *    UTC by SQL in the TENANT's zone; an OMITTED key keeps the stored value, an explicit null clears it, a
 *    pair moves it, a half pair is a generic 400;
 *  - `the refusals and the lock`: an opening at or after the start is `400 opening_after_start` (schema and
 *    database CHECK, one code), a past opening is accepted, a date locked by a sale is `409 opening_locked`
 *    (the trigger is the only judge), the lifts, the unchanged body, the ordering and the two concurrency
 *    cases (two PUTs; a PUT against an in-flight grant, both orders).
 *
 * Every event carries the prefix below, every identity the same prefix, and both are swept in `beforeAll`
 * (a crashed run) and `afterAll`. Test ORDER is load-bearing (`fileParallelism: false`).
 */

const PREFIX = 'opn6';

type Envelope = { error: { code: string; details?: { event?: string } } };

let labTenantId = '';
let zone = '';
let adminToken = '';

const request = (path: string, token: string, init: RequestInit = {}) =>
  api.request(path, {
    ...init,
    headers: {
      'x-tenant-host': HOSTS.lab,
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });

/** `YYYY-MM-DD` of the tenant-local calendar day `offsetDays` from now. */
function tenantDate(offsetDays: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

type Wall = { date: string; time: string };

type Body = {
  title: string;
  description?: string;
  format: 'in_person';
  venueName: string;
  address: string;
  start: Wall;
  end: Wall;
  registrationOpens?: Wall | null;
};

/** An in-person body starting `days` from now at 19:00 and ending at 21:00 (tenant time). */
function body(label: string, days = 10, extra: Partial<Body> = {}): Body {
  const date = tenantDate(days);
  return {
    title: `${PREFIX}-${label}`,
    description: 'Evento do teste de abertura',
    format: 'in_person',
    venueName: 'Auditorio',
    address: 'Rua das Flores, 100',
    start: { date, time: '19:00' },
    end: { date, time: '21:00' },
    ...extra,
  };
}

const create = (payload: unknown) =>
  request('/v1/events', adminToken, { method: 'POST', body: JSON.stringify(payload) });

const put = (eventId: string, payload: unknown) =>
  request(`/v1/events/${eventId}`, adminToken, { method: 'PUT', body: JSON.stringify(payload) });

async function created(payload: unknown): Promise<string> {
  const res = await create(payload);
  const text = await res.clone().text();
  expect(res.status, text).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

const errorOf = async (res: Response) => ((await res.json()) as Envelope).error;

/** The stored opening equals `wall` read in the tenant's zone (compared in SQL), or is null for `null`. */
async function openingIs(eventId: string, wall: Wall | null): Promise<boolean> {
  if (wall === null) {
    const [row] = await adminSql<{ ok: boolean }[]>`
      select registration_opens_at is null as ok from public.events where id = ${eventId}::uuid`;
    return row?.ok === true;
  }
  const [row] = await adminSql<{ ok: boolean }[]>`
    select registration_opens_at is not distinct from
           (${wall.date}::text || ' ' || ${wall.time}::text)::timestamp at time zone ${zone} as ok
      from public.events where id = ${eventId}::uuid`;
  return row?.ok === true;
}

async function updatedAtOf(eventId: string): Promise<string | undefined> {
  const [row] = await adminSql<{ updated_at: string }[]>`
    select updated_at::text from public.events where id = ${eventId}::uuid`;
  return row?.updated_at;
}

async function sweep(): Promise<void> {
  await removeTicketEvents(PREFIX);
  await removeIdentitiesByPrefix(PREFIX);
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  const [tenant] = await adminSql<{ id: string; timezone: string }[]>`
    select id::text as id, timezone from public.tenants where slug = 'rede-lab'`;
  if (!tenant) throw new Error('seed tenants missing: run pnpm db:seed');
  labTenantId = tenant.id;
  zone = tenant.timezone;
  adminToken = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  await sweep();
}, 60_000);

afterAll(async () => {
  await sweep();
});

describe('10.2 tracer: the opening write (D-792, D-781, OPEN-03)', () => {
  it('a create stores the wall clock in UTC in the tenant zone, a PUT keeps, moves and clears it', async () => {
    const opens = { date: tenantDate(3), time: '09:30' };
    const eventId = await created(body('tracer', 10, { registrationOpens: opens }));
    expect(await openingIs(eventId, opens), 'the create stores the converted instant').toBe(true);

    // OMITTED: the stored opening is untouched (a cached older client can never wipe it).
    const keep = await put(eventId, body('tracer', 10, { description: 'sem a chave' }));
    expect(keep.status, await keep.clone().text()).toBe(200);
    expect(await openingIs(eventId, opens)).toBe(true);

    // A new pair: moved, converted in SQL again.
    const moved = { date: tenantDate(4), time: '11:15' };
    const move = await put(eventId, body('tracer', 10, { registrationOpens: moved }));
    expect(move.status, await move.clone().text()).toBe(200);
    expect(await openingIs(eventId, moved)).toBe(true);

    // Explicit null clears it.
    const clear = await put(eventId, body('tracer', 10, { registrationOpens: null }));
    expect(clear.status, await clear.clone().text()).toBe(200);
    expect(await openingIs(eventId, null)).toBe(true);
  });

  it('a create without the key stores no opening, and a PUT omitting it leaves it null', async () => {
    const eventId = await created(body('no-key'));
    expect(await openingIs(eventId, null)).toBe(true);
    const res = await put(eventId, body('no-key', 10, { description: 'outra' }));
    expect(res.status).toBe(200);
    expect(await openingIs(eventId, null)).toBe(true);
  });

  it('a half pair, an empty object and an impossible day are generic 400s with no machine code (EP-08)', async () => {
    const date = tenantDate(2);
    const cases: unknown[] = [
      { date },
      { time: '09:00' },
      {},
      { date: '2026-02-30', time: '09:00' },
      { date, time: '09:00', extra: 1 },
    ];
    for (const registrationOpens of cases) {
      const res = await create({ ...body('half'), registrationOpens });
      expect(res.status, JSON.stringify(registrationOpens)).toBe(400);
      const error = await errorOf(res);
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details?.event).toBeUndefined();
    }
  });
});

// The refusals and the lock describe is appended by the next task.
void createSharedIdentity;
void ticketMapping;
void labTenantId;
void updatedAtOf;
