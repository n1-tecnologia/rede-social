import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { removeTicketEvents, ticketEvent, ticketMapping } from './payments-apply-fixtures';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  removePaymentIntegrations,
  removePaymentMappings,
  SEED_PASSWORD,
  type SeededPaymentIntegration,
  seedPaymentIntegration,
  setPaymentsRow,
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

const create = async (payload: unknown) =>
  request('/v1/events', adminToken, { method: 'POST', body: JSON.stringify(payload) });

const put = async (eventId: string, payload: unknown) =>
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
  await removePaymentMappings(labTenantId);
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

/* ── the lock fixtures: a paid event, a buyer, the definers called the way the worker calls them ── */

const DB_URL = 'postgres://postgres:postgres@127.0.0.1:54322/postgres';

/** Runs `work` in ONE transaction of the migration role acting as `service_role` (the definers' only grantee). */
async function asService<T>(
  work: (tx: postgres.TransactionSql) => Promise<T>,
  connection: postgres.Sql = adminSql,
): Promise<T> {
  return (await connection.begin(async (tx) => {
    await tx`set local role service_role`;
    return work(tx);
  })) as T;
}

type Buyer = { userId: string; membershipId: string };

async function buyer(): Promise<Buyer> {
  const identity = await createSharedIdentity({
    prefix: PREFIX,
    memberships: [{ host: 'lab', role: 'member' }],
  });
  const [membership] = await adminSql<{ id: string }[]>`
    select id::text as id from public.memberships
     where user_id = ${identity.userId}::uuid and tenant_id = ${labTenantId}::uuid`;
  if (!membership) throw new Error('the buyer has no membership');
  return { userId: identity.userId, membershipId: membership.id };
}

const orderRef = () => `OPN6-${crypto.randomUUID()}`;

const grantStatement = (
  tx: postgres.TransactionSql,
  eventId: string,
  who: Buyer,
  ref: string,
  adminRelease = false,
) =>
  tx<{ outcome: string }[]>`
    select outcome from app.event_gateway_grant(${labTenantId}::uuid, ${who.membershipId}::uuid,
                                                ${eventId}::uuid, 'fake', ${ref}, ${adminRelease})`;

async function grant(eventId: string, who: Buyer, ref = orderRef()): Promise<string> {
  const rows = await asService((tx) => grantStatement(tx, eventId, who, ref));
  return rows[0]?.outcome ?? '';
}

async function revoke(ref: string): Promise<string> {
  const rows = await asService(
    (tx) =>
      tx<{ outcome: string }[]>`
        select outcome from app.event_gateway_revoke(${labTenantId}::uuid, 'fake', ${ref})`,
  );
  return rows[0]?.outcome ?? '';
}

type Made = { id: string; base: Body; opens: Wall };

/** A paid event (mapped) created through the API WITH an opening three days ahead at 09:30. */
async function paidEvent(
  label: string,
  beforeMapping: (eventId: string) => Promise<void> = async () => {},
): Promise<Made> {
  const opens = { date: tenantDate(3), time: '09:30' };
  const base = body(label, 10, { registrationOpens: opens });
  const id = await created(base);
  // A plain Vou is refused once an event is mapped (`payment_required`), so it is seeded first.
  await beforeMapping(id);
  await ticketMapping(labTenantId, id);
  return { id, base, opens };
}

/** An attendance row written the way the server writes it (the migration role; the member lane cannot). */
async function seedPresence(
  eventId: string,
  userId: string,
  row: {
    status: 'going' | 'checked_in';
    origin: 'rsvp' | 'ticket' | 'courtesy';
    ref?: string;
  },
): Promise<void> {
  const checkedIn = row.status === 'checked_in';
  await adminSql`
    insert into public.event_attendances
           (tenant_id, event_id, user_id, status, responded_at, checked_in_at, checkin_via, origin,
            order_provider, order_ref)
    values (${labTenantId}::uuid, ${eventId}::uuid, ${userId}::uuid, ${row.status}, now(),
            ${checkedIn ? adminSql`now()` : null}, ${checkedIn ? 'code' : null}, ${row.origin},
            ${row.origin === 'ticket' ? 'fake' : null}, ${row.origin === 'ticket' ? (row.ref ?? orderRef()) : null})`;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

afterEach(async () => {
  await sweep();
});

describe('10.2 the refusals (OPEN-04, D-792; EP-12)', () => {
  it('an opening equal to or after the start is 400 opening_after_start, on POST and on PUT (the schema path)', async () => {
    const start = body('refuse').start;
    const after = { date: tenantDate(11), time: '09:00' };
    for (const registrationOpens of [{ ...start }, after]) {
      const res = await create(body('refuse', 10, { registrationOpens }));
      expect(res.status).toBe(400);
      const error = await errorOf(res);
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details?.event).toBe('opening_after_start');
    }

    const eventId = await created(body('refuse-put'));
    const res = await put(eventId, body('refuse-put', 10, { registrationOpens: { ...start } }));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).details?.event).toBe('opening_after_start');
    expect(await openingIs(eventId, null), 'a refused PUT writes nothing').toBe(true);
  });

  it('one minute before the start passes, and a date in the past is accepted (it simply means open)', async () => {
    const almost = await created(
      body('almost', 10, { registrationOpens: { date: tenantDate(10), time: '18:59' } }),
    );
    expect(await openingIs(almost, { date: tenantDate(10), time: '18:59' })).toBe(true);

    const past = { date: tenantDate(-30), time: '09:00' };
    const old = await created(body('past', 10, { registrationOpens: past }));
    expect(await openingIs(old, past)).toBe(true);
  });

  it('a start moved earlier than the KEPT opening trips the database CHECK and answers the same code (EP-12)', async () => {
    const opens = { date: tenantDate(9), time: '09:00' };
    const eventId = await created(body('check', 10, { registrationOpens: opens }));
    // The key is OMITTED, so the schema cannot see the conflict: only the CHECK can.
    const res = await put(eventId, body('check', 8));
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details?.event).toBe('opening_after_start');
    expect(await openingIs(eventId, opens), 'the refused PUT left the opening alone').toBe(true);
  });
});

describe('10.2 the lock (D-783, OPEN-16; T-10.2-02)', () => {
  it('with a ticket, a changed opening and an explicit null are 409 opening_locked; the rest still save', async () => {
    const event = await paidEvent('lock');
    const who = await buyer();
    expect(await grant(event.id, who)).toBe('granted');

    const moved = await put(
      event.id,
      body('lock', 10, { registrationOpens: { date: tenantDate(4), time: '10:00' } }),
    );
    expect(moved.status).toBe(409);
    const refusal = await errorOf(moved);
    expect(refusal.code).toBe('CONFLICT');
    expect(refusal.details?.event).toBe('opening_locked');

    const cleared = await put(event.id, body('lock', 10, { registrationOpens: null }));
    expect(cleared.status).toBe(409);
    expect((await errorOf(cleared)).details?.event).toBe('opening_locked');
    expect(await openingIs(event.id, event.opens), 'a refused PUT leaves the date').toBe(true);

    // A title edit (the key omitted), the same pair and a body that never knew the key are all fine.
    const title = await put(event.id, {
      ...event.base,
      registrationOpens: undefined,
      description: 'novo',
    });
    expect(title.status, await title.clone().text()).toBe(200);
    const same = await put(event.id, { ...event.base, registrationOpens: { ...event.opens } });
    expect(same.status, await same.clone().text()).toBe(200);
    expect(await openingIs(event.id, event.opens)).toBe(true);
  });

  it('a courtesy only and a plain rsvp only never lock the date (D-783)', async () => {
    const holder = await buyer();
    const guest = await buyer();
    const event = await paidEvent('courtesy', (eventId) =>
      seedPresence(eventId, guest.userId, { status: 'going', origin: 'rsvp' }),
    );
    await seedPresence(event.id, holder.userId, { status: 'going', origin: 'courtesy' });

    const next = { date: tenantDate(4), time: '08:00' };
    const res = await put(event.id, body('courtesy', 10, { registrationOpens: next }));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await openingIs(event.id, next)).toBe(true);
  });

  it('a full refund lifts the lock; a refunded checked-in ticket keeps it', async () => {
    const event = await paidEvent('refund');
    const who = await buyer();
    const ref = orderRef();
    expect(await grant(event.id, who, ref)).toBe('granted');
    expect((await put(event.id, body('refund', 10, { registrationOpens: null }))).status).toBe(409);

    expect(await revoke(ref)).toBe('removed');
    const lifted = await put(event.id, body('refund', 10, { registrationOpens: null }));
    expect(lifted.status, await lifted.clone().text()).toBe(200);
    expect(await openingIs(event.id, null)).toBe(true);

    // A person who was already there keeps the row on a refund (flagged), so the lock stays. The event is
    // moved to start in 30 minutes (inside the check-in window) with a past opening, by direct SQL.
    const kept = await paidEvent('refund-kept');
    await adminSql`
      update public.events
         set starts_at = now() + interval '30 minutes', ends_at = now() + interval '3 hours',
             registration_opens_at = now() - interval '1 day'
       where id = ${kept.id}::uuid`;
    const present = await buyer();
    const keptRef = orderRef();
    await seedPresence(kept.id, present.userId, {
      status: 'checked_in',
      origin: 'ticket',
      ref: keptRef,
    });
    expect(await revoke(keptRef)).toBe('kept');
    const refused = await put(kept.id, body('refund-kept', 10, { registrationOpens: null }));
    expect(refused.status).toBe(409);
    expect((await errorOf(refused)).details?.event).toBe('opening_locked');
  });
});

describe('10.2 idempotency, ordering and concurrency (EP-07, EP-09, EP-10, EP-11)', () => {
  it('the same PUT twice answers 200 both times and writes nothing the second time; one minute off is a change', async () => {
    const opens = { date: tenantDate(3), time: '09:30' };
    const base = body('idem', 10, { registrationOpens: opens });
    const eventId = await created(base);

    const first = await put(eventId, { ...base, description: 'primeira' });
    expect(first.status).toBe(200);
    const stamp = await updatedAtOf(eventId);
    const second = await put(eventId, { ...base, description: 'primeira' });
    expect(second.status).toBe(200);
    expect(await updatedAtOf(eventId), 'an identical body writes nothing').toBe(stamp);

    // EP-07: the wall clock converts to exactly the stored instant, so the body is still identical.
    const same = await put(eventId, {
      ...base,
      description: 'primeira',
      registrationOpens: { ...opens },
    });
    expect(same.status).toBe(200);
    expect(await updatedAtOf(eventId)).toBe(stamp);

    // One minute off is a real change.
    const off = await put(eventId, {
      ...base,
      description: 'primeira',
      registrationOpens: { date: opens.date, time: '09:31' },
    });
    expect(off.status).toBe(200);
    expect(await updatedAtOf(eventId)).not.toBe(stamp);
    expect(await openingIs(eventId, { date: opens.date, time: '09:31' })).toBe(true);

    // The create half: the same body twice is two events, never a 409.
    const a = await created(body('idem-create', 10, { registrationOpens: opens }));
    const b = await created(body('idem-create', 10, { registrationOpens: opens }));
    expect(a).not.toBe(b);
  });

  it('two events sharing one opening list in the unchanged (starts_at, id) order (EP-09)', async () => {
    const opens = { date: tenantDate(3), time: '09:30' };
    const later = await created(body('order-late', 12, { registrationOpens: opens }));
    const sooner = await created(body('order-soon', 11, { registrationOpens: opens }));

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 40; guard++) {
      const query: string = cursor
        ? `?period=upcoming&limit=25&cursor=${encodeURIComponent(cursor)}`
        : '?period=upcoming&limit=25';
      const res = await request(`/v1/events${query}`, adminToken);
      expect(res.status).toBe(200);
      const page = (await res.json()) as { items: { id: string }[]; nextCursor: string | null };
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    expect(seen.indexOf(sooner)).toBeGreaterThanOrEqual(0);
    expect(seen.indexOf(later)).toBeGreaterThan(seen.indexOf(sooner));
  });

  it('two PUTs at once both finish without a 500 and the stored opening is one of the two bodies (EP-11)', async () => {
    const eventId = await created(
      body('race', 10, { registrationOpens: { date: tenantDate(3), time: '09:00' } }),
    );
    const one = { date: tenantDate(4), time: '10:00' };
    const two = { date: tenantDate(5), time: '11:00' };
    const [a, b] = await Promise.all([
      put(eventId, body('race', 10, { registrationOpens: one })),
      put(eventId, body('race', 10, { registrationOpens: two })),
    ]);
    // No ticket exists, so neither can be locked out; a 409 here would be a false lock.
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await openingIs(eventId, one)) || (await openingIs(eventId, two))).toBe(true);
  });
});

describe('10.2 the PUT and the grant serialise on the event row, in both orders (EP-36; T-10.2-02)', () => {
  it('a PUT started while a grant is in flight waits for it and is then refused 409 opening_locked', async () => {
    const event = await paidEvent('race-grant');
    const who = await buyer();
    const holder = postgres(DB_URL, { prepare: false, max: 1 });
    try {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let inFlight: () => void = () => {};
      const started = new Promise<void>((resolve) => {
        inFlight = resolve;
      });
      const outcomes: string[] = [];
      const transaction = asService(async (tx) => {
        const rows = await grantStatement(tx, event.id, who, orderRef());
        outcomes.push(rows[0]?.outcome ?? '');
        inFlight();
        await gate;
      }, holder);
      await started;

      let settled = false;
      const pending = put(
        event.id,
        body('race-grant', 10, { registrationOpens: { date: tenantDate(4), time: '10:00' } }),
      ).then((res) => {
        settled = true;
        return res;
      });
      await sleep(800);
      expect(settled, 'the PUT must wait for the row lock the grant holds').toBe(false);

      release();
      await transaction;
      const res = await pending;
      expect(outcomes).toEqual(['granted']);
      expect(res.status).toBe(409);
      expect((await errorOf(res)).details?.event).toBe('opening_locked');
      expect(await openingIs(event.id, event.opens)).toBe(true);
    } finally {
      await holder.end({ timeout: 5 });
    }
  });

  it('a grant started while an update holds the event row waits, confirms after the commit and is judged against the NEW opening', async () => {
    const event = await paidEvent('race-update');
    const who = await buyer();
    const ref = orderRef();
    const updater = postgres(DB_URL, { prepare: false, max: 1 });
    const granter = postgres(DB_URL, { prepare: false, max: 1 });
    try {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let holding: () => void = () => {};
      const started = new Promise<void>((resolve) => {
        holding = resolve;
      });
      // No ticket exists yet, so the trigger lets the move through; the row lock is held until the commit.
      const transaction = updater.begin(async (tx) => {
        await tx`
          update public.events set registration_opens_at = now() + interval '90 minutes'
           where id = ${event.id}::uuid`;
        holding();
        await gate;
      });
      await started;

      let settled = false;
      const pending = asService((tx) => grantStatement(tx, event.id, who, ref), granter).then(
        (rows) => {
          settled = true;
          return rows;
        },
      );
      await sleep(800);
      expect(settled, 'the grant must wait for the row lock the update holds').toBe(false);

      release();
      await transaction;
      const rows = await pending;
      expect(rows[0]?.outcome).toBe('granted');

      const [judged] = await adminSql<{ early: boolean; matches: boolean }[]>`
        select a.ticket_confirmed_at < e.registration_opens_at as early,
               e.registration_opens_at > now() as matches
          from public.event_attendances a
          join public.events e on e.id = a.event_id
         where a.event_id = ${event.id}::uuid and a.order_ref = ${ref}`;
      // Confirmed before the NEW opening (90 minutes ahead), not the old one (three days ahead, set at create).
      expect(judged).toEqual({ early: true, matches: true });
      const [marked] = await asService(
        (tx) =>
          tx<{ before_opening: boolean }[]>`
            select app.event_ticket_before_opening(${labTenantId}::uuid, ${event.id}::uuid, 'fake', ${ref})
                   as before_opening`,
      );
      expect(marked?.before_opening).toBe(true);
    } finally {
      await updater.end({ timeout: 5 });
      await granter.end({ timeout: 5 });
    }
  });
});

/* ── 10.2-07: the READ half (OPEN-02, OPEN-05, OPEN-06, OPEN-14, OPEN-23, OPEN-24; D-780, D-788, D-789, D-791, D-792) ── */

/** Six fractional digits, UTC, fixed width: a plain string comparison is exact to the microsecond (EP-15). */
const ISO6 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const LINK = 'https://pay.example.com/checkout/opn7';

type Json = Record<string, unknown>;
type Read = { status: number; json: Json; raw: string };

async function readAs(token: string, path: string, host: string = HOSTS.lab): Promise<Read> {
  const res = await api.request(path, {
    headers: { 'x-tenant-host': host, authorization: `Bearer ${token}` },
  });
  const raw = await res.text();
  let json: Json = {};
  try {
    json = raw ? (JSON.parse(raw) as Json) : {};
  } catch {
    // A non-JSON body: the status and the raw text still tell.
  }
  return { status: res.status, json, raw };
}

const memberToken = async (): Promise<string> => {
  const identity = await createSharedIdentity({
    prefix: PREFIX,
    memberships: [{ host: 'lab', role: 'member' }],
  });
  return signInAs(identity.email, identity.password);
};

/**
 * A mapped event of the lab tenant, an opening `opensInMinutes` from the DATABASE clock (the start is 60
 * minutes ahead, so 30 is "ahead" and -30 is "past"), and a stored purchase link unless told otherwise.
 */
async function mapped(
  label: string,
  options: { opensInMinutes?: number | null; link?: boolean } = {},
): Promise<string> {
  const id = await ticketEvent(labTenantId, {
    title: `${PREFIX}-${label}`,
    opensInMinutes: options.opensInMinutes === undefined ? null : options.opensInMinutes,
  });
  await ticketMapping(labTenantId, id);
  if (options.link !== false) {
    await adminSql`
      update public.payment_products set checkout_url = ${LINK}
       where kind = 'event' and event_id = ${id}::uuid`;
  }
  return id;
}

/** Sets the opening to the database clock plus a signed interval, in SQL (never a client clock). */
const openingAt = (eventId: string, interval: string | null) =>
  interval === null
    ? adminSql`update public.events set registration_opens_at = null where id = ${eventId}::uuid`
    : adminSql`
        update public.events set registration_opens_at = now() + ${interval}::interval
         where id = ${eventId}::uuid`;

describe('10.2 the member read (D-780, D-788, D-789; OPEN-02, OPEN-05, OPEN-06)', () => {
  let integration: SeededPaymentIntegration | undefined;
  let restorePayments: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const [previous] = await adminSql<{ enabled: boolean; settings: Record<string, unknown> }[]>`
      select enabled, settings from public.tenant_modules
       where tenant_id = ${labTenantId}::uuid and module_key = 'payments'`;
    await removePaymentIntegrations(labTenantId);
    await setPaymentsRow(labTenantId, { enabled: true, settings: {} });
    moduleFlags.invalidate(labTenantId);
    integration = await seedPaymentIntegration(labTenantId);
    restorePayments = async () => {
      if (previous) {
        await setPaymentsRow(labTenantId, {
          enabled: previous.enabled,
          settings: previous.settings,
        });
      } else {
        await adminSql`
          delete from public.tenant_modules
           where tenant_id = ${labTenantId}::uuid and module_key = 'payments'`;
      }
      moduleFlags.invalidate(labTenantId);
    };
  }, 60_000);

  afterAll(async () => {
    await removePaymentIntegrations(labTenantId);
    await restorePayments();
  });

  it('TRACER: before the opening the detail has the date, the server instant and saleReady with NO link; at the opening the link', async () => {
    expect(integration?.provider).toBe('fake');
    const token = await memberToken();
    const eventId = await mapped('tracer', { opensInMinutes: 30 });

    const before = await readAs(token, `/v1/events/${eventId}`);
    expect(before.status, before.raw).toBe(200);
    expect(before.json.registrationOpensAt).toMatch(ISO6);
    expect(before.json.serverNow).toMatch(ISO6);
    expect(before.json.saleReady).toBe(true);
    expect(before.json.checkoutUrl).toBeNull();
    // Plain string comparison: the opening is ahead of the server instant that decided the link.
    expect((before.json.registrationOpensAt as string) > (before.json.serverNow as string)).toBe(
      true,
    );

    const list = await readAs(token, '/v1/events?period=upcoming&limit=50');
    const item = (list.json.items as Json[]).find((entry) => entry.id === eventId);
    expect(item).toBeDefined();
    expect(item?.registrationOpensAt).toBe(before.json.registrationOpensAt);
    expect(item?.serverNow).toMatch(ISO6);
    expect(item).not.toHaveProperty('checkoutUrl');
    expect(item).not.toHaveProperty('saleReady');

    // One second before now: the opening has come.
    await openingAt(eventId, '-1 second');
    const after = await readAs(token, `/v1/events/${eventId}`);
    expect(after.json.checkoutUrl).toBe(LINK);
    expect(after.json.saleReady).toBe(true);
    expect((after.json.registrationOpensAt as string) <= (after.json.serverNow as string)).toBe(
      true,
    );
  });

  /* ── Task 3: the key sets, the order, the matrix, the shape, the lanes and the removal ── */

  /** The 10.1 key set of a FREE event's list item, written down from the shipped contract, NOT from the new code. */
  const FREE_ITEM_KEYS = [
    'address',
    'capacity',
    'category',
    'confirmedCount',
    'coverAssetId',
    'coverVariantWidths',
    'endsAt',
    'format',
    'id',
    'paid',
    'posterAssetId',
    'posterVariantWidths',
    'presentCount',
    'startsAt',
    'status',
    'ticketPriceCents',
    'title',
    'venueName',
    'viewerCheckedInAt',
    'viewerOrigin',
    'viewerRefunded',
    'viewerStatus',
  ];
  const FREE_DETAIL_KEYS = [
    ...FREE_ITEM_KEYS,
    'checkoutUrl',
    'description',
    'schedule',
    'viewerRespondedAt',
  ].sort();
  const FREE_EDIT_KEYS = [
    'address',
    'capacity',
    'category',
    'coverAssetId',
    'coverVariantWidths',
    'description',
    'end',
    'endsAt',
    'format',
    'id',
    'meetingUrl',
    'posterAssetId',
    'posterVariantWidths',
    'schedule',
    'start',
    'startsAt',
    'status',
    'ticket',
    'ticketPriceCents',
    'title',
    'venueName',
  ];
  const sortedKeys = (value: unknown) => Object.keys(value as Json).sort();

  it('a free event keeps the 10.1 key set on every read, even with a stale stored opening; a paid one with no opening adds only the seed (and saleReady on the detail) (EP-04, EP-05)', async () => {
    const token = await memberToken();
    const free = await ticketEvent(labTenantId, {
      title: `${PREFIX}-keys-free`,
      opensInMinutes: 30,
    });
    const paidNone = await mapped('keys-paid');

    const freeDetail = await readAs(token, `/v1/events/${free}`);
    expect(freeDetail.status, freeDetail.raw).toBe(200);
    expect(sortedKeys(freeDetail.json)).toEqual(FREE_DETAIL_KEYS);

    const list = await readAs(token, '/v1/events?period=upcoming&limit=50');
    const items = list.json.items as Json[];
    const freeItem = items.find((item) => item.id === free);
    const paidItem = items.find((item) => item.id === paidNone);
    expect(sortedKeys(freeItem)).toEqual(FREE_ITEM_KEYS);
    expect(sortedKeys(paidItem)).toEqual([...FREE_ITEM_KEYS, 'serverNow'].sort());

    const paidDetail = await readAs(token, `/v1/events/${paidNone}`);
    expect(sortedKeys(paidDetail.json)).toEqual(
      [...FREE_DETAIL_KEYS, 'saleReady', 'serverNow'].sort(),
    );

    // The next read answers a seeded FREE event of the lab tenant: the 10.1 key set again.
    const next = await readAs(token, '/v1/events/next');
    const nextEvent = next.json.event as Json | null;
    if (nextEvent && nextEvent.paid === false) {
      expect(sortedKeys(nextEvent)).toEqual(FREE_ITEM_KEYS);
    }

    const freeEdit = await request(`/v1/events/${free}/edit`, adminToken);
    expect(sortedKeys(await freeEdit.json())).toEqual(FREE_EDIT_KEYS);
    // A paid event with no opening differs on the edit read by the pair (null) and the seed only.
    const paidEdit = await request(`/v1/events/${paidNone}/edit`, adminToken);
    expect(sortedKeys(await paidEdit.json())).toEqual(
      [...FREE_EDIT_KEYS, 'registrationOpens', 'serverNow'].sort(),
    );
  });

  it('the list order of a free, a paid-with-opening and a paid-without event is the unchanged (starts_at, id) order (EP-06)', async () => {
    const token = await memberToken();
    const ids = [
      await ticketEvent(labTenantId, {
        title: `${PREFIX}-ord-free`,
        startsInMinutes: 5000,
        endsInMinutes: 5100,
      }),
      await ticketEvent(labTenantId, {
        title: `${PREFIX}-ord-open`,
        startsInMinutes: 5200,
        endsInMinutes: 5300,
        opensInMinutes: 30,
      }),
      await ticketEvent(labTenantId, {
        title: `${PREFIX}-ord-none`,
        startsInMinutes: 5200,
        endsInMinutes: 5300,
      }),
    ];
    await ticketMapping(labTenantId, ids[1] as string);
    await ticketMapping(labTenantId, ids[2] as string);
    const expected = await adminSql<{ id: string }[]>`
      select id::text as id from public.events
       where title like ${`${PREFIX}-ord-%`} order by starts_at asc, id asc`;
    const list = await readAs(token, '/v1/events?period=upcoming&limit=50');
    const mine = (list.json.items as Json[])
      .map((item) => item.id as string)
      .filter((id) => ids.includes(id));
    expect(mine).toEqual(expected.map((row) => row.id));
    expect(mine).toHaveLength(3);
  });

  it('the link, the readiness and the opening agree on every row of the matrix: module on, module off, gateway down; no link; opening null, past, future; soft-deleted (EP-14)', async () => {
    const token = await memberToken();
    const kinds = [
      { name: 'null', opens: null },
      { name: 'past', opens: -30 },
      { name: 'future', opens: 30 },
    ] as const;
    const withLink: Record<string, string> = {};
    const noLink: Record<string, string> = {};
    for (const kind of kinds) {
      withLink[kind.name] = await mapped(`mx-link-${kind.name}`, { opensInMinutes: kind.opens });
      noLink[kind.name] = await mapped(`mx-nolink-${kind.name}`, {
        opensInMinutes: kind.opens,
        link: false,
      });
    }
    const read = async (id: string) => (await readAs(token, `/v1/events/${id}`)).json;

    /** checkoutUrl is non-null iff the sale is ready and the opening is not after the server instant. */
    const invariant = (json: Json, label: string) => {
      const opens = json.registrationOpensAt as string | undefined;
      const now = json.serverNow as string;
      expect(now, label).toMatch(ISO6);
      const notAhead = opens === undefined || opens <= now;
      expect(json.checkoutUrl !== null, label).toBe(json.saleReady === true && notAhead);
    };

    // State 1: module on, gateway connected.
    for (const kind of kinds) {
      const linked = await read(withLink[kind.name] as string);
      const bare = await read(noLink[kind.name] as string);
      invariant(linked, `on/link/${kind.name}`);
      invariant(bare, `on/nolink/${kind.name}`);
      expect(linked.saleReady, `on/link/${kind.name}`).toBe(true);
      expect(linked.checkoutUrl, `on/link/${kind.name}`).toBe(kind.name === 'future' ? null : LINK);
      expect(bare.saleReady, `on/nolink/${kind.name}`).toBe(false);
      expect(bare.checkoutUrl, `on/nolink/${kind.name}`).toBeNull();
    }

    // State 2: the payments module off.
    await setPaymentsRow(labTenantId, { enabled: false, settings: {} });
    moduleFlags.invalidate(labTenantId);
    try {
      for (const kind of kinds) {
        const linked = await read(withLink[kind.name] as string);
        invariant(linked, `off/${kind.name}`);
        expect(linked.checkoutUrl, `off/${kind.name}`).toBeNull();
        expect(linked.saleReady, `off/${kind.name}`).toBe(false);
      }
    } finally {
      await setPaymentsRow(labTenantId, { enabled: true, settings: {} });
      moduleFlags.invalidate(labTenantId);
    }

    // State 3: the gateway disconnected.
    await removePaymentIntegrations(labTenantId);
    try {
      for (const kind of kinds) {
        const linked = await read(withLink[kind.name] as string);
        invariant(linked, `down/${kind.name}`);
        expect(linked.checkoutUrl, `down/${kind.name}`).toBeNull();
        expect(linked.saleReady, `down/${kind.name}`).toBe(false);
      }
    } finally {
      integration = await seedPaymentIntegration(labTenantId);
    }

    // State 4: soft-deleted: a bare 404 on the detail and absent from the list.
    const doomed = withLink.null as string;
    await adminSql`update public.events set deleted_at = now() where id = ${doomed}::uuid`;
    const gone = await readAs(token, `/v1/events/${doomed}`);
    expect(gone.status).toBe(404);
    const list = await readAs(token, '/v1/events?period=upcoming&limit=50');
    expect((list.json.items as Json[]).some((item) => item.id === doomed)).toBe(false);
  });

  it('through the API an opening seconds ahead holds the link back and one seconds behind hands it out, judged by the answer’s own instants (EP-14)', async () => {
    const token = await memberToken();
    const eventId = await mapped('edge');
    for (const [interval, linked] of [
      ['10 seconds', false],
      ['-10 seconds', true],
    ] as const) {
      await openingAt(eventId, interval);
      const res = await readAs(token, `/v1/events/${eventId}`);
      expect(res.json.saleReady).toBe(true);
      expect(res.json.checkoutUrl, interval).toBe(linked ? LINK : null);
      const opens = res.json.registrationOpensAt as string;
      const now = res.json.serverNow as string;
      expect(opens <= now, interval).toBe(linked);
    }
  });

  it('the instants are fixed-width six-digit UTC strings, an opening one microsecond before the start reads back exactly, and two instants one microsecond apart order as plain strings (EP-04, EP-15)', async () => {
    const token = await memberToken();
    const a = await mapped('shape-a');
    const b = await mapped('shape-b');
    await adminSql`
      update public.events set registration_opens_at = date_trunc('second', starts_at) - interval '1 hour' + interval '1 microsecond'
       where id = ${a}::uuid`;
    await adminSql`
      update public.events set registration_opens_at = date_trunc('second', starts_at) - interval '1 hour' + interval '2 microseconds'
       where id = ${b}::uuid`;
    const [expectedA] = await adminSql<{ at: string }[]>`
      select to_char(registration_opens_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at
        from public.events where id = ${a}::uuid`;
    const readA = (await readAs(token, `/v1/events/${a}`)).json;
    const readB = (await readAs(token, `/v1/events/${b}`)).json;
    expect(readA.registrationOpensAt).toBe(expectedA?.at);
    expect(readA.registrationOpensAt).toMatch(/\.000001Z$/);
    expect(readB.registrationOpensAt).toMatch(/\.000002Z$/);
    expect((readA.registrationOpensAt as string) < (readB.registrationOpensAt as string)).toBe(
      true,
    );
    for (const json of [readA, readB]) {
      expect(json.serverNow).toMatch(ISO6);
      expect(json.registrationOpensAt).toMatch(ISO6);
    }

    // An opening one microsecond before the start is stored by the CHECK and read back at six digits.
    const c = await mapped('shape-c');
    await adminSql`
      update public.events set registration_opens_at = starts_at - interval '1 microsecond'
       where id = ${c}::uuid`;
    const [expectedC] = await adminSql<{ at: string }[]>`
      select to_char(registration_opens_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at
        from public.events where id = ${c}::uuid`;
    const readC = (await readAs(token, `/v1/events/${c}`)).json;
    expect(readC.registrationOpensAt).toBe(expectedC?.at);
    expect(readC.registrationOpensAt).toMatch(ISO6);
  });

  it('cross-tenant, both directions, each with a positive control: a member of the other tenant gets the bare 404 and never an opening (OPEN-23)', async () => {
    const [demo] = await adminSql<{ id: string }[]>`
      select id::text as id from public.tenants where slug = 'rede-demo'`;
    if (!demo) throw new Error('rede-demo is not seeded');
    try {
      const labMember = await memberToken();
      const demoIdentity = await createSharedIdentity({
        prefix: PREFIX,
        memberships: [{ host: 'demo', role: 'member' }],
      });
      const demoMember = await signInAs(demoIdentity.email, demoIdentity.password);

      const labEvent = await mapped('xt-lab', { opensInMinutes: 30 });
      const demoEvent = await ticketEvent(demo.id, {
        title: `${PREFIX}-xt-demo`,
        opensInMinutes: 30,
      });
      await ticketMapping(demo.id, demoEvent);

      // Positive controls: each member reads their own tenant's paid event with the opening.
      const ownLab = await readAs(labMember, `/v1/events/${labEvent}`);
      expect(ownLab.status, ownLab.raw).toBe(200);
      expect(ownLab.json.registrationOpensAt).toMatch(ISO6);
      const ownDemo = await readAs(demoMember, `/v1/events/${demoEvent}`, HOSTS.demo);
      expect(ownDemo.status, ownDemo.raw).toBe(200);
      expect(ownDemo.json.registrationOpensAt).toMatch(ISO6);

      // The negatives, in both directions: the bare 404, no opening anywhere in the body.
      for (const [token, host, id, openingOf] of [
        [demoMember, HOSTS.demo, labEvent, ownLab.json.registrationOpensAt],
        [labMember, HOSTS.lab, demoEvent, ownDemo.json.registrationOpensAt],
      ] as const) {
        const res = await readAs(token, `/v1/events/${id}`, host);
        expect(res.status).toBe(404);
        expect(res.raw).not.toContain(String(openingOf));
        expect(res.json.error).toMatchObject({ code: 'NOT_FOUND' });
        const list = await readAs(token, '/v1/events?period=upcoming&limit=50', host);
        expect((list.json.items as Json[]).some((item) => item.id === id)).toBe(false);
        expect(list.raw).not.toContain(String(openingOf));
      }

      // The attendance list: the other tenant's admin is refused with the bare 404; the own admin reads it.
      const demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
      const foreign = await readAs(
        demoAdmin,
        `/v1/events/${labEvent}/attendance?list=confirmed&limit=50`,
        HOSTS.demo,
      );
      expect(foreign.status).toBe(404);
      const own = await readAs(
        adminToken,
        `/v1/events/${labEvent}/attendance?list=confirmed&limit=50`,
      );
      expect(own.status, own.raw).toBe(200);
    } finally {
      await removePaymentMappings(demo.id);
    }
  });

  it('removing the product link turns the event into a free one on every read and clears the stored opening (EP-04)', async () => {
    const token = await memberToken();
    const eventId = await mapped('removal', { opensInMinutes: 30 });
    const before = await readAs(token, `/v1/events/${eventId}`);
    expect(before.json.registrationOpensAt).toMatch(ISO6);

    const removed = await request(`/v1/payments/event-products/${eventId}`, adminToken, {
      method: 'DELETE',
    });
    expect(removed.status, await removed.clone().text()).toBeLessThan(300);
    expect(await openingIs(eventId, null)).toBe(true);

    const detail = await readAs(token, `/v1/events/${eventId}`);
    expect(sortedKeys(detail.json)).toEqual(FREE_DETAIL_KEYS);
    expect(detail.json.paid).toBe(false);
    const list = await readAs(token, '/v1/events?period=upcoming&limit=50');
    const item = (list.json.items as Json[]).find((entry) => entry.id === eventId);
    expect(sortedKeys(item)).toEqual(FREE_ITEM_KEYS);
    const edit = await request(`/v1/events/${eventId}/edit`, adminToken);
    expect(sortedKeys(await edit.json())).toEqual(FREE_EDIT_KEYS);
  });
});

describe('10.2 the edit read gives the wall clock back, and Participantes marks the early payer (D-791, D-792; OPEN-03, OPEN-14)', () => {
  /** The expected wall-clock pair, computed in SQL with the TENANT's zone (the exact inverse of the write). */
  async function wallClockOf(eventId: string) {
    const [row] = await adminSql<{ date: string; time: string; utc_day: string }[]>`
      select to_char(registration_opens_at at time zone ${zone}, 'YYYY-MM-DD') as date,
             to_char(registration_opens_at at time zone ${zone}, 'HH24:MI') as time,
             to_char(registration_opens_at at time zone 'utc', 'YYYY-MM-DD') as utc_day
        from public.events where id = ${eventId}::uuid`;
    if (!row) throw new Error('the event is gone');
    return row;
  }

  it('a paid event returns the typed pair of the tenant wall clock (a late-evening time crosses the UTC day), the instant and the seed', async () => {
    const typed = { date: tenantDate(3), time: '23:30' };
    const eventId = await created(body('edit-paid', 10, { registrationOpens: typed }));
    await ticketMapping(labTenantId, eventId);

    const res = await request(`/v1/events/${eventId}/edit`, adminToken);
    expect(res.status, await res.clone().text()).toBe(200);
    const json = (await res.json()) as Json;
    const expected = await wallClockOf(eventId);
    expect({ date: expected.date, time: expected.time }).toEqual(typed);
    // The point of the case: in America/Sao_Paulo 23:30 is the NEXT day in UTC.
    expect(expected.utc_day).not.toBe(typed.date);
    expect(json.registrationOpens).toEqual(typed);
    expect(json.registrationOpensAt).toMatch(ISO6);
    expect(json.serverNow).toMatch(ISO6);
    expect(json.ticket).toBeTruthy();
  });

  it('a paid event with no opening reads registrationOpens null and no instant, but still the seed', async () => {
    const eventId = await created(body('edit-none'));
    await ticketMapping(labTenantId, eventId);
    const res = await request(`/v1/events/${eventId}/edit`, adminToken);
    const json = (await res.json()) as Json;
    expect(res.status).toBe(200);
    expect(json.registrationOpens).toBeNull();
    expect(json).not.toHaveProperty('registrationOpensAt');
    expect(json.serverNow).toMatch(ISO6);
  });

  it('an event with NO mapping returns none of the three keys even when a date is stored (A-10.2-STALE-DATE)', async () => {
    const eventId = await created(
      body('edit-stale', 10, { registrationOpens: { date: tenantDate(3), time: '09:00' } }),
    );
    expect(await openingIs(eventId, { date: tenantDate(3), time: '09:00' })).toBe(true);
    const res = await request(`/v1/events/${eventId}/edit`, adminToken);
    const json = (await res.json()) as Json;
    expect(res.status).toBe(200);
    for (const key of ['registrationOpens', 'registrationOpensAt', 'serverNow']) {
      expect(json, key).not.toHaveProperty(key);
    }
  });

  it('a member and a support holder never get an opening block from the edit read', async () => {
    const eventId = await created(
      body('edit-lane', 10, { registrationOpens: { date: tenantDate(3), time: '09:00' } }),
    );
    await ticketMapping(labTenantId, eventId);
    const member = await memberToken();
    const asMember = await request(`/v1/events/${eventId}/edit`, member);
    expect(asMember.status).toBe(403);
    expect(await asMember.text()).not.toMatch(/registrationOpens|serverNow/);

    const identity = await createSharedIdentity({
      prefix: PREFIX,
      memberships: [{ host: 'lab', role: 'support_tenant' }],
    });
    const support = await signInAs(identity.email, identity.password);
    const asSupport = await request(`/v1/events/${eventId}/edit`, support);
    const raw = await asSupport.text();
    if (asSupport.status === 200) {
      expect(JSON.parse(raw)).not.toHaveProperty('ticket');
      expect(raw).not.toMatch(/registrationOpens|serverNow/);
    } else {
      expect(raw).not.toMatch(/registrationOpens|serverNow/);
    }
  });

  /* ── the attendee mark ── */

  /** The `before_opening` expression of pgTAP 234 section 8, evaluated on the stored rows (edit both together). */
  async function markTruth(eventId: string): Promise<Map<string, boolean>> {
    const rows = await adminSql<{ id: string; before_opening: boolean }[]>`
      select a.id::text as id,
             (a.origin = 'ticket' and a.ticket_confirmed_at is not null and ev.registration_opens_at is not null and a.ticket_confirmed_at < ev.registration_opens_at) as before_opening
        from public.event_attendances a
        join public.events ev on ev.id = a.event_id and ev.tenant_id = a.tenant_id
       where a.event_id = ${eventId}::uuid`;
    return new Map(rows.map((row) => [row.id, row.before_opening]));
  }

  /** A ticket row whose confirmation instant is `offset` from the event's stored opening (null: no instant). */
  async function ticketRow(
    eventId: string,
    userId: string,
    offset: string | null,
  ): Promise<string> {
    const [row] = await adminSql<{ id: string }[]>`
      insert into public.event_attendances
             (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref,
              ticket_confirmed_at)
      select ${labTenantId}::uuid, ${eventId}::uuid, ${userId}::uuid, 'going', now(), 'ticket', 'fake',
             ${orderRef()},
             case when ${offset}::text is null then null
                  else ev.registration_opens_at + ${offset}::interval end
        from public.events ev where ev.id = ${eventId}::uuid
      returning id::text as id`;
    if (!row) throw new Error('could not seed the ticket row');
    return row.id;
  }

  const attendance = async (token: string, eventId: string) =>
    readAs(token, `/v1/events/${eventId}/attendance?list=confirmed&limit=50`);

  it('an early payer is marked; a late payer, the exact instant, a null instant, a courtesy and a plain Vou are not; free rows carry no paid key', async () => {
    const eventId = await ticketEvent(labTenantId, { title: `${PREFIX}-mark`, opensInMinutes: 30 });
    const plain = await buyer();
    await seedPresence(eventId, plain.userId, { status: 'going', origin: 'rsvp' });
    await ticketMapping(labTenantId, eventId);
    const early = await buyer();
    const late = await buyer();
    const exact = await buyer();
    const none = await buyer();
    const courtesy = await buyer();
    const micro = await buyer();
    const ids = {
      early: await ticketRow(eventId, early.userId, '-1 hour'),
      micro: await ticketRow(eventId, micro.userId, '-1 microsecond'),
      exact: await ticketRow(eventId, exact.userId, '0 seconds'),
      late: await ticketRow(eventId, late.userId, '1 minute'),
      none: await ticketRow(eventId, none.userId, null),
    };
    await seedPresence(eventId, courtesy.userId, { status: 'going', origin: 'courtesy' });

    const admin = await attendance(adminToken, eventId);
    expect(admin.status, admin.raw).toBe(200);
    const items = admin.json.items as Json[];
    expect(items).toHaveLength(7);
    const marked = items.filter((item) => item.beforeOpening === true).map((item) => item.id);
    expect(marked.sort()).toEqual([ids.early, ids.micro].sort());
    for (const item of items) {
      if (item.beforeOpening !== undefined) expect(item.beforeOpening).toBe(true);
    }

    // The API answer is the pgTAP 234 section 8 expression evaluated on the same rows.
    const truth = await markTruth(eventId);
    for (const item of items) {
      expect(item.beforeOpening === true, String(item.id)).toBe(truth.get(item.id as string));
    }

    // A free event's rows carry none of the paid keys, even with a stale stored opening.
    const free = await ticketEvent(labTenantId, {
      title: `${PREFIX}-mark-free`,
      opensInMinutes: 30,
    });
    const freeUser = await buyer();
    await seedPresence(free, freeUser.userId, { status: 'going', origin: 'rsvp' });
    const freeList = await attendance(adminToken, free);
    const freeItems = freeList.json.items as Json[];
    expect(freeItems).toHaveLength(1);
    for (const key of ['origin', 'refunded', 'overLimit', 'beforeOpening']) {
      expect(freeItems[0], key).not.toHaveProperty(key);
    }

    // A paid event with nobody: an empty page.
    const empty = await mapped('mark-empty', { opensInMinutes: 30 });
    const emptyList = await attendance(adminToken, empty);
    expect(emptyList.json.items).toEqual([]);
  });

  it('a member is refused the attendance list (403) and receives no mark', async () => {
    const eventId = await ticketEvent(labTenantId, {
      title: `${PREFIX}-mark-member`,
      opensInMinutes: 30,
    });
    await ticketMapping(labTenantId, eventId);
    const payer = await buyer();
    await ticketRow(eventId, payer.userId, '-1 hour');
    const res = await attendance(await memberToken(), eventId);
    expect(res.status).toBe(403);
    expect(res.raw).not.toMatch(/beforeOpening/);
    // The payer's own detail read never carries the mark either (it is the admin lane's alone).
    const detail = await readAs(await memberToken(), `/v1/events/${eventId}`);
    expect(detail.raw).not.toMatch(/beforeOpening/);
  });
});
