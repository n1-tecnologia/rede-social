import { sqlClient } from '@rede-social/core/db';
import type { ProductDetail } from '@rede-social/module-store/contracts';
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
 * 11.1-06 (D-363, D-890, D-891; BPERM-17, BPERM-25, BPERM-27): the store service half of buyer
 * permissions against the live local stack and the real seed. The product form's save carries the five
 * flags per linked community (`communityLinks`), written with the links in the product transaction, with
 * an idempotent update path for a changed flag, and read back for the administrator only at non-default
 * values.
 *
 * Every product and community this file creates carries the name prefix `bps-<run>` (a prefix the
 * `store.test.ts` sweep, which deletes `st-%`, never touches); both hooks sweep it with `adminSql`.
 *
 * Test ORDER inside each describe is load-bearing (declaration order, `fileParallelism: false`).
 */

type Envelope = { error: { code: string; message?: string; details?: Record<string, unknown> } };
type Flags = { like: boolean; comment: boolean; share: boolean; post: boolean; story: boolean };
type LinkRow = {
  community_id: string;
  can_like: boolean;
  can_comment: boolean;
  can_share: boolean;
  can_post: boolean;
  can_story: boolean;
};

const RUN = Date.now();
const PREFIX = `bps-${RUN}`;

const DEFAULTS: Flags = { like: true, comment: true, share: true, post: false, story: false };
const FLAG_KEYS = ['can_like', 'can_comment', 'can_share', 'can_post', 'can_story'];

const tokens = {
  demoAdmin: '',
  demoMember: '',
  demoSupport: '',
  labAdmin: '',
  buyer: '',
};
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

const patch = (productId: string, body: unknown, token = tokens.demoAdmin, host = HOSTS.demo) =>
  request(
    `/v1/store/products/${productId}`,
    token,
    { method: 'PATCH', body: JSON.stringify(body) },
    host,
  );

/** The manager read of one product, parsed. */
async function managerRead(productId: string): Promise<ProductDetail> {
  const res = await request(`/v1/store/products/${productId}`, tokens.demoAdmin);
  expect(res.status).toBe(200);
  return (await res.json()) as ProductDetail;
}

async function sweep(): Promise<void> {
  const products = adminSql`select id from public.store_products where name like ${`${PREFIX}%`}`;
  await adminSql`delete from public.store_entitlements where product_id in (${products})`;
  await adminSql`delete from public.store_orders where product_id in (${products})`;
  await adminSql`delete from public.store_products where name like ${`${PREFIX}%`}`;
  const communities = adminSql`select id from public.communities where name like ${`${PREFIX}%`}`;
  await adminSql`delete from public.feed_posts where community_id in (${communities})`;
  await adminSql`delete from public.communities where name like ${`${PREFIX}%`}`;
  await removeIdentitiesByPrefix(PREFIX);
}

/** A throwaway organization community through the admin's own route, and its id. */
async function createCommunity(name: string, host = HOSTS.demo, token = tokens.demoAdmin) {
  const res = await post('/v1/communities', token, { name: `${PREFIX} ${name}` }, host);
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

const link = (communityId: string, flags: Partial<Flags> = {}) => ({
  communityId,
  ...DEFAULTS,
  ...flags,
});

/** The stored link rows of a product, in community id order. */
async function linkRows(productId: string): Promise<LinkRow[]> {
  return adminSql<LinkRow[]>`
    select community_id::text as community_id, can_like, can_comment, can_share, can_post, can_story
      from public.store_product_communities
     where product_id = ${productId}::uuid
     order by community_id`;
}

/** The row's `xmin`: it changes on every physical write, so an unchanged value proves a no-op. */
async function linkXmin(productId: string, communityId: string): Promise<string> {
  const [row] = await adminSql<{ x: string }[]>`
    select xmin::text as x from public.store_product_communities
     where product_id = ${productId}::uuid and community_id = ${communityId}::uuid`;
  return row?.x ?? '';
}

async function createProduct(name: string, body: Record<string, unknown>): Promise<ProductDetail> {
  const res = await post('/v1/store/products', tokens.demoAdmin, {
    name: `${PREFIX} ${name}`,
    priceCents: 1990,
    ...body,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as ProductDetail;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  await sweep();
  restoreStore = await withStoreEnabled('demo');
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.demoSupport = await signInAs('support@rede-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  const buyer = await createSharedIdentity({ prefix: PREFIX, memberships: [{ host: 'demo' }] });
  tokens.buyer = await signInAs(buyer.email, buyer.password);
});

afterAll(async () => {
  await restoreStore();
  await sweep();
  await adminSql.end();
  await sqlClient.end();
});

describe('11.1-06 tracer: an administrator saves a product with a non-default link and reads it back', () => {
  const fx: { community: string; other: string; product?: ProductDetail } = {
    community: '',
    other: '',
  };

  beforeAll(async () => {
    fx.community = await createCommunity('trilha');
    fx.other = await createCommunity('padrao');
  });

  it('1. D-890/D-891 TRACER: POST with one non-default communityLinks entry stores the five flags and the manager read returns them', async () => {
    const flags: Flags = { like: true, comment: false, share: true, post: true, story: false };
    const created = await createProduct('trilha', {
      communityLinks: [link(fx.community, flags)],
    });
    fx.product = created;
    expect(created.communities.map((c) => c.id)).toEqual([fx.community]);

    const rows = await linkRows(created.id);
    expect(rows).toEqual([
      {
        community_id: fx.community,
        can_like: true,
        can_comment: false,
        can_share: true,
        can_post: true,
        can_story: false,
      },
    ]);

    // The create answer is the manager's detail, and so is the next manager read.
    expect(created.communityPermissions).toEqual([{ communityId: fx.community, ...flags }]);
    const read = await managerRead(created.id);
    expect(read.communityPermissions).toEqual([{ communityId: fx.community, ...flags }]);
  });

  it('2. D-891: a link at the defaults returns no communityPermissions key at all, and a communityIds-only product answers the shape it always did', async () => {
    const atDefaults = await createProduct('padrao', { communityLinks: [link(fx.other)] });
    expect(atDefaults).not.toHaveProperty('communityPermissions');
    expect(await linkRows(atDefaults.id)).toEqual([
      {
        community_id: fx.other,
        can_like: true,
        can_comment: true,
        can_share: true,
        can_post: false,
        can_story: false,
      },
    ]);
    expect(await managerRead(atDefaults.id)).not.toHaveProperty('communityPermissions');

    const legacy = await createProduct('legado', { communityIds: [fx.other] });
    expect(legacy).not.toHaveProperty('communityPermissions');
    expect(Object.keys(legacy).sort()).toEqual(Object.keys(atDefaults).sort());
    const rows = await linkRows(legacy.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ can_like: true, can_post: false, can_story: false });
  });
});

describe('11.1-06 update path: a changed flag, communityIds alone, archived links, an idempotent re-save', () => {
  const fx = { a: '', b: '', c: '', archived: '', product: '' };

  beforeAll(async () => {
    fx.a = await createCommunity('upd-a');
    fx.b = await createCommunity('upd-b');
    fx.c = await createCommunity('upd-c');
    fx.archived = await createCommunity('upd-arq');
    const product = await createProduct('atualiza', {
      communityLinks: [link(fx.a), link(fx.archived, { post: true, story: true })],
    });
    fx.product = product.id;
    // The community is archived AFTER the link exists: the form can no longer list or re-send it (CR-02).
    await adminSql`update public.communities set status = 'archived' where id = ${fx.archived}::uuid`;
  });

  const flagsOf = async (communityId: string) =>
    (await linkRows(fx.product)).find((row) => row.community_id === communityId);

  it('a. D-891: PATCH communityLinks changing one flag of an existing link persists it and the next manager read returns it', async () => {
    const before = await linkXmin(fx.product, fx.a);
    const res = await patch(fx.product, { communityLinks: [link(fx.a, { comment: false })] });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await flagsOf(fx.a)).toMatchObject({
      can_comment: false,
      can_like: true,
      can_post: false,
    });
    expect(await linkXmin(fx.product, fx.a)).not.toBe(before);
    const read = await managerRead(fx.product);
    expect(read.communityPermissions).toEqual([{ communityId: fx.a, ...DEFAULTS, comment: false }]);
    // The positive control of the unchanged case below: the flag is back to default and the key disappears.
    const back = await patch(fx.product, { communityLinks: [link(fx.a)] });
    expect(back.status).toBe(200);
    expect(await managerRead(fx.product)).not.toHaveProperty('communityPermissions');
  });

  it('b. T-11.1-23: an unchanged re-save writes no row (the link keeps its row version)', async () => {
    const saved = await patch(fx.product, { communityLinks: [link(fx.a, { share: false })] });
    expect(saved.status).toBe(200);
    const first = await linkXmin(fx.product, fx.a);
    const again = await patch(fx.product, { communityLinks: [link(fx.a, { share: false })] });
    expect(again.status).toBe(200);
    expect(await linkXmin(fx.product, fx.a)).toBe(first);
    expect(await flagsOf(fx.a)).toMatchObject({ can_share: false });
    // control: a real change moves the row version
    const changed = await patch(fx.product, { communityLinks: [link(fx.a, { share: true })] });
    expect(changed.status).toBe(200);
    expect(await linkXmin(fx.product, fx.a)).not.toBe(first);
  });

  it('c. D-363: communityIds alone leaves the stored flags of an existing link and gives a NEW link the defaults', async () => {
    await adminSql`
      update public.store_product_communities set can_post = true
       where product_id = ${fx.product}::uuid and community_id = ${fx.a}::uuid`;
    const res = await patch(fx.product, { communityIds: [fx.a, fx.b] });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await flagsOf(fx.a)).toMatchObject({ can_post: true });
    expect(await flagsOf(fx.b)).toEqual({
      community_id: fx.b,
      can_like: true,
      can_comment: true,
      can_share: true,
      can_post: false,
      can_story: false,
    });
    // the manager read carries only what differs from the defaults
    expect((await managerRead(fx.product)).communityPermissions).toEqual([
      { communityId: fx.a, ...DEFAULTS, post: true },
    ]);
  });

  it('d. D-363: a patch with neither field (a price edit) leaves the links and their flags untouched', async () => {
    const before = await linkRows(fx.product);
    const xminA = await linkXmin(fx.product, fx.a);
    const res = await patch(fx.product, { priceCents: 2490 });
    expect(res.status).toBe(200);
    expect(await linkRows(fx.product)).toEqual(before);
    expect(await linkXmin(fx.product, fx.a)).toBe(xminA);
  });

  it('e. CR-02: a link to an ARCHIVED community survives a communityLinks replace that omits it, an ACTIVE one omitted is unlinked', async () => {
    const res = await patch(fx.product, {
      communityLinks: [link(fx.a, { post: true }), link(fx.c, { story: true })],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const rows = await linkRows(fx.product);
    expect(rows.map((row) => row.community_id).sort()).toEqual([fx.a, fx.c, fx.archived].sort());
    expect(rows.find((row) => row.community_id === fx.archived)).toMatchObject({
      can_post: true,
      can_story: true,
    });
    expect(rows.find((row) => row.community_id === fx.b)).toBeUndefined();
    // the archived link is not on the manager read (the form cannot show it); the order is the list order
    const byId = <T extends { communityId: string }>(list: T[] = []) =>
      [...list].sort((x, y) => x.communityId.localeCompare(y.communityId));
    expect(byId((await managerRead(fx.product)).communityPermissions)).toEqual(
      byId([
        { communityId: fx.a, ...DEFAULTS, post: true },
        { communityId: fx.c, ...DEFAULTS, story: true },
      ]),
    );
  });

  it('f. D-890: communityIds beside communityLinks, and a duplicate id inside communityLinks, are 400 community_links_conflict on create and on patch', async () => {
    const both = { communityIds: [fx.a], communityLinks: [link(fx.a)] };
    const dup = { communityLinks: [link(fx.a), link(fx.a, { post: true })] };
    for (const body of [both, dup]) {
      const created = await post('/v1/store/products', tokens.demoAdmin, {
        name: `${PREFIX} conflito`,
        priceCents: 100,
        ...body,
      });
      expect(created.status).toBe(400);
      expect(((await created.json()) as Envelope).error.details).toEqual({
        store: 'community_links_conflict',
      });
      const patched = await patch(fx.product, body);
      expect(patched.status).toBe(400);
      expect(((await patched.json()) as Envelope).error.details).toEqual({
        store: 'community_links_conflict',
      });
    }
    const named =
      await adminSql`select 1 from public.store_products where name = ${`${PREFIX} conflito`}`;
    expect(named).toHaveLength(0);
  });

  it('g. D-364: a flags-only save needs no preview: the lock preview names nothing for communities the product already links', async () => {
    const res = await post('/v1/store/products/lock-preview', tokens.demoAdmin, {
      productId: fx.product,
      communityIds: [fx.a, fx.c],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { items: unknown[] }).items).toEqual([]);
  });
});

describe('11.1-06 authorization, isolation and member payloads (BPERM-25, D-888, D-363)', () => {
  const fx = {
    own: '',
    other: '',
    archived: '',
    removed: '',
    labCommunity: '',
    product: '',
    nonDefault: '',
  };
  let restoreLab: () => Promise<void> = async () => {};
  let restoreLabCommunities: () => Promise<void> = async () => {};

  beforeAll(async () => {
    restoreLab = await withStoreEnabled('lab');
    restoreLabCommunities = await withModuleEnabled('lab', 'communities');
    fx.own = await createCommunity('aut-a');
    fx.other = await createCommunity('aut-b');
    fx.archived = await createCommunity('aut-arq');
    fx.removed = await createCommunity('aut-rem');
    await adminSql`update public.communities set status = 'archived' where id = ${fx.archived}::uuid`;
    await adminSql`update public.communities set deleted_at = now() where id = ${fx.removed}::uuid`;
    fx.labCommunity = await createCommunity('aut-lab', HOSTS.lab, tokens.labAdmin);
    const product = await createProduct('autoriza', {
      communityLinks: [link(fx.own, { post: true, story: true, share: false })],
    });
    fx.product = product.id;
  });

  afterAll(async () => {
    await restoreLabCommunities();
    await restoreLab();
  });

  it('T-11.1-20: a member and a support user are refused 403 on create and patch with communityLinks, beside a manager that succeeds', async () => {
    for (const token of [tokens.demoMember, tokens.demoSupport]) {
      const created = await post('/v1/store/products', token, {
        name: `${PREFIX} recusado`,
        priceCents: 100,
        communityLinks: [link(fx.own, { post: true })],
      });
      expect(created.status).toBe(403);
      const patched = await patch(fx.product, { communityLinks: [link(fx.own)] }, token);
      expect(patched.status).toBe(403);
    }
    // nothing was written by the refusals
    expect(
      await adminSql`select 1 from public.store_products where name = ${`${PREFIX} recusado`}`,
    ).toHaveLength(0);
    expect((await linkRows(fx.product))[0]).toMatchObject({ can_post: true, can_story: true });
    // positive control: the manager succeeds with the very same body
    const ok = await patch(fx.product, {
      communityLinks: [link(fx.own, { post: true, story: true, share: false })],
    });
    expect(ok.status).toBe(200);
  });

  it('T-11.1-20: neither a member nor a support user receives communityPermissions from the product read', async () => {
    for (const token of [tokens.demoMember, tokens.demoSupport, tokens.buyer]) {
      const res = await request(`/v1/store/products/${fx.product}`, token);
      expect(res.status).toBe(200);
      expect(await res.json()).not.toHaveProperty('communityPermissions');
    }
    // control: the manager does receive it for the same product
    expect((await managerRead(fx.product)).communityPermissions).toEqual([
      { communityId: fx.own, ...DEFAULTS, post: true, story: true, share: false },
    ]);
  });

  it('T-11.1-21: an archived and a soft-deleted community in communityLinks are refused like in communityIds; an active one is accepted', async () => {
    for (const community of [fx.archived, fx.removed]) {
      const links = await patch(fx.product, { communityLinks: [link(community)] });
      expect(links.status).toBe(400);
      expect(((await links.json()) as Envelope).error.details).toEqual({
        store: 'community_invalid',
      });
      const ids = await patch(fx.product, { communityIds: [community] });
      expect(ids.status).toBe(400);
      expect(((await ids.json()) as Envelope).error.details).toEqual({
        store: 'community_invalid',
      });
      const created = await post('/v1/store/products', tokens.demoAdmin, {
        name: `${PREFIX} invalida`,
        priceCents: 100,
        communityLinks: [link(community)],
      });
      expect(created.status).toBe(400);
    }
    expect(
      await adminSql`select 1 from public.store_products where name = ${`${PREFIX} invalida`}`,
    ).toHaveLength(0);
    // nothing changed on the product
    expect((await linkRows(fx.product)).map((row) => row.community_id)).toEqual([fx.own]);
    const ok = await patch(fx.product, {
      communityLinks: [link(fx.own, { post: true, story: true, share: false })],
    });
    expect(ok.status).toBe(200);
  });

  it('T-11.1-21 / BPERM-25: the other tenant never reaches this one: a lab manager cannot patch the demo product, and a demo community id inside lab communityLinks is community_invalid', async () => {
    const before = await linkRows(fx.product);
    const foreign = await patch(
      fx.product,
      { communityLinks: [link(fx.labCommunity, { post: true })] },
      tokens.labAdmin,
      HOSTS.lab,
    );
    expect(foreign.status).toBe(404);
    const foreignBody = (await foreign.json()) as Envelope;
    expect(foreignBody.error.code).toBe('NOT_FOUND');
    expect(foreignBody.error).not.toHaveProperty('details');
    expect(await linkRows(fx.product)).toEqual(before);

    // a lab product whose links name a DEMO community: the same bare refusal as an unknown id
    const labProduct = await post(
      '/v1/store/products',
      tokens.labAdmin,
      {
        name: `${PREFIX} lab-produto`,
        priceCents: 100,
        communityLinks: [link(fx.own, { post: true })],
      },
      HOSTS.lab,
    );
    expect(labProduct.status).toBe(400);
    expect(((await labProduct.json()) as Envelope).error.details).toEqual({
      store: 'community_invalid',
    });
    // positive control: the same lab manager links the lab's own community with a flag
    const labOk = await post(
      '/v1/store/products',
      tokens.labAdmin,
      {
        name: `${PREFIX} lab-produto`,
        priceCents: 100,
        communityLinks: [link(fx.labCommunity, { post: true })],
      },
      HOSTS.lab,
    );
    expect(labOk.status, await labOk.clone().text()).toBe(201);
    const labDetail = (await labOk.json()) as ProductDetail;
    expect(labDetail.communityPermissions).toEqual([
      { communityId: fx.labCommunity, ...DEFAULTS, post: true },
    ]);
    // and the demo product's links were never involved
    expect(await linkRows(fx.product)).toEqual(before);
  });

  it('T-11.1-22 / D-888: the purchase answer, the member list and the member detail carry no communityPermissions, no can_* key and no flag key', async () => {
    const forbidden = new RegExp(
      `"(communityPermissions|${FLAG_KEYS.join('|')}|like|comment|share|post|story)"\\s*:`,
    );
    const bought = await post(`/v1/store/products/${fx.product}/purchase`, tokens.buyer, {
      expectedAmountCents: 1990,
    });
    expect(bought.status, await bought.clone().text()).toBe(200);
    const purchaseBody = await bought.text();
    expect(purchaseBody).not.toMatch(forbidden);

    const bodies: string[] = [purchaseBody];
    for (const token of [tokens.buyer, tokens.demoMember]) {
      for (const path of [`/v1/store/products/${fx.product}`, '/v1/store/products?limit=50']) {
        const res = await request(path, token);
        expect(res.status).toBe(200);
        bodies.push(await res.text());
      }
    }
    // the list really carries the product (so the absence above is not an empty-list artefact)
    expect(bodies.some((body) => body.includes(fx.product))).toBe(true);
    for (const body of bodies) expect(body).not.toMatch(forbidden);
    // control: the manager's body for the same product does name the flags
    const managerBody = await (
      await request(`/v1/store/products/${fx.product}`, tokens.demoAdmin)
    ).text();
    expect(managerBody).toMatch(forbidden);
  });

  it('D-363: two sequential saves with different sets leave the last set (last writer wins), flags included', async () => {
    const first = await patch(fx.product, {
      communityLinks: [link(fx.own), link(fx.other, { post: true })],
    });
    expect(first.status).toBe(200);
    expect((await linkRows(fx.product)).map((row) => row.community_id).sort()).toEqual(
      [fx.own, fx.other].sort(),
    );
    const second = await patch(fx.product, { communityLinks: [link(fx.other, { story: true })] });
    expect(second.status).toBe(200);
    const rows = await linkRows(fx.product);
    expect(rows).toEqual([
      {
        community_id: fx.other,
        can_like: true,
        can_comment: true,
        can_share: true,
        can_post: false,
        can_story: true,
      },
    ]);
  });
});
