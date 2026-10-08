import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import type { FeedPage, FeedPost, VideoCommunities } from '@rede-social/module-feed/contracts';
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
 * 08.2-03 — the community gate reaches every FEED consumer of a locked community's content (ROADMAP
 * SC 4 and SC 7, decisions (8), (10) and (11); STORE-13, STORE-15, STORE-16, STORE-17), against the
 * live local stack and the real seed.
 *
 * Fixture (built in `beforeAll`, every name and caption prefixed `sg-<run>`): in `rede-demo` with the
 * store ON, one OPEN community with one post, one LOCKED community (linked to a throwaway product)
 * holding four posts — a text post, a ready VIDEO post, a post carrying a resolved LINK PREVIEW and,
 * newest, a ready video post that is therefore the SAMPLE — plus one post with no community. The
 * seed member holds nothing (`member-without`); a throwaway member bought the product
 * (`member-holder`); the seed admin and support are staff. A second locked community with no live
 * post backs P50, and a throwaway tenant whose only community is locked backs P62.
 *
 * What is proved here:
 *  - `feed reads`: Início and Reels "Todos" never carry a locked community's post, the sample
 *    included, and `video-communities` names no lane for it (truth 1, P61, P62); the community page
 *    answers the sample marked `access: 'sample'`, `nextCursor: null` and `lockedCount` =
 *    `post_count - 1` (truth 2, P52), and an empty locked community the plain empty page (P50);
 *    `GET /v1/feed/posts/{id}` answers 403 `{ access: 'community_locked', communityId }` on a hidden
 *    post, the sample with its marker, and the bare 404 on unknown, deleted and other-tenant ids
 *    (truth 5); keyset pages concatenate to exactly the open posts (P63) and a lock between two pages
 *    leaves page 2 clean with a still-valid cursor (P64); no serialised member answer contains a
 *    hidden post's id, caption, media asset id or preview title (P51).
 *
 * Both hooks sweep the prefix; `withStoreEnabled('demo')`'s restore runs in `afterAll`. Test ORDER is
 * load-bearing (`fileParallelism: false`, declaration order).
 */

type Envelope = {
  error: { code: string; message?: string; details?: Record<string, unknown> };
};

const RUN = Date.now();
/** Every product, community, caption, preview URL, identity and tenant this file writes. */
const PREFIX = `sg-${RUN}`;
/** P62's throwaway tenant: its only community is locked and it has no general post. */
const EMPTY_SLUG = `${PREFIX}-vazia`;
const EMPTY_HOST = `${EMPTY_SLUG}.localhost`;

const tokens = {
  demoAdmin: '',
  demoMember: '',
  demoSupport: '',
  holder: '',
  emptyAdmin: '',
  emptyMember: '',
};
const users = { demoMember: '', demoAdmin: '', demoSupport: '', holder: '' };
let demoTenantId = '';
let restoreStore: () => Promise<void> = async () => {};

/** The fixture's ids, filled in `beforeAll`. */
const fx = {
  openCommunity: '',
  lockedCommunity: '',
  emptyLockedCommunity: '',
  product: '',
  openPost: '',
  generalPost: '',
  hiddenText: '',
  hiddenVideo: '',
  hiddenLink: '',
  sample: '',
  hiddenVideoAsset: '',
  sampleVideoAsset: '',
  /** The hidden posts' captions and the preview's title: none may reach a member-lane answer. */
  hiddenStrings: [] as string[],
};
const createdAssetIds: string[] = [];

/** Every member-lane (member-without) answer body, searched at the end of `feed reads` (P51). */
const memberAnswers: string[] = [];

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

/** A GET whose 200 body is returned; a member-lane body is also kept for the P51 search. */
async function getJson<T>(path: string, token: string, host = HOSTS.demo): Promise<T> {
  const res = await request(path, token, {}, host);
  const text = await res.text();
  expect(res.status, `GET ${path} -> ${res.status} ${text}`).toBe(200);
  if (token === tokens.demoMember) memberAnswers.push(text);
  return JSON.parse(text) as T;
}

/** Removes everything a run of this file (or an interrupted earlier run) left behind. */
async function sweep(): Promise<void> {
  const products = adminSql`select id from public.store_products where name like ${'sg-%'}`;
  await adminSql`delete from public.store_entitlements where product_id in (${products})`;
  await adminSql`delete from public.store_orders where product_id in (${products})`;
  await adminSql`delete from public.store_products where name like ${'sg-%'}`;
  const posts = await adminSql<{ asset_id: string | null }[]>`
    select m.media_asset_id as asset_id
      from public.feed_posts p
      left join public.feed_post_media m on m.post_id = p.id
     where p.caption like ${'sg-%'}`;
  await adminSql`delete from public.feed_posts where caption like ${'sg-%'}`;
  const communities = adminSql`select id from public.communities where name like ${'sg-%'}`;
  await adminSql`delete from public.feed_posts where community_id in (${communities})`;
  await adminSql`delete from public.communities where name like ${'sg-%'}`;
  await adminSql`delete from public.feed_link_previews where url like ${'https://sg-%'}`;
  const assets = [
    ...createdAssetIds,
    ...posts.map((row) => row.asset_id).filter((id): id is string => id !== null),
  ];
  if (assets.length > 0) {
    await adminSql`delete from public.media_assets where id = any(${assets}::uuid[])`;
  }
  await adminSql`delete from public.media_assets where filename like ${'sg-%'}`;
  await removeIdentitiesByPrefix('sg');
  await adminSql`delete from public.tenant_modules where tenant_id in (
    select id from public.tenants where slug like ${'sg-%'})`;
  await adminSql`delete from public.tenant_domains where host like ${'sg-%'}`;
  await adminSql`delete from public.tenants where slug like ${'sg-%'}`;
}

/** A throwaway community through the admin's own route, and its id. */
async function createCommunity(name: string): Promise<string> {
  const res = await post('/v1/communities', tokens.demoAdmin, { name });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** One admin post through the feed's create route, and its id. */
async function publish(caption: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await post('/v1/feed/posts', tokens.demoAdmin, { caption, ...extra });
  expect(res.status, `POST /v1/feed/posts -> ${res.status}`).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** A ready portrait video owned by `email` (`fake` provider, the reels.test fixture). */
async function readyVideo(tenantId: string, email: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, playback_id,
       mime, bytes, width, height, duration_seconds, aspect_ratio, filename, ready_at)
    select ${tenantId}::uuid, u.id, 'video', 'post', 'ready', 'fake',
           ${`fake-${crypto.randomUUID()}`}, ${`pb-${crypto.randomUUID()}`},
           'video/mp4', 1048576, 1080, 1920, 15, '9:16', ${`${PREFIX}.mp4`}, now()
      from public.users u where u.email = ${email}
    returning id`;
  if (!row) throw new Error(`could not seed a video asset for ${email}`);
  createdAssetIds.push(row.id);
  return row.id;
}

/** A product through the API, and its detail. */
async function createProduct(name: string, communityIds: string[]): Promise<ProductDetail> {
  const res = await post('/v1/store/products', tokens.demoAdmin, {
    name,
    priceCents: 1990,
    communityIds,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as ProductDetail;
}

/** Walk a feed list to its end (bounded), in the server's own order. */
async function walk(query: string, token: string, host = HOSTS.demo): Promise<FeedPost[]> {
  const seen: FeedPost[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 200; guard += 1) {
    const sep = query.includes('?') ? '&' : '?';
    const path: string = cursor ? `${query}${sep}cursor=${encodeURIComponent(cursor)}` : query;
    const page: FeedPage = await getJson<FeedPage>(path, token, host);
    seen.push(...page.items);
    cursor = page.nextCursor;
    if (cursor === null) return seen;
  }
  throw new Error(`walk(${query}) did not reach the end in 200 pages`);
}

const ids = (items: { id: string }[]) => items.map((item) => item.id);

/** The bare 404 (D-23): code NOT_FOUND and no `details` key at all. */
async function expectBare404(res: Response): Promise<void> {
  expect(res.status).toBe(404);
  const body = (await res.json()) as Envelope;
  expect(body.error.code).toBe('NOT_FOUND');
  expect(body.error).not.toHaveProperty('details');
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  await sweep();
  [tokens.demoAdmin, tokens.demoMember, tokens.demoSupport] = await Promise.all([
    signInAs('admin@rede-demo.local', SEED_PASSWORD),
    signInAs('member@rede-demo.local', SEED_PASSWORD),
    signInAs('support@rede-demo.local', SEED_PASSWORD),
  ]);
  const seedUsers = await adminSql<{ id: string; email: string }[]>`
    select id::text as id, email from public.users
     where email in ('admin@rede-demo.local', 'member@rede-demo.local', 'support@rede-demo.local')`;
  const userOf = (email: string) => seedUsers.find((row) => row.email === email)?.id ?? '';
  users.demoAdmin = userOf('admin@rede-demo.local');
  users.demoMember = userOf('member@rede-demo.local');
  users.demoSupport = userOf('support@rede-demo.local');
  const [demo] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-demo'`;
  demoTenantId = demo?.id ?? '';
  restoreStore = await withStoreEnabled('demo');

  // The holder: a throwaway member of rede-demo who buys the product below.
  const holder = await createSharedIdentity({ prefix: PREFIX, memberships: [{ host: 'demo' }] });
  users.holder = holder.userId;
  tokens.holder = await signInAs(holder.email, holder.password);

  fx.openCommunity = await createCommunity(`${PREFIX} aberta`);
  fx.lockedCommunity = await createCommunity(`${PREFIX} trancada`);
  fx.emptyLockedCommunity = await createCommunity(`${PREFIX} trancada-vazia`);
  fx.hiddenVideoAsset = await readyVideo(demoTenantId, 'admin@rede-demo.local');
  fx.sampleVideoAsset = await readyVideo(demoTenantId, 'admin@rede-demo.local');

  // Publication order, oldest first. The link post sits BETWEEN the open post and the general post
  // (P61), and the newest locked post is a ready video, so the sample is a playable post that Reels
  // must still never list.
  const hiddenTextCaption = `${PREFIX} oculto-texto ${crypto.randomUUID()}`;
  const hiddenVideoCaption = `${PREFIX} oculto-video ${crypto.randomUUID()}`;
  const hiddenLinkCaption = `${PREFIX} oculto-link ${crypto.randomUUID()}`;
  const previewTitle = `${PREFIX} titulo-oculto ${crypto.randomUUID()}`;
  fx.hiddenStrings = [hiddenTextCaption, hiddenVideoCaption, hiddenLinkCaption, previewTitle];

  fx.hiddenText = await publish(hiddenTextCaption, { communityId: fx.lockedCommunity });
  fx.hiddenVideo = await publish(hiddenVideoCaption, {
    communityId: fx.lockedCommunity,
    videoAssetId: fx.hiddenVideoAsset,
  });
  fx.openPost = await publish(`${PREFIX} aberto`, { communityId: fx.openCommunity });
  fx.hiddenLink = await publish(hiddenLinkCaption, { communityId: fx.lockedCommunity });
  const [preview] = await adminSql<{ id: string }[]>`
    insert into public.feed_link_previews (tenant_id, url_hash, url, status, title, fetched_at)
    values (${demoTenantId}::uuid, ${`${PREFIX}-${crypto.randomUUID()}`},
            ${`https://${PREFIX}.example.com/artigo`}, 'resolved', ${previewTitle}, now())
    returning id`;
  await adminSql`
    update public.feed_posts set link_preview_id = ${preview?.id ?? null}::uuid
     where id = ${fx.hiddenLink}::uuid`;
  fx.generalPost = await publish(`${PREFIX} geral`);
  fx.sample = await publish(`${PREFIX} amostra`, {
    communityId: fx.lockedCommunity,
    videoAssetId: fx.sampleVideoAsset,
  });

  // The lock: one product linked to both locked communities; the holder buys it.
  const product = await createProduct(`${PREFIX} curso`, [
    fx.lockedCommunity,
    fx.emptyLockedCommunity,
  ]);
  fx.product = product.id;
  const bought = await post(`/v1/store/products/${product.id}/purchase`, tokens.holder, {
    expectedAmountCents: 1990,
  });
  expect(bought.status).toBe(200);

  // P62's throwaway tenant: feed, communities and store ON; one community, locked, holding one
  // ready video post; no general post. An admin and a member, reached through its own verified host.
  const [empty] = await adminSql<{ id: string }[]>`
    insert into public.tenants (slug, display_name, rules_text, rules_version)
    values (${EMPTY_SLUG}, 'Comunidade Trancada', 'Regras de teste.', 1)
    returning id::text as id`;
  const emptyTenantId = empty?.id ?? '';
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${emptyTenantId}::uuid, 'feed', true),
           (${emptyTenantId}::uuid, 'communities', true),
           (${emptyTenantId}::uuid, 'store', true)`;
  await adminSql`
    insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
    values (${emptyTenantId}::uuid, ${EMPTY_HOST}, true, now())`;
  const emptyAdmin = await createSharedIdentity({
    prefix: PREFIX,
    memberships: [{ tenantSlug: EMPTY_SLUG, role: 'admin_tenant' }],
  });
  const emptyMember = await createSharedIdentity({
    prefix: PREFIX,
    memberships: [{ tenantSlug: EMPTY_SLUG }],
  });
  tokens.emptyAdmin = await signInAs(emptyAdmin.email, emptyAdmin.password);
  tokens.emptyMember = await signInAs(emptyMember.email, emptyMember.password);
  const [emptyCommunity] = await adminSql<{ id: string }[]>`
    insert into public.communities (tenant_id, created_by_user_id, name, slug)
    values (${emptyTenantId}::uuid, ${emptyAdmin.userId}::uuid, ${`${PREFIX} unica`},
            ${`${PREFIX}-unica`})
    returning id::text as id`;
  const emptyVideo = await readyVideo(emptyTenantId, emptyAdmin.email);
  const [emptyPost] = await adminSql<{ id: string }[]>`
    insert into public.feed_posts (tenant_id, author_user_id, caption, community_id, media_kind)
    values (${emptyTenantId}::uuid, ${emptyAdmin.userId}::uuid, ${`${PREFIX} unico`},
            ${emptyCommunity?.id ?? ''}::uuid, 'video')
    returning id::text as id`;
  await adminSql`
    insert into public.feed_post_media
      (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
    values (${emptyTenantId}::uuid, ${emptyPost?.id ?? ''}::uuid, 'video', ${emptyVideo}::uuid,
            'video', 0)`;
  const [emptyProduct] = await adminSql<{ id: string }[]>`
    insert into public.store_products (tenant_id, created_by_user_id, name, price_cents)
    values (${emptyTenantId}::uuid, ${emptyAdmin.userId}::uuid, ${`${PREFIX} vazia`}, 990)
    returning id::text as id`;
  await adminSql`
    insert into public.store_product_communities (tenant_id, product_id, community_id)
    values (${emptyTenantId}::uuid, ${emptyProduct?.id ?? ''}::uuid,
            ${emptyCommunity?.id ?? ''}::uuid)`;
  moduleFlags.invalidate(emptyTenantId);
});

afterAll(async () => {
  await restoreStore();
  await sweep();
});

describe('feed reads', () => {
  it('truth 1 / P61: Início skips every post of the locked community, the sample included, and keeps the open and general posts in place', async () => {
    // P61: the newest member page: the general post, then the open post. The link post published
    // between them and the sample published after them are absent.
    const first = await getJson<FeedPage>('/v1/feed?limit=2', tokens.demoMember);
    expect(ids(first.items)).toEqual([fx.generalPost, fx.openPost]);
    expect(first.items.every((item) => item.access === undefined)).toBe(true);
    expect(first).not.toHaveProperty('lockedCount');

    const lockedIds = [fx.hiddenText, fx.hiddenVideo, fx.hiddenLink, fx.sample];
    const all = ids(await walk('/v1/feed?limit=25', tokens.demoMember));
    for (const id of lockedIds) expect(all).not.toContain(id);
    expect(all).toContain(fx.openPost);
    expect(all).toContain(fx.generalPost);

    // The holder and staff see every post of the community in Início.
    for (const token of [tokens.holder, tokens.demoAdmin, tokens.demoSupport]) {
      const theirs = ids(await walk('/v1/feed?limit=25', token));
      for (const id of lockedIds) expect(theirs).toContain(id);
    }
  });

  it('truth 1: Reels "Todos" lists neither locked video (the sample included); the holder gets both', async () => {
    const member = ids(await walk('/v1/feed?media=video&limit=25', tokens.demoMember));
    expect(member).not.toContain(fx.sample);
    expect(member).not.toContain(fx.hiddenVideo);
    const holder = ids(await walk('/v1/feed?media=video&limit=25', tokens.holder));
    expect(holder).toContain(fx.sample);
    expect(holder).toContain(fx.hiddenVideo);
  });

  it('truth 1: video-communities names no lane for the locked community; the holder and the admin see it', async () => {
    const member = await getJson<VideoCommunities>('/v1/feed/video-communities', tokens.demoMember);
    expect(ids(member.items)).not.toContain(fx.lockedCommunity);
    for (const token of [tokens.holder, tokens.demoAdmin]) {
      const theirs = await getJson<VideoCommunities>('/v1/feed/video-communities', token);
      expect(ids(theirs.items)).toContain(fx.lockedCommunity);
    }
  });

  it('truth 2 / P52: the locked page is the sample, marked, no cursor, and lockedCount = post_count - 1', async () => {
    const [community] = await adminSql<{ post_count: number }[]>`
      select post_count from public.communities where id = ${fx.lockedCommunity}::uuid`;
    expect(community?.post_count).toBe(4);

    const page = await getJson<FeedPage>(
      `/v1/feed?communityId=${fx.lockedCommunity}`,
      tokens.demoMember,
    );
    expect(ids(page.items)).toEqual([fx.sample]);
    expect(page.items[0]?.access).toBe('sample');
    expect(page.nextCursor).toBeNull();
    expect(page.lockedCount).toBe((community?.post_count ?? 0) - 1);
    // The count is a NUMBER only: the page's keys are exactly these three.
    expect(Object.keys(page).sort()).toEqual(['items', 'lockedCount', 'nextCursor']);

    // A Reels lane of a locked community is empty, with no count.
    const lane = await getJson<FeedPage>(
      `/v1/feed?communityId=${fx.lockedCommunity}&media=video`,
      tokens.demoMember,
    );
    expect(lane).toEqual({ items: [], nextCursor: null });

    // The holder reads all four, unmarked, with no count.
    const full = await getJson<FeedPage>(
      `/v1/feed?communityId=${fx.lockedCommunity}`,
      tokens.holder,
    );
    expect(ids(full.items)).toEqual([fx.sample, fx.hiddenLink, fx.hiddenVideo, fx.hiddenText]);
    expect(full.items.every((item) => item.access === undefined)).toBe(true);
    expect(full).not.toHaveProperty('lockedCount');

    // An open community's page is unchanged: no marker, no count.
    const open = await getJson<FeedPage>(
      `/v1/feed?communityId=${fx.openCommunity}`,
      tokens.demoMember,
    );
    expect(ids(open.items)).toEqual([fx.openPost]);
    expect(open.items[0]).not.toHaveProperty('access');
    expect(open).not.toHaveProperty('lockedCount');
  });

  it('P50: a locked community with no live post answers the plain empty page, with no lockedCount key', async () => {
    const page = await getJson<FeedPage>(
      `/v1/feed?communityId=${fx.emptyLockedCommunity}`,
      tokens.demoMember,
    );
    expect(page).toEqual({ items: [], nextCursor: null });
    expect(page).not.toHaveProperty('lockedCount');
  });

  it('truth 5: getPost answers 403 community_locked with the community id on a hidden post, the marked sample, and the bare 404 elsewhere', async () => {
    for (const hidden of [fx.hiddenText, fx.hiddenVideo, fx.hiddenLink]) {
      const res = await request(`/v1/feed/posts/${hidden}`, tokens.demoMember);
      const text = await res.text();
      memberAnswers.push(text);
      expect(res.status).toBe(403);
      const body = JSON.parse(text) as Envelope;
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.details).toEqual({
        access: 'community_locked',
        communityId: fx.lockedCommunity,
      });
    }

    const sample = await getJson<FeedPost>(`/v1/feed/posts/${fx.sample}`, tokens.demoMember);
    expect(sample.id).toBe(fx.sample);
    expect(sample.access).toBe('sample');

    const open = await getJson<FeedPost>(`/v1/feed/posts/${fx.openPost}`, tokens.demoMember);
    expect(open).not.toHaveProperty('access');

    // The holder and staff read the hidden posts in full, unmarked.
    for (const token of [tokens.holder, tokens.demoAdmin]) {
      const full = await getJson<FeedPost>(`/v1/feed/posts/${fx.hiddenLink}`, token);
      expect(full.id).toBe(fx.hiddenLink);
      expect(full).not.toHaveProperty('access');
    }

    // Unknown, deleted and other-tenant ids: the bare 404, no details.
    await expectBare404(
      await request('/v1/feed/posts/00000000-0000-4000-8000-000000000000', tokens.demoMember),
    );
    const deleted = await publish(`${PREFIX} apagado`, { communityId: fx.lockedCommunity });
    await adminSql`update public.feed_posts set deleted_at = now() where id = ${deleted}::uuid`;
    await expectBare404(await request(`/v1/feed/posts/${deleted}`, tokens.demoMember));
    const [labPost] = await adminSql<{ id: string }[]>`
      select p.id::text as id from public.feed_posts p join public.tenants t on t.id = p.tenant_id
       where t.slug = 'rede-lab' and p.deleted_at is null limit 1`;
    await expectBare404(await request(`/v1/feed/posts/${labPost?.id ?? ''}`, tokens.demoMember));
  });

  it('P62: a tenant whose every post sits in a locked community answers the member an empty Início and no lane', async () => {
    const feed = await getJson<FeedPage>('/v1/feed', tokens.emptyMember, EMPTY_HOST);
    expect(feed).toEqual({ items: [], nextCursor: null });
    const reels = await getJson<FeedPage>('/v1/feed?media=video', tokens.emptyMember, EMPTY_HOST);
    expect(reels).toEqual({ items: [], nextCursor: null });
    const lanes = await getJson<VideoCommunities>(
      '/v1/feed/video-communities',
      tokens.emptyMember,
      EMPTY_HOST,
    );
    expect(lanes).toEqual({ items: [] });
    // The fixture is real: the tenant's admin reads the post and its lane.
    const adminFeed = await getJson<FeedPage>('/v1/feed', tokens.emptyAdmin, EMPTY_HOST);
    expect(adminFeed.items).toHaveLength(1);
    const adminLanes = await getJson<VideoCommunities>(
      '/v1/feed/video-communities',
      tokens.emptyAdmin,
      EMPTY_HOST,
    );
    expect(adminLanes.items).toHaveLength(1);
  });

  it('P63: member pages concatenate to exactly the open posts, newest first, with no duplicate and no gap', async () => {
    const memberAll = ids(await walk('/v1/feed?limit=3', tokens.demoMember));
    const adminAll = ids(await walk('/v1/feed?limit=25', tokens.demoAdmin));
    const lockedRows = await adminSql<{ id: string }[]>`
      select p.id::text as id from public.feed_posts p
       where p.tenant_id = ${demoTenantId}::uuid
         and p.community_id = any (${[fx.lockedCommunity, fx.emptyLockedCommunity]}::uuid[])`;
    const locked = new Set(lockedRows.map((row) => row.id));
    expect(memberAll).toEqual(adminAll.filter((id) => !locked.has(id)));
    expect(new Set(memberAll).size).toBe(memberAll.length);
  });

  it('P64: a community locked between page 1 and page 2 contributes nothing to page 2, and the old cursor stays valid', async () => {
    const late = await createCommunity(`${PREFIX} tardia`);
    const lateA = await publish(`${PREFIX} tardia-a`, { communityId: late });
    const openA = await publish(`${PREFIX} aberto-a`, { communityId: fx.openCommunity });
    const lateB = await publish(`${PREFIX} tardia-b`, { communityId: late });
    const openB = await publish(`${PREFIX} aberto-b`, { communityId: fx.openCommunity });
    const lateC = await publish(`${PREFIX} tardia-c`, { communityId: late });

    const page1 = await getJson<FeedPage>('/v1/feed?limit=2', tokens.demoMember);
    expect(ids(page1.items)).toEqual([lateC, openB]);
    expect(page1.nextCursor).not.toBeNull();

    await createProduct(`${PREFIX} tardia`, [late]);

    const page2 = await getJson<FeedPage>(
      `/v1/feed?limit=3&cursor=${encodeURIComponent(page1.nextCursor ?? '')}`,
      tokens.demoMember,
    );
    expect(page2.items[0]?.id).toBe(openA);
    for (const id of [lateA, lateB, lateC]) expect(ids(page2.items)).not.toContain(id);
    expect(ids(page2.items)).toEqual([openA, fx.generalPost, fx.openPost]);
  });

  it('P51: no serialised member answer carries a hidden post id, caption, media asset id or preview title', () => {
    expect(memberAnswers.length).toBeGreaterThan(10);
    const needles = [
      fx.hiddenText,
      fx.hiddenVideo,
      fx.hiddenLink,
      fx.hiddenVideoAsset,
      ...fx.hiddenStrings,
    ];
    for (const answer of memberAnswers) {
      for (const needle of needles) expect(answer).not.toContain(needle);
    }
  });
});
