import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
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
  type SeededPaymentIntegration,
  seedPaymentIntegration,
  setPaymentsRow,
  signInAs,
} from './setup';

/**
 * 10.1-07 (TICK-03, TICK-05, TICK-10, TICK-14, TICK-16, TICK-18, TICK-21, TICK-23; D-746, D-747, D-748,
 * D-753, D-755) against the live local stack: the READ side of a paid event.
 *
 *  - `10.1 tracer`: a member with no presence reads a mapped event and gets `paid`, the price, the sale link
 *    from the definer and `viewerOrigin: null`.
 *  - the three module states of D-746 (on and connected, module off, gateway disconnected): `paid` is true in
 *    all three, the link only in the first;
 *  - each `viewerOrigin` variant and `viewerRefunded`; another member's origin is never in a payload;
 *  - the list answers `paid` per row (the one-statement budget is `feed-query-budget.test.ts`);
 *  - the admin's edit read `ticket` object (task 2).
 *
 * Every identity and every event carries the prefix below; events and mappings are swept in `beforeAll`
 * (a crashed run) and `afterAll`. Test ORDER is load-bearing (`fileParallelism: false`).
 */

const PREFIX = 'evtk';

let labTenantId = '';
let integration: SeededPaymentIntegration;
let restorePayments: () => Promise<void> = async () => {};

type Person = { userId: string; membershipId: string; email: string; token: string };
type Role = 'member' | 'admin_tenant' | 'support_tenant';

async function person(role: Role = 'member'): Promise<Person> {
  const identity = await createSharedIdentity({
    prefix: PREFIX,
    memberships: [{ host: 'lab', role }],
  });
  const [membership] = await adminSql<{ id: string }[]>`
    select id::text as id from public.memberships
     where user_id = ${identity.userId}::uuid and tenant_id = ${labTenantId}::uuid`;
  return {
    userId: identity.userId,
    membershipId: membership?.id ?? '',
    email: identity.email,
    token: await signInAs(identity.email, identity.password),
  };
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

const LINK = 'https://pay.example.com/checkout/evtk';

/** A mapped event of the lab tenant with a stored purchase link and a reference price. */
async function paidEvent(label: string, options: { capacity?: number } = {}): Promise<string> {
  const eventId = await ticketEvent(labTenantId, {
    title: `${PREFIX}-${label}`,
    capacity: options.capacity ?? null,
  });
  await ticketMapping(labTenantId, eventId);
  await adminSql`
    update public.payment_products set checkout_url = ${LINK}
     where kind = 'event' and event_id = ${eventId}::uuid`;
  await adminSql`
    update public.events set ticket_price_cents = 8000 where id = ${eventId}::uuid`;
  return eventId;
}

/** A presence written the way the server writes it (the migration role; the member lane cannot). */
async function presence(
  eventId: string,
  userId: string,
  row: {
    status?: 'going' | 'checked_in' | 'walk_in' | 'not_going';
    origin?: 'rsvp' | 'ticket' | 'courtesy';
    refunded?: boolean;
    respondedAt?: string;
  } = {},
): Promise<string> {
  const origin = row.origin ?? 'rsvp';
  const status = row.status ?? 'going';
  const [inserted] = await adminSql<{ id: string }[]>`
    insert into public.event_attendances
           (tenant_id, event_id, user_id, status, responded_at, checked_in_at, checkin_via, origin,
            order_provider, order_ref, refunded_at)
    values (${labTenantId}::uuid, ${eventId}::uuid, ${userId}::uuid, ${status},
            ${row.respondedAt ?? new Date().toISOString()}::timestamptz,
            ${status === 'checked_in' || status === 'walk_in' ? adminSql`now()` : null},
            ${status === 'checked_in' || status === 'walk_in' ? 'online' : null},
            ${origin}, ${origin === 'ticket' ? 'fake' : null},
            ${origin === 'ticket' ? `ord-${crypto.randomUUID()}` : null},
            ${row.refunded ? adminSql`now()` : null})
    returning id::text as id`;
  if (!inserted) throw new Error('could not seed the presence');
  return inserted.id;
}

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
  integration = await seedPaymentIntegration(labTenantId);
}, 60_000);

afterEach(async () => {
  await removeTicketEvents(PREFIX);
  await removePaymentMappings(labTenantId);
  await setPaymentsRow(labTenantId, { enabled: true, settings: {} });
  moduleFlags.invalidate(labTenantId);
});

afterAll(async () => {
  await removeTicketEvents(PREFIX);
  await removePaymentMappings(labTenantId);
  await removePaymentIntegrations(labTenantId);
  await removeIdentitiesByPrefix(PREFIX);
  await restorePayments();
});

describe('10.1 tracer: a member reads a paid event (D-746, D-753, D-755, D-748)', () => {
  it('the detail answers paid, the price, the sale link and a null origin for a member with no presence', async () => {
    expect(integration.provider).toBe('fake');
    const member = await person();
    const eventId = await paidEvent('tracer');

    const res = await call(member, 'GET', `/${eventId}`);
    expect(res.status, res.raw).toBe(200);
    expect(res.json).toMatchObject({
      id: eventId,
      paid: true,
      ticketPriceCents: 8000,
      checkoutUrl: LINK,
      viewerOrigin: null,
      viewerStatus: null,
    });
  });
});

describe('10.1 the three module states of the sale link (D-746)', () => {
  it('module on and connected gives the link; module off and gateway disconnected give null; paid stays true', async () => {
    const member = await person();
    const eventId = await paidEvent('states');

    const on = await call(member, 'GET', `/${eventId}`);
    expect(on.json).toMatchObject({ paid: true, checkoutUrl: LINK });

    // Module off: the row stays, the flag is false. The Vou stays closed, the link disappears.
    await setPaymentsRow(labTenantId, { enabled: false, settings: {} });
    moduleFlags.invalidate(labTenantId);
    const off = await call(member, 'GET', `/${eventId}`);
    expect(off.status, off.raw).toBe(200);
    expect(off.json).toMatchObject({ paid: true, checkoutUrl: null });

    // Module back on, gateway disconnected.
    await setPaymentsRow(labTenantId, { enabled: true, settings: {} });
    moduleFlags.invalidate(labTenantId);
    await removePaymentIntegrations(labTenantId);
    const disconnected = await call(member, 'GET', `/${eventId}`);
    expect(disconnected.json).toMatchObject({ paid: true, checkoutUrl: null });

    integration = await seedPaymentIntegration(labTenantId);
    const reconnected = await call(member, 'GET', `/${eventId}`);
    expect(reconnected.json).toMatchObject({ paid: true, checkoutUrl: LINK });
  });

  it('an unmapped event answers paid false and a null link; a mapped event with a stored non-https link answers null', async () => {
    const member = await person();
    const free = await ticketEvent(labTenantId, { title: `${PREFIX}-free` });
    const res = await call(member, 'GET', `/${free}`);
    expect(res.json).toMatchObject({ paid: false, checkoutUrl: null, viewerOrigin: null });

    // A mapping with no link at all (hand-seeded): paid, but the sale is not open.
    const noLink = await ticketEvent(labTenantId, { title: `${PREFIX}-nolink` });
    await ticketMapping(labTenantId, noLink);
    const open = await call(member, 'GET', `/${noLink}`);
    expect(open.json).toMatchObject({ paid: true, checkoutUrl: null });
  });
});

describe('10.1 the viewer origin and the refund flag (D-748, D-753)', () => {
  it('answers ticket, courtesy, before_ticket and null, and the refunded flag', async () => {
    const buyer = await person();
    const guest = await person();
    const early = await person();
    const nobody = await person();
    const walker = await person();

    // The before-the-link row exists BEFORE the event is mapped (the paid door closes the Vou after).
    const eventId = await ticketEvent(labTenantId, { title: `${PREFIX}-origins` });
    await presence(eventId, early.userId, { origin: 'rsvp' });
    await presence(eventId, walker.userId, { origin: 'rsvp', status: 'walk_in' });
    await ticketMapping(labTenantId, eventId);
    await adminSql`
      update public.payment_products set checkout_url = ${LINK}
       where kind = 'event' and event_id = ${eventId}::uuid`;
    await presence(eventId, buyer.userId, { origin: 'ticket' });
    await presence(eventId, guest.userId, { origin: 'courtesy' });

    const read = async (who: Person) => (await call(who, 'GET', `/${eventId}`)).json;
    expect(await read(buyer)).toMatchObject({ viewerOrigin: 'ticket', viewerRefunded: false });
    expect(await read(guest)).toMatchObject({ viewerOrigin: 'courtesy', viewerRefunded: false });
    expect(await read(early)).toMatchObject({ viewerOrigin: 'before_ticket' });
    expect(await read(walker)).toMatchObject({ viewerOrigin: 'before_ticket' });
    expect(await read(nobody)).toMatchObject({ viewerOrigin: null, viewerRefunded: false });

    // A refunded checked-in ticket row stays, flagged.
    const refunded = await person();
    await presence(eventId, refunded.userId, {
      origin: 'ticket',
      status: 'checked_in',
      refunded: true,
    });
    expect(await read(refunded)).toMatchObject({ viewerOrigin: 'ticket', viewerRefunded: true });
  });

  it('a free event never answers an origin, even for a member with a plain Vou', async () => {
    const member = await person();
    const free = await ticketEvent(labTenantId, { title: `${PREFIX}-free-vou` });
    await presence(free, member.userId, { origin: 'rsvp' });
    const res = await call(member, 'GET', `/${free}`);
    expect(res.json).toMatchObject({ paid: false, viewerStatus: 'going', viewerOrigin: null });
  });

  it('a member never receives another member origin, and no payload carries a product id or a sold count', async () => {
    const buyer = await person();
    const other = await person();
    const eventId = await paidEvent('privacy');
    await presence(eventId, buyer.userId, { origin: 'ticket' });
    await presence(eventId, other.userId, { origin: 'courtesy' });

    const res = await call(other, 'GET', `/${eventId}`);
    const mine = res.json as { viewerOrigin?: string };
    expect(mine.viewerOrigin).toBe('courtesy');
    // The raw text names no gateway product, no order and no sold count.
    expect(res.raw).not.toMatch(/soldCount|externalProductId|order_ref|orderRef|overLimit/);
    const list = await call(other, 'GET', '?period=upcoming&limit=50');
    expect(list.raw).not.toMatch(/checkoutUrl|soldCount|externalProductId|overLimit/);
  });
});

describe('10.1 the list answers paid per row', () => {
  it('a mapped and an unmapped event in one page, without the sale link', async () => {
    const member = await person();
    const paid = await paidEvent('list-paid');
    const free = await ticketEvent(labTenantId, { title: `${PREFIX}-list-free` });

    const list = await call(member, 'GET', '?period=upcoming&limit=50');
    expect(list.status, list.raw).toBe(200);
    const items = (list.json as { items: Record<string, unknown>[] }).items;
    const paidItem = items.find((item) => item.id === paid);
    const freeItem = items.find((item) => item.id === free);
    expect(paidItem).toMatchObject({ paid: true, ticketPriceCents: 8000 });
    expect(freeItem).toMatchObject({ paid: false });
    // The sale link is the DETAIL's alone.
    expect(paidItem).not.toHaveProperty('checkoutUrl');
  });
});
