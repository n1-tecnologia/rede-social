import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import type { PaymentsPurchaseConfirmed } from '@rede-social/contracts/payments';
import { subscribe } from '@rede-social/core/server/events/bus';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  attendancesOf,
  deliver,
  deliverAndApply,
  eventRow,
  freshEmail,
  type Person,
  personWithEmail,
  removeTicketEvents,
  runApply,
  ticketDelivery,
  ticketEvent,
  ticketMapping,
} from './payments-apply-fixtures';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  removePaymentIntegrations,
  removePaymentMappings,
  runNotificationJobs,
  type SeededPaymentIntegration,
  seedPaymentIntegration,
  seedPaymentMapping,
  setPaymentsRow,
  signInAs,
  withStoreEnabled,
} from './setup';

/**
 * 09.1-10 (D-490, D-503; PAY-21, PAY-29) against the live local stack: the Eventos list and "Liberar
 * manualmente", read and written through the REAL routes. Deliveries go through the real signed webhook and
 * the real apply job, so the states the list shows are the states a gateway really produced.
 *
 * `09.1 events` covers the list (what it shows, what it never shows, the 50-row total order, tenant
 * adjacency, the empty and null shapes) and the manual release of a store product to an event that was
 * waiting for an account (once, idempotently, under a race with the webhook apply).
 *
 * Every identity carries a prefix (swept in `afterAll`); the integration, its events and its mappings go
 * with `removePaymentIntegrations` / `removePaymentMappings`. Test ORDER is load-bearing.
 */

const PREFIX = 'payev';
const NAME = `${PREFIX}-store`;
let labTenantId = '';
let demoTenantId = '';
let labAdminUserId = '';
let admin: Person;
let supportUser: Person;
let integration: SeededPaymentIntegration;
let storeProduct = '';
let restoreStore: () => Promise<void> = async () => {};
let restorePayments: () => Promise<void> = async () => {};
const purchases: PaymentsPurchaseConfirmed[] = [];
let unsubscribe: () => void = () => {};

type Json = Record<string, unknown>;
type EventItem = {
  id: string;
  type: string;
  state: string;
  email: string | null;
  productName: string | null;
  externalProductId: string | null;
  outcome: string | null;
  receivedAt: string;
};

const EVENT_KEYS = [
  'email',
  'externalProductId',
  'id',
  'outcome',
  'productName',
  'receivedAt',
  'state',
  'type',
];

async function call(
  who: Person | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Json; raw: string }> {
  const res = await api.request(`/v1/payments${path}`, {
    method,
    headers: {
      [TENANT_HOST_HEADER]: HOSTS.lab,
      ...(who ? { authorization: `Bearer ${who.token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await res.text();
  let json: Json = {};
  try {
    json = raw ? (JSON.parse(raw) as Json) : {};
  } catch {
    // A non-JSON body: the status still tells.
  }
  return { status: res.status, json, raw };
}

const listEvents = async () => {
  const res = await call(admin, 'GET', '/events');
  expect(res.status, 'GET /events').toBe(200);
  return { ...(res.json as { items: EventItem[]; serverNow: string }), raw: res.raw };
};

const grant = (eventId: string, who: Person | null = admin) =>
  call(who, 'POST', `/events/${eventId}/grant`);

const codeOf = (res: { json: Json }) =>
  ((res.json as { error?: { code?: string; details?: { payments?: string } } }).error ?? {}) as {
    code?: string;
    details?: { payments?: string };
  };

const entitlements = (userId: string, productId = storeProduct) =>
  adminSql<{ source: string; status: string; order_id: string | null }[]>`
    select source, status, order_id::text as order_id from public.store_entitlements
     where user_id = ${userId}::uuid and product_id = ${productId}::uuid order by created_at, id`;

const orders = async (userId: string): Promise<number> => {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.store_orders where user_id = ${userId}::uuid`;
  return row?.n ?? -1;
};

const rowFacts = (eventId: string) =>
  adminSql`
    select state, outcome, applied_at, mapping_id::text as mapping_id from public.payment_events
     where id = ${eventId}::uuid`;

const saleBody = (
  type: string,
  fields: { ref: string; productId: string; email?: string } & Json,
): Json => {
  const { ref, productId, email, ...rest } = fields;
  return {
    type,
    externalRef: ref,
    productId,
    ...(email === undefined ? {} : { email }),
    amountCents: 12_345,
    currency: 'BRL',
    recurring: false,
    ...rest,
  };
};

async function insertEvents(
  tenantId: string,
  integrationId: string,
  rows: {
    at: string;
    email?: string | null;
    state?: string;
    outcome?: string | null;
    type?: string;
  }[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const row of rows) {
    const [inserted] = await adminSql<{ id: string }[]>`
      insert into public.payment_events
             (tenant_id, integration_id, provider, dedupe_key, type, effect, email, state, outcome,
              received_at)
      values (${tenantId}::uuid, ${integrationId}::uuid, 'fake', ${crypto.randomUUID()},
              ${row.type ?? 'cart_abandoned'}, 'none', ${row.email ?? null},
              ${row.state ?? 'ignored'}, ${row.outcome === undefined ? 'no_effect' : row.outcome},
              ${row.at}::timestamptz)
      returning id::text as id`;
    if (inserted) ids.push(inserted.id);
  }
  return ids;
}

async function sweepStore(): Promise<void> {
  const products = adminSql`select id from public.store_products where name like ${`${NAME}%`}`;
  await adminSql`delete from public.store_entitlements where product_id in (${products})`;
  await adminSql`delete from public.store_orders where product_id in (${products})`;
  await removePaymentMappings(labTenantId);
  await removePaymentMappings(demoTenantId);
  await adminSql`delete from public.store_products where name like ${`${NAME}%`}`;
}

async function sweep(): Promise<void> {
  await removePaymentIntegrations(labTenantId);
  await removePaymentIntegrations(demoTenantId);
  await sweepStore();
  await removeIdentitiesByPrefix(PREFIX);
}

beforeAll(async () => {
  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id::text as id, slug from public.tenants where slug in ('rede-lab', 'rede-demo')`;
  labTenantId = rows.find((row) => row.slug === 'rede-lab')?.id ?? '';
  demoTenantId = rows.find((row) => row.slug === 'rede-demo')?.id ?? '';
  if (!labTenantId || !demoTenantId) throw new Error('seed tenants missing: run pnpm db:seed');
  await sweep();

  // payments ON (gate untouched: the lists do not need it), store ON for the grant.
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
  restoreStore = await withStoreEnabled('lab');

  const adminIdentity = await createSharedIdentity({
    prefix: PREFIX,
    memberships: [{ host: 'lab', role: 'admin_tenant' }],
  });
  labAdminUserId = adminIdentity.userId;
  admin = {
    userId: adminIdentity.userId,
    membershipId: '',
    email: adminIdentity.email,
    token: await signInAs(adminIdentity.email, adminIdentity.password),
  };
  const supportIdentity = await createSharedIdentity({
    prefix: PREFIX,
    memberships: [{ host: 'lab', role: 'support_tenant' }],
  });
  supportUser = {
    userId: supportIdentity.userId,
    membershipId: '',
    email: supportIdentity.email,
    token: await signInAs(supportIdentity.email, supportIdentity.password),
  };
  const [product] = await adminSql<{ id: string }[]>`
    insert into public.store_products (tenant_id, created_by_user_id, name, price_cents, status)
    values (${labTenantId}::uuid, ${labAdminUserId}::uuid, ${`${NAME} curso`}, 99900, 'active')
    returning id::text as id`;
  storeProduct = product?.id ?? '';
  unsubscribe = subscribe('payments.purchase_confirmed', async (payload) => {
    purchases.push(payload);
  });
}, 60_000);

afterAll(async () => {
  unsubscribe();
  await sweep();
  await restoreStore();
  await restorePayments();
  await stopBoss();
}, 60_000);

describe('09.1 events', () => {
  it('lists applied, no-account, unknown-product and ignored rows from real deliveries with the neutral state, the product name through the seam, no payload, and nothing still transient', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const accessId = `acc-${crypto.randomUUID()}`;
    await seedPaymentMapping(labTenantId, {
      kind: 'access',
      name: 'Plano',
      externalProductId: accessId,
    });
    const storeId = `sp-${crypto.randomUUID()}`;
    await seedPaymentMapping(labTenantId, {
      kind: 'store_product',
      targetId: storeProduct,
      externalProductId: storeId,
    });
    const ghostId = `ghost-${crypto.randomUUID()}`;
    const buyerAccess = freshEmail(PREFIX, 'ana');
    const buyerStore = freshEmail(PREFIX, 'noacct');

    const applied = await deliverAndApply(
      integration,
      saleBody('purchase_approved', {
        ref: `r-${crypto.randomUUID()}`,
        productId: accessId,
        email: buyerAccess,
      }),
    );
    const waiting = await deliverAndApply(
      integration,
      saleBody('purchase_approved', {
        ref: `r-${crypto.randomUUID()}`,
        productId: storeId,
        email: buyerStore,
      }),
    );
    const unknown = await deliverAndApply(
      integration,
      saleBody('purchase_approved', {
        ref: `r-${crypto.randomUUID()}`,
        productId: ghostId,
        email: buyerStore,
      }),
    );
    const ignored = await deliverAndApply(
      integration,
      saleBody('cart_abandoned', {
        ref: `r-${crypto.randomUUID()}`,
        productId: accessId,
        email: buyerAccess,
      }),
    );
    const noEmail = await deliverAndApply(
      integration,
      saleBody('purchase_approved', { ref: `r-${crypto.randomUUID()}`, productId: accessId }),
    );
    expect(applied.state).toBe('applied');
    expect(waiting.state).toBe('no_membership');
    expect(unknown.state).toBe('unknown_product');
    expect(ignored.state).toBe('ignored');
    expect(noEmail.state).toBe('ignored');
    // Still `received` (the job has not run) and `failed` are operational, never listed.
    const transient = await deliver(
      integration,
      saleBody('purchase_approved', {
        ref: `r-${crypto.randomUUID()}`,
        productId: accessId,
        email: buyerAccess,
      }),
    );
    const failed = await deliver(
      integration,
      saleBody('purchase_approved', {
        ref: `r-${crypto.randomUUID()}`,
        productId: accessId,
        email: buyerAccess,
      }),
    );
    await adminSql`update public.payment_events set state = 'failed' where id = ${failed}::uuid`;

    const { items, raw, serverNow } = await listEvents();
    expect(typeof serverNow).toBe('string');
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.has(transient)).toBe(false);
    expect(byId.has(failed)).toBe(false);

    expect(byId.get(applied.id)).toMatchObject({
      type: 'purchase_approved',
      state: 'applied',
      email: buyerAccess,
      productName: 'Plano',
      externalProductId: accessId,
      outcome: 'access_granted',
    });
    expect(byId.get(waiting.id)).toMatchObject({
      state: 'no_account',
      email: buyerStore,
      productName: `${NAME} curso`,
      externalProductId: storeId,
      outcome: null,
    });
    expect(byId.get(unknown.id)).toMatchObject({
      state: 'unknown_product',
      productName: null,
      externalProductId: ghostId,
    });
    expect(byId.get(ignored.id)?.state).toBe('ignored');
    expect(byId.get(noEmail.id)).toMatchObject({ state: 'ignored', email: null });

    // The select list IS the contract: the exact key set, no payload, no header, no gateway message.
    for (const item of items) expect(Object.keys(item).sort()).toEqual(EVENT_KEYS);
    expect(raw).not.toMatch(/REF-\d+-\d+/);
    expect(raw).not.toContain('amountCents');
    expect(raw).not.toContain('signature');
    expect(raw).not.toContain(integration.token);

    // Newest first by (received_at desc, id desc).
    const sorted = [...items].sort((a, b) =>
      a.receivedAt === b.receivedAt ? (a.id < b.id ? 1 : -1) : a.receivedAt < b.receivedAt ? 1 : -1,
    );
    expect(items.map((item) => item.id)).toEqual(sorted.map((item) => item.id));
  }, 60_000);

  it('P46 adjacency: an access event and a store event for one e-mail are two rows, and identical-looking events of the other tenant never appear', async () => {
    await removePaymentIntegrations(labTenantId);
    await removePaymentMappings(labTenantId);
    integration = await seedPaymentIntegration(labTenantId);
    const demoIntegration = await seedPaymentIntegration(demoTenantId);
    const same = freshEmail(PREFIX, 'twin');
    const accessId = `acc-${crypto.randomUUID()}`;
    const storeId = `sp-${crypto.randomUUID()}`;
    await seedPaymentMapping(labTenantId, {
      kind: 'access',
      name: 'Plano',
      externalProductId: accessId,
    });
    await seedPaymentMapping(labTenantId, {
      kind: 'store_product',
      targetId: storeProduct,
      externalProductId: storeId,
    });
    const a = await deliverAndApply(
      integration,
      saleBody('purchase_approved', {
        ref: `r-${crypto.randomUUID()}`,
        productId: accessId,
        email: same,
      }),
    );
    const b = await deliverAndApply(
      integration,
      saleBody('purchase_approved', {
        ref: `r-${crypto.randomUUID()}`,
        productId: storeId,
        email: same,
      }),
    );
    // The demo tenant holds events that look exactly alike (same e-mail, type, state, instant).
    const [demoOne, demoTwo] = await insertEvents(demoTenantId, demoIntegration.id, [
      {
        at: '2026-10-21T01:00:00Z',
        email: same,
        state: 'applied',
        outcome: 'access_granted',
        type: 'purchase_approved',
      },
      {
        at: '2026-10-21T01:00:00Z',
        email: same,
        state: 'no_membership',
        outcome: null,
        type: 'purchase_approved',
      },
    ]);
    const { items, raw } = await listEvents();
    const ids = items.map((item) => item.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(items.filter((item) => item.email === same)).toHaveLength(2);
    expect(ids).not.toContain(demoOne);
    expect(ids).not.toContain(demoTwo);
    expect(raw).not.toContain(demoOne ?? '');
  }, 60_000);

  it('P47 empty: a tenant with no events answers an empty list with the server clock', async () => {
    await removePaymentIntegrations(labTenantId);
    const { items, serverNow } = await listEvents();
    expect(items).toEqual([]);
    expect(typeof serverNow).toBe('string');
  });

  it('P48 ordering: the list is exactly the 50 newest by (received_at desc, id desc), tie-broken by id, and a newer event pushes the oldest out', async () => {
    await removePaymentIntegrations(labTenantId);
    integration = await seedPaymentIntegration(labTenantId);
    const rows = Array.from({ length: 55 }, (_, i) => ({
      // Five groups of equal instants force the id tie-break; the rest are distinct.
      at: new Date(Date.UTC(2026, 0, 1, 0, 0, Math.floor(i / (i < 25 ? 5 : 1)))).toISOString(),
    }));
    await insertEvents(labTenantId, integration.id, rows);
    const expected = await adminSql<{ id: string }[]>`
      select id::text as id from public.payment_events
       where tenant_id = ${labTenantId}::uuid and state in ('applied','no_membership','unknown_product','ignored')
       order by received_at desc, id desc limit 50`;
    const first = await listEvents();
    expect(first.items).toHaveLength(50);
    expect(first.items.map((item) => item.id)).toEqual(expected.map((row) => row.id));
    const oldest = first.items[49]?.id;

    await insertEvents(labTenantId, integration.id, [{ at: '2026-06-01T00:00:00Z' }]);
    const second = await listEvents();
    expect(second.items).toHaveLength(50);
    expect(second.items.map((item) => item.id)).not.toContain(oldest);
    expect(second.items[0]?.receivedAt.startsWith('2026-06-01')).toBe(true);
  }, 60_000);

  it('authorisation: a support_tenant is 403 and no token is 401 on both routes', async () => {
    for (const [method, path] of [
      ['GET', '/events'],
      ['POST', `/events/${crypto.randomUUID()}/grant`],
    ] as const) {
      expect((await call(supportUser, method, path)).status, `${method} ${path}`).toBe(403);
      expect((await call(null, method, path)).status, `${method} ${path}`).toBe(401);
    }
  });
});

describe('09.1 events: Liberar manualmente', () => {
  /** An event waiting for an account: a store purchase delivered while the e-mail has none. */
  async function waitingEvent(email: string): Promise<string> {
    const row = await deliverAndApply(
      integration,
      saleBody('purchase_approved', {
        ref: `r-${crypto.randomUUID()}`,
        productId: storeGatewayId,
        email,
      }),
    );
    expect(row.state).toBe('no_membership');
    return row.id;
  }
  let storeGatewayId = '';

  beforeAll(async () => {
    await removePaymentIntegrations(labTenantId);
    await removePaymentMappings(labTenantId);
    integration = await seedPaymentIntegration(labTenantId);
    storeGatewayId = `sp-${crypto.randomUUID()}`;
    await seedPaymentMapping(labTenantId, {
      kind: 'store_product',
      targetId: storeProduct,
      externalProductId: storeGatewayId,
    });
  });

  it('a no-account store event, then the account, then grant: applied, one grant entitlement with no order, no confirmation event and no revenue; a second grant returns the same row (P49)', async () => {
    purchases.length = 0;
    const email = freshEmail(PREFIX, 'late');
    const eventId = await waitingEvent(email);

    // No account yet: 409 no_membership and the row is untouched.
    const before = await rowFacts(eventId);
    const early = await grant(eventId);
    expect(early.status).toBe(409);
    expect(codeOf(early)).toMatchObject({
      code: 'CONFLICT',
      details: { payments: 'no_membership' },
    });
    expect(await rowFacts(eventId)).toEqual(before);

    const buyer = await personWithEmail(email, 'lab');
    const first = await grant(eventId);
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({
      id: eventId,
      state: 'applied',
      outcome: 'product_granted',
      email,
    });
    expect(Object.keys(first.json).sort()).toEqual(EVENT_KEYS);
    expect(await entitlements(buyer.userId)).toEqual([
      { source: 'grant', status: 'active', order_id: null },
    ]);
    expect(await orders(buyer.userId)).toBe(0);
    expect(purchases).toEqual([]);
    expect((await eventRow(eventId)).applied_at).not.toBeNull();

    const second = await grant(eventId);
    expect(second.status).toBe(200);
    expect(second.json).toMatchObject({
      id: eventId,
      state: 'applied',
      outcome: 'product_granted',
    });
    expect(await entitlements(buyer.userId)).toHaveLength(1);
    // The listing reads it as applied now.
    const item = (await listEvents()).items.find((candidate) => candidate.id === eventId);
    expect(item).toMatchObject({ state: 'applied', productName: `${NAME} curso` });
  }, 60_000);

  it('an event in any other state is 409 not_grantable, a non-uuid and another tenant event are the bare 404', async () => {
    const accessId = `acc-${crypto.randomUUID()}`;
    await seedPaymentMapping(labTenantId, {
      kind: 'access',
      name: 'Plano',
      externalProductId: accessId,
    });
    const person = freshEmail(PREFIX, 'other');
    const appliedAccess = await deliverAndApply(
      integration,
      saleBody('purchase_approved', {
        ref: `r-${crypto.randomUUID()}`,
        productId: accessId,
        email: person,
      }),
    );
    const unknown = await deliverAndApply(
      integration,
      saleBody('purchase_approved', {
        ref: `r-${crypto.randomUUID()}`,
        productId: `ghost-${crypto.randomUUID()}`,
        email: person,
      }),
    );
    const ignored = await deliverAndApply(
      integration,
      saleBody('cart_abandoned', {
        ref: `r-${crypto.randomUUID()}`,
        productId: storeGatewayId,
        email: person,
      }),
    );
    for (const row of [appliedAccess, unknown, ignored]) {
      const res = await grant(row.id);
      expect(res.status, row.state).toBe(409);
      expect(codeOf(res)).toMatchObject({
        code: 'CONFLICT',
        details: { payments: 'not_grantable' },
      });
    }
    // A waiting event whose mapping is an access product (not a store product) is not grantable either.
    const [accessWaiting] = await insertEvents(labTenantId, integration.id, [
      {
        at: '2026-10-21T02:00:00Z',
        email: person,
        state: 'no_membership',
        outcome: null,
        type: 'purchase_approved',
      },
    ]);
    await adminSql`
      update public.payment_events set mapping_id = (
        select id from public.payment_products where tenant_id = ${labTenantId}::uuid and kind = 'access' limit 1)
       where id = ${accessWaiting ?? ''}::uuid`;
    const wrongKind = await grant(accessWaiting ?? '');
    expect(wrongKind.status).toBe(409);
    expect(codeOf(wrongKind).details?.payments).toBe('not_grantable');

    // A non-uuid id and an unknown id: the bare 404.
    for (const id of ['not-a-uuid', crypto.randomUUID()]) {
      const res = await grant(id);
      expect(res.status, id).toBe(404);
      expect(codeOf(res).code).toBe('NOT_FOUND');
      expect(res.json.error).not.toHaveProperty('details');
    }

    // Another tenant's waiting event: the bare 404, no entitlement, the row untouched.
    await removePaymentIntegrations(demoTenantId);
    const demoIntegration = await seedPaymentIntegration(demoTenantId);
    const [foreign] = await insertEvents(demoTenantId, demoIntegration.id, [
      {
        at: '2026-10-21T03:00:00Z',
        email: person,
        state: 'no_membership',
        outcome: null,
        type: 'purchase_approved',
      },
    ]);
    const before = await rowFacts(foreign ?? '');
    const refused = await grant(foreign ?? '');
    expect(refused.status).toBe(404);
    expect(codeOf(refused).code).toBe('NOT_FOUND');
    expect(await rowFacts(foreign ?? '')).toEqual(before);
  }, 60_000);

  it('a member who already holds the product is applied with no_effect and gets no second entitlement', async () => {
    const email = freshEmail(PREFIX, 'holder');
    const eventId = await waitingEvent(email);
    const holder = await personWithEmail(email, 'lab');
    // The member already owns the product by an earlier grant.
    const [membership] = await adminSql<{ id: string }[]>`
      select id::text as id from public.memberships
       where user_id = ${holder.userId}::uuid and tenant_id = ${labTenantId}::uuid`;
    await adminSql`
      insert into public.store_entitlements (tenant_id, user_id, product_id, source, granted_by_user_id)
      values (${labTenantId}::uuid, ${holder.userId}::uuid, ${storeProduct}::uuid, 'grant', ${labAdminUserId}::uuid)`;
    expect(membership?.id).toBeTruthy();
    const res = await grant(eventId);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ id: eventId, state: 'applied', outcome: 'no_effect' });
    expect(await entitlements(holder.userId)).toHaveLength(1);
  }, 60_000);

  it('P50 concurrency: two simultaneous grants, and a grant racing the webhook apply of a fresh delivery, end with ONE active entitlement, a consistent event row and no 5xx', async () => {
    // (a) two simultaneous grants of one event
    const emailA = freshEmail(PREFIX, 'race-a');
    const eventA = await waitingEvent(emailA);
    const personA = await personWithEmail(emailA, 'lab');
    const pair = await Promise.all([grant(eventA), grant(eventA)]);
    expect(pair.map((res) => res.status)).toEqual([200, 200]);
    expect(await entitlements(personA.userId)).toHaveLength(1);
    const settled = await eventRow(eventA);
    expect(settled.state).toBe('applied');
    expect(['product_granted', 'no_effect']).toContain(settled.outcome);

    // (b) a grant racing the apply job of a fresh delivery for the same member and product
    const emailB = freshEmail(PREFIX, 'race-b');
    const eventB = await waitingEvent(emailB);
    const personB = await personWithEmail(emailB, 'lab');
    const fresh = await deliver(
      integration,
      saleBody('purchase_approved', {
        ref: `r-${crypto.randomUUID()}`,
        productId: storeGatewayId,
        email: emailB,
      }),
    );
    const [raced] = await Promise.all([grant(eventB), runApply(fresh)]);
    expect(raced.status).toBeLessThan(500);
    expect(raced.status).toBe(200);
    const active = (await entitlements(personB.userId)).filter((row) => row.status === 'active');
    expect(active).toHaveLength(1);
    expect((await eventRow(eventB)).state).toBe('applied');
    expect((await eventRow(fresh)).state).toBe('applied');
  }, 60_000);
});

/* ── 10.1-05: paid-event deliveries in the list and in "Liberar manualmente" (D-749, D-758, D-759, TICK-19) ── */

describe('10.1 events: paid-event deliveries', () => {
  const TITLE = `${PREFIX}-evento`;
  const TICKET_KEYS = [...EVENT_KEYS, 'eventTitle', 'kind'].sort();
  let restoreNotifications: () => Promise<void> = async () => {};

  type TicketItem = EventItem & { kind?: string | null; eventTitle?: string | null };

  async function enableNotifications(tenantId: string): Promise<() => Promise<void>> {
    const [previous] = await adminSql<{ enabled: boolean }[]>`
      select enabled from public.tenant_modules
       where tenant_id = ${tenantId}::uuid and module_key = 'notifications'`;
    await adminSql`
      insert into public.tenant_modules (tenant_id, module_key, enabled)
      values (${tenantId}::uuid, 'notifications', true)
      on conflict (tenant_id, module_key) do update set enabled = true, updated_at = now()`;
    moduleFlags.invalidate(tenantId);
    return async () => {
      if (previous) {
        await adminSql`
          update public.tenant_modules set enabled = ${previous.enabled}, updated_at = now()
           where tenant_id = ${tenantId}::uuid and module_key = 'notifications'`;
      } else {
        await adminSql`
          delete from public.tenant_modules
           where tenant_id = ${tenantId}::uuid and module_key = 'notifications'`;
      }
      moduleFlags.invalidate(tenantId);
    };
  }

  /** A paid event of the lab tenant with its mapping and a fresh integration. */
  async function paid(options: Parameters<typeof ticketEvent>[1]) {
    await removePaymentIntegrations(labTenantId);
    await removePaymentMappings(labTenantId);
    await removeTicketEvents(TITLE);
    integration = await seedPaymentIntegration(labTenantId);
    const eventId = await ticketEvent(labTenantId, options);
    const mapping = await ticketMapping(labTenantId, eventId);
    return { eventId, productId: mapping.externalProductId };
  }

  const ref = () => `ord-${crypto.randomUUID()}`;
  const approved = (productId: string, email: string, orderRef = ref()) =>
    ticketDelivery('purchase_approved', { ref: orderRef, productId, email });

  const noticesOf = (userId: string) =>
    adminSql<{ payload: Json }[]>`
      select payload from public.notifications
       where user_id = ${userId}::uuid and kind = 'payments.ticket_confirmed'`;

  beforeAll(async () => {
    restoreNotifications = await enableNotifications(labTenantId);
  }, 60_000);

  afterAll(async () => {
    await removePaymentIntegrations(labTenantId);
    await removePaymentMappings(labTenantId);
    await removeTicketEvents(TITLE);
    await restoreNotifications();
  }, 60_000);

  it('a ticket delivery lists with its kind, the event title as the product line and the neutral type; a store or access item keeps its exact shape (EP-32)', async () => {
    const ev = await paid({ title: `${TITLE}-lista` });
    const buyer = await personWithEmail(freshEmail(PREFIX, 'listed'), 'lab');
    // before any ticket delivery: an ignored row lists with exactly the old key set
    await insertEvents(labTenantId, integration.id, [{ at: '2026-01-01T00:00:00Z' }]);
    const before = await listEvents();
    expect(before.items.length).toBeGreaterThan(0);
    for (const item of before.items) expect(Object.keys(item).sort()).toEqual(EVENT_KEYS);

    const granted = await deliverAndApply(integration, approved(ev.productId, buyer.email));
    expect(granted).toMatchObject({ state: 'applied', outcome: 'ticket_granted' });
    const { items, raw } = await listEvents();
    const item = items.find((entry) => entry.id === granted.id) as TicketItem;
    expect(item).toMatchObject({
      type: 'purchase_approved',
      state: 'applied',
      email: buyer.email,
      productName: `${TITLE}-lista`,
      kind: 'event',
      eventTitle: `${TITLE}-lista`,
      outcome: 'ticket_granted',
    });
    expect(Object.keys(item).sort()).toEqual(TICKET_KEYS);
    // the old rows still list with the old shape, and no order reference or amount leaks
    for (const other of items.filter((entry) => entry.id !== granted.id)) {
      expect(Object.keys(other).sort()).toEqual(EVENT_KEYS);
    }
    expect(raw).not.toContain('amountCents');
    expect(raw).not.toMatch(/ord-[0-9a-f]{8}/);
  }, 60_000);

  it('a delivery whose event was deleted lists with a null title and kind event (EP-32)', async () => {
    const ev = await paid({ title: `${TITLE}-apagado` });
    const buyer = await personWithEmail(freshEmail(PREFIX, 'gone'), 'lab');
    const granted = await deliverAndApply(integration, approved(ev.productId, buyer.email));
    await adminSql`update public.events set deleted_at = now() where id = ${ev.eventId}::uuid`;
    const { items } = await listEvents();
    const item = items.find((entry) => entry.id === granted.id) as TicketItem;
    expect(item).toMatchObject({ kind: 'event', eventTitle: null, productName: null });
  }, 60_000);

  it('a payment for an ended or a cancelled event lists as event_ended or event_cancelled (D-758)', async () => {
    const ended = await paid({ title: `${TITLE}-fim`, startsInMinutes: -240, endsInMinutes: -60 });
    const buyer = await personWithEmail(freshEmail(PREFIX, 'closed'), 'lab');
    const late = await deliverAndApply(integration, approved(ended.productId, buyer.email));
    expect(late).toMatchObject({ state: 'ignored', outcome: 'event_ended' });

    const cancelledEvent = await ticketEvent(labTenantId, {
      title: `${TITLE}-cancelado`,
      status: 'cancelled',
    });
    const cancelledMapping = await ticketMapping(labTenantId, cancelledEvent);
    const cancelled = await deliverAndApply(
      integration,
      approved(cancelledMapping.externalProductId, buyer.email),
    );
    expect(cancelled).toMatchObject({ state: 'ignored', outcome: 'event_cancelled' });

    const { items } = await listEvents();
    expect(items.find((entry) => entry.id === late.id)).toMatchObject({
      state: 'event_ended',
      outcome: 'event_ended',
      kind: 'event',
    });
    expect(items.find((entry) => entry.id === cancelled.id)).toMatchObject({
      state: 'event_cancelled',
      outcome: 'event_cancelled',
      kind: 'event',
    });
  }, 60_000);

  it('EP-31: two ticket deliveries received at the same instant list in id-descending order, every time', async () => {
    const ev = await paid({ title: `${TITLE}-empate` });
    const one = await personWithEmail(freshEmail(PREFIX, 'tie1'), 'lab');
    const two = await personWithEmail(freshEmail(PREFIX, 'tie2'), 'lab');
    const a = await deliverAndApply(integration, approved(ev.productId, one.email));
    const b = await deliverAndApply(integration, approved(ev.productId, two.email));
    await adminSql`
      update public.payment_events set received_at = '2026-07-01T00:00:00Z'
       where id in (${a.id}::uuid, ${b.id}::uuid)`;
    const expected = [a.id, b.id].sort().reverse();
    for (let round = 0; round < 3; round += 1) {
      const { items } = await listEvents();
      expect(items.map((item) => item.id).filter((id) => expected.includes(id))).toEqual(expected);
    }
  }, 60_000);

  it('EP-33: ticket, access and store deliveries interleave by received time inside the unchanged 50-row cap', async () => {
    const ev = await paid({ title: `${TITLE}-misto` });
    const accessId = `acc-${crypto.randomUUID()}`;
    await seedPaymentMapping(labTenantId, {
      kind: 'access',
      name: 'Plano',
      externalProductId: accessId,
    });
    const storeId = `sp-${crypto.randomUUID()}`;
    await seedPaymentMapping(labTenantId, {
      kind: 'store_product',
      targetId: storeProduct,
      externalProductId: storeId,
    });
    const email = freshEmail(PREFIX, 'mixed');
    const buyer = await personWithEmail(email, 'lab');
    const access = await deliverAndApply(
      integration,
      saleBody('purchase_approved', { ref: ref(), productId: accessId, email }),
    );
    const store = await deliverAndApply(
      integration,
      saleBody('purchase_approved', { ref: ref(), productId: storeId, email }),
    );
    const ticket = await deliverAndApply(integration, approved(ev.productId, buyer.email));
    // 47 older fillers, then the three in a chosen order: ticket newest, access oldest of the three
    await insertEvents(
      labTenantId,
      integration.id,
      Array.from({ length: 48 }, (_, i) => ({
        at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      })),
    );
    await adminSql`update public.payment_events set received_at = '2026-06-01T00:00:01Z' where id = ${access.id}::uuid`;
    await adminSql`update public.payment_events set received_at = '2026-06-01T00:00:02Z' where id = ${store.id}::uuid`;
    await adminSql`update public.payment_events set received_at = '2026-06-01T00:00:03Z' where id = ${ticket.id}::uuid`;
    const { items } = await listEvents();
    expect(items).toHaveLength(50);
    expect(items.slice(0, 3).map((item) => item.id)).toEqual([ticket.id, store.id, access.id]);
    expect((items[0] as TicketItem).kind).toBe('event');
    expect((items[1] as TicketItem).kind).toBeUndefined();
    expect((items[2] as TicketItem).kind).toBeUndefined();
  }, 60_000);

  it('Liberar manualmente on a "sem conta" ticket delivery: the account now exists, the presence is confirmed, the payer is told once, a second call is idempotent', async () => {
    const ev = await paid({ title: `${TITLE}-manual` });
    const email = freshEmail(PREFIX, 'later');
    const waiting = await deliverAndApply(integration, approved(ev.productId, email));
    expect(waiting).toMatchObject({ state: 'no_membership', outcome: null });
    expect((await grant(waiting.id)).status).toBe(409);
    expect(codeOf(await grant(waiting.id)).details?.payments).toBe('no_membership');

    const payer = await personWithEmail(email, 'lab');
    const released = await grant(waiting.id);
    expect(released.status, JSON.stringify(released.json)).toBe(200);
    expect(released.json).toMatchObject({
      id: waiting.id,
      state: 'applied',
      outcome: 'ticket_granted',
    });
    expect((released.json as TicketItem).kind).toBe('event');
    expect(await attendancesOf(ev.eventId)).toMatchObject([
      { user_id: payer.userId, status: 'going', origin: 'ticket', order_provider: 'fake' },
    ]);

    await runNotificationJobs(labTenantId);
    const notices = await noticesOf(payer.userId);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.payload).toEqual({ eventId: ev.eventId, eventTitle: `${TITLE}-manual` });

    const again = await grant(waiting.id);
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({
      id: waiting.id,
      state: 'applied',
      outcome: 'ticket_granted',
    });
    await runNotificationJobs(labTenantId);
    expect(await attendancesOf(ev.eventId)).toHaveLength(1);
    expect(await noticesOf(payer.userId)).toHaveLength(1);
  }, 60_000);

  it('Liberar manualmente confirms the presence of an UNCONFIRMED account too, the only way a payment reaches it (D-759)', async () => {
    const ev = await paid({ title: `${TITLE}-naoconf` });
    const payer = await personWithEmail(freshEmail(PREFIX, 'unconf'), 'lab');
    await adminSql`update auth.users set email_confirmed_at = null where id = ${payer.userId}::uuid`;
    const waiting = await deliverAndApply(integration, approved(ev.productId, payer.email));
    expect(waiting.state).toBe('no_membership');
    expect(await attendancesOf(ev.eventId)).toHaveLength(0);

    const released = await grant(waiting.id);
    expect(released.status, JSON.stringify(released.json)).toBe(200);
    expect(released.json).toMatchObject({ state: 'applied', outcome: 'ticket_granted' });
    expect(await attendancesOf(ev.eventId)).toMatchObject([
      { user_id: payer.userId, origin: 'ticket' },
    ]);
  }, 60_000);

  it('after a refund of the same order the release is 409 not_grantable and the row is untouched (PAY-30, T-10.1-08)', async () => {
    const ev = await paid({ title: `${TITLE}-estorno` });
    const email = freshEmail(PREFIX, 'refunded');
    const orderRef = ref();
    const waiting = await deliverAndApply(integration, approved(ev.productId, email, orderRef));
    const refund = await deliverAndApply(
      integration,
      ticketDelivery('purchase_refunded', { ref: orderRef, productId: ev.productId, email }),
    );
    expect(refund).toMatchObject({ state: 'applied', outcome: 'no_effect' });
    await personWithEmail(email, 'lab');
    const res = await grant(waiting.id);
    expect(res.status).toBe(409);
    expect(codeOf(res).details?.payments).toBe('not_grantable');
    expect((await eventRow(waiting.id)).state).toBe('no_membership');
    expect(await attendancesOf(ev.eventId)).toHaveLength(0);
  }, 60_000);

  /**
   * WR-01 (D-752, D-757): the manual release and the apply job serialise on ONE advisory lock per order, the
   * key text `<tenant>:<provider>:<external_ref>` (hash seed 0). These cases hold that key from a connection
   * of their own, using the LITERAL text, so they also prove the helper builds the same key.
   * `adminSql` has one connection, hence the holder.
   */
  const holdOrderLock = async (tenantId: string, orderRef: string) => {
    const holder = postgres('postgres://postgres:postgres@127.0.0.1:54322/postgres', {
      prepare: false,
      max: 1,
    });
    await holder`select pg_advisory_lock(hashtextextended(${`${tenantId}:fake:${orderRef}`}, 0))`;
    return {
      release: async () => {
        await holder`select pg_advisory_unlock_all()`;
      },
      end: async () => {
        await holder`select pg_advisory_unlock_all()`;
        await holder.end();
      },
    };
  };

  /** The number of advisory locks somebody is waiting for (polled up to 5 s, as the apply-tickets precedent does). */
  const waitersOnAdvisoryLock = async (): Promise<number> => {
    let waiting = 0;
    for (let attempt = 0; attempt < 100 && waiting === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const [row] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`;
      waiting = row?.n ?? 0;
    }
    return waiting;
  };

  it('WR-01: a refund that applies while the release waits for the order lock is seen: 409 not_grantable, no presence, the delivery stays sem conta', async () => {
    const ev = await paid({ title: `${TITLE}-wr01-race` });
    const email = freshEmail(PREFIX, 'wr01race');
    const orderRef = ref();
    const waiting = await deliverAndApply(integration, approved(ev.productId, email, orderRef));
    expect(waiting.state).toBe('no_membership');
    await personWithEmail(email, 'lab');
    // The refund is recorded but NOT applied yet: the release's first read cannot see it as applied.
    const refundId = await deliver(
      integration,
      ticketDelivery('purchase_refunded', { ref: orderRef, productId: ev.productId, email }),
    );
    expect((await eventRow(refundId)).state).toBe('received');

    const holder = await holdOrderLock(labTenantId, orderRef);
    let releasing: ReturnType<typeof grant> = Promise.resolve({
      status: 0,
      json: {},
      raw: '',
    });
    try {
      releasing = grant(waiting.id);
      expect(
        await waitersOnAdvisoryLock(),
        'the release must be waiting on the order lock',
      ).toBeGreaterThan(0);
      // The refund job commits while the release waits, then the lock is freed.
      await adminSql`
        update public.payment_events
           set state = 'applied', outcome = 'no_effect', applied_at = now()
         where id = ${refundId}::uuid`;
      await holder.release();
      const res = await releasing;
      expect(res.status, JSON.stringify(res.json)).toBe(409);
      expect(codeOf(res).details?.payments).toBe('not_grantable');
    } finally {
      await holder.end();
      await releasing.catch(() => undefined);
    }
    expect(await attendancesOf(ev.eventId)).toHaveLength(0);
    expect((await eventRow(waiting.id)).state).toBe('no_membership');
  }, 60_000);

  it('an event that ended, was cancelled or was deleted since is 409 event_ended / event_cancelled and the row stays "sem conta"', async () => {
    const ev = await paid({ title: `${TITLE}-fechado` });
    const email = freshEmail(PREFIX, 'closing');
    const waiting = await deliverAndApply(integration, approved(ev.productId, email));
    await personWithEmail(email, 'lab');

    await adminSql`
      update public.events set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour'
       where id = ${ev.eventId}::uuid`;
    const ended = await grant(waiting.id);
    expect(ended.status).toBe(409);
    expect(codeOf(ended).details?.payments).toBe('event_ended');
    expect((await eventRow(waiting.id)).state).toBe('no_membership');

    await adminSql`
      update public.events set starts_at = now() + interval '1 hour', ends_at = now() + interval '3 hours',
                               status = 'cancelled', cancelled_at = now()
       where id = ${ev.eventId}::uuid`;
    const cancelled = await grant(waiting.id);
    expect(cancelled.status).toBe(409);
    expect(codeOf(cancelled).details?.payments).toBe('event_cancelled');

    await adminSql`
      update public.events set status = 'active', cancelled_at = null, deleted_at = now()
       where id = ${ev.eventId}::uuid`;
    const deleted = await grant(waiting.id);
    expect(deleted.status).toBe(409);
    expect(codeOf(deleted).details?.payments).toBe('event_cancelled');

    expect((await eventRow(waiting.id)).state).toBe('no_membership');
    expect(await attendancesOf(ev.eventId)).toHaveLength(0);
  }, 60_000);

  it("another tenant's ticket delivery id is the bare 404 and a support_tenant is 403", async () => {
    await removePaymentIntegrations(demoTenantId);
    const demoIntegration = await seedPaymentIntegration(demoTenantId);
    const demoEvent = await ticketEvent(demoTenantId, { title: `${TITLE}-demo` });
    const demoMapping = await ticketMapping(demoTenantId, demoEvent);
    const waiting = await deliverAndApply(
      demoIntegration,
      approved(demoMapping.externalProductId, freshEmail(PREFIX, 'demoghost')),
    );
    expect(waiting.state).toBe('no_membership');
    const res = await grant(waiting.id);
    expect(res.status).toBe(404);
    expect(codeOf(res).code).toBe('NOT_FOUND');
    expect((await grant(waiting.id, supportUser)).status).toBe(403);
    expect((await eventRow(waiting.id)).state).toBe('no_membership');
    await removePaymentIntegrations(demoTenantId);
    await removePaymentMappings(demoTenantId);
  }, 60_000);
});
