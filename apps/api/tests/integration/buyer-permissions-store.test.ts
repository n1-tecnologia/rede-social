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

// Kept so the helper constants are referenced by the later describes appended by Task 2 and Task 3.
void FLAG_KEYS;
void (null as unknown as Envelope);
