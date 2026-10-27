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

  it('4. every route that takes a post or comment id answers the bare 404, rows and counters stay', async () => {
    const k = await createCommunity(communityName('rotas K'));
    const p = await publish({ caption: caption('t4 K post'), communityId: k.id });
    const asMember = async (path: string, init: RequestInit = {}) =>
      request(path, tokens.demoMember, init);
    const json = (body: unknown) => ({ body: JSON.stringify(body) });

    const rootRes = await asMember(`/v1/feed/posts/${p.id}/comments`, {
      method: 'POST',
      ...json({ body: `${CAPTION_PREFIX} raiz` }),
    });
    expect(rootRes.status, await rootRes.clone().text()).toBe(201);
    const c1 = (await rootRes.json()) as { id: string };
    const replyRes = await asMember(`/v1/feed/posts/${p.id}/comments`, {
      method: 'POST',
      ...json({ body: `${CAPTION_PREFIX} resposta`, parentId: c1.id }),
    });
    expect(replyRes.status, await replyRes.clone().text()).toBe(201);
    const c2 = (await replyRes.json()) as { id: string };
    expect((await asMember(`/v1/feed/posts/${p.id}/like`, { method: 'POST' })).status).toBe(200);
    expect((await asMember(`/v1/feed/comments/${c1.id}/like`, { method: 'POST' })).status).toBe(
      200,
    );

    // Positive controls: while the community is live every route below answers.
    expect((await asMember(`/v1/feed/posts/${p.id}/comments`)).status).toBe(200);
    expect((await asMember(`/v1/feed/comments/${c1.id}/replies`)).status).toBe(200);
    expect((await asMember(`/v1/feed/comments/${c2.id}/thread`)).status).toBe(200);
    const before = await snapshotOf([p.id]);
    expect(JSON.parse(before).comments).toHaveLength(2);
    expect(JSON.parse(before).likes).toHaveLength(2);

    await archiveAndDelete(k.id);

    for (const [who, token] of [
      ['member', tokens.demoMember],
      ['admin', tokens.demoAdmin],
    ] as const) {
      const call = (method: string, path: string, body?: unknown) =>
        send(method, path, token, body);
      const routes: [string, string, string, unknown?][] = [
        ['GET', `/v1/feed/posts/${p.id}`, 'post page'],
        ['GET', `/v1/feed/posts/${p.id}/comments`, 'comments list'],
        [
          'POST',
          `/v1/feed/posts/${p.id}/comments`,
          'new comment',
          { body: `${CAPTION_PREFIX} nova` },
        ],
        ['POST', `/v1/feed/posts/${p.id}/like`, 'like post'],
        ['DELETE', `/v1/feed/posts/${p.id}/like`, 'unlike post'],
        ['POST', `/v1/feed/comments/${c1.id}/like`, 'like comment (RLS only)'],
        ['DELETE', `/v1/feed/comments/${c1.id}/like`, 'unlike comment (RLS only)'],
        ['GET', `/v1/feed/comments/${c1.id}/replies`, 'replies'],
        ['GET', `/v1/feed/comments/${c2.id}/thread`, 'thread'],
      ];
      for (const [method, path, label, body] of routes) {
        await expectBare404(await call(method, path, body), `${who} ${label}`);
      }
    }
    // The author edits and removes: the admin's own routes on the post.
    await expectBare404(
      await send('PATCH', `/v1/feed/posts/${p.id}`, tokens.demoAdmin, {
        caption: caption('editado'),
      }),
      'admin PATCH post',
    );
    await expectBare404(
      await send('DELETE', `/v1/feed/posts/${p.id}`, tokens.demoAdmin),
      'admin DELETE post',
    );
    await expectBare404(
      await send('DELETE', `/v1/feed/comments/${c1.id}`, tokens.demoMember),
      'member DELETE own comment',
    );

    // D-556: every row and every counter is as it was.
    expect(await snapshotOf([p.id])).toBe(before);
  });

  it('5. recovery: clearing deleted_at brings everything back', async () => {
    const k = await createCommunity(communityName('recupera K'));
    const p = await publish({ caption: caption('t5 K post'), communityId: k.id });
    const commented = await send('POST', `/v1/feed/posts/${p.id}/comments`, tokens.demoMember, {
      body: `${CAPTION_PREFIX} recupera`,
    });
    expect(commented.status, await commented.clone().text()).toBe(201);
    const c1 = (await commented.json()) as { id: string };
    await archiveAndDelete(k.id);
    await expectBare404(await request(`/v1/feed/posts/${p.id}`, tokens.demoMember), 'deleted');

    await adminSql`update public.communities set deleted_at = null where id = ${k.id}::uuid`;

    for (const token of [tokens.demoMember, tokens.demoAdmin]) {
      expect((await request(`/v1/feed/posts/${p.id}`, token)).status).toBe(200);
      expect((await inicio(token)).map((item) => item.id)).toContain(p.id);
    }
    const list = await request(`/v1/feed/posts/${p.id}/comments`, tokens.demoMember);
    expect(list.status).toBe(200);
    const page = (await list.json()) as { items: { id: string }[] };
    expect(page.items.map((item) => item.id)).toContain(c1.id);
  });

  it('6. adjacency and ordering (P13, P15): same instant, strict order, an old cursor still pages', async () => {
    const k = await createCommunity(communityName('ordem K'));
    const l = await createCommunity(communityName('ordem L'));
    const kPost = await publish({ caption: caption('t6 K'), communityId: k.id });
    const orgPost = await publish({ caption: caption('t6 organizacao') });
    const lPost = await publish({ caption: caption('t6 L'), communityId: l.id });
    const same = [kPost.id, orgPost.id, lPost.id];
    await adminSql`
      update public.feed_posts set created_at = date_trunc('milliseconds', now())
       where id = any(${same}::uuid[])`;

    // The full order before, and a cursor issued BEFORE the delete from the K post's own row: walk
    // one post per page until the K post is the item just returned.
    const beforeIds = (await inicio(tokens.demoMember)).map((item) => item.id);
    const tied = beforeIds.filter((id) => same.includes(id));
    expect(tied).toEqual([...same].sort().reverse());
    let cursor: string | null = null;
    let found: string | null = null;
    for (let guard = 0; guard < 50 && found === null; guard += 1) {
      const path: string = cursor
        ? `/v1/feed?limit=1&cursor=${encodeURIComponent(cursor)}`
        : '/v1/feed?limit=1';
      const page = (await (await request(path, tokens.demoMember)).json()) as FeedPage;
      cursor = page.nextCursor;
      if (page.items[0]?.id === kPost.id) found = cursor;
      if (cursor === null) break;
    }
    expect(found, 'a cursor sitting on the K post').not.toBeNull();
    const idx = beforeIds.indexOf(kPost.id);
    const expectedTail = beforeIds.slice(idx + 1);

    await archiveAndDelete(k.id);

    const after = await inicio(tokens.demoMember);
    const afterIds = after.map((item) => item.id);
    expect(afterIds).toEqual(beforeIds.filter((id) => id !== kPost.id));
    expect(afterIds.filter((id) => id === orgPost.id)).toHaveLength(1);
    const org = after.find((item) => item.id === orgPost.id);
    expect(org?.communityId).toBeNull();
    expect(org?.caption).toBe(orgPost.caption);

    // The old cursor: 200, no K id, no repeated and no skipped remaining row.
    const rest: string[] = [];
    let next: string | null = found;
    for (let guard = 0; guard < 500; guard += 1) {
      const path: string = next
        ? `/v1/feed?limit=25&cursor=${encodeURIComponent(next)}`
        : '/v1/feed?limit=25';
      const res = await request(path, tokens.demoMember);
      expect(res.status, await res.clone().text()).toBe(200);
      const page = (await res.json()) as FeedPage;
      rest.push(...page.items.map((item) => item.id));
      next = page.nextCursor;
      if (next === null) break;
    }
    expect(rest).not.toContain(kPost.id);
    expect(new Set(rest).size).toBe(rest.length);
    expect(rest).toEqual(expectedTail);
  });

  it('7. empty and fill (P14): a page of deleted posts still fills from older rows', async () => {
    const k = await createCommunity(communityName('cheio K'));
    const kPosts = [
      await publish({ caption: caption('t7 K um'), communityId: k.id }),
      await publish({ caption: caption('t7 K dois'), communityId: k.id }),
      await publish({ caption: caption('t7 K tres'), communityId: k.id }),
    ];
    const ids = kPosts.map((post) => post.id);
    for (const [i, id] of ids.entries()) {
      await adminSql`
        update public.feed_posts
           set created_at = (select max(created_at) from public.feed_posts
                              where tenant_id = ${tenantIds.demo}::uuid and id <> all(${ids}::uuid[]))
                            + ${i + 1} * interval '1 second'
         where id = ${id}::uuid`;
    }
    const top = (await (await request('/v1/feed?limit=3', tokens.demoMember)).json()) as FeedPage;
    expect(top.items.map((item) => item.id).sort()).toEqual([...ids].sort());

    await archiveAndDelete(k.id);

    for (const token of [tokens.demoMember, tokens.demoAdmin]) {
      const res = await request('/v1/feed?limit=3', token);
      expect(res.status, await res.clone().text()).toBe(200);
      const page = (await res.json()) as FeedPage;
      expect(page.items).toHaveLength(3);
      for (const item of page.items) expect(ids).not.toContain(item.id);
      expect(page.nextCursor).not.toBeNull();
    }

    // A community with no post at all deletes with no effect on the feed.
    const before = (await inicio(tokens.demoMember)).map((item) => item.id);
    const empty = await createCommunity(communityName('vazio'));
    await archiveAndDelete(empty.id);
    expect((await inicio(tokens.demoMember)).map((item) => item.id)).toEqual(before);
  });

  it('8. the community page of a deleted community is the bare 404', async () => {
    const k = await createCommunity(communityName('pagina K'));
    const p = await publish({ caption: caption('t8 K'), communityId: k.id });
    for (const token of [tokens.demoMember, tokens.demoAdmin]) {
      const ok = await request(`/v1/feed?communityId=${k.id}`, token);
      expect(ok.status, await ok.clone().text()).toBe(200);
      expect(((await ok.json()) as FeedPage).items.map((item) => item.id)).toContain(p.id);
    }
    await archiveAndDelete(k.id);
    for (const [who, token] of [
      ['member', tokens.demoMember],
      ['admin', tokens.demoAdmin],
    ] as const) {
      await expectBare404(
        await request(`/v1/feed?communityId=${k.id}`, token),
        `${who} community page`,
      );
    }
  });

  it('9. an archived (not deleted) community keeps its posts: the archive rule is unchanged', async () => {
    const k = await createCommunity(communityName('arquivada K'));
    const p = await publish({ caption: caption('t9 K'), communityId: k.id });
    await archiveCommunity(k.id);
    for (const token of [tokens.demoMember, tokens.demoAdmin]) {
      expect((await inicio(token)).map((item) => item.id)).toContain(p.id);
      const page = await request(`/v1/feed/posts/${p.id}`, token);
      expect(page.status, await page.clone().text()).toBe(200);
    }
  });
});
