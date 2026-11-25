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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
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

const envelope = async (res: Response) => (await res.json()) as Envelope;

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
