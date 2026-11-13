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
  seedPaymentIntegration,
  setPaymentsRow,
  signInAs,
} from './setup';

/**
 * 10.1-07 (TICK-10, TICK-14, TICK-21; D-743, D-747, D-750, A-UI-5, A-UI-6; EP-21) against the live local
 * stack: the admin's courtesy.
 *
 *  - `10.1 tracer`: an admin releases a courtesy for a live member of a paid event through the real route;
 *  - every outcome of `POST /v1/events/{id}/courtesy`: granted, already_in (any origin, never rewritten), the
 *    `attendanceId` arm for a Nao vou row, over the limit, after the start, with the payments module OFF, and
 *    the refusals (member 403, free event, ended, cancelled, a member that is not live);
 *  - `DELETE .../courtesy/{attendanceId}`: removal, the checked-in lock, a ticket or a plain Vou is not a
 *    courtesy, a repeat is the bare 404;
 *  - `GET .../courtesy/holders`: 3 ids, the empty read, the 50-id cap (a 51st id is a 400);
 *  - EP-21: two parallel POSTs end with one row, and a POST racing the sale's grant of the same member ends
 *    with exactly one row of origin ticket, whichever side wins.
 *
 * The cross-tenant refusals of these three routes are the `phase 10.1 sweep: event courtesy` case of
 * `isolation.test.ts`. Every identity and event carries the prefix below and is swept in `beforeAll` and
 * `afterAll`. Test ORDER is load-bearing (`fileParallelism: false`).
 */

const PREFIX = 'evcty';

let labTenantId = '';
/** A second connection: the shared `adminSql` has one, and the race needs the sale's grant in parallel. */
let raceSql: postgres.Sql;
let restorePayments: () => Promise<void> = async () => {};

type Person = { userId: string; membershipId: string; email: string; token: string };
type Role = 'member' | 'admin_tenant' | 'support_tenant';

async function person(role: Role = 'member', status: 'active' | 'blocked' = 'active') {
  const identity = await createSharedIdentity({
    prefix: PREFIX,
    memberships: [{ host: 'lab', role, status }],
  });
  const [membership] = await adminSql<{ id: string }[]>`
    select id::text as id from public.memberships
     where user_id = ${identity.userId}::uuid and tenant_id = ${labTenantId}::uuid`;
  return {
    userId: identity.userId,
    membershipId: membership?.id ?? '',
    email: identity.email,
    token: await signInAs(identity.email, identity.password),
  } satisfies Person;
}

type Called = { status: number; json: Record<string, unknown>; raw: string };

async function call(who: Person, method: string, path: string, body?: unknown): Promise<Called> {
  const res = await api.request(`/v1/events${path}`, {
    method,
    headers: {
      'x-tenant-host': HOSTS.lab,
      authorization: `Bearer ${who.token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    // A non-JSON body: the status and the raw text still tell.
  }
  return { status: res.status, json, raw };
}

/** `details.event` of a refusal, or undefined. */
const eventIssue = (res: Called): unknown =>
  (res.json as { error?: { details?: { event?: unknown } } }).error?.details?.event;

const grant = (admin: Person, eventId: string, member: Person) =>
  call(admin, 'POST', `/${eventId}/courtesy`, { membershipId: member.membershipId });

/** The attendance rows of one event, with their owners' membership. */
const rowsOf = (eventId: string) =>
  adminSql<
    {
      id: string;
      user_id: string;
      status: string;
      origin: string;
      checked_in_at: Date | null;
      order_ref: string | null;
    }[]
  >`
    select id::text as id, user_id::text as user_id, status, origin, checked_in_at, order_ref
      from public.event_attendances where event_id = ${eventId}::uuid order by created_at, id`;

/** A live, mapped event of the lab tenant (the paid fact is the mapping row). */
async function paidEvent(
  label: string,
  options: {
    capacity?: number | null;
    startsInMinutes?: number;
    endsInMinutes?: number;
    status?: 'active' | 'cancelled';
  } = {},
): Promise<string> {
  const eventId = await ticketEvent(labTenantId, { title: `${PREFIX}-${label}`, ...options });
  await ticketMapping(labTenantId, eventId);
  return eventId;
}

/** A presence written the way the server writes it (the migration role). */
async function presence(
  eventId: string,
  userId: string,
  spec: { status?: 'going' | 'not_going' | 'checked_in'; origin?: 'rsvp' | 'ticket' | 'courtesy' },
): Promise<string> {
  const origin = spec.origin ?? 'rsvp';
  const status = spec.status ?? 'going';
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.event_attendances
           (tenant_id, event_id, user_id, status, responded_at, checked_in_at, checkin_via, origin,
            order_provider, order_ref)
    values (${labTenantId}::uuid, ${eventId}::uuid, ${userId}::uuid, ${status}, now(),
            ${status === 'checked_in' ? adminSql`now()` : null},
            ${status === 'checked_in' ? 'online' : null}, ${origin},
            ${origin === 'ticket' ? 'fake' : null},
            ${origin === 'ticket' ? `ord-${crypto.randomUUID()}` : null})
    returning id::text as id`;
  if (!row) throw new Error('could not seed the presence');
  return row.id;
}

/** The sale's grant: `app.event_gateway_grant` as the service role, on its own connection. */
async function saleGrant(eventId: string, member: Person, orderRef: string): Promise<string> {
  const rows = await raceSql.begin(async (tx) => {
    await tx`set local role service_role`;
    return tx<{ outcome: string }[]>`
      select outcome from app.event_gateway_grant(${labTenantId}::uuid, ${member.membershipId}::uuid,
                                                  ${eventId}::uuid, 'fake', ${orderRef})`;
  });
  return rows[0]?.outcome ?? 'none';
}

let admin: Person;

beforeAll(async () => {
  const [tenant] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-lab'`;
  if (!tenant) throw new Error('seed tenants missing: run pnpm db:seed');
  labTenantId = tenant.id;
  await removeTicketEvents(PREFIX);
  await removePaymentMappings(labTenantId);
  await removePaymentIntegrations(labTenantId);
  await removeIdentitiesByPrefix(PREFIX);

  const [previous] = await adminSql<{ enabled: boolean; settings: Record<string, unknown> }[]>`
    select enabled, settings from public.tenant_modules
     where tenant_id = ${labTenantId}::uuid and module_key = 'payments'`;
  await setPaymentsRow(labTenantId, { enabled: true, settings: {} });
  moduleFlags.invalidate(labTenantId);
  restorePayments = async () => {
    if (previous) {
      await setPaymentsRow(labTenantId, { enabled: previous.enabled, settings: previous.settings });
    } else {
      await adminSql`
        delete from public.tenant_modules
         where tenant_id = ${labTenantId}::uuid and module_key = 'payments'`;
    }
    moduleFlags.invalidate(labTenantId);
  };
  await seedPaymentIntegration(labTenantId);
  raceSql = postgres('postgres://postgres:postgres@127.0.0.1:54322/postgres', {
    prepare: false,
    max: 4,
  });
  admin = await person('admin_tenant');
}, 60_000);

afterEach(async () => {
  await removeTicketEvents(PREFIX);
  await removePaymentMappings(labTenantId);
});

afterAll(async () => {
  await removeTicketEvents(PREFIX);
  await removePaymentMappings(labTenantId);
  await removePaymentIntegrations(labTenantId);
  await removeIdentitiesByPrefix(PREFIX);
  await raceSql?.end({ timeout: 5 });
  await restorePayments();
});

describe('10.1 tracer: the admin releases a courtesy (D-743)', () => {
  it('POST with a membershipId answers granted and leaves one going row of origin courtesy', async () => {
    const member = await person();
    const eventId = await paidEvent('tracer');

    const res = await grant(admin, eventId, member);
    expect(res.status, res.raw).toBe(200);
    expect(res.json).toEqual({ outcome: 'granted' });
    const rows = await rowsOf(eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: member.userId,
      status: 'going',
      origin: 'courtesy',
      checked_in_at: null,
      order_ref: null,
    });
  });
});

describe('10.1 the outcomes of the release', () => {
  it('already_in leaves any existing presence untouched: a ticket stays a ticket, a plain Vou stays a Vou', async () => {
    const buyer = await person();
    const early = await person();
    const eventId = await ticketEvent(labTenantId, { title: `${PREFIX}-already` });
    await presence(eventId, early.userId, { origin: 'rsvp' });
    await ticketMapping(labTenantId, eventId);
    await presence(eventId, buyer.userId, { origin: 'ticket' });
    const before = JSON.stringify(await rowsOf(eventId));

    for (const member of [buyer, early]) {
      const res = await grant(admin, eventId, member);
      expect(res.status, res.raw).toBe(200);
      expect(res.json).toEqual({ outcome: 'already_in' });
    }
    expect(JSON.stringify(await rowsOf(eventId))).toBe(before);

    // A repeat of a courtesy is already_in too.
    const guest = await person();
    expect((await grant(admin, eventId, guest)).json).toEqual({ outcome: 'granted' });
    expect((await grant(admin, eventId, guest)).json).toEqual({ outcome: 'already_in' });
    expect((await rowsOf(eventId)).filter((row) => row.origin === 'courtesy')).toHaveLength(1);
  });

  it('the attendanceId arm releases the member of a Nao vou row (the row carries no user id)', async () => {
    const declined = await person();
    const eventId = await ticketEvent(labTenantId, { title: `${PREFIX}-attendance` });
    const attendanceId = await presence(eventId, declined.userId, { status: 'not_going' });
    await ticketMapping(labTenantId, eventId);

    const res = await call(admin, 'POST', `/${eventId}/courtesy`, { attendanceId });
    expect(res.status, res.raw).toBe(200);
    expect(res.json).toEqual({ outcome: 'granted' });
    const rows = await rowsOf(eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: attendanceId, status: 'going', origin: 'courtesy' });

    // An unknown attendance id is the bare 404.
    const unknown = await call(admin, 'POST', `/${eventId}/courtesy`, {
      attendanceId: crypto.randomUUID(),
    });
    expect(unknown.status).toBe(404);
    expect(unknown.json).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect((unknown.json as { error: { details?: unknown } }).error.details).toBeUndefined();
  });

  it('works over the limit (A-UI-5), after the start (D-750) and with the payments module OFF (D-743)', async () => {
    const buyer = await person();
    const over = await person();
    const later = await person();
    const full = await paidEvent('full', { capacity: 1 });
    await presence(full, buyer.userId, { origin: 'ticket' });
    expect((await grant(admin, full, over)).json).toEqual({ outcome: 'granted' });

    const started = await paidEvent('started', { startsInMinutes: -30, endsInMinutes: 120 });
    expect((await grant(admin, started, later)).json).toEqual({ outcome: 'granted' });

    await setPaymentsRow(labTenantId, { enabled: false, settings: {} });
    moduleFlags.invalidate(labTenantId);
    const off = await person();
    const open = await paidEvent('module-off');
    const res = await grant(admin, open, off);
    expect(res.status, res.raw).toBe(200);
    expect(res.json).toEqual({ outcome: 'granted' });
    await setPaymentsRow(labTenantId, { enabled: true, settings: {} });
    moduleFlags.invalidate(labTenantId);
  });

  it('refuses a free event (event_not_paid), an ended and a cancelled event, and answers a member that is not live with the bare 404', async () => {
    const member = await person();
    const free = await ticketEvent(labTenantId, { title: `${PREFIX}-free` });
    const notPaid = await grant(admin, free, member);
    expect(notPaid.status).toBe(409);
    expect(eventIssue(notPaid)).toBe('event_not_paid');

    const ended = await paidEvent('ended', { startsInMinutes: -240, endsInMinutes: -60 });
    const endedRes = await grant(admin, ended, member);
    expect(endedRes.status).toBe(409);
    expect(eventIssue(endedRes)).toBe('event_ended');

    const cancelled = await paidEvent('cancelled', { status: 'cancelled' });
    const cancelledRes = await grant(admin, cancelled, member);
    expect(cancelledRes.status).toBe(409);
    expect(eventIssue(cancelledRes)).toBe('cancelled');

    const blocked = await person('member', 'blocked');
    const live = await paidEvent('blocked');
    const blockedRes = await grant(admin, live, blocked);
    expect(blockedRes.status).toBe(404);
    expect((blockedRes.json as { error: { details?: unknown } }).error.details).toBeUndefined();
    expect(await rowsOf(live)).toHaveLength(0);
    expect(await rowsOf(free)).toHaveLength(0);
    expect(await rowsOf(ended)).toHaveLength(0);
    expect(await rowsOf(cancelled)).toHaveLength(0);
  });

  it('is refused to a member and to support (403) on all three routes, and the strict body refuses forged keys', async () => {
    const member = await person();
    const support = await person('support_tenant');
    const target = await person();
    const eventId = await paidEvent('guards');
    const courtesyId = await presence(eventId, target.userId, { origin: 'courtesy' });

    for (const who of [member, support]) {
      const post = await call(who, 'POST', `/${eventId}/courtesy`, {
        membershipId: target.membershipId,
      });
      expect(post.status, `post ${who.email}`).toBe(403);
      const remove = await call(who, 'DELETE', `/${eventId}/courtesy/${courtesyId}`);
      expect(remove.status, `delete ${who.email}`).toBe(403);
      const holders = await call(
        who,
        'GET',
        `/${eventId}/courtesy/holders?membershipIds=${target.membershipId}`,
      );
      expect(holders.status, `holders ${who.email}`).toBe(403);
    }
    expect((await rowsOf(eventId))[0]?.origin).toBe('courtesy');

    const forged = [
      { membershipId: target.membershipId, userId: member.userId },
      { membershipId: target.membershipId, origin: 'ticket' },
      { membershipId: target.membershipId, attendanceId: courtesyId },
      {},
      { membershipId: 'not-a-uuid' },
    ];
    for (const body of forged) {
      const res = await call(admin, 'POST', `/${eventId}/courtesy`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe('10.1 the removal of a courtesy', () => {
  it('deletes a going courtesy, refuses a checked-in one, a ticket and a plain Vou, and a repeat is the bare 404', async () => {
    const guest = await person();
    const present = await person();
    const buyer = await person();
    const early = await person();
    const eventId = await ticketEvent(labTenantId, { title: `${PREFIX}-remove` });
    const earlyRow = await presence(eventId, early.userId, { origin: 'rsvp' });
    await ticketMapping(labTenantId, eventId);
    const guestRow = await presence(eventId, guest.userId, { origin: 'courtesy' });
    const presentRow = await presence(eventId, present.userId, {
      origin: 'courtesy',
      status: 'checked_in',
    });
    const buyerRow = await presence(eventId, buyer.userId, { origin: 'ticket' });

    const removed = await call(admin, 'DELETE', `/${eventId}/courtesy/${guestRow}`);
    expect(removed.status, removed.raw).toBe(204);
    expect((await rowsOf(eventId)).some((row) => row.id === guestRow)).toBe(false);

    const again = await call(admin, 'DELETE', `/${eventId}/courtesy/${guestRow}`);
    expect(again.status).toBe(404);
    expect((again.json as { error: { details?: unknown } }).error.details).toBeUndefined();

    const locked = await call(admin, 'DELETE', `/${eventId}/courtesy/${presentRow}`);
    expect(locked.status).toBe(409);
    expect(eventIssue(locked)).toBe('attendance_locked');
    for (const row of [buyerRow, earlyRow]) {
      const res = await call(admin, 'DELETE', `/${eventId}/courtesy/${row}`);
      expect(res.status, row).toBe(409);
      expect(eventIssue(res), row).toBe('not_courtesy');
    }
    expect(await rowsOf(eventId)).toHaveLength(3);

    // After the removal the member can be released again.
    expect((await grant(admin, eventId, guest)).json).toEqual({ outcome: 'granted' });
  });
});

describe('10.1 the holders read (A-UI-6)', () => {
  it('answers which of the asked memberships already hold a presence, the empty read, and refuses a 51st id', async () => {
    const holder = await person();
    const guest = await person();
    const nobody = await person();
    const declined = await person();
    const eventId = await ticketEvent(labTenantId, { title: `${PREFIX}-holders` });
    await presence(eventId, declined.userId, { status: 'not_going' });
    await ticketMapping(labTenantId, eventId);
    await presence(eventId, holder.userId, { origin: 'ticket' });
    await presence(eventId, guest.userId, { origin: 'courtesy' });

    const ids = [holder, guest, nobody, declined].map((who) => who.membershipId);
    const res = await call(
      admin,
      'GET',
      `/${eventId}/courtesy/holders?membershipIds=${ids.join(',')}`,
    );
    expect(res.status, res.raw).toBe(200);
    const holders = (res.json as { holders: string[] }).holders;
    expect([...holders].sort()).toEqual([holder.membershipId, guest.membershipId].sort());

    const none = await call(admin, 'GET', `/${eventId}/courtesy/holders`);
    expect(none.status).toBe(200);
    expect(none.json).toEqual({ holders: [] });

    // Fifty ids is the cap; the 51st is a 400 and reads nothing.
    const fifty = Array.from({ length: 50 }, () => crypto.randomUUID());
    const atCap = await call(
      admin,
      'GET',
      `/${eventId}/courtesy/holders?membershipIds=${fifty.join(',')}`,
    );
    expect(atCap.status).toBe(200);
    expect(atCap.json).toEqual({ holders: [] });
    const over = await call(
      admin,
      'GET',
      `/${eventId}/courtesy/holders?membershipIds=${[...fifty, crypto.randomUUID()].join(',')}`,
    );
    expect(over.status).toBe(400);
    const malformed = await call(
      admin,
      'GET',
      `/${eventId}/courtesy/holders?membershipIds=not-a-uuid`,
    );
    expect(malformed.status).toBe(400);
  });
});

describe('10.1 the races (EP-21, T-10.1-15)', () => {
  it('two parallel releases of one member end with one row, one granted and one already_in, never an error', async () => {
    for (let round = 0; round < 4; round += 1) {
      const member = await person();
      const eventId = await paidEvent(`double-${round}`);
      const [first, second] = await Promise.all([
        grant(admin, eventId, member),
        grant(admin, eventId, member),
      ]);
      expect([first.status, second.status], `round ${round}`).toEqual([200, 200]);
      expect(
        [
          (first.json as { outcome: string }).outcome,
          (second.json as { outcome: string }).outcome,
        ].sort(),
        `round ${round}`,
      ).toEqual(['already_in', 'granted']);
      const rows = await rowsOf(eventId);
      expect(rows, `round ${round}`).toHaveLength(1);
      expect(rows[0]?.origin).toBe('courtesy');
    }
  });

  it('a release racing the sale of the same member ends with exactly one row of origin ticket, whichever side wins', async () => {
    for (let round = 0; round < 6; round += 1) {
      const member = await person();
      const eventId = await paidEvent(`sale-${round}`);
      const [courtesy, sale] = await Promise.all([
        grant(admin, eventId, member),
        saleGrant(eventId, member, `${PREFIX}-ord-${round}-${crypto.randomUUID()}`),
      ]);
      expect(courtesy.status, `round ${round}: ${courtesy.raw}`).toBe(200);
      expect(['granted', 'already_in']).toContain((courtesy.json as { outcome: string }).outcome);
      expect(sale, `round ${round}`).not.toBe('none');
      const rows = await rowsOf(eventId);
      expect(rows, `round ${round}`).toHaveLength(1);
      expect(rows[0]?.origin, `round ${round} (sale ${sale})`).toBe('ticket');
      expect(rows[0]?.order_ref, `round ${round}`).not.toBeNull();
    }
  });
});
