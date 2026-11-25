import fs from 'node:fs';
import { sqlClient } from '@rede-social/core/db';
import { withTenantTx } from '@rede-social/core/db/tenant-tx';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import {
  COMMUNITY_POSTS_PER_HOUR,
  memberCommunityPostLimiter,
  safetyLimiterKey,
} from '@rede-social/core/server/safety/limits';
import type {
  FeedComment,
  FeedPage,
  FeedPost,
  LikeResult,
} from '@rede-social/module-feed/contracts';
import { feedNotificationSources } from '@rede-social/module-feed/server';
import { notificationsSystemCtx } from '@rede-social/module-notifications/server';
import type { ProductDetail } from '@rede-social/module-store/contracts';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
 * 11.1-08 (D-880, D-881, D-882, D-888, D-891, D-896, UI-D-889; BPERM-06..10, BPERM-16, BPERM-25, BPERM-26): the feed SERVICE
 * half of buyer permissions against the live local stack and the real seed. The service refuses an action the buyer lacks
 * with ONE bare 403 before any write; the buyer's post path keeps its limiter; each post carries the viewer's own
 * `community.actions` only when something is withheld.
 *
 * Fixture (built in `beforeAll`, every name and caption prefixed `bpf-<run>`): in `rede-demo` with `store` and `social` ON,
 * two organization communities made by the seed admin (`orgA`, linked to a product, and `bare`, linked to nothing), a
 * product linked to `orgA`, a second product linked to it, three throwaway members of rede-demo: the buyer (holds the first
 * product through the real purchase route), a reader (holds nothing, so `orgA` is locked for them) and a second buyer.
 * The link flags and the entitlement status are written through the owner connection (the product form is a later plan).
 *
 * Test ORDER inside each describe is load-bearing (declaration order); every case sets the state it needs.
 */

type Envelope = { error: { code: string; message?: string; details?: Record<string, unknown> } };

const RUN = Date.now();
const PREFIX = `bpf-${RUN}`;

const tokens = { admin: '', buyer: '', reader: '' };
const users = { buyer: '', reader: '' };
let tenantId = '';
let labTenantId = '';
let restoreStore: () => Promise<void> = async () => {};
let restoreSocial: () => Promise<void> = async () => {};
const fx = {
  orgA: '',
  bare: '',
  productA: '',
  productB: '',
  adminPostA: '',
  adminPostBare: '',
  foreignPost: '',
  adminComment: '',
};
const VIDEO_FILENAME = 'bpf-reel.mp4';
/** A product name with accents: it must never appear in a refusal body or a log line (D-888, NFC and NFD). */
const PRODUCT_NAME = `${PREFIX} Açaí Café Ação`;
const FLAG_WORDS = [
  'Curtir',
  'Comentar',
  'can_like',
  'can_comment',
  'can_post',
  'canLike',
  'canPost',
];

const request = (path: string, token: string, init: RequestInit = {}) =>
  api.request(path, {
    ...init,
    headers: {
      'x-tenant-host': HOSTS.demo,
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });

const post = (path: string, token: string, body?: unknown) =>
  request(path, token, {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const del = (path: string, token: string) => request(path, token, { method: 'DELETE' });

const likePost = (token: string, postId: string) => post(`/v1/feed/posts/${postId}/like`, token);

async function sweep(): Promise<void> {
  const products = adminSql`select id from public.store_products where name like ${`${PREFIX}%`}`;
  const communities = adminSql`select id from public.communities where name like ${`${PREFIX}%`}`;
  await dropRaceTriggers();
  await adminSql`delete from public.stories where caption like ${`${PREFIX}%`}`;
  await adminSql`delete from public.feed_posts where caption like ${`${PREFIX}%`}`;
  await adminSql`delete from public.feed_posts where community_id in (${communities})`;
  await adminSql`delete from public.feed_posts where id in (select post_id from public.feed_post_media where media_asset_id in (select id from public.media_assets where filename = ${VIDEO_FILENAME}))`;
  await adminSql`delete from public.media_assets where filename = ${VIDEO_FILENAME}`;
  await adminSql`delete from public.store_entitlements where product_id in (${products})`;
  await adminSql`delete from public.store_orders where product_id in (${products})`;
  await adminSql`delete from public.store_products where name like ${`${PREFIX}%`}`;
  await adminSql`delete from public.communities where name like ${`${PREFIX}%`}`;
  await removeIdentitiesByPrefix(PREFIX);
}

/** Temporary triggers the race cases install; dropped by every sweep so a crashed run leaves nothing behind. */
async function dropRaceTriggers(): Promise<void> {
  await adminSql`drop trigger if exists bpf_raise_42501 on public.feed_likes`;
  await adminSql`drop function if exists public.bpf_raise_42501()`;
}

/** The five flags of the ONE link (productA x orgA); the three read-only ones default to today's behaviour. */
const setFlags = (
  flags: Partial<Record<'like' | 'comment' | 'share' | 'post' | 'story', boolean>>,
  product = fx.productA,
) =>
  adminSql`
    update public.store_product_communities
       set can_like = ${flags.like ?? true}, can_comment = ${flags.comment ?? true},
           can_share = ${flags.share ?? true}, can_post = ${flags.post ?? false},
           can_story = ${flags.story ?? false}
     where product_id = ${product}::uuid and community_id = ${fx.orgA}::uuid`;

const unlikePost = (token: string, postId: string) => del(`/v1/feed/posts/${postId}/like`, token);
const likeComment = (token: string, commentId: string) =>
  post(`/v1/feed/comments/${commentId}/like`, token);
const unlikeComment = (token: string, commentId: string) =>
  del(`/v1/feed/comments/${commentId}/like`, token);
const commentOn = (token: string, postId: string, body: string, parentId?: string) =>
  post(`/v1/feed/posts/${postId}/comments`, token, parentId ? { body, parentId } : { body });

const likeRowsOf = async (postId: string, userId: string): Promise<number> => {
  const rows = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.feed_likes
     where post_id = ${postId}::uuid and user_id = ${userId}::uuid`;
  return rows[0]?.n ?? 0;
};

/** A post of the seed admin in `community`, through the real route (organization voice, `tenant` visibility). */
async function adminPost(community: string, label: string): Promise<string> {
  const res = await post('/v1/feed/posts', tokens.admin, {
    caption: `${PREFIX} ${label}`,
    communityId: community,
  });
  expect(res.status, `admin post ${label} -> ${await res.clone().text()}`).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  await sweep();
  restoreStore = await withStoreEnabled('demo');
  restoreSocial = await withSocialEnabled('demo');
  const tenants = await adminSql<{ id: string; slug: string }[]>`
    select id::text as id, slug from public.tenants where slug in ('rede-demo', 'rede-lab')`;
  tenantId = tenants.find((t) => t.slug === 'rede-demo')?.id ?? '';
  labTenantId = tenants.find((t) => t.slug === 'rede-lab')?.id ?? '';
  tokens.admin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);

  const buyer = await createSharedIdentity({ prefix: PREFIX, memberships: [{ host: 'demo' }] });
  const reader = await createSharedIdentity({ prefix: PREFIX, memberships: [{ host: 'demo' }] });
  users.buyer = buyer.userId;
  users.reader = reader.userId;
  tokens.buyer = await signInAs(buyer.email, buyer.password);
  tokens.reader = await signInAs(reader.email, reader.password);

  const orgA = await post('/v1/communities', tokens.admin, { name: `${PREFIX} orgA` });
  expect(orgA.status).toBe(201);
  fx.orgA = ((await orgA.json()) as { id: string }).id;
  const bare = await post('/v1/communities', tokens.admin, { name: `${PREFIX} bare` });
  expect(bare.status).toBe(201);
  fx.bare = ((await bare.json()) as { id: string }).id;

  const product = await post('/v1/store/products', tokens.admin, {
    name: PRODUCT_NAME,
    priceCents: 1990,
    communityIds: [fx.orgA],
  });
  expect(product.status).toBe(201);
  fx.productA = ((await product.json()) as ProductDetail).id;
  const productB = await post('/v1/store/products', tokens.admin, {
    name: `${PREFIX} produto B`,
    priceCents: 990,
    communityIds: [fx.orgA],
  });
  expect(productB.status).toBe(201);
  fx.productB = ((await productB.json()) as ProductDetail).id;
  // B grants nothing until a case ticks it: a link written with no flag reads the defaults (like, comment, share on)
  await setFlags({ like: false, comment: false, share: false }, fx.productB);
  const bought = await post(`/v1/store/products/${fx.productA}/purchase`, tokens.buyer, {
    expectedAmountCents: 1990,
  });
  expect(bought.status, `purchase -> ${bought.status}`).toBe(200);

  // the posts the cases act on: the admin's, in each community (the newest tenant post of orgA is also its free sample)
  fx.adminPostA = await adminPost(fx.orgA, 'post da org A');
  fx.adminPostBare = await adminPost(fx.bare, 'post da comunidade sem produto');
  const adminComment = await commentOn(
    tokens.admin,
    fx.adminPostA,
    `${PREFIX} comentario do admin`,
  );
  expect(adminComment.status).toBe(201);
  fx.adminComment = ((await adminComment.json()) as FeedComment).id;

  // a post of ANOTHER tenant, written through the owner connection
  const [labAuthor] = await adminSql<{ user_id: string }[]>`
    select user_id::text as user_id from public.memberships
     where tenant_id = ${labTenantId}::uuid and role = 'admin_tenant' limit 1`;
  const [foreign] = await adminSql<{ id: string }[]>`
    insert into public.feed_posts (tenant_id, author_user_id, caption)
    values (${labTenantId}::uuid, ${labAuthor?.user_id ?? null}::uuid, ${`${PREFIX} de outro tenant`})
    returning id::text as id`;
  fx.foreignPost = foreign?.id ?? '';
});

afterAll(async () => {
  await sweep();
  await lockSql.end();
  await restoreSocial();
  await restoreStore();
  await adminSql.end();
  await sqlClient.end();
});

const envelope = async (res: Response) => (await res.json()) as Envelope;

/** A refusal body as bytes: the request id is per request, so it is the one field dropped before comparing. */
async function bytesOf(res: Response): Promise<string> {
  const body = (await res.json()) as Envelope & { error: { requestId?: string } };
  const { requestId: _requestId, ...error } = body.error;
  return JSON.stringify({ error });
}

/**
 * Everything the process wrote to its log descriptors while `fn` ran (the API logs in-process through pino, whose
 * destination writes with `fs.write` asynchronously, so the spy stays on a moment after `fn` resolved).
 */
async function captured<T>(fn: () => Promise<T>): Promise<{ value: T; lines: string }> {
  const chunks: string[] = [];
  const realWrite = fs.write;
  const realWriteSync = fs.writeSync;
  const writeSpy = vi.spyOn(fs, 'write').mockImplementation(((fd: number, ...args: unknown[]) => {
    if (fd !== 1 && fd !== 2) return (realWrite as (...a: unknown[]) => void)(fd, ...args);
    const data = String(args[0]);
    chunks.push(data);
    const callback = args.find((arg) => typeof arg === 'function') as
      | ((error: null, written: number) => void)
      | undefined;
    callback?.(null, Buffer.byteLength(data));
  }) as never);
  const syncSpy = vi.spyOn(fs, 'writeSync').mockImplementation(((
    fd: number,
    ...args: unknown[]
  ) => {
    if (fd !== 1 && fd !== 2) return (realWriteSync as (...a: unknown[]) => number)(fd, ...args);
    chunks.push(String(args[0]));
    return Buffer.byteLength(String(args[0]));
  }) as never);
  try {
    const value = await fn();
    await sleep(150);
    return { value, lines: chunks.join('') };
  } finally {
    writeSpy.mockRestore();
    syncSpy.mockRestore();
  }
}

/** Fails when `text` carries anything that names the product, a flag, the community or an entitlement. */
function expectNothingNamed(text: string, where: string, withCommunity: boolean) {
  const forbidden = [
    PRODUCT_NAME,
    PRODUCT_NAME.normalize('NFD'),
    fx.productA,
    fx.productB,
    ...FLAG_WORDS,
    ...(withCommunity ? [fx.orgA] : []),
  ];
  for (const word of forbidden) {
    expect(text.includes(word), `${where} must not carry "${word}"`).toBe(false);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const lockSql = postgres('postgres://postgres:postgres@127.0.0.1:54322/postgres', {
  prepare: false,
  max: 1,
});

/**
 * The race of D-888 / Pitfall 3, made deterministic: a SECOND connection holds an ACCESS EXCLUSIVE lock on the table the
 * write inserts into, `send` fires the request (the guard passes, the insert blocks on the lock), and only then the flip
 * commits and the lock goes. The insert statement therefore starts AFTER the revoke committed, exactly like a revoke
 * landing between the guard and the write.
 */
async function raceBetweenGuardAndWrite(
  table: 'feed_likes' | 'feed_comments',
  flipSql: string,
  send: () => Promise<Response> | Response,
): Promise<Response> {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked: () => void = () => {};
  const lockedP = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const holder = lockSql.begin(async (tx) => {
    await tx.unsafe(`lock table public.${table} in access exclusive mode`);
    locked();
    await gate;
    await tx.unsafe(flipSql);
  });
  await lockedP;
  const pending = send();
  let blocked = false;
  for (let i = 0; i < 100 && !blocked; i += 1) {
    const rows = await adminSql`
      select 1 from pg_stat_activity
       where wait_event_type = 'Lock' and query ilike ${`%insert into ${table}%`}
         and pid <> pg_backend_pid()`;
    blocked = rows.length > 0;
    if (!blocked) await sleep(50);
  }
  release();
  await holder;
  expect(
    blocked,
    `the ${table} insert must have been waiting on the lock (the guard already passed)`,
  ).toBe(true);
  return await pending;
}

describe('11.1-08 tracer: a buyer without like is refused with a bare 403 before any write', () => {
  it('1. D-888/D-891 TRACER: without like the buyer is a bare 403 (no details) and no row is written; with like it is accepted; staff and a community with no linked product are controls', async () => {
    await setFlags({ like: false });
    const refused = await likePost(tokens.buyer, fx.adminPostA);
    expect(refused.status).toBe(403);
    const body = await envelope(refused);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error).not.toHaveProperty('details');
    expect(await likeRowsOf(fx.adminPostA, users.buyer)).toBe(0);

    await setFlags({ like: true });
    const accepted = await likePost(tokens.buyer, fx.adminPostA);
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    expect(((await accepted.json()) as LikeResult).liked).toBe(true);
    expect(await likeRowsOf(fx.adminPostA, users.buyer)).toBe(1);

    // controls: staff in the same community, and the buyer in a community with no linked product, with like off
    await setFlags({ like: false });
    expect((await likePost(tokens.admin, fx.adminPostA)).status).toBe(200);
    expect((await likePost(tokens.buyer, fx.adminPostBare)).status).toBe(200);
  });

  it('2. D-888 ordering: a locked member keeps the community_locked refusal, and a post id of another tenant answers 404, never 403', async () => {
    await setFlags({ like: false });
    const locked = await likePost(tokens.reader, fx.adminPostA);
    expect(locked.status).toBe(403);
    const body = await envelope(locked);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.details).toEqual({ access: 'community_locked' });

    for (const token of [tokens.buyer, tokens.reader, tokens.admin]) {
      const foreign = await likePost(token, fx.foreignPost);
      expect(foreign.status).toBe(404);
      expect((await envelope(foreign)).error).not.toHaveProperty('details');
    }
    await setFlags({});
  });
});

describe('11.1-08 expansion: comment, reply, comment hearts, the 42501 maps and the bare-body matrix', () => {
  it('3. D-888: a buyer without comment is a bare 403 on a root comment and on a reply, nothing is written; with comment both are 201', async () => {
    await setFlags({ comment: false });
    const root = await commentOn(tokens.buyer, fx.adminPostA, `${PREFIX} sem permissao`);
    expect(root.status).toBe(403);
    expect((await envelope(root)).error).not.toHaveProperty('details');
    const reply = await commentOn(
      tokens.buyer,
      fx.adminPostA,
      `${PREFIX} resposta`,
      fx.adminComment,
    );
    expect(reply.status).toBe(403);
    expect((await envelope(reply)).error).not.toHaveProperty('details');
    const [written] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_comments where author_user_id = ${users.buyer}::uuid`;
    expect(written?.n).toBe(0);

    await setFlags({ comment: true });
    const rootOk = await commentOn(tokens.buyer, fx.adminPostA, `${PREFIX} com permissao`);
    expect(rootOk.status, await rootOk.clone().text()).toBe(201);
    const replyOk = await commentOn(
      tokens.buyer,
      fx.adminPostA,
      `${PREFIX} resposta ok`,
      fx.adminComment,
    );
    expect(replyOk.status, await replyOk.clone().text()).toBe(201);

    // controls: staff in the same community, and the buyer where no product is linked, with comment off
    await setFlags({ comment: false });
    expect((await commentOn(tokens.admin, fx.adminPostA, `${PREFIX} do admin`)).status).toBe(201);
    expect((await commentOn(tokens.buyer, fx.adminPostBare, `${PREFIX} sem produto`)).status).toBe(
      201,
    );
  });

  it('4. D-888/D-891: comment hearts follow like: refused both ways without it, accepted with it, and a story comment still answers 400 story_comment_not_likeable', async () => {
    await setFlags({ like: false });
    const refused = await likeComment(tokens.buyer, fx.adminComment);
    expect(refused.status).toBe(403);
    expect((await envelope(refused)).error).not.toHaveProperty('details');
    const refusedUnlike = await unlikeComment(tokens.buyer, fx.adminComment);
    expect(refusedUnlike.status).toBe(403);
    expect((await envelope(refusedUnlike)).error).not.toHaveProperty('details');
    const [none] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_likes
       where comment_id = ${fx.adminComment}::uuid and user_id = ${users.buyer}::uuid`;
    expect(none?.n).toBe(0);

    await setFlags({ like: true });
    const ok = await likeComment(tokens.buyer, fx.adminComment);
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(((await ok.json()) as LikeResult).liked).toBe(true);
    expect((await unlikeComment(tokens.buyer, fx.adminComment)).status).toBe(200);

    // a STORY comment is no post comment: the denied test is skipped and the database constraint answers its own 400
    await setFlags({ like: false });
    const [asset] = await adminSql<{ id: string }[]>`
      select id::text as id from public.media_assets
       where tenant_id = ${tenantId}::uuid and kind = 'image' limit 1`;
    const [adminUser] = await adminSql<{ id: string }[]>`
      select id::text as id from public.users where email = 'admin@rede-demo.local'`;
    const [story] = await adminSql<{ id: string }[]>`
      insert into public.stories (tenant_id, author_user_id, media_asset_id, media_kind, caption)
      values (${tenantId}::uuid, ${adminUser?.id ?? null}::uuid, ${asset?.id ?? null}::uuid, 'image', ${`${PREFIX} story`})
      returning id::text as id`;
    const [storyComment] = await adminSql<{ id: string }[]>`
      insert into public.feed_comments (tenant_id, story_id, author_user_id, body)
      values (${tenantId}::uuid, ${story?.id ?? null}::uuid, ${adminUser?.id ?? null}::uuid, ${`${PREFIX} comentario de story`})
      returning id::text as id`;
    const storyLike = await likeComment(tokens.buyer, storyComment?.id ?? '');
    expect(storyLike.status).toBe(400);
    expect((await envelope(storyLike)).error.details).toEqual({
      like: 'story_comment_not_likeable',
    });
  });

  it('5. D-887/D-888: unlike is refused for a buyer who lost like (the like stays), while removing ones own post and comment is never gated', async () => {
    await setFlags({ like: true, comment: true, post: true });
    expect((await likePost(tokens.buyer, fx.adminPostA)).status).toBe(200);
    const ownPost = await post('/v1/feed/posts', tokens.buyer, {
      caption: `${PREFIX} do comprador para apagar`,
      communityId: fx.orgA,
    });
    expect(ownPost.status, await ownPost.clone().text()).toBe(201);
    const ownPostId = ((await ownPost.json()) as { id: string }).id;
    const ownComment = await commentOn(tokens.buyer, fx.adminPostA, `${PREFIX} meu comentario`);
    expect(ownComment.status).toBe(201);
    const ownCommentId = ((await ownComment.json()) as FeedComment).id;

    await setFlags({ like: false, comment: false, post: false });
    const refused = await unlikePost(tokens.buyer, fx.adminPostA);
    expect(refused.status).toBe(403);
    expect((await envelope(refused)).error).not.toHaveProperty('details');
    expect(await likeRowsOf(fx.adminPostA, users.buyer)).toBe(1);

    expect((await del(`/v1/feed/comments/${ownCommentId}`, tokens.buyer)).status).toBe(200);
    expect((await del(`/v1/feed/posts/${ownPostId}`, tokens.buyer)).status).toBe(200);
  });

  it('6. UI-D-890: reading is never reduced: a buyer with every flag unticked still lists the comments of the post', async () => {
    await setFlags({ like: false, comment: false, share: false, post: false, story: false });
    const res = await request(`/v1/feed/posts/${fx.adminPostA}/comments`, tokens.buyer);
    expect(res.status, await res.clone().text()).toBe(200);
    const page = (await res.json()) as { items: FeedComment[] };
    expect(page.items.map((item) => item.id)).toContain(fx.adminComment);
    expect((await request(`/v1/feed/posts/${fx.adminPostA}`, tokens.buyer)).status).toBe(200);
  });

  it('7. D-888 matrix: a missing flag and a revoked entitlement refuse with the SAME bytes for like, comment, comment heart and post; nothing names a product or a flag; locked keeps its own code', async () => {
    const refusals = async () => {
      const like = await likePost(tokens.buyer, fx.adminPostA);
      const comment = await commentOn(tokens.buyer, fx.adminPostA, `${PREFIX} matriz`);
      const heart = await likeComment(tokens.buyer, fx.adminComment);
      const created = await post('/v1/feed/posts', tokens.buyer, {
        caption: `${PREFIX} matriz`,
        communityId: fx.orgA,
      });
      for (const res of [like, comment, heart, created]) expect(res.status).toBe(403);
      return Promise.all([like, comment, heart, created].map((res) => bytesOf(res)));
    };

    // S1: the product the buyer holds ticks nothing and no other product is held
    await setFlags({ like: false, comment: false, share: false, post: false });
    const missing = await captured(refusals);

    // S2: a second product grants everything, the buyer holds it (accepted), then its entitlement is revoked
    const bought = await post(`/v1/store/products/${fx.productB}/purchase`, tokens.buyer, {
      expectedAmountCents: 990,
    });
    expect(bought.status, `purchase B -> ${bought.status}`).toBe(200);
    await setFlags({ like: true, comment: true, share: true, post: true }, fx.productB);
    expect((await likePost(tokens.buyer, fx.adminPostA)).status).toBe(200);
    expect((await commentOn(tokens.buyer, fx.adminPostA, `${PREFIX} via B`)).status).toBe(201);
    await adminSql`
      update public.store_entitlements set status = 'revoked'
       where product_id = ${fx.productB}::uuid and user_id = ${users.buyer}::uuid`;
    const revoked = await captured(refusals);

    expect(revoked.value).toEqual(missing.value);
    for (const bytes of missing.value) {
      expect(JSON.parse(bytes).error).not.toHaveProperty('details');
      expectNothingNamed(bytes, 'a refusal body', true);
      expectNothingNamed(bytes.normalize('NFD'), 'a refusal body (NFD)', true);
    }
    expect(missing.lines).toContain('"status":403');
    expect(revoked.lines).toContain('"status":403');
    expectNothingNamed(missing.lines, 'the log lines of a missing flag', false);
    expectNothingNamed(revoked.lines, 'the log lines of a revoked entitlement', false);

    // locked keeps its own code: it differs from the bare one and still carries its single detail
    const locked = await likePost(tokens.reader, fx.adminPostA);
    expect(locked.status).toBe(403);
    const lockedBytes = await bytesOf(locked);
    expect(JSON.parse(lockedBytes).error.details).toEqual({ access: 'community_locked' });
    expect(missing.value[0]).not.toBe(lockedBytes);
    await setFlags({}, fx.productB);
  });

  it('8. Pitfall 3: a revoke committing between the guard and the write is the bare 403 for a member; the same 42501 for staff stays a 500', async () => {
    await setFlags({ like: true, comment: true, post: true });
    await adminSql`delete from public.feed_likes where user_id = ${users.buyer}::uuid`;
    const flipLike = `update public.store_product_communities set can_like = false
                       where product_id = '${fx.productA}'::uuid`;
    const raced = await raceBetweenGuardAndWrite('feed_likes', flipLike, () =>
      likePost(tokens.buyer, fx.adminPostA),
    );
    expect(raced.status).toBe(403);
    expect((await envelope(raced)).error).not.toHaveProperty('details');
    expect(await likeRowsOf(fx.adminPostA, users.buyer)).toBe(0);

    await setFlags({ like: true, comment: true });
    const racedHeart = await raceBetweenGuardAndWrite('feed_likes', flipLike, () =>
      likeComment(tokens.buyer, fx.adminComment),
    );
    expect(racedHeart.status).toBe(403);
    expect((await envelope(racedHeart)).error).not.toHaveProperty('details');

    await setFlags({ like: true, comment: true });
    const flipComment = `update public.store_product_communities set can_comment = false
                          where product_id = '${fx.productA}'::uuid`;
    const racedComment = await raceBetweenGuardAndWrite('feed_comments', flipComment, () =>
      commentOn(tokens.buyer, fx.adminPostA, `${PREFIX} corrida`),
    );
    expect(racedComment.status).toBe(403);
    expect((await envelope(racedComment)).error).not.toHaveProperty('details');

    // staff: a 42501 raised for the admin is NEVER masked (a real policy bug stays a 500)
    const [adminUser] = await adminSql<{ id: string }[]>`
      select id::text as id from public.users where email = 'admin@rede-demo.local'`;
    await adminSql.unsafe(`
      create or replace function public.bpf_raise_42501() returns trigger language plpgsql as $f$
      begin raise exception 'bpf staff refusal' using errcode = '42501'; end $f$`);
    await adminSql.unsafe(`
      create trigger bpf_raise_42501 before insert on public.feed_likes
        for each row when (new.user_id = '${adminUser?.id}'::uuid) execute function public.bpf_raise_42501()`);
    try {
      await adminSql`delete from public.feed_likes where user_id = ${adminUser?.id ?? null}::uuid`;
      const staff = await likePost(tokens.admin, fx.adminPostBare);
      expect(staff.status).toBe(500);
    } finally {
      await dropRaceTriggers();
    }
    await setFlags({});
  });
});

/** Runs `fn` with the demo module `social` switched to `enabled`, then writes it back ON. */
async function withSocial<T>(enabled: boolean, fn: () => Promise<T> | T): Promise<T> {
  const set = async (value: boolean) => {
    await adminSql`
      update public.tenant_modules set enabled = ${value}, updated_at = now()
       where tenant_id = ${tenantId}::uuid and module_key = 'social'`;
    moduleFlags.invalidate(tenantId);
  };
  await set(enabled);
  try {
    return await fn();
  } finally {
    await set(true);
  }
}

const ids = (posts: FeedPost[]): string[] => posts.map((item) => item.id);
const feedOf = async (token: string, query: string): Promise<FeedPost[]> => {
  const res = await request(`/v1/feed?${query}`, token);
  expect(res.status, `GET /v1/feed?${query} -> ${await res.clone().text()}`).toBe(200);
  return ((await res.json()) as FeedPage).items;
};
const publish = (token: string, caption: string, communityId?: string) =>
  post('/v1/feed/posts', token, communityId ? { caption, communityId } : { caption });

/** A member-created community owned by `owner`, written through the owner connection. */
async function memberCommunity(owner: string, label: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.communities (tenant_id, created_by_user_id, name, slug, kind, position)
    values (${tenantId}::uuid, ${owner}::uuid, ${`${PREFIX} ${label}`}, ${`${PREFIX}-${label}`}, 'member', 1000000)
    returning id::text as id`;
  return row?.id ?? '';
}

describe('11.1-08 the buyer post branch: absent from every tenant list, silent, limited and negative-proof', () => {
  const made: { post?: FeedPost; video?: string } = {};

  it('9. D-880/D-881: a buyer with post publishes a community-only post: on the community page for a reader who holds the product, absent from Inicio, Explorar and Reels for everyone, and nobody is notified', async () => {
    memberCommunityPostLimiter.reset();
    await setFlags({ post: true });
    const bought = await post(`/v1/store/products/${fx.productA}/purchase`, tokens.reader, {
      expectedAmountCents: 1990,
    });
    expect(bought.status, `purchase reader -> ${bought.status}`).toBe(200);

    const res = await publish(tokens.buyer, `${PREFIX} do comprador listas`, fx.orgA);
    expect(res.status, await res.clone().text()).toBe(201);
    made.post = (await res.json()) as FeedPost;
    const [stored] = await adminSql<{ visibility: string }[]>`
      select visibility from public.feed_posts where id = ${made.post.id}::uuid`;
    expect(stored?.visibility).toBe('community');

    // a ready video of the buyer in the same community, written through the owner connection (the Reels lane's fixture)
    const [asset] = await adminSql<{ id: string }[]>`
      insert into public.media_assets
        (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, playback_id,
         mime, bytes, width, height, duration_seconds, aspect_ratio, filename, ready_at)
      values (${tenantId}::uuid, ${users.buyer}::uuid, 'video', 'post', 'ready', 'fake',
              ${`fake-${crypto.randomUUID()}`}, ${`pb-${crypto.randomUUID()}`},
              'video/mp4', 1048576, 1080, 1920, 15, '9:16', ${VIDEO_FILENAME}, now())
      returning id::text as id`;
    const [video] = await adminSql<{ id: string }[]>`
      insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, media_kind, community_id)
      values (${tenantId}::uuid, ${users.buyer}::uuid, ${`${PREFIX} video do comprador`}, 'community', 'video', ${fx.orgA}::uuid)
      returning id::text as id`;
    made.video = video?.id;
    await adminSql`
      insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
      values (${tenantId}::uuid, ${made.video ?? null}::uuid, 'video', ${asset?.id ?? null}::uuid, 'video', 0)`;

    // present on the community page for whoever can read the community
    for (const token of [tokens.reader, tokens.buyer]) {
      expect(ids(await feedOf(token, `communityId=${fx.orgA}&limit=25`))).toContain(made.post.id);
    }
    // absent from Inicio, Explorar and the Reels lane, for the buyer AND for the other member
    for (const token of [tokens.buyer, tokens.reader]) {
      for (const query of ['limit=25', 'scope=explorar&limit=25', 'media=video&limit=25']) {
        const listed = ids(await feedOf(token, query));
        expect(listed, `${query}`).not.toContain(made.post.id);
        expect(listed, `${query}`).not.toContain(made.video ?? '');
      }
    }

    // nobody is told: the worker's resolver answers no intent for it, beside the positive control of an organization post
    const source = feedNotificationSources[0];
    if (!source) throw new Error('feed declares no post.published source');
    const resolveFor = (postId: string, authorUserId: string, communityId: string) =>
      withTenantTx(notificationsSystemCtx(tenantId), (tx) =>
        source.resolve(
          tx,
          {
            tenantId,
            postId,
            authorUserId,
            communityId,
            hasMedia: false,
            occurredAt: new Date().toISOString(),
          },
          { sinkAt: new Date().toISOString() },
        ),
      );
    expect(await resolveFor(made.post.id, users.buyer, fx.orgA)).toEqual([]);
    const [adminUser] = await adminSql<{ id: string }[]>`
      select id::text as id from public.users where email = 'admin@rede-demo.local'`;
    expect(
      (await resolveFor(fx.adminPostA, adminUser?.id ?? '', fx.orgA)).length,
      'the organization post keeps its intent (positive control)',
    ).toBe(1);
    const rows = await adminSql`
      select 1 from public.notifications where subject_id = ${made.post.id}::uuid`;
    expect(rows).toHaveLength(0);
  });

  it('10. D-880/T-11.1-31: without post, in a member community that is not theirs, archived, in another tenant, or with social off the buyer is refused; the buyer with post posts beside each', async () => {
    await setFlags({ post: false });
    const noFlag = await publish(tokens.buyer, `${PREFIX} sem flag`, fx.orgA);
    expect(noFlag.status).toBe(403);
    expect((await envelope(noFlag)).error).not.toHaveProperty('details');

    await setFlags({ post: true });
    expect((await publish(tokens.buyer, `${PREFIX} com flag`, fx.orgA)).status).toBe(201);

    const readers = await memberCommunity(users.reader, 'membro');
    const notTheirs = await publish(tokens.buyer, `${PREFIX} comunidade alheia`, readers);
    expect(notTheirs.status).toBe(403);
    expect((await envelope(notTheirs)).error).not.toHaveProperty('details');

    // an archived organization community the buyer holds a post grant in: the existing 400 after the permission test
    const arch = await post('/v1/communities', tokens.admin, { name: `${PREFIX} arquivada` });
    expect(arch.status).toBe(201);
    const archId = ((await arch.json()) as { id: string }).id;
    await adminSql`
      insert into public.store_product_communities (tenant_id, product_id, community_id, can_post)
      values (${tenantId}::uuid, ${fx.productA}::uuid, ${archId}::uuid, true)`;
    await adminSql`update public.communities set status = 'archived' where id = ${archId}::uuid`;
    const archived = await publish(tokens.buyer, `${PREFIX} arquivada`, archId);
    expect(archived.status).toBe(400);
    expect((await envelope(archived)).error.details).toEqual({ community: 'archived' });
    await adminSql`delete from public.store_product_communities where community_id = ${archId}::uuid`;

    // a community of another tenant answers the existing 404, never the 403
    const [foreign] = await adminSql<{ id: string }[]>`
      select id::text as id from public.communities where tenant_id = ${labTenantId}::uuid limit 1`;
    const other = await publish(tokens.buyer, `${PREFIX} outro tenant`, foreign?.id);
    expect(other.status).toBe(404);
    expect((await envelope(other)).error).not.toHaveProperty('details');

    // `social` off: the member loses feed.post.create altogether
    const off = await withSocial(false, () =>
      publish(tokens.buyer, `${PREFIX} social off`, fx.orgA),
    );
    expect(off.status).toBe(403);
    const none = await adminSql`
      select 1 from public.feed_posts where caption = ${`${PREFIX} social off`}`;
    expect(none).toHaveLength(0);
    expect((await publish(tokens.buyer, `${PREFIX} social de volta`, fx.orgA)).status).toBe(201);
  });

  it('11. D-896/BPERM-26: the thirtieth attempt passes, the thirty-first is 429, two identical posts make two posts and count twice, the key is tenant plus user', async () => {
    memberCommunityPostLimiter.reset();
    await setFlags({ post: true });
    const caption = `${PREFIX} limite`;
    for (let attempt = 1; attempt <= COMMUNITY_POSTS_PER_HOUR; attempt += 1) {
      // the first two are IDENTICAL on purpose: no dedupe, and both count
      const res = await publish(
        tokens.buyer,
        attempt <= 2 ? caption : `${caption} ${attempt}`,
        fx.orgA,
      );
      expect(res.status, `attempt ${attempt} -> ${await res.clone().text()}`).toBe(201);
    }
    const over = await publish(tokens.buyer, `${caption} 31`, fx.orgA);
    expect(over.status).toBe(429);
    expect((await envelope(over)).error.code).toBe('RATE_LIMITED');
    const [stored] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_posts where caption like ${`${caption}%`}`;
    expect(stored?.n).toBe(30);
    const [identical] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_posts where caption = ${caption}`;
    expect(identical?.n).toBe(2);

    // the key is the tenant plus the user: the same user in another tenant counts separately
    memberCommunityPostLimiter.reset();
    const mine = safetyLimiterKey({ tenantId, userId: users.buyer });
    const theirs = safetyLimiterKey({ tenantId: labTenantId, userId: users.buyer });
    for (let i = 0; i < COMMUNITY_POSTS_PER_HOUR; i += 1) {
      expect(memberCommunityPostLimiter.consume(mine)).toBe(true);
    }
    expect(memberCommunityPostLimiter.consume(mine)).toBe(false);
    expect(memberCommunityPostLimiter.consume(theirs)).toBe(true);
  });

  it('12. D-896: every attempt counts before the permission check, a refused one included; no attempt leaves no state', async () => {
    memberCommunityPostLimiter.reset();
    await setFlags({ post: false });
    for (let attempt = 1; attempt <= COMMUNITY_POSTS_PER_HOUR; attempt += 1) {
      const res = await publish(tokens.buyer, `${PREFIX} recusada ${attempt}`, fx.orgA);
      expect(res.status, `refused attempt ${attempt}`).toBe(403);
    }
    // the thirty refused attempts were counted: the flag is on now, and the thirty-first is the 429, not a 201
    await setFlags({ post: true });
    const res = await publish(tokens.buyer, `${PREFIX} depois das recusadas`, fx.orgA);
    expect(res.status).toBe(429);
    const stored = await adminSql`
      select 1 from public.feed_posts where caption like ${`${PREFIX} recusada%`} or caption = ${`${PREFIX} depois das recusadas`}`;
    expect(stored).toHaveLength(0);
  });

  it('13. D-896: a member post with no community, a creator post in their own member community and thirty-two staff posts never consume the limiter', async () => {
    memberCommunityPostLimiter.reset();
    await setFlags({ post: true });
    const own = await memberCommunity(users.buyer, 'do-comprador');
    for (let i = 0; i < 3; i += 1) {
      expect((await publish(tokens.buyer, `${PREFIX} sem comunidade ${i}`)).status).toBe(201);
      expect((await publish(tokens.buyer, `${PREFIX} na propria ${i}`, own)).status).toBe(201);
    }
    for (let i = 0; i < COMMUNITY_POSTS_PER_HOUR + 2; i += 1) {
      expect((await publish(tokens.admin, `${PREFIX} do admin ${i}`, fx.orgA)).status).toBe(201);
    }
    // all thirty buyer attempts still pass, so none of the above counted
    for (let i = 1; i <= COMMUNITY_POSTS_PER_HOUR; i += 1) {
      const res = await publish(tokens.buyer, `${PREFIX} apos nao contar ${i}`, fx.orgA);
      expect(res.status, `buyer attempt ${i}`).toBe(201);
    }
    expect((await publish(tokens.buyer, `${PREFIX} trinta e um`, fx.orgA)).status).toBe(429);
  });

  it('14. D-896 concurrency: thirty-one concurrent buyer attempts leave exactly thirty posts and one 429', async () => {
    memberCommunityPostLimiter.reset();
    await setFlags({ post: true });
    const results = await Promise.all(
      Array.from({ length: COMMUNITY_POSTS_PER_HOUR + 1 }, (_, i) =>
        publish(tokens.buyer, `${PREFIX} concorrente ${i}`, fx.orgA),
      ),
    );
    const statuses = results.map((res) => res.status).sort((a, b) => a - b);
    expect(statuses.filter((status) => status === 201)).toHaveLength(COMMUNITY_POSTS_PER_HOUR);
    expect(statuses.filter((status) => status === 429)).toHaveLength(1);
    const [stored] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_posts where caption like ${`${PREFIX} concorrente%`}`;
    expect(stored?.n).toBe(COMMUNITY_POSTS_PER_HOUR);
    memberCommunityPostLimiter.reset();
  });
});

describe('11.1-08 community.actions: the viewer facts ride the post only when something is withheld', () => {
  const actionsOf = (item: FeedPost | undefined) => item?.community?.actions;
  const postOf = async (token: string, id: string): Promise<FeedPost> => {
    const res = await request(`/v1/feed/posts/${id}`, token);
    expect(res.status, await res.clone().text()).toBe(200);
    return (await res.json()) as FeedPost;
  };

  it('15. UI-D-889/BPERM-16: all three flags carry no actions; one false flag carries all three; the other flags and a staff viewer read nothing', async () => {
    await adminSql`
      update public.store_entitlements set status = 'revoked'
       where product_id = ${fx.productB}::uuid and user_id = ${users.buyer}::uuid`;
    await setFlags({ like: true, comment: true, share: true });
    expect(actionsOf(await postOf(tokens.buyer, fx.adminPostA))).toBeUndefined();
    expect(await postOf(tokens.buyer, fx.adminPostA)).toHaveProperty('community');

    await setFlags({ like: false, comment: true, share: true });
    const one = await postOf(tokens.buyer, fx.adminPostA);
    expect(actionsOf(one)).toEqual({ like: false, comment: true, share: true });
    expect(Object.keys(one.community ?? {}).sort()).toEqual(['actions', 'id', 'name', 'slug']);
    const body = JSON.stringify(one);
    expect(body).not.toContain('"post":');
    expect(body).not.toContain('openHighlight');
    expectNothingNamed(body, 'a post body', false);

    await setFlags({ like: true, comment: false, share: false });
    expect(actionsOf(await postOf(tokens.buyer, fx.adminPostA))).toEqual({
      like: true,
      comment: false,
      share: false,
    });

    // staff never read the key, even with every flag unticked
    await setFlags({ like: false, comment: false, share: false });
    expect(actionsOf(await postOf(tokens.admin, fx.adminPostA))).toBeUndefined();
  });

  it('16. BPERM-16: no actions for a post with no community, in a member community or in a community with no linked product; two products with equal flags equal one', async () => {
    await setFlags({ like: false, comment: false, share: false });
    // no linked product
    expect(actionsOf(await postOf(tokens.buyer, fx.adminPostBare))).toBeUndefined();
    // no community at all
    const loose = await publish(tokens.admin, `${PREFIX} sem comunidade do admin`);
    expect(loose.status).toBe(201);
    const looseId = ((await loose.json()) as FeedPost).id;
    const looseRead = await postOf(tokens.buyer, looseId);
    expect(looseRead.community).toBeNull();
    // a member community of the buyer's own
    const own = await memberCommunity(users.buyer, 'sem-actions');
    const inOwn = await publish(tokens.buyer, `${PREFIX} na propria sem actions`, own);
    expect(inOwn.status, await inOwn.clone().text()).toBe(201);
    const inOwnPost = (await inOwn.json()) as FeedPost;
    expect(inOwnPost.community).not.toBeNull();
    expect(actionsOf(inOwnPost)).toBeUndefined();

    // two products with the SAME flags read like one product
    const single = actionsOf(await postOf(tokens.buyer, fx.adminPostA));
    const reGranted = await adminSql`
      update public.store_entitlements set status = 'active'
       where product_id = ${fx.productB}::uuid and user_id = ${users.buyer}::uuid`;
    expect(reGranted.count).toBe(1);
    await setFlags({ like: false, comment: false, share: false }, fx.productB);
    expect(actionsOf(await postOf(tokens.buyer, fx.adminPostA))).toEqual(single);
    // the union: a second product that grants comment lifts it
    await setFlags({ like: false, comment: true, share: false }, fx.productB);
    expect(actionsOf(await postOf(tokens.buyer, fx.adminPostA))).toEqual({
      like: false,
      comment: true,
      share: false,
    });
    await adminSql`
      update public.store_entitlements set status = 'revoked'
       where product_id = ${fx.productB}::uuid and user_id = ${users.buyer}::uuid`;
  });

  it('17. BPERM-16 ordering: in a mixed list each post reads its own community, whatever the order', async () => {
    await setFlags({ like: false, comment: true, share: true });
    const first = await adminPost(fx.orgA, 'mistura 1 org A');
    const second = await adminPost(fx.bare, 'mistura 2 sem produto');
    const third = await adminPost(fx.bare, 'mistura 3 sem produto');
    const fourth = await adminPost(fx.orgA, 'mistura 4 org A');
    const list = await feedOf(tokens.buyer, 'limit=25');
    const byId = new Map(list.map((item) => [item.id, item]));
    for (const id of [first, fourth]) {
      expect(actionsOf(byId.get(id)), `org A post ${id}`).toEqual({
        like: false,
        comment: true,
        share: true,
      });
    }
    for (const id of [second, third]) {
      expect(byId.has(id)).toBe(true);
      expect(actionsOf(byId.get(id)), `bare post ${id}`).toBeUndefined();
    }
    // the same facts through the community page (a different statement shape) and in the opposite order
    const page = await feedOf(tokens.buyer, `communityId=${fx.orgA}&limit=25`);
    expect(page.map((item) => item.id)).toContain(first);
    for (const item of page)
      expect(actionsOf(item)).toEqual({ like: false, comment: true, share: true });
    const reversed = [...list].reverse();
    for (const item of reversed) {
      const want =
        item.communityId === fx.orgA ? { like: false, comment: true, share: true } : undefined;
      expect(actionsOf(item)).toEqual(want);
    }
    await setFlags({});
  });
});
