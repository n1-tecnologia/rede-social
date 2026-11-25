import { randomUUID } from 'node:crypto';
import { sqlClient } from '@rede-social/core/db';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { storyPublishLimiter } from '@rede-social/core/server/safety/limits';
import type { ProductDetail } from '@rede-social/module-store/contracts';
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
  withSocialEnabled,
  withStoreEnabled,
  withStoriesEnabled,
} from './setup';

/**
 * 11.1-09 (D-883, D-884, D-885, D-887, D-895; BPERM-02, BPERM-08, BPERM-12, BPERM-13, BPERM-14, BPERM-25): the stories
 * SERVICE half of buyer permissions against the live local stack and the real seed. A buyer saves and removes only their
 * OWN stories in a highlight the administrator opened, through the real routes; every refusal is one bare 403.
 *
 * Fixture (built in `beforeAll`, every name, caption and title prefixed `bps-<run>`): in `rede-demo` with `store`,
 * `social`, `communities` and `stories` ON, an organization community `orgA` made by the seed admin, a product linked
 * to it (`can_story` ticked by the owner connection, the product form is a later plan), a second community `orgB` linked
 * to nothing, throwaway members: the buyer (holds the product through the real purchase route), a second buyer and a
 * reader who holds nothing. Highlights and their open flag are written through the owner connection until the toggle
 * route is exercised. Test ORDER inside each describe is load-bearing (declaration order); every case sets the state it
 * needs.
 */

type Envelope = { error: { code: string; message?: string; details?: Record<string, unknown> } };

const RUN = Date.now();
const PREFIX = `bps-${RUN}`;

const tokens = { admin: '', buyer: '', buyer2: '', reader: '' };
const users = { admin: '', buyer: '', buyer2: '', reader: '' };
let tenantId = '';
let labTenantId = '';
let restoreStore: () => Promise<void> = async () => {};
let restoreSocial: () => Promise<void> = async () => {};
let restoreCommunities: () => Promise<void> = async () => {};
let restoreStories: () => Promise<void> = async () => {};
const createdAssets: string[] = [];
const fx = { orgA: '', orgB: '', productA: '', hOpen: '', foreignHighlight: '' };

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
const put = (path: string, token: string) => request(path, token, { method: 'PUT' });
const del = (path: string, token: string) => request(path, token, { method: 'DELETE' });
const patch = (path: string, token: string, body: unknown) =>
  request(path, token, { method: 'PATCH', body: JSON.stringify(body) });

const addItem = (token: string, highlightId: string, storyId: string) =>
  put(`/v1/stories/highlights/${highlightId}/stories/${storyId}`, token);
const removeItem = (token: string, highlightId: string, storyId: string) =>
  del(`/v1/stories/highlights/${highlightId}/stories/${storyId}`, token);

const envelope = async (res: Response) => (await res.json()) as Envelope;

/** The refusal every layer of this plan answers with: status 403, code FORBIDDEN and NO `details` key. */
async function expectBare403(res: Response, where: string) {
  const text = await res.clone().text();
  expect(res.status, `${where} -> ${text}`).toBe(403);
  const body = (await res.json()) as Envelope;
  expect(body.error.code, where).toBe('FORBIDDEN');
  expect(body.error, where).not.toHaveProperty('details');
}

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
async function insertStory(opts: {
  author: string;
  visibility?: 'tenant' | 'followers';
  label: string;
  publishedAt?: string;
  expiresAt?: string;
}): Promise<string> {
  const asset = await makeAsset(opts.author);
  const visibility = opts.visibility ?? (opts.author === users.admin ? 'tenant' : 'followers');
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.stories
      (tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility, published_at, expires_at)
    values (${tenantId}::uuid, ${opts.author}::uuid, ${asset}::uuid, 'image', ${`${PREFIX} ${opts.label}`},
            ${visibility},
            coalesce(${opts.publishedAt ?? null}::timestamptz, now()),
            coalesce(${opts.expiresAt ?? null}::timestamptz, now() + interval '24 hours'))
    returning id`;
  return row?.id ?? '';
}

/** A highlight of `orgA` (or another community, or Início) written through the owner connection. */
async function insertHighlight(opts: {
  title: string;
  communityId?: string | null;
  open?: boolean;
  tenant?: string;
}): Promise<string> {
  const tenant = opts.tenant ?? tenantId;
  const community = opts.communityId === undefined ? fx.orgA : opts.communityId;
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.story_highlights
      (tenant_id, community_id, title, position, created_by_user_id, open_to_buyers)
    select ${tenant}::uuid, ${community}::uuid, ${`${PREFIX} ${opts.title}`},
           coalesce(max(h.position) + 1, 0), ${users.admin}::uuid, ${opts.open ?? false}
      from public.story_highlights h
     where h.tenant_id = ${tenant}::uuid and h.community_id is not distinct from ${community}::uuid
    returning id`;
  return row?.id ?? '';
}

const setOpen = (highlightId: string, open: boolean) =>
  adminSql`update public.story_highlights set open_to_buyers = ${open} where id = ${highlightId}::uuid`;

const setStoryFlag = (can: boolean, community = fx.orgA) =>
  adminSql`
    update public.store_product_communities set can_story = ${can}
     where product_id = ${fx.productA}::uuid and community_id = ${community}::uuid`;

const itemsOf = async (highlightId: string) =>
  adminSql<{ story_id: string; added_by_user_id: string }[]>`
    select story_id::text as story_id, added_by_user_id::text as added_by_user_id
      from public.story_highlight_items
     where highlight_id = ${highlightId}::uuid order by added_at, id`;

async function sweep(): Promise<void> {
  const products = adminSql`select id from public.store_products where name like ${`${PREFIX}%`}`;
  await adminSql`delete from public.story_highlights where title like ${`${PREFIX}%`}`;
  await adminSql`delete from public.stories where caption like ${`${PREFIX}%`}`;
  if (createdAssets.length > 0) {
    await adminSql`delete from public.media_assets where id = any (${createdAssets}::uuid[])`;
  }
  await adminSql`delete from public.store_entitlements where product_id in (${products})`;
  await adminSql`delete from public.store_orders where product_id in (${products})`;
  await adminSql`delete from public.store_products where name like ${`${PREFIX}%`}`;
  await adminSql`delete from public.communities where name like ${`${PREFIX}%`}`;
  await removeIdentitiesByPrefix(PREFIX);
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  await sweep();
  restoreStore = await withStoreEnabled('demo');
  restoreSocial = await withSocialEnabled('demo');
  restoreCommunities = await withCommunitiesEnabled('demo');
  restoreStories = await withStoriesEnabled('demo');
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

  const orgA = await post('/v1/communities', tokens.admin, { name: `${PREFIX} orgA` });
  expect(orgA.status).toBe(201);
  fx.orgA = ((await orgA.json()) as { id: string }).id;
  const orgB = await post('/v1/communities', tokens.admin, { name: `${PREFIX} orgB` });
  expect(orgB.status).toBe(201);
  fx.orgB = ((await orgB.json()) as { id: string }).id;

  const product = await post('/v1/store/products', tokens.admin, {
    name: `${PREFIX} produto`,
    priceCents: 1990,
    communityIds: [fx.orgA],
  });
  expect(product.status).toBe(201);
  fx.productA = ((await product.json()) as ProductDetail).id;
  for (const name of ['buyer', 'buyer2'] as const) {
    const bought = await post(`/v1/store/products/${fx.productA}/purchase`, tokens[name], {
      expectedAmountCents: 1990,
    });
    expect(bought.status, `purchase ${name} -> ${bought.status}`).toBe(200);
  }
  await setStoryFlag(true);
  fx.hOpen = await insertHighlight({ title: 'aberto', open: true });
  fx.foreignHighlight = await insertHighlight({
    title: 'de outro tenant',
    communityId: null,
    open: true,
    tenant: labTenantId,
  });
});

beforeEach(() => {
  storyPublishLimiter.reset();
});

afterAll(async () => {
  await sweep();
  await restoreStories();
  await restoreCommunities();
  await restoreSocial();
  await restoreStore();
  await adminSql.end();
  await sqlClient.end();
});

describe('11.1-09 tracer: a buyer saves their own story into an open highlight', () => {
  it('1. D-883/D-884/D-885 TRACER: the buyer adds their own story to an open highlight of the organization community: 200 and the item exists', async () => {
    await setStoryFlag(true);
    await setOpen(fx.hOpen, true);
    const story = await insertStory({ author: users.buyer, label: 'trilha' });
    const res = await addItem(tokens.buyer, fx.hOpen, story);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ highlighted: true, highlightCount: 1 });
    const items = await itemsOf(fx.hOpen);
    expect(items.map((item) => item.story_id)).toContain(story);
    expect(items.find((item) => item.story_id === story)?.added_by_user_id).toBe(users.buyer);
    await adminSql`delete from public.story_highlight_items where highlight_id = ${fx.hOpen}::uuid`;
  });

  it('2. the same call is a bare 403 (never a 404 for a highlight that exists) when the highlight is closed, the link does not tick story, social is off or the community is archived, each beside the open positive control', async () => {
    const story = await insertStory({ author: users.buyer, label: 'recusas' });
    const control = async (where: string) => {
      const ok = await addItem(tokens.buyer, fx.hOpen, story);
      expect(ok.status, `${where}: positive control -> ${await ok.clone().text()}`).toBe(200);
      await adminSql`delete from public.story_highlight_items where highlight_id = ${fx.hOpen}::uuid`;
    };

    await setOpen(fx.hOpen, false);
    await expectBare403(await addItem(tokens.buyer, fx.hOpen, story), 'closed highlight');
    expect(await itemsOf(fx.hOpen)).toHaveLength(0);
    await setOpen(fx.hOpen, true);
    await control('closed highlight');

    await setStoryFlag(false);
    await expectBare403(await addItem(tokens.buyer, fx.hOpen, story), 'story flag unticked');
    expect(await itemsOf(fx.hOpen)).toHaveLength(0);
    await setStoryFlag(true);
    await control('story flag unticked');

    // a reader who holds nothing is locked out of the community and never holds the grant
    await expectBare403(await addItem(tokens.reader, fx.hOpen, story), 'no entitlement');

    // social off: the member holds no `stories.story.publish`, the route guard answers first
    await adminSql`
      update public.tenant_modules set enabled = false
       where tenant_id = ${tenantId}::uuid and module_key = 'social'`;
    moduleFlags.invalidate(tenantId);
    await expectBare403(await addItem(tokens.buyer, fx.hOpen, story), 'social off');
    await adminSql`
      update public.tenant_modules set enabled = true
       where tenant_id = ${tenantId}::uuid and module_key = 'social'`;
    moduleFlags.invalidate(tenantId);
    await control('social off');

    await adminSql`update public.communities set status = 'archived' where id = ${fx.orgA}::uuid`;
    await expectBare403(await addItem(tokens.buyer, fx.hOpen, story), 'archived community');
    await adminSql`update public.communities set status = 'active' where id = ${fx.orgA}::uuid`;
    await control('archived community');

    // another tenant's highlight id is the bare 404
    const foreign = await addItem(tokens.buyer, fx.foreignHighlight, story);
    expect(foreign.status).toBe(404);
    expect(await envelope(foreign)).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it("3. someone else's story is the existing bare 404 (the story select carries the own-story predicate) and writes nothing; the administrator keeps adding organization stories", async () => {
    const other = await insertStory({ author: users.buyer2, label: 'do outro' });
    const res = await addItem(tokens.buyer, fx.hOpen, other);
    expect(res.status, await res.clone().text()).toBe(404);
    expect(await itemsOf(fx.hOpen)).toHaveLength(0);

    const orgStory = await insertStory({ author: users.admin, label: 'da organizacao' });
    const staff = await addItem(tokens.admin, fx.hOpen, orgStory);
    expect(staff.status, await staff.clone().text()).toBe(200);
    await adminSql`delete from public.story_highlight_items where highlight_id = ${fx.hOpen}::uuid`;
  });
});
