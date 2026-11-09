import { randomUUID } from 'node:crypto';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import {
  type BuyersPage,
  type CommunityAccess,
  type CommunityAccessList,
  type CourseAccess,
  type CourseAccessList,
  type GrantResult,
  type LiveAccess,
  type LiveAccessList,
  type ProductDetail,
  type ProductPage,
  type PurchaseResult,
  productDetailSchema,
  purchaseResultSchema,
} from '@rede-social/module-store/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  SEED_PASSWORD,
  signInAs,
  withModuleEnabled,
  withStoreEnabled,
} from './setup';

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
 *  - `buyers, grant and revoke` (08.2-06, D-359, D-360, STORE-09, STORE-10): the holders list (shape,
 *    `source`, a removed member's nulls, empty, keyset order), the grant (opens the community,
 *    `already_active`, refusals), the revoke (history kept, the next read is the sample only, a new
 *    purchase is a new order and entitlement, no IDOR), the 403s and the grant-versus-purchase race.
 *  - `product course and live links` (08.4-03, STORE-22, STORE-03, SC 3, SC 5, D-418): the store-side
 *    write path at its edges — dedupe, order, clear, cap, the kept rule for archived courses and
 *    cancelled lives, cross-tenant refusal, concurrency, independent link sets, the module switches,
 *    the manager-only lists and the live status parity, each link write with the tenant's
 *    entitlement and order counts unchanged (PR-2).
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

const tokens = { demoAdmin: '', demoMember: '', demoSupport: '', labAdmin: '', labMember: '' };
let demoTenantId = '';
let labTenantId = '';
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

/**
 * Turns `store` on for a tenant (an upsert) and drops the API's flag cache for it. `purchase matrix`
 * P02 ends with the demo row DELETED, so every later describe calls this first; `afterAll`'s restore
 * still writes the seed's original row back.
 */
async function storeOn(tenantId: string): Promise<void> {
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${tenantId}::uuid, 'store', true)
    on conflict (tenant_id, module_key) do update set enabled = true, updated_at = now()`;
  moduleFlags.invalidate(tenantId);
}

/** A GET through the API as a given session, parsed. */
async function getJson<T>(path: string, token: string, host = HOSTS.demo): Promise<T> {
  const res = await request(path, token, {}, host);
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

/** An admin-lane product row, for fixtures the API cannot shape (a fixed `created_at`). */
async function insertProduct(
  tenantId: string,
  name: string,
  createdAt: string,
  status: 'active' | 'archived' = 'active',
): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.store_products (tenant_id, created_by_user_id, name, price_cents, status, created_at)
    select ${tenantId}::uuid, m.user_id, ${name}, 990, ${status}, ${createdAt}::timestamptz
      from public.memberships m
     where m.tenant_id = ${tenantId}::uuid and m.role = 'admin_tenant'
     limit 1
    returning id::text as id`;
  return row?.id ?? '';
}

/** Every page of a list, following `nextCursor`, at a given page size. */
async function allPages(path: string, token: string, limit: number, host = HOSTS.demo) {
  const pages: ProductPage[] = [];
  let cursor: string | null = null;
  do {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${path}${sep}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const page: ProductPage = await getJson<ProductPage>(url, token, host);
    pages.push(page);
    cursor = page.nextCursor;
  } while (cursor && pages.length < 200);
  return pages;
}

/** The labs' `st-` fixtures, swept by their own describe (the file-level sweep is name-wide too). */
async function sweepLab(): Promise<void> {
  const products = adminSql`
    select id from public.store_products
     where tenant_id = ${labTenantId}::uuid and name like ${'st-%'}`;
  await adminSql`delete from public.store_entitlements where product_id in (${products})`;
  await adminSql`delete from public.store_orders where product_id in (${products})`;
  await adminSql`
    delete from public.store_products where tenant_id = ${labTenantId}::uuid and name like ${'st-%'}`;
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
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  tokens.labMember = await signInAs('member@rede-lab.local', SEED_PASSWORD);
  const [demo] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-demo'`;
  demoTenantId = demo?.id ?? '';
  const [lab] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-lab'`;
  labTenantId = lab?.id ?? '';
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
    expect((await ok.json()) as PurchaseResult).toEqual({
      owned: true,
      communities: [],
      courses: [],
      lives: [],
    });
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

  it('WR-01: a holder replaying after a price edit or an archive gets the same 200, not a 409', async () => {
    const product = await createProduct(`${PREFIX} wr01`, 1990, []);
    const first = await buy(product.id, 1990);
    expect(first.status).toBe(200);
    const bought = await first.json();
    const before = await ledger(product.id);
    // The admin edits the price before the replay (a double tap, a second tab) arrives.
    await adminSql`update public.store_products set price_cents = 4990 where id = ${product.id}::uuid`;
    const afterPrice = await buy(product.id, 1990);
    expect(afterPrice.status).toBe(200);
    expect(await afterPrice.json()).toEqual(bought);
    // …or archives it.
    await adminSql`update public.store_products set status = 'archived' where id = ${product.id}::uuid`;
    const afterArchive = await buy(product.id, 4990);
    expect(afterArchive.status).toBe(200);
    expect(await afterArchive.json()).toEqual(bought);
    expect(await ledger(product.id)).toEqual(before);
    // A NON-holder is still refused on the archived product.
    await expectRefusal(await buy(product.id, 4990, tokens.demoSupport), 409, {
      store: 'unavailable',
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

describe('catalogue', () => {
  beforeAll(async () => {
    await storeOn(demoTenantId);
  });

  it('D-352 / STORE-06 / P07 / P18 / P29: filters, the product read, archived visibility and the linked communities in the list order', async () => {
    // Two communities whose list order (position asc) is the REVERSE of their creation order, and
    // a third that is archived: the product read must list b, a and never c (D-353, P29).
    const a = await createCommunity(`${PREFIX} cat-a`);
    const b = await createCommunity(`${PREFIX} cat-b`);
    const c = await createCommunity(`${PREFIX} cat-c`);
    await adminSql`update public.communities set position = 2 where id = ${a}::uuid`;
    await adminSql`update public.communities set position = 1 where id = ${b}::uuid`;
    const x = await createProduct(`${PREFIX} cat-x`, 1990, [a, b, c]);
    await adminSql`update public.communities set status = 'archived' where id = ${c}::uuid`;
    const y = await createProduct(`${PREFIX} cat-y`, 990, []);
    const z = await createProduct(`${PREFIX} cat-z`, 490, []);

    // The member holds x, then y (y is the NEWER entitlement); y and z are archived afterwards.
    for (const product of [x, y]) {
      const res = await post(`/v1/store/products/${product.id}/purchase`, tokens.demoMember, {
        expectedAmountCents: product.priceCents,
      });
      expect(res.status).toBe(200);
    }
    await adminSql`
      update public.store_products set status = 'archived' where id in (${y.id}::uuid, ${z.id}::uuid)`;

    // filter=all (the default): active only, `owned` per caller, newest first (P10 order).
    const all = await getJson<ProductPage>('/v1/store/products?limit=50', tokens.demoMember);
    const allIds = all.items.map((item) => item.id);
    expect(allIds).toContain(x.id);
    expect(allIds).not.toContain(y.id);
    expect(allIds).not.toContain(z.id);
    expect(all.items.find((item) => item.id === x.id)).toEqual({
      id: x.id,
      name: `${PREFIX} cat-x`,
      priceCents: 1990,
      currency: 'BRL',
      imageAssetId: null,
      status: 'active',
      // 12.3 (OQ-3): a create with no category key applies the name guess; this name matches nothing.
      category: 'outros',
      owned: true,
      purchase: { mode: 'simulated', checkoutUrl: null },
    });
    const expectedAll = await adminSql<{ id: string }[]>`
      select id::text as id from public.store_products
       where tenant_id = ${demoTenantId}::uuid and status = 'active'
       order by created_at desc, id desc limit 50`;
    expect(allIds).toEqual(expectedAll.map((row) => row.id));
    // The admin does not hold x: the same card, `owned: false`.
    const adminAll = await getJson<ProductPage>('/v1/store/products?limit=50', tokens.demoAdmin);
    expect(adminAll.items.find((item) => item.id === x.id)?.owned).toBe(false);

    // filter=owned: both held products, the archived one included, newest entitlement first (P18).
    const owned = await getJson<ProductPage>(
      '/v1/store/products?filter=owned&limit=50',
      tokens.demoMember,
    );
    const ownedIds = owned.items.map((item) => item.id);
    expect(ownedIds.indexOf(y.id)).toBeGreaterThanOrEqual(0);
    expect(ownedIds.indexOf(y.id)).toBeLessThan(ownedIds.indexOf(x.id));
    expect(ownedIds).not.toContain(z.id);
    expect(owned.items.find((item) => item.id === y.id)).toMatchObject({
      status: 'archived',
      owned: true,
    });
    expect(owned.items.every((item) => item.owned)).toBe(true);

    // filter=archived: managers only (T-08.2-28); a member and a support_tenant get 403.
    for (const token of [tokens.demoMember, tokens.demoSupport]) {
      const res = await request('/v1/store/products?filter=archived', token);
      expect(res.status).toBe(403);
      expect(((await res.json()) as Envelope).error.code).toBe('FORBIDDEN');
    }
    const archived = await getJson<ProductPage>(
      '/v1/store/products?filter=archived&limit=50',
      tokens.demoAdmin,
    );
    const archivedIds = archived.items.map((item) => item.id);
    expect(archivedIds.indexOf(z.id)).toBeGreaterThanOrEqual(0);
    expect(archivedIds.indexOf(z.id)).toBeLessThan(archivedIds.indexOf(y.id));
    expect(archivedIds).not.toContain(x.id);

    // The product read (STORE-06): active linked communities in the list order, archived c absent.
    const memberX = await getJson<ProductDetail>(`/v1/store/products/${x.id}`, tokens.demoMember);
    expect(memberX.owned).toBe(true);
    expect(memberX.communities.map((row) => row.id)).toEqual([b, a]);
    expect(memberX).not.toHaveProperty('holderCount');
    const adminX = await getJson<ProductDetail>(`/v1/store/products/${x.id}`, tokens.demoAdmin);
    expect(adminX.holderCount).toBe(1);
    expect(adminX.owned).toBe(false);
    // The support_tenant holds no store permission: no holder count either.
    const supportX = await getJson<ProductDetail>(`/v1/store/products/${x.id}`, tokens.demoSupport);
    expect(supportX).not.toHaveProperty('holderCount');

    // Archived: 200 to its holder and to a manager, the bare 404 to anyone else (P07).
    const heldArchived = await getJson<ProductDetail>(
      `/v1/store/products/${y.id}`,
      tokens.demoMember,
    );
    expect(heldArchived).toMatchObject({ status: 'archived', owned: true, communities: [] });
    const managed = await getJson<ProductDetail>(`/v1/store/products/${z.id}`, tokens.demoAdmin);
    expect(managed).toMatchObject({ status: 'archived', holderCount: 0 });
    for (const token of [tokens.demoMember, tokens.demoSupport]) {
      const res = await request(`/v1/store/products/${z.id}`, token);
      expect(res.status).toBe(404);
      const body = (await res.json()) as Envelope;
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error).not.toHaveProperty('details');
    }
    // An unknown id and another tenant's id are the same bare 404.
    const unknown = await request(
      '/v1/store/products/00000000-0000-4000-8000-000000000000',
      tokens.demoAdmin,
    );
    expect(unknown.status).toBe(404);
  });

  it('P08: a product with an empty description, no image and no community reads end to end', async () => {
    const bare = await createProduct(`${PREFIX} cat-vazio`, 0, []);
    const detail = await getJson<ProductDetail>(`/v1/store/products/${bare.id}`, tokens.demoMember);
    expect(detail).toEqual({
      id: bare.id,
      name: `${PREFIX} cat-vazio`,
      description: '',
      priceCents: 0,
      currency: 'BRL',
      imageAssetId: null,
      status: 'active',
      // 12.3 (OQ-3): no category key on create applies the name guess; this name matches nothing.
      category: 'outros',
      owned: false,
      communities: [],
      unlockedCourses: [],
      unlockedLives: [],
      purchase: { mode: 'simulated', checkoutUrl: null },
    });
  });

  describe('paging on a tenant with no product (rede-lab)', () => {
    let restoreLab: () => Promise<void> = async () => {};
    beforeAll(async () => {
      await sweepLab();
      restoreLab = await withStoreEnabled('lab');
    });
    afterAll(async () => {
      await sweepLab();
      await restoreLab();
    });

    it('P08 / P17 / P10: empty page, exactly 20 then 22 items, ties broken by id across pages, and refused cursors', async () => {
      // The lab seed has no product, so the empty catalogue is observable there (P08).
      const [existing] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.store_products where tenant_id = ${labTenantId}::uuid`;
      expect(existing?.n).toBe(0);
      expect(await getJson<ProductPage>('/v1/store/products', tokens.labMember, HOSTS.lab)).toEqual(
        {
          items: [],
          nextCursor: null,
        },
      );

      // Exactly 20 items with nothing after them: `nextCursor: null` (the over-fetch rule, P17).
      const base = Date.parse('2026-01-01T00:00:00Z');
      for (let i = 0; i < 20; i += 1) {
        await insertProduct(
          labTenantId,
          `${PREFIX} pg-${i}`,
          new Date(base + i * 1000).toISOString(),
        );
      }
      const twenty = await getJson<ProductPage>('/v1/store/products', tokens.labMember, HOSTS.lab);
      expect(twenty.items).toHaveLength(20);
      expect(twenty.nextCursor).toBeNull();

      // Two more created in the SAME instant (P10): pages of one walk every row exactly once, in
      // `(created_at desc, id desc)` order.
      const tie = new Date(base + 30_000).toISOString();
      await insertProduct(labTenantId, `${PREFIX} pg-tie-1`, tie);
      await insertProduct(labTenantId, `${PREFIX} pg-tie-2`, tie);
      const expected = await adminSql<{ id: string }[]>`
        select id::text as id from public.store_products
         where tenant_id = ${labTenantId}::uuid and status = 'active'
         order by created_at desc, id desc`;
      const ones = await allPages('/v1/store/products', tokens.labMember, 1, HOSTS.lab);
      expect(ones.flatMap((page) => page.items.map((item) => item.id))).toEqual(
        expected.map((row) => row.id),
      );
      expect(ones[ones.length - 1]?.nextCursor).toBeNull();
      const twenties = await allPages('/v1/store/products', tokens.labMember, 20, HOSTS.lab);
      expect(twenties[0]?.items).toHaveLength(20);
      expect(twenties[0]?.nextCursor).not.toBeNull();
      expect(twenties.flatMap((page) => page.items.map((item) => item.id))).toEqual(
        expected.map((row) => row.id),
      );

      // Refused cursors and limits: 400, never a widened read (P17, T-08.2-27).
      const bad = (n: string, id = '00000000-0000-4000-8000-000000000000') =>
        Buffer.from(JSON.stringify({ v: 1, n, id })).toString('base64url');
      for (const query of [
        'cursor=not-a-cursor',
        `cursor=${'c'.repeat(513)}`,
        `cursor=${bad('2026-02-30T00:00:00.000000Z')}`,
        `cursor=${bad('yesterday')}`,
        'limit=0',
        'limit=51',
        'filter=comprados',
        'sort=asc',
      ]) {
        const res = await request(`/v1/store/products?${query}`, tokens.labMember, {}, HOSTS.lab);
        expect(res.status).toBe(400);
        expect(((await res.json()) as Envelope).error.code).toBe('VALIDATION_FAILED');
      }
    });
  });
});

describe('community access', () => {
  beforeAll(async () => {
    await storeOn(demoTenantId);
  });

  it('STORE-12 / A3 / P43: one row per gated community, locked per caller, archivedTag only when no linked product is active', async () => {
    const g1 = await createCommunity(`${PREFIX} acc-1`);
    const g2 = await createCommunity(`${PREFIX} acc-2`);
    const g3 = await createCommunity(`${PREFIX} acc-3`);
    const open = await createCommunity(`${PREFIX} acc-aberta`);
    const p1 = await createProduct(`${PREFIX} acc-p1`, 1990, [g1, g3]);
    const p2 = await createProduct(`${PREFIX} acc-p2`, 990, [g2, g3]);
    await adminSql`update public.store_products set status = 'archived' where id = ${p2.id}::uuid`;

    const rowsFor = async (token: string) => {
      const list = await getJson<CommunityAccessList>('/v1/store/community-access', token);
      return new Map(list.items.map((item) => [item.communityId, item]));
    };

    const member = await rowsFor(tokens.demoMember);
    expect(member.get(g1)).toEqual({
      communityId: g1,
      locked: true,
      gated: true,
      archivedTag: false,
    });
    // Only an archived product gates g2: still locked for a non-holder (A4), and tagged.
    expect(member.get(g2)).toEqual({
      communityId: g2,
      locked: true,
      gated: true,
      archivedTag: true,
    });
    // One active plus one archived: no tag (P43).
    expect(member.get(g3)).toEqual({
      communityId: g3,
      locked: true,
      gated: true,
      archivedTag: false,
    });
    expect(member.has(open)).toBe(false);

    // Staff read everything: `locked: false`, the same gated rows.
    for (const token of [tokens.demoAdmin, tokens.demoSupport]) {
      const staff = await rowsFor(token);
      for (const id of [g1, g2, g3])
        expect(staff.get(id)).toMatchObject({ locked: false, gated: true });
      expect(staff.has(open)).toBe(false);
    }

    // The member buys p1: g1 and g3 open for them on the very next read (P78: nothing cached).
    const bought = await post(`/v1/store/products/${p1.id}/purchase`, tokens.demoMember, {
      expectedAmountCents: 1990,
    });
    expect(bought.status).toBe(200);
    const after = await rowsFor(tokens.demoMember);
    expect(after.get(g1)?.locked).toBe(false);
    expect(after.get(g3)?.locked).toBe(false);
    expect(after.get(g2)?.locked).toBe(true);

    // The list follows the Comunidades order: the same relative order as the communities' own sort.
    const order = await adminSql<{ id: string }[]>`
      select id::text as id from public.communities
       where id in (${g1}::uuid, ${g2}::uuid, ${g3}::uuid)
       order by position asc, last_activity_at desc, id desc`;
    const listed = (
      await getJson<CommunityAccessList>('/v1/store/community-access', tokens.demoMember)
    ).items
      .map((item) => item.communityId)
      .filter((id) => [g1, g2, g3].includes(id));
    expect(listed).toEqual(order.map((row) => row.id));
  });

  it('STORE-14 / P55: buyableProducts are the active linked products newest first; only a manager gets products', async () => {
    const community = await createCommunity(`${PREFIX} acc-compra`);
    const older = await createProduct(`${PREFIX} acc-velho`, 1990, [community]);
    const archived = await createProduct(`${PREFIX} acc-arquivado`, 990, [community]);
    const newer = await createProduct(`${PREFIX} acc-novo`, 0, [community]);
    await adminSql`update public.store_products set status = 'archived' where id = ${archived.id}::uuid`;

    const path = `/v1/store/communities/${community}/access`;
    const member = await getJson<CommunityAccess>(path, tokens.demoMember);
    expect(member).toEqual({
      communityId: community,
      locked: true,
      gated: true,
      archivedTag: false,
      buyableProducts: [
        { id: newer.id, name: `${PREFIX} acc-novo`, priceCents: 0, imageAssetId: null },
        { id: older.id, name: `${PREFIX} acc-velho`, priceCents: 1990, imageAssetId: null },
      ],
    });
    expect(member).not.toHaveProperty('products');
    expect(await getJson<CommunityAccess>(path, tokens.demoSupport)).not.toHaveProperty('products');

    const admin = await getJson<CommunityAccess>(path, tokens.demoAdmin);
    expect(admin.locked).toBe(false);
    expect(admin.products).toEqual([
      { id: newer.id, name: `${PREFIX} acc-novo`, status: 'active' },
      { id: archived.id, name: `${PREFIX} acc-arquivado`, status: 'archived' },
      { id: older.id, name: `${PREFIX} acc-velho`, status: 'active' },
    ]);

    // Only archived products left: nothing to buy, the tag on, still locked for a non-holder.
    await adminSql`
      update public.store_products set status = 'archived'
       where id in (${older.id}::uuid, ${newer.id}::uuid)`;
    expect(await getJson<CommunityAccess>(path, tokens.demoMember)).toEqual({
      communityId: community,
      locked: true,
      gated: true,
      archivedTag: true,
      buyableProducts: [],
    });

    // An open community: not gated, nothing to buy; an unknown id: the bare 404.
    const open = await createCommunity(`${PREFIX} acc-livre`);
    const openAccess = await getJson<CommunityAccess>(
      `/v1/store/communities/${open}/access`,
      tokens.demoAdmin,
    );
    expect(openAccess).toEqual({
      communityId: open,
      locked: false,
      gated: false,
      archivedTag: false,
      buyableProducts: [],
      products: [],
    });
    const unknown = await request(
      '/v1/store/communities/00000000-0000-4000-8000-000000000000/access',
      tokens.demoMember,
    );
    expect(unknown.status).toBe(404);
    const unknownBody = (await unknown.json()) as Envelope;
    expect(unknownBody.error.code).toBe('NOT_FOUND');
    expect(unknownBody.error).not.toHaveProperty('details');
  });

  it('P45: no product means an empty map; with the store off the map is 404 MODULE_DISABLED', async () => {
    await sweepLab();
    const restoreLab = await withStoreEnabled('lab');
    try {
      const [links] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.store_product_communities
         where tenant_id = ${labTenantId}::uuid`;
      expect(links?.n).toBe(0);
      expect(
        await getJson<CommunityAccessList>(
          '/v1/store/community-access',
          tokens.labMember,
          HOSTS.lab,
        ),
      ).toEqual({ items: [] });
    } finally {
      await restoreLab();
    }
    // The seed leaves the lab's store off: the restore puts it back, and the map is refused.
    for (const path of ['/v1/store/community-access', '/v1/store/products']) {
      const res = await request(path, tokens.labMember, {}, HOSTS.lab);
      expect(res.status).toBe(404);
      expect(((await res.json()) as Envelope).error.code).toBe('MODULE_DISABLED');
    }
  });
});

describe('product admin', () => {
  beforeAll(async () => {
    await storeOn(demoTenantId);
  });

  const patch = (productId: string, body: unknown, token = tokens.demoAdmin) =>
    request(`/v1/store/products/${productId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  const putStatus = (productId: string, status: string, token = tokens.demoAdmin) =>
    request(`/v1/store/products/${productId}/status`, token, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
  const preview = (body: unknown, token = tokens.demoAdmin) =>
    post('/v1/store/products/lock-preview', token, body);

  /** A product's link set, sorted, through the admin connection. */
  async function links(productId: string): Promise<string[]> {
    const rows = await adminSql<{ id: string }[]>`
      select community_id::text as id from public.store_product_communities
       where product_id = ${productId}::uuid order by community_id`;
    return rows.map((row) => row.id);
  }

  /** Every entitlement and order of a product, as rows a later read must find unchanged. */
  async function ledgerRows(productId: string) {
    const entitlements = await adminSql`
      select id, user_id, status, source, created_at, revoked_at from public.store_entitlements
       where product_id = ${productId}::uuid order by id`;
    const orders = await adminSql`
      select id, user_id, status, amount_cents, created_at, revoked_at from public.store_orders
       where product_id = ${productId}::uuid order by id`;
    return { entitlements, orders };
  }

  /** The tenant's live `member`-role memberships (the D-364 population). */
  async function liveMembers(): Promise<number> {
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.memberships
       where tenant_id = ${demoTenantId}::uuid and role = 'member' and status = 'active'
         and blocked_at is null and deleted_at is null`;
    return row?.n ?? -1;
  }

  it('D-338: a member and a support_tenant get 403 on every write, and nothing changes', async () => {
    const product = await createProduct(`${PREFIX} adm-guard`, 1990, []);
    const community = await createCommunity(`${PREFIX} adm-guard`);
    for (const token of [tokens.demoMember, tokens.demoSupport]) {
      for (const res of [
        await patch(product.id, { name: `${PREFIX} tomado` }, token),
        await putStatus(product.id, 'archived', token),
        await preview({ communityIds: [community] }, token),
      ]) {
        expect(res.status).toBe(403);
        expect(((await res.json()) as Envelope).error.code).toBe('FORBIDDEN');
      }
    }
    const [row] = await adminSql<{ name: string; status: string }[]>`
      select name, status from public.store_products where id = ${product.id}::uuid`;
    expect(row).toEqual({ name: `${PREFIX} adm-guard`, status: 'active' });
  });

  it('D-361: a patched price leaves the old order amount and the next purchase uses the new price', async () => {
    const product = await createProduct(`${PREFIX} adm-preco`, 1990, []);
    const first = await post(`/v1/store/products/${product.id}/purchase`, tokens.demoMember, {
      expectedAmountCents: 1990,
    });
    expect(first.status).toBe(200);
    const res = await patch(product.id, { priceCents: 4990 });
    expect(res.status).toBe(200);
    const detail = (await res.json()) as ProductDetail;
    expect(detail).toMatchObject({ priceCents: 4990, holderCount: 1 });
    // The old price is now a stale check; the new one buys at the new amount.
    const stale = await post(`/v1/store/products/${product.id}/purchase`, tokens.demoSupport, {
      expectedAmountCents: 1990,
    });
    expect(stale.status).toBe(409);
    const fresh = await post(`/v1/store/products/${product.id}/purchase`, tokens.demoSupport, {
      expectedAmountCents: 4990,
    });
    expect(fresh.status).toBe(200);
    const orders = await adminSql<{ amount_cents: number }[]>`
      select amount_cents from public.store_orders
       where product_id = ${product.id}::uuid order by created_at, id`;
    expect(orders.map((row) => row.amount_cents)).toEqual([1990, 4990]);
  });

  it('decision 3 / STORE-09 / P07 / P12: archive keeps every link and entitlement, the holder keeps reading, new purchases are refused; reactivate restores the catalogue', async () => {
    const community = await createCommunity(`${PREFIX} adm-arquivo`);
    const posts = [
      await publish(community, 'um'),
      await publish(community, 'dois'),
      await publish(community, 'tres'),
    ];
    const product = await createProduct(`${PREFIX} adm-arquivo`, 1990, [community]);
    const bought = await post(`/v1/store/products/${product.id}/purchase`, tokens.demoMember, {
      expectedAmountCents: 1990,
    });
    expect(bought.status).toBe(200);
    const before = await ledgerRows(product.id);
    const linksBefore = await links(product.id);

    const archived = await putStatus(product.id, 'archived');
    expect(archived.status).toBe(200);
    const archivedDetail = (await archived.json()) as ProductDetail;
    expect(archivedDetail).toMatchObject({ status: 'archived', holderCount: 1 });
    const [stamp] = await adminSql<{ updated_at: string }[]>`
      select updated_at::text as updated_at from public.store_products where id = ${product.id}::uuid`;
    // P12: the status it already has answers the unchanged detail, `updated_at` untouched.
    const again = await putStatus(product.id, 'archived');
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(archivedDetail);
    const [stampAgain] = await adminSql<{ updated_at: string }[]>`
      select updated_at::text as updated_at from public.store_products where id = ${product.id}::uuid`;
    expect(stampAgain).toEqual(stamp);

    // The prohibition: nothing a member holds changed, and the holder still reads every post.
    expect(await ledgerRows(product.id)).toEqual(before);
    expect(await links(product.id)).toEqual(linksBefore);
    expect((await communityFeed(tokens.demoMember, community)).items.map((i) => i.id)).toEqual(
      [...posts].reverse(),
    );
    // P07 adjacency: absent from `all`, present under the holder's `owned` and the manager's
    // `archived`, refused for purchase.
    const all = await getJson<ProductPage>('/v1/store/products?limit=50', tokens.demoMember);
    expect(all.items.map((i) => i.id)).not.toContain(product.id);
    const owned = await getJson<ProductPage>(
      '/v1/store/products?filter=owned&limit=50',
      tokens.demoMember,
    );
    expect(owned.items.map((i) => i.id)).toContain(product.id);
    const managed = await getJson<ProductPage>(
      '/v1/store/products?filter=archived&limit=50',
      tokens.demoAdmin,
    );
    expect(managed.items.map((i) => i.id)).toContain(product.id);
    const refused = await post(`/v1/store/products/${product.id}/purchase`, tokens.demoSupport, {
      expectedAmountCents: 1990,
    });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as Envelope).error.details).toEqual({ store: 'unavailable' });

    // Reactivate: back in `all`, still nothing a member holds changed.
    const reactivated = await putStatus(product.id, 'active');
    expect(reactivated.status).toBe(200);
    expect(((await reactivated.json()) as ProductDetail).status).toBe('active');
    const allAgain = await getJson<ProductPage>('/v1/store/products?limit=50', tokens.demoMember);
    expect(allAgain.items.map((i) => i.id)).toContain(product.id);
    expect(await ledgerRows(product.id)).toEqual(before);
    expect(await links(product.id)).toEqual(linksBefore);

    // Unknown ids are the bare 404; a bad status is 400.
    const unknown = await putStatus('00000000-0000-4000-8000-000000000000', 'archived');
    expect(unknown.status).toBe(404);
    expect((await putStatus(product.id, 'deleted')).status).toBe(400);
  });

  it('D-363 / P14 / P78: a patch replaces the whole link set; a community edit or archive never writes a link; a link saved takes effect on the next read', async () => {
    const a = await createCommunity(`${PREFIX} adm-la`);
    const b = await createCommunity(`${PREFIX} adm-lb`);
    const c = await createCommunity(`${PREFIX} adm-lc`);
    const olderOnC = await publish(c, 'antes');
    const newestOnC = await publish(c, 'depois');
    const product = await createProduct(`${PREFIX} adm-links`, 1990, [a, b]);
    expect(await links(product.id)).toEqual([a, b].sort());

    // P78: c reads in full for the member before the link is saved…
    expect((await communityFeed(tokens.demoMember, c)).items).toHaveLength(2);
    const replaced = await patch(product.id, { communityIds: [b, c] });
    expect(replaced.status).toBe(200);
    expect(await links(product.id)).toEqual([b, c].sort());
    // …and is locked on the member's very next request (the sample only).
    const lockedNow = await communityFeed(tokens.demoMember, c);
    expect(lockedNow.items.map((i) => i.id)).toEqual([newestOnC]);
    expect(lockedNow.items.map((i) => i.id)).not.toContain(olderOnC);

    // The communities API never writes a link: an edit and an archive/reactivate keep them (P14).
    const linkCount = async () => {
      const [row] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.store_product_communities
         where community_id in (${a}::uuid, ${b}::uuid, ${c}::uuid)`;
      return row?.n ?? -1;
    };
    const count = await linkCount();
    for (const body of [
      { name: `${PREFIX} adm-lc renomeada` },
      { status: 'archived' },
      { status: 'active' },
    ]) {
      const res = await request(`/v1/communities/${c}`, tokens.demoAdmin, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      expect(await linkCount()).toBe(count);
    }
    // The product read lists only the ACTIVE links; an archived community keeps its link row.
    await adminSql`update public.communities set status = 'archived' where id = ${b}::uuid`;
    const detail = await getJson<ProductDetail>(
      `/v1/store/products/${product.id}`,
      tokens.demoAdmin,
    );
    expect(detail.communities.map((row) => row.id)).toEqual([c]);
    expect(await links(product.id)).toEqual([b, c].sort());
    await adminSql`update public.communities set status = 'active' where id = ${b}::uuid`;

    // An empty set unlinks everything; the community reads in full again.
    expect((await patch(product.id, { communityIds: [] })).status).toBe(200);
    expect(await links(product.id)).toEqual([]);
    expect((await communityFeed(tokens.demoMember, c)).items).toHaveLength(2);
  });

  it('CR-02: a save that changes the selection keeps the links to archived and removed communities, so an archived community stays locked', async () => {
    const active = await createCommunity(`${PREFIX} adm-cr02-ativa`);
    const archived = await createCommunity(`${PREFIX} adm-cr02-arquivada`);
    const removed = await createCommunity(`${PREFIX} adm-cr02-removida`);
    const other = await createCommunity(`${PREFIX} adm-cr02-outra`);
    const olderOnArchived = await publish(archived, 'antes');
    const newestOnArchived = await publish(archived, 'depois');
    const product = await createProduct(`${PREFIX} adm-cr02`, 1990, [active, archived, removed]);
    // Archived and removed AFTER the link is saved: the API refuses them as new links.
    await adminSql`update public.communities set status = 'archived' where id = ${archived}::uuid`;
    await adminSql`update public.communities set deleted_at = now() where id = ${removed}::uuid`;
    try {
      // The form lists only the active link, so the admin's save sends a new selection without the
      // other two. It replaces only what the form could see.
      const saved = await patch(product.id, { communityIds: [other] });
      expect(saved.status).toBe(200);
      expect(((await saved.json()) as ProductDetail).communities.map((row) => row.id)).toEqual([
        other,
      ]);
      expect(await links(product.id)).toEqual([archived, removed, other].sort());
      // The archived community is still gated: the member without access reads the sample only.
      const lockedFeed = await communityFeed(tokens.demoMember, archived);
      expect(lockedFeed.items.map((i) => i.id)).toEqual([newestOnArchived]);
      expect(lockedFeed.items.map((i) => i.id)).not.toContain(olderOnArchived);
      // An empty selection, too, drops only the active links.
      expect((await patch(product.id, { communityIds: [] })).status).toBe(200);
      expect(await links(product.id)).toEqual([archived, removed].sort());
      expect((await communityFeed(tokens.demoMember, archived)).items.map((i) => i.id)).toEqual([
        newestOnArchived,
      ]);
    } finally {
      await adminSql`update public.communities set status = 'active' where id = ${archived}::uuid`;
      await adminSql`update public.communities set deleted_at = null where id = ${removed}::uuid`;
    }
  });

  it('D-364 / P15 / P16: the preview lists only newly locking communities with an exact count of live members, staff never counted', async () => {
    const fresh = await createCommunity(`${PREFIX} adm-nova`);
    const gatedElsewhere = await createCommunity(`${PREFIX} adm-outra`);
    const ownOnly = await createCommunity(`${PREFIX} adm-propria`);
    const archivedCommunity = await createCommunity(`${PREFIX} adm-arquivada`);
    await adminSql`update public.communities set status = 'archived' where id = ${archivedCommunity}::uuid`;
    await createProduct(`${PREFIX} adm-outro`, 990, [gatedElsewhere]);
    const product = await createProduct(`${PREFIX} adm-alvo`, 1990, [ownOnly]);

    const live = await liveMembers();
    const [staff] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.memberships
       where tenant_id = ${demoTenantId}::uuid and role in ('admin_tenant', 'support_tenant')
         and status = 'active' and deleted_at is null`;
    expect(staff?.n ?? 0).toBeGreaterThan(0);
    expect(live).toBeGreaterThan(0);

    // A new product (no productId): every live member; only the fresh community is newly locking.
    const unknownCommunity = '00000000-0000-4000-8000-000000000000';
    const res = await preview({
      communityIds: [gatedElsewhere, fresh, ownOnly, archivedCommunity, unknownCommunity],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [{ communityId: fresh, membersLosingAccess: live }],
    });

    // Editing the product: its holders do not lose access (exact count, never estimated).
    const bought = await post(`/v1/store/products/${product.id}/purchase`, tokens.demoMember, {
      expectedAmountCents: 1990,
    });
    expect(bought.status).toBe(200);
    const edited = await preview({ productId: product.id, communityIds: [fresh, ownOnly] });
    expect(await edited.json()).toEqual({
      items: [{ communityId: fresh, membersLosingAccess: live - 1 }],
    });
    // Staff holding the product changes nothing: they were never counted.
    await post(`/v1/store/products/${product.id}/purchase`, tokens.demoSupport, {
      expectedAmountCents: 1990,
    });
    const withStaff = await preview({ productId: product.id, communityIds: [fresh] });
    expect(
      ((await withStaff.json()) as { items: { membersLosingAccess: number }[] }).items[0]
        ?.membersLosingAccess,
    ).toBe(live - 1);

    // N = 0 when every live member already holds the product.
    const [admin] = await adminSql<{ user_id: string }[]>`
      select user_id::text as user_id from public.memberships
       where tenant_id = ${demoTenantId}::uuid and role = 'admin_tenant' limit 1`;
    await adminSql`
      insert into public.store_entitlements (tenant_id, user_id, product_id, source, granted_by_user_id)
      select m.tenant_id, m.user_id, ${product.id}::uuid, 'grant', ${admin?.user_id ?? ''}::uuid
        from public.memberships m
       where m.tenant_id = ${demoTenantId}::uuid and m.role = 'member' and m.status = 'active'
         and m.blocked_at is null and m.deleted_at is null
      on conflict (tenant_id, user_id, product_id) where status = 'active' do nothing`;
    const none = await preview({ productId: product.id, communityIds: [fresh] });
    expect(await none.json()).toEqual({ items: [{ communityId: fresh, membersLosingAccess: 0 }] });

    // The preview writes nothing, and a productId outside the tenant is the bare 404.
    expect(await links(product.id)).toEqual([ownOnly]);
    const foreign = await preview({
      productId: '00000000-0000-4000-8000-000000000000',
      communityIds: [fresh],
    });
    expect(foreign.status).toBe(404);
    expect((await preview({ communityIds: [] })).status).toBe(400);
  });

  it('P06 / P09: field boundaries through the API, measured in trimmed UTF-16 code units', async () => {
    const product = await createProduct(`${PREFIX} adm-campos`, 1990, []);
    // Accepted.
    for (const body of [
      { name: 'x' },
      { name: `${PREFIX}`.padEnd(80, 'n') },
      { name: `  ${'é'.repeat(80)}  ` },
      { description: '' },
      { description: 'd'.repeat(2000) },
      { priceCents: 0 },
      { priceCents: 10_000_000 },
    ]) {
      const res = await patch(product.id, body);
      expect(res.status).toBe(200);
    }
    const [stored] = await adminSql<{ name: string }[]>`
      select name from public.store_products where id = ${product.id}::uuid`;
    expect(stored?.name).toBe('é'.repeat(80));
    // P09 as Zod 4.6 measures it: `.max()` counts CODE POINTS, so an astral character (two UTF-16
    // units) counts once at the API. The browser `maxLength` counts UTF-16 units and is therefore
    // the STRICTER side: the form can never send a name the API refuses. 80 emoji pass here, 81 fail.
    expect((await patch(product.id, { name: '😀'.repeat(80) })).status).toBe(200);
    // Refused, each with its machine code; nothing written.
    for (const [body, issue] of [
      [{ name: '' }, 'name_required'],
      [{ name: '   ' }, 'name_required'],
      [{ name: 'x'.repeat(81) }, 'name_too_long'],
      [{ name: '😀'.repeat(81) }, 'name_too_long'],
      [{ description: 'd'.repeat(2001) }, 'description_too_long'],
      [{ priceCents: -1 }, 'price_invalid'],
      [{ priceCents: 10_000_001 }, 'price_invalid'],
      [{ priceCents: 19.9 }, 'price_invalid'],
    ] as const) {
      const res = await patch(product.id, body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as Envelope).error.details).toEqual({ store: issue });
    }
    const empty = await patch(product.id, {});
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as Envelope).error.code).toBe('VALIDATION_FAILED');

    // 50 community ids are accepted, 51 are refused (the create and the patch share the rule).
    const [admin] = await adminSql<{ user_id: string }[]>`
      select user_id::text as user_id from public.memberships
       where tenant_id = ${demoTenantId}::uuid and role = 'admin_tenant' limit 1`;
    const many = await adminSql<{ id: string }[]>`
      insert into public.communities (tenant_id, created_by_user_id, name, slug)
      select ${demoTenantId}::uuid, ${admin?.user_id ?? ''}::uuid,
             ${`${PREFIX} cap `} || g, ${`st-${RUN}-cap-`} || g
        from generate_series(1, 51) g
      returning id::text as id`;
    const ids = many.map((row) => row.id);
    const fifty = await patch(product.id, { communityIds: ids.slice(0, 50) });
    expect(fifty.status).toBe(200);
    expect((await links(product.id)).length).toBe(50);
    const fiftyOne = await patch(product.id, { communityIds: ids });
    expect(fiftyOne.status).toBe(400);
    expect(((await fiftyOne.json()) as Envelope).error.details).toEqual({
      store: 'too_many_communities',
    });
    expect((await links(product.id)).length).toBe(50);
    // Back to a prefixed name and no links, so the file's sweep finds it.
    const restored = await patch(product.id, { name: `${PREFIX} adm-campos`, communityIds: [] });
    expect(restored.status).toBe(200);
  });

  it('P12 / P13: the same patch twice leaves the same row and links; two concurrent patches leave exactly one submitted set', async () => {
    const a = await createCommunity(`${PREFIX} adm-ca`);
    const b = await createCommunity(`${PREFIX} adm-cb`);
    const c = await createCommunity(`${PREFIX} adm-cc`);
    const d = await createCommunity(`${PREFIX} adm-cd`);
    const product = await createProduct(`${PREFIX} adm-corrida`, 1990, []);

    const body = { name: `${PREFIX} adm-corrida 2`, priceCents: 2990, communityIds: [a, b] };
    const once = await patch(product.id, body);
    expect(once.status).toBe(200);
    const twice = await patch(product.id, body);
    expect(twice.status).toBe(200);
    expect(await twice.json()).toEqual(await once.json());
    expect(await links(product.id)).toEqual([a, b].sort());

    const setOne = [a, b];
    const setTwo = [c, d];
    for (let round = 0; round < 5; round += 1) {
      const answers = await Promise.all([
        patch(product.id, { communityIds: setOne }),
        patch(product.id, { communityIds: setTwo }),
      ]);
      expect(answers.map((res) => res.status)).toEqual([200, 200]);
      const final = await links(product.id);
      expect([[...setOne].sort(), [...setTwo].sort()]).toContainEqual(final);
    }
  });
});

/**
 * The 08.4 store-side write path at its edges (08.4-03, SC 3, SC 5, STORE-22, STORE-03, D-418):
 * `courseIds` and `liveIds` on the product routes replace, clear, dedupe and cap; links to archived
 * courses and cancelled lives are kept by every replace and accepted when re-sent; another tenant's
 * ids are refused by name; two concurrent writes never merge; the three link sets are independent;
 * the module switches only pause the gate; a member's detail never names a course or a live; and the
 * store's projected live status equals the courses module's. Every link write is wrapped in
 * `linkWrite`, which asserts the tenant's entitlement and order counts are unchanged around it
 * (PR-2: a link edit never touches what a member holds). Courses and lives carry the file's `st-`
 * prefix; the identities carry `st84l`; everything is swept in `afterAll`.
 */
describe('product course and live links', () => {
  const ID_PREFIX = 'st84l';
  let restoreCourses: () => Promise<void> = async () => {};
  let seedMemberUserId = '';

  const patchProduct = (productId: string, body: unknown, token = tokens.demoAdmin) =>
    request(`/v1/store/products/${productId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

  /** A course through `POST /v1/courses` (draft), and its id. */
  async function createCourse(title: string, token = tokens.demoAdmin, host = HOSTS.demo) {
    const res = await post(
      '/v1/courses',
      token,
      { title: `${PREFIX} ${title}`, instructorName: 'Dra. Ana' },
      host,
    );
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  /** Archives a course through `PUT /v1/courses/{courseId}/status`. */
  async function archiveCourse(courseId: string): Promise<void> {
    const res = await request(`/v1/courses/${courseId}/status`, tokens.demoAdmin, {
      method: 'PUT',
      body: JSON.stringify({ status: 'archived' }),
    });
    expect(res.status).toBe(200);
  }

  /** A live through `POST /v1/courses/lives` starting `startIn` minutes from now, and its id. */
  async function scheduleLive(
    title: string,
    startIn: number,
    durationMin = 60,
    token = tokens.demoAdmin,
    host = HOSTS.demo,
  ): Promise<string> {
    const res = await post(
      '/v1/courses/lives',
      token,
      {
        title: `${PREFIX} ${title}`,
        startsAt: minutes(startIn),
        durationMin,
        externalUrl: 'https://youtu.be/st-084-links',
      },
      host,
    );
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  async function cancelLive(liveId: string): Promise<void> {
    const res = await request(`/v1/courses/lives/${liveId}/cancel`, tokens.demoAdmin, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
  }

  /** The member-lane gate (`app.course_locked_ids()` / `app.live_locked_ids()`) for one user. */
  async function lockedIds(kind: 'course' | 'live', userId = seedMemberUserId): Promise<string[]> {
    return adminSql.begin(async (sql) => {
      const claims = JSON.stringify({
        sub: userId,
        role: 'authenticated',
        tenant_id: demoTenantId,
        tenant_role: 'member',
      });
      await sql`select set_config('request.jwt.claims', ${claims}, true)`;
      await sql`set local role authenticated`;
      const [row] =
        kind === 'course'
          ? await sql<{ ids: string[] }[]>`select app.course_locked_ids()::text[] as ids`
          : await sql<{ ids: string[] }[]>`select app.live_locked_ids()::text[] as ids`;
      return row?.ids ?? [];
    });
  }

  type LinkRow = { target_id: string; created_at: string };

  /** A product's course or live link rows as stored, sorted by target id. */
  async function linkRows(kind: 'course' | 'live', productId: string): Promise<LinkRow[]> {
    return kind === 'course'
      ? adminSql<LinkRow[]>`
          select course_id::text as target_id, created_at::text as created_at
            from public.store_product_courses
           where product_id = ${productId}::uuid order by course_id`
      : adminSql<LinkRow[]>`
          select live_id::text as target_id, created_at::text as created_at
            from public.store_product_lives
           where product_id = ${productId}::uuid order by live_id`;
  }
  const targets = async (kind: 'course' | 'live', productId: string) =>
    (await linkRows(kind, productId)).map((row) => row.target_id);

  /** A product's community link rows as stored. */
  async function communityRows(productId: string): Promise<LinkRow[]> {
    return adminSql<LinkRow[]>`
      select community_id::text as target_id, created_at::text as created_at
        from public.store_product_communities
       where product_id = ${productId}::uuid order by community_id`;
  }

  /** Every entitlement and order of the demo tenant, counted (PR-2). */
  async function entitlementsAndOrdersCount(): Promise<{ entitlements: number; orders: number }> {
    const [row] = await adminSql<{ entitlements: number; orders: number }[]>`
      select (select count(*)::int from public.store_entitlements
               where tenant_id = ${demoTenantId}::uuid) as entitlements,
             (select count(*)::int from public.store_orders
               where tenant_id = ${demoTenantId}::uuid) as orders`;
    return row ?? { entitlements: -1, orders: -1 };
  }

  /** Runs a link write and asserts no entitlement or order was written around it (PR-2). */
  async function linkWrite<T>(write: () => Promise<T>): Promise<T> {
    const before = await entitlementsAndOrdersCount();
    const result = await write();
    expect(await entitlementsAndOrdersCount()).toEqual(before);
    return result;
  }

  /** A link PATCH wrapped in `linkWrite`, expecting `status`; answers the parsed body. */
  async function linkPatch(productId: string, body: unknown, status = 200, token?: string) {
    return linkWrite(async () => {
      const res = await patchProduct(productId, body, token);
      expect(res.status).toBe(status);
      return (await res.json()) as ProductDetail & Envelope;
    });
  }

  /** The manager's product detail. */
  const managerDetail = (productId: string) =>
    getJson<ProductDetail>(`/v1/store/products/${productId}`, tokens.demoAdmin);

  /** A product created through the API with any link keys, wrapped in `linkWrite`. */
  async function createLinked(name: string, body: Record<string, unknown>): Promise<ProductDetail> {
    return linkWrite(async () => {
      const res = await post('/v1/store/products', tokens.demoAdmin, {
        name: `${PREFIX} ${name}`,
        priceCents: 1990,
        ...body,
      });
      expect(res.status).toBe(201);
      return (await res.json()) as ProductDetail;
    });
  }

  /**
   * Runs `fn` with the demo tenant's `key` row set to `enabled`, then puts the row back exactly as
   * found (the `courses.test.ts` `withDemoStore` shape, for either module). The API flag cache is
   * dropped on both edges; the SQL gate reads the row directly.
   */
  async function withDemoModule<T>(
    key: 'store' | 'courses',
    enabled: boolean,
    fn: () => Promise<T>,
  ): Promise<T> {
    const [row] = await adminSql<{ enabled: boolean }[]>`
      select enabled from public.tenant_modules
       where tenant_id = ${demoTenantId}::uuid and module_key = ${key}`;
    const was = row?.enabled ?? false;
    await adminSql`
      update public.tenant_modules set enabled = ${enabled}
       where tenant_id = ${demoTenantId}::uuid and module_key = ${key}`;
    moduleFlags.invalidate(demoTenantId);
    try {
      return await fn();
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = ${was}
         where tenant_id = ${demoTenantId}::uuid and module_key = ${key}`;
      moduleFlags.invalidate(demoTenantId);
    }
  }

  function expectStoreIssue(res: ProductDetail & Envelope, issue: string): void {
    expect(res.error.code).toBe('VALIDATION_FAILED');
    expect(res.error.details).toEqual({ store: issue });
  }

  async function sweepLinks(): Promise<void> {
    await adminSql`delete from public.course_lives where title like ${'st-%'}`;
    await adminSql`delete from public.courses where title like ${'st-%'}`;
  }

  beforeAll(async () => {
    await storeOn(demoTenantId);
    restoreCourses = await withModuleEnabled('demo', 'courses');
    await removeIdentitiesByPrefix(ID_PREFIX);
    await sweepLinks();
    const [member] = await adminSql<{ id: string }[]>`
      select id::text as id from auth.users where email = 'member@rede-demo.local'`;
    seedMemberUserId = member?.id ?? '';
  });

  afterAll(async () => {
    await restoreCourses();
    await removeIdentitiesByPrefix(ID_PREFIX);
    // Entitlements, orders and products (their links cascade), then the courses and lives.
    await sweep();
    await sweepLab();
    await sweepLinks();
  });

  it('EP-08 / EP-07: [a, b, a] stores two rows; the detail orders courses by (created_at desc, id desc) and lives by (starts_at asc, id asc); [] clears; a patch without the key keeps the set; a create without the keys stores none; 51 ids are too_many_courses / too_many_lives with nothing written', async () => {
    const a = await createCourse('ep08 a');
    const b = await createCourse('ep08 b');
    const late = await scheduleLive('ep08 tarde', 48 * 60);
    const soon = await scheduleLive('ep08 cedo', 24 * 60);
    const unlinked = await createCourse('ep08 sem vinculo');

    const created = await createLinked('ep08', { courseIds: [a, b, a], liveIds: [late, soon] });
    expect(await targets('course', created.id)).toEqual([a, b].sort());
    expect(await targets('live', created.id)).toEqual([late, soon].sort());
    const courseOrder = await adminSql<{ id: string }[]>`
      select id::text as id from public.courses where id in (${a}::uuid, ${b}::uuid)
       order by created_at desc, id desc`;
    expect(created.courses?.map((c) => c.id)).toEqual(courseOrder.map((row) => row.id));
    expect(created.lives?.map((l) => l.id)).toEqual([soon, late]);
    expect((await managerDetail(created.id)).courses?.map((c) => c.id)).toEqual(
      courseOrder.map((row) => row.id),
    );

    // A course or live with no link is open: the gate never names it.
    expect(await lockedIds('course')).toEqual(expect.arrayContaining([a, b]));
    expect(await lockedIds('course')).not.toContain(unlinked);

    // A patch without the keys keeps both sets.
    await linkPatch(created.id, { name: `${PREFIX} ep08 renomeado` });
    expect(await targets('course', created.id)).toEqual([a, b].sort());
    expect(await targets('live', created.id)).toEqual([late, soon].sort());

    // 51 ids: refused by name, nothing written.
    const many = Array.from({ length: 51 }, () => randomUUID());
    expectStoreIssue(await linkPatch(created.id, { courseIds: many }, 400), 'too_many_courses');
    expectStoreIssue(await linkPatch(created.id, { liveIds: many }, 400), 'too_many_lives');
    expect(await targets('course', created.id)).toEqual([a, b].sort());
    expect(await targets('live', created.id)).toEqual([late, soon].sort());

    // [] clears each set on its own.
    const cleared = await linkPatch(created.id, { courseIds: [] });
    expect(cleared.courses).toEqual([]);
    expect(await targets('course', created.id)).toEqual([]);
    expect(await targets('live', created.id)).toEqual([late, soon].sort());
    expect(await lockedIds('course')).not.toContain(a);
    await linkPatch(created.id, { liveIds: [] });
    expect(await targets('live', created.id)).toEqual([]);

    // A create without the keys stores none.
    const bare = await createLinked('ep08 sem chaves', {});
    expect(await targets('course', bare.id)).toEqual([]);
    expect(await targets('live', bare.id)).toEqual([]);
  });

  it('EP-09: the same courseIds / liveIds body twice answers 200 twice and keeps the rows with their first created_at', async () => {
    const a = await createCourse('ep09 a');
    const b = await createCourse('ep09 b');
    const live = await scheduleLive('ep09', 24 * 60);
    const product = await createLinked('ep09', {});

    const once = await linkPatch(product.id, { courseIds: [a, b], liveIds: [live] });
    const rowsOnce = {
      courses: await linkRows('course', product.id),
      lives: await linkRows('live', product.id),
    };
    expect(rowsOnce.courses.map((r) => r.target_id)).toEqual([a, b].sort());
    const twice = await linkPatch(product.id, { courseIds: [a, b], liveIds: [live] });
    expect(twice.courses).toEqual(once.courses);
    expect(twice.lives).toEqual(once.lives);
    expect(await linkRows('course', product.id)).toEqual(rowsOnce.courses);
    expect(await linkRows('live', product.id)).toEqual(rowsOnce.lives);
    // A reordered body is the same set.
    await linkPatch(product.id, { courseIds: [b, a] });
    expect(await linkRows('course', product.id)).toEqual(rowsOnce.courses);
  });

  it('SC 3 kept rule / EP-17: an archived course and a cancelled live stay linked through every replace, stay locked for a non-holder, leave the manager detail and are accepted when re-sent; an archived or cancelled target never linked is refused; a recorded live is linkable (A2)', async () => {
    const kept = await createCourse('kept arquivado');
    const other = await createCourse('kept outro');
    const neverLinked = await createCourse('kept nunca');
    const product = await createLinked('kept', { courseIds: [kept, other] });

    await archiveCourse(kept);
    await archiveCourse(neverLinked);
    const replaced = await linkPatch(product.id, { courseIds: [other] });
    expect(replaced.courses?.map((c) => c.id)).toEqual([other]);
    expect(await targets('course', product.id)).toEqual([kept, other].sort());
    expect(await lockedIds('course')).toContain(kept);
    expect((await managerDetail(product.id)).courses?.map((c) => c.id)).toEqual([other]);
    // Re-sending the archived link is accepted (already linked); [] drops only the linkable one.
    await linkPatch(product.id, { courseIds: [kept, other] });
    expect(await targets('course', product.id)).toEqual([kept, other].sort());
    await linkPatch(product.id, { courseIds: [] });
    expect(await targets('course', product.id)).toEqual([kept]);
    expect(await lockedIds('course')).toContain(kept);
    // An archived course never linked to THIS product is refused by name, nothing written.
    expectStoreIssue(
      await linkPatch(product.id, { courseIds: [other, neverLinked] }, 400),
      'course_invalid',
    );
    expect(await targets('course', product.id)).toEqual([kept]);

    // Lives: a recorded live is linkable (A2).
    const recorded = await scheduleLive('kept gravada', -120, 30);
    const linkedLive = await scheduleLive('kept agendada', 24 * 60);
    const cancelledFirst = await scheduleLive('kept cancelada antes', 24 * 60);
    await cancelLive(cancelledFirst);
    const withLives = await linkPatch(product.id, { liveIds: [recorded, linkedLive] });
    expect(withLives.lives?.map((l) => ({ id: l.id, status: l.status }))).toEqual([
      { id: recorded, status: 'recorded' },
      { id: linkedLive, status: 'scheduled' },
    ]);
    // Cancel first, then link: refused by name, nothing written.
    expectStoreIssue(
      await linkPatch(product.id, { liveIds: [recorded, linkedLive, cancelledFirst] }, 400),
      'live_invalid',
    );
    expect(await targets('live', product.id)).toEqual([recorded, linkedLive].sort());
    // Link first, then cancel: the link stays, leaves the manager detail, still locks.
    await cancelLive(linkedLive);
    expect(await targets('live', product.id)).toEqual([recorded, linkedLive].sort());
    expect((await managerDetail(product.id)).lives?.map((l) => l.id)).toEqual([recorded]);
    expect(await lockedIds('live')).toContain(linkedLive);
    // Re-sending it is accepted (already linked); a replace without it keeps it.
    await linkPatch(product.id, { liveIds: [recorded, linkedLive] });
    await linkPatch(product.id, { liveIds: [] });
    expect(await targets('live', product.id)).toEqual([linkedLive]);
    expect(await lockedIds('live')).toContain(linkedLive);
  });

  it('EP-06: a course linked by P1 and P2 stays locked for a member holding neither after P1 clears it, and a member holding P2 reads it open throughout', async () => {
    const holder = await createSharedIdentity({
      prefix: ID_PREFIX,
      memberships: [{ host: 'demo', role: 'member' }],
    });
    const stranger = await createSharedIdentity({
      prefix: ID_PREFIX,
      memberships: [{ host: 'demo', role: 'member' }],
    });
    const membershipOf = async (userId: string) => {
      const [row] = await adminSql<{ id: string }[]>`
        select id::text as id from public.memberships
         where tenant_id = ${demoTenantId}::uuid and user_id = ${userId}::uuid`;
      return row?.id ?? '';
    };
    const course = await createCourse('ep06');
    const p1 = await createLinked('ep06 p1', { courseIds: [course] });
    const p2 = await createLinked('ep06 p2', { courseIds: [course] });
    const grant = await post(`/v1/store/products/${p2.id}/grants`, tokens.demoAdmin, {
      membershipId: await membershipOf(holder.userId),
    });
    expect(grant.status).toBe(200);

    expect(await lockedIds('course', holder.userId)).not.toContain(course);
    expect(await lockedIds('course', stranger.userId)).toContain(course);
    await linkPatch(p1.id, { courseIds: [] });
    expect(await targets('course', p1.id)).toEqual([]);
    expect(await targets('course', p2.id)).toEqual([course]);
    // P2 still links it: locked for the stranger, open for P2's holder.
    expect(await lockedIds('course', stranger.userId)).toContain(course);
    expect(await lockedIds('course', holder.userId)).not.toContain(course);

    const second = await post(`/v1/store/products/${p2.id}/grants`, tokens.demoAdmin, {
      membershipId: await membershipOf(stranger.userId),
    });
    expect(second.status).toBe(200);
    expect(await lockedIds('course', stranger.userId)).not.toContain(course);
  });

  it('SC 3 cross-tenant: a rede-lab course or live id, an unknown uuid and a non-uuid are 400 course_invalid / live_invalid by name with nothing written; a rede-lab admin editing a rede-demo product is the bare 404', async () => {
    const restoreLabCourses = await withModuleEnabled('lab', 'courses');
    const restoreLabStore = await withModuleEnabled('lab', 'store');
    try {
      const labCourse = await createCourse('lab curso', tokens.labAdmin, HOSTS.lab);
      const labLive = await scheduleLive('lab live', 24 * 60, 60, tokens.labAdmin, HOSTS.lab);
      const own = await createCourse('xt propria');
      const ownLive = await scheduleLive('xt propria', 24 * 60);
      const product = await createLinked('xt', { courseIds: [own], liveIds: [ownLive] });

      for (const id of [labCourse, randomUUID(), 'not-a-uuid']) {
        expectStoreIssue(
          await linkPatch(product.id, { courseIds: [own, id] }, 400),
          'course_invalid',
        );
      }
      for (const id of [labLive, randomUUID(), 'not-a-uuid']) {
        expectStoreIssue(
          await linkPatch(product.id, { liveIds: [ownLive, id] }, 400),
          'live_invalid',
        );
      }
      // The create refuses them the same way, and no product is written.
      const refused = await linkWrite(async () =>
        post('/v1/store/products', tokens.demoAdmin, {
          name: `${PREFIX} xt recusado`,
          priceCents: 990,
          courseIds: [labCourse],
        }),
      );
      expect(refused.status).toBe(400);
      expect(((await refused.json()) as Envelope).error.details).toEqual({
        store: 'course_invalid',
      });
      const [refusedRows] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.store_products where name = ${`${PREFIX} xt recusado`}`;
      expect(refusedRows?.n).toBe(0);
      expect(await targets('course', product.id)).toEqual([own]);
      expect(await targets('live', product.id)).toEqual([ownLive]);

      // A rede-lab admin on its own host cannot reach the demo product (lockProduct, bare 404).
      const foreign = await linkWrite(async () =>
        request(
          `/v1/store/products/${product.id}`,
          tokens.labAdmin,
          { method: 'PATCH', body: JSON.stringify({ courseIds: [labCourse] }) },
          HOSTS.lab,
        ),
      );
      expect(foreign.status).toBe(404);
      const foreignBody = (await foreign.json()) as Envelope;
      expect(foreignBody.error.code).toBe('NOT_FOUND');
      expect(foreignBody.error).not.toHaveProperty('details');
      expect(await targets('course', product.id)).toEqual([own]);
      const [labRows] = await adminSql<{ n: number }[]>`
        select (select count(*)::int from public.store_product_courses where course_id = ${labCourse}::uuid)
             + (select count(*)::int from public.store_product_lives where live_id = ${labLive}::uuid) as n`;
      expect(labRows?.n).toBe(0);
    } finally {
      await restoreLabStore();
      await restoreLabCourses();
    }
  });

  it('EP-10: two concurrent PATCH with different courseIds (or liveIds) both answer 200 and the final set is exactly one of them, never the union; the gate follows the committed set', async () => {
    const a = await createCourse('ep10 a');
    const b = await createCourse('ep10 b');
    const liveA = await scheduleLive('ep10 a', 24 * 60);
    const liveB = await scheduleLive('ep10 b', 25 * 60);
    const product = await createLinked('ep10', {});

    for (let round = 0; round < 4; round += 1) {
      const answers = await linkWrite(() =>
        Promise.all([
          patchProduct(product.id, { courseIds: [a] }),
          patchProduct(product.id, { courseIds: [b] }),
        ]),
      );
      expect(answers.map((res) => res.status)).toEqual([200, 200]);
      const final = await targets('course', product.id);
      expect([[a], [b]]).toContainEqual(final);
      const locked = await lockedIds('course');
      const loser = final[0] === a ? b : a;
      expect(locked).toContain(final[0]);
      expect(locked).not.toContain(loser);
    }
    for (let round = 0; round < 4; round += 1) {
      const answers = await linkWrite(() =>
        Promise.all([
          patchProduct(product.id, { liveIds: [liveA] }),
          patchProduct(product.id, { liveIds: [liveB] }),
        ]),
      );
      expect(answers.map((res) => res.status)).toEqual([200, 200]);
      const final = await targets('live', product.id);
      expect([[liveA], [liveB]]).toContainEqual(final);
      const locked = await lockedIds('live');
      const loser = final[0] === liveA ? liveB : liveA;
      expect(locked).toContain(final[0]);
      expect(locked).not.toContain(loser);
    }
  });

  it('EP-01 / EP-05: the community, course and live sets are independent — a patch of one leaves the others, and concurrent patches of different sets both land', async () => {
    const community = await createCommunity(`${PREFIX} ep01`);
    const otherCommunity = await createCommunity(`${PREFIX} ep01 outra`);
    const course = await createCourse('ep01');
    const otherCourse = await createCourse('ep01 outro');
    const live = await scheduleLive('ep01', 24 * 60);
    const product = await createLinked('ep01', {
      communityIds: [community],
      courseIds: [course],
      liveIds: [live],
    });
    const communitiesBefore = await communityRows(product.id);
    const livesBefore = await linkRows('live', product.id);

    await linkPatch(product.id, { courseIds: [otherCourse] });
    expect(await communityRows(product.id)).toEqual(communitiesBefore);
    expect(await linkRows('live', product.id)).toEqual(livesBefore);
    const coursesBefore = await linkRows('course', product.id);
    expect(coursesBefore.map((r) => r.target_id)).toEqual([otherCourse]);

    await linkPatch(product.id, { communityIds: [] });
    expect(await communityRows(product.id)).toEqual([]);
    expect(await linkRows('course', product.id)).toEqual(coursesBefore);
    expect(await linkRows('live', product.id)).toEqual(livesBefore);

    // EP-05: the product row lock serialises them; neither wipes the other.
    for (let round = 0; round < 3; round += 1) {
      const communityPick = round % 2 === 0 ? community : otherCommunity;
      const coursePick = round % 2 === 0 ? course : otherCourse;
      const answers = await linkWrite(() =>
        Promise.all([
          patchProduct(product.id, { communityIds: [communityPick] }),
          patchProduct(product.id, { courseIds: [coursePick] }),
        ]),
      );
      expect(answers.map((res) => res.status)).toEqual([200, 200]);
      expect((await communityRows(product.id)).map((r) => r.target_id)).toEqual([communityPick]);
      expect(await targets('course', product.id)).toEqual([coursePick]);
      expect(await linkRows('live', product.id)).toEqual(livesBefore);
    }
  });

  it('EP-02 / EP-04: a product with no link reads three empty lists for the manager; re-sending the same communityIds beside a new courseIds keeps the community rows and their created_at', async () => {
    const empty = await createLinked('ep02', {});
    const read = await managerDetail(empty.id);
    expect(read.communities).toEqual([]);
    expect(read.courses).toEqual([]);
    expect(read.lives).toEqual([]);

    const community = await createCommunity(`${PREFIX} ep04`);
    const course = await createCourse('ep04');
    await linkPatch(empty.id, { communityIds: [community] });
    const communitiesBefore = await communityRows(empty.id);
    expect(communitiesBefore.map((r) => r.target_id)).toEqual([community]);
    const both = await linkPatch(empty.id, { communityIds: [community], courseIds: [course] });
    expect(both.communities.map((c) => c.id)).toEqual([community]);
    expect(both.courses?.map((c) => c.id)).toEqual([course]);
    expect(await communityRows(empty.id)).toEqual(communitiesBefore);
  });

  it('PR-1 / T-08.4-05: the member and the support product detail carry neither courses nor lives (strict schema); the admin detail carries both', async () => {
    const course = await createCourse('pr1');
    const live = await scheduleLive('pr1', 24 * 60);
    const product = await createLinked('pr1', { courseIds: [course], liveIds: [live] });
    for (const token of [tokens.demoMember, tokens.demoSupport]) {
      const body = await getJson<Record<string, unknown>>(
        `/v1/store/products/${product.id}`,
        token,
      );
      const parsed = productDetailSchema.parse(body);
      expect(Object.keys(parsed)).not.toContain('courses');
      expect(Object.keys(parsed)).not.toContain('lives');
      expect(Object.keys(body)).not.toContain('courses');
      expect(Object.keys(body)).not.toContain('lives');
    }
    const admin = productDetailSchema.parse(await managerDetail(product.id));
    expect(Object.keys(admin)).toEqual(expect.arrayContaining(['courses', 'lives']));
    expect(admin.courses?.map((c) => c.id)).toEqual([course]);
    expect(admin.lives?.map((l) => l.id)).toEqual([live]);
  });

  it('SC 5: with the store off the course and live gates answer {} while link rows exist, the product routes are 404 MODULE_DISABLED and the course and live details still answer; with courses off, courseIds is still accepted (A4) and the gate answers {}', async () => {
    const course = await createCourse('sc5');
    const live = await scheduleLive('sc5', 24 * 60);
    const product = await createLinked('sc5', { courseIds: [course], liveIds: [live] });
    expect(await lockedIds('course')).toContain(course);
    expect(await lockedIds('live')).toContain(live);

    await withDemoModule('store', false, async () => {
      expect(await lockedIds('course')).toEqual([]);
      expect(await lockedIds('live')).toEqual([]);
      expect(await targets('course', product.id)).toEqual([course]);
      expect(await targets('live', product.id)).toEqual([live]);
      const res = await linkWrite(async () => patchProduct(product.id, { courseIds: [] }));
      expect(res.status).toBe(404);
      expect(((await res.json()) as Envelope).error.code).toBe('MODULE_DISABLED');
      expect(await targets('course', product.id)).toEqual([course]);
      const courseDetail = await getJson<{ products: { id: string }[] }>(
        `/v1/courses/${course}`,
        tokens.demoAdmin,
      );
      expect(courseDetail.products.map((p) => p.id)).toEqual([product.id]);
      const liveDetail = await getJson<{ products: { id: string }[] }>(
        `/v1/courses/lives/${live}`,
        tokens.demoAdmin,
      );
      expect(liveDetail.products.map((p) => p.id)).toEqual([product.id]);
    });
    expect(await lockedIds('course')).toContain(course);

    const dormant = await createCourse('sc5 dormente');
    await withDemoModule('courses', false, async () => {
      const linked = await linkPatch(product.id, { courseIds: [course, dormant] });
      expect(linked.courses?.map((c) => c.id).sort()).toEqual([course, dormant].sort());
      expect(await targets('course', product.id)).toEqual([course, dormant].sort());
      expect(await lockedIds('course')).toEqual([]);
      expect(await lockedIds('live')).toEqual([]);
    });
    // Back on: the dormant links gate again.
    expect(await lockedIds('course')).toEqual(expect.arrayContaining([course, dormant]));
  });

  it('live status parity (planning decision 7): a scheduled, a live-now and a recorded live linked to one product carry the same status in the manager detail and in GET /v1/courses/lives/{liveId}', async () => {
    const scheduled = await scheduleLive('par agendada', 24 * 60);
    const onAir = await scheduleLive('par ao vivo', -30, 60);
    const recorded = await scheduleLive('par gravada', -120, 30);
    const product = await createLinked('par', { liveIds: [scheduled, onAir, recorded] });
    const detail = await managerDetail(product.id);
    const byId = new Map((detail.lives ?? []).map((l) => [l.id, l.status]));
    const expected = { [scheduled]: 'scheduled', [onAir]: 'live', [recorded]: 'recorded' };
    for (const [liveId, status] of Object.entries(expected)) {
      const fromCourses = await getJson<{ status: string }>(
        `/v1/courses/lives/${liveId}`,
        tokens.demoAdmin,
      );
      expect(fromCourses.status).toBe(status);
      expect(byId.get(liveId)).toBe(fromCourses.status);
    }
    // Soonest first (starts_at asc).
    expect(detail.lives?.map((l) => l.id)).toEqual([recorded, onAir, scheduled]);
  });
});

describe('buyers, grant and revoke', () => {
  /** Throwaway identities, one `member` membership in rede-demo each (`removeIdentitiesByPrefix`). */
  const BG_PREFIX = 'st82b';
  type Holder = { userId: string; email: string; token: string; membershipId: string };
  const people: Record<'ana' | 'bruno' | 'carla' | 'davi', Holder> = {
    ana: { userId: '', email: '', token: '', membershipId: '' },
    bruno: { userId: '', email: '', token: '', membershipId: '' },
    carla: { userId: '', email: '', token: '', membershipId: '' },
    davi: { userId: '', email: '', token: '', membershipId: '' },
  };
  const NAMES = {
    ana: 'Ana Compradora',
    bruno: 'Bruno Concedido',
    carla: 'Carla Removida',
    davi: 'Davi Bloqueado',
  } as const;
  let adminUserId = '';

  const buyers = (productId: string, token = tokens.demoAdmin, query = '') =>
    request(`/v1/store/products/${productId}/buyers${query}`, token);
  const grant = (productId: string, membershipId: string, token = tokens.demoAdmin) =>
    post(`/v1/store/products/${productId}/grants`, token, { membershipId });
  const revoke = (productId: string, entitlementId: string, token = tokens.demoAdmin) =>
    request(`/v1/store/products/${productId}/entitlements/${entitlementId}`, token, {
      method: 'DELETE',
    });
  const buy = (productId: string, token: string, expectedAmountCents = 1990) =>
    post(`/v1/store/products/${productId}/purchase`, token, { expectedAmountCents });

  async function expectBare404(res: Response) {
    expect(res.status).toBe(404);
    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error).not.toHaveProperty('details');
  }

  /** Every entitlement and order of a product, through the admin connection. */
  async function ledger(productId: string) {
    const entitlements = await adminSql<
      {
        id: string;
        user_id: string;
        source: string;
        status: string;
        order_id: string | null;
        granted_by_user_id: string | null;
        revoked_by_user_id: string | null;
        revoked: boolean;
      }[]
    >`
      select id::text as id, user_id::text as user_id, source, status, order_id::text as order_id,
             granted_by_user_id::text as granted_by_user_id,
             revoked_by_user_id::text as revoked_by_user_id, revoked_at is not null as revoked
        from public.store_entitlements where product_id = ${productId}::uuid order by created_at, id`;
    const orders = await adminSql<
      { id: string; user_id: string; status: string; revoked: boolean; by: string | null }[]
    >`
      select id::text as id, user_id::text as user_id, status, revoked_at is not null as revoked,
             revoked_by_user_id::text as by
        from public.store_orders where product_id = ${productId}::uuid order by created_at, id`;
    return { entitlements, orders };
  }

  beforeAll(async () => {
    await storeOn(demoTenantId);
    await removeIdentitiesByPrefix(BG_PREFIX);
    for (const key of Object.keys(people) as (keyof typeof people)[]) {
      const created = await createSharedIdentity({
        prefix: BG_PREFIX,
        memberships: [{ host: 'demo', role: 'member', displayName: NAMES[key] }],
      });
      const [membership] = await adminSql<{ id: string }[]>`
        select id::text as id from public.memberships
         where tenant_id = ${demoTenantId}::uuid and user_id = ${created.userId}::uuid`;
      people[key] = {
        userId: created.userId,
        email: created.email,
        token: await signInAs(created.email, created.password),
        membershipId: membership?.id ?? '',
      };
    }
    const [admin] = await adminSql<{ id: string }[]>`
      select id::text as id from public.users where email = 'admin@rede-demo.local'`;
    adminUserId = admin?.id ?? '';
  });

  afterAll(async () => {
    // The store rows of these identities go with them (removeIdentitiesByPrefix clears the ledgers).
    await removeIdentitiesByPrefix(BG_PREFIX);
  });

  it('D-360 / P35 / P36: the holders list, a purchase and a grant told apart by source, a removed member keeps a nameless row, and a re-buy shows once with a new since', async () => {
    // P36: a product nobody holds.
    const empty = await createProduct(`${PREFIX} bg-vazio`, 990, []);
    const emptyRes = await buyers(empty.id);
    expect(emptyRes.status).toBe(200);
    expect(await emptyRes.json()).toEqual({ items: [], nextCursor: null, total: 0 });

    const product = await createProduct(`${PREFIX} bg-lista`, 1990, []);
    expect((await buy(product.id, people.ana.token)).status).toBe(200);
    const granted = await grant(product.id, people.bruno.membershipId);
    expect(granted.status).toBe(200);
    const grantBody = (await granted.json()) as GrantResult;
    expect(grantBody.outcome).toBe('granted');
    expect((await buy(product.id, people.carla.token)).status).toBe(200);
    // Carla's membership is removed AFTER she bought: her row stays, with no name and no membership.
    await adminSql`
      update public.memberships set deleted_at = now() where id = ${people.carla.membershipId}::uuid`;

    const res = await buyers(product.id);
    expect(res.status).toBe(200);
    const text = await res.text();
    // Names come from the tenant's member_profiles; no identity e-mail or user id is projected.
    for (const person of Object.values(people)) {
      expect(text).not.toContain(person.email);
      expect(text).not.toContain(person.userId);
    }
    const page = JSON.parse(text) as BuyersPage;
    expect(page.total).toBe(3);
    expect(page.nextCursor).toBeNull();
    const { entitlements } = await ledger(product.id);
    const entitlementOf = (userId: string) => entitlements.find((e) => e.user_id === userId)?.id;
    expect(page.items.map(({ since: _since, ...rest }) => rest)).toEqual([
      {
        entitlementId: entitlementOf(people.carla.userId),
        membershipId: null,
        displayName: null,
        avatarAssetId: null,
        source: 'purchase',
      },
      {
        entitlementId: grantBody.entitlementId,
        membershipId: people.bruno.membershipId,
        displayName: NAMES.bruno,
        avatarAssetId: null,
        source: 'grant',
      },
      {
        entitlementId: entitlementOf(people.ana.userId),
        membershipId: people.ana.membershipId,
        displayName: NAMES.ana,
        avatarAssetId: null,
        source: 'purchase',
      },
    ]);
    const sinces = page.items.map((item) => item.since);
    expect([...sinces].sort().reverse()).toEqual(sinces);

    // P35: Ana is revoked, then buys again: ONE row for her, a new entitlement and a later `since`.
    const anaBefore = page.items[2];
    expect((await revoke(product.id, anaBefore?.entitlementId ?? '')).status).toBe(200);
    const afterRevoke = (await (await buyers(product.id)).json()) as BuyersPage;
    expect(afterRevoke.total).toBe(2);
    expect(afterRevoke.items.map((item) => item.membershipId)).not.toContain(
      people.ana.membershipId,
    );
    expect((await buy(product.id, people.ana.token)).status).toBe(200);
    const again = (await (await buyers(product.id)).json()) as BuyersPage;
    expect(again.total).toBe(3);
    const anaRows = again.items.filter((item) => item.membershipId === people.ana.membershipId);
    expect(anaRows).toHaveLength(1);
    expect(anaRows[0]?.entitlementId).not.toBe(anaBefore?.entitlementId);
    expect(anaRows[0]?.source).toBe('purchase');
    expect((anaRows[0]?.since ?? '') > (anaBefore?.since ?? '')).toBe(true);
    expect(again.items[0]?.membershipId).toBe(people.ana.membershipId);
  });

  it('P37: holders order by (created_at desc, id desc), stable and exact across keyset pages; bad limits and cursors are 400', async () => {
    const product = await createProduct(`${PREFIX} bg-ordem`, 990, []);
    // Six holders, three of them in the SAME instant, so only the id breaks the tie.
    const holders = await adminSql<{ id: string }[]>`
      select u.id::text as id from public.memberships m join public.users u on u.id = m.user_id
       where m.tenant_id = ${demoTenantId}::uuid and m.user_id <> ${adminUserId}::uuid
       order by u.id limit 6`;
    expect(holders).toHaveLength(6);
    const instants = [
      '2026-10-01T10:00:00Z',
      '2026-10-02T10:00:00Z',
      '2026-10-02T10:00:00Z',
      '2026-10-02T10:00:00Z',
      '2026-10-03T10:00:00Z',
      '2026-10-04T10:00:00Z',
    ];
    for (const [index, holder] of holders.entries()) {
      await adminSql`
        insert into public.store_entitlements
               (tenant_id, user_id, product_id, source, granted_by_user_id, created_at)
        values (${demoTenantId}::uuid, ${holder.id}::uuid, ${product.id}::uuid, 'grant',
                ${adminUserId}::uuid, ${instants[index] ?? ''}::timestamptz)`;
    }
    const expected = (
      await adminSql<{ id: string }[]>`
        select id::text as id from public.store_entitlements
         where product_id = ${product.id}::uuid and status = 'active'
         order by created_at desc, id desc`
    ).map((row) => row.id);

    for (const limit of [1, 2, 4, 6, 50]) {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 20; guard += 1) {
        const query: string = `?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const res = await buyers(product.id, tokens.demoAdmin, query);
        expect(res.status).toBe(200);
        const page = (await res.json()) as BuyersPage;
        expect(page.total).toBe(6);
        seen.push(...page.items.map((item) => item.entitlementId));
        cursor = page.nextCursor;
        if (cursor === null) break;
      }
      expect(seen).toEqual(expected);
    }
    // The same request twice answers the same page.
    const first = await (await buyers(product.id, tokens.demoAdmin, '?limit=3')).json();
    expect(await (await buyers(product.id, tokens.demoAdmin, '?limit=3')).json()).toEqual(first);
    for (const query of ['?limit=0', '?limit=51', '?cursor=nao-e-cursor', '?filter=all']) {
      const res = await buyers(product.id, tokens.demoAdmin, query);
      expect(res.status).toBe(400);
      expect(((await res.json()) as Envelope).error.code).toBe('VALIDATION_FAILED');
    }
    // An unknown product is the bare 404, never an empty page.
    await expectBare404(await buyers('00000000-0000-4000-8000-000000000000'));
  });

  it('D-360 / P34: a grant opens the community on the next read, a second grant is already_active, an archived product may be granted, and blocked, removed, unknown or foreign memberships are the bare 404', async () => {
    const communityId = await createCommunity(`${PREFIX} bg-concedida`);
    const older = await publish(communityId, 'antigo');
    const newer = await publish(communityId, 'novo');
    const product = await createProduct(`${PREFIX} bg-concessao`, 1990, [communityId]);
    expect(
      (await communityFeed(people.davi.token, communityId)).items.map((item) => item.id),
    ).toEqual([newer]);

    // Davi is granted while active: the community opens on his next read.
    const first = await grant(product.id, people.davi.membershipId);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as GrantResult;
    expect(firstBody.outcome).toBe('granted');
    expect(
      (await communityFeed(people.davi.token, communityId)).items.map((item) => item.id),
    ).toEqual([newer, older]);
    const { entitlements, orders } = await ledger(product.id);
    expect(entitlements).toEqual([
      expect.objectContaining({
        id: firstBody.entitlementId,
        user_id: people.davi.userId,
        source: 'grant',
        status: 'active',
        order_id: null,
        granted_by_user_id: adminUserId,
      }),
    ]);
    expect(orders).toEqual([]);

    // Again: already_active, the same entitlement, nothing written.
    const second = await grant(product.id, people.davi.membershipId);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({
      outcome: 'already_active',
      entitlementId: firstBody.entitlementId,
    });
    expect((await ledger(product.id)).entitlements).toHaveLength(1);

    // P34: a member who already bought gets already_active pointing at the PURCHASE entitlement.
    const bought = await createProduct(`${PREFIX} bg-ja-comprado`, 1990, []);
    expect((await buy(bought.id, people.bruno.token)).status).toBe(200);
    const before = await ledger(bought.id);
    const onPurchase = await grant(bought.id, people.bruno.membershipId);
    expect(onPurchase.status).toBe(200);
    expect(await onPurchase.json()).toEqual({
      outcome: 'already_active',
      entitlementId: before.entitlements[0]?.id,
    });
    expect(await ledger(bought.id)).toEqual(before);

    // An archived product may be granted (archiving refuses NEW purchases only).
    const archived = await createProduct(`${PREFIX} bg-arquivado`, 1990, []);
    await adminSql`update public.store_products set status = 'archived' where id = ${archived.id}::uuid`;
    const onArchived = await grant(archived.id, people.bruno.membershipId);
    expect(onArchived.status).toBe(200);
    expect(((await onArchived.json()) as GrantResult).outcome).toBe('granted');

    // Refusals: blocked, removed, unknown, another tenant's membership, and an unknown product.
    const target = await createProduct(`${PREFIX} bg-recusas`, 1990, []);
    await adminSql`
      update public.memberships set status = 'blocked', blocked_at = now()
       where id = ${people.davi.membershipId}::uuid`;
    try {
      const [labMembership] = await adminSql<{ id: string }[]>`
        select id::text as id from public.memberships
         where tenant_id = ${labTenantId}::uuid and role = 'member' limit 1`;
      for (const membershipId of [
        people.davi.membershipId,
        people.carla.membershipId,
        '00000000-0000-4000-8000-000000000000',
        labMembership?.id ?? '',
      ]) {
        await expectBare404(await grant(target.id, membershipId));
      }
      await expectBare404(
        await grant('00000000-0000-4000-8000-000000000000', people.ana.membershipId),
      );
      expect((await ledger(target.id)).entitlements).toEqual([]);
    } finally {
      await adminSql`
        update public.memberships set status = 'active', blocked_at = null
         where id = ${people.davi.membershipId}::uuid`;
    }
  });

  it('D-359 / P42: a revoke ends access on the next read and keeps the rows as history; a re-buy writes a new order and entitlement; twice, or under another product, is the bare 404', async () => {
    const communityId = await createCommunity(`${PREFIX} bg-revogada`);
    const older = await publish(communityId, 'um');
    const newer = await publish(communityId, 'dois');
    const product = await createProduct(`${PREFIX} bg-revoga`, 1990, [communityId]);
    const other = await createProduct(`${PREFIX} bg-outro`, 1990, []);
    expect((await buy(product.id, people.ana.token)).status).toBe(200);
    expect(
      (await communityFeed(people.ana.token, communityId)).items.map((item) => item.id),
    ).toEqual([newer, older]);
    const [purchase] = (await ledger(product.id)).entitlements;
    const entitlementId = purchase?.id ?? '';

    // No IDOR: the entitlement under ANOTHER product's path is the bare 404 and stays active.
    await expectBare404(await revoke(other.id, entitlementId));
    expect((await ledger(product.id)).entitlements[0]?.status).toBe('active');

    const res = await revoke(product.id, entitlementId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: 'revoked' });
    // History: both rows stay, revoked, stamped with the admin.
    const after = await ledger(product.id);
    expect(after.entitlements).toEqual([
      expect.objectContaining({
        id: entitlementId,
        status: 'revoked',
        revoked: true,
        revoked_by_user_id: adminUserId,
      }),
    ]);
    expect(after.orders).toEqual([
      expect.objectContaining({ status: 'revoked', revoked: true, by: adminUserId }),
    ]);
    // P42: the very next read is the sample only, and the product is no longer owned.
    expect(
      (await communityFeed(people.ana.token, communityId)).items.map((item) => item.id),
    ).toEqual([newer]);
    expect(
      (await getJson<ProductDetail>(`/v1/store/products/${product.id}`, people.ana.token)).owned,
    ).toBe(false);

    // Revoking twice is the bare 404.
    await expectBare404(await revoke(product.id, entitlementId));

    // The member buys again: a NEW order and a NEW entitlement, the old ones untouched.
    expect((await buy(product.id, people.ana.token)).status).toBe(200);
    const rebought = await ledger(product.id);
    expect(rebought.orders.map((order) => order.status)).toEqual(['revoked', 'paid']);
    expect(rebought.entitlements.map((e) => e.status)).toEqual(['revoked', 'active']);
    expect(rebought.entitlements[1]?.order_id).toBe(rebought.orders[1]?.id);
    expect(
      (await communityFeed(people.ana.token, communityId)).items.map((item) => item.id),
    ).toEqual([newer, older]);

    // Revoking a GRANT touches no order.
    const granted = (await (
      await grant(other.id, people.bruno.membershipId)
    ).json()) as GrantResult;
    expect((await revoke(other.id, granted.entitlementId)).status).toBe(200);
    const otherLedger = await ledger(other.id);
    expect(otherLedger.orders).toEqual([]);
    expect(otherLedger.entitlements.map((e) => e.status)).toEqual(['revoked']);
    // An unknown entitlement id is the same bare 404.
    await expectBare404(await revoke(product.id, '00000000-0000-4000-8000-000000000000'));
  });

  it('T-08.2-12: a member and a support_tenant get 403 on the holders list, the grant and the revoke, and nothing changes', async () => {
    const product = await createProduct(`${PREFIX} bg-guarda`, 1990, []);
    expect((await buy(product.id, people.ana.token)).status).toBe(200);
    const before = await ledger(product.id);
    const entitlementId = before.entitlements[0]?.id ?? '';
    for (const token of [tokens.demoMember, tokens.demoSupport, people.ana.token]) {
      for (const res of [
        await buyers(product.id, token),
        await grant(product.id, people.bruno.membershipId, token),
        await revoke(product.id, entitlementId, token),
      ]) {
        expect(res.status).toBe(403);
        expect(((await res.json()) as Envelope).error.code).toBe('FORBIDDEN');
      }
    }
    expect(await ledger(product.id)).toEqual(before);
  });

  it('a grant and a purchase of the same member and product fired together leave ONE active entitlement and no orphan paid order', async () => {
    for (let round = 0; round < 6; round += 1) {
      const product = await createProduct(`${PREFIX} bg-corrida-${round}`, 1990, []);
      const answers = await Promise.all([
        buy(product.id, people.ana.token),
        grant(product.id, people.ana.membershipId),
      ]);
      expect(answers.map((res) => res.status)).toEqual([200, 200]);
      const { entitlements, orders } = await ledger(product.id);
      const active = entitlements.filter((e) => e.status === 'active');
      expect(active).toHaveLength(1);
      const paid = orders.filter((order) => order.status === 'paid');
      // A paid order exists exactly when the purchase won, and then the entitlement points at it.
      if (active[0]?.source === 'purchase') {
        expect(paid.map((order) => order.id)).toEqual([active[0]?.order_id]);
      } else {
        expect(paid).toEqual([]);
      }
      const grantBody = (await answers[1].json()) as GrantResult;
      expect(grantBody.entitlementId).toBe(active[0]?.id);
      expect(grantBody.outcome).toBe(active[0]?.source === 'grant' ? 'granted' : 'already_active');
    }
  });
});

/**
 * The 08.4 tracer (08.4-01, SC 2, SC 3, SC 4, STORE-22, COURSE-08, COURSE-11; D-418): the product
 * route is the ONLY writer of a course or live link, the store owns the link tables, and the kernel
 * gate (`app.course_locked_ids()` / `app.live_locked_ids()`) reads them with the 08.3 answers. The
 * course and live routes refuse the old link key with 400 and write no row. Courses and lives this
 * describe creates carry the file's `st-` prefix and are swept in its `afterAll` (links cascade with
 * either side).
 */
describe('08.4 tracer', () => {
  let demoMemberUserId = '';
  let demoMemberMembershipId = '';
  let restoreCourses: () => Promise<void> = async () => {};

  const patch = (path: string, token: string, body: unknown) =>
    request(path, token, { method: 'PATCH', body: JSON.stringify(body) });

  /** A gate function as the seed member's lane reads it, in one admin-connection transaction. */
  async function memberLockedIds(fn: 'course_locked_ids' | 'live_locked_ids'): Promise<string[]> {
    return adminSql.begin(async (sql) => {
      const claims = JSON.stringify({
        sub: demoMemberUserId,
        role: 'authenticated',
        tenant_id: demoTenantId,
        tenant_role: 'member',
      });
      await sql`select set_config('request.jwt.claims', ${claims}, true)`;
      await sql`set local role authenticated`;
      const [row] =
        fn === 'course_locked_ids'
          ? await sql<{ ids: string[] }[]>`select app.course_locked_ids()::text[] as ids`
          : await sql<{ ids: string[] }[]>`select app.live_locked_ids()::text[] as ids`;
      return row?.ids ?? [];
    });
  }

  async function courseLinkCount(courseId: string): Promise<number> {
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.store_product_courses where course_id = ${courseId}::uuid`;
    return row?.n ?? -1;
  }

  async function sweepTracer(): Promise<void> {
    await adminSql`delete from public.course_lives where title like ${'st-%'}`;
    await adminSql`delete from public.courses where title like ${'st-%'}`;
  }

  beforeAll(async () => {
    await storeOn(demoTenantId);
    restoreCourses = await withModuleEnabled('demo', 'courses');
    await sweepTracer();
    const [member] = await adminSql<{ user_id: string; membership_id: string }[]>`
      select m.user_id::text as user_id, m.id::text as membership_id
        from public.memberships m
        join auth.users a on a.id = m.user_id
       where m.tenant_id = ${demoTenantId}::uuid and a.email = 'member@rede-demo.local'`;
    demoMemberUserId = member?.user_id ?? '';
    demoMemberMembershipId = member?.membership_id ?? '';
  });

  afterAll(async () => {
    await restoreCourses();
    // Entitlements and products first (the file sweep), then the courses and lives they opened.
    await sweep();
    await sweepTracer();
  });

  it('course: the product route links a draft course, the gate locks it for a member until the grant, the course detail lists the product read-only, the course routes refuse the old link key, and a member never sees the course list', async () => {
    const courseRes = await post('/v1/courses', tokens.demoAdmin, {
      title: `${PREFIX} 084 curso`,
      instructorName: 'Dra. Ana',
    });
    expect(courseRes.status).toBe(201);
    const course = (await courseRes.json()) as { id: string; title: string; products: unknown[] };
    expect(course.products).toEqual([]);

    const product = await createProduct(`${PREFIX} 084 produto curso`, 1990, []);
    expect(product.courses).toEqual([]);

    const linkedRes = await patch(`/v1/store/products/${product.id}`, tokens.demoAdmin, {
      courseIds: [course.id],
    });
    expect(linkedRes.status).toBe(200);
    const linked = (await linkedRes.json()) as ProductDetail;
    expect(linked.courses).toEqual([
      { id: course.id, title: course.title, coverAssetId: null, status: 'draft' },
    ]);

    const rows = await adminSql<{ tenant_id: string; product_id: string; course_id: string }[]>`
      select tenant_id::text as tenant_id, product_id::text as product_id, course_id::text as course_id
        from public.store_product_courses where course_id = ${course.id}::uuid`;
    expect(rows).toEqual([
      { tenant_id: demoTenantId, product_id: product.id, course_id: course.id },
    ]);

    // The gate reads the store's table: locked for the member until the product is granted.
    expect(await memberLockedIds('course_locked_ids')).toContain(course.id);
    const granted = await post(`/v1/store/products/${product.id}/grants`, tokens.demoAdmin, {
      membershipId: demoMemberMembershipId,
    });
    expect(granted.status).toBe(200);
    expect(await memberLockedIds('course_locked_ids')).not.toContain(course.id);

    // The course detail lists the product, read by SQL from the store's table.
    const detail = await getJson<{ products: unknown[] }>(
      `/v1/courses/${course.id}`,
      tokens.demoAdmin,
    );
    expect(detail.products).toEqual([{ id: product.id, name: product.name, status: 'active' }]);

    // The course routes refuse the old link key (strict) and write nothing.
    const alone = await patch(`/v1/courses/${course.id}`, tokens.demoAdmin, { productIds: [] });
    expect(alone.status).toBe(400);
    const aloneBody = (await alone.json()) as Envelope;
    expect(aloneBody.error.code).toBe('VALIDATION_FAILED');
    expect(aloneBody.error.details).toEqual({ courses: 'patch_empty' });
    const beside = await patch(`/v1/courses/${course.id}`, tokens.demoAdmin, {
      title: `${PREFIX} 084 curso novo`,
      productIds: [product.id],
    });
    expect(beside.status).toBe(400);
    const besideBody = (await beside.json()) as Envelope;
    expect(besideBody.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(besideBody.error.details?.issues)).toContain('productIds');
    const created = await post('/v1/courses', tokens.demoAdmin, {
      title: `${PREFIX} 084 curso recusado`,
      instructorName: 'Dra. Ana',
      productIds: [product.id],
    });
    expect(created.status).toBe(400);
    expect(await courseLinkCount(course.id)).toBe(1);
    const [refusedCourses] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.courses where title = ${`${PREFIX} 084 curso recusado`}`;
    expect(refusedCourses?.n).toBe(0);

    // A member's product detail never names a course or a live (PR-1, T-08.4-05).
    const memberView = await getJson<Record<string, unknown>>(
      `/v1/store/products/${product.id}`,
      tokens.demoMember,
    );
    expect(memberView).not.toHaveProperty('courses');
    expect(memberView).not.toHaveProperty('lives');
    expect(memberView).not.toHaveProperty('holderCount');
  });

  it('live: the product route links a scheduled live, the gate locks it for a member until the grant, the live detail lists the product read-only, and the live routes refuse the old link key', async () => {
    const startsAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const liveRes = await post('/v1/courses/lives', tokens.demoAdmin, {
      title: `${PREFIX} 084 live`,
      startsAt,
      durationMin: 60,
      externalUrl: 'https://youtu.be/st-084',
    });
    expect(liveRes.status).toBe(201);
    const live = (await liveRes.json()) as { id: string; title: string; startsAt: string };

    const product = await createProduct(`${PREFIX} 084 produto live`, 1990, []);
    expect(product.lives).toEqual([]);

    const linkedRes = await patch(`/v1/store/products/${product.id}`, tokens.demoAdmin, {
      liveIds: [live.id],
    });
    expect(linkedRes.status).toBe(200);
    const linked = (await linkedRes.json()) as ProductDetail;
    expect(linked.lives).toEqual([
      {
        id: live.id,
        title: live.title,
        coverAssetId: null,
        startsAt: new Date(live.startsAt).toISOString(),
        status: 'scheduled',
      },
    ]);
    const liveLinkCount = async () => {
      const [row] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.store_product_lives where live_id = ${live.id}::uuid`;
      return row?.n ?? -1;
    };
    expect(await liveLinkCount()).toBe(1);

    expect(await memberLockedIds('live_locked_ids')).toContain(live.id);
    const granted = await post(`/v1/store/products/${product.id}/grants`, tokens.demoAdmin, {
      membershipId: demoMemberMembershipId,
    });
    expect(granted.status).toBe(200);
    expect(await memberLockedIds('live_locked_ids')).not.toContain(live.id);

    const detail = await getJson<{ products: unknown[] }>(
      `/v1/courses/lives/${live.id}`,
      tokens.demoAdmin,
    );
    expect(detail.products).toEqual([{ id: product.id, name: product.name, status: 'active' }]);

    // The live routes refuse the old link key and write nothing.
    const refusedCreate = await post('/v1/courses/lives', tokens.demoAdmin, {
      title: `${PREFIX} 084 live recusada`,
      startsAt,
      durationMin: 60,
      externalUrl: 'https://youtu.be/st-084',
      productIds: [product.id],
    });
    expect(refusedCreate.status).toBe(400);
    const [refusedLives] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.course_lives where title = ${`${PREFIX} 084 live recusada`}`;
    expect(refusedLives?.n).toBe(0);
    const refusedPatch = await patch(`/v1/courses/lives/${live.id}`, tokens.demoAdmin, {
      productIds: [],
    });
    expect(refusedPatch.status).toBe(400);
    expect(((await refusedPatch.json()) as Envelope).error.code).toBe('VALIDATION_FAILED');
    const refusedBeside = await patch(`/v1/courses/lives/${live.id}`, tokens.demoAdmin, {
      title: `${PREFIX} 084 live nova`,
      productIds: [product.id],
    });
    expect(refusedBeside.status).toBe(400);
    expect(await liveLinkCount()).toBe(1);
  });
});

/**
 * `08.5 store` (08.5-05, STORE-23, STORE-06 / STORE-07 amended, D-421, D-424, D-425): the store side
 * of the member school. The four course and live access reads mirror the community reads (tags,
 * buy section, manager-only `products`), and the product detail and the purchase answer name the
 * published courses and non-cancelled lives a product unlocks, for every caller.
 *
 * Fixtures: courses through `POST /v1/courses` (draft), published by `adminSql` with a FIXED
 * `published_at` so the order is under test (EP-49); lives through `POST /v1/courses/lives`;
 * products through the product route with `courseIds` / `liveIds` (the one link write path, D-418).
 * Everything carries the file's `st-` prefix and is swept with it.
 */
describe('08.5 store', () => {
  let restoreCourses: () => Promise<void> = async () => {};
  let demoMemberMembershipId = '';

  const at = (minutesFromNow: number) =>
    new Date(Date.now() + minutesFromNow * 60_000).toISOString();

  /** A course of the demo tenant; published at `publishedAt` when given, else left a draft. */
  async function course(title: string, publishedAt: string | null = at(-60)): Promise<string> {
    const res = await post('/v1/courses', tokens.demoAdmin, {
      title: `${PREFIX} 085 ${title}`,
      instructorName: 'Dra. Ana',
    });
    expect(res.status).toBe(201);
    const id = ((await res.json()) as { id: string }).id;
    if (publishedAt !== null) {
      await adminSql`
        update public.courses set status = 'published', published_at = ${publishedAt}::timestamptz
         where id = ${id}::uuid`;
    }
    return id;
  }

  /** A live of the demo tenant starting `startIn` minutes from now. */
  async function live(title: string, startIn: number, durationMin = 60): Promise<string> {
    const res = await post('/v1/courses/lives', tokens.demoAdmin, {
      title: `${PREFIX} 085 ${title}`,
      startsAt: at(startIn),
      durationMin,
      externalUrl: 'https://youtu.be/st-085',
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  /** A product linking the given courses and lives, through the product route. */
  async function product(
    name: string,
    links: { courseIds?: string[]; liveIds?: string[]; communityIds?: string[] },
    priceCents = 1990,
  ): Promise<ProductDetail> {
    const res = await post('/v1/store/products', tokens.demoAdmin, {
      name: `${PREFIX} 085 ${name}`,
      priceCents,
      ...links,
    });
    expect(res.status).toBe(201);
    return (await res.json()) as ProductDetail;
  }

  async function archive(productId: string): Promise<void> {
    const res = await request(`/v1/store/products/${productId}/status`, tokens.demoAdmin, {
      method: 'PUT',
      body: JSON.stringify({ status: 'archived' }),
    });
    expect(res.status).toBe(200);
  }

  async function grant(productId: string): Promise<string> {
    const res = await post(`/v1/store/products/${productId}/grants`, tokens.demoAdmin, {
      membershipId: demoMemberMembershipId,
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as GrantResult).entitlementId;
  }

  async function revoke(productId: string, entitlementId: string): Promise<void> {
    const res = await request(
      `/v1/store/products/${productId}/entitlements/${entitlementId}`,
      tokens.demoAdmin,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(200);
  }

  async function expectBare404(path: string, token: string, host = HOSTS.demo): Promise<void> {
    const res = await request(path, token, {}, host);
    expect(res.status).toBe(404);
    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error).not.toHaveProperty('details');
  }

  const courseRows = async (token: string) =>
    new Map(
      (await getJson<CourseAccessList>('/v1/store/course-access', token)).items.map((item) => [
        item.courseId,
        item,
      ]),
    );
  const liveRows = async (token: string) =>
    new Map(
      (await getJson<LiveAccessList>('/v1/store/live-access', token)).items.map((item) => [
        item.liveId,
        item,
      ]),
    );
  const courseAccess = (courseId: string, token: string) =>
    getJson<CourseAccess>(`/v1/store/courses/${courseId}/access`, token);
  const liveAccess = (liveId: string, token: string) =>
    getJson<LiveAccess>(`/v1/store/lives/${liveId}/access`, token);
  const buyable = (detail: ProductDetail) => ({
    id: detail.id,
    name: detail.name,
    priceCents: detail.priceCents,
    imageAssetId: null,
  });

  /** Runs `fn` with the demo tenant's `courses` row set to `enabled`, then restores it. */
  async function withDemoCourses<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
    const [row] = await adminSql<{ enabled: boolean }[]>`
      select enabled from public.tenant_modules
       where tenant_id = ${demoTenantId}::uuid and module_key = 'courses'`;
    const was = row?.enabled ?? false;
    await adminSql`
      update public.tenant_modules set enabled = ${enabled}
       where tenant_id = ${demoTenantId}::uuid and module_key = 'courses'`;
    moduleFlags.invalidate(demoTenantId);
    try {
      return await fn();
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = ${was}
         where tenant_id = ${demoTenantId}::uuid and module_key = 'courses'`;
      moduleFlags.invalidate(demoTenantId);
    }
  }

  async function sweep085(): Promise<void> {
    await adminSql`delete from public.course_lives where title like ${'st-%'}`;
    await adminSql`delete from public.courses where title like ${'st-%'}`;
  }

  beforeAll(async () => {
    await storeOn(demoTenantId);
    restoreCourses = await withModuleEnabled('demo', 'courses');
    await sweep085();
    const [member] = await adminSql<{ membership_id: string }[]>`
      select m.id::text as membership_id
        from public.memberships m
        join auth.users a on a.id = m.user_id
       where m.tenant_id = ${demoTenantId}::uuid and a.email = 'member@rede-demo.local'`;
    demoMemberMembershipId = member?.membership_id ?? '';
  });

  afterAll(async () => {
    await restoreCourses();
    // Entitlements, orders and products first (links cascade), then the courses and lives.
    await sweep();
    await sweep085();
  });

  it('access: a course linked to P1 and P2 is locked with both buyable newest first; holding P2 opens it (EP-47); a grant and a revoke flip locked between reads (EP-51); archivedTag only when both are archived; staff are never locked; products only for the manager', async () => {
    const c = await course('ep47');
    const p1 = await product('ep47 p1', { courseIds: [c] });
    const p2 = await product('ep47 p2', { courseIds: [c] }, 990);

    const member = await courseAccess(c, tokens.demoMember);
    expect(member).toEqual({
      courseId: c,
      locked: true,
      gated: true,
      archivedTag: false,
      buyableProducts: [buyable(p2), buyable(p1)],
    });
    expect(member).not.toHaveProperty('products');
    expect((await courseRows(tokens.demoMember)).get(c)).toEqual({
      courseId: c,
      locked: true,
      gated: true,
      archivedTag: false,
    });

    // Staff: never locked; only the manager (admin_tenant) receives `products` (T-08.5-11).
    const support = await courseAccess(c, tokens.demoSupport);
    expect(support.locked).toBe(false);
    expect(support).not.toHaveProperty('products');
    const admin = await courseAccess(c, tokens.demoAdmin);
    expect(admin.locked).toBe(false);
    expect(admin.products).toEqual([
      { id: p2.id, name: p2.name, status: 'active' },
      { id: p1.id, name: p1.name, status: 'active' },
    ]);
    for (const token of [tokens.demoAdmin, tokens.demoSupport]) {
      expect((await courseRows(token)).get(c)).toMatchObject({ locked: false, gated: true });
    }

    // EP-47 / EP-51: holding P2 only opens it on the very next read; a revoke closes it again.
    const entitlement = await grant(p2.id);
    expect((await courseAccess(c, tokens.demoMember)).locked).toBe(false);
    expect((await courseRows(tokens.demoMember)).get(c)?.locked).toBe(false);
    await revoke(p2.id, entitlement);
    expect((await courseAccess(c, tokens.demoMember)).locked).toBe(true);
    expect((await courseRows(tokens.demoMember)).get(c)?.locked).toBe(true);

    // P2 archived, P1 active: no tag, only P1 to buy.
    await archive(p2.id);
    expect(await courseAccess(c, tokens.demoMember)).toEqual({
      courseId: c,
      locked: true,
      gated: true,
      archivedTag: false,
      buyableProducts: [buyable(p1)],
    });
    // Both archived: the tag, nothing to buy, still locked for a non-holder.
    await archive(p1.id);
    expect(await courseAccess(c, tokens.demoMember)).toEqual({
      courseId: c,
      locked: true,
      gated: true,
      archivedTag: true,
      buyableProducts: [],
    });
    expect((await courseRows(tokens.demoMember)).get(c)).toEqual({
      courseId: c,
      locked: true,
      gated: true,
      archivedTag: true,
    });
    expect((await courseAccess(c, tokens.demoAdmin)).products).toEqual([
      { id: p2.id, name: p2.name, status: 'archived' },
      { id: p1.id, name: p1.name, status: 'archived' },
    ]);
  });

  it('access: an open course has no row and answers gated false (EP-48); a draft is a member 404 and a manager 200; the list follows published_at desc (EP-49); a link saved shows at once and two reads agree (EP-50); an unknown id is the bare 404', async () => {
    const open = await course('ep48 aberto');
    expect((await courseRows(tokens.demoMember)).has(open)).toBe(false);
    expect(await courseAccess(open, tokens.demoMember)).toEqual({
      courseId: open,
      locked: false,
      gated: false,
      archivedTag: false,
      buyableProducts: [],
    });
    expect(await courseAccess(open, tokens.demoAdmin)).toEqual({
      courseId: open,
      locked: false,
      gated: false,
      archivedTag: false,
      buyableProducts: [],
      products: [],
    });

    // A draft: invisible to a member (the bare 404) and absent from every list; the manager reads it.
    const draft = await course('rascunho', null);
    const draftProduct = await product('rascunho', { courseIds: [draft] });
    await expectBare404(`/v1/store/courses/${draft}/access`, tokens.demoMember);
    await expectBare404(`/v1/store/courses/${draft}/access`, tokens.demoSupport);
    expect(await courseAccess(draft, tokens.demoAdmin)).toMatchObject({
      courseId: draft,
      gated: true,
      locked: false,
      products: [{ id: draftProduct.id, name: draftProduct.name, status: 'active' }],
    });
    for (const token of [tokens.demoMember, tokens.demoAdmin]) {
      expect((await courseRows(token)).has(draft)).toBe(false);
    }

    // EP-49: published_at desc, id desc — the older publication comes after the newer one.
    const older = await course('ep49 antigo', at(-120));
    const newer = await course('ep49 novo', at(-30));
    await product('ep49', { courseIds: [older, newer] });
    const listed = (
      await getJson<CourseAccessList>('/v1/store/course-access', tokens.demoMember)
    ).items
      .map((item) => item.courseId)
      .filter((id) => id === older || id === newer);
    expect(listed).toEqual([newer, older]);

    // EP-50: a link saved through the product form shows in the very next read; nothing is cached.
    const linker = await product('ep50', {});
    const patched = await request(`/v1/store/products/${linker.id}`, tokens.demoAdmin, {
      method: 'PATCH',
      body: JSON.stringify({ courseIds: [open] }),
    });
    expect(patched.status).toBe(200);
    const first = await courseAccess(open, tokens.demoMember);
    expect(first).toMatchObject({ locked: true, gated: true, archivedTag: false });
    expect(await courseAccess(open, tokens.demoMember)).toEqual(first);
    expect((await courseRows(tokens.demoMember)).get(open)?.locked).toBe(true);

    await expectBare404(
      '/v1/store/courses/00000000-0000-4000-8000-000000000000/access',
      tokens.demoMember,
    );
    const notUuid = await request('/v1/store/courses/abc/access', tokens.demoMember);
    expect(notUuid.status).toBe(400);
  });

  it('access: lives — a LOCKED live still answers 200 locked for the member with its buy section; the list holds linked lives soonest first, a cancelled one included; an open live has no row (EP-48); grant and revoke flip locked (EP-51); archivedTag; staff unlocked; products manager-only', async () => {
    const later = await live('ep49 depois', 2 * 24 * 60);
    const sooner = await live('ep49 antes', 24 * 60);
    const cancelled = await live('cancelada', 3 * 24 * 60);
    const open = await live('aberta', 24 * 60);
    const p1 = await product('lives p1', { liveIds: [later, sooner, cancelled] });
    const p2 = await product('lives p2', { liveIds: [later] }, 990);
    const cancel = await request(`/v1/courses/lives/${cancelled}/cancel`, tokens.demoAdmin, {
      method: 'POST',
    });
    expect(cancel.status).toBe(200);

    // The member lane cannot read the locked live's row, yet the store answers its access.
    const member = await liveAccess(later, tokens.demoMember);
    expect(member).toEqual({
      liveId: later,
      locked: true,
      gated: true,
      archivedTag: false,
      buyableProducts: [buyable(p2), buyable(p1)],
    });
    expect(member).not.toHaveProperty('products');
    const support = await liveAccess(later, tokens.demoSupport);
    expect(support.locked).toBe(false);
    expect(support).not.toHaveProperty('products');
    expect((await liveAccess(later, tokens.demoAdmin)).products).toEqual([
      { id: p2.id, name: p2.name, status: 'active' },
      { id: p1.id, name: p1.name, status: 'active' },
    ]);

    // EP-49: starts_at asc; the cancelled live keeps its row; the open live has none (EP-48).
    const rows = await liveRows(tokens.demoMember);
    const mine = [...rows.keys()].filter((id) => [later, sooner, cancelled, open].includes(id));
    expect(mine).toEqual([sooner, later, cancelled]);
    expect(rows.get(cancelled)).toEqual({
      liveId: cancelled,
      locked: true,
      gated: true,
      archivedTag: false,
    });
    expect(await liveAccess(open, tokens.demoMember)).toEqual({
      liveId: open,
      locked: false,
      gated: false,
      archivedTag: false,
      buyableProducts: [],
    });
    for (const token of [tokens.demoAdmin, tokens.demoSupport]) {
      expect((await liveRows(token)).get(later)).toMatchObject({ locked: false, gated: true });
    }

    // EP-51: a grant opens it on the next read, a revoke closes it again.
    const entitlement = await grant(p2.id);
    expect((await liveAccess(later, tokens.demoMember)).locked).toBe(false);
    expect((await liveRows(tokens.demoMember)).get(later)?.locked).toBe(false);
    expect((await liveAccess(sooner, tokens.demoMember)).locked).toBe(true);
    await revoke(p2.id, entitlement);
    expect((await liveAccess(later, tokens.demoMember)).locked).toBe(true);

    // Archived products: the tag only when none is active.
    await archive(p1.id);
    expect(await liveAccess(sooner, tokens.demoMember)).toEqual({
      liveId: sooner,
      locked: true,
      gated: true,
      archivedTag: true,
      buyableProducts: [],
    });
    expect((await liveRows(tokens.demoMember)).get(later)?.archivedTag).toBe(false);
    expect((await liveRows(tokens.demoMember)).get(sooner)?.archivedTag).toBe(true);

    await expectBare404(
      '/v1/store/lives/00000000-0000-4000-8000-000000000000/access',
      tokens.demoMember,
    );
  });

  it('access: with courses off both lists are empty and both single reads the bare 404 while the store stays on', async () => {
    const c = await course('desligado');
    const l = await live('desligado', 24 * 60);
    await product('desligado', { courseIds: [c], liveIds: [l] });
    expect((await courseRows(tokens.demoMember)).has(c)).toBe(true);
    await withDemoCourses(false, async () => {
      for (const token of [tokens.demoMember, tokens.demoAdmin]) {
        expect(await getJson<CourseAccessList>('/v1/store/course-access', token)).toEqual({
          items: [],
        });
        expect(await getJson<LiveAccessList>('/v1/store/live-access', token)).toEqual({
          items: [],
        });
        await expectBare404(`/v1/store/courses/${c}/access`, token);
        await expectBare404(`/v1/store/lives/${l}/access`, token);
      }
      // The store itself stays on.
      expect((await request('/v1/store/products', tokens.demoMember)).status).toBe(200);
    });
    expect((await courseRows(tokens.demoMember)).has(c)).toBe(true);
  });

  it('product detail and purchase: unlockedCourses lists only published courses (published_at desc) and unlockedLives only non-cancelled lives (starts_at asc), a locked live named before buying (EP-52, EP-54); nothing linked or courses off is [] (EP-53); the purchase answer lists the same and a replay answers the same with one order and one entitlement (EP-60)', async () => {
    const community = await createCommunity(`${PREFIX} 085 comunidade`);
    const older = await course('ep52 antigo', at(-180));
    const newer = await course('ep52 novo', at(-30));
    const draft = await course('ep52 rascunho', null);
    const archivedCourse = await course('ep52 arquivado', at(-90));
    const scheduled = await live('ep52 agendada', 24 * 60);
    const recorded = await live('ep52 gravada', 2 * 24 * 60);
    const cancelled = await live('ep52 cancelada', 3 * 24 * 60);
    const p = await product('ep52', {
      communityIds: [community],
      courseIds: [older, newer, draft, archivedCourse],
      liveIds: [scheduled, recorded, cancelled],
    });
    // Shape the states the product form cannot reach directly: an archived course, a past live.
    await adminSql`
      update public.courses set status = 'archived', archived_at = now()
       where id = ${archivedCourse}::uuid`;
    await adminSql`
      update public.course_lives set starts_at = now() - interval '3 hours'
       where id = ${recorded}::uuid`;
    const cancel = await request(`/v1/courses/lives/${cancelled}/cancel`, tokens.demoAdmin, {
      method: 'POST',
    });
    expect(cancel.status).toBe(200);

    const [recordedRow] = await adminSql<{ starts_at: Date }[]>`
      select starts_at from public.course_lives where id = ${recorded}::uuid`;
    const [scheduledRow] = await adminSql<{ starts_at: Date }[]>`
      select starts_at from public.course_lives where id = ${scheduled}::uuid`;
    const expectedCourses = [
      { id: newer, title: `${PREFIX} 085 ep52 novo`, coverAssetId: null },
      { id: older, title: `${PREFIX} 085 ep52 antigo`, coverAssetId: null },
    ];
    const expectedLives = [
      {
        id: recorded,
        title: `${PREFIX} 085 ep52 gravada`,
        coverAssetId: null,
        startsAt: new Date(recordedRow?.starts_at ?? 0).toISOString(),
      },
      {
        id: scheduled,
        title: `${PREFIX} 085 ep52 agendada`,
        coverAssetId: null,
        startsAt: new Date(scheduledRow?.starts_at ?? 0).toISOString(),
      },
    ];

    // The member holds nothing: both lives are LOCKED for them, and the page still names them.
    expect((await liveAccess(scheduled, tokens.demoMember)).locked).toBe(true);
    const path = `/v1/store/products/${p.id}`;
    for (const token of [tokens.demoMember, tokens.demoSupport, tokens.demoAdmin]) {
      const body = await getJson<Record<string, unknown>>(path, token);
      const detail = productDetailSchema.parse(body);
      expect(detail.unlockedCourses).toEqual(expectedCourses);
      expect(detail.unlockedLives).toEqual(expectedLives);
      expect(detail.communities.map((c) => c.id)).toEqual([community]);
    }
    // The 08.4 rule still holds: a member's detail carries no manager-only `courses` / `lives`.
    const memberBody = await getJson<Record<string, unknown>>(path, tokens.demoMember);
    expect(Object.keys(memberBody)).not.toContain('courses');
    expect(Object.keys(memberBody)).not.toContain('lives');
    // The manager's form lists keep their 08.4 meaning (the draft included, the archived kept out).
    const manager = await getJson<ProductDetail>(path, tokens.demoAdmin);
    expect(manager.courses?.map((c) => c.id).sort()).toEqual([older, newer, draft].sort());
    expect(manager.lives?.map((l) => l.id)).toEqual([recorded, scheduled]);

    // EP-53: a product that unlocks nothing answers two empty lists.
    const empty = await product('ep53 vazio', {});
    expect(empty.unlockedCourses).toEqual([]);
    expect(empty.unlockedLives).toEqual([]);
    const emptyRead = await getJson<ProductDetail>(
      `/v1/store/products/${empty.id}`,
      tokens.demoMember,
    );
    expect(emptyRead.unlockedCourses).toEqual([]);
    expect(emptyRead.unlockedLives).toEqual([]);

    // EP-53: with courses off both lists are [] even though the links exist.
    await withDemoCourses(false, async () => {
      for (const token of [tokens.demoMember, tokens.demoAdmin]) {
        const off = await getJson<ProductDetail>(path, token);
        expect(off.unlockedCourses).toEqual([]);
        expect(off.unlockedLives).toEqual([]);
        expect(off.communities.map((c) => c.id)).toEqual([community]);
      }
    });

    // The purchase answer lists the community, the courses and the lives (D-425, STORE-07).
    const ledger = async () => {
      const [row] = await adminSql<{ orders: number; active: number }[]>`
        select (select count(*)::int from public.store_orders where product_id = ${p.id}::uuid) as orders,
               (select count(*)::int from public.store_entitlements
                 where product_id = ${p.id}::uuid and status = 'active') as active`;
      return row;
    };
    const first = await post(`${path}/purchase`, tokens.demoMember, { expectedAmountCents: 1990 });
    expect(first.status).toBe(200);
    const bought = purchaseResultSchema.parse(await first.json());
    expect(bought.communities.map((c) => c.id)).toEqual([community]);
    expect(bought.courses).toEqual(expectedCourses);
    expect(bought.lives).toEqual(expectedLives);
    expect(await ledger()).toEqual({ orders: 1, active: 1 });
    // The lives are now open for the buyer; the detail still names the same ones.
    expect((await liveAccess(scheduled, tokens.demoMember)).locked).toBe(false);

    // EP-60: the replay answers 200 with the same lists and writes nothing (STORE-08 unchanged).
    const replay = await post(`${path}/purchase`, tokens.demoMember, { expectedAmountCents: 1990 });
    expect(replay.status).toBe(200);
    expect(purchaseResultSchema.parse(await replay.json())).toEqual(bought);
    expect(await ledger()).toEqual({ orders: 1, active: 1 });
  });
});

/**
 * 12.3-11 (NOVF-05..09, NOVF-11; D-690, D-691, D-693, D-694, OQ-2, OQ-3): the store front's read side
 * and the product's category on create. The category id in the contract is the SLUG; an absent
 * `category` key on create means "apply the name guess", an explicit `null` means "Sem categoria".
 *
 * Every case writes its categories through the lazy seed (the seed leaves a store with none) and the
 * describe's own sweep removes the `store_categories` and `store_front` rows of both seed tenants, so
 * a rerun starts from the same empty state.
 */
describe('store front and product category (12.3-11)', () => {
  const BUILT_IN = [
    ['cursos', 'Cursos', 'graduation-cap'],
    ['livros', 'Livros', 'book-open'],
    ['materiais', 'Materiais', 'file-text'],
    ['roupas', 'Roupas', 'shirt'],
    ['perfumes', 'Perfumes', 'spray-can'],
    ['equipamentos', 'Equipamentos', 'wrench'],
    ['servicos', 'Serviços', 'calendar-check'],
    ['outros', 'Outros', 'package'],
  ] as const;

  type FrontAnswer = {
    categories: { id: string; name: string; icon: string }[];
    promoProductId: string | null;
    featuredProductIds: string[];
  };
  type Card = { id: string; category?: string };

  /** Drops every category and front row of the two seed tenants (products' links go to null). */
  async function sweepCategories(): Promise<void> {
    await adminSql`
      delete from public.store_front where tenant_id in (${demoTenantId}::uuid, ${labTenantId}::uuid)`;
    await adminSql`
      delete from public.store_categories
       where tenant_id in (${demoTenantId}::uuid, ${labTenantId}::uuid)`;
  }

  /** The category rows and marker rows a tenant holds, through the admin connection. */
  async function seedState(tenantId: string): Promise<{ categories: number; markers: number }> {
    const [row] = await adminSql<{ categories: number; markers: number }[]>`
      select (select count(*)::int from public.store_categories where tenant_id = ${tenantId}::uuid)
               as categories,
             (select count(*)::int from public.store_front
               where tenant_id = ${tenantId}::uuid and categories_seeded_at is not null) as markers`;
    return row ?? { categories: -1, markers: -1 };
  }

  const createRaw = (body: Record<string, unknown>, token = tokens.demoAdmin) =>
    post('/v1/store/products', token, body);

  beforeAll(async () => {
    await storeOn(demoTenantId);
    await sweepCategories();
  });

  afterAll(async () => {
    await sweepCategories();
  });

  it('front: the first read of a store that never had categories seeds the eight built-ins for that tenant only', async () => {
    expect(await seedState(demoTenantId)).toEqual({ categories: 0, markers: 0 });

    const front = await getJson<FrontAnswer>('/v1/store/front', tokens.demoMember);
    expect(front.categories.map((c) => [c.id, c.name, c.icon])).toEqual(BUILT_IN);
    expect(front.promoProductId).toBeNull();
    expect(front.featuredProductIds).toEqual([]);

    expect(await seedState(demoTenantId)).toEqual({ categories: 8, markers: 1 });
    // The positive control above is the seed itself; the negative: the other tenant was not touched.
    expect(await seedState(labTenantId)).toEqual({ categories: 0, markers: 0 });
    // A second read answers the same and writes nothing more.
    expect(await getJson<FrontAnswer>('/v1/store/front', tokens.demoAdmin)).toEqual(front);
    expect(await seedState(demoTenantId)).toEqual({ categories: 8, markers: 1 });
  });

  it('front: a product created with NO category key lands in the category its name suggests (OQ-3)', async () => {
    const res = await createRaw({ name: `${PREFIX} Livro: Guia de Peles`, priceCents: 1990 });
    expect(res.status).toBe(201);
    const created = (await res.json()) as ProductDetail;
    expect(created.category).toBe('livros');

    const read = await getJson<ProductDetail>(
      `/v1/store/products/${created.id}`,
      tokens.demoMember,
    );
    expect(read.category).toBe('livros');
    const list = await getJson<{ items: Card[] }>('/v1/store/products?limit=50', tokens.demoMember);
    expect(list.items.find((card) => card.id === created.id)?.category).toBe('livros');
  });

  it('front: an explicit null stores none (no key on the card) and an unknown slug is 400 category_invalid', async () => {
    const none = await createRaw({
      name: `${PREFIX} Livro sem prateleira`,
      priceCents: 500,
      category: null,
    });
    expect(none.status).toBe(201);
    const created = (await none.json()) as ProductDetail;
    expect('category' in created).toBe(false);
    const list = await getJson<{ items: Card[] }>('/v1/store/products?limit=50', tokens.demoMember);
    const card = list.items.find((item) => item.id === created.id);
    expect(card).toBeDefined();
    expect(card && 'category' in card).toBe(false);

    const unknown = await createRaw({
      name: `${PREFIX} Perfume X`,
      priceCents: 500,
      category: 'nao-existe',
    });
    expect(unknown.status).toBe(400);
    const body = (await unknown.json()) as Envelope;
    expect(body.error.details).toEqual({ store: 'category_invalid' });
    // Nothing was written for the refused body.
    const [count] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.store_products where name = ${`${PREFIX} Perfume X`}`;
    expect(count?.n).toBe(0);

    // The positive control: a known slug of this tenant is accepted and stored as chosen.
    const chosen = await createRaw({
      name: `${PREFIX} Perfume Y`,
      priceCents: 500,
      category: 'roupas',
    });
    expect(chosen.status).toBe(201);
    expect(((await chosen.json()) as ProductDetail).category).toBe('roupas');
  });

  const patchRaw = (productId: string, body: unknown, token = tokens.demoAdmin) =>
    request(`/v1/store/products/${productId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  const putStatusRaw = (productId: string, status: string) =>
    request(`/v1/store/products/${productId}/status`, tokens.demoAdmin, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });

  /** A product's stored category slug through the admin connection (null when it has none). */
  async function storedSlug(productId: string): Promise<string | null> {
    const [row] = await adminSql<{ slug: string | null }[]>`
      select c.slug
        from public.store_products p
        left join public.store_categories c on c.id = p.category_id
       where p.id = ${productId}::uuid`;
    return row?.slug ?? null;
  }

  it('front: an edit with an absent category key keeps it, null clears it, a slug sets it, an unknown or malformed slug is 400 category_invalid and changes nothing (D-693, OQ-3)', async () => {
    const created = await createRaw({ name: `${PREFIX} Perfume Edit`, priceCents: 700 });
    const product = (await created.json()) as ProductDetail;
    expect(product.category).toBe('perfumes');

    // Absent key: another field changes, the category stays.
    const renamed = await patchRaw(product.id, { priceCents: 800 });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as ProductDetail).category).toBe('perfumes');

    // A slug sets it; the same edit twice stores the same category and answers the same card (idempotency).
    const first = await patchRaw(product.id, { category: 'roupas' });
    const second = await patchRaw(product.id, { category: 'roupas' });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = (await first.json()) as ProductDetail;
    const secondBody = (await second.json()) as ProductDetail;
    expect(firstBody.category).toBe('roupas');
    expect(secondBody).toEqual(firstBody);
    expect(await storedSlug(product.id)).toBe('roupas');

    // The refusals leave the stored category alone: unknown slug, uppercase, accent, space, 25 characters, empty.
    for (const bad of ['nao-existe', 'Livros', 'serviços', 'a b', 'a'.repeat(25), '']) {
      const res = await patchRaw(product.id, { category: bad });
      expect(res.status, `slug ${JSON.stringify(bad)}`).toBe(400);
      expect(((await res.json()) as Envelope).error.details).toEqual({ store: 'category_invalid' });
    }
    expect(await storedSlug(product.id)).toBe('roupas');

    // null clears it: the detail and the list carry no key, and the product sits in no shelf.
    const cleared = await patchRaw(product.id, { category: null });
    expect(cleared.status).toBe(200);
    expect('category' in ((await cleared.json()) as ProductDetail)).toBe(false);
    expect(await storedSlug(product.id)).toBeNull();
    const detail = await getJson<ProductDetail>(
      `/v1/store/products/${product.id}`,
      tokens.demoMember,
    );
    expect('category' in detail).toBe(false);
    const list = await getJson<{ items: Card[] }>('/v1/store/products?limit=50', tokens.demoMember);
    const card = list.items.find((item) => item.id === product.id);
    expect(card && 'category' in card).toBe(false);
  });

  it('front: the server never guesses a category for an existing product on a read (D-693)', async () => {
    const id = await insertProduct(demoTenantId, `${PREFIX} Livro antigo`, '2026-01-02T10:00:00Z');
    // A product written outside the API, with no category: its name tells "livros", the read must not.
    const detail = await getJson<ProductDetail>(`/v1/store/products/${id}`, tokens.demoMember);
    expect('category' in detail).toBe(false);
    const list = await getJson<{ items: Card[] }>('/v1/store/products?limit=50', tokens.demoMember);
    const card = list.items.find((item) => item.id === id);
    expect(card).toBeDefined();
    expect(card && 'category' in card).toBe(false);
    expect(await storedSlug(id)).toBeNull();
  });

  it('front: a saved promo or featured id that points at an archived product is dropped, and the featured ids keep the stored order', async () => {
    const ids: string[] = [];
    for (const label of ['Alfa', 'Beta', 'Gama']) {
      const res = await createRaw({ name: `${PREFIX} Destaque ${label}`, priceCents: 100 });
      expect(res.status).toBe(201);
      ids.push(((await res.json()) as ProductDetail).id);
    }
    const [alfa, beta, gama] = ids as [string, string, string];
    // The front's writes are plan 12's routes: the row is written here through the admin connection.
    await adminSql`
      update public.store_front
         set promo_product_id = ${alfa}::uuid,
             featured_product_ids = ${`{${gama},${alfa},${beta}}`}::uuid[]
       where tenant_id = ${demoTenantId}::uuid`;

    const before = await getJson<FrontAnswer>('/v1/store/front', tokens.demoMember);
    expect(before.promoProductId).toBe(alfa);
    expect(before.featuredProductIds).toEqual([gama, alfa, beta]);

    expect((await putStatusRaw(alfa, 'archived')).status).toBe(200);
    const after = await getJson<FrontAnswer>('/v1/store/front', tokens.demoMember);
    expect(after.promoProductId).toBeNull();
    expect(after.featuredProductIds).toEqual([gama, beta]);
    // The stored row still names the archived product: the read drops it, it never rewrites the row.
    const [stored] = await adminSql<{ promo: string | null; n: number }[]>`
      select promo_product_id::text as promo, cardinality(featured_product_ids)::int as n
        from public.store_front where tenant_id = ${demoTenantId}::uuid`;
    expect(stored).toEqual({ promo: alfa, n: 3 });

    // Reactivated, it is back in its stored place.
    expect((await putStatusRaw(alfa, 'active')).status).toBe(200);
    const again = await getJson<FrontAnswer>('/v1/store/front', tokens.demoMember);
    expect(again.promoProductId).toBe(alfa);
    expect(again.featuredProductIds).toEqual([gama, alfa, beta]);
    await adminSql`
      update public.store_front
         set promo_product_id = null, featured_product_ids = '{}'::uuid[]
       where tenant_id = ${demoTenantId}::uuid`;
  });

  it('front: two parallel first reads on a fresh store leave exactly eight category rows and one marker (D-691, T-12.3-06)', async () => {
    await sweepCategories();
    expect(await seedState(demoTenantId)).toEqual({ categories: 0, markers: 0 });

    const answers = await Promise.all(
      [tokens.demoMember, tokens.demoAdmin, tokens.demoSupport, tokens.demoMember].map((token) =>
        request('/v1/store/front', token),
      ),
    );
    for (const res of answers) expect(res.status).toBe(200);
    const bodies = (await Promise.all(answers.map((res) => res.json()))) as FrontAnswer[];
    for (const body of bodies) {
      expect(body.categories.map((category) => category.id)).toEqual(
        BUILT_IN.map(([slug]) => slug),
      );
    }
    expect(await seedState(demoTenantId)).toEqual({ categories: 8, markers: 1 });

    // Once only: an admin who deleted every category is not seeded again by the next read.
    await adminSql`delete from public.store_categories where tenant_id = ${demoTenantId}::uuid`;
    const empty = await getJson<FrontAnswer>('/v1/store/front', tokens.demoMember);
    expect(empty.categories).toEqual([]);
    expect(await seedState(demoTenantId)).toEqual({ categories: 0, markers: 1 });
  });

  /** A store with its eight built-ins and nothing else: the clean start of an edge case. */
  async function freshStore(): Promise<void> {
    await sweepCategories();
    await getJson<FrontAnswer>('/v1/store/front', tokens.demoMember);
    expect(await seedState(demoTenantId)).toEqual({ categories: 8, markers: 1 });
  }

  it('front edge adjacency: "livros" and "livros-2" are different categories, a product holds exactly one slug and the card compares by exact equality (NOVF-09)', async () => {
    await freshStore();
    await adminSql`
      insert into public.store_categories (tenant_id, slug, name, icon, position)
      values (${demoTenantId}::uuid, 'livros-2', 'Livros 2', 'book-open', 9)`;
    const one = await createRaw({ name: `${PREFIX} Adj um`, priceCents: 100, category: 'livros' });
    const two = await createRaw({
      name: `${PREFIX} Adj dois`,
      priceCents: 100,
      category: 'livros-2',
    });
    expect(one.status).toBe(201);
    expect(two.status).toBe(201);
    const first = (await one.json()) as ProductDetail;
    const second = (await two.json()) as ProductDetail;
    expect(first.category).toBe('livros');
    expect(second.category).toBe('livros-2');
    expect(first.category === second.category).toBe(false);
    expect(await storedSlug(first.id)).toBe('livros');
    expect(await storedSlug(second.id)).toBe('livros-2');

    // Moving one product never moves the other: each holds exactly one slug.
    const moved = await patchRaw(first.id, { category: 'livros-2' });
    expect(((await moved.json()) as ProductDetail).category).toBe('livros-2');
    expect(await storedSlug(second.id)).toBe('livros-2');
    const list = await getJson<{ items: Card[] }>('/v1/store/products?limit=50', tokens.demoMember);
    expect(list.items.find((item) => item.id === first.id)?.category).toBe('livros-2');

    // The front lists both, in position order, as two rows.
    const front = await getJson<FrontAnswer>('/v1/store/front', tokens.demoMember);
    expect(front.categories.map((category) => category.id).slice(-1)).toEqual(['livros-2']);
    expect(front.categories.filter((category) => category.id.startsWith('livros'))).toHaveLength(2);
  });

  it('front edge empty: an absent key applies the guess (outros when nothing matches, none when the store has no outros row), null stores none, "" is refused, an absent key on edit changes nothing (NOVF-09)', async () => {
    await freshStore();
    const nothing = await createRaw({ name: `${PREFIX} Vale-presente`, priceCents: 100 });
    expect(((await nothing.json()) as ProductDetail).category).toBe('outros');

    // The admin deleted "Outros": the same guess finds no row and stores none, without an error.
    await adminSql`
      delete from public.store_categories where tenant_id = ${demoTenantId}::uuid and slug = 'outros'`;
    const lost = await createRaw({ name: `${PREFIX} Vale-brinde`, priceCents: 100 });
    expect(lost.status).toBe(201);
    const lostBody = (await lost.json()) as ProductDetail;
    expect('category' in lostBody).toBe(false);
    expect(await storedSlug(lostBody.id)).toBeNull();
    // A guess for a category the store still has is unaffected.
    const book = await createRaw({ name: `${PREFIX} Livro de Receitas`, priceCents: 100 });
    const bookBody = (await book.json()) as ProductDetail;
    expect(bookBody.category).toBe('livros');

    const explicitNone = await createRaw({
      name: `${PREFIX} Livro sem estante`,
      priceCents: 1,
      category: null,
    });
    const noneBody = (await explicitNone.json()) as ProductDetail;
    expect('category' in noneBody).toBe(false);
    expect(await storedSlug(noneBody.id)).toBeNull();

    const empty = await createRaw({ name: `${PREFIX} Livro vazio`, priceCents: 1, category: '' });
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as Envelope).error.details).toEqual({ store: 'category_invalid' });

    // An absent key on edit changes nothing, whatever the name now says.
    const rename = await patchRaw(bookBody.id, { name: `${PREFIX} Perfume de Receitas` });
    expect(rename.status).toBe(200);
    expect(((await rename.json()) as ProductDetail).category).toBe('livros');
  });

  it('front edge encoding: a slug is lowercase letters, digits and inner hyphens up to 24; the category NAME never takes part in the check (NOVF-09)', async () => {
    await freshStore();
    // "roupas" is renamed, and a NEW category takes the name "roupas": the slug still decides.
    await adminSql`
      update public.store_categories set name = 'Vestuário'
       where tenant_id = ${demoTenantId}::uuid and slug = 'roupas'`;
    await adminSql`
      insert into public.store_categories (tenant_id, slug, name, icon, position)
      values (${demoTenantId}::uuid, 'enc-teste', 'roupas', 'tag', 9)`;
    const ok = await createRaw({ name: `${PREFIX} Enc ok`, priceCents: 1, category: 'roupas' });
    const okBody = (await ok.json()) as ProductDetail;
    expect(okBody.category).toBe('roupas');
    expect(await storedSlug(okBody.id)).toBe('roupas');

    for (const bad of [
      'Vestuário',
      'Roupas',
      'roupas ',
      ' roupas',
      'enc teste',
      'ENC-TESTE',
      'a'.repeat(25),
    ]) {
      const res = await createRaw({
        name: `${PREFIX} Enc ${bad.length}`,
        priceCents: 1,
        category: bad,
      });
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(((await res.json()) as Envelope).error.details).toEqual({ store: 'category_invalid' });
    }
    const [written] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.store_products where name like ${`${PREFIX} Enc %`}`;
    expect(written?.n).toBe(1);
  });

  it('front edge ordering: the list order and its cursor pages do not change when a category changes (NOVF-09)', async () => {
    await freshStore();
    const ids: string[] = [];
    for (const [n, at] of [
      ['um', '2026-03-01T10:00:00Z'],
      ['dois', '2026-03-02T10:00:00Z'],
      ['tres', '2026-03-03T10:00:00Z'],
      ['quatro', '2026-03-04T10:00:00Z'],
    ] as const) {
      ids.push(await insertProduct(demoTenantId, `${PREFIX} Ord ${n}`, at));
    }
    const sequence = async (limit: number) =>
      (await allPages('/v1/store/products', tokens.demoMember, limit)).flatMap((page) =>
        page.items.map((item) => item.id),
      );
    const before = { whole: await sequence(50), paged: await sequence(2) };
    expect(before.paged).toEqual(before.whole);
    expect(before.whole.filter((id) => ids.includes(id))).toEqual([...ids].reverse());

    for (const [index, slug] of ['perfumes', 'cursos', null, 'livros'].entries()) {
      const res = await patchRaw(ids[index] ?? '', { category: slug });
      expect(res.status).toBe(200);
    }
    const after = { whole: await sequence(50), paged: await sequence(2) };
    expect(after.whole).toEqual(before.whole);
    expect(after.paged).toEqual(before.whole);
  });

  it('front edge idempotency: two products created with the same name and no category key receive the same guessed category (NOVF-09)', async () => {
    await freshStore();
    const name = `${PREFIX} Livro Gêmeo`;
    const [a, b] = await Promise.all([
      createRaw({ name, priceCents: 100 }),
      createRaw({ name, priceCents: 100 }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const first = (await a.json()) as ProductDetail;
    const second = (await b.json()) as ProductDetail;
    expect(first.id).not.toBe(second.id);
    expect(first.category).toBe('livros');
    expect(second.category).toBe('livros');
    expect(await storedSlug(first.id)).toBe(await storedSlug(second.id));
  });

  it('front edge empty store (NOVF-11): a store with the module on and no product answers the eight built-ins, no promo and no featured; with the module off it is the bare MODULE_DISABLED and nothing is seeded', async () => {
    const restoreLab = await withStoreEnabled('lab');
    const labFront = (token = tokens.labMember) => request('/v1/store/front', token, {}, HOSTS.lab);
    try {
      await adminSql`
        delete from public.store_front where tenant_id = ${labTenantId}::uuid`;
      await adminSql`
        delete from public.store_categories where tenant_id = ${labTenantId}::uuid`;
      const [products] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.store_products where tenant_id = ${labTenantId}::uuid`;
      expect(products?.n).toBe(0);

      // Module off first: the bare 404, and the lazy seed did not run for this tenant.
      await adminSql`
        update public.tenant_modules set enabled = false
         where tenant_id = ${labTenantId}::uuid and module_key = 'store'`;
      moduleFlags.invalidate(labTenantId);
      const off = await labFront();
      expect(off.status).toBe(404);
      const offBody = (await off.json()) as Envelope;
      expect(offBody.error.code).toBe('MODULE_DISABLED');
      expect(offBody.error).not.toHaveProperty('details');
      expect(await seedState(labTenantId)).toEqual({ categories: 0, markers: 0 });

      // Module on, no product: the eight, in order, and nothing else.
      await adminSql`
        update public.tenant_modules set enabled = true
         where tenant_id = ${labTenantId}::uuid and module_key = 'store'`;
      moduleFlags.invalidate(labTenantId);
      const on = await labFront();
      expect(on.status).toBe(200);
      const front = (await on.json()) as FrontAnswer;
      expect(front.categories.map((c) => [c.id, c.name, c.icon])).toEqual(BUILT_IN);
      expect(front.promoProductId).toBeNull();
      expect(front.featuredProductIds).toEqual([]);
      expect(JSON.stringify(front)).not.toContain(demoTenantId);
      expect(await seedState(labTenantId)).toEqual({ categories: 8, markers: 1 });
      expect(await seedState(demoTenantId)).toMatchObject({ markers: expect.any(Number) });
    } finally {
      await adminSql`delete from public.store_front where tenant_id = ${labTenantId}::uuid`;
      await adminSql`delete from public.store_categories where tenant_id = ${labTenantId}::uuid`;
      await restoreLab();
    }
  });
});

/**
 * 12.3-12 (NOVF-05, NOVF-06, NOVF-07, NOVF-09, NOVF-11; D-690, D-691, D-693, D-696, D-699, OQ-4, OQ-6):
 * the admin writes of the store front. `PUT /v1/store/front/promo`, `PUT /v1/store/front/featured` and
 * the whole-list `PUT /v1/store/categories`, each answering the fresh front. Every case that writes
 * through the API reads the stored row back through the admin connection, so a 200 is never trusted
 * on its own; each refusal asserts that nothing was written.
 */
describe('store front writes (12.3-12)', () => {
  type FrontAnswer = {
    categories: { id: string; name: string; icon: string }[];
    promoProductId: string | null;
    featuredProductIds: string[];
  };

  const put = (path: string, token: string, body: unknown, host = HOSTS.demo) =>
    request(path, token, { method: 'PUT', body: JSON.stringify(body) }, host);
  const putPromo = (body: unknown, token = tokens.demoAdmin) =>
    put('/v1/store/front/promo', token, body);

  async function sweepFront(): Promise<void> {
    await adminSql`
      delete from public.store_front where tenant_id in (${demoTenantId}::uuid, ${labTenantId}::uuid)`;
    await adminSql`
      delete from public.store_categories
       where tenant_id in (${demoTenantId}::uuid, ${labTenantId}::uuid)`;
  }

  /** The stored front row of the demo tenant through the admin connection. */
  async function storedFront(): Promise<{
    rows: number;
    promo: string | null;
    featured: string[];
  }> {
    const rows = await adminSql<{ promo: string | null; featured: string[] }[]>`
      select promo_product_id::text as promo,
             featured_product_ids::text[] as featured
        from public.store_front where tenant_id = ${demoTenantId}::uuid`;
    return { rows: rows.length, promo: rows[0]?.promo ?? null, featured: rows[0]?.featured ?? [] };
  }

  const archive = (productId: string) =>
    request(`/v1/store/products/${productId}/status`, tokens.demoAdmin, {
      method: 'PUT',
      body: JSON.stringify({ status: 'archived' }),
    });

  beforeAll(async () => {
    await storeOn(demoTenantId);
    await sweepFront();
  });

  afterAll(async () => {
    await sweepFront();
  });

  it('promo: an admin saves the featured product and a member reads it; null clears it; the same body twice leaves one row', async () => {
    const product = await createProduct(`${PREFIX} promo a`, 1000, []);
    // A store with no front row answers no promo.
    expect((await getJson<FrontAnswer>('/v1/store/front', tokens.demoMember)).promoProductId).toBe(
      null,
    );

    const saved = await putPromo({ productId: product.id });
    expect(saved.status).toBe(200);
    const answer = (await saved.json()) as FrontAnswer;
    expect(answer.promoProductId).toBe(product.id);
    expect(answer.categories).toHaveLength(8);
    expect((await storedFront()).promo).toBe(product.id);
    expect(await getJson<FrontAnswer>('/v1/store/front', tokens.demoMember)).toEqual(answer);

    // Idempotent: the same promo twice leaves exactly one row and the same answer.
    const again = await putPromo({ productId: product.id });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(answer);
    expect((await storedFront()).rows).toBe(1);

    // Null clears; clearing the promo leaves the featured list as it was.
    await adminSql`
      update public.store_front set featured_product_ids = ${`{${product.id}}`}::uuid[]
       where tenant_id = ${demoTenantId}::uuid`;
    const cleared = await putPromo({ productId: null });
    expect(cleared.status).toBe(200);
    const clearedBody = (await cleared.json()) as FrontAnswer;
    expect(clearedBody.promoProductId).toBeNull();
    expect(clearedBody.featuredProductIds).toEqual([product.id]);
    expect(await storedFront()).toMatchObject({ rows: 1, promo: null, featured: [product.id] });
    await adminSql`
      update public.store_front set featured_product_ids = '{}'::uuid[]
       where tenant_id = ${demoTenantId}::uuid`;
  });

  it('promo: the promo may also be a featured product, both stored independently (NOVF-05 adjacency)', async () => {
    const product = await createProduct(`${PREFIX} promo both`, 1000, []);
    await adminSql`
      update public.store_front set featured_product_ids = ${`{${product.id}}`}::uuid[]
       where tenant_id = ${demoTenantId}::uuid`;
    expect((await putPromo({ productId: product.id })).status).toBe(200);
    const front = await getJson<FrontAnswer>('/v1/store/front', tokens.demoMember);
    expect(front.promoProductId).toBe(product.id);
    expect(front.featuredProductIds).toEqual([product.id]);
    await adminSql`
      update public.store_front
         set promo_product_id = null, featured_product_ids = '{}'::uuid[]
       where tenant_id = ${demoTenantId}::uuid`;
  });

  it('promo: an archived, unknown or another tenant’s product is 400 promo_invalid and nothing is written; null and the bad shapes behave', async () => {
    const good = await createProduct(`${PREFIX} promo keep`, 1000, []);
    expect((await putPromo({ productId: good.id })).status).toBe(200);

    const archived = await createProduct(`${PREFIX} promo archived`, 1000, []);
    expect((await archive(archived.id)).status).toBe(200);
    const foreign = await insertProduct(
      labTenantId,
      `${PREFIX} promo foreign`,
      '2026-01-01T00:00:00Z',
    );

    for (const productId of [archived.id, randomUUID(), foreign]) {
      const res = await putPromo({ productId });
      expect(res.status).toBe(400);
      expect(((await res.json()) as Envelope).error.details).toEqual({ store: 'promo_invalid' });
      // Nothing was written: the saved promo is still the good one.
      expect((await storedFront()).promo).toBe(good.id);
    }

    // Strict body: a missing key, an unknown key, a non-uuid and a tenant id are generic 400s.
    for (const body of [{}, { productId: good.id, tenantId: demoTenantId }, { productId: 'x' }]) {
      const res = await putPromo(body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as Envelope).error.code).toBe('VALIDATION_FAILED');
    }
    expect((await storedFront()).promo).toBe(good.id);
    expect((await putPromo({ productId: null })).status).toBe(200);
    expect((await storedFront()).promo).toBeNull();
  });

  it('promo: a member and a support member are 403 and the stored promo is unchanged; an admin of the same call succeeds', async () => {
    const product = await createProduct(`${PREFIX} promo guarded`, 1000, []);
    expect((await putPromo({ productId: product.id })).status).toBe(200);
    const other = await createProduct(`${PREFIX} promo guarded 2`, 1000, []);

    for (const token of [tokens.demoMember, tokens.demoSupport]) {
      const res = await putPromo({ productId: other.id }, token);
      expect(res.status).toBe(403);
      expect((await storedFront()).promo).toBe(product.id);
    }
    expect((await putPromo({ productId: other.id })).status).toBe(200);
    expect((await storedFront()).promo).toBe(other.id);
  });

  it('promo: the module off is the bare MODULE_DISABLED 404 and writes nothing', async () => {
    await adminSql`
      update public.tenant_modules set enabled = false
       where tenant_id = ${demoTenantId}::uuid and module_key = 'store'`;
    moduleFlags.invalidate(demoTenantId);
    try {
      const before = await storedFront();
      const res = await putPromo({ productId: null });
      expect(res.status).toBe(404);
      const body = (await res.json()) as Envelope;
      expect(body.error.code).toBe('MODULE_DISABLED');
      expect(body.error).not.toHaveProperty('details');
      expect(await storedFront()).toEqual(before);
    } finally {
      await storeOn(demoTenantId);
    }
  });

  it('promo edge concurrency: two admins saving different promos at once end with ONE row holding one of the two (NOVF-05)', async () => {
    const a = await createProduct(`${PREFIX} promo race a`, 1000, []);
    const b = await createProduct(`${PREFIX} promo race b`, 1000, []);
    await adminSql`delete from public.store_front where tenant_id = ${demoTenantId}::uuid`;
    const results = await Promise.all([
      putPromo({ productId: a.id }),
      putPromo({ productId: b.id }),
    ]);
    expect(results.map((res) => res.status)).toEqual([200, 200]);
    const stored = await storedFront();
    expect(stored.rows).toBe(1);
    expect([a.id, b.id]).toContain(stored.promo);
  });

  const putFeatured = (body: unknown, token = tokens.demoAdmin) =>
    put('/v1/store/front/featured', token, body);

  async function makeProducts(label: string, count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let n = 1; n <= count; n += 1) {
      ids.push((await createProduct(`${PREFIX} ${label} ${n}`, 100 * n, [])).id);
    }
    return ids;
  }

  it('featured: an admin saves up to five products in order, a member reads that order, reordering two changes only them, [] clears', async () => {
    const ids = await makeProducts('feat order', 5);
    await adminSql`delete from public.store_front where tenant_id = ${demoTenantId}::uuid`;
    // A store with no front row answers an empty list.
    expect(
      (await getJson<FrontAnswer>('/v1/store/front', tokens.demoMember)).featuredProductIds,
    ).toEqual([]);

    const order = [ids[3], ids[0], ids[4], ids[1], ids[2]] as string[];
    const saved = await putFeatured({ productIds: order });
    expect(saved.status).toBe(200);
    const answer = (await saved.json()) as FrontAnswer;
    expect(answer.featuredProductIds).toEqual(order);
    expect((await storedFront()).featured).toEqual(order);
    expect(await getJson<FrontAnswer>('/v1/store/front', tokens.demoMember)).toEqual(answer);
    // Two reads in a row answer the same sequence (the categories by position, the ids as stored).
    expect(await getJson<FrontAnswer>('/v1/store/front', tokens.demoMember)).toEqual(answer);

    // Reordering the first two changes only their order.
    const swapped = [order[1], order[0], ...order.slice(2)] as string[];
    expect(
      ((await (await putFeatured({ productIds: swapped })).json()) as FrontAnswer)
        .featuredProductIds,
    ).toEqual(swapped);

    // Idempotent: the same list twice leaves the same row and the same answer.
    const first = await (await putFeatured({ productIds: swapped })).json();
    const second = await (await putFeatured({ productIds: swapped })).json();
    expect(second).toEqual(first);
    expect((await storedFront()).rows).toBe(1);

    const cleared = await putFeatured({ productIds: [] });
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as FrontAnswer).featuredProductIds).toEqual([]);
    expect((await storedFront()).featured).toEqual([]);
  });

  it('featured: five are accepted and six are too_many_featured; a repeated, archived, unknown or foreign id is featured_invalid; nothing is written on a refusal', async () => {
    const ids = await makeProducts('feat bound', 6);
    const five = ids.slice(0, 5);
    expect((await putFeatured({ productIds: five })).status).toBe(200);
    expect((await storedFront()).featured).toEqual(five);

    const six = await putFeatured({ productIds: ids });
    expect(six.status).toBe(400);
    expect(((await six.json()) as Envelope).error.details).toEqual({ store: 'too_many_featured' });

    const archived = await createProduct(`${PREFIX} feat archived`, 100, []);
    expect((await archive(archived.id)).status).toBe(200);
    const foreign = await insertProduct(
      labTenantId,
      `${PREFIX} feat foreign`,
      '2026-01-01T00:00:00Z',
    );
    const bad: string[][] = [
      [ids[0] as string, ids[0] as string],
      [ids[0] as string, archived.id],
      [ids[0] as string, randomUUID()],
      [foreign],
    ];
    for (const productIds of bad) {
      const res = await putFeatured({ productIds });
      expect(res.status).toBe(400);
      expect(((await res.json()) as Envelope).error.details).toEqual({ store: 'featured_invalid' });
      expect((await storedFront()).featured).toEqual(five);
    }

    // Strict body: a missing key, an unknown key, a non-uuid and an absurd length are generic 400s.
    const huge = Array.from({ length: 101 }, () => randomUUID());
    for (const body of [
      {},
      { productIds: five, tenantId: demoTenantId },
      { productIds: ['x'] },
      { productIds: huge },
    ]) {
      const res = await putFeatured(body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as Envelope).error.code).toBe('VALIDATION_FAILED');
    }
    expect((await storedFront()).featured).toEqual(five);
    await putFeatured({ productIds: [] });
  });

  it('featured: an archived product is dropped by the read and the others keep their relative order; a member and support are 403', async () => {
    const [a, b, c] = (await makeProducts('feat drop', 3)) as [string, string, string];
    expect((await putFeatured({ productIds: [c, a, b] })).status).toBe(200);
    expect((await archive(a)).status).toBe(200);
    const front = await getJson<FrontAnswer>('/v1/store/front', tokens.demoMember);
    expect(front.featuredProductIds).toEqual([c, b]);
    // The stored row keeps the archived id: the read drops it, the write does not.
    expect((await storedFront()).featured).toEqual([c, a, b]);

    for (const token of [tokens.demoMember, tokens.demoSupport]) {
      const res = await putFeatured({ productIds: [b] }, token);
      expect(res.status).toBe(403);
      expect((await storedFront()).featured).toEqual([c, a, b]);
    }
    await putFeatured({ productIds: [] });
  });

  it('featured edge concurrency: parallel saves of two different lists end with one of the two lists whole, never a mix (NOVF-06)', async () => {
    const ids = await makeProducts('feat race', 4);
    const listA = [ids[0], ids[1]] as string[];
    const listB = [ids[3], ids[2], ids[1]] as string[];
    for (let round = 0; round < 3; round += 1) {
      await adminSql`delete from public.store_front where tenant_id = ${demoTenantId}::uuid`;
      const results = await Promise.all([
        putFeatured({ productIds: listA }),
        putFeatured({ productIds: listB }),
      ]);
      expect(results.map((res) => res.status)).toEqual([200, 200]);
      const stored = await storedFront();
      expect(stored.rows).toBe(1);
      expect([JSON.stringify(listA), JSON.stringify(listB)]).toContain(
        JSON.stringify(stored.featured),
      );
    }
    await putFeatured({ productIds: [] });
  });

  type Entry = { id?: string; name: string; icon: string };
  const putCategories = (categories: Entry[], token = tokens.demoAdmin) =>
    put('/v1/store/categories', token, { categories });
  const entry = (name: string, id?: string, icon = 'tag'): Entry =>
    id === undefined ? { name, icon } : { id, name, icon };

  /** The stored categories of the demo tenant through the admin connection, in position order. */
  async function storedCategories(): Promise<
    { id: string; slug: string; name: string; icon: string; position: number }[]
  > {
    return adminSql<{ id: string; slug: string; name: string; icon: string; position: number }[]>`
      select id::text as id, slug, name, icon, position
        from public.store_categories where tenant_id = ${demoTenantId}::uuid
       order by position, slug`;
  }
  const slugsOf = async () => (await storedCategories()).map((row) => row.slug);

  /** A store with its eight built-ins and nothing else (read first, so the seed marker is claimed). */
  async function freshStore(): Promise<FrontAnswer> {
    await sweepFront();
    const front = await getJson<FrontAnswer>('/v1/store/front', tokens.demoMember);
    expect(front.categories).toHaveLength(8);
    return front;
  }

  const refusal = async (res: Response) => ((await res.json()) as Envelope).error.details;
  const catProduct = async (name: string, category?: string | null): Promise<ProductDetail> => {
    const res = await post('/v1/store/products', tokens.demoAdmin, {
      name: `${PREFIX} ${name}`,
      priceCents: 100,
      ...(category === undefined ? {} : { category }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as ProductDetail;
  };

  it('categories: a save keeps the slug on a rename, mints one for a new row, orders by the body and deletes the omitted, leaving their products with no category (OQ-4, D-690, D-693)', async () => {
    await freshStore();
    const before = await storedCategories();
    const cursosRow = before.find((row) => row.slug === 'cursos');
    const book = await catProduct('Livro categorias', 'livros');
    expect(book.category).toBe('livros');

    const res = await putCategories([
      entry('Outros', 'outros', 'package'),
      entry('Cursos online', 'cursos', 'graduation-cap'),
      entry('Skin care & Cia', undefined, 'heart'),
    ]);
    expect(res.status).toBe(200);
    const answer = (await res.json()) as FrontAnswer;
    expect(answer.categories).toEqual([
      { id: 'outros', name: 'Outros', icon: 'package' },
      { id: 'cursos', name: 'Cursos online', icon: 'graduation-cap' },
      { id: 'skin-care-cia', name: 'Skin care & Cia', icon: 'heart' },
    ]);
    const after = await storedCategories();
    expect(after.map((row) => [row.slug, row.position])).toEqual([
      ['outros', 1],
      ['cursos', 2],
      ['skin-care-cia', 3],
    ]);
    // A rename keeps the row itself (its uuid), so the products that point at it stay put.
    expect(after.find((row) => row.slug === 'cursos')?.id).toBe(cursosRow?.id);
    expect(await getJson<FrontAnswer>('/v1/store/front', tokens.demoMember)).toEqual(answer);

    // The deleted category left its product with no category: no key on the detail or the card.
    const detail = await getJson<ProductDetail>(`/v1/store/products/${book.id}`, tokens.demoMember);
    expect('category' in detail).toBe(false);
    const list = await getJson<{ items: { id: string }[] }>(
      '/v1/store/products?limit=50',
      tokens.demoMember,
    );
    const card = list.items.find((item) => item.id === book.id);
    expect(card).toBeDefined();
    expect(card && 'category' in card).toBe(false);

    // Idempotent: the same order twice leaves the same positions and the same slugs.
    const again = await putCategories(answer.categories.map((c) => entry(c.name, c.id, c.icon)));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(answer);
    expect((await storedCategories()).map((row) => [row.slug, row.position])).toEqual(
      after.map((row) => [row.slug, row.position]),
    );
  });

  it('categories: 20 are accepted and 21 are too_many_categories; 30 code points are accepted and 31 are category_name_too_long, an emoji counting as one; nothing is written on a refusal', async () => {
    await freshStore();
    const names = (n: number) => Array.from({ length: n }, (_, k) => entry(`Cat ${k + 1}`));
    const twenty = await putCategories(names(20));
    expect(twenty.status).toBe(200);
    expect(await storedCategories()).toHaveLength(20);
    const saved = await slugsOf();

    const twentyOne = await putCategories(names(21));
    expect(twentyOne.status).toBe(400);
    expect(await refusal(twentyOne)).toEqual({ store: 'too_many_categories' });
    expect(await slugsOf()).toEqual(saved);

    expect((await putCategories([entry('a'.repeat(30))])).status).toBe(200);
    const over = await putCategories([entry('a'.repeat(31))]);
    expect(over.status).toBe(400);
    expect(await refusal(over)).toEqual({ store: 'category_name_too_long' });
    expect(await slugsOf()).toEqual(['a'.repeat(20)]);

    // An emoji is one code point: 30 of them fit, 31 do not.
    expect((await putCategories([entry('\u{1F600}'.repeat(30))])).status).toBe(200);
    const emoji = await putCategories([entry('\u{1F600}'.repeat(31))]);
    expect(emoji.status).toBe(400);
    expect(await refusal(emoji)).toEqual({ store: 'category_name_too_long' });
    // The slug of a name with no plain letters is the fixed fallback.
    expect(await slugsOf()).toEqual(['categoria']);

    // The name is trimmed and space-folded before it is counted: 30 letters inside spaces fit.
    const padded = await putCategories([entry(`  ${'b'.repeat(14)}   ${'c'.repeat(15)}  `)]);
    expect(padded.status).toBe(200);
    expect((await storedCategories())[0]?.name).toBe(`${'b'.repeat(14)} ${'c'.repeat(15)}`);
    // NFC: a decomposed "é" is stored composed and the slug is plain letters (accents stripped).
    expect((await putCategories([entry('Cafe\u0301s')])).status).toBe(200);
    const [cafe] = await storedCategories();
    expect(cafe?.name).toBe('Caf\u00e9s');
    expect(cafe?.slug).toBe('cafes');
  });

  it('categories: an empty or blank name, a repeated name by case or spacing, an icon outside the list and a malformed id are refused with their closed code and write nothing', async () => {
    await freshStore();
    const saved = await slugsOf();
    const cases: [Entry[], Record<string, string>][] = [
      [[entry('')], { store: 'category_name_required' }],
      [[entry('   ')], { store: 'category_name_required' }],
      [[entry('Livros', 'livros'), entry(' livros ')], { store: 'category_name_taken' }],
      [[entry('Skin care'), entry('SKIN  CARE')], { store: 'category_name_taken' }],
      [[entry('Cursos', 'cursos'), entry('CURSOS')], { store: 'category_name_taken' }],
      [[{ name: 'Foguete', icon: 'rocket' }], { store: 'category_icon_invalid' }],
      [[entry('Bom', 'Bad Id')], { store: 'category_invalid' }],
    ];
    for (const [categories, details] of cases) {
      const res = await putCategories(categories);
      expect(res.status, JSON.stringify(categories)).toBe(400);
      expect(await refusal(res)).toEqual(details);
      expect(await slugsOf()).toEqual(saved);
    }
    // A position, a tenant id or an unknown key in the body is a generic 400, never read.
    for (const body of [
      { categories: [{ name: 'X', icon: 'tag', position: 1 }] },
      { categories: [], tenantId: demoTenantId },
      {},
    ]) {
      const res = await put('/v1/store/categories', tokens.demoAdmin, body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as Envelope).error.code).toBe('VALIDATION_FAILED');
    }
    expect(await slugsOf()).toEqual(saved);
  });

  it('categories: swapping the names of two categories in one save succeeds; a name freed by a deleted row can be taken by a new one with a fresh slug; two names that mint the same slug get -2 (NOVF-07 adjacency)', async () => {
    await freshStore();
    const rest = (await storedCategories())
      .filter((row) => !['cursos', 'livros'].includes(row.slug))
      .map((row) => entry(row.name, row.slug, row.icon));
    const swap = await putCategories([
      entry('Livros', 'cursos', 'graduation-cap'),
      entry('Cursos', 'livros', 'book-open'),
      ...rest,
    ]);
    expect(swap.status).toBe(200);
    const swapped = await storedCategories();
    expect(swapped.find((row) => row.slug === 'cursos')?.name).toBe('Livros');
    expect(swapped.find((row) => row.slug === 'livros')?.name).toBe('Cursos');

    // A case-only rename is not a collision with itself.
    expect((await putCategories([entry('CURSOS', 'livros', 'book-open')])).status).toBe(200);
    expect((await storedCategories()).map((row) => [row.slug, row.name])).toEqual([
      ['livros', 'CURSOS'],
    ]);

    // The omitted row frees its name in the same save; the new row gets a fresh slug, never the old one.
    const reuse = await putCategories([entry('Livros')]);
    expect(reuse.status).toBe(200);
    expect(await slugsOf()).toEqual(['livros-2']);
    const again = await putCategories([entry('Outro'), entry('Livros', 'livros-2')]);
    expect(again.status).toBe(200);
    expect(await slugsOf()).toEqual(['outro', 'livros-2']);
    // Two new names that differ but mint one slug.
    const twins = await putCategories([entry('Skin care'), entry('Skin-care')]);
    expect(twins.status).toBe(200);
    expect(await slugsOf()).toEqual(['skin-care', 'skin-care-2']);
    // A new name whose plain letters equal KEPT rows' slugs gets the next free one.
    const three = await putCategories([
      entry('Skin care', 'skin-care'),
      entry('Skin-care', 'skin-care-2'),
      entry('Skin.care'),
    ]);
    expect(three.status).toBe(200);
    expect(await slugsOf()).toEqual(['skin-care', 'skin-care-2', 'skin-care-3']);
  });

  it('categories: a stale draft is refused whole: an id that no longer exists or a repeated id is category_invalid and nothing is written, so a category another admin just made survives (Pitfall 7, T-12.3-08)', async () => {
    await freshStore();
    const draft = (await storedCategories()).map((row) => entry(row.name, row.slug, row.icon));
    // Another admin deleted "perfumes" after this editor loaded: the stale draft still names it.
    await adminSql`
      delete from public.store_categories where tenant_id = ${demoTenantId}::uuid and slug = 'perfumes'`;
    // ... and made a new one this draft never saw.
    await adminSql`
      insert into public.store_categories (tenant_id, slug, name, icon, position)
      values (${demoTenantId}::uuid, 'novidade', 'Novidade', 'gift', 9)`;
    const before = await storedCategories();

    const stale = await putCategories(draft);
    expect(stale.status).toBe(400);
    expect(await refusal(stale)).toEqual({ store: 'category_invalid' });
    expect(await storedCategories()).toEqual(before);
    expect(await slugsOf()).toContain('novidade');

    const repeated = await putCategories([entry('Cursos', 'cursos'), entry('Cursos 2', 'cursos')]);
    expect(repeated.status).toBe(400);
    expect(await refusal(repeated)).toEqual({ store: 'category_invalid' });
    expect(await storedCategories()).toEqual(before);

    // A saved list that names only what exists (and the new one) is the positive control.
    const fresh = (await storedCategories()).map((row) => entry(row.name, row.slug, row.icon));
    expect((await putCategories(fresh)).status).toBe(200);
  });

  it('categories: an empty list leaves the store with no category for good; a store that never read its front is claimed before the save and never re-seeded (D-691)', async () => {
    await freshStore();
    const product = await catProduct('Livro vazio', 'livros');
    expect(product.category).toBe('livros');
    const empty = await putCategories([]);
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as FrontAnswer).categories).toEqual([]);
    expect(await storedCategories()).toEqual([]);
    expect((await getJson<FrontAnswer>('/v1/store/front', tokens.demoMember)).categories).toEqual(
      [],
    );
    expect(await storedCategories()).toEqual([]);
    const detail = await getJson<ProductDetail>(
      `/v1/store/products/${product.id}`,
      tokens.demoAdmin,
    );
    expect('category' in detail).toBe(false);

    // Never read: no front row and no marker. The save claims the seed first, then replaces the list.
    await sweepFront();
    const first = await putCategories([entry('Só uma')]);
    expect(first.status).toBe(200);
    expect(await slugsOf()).toEqual(['so-uma']);
    const read = await getJson<FrontAnswer>('/v1/store/front', tokens.demoMember);
    expect(read.categories.map((c) => c.id)).toEqual(['so-uma']);
    expect(await slugsOf()).toEqual(['so-uma']);
  });

  it('categories: a member and a support member are 403 and the list is unchanged; another tenant’s admin on this host is refused', async () => {
    await freshStore();
    const before = await storedCategories();
    for (const token of [tokens.demoMember, tokens.demoSupport]) {
      const res = await putCategories([entry('Invasor')], token);
      expect(res.status).toBe(403);
      expect(await storedCategories()).toEqual(before);
    }
    const foreign = await put(
      '/v1/store/categories',
      tokens.labAdmin,
      { categories: [] },
      HOSTS.demo,
    );
    expect(foreign.status).toBe(403);
    expect(await storedCategories()).toEqual(before);
  });

  it('categories edge concurrency (NOVF-07): two parallel saves leave one of the two lists whole, never a mix', async () => {
    for (let round = 0; round < 3; round += 1) {
      await freshStore();
      const listA = [entry('Alfa'), entry('Beta')];
      const listB = [entry('Gama'), entry('Delta'), entry('Beta')];
      const results = await Promise.all([putCategories(listA), putCategories(listB)]);
      expect(results.map((res) => res.status)).toEqual([200, 200]);
      const names = (await storedCategories()).map((row) => row.name);
      expect([
        JSON.stringify(['Alfa', 'Beta']),
        JSON.stringify(['Gama', 'Delta', 'Beta']),
      ]).toContain(JSON.stringify(names));
    }
  });

  it('categories edge concurrency (NOVF-09): a product write naming a category that a save deletes ends in one of two states, in either order, and never keeps an id no category holds', async () => {
    // Order 1: the product write commits first, the delete then leaves it with none. A transaction on the
    // admin connection holds the product row (and so a share lock on its category row) while the save
    // runs; the save waits on the delete, then finishes after the commit.
    await freshStore();
    const name = `${PREFIX} race db`;
    let saving: Promise<Response> | undefined;
    await adminSql.begin(async (tx) => {
      await tx`
        insert into public.store_products (tenant_id, created_by_user_id, name, price_cents, category_id)
        select ${demoTenantId}::uuid, m.user_id, ${name}, 100,
               (select c.id from public.store_categories c
                 where c.tenant_id = ${demoTenantId}::uuid and c.slug = 'livros')
          from public.memberships m
         where m.tenant_id = ${demoTenantId}::uuid and m.role = 'admin_tenant'
         limit 1`;
      saving = putCategories([entry('Outros', 'outros', 'package')]);
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    const saved = await saving;
    expect(saved?.status).toBe(200);
    const [row] = await adminSql<{ category_id: string | null }[]>`
      select category_id::text from public.store_products where name = ${name}`;
    expect(row?.category_id).toBeNull();
    expect(await slugsOf()).toEqual(['outros']);

    // Order 2: the delete commits first, so the product write naming it is category_invalid.
    await freshStore();
    expect((await putCategories([entry('Outros', 'outros', 'package')])).status).toBe(200);
    const late = await post('/v1/store/products', tokens.demoAdmin, {
      name: `${PREFIX} race late`,
      priceCents: 100,
      category: 'livros',
    });
    expect(late.status).toBe(400);
    expect(await refusal(late)).toEqual({ store: 'category_invalid' });
    const [none] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.store_products where name = ${`${PREFIX} race late`}`;
    expect(none?.n).toBe(0);

    // Both at once, three rounds: whichever order wins, the invariant holds.
    for (let round = 0; round < 3; round += 1) {
      await freshStore();
      const raceName = `${PREFIX} race both ${round}`;
      const [save, create] = await Promise.all([
        putCategories([entry('Outros', 'outros', 'package')]),
        post('/v1/store/products', tokens.demoAdmin, {
          name: raceName,
          priceCents: 100,
          category: 'livros',
        }),
      ]);
      expect(save.status).toBe(200);
      if (create.status === 201) {
        const [stored] = await adminSql<{ category_id: string | null }[]>`
          select category_id::text from public.store_products where name = ${raceName}`;
        expect(stored?.category_id).toBeNull();
      } else {
        expect(create.status).toBe(400);
        expect(await refusal(create)).toEqual({ store: 'category_invalid' });
      }
      const [orphans] = await adminSql<{ n: number }[]>`
        select count(*)::int as n
          from public.store_products p
         where p.tenant_id = ${demoTenantId}::uuid and p.category_id is not null
           and not exists (select 1 from public.store_categories c where c.id = p.category_id)`;
      expect(orphans?.n).toBe(0);
    }
  });
});
