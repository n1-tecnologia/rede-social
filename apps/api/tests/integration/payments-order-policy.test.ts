import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import type { MembershipAccessCut } from '@rede-social/contracts/payments';
import { subscribe } from '@rede-social/core/server/events/bus';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { recordPaymentEvent } from '@rede-social/core/server/payments/inbox';
import type { NeutralPaymentEvent } from '@rede-social/core/server/payments/types';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCode,
  deliver,
  deliverAndApply,
  eventRow,
  freshEmail,
  gatewayRowsOf,
  personWithEmail,
  runApply,
} from './payments-apply-fixtures';
import {
  adminSql,
  api,
  HOSTS,
  removeIdentitiesByPrefix,
  removePaymentIntegrations,
  removePaymentMappings,
  type SeededPaymentIntegration,
  seedPaymentIntegration,
  seedPaymentMapping,
  withModuleEnabled,
  withPaymentsGate,
} from './setup';

/**
 * 09.1-07 (PAY-07, PAY-30; P12, P13, flagged P71) against the live local stack: the apply step must be
 * safe to run twice, out of order and concurrently, because the gateway retries, re-sends and carries
 * no event id. Everything goes through the REAL signed route, the REAL `kernel.payment-event` handler
 * and the REAL tables; the member answers come from real gated requests.
 *
 *  - `09.1 idempotency` (P12): the same event twice, a re-sent body, a duplicate job.
 *  - `09.1 ordering` (PAY-30, A-P25): refund then a late approval, an out-of-order recurring sequence,
 *    a cancel that overtakes its approval, an adapter-supplied `occurredAt`.
 *  - `09.1 concurrency` (P13): parallel jobs of one reference, simultaneous first events, eight
 *    parallel deliveries of one body, a refund racing a purchase.
 *
 * A-P25 (Kiwify gives no usable timestamp, so for subscriptions ARRIVAL ORDER wins) predicts every
 * ordering result below; none departed from it. The ledger of ids this file creates carries the
 * prefix, and the hooks sweep it. Test ORDER is load-bearing (`fileParallelism: false`).
 */

const PREFIX = 'payorder';
const NAME = `${PREFIX}-store`;

let labTenantId = '';
let labAdmin = '';
let integration: SeededPaymentIntegration;
let restoreStore: () => Promise<void> = async () => {};
let unsubscribe: () => void = () => {};
const cuts: MembershipAccessCut[] = [];

let community = '';
let product = '';

const accessProduct = async () => {
  const externalProductId = `acc-${crypto.randomUUID()}`;
  const mapping = await seedPaymentMapping(labTenantId, {
    kind: 'access',
    name: 'Plano',
    externalProductId,
  });
  return { mappingId: mapping.id, productId: externalProductId };
};

const storeMapping = async () => {
  const externalProductId = `sp-${crypto.randomUUID()}`;
  await seedPaymentMapping(labTenantId, {
    kind: 'store_product',
    targetId: product,
    externalProductId,
  });
  return externalProductId;
};

const sale = (
  type: string,
  f: { ref: string; productId: string; email: string } & Record<string, unknown>,
) => {
  const { ref, productId, email, ...rest } = f;
  return {
    type,
    externalRef: ref,
    productId,
    email,
    amountCents: 4_990,
    currency: 'BRL',
    recurring: true,
    ...rest,
  };
};

const gatewayRow = async (email: string) => {
  const rows = await gatewayRowsOf(email);
  expect(rows).toHaveLength(1);
  const [row] = rows;
  if (!row) throw new Error('no gateway row');
  return row;
};

const eventCount = async () => {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.payment_events where integration_id = ${integration.id}::uuid`;
  return row?.n ?? -1;
};

const communityLocked = async (who: { token: string }): Promise<boolean> => {
  const res = await api.request(`/v1/store/communities/${community}/access`, {
    headers: { [TENANT_HOST_HEADER]: HOSTS.lab, authorization: `Bearer ${who.token}` },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { locked: boolean }).locked;
};

const storeLedger = async (userId: string) => {
  const [row] = await adminSql<{ orders: number; live: number; active: number }[]>`
    select (select count(*)::int from public.store_orders
             where user_id = ${userId}::uuid and product_id = ${product}::uuid) as orders,
           (select count(*)::int from public.store_orders
             where user_id = ${userId}::uuid and product_id = ${product}::uuid
               and status in ('pending','paid')) as live,
           (select count(*)::int from public.store_entitlements
             where user_id = ${userId}::uuid and product_id = ${product}::uuid
               and status = 'active') as active`;
  return row ?? { orders: -1, live: -1, active: -1 };
};

async function sweepStore(): Promise<void> {
  const products = adminSql`select id from public.store_products where name like ${`${NAME}%`}`;
  await adminSql`delete from public.store_entitlements where product_id in (${products})`;
  await adminSql`delete from public.store_orders where product_id in (${products})`;
  await removePaymentMappings(labTenantId);
  await adminSql`delete from public.store_products where name like ${`${NAME}%`}`;
  await adminSql`delete from public.communities where name like ${`${NAME}%`}`;
}

async function sweepAll(): Promise<void> {
  await removePaymentIntegrations(labTenantId);
  await sweepStore();
}

beforeAll(async () => {
  const [lab] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-lab'`;
  labTenantId = lab?.id ?? '';
  const [admin] = await adminSql<{ user_id: string }[]>`
    select user_id::text as user_id from public.memberships
     where tenant_id = ${labTenantId}::uuid and role = 'admin_tenant' limit 1`;
  labAdmin = admin?.user_id ?? '';
  if (!labTenantId || !labAdmin) throw new Error('seed tenant missing: run pnpm db:seed');

  restoreStore = await withModuleEnabled('lab', 'store');
  await removeIdentitiesByPrefix(PREFIX);
  await sweepAll();

  const [c] = await adminSql<{ id: string }[]>`
    insert into public.communities (tenant_id, created_by_user_id, name, slug)
    values (${labTenantId}::uuid, ${labAdmin}::uuid, ${`${NAME} comunidade`}, ${`${NAME}-c`})
    returning id::text as id`;
  community = c?.id ?? '';
  const [p] = await adminSql<{ id: string }[]>`
    insert into public.store_products (tenant_id, created_by_user_id, name, price_cents, status)
    values (${labTenantId}::uuid, ${labAdmin}::uuid, ${`${NAME} curso`}, 99900, 'active')
    returning id::text as id`;
  product = p?.id ?? '';
  await adminSql`
    insert into public.store_product_communities (tenant_id, product_id, community_id)
    values (${labTenantId}::uuid, ${product}::uuid, ${community}::uuid)`;

  unsubscribe = subscribe('membership.access_cut', async (payload) => {
    cuts.push(payload);
  });
}, 60_000);

afterEach(async () => {
  await removePaymentIntegrations(labTenantId);
  await removePaymentMappings(labTenantId);
  cuts.length = 0;
});

afterAll(async () => {
  unsubscribe();
  await removeIdentitiesByPrefix(PREFIX);
  await sweepAll();
  await restoreStore();
  await stopBoss();
}, 60_000);

describe('09.1 idempotency', () => {
  it('P12: the same body delivered twice leaves one event row, one gateway row and one emission, whatever the job count', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const { productId } = await accessProduct();
    const member = await personWithEmail(freshEmail(PREFIX, 'idem'), 'lab');
    const ref = `sub-${crypto.randomUUID()}`;
    await withPaymentsGate(labTenantId, async () => {
      await deliverAndApply(
        integration,
        sale('purchase_approved', { ref, productId, email: member.email }),
      );
      const cancel = sale('subscription_canceled', {
        ref,
        productId,
        email: member.email,
        orderRef: 'cancel-1',
      });
      const first = await deliver(integration, cancel);
      const second = await deliver(integration, cancel);
      expect(second).toBe(first);
      expect(await eventCount()).toBe(2);

      await runApply(first);
      await runApply(first);
      await runApply(second);
      expect(await eventCount()).toBe(2);
      expect((await eventRow(first)).state).toBe('applied');
      expect((await gatewayRow(member.email)).status).toBe('inactive');
      expect(cuts).toHaveLength(1);
      expect(await bootstrapCode(member)).toBe('SUBSCRIPTION_PENDING');
    });
  });

  it('a re-sent body of the same sale with one different byte is a second event that re-writes the same row to the same state', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const { productId } = await accessProduct();
    const member = await personWithEmail(freshEmail(PREFIX, 'resent'), 'lab');
    const ref = `sub-${crypto.randomUUID()}`;
    await withPaymentsGate(labTenantId, async () => {
      await deliverAndApply(
        integration,
        sale('purchase_approved', { ref, productId, email: member.email }),
      );
      const cancel = sale('subscription_canceled', { ref, productId, email: member.email });
      const one = await deliverAndApply(integration, {
        ...cancel,
        orderRef: 'c',
        updated_at: '2026-10-20T10:00:00Z',
      });
      const rowAfterOne = await gatewayRow(member.email);
      const two = await deliverAndApply(integration, {
        ...cancel,
        orderRef: 'c',
        updated_at: '2026-10-20T10:00:01Z',
      });
      expect(two.id).not.toBe(one.id);
      expect(two).toMatchObject({ state: 'applied', outcome: 'access_cut' });
      const rowAfterTwo = await gatewayRow(member.email);
      expect(rowAfterTwo.id).toBe(rowAfterOne.id);
      expect(rowAfterTwo.status).toBe('inactive');
      expect(await gatewayRowsOf(member.email)).toHaveLength(1);
      // The second cancel found the member already cut: no second signal.
      expect(cuts).toHaveLength(1);
    });
  });

  it('a duplicate job for an already applied event returns without touching the row', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const { productId } = await accessProduct();
    const email = freshEmail(PREFIX, 'dupjob');
    const eventId = await deliver(
      integration,
      sale('purchase_approved', { ref: `sub-${crypto.randomUUID()}`, productId, email }),
    );
    await runApply(eventId);
    const before = await gatewayRow(email);
    const settled = await eventRow(eventId);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await runApply(eventId);
    expect((await gatewayRow(email)).updated_at).toEqual(before.updated_at);
    expect(await eventRow(eventId)).toEqual(settled);
  });
});

describe('09.1 ordering', () => {
  it('a refund then a LATE approval of a one-off access sale ends inactive and terminal, the late event stale, the member cut', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const { productId } = await accessProduct();
    const member = await personWithEmail(freshEmail(PREFIX, 'oneoff'), 'lab');
    const ref = `ord-${crypto.randomUUID()}`;
    const send = (type: string) =>
      deliverAndApply(
        integration,
        sale(type, { ref, productId, email: member.email, recurring: false }),
      );
    await withPaymentsGate(labTenantId, async () => {
      expect(await send('purchase_approved')).toMatchObject({ outcome: 'access_granted' });
      expect(await bootstrapCode(member)).toBe('OK');
      expect(await send('purchase_refunded')).toMatchObject({ outcome: 'access_cut' });
      expect(await gatewayRow(member.email)).toMatchObject({ status: 'inactive', terminal: true });

      const late = await send('purchase_approved');
      expect(late).toMatchObject({ state: 'ignored', outcome: 'stale' });
      expect(await gatewayRow(member.email)).toMatchObject({ status: 'inactive', terminal: true });
      expect(await bootstrapCode(member)).toBe('SUBSCRIPTION_PENDING');
      expect(cuts).toHaveLength(1);
    });
  });

  it('the same sequence for a store sale leaves the community locked', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const productId = await storeMapping();
    const buyer = await personWithEmail(freshEmail(PREFIX, 'store'), 'lab');
    const ref = `ord-${crypto.randomUUID()}`;
    const send = (type: string) =>
      deliverAndApply(
        integration,
        sale(type, {
          ref,
          productId,
          email: buyer.email,
          recurring: false,
          amountCents: 12_345,
        }),
      );
    expect(await send('purchase_approved')).toMatchObject({ outcome: 'product_granted' });
    expect(await communityLocked(buyer)).toBe(false);
    expect(await send('chargeback')).toMatchObject({ outcome: 'product_revoked' });
    expect(await send('purchase_approved')).toMatchObject({ state: 'ignored', outcome: 'stale' });
    expect(await communityLocked(buyer)).toBe(true);
    expect(await storeLedger(buyer.userId)).toMatchObject({ live: 0, active: 0 });
  });

  it('A-P25: a recurring sequence renewed, late, renewed, canceled, renewed settles on the last event received each time', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const { productId } = await accessProduct();
    const member = await personWithEmail(freshEmail(PREFIX, 'seq'), 'lab');
    const ref = `sub-${crypto.randomUUID()}`;
    const send = (type: string) =>
      deliverAndApply(integration, sale(type, { ref, productId, email: member.email }));
    const steps: [string, 'active' | 'inactive', string][] = [
      ['subscription_renewed', 'active', 'OK'],
      ['subscription_late', 'inactive', 'SUBSCRIPTION_PENDING'],
      ['subscription_renewed', 'active', 'OK'],
      ['subscription_canceled', 'inactive', 'SUBSCRIPTION_PENDING'],
      ['subscription_renewed', 'active', 'OK'],
    ];
    await withPaymentsGate(labTenantId, async () => {
      for (const [type, status, answer] of steps) {
        const settled = await send(type);
        expect(settled.state, type).toBe('applied');
        expect((await gatewayRow(member.email)).status, type).toBe(status);
        expect(await bootstrapCode(member), type).toBe(answer);
      }
      expect(await gatewayRowsOf(member.email)).toHaveLength(1);
      // Two cuts (late, canceled), each followed by a return that emitted nothing.
      expect(cuts).toHaveLength(2);
    });
  });

  it('a cancel that arrives BEFORE any approval creates an inactive row, and the later approval of a recurring sale activates it', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const { productId } = await accessProduct();
    const member = await personWithEmail(freshEmail(PREFIX, 'early'), 'lab');
    const ref = `sub-${crypto.randomUUID()}`;
    await withPaymentsGate(labTenantId, async () => {
      const cancel = await deliverAndApply(
        integration,
        sale('subscription_canceled', { ref, productId, email: member.email }),
      );
      expect(cancel).toMatchObject({ state: 'applied', outcome: 'access_cut' });
      expect(await gatewayRow(member.email)).toMatchObject({ status: 'inactive', terminal: false });
      expect(await bootstrapCode(member)).toBe('SUBSCRIPTION_PENDING');
      // The member had no access before this event either: nothing moved from granted to cut.
      expect(cuts).toHaveLength(0);

      const approved = await deliverAndApply(
        integration,
        sale('purchase_approved', { ref, productId, email: member.email }),
      );
      expect(approved).toMatchObject({ state: 'applied', outcome: 'access_granted' });
      expect((await gatewayRow(member.email)).status).toBe('active');
      expect(await bootstrapCode(member)).toBe('OK');
    });
  });

  it('with an adapter that supplies occurredAt, an event older than the row last one is stale', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const { productId } = await accessProduct();
    const member = await personWithEmail(freshEmail(PREFIX, 'clock'), 'lab');
    const ref = `sub-${crypto.randomUUID()}`;
    const at = (minutes: number) => new Date(Date.UTC(2026, 9, 20, 10, minutes, 0));
    let n = 0;
    const record = async (
      type: NeutralPaymentEvent['type'],
      effect: 'grant' | 'suspend',
      when: Date,
    ) => {
      n += 1;
      const event: NeutralPaymentEvent = {
        type,
        effect,
        externalRef: ref,
        orderRef: null,
        externalProductId: productId,
        email: member.email,
        amountCents: 4_990,
        currency: 'BRL',
        validUntil: null,
        occurredAt: when,
        recurring: true,
      };
      const { eventId } = await recordPaymentEvent({
        integration: { id: integration.id, tenantId: labTenantId, provider: integration.provider },
        event,
        dedupeKey: `clock-${ref}-${n}`,
      });
      await runApply(eventId);
      return eventRow(eventId);
    };

    await withPaymentsGate(labTenantId, async () => {
      expect(await record('purchase_approved', 'grant', at(10))).toMatchObject({
        state: 'applied',
        outcome: 'access_granted',
      });
      // Delivered LATER but happened EARLIER: ignored, the member keeps the door.
      expect(await record('subscription_canceled', 'suspend', at(5))).toMatchObject({
        state: 'ignored',
        outcome: 'stale',
      });
      expect((await gatewayRow(member.email)).status).toBe('active');
      expect(await bootstrapCode(member)).toBe('OK');

      expect(await record('subscription_canceled', 'suspend', at(20))).toMatchObject({
        state: 'applied',
        outcome: 'access_cut',
      });
      expect((await gatewayRow(member.email)).last_event_at?.toISOString()).toBe(
        at(20).toISOString(),
      );
      expect(await record('subscription_renewed', 'grant', at(15))).toMatchObject({
        state: 'ignored',
        outcome: 'stale',
      });
      expect(await bootstrapCode(member)).toBe('SUBSCRIPTION_PENDING');
      expect(await record('subscription_renewed', 'grant', at(30))).toMatchObject({
        state: 'applied',
      });
      expect(await bootstrapCode(member)).toBe('OK');
    });
  });
});

describe('09.1 concurrency', () => {
  it('P13: two jobs of one subscription reference run one after the other and the row ends in the state of the last committed event', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const { productId } = await accessProduct();
    const member = await personWithEmail(freshEmail(PREFIX, 'race'), 'lab');
    const ref = `sub-${crypto.randomUUID()}`;
    await withPaymentsGate(labTenantId, async () => {
      await deliverAndApply(
        integration,
        sale('purchase_approved', { ref, productId, email: member.email }),
      );
      for (let round = 0; round < 5; round += 1) {
        cuts.length = 0;
        const cancelId = await deliver(
          integration,
          sale('subscription_canceled', { ref, productId, email: member.email }),
        );
        const renewId = await deliver(
          integration,
          sale('subscription_renewed', { ref, productId, email: member.email }),
        );
        await Promise.all([runApply(cancelId), runApply(renewId)]);

        expect((await eventRow(cancelId)).state).toBe('applied');
        expect((await eventRow(renewId)).state).toBe('applied');
        const row = await gatewayRow(member.email);
        expect(await bootstrapCode(member)).toBe(
          row.status === 'active' ? 'OK' : 'SUBSCRIPTION_PENDING',
        );
        // Either order cuts the member exactly once: cancel-then-renew cuts and returns, renew-then-cancel cuts.
        expect(cuts).toHaveLength(1);
        // Put the sale back to active for the next round.
        await deliverAndApply(
          integration,
          sale('subscription_renewed', { ref, productId, email: member.email }),
        );
        expect((await gatewayRow(member.email)).status).toBe('active');
      }
      expect(await gatewayRowsOf(member.email)).toHaveLength(1);
    });
  });

  it('two simultaneous FIRST events for one new reference create one row', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const { productId } = await accessProduct();
    const email = freshEmail(PREFIX, 'first');
    const ref = `sub-${crypto.randomUUID()}`;
    const [one, two] = await Promise.all([
      deliver(integration, sale('purchase_approved', { ref, productId, email, orderRef: 'a' })),
      deliver(integration, sale('subscription_renewed', { ref, productId, email, orderRef: 'b' })),
    ]);
    await Promise.all([runApply(one), runApply(two)]);
    expect((await eventRow(one)).state).toBe('applied');
    expect((await eventRow(two)).state).toBe('applied');
    expect(await gatewayRowsOf(email)).toHaveLength(1);
    expect((await gatewayRow(email)).status).toBe('active');
  });

  it('eight parallel deliveries of one body create one event and apply once', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const { productId } = await accessProduct();
    const member = await personWithEmail(freshEmail(PREFIX, 'eight'), 'lab');
    const ref = `sub-${crypto.randomUUID()}`;
    await withPaymentsGate(labTenantId, async () => {
      await deliverAndApply(
        integration,
        sale('purchase_approved', { ref, productId, email: member.email }),
      );
      const cancel = sale('subscription_canceled', {
        ref,
        productId,
        email: member.email,
        orderRef: 'eight',
      });
      const ids = await Promise.all(Array.from({ length: 8 }, () => deliver(integration, cancel)));
      expect(new Set(ids).size).toBe(1);
      expect(await eventCount()).toBe(2);

      const [eventId] = ids;
      if (!eventId) throw new Error('no event id');
      await Promise.all(ids.map((id) => runApply(id)));
      expect((await eventRow(eventId)).state).toBe('applied');
      expect(await gatewayRowsOf(member.email)).toHaveLength(1);
      expect(cuts).toHaveLength(1);
    });
  });

  it('a refund racing a purchase of the same reference ends with at most one live order and one active entitlement', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const productId = await storeMapping();
    for (let round = 0; round < 4; round += 1) {
      const buyer = await personWithEmail(freshEmail(PREFIX, `rr${round}`), 'lab');
      const ref = `ord-${crypto.randomUUID()}`;
      const body = (type: string) =>
        sale(type, { ref, productId, email: buyer.email, recurring: false, amountCents: 12_345 });
      const [purchase, refund] = await Promise.all([
        deliver(integration, body('purchase_approved')),
        deliver(integration, body('purchase_refunded')),
      ]);
      await Promise.all([runApply(purchase), runApply(refund)]);

      expect((await eventRow(purchase)).state).not.toBe('failed');
      expect((await eventRow(refund)).state).toBe('applied');
      const ledger = await storeLedger(buyer.userId);
      expect(ledger.live).toBeLessThanOrEqual(1);
      expect(ledger.active).toBeLessThanOrEqual(1);
      expect(ledger.live).toBe(ledger.active);
      // Both orders end with the product locked: the refund is final for a one-off sale.
      expect(await communityLocked(buyer)).toBe(true);
    }
  });
});
