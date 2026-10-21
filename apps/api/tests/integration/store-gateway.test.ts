import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import {
  type CommunityAccess,
  type ProductCard,
  type ProductDetail,
  type ProductPage,
  productCardSchema,
  productDetailSchema,
} from '@rede-social/module-store/contracts';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  removePaymentIntegrations,
  removePaymentMappings,
  SEED_PASSWORD,
  seedPaymentIntegration,
  seedPaymentMapping,
  setPaymentsRow,
  signInAs,
  withStoreEnabled,
} from './setup';

/**
 * 09.1-06 (D-505..D-509, PAY-23..PAY-27): the store half of the gateway, against the live local stack
 * and the real seed, on rede-lab.
 *
 *  - `09.1 tracer`: a tenant whose gateway is on cannot reach the simulated unlock (the guard lives in
 *    `app.store_purchase`, so a stale product read does not matter), the product read carries the mode
 *    and the stored checkout link, and the admin-lane definers `app.store_gateway_purchase` and
 *    `app.store_gateway_revoke` unlock and lock a product (and the community it opens) at the amount
 *    the gateway reports.
 *  - `09.1 edges`: replays (P56), races (P57), amount bounds (P59), empty arguments (P62) and the
 *    provider / reference encoding (P63), table-driven.
 *  - `09.1 buyable and revenue` (Task 2 of the plan).
 *
 * Every product, community and identity this file creates carries the prefix `sg-<run>` / `sg`, and
 * both hooks sweep it. The `payments` module row and the integration are put back in `afterAll`.
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order).
 */

const RUN = Date.now();
const PREFIX = `sg-${RUN}`;
const IDENTITY_PREFIX = 'sgw';

type Outcome = {
  outcome: string;
  order_id: string | null;
  product_name: string | null;
  user_id: string | null;
};
type RevokeOutcome = { outcome: string; user_id: string | null; product_id: string | null };

const ids = {
  tenant: '',
  admin: '',
  community: '',
  product: '',
  mapping: '',
  memberA: { user: '', membership: '', token: '' },
  memberB: { user: '', membership: '', token: '' },
  memberC: { user: '', membership: '', token: '' },
};
const LINK = 'https://pay.example/checkout/sg-product';

let restoreStore: () => Promise<void> = async () => {};
let previousPayments: { enabled: boolean; settings: Record<string, unknown> } | undefined;

/** A separate pool: `adminSql` has one connection, and the race cases need several at once. */
const racePool = postgres('postgres://postgres:postgres@127.0.0.1:54322/postgres', {
  prepare: false,
  max: 8,
});

const request = (path: string, token: string, init: RequestInit = {}) =>
  api.request(path, {
    ...init,
    headers: {
      [TENANT_HOST_HEADER]: HOSTS.lab,
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });

const buy = (productId: string, expectedAmountCents: number, token: string) =>
  request(`/v1/store/products/${productId}/purchase`, token, {
    method: 'POST',
    body: JSON.stringify({ expectedAmountCents }),
  });

async function readProduct(productId: string, token: string): Promise<ProductDetail> {
  const res = await request(`/v1/store/products/${productId}`, token);
  expect(res.status).toBe(200);
  return productDetailSchema.parse(await res.json());
}

async function communityAccess(communityId: string, token: string): Promise<CommunityAccess> {
  const res = await request(`/v1/store/communities/${communityId}/access`, token);
  expect(res.status).toBe(200);
  return (await res.json()) as CommunityAccess;
}

/** Calls the admin-lane purchase definer as `service_role` on a connection of `pool`. */
async function gatewayPurchase(
  args: {
    tenant?: string | null;
    membership: string | null;
    product: string | null;
    provider?: string | null;
    ref?: string | null;
    amount?: number | null;
    paidAt?: string | null;
  },
  pool: postgres.Sql = adminSql,
): Promise<Outcome> {
  const rows = await pool.begin(async (tx) => {
    await tx`set local role service_role`;
    return tx<Outcome[]>`
      select outcome, order_id::text as order_id, product_name, user_id::text as user_id
        from app.store_gateway_purchase(
               ${args.tenant === undefined ? ids.tenant : args.tenant}::uuid,
               ${args.membership}::uuid,
               ${args.product}::uuid,
               ${args.provider === undefined ? 'acme' : args.provider}::text,
               ${args.ref === undefined ? `ref-${crypto.randomUUID()}` : args.ref}::text,
               ${args.amount === undefined ? 1990 : args.amount}::int,
               ${args.paidAt === undefined ? null : args.paidAt}::timestamptz)`;
  });
  const row = rows[0];
  if (!row) throw new Error('store_gateway_purchase returned no row');
  return row;
}

/** Calls the admin-lane revoke definer as `service_role` on a connection of `pool`. */
async function gatewayRevoke(
  args: { tenant?: string | null; provider?: string | null; ref: string | null },
  pool: postgres.Sql = adminSql,
): Promise<RevokeOutcome> {
  const rows = await pool.begin(async (tx) => {
    await tx`set local role service_role`;
    return tx<RevokeOutcome[]>`
      select outcome, user_id::text as user_id, product_id::text as product_id
        from app.store_gateway_revoke(
               ${args.tenant === undefined ? ids.tenant : args.tenant}::uuid,
               ${args.provider === undefined ? 'acme' : args.provider}::text,
               ${args.ref}::text)`;
  });
  const row = rows[0];
  if (!row) throw new Error('store_gateway_revoke returned no row');
  return row;
}

/** A throwaway product of rede-lab (admin-lane insert), linked to nothing unless told. */
async function insertProduct(
  name: string,
  priceCents: number,
  status: 'active' | 'archived' = 'active',
): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.store_products (tenant_id, created_by_user_id, name, price_cents, status)
    values (${ids.tenant}::uuid, ${ids.admin}::uuid, ${`${PREFIX} ${name}`}, ${priceCents}, ${status})
    returning id::text as id`;
  return row?.id ?? '';
}

type Ledger = { orders: number; live: number; active: number; revoked: number };

/** The ledger rows of one (member, product) pair. */
async function ledger(userId: string, productId: string): Promise<Ledger> {
  const [row] = await adminSql<Ledger[]>`
    select (select count(*)::int from public.store_orders
             where user_id = ${userId}::uuid and product_id = ${productId}::uuid) as orders,
           (select count(*)::int from public.store_orders
             where user_id = ${userId}::uuid and product_id = ${productId}::uuid
               and status in ('pending','paid')) as live,
           (select count(*)::int from public.store_entitlements
             where user_id = ${userId}::uuid and product_id = ${productId}::uuid
               and status = 'active') as active,
           (select count(*)::int from public.store_entitlements
             where user_id = ${userId}::uuid and product_id = ${productId}::uuid
               and status = 'revoked') as revoked`;
  return row ?? { orders: -1, live: -1, active: -1, revoked: -1 };
}

async function orderCount(productId: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.store_orders where product_id = ${productId}::uuid`;
  return row?.n ?? -1;
}

async function sweep(): Promise<void> {
  const products = adminSql`
    select id from public.store_products
     where tenant_id = ${ids.tenant}::uuid and name like ${'sg-%'}`;
  await adminSql`delete from public.store_entitlements where product_id in (${products})`;
  await adminSql`delete from public.store_orders where product_id in (${products})`;
  await removePaymentMappings(ids.tenant);
  await adminSql`
    delete from public.store_products where tenant_id = ${ids.tenant}::uuid and name like ${'sg-%'}`;
  await adminSql`
    delete from public.communities where tenant_id = ${ids.tenant}::uuid and name like ${'sg-%'}`;
}

/** Puts the tenant's `payments` module row to a given state; settings stay empty (no gate). */
async function paymentsModule(enabled: boolean): Promise<void> {
  await setPaymentsRow(ids.tenant, { enabled, settings: {} });
}

beforeAll(async () => {
  const [lab] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-lab'`;
  ids.tenant = lab?.id ?? '';
  const [admin] = await adminSql<{ user_id: string }[]>`
    select user_id::text as user_id from public.memberships
     where tenant_id = ${ids.tenant}::uuid and role = 'admin_tenant' limit 1`;
  ids.admin = admin?.user_id ?? '';

  await removeIdentitiesByPrefix(IDENTITY_PREFIX);
  await removePaymentIntegrations(ids.tenant);
  await sweep();

  [previousPayments] = await adminSql<{ enabled: boolean; settings: Record<string, unknown> }[]>`
    select enabled, settings from public.tenant_modules
     where tenant_id = ${ids.tenant}::uuid and module_key = 'payments'`;
  await adminSql`
    delete from public.tenant_modules
     where tenant_id = ${ids.tenant}::uuid and module_key = 'payments'`;
  restoreStore = await withStoreEnabled('lab');

  for (const key of ['memberA', 'memberB', 'memberC'] as const) {
    const identity = await createSharedIdentity({
      prefix: IDENTITY_PREFIX,
      memberships: [{ host: 'lab' }],
    });
    const [membership] = await adminSql<{ id: string }[]>`
      select id::text as id from public.memberships
       where tenant_id = ${ids.tenant}::uuid and user_id = ${identity.userId}::uuid`;
    ids[key] = {
      user: identity.userId,
      membership: membership?.id ?? '',
      token: await signInAs(identity.email, SEED_PASSWORD),
    };
  }

  const [community] = await adminSql<{ id: string }[]>`
    insert into public.communities (tenant_id, created_by_user_id, name, slug)
    values (${ids.tenant}::uuid, ${ids.admin}::uuid, ${`${PREFIX} comunidade`}, ${`${PREFIX}-c`})
    returning id::text as id`;
  ids.community = community?.id ?? '';
  ids.product = await insertProduct('curso', 1990);
  await adminSql`
    insert into public.store_product_communities (tenant_id, product_id, community_id)
    values (${ids.tenant}::uuid, ${ids.product}::uuid, ${ids.community}::uuid)`;
}, 60_000);

afterAll(async () => {
  await sweep();
  await removePaymentIntegrations(ids.tenant);
  if (previousPayments) {
    await setPaymentsRow(ids.tenant, {
      enabled: previousPayments.enabled,
      settings: previousPayments.settings,
    });
  } else {
    await adminSql`
      delete from public.tenant_modules
       where tenant_id = ${ids.tenant}::uuid and module_key = 'payments'`;
  }
  await restoreStore();
  moduleFlags.invalidate(ids.tenant);
  await removeIdentitiesByPrefix(IDENTITY_PREFIX);
  await racePool.end();
}, 60_000);

describe('09.1 tracer', () => {
  let staleRead: ProductDetail;

  it('with no gateway the simulated purchase works exactly as before and the product reads simulated', async () => {
    staleRead = await readProduct(ids.product, ids.memberB.token);
    expect(staleRead.purchase).toEqual({ mode: 'simulated', checkoutUrl: null });

    const bought = await buy(ids.product, 1990, ids.memberA.token);
    expect(bought.status).toBe(200);
    const [order] = await adminSql<{ provider: string; amount_cents: number; status: string }[]>`
      select provider, amount_cents, status from public.store_orders
       where user_id = ${ids.memberA.user}::uuid and product_id = ${ids.product}::uuid`;
    expect(order).toEqual({ provider: 'none', amount_cents: 1990, status: 'paid' });
  });

  it('D-508 / P61: once a gateway is on, a non-holder is refused 409 unavailable even with a stale read, and nothing is written; a holder replaying still gets 200', async () => {
    const mapping = await seedPaymentMapping(ids.tenant, {
      targetId: ids.product,
      checkoutUrl: LINK,
    });
    ids.mapping = mapping.id;
    await seedPaymentIntegration(ids.tenant);
    await paymentsModule(true);

    // staleRead (taken BEFORE the integration existed) said simulated: the database decides anyway.
    expect(staleRead.purchase?.mode).toBe('simulated');
    const refused = await buy(ids.product, 1990, ids.memberB.token);
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as { error: { code: string; details?: unknown } };
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.details).toEqual({ store: 'unavailable' });
    expect(await ledger(ids.memberB.user, ids.product)).toEqual({
      orders: 0,
      live: 0,
      active: 0,
      revoked: 0,
    });

    const replay = await buy(ids.product, 1990, ids.memberA.token);
    expect(replay.status).toBe(200);
    expect(await ledger(ids.memberA.user, ids.product)).toMatchObject({ orders: 1, active: 1 });
  });

  it('D-506: the product read carries the mode and the stored link; simulated with no link while the module is off', async () => {
    const detail = await readProduct(ids.product, ids.memberB.token);
    expect(detail.purchase).toEqual({ mode: 'gateway', checkoutUrl: LINK });

    const res = await request('/v1/store/products', ids.memberB.token);
    expect(res.status).toBe(200);
    const page = (await res.json()) as ProductPage;
    const card = page.items.find((item) => item.id === ids.product) as ProductCard;
    expect(productCardSchema.parse(card).purchase).toEqual({ mode: 'gateway', checkoutUrl: LINK });

    await paymentsModule(false);
    const off = await readProduct(ids.product, ids.memberB.token);
    expect(off.purchase).toEqual({ mode: 'simulated', checkoutUrl: null });
    await paymentsModule(true);
  });

  it('D-509 / D-507 / PAY-27: the admin lane unlocks the product at the amount charged; a refund locks it again; a second revoke is not_found; the member can buy again', async () => {
    const ref = `sub-${crypto.randomUUID()}`;
    expect((await communityAccess(ids.community, ids.memberB.token)).locked).toBe(true);
    expect((await communityAccess(ids.community, ids.memberC.token)).locked).toBe(true);

    const bought = await gatewayPurchase({
      membership: ids.memberB.membership,
      product: ids.product,
      ref,
      amount: 12345,
      paidAt: '2026-10-01T12:00:00Z',
    });
    expect(bought.outcome).toBe('purchased');
    expect(bought.user_id).toBe(ids.memberB.user);
    expect(bought.product_name).toBe(`${PREFIX} curso`);
    expect(bought.order_id).not.toBeNull();

    // The member now owns it; the community is open for the buyer and still locked for another.
    expect((await readProduct(ids.product, ids.memberB.token)).owned).toBe(true);
    expect((await communityAccess(ids.community, ids.memberB.token)).locked).toBe(false);
    expect((await communityAccess(ids.community, ids.memberC.token)).locked).toBe(true);

    const [order] = await adminSql<
      {
        provider: string;
        provider_ref: string;
        amount_cents: number;
        currency: string;
        status: string;
        paid_at: Date;
      }[]
    >`
      select provider, provider_ref, amount_cents, currency, status, paid_at
        from public.store_orders where id = ${bought.order_id}::uuid`;
    expect(order).toMatchObject({
      provider: 'acme',
      provider_ref: ref,
      amount_cents: 12345,
      currency: 'BRL',
      status: 'paid',
    });
    expect(order?.paid_at.toISOString()).toBe('2026-10-01T12:00:00.000Z');
    const [entitlement] = await adminSql<{ source: string; order_id: string; status: string }[]>`
      select source, order_id::text as order_id, status from public.store_entitlements
       where user_id = ${ids.memberB.user}::uuid and product_id = ${ids.product}::uuid`;
    expect(entitlement).toEqual({
      source: 'purchase',
      order_id: bought.order_id,
      status: 'active',
    });

    // The same delivery again changes nothing.
    const again = await gatewayPurchase({
      membership: ids.memberB.membership,
      product: ids.product,
      ref,
      amount: 12345,
    });
    expect(again.outcome).toBe('already_active');
    expect(await ledger(ids.memberB.user, ids.product)).toMatchObject({ orders: 1, active: 1 });

    // The refund.
    const revoked = await gatewayRevoke({ ref });
    expect(revoked).toEqual({
      outcome: 'revoked',
      user_id: ids.memberB.user,
      product_id: ids.product,
    });
    expect((await communityAccess(ids.community, ids.memberB.token)).locked).toBe(true);
    const [after] = await adminSql<{ status: string; revoked_at: Date | null }[]>`
      select status, revoked_at from public.store_orders where id = ${bought.order_id}::uuid`;
    expect(after?.status).toBe('revoked');
    expect(after?.revoked_at).not.toBeNull();
    const [ended] = await adminSql<
      { status: string; revoked_at: Date | null; revoked_by_user_id: string | null }[]
    >`
      select status, revoked_at, revoked_by_user_id::text as revoked_by_user_id
        from public.store_entitlements
       where user_id = ${ids.memberB.user}::uuid and product_id = ${ids.product}::uuid`;
    expect(ended?.status).toBe('revoked');
    expect(ended?.revoked_at).not.toBeNull();
    expect(ended?.revoked_by_user_id).toBeNull();

    // Idempotent: the same refund again is not_found and changes nothing.
    expect((await gatewayRevoke({ ref })).outcome).toBe('not_found');
    expect(await ledger(ids.memberB.user, ids.product)).toMatchObject({
      orders: 1,
      live: 0,
      active: 0,
      revoked: 1,
    });

    // D-359: both arbiters are free, so the same reference may buy again, as a NEW order.
    const renewed = await gatewayPurchase({
      membership: ids.memberB.membership,
      product: ids.product,
      ref,
      amount: 12345,
    });
    expect(renewed.outcome).toBe('purchased');
    expect(renewed.order_id).not.toBe(bought.order_id);
    expect(await ledger(ids.memberB.user, ids.product)).toMatchObject({
      orders: 2,
      live: 1,
      active: 1,
      revoked: 1,
    });
    expect((await communityAccess(ids.community, ids.memberB.token)).locked).toBe(false);
  });
});

describe('09.1 edges', () => {
  const AMOUNTS: [number, string][] = [
    [0, 'purchased'],
    [10_000_000, 'purchased'],
    [-1, 'not_found'],
    [10_000_001, 'not_found'],
  ];

  it('P59: 0 and 10 000 000 are accepted, -1 and 10 000 001 are not_found and write nothing', async () => {
    for (const [amount, expected] of AMOUNTS) {
      const product = await insertProduct(`amount-${amount}`, 100);
      const out = await gatewayPurchase({
        membership: ids.memberA.membership,
        product,
        amount,
      });
      expect(out.outcome, `amount ${amount}`).toBe(expected);
      const rows = await ledger(ids.memberA.user, product);
      expect(rows.orders, `amount ${amount}`).toBe(expected === 'purchased' ? 1 : 0);
      if (expected === 'purchased') {
        const [order] = await adminSql<{ amount_cents: number }[]>`
          select amount_cents from public.store_orders where id = ${out.order_id}::uuid`;
        expect(order?.amount_cents).toBe(amount);
      }
    }
  });

  it('P56: the same purchase twice leaves one order and one entitlement; the same refund twice revokes once', async () => {
    const product = await insertProduct('replay', 700);
    const ref = `order-${crypto.randomUUID()}`;
    const first = await gatewayPurchase({
      membership: ids.memberC.membership,
      product,
      ref,
      amount: 700,
    });
    expect(first.outcome).toBe('purchased');
    const second = await gatewayPurchase({
      membership: ids.memberC.membership,
      product,
      ref,
      amount: 700,
    });
    expect(second.outcome).toBe('already_active');
    expect(await ledger(ids.memberC.user, product)).toMatchObject({
      orders: 1,
      live: 1,
      active: 1,
    });

    expect((await gatewayRevoke({ ref })).outcome).toBe('revoked');
    expect((await gatewayRevoke({ ref })).outcome).toBe('not_found');
    expect(await ledger(ids.memberC.user, product)).toMatchObject({
      orders: 1,
      live: 0,
      active: 0,
      revoked: 1,
    });
  });

  it('already_active: a member who holds the product through an admin grant writes nothing when a sale arrives (A-P27)', async () => {
    const product = await insertProduct('granted', 800);
    await adminSql`
      insert into public.store_entitlements (tenant_id, user_id, product_id, source, granted_by_user_id)
      values (${ids.tenant}::uuid, ${ids.memberA.user}::uuid, ${product}::uuid, 'grant',
              ${ids.admin}::uuid)`;
    const out = await gatewayPurchase({
      membership: ids.memberA.membership,
      product,
      amount: 800,
    });
    expect(out.outcome).toBe('already_active');
    expect(await ledger(ids.memberA.user, product)).toMatchObject({ orders: 0, active: 1 });
  });

  it('an archived product is still granted: the money was paid', async () => {
    const product = await insertProduct('arquivado', 900, 'archived');
    const out = await gatewayPurchase({
      membership: ids.memberA.membership,
      product,
      amount: 900,
    });
    expect(out.outcome).toBe('purchased');
    expect(await ledger(ids.memberA.user, product)).toMatchObject({ orders: 1, active: 1 });
  });

  it('P57: two simultaneous purchases of one reference leave one live order and one active entitlement', async () => {
    const product = await insertProduct('race-same-ref', 500);
    const ref = `order-${crypto.randomUUID()}`;
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () =>
        gatewayPurchase(
          { membership: ids.memberA.membership, product, ref, amount: 500 },
          racePool,
        ),
      ),
    );
    expect(outcomes.filter((o) => o.outcome === 'purchased')).toHaveLength(1);
    expect(outcomes.filter((o) => o.outcome === 'already_active')).toHaveLength(5);
    expect(await ledger(ids.memberA.user, product)).toMatchObject({
      orders: 1,
      live: 1,
      active: 1,
    });
  });

  it('P57: a revoke racing a purchase of the same member and product ends with at most one live order and one active entitlement', async () => {
    const product = await insertProduct('race-revoke', 500);
    const ref = `sub-${crypto.randomUUID()}`;
    expect(
      (
        await gatewayPurchase({
          membership: ids.memberA.membership,
          product,
          ref,
          amount: 500,
        })
      ).outcome,
    ).toBe('purchased');
    const settled = await Promise.all([
      gatewayRevoke({ ref }, racePool),
      gatewayPurchase({ membership: ids.memberA.membership, product, ref, amount: 500 }, racePool),
      gatewayRevoke({ ref }, racePool),
      gatewayPurchase({ membership: ids.memberA.membership, product, ref, amount: 500 }, racePool),
    ]);
    for (const out of settled) {
      expect(['purchased', 'already_active', 'revoked', 'not_found']).toContain(out.outcome);
    }
    const rows = await ledger(ids.memberA.user, product);
    expect(rows.live).toBeLessThanOrEqual(1);
    expect(rows.active).toBeLessThanOrEqual(1);
    // The order and the entitlement of a pair move together: live order iff active entitlement.
    expect(rows.live).toBe(rows.active);
  });

  it('P62: any NULL argument is not_found for the purchase and the revoke, and an empty or blank reference is refused; nothing is written', async () => {
    const product = await insertProduct('nulls', 500);
    const before = await orderCount(product);
    const base = {
      tenant: ids.tenant,
      membership: ids.memberA.membership,
      product,
      provider: 'acme',
      ref: `order-${crypto.randomUUID()}`,
      amount: 500,
    };
    for (const nulled of [
      'tenant',
      'membership',
      'product',
      'provider',
      'ref',
      'amount',
    ] as const) {
      const out = await gatewayPurchase({ ...base, [nulled]: null });
      expect(out.outcome, `null ${nulled}`).toBe('not_found');
    }
    for (const ref of ['', '   ', '\t\n']) {
      expect((await gatewayPurchase({ ...base, ref })).outcome, `ref ${JSON.stringify(ref)}`).toBe(
        'not_found',
      );
    }
    expect((await gatewayPurchase({ ...base, ref: 'x'.repeat(201) })).outcome).toBe('not_found');
    expect(await orderCount(product)).toBe(before);

    for (const args of [
      { tenant: null, provider: 'acme', ref: 'r' },
      { provider: null, ref: 'r' },
      { ref: null },
      { ref: '' },
      { ref: '   ' },
    ] as const) {
      expect((await gatewayRevoke(args)).outcome, JSON.stringify(args)).toBe('not_found');
    }
  });

  it('P63: a provider with a capital, a space or a leading digit is not_found; the reference is stored trimmed and compared exactly', async () => {
    const product = await insertProduct('encoding', 500);
    for (const provider of ['Acme', 'ac me', '1acme', 'a', `a${'b'.repeat(31)}`, '']) {
      const out = await gatewayPurchase({
        membership: ids.memberA.membership,
        product,
        provider,
        amount: 500,
      });
      expect(out.outcome, `provider ${JSON.stringify(provider)}`).toBe('not_found');
    }
    expect(await orderCount(product)).toBe(0);

    const ref = `Ref-${crypto.randomUUID()}`;
    const out = await gatewayPurchase({
      membership: ids.memberA.membership,
      product,
      ref: `  ${ref}  `,
      amount: 500,
    });
    expect(out.outcome).toBe('purchased');
    const [order] = await adminSql<{ provider_ref: string }[]>`
      select provider_ref from public.store_orders where id = ${out.order_id}::uuid`;
    expect(order?.provider_ref).toBe(ref);

    // Case-sensitive, and a Cyrillic lookalike of a Latin letter matches nothing.
    expect((await gatewayRevoke({ ref: ref.toLowerCase() })).outcome).toBe('not_found');
    expect((await gatewayRevoke({ ref: ref.replace('R', 'Р') })).outcome).toBe('not_found');
    expect((await gatewayRevoke({ provider: 'other', ref })).outcome).toBe('not_found');
    expect((await gatewayRevoke({ ref: `  ${ref}\t` })).outcome).toBe('revoked');
  });

  it('PAY-27: a membership of another tenant, a blocked one and a product of another tenant are not_found', async () => {
    const product = await insertProduct('pinning', 500);
    const [demoMember] = await adminSql<{ id: string }[]>`
      select m.id::text as id from public.memberships m
        join public.tenants t on t.id = m.tenant_id
       where t.slug = 'rede-demo' and m.role = 'member' limit 1`;
    const [demoProduct] = await adminSql<{ id: string }[]>`
      select id::text as id from public.store_products
       where tenant_id <> ${ids.tenant}::uuid limit 1`;
    expect(
      (await gatewayPurchase({ membership: demoMember?.id ?? null, product, amount: 500 })).outcome,
    ).toBe('not_found');
    if (demoProduct) {
      expect(
        (
          await gatewayPurchase({
            membership: ids.memberA.membership,
            product: demoProduct.id,
            amount: 500,
          })
        ).outcome,
      ).toBe('not_found');
    }

    await adminSql`
      update public.memberships set status = 'blocked', blocked_at = now()
       where id = ${ids.memberC.membership}::uuid`;
    try {
      expect(
        (await gatewayPurchase({ membership: ids.memberC.membership, product, amount: 500 }))
          .outcome,
      ).toBe('not_found');
    } finally {
      await adminSql`
        update public.memberships set status = 'active', blocked_at = null
         where id = ${ids.memberC.membership}::uuid`;
    }
    expect(await orderCount(product)).toBe(0);
  });
});
