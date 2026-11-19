import { randomUUID } from 'node:crypto';
import { sqlClient } from '@rede-social/core/db';
import { communityCreateLimiter } from '@rede-social/core/server/safety/limits';
import type { CommunitySummary } from '@rede-social/module-communities/contracts';
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
 * 11-15 (D-733, A-11-ROLE, MODER-05, CHAT-07; T-11-29, T-11-03, T-11-01) against the live local stack and the real
 * seed: the two rider booleans `canReport` and `canBlock` on every subject a member can open a menu on, computed on
 * the SERVER (never a role or an id on the screen):
 *
 *  - `canReport`: the viewer did not write the item (true for staff and organization content);
 *  - `canBlock`: not the viewer's own, the item's author is a live `member`, AND the viewer's own role of record on
 *    the request is `member` (A-11-ROLE: staff accounts see Denunciar and never Bloquear).
 *
 * Roles of rede-lab: Alvaro is the viewer (he follows Helena in the seed), Helena the author of the member story,
 * comment and post, the lab administrator holds `moderation.manage`, `support@` is a real `support_tenant`. Fixtures
 * carry `PREFIX` and are swept at the start and at the end; stories and comments are written by hand so each case
 * controls its audience.
 */

const PREFIX = 'Teste 11-15 ';
const tokens = { alvaro: '', helena: '', marcos: '', labAdmin: '', support: '' };
const userIds = { alvaro: '', helena: '', marcos: '', labAdmin: '' };
let labTenantId = '';
let restoreSocial: () => Promise<void> = async () => {};
let restoreCommunities: () => Promise<void> = async () => {};
let restoreStories: () => Promise<void> = async () => {};
const createdAssets: string[] = [];

type Riders = { canReport?: boolean; canBlock?: boolean };

const request = (path: string, token: string, init: RequestInit = {}, host = HOSTS.lab) =>
  api.request(path, {
    ...init,
    headers: {
      'x-tenant-host': host,
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });

async function userOf(email: string): Promise<string> {
  const [row] = await adminSql<{ user_id: string }[]>`
    select m.user_id from public.memberships m
      join public.users u on u.id = m.user_id
     where u.email = ${email}`;
  if (!row) throw new Error(`${email} is not seeded`);
  return row.user_id;
}

/** A `purpose: 'story'` asset of rede-lab owned by `ownerId`. */
async function makeAsset(ownerId: string): Promise<string> {
  const id = randomUUID();
  createdAssets.push(id);
  await adminSql`
    insert into public.media_assets
      (id, tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, variant_widths)
    values (${id}::uuid, ${labTenantId}::uuid, ${ownerId}::uuid, 'image', 'story', 'ready',
            'supabase', 'image/webp', 1024, '{640,1080}'::int[])`;
  return id;
}

/** A live story written by hand (the audience each case needs). */
async function insertStory(author: string, visibility: 'tenant' | 'followers', label: string) {
  const asset = await makeAsset(author);
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.stories
      (tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility,
       published_at, expires_at)
    values (${labTenantId}::uuid, ${author}::uuid, ${asset}::uuid, 'image', ${`${PREFIX}${label}`},
            ${visibility}, now(), now() + interval '24 hours')
    returning id`;
  return row?.id ?? '';
}

async function sweep(): Promise<void> {
  const stories = await adminSql<{ id: string }[]>`
    select id from public.stories where caption like ${`${PREFIX}%`}`;
  const storyIds = stories.map((row) => row.id);
  if (storyIds.length > 0) {
    await adminSql`delete from public.feed_comments where story_id = any (${storyIds}::uuid[])`;
    await adminSql`delete from public.stories where id = any (${storyIds}::uuid[])`;
  }
  if (createdAssets.length > 0) {
    await adminSql`delete from public.media_assets where id = any (${createdAssets}::uuid[])`;
  }
  await adminSql`delete from public.communities where name like ${`${PREFIX}%`}`;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  restoreSocial = await withSocialEnabled('lab');
  restoreCommunities = await withCommunitiesEnabled('lab');
  restoreStories = await withStoriesEnabled('lab');
  tokens.alvaro = await signInAs('alvaro.pinheiro@rede-lab.local', SEED_PASSWORD);
  tokens.helena = await signInAs('helena.kuster@rede-lab.local', SEED_PASSWORD);
  tokens.marcos = await signInAs('marcos.vinicius@rede-lab.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  tokens.support = await signInAs('support@rede-lab.local', SEED_PASSWORD);
  userIds.alvaro = await userOf('alvaro.pinheiro@rede-lab.local');
  userIds.helena = await userOf('helena.kuster@rede-lab.local');
  userIds.marcos = await userOf('marcos.vinicius@rede-lab.local');
  userIds.labAdmin = await userOf('admin@rede-lab.local');
  const [lab] = await adminSql<
    { id: string }[]
  >`select id from public.tenants where slug = 'rede-lab'`;
  labTenantId = lab?.id ?? '';
  await sweep();
});

afterAll(async () => {
  await sweep();
  await restoreStories();
  await restoreCommunities();
  await restoreSocial();
  await adminSql.end();
  await sqlClient.end();
});

describe('story riders', () => {
  const stories: { member: string; org: string } = { member: '', org: '' };

  const readStory = async (
    token: string,
    id: string,
  ): Promise<{ status: number; body: Riders }> => {
    const res = await request(`/v1/stories/${id}`, token);
    return { status: res.status, body: (await res.json()) as Riders };
  };

  it('1. a member sees Denunciar and Bloquear on a followed member’s story; the author sees neither', async () => {
    stories.member = await insertStory(userIds.helena, 'followers', 'membro');
    const viewer = await readStory(tokens.alvaro, stories.member);
    expect(viewer.status).toBe(200);
    expect(viewer.body.canReport).toBe(true);
    expect(viewer.body.canBlock).toBe(true);
    const author = await readStory(tokens.helena, stories.member);
    expect(author.status).toBe(200);
    expect(author.body.canReport).toBe(false);
    expect(author.body.canBlock).toBe(false);
  });

  it('1b. staff read Denunciar and never Bloquear on the same story (A-11-ROLE)', async () => {
    const admin = await readStory(tokens.labAdmin, stories.member);
    expect(admin.status).toBe(200);
    expect(admin.body.canReport).toBe(true);
    expect(admin.body.canBlock).toBe(false);
    // `support_tenant` holds no story read key in this tenant (the authors suites pin 403): a read it may not make
    // carries no rider at all, and a read it may make carries the staff rule.
    const support = await readStory(tokens.support, stories.member);
    if (support.status === 200) {
      expect(support.body.canReport).toBe(true);
      expect(support.body.canBlock).toBe(false);
    } else {
      expect([403, 404]).toContain(support.status);
      expect(support.body).not.toHaveProperty('canBlock');
    }
  });

  it('2. an organization story: a member reads canReport true and canBlock false; its author the administrator reads both false', async () => {
    stories.org = await insertStory(userIds.labAdmin, 'tenant', 'organizacao');
    const member = await readStory(tokens.alvaro, stories.org);
    expect(member.status).toBe(200);
    expect(member.body.canReport).toBe(true);
    expect(member.body.canBlock).toBe(false);
    const author = await readStory(tokens.labAdmin, stories.org);
    expect(author.status).toBe(200);
    expect(author.body.canReport).toBe(false);
    expect(author.body.canBlock).toBe(false);
  });

  it('2b. the strip and the author read carry the same riders (one projection)', async () => {
    const strip = await request('/v1/stories?limit=50', tokens.alvaro);
    expect(strip.status).toBe(200);
    const page = (await strip.json()) as { items: Array<Riders & { id: string }> };
    const org = page.items.find((item) => item.id === stories.org);
    expect(org?.canReport).toBe(true);
    expect(org?.canBlock).toBe(false);
  });

  it('3. T-11-01: another tenant’s story is the bare 404 for a viewer of this tenant and carries no rider', async () => {
    const [demo] = await adminSql<
      { id: string }[]
    >`select id from public.stories where tenant_id <> ${labTenantId}::uuid limit 1`;
    if (!demo) return;
    const res = await request(`/v1/stories/${demo.id}`, tokens.alvaro);
    expect(res.status).toBe(404);
    expect(await res.json()).not.toHaveProperty('canBlock');
  });
});

describe('story comment riders', () => {
  const made: { story: string; byHelena: string; byAdmin: string; byStranger: string } = {
    story: '',
    byHelena: '',
    byAdmin: '',
    byStranger: '',
  };

  const insertComment = async (author: string, body: string): Promise<string> => {
    const [row] = await adminSql<{ id: string }[]>`
      insert into public.feed_comments (tenant_id, story_id, author_user_id, body, depth)
      values (${labTenantId}::uuid, ${made.story}::uuid, ${author}::uuid, ${`${PREFIX}${body}`}, 0)
      returning id`;
    return row?.id ?? '';
  };

  const commentsFor = async (token: string): Promise<Map<string, Riders>> => {
    const res = await request(`/v1/stories/${made.story}/comments?limit=50`, token);
    expect(res.status).toBe(200);
    const page = (await res.json()) as { items: Array<Riders & { id: string }> };
    return new Map(page.items.map((item) => [item.id, item]));
  };

  it('1. the comments of an organization story: a member reads both riders true on a member’s comment, canBlock false on the administrator’s', async () => {
    made.story = await insertStory(userIds.labAdmin, 'tenant', 'comentarios');
    made.byHelena = await insertComment(userIds.helena, 'da helena');
    made.byAdmin = await insertComment(userIds.labAdmin, 'do admin');
    // A comment whose author has no live membership in this tenant (a user of another tenant): the author is "removed".
    const [stranger] = await adminSql<{ user_id: string }[]>`
      select m.user_id from public.memberships m
        join public.tenants t on t.id = m.tenant_id
       where t.slug = 'rede-demo' and m.deleted_at is null limit 1`;
    made.byStranger = await insertComment(stranger?.user_id ?? '', 'de quem saiu');
    const seen = await commentsFor(tokens.alvaro);
    expect(seen.get(made.byHelena)?.canReport).toBe(true);
    expect(seen.get(made.byHelena)?.canBlock).toBe(true);
    expect(seen.get(made.byAdmin)?.canReport).toBe(true);
    expect(seen.get(made.byAdmin)?.canBlock).toBe(false);
  });

  it('2. the author reads both false on their own comment (and the others as any member would)', async () => {
    const seen = await commentsFor(tokens.helena);
    expect(seen.get(made.byHelena)?.canReport).toBe(false);
    expect(seen.get(made.byHelena)?.canBlock).toBe(false);
    expect(seen.get(made.byAdmin)?.canReport).toBe(true);
    expect(seen.get(made.byAdmin)?.canBlock).toBe(false);
  });

  it('3. A-11-ROLE: the administrator reads canReport true and canBlock false on a member’s comment; on their own both false', async () => {
    const seen = await commentsFor(tokens.labAdmin);
    expect(seen.get(made.byHelena)?.canReport).toBe(true);
    expect(seen.get(made.byHelena)?.canBlock).toBe(false);
    expect(seen.get(made.byAdmin)?.canReport).toBe(false);
    expect(seen.get(made.byAdmin)?.canBlock).toBe(false);
  });

  it('4. MODER-05 empty: a comment whose author is removed reads canReport true and canBlock false, never an error', async () => {
    for (const token of [tokens.alvaro, tokens.labAdmin]) {
      const seen = await commentsFor(token);
      expect(seen.get(made.byStranger)?.canReport).toBe(true);
      expect(seen.get(made.byStranger)?.canBlock).toBe(false);
    }
  });

  it('5. a comment just published answers its own riders (both false for the author)', async () => {
    const res = await request(`/v1/stories/${made.story}/comments`, tokens.alvaro, {
      method: 'POST',
      body: JSON.stringify({ body: `${PREFIX}nova` }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as Riders;
    expect(created.canReport).toBe(false);
    expect(created.canBlock).toBe(false);
  });
});

describe('community riders', () => {
  const made: { member: string; org: string } = { member: '', org: '' };
  const detail = async (token: string, id: string): Promise<CommunitySummary> => {
    const res = await request(`/v1/communities/${id}`, token);
    expect(res.status).toBe(200);
    return (await res.json()) as CommunitySummary;
  };
  type ViewerRiders = CommunitySummary['viewer'] & Riders;

  it('1. a member community of Marcos: Alvaro reads both riders true; Marcos, the creator, both false', async () => {
    communityCreateLimiter.reset();
    const created = await request('/v1/communities', tokens.marcos, {
      method: 'POST',
      body: JSON.stringify({ name: `${PREFIX}do marcos` }),
    });
    expect(created.status).toBe(201);
    made.member = ((await created.json()) as CommunitySummary).id;
    const viewer = (await detail(tokens.alvaro, made.member)).viewer as ViewerRiders;
    expect(viewer.canReport).toBe(true);
    expect(viewer.canBlock).toBe(true);
    const creator = (await detail(tokens.marcos, made.member)).viewer as ViewerRiders;
    expect(creator.canReport).toBe(false);
    expect(creator.canBlock).toBe(false);
  });

  it('2. A-11-ROLE: the administrator reads canReport true and canBlock false on a member community', async () => {
    const viewer = (await detail(tokens.labAdmin, made.member)).viewer as ViewerRiders;
    expect(viewer.canReport).toBe(true);
    expect(viewer.canBlock).toBe(false);
  });

  it('3. an organization community the administrator created: a member reads canReport true and canBlock false; its creator both false', async () => {
    const created = await request('/v1/communities', tokens.labAdmin, {
      method: 'POST',
      body: JSON.stringify({ name: `${PREFIX}da organizacao` }),
    });
    expect(created.status).toBe(201);
    made.org = ((await created.json()) as CommunitySummary).id;
    const member = (await detail(tokens.alvaro, made.org)).viewer as ViewerRiders;
    expect(member.canReport).toBe(true);
    expect(member.canBlock).toBe(false);
    const creator = (await detail(tokens.labAdmin, made.org)).viewer as ViewerRiders;
    expect(creator.canReport).toBe(false);
    expect(creator.canBlock).toBe(false);
  });

  it('4. the list carries the same riders as the detail (one projection) and the answer of a create names its own', async () => {
    const res = await request('/v1/communities?limit=50', tokens.alvaro);
    expect(res.status).toBe(200);
    const page = (await res.json()) as { items: CommunitySummary[] };
    const row = page.items.find((item) => item.id === made.member);
    expect((row?.viewer as ViewerRiders | undefined)?.canBlock).toBe(true);
    const creating = await request('/v1/communities', tokens.helena, {
      method: 'POST',
      body: JSON.stringify({ name: `${PREFIX}da helena` }),
    });
    expect(creating.status).toBe(201);
    const own = ((await creating.json()) as CommunitySummary).viewer as ViewerRiders;
    expect(own.canReport).toBe(false);
    expect(own.canBlock).toBe(false);
  });

  it('5. T-11-01: a community id of nothing is the bare 404 and carries no rider', async () => {
    const res = await request(`/v1/communities/${randomUUID()}`, tokens.alvaro);
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain('canBlock');
  });
});
