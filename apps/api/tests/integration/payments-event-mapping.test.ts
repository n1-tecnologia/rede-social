import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  deliver,
  freshEmail,
  removeTicketEvents,
  ticketDelivery,
  ticketEvent,
} from './payments-apply-fixtures';
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
 * 10.1-06 (TICK-01..TICK-04, TICK-20, TICK-21, TICK-23; D-744..D-747, D-757, D-760) against the live local
 * stack: the three mapping routes `GET`, `PUT` and `DELETE /v1/payments/event-products/{eventId}` that the
 * event form of plan 11 calls. Every case uses the `fake` provider (its integration is seeded), so no
 * string here names a gateway brand.
 *
 *  - `10.1 tracer`: the admin links a product id and a purchase link to an event, through the real route,
 *    with both fields required, `https:` only, and a product id another event holds refused.
 *  - the later blocks cover the read, the sales lock, the reset, the recurring hint, the boundaries and the
 *    races (see the `describe` titles).
 *
 * Every identity and every event carries the prefix below; events and mappings are swept in `beforeAll`
 * (a crashed run) and `afterAll`. Test ORDER is load-bearing (`fileParallelism: false`).
 */

const PREFIX = 'evmap';

let labTenantId = '';
let integration: SeededPaymentIntegration;
/** A second connection: the shared `adminSql` has one, and the races need two sessions at once. */
let raceSql: postgres.Sql;
let restorePayments: () => Promise<void> = async () => {};

type Person = { userId: string; email: string; token: string };
type Role = 'member' | 'admin_tenant' | 'support_tenant';

async function person(host: keyof typeof HOSTS, role: Role = 'member'): Promise<Person> {
  const identity = await createSharedIdentity({ prefix: PREFIX, memberships: [{ host, role }] });
  return {
    userId: identity.userId,
    email: identity.email,
    token: await signInAs(identity.email, identity.password),
  };
}

type Called = { status: number; json: Record<string, unknown>; raw: string };

async function call(
  who: Person,
  method: string,
  path: string,
  body?: unknown,
  host: string = HOSTS.lab,
): Promise<Called> {
  const res = await api.request(`/v1/payments${path}`, {
    method,
    headers: {
      'x-tenant-host': host,
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

/** `details.payments` of a refusal, or undefined. */
const paymentsIssue = (res: Called): unknown =>
  (res.json as { error?: { details?: { payments?: unknown } } }).error?.details?.payments;

const link = (tail = 'checkout') => `https://pay.example.com/${tail}`;
const productId = (label: string) => `${PREFIX}-${label}-${crypto.randomUUID().slice(0, 8)}`;

/** The one event mapping row of an event (admin read), or null. */
const mappingRow = async (eventId: string) => {
  const [row] = await adminSql<
    {
      provider: string;
      external_product_id: string;
      checkout_url: string | null;
      updated_at: Date;
    }[]
  >`
    select provider, external_product_id, checkout_url, updated_at from public.payment_products
     where kind = 'event' and event_id = ${eventId}::uuid`;
  return row ?? null;
};

/** Central reservations of one gateway product id (provider `fake`). */
const routeCount = async (externalProductId: string) => {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from platform.payment_product_routes
     where provider = 'fake' and external_product_id = ${externalProductId}`;
  return row?.n ?? -1;
};

async function labEvent(label: string): Promise<string> {
  return ticketEvent(labTenantId, { title: `${PREFIX}-${label}` });
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
  raceSql = postgres('postgres://postgres:postgres@127.0.0.1:54322/postgres', {
    prepare: false,
    max: 4,
  });
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

describe('10.1 tracer: the admin links a product to an event (D-744, D-745, D-746)', () => {
  it('PUT writes the one event mapping, needs both fields, refuses a non-https link and a taken product id', async () => {
    expect(integration.provider).toBe('fake');
    const admin = await person('lab', 'admin_tenant');
    const eventId = await labEvent('tracer');
    const other = await labEvent('tracer-other');
    const ext = productId('t');

    const saved = await call(admin, 'PUT', `/event-products/${eventId}`, {
      externalProductId: ext,
      checkoutUrl: link(),
    });
    expect(saved.status, saved.raw).toBe(200);
    expect(saved.json).toEqual({
      externalProductId: ext,
      checkoutUrl: link(),
      recurring: false,
    });
    const row = await mappingRow(eventId);
    expect(row).toMatchObject({
      provider: 'fake',
      external_product_id: ext,
      checkout_url: link(),
    });
    expect(await routeCount(ext)).toBe(1);

    // Both fields are required: a missing or empty one is its own machine code, nothing is written.
    const refused = async (body: Record<string, unknown>, code: string) => {
      const res = await call(admin, 'PUT', `/event-products/${other}`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(paymentsIssue(res), JSON.stringify(body)).toBe(code);
      expect(await mappingRow(other), JSON.stringify(body)).toBeNull();
    };
    await refused({ checkoutUrl: link() }, 'gateway_product_id_required');
    await refused({ externalProductId: productId('x') }, 'link_required');
    await refused({ externalProductId: productId('x'), checkoutUrl: '' }, 'link_required');
    await refused({ externalProductId: productId('x'), checkoutUrl: '   ' }, 'link_required');
    await refused({ externalProductId: '  ', checkoutUrl: link() }, 'gateway_product_id_required');
    await refused({}, 'gateway_product_id_required');
    await refused(
      { externalProductId: productId('x'), checkoutUrl: 'http://pay.example.com/x' },
      'link_invalid',
    );

    // The strict body: an unknown key is a generic 400 and writes nothing.
    const extra = await call(admin, 'PUT', `/event-products/${other}`, {
      externalProductId: productId('x'),
      checkoutUrl: link(),
      provider: 'fake',
    });
    expect(extra.status).toBe(400);
    expect(await mappingRow(other)).toBeNull();

    // A product id another event holds is the existing 409, and the loser holds no row.
    const taken = await call(admin, 'PUT', `/event-products/${other}`, {
      externalProductId: ext,
      checkoutUrl: link('other'),
    });
    expect(taken.status).toBe(409);
    expect(paymentsIssue(taken)).toBe('gateway_product_taken');
    expect(await mappingRow(other)).toBeNull();
    expect(await routeCount(ext)).toBe(1);
  }, 90_000);
});

/** The membership id of a person in the lab tenant. */
async function membershipOf(who: Person): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    select id::text as id from public.memberships
     where user_id = ${who.userId}::uuid and tenant_id = ${labTenantId}::uuid`;
  if (!row) throw new Error('the person has no lab membership');
  return row.id;
}

/**
 * A ticket presence made the way the sale makes it: `app.event_gateway_grant` called as the service role
 * (the apply job's own role), on a connection of its own. Returns the definer's outcome.
 */
async function grantTicket(
  eventId: string,
  membershipId: string,
  orderRef: string,
  sql: postgres.Sql = raceSql,
): Promise<string> {
  const rows = await sql.begin(async (tx) => {
    await tx`set local role service_role`;
    return tx<{ outcome: string }[]>`
      select outcome from app.event_gateway_grant(${labTenantId}::uuid, ${membershipId}::uuid,
                                                  ${eventId}::uuid, 'fake', ${orderRef})`;
  });
  return rows[0]?.outcome ?? 'none';
}

/** The ticket and courtesy presences of an event, by origin. */
const presences = async (eventId: string) => {
  const rows = await adminSql<{ origin: string; status: string }[]>`
    select origin, status from public.event_attendances
     where event_id = ${eventId}::uuid order by origin`;
  return rows;
};

/** A body without its per-call request id, so two refusals are comparable. */
const sansRequestId = (raw: string) => {
  const { error } = JSON.parse(raw) as { error: Record<string, unknown> };
  const { requestId: _requestId, ...rest } = error;
  return JSON.stringify(rest);
};

const EXPECTED_READ_KEYS = ['connected', 'locked', 'mapping', 'recurring', 'soldCount'];

describe('10.1 the read and the key set (D-757, T-10.1-11)', () => {
  it('GET answers exactly the five keys before and after linking, and never the token or a payload', async () => {
    const admin = await person('lab', 'admin_tenant');
    const eventId = await labEvent('read');
    const ext = productId('r');

    const empty = await call(admin, 'GET', `/event-products/${eventId}`);
    expect(empty.status).toBe(200);
    expect(empty.json).toEqual({
      connected: true,
      mapping: null,
      soldCount: 0,
      locked: false,
      recurring: false,
    });

    await call(admin, 'PUT', `/event-products/${eventId}`, {
      externalProductId: ext,
      checkoutUrl: link('read'),
    });
    const linked = await call(admin, 'GET', `/event-products/${eventId}`);
    expect(linked.json).toEqual({
      connected: true,
      mapping: { externalProductId: ext, checkoutUrl: link('read') },
      soldCount: 0,
      locked: false,
      recurring: false,
    });
    expect(Object.keys(linked.json).sort()).toEqual(EXPECTED_READ_KEYS);
    expect(linked.raw).not.toContain(integration.token);
    expect(linked.raw).not.toContain('secret');
    expect(linked.raw).not.toContain(labTenantId);
  }, 60_000);

  it('a foreign, unknown or non-uuid event is the bare 404 on all three routes', async () => {
    const admin = await person('lab', 'admin_tenant');
    const demoAdmin = await person('demo', 'admin_tenant');
    const [demoTenant] = await adminSql<{ id: string }[]>`
      select id::text as id from public.tenants where slug = 'rede-demo'`;
    if (!demoTenant) throw new Error('rede-demo is not seeded');
    const foreign = await ticketEvent(demoTenant.id, { title: `${PREFIX}-foreign` });
    expect(demoAdmin.userId).not.toBe(admin.userId);
    for (const id of [foreign, crypto.randomUUID(), 'not-a-uuid', '12345']) {
      for (const method of ['GET', 'PUT', 'DELETE']) {
        const res = await call(
          admin,
          method,
          `/event-products/${id}`,
          method === 'PUT' ? { externalProductId: productId('f'), checkoutUrl: link() } : undefined,
        );
        expect(res.status, `${method} ${id}`).toBe(404);
        const error = (res.json as { error?: { code?: string; details?: unknown } }).error;
        expect(error?.code, `${method} ${id}`).toBe('NOT_FOUND');
        expect(error?.details, `${method} ${id}`).toBeUndefined();
      }
    }
    expect(await mappingRow(foreign)).toBeNull();
    const [leftover] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from platform.payment_product_routes
       where external_product_id like ${`${PREFIX}-f-%`}`;
    expect(leftover?.n, 'a refused PUT leaves no central reservation').toBe(0);
  }, 60_000);

  it('a member and a support agent are refused 403, and the module being off is the module-off 404 with nothing written (D-746)', async () => {
    const member = await person('lab', 'member');
    const support = await person('lab', 'support_tenant');
    const admin = await person('lab', 'admin_tenant');
    const eventId = await labEvent('guards');
    const body = { externalProductId: productId('g'), checkoutUrl: link() };
    for (const who of [member, support]) {
      for (const method of ['GET', 'PUT', 'DELETE']) {
        const res = await call(
          who,
          method,
          `/event-products/${eventId}`,
          method === 'PUT' ? body : undefined,
        );
        expect(res.status, method).toBe(403);
      }
    }
    expect(await mappingRow(eventId)).toBeNull();

    await setPaymentsRow(labTenantId, { enabled: false, settings: {} });
    moduleFlags.invalidate(labTenantId);
    try {
      for (const method of ['GET', 'PUT', 'DELETE']) {
        const res = await call(
          admin,
          method,
          `/event-products/${eventId}`,
          method === 'PUT' ? body : undefined,
        );
        expect(res.status, method).toBe(404);
        expect((res.json as { error?: { code?: string } }).error?.code, method).toBe(
          'MODULE_DISABLED',
        );
      }
      expect(await mappingRow(eventId)).toBeNull();
      expect(await routeCount(body.externalProductId)).toBe(0);
    } finally {
      await setPaymentsRow(labTenantId, { enabled: true, settings: {} });
      moduleFlags.invalidate(labTenantId);
    }
  }, 60_000);

  it('recurring is true only when a delivery of THAT product was a subscription (D-757)', async () => {
    const admin = await person('lab', 'admin_tenant');
    const eventId = await labEvent('recurring');
    const ext = productId('rec');
    const first = await call(admin, 'PUT', `/event-products/${eventId}`, {
      externalProductId: ext,
      checkoutUrl: link(),
    });
    expect(first.json.recurring).toBe(false);

    // A one-off delivery of the product, and a subscription of ANOTHER product: still false.
    await deliver(
      integration,
      ticketDelivery('purchase_approved', {
        ref: `${PREFIX}-one-${crypto.randomUUID()}`,
        productId: ext,
        email: freshEmail(PREFIX),
      }),
    );
    await deliver(
      integration,
      ticketDelivery('purchase_approved', {
        ref: `${PREFIX}-other-${crypto.randomUUID()}`,
        productId: productId('someone-else'),
        email: freshEmail(PREFIX),
        recurring: true,
      }),
    );
    expect((await call(admin, 'GET', `/event-products/${eventId}`)).json.recurring).toBe(false);

    await deliver(
      integration,
      ticketDelivery('purchase_approved', {
        ref: `${PREFIX}-sub-${crypto.randomUUID()}`,
        productId: ext,
        email: freshEmail(PREFIX),
        recurring: true,
      }),
    );
    expect((await call(admin, 'GET', `/event-products/${eventId}`)).json.recurring).toBe(true);
    const saved = await call(admin, 'PUT', `/event-products/${eventId}`, {
      externalProductId: ext,
      checkoutUrl: link(),
    });
    expect(saved.json).toEqual({ externalProductId: ext, checkoutUrl: link(), recurring: true });
  }, 60_000);
});

describe('10.1 the sales lock and the reset (D-747)', () => {
  it('with a ticket sold, a changed pair and a removal are 409 ticket_locked and write nothing; the same pair is idempotent success', async () => {
    const admin = await person('lab', 'admin_tenant');
    const buyer = await person('lab', 'member');
    const eventId = await labEvent('locked');
    const ext = productId('lk');
    await call(admin, 'PUT', `/event-products/${eventId}`, {
      externalProductId: ext,
      checkoutUrl: link('a'),
    });
    expect(await grantTicket(eventId, await membershipOf(buyer), `${PREFIX}-ord-${ext}`)).toBe(
      'granted',
    );
    const before = await mappingRow(eventId);

    const read = await call(admin, 'GET', `/event-products/${eventId}`);
    expect(read.json).toMatchObject({ soldCount: 1, locked: true });

    // A stale tab: another product id, another link, or the removal. Every one is the same 409.
    const newExt = productId('lk-new');
    const attempts: [string, Record<string, unknown> | undefined][] = [
      ['PUT', { externalProductId: newExt, checkoutUrl: link('a') }],
      ['PUT', { externalProductId: ext, checkoutUrl: link('b') }],
      ['DELETE', undefined],
      ['DELETE', undefined],
    ];
    const bodies: string[] = [];
    for (const [method, body] of attempts) {
      const res = await call(admin, method, `/event-products/${eventId}`, body);
      expect(res.status, method).toBe(409);
      expect(paymentsIssue(res), method).toBe('ticket_locked');
      bodies.push(sansRequestId(res.raw));
    }
    expect(new Set(bodies).size, 'the refusal is the same every time').toBe(1);
    expect(await mappingRow(eventId)).toEqual(before);
    expect(await routeCount(newExt), 'the refused key leaves no reservation').toBe(0);
    expect(await routeCount(ext)).toBe(1);
    expect((await presences(eventId)).map((row) => row.origin)).toEqual(['ticket']);

    // Saving the SAME pair is success and changes nothing (the form saves the whole event again).
    const same = await call(admin, 'PUT', `/event-products/${eventId}`, {
      externalProductId: ext,
      checkoutUrl: link('a'),
    });
    expect(same.status).toBe(200);
    expect(await mappingRow(eventId)).toEqual(before);
  }, 90_000);

  it('DELETE returns a courtesy presence to a plain answer (the member can say Nao vou), releases the route and is idempotent (EP-09)', async () => {
    const admin = await person('lab', 'admin_tenant');
    const guest = await person('lab', 'member');
    const eventId = await labEvent('reset');
    const ext = productId('rs');
    await call(admin, 'PUT', `/event-products/${eventId}`, {
      externalProductId: ext,
      checkoutUrl: link(),
    });
    await adminSql`
      insert into public.event_attendances (tenant_id, event_id, user_id, status, responded_at, origin)
      values (${labTenantId}::uuid, ${eventId}::uuid, ${guest.userId}::uuid, 'going', now(), 'courtesy')`;
    expect((await presences(eventId)).map((row) => row.origin)).toEqual(['courtesy']);
    expect(await routeCount(ext)).toBe(1);

    const removed = await call(admin, 'DELETE', `/event-products/${eventId}`);
    expect(removed.status).toBe(200);
    expect(removed.json).toEqual({
      connected: true,
      mapping: null,
      soldCount: 0,
      locked: false,
      recurring: false,
    });
    expect(await mappingRow(eventId)).toBeNull();
    expect(await routeCount(ext), 'the central route is released').toBe(0);
    expect(await presences(eventId)).toEqual([{ origin: 'rsvp', status: 'going' }]);

    // The member's own answer works again: the event is the instant Vou.
    const rsvp = await api.request(`/v1/events/${eventId}/rsvp`, {
      method: 'PUT',
      headers: {
        'x-tenant-host': HOSTS.lab,
        authorization: `Bearer ${guest.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ answer: 'not_going' }),
    });
    expect(rsvp.status, await rsvp.clone().text()).toBe(200);
    expect(await presences(eventId)).toEqual([{ origin: 'rsvp', status: 'not_going' }]);

    // EP-09: the second DELETE is the same success and touches nothing.
    const [attendanceBefore] = await adminSql<{ updated_at: Date }[]>`
      select updated_at from public.event_attendances where event_id = ${eventId}::uuid`;
    const again = await call(admin, 'DELETE', `/event-products/${eventId}`);
    expect(again.status).toBe(200);
    expect(again.json).toEqual(removed.json);
    const [attendanceAfter] = await adminSql<{ updated_at: Date }[]>`
      select updated_at from public.event_attendances where event_id = ${eventId}::uuid`;
    expect(attendanceAfter?.updated_at).toEqual(attendanceBefore?.updated_at);
    // The product id is free again for another event.
    const other = await labEvent('reset-other');
    const reuse = await call(admin, 'PUT', `/event-products/${other}`, {
      externalProductId: ext,
      checkoutUrl: link(),
    });
    expect(reuse.status).toBe(200);
  }, 90_000);
});

describe('10.1 the boundaries and the precision of the pair (EP-02, EP-03, EP-04)', () => {
  it('EP-02: a 128-character id and a 2048-character https link are accepted, one more is refused, other schemes are link_invalid', async () => {
    const admin = await person('lab', 'admin_tenant');
    const eventId = await labEvent('bounds');
    const longId = `${PREFIX}-${crypto.randomUUID().replaceAll('-', '')}`.padEnd(128, 'x');
    expect(longId).toHaveLength(128);
    const prefix = 'https://pay.example.com/';
    const longLink = prefix + 'a'.repeat(2048 - prefix.length);
    expect(longLink).toHaveLength(2048);

    const ok = await call(admin, 'PUT', `/event-products/${eventId}`, {
      externalProductId: longId,
      checkoutUrl: longLink,
    });
    expect(ok.status, ok.raw.slice(0, 200)).toBe(200);
    expect(await mappingRow(eventId)).toMatchObject({
      external_product_id: longId,
      checkout_url: longLink,
    });

    const refused = async (body: Record<string, unknown>, code: string) => {
      const res = await call(admin, 'PUT', `/event-products/${eventId}`, body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(paymentsIssue(res)).toBe(code);
    };
    await refused({ externalProductId: `${longId}x`, checkoutUrl: link() }, 'product_id_too_long');
    await refused(
      { externalProductId: productId('b'), checkoutUrl: `${longLink}a` },
      'link_invalid',
    );
    for (const bad of [
      'http://pay.example.com/a',
      'javascript:alert(1)',
      'pay.example.com/a',
      'ftp://pay.example.com/a',
      'https://user:pw@pay.example.com/a',
    ]) {
      await refused({ externalProductId: productId('b'), checkoutUrl: bad }, 'link_invalid');
    }
    expect(await mappingRow(eventId)).toMatchObject({ external_product_id: longId });
  }, 60_000);

  it('EP-03: the pair round-trips byte for byte (trim only), whatever characters the product id holds', async () => {
    const admin = await person('lab', 'admin_tenant');
    const eventId = await labEvent('precision');
    const ext = `${PREFIX}-Ab_9.${crypto.randomUUID().slice(0, 6)}`;
    const url = `${link('p')}?a=1&b=2#frag`;
    const saved = await call(admin, 'PUT', `/event-products/${eventId}`, {
      externalProductId: `  ${ext}  `,
      checkoutUrl: `  ${url}  `,
    });
    expect(saved.json).toMatchObject({ externalProductId: ext, checkoutUrl: url });
    const read = await call(admin, 'GET', `/event-products/${eventId}`);
    expect(read.json.mapping).toEqual({ externalProductId: ext, checkoutUrl: url });
    // Case counts: another event cannot take the same id in a different case as a clash, it is another id.
    const other = await labEvent('precision-case');
    const upper = await call(admin, 'PUT', `/event-products/${other}`, {
      externalProductId: ext.toUpperCase(),
      checkoutUrl: link(),
    });
    expect(upper.status).toBe(200);
  }, 60_000);

  it('EP-04: the same PUT twice leaves updated_at unchanged the second time; a changed pair moves it', async () => {
    const admin = await person('lab', 'admin_tenant');
    const eventId = await labEvent('idem');
    const body = { externalProductId: productId('i'), checkoutUrl: link('i') };
    const first = await call(admin, 'PUT', `/event-products/${eventId}`, body);
    expect(first.status).toBe(200);
    const row1 = await mappingRow(eventId);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const second = await call(admin, 'PUT', `/event-products/${eventId}`, body);
    expect(second.json).toEqual(first.json);
    const row2 = await mappingRow(eventId);
    expect(row2?.updated_at).toEqual(row1?.updated_at);

    const next = { externalProductId: body.externalProductId, checkoutUrl: link('j') };
    expect((await call(admin, 'PUT', `/event-products/${eventId}`, next)).status).toBe(200);
    const row3 = await mappingRow(eventId);
    expect(row3?.checkout_url).toBe(link('j'));
    expect(row3?.updated_at.getTime()).toBeGreaterThan(row1?.updated_at.getTime() ?? 0);

    // Replacing the product id retires the old route and reserves the new one.
    const swapped = productId('i2');
    await call(admin, 'PUT', `/event-products/${eventId}`, {
      externalProductId: swapped,
      checkoutUrl: link('j'),
    });
    expect(await routeCount(body.externalProductId)).toBe(0);
    expect(await routeCount(swapped)).toBe(1);
  }, 60_000);
});

describe('10.1 the races (EP-05, EP-10, T-10.1-02, T-10.1-15)', () => {
  it('EP-05: two parallel PUTs with ONE product id for two events end with one success, one gateway_product_taken and one route', async () => {
    const admin = await person('lab', 'admin_tenant');
    for (let i = 0; i < 8; i += 1) {
      const a = await labEvent(`race-a-${i}`);
      const b = await labEvent(`race-b-${i}`);
      const ext = productId(`race${i}`);
      const [ra, rb] = await Promise.all([
        call(admin, 'PUT', `/event-products/${a}`, { externalProductId: ext, checkoutUrl: link() }),
        call(admin, 'PUT', `/event-products/${b}`, { externalProductId: ext, checkoutUrl: link() }),
      ]);
      expect([ra.status, rb.status].sort(), `iteration ${i}`).toEqual([200, 409]);
      const loser = ra.status === 409 ? ra : rb;
      expect(paymentsIssue(loser)).toBe('gateway_product_taken');
      const rows = await adminSql<{ event_id: string }[]>`
        select event_id::text as event_id from public.payment_products
         where kind = 'event' and external_product_id = ${ext}`;
      expect(rows, `iteration ${i}`).toHaveLength(1);
      expect(rows[0]?.event_id).toBe(ra.status === 200 ? a : b);
      // The winner's route survives the loser's compensation: a webhook for it still finds its tenant.
      expect(await routeCount(ext), `iteration ${i}`).toBe(1);
    }
  }, 120_000);

  it('EP-10: a removal racing a sale never ends with the mapping gone and a ticket present (twenty iterations)', async () => {
    const admin = await person('lab', 'admin_tenant');
    const buyer = await person('lab', 'member');
    const membershipId = await membershipOf(buyer);
    const outcomes = { removedThenNotMapped: 0, soldThenLocked: 0 };
    for (let i = 0; i < 20; i += 1) {
      const eventId = await labEvent(`race10-${i}`);
      const ext = productId(`r10-${i}`);
      const put = await call(admin, 'PUT', `/event-products/${eventId}`, {
        externalProductId: ext,
        checkoutUrl: link(),
      });
      expect(put.status).toBe(200);
      const jitter = (i % 5) * 4;
      const [removal, grant] = await Promise.all([
        (async () => {
          if (i % 2 === 1) await new Promise((resolve) => setTimeout(resolve, jitter));
          return call(admin, 'DELETE', `/event-products/${eventId}`);
        })(),
        (async () => {
          if (i % 2 === 0) await new Promise((resolve) => setTimeout(resolve, jitter));
          return grantTicket(eventId, membershipId, `${PREFIX}-r10-${i}-${crypto.randomUUID()}`);
        })(),
      ]);
      const mapping = await mappingRow(eventId);
      const tickets = (await presences(eventId)).filter((row) => row.origin === 'ticket');
      // The forbidden end state: no mapping and a paid presence.
      expect(mapping === null && tickets.length > 0, `iteration ${i}`).toBe(false);
      if (removal.status === 200) {
        expect(grant, `iteration ${i}`).toBe('not_mapped');
        expect(mapping).toBeNull();
        expect(tickets).toHaveLength(0);
        outcomes.removedThenNotMapped += 1;
      } else {
        expect(removal.status, `iteration ${i}`).toBe(409);
        expect(paymentsIssue(removal)).toBe('ticket_locked');
        expect(grant, `iteration ${i}`).toBe('granted');
        expect(mapping).not.toBeNull();
        expect(tickets).toHaveLength(1);
        outcomes.soldThenLocked += 1;
      }
    }
    expect(outcomes.removedThenNotMapped + outcomes.soldThenLocked).toBe(20);
  }, 180_000);
});
