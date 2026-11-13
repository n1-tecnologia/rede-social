import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { removeTicketEvents, ticketEvent } from './payments-apply-fixtures';
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
