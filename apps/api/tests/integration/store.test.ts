import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import type { ProductDetail, PurchaseResult } from '@rede-social/module-store/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs, withStoreEnabled } from './setup';

/**
 * The 08.2 store tracer (08.2-01, SC 3, SC 4, STORE-08, STORE-11, STORE-13) against the live local
 * stack and the real seed: an admin links a product to a community, a member then sees only that
 * community's newest post until buying the product, and staff always see everything. The gate is
 * enforced in Postgres (the restrictive `feed_posts_community_gate` policy over the kernel seam
 * `app.community_locked_ids()`), and the purchase is ONE definer call (`app.store_purchase`).
 *
 * The seed leaves `store` OFF (STORE-01), so `withStoreEnabled('demo')` turns it on in `beforeAll` and
 * its restore puts the previous row back in `afterAll`. Every product and community this file creates
 * carries the name prefix `st-<run>`, and both hooks sweep that prefix with `adminSql` (orders and
 * entitlements first, then products, whose links cascade, then the communities' posts, then the
 * communities).
 *
 * What is proved here:
 *  - `store tracer` (truth 1): `POST /v1/store/products` answers 201 for the admin with the linked
 *    community; the seed member reads ONE item (the newest post) and `nextCursor: null`; the seed
 *    admin and support read all three; the member buys with `expectedAmountCents: 1990` and gets
 *    `{ owned: true, communities: [that community] }`; the same read then returns all three, newest
 *    first.
 *  - `purchase matrix`: one cent below and above the price answers 409 `{ store: 'price_changed' }`
 *    and writes nothing, the price answers 200 (P30); a 0-cent product answers 200 with an order of
 *    `amount_cents = 0`; an archived product answers 409 `unavailable`; an unknown id and another
 *    tenant's id answer the bare 404 (no `details`); a replay answers 200 with the counts unchanged
 *    (P32); five concurrent purchases answer five 200 and leave ONE paid order and ONE active
 *    entitlement (P33); a later price edit leaves the order's amount (D-361); a `member` and a
 *    `support_tenant` creating a product get 403 (D-338); a community with no product reads in full
 *    with the store ON (P01); with the store disabled, then with no row at all, both routes answer
 *    404 `MODULE_DISABLED` and the locked community reads in full (P02, T-08.2-14).
 *
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order).
 */

type Envelope = {
  error: { code: string; message?: string; details?: Record<string, unknown> };
};
type FeedPage = { items: { id: string }[]; nextCursor: string | null };

const RUN = Date.now();
/** The prefix every product and community THIS FILE writes carries, so the sweep can be exact. */
const PREFIX = `st-${RUN}`;

const tokens = { demoAdmin: '', demoMember: '', demoSupport: '' };
let demoTenantId = '';
let restoreStore: () => Promise<void> = async () => {};

const request = (path: string, token: string, init: RequestInit = {}, host = HOSTS.demo) =>
  api.request(path, {
    ...init,
    headers: {
      'x-tenant-host': host,
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });

const post = (path: string, token: string, body: unknown, host = HOSTS.demo) =>
  request(path, token, { method: 'POST', body: JSON.stringify(body) }, host);

/** Removes everything a run of this file (or an interrupted earlier run) left behind. */
async function sweep(): Promise<void> {
  const products = adminSql`select id from public.store_products where name like ${'st-%'}`;
  await adminSql`delete from public.store_entitlements where product_id in (${products})`;
  await adminSql`delete from public.store_orders where product_id in (${products})`;
  await adminSql`delete from public.store_products where name like ${'st-%'}`;
  const communities = adminSql`select id from public.communities where name like ${'st-%'}`;
  await adminSql`delete from public.feed_posts where community_id in (${communities})`;
  await adminSql`delete from public.communities where name like ${'st-%'}`;
}

/** A throwaway community through the API (the admin's own route), and its id. */
async function createCommunity(name: string): Promise<string> {
  const res = await post('/v1/communities', tokens.demoAdmin, { name });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** One admin post into a community through the feed's create route, and its id. */
async function publish(communityId: string, caption: string): Promise<string> {
  const res = await post('/v1/feed/posts', tokens.demoAdmin, { caption, communityId });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** A product through the API, and its detail. */
async function createProduct(
  name: string,
  priceCents: number,
  communityIds: string[],
): Promise<ProductDetail> {
  const res = await post('/v1/store/products', tokens.demoAdmin, {
    name,
    priceCents,
    communityIds,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as ProductDetail;
}

async function communityFeed(token: string, communityId: string): Promise<FeedPage> {
  const res = await request(`/v1/feed?communityId=${communityId}`, token);
  expect(res.status).toBe(200);
  return (await res.json()) as FeedPage;
}

beforeAll(async () => {
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.demoSupport = await signInAs('support@rede-demo.local', SEED_PASSWORD);
  const [demo] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-demo'`;
  demoTenantId = demo?.id ?? '';
  await sweep();
  restoreStore = await withStoreEnabled('demo');
});

afterAll(async () => {
  await restoreStore();
  await sweep();
});

describe('store tracer', () => {
  it('an admin links a product to a community; a member sees only its newest post until buying it, staff see everything', async () => {
    const communityId = await createCommunity(`${PREFIX} tracer`);
    const first = await publish(communityId, 'primeiro');
    const second = await publish(communityId, 'segundo');
    const newest = await publish(communityId, 'terceiro');

    const product = await createProduct(`${PREFIX} curso`, 1990, [communityId]);
    expect(product.priceCents).toBe(1990);
    expect(product.currency).toBe('BRL');
    expect(product.status).toBe('active');
    expect(product.owned).toBe(false);
    expect(product.communities.map((c) => c.id)).toEqual([communityId]);

    // The member holds nothing: ONE item, the newest post, and no cursor (D-354, Pitfall 4).
    const locked = await communityFeed(tokens.demoMember, communityId);
    expect(locked.items.map((item) => item.id)).toEqual([newest]);
    expect(locked.nextCursor).toBeNull();

    // Staff always read the whole community, in the same statement shape (P74).
    for (const token of [tokens.demoAdmin, tokens.demoSupport]) {
      const full = await communityFeed(token, communityId);
      expect(full.items.map((item) => item.id)).toEqual([newest, second, first]);
    }

    // The member buys at the price they saw.
    const bought = await post(`/v1/store/products/${product.id}/purchase`, tokens.demoMember, {
      expectedAmountCents: 1990,
    });
    expect(bought.status).toBe(200);
    const result = (await bought.json()) as PurchaseResult;
    expect(result.owned).toBe(true);
    expect(result.communities.map((c) => c.id)).toEqual([communityId]);

    // The same read now returns every post, newest first.
    const open = await communityFeed(tokens.demoMember, communityId);
    expect(open.items.map((item) => item.id)).toEqual([newest, second, first]);

    // The order snapshots the price (D-361) and nothing touched community_members (P77).
    const orders = await adminSql<{ amount_cents: number; currency: string; status: string }[]>`
      select amount_cents, currency, status from public.store_orders
       where product_id = ${product.id}::uuid`;
    expect(orders).toEqual([{ amount_cents: 1990, currency: 'BRL', status: 'paid' }]);
    const [members] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.community_members where community_id = ${communityId}::uuid`;
    expect(members?.n).toBe(0);
  });
});

describe('purchase matrix', () => {
  const buy = (productId: string, expectedAmountCents: number, token = tokens.demoMember) =>
    post(`/v1/store/products/${productId}/purchase`, token, { expectedAmountCents });

  /** The member's ledger rows for one product, read through the admin connection. */
  async function ledger(productId: string) {
    const [row] = await adminSql<{ orders: number; paid: number; active: number }[]>`
      select (select count(*)::int from public.store_orders where product_id = ${productId}::uuid) as orders,
             (select count(*)::int from public.store_orders
               where product_id = ${productId}::uuid and status = 'paid') as paid,
             (select count(*)::int from public.store_entitlements
               where product_id = ${productId}::uuid and status = 'active') as active`;
    return row ?? { orders: -1, paid: -1, active: -1 };
  }

  async function expectRefusal(res: Response, status: number, details?: unknown) {
    expect(res.status).toBe(status);
    const body = (await res.json()) as Envelope;
    if (details === undefined) {
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error).not.toHaveProperty('details');
    } else {
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.details).toEqual(details);
    }
  }

  it('P30: one cent below or above the price is 409 price_changed and writes nothing; the price is 200', async () => {
    const product = await createProduct(`${PREFIX} p30`, 1990, []);
    await expectRefusal(await buy(product.id, 1989), 409, { store: 'price_changed' });
    await expectRefusal(await buy(product.id, 1991), 409, { store: 'price_changed' });
    expect(await ledger(product.id)).toEqual({ orders: 0, paid: 0, active: 0 });
    const ok = await buy(product.id, 1990);
    expect(ok.status).toBe(200);
    expect((await ok.json()) as PurchaseResult).toEqual({ owned: true, communities: [] });
  });

  it('a 0-cent product answers 200 and writes an order with amount_cents = 0', async () => {
    const product = await createProduct(`${PREFIX} gratis`, 0, []);
    expect((await buy(product.id, 0)).status).toBe(200);
    const orders = await adminSql<{ amount_cents: number; provider: string }[]>`
      select amount_cents, provider from public.store_orders where product_id = ${product.id}::uuid`;
    expect(orders).toEqual([{ amount_cents: 0, provider: 'none' }]);
  });

  it('an archived product answers 409 unavailable and writes nothing', async () => {
    const product = await createProduct(`${PREFIX} arquivado`, 1990, []);
    await adminSql`update public.store_products set status = 'archived' where id = ${product.id}::uuid`;
    await expectRefusal(await buy(product.id, 1990), 409, { store: 'unavailable' });
    expect(await ledger(product.id)).toEqual({ orders: 0, paid: 0, active: 0 });
  });

  it('an unknown id and another tenant product id are the same bare 404', async () => {
    await expectRefusal(await buy('00000000-0000-4000-8000-000000000000', 1990), 404);
    const [lab] = await adminSql<{ tenant_id: string; user_id: string }[]>`
      select m.tenant_id::text as tenant_id, m.user_id::text as user_id
        from public.memberships m join public.tenants t on t.id = m.tenant_id
       where t.slug = 'rede-lab' and m.role = 'admin_tenant' limit 1`;
    const [labProduct] = await adminSql<{ id: string }[]>`
      insert into public.store_products (tenant_id, created_by_user_id, name, price_cents)
      values (${lab?.tenant_id ?? ''}::uuid, ${lab?.user_id ?? ''}::uuid, ${`${PREFIX} lab`}, 1990)
      returning id::text as id`;
    await expectRefusal(await buy(labProduct?.id ?? '', 1990), 404);
    expect(await ledger(labProduct?.id ?? '')).toEqual({ orders: 0, paid: 0, active: 0 });
  });

  it('P32: a replay answers the same 200 and leaves the counts unchanged', async () => {
    const product = await createProduct(`${PREFIX} replay`, 1990, []);
    const first = await buy(product.id, 1990);
    expect(first.status).toBe(200);
    const before = await ledger(product.id);
    expect(before).toEqual({ orders: 1, paid: 1, active: 1 });
    const again = await buy(product.id, 1990);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(await first.json());
    expect(await ledger(product.id)).toEqual(before);
  });

  it('P33: five concurrent purchases answer five 200 and leave ONE paid order and ONE active entitlement', async () => {
    const product = await createProduct(`${PREFIX} corrida`, 1990, []);
    const answers = await Promise.all(Array.from({ length: 5 }, () => buy(product.id, 1990)));
    expect(answers.map((res) => res.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await ledger(product.id)).toEqual({ orders: 1, paid: 1, active: 1 });
  });

  it('D-361: a price edit after the purchase leaves the order amount', async () => {
    const product = await createProduct(`${PREFIX} snapshot`, 1990, []);
    expect((await buy(product.id, 1990)).status).toBe(200);
    await adminSql`update public.store_products set price_cents = 4990 where id = ${product.id}::uuid`;
    const orders = await adminSql<{ amount_cents: number }[]>`
      select amount_cents from public.store_orders where product_id = ${product.id}::uuid`;
    expect(orders).toEqual([{ amount_cents: 1990 }]);
    // The client price is a staleness check only: the old price is now refused.
    await expectRefusal(await buy(product.id, 1990, tokens.demoSupport), 409, {
      store: 'price_changed',
    });
  });

  it('D-338: a member and a support_tenant creating a product get 403, and nothing is written', async () => {
    for (const token of [tokens.demoMember, tokens.demoSupport]) {
      const res = await post('/v1/store/products', token, {
        name: `${PREFIX} proibido`,
        priceCents: 1990,
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as Envelope).error.code).toBe('FORBIDDEN');
    }
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.store_products where name = ${`${PREFIX} proibido`}`;
    expect(row?.n).toBe(0);
  });

  it('P01: with the store ON, a community linked to no product reads in full for a member', async () => {
    const communityId = await createCommunity(`${PREFIX} livre`);
    const older = await publish(communityId, 'um');
    const newer = await publish(communityId, 'dois');
    const page = await communityFeed(tokens.demoMember, communityId);
    expect(page.items.map((item) => item.id)).toEqual([newer, older]);
  });

  it('P02: with the store disabled, then with no row, both routes are 404 MODULE_DISABLED and the locked community reads in full', async () => {
    const communityId = await createCommunity(`${PREFIX} desligada`);
    const older = await publish(communityId, 'um');
    const newer = await publish(communityId, 'dois');
    const product = await createProduct(`${PREFIX} desligada`, 1990, [communityId]);
    expect((await communityFeed(tokens.demoMember, communityId)).items).toHaveLength(1);

    const expectOff = async () => {
      moduleFlags.invalidate(demoTenantId);
      for (const res of [
        await post('/v1/store/products', tokens.demoAdmin, { name: `${PREFIX} x`, priceCents: 1 }),
        await buy(product.id, 1990),
      ]) {
        expect(res.status).toBe(404);
        expect(((await res.json()) as Envelope).error.code).toBe('MODULE_DISABLED');
      }
      const page = await communityFeed(tokens.demoMember, communityId);
      expect(page.items.map((item) => item.id)).toEqual([newer, older]);
    };

    await adminSql`
      update public.tenant_modules set enabled = false
       where tenant_id = ${demoTenantId}::uuid and module_key = 'store'`;
    await expectOff();
    await adminSql`
      delete from public.tenant_modules
       where tenant_id = ${demoTenantId}::uuid and module_key = 'store'`;
    await expectOff();
    // `afterAll`'s restore writes the seed's row back exactly as it was.
  });
});
