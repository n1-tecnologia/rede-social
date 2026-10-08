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

  it('the purchase answers a bare refusal shape for the wrong price: 409 price_changed, nothing written', async () => {
    const communityId = await createCommunity(`${PREFIX} preco`);
    await publish(communityId, 'post');
    const product = await createProduct(`${PREFIX} preco`, 1990, [communityId]);
    const res = await post(`/v1/store/products/${product.id}/purchase`, tokens.demoMember, {
      expectedAmountCents: 1989,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.details).toEqual({ store: 'price_changed' });
  });
});
