import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import type { PaymentsPurchaseConfirmed } from '@rede-social/contracts/payments';
import { subscribe } from '@rede-social/core/server/events/bus';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deliver,
  deliverAndApply,
  eventRow,
  freshEmail,
  type Person,
  personWithEmail,
  runApply,
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
