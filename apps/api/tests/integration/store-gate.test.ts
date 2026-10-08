import { createECDH, randomBytes } from 'node:crypto';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import type { FeedPage, FeedPost, VideoCommunities } from '@rede-social/module-feed/contracts';
import type { ProductDetail } from '@rede-social/module-store/contracts';
import type { HighlightDetail, HighlightList } from '@rede-social/module-stories/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  pushSendJobsOf,
  removeIdentitiesByPrefix,
  runNotificationJobs,
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
 *  - `interactions`: on the sample, like, unlike, list and create comments answer 403
 *    `{ access: 'community_locked' }` every time and write nothing, and the member's like placed
 *    before the lock is left as it was (truth 3, P58, P59); on a hidden post the same routes answer
 *    the bare 404; replies, thread, comment like/unlike and delete on any comment of the locked
 *    community answer the bare 404 (truth 4); the same like route answers 200 / 403 / 404 on an open
 *    post / the sample / a hidden post (P56); the sample's comment COUNT stays visible; the holder
 *    interacts normally.
 *  - `agreement` (the 08.2-01 invariant): for member-without, member-holder, admin and support and
 *    for the locked and the open community, the Início, Reels, community-page, getPost and like
 *    answers agree with `app.community_locked_ids_for(user)` read in the admin SQL lane.
 *
 * Both hooks sweep the prefix; `withStoreEnabled('demo')`'s restore runs in `afterAll`. Test ORDER is
 * load-bearing (`fileParallelism: false`, declaration order).
 */

type Envelope = {
  error: { code: string; message?: string; details?: Record<string, unknown> };
};

const RUN = Date.now();
/** The fake push transport's origin (`PUSH_TRANSPORT=fake`, the push.test fixture). */
const PUSH_FAKE = 'https://push.fake.test';
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
  /** Comments written BEFORE the lock: the admin's root and reply on the sample, a member's root
   *  on a hidden post. */
  sampleRoot: '',
  sampleReply: '',
  hiddenRoot: '',
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
  // Stories first (08.2-04 `highlights`): they hold their media asset; their highlight items go
  // with them, and a highlight placed in a swept community goes with the community.
  await adminSql`delete from public.stories where caption like ${'sg-%'}`;
  await adminSql`delete from public.push_subscriptions where endpoint like ${`${PUSH_FAKE}/sg-%`}`;
  const products = adminSql`select id from public.store_products where name like ${'sg-%'}`;
  await adminSql`delete from public.store_entitlements where product_id in (${products})`;
  await adminSql`delete from public.store_orders where product_id in (${products})`;
  await adminSql`delete from public.store_products where name like ${'sg-%'}`;
  const posts = await adminSql<{ asset_id: string | null }[]>`
    select m.media_asset_id as asset_id
      from public.feed_posts p
      left join public.feed_post_media m on m.post_id = p.id
     where p.caption like ${'sg-%'}`;
  // Notification rows about this file's posts (08.2-04 `notifications`); they hold no FK to the post.
  await adminSql`
    delete from public.notifications
     where subject_type = 'post'
       and subject_id in (select id from public.feed_posts where caption like ${'sg-%'})`;
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

/** Runs `fn` with the demo tenant's `store` module OFF, then turns it back ON (08.2-04). */
async function withStoreOff<T>(fn: () => Promise<T>): Promise<T> {
  await adminSql`
    update public.tenant_modules set enabled = false, updated_at = now()
     where tenant_id = ${demoTenantId}::uuid and module_key = 'store'`;
  moduleFlags.invalidate(demoTenantId);
  try {
    return await fn();
  } finally {
    await adminSql`
      update public.tenant_modules set enabled = true, updated_at = now()
       where tenant_id = ${demoTenantId}::uuid and module_key = 'store'`;
    moduleFlags.invalidate(demoTenantId);
  }
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

  // Interactions written BEFORE the lock (P59 and the comment cases of `interactions`): the
  // admin's root and reply on the sample, the member's root on a hidden post, the member's like on
  // the sample.
  const comment = async (token: string, postId: string, body: string, parentId?: string) => {
    const res = await post(`/v1/feed/posts/${postId}/comments`, token, {
      body,
      ...(parentId ? { parentId } : {}),
    });
    expect(res.status, `POST /v1/feed/posts/${postId}/comments -> ${res.status}`).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  fx.sampleRoot = await comment(tokens.demoAdmin, fx.sample, 'Raiz na amostra.');
  fx.sampleReply = await comment(tokens.demoAdmin, fx.sample, 'Resposta.', fx.sampleRoot);
  fx.hiddenRoot = await comment(tokens.demoMember, fx.hiddenText, 'Comentario do membro.');
  const preLockLike = await post(`/v1/feed/posts/${fx.sample}/like`, tokens.demoMember, {});
  expect(preLockLike.status).toBe(200);

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

describe('interactions', () => {
  /** Live rows the refused calls must not move: likes and comments on one post. */
  async function rowsOf(postId: string) {
    const [row] = await adminSql<{ likes: number; comments: number; like_count: number }[]>`
      select (select count(*)::int from public.feed_likes where post_id = ${postId}::uuid) as likes,
             (select count(*)::int from public.feed_comments where post_id = ${postId}::uuid) as comments,
             (select like_count from public.feed_posts where id = ${postId}::uuid) as like_count`;
    return row ?? { likes: -1, comments: -1, like_count: -1 };
  }

  const send = (method: string, path: string, token: string, body?: unknown) =>
    request(path, token, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  async function expectLocked(res: Response): Promise<void> {
    expect(res.status).toBe(403);
    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.details).toEqual({ access: 'community_locked' });
  }

  /** The four post-targeted interactions, as [method, path, body]. */
  const postInteractions = (postId: string, parentId?: string) =>
    [
      ['POST', `/v1/feed/posts/${postId}/like`, undefined],
      ['DELETE', `/v1/feed/posts/${postId}/like`, undefined],
      ['GET', `/v1/feed/posts/${postId}/comments`, undefined],
      ['POST', `/v1/feed/posts/${postId}/comments`, { body: 'Tentativa.' }],
      ...(parentId
        ? [['POST', `/v1/feed/posts/${postId}/comments`, { body: 'Tentativa.', parentId }] as const]
        : []),
    ] as const;

  it('truth 3 / P58 / P59: every interaction on the sample is 403 community_locked, every time, and writes nothing; the pre-lock like stays', async () => {
    const before = await rowsOf(fx.sample);
    // The member's like from before the lock is there, and it is counted.
    expect(before.likes).toBeGreaterThanOrEqual(1);
    const [own] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_likes
       where post_id = ${fx.sample}::uuid and user_id = ${users.demoMember}::uuid`;
    expect(own?.n).toBe(1);

    for (let round = 0; round < 2; round += 1) {
      for (const [method, path, body] of postInteractions(fx.sample, fx.sampleRoot)) {
        await expectLocked(await send(method, path, tokens.demoMember, body));
      }
    }

    expect(await rowsOf(fx.sample)).toEqual(before);
    const [still] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_likes
       where post_id = ${fx.sample}::uuid and user_id = ${users.demoMember}::uuid`;
    expect(still?.n).toBe(1);
  });

  it('truth 3: on a hidden post the same routes are the bare 404 and write nothing', async () => {
    for (const hidden of [fx.hiddenText, fx.hiddenVideo, fx.hiddenLink]) {
      const before = await rowsOf(hidden);
      for (const [method, path, body] of postInteractions(hidden)) {
        await expectBare404(await send(method, path, tokens.demoMember, body));
      }
      expect(await rowsOf(hidden)).toEqual(before);
    }
  });

  it('truth 4: replies, thread, comment like/unlike and delete on any comment of the locked community are the bare 404', async () => {
    const commentsBefore = await rowsOf(fx.hiddenText);
    for (const commentId of [fx.sampleRoot, fx.sampleReply, fx.hiddenRoot]) {
      for (const [method, path] of [
        ['GET', `/v1/feed/comments/${commentId}/replies`],
        ['GET', `/v1/feed/comments/${commentId}/thread`],
        ['POST', `/v1/feed/comments/${commentId}/like`],
        ['DELETE', `/v1/feed/comments/${commentId}/like`],
      ] as const) {
        await expectBare404(await send(method, path, tokens.demoMember));
      }
    }
    // The member AUTHORED the hidden root, yet cannot reach it to delete it; it stays live.
    await expectBare404(
      await send('DELETE', `/v1/feed/comments/${fx.hiddenRoot}`, tokens.demoMember),
    );
    const [root] = await adminSql<{ deleted_at: string | null }[]>`
      select deleted_at from public.feed_comments where id = ${fx.hiddenRoot}::uuid`;
    expect(root?.deleted_at).toBeNull();
    expect(await rowsOf(fx.hiddenText)).toEqual(commentsBefore);
    const [likes] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_likes
       where comment_id = any (${[fx.sampleRoot, fx.sampleReply, fx.hiddenRoot]}::uuid[])`;
    expect(likes?.n).toBe(0);
  });

  it('P56: the same like route answers 200 on an open post, 403 on the sample and the bare 404 on a hidden post, for the same member', async () => {
    const open = await send('POST', `/v1/feed/posts/${fx.openPost}/like`, tokens.demoMember);
    expect(open.status).toBe(200);
    expect(((await open.json()) as { liked: boolean }).liked).toBe(true);
    await expectLocked(await send('POST', `/v1/feed/posts/${fx.sample}/like`, tokens.demoMember));
    await expectBare404(
      await send('POST', `/v1/feed/posts/${fx.hiddenText}/like`, tokens.demoMember),
    );
    expect(
      (await send('DELETE', `/v1/feed/posts/${fx.openPost}/like`, tokens.demoMember)).status,
    ).toBe(200);
  });

  it('the sample keeps its comment COUNT on the member projection, equal to the holder view', async () => {
    const member = await getJson<FeedPost>(`/v1/feed/posts/${fx.sample}`, tokens.demoMember);
    const holder = await getJson<FeedPost>(`/v1/feed/posts/${fx.sample}`, tokens.holder);
    expect(member.commentCount).toBeGreaterThan(0);
    expect(member.commentCount).toBe(holder.commentCount);
    expect(member.likeCount).toBe(holder.likeCount);
  });

  it('the holder and the admin interact with the locked community as before', async () => {
    for (const token of [tokens.holder, tokens.demoAdmin]) {
      const liked = await send('POST', `/v1/feed/posts/${fx.hiddenText}/like`, token);
      expect(liked.status).toBe(200);
      expect((await send('DELETE', `/v1/feed/posts/${fx.hiddenText}/like`, token)).status).toBe(
        200,
      );
      const list = await send('GET', `/v1/feed/posts/${fx.sample}/comments`, token);
      expect(list.status).toBe(200);
      const replies = await send('GET', `/v1/feed/comments/${fx.sampleRoot}/replies`, token);
      expect(replies.status).toBe(200);
      expect(ids(((await replies.json()) as { items: { id: string }[] }).items)).toEqual([
        fx.sampleReply,
      ]);
    }
    const created = await send('POST', `/v1/feed/posts/${fx.sample}/comments`, tokens.holder, {
      body: 'Comprei.',
    });
    expect(created.status).toBe(201);
  });
});

describe('highlights', () => {
  /**
   * 08.2-04 / D-355 / STORE-18 (P66): a community's highlight READS — the row by `communityId` and
   * a highlight's detail by id — answer a member without access the SAME bare 404 a missing
   * community answers (D-23). The place seam (`resolveHighlightPlace('read')`) is the one gate.
   */
  const hl = { locked: '', open: '', story: '', asset: '' };
  const LOCKED_TITLE = 'sg Trancado';

  beforeAll(async () => {
    // A ready IMAGE asset (the highlight's automatic cover), one admin story, and one highlight in
    // each community holding that story, all through the existing routes.
    const [asset] = await adminSql<{ id: string }[]>`
      insert into public.media_assets
        (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, variant_widths,
         filename)
      select ${demoTenantId}::uuid, u.id, 'image', 'story', 'ready', 'supabase', 'image/webp', 1024,
             '{640,1080}'::int[], ${`${PREFIX}.webp`}
        from public.users u where u.email = 'admin@rede-demo.local'
      returning id::text as id`;
    hl.asset = asset?.id ?? '';
    createdAssetIds.push(hl.asset);
    const story = await post('/v1/stories', tokens.demoAdmin, {
      mediaAssetId: hl.asset,
      mediaKind: 'image',
      caption: `${PREFIX} destaque`,
    });
    expect(story.status).toBe(201);
    hl.story = ((await story.json()) as { id: string }).id;
    for (const [key, communityId, title] of [
      ['locked', fx.lockedCommunity, LOCKED_TITLE],
      ['open', fx.openCommunity, 'sg Aberto'],
    ] as const) {
      const created = await post('/v1/stories/highlights', tokens.demoAdmin, {
        title,
        communityId,
      });
      expect(created.status).toBe(201);
      hl[key] = ((await created.json()) as { id: string }).id;
      const added = await request(
        `/v1/stories/highlights/${hl[key]}/stories/${hl.story}`,
        tokens.demoAdmin,
        { method: 'PUT' },
      );
      expect(added.status).toBe(200);
    }
  });

  const withoutRequestId = (raw: string) => {
    const { requestId: _requestId, ...error } = (
      JSON.parse(raw) as Envelope & {
        error: { requestId?: string };
      }
    ).error;
    return JSON.stringify({ error });
  };

  it('D-355: the member without access gets the bare 404 on the locked row and detail, identical to a missing community, with no title or cover asset id', async () => {
    const list = await request(
      `/v1/stories/highlights?communityId=${fx.lockedCommunity}`,
      tokens.demoMember,
    );
    const detail = await request(`/v1/stories/highlights/${hl.locked}`, tokens.demoMember);
    const missing = await request(
      `/v1/stories/highlights?communityId=${crypto.randomUUID()}`,
      tokens.demoMember,
    );
    const bodies: string[] = [];
    for (const res of [list, detail, missing]) {
      expect(res.status).toBe(404);
      bodies.push(await res.text());
    }
    for (const raw of bodies) {
      const body = JSON.parse(raw) as Envelope;
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error).not.toHaveProperty('details');
      for (const needle of [LOCKED_TITLE, hl.asset, hl.story, hl.locked]) {
        expect(raw).not.toContain(needle);
      }
    }
    // The same answer as a community that does not exist (D-23): no existence oracle.
    expect(withoutRequestId(bodies[0] ?? '')).toBe(withoutRequestId(bodies[2] ?? ''));
    expect(withoutRequestId(bodies[1] ?? '')).toBe(withoutRequestId(bodies[2] ?? ''));

    // The open community's highlights stay readable for the same member.
    const open = await getJson<HighlightList>(
      `/v1/stories/highlights?communityId=${fx.openCommunity}`,
      tokens.demoMember,
    );
    expect(ids(open.items)).toContain(hl.open);
  });

  it('D-355: the holder, the admin and the support user read the locked row and detail in full', async () => {
    for (const token of [tokens.holder, tokens.demoAdmin, tokens.demoSupport]) {
      const list = await getJson<HighlightList>(
        `/v1/stories/highlights?communityId=${fx.lockedCommunity}`,
        token,
      );
      const item = list.items.find((entry) => entry.id === hl.locked);
      expect(item?.title).toBe(LOCKED_TITLE);
      expect(item?.coverAssetId).toBe(hl.asset);
      const detail = await getJson<HighlightDetail>(`/v1/stories/highlights/${hl.locked}`, token);
      expect(detail.highlight.id).toBe(hl.locked);
      expect(ids(detail.items)).toEqual([hl.story]);
    }
  });

  it('D-355: with the store off the member without access reads the row and the detail (200)', async () => {
    await withStoreOff(async () => {
      const list = await getJson<HighlightList>(
        `/v1/stories/highlights?communityId=${fx.lockedCommunity}`,
        tokens.demoMember,
      );
      expect(ids(list.items)).toContain(hl.locked);
      const detail = await getJson<HighlightDetail>(
        `/v1/stories/highlights/${hl.locked}`,
        tokens.demoMember,
      );
      expect(ids(detail.items)).toEqual([hl.story]);
    });
    // Back on: the bare 404 again.
    await expectBare404(await request(`/v1/stories/highlights/${hl.locked}`, tokens.demoMember));
  });

  it('highlight writes stay admin-only and ungated: the admin curates the locked place, the member is refused 403 as before', async () => {
    const renamed = await request(`/v1/stories/highlights/${hl.locked}`, tokens.demoAdmin, {
      method: 'PATCH',
      body: JSON.stringify({ title: LOCKED_TITLE }),
    });
    expect(renamed.status).toBe(200);
    const refused = await post('/v1/stories/highlights', tokens.demoMember, {
      title: 'sg Membro',
      communityId: fx.lockedCommunity,
    });
    expect(refused.status).toBe(403);
  });
});

describe('notifications', () => {
  /**
   * 08.2-04 / STORE-19 (P67) / Pitfall 6 / T-08.2-08 / T-08.2-23: the notifications worker lane runs
   * as `support_tenant`, for which the lane form of the gate is OPEN, so the feed's resolvers must ask
   * the gate about the RECIPIENTS. Proved against the real worker handlers (`runNotificationJobs`).
   *
   * This describe owns its community (`trancada-avisos`) and product, so the feed fixture's sample
   * and counts stay as `agreement` expects them. The holder buys this product too; a second buyer
   * (`revoked`) holds it, comments, and is then revoked.
   */
  const nx = { community: '', product: '', revoked: '', revokedToken: '' };

  type Row = { user_id: string; kind: string };

  async function rowsAbout(postId: string): Promise<Row[]> {
    return adminSql<Row[]>`
      select user_id::text as user_id, kind from public.notifications
       where tenant_id = ${demoTenantId}::uuid and subject_type = 'post'
         and subject_id = ${postId}::uuid
       order by kind, user_id`;
  }

  async function rowsAboutComment(commentId: string): Promise<Row[]> {
    return adminSql<Row[]>`
      select user_id::text as user_id, kind from public.notifications
       where tenant_id = ${demoTenantId}::uuid and object_type = 'comment'
         and object_id = ${commentId}::uuid
       order by kind, user_id`;
  }

  /** Every user a waiting `notifications.push-send` job for `dedupeKey` would push. */
  async function pushedFor(dedupeKey: string): Promise<string[]> {
    const jobs = (await pushSendJobsOf(demoTenantId)).filter(
      (job) => job.state === 'created' && job.data.dedupeKey === dedupeKey,
    );
    return jobs.flatMap((job) => job.data.userIds).sort();
  }

  /** Plays the worker for every fan-out job waiting in the demo tenant. */
  async function fanOut(): Promise<void> {
    expect(await runNotificationJobs(demoTenantId)).toBeGreaterThan(0);
  }

  async function closeWaitingJobs(): Promise<void> {
    await adminSql`
      update pgboss.job_common set state = 'completed', completed_on = now()
       where name in ('notifications.fanout', 'notifications.push-send') and state = 'created'
         and data->>'tenantId' = ${demoTenantId}`;
  }

  function subscribe(token: string, label: string) {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    return post('/v1/notifications/push-subscriptions', token, {
      endpoint: `${PUSH_FAKE}/${PREFIX}-${label}`,
      keys: {
        p256dh: ecdh.getPublicKey().toString('base64url'),
        auth: randomBytes(16).toString('base64url'),
      },
      userAgent: 'vitest',
    });
  }

  beforeAll(async () => {
    await closeWaitingJobs();
    nx.community = await createCommunity(`${PREFIX} trancada-avisos`);
    nx.product = (await createProduct(`${PREFIX} avisos`, [nx.community])).id;
    const revoked = await createSharedIdentity({ prefix: PREFIX, memberships: [{ host: 'demo' }] });
    nx.revoked = revoked.userId;
    nx.revokedToken = await signInAs(revoked.email, revoked.password);
    for (const token of [tokens.holder, nx.revokedToken]) {
      const bought = await post(`/v1/store/products/${nx.product}/purchase`, token, {
        expectedAmountCents: 1990,
      });
      expect(bought.status).toBe(200);
    }
    // Every member-role user under test has a live device, so "no push job" means "not chosen".
    for (const [token, label] of [
      [tokens.demoMember, 'member'],
      [tokens.holder, 'holder'],
      [nx.revokedToken, 'revoked'],
    ] as const) {
      expect((await subscribe(token, label)).status).toBeLessThan(300);
    }
  });

  afterAll(async () => {
    await closeWaitingJobs();
  });

  it('Pitfall 6 / T-08.2-08: a post in the locked community reaches the holder (one row, one push job) and gives the member without access no row and no push job', async () => {
    const caption = `${PREFIX} aviso-trancado ${crypto.randomUUID()}`;
    const postId = await publish(caption, { communityId: nx.community });
    await fanOut();

    const rows = await rowsAbout(postId);
    expect(rows.filter((row) => row.user_id === users.holder)).toEqual([
      { user_id: users.holder, kind: 'feed.community_post' },
    ]);
    expect(rows.filter((row) => row.user_id === users.demoMember)).toEqual([]);
    // Staff keep the member-only broadcast rule (D-229).
    expect(rows.map((row) => row.user_id)).not.toContain(users.demoSupport);
    expect(rows.map((row) => row.user_id)).not.toContain(users.demoAdmin);

    // Push follows in-app: the holder is pushed, the member without access is not.
    const pushed = await pushedFor(`feed.post:${postId}`);
    expect(pushed).toContain(users.holder);
    expect(pushed).not.toContain(users.demoMember);

    // The member's own bell carries nothing of it (no excerpt leaks through the API either).
    const bell = await request('/v1/notifications', tokens.demoMember);
    expect(bell.status).toBe(200);
    const text = await bell.text();
    expect(text).not.toContain(caption);
    expect(text).not.toContain(postId);
  });

  it('a reel in the locked community is gated the same way (feed.reel to the holder only)', async () => {
    const asset = await readyVideo(demoTenantId, 'admin@rede-demo.local');
    const postId = await publish(`${PREFIX} aviso-reel`, {
      communityId: nx.community,
      videoAssetId: asset,
    });
    await fanOut();
    const rows = await rowsAbout(postId);
    expect(rows.filter((row) => row.user_id === users.holder).map((row) => row.kind)).toEqual([
      'feed.reel',
    ]);
    expect(rows.filter((row) => row.user_id === users.demoMember)).toEqual([]);
    expect(await pushedFor(`feed.post:${postId}`)).not.toContain(users.demoMember);
  });

  it('a post in an open community still reaches the member without access and the holder (unchanged)', async () => {
    const postId = await publish(`${PREFIX} aviso-aberto`, { communityId: fx.openCommunity });
    await fanOut();
    const recipients = (await rowsAbout(postId)).map((row) => row.user_id);
    expect(recipients).toContain(users.demoMember);
    expect(recipients).toContain(users.holder);
    const pushed = await pushedFor(`feed.post:${postId}`);
    expect(pushed).toContain(users.demoMember);
    expect(pushed).toContain(users.holder);
  });

  it('STORE-19: a revoked buyer gets no reply and no comment-liked notification about their old comment; an active holder gets both', async () => {
    const hidden = await publish(`${PREFIX} aviso-comentarios`, { communityId: nx.community });
    const comment = async (token: string, body: string, parentId?: string) => {
      const res = await post(`/v1/feed/posts/${hidden}/comments`, token, {
        body,
        ...(parentId ? { parentId } : {}),
      });
      expect(res.status, `comment -> ${res.status}`).toBe(201);
      return ((await res.json()) as { id: string }).id;
    };
    const revokedRoot = await comment(nx.revokedToken, 'Comentario do comprador.');
    const holderRoot = await comment(tokens.holder, 'Comentario do titular.');

    // The revoke (the grant/revoke routes belong to a later plan): the ledger row, by the admin lane.
    await adminSql`
      update public.store_entitlements
         set status = 'revoked', revoked_at = now(), revoked_by_user_id = ${users.demoAdmin}::uuid
       where user_id = ${nx.revoked}::uuid and product_id = ${nx.product}::uuid`;

    const revokedReply = await comment(tokens.demoAdmin, 'Resposta ao comprador.', revokedRoot);
    const holderReply = await comment(tokens.demoAdmin, 'Resposta ao titular.', holderRoot);
    for (const id of [revokedRoot, holderRoot]) {
      const liked = await post(`/v1/feed/comments/${id}/like`, tokens.demoAdmin, {});
      expect(liked.status).toBe(200);
    }
    await fanOut();

    expect(await rowsAboutComment(revokedReply)).toEqual([]);
    expect(await rowsAboutComment(revokedRoot)).toEqual([]);
    expect(await pushedFor(`feed.comment_replied:${revokedReply}`)).toEqual([]);
    const [revokedTotal] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.notifications
       where tenant_id = ${demoTenantId}::uuid and user_id = ${nx.revoked}::uuid
         and kind in ('feed.comment_replied', 'feed.comment_liked')`;
    expect(revokedTotal?.n).toBe(0);

    // The control: the active holder receives both personal kinds, and the reply is pushed.
    expect(await rowsAboutComment(holderReply)).toEqual([
      { user_id: users.holder, kind: 'feed.comment_replied' },
    ]);
    expect(await rowsAboutComment(holderRoot)).toEqual([
      { user_id: users.holder, kind: 'feed.comment_liked' },
    ]);
    expect(await pushedFor(`feed.comment_replied:${holderReply}`)).toEqual([users.holder]);
  });

  it('with the store off the community-post broadcast is back to every member', async () => {
    await withStoreOff(async () => {
      const postId = await publish(`${PREFIX} aviso-loja-off`, { communityId: nx.community });
      await fanOut();
      const recipients = (await rowsAbout(postId)).map((row) => row.user_id);
      expect(recipients).toContain(users.demoMember);
      expect(recipients).toContain(users.holder);
      expect(await pushedFor(`feed.post:${postId}`)).toContain(users.demoMember);
    });
  });
});

describe('agreement', () => {
  /** `app.community_locked_ids_for(user)` in the admin SQL lane, with the tenant claim set. */
  async function lockedFor(userId: string): Promise<string[]> {
    const claims = JSON.stringify({ tenant_id: demoTenantId, sub: userId, role: 'authenticated' });
    const [row] = await adminSql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${claims}, true)`;
      return tx<{ ids: string[] }[]>`
        select app.community_locked_ids_for(${userId}::uuid)::text[] as ids`;
    });
    return row?.ids ?? [];
  }

  const roles = () =>
    [
      ['member-without', tokens.demoMember, users.demoMember],
      ['member-holder', tokens.holder, users.holder],
      ['admin', tokens.demoAdmin, users.demoAdmin],
      ['support', tokens.demoSupport, users.demoSupport],
    ] as const;

  it('every feed answer agrees with app.community_locked_ids_for, per role and per community', async () => {
    const openPosts = await adminSql<{ id: string }[]>`
      select id::text as id from public.feed_posts
       where community_id = ${fx.openCommunity}::uuid and deleted_at is null
       order by created_at desc, id desc`;
    const openAll = openPosts.map((row) => row.id);
    const communities = [
      {
        id: fx.lockedCommunity,
        newest: fx.sample,
        hidden: fx.hiddenText,
        all: [fx.sample, fx.hiddenLink, fx.hiddenVideo, fx.hiddenText],
        video: fx.sample as string | null,
      },
      {
        id: fx.openCommunity,
        newest: openAll[0] ?? '',
        hidden: fx.openPost,
        all: openAll,
        video: null as string | null,
      },
    ];

    const seen: Record<string, boolean[]> = { [fx.lockedCommunity]: [], [fx.openCommunity]: [] };
    for (const [role, token, userId] of roles()) {
      const locked = await lockedFor(userId);
      const inicio = ids(await walk('/v1/feed?limit=25', token));
      const reels = ids(await walk('/v1/feed?media=video&limit=25', token));
      for (const c of communities) {
        const isLocked = locked.includes(c.id);
        seen[c.id]?.push(isLocked);
        const label = `${role} / ${c.id === fx.lockedCommunity ? 'locked' : 'open'}`;

        // Início: none of its posts when locked; every one when not.
        for (const id of c.all) {
          expect(inicio.includes(id), `${label}: Início ${id}`).toBe(!isLocked);
        }
        // Reels: its ready video only when not locked.
        if (c.video) expect(reels.includes(c.video), `${label}: Reels`).toBe(!isLocked);

        // The community page: the marked sample and a count, or every post unmarked.
        const page = await getJson<FeedPage>(`/v1/feed?communityId=${c.id}`, token);
        if (isLocked) {
          expect(ids(page.items), `${label}: page`).toEqual([c.newest]);
          expect(page.items[0]?.access).toBe('sample');
          expect(page.lockedCount).toBe(c.all.length - 1);
        } else {
          expect(ids(page.items), `${label}: page`).toEqual(c.all);
          expect(page.items.every((item) => item.access === undefined)).toBe(true);
          expect(page).not.toHaveProperty('lockedCount');
        }

        // getPost on a non-newest post: 403 community_locked when locked, 200 when not.
        const got = await request(`/v1/feed/posts/${c.hidden}`, token);
        expect(got.status, `${label}: getPost`).toBe(isLocked && c.hidden !== c.newest ? 403 : 200);

        // Like on the newest post: 403 when locked; 200 when not (and put back).
        const like = await request(`/v1/feed/posts/${c.newest}/like`, token, { method: 'POST' });
        expect(like.status, `${label}: like`).toBe(isLocked ? 403 : 200);
        if (!isLocked) {
          const unlike = await request(`/v1/feed/posts/${c.newest}/like`, token, {
            method: 'DELETE',
          });
          expect(unlike.status).toBe(200);
        }
      }
    }

    // The matrix is not vacuous: only member-without is locked out of the locked community, and
    // nobody is locked out of the open one.
    expect(seen[fx.lockedCommunity]).toEqual([true, false, false, false]);
    expect(seen[fx.openCommunity]).toEqual([false, false, false, false]);
  });
});
