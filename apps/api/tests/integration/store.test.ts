import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import type {
  BuyersPage,
  CommunityAccess,
  CommunityAccessList,
  GrantResult,
  ProductDetail,
  ProductPage,
  PurchaseResult,
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
