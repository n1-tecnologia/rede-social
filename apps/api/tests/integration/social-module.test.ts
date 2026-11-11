import { randomUUID } from 'node:crypto';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import {
  communityCreateLimiter,
  storyPublishLimiter,
} from '@rede-social/core/server/safety/limits';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  HOSTS,
  SEED_PASSWORD,
  signInAs,
  withCommunitiesEnabled,
  withSocialEnabled,
  withStoriesEnabled,
} from './setup';

/**
 * 09-01 (SOCIAL-01, SOCIAL-02, D-482, D-121) against the live local stack and the real seed: the
 * `social` module is the ONE switch that turns a member into an author, composed in
 * `permissionsFor` and read by the bootstrap and the route guards alike.
 *
 * The seed turns `social` ON for rede-lab and leaves it OFF for rede-demo (planning decision 5), so
 * the tracer reads one tenant of each. Every case that changes a row puts it back in `finally`, and
 * invalidates the per-instance flags cache, the `communities.test.ts` precedent.
 */

type BootstrapBody = {
  tenant: { id: string; slug: string };
  modules: { key: string; nav?: unknown }[];
  permissions: string[];
};

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';

const AUTHORING = ['feed.post.create', 'feed.post.manage', 'social.participate'] as const;

const tokens = {
  demoMember: '',
  labMember: '',
  labAdmin: '',
  labSupport: '',
  superAdmin: '',
};
const tenantIds = { demo: '', lab: '' };

const bootstrap = async (token: string): Promise<BootstrapBody> => {
  const res = await api.request('/v1/me/bootstrap', {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as BootstrapBody;
};

const platformToggle = (tenantId: string, key: string, enabled: boolean) =>
  api.request(`/v1/platform/tenants/${tenantId}/modules/${key}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${tokens.superAdmin}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ enabled }),
  });

const rowOf = async (tenantId: string, key: string) => {
  const [row] = await adminSql<{ enabled: boolean }[]>`
    select enabled from public.tenant_modules
     where tenant_id = ${tenantId}::uuid and module_key = ${key}`;
  return row;
};

/** Puts a module row back exactly as it was (an upsert, or a delete when there was none). */
async function restoreRow(
  tenantId: string,
  key: string,
  previous: { enabled: boolean } | undefined,
) {
  if (previous) {
    await adminSql`
      insert into public.tenant_modules (tenant_id, module_key, enabled)
      values (${tenantId}::uuid, ${key}, ${previous.enabled})
      on conflict (tenant_id, module_key)
      do update set enabled = ${previous.enabled}, updated_at = now()`;
  } else {
    await adminSql`
      delete from public.tenant_modules
       where tenant_id = ${tenantId}::uuid and module_key = ${key}`;
  }
  moduleFlags.invalidate(tenantId);
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  if (!SUPER_ADMIN_PASSWORD) {
    throw new Error('SUPER_ADMIN_PASSWORD is required (same value as `pnpm db:seed`)');
  }
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.labMember = await signInAs('member@rede-lab.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  tokens.labSupport = await signInAs('support@rede-lab.local', SEED_PASSWORD);
  tokens.superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('rede-demo', 'rede-lab')`;
  for (const row of rows) {
    if (row.slug === 'rede-demo') tenantIds.demo = row.id;
    if (row.slug === 'rede-lab') tenantIds.lab = row.id;
  }
  moduleFlags.invalidate(tenantIds.demo);
  moduleFlags.invalidate(tenantIds.lab);
});

afterAll(async () => {
  await adminSql.end();
});

describe('09 tracer', () => {
  it('1. a lab member (social on) is an author with a social entry; a demo member (social off) is not', async () => {
    const lab = await bootstrap(tokens.labMember);
    expect(lab.modules.map((m) => m.key)).toContain('social');
    for (const permission of AUTHORING) expect(lab.permissions, permission).toContain(permission);

    const demo = await bootstrap(tokens.demoMember);
    expect(demo.modules.map((m) => m.key)).not.toContain('social');
    for (const permission of AUTHORING) {
      expect(demo.permissions, permission).not.toContain(permission);
    }
  });

  it('2. EP-03: the entry has no nav and sorts after every navigable module', async () => {
    const lab = await bootstrap(tokens.labMember);
    const entry = lab.modules.find((m) => m.key === 'social');
    expect(entry).toBeDefined();
    expect(entry?.nav).toBeUndefined();
    expect(lab.modules.map((m) => m.key)).toEqual(['reels', 'events', 'feed', 'social']);
  });

  it('3. EP-04: neither the lab admin nor the lab support account holds social.participate', async () => {
    for (const token of [tokens.labAdmin, tokens.labSupport]) {
      const body = await bootstrap(token);
      expect(body.permissions).not.toContain('social.participate');
    }
    // The admin keeps the authoring pair the feed manifest gives it, social or not.
    const admin = await bootstrap(tokens.labAdmin);
    expect(admin.permissions).toContain('feed.post.create');
    expect(admin.permissions).toContain('feed.post.manage');
  });

  it('4. EP-01 / D-121: with feed off, social contributes no entry and no permission; feed back on restores both', async () => {
    const previous = await rowOf(tenantIds.lab, 'feed');
    try {
      await adminSql`
        update public.tenant_modules set enabled = false, updated_at = now()
         where tenant_id = ${tenantIds.lab}::uuid and module_key = 'feed'`;
      moduleFlags.invalidate(tenantIds.lab);
      const off = await bootstrap(tokens.labMember);
      expect(off.modules.map((m) => m.key)).not.toContain('social');
      for (const permission of AUTHORING) {
        expect(off.permissions, permission).not.toContain(permission);
      }
    } finally {
      await restoreRow(tenantIds.lab, 'feed', previous);
    }
    const back = await bootstrap(tokens.labMember);
    expect(back.modules.map((m) => m.key)).toContain('social');
    for (const permission of AUTHORING) expect(back.permissions, permission).toContain(permission);
  });

  it('5. T-09-45: a legacy posting-policy blob on the feed row grants a demo member nothing', async () => {
    const [before] = await adminSql<{ settings: unknown }[]>`
      select settings from public.tenant_modules
       where tenant_id = ${tenantIds.demo}::uuid and module_key = 'feed'`;
    try {
      await adminSql`
        update public.tenant_modules
           set settings = settings || '{"postingPolicy":"members"}'::jsonb, updated_at = now()
         where tenant_id = ${tenantIds.demo}::uuid and module_key = 'feed'`;
      moduleFlags.invalidate(tenantIds.demo);
      const body = await bootstrap(tokens.demoMember);
      for (const permission of AUTHORING) {
        expect(body.permissions, permission).not.toContain(permission);
      }
    } finally {
      await adminSql`
        update public.tenant_modules set settings = ${adminSql.json(
          (before?.settings ?? {}) as Parameters<typeof adminSql.json>[0],
        )}, updated_at = now()
         where tenant_id = ${tenantIds.demo}::uuid and module_key = 'feed'`;
      moduleFlags.invalidate(tenantIds.demo);
    }
  });
});

describe('09 toggle', () => {
  it('6. PUT …/modules/social flips the composed permissions on the very next request', async () => {
    const previous = await rowOf(tenantIds.lab, 'social');
    try {
      const off = await platformToggle(tenantIds.lab, 'social', false);
      expect(off.status).toBe(200);
      const offBody = await bootstrap(tokens.labMember);
      expect(offBody.modules.map((m) => m.key)).not.toContain('social');
      for (const permission of AUTHORING) {
        expect(offBody.permissions, permission).not.toContain(permission);
      }

      const on = await platformToggle(tenantIds.lab, 'social', true);
      expect(on.status).toBe(200);
      const onBody = await bootstrap(tokens.labMember);
      expect(onBody.modules.map((m) => m.key)).toContain('social');
      for (const permission of AUTHORING) {
        expect(onBody.permissions, permission).toContain(permission);
      }
    } finally {
      await restoreRow(tenantIds.lab, 'social', previous);
    }
  });

  it('7. the toggle accepts the new key at validation and at the database CHECK', async () => {
    const previous = await rowOf(tenantIds.demo, 'social');
    try {
      const res = await platformToggle(tenantIds.demo, 'social', true);
      expect(res.status).toBe(200);
      const [row] = await adminSql<{ enabled: boolean }[]>`
        select enabled from public.tenant_modules
         where tenant_id = ${tenantIds.demo}::uuid and module_key = 'social'`;
      expect(row?.enabled).toBe(true);
    } finally {
      await restoreRow(tenantIds.demo, 'social', previous);
    }
    // A key outside the vocabulary is still refused.
    const unknown = await platformToggle(tenantIds.demo, 'nao-existe', true);
    expect(unknown.status).toBe(400);
  });

  it('8. EP-02: a tenant with no social row reads as off, and the row can come back', async () => {
    const previous = await rowOf(tenantIds.lab, 'social');
    try {
      await adminSql`
        delete from public.tenant_modules
         where tenant_id = ${tenantIds.lab}::uuid and module_key = 'social'`;
      moduleFlags.invalidate(tenantIds.lab);
      const body = await bootstrap(tokens.labMember);
      expect(body.modules.map((m) => m.key)).not.toContain('social');
      for (const permission of AUTHORING) {
        expect(body.permissions, permission).not.toContain(permission);
      }
    } finally {
      await restoreRow(tenantIds.lab, 'social', previous);
    }
    const back = await bootstrap(tokens.labMember);
    expect(back.modules.map((m) => m.key)).toContain('social');
  });
});

/**
 * 10-10 (MPUB-05, D-718, D-483, T-10-38; EP-48, flagged: the probe found no edge category for "social off stops
 * writes and keeps reads", so the matrix below is the planner's and is not probe-verified): the `social` switch end
 * to end on rede-lab, in four ordered steps that share one set of rows. Order is load-bearing.
 *
 *   1. social ON: Helena creates communities, posts in one, publishes stories and saves one in a highlight.
 *   2. social OFF through the database with a WARM flags cache (the 30 s window): every member write answers 403,
 *      never 500 (the SQL gates `app.social_enabled()` and the route's own check are the backstop of the cache).
 *   3. social OFF with the cache expired: the writes are still 403; the community, its post, its highlight and a
 *      story saved in a highlight stay readable with like and comment working; member stories outside a highlight and
 *      the Explorar authors routes are gone; the moderator's archive and removals keep working with their log rows.
 *   4. social ON again: the writes work again, the Explorar row returns, and no row was deleted or rewritten.
 */
describe('10 social switch', () => {
  const PREFIX = 'Teste 10-10 ';
  const RUN_TAG = String(Date.now()).slice(-6);
  const members = {
    helena: '',
    marcos: '',
    alvaro: '',
    admin: '',
  };
  const userIds = { helena: '', marcos: '' };
  const memberships = { helena: '' };
  const made: {
    community?: string;
    modCommunity?: string;
    post?: string;
    modPost?: string;
    plainStory?: string;
    modStory?: string;
    highlightStory?: string;
    highlight?: string;
  } = {};
  const createdAssets: string[] = [];
  let restores: (() => Promise<void>)[] = [];
  let socialPrevious: { enabled: boolean } | undefined;
  let before: Awaited<ReturnType<typeof counts>>;

  const labRequest = (path: string, token: string, init: RequestInit = {}) =>
    api.request(path, {
      ...init,
      headers: {
        'x-tenant-host': HOSTS.lab,
        authorization: `Bearer ${token}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
  const call = (method: string, path: string, token: string, body?: unknown) =>
    labRequest(path, token, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const errorCode = async (res: Response) =>
    ((await res.json()) as { error: { code: string } }).error.code;

  const asset = async (ownerId: string): Promise<string> => {
    const id = randomUUID();
    createdAssets.push(id);
    await adminSql`
      insert into public.media_assets
        (id, tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, variant_widths)
      values (${id}::uuid, ${tenantIds.lab}::uuid, ${ownerId}::uuid, 'image', 'story', 'ready',
              'supabase', 'image/webp', 1024, '{640,1080}'::int[])`;
    return id;
  };

  const setSocial = async (enabled: boolean, invalidate: boolean) => {
    await adminSql`
      update public.tenant_modules set enabled = ${enabled}, updated_at = now()
       where tenant_id = ${tenantIds.lab}::uuid and module_key = 'social'`;
    if (invalidate) moduleFlags.invalidate(tenantIds.lab);
  };

  /** What the switch must never change: the rows of the four tables, minus the moderator's own targets. */
  const counts = async () => {
    const modCommunity = made.modCommunity ?? randomUUID();
    const modPost = made.modPost ?? randomUUID();
    const modStory = made.modStory ?? randomUUID();
    const [row] = await adminSql<
      {
        communities: number;
        posts: number;
        stories: number;
        highlights: number;
        items: number;
        live: number;
      }[]
    >`
      select (select count(*)::int from public.communities
               where tenant_id = ${tenantIds.lab}::uuid and name like ${`${PREFIX}%`}
                 and id <> ${modCommunity}::uuid) as communities,
             (select count(*)::int from public.feed_posts
               where tenant_id = ${tenantIds.lab}::uuid and caption like ${`${PREFIX}%`}
                 and id <> ${modPost}::uuid) as posts,
             (select count(*)::int from public.stories
               where tenant_id = ${tenantIds.lab}::uuid and caption like ${`${PREFIX}%`}
                 and id <> ${modStory}::uuid) as stories,
             (select count(*)::int from public.story_highlights
               where tenant_id = ${tenantIds.lab}::uuid and title like ${`${PREFIX}%`}) as highlights,
             (select count(*)::int from public.story_highlight_items
               where tenant_id = ${tenantIds.lab}::uuid
                 and highlight_id = ${made.highlight ?? randomUUID()}::uuid) as items,
             (select count(*)::int from public.stories
               where tenant_id = ${tenantIds.lab}::uuid and caption like ${`${PREFIX}%`}
                 and id <> ${modStory}::uuid and deleted_at is null) as live`;
    if (!row) throw new Error('could not count the switch fixtures');
    return row;
  };

  async function sweep(): Promise<void> {
    const stories = await adminSql<{ id: string }[]>`
      select id::text as id from public.stories
       where tenant_id = ${tenantIds.lab}::uuid
         and (caption like ${`${PREFIX}%`} or media_asset_id = any (${createdAssets}::uuid[]))`;
    const storyIds = stories.map((row) => row.id);
    const communities = await adminSql<{ id: string }[]>`
      select id::text as id from public.communities
       where tenant_id = ${tenantIds.lab}::uuid and name like ${`${PREFIX}%`}`;
    const communityIds = communities.map((row) => row.id);
    const posts = await adminSql<{ id: string }[]>`
      select id::text as id from public.feed_posts
       where tenant_id = ${tenantIds.lab}::uuid
         and (caption like ${`${PREFIX}%`} or community_id = any (${communityIds}::uuid[]))`;
    const postIds = posts.map((row) => row.id);
    const subjects = [...storyIds, ...communityIds, ...postIds];
    if (subjects.length > 0) {
      await adminSql`delete from public.notifications where subject_id = any (${subjects}::uuid[])`;
      // `moderation_log` is append-only (a trigger refuses delete for every role): the fixture cleanup, scoped to
      // this file's subject ids, runs with triggers off for the transaction (the member-stories sweep precedent).
      await adminSql.begin(async (tx) => {
        await tx.unsafe('set local session_replication_role = replica');
        await tx`delete from public.moderation_log where subject_id = any (${subjects}::uuid[])`;
      });
    }
    await adminSql`delete from public.story_highlights where title like ${`${PREFIX}%`}`;
    if (storyIds.length > 0) {
      await adminSql`delete from public.stories where id = any (${storyIds}::uuid[])`;
    }
    if (postIds.length > 0) {
      await adminSql`delete from public.feed_posts where id = any (${postIds}::uuid[])`;
    }
    if (communityIds.length > 0) {
      await adminSql`delete from public.communities where id = any (${communityIds}::uuid[])`;
    }
    if (createdAssets.length > 0) {
      await adminSql`delete from public.media_assets where id = any (${createdAssets}::uuid[])`;
    }
  }

  beforeAll(async () => {
    members.helena = await signInAs('helena.kuster@rede-lab.local', SEED_PASSWORD);
    members.marcos = await signInAs('marcos.vinicius@rede-lab.local', SEED_PASSWORD);
    members.alvaro = await signInAs('alvaro.pinheiro@rede-lab.local', SEED_PASSWORD);
    members.admin = tokens.labAdmin;
    for (const [key, email] of [
      ['helena', 'helena.kuster@rede-lab.local'],
      ['marcos', 'marcos.vinicius@rede-lab.local'],
    ] as const) {
      const [row] = await adminSql<{ user_id: string; id: string }[]>`
        select m.user_id::text as user_id, m.id::text as id from public.memberships m
          join public.users u on u.id = m.user_id
         where u.email = ${email} and m.tenant_id = ${tenantIds.lab}::uuid`;
      userIds[key] = row?.user_id ?? '';
      if (key === 'helena') memberships.helena = row?.id ?? '';
    }
    socialPrevious = await rowOf(tenantIds.lab, 'social');
    restores = [
      await withSocialEnabled('lab'),
      await withCommunitiesEnabled('lab'),
      await withStoriesEnabled('lab'),
    ];
    await sweep();
  });

  afterAll(async () => {
    // A crashed run must not leave the module off in the local rede-lab tenant.
    await restoreRow(tenantIds.lab, 'social', socialPrevious);
    await sweep();
    for (const restore of restores.reverse()) await restore();
    communityCreateLimiter.reset();
    storyPublishLimiter.reset();
  });

  it('1. social ON: Helena creates a community, publishes a post, a story and a highlight, and the Explorar row lists her', async () => {
    communityCreateLimiter.reset();
    storyPublishLimiter.reset();
    const community = await call('POST', '/v1/communities', members.helena, {
      name: `${PREFIX}Corrida`,
    });
    expect(community.status).toBe(201);
    made.community = ((await community.json()) as { id: string }).id;
    const modCommunity = await call('POST', '/v1/communities', members.helena, {
      name: `${PREFIX}Moderada`,
    });
    expect(modCommunity.status).toBe(201);
    made.modCommunity = ((await modCommunity.json()) as { id: string }).id;
    for (const [key, communityId, caption] of [
      ['post', made.community, `${PREFIX}post`],
      ['modPost', made.modCommunity, `${PREFIX}post da moderada`],
    ] as const) {
      const res = await call('POST', '/v1/feed/posts', members.helena, { caption, communityId });
      expect(res.status, caption).toBe(201);
      made[key] = ((await res.json()) as { id: string }).id;
    }
    const plain = await call('POST', '/v1/stories', members.helena, {
      mediaAssetId: await asset(userIds.helena),
      mediaKind: 'image',
      caption: `${PREFIX}solta`,
    });
    expect(plain.status).toBe(201);
    made.plainStory = ((await plain.json()) as { id: string }).id;
    // The moderator's story target is held by a highlight of the moderated community, so it stays reachable by the
    // moderator with `social` off (the highlight branch of the audience gate); its highlight title carries no PREFIX.
    const held = await call('POST', '/v1/stories', members.helena, {
      mediaAssetId: await asset(userIds.helena),
      mediaKind: 'image',
      caption: `${PREFIX}do moderador`,
      newHighlight: { communityId: made.modCommunity, title: `Moderacao 10-10 ${RUN_TAG}` },
    });
    expect(held.status).toBe(201);
    made.modStory = ((await held.json()) as { id: string }).id;
    const saved = await call('POST', '/v1/stories', members.helena, {
      mediaAssetId: await asset(userIds.helena),
      mediaKind: 'image',
      caption: `${PREFIX}no destaque`,
      newHighlight: { communityId: made.community, title: `${PREFIX}Treinos` },
    });
    expect(saved.status).toBe(201);
    made.highlightStory = ((await saved.json()) as { id: string }).id;
    const [highlight] = await adminSql<{ id: string }[]>`
      select id::text as id from public.story_highlights where community_id = ${made.community ?? ''}::uuid`;
    made.highlight = highlight?.id;
    expect(made.highlight).toBeTruthy();

    // Explorar: Alvaro follows Helena, so her circle is in his row, and her loose story opens for him.
    const row = await call('GET', '/v1/stories/authors', members.alvaro);
    expect(row.status).toBe(200);
    expect(
      ((await row.json()) as { items: { membershipId: string }[] }).items.map(
        (item) => item.membershipId,
      ),
    ).toContain(memberships.helena);
    expect((await call('GET', `/v1/stories/${made.plainStory}`, members.alvaro)).status).toBe(200);
    before = await counts();
    expect(before).toEqual({
      communities: 1,
      posts: 1,
      stories: 2,
      highlights: 1,
      items: 1,
      live: 2,
    });
  });

  it('2. social OFF with a WARM flags cache: every member write answers 403, never 500', async () => {
    // The cache holds `social` on from step 1; the switch is flipped under it, exactly the 30 s window of T-10-38.
    await setSocial(false, false);
    const writes = [
      ['create a community', 'POST', '/v1/communities', { name: `${PREFIX}recusada` }],
      ['edit a community', 'PATCH', `/v1/communities/${made.community}`, { description: 'Nova.' }],
      ['archive a community', 'PATCH', `/v1/communities/${made.community}`, { status: 'archived' }],
      ['delete a community', 'DELETE', `/v1/communities/${made.community}`, undefined],
      [
        'post in the community',
        'POST',
        '/v1/feed/posts',
        { caption: `${PREFIX}recusado`, communityId: made.community },
      ],
      [
        'publish a story',
        'POST',
        '/v1/stories',
        {
          mediaAssetId: await asset(userIds.helena),
          mediaKind: 'image',
          caption: `${PREFIX}recusado`,
        },
      ],
      [
        'publish a story into a new highlight',
        'POST',
        '/v1/stories',
        {
          mediaAssetId: await asset(userIds.helena),
          mediaKind: 'image',
          caption: `${PREFIX}recusado`,
          newHighlight: { communityId: made.community, title: `${PREFIX}recusado` },
        },
      ],
      [
        'create a highlight',
        'POST',
        '/v1/stories/highlights',
        { communityId: made.community, title: `${PREFIX}recusado` },
      ],
      [
        'rename a highlight',
        'PATCH',
        `/v1/stories/highlights/${made.highlight}`,
        { title: `${PREFIX}renomeado` },
      ],
      [
        'save a story in a highlight',
        'PUT',
        `/v1/stories/highlights/${made.highlight}/stories/${made.plainStory}`,
        undefined,
      ],
    ] as const;
    for (const [label, method, path, body] of writes) {
      const res = await call(method, path, members.helena, body);
      expect(res.status, `${label} (warm cache): ${res.status}`).toBe(403);
    }
    const [refused] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.communities
       where tenant_id = ${tenantIds.lab}::uuid and name = ${`${PREFIX}recusada`}`;
    expect(refused?.n).toBe(0);
  });

  it('3. social OFF, cache expired: writes stay 403; the community, its post, its highlight and a saved story stay readable with like and comment; the rest of the member surface is gone; the moderator keeps working', async () => {
    moduleFlags.invalidate(tenantIds.lab);
    // Writes: the permission has left the composed set, so the guard answers (still 403, never 500).
    for (const [label, method, path, body] of [
      ['create a community', 'POST', '/v1/communities', { name: `${PREFIX}recusada` }],
      ['edit a community', 'PATCH', `/v1/communities/${made.community}`, { description: 'Nova.' }],
      [
        'post in the community',
        'POST',
        '/v1/feed/posts',
        { caption: `${PREFIX}recusado`, communityId: made.community },
      ],
      [
        'publish a story',
        'POST',
        '/v1/stories',
        {
          mediaAssetId: await asset(userIds.helena),
          mediaKind: 'image',
          caption: `${PREFIX}recusado`,
        },
      ],
      [
        'create a highlight',
        'POST',
        '/v1/stories/highlights',
        { communityId: made.community, title: `${PREFIX}recusado` },
      ],
    ] as const) {
      const res = await call(method, path, members.helena, body);
      expect(res.status, `${label} (cache expired)`).toBe(403);
    }

    // Reads: Marcos lists and opens the community, reads its post, its highlight and the story saved in it.
    const list = await call('GET', '/v1/communities?limit=25', members.marcos);
    expect(list.status).toBe(200);
    expect(((await list.json()) as { items: { id: string }[] }).items.map((i) => i.id)).toContain(
      made.community,
    );
    expect((await call('GET', `/v1/communities/${made.community}`, members.marcos)).status).toBe(
      200,
    );
    expect((await call('GET', `/v1/feed/posts/${made.post}`, members.marcos)).status).toBe(200);
    const feed = await call(
      'GET',
      `/v1/feed?limit=25&communityId=${made.community}`,
      members.marcos,
    );
    expect(feed.status).toBe(200);
    expect(((await feed.json()) as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([
      made.post,
    ]);
    const row = await call(
      'GET',
      `/v1/stories/highlights?communityId=${made.community}`,
      members.marcos,
    );
    expect(row.status).toBe(200);
    expect(((await row.json()) as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([
      made.highlight,
    ]);
    // The saved story is read after its 24 hours (expiry moved into the past), liked and commented on.
    await adminSql`
      update public.stories
         set published_at = now() - interval '30 hours', expires_at = now() - interval '6 hours'
       where id = ${made.highlightStory ?? ''}::uuid`;
    const detail = await call('GET', `/v1/stories/highlights/${made.highlight}`, members.marcos);
    expect(detail.status).toBe(200);
    expect(
      ((await detail.json()) as { items: { id: string }[] }).items.map((item) => item.id),
    ).toEqual([made.highlightStory]);
    expect((await call('GET', `/v1/stories/${made.highlightStory}`, members.marcos)).status).toBe(
      200,
    );
    expect(
      (await call('POST', `/v1/stories/${made.highlightStory}/likes`, members.marcos)).status,
    ).toBe(200);
    expect(
      (
        await call('POST', `/v1/stories/${made.highlightStory}/comments`, members.marcos, {
          body: `${PREFIX}comentario`,
        })
      ).status,
    ).toBe(201);
    // Like and comment on the community's post too.
    expect((await call('POST', `/v1/feed/posts/${made.post}/like`, members.marcos)).status).toBe(
      200,
    );
    expect(
      (
        await call('POST', `/v1/feed/posts/${made.post}/comments`, members.marcos, {
          body: `${PREFIX}comentario`,
        })
      ).status,
    ).toBe(201);

    // The Explorar authors routes are gone for everyone, the moderator included, and a loose member story is
    // unreadable by id for the follower and for the stranger.
    for (const token of [members.alvaro, members.marcos, members.admin]) {
      const authors = await call('GET', '/v1/stories/authors', token);
      expect(authors.status).toBe(404);
      expect(await errorCode(authors)).toBe('MODULE_DISABLED');
      const group = await call('GET', `/v1/stories/authors/${memberships.helena}`, token);
      expect(group.status).toBe(404);
      expect(await errorCode(group)).toBe('MODULE_DISABLED');
    }
    for (const token of [members.alvaro, members.marcos]) {
      expect((await call('GET', `/v1/stories/${made.plainStory}`, token)).status).toBe(404);
    }

    // The moderator: delete a member story, archive then remove a member community and remove its post, each with its log row.
    const logged = async (subject: string | undefined): Promise<string[]> =>
      (
        await adminSql<{ action: string }[]>`
          select action from public.moderation_log where subject_id = ${subject ?? ''}::uuid`
      ).map((row) => row.action);
    // A member story held by a highlight stays reachable by the moderator, so its delete works with its log row.
    const removed = await call('DELETE', `/v1/stories/${made.modStory}`, members.admin);
    expect(removed.status).toBe(204);
    expect(await logged(made.modStory)).toContain('story_removed');
    // KNOWN LIMIT (pgTAP 231 section 3 against D-718, recorded in docs/DEPLOY.md under the Phase 10 open items): a
    // loose member story is outside every read of the moderator while `social` is off, so deleting it is the bare 404.
    // If this ever turns 204 the DEPLOY.md item has to be revisited.
    const loose = await call('DELETE', `/v1/stories/${made.plainStory}`, members.admin);
    expect(loose.status).toBe(404);
    const archived = await call('PATCH', `/v1/communities/${made.modCommunity}`, members.admin, {
      status: 'archived',
    });
    expect(archived.status).toBe(200);
    expect(await logged(made.modCommunity)).toContain('community_archived');
    expect((await call('DELETE', `/v1/feed/posts/${made.modPost}`, members.admin)).status).toBe(
      200,
    );
    expect(await logged(made.modPost)).toContain('post_removed');
    expect(
      (await call('DELETE', `/v1/communities/${made.modCommunity}`, members.admin)).status,
    ).toBe(204);
    expect(await logged(made.modCommunity)).toContain('community_removed');
  });

  it('4. social ON again: the writes work, the Explorar row returns, and no row was deleted or rewritten', async () => {
    await setSocial(true, true);
    communityCreateLimiter.reset();
    storyPublishLimiter.reset();
    const created = await call('POST', '/v1/communities', members.helena, {
      name: `${PREFIX}de volta`,
    });
    expect(created.status).toBe(201);
    expect(
      (
        await call('POST', '/v1/feed/posts', members.helena, {
          caption: `${PREFIX}de volta`,
          communityId: made.community,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await call('POST', '/v1/stories', members.helena, {
          mediaAssetId: await asset(userIds.helena),
          mediaKind: 'image',
          caption: `${PREFIX}de volta`,
        })
      ).status,
    ).toBe(201);
    const row = await call('GET', '/v1/stories/authors', members.alvaro);
    expect(row.status).toBe(200);
    expect(
      ((await row.json()) as { items: { membershipId: string }[] }).items.map(
        (item) => item.membershipId,
      ),
    ).toContain(memberships.helena);
    expect((await call('GET', `/v1/stories/${made.plainStory}`, members.alvaro)).status).toBe(200);
    // The rows of step 1 are all still there, untouched by the off and on (the three new rows above are the
    // only difference, and they are counted out by name).
    const after = await counts();
    expect({
      ...after,
      communities: after?.communities - 1,
      posts: after?.posts - 1,
      stories: after?.stories - 1,
      live: after?.live - 1,
    }).toEqual(before);
    const [still] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.communities
       where id = ${made.community ?? ''}::uuid and deleted_at is null and status = 'active'`;
    expect(still?.n).toBe(1);
  });

  it('5. D-701 / D-702 / D-705: the seam as a whole, with social on: a stranger reads no loose member story, a member-community post is in no merged read, and only the creator posts in the community', async () => {
    // D-705: Marcos does not follow Helena, so her loose story is the bare 404 (no details: no existence oracle).
    const stranger = await call('GET', `/v1/stories/${made.plainStory}`, members.marcos);
    expect(stranger.status).toBe(404);
    expect(
      ((await stranger.json()) as { error: { details?: unknown } }).error.details,
    ).toBeUndefined();
    // Positive control: the follower reads the same story.
    expect((await call('GET', `/v1/stories/${made.plainStory}`, members.alvaro)).status).toBe(200);

    // D-701: the community's post (and a community VIDEO post, the Reels "Todos" candidate) is on the community page
    // for the follower and the stranger, and in no Início, no Explorar and no Reels "Todos".
    const [video] = await adminSql<{ id: string }[]>`
      insert into public.media_assets
        (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, playback_id,
         mime, bytes, width, height, duration_seconds, aspect_ratio, filename, ready_at)
      values (${tenantIds.lab}::uuid, ${userIds.helena}::uuid, 'video', 'post', 'ready', 'fake',
              ${`fake-${randomUUID()}`}, ${`pb-${randomUUID()}`},
              'video/mp4', 1048576, 1080, 1920, 15, '9:16', 'reel-10-10.mp4', now())
      returning id::text as id`;
    if (video) createdAssets.push(video.id);
    const [videoPost] = await adminSql<{ id: string }[]>`
      insert into public.feed_posts
        (tenant_id, author_user_id, community_id, caption, visibility, media_kind)
      values (${tenantIds.lab}::uuid, ${userIds.helena}::uuid, ${made.community ?? ''}::uuid,
              ${`${PREFIX}video da comunidade`}, 'community', 'video')
      returning id::text as id`;
    await adminSql`
      insert into public.feed_post_media
        (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
      values (${tenantIds.lab}::uuid, ${videoPost?.id ?? ''}::uuid, 'video', ${video?.id ?? ''}::uuid, 'video', 0)`;
    const feedIds = async (token: string, query: string): Promise<string[]> => {
      const res = await call('GET', `/v1/feed?limit=25${query}`, token);
      expect(res.status, query).toBe(200);
      return ((await res.json()) as { items: { id: string }[] }).items.map((item) => item.id);
    };
    for (const token of [members.alvaro, members.marcos, members.helena]) {
      for (const query of ['', '&scope=explorar', '&media=video']) {
        const ids = await feedIds(token, query);
        expect(ids, `merged read ${query || 'inicio'}`).not.toContain(made.post);
        expect(ids, `merged read ${query || 'inicio'}`).not.toContain(videoPost?.id);
      }
    }
    for (const token of [members.alvaro, members.marcos]) {
      const onPage = await feedIds(token, `&communityId=${made.community}`);
      expect(onPage).toEqual(expect.arrayContaining([made.post, videoPost?.id]));
    }

    // D-702: a non-owner publish in the member community is 403 for a member, the admin and a support session.
    const before = await counts();
    for (const [who, token] of [
      ['member', members.marcos],
      ['admin', members.admin],
      ['support', tokens.labSupport],
    ] as const) {
      const res = await call('POST', '/v1/feed/posts', token, {
        caption: `${PREFIX}intruso`,
        communityId: made.community,
      });
      expect(res.status, who).toBe(403);
    }
    expect((await counts()).posts).toBe(before.posts);
    // Positive control: the creator posts in it.
    const owner = await call('POST', '/v1/feed/posts', members.helena, {
      caption: `${PREFIX}dona`,
      communityId: made.community,
    });
    expect(owner.status).toBe(201);
  });
});
