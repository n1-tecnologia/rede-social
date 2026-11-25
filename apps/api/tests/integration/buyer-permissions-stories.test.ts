import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { sqlClient } from '@rede-social/core/db';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import {
  communityCreateLimiter,
  storyPublishLimiter,
} from '@rede-social/core/server/safety/limits';
import type { ProductDetail } from '@rede-social/module-store/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  await adminSql`
    with gone as (delete from public.stories where caption like ${`${PREFIX}%`} returning media_asset_id)
    delete from public.media_assets where id in (select media_asset_id from gone)`;
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
  communityCreateLimiter.reset();
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

const get = (path: string, token: string) => request(path, token);

/** A highlight written through the owner connection returns its flag; the route reads must agree with it. */
const openFlagOf = async (highlightId: string): Promise<boolean> => {
  const [row] = await adminSql<{ open_to_buyers: boolean }[]>`
    select open_to_buyers from public.story_highlights where id = ${highlightId}::uuid`;
  return row?.open_to_buyers === true;
};
const updatedAtOf = async (highlightId: string): Promise<string> => {
  const [row] = await adminSql<{ updated_at: string }[]>`
    select updated_at::text as updated_at from public.story_highlights where id = ${highlightId}::uuid`;
  return row?.updated_at ?? '';
};

/** A MEMBER community made through the real route by `token` (the creator curates its highlights). */
async function memberCommunity(token: string, label: string): Promise<string> {
  const res = await post('/v1/communities', token, { name: `${PREFIX} ${label}` });
  expect(res.status, `member community ${label} -> ${await res.clone().text()}`).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe('11.1-09 toggle: openToBuyers is the curator\u2019s single switch', () => {
  it('1. D-884/UI-D-886 (BPERM-02 a, b): a highlight reads closed by default; the manager opens and closes it with one PATCH field on the curator reads, and highlight.updated moves updated_at only on a real change', async () => {
    const created = await post('/v1/stories/highlights', tokens.admin, {
      communityId: fx.orgA,
      title: `${PREFIX} interruptor`,
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const made = (await created.json()) as { id: string };
    expect(made).not.toHaveProperty('openToBuyers');
    expect(await openFlagOf(made.id)).toBe(false);

    const first = await patch(`/v1/stories/highlights/${made.id}`, tokens.admin, {
      openToBuyers: true,
    });
    expect(first.status, await first.clone().text()).toBe(200);
    expect(((await first.json()) as { openToBuyers?: boolean }).openToBuyers).toBe(true);
    expect(await openFlagOf(made.id)).toBe(true);
    const stamp = await updatedAtOf(made.id);

    const repeat = await patch(`/v1/stories/highlights/${made.id}`, tokens.admin, {
      openToBuyers: true,
    });
    expect(repeat.status).toBe(200);
    expect(await updatedAtOf(made.id), 'an identical PATCH moves nothing').toBe(stamp);

    const listed = await get(
      `/v1/stories/highlights?communityId=${fx.orgA}&scope=all`,
      tokens.admin,
    );
    expect(listed.status).toBe(200);
    const items = ((await listed.json()) as { items: { id: string; openToBuyers?: boolean }[] })
      .items;
    expect(items.find((item) => item.id === made.id)?.openToBuyers).toBe(true);
    const detail = await get(`/v1/stories/highlights/${made.id}`, tokens.admin);
    expect(detail.status).toBe(200);
    expect(
      ((await detail.json()) as { highlight: { openToBuyers?: boolean } }).highlight.openToBuyers,
    ).toBe(true);
    const catalog = await get('/v1/stories/highlights/catalog', tokens.admin);
    const catalogItems = (
      (await catalog.json()) as { items: { id: string; openToBuyers?: boolean }[] }
    ).items;
    expect(catalogItems.find((item) => item.id === made.id)?.openToBuyers).toBe(true);

    const closed = await patch(`/v1/stories/highlights/${made.id}`, tokens.admin, {
      openToBuyers: false,
    });
    expect(closed.status).toBe(200);
    expect(await closed.json()).not.toHaveProperty('openToBuyers');
    expect(await openFlagOf(made.id)).toBe(false);
    expect(await updatedAtOf(made.id), 'a real change moved updated_at').not.toBe(stamp);
  });

  it('2. T-11.1-35 (BPERM-02 d): the switch is refused open_unavailable for an Inicio highlight, a member community highlight (also for its creator, who cannot flip it) and an archived community highlight', async () => {
    const inicio = await insertHighlight({ title: 'inicio', communityId: null });
    const res = await patch(`/v1/stories/highlights/${inicio}`, tokens.admin, {
      openToBuyers: true,
    });
    expect(res.status).toBe(400);
    expect((await envelope(res)).error.details).toEqual({ highlight: 'open_unavailable' });
    expect(await openFlagOf(inicio)).toBe(false);

    const own = await memberCommunity(tokens.buyer, 'da compradora');
    const created = await post('/v1/stories/highlights', tokens.buyer, {
      communityId: own,
      title: `${PREFIX} da criadora`,
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const ownHighlight = ((await created.json()) as { id: string }).id;
    const creatorFlip = await patch(`/v1/stories/highlights/${ownHighlight}`, tokens.buyer, {
      openToBuyers: true,
    });
    expect(creatorFlip.status).toBe(400);
    expect((await envelope(creatorFlip)).error.details).toEqual({ highlight: 'open_unavailable' });
    // the creator still renames it with the same route: the switch is the only refusal
    const rename = await patch(`/v1/stories/highlights/${ownHighlight}`, tokens.buyer, {
      title: `${PREFIX} renomeado`,
    });
    expect(rename.status).toBe(200);
    expect(await openFlagOf(ownHighlight)).toBe(false);
    // the administrator is not the curator of a member community: the bare 403
    await expectBare403(
      await patch(`/v1/stories/highlights/${ownHighlight}`, tokens.admin, { openToBuyers: true }),
      'admin on a member community',
    );

    const archivedCommunity = await post('/v1/communities', tokens.admin, {
      name: `${PREFIX} arquivada`,
    });
    const archivedId = ((await archivedCommunity.json()) as { id: string }).id;
    const archivedHighlight = await insertHighlight({
      title: 'arquivada',
      communityId: archivedId,
    });
    await adminSql`update public.communities set status = 'archived' where id = ${archivedId}::uuid`;
    const archived = await patch(`/v1/stories/highlights/${archivedHighlight}`, tokens.admin, {
      openToBuyers: true,
    });
    expect(archived.status).toBe(400);
    expect((await envelope(archived)).error.details).toEqual({ highlight: 'open_unavailable' });
    expect(await openFlagOf(archivedHighlight)).toBe(false);
  });

  it('3. T-11.1-32: a member, a buyer and the support user are refused 403 on the switch beside the manager control, and a buyer touches no highlight-level write', async () => {
    const target = await insertHighlight({ title: 'protegido' });
    for (const [who, token] of [
      ['reader', tokens.reader],
      ['buyer', tokens.buyer],
    ] as const) {
      await expectBare403(
        await patch(`/v1/stories/highlights/${target}`, token, { openToBuyers: true }),
        `${who} toggling`,
      );
      await expectBare403(
        await patch(`/v1/stories/highlights/${target}`, token, { title: `${PREFIX} x` }),
        `${who} renaming`,
      );
      await expectBare403(
        await post('/v1/stories/highlights', token, { communityId: fx.orgA, title: `${PREFIX} y` }),
        `${who} creating`,
      );
      await expectBare403(await del(`/v1/stories/highlights/${target}`, token), `${who} deleting`);
      await expectBare403(
        await request('/v1/stories/highlights/order', token, {
          method: 'PUT',
          body: JSON.stringify({ communityId: fx.orgA, highlightIds: [target] }),
        }),
        `${who} reordering`,
      );
    }
    const support = await signInAs('support@rede-demo.local', SEED_PASSWORD);
    await expectBare403(
      await patch(`/v1/stories/highlights/${target}`, support, { openToBuyers: true }),
      'support toggling',
    );
    expect(await openFlagOf(target)).toBe(false);
    const control = await patch(`/v1/stories/highlights/${target}`, tokens.admin, {
      openToBuyers: true,
    });
    expect(control.status, 'manager control').toBe(200);
    expect(await openFlagOf(target)).toBe(true);
  });

  it('4. UI-D-887 (BPERM-02 c): no member-facing read carries the flag, open or closed (list, detail, the story, the community page and list, the buyer catalogue)', async () => {
    const story = await insertStory({ author: users.admin, label: 'leitura' });
    const shown = await insertHighlight({ title: 'leitura', open: false });
    const added = await addItem(tokens.admin, shown, story);
    expect(added.status).toBe(200);

    const reads = async (where: string) => {
      for (const token of [tokens.buyer, tokens.buyer2]) {
        for (const path of [
          `/v1/stories/highlights?communityId=${fx.orgA}`,
          `/v1/stories/highlights/${shown}`,
          `/v1/stories/${story}`,
          `/v1/communities/${fx.orgA}`,
          '/v1/communities',
          '/v1/stories/highlights/catalog',
        ]) {
          const res = await get(path, token);
          const text = await res.text();
          expect([200, 403, 404], `${where} ${path} -> ${res.status}`).toContain(res.status);
          expect(text.includes('openToBuyers'), `${where} ${path}`).toBe(false);
          expect(text.includes('open_to_buyers'), `${where} ${path}`).toBe(false);
        }
      }
    };
    await reads('closed');
    await setOpen(shown, true);
    await setStoryFlag(true);
    await reads('open');
    // the same open highlight read as a curator carries it: the one place it shows
    const curator = await get(`/v1/stories/highlights/${shown}`, tokens.admin);
    expect(await curator.text()).toContain('openToBuyers');
  });
});

describe('11.1-09 catalogue: a buyer is offered only the open highlights they hold the story grant for', () => {
  const ids: { a1: string; a2: string; closed: string; other: string } = {
    a1: '',
    a2: '',
    closed: '',
    other: '',
  };

  const catalogOf = async (token: string) => {
    const res = await get('/v1/stories/highlights/catalog', token);
    expect(res.status, await res.clone().text()).toBe(200);
    return ((await res.json()) as { items: { id: string; communityId: string | null }[] }).items;
  };

  /** The buyer's rows for the ORGANIZATION community (the creator's own member community is a different group). */
  const orgAOf = async (token: string) =>
    (await catalogOf(token)).filter((item) => item.communityId === fx.orgA);

  it('1. UI-D-891 (BPERM-14): open highlights of the community where story is granted, grouped by community and in their own position, no flag on a row; a closed one and one of a community without the grant are absent', async () => {
    await adminSql`delete from public.story_highlights where title like ${`${PREFIX} cat-%`}`;
    await setStoryFlag(true);
    ids.a1 = await insertHighlight({ title: 'cat-a1', open: true });
    ids.closed = await insertHighlight({ title: 'cat-fechado', open: false });
    ids.a2 = await insertHighlight({ title: 'cat-a2', open: true });
    ids.other = await insertHighlight({ title: 'cat-orgB', communityId: fx.orgB, open: true });

    const items = await catalogOf(tokens.buyer);
    const mine = items.filter((item) => item.communityId === fx.orgA).map((item) => item.id);
    // position order of the place: a1 was written before a2 (the closed one between them is absent)
    expect(mine.filter((id) => id === ids.a1 || id === ids.a2)).toEqual([ids.a1, ids.a2]);
    expect(items.map((item) => item.id)).not.toContain(ids.closed);
    expect(items.map((item) => item.id)).not.toContain(ids.other);
    for (const item of items) expect(item).not.toHaveProperty('openToBuyers');
  });

  it('2. BPERM-14 adjacency: unticking story, revoking the entitlement or archiving the community each empty the buyer\u2019s group beside the positive control', async () => {
    await setStoryFlag(false);
    expect((await catalogOf(tokens.buyer)).map((item) => item.id)).not.toContain(ids.a1);
    await setStoryFlag(true);
    expect((await catalogOf(tokens.buyer)).map((item) => item.id)).toContain(ids.a1);

    await adminSql`
      update public.store_entitlements set status = 'revoked', revoked_at = now()
       where user_id = ${users.buyer}::uuid and product_id = ${fx.productA}::uuid`;
    expect(await orgAOf(tokens.buyer)).toEqual([]);
    await adminSql`
      update public.store_entitlements set status = 'active', revoked_at = null
       where user_id = ${users.buyer}::uuid and product_id = ${fx.productA}::uuid`;
    expect((await catalogOf(tokens.buyer)).map((item) => item.id)).toContain(ids.a1);

    await adminSql`update public.communities set status = 'archived' where id = ${fx.orgA}::uuid`;
    expect(await orgAOf(tokens.buyer)).toEqual([]);
    await adminSql`update public.communities set status = 'active' where id = ${fx.orgA}::uuid`;
    expect((await catalogOf(tokens.buyer)).map((item) => item.id)).toContain(ids.a1);
  });

  it('3. BPERM-14 empty: a member with no grant gets an empty catalogue, social off is the route guard\u2019s 403, and a creator keeps their own community in the same answer', async () => {
    expect(await catalogOf(tokens.reader)).toEqual([]);

    const own = await memberCommunity(tokens.buyer, 'catalogo');
    const ownHighlight = await post('/v1/stories/highlights', tokens.buyer, {
      communityId: own,
      title: `${PREFIX} cat-propria`,
    });
    expect(ownHighlight.status).toBe(201);
    const ownId = ((await ownHighlight.json()) as { id: string }).id;
    const items = await catalogOf(tokens.buyer);
    expect(items.map((item) => item.id)).toEqual(expect.arrayContaining([ownId, ids.a1, ids.a2]));
    for (const item of items) expect(item).not.toHaveProperty('openToBuyers');

    await adminSql`
      update public.tenant_modules set enabled = false
       where tenant_id = ${tenantId}::uuid and module_key = 'social'`;
    moduleFlags.invalidate(tenantId);
    await expectBare403(await get('/v1/stories/highlights/catalog', tokens.buyer), 'social off');
    await adminSql`
      update public.tenant_modules set enabled = true
       where tenant_id = ${tenantId}::uuid and module_key = 'social'`;
    moduleFlags.invalidate(tenantId);
  });
});

describe('11.1-09 open-counts: the product form\u2019s staff-only read', () => {
  it('1. UI-D-884 (3): the manager gets one row per ACTIVE ORGANIZATION community named; member, archived, foreign and unknown ids are absent; a buyer and a member are refused 403', async () => {
    await adminSql`delete from public.story_highlights where title like ${`${PREFIX} oc-%`} or title like ${`${PREFIX} cat-%`}`;
    await insertHighlight({ title: 'oc-1', open: true });
    await insertHighlight({ title: 'oc-2', open: true });
    await insertHighlight({ title: 'oc-3', open: false });
    const memberOwned = await memberCommunity(tokens.buyer2, 'contagem');
    const archived = await post('/v1/communities', tokens.admin, { name: `${PREFIX} oc-arq` });
    const archivedId = ((await archived.json()) as { id: string }).id;
    await adminSql`update public.communities set status = 'archived' where id = ${archivedId}::uuid`;
    const unknown = randomUUID();
    const ids = [fx.orgA, fx.orgB, memberOwned, archivedId, unknown].join(',');

    const res = await get(`/v1/stories/highlights/open-counts?communityIds=${ids}`, tokens.admin);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { items: { communityId: string; openHighlights: number }[] };
    const byId = new Map(body.items.map((item) => [item.communityId, item.openHighlights]));
    expect(byId.get(fx.orgA)).toBeGreaterThanOrEqual(2);
    expect(byId.get(fx.orgB)).toBe(0);
    expect(byId.has(memberOwned)).toBe(false);
    expect(byId.has(archivedId)).toBe(false);
    expect(byId.has(unknown)).toBe(false);

    for (const token of [tokens.buyer, tokens.reader]) {
      await expectBare403(
        await get(`/v1/stories/highlights/open-counts?communityIds=${fx.orgA}`, token),
        'open-counts for a non-manager',
      );
    }
  });

  it('2. a malformed, empty or oversized communityIds is the contract\u2019s 400 and nothing is read', async () => {
    const many = Array.from({ length: 51 }, () => randomUUID()).join(',');
    for (const query of ['communityIds=not-a-uuid', 'communityIds=', `communityIds=${many}`, '']) {
      const res = await get(`/v1/stories/highlights/open-counts?${query}`, tokens.admin);
      expect(res.status, query.slice(0, 40)).toBe(400);
      expect((await envelope(res)).error.code).toBe('VALIDATION_FAILED');
    }
  });
});

/** Everything the process wrote to its log descriptors while `fn` ran (pino writes asynchronously, so the spy stays on a moment). */
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
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    return { value, lines: chunks.join('') };
  } finally {
    writeSpy.mockRestore();
    syncSpy.mockRestore();
  }
}

/** A refusal body as bytes: the request id is per request, so it is the one field dropped before comparing. */
async function bytesOf(res: Response): Promise<string> {
  const body = (await res.json()) as Envelope & { error: { requestId?: string } };
  const { requestId: _requestId, ...error } = body.error;
  return JSON.stringify({ error });
}

/** `n` stories of `author`, each with a ready asset, all held by `highlightId` (set-based, through the owner connection). */
async function fillHighlight(highlightId: string, author: string, n: number): Promise<string[]> {
  const rows = await adminSql<{ id: string }[]>`
    with a as (
      insert into public.media_assets
        (id, tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, variant_widths)
      select gen_random_uuid(), ${tenantId}::uuid, ${author}::uuid, 'image', 'story', 'ready', 'supabase',
             'image/webp', 1024, '{640}'::int[]
        from generate_series(1, ${n}::int)
      returning id
    ), s as (
      insert into public.stories
        (tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility)
      select ${tenantId}::uuid, ${author}::uuid, a.id, 'image', ${`${PREFIX} cheio`}, 'followers' from a
      returning id
    ), i as (
      insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
      select ${tenantId}::uuid, ${highlightId}::uuid, s.id, ${author}::uuid from s
      returning story_id
    )
    select story_id::text as id from i`;
  return rows.map((row) => row.id);
}

const clearItems = (highlightId: string) =>
  adminSql`delete from public.story_highlight_items where highlight_id = ${highlightId}::uuid`;

const storyAlive = async (storyId: string): Promise<boolean> => {
  const [row] = await adminSql<{ deleted_at: string | null }[]>`
    select deleted_at::text as deleted_at from public.stories where id = ${storyId}::uuid`;
  return row !== undefined && row.deleted_at === null;
};

const itemExists = async (highlightId: string, storyId: string): Promise<boolean> =>
  (await itemsOf(highlightId)).some((item) => item.story_id === storyId);

describe('11.1-09 removal: a buyer removes only their own item while the permission lasts (D-885, D-895, D-887)', () => {
  let h = '';

  it('1. BPERM-13: the buyer removes their own item from an open highlight; the story survives; the last item leaves an empty OPEN highlight', async () => {
    h = await insertHighlight({ title: 'remocao', open: true });
    await setStoryFlag(true);
    const story = await insertStory({ author: users.buyer, label: 'remover' });
    expect((await addItem(tokens.buyer, h, story)).status).toBe(200);
    const res = await removeItem(tokens.buyer, h, story);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ highlighted: false, highlightCount: 0 });
    expect(await itemsOf(h)).toHaveLength(0);
    expect(await storyAlive(story)).toBe(true);
    expect(await openFlagOf(h), 'the empty highlight stays open').toBe(true);
  });

  it('2. D-895/D-887: another buyer\u2019s item, a flipped flag, a revoked entitlement and a closed highlight are each the bare 403 and the item stays; the administrator removes it and the story survives', async () => {
    const mine = await insertStory({ author: users.buyer, label: 'minha' });
    const theirs = await insertStory({ author: users.buyer2, label: 'dela' });
    const reseed = async () => {
      await clearItems(h);
      await setOpen(h, true);
      await setStoryFlag(true);
      expect((await addItem(tokens.buyer, h, mine)).status).toBe(200);
      expect((await addItem(tokens.buyer2, h, theirs)).status).toBe(200);
    };

    await reseed();
    await expectBare403(await removeItem(tokens.buyer, h, theirs), 'another buyer item');
    expect(await itemExists(h, theirs)).toBe(true);

    await setStoryFlag(false);
    await expectBare403(await removeItem(tokens.buyer, h, mine), 'flag unticked');
    expect(await itemExists(h, mine)).toBe(true);
    await setStoryFlag(true);

    await adminSql`
      update public.store_entitlements set status = 'revoked', revoked_at = now()
       where user_id = ${users.buyer}::uuid and product_id = ${fx.productA}::uuid`;
    await expectBare403(await removeItem(tokens.buyer, h, mine), 'revoked entitlement');
    expect(await itemExists(h, mine)).toBe(true);
    // nothing is hidden or removed automatically (D-887), and the buyer still deletes the story itself
    expect(await storyAlive(mine)).toBe(true);
    await adminSql`
      update public.store_entitlements set status = 'active', revoked_at = null
       where user_id = ${users.buyer}::uuid and product_id = ${fx.productA}::uuid`;

    await setOpen(h, false);
    await expectBare403(await removeItem(tokens.buyer, h, mine), 'closed highlight');
    expect(await itemExists(h, mine)).toBe(true);
    // the administrator removes any item of a closed highlight, and the story is left alone
    const staff = await removeItem(tokens.admin, h, mine);
    expect(staff.status, await staff.clone().text()).toBe(200);
    expect(await itemExists(h, mine)).toBe(false);
    expect(await storyAlive(mine)).toBe(true);
    await setOpen(h, true);

    // positive control: with everything back the buyer removes their own item
    expect((await addItem(tokens.buyer, h, mine)).status).toBe(200);
    expect((await removeItem(tokens.buyer, h, mine)).status).toBe(200);
  });

  it('3. BPERM-13 empty and ordering: a story that is not in the highlight is the idempotent answer and touches nothing, an unknown story is 404, and removing a middle item leaves the order of the others', async () => {
    await clearItems(h);
    const s1 = await insertStory({ author: users.buyer, label: 'ordem-1' });
    const s2 = await insertStory({ author: users.buyer2, label: 'ordem-2' });
    const s3 = await insertStory({ author: users.buyer, label: 'ordem-3' });
    expect((await addItem(tokens.buyer, h, s1)).status).toBe(200);
    expect((await addItem(tokens.buyer2, h, s2)).status).toBe(200);
    expect((await addItem(tokens.buyer, h, s3)).status).toBe(200);
    expect((await itemsOf(h)).map((item) => item.story_id)).toEqual([s1, s2, s3]);

    const absent = await insertStory({ author: users.buyer, label: 'ausente' });
    const none = await removeItem(tokens.buyer, h, absent);
    expect(none.status).toBe(200);
    expect((await itemsOf(h)).map((item) => item.story_id)).toEqual([s1, s2, s3]);
    expect((await removeItem(tokens.buyer, h, randomUUID())).status).toBe(404);

    expect((await removeItem(tokens.buyer2, h, s2)).status).toBe(200);
    expect((await itemsOf(h)).map((item) => item.story_id)).toEqual([s1, s3]);
  });

  it('4. D-887: after a refund the buyer still soft-deletes their own story, and the item of an administrator\u2019s removal leaves the story itself', async () => {
    await clearItems(h);
    const story = await insertStory({ author: users.buyer, label: 'apos-reembolso' });
    expect((await addItem(tokens.buyer, h, story)).status).toBe(200);
    await adminSql`
      update public.store_entitlements set status = 'revoked', revoked_at = now()
       where user_id = ${users.buyer}::uuid and product_id = ${fx.productA}::uuid`;
    const deleted = await del(`/v1/stories/${story}`, tokens.buyer);
    expect(deleted.status, await deleted.clone().text()).toBe(204);
    expect(await storyAlive(story)).toBe(false);
    await adminSql`
      update public.store_entitlements set status = 'active', revoked_at = null
       where user_id = ${users.buyer}::uuid and product_id = ${fx.productA}::uuid`;
  });
});

describe('11.1-09 publish with a highlight: saving is publishing (D-883)', () => {
  it('1. a buyer publishes a story into an open highlight: 201, the item exists; a closed or a foreign highlight is refused and NO story is created', async () => {
    const open = await insertHighlight({ title: 'publicar', open: true });
    await setStoryFlag(true);
    const asset = await makeAsset(users.buyer);
    const ok = await post('/v1/stories', tokens.buyer, {
      mediaAssetId: asset,
      mediaKind: 'image',
      caption: `${PREFIX} publicada`,
      highlightId: open,
    });
    expect(ok.status, await ok.clone().text()).toBe(201);
    const created = (await ok.json()) as { id: string };
    expect(await itemExists(open, created.id)).toBe(true);

    await setOpen(open, false);
    const refusedAsset = await makeAsset(users.buyer);
    const closed = await post('/v1/stories', tokens.buyer, {
      mediaAssetId: refusedAsset,
      mediaKind: 'image',
      caption: `${PREFIX} recusada`,
      highlightId: open,
    });
    await expectBare403(closed, 'publish into a closed highlight');
    const foreignAsset = await makeAsset(users.buyer);
    const foreign = await post('/v1/stories', tokens.buyer, {
      mediaAssetId: foreignAsset,
      mediaKind: 'image',
      caption: `${PREFIX} estrangeira`,
      highlightId: fx.foreignHighlight,
    });
    expect(foreign.status).toBe(404);
    const stored = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.stories
       where caption in (${`${PREFIX} recusada`}, ${`${PREFIX} estrangeira`})`;
    expect(stored[0]?.n, 'a refused destination creates no story').toBe(0);
  });

  it('2. the publish limiter counts every attempt, a refused one included: the 31st attempt is 429', async () => {
    const closed = await insertHighlight({ title: 'limite', open: false });
    storyPublishLimiter.reset();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 31; attempt++) {
      const res = await post('/v1/stories', tokens.buyer2, {
        mediaAssetId: randomUUID(),
        mediaKind: 'image',
        caption: `${PREFIX} limite`,
        highlightId: closed,
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 30).every((status) => status === 403)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it('3. the administrator publishes an organization story into the same open highlight as before', async () => {
    const open = await insertHighlight({ title: 'publicar-admin', open: true });
    const asset = await makeAsset(users.admin);
    const res = await post('/v1/stories', tokens.admin, {
      mediaAssetId: asset,
      mediaKind: 'image',
      caption: `${PREFIX} do admin`,
      highlightId: open,
    });
    expect(res.status, await res.clone().text()).toBe(201);
  });
});

describe('11.1-09 edge matrix (BPERM-12, BPERM-08, BPERM-25)', () => {
  it('1. adjacency: a story exactly at its 24 hour expiry and one just inside are both saveable; an expired story stays readable through the highlight', async () => {
    const h = await insertHighlight({ title: 'bordas', open: true });
    await setStoryFlag(true);
    const exact = await insertStory({
      author: users.buyer,
      label: 'borda-exata',
      publishedAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      expiresAt: new Date(Date.now()).toISOString(),
    });
    const inside = await insertStory({
      author: users.buyer,
      label: 'borda-dentro',
      publishedAt: new Date(Date.now() - (24 * 3600 - 60) * 1000).toISOString(),
      expiresAt: new Date(Date.now() + 60 * 1000).toISOString(),
    });
    expect((await addItem(tokens.buyer, h, exact)).status).toBe(200);
    expect((await addItem(tokens.buyer, h, inside)).status).toBe(200);
    // everyone who can read the community reads them, past the 24 hours (D-716): a second buyer, beside a locked reader
    const detail = await get(`/v1/stories/highlights/${h}`, tokens.buyer2);
    expect(detail.status, await detail.clone().text()).toBe(200);
    const items = ((await detail.json()) as { items: { id: string; isActive: boolean }[] }).items;
    expect(items.find((item) => item.id === exact)?.isActive).toBe(false);
    expect(items.map((item) => item.id)).toEqual(expect.arrayContaining([exact, inside]));
    expect((await get(`/v1/stories/highlights/${h}`, tokens.reader)).status).toBe(404);
    expect((await get(`/v1/stories/${exact}`, tokens.buyer2)).status).toBe(200);
    expect(
      (await get(`/v1/stories/${exact}`, tokens.reader)).status,
      'a locked member reads no story a buyer saved',
    ).toBe(404);
  });

  it('2. empty and idempotency: an open highlight with no items takes the first, the same story twice leaves one item and the same answer', async () => {
    const h = await insertHighlight({ title: 'vazio', open: true });
    const story = await insertStory({ author: users.buyer, label: 'primeira' });
    expect(await itemsOf(h)).toHaveLength(0);
    const first = await addItem(tokens.buyer, h, story);
    const again = await addItem(tokens.buyer, h, story);
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ highlighted: true, highlightCount: 1 });
    expect(await itemsOf(h)).toHaveLength(1);
    expect(
      (await addItem(tokens.buyer, h, randomUUID())).status,
      'nothing to add is the bare 404',
    ).toBe(404);
  });

  it('3. item cap: a highlight at the cap answers the existing full issue to a buyer, a repeat of a held story stays idempotent, and two buyers racing for the last place fill exactly the capacity', async () => {
    const h = await insertHighlight({ title: 'capacidade', open: true });
    const held = await fillHighlight(h, users.buyer, 98);
    const last = await insertStory({ author: users.buyer, label: 'ultima' });
    const mine = await insertStory({ author: users.buyer2, label: 'concorrente' });
    // two buyers race for the 99th... then one place: first fill to 99
    const filler = await insertStory({ author: users.buyer, label: 'enchimento' });
    expect((await addItem(tokens.buyer, h, filler)).status).toBe(200);
    expect(await itemsOf(h)).toHaveLength(99);

    const [a, b] = await Promise.all([
      addItem(tokens.buyer, h, last),
      addItem(tokens.buyer2, h, mine),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    const full = a.status === 400 ? a : b;
    expect((await envelope(full)).error.details).toEqual({ highlight: 'full' });
    expect(await itemsOf(h), 'exactly the capacity').toHaveLength(100);

    const repeat = await addItem(tokens.buyer, h, held[0] ?? '');
    expect(repeat.status, 'a story already held is the idempotent answer at the cap').toBe(200);
    expect(await itemsOf(h)).toHaveLength(100);
  });

  it('4. concurrency: a close racing an add either lands after the item (it stays) or refuses the add with the bare 403, never a 500', async () => {
    for (let round = 0; round < 3; round++) {
      const h = await insertHighlight({ title: `corrida-${round}`, open: true });
      const story = await insertStory({ author: users.buyer, label: `corrida-${round}` });
      const [added, closed] = await Promise.all([
        addItem(tokens.buyer, h, story),
        patch(`/v1/stories/highlights/${h}`, tokens.admin, { openToBuyers: false }),
      ]);
      expect(closed.status).toBe(200);
      expect(await openFlagOf(h)).toBe(false);
      if (added.status === 200) {
        expect(await itemExists(h, story), 'a close after the item leaves the item (D-887)').toBe(
          true,
        );
      } else {
        await expectBare403(added, `round ${round}`);
        expect(await itemExists(h, story)).toBe(false);
      }
    }
  });

  it('5. BPERM-08: a closed highlight, a missing flag and a missing grant answer the SAME bytes (status, code, body, no details) and no product, flag or open-state word reaches a body or a log line', async () => {
    const h = await insertHighlight({ title: 'bytes', open: true });
    const story = await insertStory({ author: users.buyer, label: 'bytes' });
    const forbidden = [
      `${PREFIX} produto`,
      fx.productA,
      fx.orgA,
      'can_story',
      'canStory',
      'openToBuyers',
      'open_to_buyers',
    ];

    const closed = await captured(async () => {
      await setOpen(h, false);
      return addItem(tokens.buyer, h, story);
    });
    await setOpen(h, true);
    const noFlag = await captured(async () => {
      await setStoryFlag(false);
      return addItem(tokens.buyer, h, story);
    });
    await setStoryFlag(true);
    const noGrant = await captured(async () => addItem(tokens.reader, h, story));

    const bodies: string[] = [];
    for (const [label, run] of [
      ['closed', closed],
      ['no flag', noFlag],
      ['no grant', noGrant],
    ] as const) {
      expect(run.value.status, label).toBe(403);
      const text = await run.value.clone().text();
      for (const word of forbidden) {
        expect(text.includes(word), `${label} body must not carry "${word}"`).toBe(false);
        expect(run.lines.includes(word), `${label} log must not carry "${word}"`).toBe(false);
      }
      bodies.push(await bytesOf(run.value));
    }
    expect(new Set(bodies).size, 'the three refusals are byte-identical').toBe(1);
    expect(bodies[0]).not.toContain('details');
  });

  it('6. BPERM-25: tenant B grants a buyer of tenant A nothing and tenant A\u2019s highlight routes answer the bare 404 for it, each beside a positive control', async () => {
    const story = await insertStory({ author: users.buyer, label: 'estrangeira' });
    for (const res of [
      await addItem(tokens.buyer, fx.foreignHighlight, story),
      await removeItem(tokens.buyer, fx.foreignHighlight, story),
      await patch(`/v1/stories/highlights/${fx.foreignHighlight}`, tokens.admin, {
        openToBuyers: true,
      }),
      await get(`/v1/stories/highlights/${fx.foreignHighlight}`, tokens.buyer),
    ]) {
      expect(res.status).toBe(404);
      expect(await envelope(res)).toMatchObject({ error: { code: 'NOT_FOUND' } });
    }
    expect(await openFlagOf(fx.foreignHighlight)).toBe(true);
    const own = await insertHighlight({ title: 'controle', open: true });
    expect((await addItem(tokens.buyer, own, story)).status).toBe(200);
  });
});
