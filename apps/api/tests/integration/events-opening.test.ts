import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { removeTicketEvents, ticketMapping } from './payments-apply-fixtures';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  removePaymentMappings,
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
