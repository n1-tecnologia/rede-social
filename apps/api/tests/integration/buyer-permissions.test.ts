import { sqlClient } from '@rede-social/core/db';
import type { FeedPage, FeedPost } from '@rede-social/module-feed/contracts';
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
} from './setup';

/**
 * 11.1-02 (D-880, D-881, D-882, D-886, D-891; BPERM-09, BPERM-02): the tracer of Phase 11.1 against the live local
 * stack and the real seed. ONE buyer, ONE product linked to an ORGANIZATION community with `can_post`, ONE post
 * through the real route `POST /v1/feed/posts`, and the refusal of the same buyer once the flag is off.
 *
 * Fixture (built in `beforeAll`, every name and caption prefixed `bp-<run>`): in `rede-demo` with `store` and
 * `social` ON, an organization community made by the seed admin, a product linked to it, two throwaway members of
 * rede-demo (the buyer who holds the product and a reader who does not hold it). The product is bought through the
 * real purchase route, so the entitlement is the one the app writes. The link's flags are written by SQL (the product
 * form that writes them is a later plan of the phase).
 *
 * Test ORDER inside the describe is load-bearing (declaration order).
 */

type Envelope = { error: { code: string; message?: string; details?: Record<string, unknown> } };

const RUN = Date.now();
const PREFIX = `bp-${RUN}`;

const tokens = { admin: '', buyer: '', reader: '' };
const users = { buyer: '', reader: '' };
let tenantId = '';
let restoreStore: () => Promise<void> = async () => {};
let restoreSocial: () => Promise<void> = async () => {};
const fx = { community: '', product: '' };

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
  await adminSql`delete from public.feed_posts where caption like ${`${PREFIX}%`}`;
  await adminSql`delete from public.store_entitlements where product_id in (${products})`;
  await adminSql`delete from public.store_orders where product_id in (${products})`;
  await adminSql`delete from public.store_products where name like ${`${PREFIX}%`}`;
  const communities = adminSql`select id from public.communities where name like ${`${PREFIX}%`}`;
  await adminSql`delete from public.feed_posts where community_id in (${communities})`;
  await adminSql`delete from public.communities where name like ${`${PREFIX}%`}`;
  await removeIdentitiesByPrefix(PREFIX);
}

const setFlags = (flags: { canPost: boolean }) =>
  adminSql`
    update public.store_product_communities set can_post = ${flags.canPost}
     where product_id = ${fx.product}::uuid and community_id = ${fx.community}::uuid`;

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  await sweep();
  restoreStore = await withStoreEnabled('demo');
  restoreSocial = await withSocialEnabled('demo');
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

  const community = await post('/v1/communities', tokens.admin, { name: `${PREFIX} loja` });
  expect(community.status).toBe(201);
  fx.community = ((await community.json()) as { id: string }).id;
  const product = await post('/v1/store/products', tokens.admin, {
    name: `${PREFIX} produto`,
    priceCents: 1990,
    communityIds: [fx.community],
  });
  expect(product.status).toBe(201);
  fx.product = ((await product.json()) as ProductDetail).id;
  const bought = await post(`/v1/store/products/${fx.product}/purchase`, tokens.buyer, {
    expectedAmountCents: 1990,
  });
  expect(bought.status, `purchase -> ${bought.status}`).toBe(200);
});

afterAll(async () => {
  await sweep();
  await restoreSocial();
  await restoreStore();
  await adminSql.end();
  await sqlClient.end();
});

describe('11.1 tracer: a buyer publishes into an organization community', () => {
  const made: { post?: FeedPost } = {};

  it('1. D-890/D-891: a link written without any flag reads the defaults: like, comment, share on, post and story off', async () => {
    const [row] = await adminSql<
      {
        can_like: boolean;
        can_comment: boolean;
        can_share: boolean;
        can_post: boolean;
        can_story: boolean;
      }[]
    >`select can_like, can_comment, can_share, can_post, can_story
        from public.store_product_communities
       where product_id = ${fx.product}::uuid and community_id = ${fx.community}::uuid`;
    expect(row).toEqual({
      can_like: true,
      can_comment: true,
      can_share: true,
      can_post: false,
      can_story: false,
    });
  });

  it('2. D-880/D-888: with can_post off the buyer is a bare 403 (no details) and nothing is stored', async () => {
    const res = await post('/v1/feed/posts', tokens.buyer, {
      caption: `${PREFIX} sem permissao`,
      communityId: fx.community,
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error).not.toHaveProperty('details');
    const rows = await adminSql`
      select 1 from public.feed_posts where caption = ${`${PREFIX} sem permissao`}`;
    expect(rows).toHaveLength(0);
  });

  it('3. D-880/D-881 TRACER: with can_post on the buyer publishes: 201, stored visibility community, in the organization community', async () => {
    await setFlags({ canPost: true });
    const res = await post('/v1/feed/posts', tokens.buyer, {
      caption: `${PREFIX} do comprador`,
      communityId: fx.community,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    made.post = (await res.json()) as FeedPost;
    expect(made.post.communityId).toBe(fx.community);
    const [row] = await adminSql<
      { visibility: string; community_id: string; author_user_id: string }[]
    >`select visibility, community_id, author_user_id from public.feed_posts where id = ${made.post.id}::uuid`;
    expect(row?.visibility).toBe('community');
    expect(row?.community_id).toBe(fx.community);
    expect(row?.author_user_id).toBe(users.buyer);
  });

  it('4. D-881: another member who can read the community reads the buyer post where the community posts are listed', async () => {
    // the reader bought nothing, so first give the reader the same product: access follows the entitlement
    const bought = await post(`/v1/store/products/${fx.product}/purchase`, tokens.reader, {
      expectedAmountCents: 1990,
    });
    expect(bought.status, `purchase -> ${bought.status}`).toBe(200);
    const res = await request(`/v1/feed?communityId=${fx.community}&limit=25`, tokens.reader);
    expect(res.status, await res.clone().text()).toBe(200);
    const page = (await res.json()) as FeedPage;
    expect(page.items.map((item) => item.id)).toContain(made.post?.id);
  });

  it('5. D-881: the buyer post does not reach Inicio (the merged feed carries organization and followed posts only)', async () => {
    const res = await request('/v1/feed?limit=25', tokens.reader);
    expect(res.status).toBe(200);
    const page = (await res.json()) as FeedPage;
    expect(page.items.map((item) => item.id)).not.toContain(made.post?.id);
  });

  it('6. D-888: flipping can_post off again turns the same buyer back into the bare 403', async () => {
    await setFlags({ canPost: false });
    const res = await post('/v1/feed/posts', tokens.buyer, {
      caption: `${PREFIX} depois da flag`,
      communityId: fx.community,
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as Envelope).error).not.toHaveProperty('details');
  });

  it('7. D-882: the database gate backs the service: a direct insert as the buyer with can_post off is refused', async () => {
    // the same refusal as case 6, asked of Postgres alone (no service in between), through the buyer's own claims
    const refused = await adminSql
      .begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({
          sub: users.buyer,
          role: 'authenticated',
          tenant_id: tenantId,
          tenant_role: 'member',
        })}, true)`;
        await tx`set local role authenticated`;
        await tx`
          insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
          values (${tenantId}::uuid, ${users.buyer}::uuid, ${`${PREFIX} direto`}, 'community', ${fx.community}::uuid)`;
        return 'inserted';
      })
      .catch((error: { code?: string }) => error.code ?? 'error');
    expect(refused).toBe('42501');
  });

  it('8. D-886/D-892 positive sibling of member-communities case 8: through the buyer\'s own claims the function answers true for post only while the flag is on, and never for story or openHighlight', async () => {
    const answers = async () =>
      adminSql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({
          sub: users.buyer,
          role: 'authenticated',
          tenant_id: tenantId,
          tenant_role: 'member',
        })}, true)`;
        await tx`set local role authenticated`;
        const [row] = await tx<{ post: boolean; story: boolean; open: boolean; like: boolean }[]>`
          select app.community_action_allowed(${fx.community}::uuid, 'post') as post,
                 app.community_action_allowed(${fx.community}::uuid, 'story') as story,
                 app.community_action_allowed(${fx.community}::uuid, 'openHighlight') as open,
                 app.community_action_allowed(${fx.community}::uuid, 'like') as "like"`;
        return row;
      });
    await setFlags({ canPost: true });
    expect(await answers()).toEqual({ post: true, story: false, open: false, like: true });
    await setFlags({ canPost: false });
    expect(await answers()).toEqual({ post: false, story: false, open: false, like: true });
  });
});
