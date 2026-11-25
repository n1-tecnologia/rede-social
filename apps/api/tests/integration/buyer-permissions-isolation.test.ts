import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { sqlClient } from '@rede-social/core/db';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import {
  communityCreateLimiter,
  memberCommunityPostLimiter,
  storyPublishLimiter,
} from '@rede-social/core/server/safety/limits';
import type { CommunitySummary } from '@rede-social/module-communities/contracts';
import type { FeedComment, FeedPage, FeedPost } from '@rede-social/module-feed/contracts';
import type { CommunityAccess, ProductDetail } from '@rede-social/module-store/contracts';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  notificationJobsOf,
  pushSendJobsOf,
  removeIdentitiesByPrefix,
  SEED_PASSWORD,
  signInAs,
  withCommunitiesEnabled,
  withModuleEnabled,
  withSocialEnabled,
  withStoreEnabled,
  withStoriesEnabled,
} from './setup';

/**
 * 11.1-11 (D-881, D-886, D-887, D-888, T-isolation; BPERM-05, BPERM-08, BPERM-10, BPERM-25): the security sweep that
 * closes the SERVER half of buyer permissions, against the live local stack and the real seed. It authors no feature:
 * every case drives routes and definers that plans 02 to 09 shipped.
 *
 *  - `refund` (Task 1, the tracer): a gateway refund (`app.store_gateway_revoke`, the function the refund and chargeback
 *    webhooks call) ends every permission at the NEXT request while everything the buyer already wrote stays readable and
 *    hidden by nothing; a re-purchase restores the grant with no data change; the admin revoke route agrees; the
 *    administrator removes the buyer's content through the SHIPPED moderation (with its log row), never through new code.
 *  - `race`, `notification` and `matrix` (Task 2): the revoke race on TWO connections, the notification negative through
 *    the worker's own job path, and the cross-tenant matrix beside a positive control for each case.
 *  - `leak` (Task 3): the serialised no-leak sweep of every member-readable body the phase touched.
 *
 * Fixture (built in `beforeAll`, every name, caption and title prefixed `bpi-<run>`): in `rede-demo` with `store`,
 * `social`, `communities` and `stories` ON, an organization community `orgA` made by the seed admin, a product linked to
 * it with every flag ticked, an open highlight, a second product that ticks nothing, and throwaway members: the buyer
 * (holds the product through the gateway definer exactly as the webhook does), a second buyer, and a reader who holds
 * nothing. Test ORDER inside each describe is load-bearing (declaration order); every case sets the state it needs.
 */

type Envelope = { error: { code: string; message?: string; details?: Record<string, unknown> } };

const RUN = Date.now();
const PREFIX = `bpi-${RUN}`;

const tokens = { admin: '', buyer: '', buyer2: '', reader: '' };
const users = { admin: '', buyer: '', buyer2: '', reader: '' };
const memberships = { buyer: '', buyer2: '' };
let tenantId = '';
let labTenantId = '';
const restores: (() => Promise<void>)[] = [];
const createdAssets: string[] = [];
const fx = {
  orgA: '',
  productA: '',
  productB: '',
  hOpen: '',
  adminPost: '',
  adminComment: '',
};

const request = (path: string, token: string, init: RequestInit = {}, host = HOSTS.demo) =>
  api.request(path, {
    ...init,
    headers: {
      'x-tenant-host': host,
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });

const get = (path: string, token: string, host = HOSTS.demo) => request(path, token, {}, host);
const post = (path: string, token: string, body?: unknown, host = HOSTS.demo) =>
  request(
    path,
    token,
    { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
    host,
  );
const put = (path: string, token: string, host = HOSTS.demo) =>
  request(path, token, { method: 'PUT' }, host);
const del = (path: string, token: string, host = HOSTS.demo) =>
  request(path, token, { method: 'DELETE' }, host);

const likePost = (token: string, postId: string) => post(`/v1/feed/posts/${postId}/like`, token);
const commentOn = (token: string, postId: string, body: string) =>
  post(`/v1/feed/posts/${postId}/comments`, token, { body });
const publish = (token: string, caption: string, communityId: string) =>
  post('/v1/feed/posts', token, { caption, communityId });
const addItem = (token: string, highlightId: string, storyId: string) =>
  put(`/v1/stories/highlights/${highlightId}/stories/${storyId}`, token);

/** The refusal every layer of this phase answers with: status 403, code FORBIDDEN and NO `details` key. */
async function expectBare403(res: Response, where: string) {
  const text = await res.clone().text();
  expect(res.status, `${where} -> ${text}`).toBe(403);
  const body = (await res.json()) as Envelope;
  expect(body.error.code, where).toBe('FORBIDDEN');
  expect(body.error, where).not.toHaveProperty('details');
}

/** The refusal of a LOCKED community: the existing 403 with its own single detail (08.2), never the bare one. */
async function expectLocked403(res: Response, where: string) {
  const text = await res.clone().text();
  expect(res.status, `${where} -> ${text}`).toBe(403);
  const body = (await res.json()) as Envelope;
  expect(body.error.code, where).toBe('FORBIDDEN');
  expect(body.error.details, where).toEqual({ access: 'community_locked' });
}

// ── the gateway definers exactly as the refund and chargeback webhooks call them ────────────────────────────────

type GatewayOutcome = { outcome: string; user_id: string | null; product_id?: string | null };

/** `app.store_gateway_purchase` as `service_role`, the lane `applyStore` runs it in. */
async function gatewayPurchase(
  membership: string,
  product: string,
  ref: string,
  tenant = tenantId,
): Promise<string> {
  const rows = await adminSql.begin(async (tx) => {
    await tx`set local role service_role`;
    return tx<{ outcome: string }[]>`
      select outcome from app.store_gateway_purchase(
        ${tenant}::uuid, ${membership}::uuid, ${product}::uuid, 'acme'::text, ${ref}::text,
        1990::int, now())`;
  });
  return rows[0]?.outcome ?? 'no_row';
}

/** `app.store_gateway_revoke` as `service_role`: the refund and the chargeback call exactly this. */
async function gatewayRevoke(ref: string, tenant = tenantId): Promise<GatewayOutcome> {
  const rows = await adminSql.begin(async (tx) => {
    await tx`set local role service_role`;
    return tx<GatewayOutcome[]>`
      select outcome, user_id::text as user_id, product_id::text as product_id
        from app.store_gateway_revoke(${tenant}::uuid, 'acme'::text, ${ref}::text)`;
  });
  const row = rows[0];
  if (!row) throw new Error('store_gateway_revoke returned no row');
  return row;
}

/** What the database says the lane of `userId` in `tenant` holds: the keys of `app.community_buyer_scope()`. */
async function scopeOf(
  userId: string,
  tenant = tenantId,
  role = 'member',
): Promise<Record<string, Record<string, boolean>>> {
  const rows = await adminSql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({
      sub: userId,
      role: 'authenticated',
      tenant_id: tenant,
      tenant_role: role,
    })}, true)`;
    await tx`set local role authenticated`;
    return tx<{ scope: Record<string, Record<string, boolean>> }[]>`
      select app.community_buyer_scope() as scope`;
  });
  return rows[0]?.scope ?? {};
}

const setFlags = (
  flags: Partial<Record<'like' | 'comment' | 'share' | 'post' | 'story', boolean>>,
  product = fx.productA,
  community = fx.orgA,
) =>
  adminSql`
    update public.store_product_communities
       set can_like = ${flags.like ?? true}, can_comment = ${flags.comment ?? true},
           can_share = ${flags.share ?? true}, can_post = ${flags.post ?? false},
           can_story = ${flags.story ?? false}
     where product_id = ${product}::uuid and community_id = ${community}::uuid`;

const entitlementStatus = async (userId: string, product: string): Promise<string[]> => {
  const rows = await adminSql<{ status: string }[]>`
    select status from public.store_entitlements
     where user_id = ${userId}::uuid and product_id = ${product}::uuid order by created_at, id`;
  return rows.map((row) => row.status);
};

/** A `purpose: 'story'` asset of rede-demo owned by `ownerId`, ready. */
async function makeAsset(ownerId: string): Promise<string> {
  const id = randomUUID();
  createdAssets.push(id);
  await adminSql`
    insert into public.media_assets
      (id, tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, variant_widths)
    values (${id}::uuid, ${tenantId}::uuid, ${ownerId}::uuid, 'image', 'story', 'ready', 'supabase',
            'image/webp', 1024, '{640,1080}'::int[])`;
  return id;
}

/** A story row written by hand: the buyer's are `followers`, the administrator's `tenant`. */
async function insertStory(author: string, label: string): Promise<string> {
  const asset = await makeAsset(author);
  const visibility = author === users.admin ? 'tenant' : 'followers';
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.stories
      (tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility, published_at, expires_at)
    values (${tenantId}::uuid, ${author}::uuid, ${asset}::uuid, 'image', ${`${PREFIX} ${label}`},
            ${visibility}, now(), now() + interval '24 hours')
    returning id`;
  return row?.id ?? '';
}

async function insertHighlight(title: string, open: boolean): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.story_highlights
      (tenant_id, community_id, title, position, created_by_user_id, open_to_buyers)
    select ${tenantId}::uuid, ${fx.orgA}::uuid, ${`${PREFIX} ${title}`},
           coalesce(max(h.position) + 1, 0), ${users.admin}::uuid, ${open}
      from public.story_highlights h
     where h.tenant_id = ${tenantId}::uuid and h.community_id = ${fx.orgA}::uuid
    returning id`;
  return row?.id ?? '';
}

const itemsOf = async (highlightId: string) =>
  adminSql<{ story_id: string; added_by_user_id: string }[]>`
    select story_id::text as story_id, added_by_user_id::text as added_by_user_id
      from public.story_highlight_items
     where highlight_id = ${highlightId}::uuid order by added_at, id`;

async function sweep(): Promise<void> {
  await dropRaceTriggers();
  const products = adminSql`select id from public.store_products where name like ${`${PREFIX}%`}`;
  const communities = adminSql`select id from public.communities where name like ${`${PREFIX}%`}`;
  await adminSql`delete from public.story_highlights where title like ${`${PREFIX}%`}`;
  await adminSql`
    with gone as (delete from public.stories where caption like ${`${PREFIX}%`} returning media_asset_id)
    delete from public.media_assets where id in (select media_asset_id from gone)`;
  if (createdAssets.length > 0) {
    await adminSql`delete from public.media_assets where id = any (${createdAssets}::uuid[])`;
  }
  await adminSql`delete from public.feed_posts where caption like ${`${PREFIX}%`}`;
  await adminSql`delete from public.feed_posts where community_id in (${communities})`;
  await adminSql`delete from public.store_entitlements where product_id in (${products})`;
  await adminSql`delete from public.store_orders where product_id in (${products})`;
  await adminSql`delete from public.store_products where name like ${`${PREFIX}%`}`;
  await adminSql`delete from public.communities where name like ${`${PREFIX}%`}`;
  await removeIdentitiesByPrefix(PREFIX);
  // 11.1-11 case 17: the throwaway tenant that owns nothing (swept by shape, so a crashed run's is collected too)
  await adminSql`delete from public.tenant_modules where tenant_id in (
    select id from public.tenants where slug like 'bpi-%-vazio')`;
  await adminSql`delete from public.tenant_domains where host like 'bpi-%-vazio.localhost'`;
  await adminSql`delete from public.tenants where slug like 'bpi-%-vazio'`;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  await sweep();
  restores.push(await withStoreEnabled('demo'));
  restores.push(await withSocialEnabled('demo'));
  restores.push(await withCommunitiesEnabled('demo'));
  restores.push(await withStoriesEnabled('demo'));
  const tenants = await adminSql<{ id: string; slug: string }[]>`
    select id::text as id, slug from public.tenants where slug in ('rede-demo', 'rede-lab')`;
  tenantId = tenants.find((t) => t.slug === 'rede-demo')?.id ?? '';
  labTenantId = tenants.find((t) => t.slug === 'rede-lab')?.id ?? '';
  tokens.admin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  const [admin] = await adminSql<{ user_id: string }[]>`
    select m.user_id::text as user_id from public.memberships m
      join public.users u on u.id = m.user_id
     where u.email = 'admin@rede-demo.local' and m.tenant_id = ${tenantId}::uuid`;
  users.admin = admin?.user_id ?? '';

  for (const name of ['buyer', 'buyer2', 'reader'] as const) {
    const identity = await createSharedIdentity({
      prefix: PREFIX,
      memberships: [{ host: 'demo' }],
    });
    users[name] = identity.userId;
    tokens[name] = await signInAs(identity.email, identity.password);
  }
  for (const name of ['buyer', 'buyer2'] as const) {
    const [row] = await adminSql<{ id: string }[]>`
      select id::text as id from public.memberships
       where user_id = ${users[name]}::uuid and tenant_id = ${tenantId}::uuid`;
    memberships[name] = row?.id ?? '';
  }

  const orgA = await post('/v1/communities', tokens.admin, { name: `${PREFIX} orgA` });
  expect(orgA.status).toBe(201);
  fx.orgA = ((await orgA.json()) as { id: string }).id;
  // product A ticks every permission, through the REAL product form body (D-890, D-891)
  const productA = await post('/v1/store/products', tokens.admin, {
    name: `${PREFIX} produto A`,
    priceCents: 1990,
    communityLinks: [
      { communityId: fx.orgA, like: true, comment: true, share: true, post: true, story: true },
    ],
  });
  expect(productA.status, await productA.clone().text()).toBe(201);
  fx.productA = ((await productA.json()) as ProductDetail).id;
  // product B opens the community and ticks nothing: the buyer who also holds it keeps a door that grants no action
  const productB = await post('/v1/store/products', tokens.admin, {
    name: `${PREFIX} produto B`,
    priceCents: 990,
    communityLinks: [
      {
        communityId: fx.orgA,
        like: false,
        comment: false,
        share: false,
        post: false,
        story: false,
      },
    ],
  });
  expect(productB.status, await productB.clone().text()).toBe(201);
  fx.productB = ((await productB.json()) as ProductDetail).id;

  fx.hOpen = await insertHighlight('aberto', true);
  const adminPost = await post('/v1/feed/posts', tokens.admin, {
    caption: `${PREFIX} post da organizacao`,
    communityId: fx.orgA,
  });
  expect(adminPost.status, await adminPost.clone().text()).toBe(201);
  fx.adminPost = ((await adminPost.json()) as { id: string }).id;
  const adminComment = await commentOn(tokens.admin, fx.adminPost, `${PREFIX} comentario do admin`);
  expect(adminComment.status).toBe(201);
  fx.adminComment = ((await adminComment.json()) as FeedComment).id;
});

beforeEach(() => {
  storyPublishLimiter.reset();
  communityCreateLimiter.reset();
  memberCommunityPostLimiter.reset();
});

afterAll(async () => {
  await sweep();
  for (const restore of restores.reverse()) await restore();
  await lane1.end();
  await holder.end();
  await adminSql.end();
  await sqlClient.end();
});

// ── Task 1: the tracer ───────────────────────────────────────────────────────────────────────────────────────────

/** What a buyer wrote while the grant lasted, kept so every later case can prove it is still there. */
const written: { post: string; comment: string; story: string; like: string } = {
  post: '',
  comment: '',
  story: '',
  like: '',
};

const postIdsOf = async (token: string): Promise<string[]> => {
  const res = await get(`/v1/feed?communityId=${fx.orgA}&limit=25`, token);
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as FeedPage).items.map((item) => item.id);
};

const actionsOf = async (token: string): Promise<CommunitySummary['viewer']['actions']> => {
  const res = await get(`/v1/communities/${fx.orgA}`, token);
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as CommunitySummary).viewer.actions;
};

const ALL_ON = { like: true, comment: true, share: true, post: true, story: true };

describe('11.1-11 tracer: a gateway refund ends the grant at the next request and keeps the content', () => {
  it('1. D-887/BPERM-05 TRACER: the refund path ends like, comment, post and story save at the next request, empties the scope and the viewer flags, and leaves everything the buyer wrote readable', async () => {
    // the grant, through the gateway definer exactly as the webhook writes it
    expect(await gatewayPurchase(memberships.buyer, fx.productA, `${PREFIX}-ref-1`)).toBe(
      'purchased',
    );
    expect(await gatewayPurchase(memberships.buyer2, fx.productA, `${PREFIX}-ref-2`)).toBe(
      'purchased',
    );
    expect(Object.keys(await scopeOf(users.buyer))).toEqual([fx.orgA]);
    expect(await actionsOf(tokens.buyer)).toEqual(ALL_ON);

    // while the grant lasts the buyer writes in every lane
    const liked = await likePost(tokens.buyer, fx.adminPost);
    expect(liked.status, await liked.clone().text()).toBe(200);
    const commented = await commentOn(
      tokens.buyer,
      fx.adminPost,
      `${PREFIX} comentario do comprador`,
    );
    expect(commented.status, await commented.clone().text()).toBe(201);
    written.comment = ((await commented.json()) as FeedComment).id;
    const published = await publish(tokens.buyer, `${PREFIX} post do comprador`, fx.orgA);
    expect(published.status, await published.clone().text()).toBe(201);
    written.post = ((await published.json()) as FeedPost).id;
    written.story = await insertStory(users.buyer, 'story do comprador');
    const saved = await addItem(tokens.buyer, fx.hOpen, written.story);
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect((await itemsOf(fx.hOpen)).map((item) => item.story_id)).toContain(written.story);

    // THE REFUND: the same function the refund and chargeback webhooks call
    const refund = await gatewayRevoke(`${PREFIX}-ref-1`);
    expect(refund.outcome).toBe('revoked');
    expect(refund.user_id).toBe(users.buyer);
    expect(await entitlementStatus(users.buyer, fx.productA)).toEqual(['revoked']);

    // the NEXT statement: the scope is empty and the viewer carries no buyer flag
    expect(await scopeOf(users.buyer)).toEqual({});
    // the only product opening the community is gone, so the community is the locked page of 08.2
    await expectLocked403(await likePost(tokens.buyer, fx.adminPost), 'like after the refund');
    await expectLocked403(
      await commentOn(tokens.buyer, fx.adminPost, `${PREFIX} depois do reembolso`),
      'comment after the refund',
    );
    // a post is judged by the buyer rule, not the locked one: the same bare 403 as a missing flag
    await expectBare403(
      await publish(tokens.buyer, `${PREFIX} post depois do reembolso`, fx.orgA),
      'post after the refund',
    );
    const second = await insertStory(users.buyer, 'story depois do reembolso');
    await expectBare403(
      await addItem(tokens.buyer, fx.hOpen, second),
      'story save after the refund',
    );

    // refused means refused: nothing new was written
    const [counts] = await adminSql<{ posts: number; comments: number; items: number }[]>`
      select (select count(*) from public.feed_posts
               where author_user_id = ${users.buyer}::uuid and caption like ${`${PREFIX}%`})::int as posts,
             (select count(*) from public.feed_comments
               where author_user_id = ${users.buyer}::uuid)::int as comments,
             (select count(*) from public.story_highlight_items
               where highlight_id = ${fx.hOpen}::uuid and added_by_user_id = ${users.buyer}::uuid)::int as items`;
    expect(counts).toEqual({ posts: 1, comments: 1, items: 1 });

    // the positive control in the SAME test: the second buyer, never refunded, still reads and writes everywhere
    expect(await actionsOf(tokens.buyer2)).toEqual(ALL_ON);
    expect((await likePost(tokens.buyer2, fx.adminPost)).status).toBe(200);

    // everything the buyer wrote is STILL there, for whoever can read the community, and hidden by nothing
    expect(await postIdsOf(tokens.buyer2)).toContain(written.post);
    const stillPost = await get(`/v1/feed/posts/${written.post}`, tokens.buyer2);
    expect(stillPost.status).toBe(200);
    const comments = await get(`/v1/feed/posts/${fx.adminPost}/comments`, tokens.buyer2);
    expect(comments.status).toBe(200);
    expect(((await comments.json()) as { items: FeedComment[] }).items.map((c) => c.id)).toContain(
      written.comment,
    );
    const highlight = await get(`/v1/stories/highlights/${fx.hOpen}`, tokens.buyer2);
    expect(highlight.status, await highlight.clone().text()).toBe(200);
    expect(
      ((await highlight.json()) as { items: { id: string }[] }).items.map((item) => item.id),
    ).toContain(written.story);
    expect((await get(`/v1/stories/${written.story}`, tokens.buyer2)).status).toBe(200);
    // the like is still counted
    const [likes] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_likes
       where post_id = ${fx.adminPost}::uuid and user_id = ${users.buyer}::uuid`;
    expect(likes?.n).toBe(1);
    // no row was deleted, hidden or reassigned by any code of the phase
    const [rows] = await adminSql<{ live: number }[]>`
      select (select count(*) from public.feed_posts where id = ${written.post}::uuid and deleted_at is null
                 and author_user_id = ${users.buyer}::uuid)::int
           + (select count(*) from public.feed_comments where id = ${written.comment}::uuid and deleted_at is null
                 and author_user_id = ${users.buyer}::uuid)::int
           + (select count(*) from public.stories where id = ${written.story}::uuid and deleted_at is null
                 and author_user_id = ${users.buyer}::uuid)::int as live`;
    expect(rows?.live).toBe(3);
  });
});

/** The log row of one moderation removal, anchored by the subject it removed (the log is append-only). */
const logRowsFor = (subjectId: string) =>
  adminSql<{ action: string; subject_type: string | null; target_user_id: string }[]>`
    select action, subject_type, target_user_id::text as target_user_id
      from public.moderation_log where subject_id = ${subjectId}::uuid`;

/** Everything the buyer wrote, as the database holds it: a re-purchase must change none of it. */
const contentSnapshot = async (): Promise<string> => {
  const rows = await adminSql<{ snap: string }[]>`
    select coalesce(json_agg(r order by r.kind, r.id)::text, '[]') as snap from (
      select 'post' as kind, id::text as id, caption as body, deleted_at::text as gone, visibility as extra
        from public.feed_posts where author_user_id = ${users.buyer}::uuid
      union all
      select 'comment', id::text, body, deleted_at::text, post_id::text
        from public.feed_comments where author_user_id = ${users.buyer}::uuid
      union all
      select 'story', id::text, caption, deleted_at::text, visibility
        from public.stories where author_user_id = ${users.buyer}::uuid
      union all
      select 'item', story_id::text, highlight_id::text, null, added_by_user_id::text
        from public.story_highlight_items where added_by_user_id = ${users.buyer}::uuid
      union all
      select 'like', id::text, coalesce(post_id::text, comment_id::text), null, user_id::text
        from public.feed_likes where user_id = ${users.buyer}::uuid
    ) r`;
  return rows[0]?.snap ?? '';
};

const accessOf = async (token: string): Promise<CommunityAccess> => {
  const res = await get(`/v1/store/communities/${fx.orgA}/access`, token);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as CommunityAccess;
};

/** The buyer is refused in every lane the grant opened (the locked page speaks for like and comment). */
async function expectEveryLaneRefused(token: string, where: string) {
  await expectLocked403(await likePost(token, fx.adminPost), `${where}: like`);
  await expectLocked403(
    await commentOn(token, fx.adminPost, `${PREFIX} ${where}`),
    `${where}: comment`,
  );
  await expectBare403(await publish(token, `${PREFIX} ${where}`, fx.orgA), `${where}: post`);
  const story = await insertStory(users.buyer, `story ${where}`);
  await expectBare403(await addItem(token, fx.hOpen, story), `${where}: story save`);
}

describe('11.1-11 refund: re-purchase, the admin path, the same function for every end, and the shipped moderation', () => {
  it('2. D-887/BPERM-05 (a, d): a re-purchase restores every flag with no data change, and the locked page of 08.2 comes back with the refund', async () => {
    // after the refund of case 1 the community is the locked page for the buyer
    expect(await entitlementStatus(users.buyer, fx.productA)).toEqual(['revoked']);
    const locked = await accessOf(tokens.buyer);
    expect(locked.locked).toBe(true);
    expect((await accessOf(tokens.buyer2)).locked, 'positive control: the second buyer').toBe(
      false,
    );
    const before = await contentSnapshot();
    expect(JSON.parse(before).length).toBeGreaterThanOrEqual(4);

    expect(await gatewayPurchase(memberships.buyer, fx.productA, `${PREFIX}-ref-1b`)).toBe(
      'purchased',
    );
    expect(await entitlementStatus(users.buyer, fx.productA)).toEqual(['revoked', 'active']);
    expect(Object.keys(await scopeOf(users.buyer))).toEqual([fx.orgA]);
    expect(await actionsOf(tokens.buyer)).toEqual(ALL_ON);
    expect((await accessOf(tokens.buyer)).locked).toBe(false);
    expect(await contentSnapshot(), 'a re-purchase changes no row the buyer wrote').toBe(before);

    // the restored grant works in every lane again
    expect((await likePost(tokens.buyer, fx.adminPost)).status).toBe(200);
    const again = await commentOn(tokens.buyer, fx.adminPost, `${PREFIX} de volta`);
    expect(again.status, await again.clone().text()).toBe(201);
    const back = await publish(tokens.buyer, `${PREFIX} de volta`, fx.orgA);
    expect(back.status, await back.clone().text()).toBe(201);
    const story = await insertStory(users.buyer, 'story de volta');
    expect((await addItem(tokens.buyer, fx.hOpen, story)).status).toBe(200);
  });

  it('3. D-887/BPERM-05 (a, e): the admin revoke route ends the grant exactly like the gateway, and the refund, the chargeback and the cancel reach ONE database function', async () => {
    const [entitlement] = await adminSql<{ id: string }[]>`
      select id::text as id from public.store_entitlements
       where user_id = ${users.buyer}::uuid and product_id = ${fx.productA}::uuid and status = 'active'`;
    const res = await del(
      `/v1/store/products/${fx.productA}/entitlements/${entitlement?.id}`,
      tokens.admin,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await entitlementStatus(users.buyer, fx.productA)).toEqual(['revoked', 'revoked']);
    expect(await scopeOf(users.buyer)).toEqual({});
    expect((await accessOf(tokens.buyer)).locked).toBe(true);
    await expectEveryLaneRefused(tokens.buyer, 'admin revoke');
    // the same content stays readable for the other buyer
    expect(await postIdsOf(tokens.buyer2)).toContain(written.post);
    expect(await actionsOf(tokens.buyer2), 'positive control').toEqual(ALL_ON);

    // the webhook's apply path calls the revoke definer from ONE place: refund, chargeback and cancel share it
    const apply = fs.readFileSync(
      new URL('../../../../packages/core/server/payments/apply.ts', import.meta.url),
      'utf8',
    );
    expect(apply.match(/select outcome from app\.store_gateway_revoke\(/g)).toHaveLength(1);
    // and the definer ends only the grant: a refund of an unknown reference touches nobody, a second one revokes once
    expect((await gatewayRevoke(`${PREFIX}-no-such-ref`)).outcome).toBe('not_found');
    expect(await actionsOf(tokens.buyer2)).toEqual(ALL_ON);
    expect(
      await gatewayRevoke(`${PREFIX}-ref-1b`),
      'the admin route already ended that order',
    ).toMatchObject({
      outcome: 'not_found',
    });
  });

  it('4. D-887/BPERM-05 (b): another product the buyer still holds keeps the community open, and the union is what is left: a refund of A leaves B (no flag) and the next request is the bare 403', async () => {
    expect(await gatewayPurchase(memberships.buyer, fx.productB, `${PREFIX}-ref-b`)).toBe(
      'purchased',
    );
    expect(await gatewayPurchase(memberships.buyer, fx.productA, `${PREFIX}-ref-1c`)).toBe(
      'purchased',
    );
    expect(await actionsOf(tokens.buyer)).toEqual(ALL_ON);
    expect((await likePost(tokens.buyer, fx.adminPost)).status).toBe(200);

    expect((await gatewayRevoke(`${PREFIX}-ref-1c`)).outcome).toBe('revoked');
    // B still opens the community, so it is NOT the locked page: every lane is the bare 403 and the flags are gone
    expect((await accessOf(tokens.buyer)).locked).toBe(false);
    expect(await actionsOf(tokens.buyer)).toEqual({
      like: false,
      comment: false,
      share: false,
      post: false,
      story: false,
    });
    await expectBare403(await likePost(tokens.buyer, fx.adminPost), 'like with B only');
    await expectBare403(
      await commentOn(tokens.buyer, fx.adminPost, `${PREFIX} so com B`),
      'comment with B only',
    );
    await expectBare403(
      await publish(tokens.buyer, `${PREFIX} so com B`, fx.orgA),
      'post with B only',
    );
    const story = await insertStory(users.buyer, 'story so com B');
    await expectBare403(await addItem(tokens.buyer, fx.hOpen, story), 'story save with B only');
    // reading is never reduced: the community and the buyer's own post still read for the buyer
    expect(await postIdsOf(tokens.buyer)).toContain(written.post);

    // B refunded too: now the locked page
    expect((await gatewayRevoke(`${PREFIX}-ref-b`)).outcome).toBe('revoked');
    expect((await accessOf(tokens.buyer)).locked).toBe(true);
    expect(await scopeOf(users.buyer)).toEqual({});
  });

  it('5. D-887 (c): the administrator removes a refunded buyer\u2019s post and comment through the SHIPPED moderation (one log row each) and the highlight item through the shipped takedown; nothing else is hidden', async () => {
    // positive control first: every piece is readable before the administrator acts
    expect((await get(`/v1/feed/posts/${written.post}`, tokens.buyer2)).status).toBe(200);
    expect(await logRowsFor(written.post)).toHaveLength(0);

    const removedPost = await del(`/v1/feed/posts/${written.post}`, tokens.admin);
    expect(removedPost.status, await removedPost.clone().text()).toBe(200);
    const postLog = await logRowsFor(written.post);
    expect(postLog).toEqual([
      { action: 'post_removed', subject_type: 'feed_post', target_user_id: users.buyer },
    ]);
    expect((await get(`/v1/feed/posts/${written.post}`, tokens.buyer2)).status).toBe(404);
    expect(await postIdsOf(tokens.buyer2)).not.toContain(written.post);

    const removedComment = await del(`/v1/feed/comments/${written.comment}`, tokens.admin);
    expect(removedComment.status, await removedComment.clone().text()).toBe(200);
    expect(await logRowsFor(written.comment)).toEqual([
      { action: 'comment_removed', subject_type: 'post_comment', target_user_id: users.buyer },
    ]);

    // the highlight item: the shipped takedown, the story itself survives
    const takedown = await del(
      `/v1/stories/highlights/${fx.hOpen}/stories/${written.story}`,
      tokens.admin,
    );
    expect(takedown.status, await takedown.clone().text()).toBe(200);
    expect((await itemsOf(fx.hOpen)).map((item) => item.story_id)).not.toContain(written.story);
    const [story] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.stories where id = ${written.story}::uuid and deleted_at is null`;
    expect(story?.n).toBe(1);

    // NOTHING ELSE moved: the second buyer's content and the administrator's are untouched, one log row per removal
    expect((await get(`/v1/feed/posts/${fx.adminPost}`, tokens.buyer2)).status).toBe(200);
    expect(await logRowsFor(fx.adminPost)).toHaveLength(0);
    expect(await logRowsFor(written.story)).toHaveLength(0);
  });
});

// ── Task 2: the revoke race on two connections ───────────────────────────────────────────────────────────────────

/** The two raw connections of the race: connection 1 is the buyer's lane, connection 2 (`adminSql`) the revoker. */
const lane1 = postgres('postgres://postgres:postgres@127.0.0.1:54322/postgres', {
  prepare: false,
  max: 1,
});
const holder = postgres('postgres://postgres:postgres@127.0.0.1:54322/postgres', {
  prepare: false,
  max: 1,
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The claims `withTenantTx` binds for a member lane, as one JSON text. */
const claimsOf = (userId: string, tenant = tenantId, role = 'member') =>
  JSON.stringify({ sub: userId, role: 'authenticated', tenant_id: tenant, tenant_role: role });

const likeRowsOf = async (postId: string, userId: string): Promise<number> => {
  const rows = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.feed_likes
     where post_id = ${postId}::uuid and user_id = ${userId}::uuid`;
  return rows[0]?.n ?? 0;
};

/** Ends buyer2's grant exactly as the definer does: the entitlement AND its live order (history is kept). */
const REVOKE_BUYER2 = () =>
  `update public.store_entitlements set status = 'revoked', revoked_at = now()
    where user_id = '${users.buyer2}'::uuid and product_id = '${fx.productA}'::uuid and status = 'active';
   update public.store_orders set status = 'revoked', revoked_at = now()
    where user_id = '${users.buyer2}'::uuid and product_id = '${fx.productA}'::uuid and status in ('pending', 'paid')`;
const revokeBuyer2 = () => adminSql.unsafe(REVOKE_BUYER2());

/** Makes buyer2 a holder of product B too (it ticks nothing): the community stays open when product A is revoked. */
async function holdProductB(): Promise<void> {
  if ((await entitlementStatus(users.buyer2, fx.productB)).includes('active')) return;
  expect(
    await gatewayPurchase(memberships.buyer2, fx.productB, `${PREFIX}-b2-${randomUUID()}`),
  ).toBe('purchased');
}

/** Ends buyer2's hold of product B (entitlement and live order, as the definer does). */
const releaseProductB = () =>
  adminSql.unsafe(
    `update public.store_entitlements set status = 'revoked', revoked_at = now()
      where user_id = '${users.buyer2}'::uuid and product_id = '${fx.productB}'::uuid and status = 'active';
     update public.store_orders set status = 'revoked', revoked_at = now()
      where user_id = '${users.buyer2}'::uuid and product_id = '${fx.productB}'::uuid and status in ('pending', 'paid')`,
  );

/** Puts buyer2 back as a holder of product A with a FRESH purchase (the previous order stays history). */
async function rebuyBuyer2(): Promise<void> {
  const active = (await entitlementStatus(users.buyer2, fx.productA)).includes('active');
  if (active) return;
  expect(
    await gatewayPurchase(memberships.buyer2, fx.productA, `${PREFIX}-r-${randomUUID()}`),
  ).toBe('purchased');
}

/**
 * The race of D-888 / Pitfall 3 made deterministic at the API level: a SECOND connection holds an ACCESS EXCLUSIVE lock on
 * the table the write inserts into, `send` fires the request (the guard passes, the insert blocks on the lock), and only
 * then the revoke commits and the lock goes: the insert statement starts AFTER the revoke, exactly like a revoke landing
 * between the guard and the write.
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
  const held = holder.begin(async (tx) => {
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
  await held;
  expect(
    blocked,
    `the ${table} insert must have been waiting on the lock (the guard already passed)`,
  ).toBe(true);
  return await pending;
}

describe('11.1-11 race: a revoke committing between the read and the write (D-888, Pitfall 3, T-11.1-41)', () => {
  it('6. two connections: connection 1 reads the grant (true) in a READ COMMITTED transaction, connection 2 revokes and commits, and connection 1’s NEXT like insert is refused 42501 by the restrictive gate', async () => {
    await rebuyBuyer2();
    await adminSql`delete from public.feed_likes where user_id = ${users.buyer2}::uuid and post_id = ${fx.adminPost}::uuid`;
    let refusal: { code?: string } | null = null;
    let readBefore: boolean | null = null;
    let revoked = false;
    try {
      await lane1.begin('isolation level read committed', async (tx) => {
        await tx`select set_config('request.jwt.claims', ${claimsOf(users.buyer2)}, true)`;
        await tx`set local role authenticated`;
        const [first] = await tx<{ ok: boolean }[]>`
          select app.community_action_allowed(${fx.orgA}::uuid, 'like') as ok`;
        readBefore = first?.ok ?? null;
        // connection 2: the revoke commits while connection 1's transaction is still open
        await revokeBuyer2();
        revoked = true;
        await tx`
          insert into public.feed_likes (tenant_id, post_id, user_id)
          values (${tenantId}::uuid, ${fx.adminPost}::uuid, ${users.buyer2}::uuid)`;
      });
    } catch (error) {
      refusal = error as { code?: string };
    }
    expect(revoked, 'connection 2 committed its revoke before the insert').toBe(true);
    expect(readBefore, 'the first read saw the grant').toBe(true);
    expect(
      (refusal as { code?: string } | null)?.code,
      'the next statement is a new snapshot',
    ).toBe('42501');
    expect(await likeRowsOf(fx.adminPost, users.buyer2)).toBe(0);
    // the same lane on a NEW statement sees no grant at all
    expect(await scopeOf(users.buyer2)).toEqual({});
  });

  it('7. a revoke committing AFTER the insert leaves the row in place, and no entitlement row lock was taken (the revoke never waited)', async () => {
    await rebuyBuyer2();
    await adminSql`delete from public.feed_likes where user_id = ${users.buyer2}::uuid and post_id = ${fx.adminPost}::uuid`;
    let revokeMs = Number.POSITIVE_INFINITY;
    await lane1.begin('isolation level read committed', async (tx) => {
      await tx`select set_config('request.jwt.claims', ${claimsOf(users.buyer2)}, true)`;
      await tx`set local role authenticated`;
      await tx`
        insert into public.feed_likes (tenant_id, post_id, user_id)
        values (${tenantId}::uuid, ${fx.adminPost}::uuid, ${users.buyer2}::uuid)`;
      // the revoke is a plain UPDATE of the entitlement row: if the insert had locked it, this would wait for our commit
      const started = Date.now();
      await Promise.race([
        revokeBuyer2(),
        sleep(4000).then(() => {
          throw new Error('the revoke waited on a lock held by the like insert');
        }),
      ]);
      revokeMs = Date.now() - started;
    });
    expect(revokeMs).toBeLessThan(4000);
    expect(
      await likeRowsOf(fx.adminPost, users.buyer2),
      'the like written before the revoke stays',
    ).toBe(1);
    expect(await scopeOf(users.buyer2)).toEqual({});
    await adminSql`delete from public.feed_likes where user_id = ${users.buyer2}::uuid`;
  });

  it('8. the API maps the member 42501 of a revoke landing between the guard and the write to the bare 403, on like, comment heart and comment, and a staff 42501 stays a 500', async () => {
    // product B (no flag) keeps the community OPEN after A is revoked, so the refusal is the gate's 42501 and not a locked read
    await holdProductB();
    await rebuyBuyer2();
    const raced = await raceBetweenGuardAndWrite('feed_likes', REVOKE_BUYER2(), () =>
      likePost(tokens.buyer2, fx.adminPost),
    );
    await expectBare403(raced, 'like raced by a revoke');
    expect(await likeRowsOf(fx.adminPost, users.buyer2)).toBe(0);

    await rebuyBuyer2();
    const racedHeart = await raceBetweenGuardAndWrite('feed_likes', REVOKE_BUYER2(), () =>
      post(`/v1/feed/comments/${fx.adminComment}/like`, tokens.buyer2),
    );
    await expectBare403(racedHeart, 'comment heart raced by a revoke');

    await rebuyBuyer2();
    const racedComment = await raceBetweenGuardAndWrite('feed_comments', REVOKE_BUYER2(), () =>
      commentOn(tokens.buyer2, fx.adminPost, `${PREFIX} corrida`),
    );
    await expectBare403(racedComment, 'comment raced by a revoke');
    const [written] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_comments
       where author_user_id = ${users.buyer2}::uuid and body = ${`${PREFIX} corrida`}`;
    expect(written?.n).toBe(0);

    // positive control: with the grant in place the very same calls pass
    await rebuyBuyer2();
    expect((await likePost(tokens.buyer2, fx.adminPost)).status).toBe(200);
    await adminSql`delete from public.feed_likes where user_id = ${users.buyer2}::uuid`;

    // the LAST product revoked: the community turns locked at the write statement, so the comment is already hidden
    // from the lane. Whatever the answer is (the bare 403 or the locked read's 404) it is never a 500 and nothing lands.
    await releaseProductB();
    const lastProduct = await raceBetweenGuardAndWrite('feed_likes', REVOKE_BUYER2(), () =>
      post(`/v1/feed/comments/${fx.adminComment}/like`, tokens.buyer2),
    );
    expect([403, 404], `the last-product race answered ${lastProduct.status}`).toContain(
      lastProduct.status,
    );
    const [landed] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_likes
       where comment_id = ${fx.adminComment}::uuid and user_id = ${users.buyer2}::uuid`;
    expect(landed?.n).toBe(0);
    await rebuyBuyer2();

    // staff: a 42501 raised for the administrator is NEVER masked (a real policy bug stays a 500)
    await adminSql.unsafe(`
      create or replace function public.bpi_raise_42501() returns trigger language plpgsql as $f$
      begin raise exception 'bpi staff refusal' using errcode = '42501'; end $f$`);
    await adminSql.unsafe(`
      create trigger bpi_raise_42501 before insert on public.feed_likes
        for each row when (new.user_id = '${users.admin}'::uuid) execute function public.bpi_raise_42501()`);
    try {
      await adminSql`delete from public.feed_likes where user_id = ${users.admin}::uuid`;
      const staff = await likePost(tokens.admin, fx.adminPost);
      expect(staff.status).toBe(500);
    } finally {
      await dropRaceTriggers();
    }
    await adminSql`delete from public.feed_likes where user_id = ${users.admin}::uuid`;
  });
});

async function dropRaceTriggers(): Promise<void> {
  await adminSql`drop trigger if exists bpi_raise_42501 on public.feed_likes`;
  await adminSql`drop function if exists public.bpi_raise_42501()`;
}

// ── Task 2: the notification negative through the worker's own job path ──────────────────────────────────────────

/**
 * Plays the worker for the fan-out jobs that name `postId` ONLY (the old jobs of the local stack are none of this suite's
 * business): each `created` row goes through the real `notificationsFanoutJob.handler` and is marked `completed`, like
 * `boss.work` would. Returns how many handlers ran.
 */
async function runFanoutFor(postId: string): Promise<number> {
  const { notificationsFanoutJob } = await import('@rede-social/module-notifications/server');
  const rows = (await notificationJobsOf(tenantId)).filter(
    (row) => row.state === 'created' && JSON.stringify(row.data).includes(postId),
  );
  for (const row of rows) {
    await notificationsFanoutJob.handler(
      row.data as Parameters<typeof notificationsFanoutJob.handler>[0],
    );
    await adminSql`
      update pgboss.job_common set state = 'completed', completed_on = now()
       where name = 'notifications.fanout' and id = ${row.id}::uuid`;
  }
  return rows.length;
}

const notificationsAbout = (postId: string) =>
  adminSql<{ user_id: string; kind: string }[]>`
    select user_id::text as user_id, kind from public.notifications
     where tenant_id = ${tenantId}::uuid and subject_id = ${postId}::uuid`;

const pushJobsAbout = async (postId: string) =>
  (await pushSendJobsOf(tenantId)).filter((row) => JSON.stringify(row.data).includes(postId));

describe('11.1-11 notification negative: a buyer’s post tells nobody, a staff post of the same community still does (D-881, T-11.1-42)', () => {
  it('9. BPERM-10/D-881: the buyer’s community post raises no notification row and no push job after the worker ran its fan-out job; the administrator’s post of the same community notifies its holders (positive control)', async () => {
    restores.push(await withModuleEnabled('demo', 'notifications'));
    await rebuyBuyer2();
    await adminSql`update public.store_product_communities set can_post = true where product_id = ${fx.productA}::uuid`;

    const mine = await publish(tokens.buyer2, `${PREFIX} do comprador notificacao`, fx.orgA);
    expect(mine.status, await mine.clone().text()).toBe(201);
    const buyerPost = ((await mine.json()) as FeedPost).id;
    const [stored] = await adminSql<{ visibility: string }[]>`
      select visibility from public.feed_posts where id = ${buyerPost}::uuid`;
    expect(stored?.visibility).toBe('community');

    // the staff post of the SAME community, written after, notifies the holders
    const staff = await publish(tokens.admin, `${PREFIX} do admin notificacao`, fx.orgA);
    expect(staff.status, await staff.clone().text()).toBe(201);
    const staffPost = ((await staff.json()) as FeedPost).id;

    // the event bus enqueued a fan-out job for each post; the worker's handler resolves each one
    const buyerJobs = (await notificationJobsOf(tenantId)).filter((row) =>
      JSON.stringify(row.data).includes(buyerPost),
    );
    const staffJobs = (await notificationJobsOf(tenantId)).filter((row) =>
      JSON.stringify(row.data).includes(staffPost),
    );
    expect(
      buyerJobs.length,
      'the bus enqueues a job for every post.published, a buyer’s included',
    ).toBe(1);
    expect(staffJobs.length).toBe(1);

    expect(await runFanoutFor(buyerPost)).toBe(1);
    expect(await notificationsAbout(buyerPost), 'no row for any user of the tenant').toEqual([]);
    expect(await pushJobsAbout(buyerPost), 'no push job names the buyer’s post').toEqual([]);
    const [anyRow] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.notifications
       where tenant_id = ${tenantId}::uuid and (payload::text like ${`%${buyerPost}%`}
          or dedupe_key like ${`%${buyerPost}%`})`;
    expect(anyRow?.n, 'no row of any kind mentions the post').toBe(0);

    // positive control: the staff post of the same community reaches the holders (the community is gated, so only they)
    expect(await runFanoutFor(staffPost)).toBe(1);
    const told = await notificationsAbout(staffPost);
    expect(told.length, 'the staff post notifies').toBeGreaterThan(0);
    expect(told.map((row) => row.user_id)).toContain(users.buyer2);
    expect(told.map((row) => row.user_id)).not.toContain(users.reader);
    expect(told.map((row) => row.user_id)).not.toContain(users.admin);

    await adminSql`delete from public.notifications where subject_id in (${buyerPost}::uuid, ${staffPost}::uuid)`;
    await adminSql`update public.store_product_communities set can_post = true where product_id = ${fx.productA}::uuid`;
  });
});

// ── Task 2: the cross-tenant matrix (T-isolation, BPERM-25) ──────────────────────────────────────────────────────

/** A response as comparable bytes: status plus the body with the per-request id dropped. */
async function bytesOfAnswer(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { error?: { requestId?: string } };
    if (parsed.error) {
      const { requestId: _requestId, ...error } = parsed.error;
      return `${res.status} ${JSON.stringify({ error })}`;
    }
  } catch {
    // not JSON: compare the raw text
  }
  return `${res.status} ${text}`;
}

/**
 * The oracle rule (D-23): a foreign id answers the SAME bytes as an id that exists nowhere, so the answer cannot tell a
 * caller whether the row exists in some other tenant. Returns the shared answer for further needles.
 */
async function expectSameAsUnknown(
  label: string,
  foreign: () => Promise<Response> | Response,
  unknown: () => Promise<Response> | Response,
  status = 404,
): Promise<string> {
  const [a, b] = [await foreign(), await unknown()];
  expect(a.status, `${label}: foreign id`).toBe(status);
  expect(b.status, `${label}: unknown id`).toBe(status);
  const [foreignBytes, unknownBytes] = [await bytesOfAnswer(a), await bytesOfAnswer(b)];
  expect(foreignBytes, `${label}: a foreign id answers like an unknown one`).toBe(unknownBytes);
  return foreignBytes;
}

/** `app.community_action_allowed` for one lane, claims bound exactly as `withTenantTx` binds them. */
async function allowedOf(
  userId: string,
  tenant: string,
  community: string,
  action: string,
  role = 'member',
): Promise<boolean> {
  const rows = await adminSql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claimsOf(userId, tenant, role)}, true)`;
    await tx`set local role authenticated`;
    return tx<{ ok: boolean }[]>`
      select app.community_action_allowed(${community}::uuid, ${action}::text) as ok`;
  });
  return rows[0]?.ok === true;
}

/** `app.community_action_denied_ids(action)` for one lane. */
async function deniedOf(userId: string, tenant: string, action: string, role = 'member') {
  const rows = await adminSql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claimsOf(userId, tenant, role)}, true)`;
    await tx`set local role authenticated`;
    return tx<{ ids: string[] | null }[]>`
      select app.community_action_denied_ids(${action}::text) as ids`;
  });
  return rows[0]?.ids ?? [];
}

/** Tenant B (`rede-lab`): the same shapes as tenant A, built through the owner connection and the real routes. */
const b = {
  admin: '',
  adminUser: '',
  buyer: '',
  buyerUser: '',
  buyerMembership: '',
  orgB: '',
  productB: '',
  hB: '',
  storyB: '',
  postB: '',
  commentB: '',
};
const dual = { userId: '', token: '', membershipA: '' };
const empty = { tenant: '', host: '', slug: '', member: '', admin: '', memberUser: '' };

async function insertLabStory(author: string, label: string): Promise<string> {
  const asset = randomUUID();
  createdAssets.push(asset);
  await adminSql`
    insert into public.media_assets
      (id, tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, variant_widths)
    values (${asset}::uuid, ${labTenantId}::uuid, ${author}::uuid, 'image', 'story', 'ready', 'supabase',
            'image/webp', 1024, '{640,1080}'::int[])`;
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.stories
      (tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility, published_at, expires_at)
    values (${labTenantId}::uuid, ${author}::uuid, ${asset}::uuid, 'image', ${`${PREFIX} ${label}`},
            'followers', now(), now() + interval '24 hours')
    returning id`;
  return row?.id ?? '';
}

describe('11.1-11 matrix: a buyer of one tenant holds, reads and writes nothing through another tenant (BPERM-25, T-11.1-40)', () => {
  beforeAll(async () => {
    restores.push(await withStoreEnabled('lab'));
    restores.push(await withSocialEnabled('lab'));
    restores.push(await withCommunitiesEnabled('lab'));
    restores.push(await withStoriesEnabled('lab'));
    b.admin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
    const [admin] = await adminSql<{ user_id: string }[]>`
      select m.user_id::text as user_id from public.memberships m
        join public.users u on u.id = m.user_id
       where u.email = 'admin@rede-lab.local' and m.tenant_id = ${labTenantId}::uuid`;
    b.adminUser = admin?.user_id ?? '';
    const buyer = await createSharedIdentity({ prefix: PREFIX, memberships: [{ host: 'lab' }] });
    b.buyerUser = buyer.userId;
    b.buyer = await signInAs(buyer.email, buyer.password);
    const [membership] = await adminSql<{ id: string }[]>`
      select id::text as id from public.memberships
       where user_id = ${b.buyerUser}::uuid and tenant_id = ${labTenantId}::uuid`;
    b.buyerMembership = membership?.id ?? '';

    // tenant B's organization community carries the SAME name (and so the same slug) as tenant A's `orgA`
    const orgB = await post('/v1/communities', b.admin, { name: `${PREFIX} orgA` }, HOSTS.lab);
    expect(orgB.status, await orgB.clone().text()).toBe(201);
    b.orgB = ((await orgB.json()) as { id: string }).id;
    const productB = await post(
      '/v1/store/products',
      b.admin,
      {
        name: `${PREFIX} produto lab`,
        priceCents: 1990,
        communityLinks: [
          { communityId: b.orgB, like: true, comment: true, share: true, post: true, story: true },
        ],
      },
      HOSTS.lab,
    );
    expect(productB.status, await productB.clone().text()).toBe(201);
    b.productB = ((await productB.json()) as ProductDetail).id;
    expect(
      await gatewayPurchase(b.buyerMembership, b.productB, `${PREFIX}-lab-1`, labTenantId),
    ).toBe('purchased');
    b.storyB = await insertLabStory(b.buyerUser, 'story do lab');
    const [highlight] = await adminSql<{ id: string }[]>`
      insert into public.story_highlights
        (tenant_id, community_id, title, position, created_by_user_id, open_to_buyers)
      values (${labTenantId}::uuid, ${b.orgB}::uuid, ${`${PREFIX} aberto lab`}, 0, ${b.adminUser}::uuid, true)
      returning id::text as id`;
    b.hB = highlight?.id ?? '';
    await adminSql`
      insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
      values (${labTenantId}::uuid, ${b.hB}::uuid, ${b.storyB}::uuid, ${b.buyerUser}::uuid)`;
    const postB = await post(
      '/v1/feed/posts',
      b.admin,
      { caption: `${PREFIX} post do lab`, communityId: b.orgB },
      HOSTS.lab,
    );
    expect(postB.status, await postB.clone().text()).toBe(201);
    b.postB = ((await postB.json()) as { id: string }).id;
    const commentB = await post(
      `/v1/feed/posts/${b.postB}/comments`,
      b.admin,
      { body: `${PREFIX} comentario do lab` },
      HOSTS.lab,
    );
    expect(commentB.status, await commentB.clone().text()).toBe(201);
    b.commentB = ((await commentB.json()) as FeedComment).id;

    // one user, two tenants: holds product A in tenant A and NOTHING in tenant B
    const shared = await createSharedIdentity({
      prefix: PREFIX,
      memberships: [{ host: 'demo' }, { host: 'lab' }],
    });
    dual.userId = shared.userId;
    dual.token = await signInAs(shared.email, shared.password);
    const [dualMembership] = await adminSql<{ id: string }[]>`
      select id::text as id from public.memberships
       where user_id = ${dual.userId}::uuid and tenant_id = ${tenantId}::uuid`;
    dual.membershipA = dualMembership?.id ?? '';
    expect(await gatewayPurchase(dual.membershipA, fx.productA, `${PREFIX}-dual`)).toBe(
      'purchased',
    );
    await rebuyBuyer2();
  });

  it('10. the like, the comment and the post of tenant A’s buyer against tenant B’s ids answer exactly what an unknown id answers; A’s own call passes beside each', async () => {
    const stranger = randomUUID();
    await expectSameAsUnknown(
      'like on a foreign post',
      () => likePost(tokens.buyer2, b.postB),
      () => likePost(tokens.buyer2, stranger),
    );
    await expectSameAsUnknown(
      'comment on a foreign post',
      () => commentOn(tokens.buyer2, b.postB, `${PREFIX} nao deve gravar`),
      () => commentOn(tokens.buyer2, stranger, `${PREFIX} nao deve gravar`),
    );
    await expectSameAsUnknown(
      'comment heart on a foreign comment',
      () => post(`/v1/feed/comments/${b.commentB}/like`, tokens.buyer2),
      () => post(`/v1/feed/comments/${stranger}/like`, tokens.buyer2),
    );
    await expectSameAsUnknown(
      'post into a foreign community',
      () => publish(tokens.buyer2, `${PREFIX} nao deve gravar`, b.orgB),
      () => publish(tokens.buyer2, `${PREFIX} nao deve gravar`, stranger),
    );
    const [leaked] = await adminSql<{ n: number }[]>`
      select (select count(*) from public.feed_likes where user_id = ${users.buyer2}::uuid and post_id = ${b.postB}::uuid)::int
           + (select count(*) from public.feed_comments where author_user_id = ${users.buyer2}::uuid and post_id = ${b.postB}::uuid)::int
           + (select count(*) from public.feed_posts where caption = ${`${PREFIX} nao deve gravar`})::int as n`;
    expect(leaked?.n, 'nothing was written in tenant B').toBe(0);
    // the positive control: tenant A's own calls, the very same shapes, pass
    expect((await likePost(tokens.buyer2, fx.adminPost)).status).toBe(200);
    expect((await commentOn(tokens.buyer2, fx.adminPost, `${PREFIX} controle A`)).status).toBe(201);
    expect((await post(`/v1/feed/comments/${fx.adminComment}/like`, tokens.buyer2)).status).toBe(
      200,
    );
    expect((await publish(tokens.buyer2, `${PREFIX} controle A`, fx.orgA)).status).toBe(201);
    await adminSql`delete from public.feed_likes where user_id = ${users.buyer2}::uuid`;
  });

  it('11. the highlight item, the open switch and the open counts of tenant A against tenant B’s highlight and community answer like unknown ids; A’s own pass', async () => {
    const stranger = randomUUID();
    const mine = await insertStory(users.buyer2, 'story de A cruzado');
    await expectSameAsUnknown(
      'add into a foreign highlight (buyer)',
      () => addItem(tokens.buyer2, b.hB, mine),
      () => addItem(tokens.buyer2, stranger, mine),
    );
    await expectSameAsUnknown(
      'add into a foreign highlight (administrator)',
      () => addItem(tokens.admin, b.hB, mine),
      () => addItem(tokens.admin, stranger, mine),
    );
    await expectSameAsUnknown(
      'remove from a foreign highlight (buyer)',
      () => del(`/v1/stories/highlights/${b.hB}/stories/${b.storyB}`, tokens.buyer2),
      () => del(`/v1/stories/highlights/${stranger}/stories/${b.storyB}`, tokens.buyer2),
    );
    await expectSameAsUnknown(
      'remove from a foreign highlight (administrator)',
      () => del(`/v1/stories/highlights/${b.hB}/stories/${b.storyB}`, tokens.admin),
      () => del(`/v1/stories/highlights/${stranger}/stories/${b.storyB}`, tokens.admin),
    );
    const patchOpen = (token: string, id: string, open: boolean) =>
      request(`/v1/stories/highlights/${id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ openToBuyers: open }),
      });
    await expectSameAsUnknown(
      'the open switch on a foreign highlight',
      () => patchOpen(tokens.admin, b.hB, false),
      () => patchOpen(tokens.admin, stranger, false),
    );
    const [stillOpen] = await adminSql<{ open_to_buyers: boolean }[]>`
      select open_to_buyers from public.story_highlights where id = ${b.hB}::uuid`;
    expect(stillOpen?.open_to_buyers, 'tenant B’s highlight stayed open').toBe(true);
    const [stillItem] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.story_highlight_items where highlight_id = ${b.hB}::uuid`;
    expect(stillItem?.n, 'tenant B’s item stayed').toBe(1);

    // the open counts: a foreign community is ABSENT, the same as an unknown id; A's own community has its row
    const counts = (ids: string[]) =>
      get(`/v1/stories/highlights/open-counts?communityIds=${ids.join(',')}`, tokens.admin);
    await expectSameAsUnknown(
      'open counts of a foreign community',
      () => counts([b.orgB]),
      () => counts([stranger]),
      200,
    );
    const both = await counts([b.orgB, stranger, fx.orgA]);
    const rows = ((await both.json()) as { items: { communityId: string; openCount: number }[] })
      .items;
    expect(rows.map((row) => row.communityId)).toEqual([fx.orgA]);
    expect(JSON.stringify(rows)).not.toContain(b.orgB);

    // the positive control: tenant A's own highlight takes the story and the administrator's switch answers 200
    expect((await addItem(tokens.buyer2, fx.hOpen, mine)).status).toBe(200);
    expect((await removeItemOf(tokens.buyer2, fx.hOpen, mine)).status).toBe(200);
    expect((await patchOpen(tokens.admin, fx.hOpen, true)).status).toBe(200);
  });

  it('12. viewer.actions, post.community.actions, the catalogue and the product read never answer for tenant B; A’s own reads pass', async () => {
    const stranger = randomUUID();
    await expectSameAsUnknown(
      'community detail (viewer.actions)',
      () => get(`/v1/communities/${b.orgB}`, tokens.buyer2),
      () => get(`/v1/communities/${stranger}`, tokens.buyer2),
    );
    const list = await get('/v1/communities', tokens.buyer2);
    expect(list.status).toBe(200);
    const listed = ((await list.json()) as { items: CommunitySummary[] }).items;
    expect(listed.map((item) => item.id)).not.toContain(b.orgB);
    expect(
      listed.map((item) => item.id),
      'positive control: A’s own community',
    ).toContain(fx.orgA);
    await expectSameAsUnknown(
      'post detail (community.actions)',
      () => get(`/v1/feed/posts/${b.postB}`, tokens.buyer2),
      () => get(`/v1/feed/posts/${stranger}`, tokens.buyer2),
    );
    await expectSameAsUnknown(
      'comment list of a foreign post',
      () => get(`/v1/feed/posts/${b.postB}/comments`, tokens.buyer2),
      () => get(`/v1/feed/posts/${stranger}/comments`, tokens.buyer2),
    );
    const feed = await get(`/v1/feed?communityId=${b.orgB}&limit=25`, tokens.buyer2);
    const feedUnknown = await get(`/v1/feed?communityId=${stranger}&limit=25`, tokens.buyer2);
    expect(await bytesOfAnswer(feed), 'the community feed of a foreign community').toBe(
      await bytesOfAnswer(feedUnknown),
    );
    expect(feed.status).toBe(404);
    expect((await get(`/v1/feed/posts/${fx.adminPost}`, tokens.buyer2)).status).toBe(200);

    // the buyer catalogue: A's open highlight, never B's
    await adminSql`update public.story_highlights set open_to_buyers = true where id = ${fx.hOpen}::uuid`;
    const catalog = await get('/v1/stories/highlights/catalog', tokens.buyer2);
    expect(catalog.status, await catalog.clone().text()).toBe(200);
    const catalogIds = ((await catalog.json()) as { items: { id: string }[] }).items.map(
      (item) => item.id,
    );
    expect(catalogIds).toContain(fx.hOpen);
    expect(catalogIds).not.toContain(b.hB);

    // the member product read and the catalogue of products
    await expectSameAsUnknown(
      'product read',
      () => get(`/v1/store/products/${b.productB}`, tokens.buyer2),
      () => get(`/v1/store/products/${stranger}`, tokens.buyer2),
    );
    const products = await get('/v1/store/products', tokens.buyer2);
    expect(products.status).toBe(200);
    const productsText = await products.text();
    expect(productsText).not.toContain(b.productB);
    expect(productsText).toContain(fx.productA);
    await expectSameAsUnknown(
      'community access read',
      () => get(`/v1/store/communities/${b.orgB}/access`, tokens.buyer2),
      () => get(`/v1/store/communities/${stranger}/access`, tokens.buyer2),
    );
  });

  it('13. the product form (communityLinks) of tenant A cannot touch tenant B’s product or name tenant B’s community; its own link writes pass', async () => {
    const stranger = randomUUID();
    const links = (communityId: string) => [
      { communityId, like: true, comment: true, share: true, post: true, story: true },
    ];
    const patchProduct = (id: string, communityId: string) =>
      request(`/v1/store/products/${id}`, tokens.admin, {
        method: 'PATCH',
        body: JSON.stringify({ communityLinks: links(communityId) }),
      });
    await expectSameAsUnknown(
      'patch a foreign product',
      () => patchProduct(b.productB, fx.orgA),
      () => patchProduct(stranger, fx.orgA),
    );
    const [untouched] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.store_product_communities
       where product_id = ${b.productB}::uuid and community_id = ${b.orgB}::uuid and can_post and can_story`;
    expect(untouched?.n, 'tenant B’s link kept its flags and its community').toBe(1);
    const [leakedLink] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.store_product_communities
       where product_id = ${b.productB}::uuid and community_id = ${fx.orgA}::uuid`;
    expect(leakedLink?.n).toBe(0);

    // naming a foreign community in OUR product's links is refused like naming one that exists nowhere
    const createWith = (communityId: string) =>
      post('/v1/store/products', tokens.admin, {
        name: `${PREFIX} produto cruzado`,
        priceCents: 500,
        communityLinks: links(communityId),
      });
    const refused = await expectSameAsUnknown(
      'communityLinks naming a foreign community',
      () => createWith(b.orgB),
      () => createWith(stranger),
      400,
    );
    expect(refused).not.toContain(b.orgB);
    const [crossed] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.store_products where name = ${`${PREFIX} produto cruzado`}`;
    expect(crossed?.n, 'no product was created by either refusal').toBe(0);
    // positive controls: our own community in the same body, on create and on patch
    const ok = await createWith(fx.orgA);
    expect(ok.status, await ok.clone().text()).toBe(201);
    expect((await patchProduct(fx.productA, fx.orgA)).status).toBe(200);
  });

  it('14. tenant A’s session on tenant B’s host is refused TENANT_HOST_MISMATCH before any read; the same call on its own host passes', async () => {
    const mismatch = async (res: Response, label: string) => {
      expect(res.status, label).toBe(403);
      expect(((await res.json()) as Envelope).error.code, label).toBe('TENANT_HOST_MISMATCH');
    };
    await mismatch(
      await get(`/v1/communities/${b.orgB}`, tokens.buyer2, HOSTS.lab),
      'community read',
    );
    await mismatch(
      await post(`/v1/feed/posts/${b.postB}/like`, tokens.buyer2, undefined, HOSTS.lab),
      'like',
    );
    await mismatch(
      await post(
        '/v1/feed/posts',
        tokens.buyer2,
        { caption: `${PREFIX} host`, communityId: b.orgB },
        HOSTS.lab,
      ),
      'post',
    );
    await mismatch(
      await get('/v1/stories/highlights/catalog', tokens.buyer2, HOSTS.lab),
      'catalogue',
    );
    await mismatch(
      await put(`/v1/stories/highlights/${b.hB}/stories/${b.storyB}`, tokens.buyer2, HOSTS.lab),
      'item add',
    );
    await mismatch(await get('/v1/store/products', tokens.buyer2, HOSTS.lab), 'product list');
    // the other way round: tenant B's buyer on tenant A's host
    await mismatch(await get(`/v1/communities/${fx.orgA}`, b.buyer, HOSTS.demo), 'B on A’s host');
    expect(
      (await get(`/v1/communities/${fx.orgA}`, tokens.buyer2)).status,
      'positive control',
    ).toBe(200);
    expect(
      (await get(`/v1/communities/${b.orgB}`, b.buyer, HOSTS.lab)).status,
      'positive control B',
    ).toBe(200);
  });

  it('15. the symmetric direction (creation order is irrelevant): tenant B’s buyer against tenant A’s ids answers like unknown ids, beside B’s own passing call', async () => {
    const stranger = randomUUID();
    const onLab = (path: string, init: RequestInit = {}) => request(path, b.buyer, init, HOSTS.lab);
    await expectSameAsUnknown(
      'B likes a post of A',
      () => onLab(`/v1/feed/posts/${fx.adminPost}/like`, { method: 'POST' }),
      () => onLab(`/v1/feed/posts/${stranger}/like`, { method: 'POST' }),
    );
    await expectSameAsUnknown(
      'B posts into a community of A',
      () =>
        onLab('/v1/feed/posts', {
          method: 'POST',
          body: JSON.stringify({ caption: `${PREFIX} nao deve gravar B`, communityId: fx.orgA }),
        }),
      () =>
        onLab('/v1/feed/posts', {
          method: 'POST',
          body: JSON.stringify({ caption: `${PREFIX} nao deve gravar B`, communityId: stranger }),
        }),
    );
    await expectSameAsUnknown(
      'B reads a community of A',
      () => onLab(`/v1/communities/${fx.orgA}`),
      () => onLab(`/v1/communities/${stranger}`),
    );
    await expectSameAsUnknown(
      'B adds into a highlight of A',
      () => onLab(`/v1/stories/highlights/${fx.hOpen}/stories/${b.storyB}`, { method: 'PUT' }),
      () => onLab(`/v1/stories/highlights/${stranger}/stories/${b.storyB}`, { method: 'PUT' }),
    );
    const none = await adminSql`
      select 1 from public.feed_posts where caption = ${`${PREFIX} nao deve gravar B`}`;
    expect(none).toHaveLength(0);
    // positive control: B's own buyer likes B's post, posts into B's community and sees B's catalogue
    expect((await onLab(`/v1/feed/posts/${b.postB}/like`, { method: 'POST' })).status).toBe(200);
    const posted = await onLab('/v1/feed/posts', {
      method: 'POST',
      body: JSON.stringify({ caption: `${PREFIX} do comprador do lab`, communityId: b.orgB }),
    });
    expect(posted.status, await posted.clone().text()).toBe(201);
    const catalog = await onLab('/v1/stories/highlights/catalog');
    const ids = ((await catalog.json()) as { items: { id: string }[] }).items.map(
      (item) => item.id,
    );
    expect(ids).toContain(b.hB);
    expect(ids).not.toContain(fx.hOpen);
  });

  it('16. BPERM-25 adjacency: two tenants each hold a community with the SAME name and slug and one user is a member of both; tenant A’s grant never answers for B’s twin, under either claim', async () => {
    const [twins] = await adminSql<{ names: string[]; slugs: string[]; tenants: number }[]>`
      select array_agg(name) as names, array_agg(slug) as slugs, count(distinct tenant_id)::int as tenants
        from public.communities where id in (${fx.orgA}::uuid, ${b.orgB}::uuid)`;
    expect(twins?.tenants).toBe(2);
    expect(new Set(twins?.names).size, 'the two communities carry one name').toBe(1);
    expect(new Set(twins?.slugs).size, 'the two communities carry one slug').toBe(1);

    // under tenant A's claim the shared user holds every permission in A's community and none of them in B's
    for (const action of ['like', 'comment', 'share', 'post', 'story']) {
      expect(
        await allowedOf(dual.userId, tenantId, fx.orgA, action),
        `A claim, A community, ${action}`,
      ).toBe(true);
      expect(
        await allowedOf(dual.userId, tenantId, b.orgB, action),
        `A claim, B community, ${action}`,
      ).toBe(false);
      expect(
        await allowedOf(dual.userId, labTenantId, fx.orgA, action),
        `B claim, A community, ${action}`,
      ).toBe(false);
      expect(
        await allowedOf(dual.userId, labTenantId, b.orgB, action),
        `B claim, B community, ${action}`,
      ).toBe(false);
    }
    expect(Object.keys(await scopeOf(dual.userId, tenantId))).toEqual([fx.orgA]);
    expect(await scopeOf(dual.userId, labTenantId)).toEqual({});
    // the lane form: under B's claim A's community is in nobody's denied list either (it does not exist there)
    expect(await deniedOf(dual.userId, labTenantId, 'like')).not.toContain(fx.orgA);
    // staff fail closed in both tenants
    expect(await scopeOf(users.admin, tenantId, 'admin_tenant')).toEqual({});
    expect(await scopeOf(b.adminUser, labTenantId, 'admin_tenant')).toEqual({});

    // through the API, same token, two hosts: it posts in A, and in B's same-named community it is refused
    const inA = await publish(dual.token, `${PREFIX} dual em A`, fx.orgA);
    expect(inA.status, await inA.clone().text()).toBe(201);
    const labPost = (caption: string, communityId: string) =>
      post('/v1/feed/posts', dual.token, { caption, communityId }, HOSTS.lab);
    const inB = await labPost(`${PREFIX} dual em B`, b.orgB);
    expect(inB.status, 'the grant of A does not post in B').toBeGreaterThanOrEqual(403);
    expect(inB.status).toBeLessThan(500);
    const [rowB] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_posts where caption = ${`${PREFIX} dual em B`}`;
    expect(rowB?.n).toBe(0);
    await expectSameAsUnknown(
      'the shared user under B’s claim reaches no post of A',
      () =>
        request(`/v1/feed/posts/${fx.adminPost}/like`, dual.token, { method: 'POST' }, HOSTS.lab),
      () =>
        request(`/v1/feed/posts/${randomUUID()}/like`, dual.token, { method: 'POST' }, HOSTS.lab),
    );
    // the viewer flags: A's community reads every flag for the shared user, B's twin reads today's member values
    const actionsAt = async (community: string, host: string) => {
      const res = await get(`/v1/communities/${community}`, dual.token, host);
      return {
        status: res.status,
        actions: ((await res.json()) as CommunitySummary).viewer?.actions,
      };
    };
    expect((await actionsAt(fx.orgA, HOSTS.demo)).actions).toEqual(ALL_ON);
    const twin = await actionsAt(b.orgB, HOSTS.lab);
    expect(twin.status).toBe(200);
    expect(twin.actions?.post).toBe(false);
    expect(twin.actions?.story).toBe(false);
  });

  it('17. BPERM-25 empty and ordering: a tenant with no community, product or entitlement answers empty or false everywhere, never an error', async () => {
    empty.slug = `${PREFIX}-vazio`;
    empty.host = `${empty.slug}.localhost`;
    const [tenant] = await adminSql<{ id: string }[]>`
      insert into public.tenants (slug, display_name, rules_text, rules_version)
      values (${empty.slug}, 'Vazia', 'Regras de teste.', 1) returning id::text as id`;
    empty.tenant = tenant?.id ?? '';
    for (const key of ['feed', 'store', 'social', 'communities', 'stories']) {
      await adminSql`
        insert into public.tenant_modules (tenant_id, module_key, enabled)
        values (${empty.tenant}::uuid, ${key}, true)`;
    }
    await adminSql`
      insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
      values (${empty.tenant}::uuid, ${empty.host}, true, now())`;
    moduleFlags.invalidate(empty.tenant);
    const member = await createSharedIdentity({
      prefix: PREFIX,
      memberships: [{ tenantSlug: empty.slug }],
    });
    const admin = await createSharedIdentity({
      prefix: PREFIX,
      memberships: [{ tenantSlug: empty.slug, role: 'admin_tenant' }],
    });
    empty.memberUser = member.userId;
    empty.member = await signInAs(member.email, member.password);
    empty.admin = await signInAs(admin.email, admin.password);

    const read = async (path: string, token = empty.member) => {
      const res = await get(path, token, empty.host);
      expect(res.status, `${path} -> ${await res.clone().text()}`).toBe(200);
      return (await res.json()) as { items: unknown[] };
    };
    expect((await read('/v1/communities')).items).toEqual([]);
    expect((await read('/v1/stories/highlights/catalog', empty.admin)).items).toEqual([]);
    expect((await read('/v1/store/products')).items).toEqual([]);
    expect((await read('/v1/feed?limit=25')).items).toEqual([]);
    expect(
      (await read(`/v1/stories/highlights/open-counts?communityIds=${randomUUID()}`, empty.admin))
        .items,
    ).toEqual([]);

    // a foreign id answers the same bare 404 as an unknown one, in a tenant that owns nothing
    const stranger = randomUUID();
    await expectSameAsUnknown(
      'a tenant with nothing, a community of another tenant',
      () => get(`/v1/communities/${fx.orgA}`, empty.member, empty.host),
      () => get(`/v1/communities/${stranger}`, empty.member, empty.host),
    );
    await expectSameAsUnknown(
      'a tenant with nothing, a like on a post of another tenant',
      () =>
        request(
          `/v1/feed/posts/${fx.adminPost}/like`,
          empty.member,
          { method: 'POST' },
          empty.host,
        ),
      () =>
        request(`/v1/feed/posts/${stranger}/like`, empty.member, { method: 'POST' }, empty.host),
    );

    // the functions answer empty and false, never an error
    expect(await scopeOf(empty.memberUser, empty.tenant)).toEqual({});
    expect(await allowedOf(empty.memberUser, empty.tenant, fx.orgA, 'like')).toBe(false);
    expect(await allowedOf(empty.memberUser, empty.tenant, stranger, 'post')).toBe(false);
    expect(await deniedOf(empty.memberUser, empty.tenant, 'like')).toEqual([]);
    // and with no claims at all
    const bare = await adminSql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', '', true)`;
      await tx`set local role authenticated`;
      return tx<{ scope: unknown; ok: boolean }[]>`
        select app.community_buyer_scope() as scope, app.community_action_allowed(${fx.orgA}::uuid, 'like') as ok`;
    });
    expect(bare[0]).toEqual({ scope: {}, ok: false });
  });
});

const removeItemOf = (token: string, highlightId: string, storyId: string) =>
  del(`/v1/stories/highlights/${highlightId}/stories/${storyId}`, token);

// ── Task 3: the no-leak sweep of every member-readable body the phase touched (D-888, T-11.1-43) ──────────────────

/** Every key name the flags travel under: none of them may reach a member-readable body (UI-D-887). */
const FLAG_KEYS = [
  'can_like',
  'can_comment',
  'can_share',
  'can_post',
  'can_story',
  'canLike',
  'canComment',
  'canShare',
  'canPost',
  'canStory',
  'communityPermissions',
  'community_permissions',
  'buyer_scope',
  'buyerScope',
  'openHighlight',
  'open_highlight',
  'open_to_buyers',
];

/** Fails when `text` carries a flag key, the scope, the open-highlight fact, an entitlement id or the open switch. */
function expectNoFlagsOrEntitlements(text: string, where: string, entitlementIds: string[]) {
  for (const key of [...FLAG_KEYS, 'openToBuyers']) {
    expect(text.includes(key), `${where} must not carry "${key}"`).toBe(false);
  }
  for (const id of entitlementIds) {
    expect(text.includes(id), `${where} must not carry the entitlement id ${id}`).toBe(false);
  }
}

describe('11.1-11 leak: no member-readable body names a product, an entitlement, a flag or the open switch (D-888, T-11.1-43)', () => {
  it('18. the community, feed, comment, highlight and story reads carry no product id or name, no entitlement id, no flag key; the manager reads carry them (the sweep is not blind)', async () => {
    await rebuyBuyer2();
    await setFlags({ like: true, comment: true, share: true, post: true, story: true });
    await adminSql`update public.story_highlights set open_to_buyers = true where id = ${fx.hOpen}::uuid`;
    const story = await insertStory(users.buyer2, 'story do varrimento');
    expect((await addItem(tokens.buyer2, fx.hOpen, story)).status).toBe(200);
    const mine = await publish(tokens.buyer2, `${PREFIX} post do varrimento`, fx.orgA);
    expect(mine.status, await mine.clone().text()).toBe(201);
    const minePost = ((await mine.json()) as FeedPost).id;
    // a second, never-bought reader holds the community locked; both lanes are swept
    const entitlements = (
      await adminSql<{ id: string }[]>`
        select id::text as id from public.store_entitlements
         where product_id in (${fx.productA}::uuid, ${fx.productB}::uuid, ${b.productB}::uuid)`
    ).map((row) => row.id);
    expect(entitlements.length, 'the fixture holds entitlements to look for').toBeGreaterThan(0);
    const productWords = [
      fx.productA,
      fx.productB,
      b.productB,
      `${PREFIX} produto A`,
      `${PREFIX} produto B`,
      `${PREFIX} produto lab`,
    ];

    const paths = [
      '/v1/communities',
      `/v1/communities/${fx.orgA}`,
      `/v1/feed?communityId=${fx.orgA}&limit=25`,
      '/v1/feed?limit=25',
      '/v1/feed?scope=explorar&limit=25',
      `/v1/feed/posts/${fx.adminPost}`,
      `/v1/feed/posts/${minePost}`,
      `/v1/feed/posts/${fx.adminPost}/comments`,
      `/v1/stories/highlights?communityId=${fx.orgA}`,
      `/v1/stories/highlights/${fx.hOpen}`,
      '/v1/stories/highlights/catalog',
      `/v1/stories/${story}`,
      '/v1/stories',
    ];
    let swept = 0;
    for (const [who, token] of [
      ['buyer', tokens.buyer2],
      ['reader', tokens.reader],
    ] as const) {
      for (const path of paths) {
        const res = await get(path, token);
        const text = await res.text();
        // a locked reader may be refused or shown less: the rule is about what IS returned
        expect([200, 403, 404], `${who} ${path} -> ${res.status}`).toContain(res.status);
        expectNoFlagsOrEntitlements(text, `${who} ${path}`, entitlements);
        for (const word of productWords) {
          expect(text.includes(word), `${who} ${path} must not carry "${word}"`).toBe(false);
          expect(text.normalize('NFD').includes(word.normalize('NFD'))).toBe(false);
        }
        if (res.status === 200) swept += 1;
      }
    }
    expect(swept, 'the sweep read bodies, it did not just collect refusals').toBeGreaterThan(15);

    // the buyer's own sees the facts they may act on, by their finished names (positive control for the paths above)
    const buyerPost = await get(`/v1/feed/posts/${fx.adminPost}`, tokens.buyer2);
    expect(buyerPost.status).toBe(200);
    // the manager reads DO carry the switch and the flags, so the absences above are not a blind sweep
    const curatorHighlight = await get(`/v1/stories/highlights/${fx.hOpen}`, tokens.admin);
    expect(await curatorHighlight.text(), 'the curator read carries the switch').toContain(
      'openToBuyers',
    );
    const curatorList = await get(
      `/v1/stories/highlights?communityId=${fx.orgA}&scope=all`,
      tokens.admin,
    );
    expect(await curatorList.text()).toContain('openToBuyers');
    const managerProduct = await get(`/v1/store/products/${fx.productA}`, tokens.admin);
    expect(
      await managerProduct.text(),
      'the manager product read carries the permissions',
    ).toContain('communityPermissions');
  });

  it('19. the member product read, the product list, the community access read and the purchase answer carry no flag, no scope, no entitlement id and no other product; the subject product is allowed to name itself', async () => {
    const entitlementsBefore = (
      await adminSql<{ id: string }[]>`
        select id::text as id from public.store_entitlements
         where product_id in (${fx.productA}::uuid, ${fx.productB}::uuid, ${b.productB}::uuid)`
    ).map((row) => row.id);
    const readsOf = async (token: string, where: string, entitlementIds: string[]) => {
      const seen: string[] = [];
      for (const path of [
        `/v1/store/products/${fx.productA}`,
        '/v1/store/products',
        `/v1/store/communities/${fx.orgA}/access`,
        '/v1/store/community-access',
      ]) {
        const res = await get(path, token);
        expect([200, 404], `${where} ${path} -> ${res.status}`).toContain(res.status);
        const text = await res.text();
        expectNoFlagsOrEntitlements(text, `${where} ${path}`, entitlementIds);
        if (res.status === 200) seen.push(path);
      }
      expect(seen.length, `${where} read the product surfaces`).toBeGreaterThanOrEqual(3);
    };
    await readsOf(tokens.buyer2, 'buyer', entitlementsBefore);
    await readsOf(tokens.reader, 'reader', entitlementsBefore);

    // another tenant's product never appears in this tenant's product reads (the list and the single read)
    const list = await (await get('/v1/store/products', tokens.buyer2)).text();
    expect(list.includes(b.productB)).toBe(false);
    expect(list.includes(`${PREFIX} produto lab`)).toBe(false);
    expect(
      list.includes(fx.productA),
      'positive control: this tenant’s own product is listed',
    ).toBe(true);

    // the purchase answer: a reader buys product B (no flag ticked) and the answer names no flag and no entitlement
    const bought = await post(`/v1/store/products/${fx.productB}/purchase`, tokens.reader, {
      expectedAmountCents: 990,
    });
    const boughtText = await bought.text();
    expect(bought.status, boughtText).toBe(200);
    const after = (
      await adminSql<{ id: string }[]>`
        select id::text as id from public.store_entitlements
         where product_id in (${fx.productA}::uuid, ${fx.productB}::uuid, ${b.productB}::uuid)`
    ).map((row) => row.id);
    expect(after.length).toBeGreaterThan(entitlementsBefore.length);
    expectNoFlagsOrEntitlements(boughtText, 'the purchase answer', after);
    expect(boughtText.includes(fx.productA), 'the purchase answer names no OTHER product').toBe(
      false,
    );
    // and the reader who just bought now reads the community like any holder, with the same bodies
    const community = await get(`/v1/communities/${fx.orgA}`, tokens.reader);
    expect(community.status).toBe(200);
    expectNoFlagsOrEntitlements(await community.text(), 'the new holder’s community read', after);
  });
});
