import { sqlClient } from '@rede-social/core/db';
import type { CommunityPage, CommunitySummary } from '@rede-social/module-communities/contracts';
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
  withSocialEnabled,
  withStoreEnabled,
  withStoriesEnabled,
} from './setup';

/**
 * 11.1-07 (D-886, D-892, D-882, D-718, UI-D-888; BPERM-11, BPERM-15, BPERM-25, BPERM-27): `viewer.actions` on the community
 * list and detail is the UNION of the buyer's flags, built at the one site (`viewerOf`).
 *
 * Fixture (built in `beforeAll`, every name prefixed `bpv-<run>`): in `rede-demo` with `store`, `social` and `stories`
 * ON, three organization communities made by the seed admin: `main` (the one under test, linked to a product), `other`
 * (linked to a second product) and `bare` (no product at all); a member-created community; two throwaway members: the
 * buyer (holds the products through the real purchase route) and a reader who holds nothing. Link flags, entitlement
 * status and `story_highlights.open_to_buyers` are written through the owner connection (the product form that writes the
 * flags is a later plan of the phase).
 *
 * Test ORDER inside each describe is load-bearing (declaration order); every case sets the state it needs.
 */

const RUN = Date.now();
const PREFIX = `bpv-${RUN}`;

type Actions = CommunitySummary['viewer']['actions'];

/** What a member reads today for an organization community: the controls every member had before this phase. */
const TODAY_MEMBER: Actions = { like: true, comment: true, share: true, post: false, story: false };
const ALL_TRUE: Actions = { like: true, comment: true, share: true, post: true, story: true };

const tokens = { admin: '', buyer: '', reader: '' };
const users = { buyer: '', reader: '' };
let tenantId = '';
let restoreStore: () => Promise<void> = async () => {};
let restoreSocial: () => Promise<void> = async () => {};
let restoreStories: () => Promise<void> = async () => {};
const fx = {
  main: '',
  other: '',
  bare: '',
  memberMade: '',
  productA: '',
  productB: '',
  productOther: '',
};

const request = (path: string, token: string, init: RequestInit = {}) =>
  api.request(path, {
    ...init,
    headers: {
      'x-tenant-host': HOSTS.demo,
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });

const post = (path: string, token: string, body: unknown) =>
  request(path, token, { method: 'POST', body: JSON.stringify(body) });

async function sweep(): Promise<void> {
  const products = adminSql`select id from public.store_products where name like ${`${PREFIX}%`}`;
  const communities = adminSql`select id from public.communities where name like ${`${PREFIX}%`}`;
  await adminSql`
    delete from public.story_highlights where community_id in (${communities})`;
  await adminSql`delete from public.feed_posts where community_id in (${communities})`;
  await adminSql`delete from public.store_entitlements where product_id in (${products})`;
  await adminSql`delete from public.store_orders where product_id in (${products})`;
  await adminSql`delete from public.store_products where name like ${`${PREFIX}%`}`;
  await adminSql`delete from public.communities where name like ${`${PREFIX}%`}`;
  await removeIdentitiesByPrefix(PREFIX);
}

/** Writes the five flags of ONE link (product x community); the other links of the product are untouched. */
const setFlags = (
  product: string,
  community: string,
  flags: Partial<Record<'like' | 'comment' | 'share' | 'post' | 'story', boolean>>,
) =>
  adminSql`
    update public.store_product_communities
       set can_like = ${flags.like ?? true}, can_comment = ${flags.comment ?? true},
           can_share = ${flags.share ?? true}, can_post = ${flags.post ?? false},
           can_story = ${flags.story ?? false}
     where product_id = ${product}::uuid and community_id = ${community}::uuid`;

async function createProduct(name: string, communityIds: string[]): Promise<string> {
  const res = await post('/v1/store/products', tokens.admin, {
    name: `${PREFIX} ${name}`,
    priceCents: 1990,
    communityIds,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as ProductDetail).id;
}

async function buy(product: string, token: string): Promise<void> {
  const res = await post(`/v1/store/products/${product}/purchase`, token, {
    expectedAmountCents: 1990,
  });
  expect(res.status, `purchase -> ${res.status}`).toBe(200);
}

/** Actions of one community as the DETAIL read answers them. */
async function detailActions(token: string, community: string): Promise<Actions> {
  const res = await request(`/v1/communities/${community}`, token);
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as CommunitySummary).viewer.actions;
}

/** Actions of every fixture community as the LIST read answers them, keyed by id. */
async function listActions(token: string): Promise<Map<string, Actions>> {
  const res = await request('/v1/communities?limit=50', token);
  expect(res.status, await res.clone().text()).toBe(200);
  const page = (await res.json()) as CommunityPage;
  return new Map(page.items.map((item) => [item.id, item.viewer.actions]));
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  await sweep();
  restoreStore = await withStoreEnabled('demo');
  restoreSocial = await withSocialEnabled('demo');
  restoreStories = await withStoriesEnabled('demo');
  const [demo] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-demo'`;
  tenantId = demo?.id ?? '';
  tokens.admin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);

  const buyer = await createSharedIdentity({ prefix: PREFIX, memberships: [{ host: 'demo' }] });
  const reader = await createSharedIdentity({ prefix: PREFIX, memberships: [{ host: 'demo' }] });
  users.buyer = buyer.userId;
  users.reader = reader.userId;
  tokens.buyer = await signInAs(buyer.email, buyer.password);
  tokens.reader = await signInAs(reader.email, reader.password);

  const make = async (name: string): Promise<string> => {
    const res = await post('/v1/communities', tokens.admin, { name: `${PREFIX} ${name}` });
    expect(res.status, await res.clone().text()).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  fx.main = await make('principal');
  fx.other = await make('outra');
  fx.bare = await make('sem produto');

  fx.productA = await createProduct('produto A', [fx.main]);
  fx.productOther = await createProduct('produto outra', [fx.other]);
  await buy(fx.productA, tokens.buyer);
});

afterAll(async () => {
  await sweep();
  await restoreStories();
  await restoreSocial();
  await restoreStore();
  await adminSql.end();
  await sqlClient.end();
});

describe('11.1-07 tracer: a buyer reads the community with their union in viewer.actions', () => {
  it('1. D-886/D-892 TRACER: a link ticking only comment and post gives like false, comment true, share false, post true, story false, on the list and on the detail', async () => {
    await setFlags(fx.productA, fx.main, { comment: true, post: true, like: false, share: false });
    const expected: Actions = {
      like: false,
      comment: true,
      share: false,
      post: true,
      story: false,
    };
    expect(await detailActions(tokens.buyer, fx.main)).toEqual(expected);
    expect((await listActions(tokens.buyer)).get(fx.main)).toEqual(expected);
  });

  it('2. controls: a member without an entitlement, a staff viewer and a community with no linked product read what they read before', async () => {
    await setFlags(fx.productA, fx.main, { comment: true, post: true, like: false, share: false });
    // a member who holds nothing reads today's values (the locked page does not draw them)
    const locked = await request(`/v1/communities/${fx.main}`, tokens.reader);
    if (locked.status === 200) {
      expect(((await locked.json()) as CommunitySummary).viewer.actions).toEqual(TODAY_MEMBER);
    } else {
      expect([403, 404]).toContain(locked.status);
    }
    // staff holds every action, whatever the link ticks
    expect(await detailActions(tokens.admin, fx.main)).toEqual(ALL_TRUE);
    // a community with no linked product is open and behaves as today for a member
    expect(await detailActions(tokens.buyer, fx.bare)).toEqual(TODAY_MEMBER);
    expect((await listActions(tokens.buyer)).get(fx.bare)).toEqual(TODAY_MEMBER);
  });
});
