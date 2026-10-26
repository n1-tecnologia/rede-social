import { sqlClient } from '@rede-social/core/db';
import type { CommunitySummary } from '@rede-social/module-communities/contracts';
import type { FeedPage, FeedPost } from '@rede-social/module-feed/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs, withStoreEnabled } from './setup';

/**
 * A deleted community's publications leave the feed, end to end against the live local stack and the
 * real seed (09.3-06, PEND-05, PEND-13, D-555, D-556): after an admin archives and deletes a community
 * through `DELETE /v1/communities/{id}` its posts are gone from Início, Reels and the post page, the
 * link answers the bare 404 (never 403), and every row stays in the database.
 *
 * The two layers under test are written side by side in the feed module: the service predicate
 * (`c.deleted_at is null` in the WHERE of `feedPage` and `getPost`, never in the ON of the join) and
 * the RESTRICTIVE policy `feed_posts_deleted_community_gate` that makes a route finding a post by id
 * alone, or a comment-id route that relies on RLS alone, fail closed.
 *
 * Every community this file writes carries `COMMUNITY_PREFIX`, every post `CAPTION_PREFIX`, every
 * product `PRODUCT_PREFIX`, so both hooks sweep exactly this file's rows. Test ORDER is load-bearing
 * (`fileParallelism: false`, declaration order).
 */

type Envelope = {
  error: { code: string; message?: string; details?: unknown; requestId?: string };
};

const tokens = { demoAdmin: '', demoMember: '' };
const tenantIds = { demo: '' };

const COMMUNITY_PREFIX = 'Comunidade do feed exclusao';
const CAPTION_PREFIX = 'Teste feed exclusao';
const PRODUCT_PREFIX = 'Produto do feed exclusao';

const createdAssets: string[] = [];
const createdProducts: string[] = [];
let restoreStore: () => Promise<void> = async () => {};
let counter = 0;
const communityName = (suffix: string) => `${COMMUNITY_PREFIX} ${suffix} ${++counter}`;
const caption = (suffix: string) => `${CAPTION_PREFIX} ${suffix} ${++counter}`;

const request = (path: string, token?: string, init: RequestInit = {}) =>
  api.request(path, {
    ...init,
    headers: {
      'x-tenant-host': HOSTS.demo,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });

const send = (method: string, path: string, token: string, body?: unknown) =>
  request(path, token, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** Asserts the bare 404: the `NOT_FOUND` code and no `details` key (D-23), never a 403. */
async function expectBare404(res: Response, label: string): Promise<void> {
  const raw = await res.clone().text();
  expect(res.status, `${label}: ${raw}`).toBe(404);
  const error = ((await res.json()) as Envelope).error;
  expect(error.code, label).toBe('NOT_FOUND');
  expect(Object.hasOwn(error, 'details'), label).toBe(false);
}

async function createCommunity(name = communityName('x')): Promise<CommunitySummary> {
  const res = await send('POST', '/v1/communities', tokens.demoAdmin, {
    name,
    description: 'Descricao da comunidade',
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as CommunitySummary;
}

async function archiveCommunity(communityId: string): Promise<void> {
  const res = await send('PATCH', `/v1/communities/${communityId}`, tokens.demoAdmin, {
    status: 'archived',
  });
  expect(res.status, await res.clone().text()).toBe(200);
}

async function deleteCommunity(communityId: string): Promise<void> {
  const res = await send('DELETE', `/v1/communities/${communityId}`, tokens.demoAdmin);
  expect(res.status, await res.clone().text()).toBe(204);
}

/** Archives, then deletes: the only way a community leaves (D-553). */
async function archiveAndDelete(communityId: string): Promise<void> {
  await archiveCommunity(communityId);
  await deleteCommunity(communityId);
}

/** A post through the real route as the demo admin. */
async function publish(body: {
  caption: string;
  communityId?: string;
  videoAssetId?: string;
}): Promise<FeedPost> {
  const res = await send('POST', '/v1/feed/posts', tokens.demoAdmin, body);
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as FeedPost;
}

/** A READY portrait video asset row (the `fake` provider, the reels.test.ts technique). */
async function readyVideoAsset(): Promise<string> {
  const rows = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, playback_id,
       mime, bytes, width, height, duration_seconds, aspect_ratio, filename, ready_at)
    select ${tenantIds.demo}::uuid, u.id, 'video', 'post', 'ready', 'fake',
           ${`fake-${crypto.randomUUID()}`}, ${`pb-${crypto.randomUUID()}`},
           'video/mp4', 1048576, 1080, 1920, 15, '9:16', 'reel.mp4', now()
      from public.users u where u.email = 'admin@rede-demo.local'
    returning id`;
  const id = rows[0]?.id;
  if (!id) throw new Error('could not seed a video asset for the demo admin');
  createdAssets.push(id);
  return id;
}

/** Walks a feed list to its end (bounded), in the server's own order. */
async function walk(query: string, token: string): Promise<FeedPost[]> {
  const seen: FeedPost[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 500; guard += 1) {
    const sep = query.includes('?') ? '&' : '?';
    const path: string = cursor ? `${query}${sep}cursor=${encodeURIComponent(cursor)}` : query;
    const res = await request(path, token);
    expect(res.status, `GET ${path} -> ${res.status}`).toBe(200);
    const page = (await res.json()) as FeedPage;
    seen.push(...page.items);
    cursor = page.nextCursor;
    if (cursor === null) return seen;
  }
  throw new Error(`walk(${query}) did not reach the end in 500 pages`);
}

const inicio = (token: string) => walk('/v1/feed?limit=25', token);

/** Every row the delete must leave alone, as one comparable value (D-556). */
async function snapshotOf(postIds: string[]): Promise<string> {
  const posts = await adminSql`
    select id::text, community_id::text, caption, like_count, comment_count, deleted_at::text
      from public.feed_posts where id = any(${postIds}::uuid[]) order by id`;
  const comments = await adminSql`
    select id::text, post_id::text, like_count, deleted_at::text
      from public.feed_comments where post_id = any(${postIds}::uuid[]) order by id`;
  const likes = await adminSql`
    select id::text, post_id::text, comment_id::text, user_id::text
      from public.feed_likes
     where post_id = any(${postIds}::uuid[])
        or comment_id in (select id from public.feed_comments where post_id = any(${postIds}::uuid[]))
     order by id`;
  const media = await adminSql`
    select post_id::text, media_asset_id::text, position
      from public.feed_post_media where post_id = any(${postIds}::uuid[])
     order by post_id, position`;
  return JSON.stringify({ posts, comments, likes, media });
}

async function sweep(): Promise<void> {
  const posts = await adminSql<{ id: string }[]>`
    select id::text as id from public.feed_posts where caption like ${`${CAPTION_PREFIX}%`}`;
  const postIds = posts.map((row) => row.id);
  if (postIds.length > 0) {
    await adminSql`delete from public.feed_likes where post_id = any(${postIds}::uuid[])`;
    await adminSql`delete from public.feed_comments where post_id = any(${postIds}::uuid[])`;
    await adminSql`delete from public.feed_post_media where post_id = any(${postIds}::uuid[])`;
    await adminSql`delete from public.feed_posts where id = any(${postIds}::uuid[])`;
  }
  const communities = await adminSql<{ id: string }[]>`
    select id::text as id from public.communities where name like ${`${COMMUNITY_PREFIX}%`}`;
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
  }
  if (productIds.length > 0) {
    await adminSql`delete from public.store_products where id = any(${productIds}::uuid[])`;
  }
  await adminSql`delete from public.communities where name like ${`${COMMUNITY_PREFIX}%`}`;
  if (createdAssets.length > 0) {
    await adminSql`delete from public.media_assets where id = any(${createdAssets}::uuid[])`;
    createdAssets.length = 0;
  }
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  const [row] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-demo'`;
  tenantIds.demo = row?.id ?? '';
  if (!tenantIds.demo) throw new Error('the seed tenant rede-demo is not seeded');
  await sweep();
  restoreStore = await withStoreEnabled('demo');
});

afterAll(async () => {
  await restoreStore();
  await sweep();
  await adminSql.end();
  await sqlClient.end();
});

describe('a deleted community leaves the feed (D-555, D-556)', () => {
  it('1. tracer (Início, Reels, post page): the posts vanish, the others stay, nothing is erased', async () => {
    const k = await createCommunity(communityName('tracer K'));
    const l = await createCommunity(communityName('tracer L'));
    const k1 = await publish({ caption: caption('t1 K um'), communityId: k.id });
    const k2 = await publish({ caption: caption('t1 K dois'), communityId: k.id });
    const kv = await publish({
      caption: caption('t1 K video'),
      communityId: k.id,
      videoAssetId: await readyVideoAsset(),
    });
    const org = await publish({ caption: caption('t1 organizacao') });
    const live = await publish({ caption: caption('t1 L viva'), communityId: l.id });
    const kIds = [k1.id, k2.id, kv.id];

    // A member's like and comment on K's post, so the rows the delete must leave alone are not empty.
    expect((await send('POST', `/v1/feed/posts/${k1.id}/like`, tokens.demoMember)).status).toBe(
      200,
    );
    const commented = await send('POST', `/v1/feed/posts/${k1.id}/comments`, tokens.demoMember, {
      body: `${CAPTION_PREFIX} comentario`,
    });
    expect(commented.status, await commented.clone().text()).toBe(201);

    // Positive controls: before the delete everything is listed and readable.
    for (const token of [tokens.demoMember, tokens.demoAdmin]) {
      const ids = (await inicio(token)).map((item) => item.id);
      for (const id of [...kIds, org.id, live.id]) expect(ids, id).toContain(id);
      const reels = (await walk('/v1/feed?media=video&limit=25', token)).map((item) => item.id);
      expect(reels).toContain(kv.id);
      expect((await request(`/v1/feed/posts/${k1.id}`, token)).status).toBe(200);
    }
    const before = await snapshotOf(kIds);
    expect(JSON.parse(before).likes.length).toBeGreaterThan(0);
    expect(JSON.parse(before).comments.length).toBeGreaterThan(0);
    expect(JSON.parse(before).media.length).toBeGreaterThan(0);

    await archiveAndDelete(k.id);

    for (const [who, token] of [
      ['member', tokens.demoMember],
      ['admin', tokens.demoAdmin],
    ] as const) {
      const items = await inicio(token);
      const ids = items.map((item) => item.id);
      for (const id of kIds) expect(ids, `${who} Início ${id}`).not.toContain(id);
      expect(ids, `${who} keeps the organisation post`).toContain(org.id);
      expect(ids, `${who} keeps the live community post`).toContain(live.id);
      // The ON-clause trap: the post must not come back re-labelled as a community-less one.
      expect(
        items.filter((item) => item.caption.startsWith(`${CAPTION_PREFIX} t1 K`)),
        `${who} Início shows no caption of the deleted community`,
      ).toEqual([]);
      const orgItem = items.find((item) => item.id === org.id);
      expect(orgItem?.communityId).toBeNull();
      expect(items.find((item) => item.id === live.id)?.communityId).toBe(l.id);

      const reels = (await walk('/v1/feed?media=video&limit=25', token)).map((item) => item.id);
      expect(reels, `${who} Reels`).not.toContain(kv.id);

      for (const id of kIds) {
        await expectBare404(await request(`/v1/feed/posts/${id}`, token), `${who} post page ${id}`);
      }
      expect((await request(`/v1/feed/posts/${org.id}`, token)).status).toBe(200);
      expect((await request(`/v1/feed/posts/${live.id}`, token)).status).toBe(200);
    }

    // D-556: nothing erased, nothing recounted.
    expect(await snapshotOf(kIds)).toBe(before);
  });

  it('2. an archived product still locks it: 404, not 403', async () => {
    const k2 = await createCommunity(communityName('locked K2'));
    const older = await publish({ caption: caption('t2 K2 antiga'), communityId: k2.id });
    const newer = await publish({ caption: caption('t2 K2 nova'), communityId: k2.id });

    const created = await send('POST', '/v1/store/products', tokens.demoAdmin, {
      name: `${PRODUCT_PREFIX} ${++counter}`,
      priceCents: 990,
      communityIds: [k2.id],
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const product = (await created.json()) as { id: string };
    createdProducts.push(product.id);

    // Positive control: with the product active and no entitlement, the OLDER post is hidden and the
    // NEWER one is the sample; the older one answers 403 community_locked.
    const locked = await request(`/v1/feed/posts/${older.id}`, tokens.demoMember);
    expect(locked.status, await locked.clone().text()).toBe(403);
    expect(((await locked.json()) as Envelope).error.details).toEqual({
      access: 'community_locked',
      communityId: k2.id,
    });
    expect((await request(`/v1/feed/posts/${newer.id}`, tokens.demoMember)).status).toBe(200);

    // Archive the product (its link stays), archive the community, delete it: archived products do
    // not block a delete.
    const archivedProduct = await send(
      'PUT',
      `/v1/store/products/${product.id}/status`,
      tokens.demoAdmin,
      { status: 'archived' },
    );
    expect(archivedProduct.status, await archivedProduct.clone().text()).toBe(200);
    await archiveAndDelete(k2.id);

    const [link] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.store_product_communities
       where community_id = ${k2.id}::uuid`;
    expect(link?.n, 'the archived product still links the deleted community').toBe(1);

    for (const id of [older.id, newer.id]) {
      await expectBare404(
        await request(`/v1/feed/posts/${id}`, tokens.demoMember),
        `member post page ${id}`,
      );
    }
  });

  it('3. the policy exists: restrictive, select', async () => {
    const rows = await adminSql<{ permissive: string; cmd: string; roles: string }[]>`
      select permissive, cmd, roles::text as roles
        from pg_policies
       where schemaname = 'public' and tablename = 'feed_posts'
         and policyname = 'feed_posts_deleted_community_gate'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.permissive).toBe('RESTRICTIVE');
    expect(rows[0]?.cmd).toBe('SELECT');
    expect(rows[0]?.roles).toContain('authenticated');
  });
});
