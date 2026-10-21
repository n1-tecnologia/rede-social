import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import type {
  MembershipAccessCut,
  PaymentsPurchaseConfirmed,
} from '@rede-social/contracts/payments';
import { subscribe } from '@rede-social/core/server/events/bus';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCode,
  deliver,
  deliverAndApply,
  eventRow,
  freshEmail,
  gatewayRowsOf,
  membershipFacts,
  notificationCount,
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
  withPaymentsGate,
  withStoreEnabled,
} from './setup';

/**
 * 09.1-07 (PAY-07, PAY-11, PAY-13, PAY-17, PAY-18, PAY-23..PAY-27, PAY-29; D-490, D-494, D-496, D-499,
 * D-500, D-505, D-506, D-509) against the live local stack: a signed `fake` delivery goes through the
 * REAL route and inbox, the REAL `kernel.payment-event` handler applies it, and a REAL gated request
 * proves what a member may do afterwards.
 *
 *  - `09.1 tracer`: one subscription's whole life (approved, canceled or late or refunded or charged
 *    back, renewed) for an e-mail that has no account when the purchase arrives.
 *  - `09.1 job`: the handler's own contract (payload, replay, failure and retry).
 *  - `09.1 store events`: the store branch and the visible states (Task 2 of the plan).
 *
 * Every identity carries the prefix below (its access rows go with it); the integration, its events and
 * its mappings are removed in `afterEach` / `afterAll`. Test ORDER is load-bearing (`fileParallelism:
 * false`, declaration order).
 */

const PREFIX = 'payapply';

let labTenantId = '';
let demoTenantId = '';
let integration: SeededPaymentIntegration;

const cuts: MembershipAccessCut[] = [];
let unsubscribe: () => void = () => {};

/** An access mapping of rede-lab with a unique gateway product id. */
const accessProduct = (name = 'Plano') =>
  seedPaymentMapping(labTenantId, {
    kind: 'access',
    name,
    externalProductId: `acc-${crypto.randomUUID()}`,
  });

const productIdOf = async (mappingId: string): Promise<string> => {
  const [row] = await adminSql<{ external_product_id: string }[]>`
    select external_product_id from public.payment_products where id = ${mappingId}::uuid`;
  return row?.external_product_id ?? '';
};

/** A neutral `fake` delivery body for a recurring sale. */
const sale = (
  type: string,
  fields: { ref: string; productId: string; email: string } & Record<string, unknown>,
) => {
  const { ref, productId, email, ...rest } = fields;
  return {
    type,
    externalRef: ref,
    productId,
    email,
    amountCents: 4990,
    currency: 'BRL',
    recurring: true,
    validUntil: '2027-01-01T00:00:00.000Z',
    ...rest,
  };
};

beforeAll(async () => {
  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id::text as id, slug from public.tenants where slug in ('rede-lab', 'rede-demo')`;
  labTenantId = rows.find((row) => row.slug === 'rede-lab')?.id ?? '';
  demoTenantId = rows.find((row) => row.slug === 'rede-demo')?.id ?? '';
  if (!labTenantId || !demoTenantId) throw new Error('seed tenants missing: run pnpm db:seed');
  await removeIdentitiesByPrefix(PREFIX);
  await removePaymentIntegrations(labTenantId);
  await removePaymentIntegrations(demoTenantId);
  await removePaymentMappings(labTenantId);
  await removePaymentMappings(demoTenantId);
  unsubscribe = subscribe('membership.access_cut', async (payload) => {
    cuts.push(payload);
  });
}, 60_000);

afterEach(async () => {
  await removePaymentIntegrations(labTenantId);
  await removePaymentIntegrations(demoTenantId);
  await removePaymentMappings(labTenantId);
  await removePaymentMappings(demoTenantId);
  cuts.length = 0;
});

afterAll(async () => {
  unsubscribe();
  await removePaymentIntegrations(labTenantId);
  await removePaymentIntegrations(demoTenantId);
  await removePaymentMappings(labTenantId);
  await removePaymentMappings(demoTenantId);
  await removeIdentitiesByPrefix(PREFIX);
  await stopBoss();
}, 60_000);

describe('09.1 tracer', () => {
  it('a subscription whole life: bought before the account exists, cut on cancel, returned on renewal, nothing else moves', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const mapping = await accessProduct();
    const productId = await productIdOf(mapping.id);
    const email = freshEmail(PREFIX, 'ana');
    const ref = `sub-${crypto.randomUUID()}`;

    // (a) the purchase arrives while the e-mail has NO account (D-490, D-493)
    const approved = await deliverAndApply(
      integration,
      sale('purchase_approved', { ref, productId, email }),
    );
    expect(approved).toMatchObject({
      state: 'applied',
      outcome: 'access_granted',
      mapping_id: mapping.id,
      tenant_id: labTenantId,
    });
    expect(approved.applied_at).not.toBeNull();
    const rows = await gatewayRowsOf(email);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: labTenantId,
      status: 'active',
      terminal: false,
      provider: 'fake',
      external_ref: ref,
      mapping_id: mapping.id,
    });
    expect(rows[0]?.valid_until?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(rows[0]?.last_event_at).not.toBeNull();

    await withPaymentsGate(labTenantId, async () => {
      // (b) the person signs up later: the gated tenant admits them
      const member = await personWithEmail(email, 'lab');
      expect(await bootstrapCode(member)).toBe('OK');
      const facts = await membershipFacts(member.userId, labTenantId);
      const notices = await notificationCount(member.userId);

      // (c) the cancel: the very next request is refused, exactly one signal, nothing else moves
      const canceled = await deliverAndApply(
        integration,
        sale('subscription_canceled', { ref, productId, email }),
      );
      expect(canceled).toMatchObject({ state: 'applied', outcome: 'access_cut' });
      expect((await gatewayRowsOf(email))[0]).toMatchObject({
        status: 'inactive',
        terminal: false,
      });
      expect(await bootstrapCode(member)).toBe('SUBSCRIPTION_PENDING');
      expect(cuts).toEqual([
        { tenantId: labTenantId, userId: member.userId, membershipId: member.membershipId },
      ]);
      expect(await membershipFacts(member.userId, labTenantId)).toEqual(facts);

      // (d) the renewal: back with no admin action, no signal, no notification of any kind
      const renewed = await deliverAndApply(
        integration,
        sale('subscription_renewed', { ref, productId, email }),
      );
      expect(renewed).toMatchObject({ state: 'applied', outcome: 'access_granted' });
      expect(await bootstrapCode(member)).toBe('OK');
      expect(cuts).toHaveLength(1);
      expect(await notificationCount(member.userId)).toBe(notices);
      expect(await membershipFacts(member.userId, labTenantId)).toEqual(facts);
      expect(await gatewayRowsOf(email)).toHaveLength(1);
    });
  });

  it.each([
    ['subscription_late', 'subscription_renewed'],
    ['purchase_refunded', 'subscription_renewed'],
    ['chargeback', 'subscription_renewed'],
    ['purchase_refunded', 'purchase_approved'],
  ])('%s cuts a recurring sale and %s returns it (D-496, D-505)', async (cutType, returnType) => {
    integration = await seedPaymentIntegration(labTenantId);
    const mapping = await accessProduct();
    const productId = await productIdOf(mapping.id);
    const member = await personWithEmail(freshEmail(PREFIX, 'seq'), 'lab');
    const ref = `sub-${crypto.randomUUID()}`;
    const body = (type: string) => sale(type, { ref, productId, email: member.email });

    await withPaymentsGate(labTenantId, async () => {
      await deliverAndApply(integration, body('purchase_approved'));
      expect(await bootstrapCode(member)).toBe('OK');

      const cut = await deliverAndApply(integration, body(cutType));
      expect(cut).toMatchObject({ state: 'applied', outcome: 'access_cut' });
      expect(await bootstrapCode(member)).toBe('SUBSCRIPTION_PENDING');
      expect(cuts).toHaveLength(1);

      const back = await deliverAndApply(integration, body(returnType));
      expect(back).toMatchObject({ state: 'applied', outcome: 'access_granted' });
      expect(await bootstrapCode(member)).toBe('OK');
      expect(cuts).toHaveLength(1);
    });
  });

  it('D-494: with two access products cancelling one leaves the other active, no cut and no event', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const [a, b] = await Promise.all([accessProduct('Plano A'), accessProduct('Plano B')]);
    const member = await personWithEmail(freshEmail(PREFIX, 'two'), 'lab');
    const refA = `sub-${crypto.randomUUID()}`;
    const refB = `sub-${crypto.randomUUID()}`;
    const productA = await productIdOf(a.id);
    const productB = await productIdOf(b.id);

    await withPaymentsGate(labTenantId, async () => {
      await deliverAndApply(
        integration,
        sale('purchase_approved', { ref: refA, productId: productA, email: member.email }),
      );
      await deliverAndApply(
        integration,
        sale('purchase_approved', { ref: refB, productId: productB, email: member.email }),
      );
      expect(await gatewayRowsOf(member.email)).toHaveLength(2);

      await deliverAndApply(
        integration,
        sale('subscription_canceled', { ref: refA, productId: productA, email: member.email }),
      );
      expect(await bootstrapCode(member)).toBe('OK');
      expect(cuts).toHaveLength(0);

      await deliverAndApply(
        integration,
        sale('subscription_canceled', { ref: refB, productId: productB, email: member.email }),
      );
      expect(await bootstrapCode(member)).toBe('SUBSCRIPTION_PENDING');
      expect(cuts).toHaveLength(1);
    });
  });

  it('emits nothing for staff, for a tenant whose gate is off, and for a return (D-499, D-500, PR-4)', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const mapping = await accessProduct();
    const productId = await productIdOf(mapping.id);
    const staff = await personWithEmail(freshEmail(PREFIX, 'adm'), 'lab', 'admin_tenant');
    const member = await personWithEmail(freshEmail(PREFIX, 'off'), 'lab');
    const run = async (email: string) => {
      const ref = `sub-${crypto.randomUUID()}`;
      await deliverAndApply(integration, sale('purchase_approved', { ref, productId, email }));
      return deliverAndApply(integration, sale('subscription_canceled', { ref, productId, email }));
    };

    // staff: gate on, role exempt
    await withPaymentsGate(labTenantId, async () => {
      expect((await run(staff.email)).outcome).toBe('access_cut');
      expect(await bootstrapCode(staff)).toBe('OK');
    });
    // gate off: the row still goes inactive, nobody is cut
    await withPaymentsGate(
      labTenantId,
      async () => {
        expect((await run(member.email)).outcome).toBe('access_cut');
        expect(await bootstrapCode(member)).toBe('OK');
      },
      { gate: false },
    );
    expect(cuts).toHaveLength(0);
  });

  it('PAY-29 / T-09.1-22: a delivery signed with tenant A token that names tenant B product is unknown_product and writes nothing anywhere', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    await seedPaymentIntegration(demoTenantId);
    const foreign = await seedPaymentMapping(demoTenantId, {
      kind: 'access',
      name: 'Plano do outro',
      externalProductId: `acc-${crypto.randomUUID()}`,
    });
    const productId = await productIdOf(foreign.id);
    const email = freshEmail(PREFIX, 'pin');
    const ref = `sub-${crypto.randomUUID()}`;

    const settled = await deliverAndApply(
      integration,
      sale('purchase_approved', { ref, productId, email }),
    );
    expect(settled).toMatchObject({ state: 'unknown_product', tenant_id: labTenantId });
    expect(settled.mapping_id).toBeNull();
    expect(await gatewayRowsOf(email)).toEqual([]);
    const [leaked] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.access_grants where external_ref = ${ref}`;
    expect(leaked?.n).toBe(0);
  });
});

describe('09.1 tracer: events without an e-mail', () => {
  it('a cancel that omits the customer still cuts the existing row; a first event with no e-mail creates nothing', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const mapping = await accessProduct();
    const productId = await productIdOf(mapping.id);
    const member = await personWithEmail(freshEmail(PREFIX, 'noml'), 'lab');
    const ref = `sub-${crypto.randomUUID()}`;
    await withPaymentsGate(labTenantId, async () => {
      await deliverAndApply(
        integration,
        sale('purchase_approved', { ref, productId, email: member.email }),
      );
      expect(await bootstrapCode(member)).toBe('OK');
      const anonymous = {
        ...sale('subscription_canceled', { ref, productId, email: '' }),
        email: null,
      };
      expect(await deliverAndApply(integration, anonymous)).toMatchObject({
        state: 'applied',
        outcome: 'access_cut',
      });
      expect(await bootstrapCode(member)).toBe('SUBSCRIPTION_PENDING');
      expect(cuts).toHaveLength(1);
    });

    const orphan = {
      ...sale('purchase_approved', { ref: `sub-${crypto.randomUUID()}`, productId, email: '' }),
      email: null,
    };
    expect(await deliverAndApply(integration, orphan)).toMatchObject({
      state: 'ignored',
      outcome: 'no_effect',
    });
  });
});

describe('09.1 job', () => {
  it('drops a malformed payload without throwing', async () => {
    for (const payload of [undefined, null, {}, { eventId: 'nope' }, { eventId: 42 }, []]) {
      await expect(
        (await import('@rede-social/core/server/payments/event-job')).paymentEventJob.handler(
          payload as never,
        ),
      ).resolves.toBeUndefined();
    }
  });

  it('a missing event is logged and returned, never thrown', async () => {
    await expect(runApply(crypto.randomUUID())).resolves.toBeUndefined();
  });

  it('P12: applying the same event twice leaves one row, one applied event and no second emission', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const mapping = await accessProduct();
    const productId = await productIdOf(mapping.id);
    const member = await personWithEmail(freshEmail(PREFIX, 'twice'), 'lab');
    const ref = `sub-${crypto.randomUUID()}`;

    await withPaymentsGate(labTenantId, async () => {
      await deliverAndApply(
        integration,
        sale('purchase_approved', { ref, productId, email: member.email }),
      );
      const eventId = await deliver(
        integration,
        sale('subscription_canceled', { ref, productId, email: member.email }),
      );
      await runApply(eventId);
      const first = await eventRow(eventId);
      const [rowBefore] = await gatewayRowsOf(member.email);
      expect(cuts).toHaveLength(1);

      await runApply(eventId);
      const second = await eventRow(eventId);
      const [rowAfter] = await gatewayRowsOf(member.email);
      expect(second).toEqual(first);
      expect(rowAfter?.updated_at).toEqual(rowBefore?.updated_at);
      expect(await gatewayRowsOf(member.email)).toHaveLength(1);
      expect(cuts).toHaveLength(1);
    });
  });

  it('Pitfall 7: a thrown error rolls the write back, marks the event failed and rethrows; the retry converges', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const mapping = await accessProduct();
    const productId = await productIdOf(mapping.id);
    const email = freshEmail(PREFIX, 'boom');
    const ref = `boom-${crypto.randomUUID()}`;
    const eventId = await deliver(
      integration,
      sale('purchase_approved', { ref, productId, email }),
    );

    // A trigger that refuses exactly this reference makes the access write throw.
    await adminSql.unsafe(`
      create or replace function public.payapply_boom() returns trigger language plpgsql as $$
      begin
        if new.external_ref like 'boom-%' then raise exception 'payapply boom'; end if;
        return new;
      end $$`);
    await adminSql.unsafe(`
      create trigger payapply_boom before insert on public.access_grants
      for each row execute function public.payapply_boom()`);
    try {
      await expect(runApply(eventId)).rejects.toThrow();
      expect(await eventRow(eventId)).toMatchObject({ state: 'failed', outcome: null });
      expect(await gatewayRowsOf(email)).toEqual([]);
    } finally {
      await adminSql.unsafe('drop trigger if exists payapply_boom on public.access_grants');
      await adminSql.unsafe('drop function if exists public.payapply_boom()');
    }

    // `failed` is re-appliable: the retry (or the gateway's manual resend) converges.
    await runApply(eventId);
    expect(await eventRow(eventId)).toMatchObject({ state: 'applied', outcome: 'access_granted' });
    expect(await gatewayRowsOf(email)).toHaveLength(1);
  });

  it('an event whose state is already settled is an idempotent no-op even for a different outcome', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const eventId = await deliver(integration, { type: 'boleto_generated' });
    await runApply(eventId);
    const settled = await eventRow(eventId);
    expect(settled).toMatchObject({ state: 'ignored', outcome: 'no_effect' });
    await runApply(eventId);
    expect(await eventRow(eventId)).toEqual(settled);
  });
});

describe('09.1 store events', () => {
  const STORE_PREFIX = 'payapplystore';
  const NAME = `${PREFIX}-store`;
  const purchases: PaymentsPurchaseConfirmed[] = [];
  let unsubscribePurchase: () => void = () => {};
  let restoreStore: () => Promise<void> = async () => {};
  let labAdmin = '';
  let demoAdmin = '';
  let community = '';
  let product = '';
  let other: Awaited<ReturnType<typeof personWithEmail>>;
  const PRICE = 99_900;

  const order = async (userId: string, productId = product) =>
    adminSql<{ status: string; amount_cents: number; provider: string; provider_ref: string }[]>`
      select status, amount_cents, provider, provider_ref from public.store_orders
       where user_id = ${userId}::uuid and product_id = ${productId}::uuid order by created_at, id`;

  const entitlements = async (userId: string, productId = product) =>
    adminSql<{ status: string }[]>`
      select status from public.store_entitlements
       where user_id = ${userId}::uuid and product_id = ${productId}::uuid order by created_at, id`;

  const locked = async (who: { token: string }, communityId = community): Promise<boolean> => {
    const res = await api.request(`/v1/store/communities/${communityId}/access`, {
      headers: { [TENANT_HOST_HEADER]: HOSTS.lab, authorization: `Bearer ${who.token}` },
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { locked: boolean }).locked;
  };

  /** A fresh integration and a store-product mapping for `productId`; returns the gateway product id. */
  const mapStore = async (productId = product) => {
    const externalProductId = `sp-${crypto.randomUUID()}`;
    await seedPaymentMapping(labTenantId, {
      kind: 'store_product',
      targetId: productId,
      externalProductId,
    });
    return externalProductId;
  };

  const storeSale = (
    type: string,
    f: { ref: string; productId: string; email: string } & Record<string, unknown>,
  ) => {
    const { ref, productId, email, ...rest } = f;
    return {
      type,
      externalRef: ref,
      productId,
      email,
      amountCents: 12_345,
      currency: 'BRL',
      recurring: false,
      ...rest,
    };
  };

  beforeAll(async () => {
    restoreStore = await withStoreEnabled('lab');
    const [lab] = await adminSql<{ user_id: string }[]>`
      select user_id::text as user_id from public.memberships
       where tenant_id = ${labTenantId}::uuid and role = 'admin_tenant' limit 1`;
    const [demo] = await adminSql<{ user_id: string }[]>`
      select user_id::text as user_id from public.memberships
       where tenant_id = ${demoTenantId}::uuid and role = 'admin_tenant' limit 1`;
    labAdmin = lab?.user_id ?? '';
    demoAdmin = demo?.user_id ?? '';
    await removeIdentitiesByPrefix(STORE_PREFIX);
    await sweepStore();
    const [c] = await adminSql<{ id: string }[]>`
      insert into public.communities (tenant_id, created_by_user_id, name, slug)
      values (${labTenantId}::uuid, ${labAdmin}::uuid, ${`${NAME} comunidade`}, ${`${NAME}-c`})
      returning id::text as id`;
    community = c?.id ?? '';
    product = await insertProduct(labTenantId, labAdmin, 'curso', PRICE);
    await adminSql`
      insert into public.store_product_communities (tenant_id, product_id, community_id)
      values (${labTenantId}::uuid, ${product}::uuid, ${community}::uuid)`;
    other = await personWithEmail(freshEmail(STORE_PREFIX, 'other'), 'lab');
    unsubscribePurchase = subscribe('payments.purchase_confirmed', async (payload) => {
      purchases.push(payload);
    });
  }, 60_000);

  afterEach(() => {
    purchases.length = 0;
  });

  afterAll(async () => {
    unsubscribePurchase();
    await removeIdentitiesByPrefix(STORE_PREFIX);
    await sweepStore();
    await restoreStore();
  }, 60_000);

  async function insertProduct(
    tenantId: string,
    adminId: string,
    label: string,
    priceCents: number,
  ): Promise<string> {
    const [row] = await adminSql<{ id: string }[]>`
      insert into public.store_products (tenant_id, created_by_user_id, name, price_cents, status)
      values (${tenantId}::uuid, ${adminId}::uuid, ${`${NAME} ${label}`}, ${priceCents}, 'active')
      returning id::text as id`;
    return row?.id ?? '';
  }

  async function sweepStore(): Promise<void> {
    const products = adminSql`select id from public.store_products where name like ${`${NAME}%`}`;
    await adminSql`delete from public.store_entitlements where product_id in (${products})`;
    await adminSql`delete from public.store_orders where product_id in (${products})`;
    await removePaymentMappings(labTenantId);
    await removePaymentMappings(demoTenantId);
    await adminSql`delete from public.store_products where name like ${`${NAME}%`}`;
    await adminSql`delete from public.communities where name like ${`${NAME}%`}`;
  }

  it('an approved purchase for a live member e-mail unlocks the community for that member only, at the amount paid, with one confirmation (D-505, D-507)', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const gatewayProduct = await mapStore();
    const buyer = await personWithEmail(freshEmail(STORE_PREFIX, 'buyer'), 'lab');
    expect(await locked(buyer)).toBe(true);
    const ref = `ord-${crypto.randomUUID()}`;
    const body = storeSale('purchase_approved', {
      ref,
      productId: gatewayProduct,
      email: buyer.email,
      orderRef: `same-${ref}`,
    });

    const eventId = await deliver(integration, body);
    await runApply(eventId);
    expect(await eventRow(eventId)).toMatchObject({ state: 'applied', outcome: 'product_granted' });
    expect(await order(buyer.userId)).toEqual([
      { status: 'paid', amount_cents: 12_345, provider: 'fake', provider_ref: ref },
    ]);
    expect(await entitlements(buyer.userId)).toEqual([{ status: 'active' }]);
    expect(await locked(buyer)).toBe(false);
    expect(await locked(other)).toBe(true);
    expect(purchases).toEqual([
      {
        tenantId: labTenantId,
        userId: buyer.userId,
        productId: product,
        productName: `${NAME} curso`,
      },
    ]);

    // The very same delivery again (same bytes → the same event row) changes nothing.
    expect(await deliver(integration, body)).toBe(eventId);
    await runApply(eventId);
    expect(await order(buyer.userId)).toHaveLength(1);
    expect(purchases).toHaveLength(1);

    // A re-sent body of the same sale (other bytes) is a second event: already held, no second order.
    const resent = await deliverAndApply(integration, { ...body, orderRef: 'resent' });
    expect(resent).toMatchObject({ state: 'applied', outcome: 'no_effect' });
    expect(await order(buyer.userId)).toHaveLength(1);
    expect(await entitlements(buyer.userId)).toHaveLength(1);
    expect(purchases).toHaveLength(1);
  });

  it('a refund locks the community, revokes order and entitlement, and a LATE approval of the same one-off reference is stale (T-09.1-33)', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const gatewayProduct = await mapStore();
    const buyer = await personWithEmail(freshEmail(STORE_PREFIX, 'refund'), 'lab');
    const ref = `ord-${crypto.randomUUID()}`;
    const send = (type: string) =>
      deliverAndApply(
        integration,
        storeSale(type, { ref, productId: gatewayProduct, email: buyer.email }),
      );

    expect(await send('purchase_approved')).toMatchObject({ outcome: 'product_granted' });
    expect(await locked(buyer)).toBe(false);

    const refunded = await send('purchase_refunded');
    expect(refunded).toMatchObject({ state: 'applied', outcome: 'product_revoked' });
    expect(await locked(buyer)).toBe(true);
    expect((await order(buyer.userId))[0]?.status).toBe('revoked');
    expect(await entitlements(buyer.userId)).toEqual([{ status: 'revoked' }]);

    const late = await send('purchase_approved');
    expect(late).toMatchObject({ state: 'ignored', outcome: 'stale' });
    expect(await locked(buyer)).toBe(true);
    expect(await order(buyer.userId)).toHaveLength(1);
    expect(purchases).toHaveLength(1);

    // A chargeback of another sale behaves the same way.
    const ref2 = `ord-${crypto.randomUUID()}`;
    const send2 = (type: string) =>
      deliverAndApply(
        integration,
        storeSale(type, { ref: ref2, productId: gatewayProduct, email: buyer.email }),
      );
    expect(await send2('purchase_approved')).toMatchObject({ outcome: 'product_granted' });
    expect(await send2('chargeback')).toMatchObject({ outcome: 'product_revoked' });
    expect(await send2('purchase_approved')).toMatchObject({ state: 'ignored', outcome: 'stale' });
  });

  it('a refund that arrives before any purchase is applied as no_effect, and the purchase after it is stale', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const gatewayProduct = await mapStore();
    const buyer = await personWithEmail(freshEmail(STORE_PREFIX, 'early'), 'lab');
    const ref = `ord-${crypto.randomUUID()}`;
    const send = (type: string) =>
      deliverAndApply(
        integration,
        storeSale(type, { ref, productId: gatewayProduct, email: buyer.email }),
      );
    expect(await send('purchase_refunded')).toMatchObject({
      state: 'applied',
      outcome: 'no_effect',
    });
    expect(await send('purchase_approved')).toMatchObject({ state: 'ignored', outcome: 'stale' });
    expect(await order(buyer.userId)).toEqual([]);
    expect(purchases).toHaveLength(0);
  });

  it('a recurring sale: the cancel revokes, the renewal after it buys again as a NEW order, a renewal while active adds none (A-P11, D-505)', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const gatewayProduct = await mapStore();
    const buyer = await personWithEmail(freshEmail(STORE_PREFIX, 'sub'), 'lab');
    const ref = `sub-${crypto.randomUUID()}`;
    const send = (type: string) =>
      deliverAndApply(
        integration,
        storeSale(type, { ref, productId: gatewayProduct, email: buyer.email, recurring: true }),
      );

    expect(await send('purchase_approved')).toMatchObject({ outcome: 'product_granted' });
    expect(await send('subscription_renewed')).toMatchObject({
      state: 'applied',
      outcome: 'no_effect',
    });
    expect(await order(buyer.userId)).toHaveLength(1);

    expect(await send('subscription_canceled')).toMatchObject({ outcome: 'product_revoked' });
    expect(await locked(buyer)).toBe(true);

    expect(await send('subscription_renewed')).toMatchObject({ outcome: 'product_granted' });
    expect(await locked(buyer)).toBe(false);
    const orders = await order(buyer.userId);
    expect(orders.map((o) => o.status)).toEqual(['revoked', 'paid']);
    expect(await entitlements(buyer.userId)).toHaveLength(2);
    expect(purchases).toHaveLength(2);

    // A late payment suspends the same way a cancel does.
    expect(await send('subscription_late')).toMatchObject({ outcome: 'product_revoked' });
    expect(await locked(buyer)).toBe(true);
  });

  it('D-490 / PR-7: an e-mail with no LIVE membership of the tenant is no_membership and nothing is written, however close it is', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const gatewayProduct = await mapStore();
    const local = `${STORE_PREFIX}-nm${crypto.randomUUID().slice(0, 8)}`;
    const account = await personWithEmail(`${local}@rede-demo.local`, 'lab');
    const blocked = await personWithEmail(freshEmail(STORE_PREFIX, 'blk'), 'lab');
    const deleted = await personWithEmail(freshEmail(STORE_PREFIX, 'del'), 'lab');
    await adminSql`
      update public.memberships set status = 'blocked', blocked_at = now()
       where id = ${blocked.membershipId}::uuid`;
    await adminSql`
      update public.memberships set deleted_at = now() where id = ${deleted.membershipId}::uuid`;

    const cases: [string, string, string?][] = [
      ['no account at all', freshEmail(STORE_PREFIX, 'ghost')],
      ['plus-address of an account', `${local}+x@rede-demo.local`],
      ['a blocked membership', blocked.email],
      ['a soft-deleted membership', deleted.email],
    ];
    for (const [label, email] of cases) {
      const settled = await deliverAndApply(
        integration,
        storeSale('purchase_approved', {
          ref: `ord-${crypto.randomUUID()}`,
          productId: gatewayProduct,
          email,
        }),
      );
      expect(settled, label).toMatchObject({ state: 'no_membership', outcome: null });
    }
    for (const who of [account, blocked, deleted]) {
      expect(await order(who.userId)).toEqual([]);
      expect(await entitlements(who.userId)).toEqual([]);
    }
    // The same address with different CASE and padding is the SAME e-mail (the inbox normalises it).
    const upper = await deliverAndApply(
      integration,
      storeSale('purchase_approved', {
        ref: `ord-${crypto.randomUUID()}`,
        productId: gatewayProduct,
        email: `  ${account.email.toUpperCase()} `,
      }),
    );
    expect(upper).toMatchObject({ state: 'applied', outcome: 'product_granted' });
    expect(await order(account.userId)).toHaveLength(1);
    expect(purchases).toHaveLength(1);
  });

  it('an unmapped product id is unknown_product, another currency is currency_unsupported, an event with no effect or no e-mail is no_effect', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const gatewayProduct = await mapStore();
    const buyer = await personWithEmail(freshEmail(STORE_PREFIX, 'odd'), 'lab');
    const base = (extra: Record<string, unknown>) =>
      storeSale('purchase_approved', {
        ref: `ord-${crypto.randomUUID()}`,
        productId: gatewayProduct,
        email: buyer.email,
        ...extra,
      });

    expect(
      await deliverAndApply(integration, base({ productId: `nope-${crypto.randomUUID()}` })),
    ).toMatchObject({ state: 'unknown_product', outcome: null });
    expect(await deliverAndApply(integration, base({ currency: 'USD' }))).toMatchObject({
      state: 'ignored',
      outcome: 'currency_unsupported',
    });
    expect(await deliverAndApply(integration, base({ type: 'boleto_generated' }))).toMatchObject({
      state: 'ignored',
      outcome: 'no_effect',
    });
    expect(await deliverAndApply(integration, base({ email: null }))).toMatchObject({
      state: 'ignored',
      outcome: 'no_effect',
    });
    expect(await deliverAndApply(integration, base({ externalRef: null }))).toMatchObject({
      state: 'ignored',
      outcome: 'no_effect',
    });
    expect(await deliverAndApply(integration, base({ amountCents: null }))).toMatchObject({
      state: 'ignored',
      outcome: 'no_effect',
    });
    expect(await deliverAndApply(integration, { type: 'other' })).toMatchObject({
      state: 'ignored',
      outcome: 'no_effect',
    });
    expect(await order(buyer.userId)).toEqual([]);
    expect(purchases).toHaveLength(0);
  });

  it('a refund still locks the product when the buyer has been blocked since (the sale reference identifies the order)', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const gatewayProduct = await mapStore();
    const buyer = await personWithEmail(freshEmail(STORE_PREFIX, 'blkref'), 'lab');
    const ref = `ord-${crypto.randomUUID()}`;
    const send = (type: string) =>
      deliverAndApply(
        integration,
        storeSale(type, { ref, productId: gatewayProduct, email: buyer.email }),
      );
    expect(await send('purchase_approved')).toMatchObject({ outcome: 'product_granted' });
    await adminSql`
      update public.memberships set status = 'blocked', blocked_at = now()
       where id = ${buyer.membershipId}::uuid`;
    expect(await send('purchase_refunded')).toMatchObject({
      state: 'applied',
      outcome: 'product_revoked',
    });
    expect(await entitlements(buyer.userId)).toEqual([{ status: 'revoked' }]);
  });

  it('PAY-29: a delivery signed by tenant A that names tenant B mapped store product leaves B ledgers empty', async () => {
    integration = await seedPaymentIntegration(labTenantId);
    const foreignProduct = await insertProduct(demoTenantId, demoAdmin, 'foreign', 5_000);
    const foreignGateway = `sp-${crypto.randomUUID()}`;
    await seedPaymentMapping(demoTenantId, {
      kind: 'store_product',
      targetId: foreignProduct,
      externalProductId: foreignGateway,
    });
    const buyer = await personWithEmail(freshEmail(STORE_PREFIX, 'pin'), 'lab');
    const demoBuyer = await personWithEmail(freshEmail(STORE_PREFIX, 'pind'), 'demo');

    for (const email of [buyer.email, demoBuyer.email]) {
      const settled = await deliverAndApply(
        integration,
        storeSale('purchase_approved', {
          ref: `ord-${crypto.randomUUID()}`,
          productId: foreignGateway,
          email,
        }),
      );
      expect(settled).toMatchObject({ state: 'unknown_product', tenant_id: labTenantId });
    }
    for (const who of [buyer, demoBuyer]) {
      expect(await order(who.userId, foreignProduct)).toEqual([]);
      expect(await entitlements(who.userId, foreignProduct)).toEqual([]);
    }
    const [leaked] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.store_orders where product_id = ${foreignProduct}::uuid`;
    expect(leaked?.n).toBe(0);
  });
});
