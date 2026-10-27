import { randomUUID } from 'node:crypto';
import { sqlClient } from '@rede-social/core/db';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import {
  COMMUNITY_UNLOCK_NAMES_MAX,
  type CommunityPage,
  type CommunitySummary,
  communityUnlockRefusalSchema,
} from '@rede-social/module-communities/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs, withStoreEnabled } from './setup';

/**
 * Deleting a community end to end against the live local stack and the real seed (09.3, PEND-04,
 * PEND-06, PEND-13, D-553, D-554, D-556, D-557): `DELETE /v1/communities/{communityId}` is a SOFT
 * delete of an ARCHIVED community, guarded by the literal `communities.community.manage`, answering
 * 204 with `cache-control: no-store`.
 *
 * What is proved here:
 *  - the tracer: an admin archives then deletes a community, it leaves both lists and the detail,
 *    and a second delete or a PATCH is the bare 404;
 *  - a community that is not archived is `409 { community: 'not_archived' }` and nothing is written;
 *  - a member is 403 and an anonymous caller 401;
 *  - the Loja refusal `unlock_active` (names and total), its cap, order, encoding, the store module
 *    flag, the row lock that serialises a concurrent product link, races, hidden-not-erased
 *    highlights, an untouched Loja, the slug, and the no-oracle rule.
 *
 * The converse of D-554 (09.3 WR-03): reactivating a product that links a DELETED community is
 * `409 { store: 'community_deleted' }`, and a reactivation racing a delete never ends with an
 * active product that unlocks a deleted community.
 *
 * `story_community_pins` no longer exists (dropped in Phase 05.2-11), so D-556 has nothing to treat
 * there; the highlights stay in `story_highlights` and are hidden by the read filters.
 *
 * Every community this file writes carries `TEST_NAME_PREFIX` (and every product `PRODUCT_PREFIX`), so
 * both hooks sweep exactly this file's rows. Test ORDER is load-bearing (`fileParallelism: false`,
 * declaration order).
 */

type Envelope = {
  error: { code: string; message?: string; details?: unknown; requestId?: string };
};

const tokens = { demoAdmin: '', demoMember: '', labAdmin: '' };
const tenantIds = { demo: '', lab: '' };

/** The prefix every community THIS FILE writes carries, so the sweep can be exact. */
const TEST_NAME_PREFIX = 'Comunidade de exclusao';
/** The prefix every Loja product this file writes carries. */
const PRODUCT_PREFIX = 'Produto de exclusao';

const request = (path: string, token?: string, init: RequestInit = {}, host = HOSTS.demo) =>
  api.request(path, {
    ...init,
    headers: {
      'x-tenant-host': host,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });

const envelope = async (res: Response) => ((await res.json()) as Envelope).error;

/** The error body without the per-request id, so two answers compare byte for byte. */
function sansRequestId(raw: string): string {
  const parsed = JSON.parse(raw) as Envelope;
  const { requestId: _requestId, ...rest } = parsed.error;
  return JSON.stringify({ error: rest });
}

/** Asserts the bare 404: the `NOT_FOUND` code and no `details` key (D-23). Returns the raw body. */
async function expectBare404(res: Response, label: string): Promise<string> {
  const raw = await res.clone().text();
  expect(res.status, `${label}: ${raw}`).toBe(404);
  const error = await envelope(res);
  expect(error.code, label).toBe('NOT_FOUND');
  expect(Object.hasOwn(error, 'details'), label).toBe(false);
  return raw;
}

/** Stories and media assets this file inserts for the highlight case, removed by `sweep`. */
const createdStories: string[] = [];
const createdAssets: string[] = [];
/** Every product created through the API, swept by id as well (some names carry no prefix). */
const createdProducts: string[] = [];
let restoreStore: () => Promise<void> = async () => {};

let counter = 0;
const uniqueName = (suffix: string) => `${TEST_NAME_PREFIX} ${suffix} ${++counter}`;

/** Creates a community through the admin API. */
async function createCommunity(name = uniqueName('x')): Promise<CommunitySummary> {
  const res = await request('/v1/communities', tokens.demoAdmin, {
    method: 'POST',
    body: JSON.stringify({ name, description: 'Descricao da comunidade' }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as CommunitySummary;
}

const setStatus = (communityId: string, status: 'active' | 'archived') =>
  request(`/v1/communities/${communityId}`, tokens.demoAdmin, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });

async function archive(communityId: string): Promise<void> {
  const res = await setStatus(communityId, 'archived');
  expect(res.status, await res.clone().text()).toBe(200);
}

const del = (communityId: string, token = tokens.demoAdmin, host = HOSTS.demo) =>
  request(`/v1/communities/${communityId}`, token, { method: 'DELETE' }, host);

const detail = (communityId: string, token = tokens.demoAdmin) =>
  request(`/v1/communities/${communityId}`, token);

async function deletedAtOf(communityId: string): Promise<string | null | undefined> {
  const [row] = await adminSql<{ deleted_at: string | null }[]>`
    select deleted_at::text from public.communities where id = ${communityId}::uuid`;
  return row?.deleted_at;
}

/** Every id of one status of the demo's list, as the admin sees it. */
async function listedIds(status: 'active' | 'archived'): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 60; guard++) {
    const query: string = cursor
      ? `?limit=25&status=${status}&cursor=${encodeURIComponent(cursor)}`
      : `?limit=25&status=${status}`;
    const res = await request(`/v1/communities${query}`, tokens.demoAdmin);
    expect(res.status).toBe(200);
    const page = (await res.json()) as CommunityPage;
    seen.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
    if (cursor === null) break;
  }
  return seen;
}

const post = (path: string, token: string, body: unknown, host = HOSTS.demo) =>
  request(path, token, { method: 'POST', body: JSON.stringify(body) }, host);

/** A Loja product through the admin API, linked to `communityIds`. */
async function createProduct(
  name: string,
  communityIds: string[],
): Promise<{ id: string; name: string }> {
  const res = await post('/v1/store/products', tokens.demoAdmin, {
    name,
    priceCents: 990,
    communityIds,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  const created = (await res.json()) as { id: string; name: string };
  createdProducts.push(created.id);
  return created;
}

async function archiveProduct(productId: string): Promise<void> {
  const res = await request(`/v1/store/products/${productId}/status`, tokens.demoAdmin, {
    method: 'PUT',
    body: JSON.stringify({ status: 'archived' }),
  });
  expect(res.status, await res.clone().text()).toBe(200);
}

const productName = (suffix: string) => `${PRODUCT_PREFIX} ${suffix} ${++counter}`;

async function linkCount(communityId: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.store_product_communities
     where community_id = ${communityId}::uuid`;
  return row?.n ?? -1;
}

/** An archived community that an ACTIVE product links, ready for the refusal. */
async function lockedArchived(suffix: string, productNames: string[]) {
  const community = await createCommunity(uniqueName(suffix));
  const products = [];
  for (const name of productNames) products.push(await createProduct(name, [community.id]));
  await archive(community.id);
  return { community, products };
}

async function refusalOf(res: Response) {
  const raw = await res.clone().text();
  expect(res.status, raw).toBe(409);
  const error = await envelope(res);
  expect(error.code).toBe('CONFLICT');
  return communityUnlockRefusalSchema.parse(error.details);
}

async function sweep(): Promise<void> {
  if (createdStories.length > 0) {
    await adminSql`
      delete from public.story_highlight_items where story_id = any(${createdStories}::uuid[])`;
  }
  const communities = await adminSql<{ id: string }[]>`
    select id::text as id from public.communities where name like ${`${TEST_NAME_PREFIX}%`}`;
  const communityIds = communities.map((row) => row.id);
  const products = await adminSql<{ id: string }[]>`
    select id::text as id from public.store_products where name like ${`${PRODUCT_PREFIX}%`}`;
  const productIds = [...products.map((row) => row.id), ...createdProducts];
  createdProducts.length = 0;
  if (productIds.length > 0) {
    await adminSql`delete from public.store_product_communities where product_id = any(${productIds}::uuid[])`;
  }
  if (communityIds.length > 0) {
    await adminSql`delete from public.store_product_communities where community_id = any(${communityIds}::uuid[])`;
    await adminSql`
      delete from public.story_highlight_items
       where highlight_id in (select id from public.story_highlights
                               where community_id = any(${communityIds}::uuid[]))`;
    await adminSql`delete from public.story_highlights where community_id = any(${communityIds}::uuid[])`;
  }
  if (productIds.length > 0) {
    await adminSql`delete from public.store_products where id = any(${productIds}::uuid[])`;
  }
  await adminSql`delete from public.communities where name like ${`${TEST_NAME_PREFIX}%`}`;
  if (createdStories.length > 0) {
    await adminSql`delete from public.stories where id = any(${createdStories}::uuid[])`;
    createdStories.length = 0;
  }
  if (createdAssets.length > 0) {
    await adminSql`delete from public.media_assets where id = any(${createdAssets}::uuid[])`;
    createdAssets.length = 0;
  }
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('rede-demo', 'rede-lab')`;
  for (const row of rows) {
    if (row.slug === 'rede-demo') tenantIds.demo = row.id;
    if (row.slug === 'rede-lab') tenantIds.lab = row.id;
  }
  await sweep();
  restoreStore = await withStoreEnabled('demo');
});

afterAll(async () => {
  await restoreStore();
  await sweep();
  await adminSql.end();
  await sqlClient.end();
});

describe('DELETE /v1/communities/{communityId} - an archived community, soft-deleted (D-553)', () => {
  it('1. tracer: an admin archives then deletes a community; it vanishes and stays in the database', async () => {
    const community = await createCommunity(uniqueName('tracer'));
    expect(await listedIds('active')).toContain(community.id);
    await archive(community.id);
    expect(await listedIds('archived')).toContain(community.id);

    const res = await del(community.id);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(res.headers.get('cache-control')).toBe('no-store');

    // The row is still there, flagged.
    expect(await deletedAtOf(community.id)).toEqual(expect.any(String));
    // The detail is the bare 404 for the admin and for a member.
    await expectBare404(await detail(community.id, tokens.demoAdmin), 'detail (admin)');
    await expectBare404(await detail(community.id, tokens.demoMember), 'detail (member)');
    // It is in neither list.
    expect(await listedIds('active')).not.toContain(community.id);
    expect(await listedIds('archived')).not.toContain(community.id);
    // A PATCH and a second DELETE are the bare 404, and the second does not move `deleted_at`.
    const firstStamp = await deletedAtOf(community.id);
    await expectBare404(await setStatus(community.id, 'active'), 'patch after delete');
    await expectBare404(await del(community.id), 'second delete');
    expect(await deletedAtOf(community.id)).toBe(firstStamp);
  });

  it('2. not archived: an ACTIVE community is 409 not_archived, nothing is written, and it repeats', async () => {
    const community = await createCommunity(uniqueName('ativa'));
    const [before] = await adminSql<{ row: unknown }[]>`
      select to_jsonb(c) as row from public.communities c where c.id = ${community.id}::uuid`;

    const first = await del(community.id);
    const firstText = await first.clone().text();
    expect(first.status, firstText).toBe(409);
    const error = await envelope(first);
    expect(error.code).toBe('CONFLICT');
    expect(error.details).toEqual({ community: 'not_archived' });

    const [after] = await adminSql<{ row: unknown }[]>`
      select to_jsonb(c) as row from public.communities c where c.id = ${community.id}::uuid`;
    expect(after?.row).toEqual(before?.row);
    expect(await deletedAtOf(community.id)).toBeNull();

    // Repeating the refusal answers the same body.
    const second = await del(community.id);
    expect(second.status).toBe(409);
    expect(sansRequestId(await second.text())).toBe(sansRequestId(firstText));
  });

  it('3. permission: a member is 403, an anonymous caller 401, and the archived community stays live', async () => {
    const community = await createCommunity(uniqueName('permissao'));
    await archive(community.id);

    const asMember = await del(community.id, tokens.demoMember);
    expect(asMember.status).toBe(403);
    expect((await envelope(asMember)).code).toBe('FORBIDDEN');

    const anonymous = await request(`/v1/communities/${community.id}`, undefined, {
      method: 'DELETE',
    });
    expect(anonymous.status).toBe(401);

    expect(await deletedAtOf(community.id)).toBeNull();
    expect(await listedIds('archived')).toContain(community.id);
  });
});

describe('the Loja refusal - unlock_active (D-554)', () => {
  it('4. unlock_active: names and total, nothing changed; an archived product no longer blocks (P16, P19, P20)', async () => {
    const name = productName('unico');
    const { community, products } = await lockedArchived('bloqueada', [name]);
    const product = products[0];
    if (!product) throw new Error('no product');

    const first = await del(community.id);
    const firstText = await first.clone().text();
    const refusal = await refusalOf(first);
    expect(refusal).toEqual({
      community: 'unlock_active',
      products: [{ id: product.id, name }],
      count: 1,
    });
    expect(await deletedAtOf(community.id)).toBeNull();

    // Repeating the refused call answers the same body (P20).
    const second = await del(community.id);
    expect(second.status).toBe(409);
    expect(sansRequestId(await second.text())).toBe(sansRequestId(firstText));

    // The product is archived: the same delete now succeeds, and the link row stays.
    await archiveProduct(product.id);
    expect((await del(community.id)).status).toBe(204);
    expect(await deletedAtOf(community.id)).toEqual(expect.any(String));
    expect(await linkCount(community.id)).toBe(1);
  });

  it('5. the cap and the order: 5 names, the total, created_at desc then id desc, 5 stays 5, 1 stays 1 (P16, P19)', async () => {
    const names = Array.from({ length: 6 }, (_, index) => productName(`lote ${index + 1}`));
    const { community, products } = await lockedArchived('cheia', names);
    expect(products).toHaveLength(6);
    expect(COMMUNITY_UNLOCK_NAMES_MAX).toBe(5);

    // Fixed instants, the third and the fourth product TIED, so `id desc` is what orders them.
    const ids = products.map((product) => product.id);
    const stamps = [
      '2026-03-01T10:00:01.000Z',
      '2026-03-01T10:00:02.000Z',
      '2026-03-01T10:00:03.000Z',
      '2026-03-01T10:00:03.000Z',
      '2026-03-01T10:00:05.000Z',
      '2026-03-01T10:00:06.000Z',
    ];
    for (const [index, id] of ids.entries()) {
      await adminSql`
        update public.store_products set created_at = ${stamps[index] ?? ''}::timestamptz
         where id = ${id}::uuid`;
    }
    const expectedOrder = (activeIds: string[]) =>
      activeIds
        .map((id) => ({ id, at: stamps[ids.indexOf(id)] ?? '' }))
        .sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1))
        .map((entry) => entry.id);

    const six = await del(community.id);
    const sixText = await six.clone().text();
    const sixRefusal = await refusalOf(six);
    expect(sixRefusal.products).toHaveLength(5);
    expect(sixRefusal.count).toBe(6);
    expect(sixRefusal.products.map((product) => product.id)).toEqual(
      expectedOrder(ids).slice(0, 5),
    );
    // Two consecutive calls return the same names in the same order.
    const again = await del(community.id);
    expect(sansRequestId(await again.text())).toBe(sansRequestId(sixText));

    // Archive the oldest: exactly 5 remain, so 5 names and a total of 5.
    const oldest = ids[0] ?? '';
    await archiveProduct(oldest);
    const five = await refusalOf(await del(community.id));
    expect(five.products).toHaveLength(5);
    expect(five.count).toBe(5);

    // Archive three more: 2 remain; then one more: exactly 1.
    for (const id of ids.slice(1, 5)) await archiveProduct(id);
    const one = await refusalOf(await del(community.id));
    expect(one.products).toEqual([{ id: ids[5], name: names[5] }]);
    expect(one.count).toBe(1);

    // Zero active products: the delete proceeds.
    await archiveProduct(ids[5] ?? '');
    expect((await del(community.id)).status).toBe(204);
  });

  it('6. names are bytes: accents, emoji, markup and the longest name come back unchanged (P18)', async () => {
    const markup = `Ação 🎉 <b>x</b> & "q" ${++counter}`;
    // 80 code points (the longest the store accepts), 100 UTF-16 code units.
    const longest = `${'ã'.repeat(60)}${'🎉'.repeat(20)}`;
    expect([...longest]).toHaveLength(80);
    // Products can only link an ACTIVE community, so the community is archived afterwards.
    const community = await createCommunity(uniqueName('bytes'));
    const created = [
      await createProduct(markup, [community.id]),
      await createProduct(longest, [community.id]),
    ];
    expect(created.map((product) => product.name)).toEqual([markup, longest]);
    await archive(community.id);

    const refusal = await refusalOf(await del(community.id));
    expect(refusal.count).toBe(2);
    const byId = new Map(refusal.products.map((product) => [product.id, product.name]));
    expect(byId.get(created[0]?.id ?? '')).toBe(markup);
    expect(byId.get(created[1]?.id ?? '')).toBe(longest);
  });
});

describe('the store flag, the lock and the races (A1, P21, P12)', () => {
  it('7. the store flag (A1): with the Loja off the links unlock nothing; the link row stays', async () => {
    const { community, products } = await lockedArchived('loja desligada', [productName('flag')]);
    const product = products[0];
    if (!product) throw new Error('no product');
    // With the Loja on the product blocks.
    expect((await del(community.id)).status).toBe(409);

    try {
      await adminSql`
        update public.tenant_modules set enabled = false
         where tenant_id = ${tenantIds.demo}::uuid and module_key = 'store'`;
      moduleFlags.invalidate(tenantIds.demo);
      expect((await del(community.id)).status).toBe(204);
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = true
         where tenant_id = ${tenantIds.demo}::uuid and module_key = 'store'`;
      moduleFlags.invalidate(tenantIds.demo);
    }

    // Back on: the deleted community is still the bare 404 and its link row is still there.
    await expectBare404(await detail(community.id), 'detail after delete');
    expect(await linkCount(community.id)).toBe(1);
  });

  it('8. the lock (P21): a link committed while the delete waits is seen; a later link is refused community_invalid', async () => {
    // Product P exists and links a DIFFERENT active community D, so it is an active product.
    const other = await createCommunity(uniqueName('outra'));
    const product = await createProduct(productName('trava'), [other.id]);
    const community = await createCommunity(uniqueName('travada'));
    await archive(community.id);

    let release: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let linked: () => void = () => {};
    const linkedFirst = new Promise<void>((resolve) => {
      linked = resolve;
    });
    // The link insert takes FOR KEY SHARE on the community row through its foreign key and the
    // transaction stays open; `adminSql` has one connection, so nothing else may use it until release.
    const holder = adminSql.begin(async (tx) => {
      await tx`
        insert into public.store_product_communities (tenant_id, product_id, community_id)
        values (${tenantIds.demo}::uuid, ${product.id}::uuid, ${community.id}::uuid)`;
      linked();
      await barrier;
    });

    let pending: Promise<Response> | undefined;
    try {
      await linkedFirst;
      pending = Promise.resolve(del(community.id));
      let settled = false;
      pending.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
      // A plain update (FOR NO KEY UPDATE) would have finished by now with a 204; FOR UPDATE waits.
      expect(settled, 'the delete waits for the uncommitted link').toBe(false);
    } finally {
      release();
      await holder;
    }

    if (!pending) throw new Error('the delete was never started');
    const refusal = await refusalOf(await pending);
    expect(refusal.products).toEqual([{ id: product.id, name: product.name }]);
    expect(refusal.count).toBe(1);
    expect(await deletedAtOf(community.id)).toBeNull();

    // Take P off the active products, delete, then a NEW link to the deleted community is refused.
    await archiveProduct(product.id);
    expect((await del(community.id)).status).toBe(204);
    const relink = await post('/v1/store/products', tokens.demoAdmin, {
      name: productName('religada'),
      priceCents: 990,
      communityIds: [community.id],
    });
    expect(relink.status).toBe(400);
    expect((await envelope(relink)).details).toEqual({ store: 'community_invalid' });
  });

  it('9. races (P12): two deletes give one 204 and one 404; a reactivation racing a delete never ends half-way', async () => {
    const community = await createCommunity(uniqueName('corrida'));
    await archive(community.id);
    const both = await Promise.all([del(community.id), del(community.id)]);
    expect(both.map((res) => res.status).sort()).toEqual([204, 404]);
    expect(await deletedAtOf(community.id)).toEqual(expect.any(String));

    for (let round = 0; round < 3; round++) {
      const racing = await createCommunity(uniqueName(`disputa ${round}`));
      await archive(racing.id);
      await Promise.all([del(racing.id), setStatus(racing.id, 'active')]);
      const [row] = await adminSql<{ status: string; deleted_at: string | null }[]>`
        select status, deleted_at::text from public.communities where id = ${racing.id}::uuid`;
      const deleted = row?.deleted_at != null;
      const reactivated = row?.status === 'active' && row?.deleted_at === null;
      expect(deleted || reactivated, JSON.stringify(row)).toBe(true);
    }
  });
});

describe('what stays: highlights, the Loja and the slug (D-556, D-554, D-557)', () => {
  /** A ready story image and a live story authored by the demo admin, swept by `sweep`. */
  async function seedStory(): Promise<string> {
    const [asset] = await adminSql<{ id: string }[]>`
      insert into public.media_assets
        (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, width, height,
         variant_widths, filename, ready_at)
      select ${tenantIds.demo}::uuid, u.id, 'image', 'story', 'ready', 'supabase',
             'image/webp', 262144, 1080, 1920, '{640,1080}'::int[], 'story.webp', now()
        from public.users u where u.email = 'admin@rede-demo.local'
      returning id::text as id`;
    if (!asset) throw new Error('could not seed a story image');
    createdAssets.push(asset.id);
    const [story] = await adminSql<{ id: string }[]>`
      insert into public.stories
        (tenant_id, author_user_id, media_asset_id, media_kind, caption, published_at, expires_at)
      select ${tenantIds.demo}::uuid, u.id, ${asset.id}::uuid, 'image', 'Historia de exclusao',
             now(), now() + interval '24 hours'
        from public.users u where u.email = 'admin@rede-demo.local'
      returning id::text as id`;
    if (!story) throw new Error('could not seed a story');
    createdStories.push(story.id);
    return story.id;
  }

  it('10. highlights hidden, nothing erased (D-556): the rows stay, every read filters them, the sheet ids drop it', async () => {
    const community = await createCommunity(uniqueName('destaques'));
    const storyId = await seedStory();
    const [highlight] = await adminSql<{ id: string }[]>`
      insert into public.story_highlights (tenant_id, community_id, title, position, created_by_user_id)
      select ${tenantIds.demo}::uuid, ${community.id}::uuid, 'Destaque exclusao', 0, u.id
        from public.users u where u.email = 'admin@rede-demo.local'
      returning id::text as id`;
    const highlightId = highlight?.id ?? '';
    expect(highlightId).not.toBe('');
    await adminSql`
      insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
      select s.tenant_id, ${highlightId}::uuid, s.id, s.author_user_id
        from public.stories s where s.id = ${storyId}::uuid`;

    const counts = async () => {
      const [row] = await adminSql<{ highlights: number; items: number }[]>`
        select (select count(*)::int from public.story_highlights where community_id = ${community.id}::uuid)
                 as highlights,
               (select count(*)::int from public.story_highlight_items where highlight_id = ${highlightId}::uuid)
                 as items`;
      return row;
    };
    const sheetIds = async () => {
      const res = await request(`/v1/stories/${storyId}/highlights`, tokens.demoAdmin);
      expect(res.status, await res.clone().text()).toBe(200);
      return ((await res.json()) as { highlightIds: string[] }).highlightIds;
    };
    const catalogIds = async () => {
      const res = await request('/v1/stories/highlights/catalog', tokens.demoAdmin);
      expect(res.status).toBe(200);
      return ((await res.json()) as { items: { id: string }[] }).items.map((item) => item.id);
    };

    // Positive controls while the community is live and while it is archived but not yet deleted.
    expect(await catalogIds()).toContain(highlightId);
    expect(await sheetIds()).toContain(highlightId);
    const before = await counts();
    expect(before).toEqual({ highlights: 1, items: 1 });
    await archive(community.id);
    expect(await sheetIds()).toContain(highlightId);

    expect((await del(community.id)).status).toBe(204);

    // Nothing erased.
    expect(await counts()).toEqual(before);
    // Hidden: the place, the catalogue and the curator sheet's ids no longer name it.
    await expectBare404(
      await request(`/v1/stories/highlights?communityId=${community.id}`, tokens.demoAdmin),
      'highlight list of a deleted community',
    );
    expect(await catalogIds()).not.toContain(highlightId);
    expect(await sheetIds()).not.toContain(highlightId);
  });

  it('11. the Loja is untouched and the slug stays (D-554, D-557)', async () => {
    const name = uniqueName('loja intacta');
    const community = await createCommunity(name);
    const product = await createProduct(productName('arquivado'), [community.id]);
    await archiveProduct(product.id);
    await archive(community.id);

    const lojaSnapshot = async () => {
      const [row] = await adminSql<{ snapshot: string }[]>`
        select jsonb_build_object(
          'products', coalesce((select jsonb_agg(to_jsonb(r) order by r.id)
                                  from public.store_products r
                                 where r.tenant_id = ${tenantIds.demo}::uuid), '[]'),
          'links', coalesce((select jsonb_agg(to_jsonb(r) order by r.product_id, r.community_id)
                               from public.store_product_communities r
                              where r.tenant_id = ${tenantIds.demo}::uuid), '[]'),
          'orders', coalesce((select jsonb_agg(to_jsonb(r) order by r.id)
                                from public.store_orders r
                               where r.tenant_id = ${tenantIds.demo}::uuid), '[]'),
          'entitlements', coalesce((select jsonb_agg(to_jsonb(r) order by r.id)
                                      from public.store_entitlements r
                                     where r.tenant_id = ${tenantIds.demo}::uuid), '[]')
        )::text as snapshot`;
      return row?.snapshot;
    };
    const [slugBefore] = await adminSql<{ slug: string }[]>`
      select slug from public.communities where id = ${community.id}::uuid`;
    const before = await lojaSnapshot();

    expect((await del(community.id)).status).toBe(204);

    expect(await lojaSnapshot()).toBe(before);
    const [slugAfter] = await adminSql<{ slug: string }[]>`
      select slug from public.communities where id = ${community.id}::uuid`;
    expect(slugAfter?.slug).toBe(slugBefore?.slug);

    // The same name again gets the numeric suffix: the deleted row keeps its slug.
    const again = await createCommunity(name);
    expect(again.slug).not.toBe(slugBefore?.slug);
    expect(again.slug).toMatch(new RegExp(`^${slugBefore?.slug}-\\d+$`));
  });
});

describe('no oracle and no leak (PEND-13, P38)', () => {
  it('12. another tenant is the bare 404 of an unknown id; a member learns no product name; the zero-match case moves nothing', async () => {
    const [labAdmin] = await adminSql<{ id: string }[]>`
      select u.id::text as id from public.users u where u.email = 'admin@rede-lab.local'`;
    const labName = `${TEST_NAME_PREFIX} laboratorio ${++counter}`;
    const insertLab = async (status: 'active' | 'archived', slug: string) => {
      const [row] = await adminSql<{ id: string }[]>`
        insert into public.communities (tenant_id, created_by_user_id, name, slug, status)
        values (${tenantIds.lab}::uuid, ${labAdmin?.id ?? ''}::uuid, ${`${labName} ${status}`},
                ${slug}, ${status})
        returning id::text as id`;
      return row?.id ?? '';
    };
    const labArchived = await insertLab('archived', `exclusao-lab-arquivada-${counter}`);
    const labActive = await insertLab('active', `exclusao-lab-ativa-${counter}`);
    const labProductName = productName('laboratorio');
    await adminSql`
      insert into public.store_products (tenant_id, created_by_user_id, name, price_cents, status)
      values (${tenantIds.lab}::uuid, ${labAdmin?.id ?? ''}::uuid, ${labProductName}, 990, 'active')`;
    await adminSql`
      insert into public.store_product_communities (tenant_id, product_id, community_id)
      select ${tenantIds.lab}::uuid, p.id, ${labArchived}::uuid
        from public.store_products p where p.name = ${labProductName}`;

    const labRows = async () => {
      const [row] = await adminSql<{ snapshot: string }[]>`
        select jsonb_build_object(
          'communities', (select jsonb_agg(to_jsonb(c) order by c.id)
                            from public.communities c where c.id = any(${[labArchived, labActive]}::uuid[])),
          'links', (select jsonb_agg(to_jsonb(l) order by l.product_id)
                      from public.store_product_communities l where l.community_id = ${labArchived}::uuid)
        )::text as snapshot`;
      return row?.snapshot;
    };
    const deletedCounts = async () =>
      JSON.stringify(
        await adminSql<{ tenant_id: string; n: number }[]>`
          select tenant_id::text, count(*)::int as n from public.communities
           where deleted_at is not null group by tenant_id order by tenant_id`,
      );

    const labBefore = await labRows();
    const countsBefore = await deletedCounts();

    const unknown = sansRequestId(await expectBare404(await del(randomUUID()), 'unknown id'));
    for (const [label, id] of [
      ['lab archived', labArchived],
      ['lab active', labActive],
    ] as const) {
      const raw = await expectBare404(await del(id), label);
      expect(sansRequestId(raw), label).toBe(unknown);
      for (const needle of [id, tenantIds.lab, labName, labProductName]) {
        expect(raw, `${label}: ${needle}`).not.toContain(needle);
      }
    }
    // The zero-match calls changed no row of any tenant.
    expect(await labRows()).toBe(labBefore);
    expect(await deletedCounts()).toBe(countsBefore);

    // A member deleting an archived community that an active product links is 403, naming nothing.
    const secret = productName('segredo');
    const { community } = await lockedArchived('sigilosa', [secret]);
    const asMember = await del(community.id, tokens.demoMember);
    const memberText = await asMember.text();
    expect(asMember.status, memberText).toBe(403);
    expect(memberText).not.toContain(secret);
    expect(memberText).not.toContain(community.id);
    expect(await deletedAtOf(community.id)).toBeNull();
  });
});

type ProductRow = { status: string; updated_at: string };

/** `PUT /v1/store/products/{productId}/status`. */
const putProductStatus = (
  productId: string,
  status: 'active' | 'archived',
  token = tokens.demoAdmin,
  host = HOSTS.demo,
) =>
  request(
    `/v1/store/products/${productId}/status`,
    token,
    { method: 'PUT', body: JSON.stringify({ status }) },
    host,
  );

async function productRow(productId: string): Promise<ProductRow | undefined> {
  const [row] = await adminSql<ProductRow[]>`
    select status, updated_at::text from public.store_products where id = ${productId}::uuid`;
  return row;
}

/** Asserts the closed 409 and that the raw body names nothing. Returns the raw body. */
async function expectCommunityDeleted(
  res: Response,
  label: string,
  forbidden: string[] = [],
): Promise<string> {
  const raw = await res.clone().text();
  expect(res.status, `${label}: ${raw}`).toBe(409);
  const error = await envelope(res);
  expect(error.code, label).toBe('CONFLICT');
  expect(error.details, label).toEqual({ store: 'community_deleted' });
  for (const needle of forbidden) expect(raw, `${label}: ${needle}`).not.toContain(needle);
  return raw;
}

/** An ARCHIVED product linking an ARCHIVED, DELETED community. */
async function archivedProductOfDeletedCommunity(suffix: string) {
  const community = await createCommunity(uniqueName(suffix));
  const product = await createProduct(productName(suffix), [community.id]);
  await archiveProduct(product.id);
  await archive(community.id);
  expect((await del(community.id)).status).toBe(204);
  return { community, product };
}

describe('reactivating a product that links a deleted community (09.3 WR-03, D-554)', () => {
  it('13. tracer: the reactivation is 409 community_deleted and writes nothing; archiving is still 200', async () => {
    const { community, product } = await archivedProductOfDeletedCommunity('reativar');
    const before = await productRow(product.id);
    expect(before?.status).toBe('archived');

    const first = await putProductStatus(product.id, 'active');
    const firstText = await expectCommunityDeleted(first, 'first', [
      product.id,
      product.name,
      community.id,
      community.name,
    ]);
    expect(await productRow(product.id)).toEqual(before);
    expect(await linkCount(community.id)).toBe(1);
    expect(await deletedAtOf(community.id)).toEqual(expect.any(String));

    // The same call answers the same body.
    const second = await putProductStatus(product.id, 'active');
    expect(second.status).toBe(409);
    expect(sansRequestId(await second.text())).toBe(sansRequestId(firstText));
    expect(await productRow(product.id)).toEqual(before);

    // Archiving is never refused.
    const archived = await putProductStatus(product.id, 'archived');
    expect(archived.status, await archived.clone().text()).toBe(200);
    expect(await productRow(product.id)).toEqual(before);
  });

  it('14. control: an archived but NOT deleted community does not block; the reactivated product counts again', async () => {
    const community = await createCommunity(uniqueName('controle'));
    const product = await createProduct(productName('controle'), [community.id]);
    await archiveProduct(product.id);
    await archive(community.id);

    const res = await putProductStatus(product.id, 'active');
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('active');
    expect((await productRow(product.id))?.status).toBe('active');

    const refusal = await refusalOf(await del(community.id));
    expect(refusal.products).toEqual([{ id: product.id, name: product.name }]);
    expect(await deletedAtOf(community.id)).toBeNull();
  });

  it('15. idempotent: re-sending active leaves the row alone, even when a linked community is deleted', async () => {
    const community = await createCommunity(uniqueName('idempotente'));
    const product = await createProduct(productName('idempotente'), [community.id]);
    const before = await productRow(product.id);
    expect(before?.status).toBe('active');

    const first = await putProductStatus(product.id, 'active');
    expect(first.status, await first.clone().text()).toBe(200);
    expect(await productRow(product.id)).toEqual(before);

    // The inconsistent state an older row or a support recovery could leave.
    await adminSql`update public.communities set deleted_at = now() where id = ${community.id}::uuid`;
    const second = await putProductStatus(product.id, 'active');
    expect(second.status, await second.clone().text()).toBe(200);
    expect(await productRow(product.id)).toEqual(before);
  });
});

/** True when `pending` settles within `ms` (it does not stop the promise). */
async function settlesWithin(pending: Promise<unknown>, ms: number): Promise<boolean> {
  let settled = false;
  pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, ms));
  return settled;
}

describe('the reactivation guard across tenants, links and races (09.3 WR-03, T-qc8-01..03)', () => {
  let restoreLabStore: () => Promise<void> = async () => {};

  beforeAll(async () => {
    restoreLabStore = await withStoreEnabled('lab');
  });

  afterAll(async () => {
    await restoreLabStore();
  });

  it('16. cross-tenant: a foreign admin and a foreign id are the bare 404; the check is per tenant; a foreign link blocks nothing', async () => {
    const { community: deletedCommunity, product } =
      await archivedProductOfDeletedCommunity('inquilinos');
    const before = await productRow(product.id);
    expect(before?.status).toBe('archived');

    // The lab admin and an unknown id: the same bare 404 as a random uuid.
    const unknown = sansRequestId(
      await expectBare404(await putProductStatus(randomUUID(), 'active'), 'unknown id'),
    );
    const asLab = await putProductStatus(product.id, 'active', tokens.labAdmin, HOSTS.lab);
    const asLabRaw = await expectBare404(asLab, 'lab admin on a demo product');
    expect(sansRequestId(asLabRaw)).toBe(unknown);
    for (const needle of [product.id, product.name, deletedCommunity.id]) {
      expect(asLabRaw).not.toContain(needle);
    }
    expect(await productRow(product.id)).toEqual(before);

    // Lab rows, inserted the way test 12 does.
    const [labAdmin] = await adminSql<{ id: string }[]>`
      select u.id::text as id from public.users u where u.email = 'admin@rede-lab.local'`;
    const labCommunityName = `${TEST_NAME_PREFIX} laboratorio apagada ${++counter}`;
    const [labCommunity] = await adminSql<{ id: string }[]>`
      insert into public.communities (tenant_id, created_by_user_id, name, slug, status, deleted_at)
      values (${tenantIds.lab}::uuid, ${labAdmin?.id ?? ''}::uuid, ${labCommunityName},
              ${`exclusao-lab-apagada-${counter}`}, 'archived', now())
      returning id::text as id`;
    const labCommunityId = labCommunity?.id ?? '';
    const labProductName = productName('laboratorio reativar');
    const [labProduct] = await adminSql<{ id: string }[]>`
      insert into public.store_products (tenant_id, created_by_user_id, name, price_cents, status)
      values (${tenantIds.lab}::uuid, ${labAdmin?.id ?? ''}::uuid, ${labProductName}, 990, 'archived')
      returning id::text as id`;
    const labProductId = labProduct?.id ?? '';
    await adminSql`
      insert into public.store_product_communities (tenant_id, product_id, community_id)
      values (${tenantIds.lab}::uuid, ${labProductId}::uuid, ${labCommunityId}::uuid)`;
    createdProducts.push(labProductId);

    // The demo admin on the lab product: the same bare 404.
    const asDemo = await putProductStatus(labProductId, 'active');
    const asDemoRaw = await expectBare404(asDemo, 'demo admin on a lab product');
    expect(sansRequestId(asDemoRaw)).toBe(unknown);
    expect((await productRow(labProductId))?.status).toBe('archived');

    // Per tenant: the lab admin reactivating its own product is the 409.
    await expectCommunityDeleted(
      await putProductStatus(labProductId, 'active', tokens.labAdmin, HOSTS.lab),
      'lab own product',
      [labProductId, labProductName, labCommunityId, labCommunityName],
    );
    expect((await productRow(labProductId))?.status).toBe('archived');

    // Tenant B's deleted community does not block tenant A's product with a live community.
    const live = await createCommunity(uniqueName('viva'));
    const mine = await createProduct(productName('viva'), [live.id]);
    await archiveProduct(mine.id);
    await archive(live.id);
    const ok = await putProductStatus(mine.id, 'active');
    expect(ok.status, await ok.clone().text()).toBe(200);

    // A foreign link row planted through the admin connection (the FK is single-column).
    await archiveProduct(mine.id);
    let planted = true;
    try {
      await adminSql`
        insert into public.store_product_communities (tenant_id, product_id, community_id)
        values (${tenantIds.demo}::uuid, ${mine.id}::uuid, ${labCommunityId}::uuid)`;
    } catch (error) {
      planted = false;
      console.warn('foreign link rejected by the database:', (error as Error).message);
    }
    if (planted) {
      const again = await putProductStatus(mine.id, 'active');
      const raw = await again.clone().text();
      expect(again.status, raw).toBe(200);
      for (const needle of [labCommunityId, labCommunityName, tenantIds.lab]) {
        expect(raw).not.toContain(needle);
      }
    }
  });

  it('17. several communities: one deleted among three refuses; two live ones (one archived) reactivate', async () => {
    const a = await createCommunity(uniqueName('a'));
    const b = await createCommunity(uniqueName('b'));
    const c = await createCommunity(uniqueName('c'));
    const refused = await createProduct(productName('tres'), [a.id, b.id, c.id]);
    const allowed = await createProduct(productName('duas'), [a.id, b.id]);
    await archiveProduct(refused.id);
    await archiveProduct(allowed.id);
    await archive(b.id);
    await archive(c.id);
    expect((await del(c.id)).status).toBe(204);

    const before = await productRow(refused.id);
    await expectCommunityDeleted(await putProductStatus(refused.id, 'active'), 'three links', [
      refused.id,
      c.id,
      c.name,
    ]);
    expect(await productRow(refused.id)).toEqual(before);

    const res = await putProductStatus(allowed.id, 'active');
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await productRow(allowed.id))?.status).toBe('active');
  });

  it('18. deterministic race: a reactivation waits for an in-flight delete, and a delete waits for an in-flight reactivation', async () => {
    // a) the delete holds the community row first.
    {
      const community = await createCommunity(uniqueName('corrida a'));
      const product = await createProduct(productName('corrida a'), [community.id]);
      await archiveProduct(product.id);
      await archive(community.id);

      let release: () => void = () => {};
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked: () => void = () => {};
      const lockedFirst = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const holder = adminSql.begin(async (tx) => {
        await tx`select id from public.communities where id = ${community.id}::uuid for update`;
        locked();
        await barrier;
        await tx`update public.communities set deleted_at = now() where id = ${community.id}::uuid`;
      });

      let pending: Promise<Response> | undefined;
      try {
        await lockedFirst;
        pending = Promise.resolve(putProductStatus(product.id, 'active'));
        expect(
          await settlesWithin(pending, 400),
          'the reactivation waits for the community lock',
        ).toBe(false);
      } finally {
        release();
        await holder;
      }
      if (!pending) throw new Error('the reactivation was never started');
      await expectCommunityDeleted(await pending, '18a');
      expect((await productRow(product.id))?.status).toBe('archived');
    }

    // b) the reactivation holds the community row first.
    {
      const community = await createCommunity(uniqueName('corrida b'));
      const product = await createProduct(productName('corrida b'), [community.id]);
      await archiveProduct(product.id);
      await archive(community.id);

      let release: () => void = () => {};
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked: () => void = () => {};
      const lockedFirst = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const holder = adminSql.begin(async (tx) => {
        await tx`select id from public.communities where id = ${community.id}::uuid for share`;
        await tx`update public.store_products set status = 'active' where id = ${product.id}::uuid`;
        locked();
        await barrier;
      });

      let pending: Promise<Response> | undefined;
      try {
        await lockedFirst;
        pending = Promise.resolve(del(community.id));
        expect(await settlesWithin(pending, 400), 'the delete waits for the share lock').toBe(
          false,
        );
      } finally {
        release();
        await holder;
      }
      if (!pending) throw new Error('the delete was never started');
      const refusal = await refusalOf(await pending);
      expect(refusal.products).toEqual([{ id: product.id, name: product.name }]);
      expect(await deletedAtOf(community.id)).toBeNull();
    }
  });

  it('19. real race: a delete and a reactivation together end as 204/409 or 409/200, never an active product on a deleted community', async () => {
    for (let round = 0; round < 3; round++) {
      const community = await createCommunity(uniqueName(`disputa ${round}`));
      const product = await createProduct(productName(`disputa ${round}`), [community.id]);
      await archiveProduct(product.id);
      await archive(community.id);

      const [deleted, reactivated] = await Promise.all([
        del(community.id),
        putProductStatus(product.id, 'active'),
      ]);
      const pair = `${deleted.status}/${reactivated.status}`;
      expect(['204/409', '409/200'], pair).toContain(pair);

      const row = await productRow(product.id);
      const deletedAt = await deletedAtOf(community.id);
      expect(row?.status === 'active' && deletedAt != null, `${pair}: ${row?.status}`).toBe(false);
    }
  });
});
