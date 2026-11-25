import { sqlClient } from '@rede-social/core/db';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
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

const setEntitlement = (product: string, status: 'active' | 'revoked', user = users.buyer) =>
  adminSql`
    update public.store_entitlements set status = ${status}
     where product_id = ${product}::uuid and user_id = ${user}::uuid`;

/** Runs `fn` with a demo module switched to `enabled`, then writes the module back ON (the fixture runs with all three on). */
async function withModule<T>(
  key: 'store' | 'social',
  enabled: boolean,
  fn: () => Promise<T>,
): Promise<T> {
  const set = async (value: boolean) => {
    await adminSql`
      update public.tenant_modules set enabled = ${value}, updated_at = now()
       where tenant_id = ${tenantId}::uuid and module_key = ${key}`;
    moduleFlags.invalidate(tenantId);
  };
  await set(enabled);
  try {
    return await fn();
  } finally {
    await set(true);
  }
}

/** A highlight of an organization community, written through the owner connection (the open switch has no route yet). */
async function makeHighlight(community: string, open: boolean): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.story_highlights (tenant_id, community_id, title, position, created_by_user_id, open_to_buyers)
    select ${tenantId}::uuid, ${community}::uuid, ${`${PREFIX} destaque`}, 0, u.id, ${open}
      from public.users u where u.email = 'admin@rede-demo.local'
    returning id::text as id`;
  return row?.id ?? '';
}

const clearHighlights = () =>
  adminSql`
    delete from public.story_highlights
     where tenant_id = ${tenantId}::uuid and title = ${`${PREFIX} destaque`}`;

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

describe('11.1-07 matrix: two products, social off, the open highlight, revoke, other tenant, list order', () => {
  beforeAll(async () => {
    fx.productB = await createProduct('produto B', [fx.main]);
    await buy(fx.productB, tokens.buyer);
  });

  it('a. D-886: two products on one community give the union: like from one, post from the other, the rest false', async () => {
    await setFlags(fx.productA, fx.main, { like: true, comment: false, share: false });
    await setFlags(fx.productB, fx.main, { like: false, comment: false, share: false, post: true });
    const union: Actions = { like: true, comment: false, share: false, post: true, story: false };
    expect(await detailActions(tokens.buyer, fx.main)).toEqual(union);
    expect((await listActions(tokens.buyer)).get(fx.main)).toEqual(union);
    // adjacency: two products with equal flags give the same actions as one
    await setFlags(fx.productB, fx.main, { like: true, comment: false, share: false, post: false });
    await setFlags(fx.productA, fx.main, { like: true, comment: false, share: false, post: false });
    const same: Actions = { like: true, comment: false, share: false, post: false, story: false };
    expect(await detailActions(tokens.buyer, fx.main)).toEqual(same);
    await setEntitlement(fx.productB, 'revoked');
    expect(await detailActions(tokens.buyer, fx.main)).toEqual(same);
    await setEntitlement(fx.productB, 'active');
  });

  it('b. D-882/D-718: with social off post and story are false whatever is ticked, like comment and share still follow the flags, and social back on restores them', async () => {
    await setFlags(fx.productA, fx.main, {
      like: false,
      comment: true,
      share: true,
      post: true,
      story: true,
    });
    await setFlags(fx.productB, fx.main, { like: false, comment: false, share: false });
    const highlight = await makeHighlight(fx.main, true);
    expect(highlight).not.toBe('');
    const full: Actions = { like: false, comment: true, share: true, post: true, story: true };
    expect(await detailActions(tokens.buyer, fx.main)).toEqual(full);
    await withModule('social', false, async () => {
      expect(await detailActions(tokens.buyer, fx.main)).toEqual({
        like: false,
        comment: true,
        share: true,
        post: false,
        story: false,
      });
      expect((await listActions(tokens.buyer)).get(fx.main)).toEqual({
        like: false,
        comment: true,
        share: true,
        post: false,
        story: false,
      });
    });
    expect(await detailActions(tokens.buyer, fx.main)).toEqual(full);
    // reading the community is unchanged: the same row, not a different error
    await clearHighlights();
  });

  it('c. UI-D-888: story is false with no highlight open, true with one open highlight of THAT community, false when the only open one belongs to another, false again once closed', async () => {
    await setFlags(fx.productA, fx.main, { like: true, comment: true, share: true, story: true });
    await setFlags(fx.productB, fx.main, { like: true, comment: true, share: true });
    await clearHighlights();
    expect((await detailActions(tokens.buyer, fx.main)).story).toBe(false);
    // a closed highlight does not count
    const closed = await makeHighlight(fx.main, false);
    expect((await detailActions(tokens.buyer, fx.main)).story).toBe(false);
    // an open highlight of ANOTHER community does not count
    await makeHighlight(fx.other, true);
    expect((await detailActions(tokens.buyer, fx.main)).story).toBe(false);
    // the highlight of THIS community, opened, does
    await adminSql`update public.story_highlights set open_to_buyers = true where id = ${closed}::uuid`;
    expect((await detailActions(tokens.buyer, fx.main)).story).toBe(true);
    expect((await listActions(tokens.buyer)).get(fx.main)?.story).toBe(true);
    // and the flag still decides: an open highlight with the flag off is no door
    await setFlags(fx.productA, fx.main, { story: false });
    expect((await detailActions(tokens.buyer, fx.main)).story).toBe(false);
    await setFlags(fx.productA, fx.main, { story: true });
    // closed again: false
    await adminSql`update public.story_highlights set open_to_buyers = false where id = ${closed}::uuid`;
    expect((await detailActions(tokens.buyer, fx.main)).story).toBe(false);
    await clearHighlights();
  });

  it('d. D-887: a revoked entitlement removes the buyer actions at the next request, and a new active one brings them back', async () => {
    await setFlags(fx.productA, fx.main, {
      like: false,
      comment: true,
      share: true,
      post: true,
      story: true,
    });
    await setFlags(fx.productB, fx.main, { like: false, comment: false, share: false });
    await makeHighlight(fx.main, true);
    const full: Actions = { like: false, comment: true, share: true, post: true, story: true };
    expect(await detailActions(tokens.buyer, fx.main)).toEqual(full);
    await setEntitlement(fx.productA, 'revoked');
    await setEntitlement(fx.productB, 'revoked');
    const after = await request(`/v1/communities/${fx.main}`, tokens.buyer);
    if (after.status === 200) {
      const actions = ((await after.json()) as CommunitySummary).viewer.actions;
      expect(actions.post).toBe(false);
      expect(actions.story).toBe(false);
      expect(actions).toEqual(TODAY_MEMBER);
    }
    await setEntitlement(fx.productA, 'active');
    await setEntitlement(fx.productB, 'active');
    expect(await detailActions(tokens.buyer, fx.main)).toEqual(full);
    await clearHighlights();
  });

  it('e. BPERM-25: the same user with a membership in tenant B reads only tenant B values under tenant B claim, never tenant A flags', async () => {
    const dual = await createSharedIdentity({
      prefix: PREFIX,
      memberships: [{ host: 'demo' }, { host: 'lab' }],
    });
    const demoToken = await signInAs(dual.email, dual.password);
    await buy(fx.productA, demoToken);
    await setFlags(fx.productA, fx.main, { like: false, comment: true, share: false, post: true });
    await setFlags(fx.productB, fx.main, { like: false, comment: false, share: false });
    // positive control: under tenant A the buyer actions are there
    expect(await detailActions(demoToken, fx.main)).toEqual({
      like: false,
      comment: true,
      share: false,
      post: true,
      story: false,
    });
    // under tenant B the same person never reads tenant A community, and every community of B reads B's own values
    const labRequest = (path: string) =>
      api.request(path, {
        headers: { 'x-tenant-host': HOSTS.lab, authorization: `Bearer ${demoToken}` },
      });
    const detail = await labRequest(`/v1/communities/${fx.main}`);
    expect(detail.status).toBe(404);
    const list = await labRequest('/v1/communities?limit=25');
    if (list.status === 200) {
      const page = (await list.json()) as CommunityPage;
      expect(page.items.map((item) => item.id)).not.toContain(fx.main);
      for (const item of page.items) {
        // tenant B holds no product link for this person: today's values for an organization community
        if (item.kind === 'organization') expect(item.viewer.actions).toEqual(TODAY_MEMBER);
      }
    }
  });

  it('f. BPERM-15 ordering: each row reads its own scope key, so listing in two orders leaves every row actions equal', async () => {
    await setFlags(fx.productA, fx.main, { like: false, comment: true, share: false, post: true });
    await setFlags(fx.productB, fx.main, { like: false, comment: false, share: false });
    await setFlags(fx.productOther, fx.other, {
      like: true,
      comment: false,
      share: true,
      post: false,
    });
    await buy(fx.productOther, tokens.buyer);
    const order = (main: number, other: number, bare: number) =>
      adminSql`
        update public.communities set position = case id
          when ${fx.main}::uuid then ${main}::int
          when ${fx.other}::uuid then ${other}::int
          else ${bare}::int end
        where id in (${fx.main}::uuid, ${fx.other}::uuid, ${fx.bare}::uuid)`;
    await order(1, 2, 3);
    const first = await request('/v1/communities?limit=25', tokens.buyer);
    const firstItems = ((await first.json()) as CommunityPage).items;
    await order(3, 2, 1);
    const second = await request('/v1/communities?limit=25', tokens.buyer);
    const secondItems = ((await second.json()) as CommunityPage).items;
    const ids = (items: CommunitySummary[]) =>
      items.filter((i) => [fx.main, fx.other, fx.bare].includes(i.id)).map((i) => i.id);
    expect(ids(firstItems)).toEqual([fx.main, fx.other, fx.bare]);
    expect(ids(secondItems)).toEqual([fx.bare, fx.other, fx.main]);
    const byId = (items: CommunitySummary[]) =>
      new Map(items.map((item) => [item.id, item.viewer.actions]));
    for (const id of [fx.main, fx.other, fx.bare]) {
      expect(byId(firstItems).get(id), id).toEqual(byId(secondItems).get(id));
    }
    expect(byId(firstItems).get(fx.main)).toEqual({
      like: false,
      comment: true,
      share: false,
      post: true,
      story: false,
    });
    expect(byId(firstItems).get(fx.other)).toEqual({
      like: true,
      comment: false,
      share: true,
      post: false,
      story: false,
    });
    expect(byId(firstItems).get(fx.bare)).toEqual(TODAY_MEMBER);
    // an empty list stays empty: the buyer owns no archived community, so the own-only archived list is empty
    const archived = await request('/v1/communities?status=archived&limit=25', tokens.buyer);
    expect(archived.status).toBe(200);
    const archivedItems = ((await archived.json()) as CommunityPage).items.filter((i) =>
      i.name.startsWith(PREFIX),
    );
    expect(archivedItems).toEqual([]);
  });

  it('g. D-892 / BPERM-15 empty: a member-created community, a community whose store module is off, and a staff viewer read what they read before', async () => {
    await setFlags(fx.productA, fx.main, {
      like: false,
      comment: false,
      share: false,
      post: true,
      story: true,
    });
    await setFlags(fx.productB, fx.main, { like: false, comment: false, share: false });
    // a member-created community: no product can link it, so the buyer flags never apply
    const made = await post('/v1/communities', tokens.buyer, { name: `${PREFIX} do membro` });
    expect(made.status, await made.clone().text()).toBe(201);
    fx.memberMade = ((await made.json()) as { id: string }).id;
    expect(await detailActions(tokens.buyer, fx.memberMade)).toEqual(ALL_TRUE);
    // store off: the link exists but the scope is empty, so the buyer reads what any member reads
    await withModule('store', false, async () => {
      expect(await detailActions(tokens.buyer, fx.main)).toEqual(TODAY_MEMBER);
      expect((await listActions(tokens.buyer)).get(fx.main)).toEqual(TODAY_MEMBER);
    });
    // back on: the buyer scope returns
    expect((await detailActions(tokens.buyer, fx.main)).post).toBe(true);
    // staff holds every action regardless of the ticks
    expect(await detailActions(tokens.admin, fx.main)).toEqual(ALL_TRUE);
    // an archived organization community is still read, but the server refuses a post or a story into it, so the
    // buyer is not offered either (the ticks below would otherwise say yes); like, comment and share follow the flags
    await setFlags(fx.productOther, fx.other, {
      like: true,
      comment: true,
      share: true,
      post: true,
      story: true,
    });
    await makeHighlight(fx.other, true);
    expect(await detailActions(tokens.buyer, fx.other)).toEqual(ALL_TRUE);
    await adminSql`update public.communities set status = 'archived' where id = ${fx.other}::uuid`;
    const archivedRead = await request(`/v1/communities/${fx.other}`, tokens.buyer);
    expect(archivedRead.status).toBe(200);
    expect(((await archivedRead.json()) as CommunitySummary).viewer.actions).toEqual({
      like: true,
      comment: true,
      share: true,
      post: false,
      story: false,
    });
    await adminSql`update public.communities set status = 'active' where id = ${fx.other}::uuid`;
    await clearHighlights();
  });

  it('h. T-11.1-24 / BPERM-27: no community body carries a flag name, the scope, an open-highlight fact or a product id, and the viewer keeps its five strict booleans', async () => {
    await setFlags(fx.productA, fx.main, {
      like: true,
      comment: true,
      share: true,
      post: true,
      story: true,
    });
    await makeHighlight(fx.main, true);
    const bodies = [
      await (await request(`/v1/communities/${fx.main}`, tokens.buyer)).text(),
      await (await request('/v1/communities?limit=25', tokens.buyer)).text(),
    ];
    for (const body of bodies) {
      for (const needle of [
        'can_like',
        'can_comment',
        'can_post',
        'can_story',
        'canLike',
        'canPost',
        'buyer_scope',
        'buyerScope',
        'openHighlight',
        'open_to_buyers',
        fx.productA,
        fx.productB,
        fx.productOther,
      ]) {
        expect(body.includes(needle), needle).toBe(false);
      }
    }
    const detail = JSON.parse(bodies[0] ?? '{}') as CommunitySummary;
    expect(Object.keys(detail.viewer.actions).sort()).toEqual([
      'comment',
      'like',
      'post',
      'share',
      'story',
    ]);
    for (const value of Object.values(detail.viewer.actions)) expect(typeof value).toBe('boolean');
    await clearHighlights();
  });
});

/** The community module's own tables, the pattern `feed-query-budget.test.ts` counts the community list with. */
const COMMUNITY_TABLES_PATTERN = 'communit(ies|y_members)';

describe('11.1-07 budget: the buyer column adds no statement to the community list or detail', () => {
  /** Statements that touch the community tables while ONE request is served, counted by `pg_stat_statements`. */
  async function statementsOf(path: string, token: string): Promise<number> {
    await adminSql`select pg_stat_statements_reset()`;
    const res = await request(path, token);
    expect(res.status, await res.clone().text()).toBe(200);
    const [measured] = await adminSql<{ calls: number }[]>`
      select coalesce(sum(calls), 0)::int as calls
        from pg_stat_statements
       where query ~ ${COMMUNITY_TABLES_PATTERN}`;
    return measured?.calls ?? 0;
  }

  it('i. T-11.1-26: a buyer, a staff viewer and a member with no entitlement cost the same number of community statements, on the list and on the detail', async () => {
    await setFlags(fx.productA, fx.main, {
      like: true,
      comment: true,
      share: true,
      post: true,
      story: true,
    });
    await setFlags(fx.productB, fx.main, { like: true, comment: true, share: true });
    // positive control: the buyer really reads a buyer entry in this request (the column is evaluated, not skipped)
    expect((await detailActions(tokens.buyer, fx.main)).post).toBe(true);
    const list = '/v1/communities?limit=25';
    const detail = `/v1/communities/${fx.main}`;
    const listCalls = {
      buyer: await statementsOf(list, tokens.buyer),
      staff: await statementsOf(list, tokens.admin),
      plain: await statementsOf(list, tokens.reader),
    };
    const detailCalls = {
      buyer: await statementsOf(detail, tokens.buyer),
      staff: await statementsOf(detail, tokens.admin),
      plain: await statementsOf(detail, tokens.reader),
    };
    // bidirectional: a zero would mean the pattern matched nothing, not that the page got cheaper
    expect(listCalls.buyer).toBeGreaterThan(0);
    expect(detailCalls.buyer).toBeGreaterThan(0);
    expect(listCalls.buyer).toBe(listCalls.staff);
    expect(listCalls.buyer).toBe(listCalls.plain);
    expect(detailCalls.buyer).toBe(detailCalls.staff);
    expect(detailCalls.buyer).toBe(detailCalls.plain);
    // and the list is the one statement the 05-01 budget holds it to
    expect(listCalls.buyer).toBeLessThanOrEqual(1);
  });
});
