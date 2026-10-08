import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import type {
  CommunityAccess,
  CommunityAccessList,
  ProductDetail,
  ProductPage,
  PurchaseResult,
} from '@rede-social/module-store/contracts';
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
      owned: true,
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
      owned: false,
      communities: [],
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
