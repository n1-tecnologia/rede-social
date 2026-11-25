import { sqlClient } from '@rede-social/core/db';
import type { LikeResult } from '@rede-social/module-feed/contracts';
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
const fx = { orgA: '', bare: '', productA: '', adminPostA: '', adminPostBare: '', foreignPost: '' };

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

const likePost = (token: string, postId: string) => post(`/v1/feed/posts/${postId}/like`, token);

async function sweep(): Promise<void> {
  const products = adminSql`select id from public.store_products where name like ${`${PREFIX}%`}`;
  const communities = adminSql`select id from public.communities where name like ${`${PREFIX}%`}`;
  await adminSql`delete from public.feed_posts where caption like ${`${PREFIX}%`}`;
  await adminSql`delete from public.feed_posts where community_id in (${communities})`;
  await adminSql`delete from public.store_entitlements where product_id in (${products})`;
  await adminSql`delete from public.store_orders where product_id in (${products})`;
  await adminSql`delete from public.store_products where name like ${`${PREFIX}%`}`;
  await adminSql`delete from public.communities where name like ${`${PREFIX}%`}`;
  await removeIdentitiesByPrefix(PREFIX);
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
    name: `${PREFIX} produto`,
    priceCents: 1990,
    communityIds: [fx.orgA],
  });
  expect(product.status).toBe(201);
  fx.productA = ((await product.json()) as ProductDetail).id;
  const bought = await post(`/v1/store/products/${fx.productA}/purchase`, tokens.buyer, {
    expectedAmountCents: 1990,
  });
  expect(bought.status, `purchase -> ${bought.status}`).toBe(200);

  // the posts the cases act on: the admin's, in each community (the newest tenant post of orgA is also its free sample)
  fx.adminPostA = await adminPost(fx.orgA, 'post da org A');
  fx.adminPostBare = await adminPost(fx.bare, 'post da comunidade sem produto');

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
  await restoreSocial();
  await restoreStore();
  await adminSql.end();
  await sqlClient.end();
});

const envelope = async (res: Response) => (await res.json()) as Envelope;

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
