import { sqlClient } from '@rede-social/core/db';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { communityCreateLimiter } from '@rede-social/core/server/safety/limits';
import type { CommunitySummary } from '@rede-social/module-communities/contracts';
import {
  COMMUNITY_MAX_DESCRIPTION,
  COMMUNITY_MAX_NAME,
} from '@rede-social/module-communities/contracts';
import type { FeedPage, FeedPost } from '@rede-social/module-feed/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
 * 10-05 (D-706, D-707, D-709, D-710, D-711, D-713; MCOMM-01/05/06/10, MPUB-01/02/03/05) against the live
 * local stack and the real seed: a member of a `social` tenant creates a community stamped as theirs,
 * publishes in it, and nobody else (an admin included) can.
 *
 * `10 tracer` is ONE creator, ONE community, ONE post and the refusals, end to end (the route guard, the
 * permission composition, the kind stamp, the owner seam of the post, the derived audience, the RLS gates
 * of plan 03 behind them and the read predicates). `10 limit` and `10 lifecycle` arrive with the later
 * tasks of the plan and share these fixtures.
 *
 * Fixtures: rede-lab has `social` ON in the seed (the suite re-asserts it). Every member community this
 * file makes is created by Helena, Marcos or the lab member, so the sweep is exact: it removes the
 * `kind = 'member'` communities of those users and the posts that carry `PREFIX`. Test ORDER inside a
 * describe is load-bearing (declaration order).
 */

type Envelope = { error: { code: string; message?: string; details?: Record<string, unknown> } };

const PREFIX = 'Teste 10-05 ';
const tokens = { helena: '', marcos: '', alvaro: '', labAdmin: '', labMember: '' };
const userIds = { helena: '', marcos: '', alvaro: '', labAdmin: '', labMember: '' };
let labTenantId = '';
let restoreSocial: () => Promise<void> = async () => {};
let restoreCommunities: () => Promise<void> = async () => {};
let restoreStories: () => Promise<void> = async () => {};
/** The social settings blob of rede-lab as the suite found it, put back in `afterAll` (the limit tests write it). */
let savedSocialSettings: Record<string, unknown> = {};
/** The seeded ORGANIZATION community of rede-lab that the Escopo assertions post into. */
let orgCommunityId = '';

const request = (path: string, token: string, init: RequestInit = {}) =>
  api.request(path, {
    ...init,
    headers: {
      'x-tenant-host': HOSTS.lab,
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const patch = (body: unknown): RequestInit => ({ method: 'PATCH', body: JSON.stringify(body) });

const createCommunity = (token: string, body: Record<string, unknown>) =>
  request('/v1/communities', token, json(body));

const publish = (token: string, body: Record<string, unknown>) =>
  request('/v1/feed/posts', token, json(body));

const errorOf = async (res: Response) => ((await res.json()) as Envelope).error;

const feedOf = async (token: string, query: string): Promise<FeedPost[]> => {
  const res = await request(`/v1/feed?limit=25${query}`, token);
  expect(res.status, `GET /v1/feed?limit=25${query}`).toBe(200);
  return ((await res.json()) as FeedPage).items;
};

async function userOf(email: string): Promise<string> {
  const [row] = await adminSql<{ user_id: string }[]>`
    select m.user_id from public.memberships m
      join public.users u on u.id = m.user_id
     where u.email = ${email}`;
  if (!row) throw new Error(`${email} is not seeded`);
  return row.user_id;
}

const memberUsers = () => [userIds.helena, userIds.marcos, userIds.labMember];

/** Removes what this file wrote: the test users' posts and member communities (posts first, the FK). */
async function sweep(): Promise<void> {
  await adminSql`delete from public.feed_posts where caption like ${`${PREFIX}%`}`;
  await adminSql`delete from public.media_assets where filename = 'reel-10-05.mp4'`;
  await adminSql`
    delete from public.feed_posts
     where community_id in (
       select id from public.communities
        where kind = 'member' and created_by_user_id = any (${memberUsers()}::uuid[]))`;
  await adminSql`
    delete from public.communities
     where kind = 'member' and created_by_user_id = any (${memberUsers()}::uuid[])`;
  await adminSql`
    delete from public.communities where name like ${`${PREFIX}%`}`;
}

/** Writes the social settings blob of rede-lab verbatim and drops the flags cache (a 30 s cache otherwise). */
async function writeSocialSettings(settings: Record<string, unknown>): Promise<void> {
  await adminSql`
    update public.tenant_modules set settings = ${adminSql.json(settings as never)}
     where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
  moduleFlags.invalidate(labTenantId);
}

/** The per-member limit as `super_admin` stores it; `null` writes a blob with NO `communities` key. */
const setLimit = (maxPerMember: number | null) =>
  writeSocialSettings(
    maxPerMember === null
      ? savedSocialSettings
      : { ...savedSocialSettings, communities: { maxPerMember } },
  );

const activeOwned = async (userId: string): Promise<number> => {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.communities
     where kind = 'member' and created_by_user_id = ${userId}::uuid
       and status = 'active' and deleted_at is null`;
  return row?.n ?? 0;
};

const communityRow = async (id: string) => {
  const [row] = await adminSql<
    {
      kind: string;
      created_by_user_id: string | null;
      position: number;
      status: string;
      name: string;
      description: string;
    }[]
  >`select kind, created_by_user_id, position, status, name, description
      from public.communities where id = ${id}::uuid`;
  return row;
};

const postsIn = async (
  communityId: string,
): Promise<{ author_user_id: string; visibility: string }[]> =>
  adminSql<{ author_user_id: string; visibility: string }[]>`
    select author_user_id, visibility from public.feed_posts
     where community_id = ${communityId}::uuid and deleted_at is null`;

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  restoreSocial = await withSocialEnabled('lab');
  // The seed leaves `communities` and `stories` OFF on rede-lab; the creator rule needs them on.
  restoreCommunities = await withCommunitiesEnabled('lab');
  restoreStories = await withStoriesEnabled('lab');
  tokens.helena = await signInAs('helena.kuster@rede-lab.local', SEED_PASSWORD);
  tokens.marcos = await signInAs('marcos.vinicius@rede-lab.local', SEED_PASSWORD);
  tokens.alvaro = await signInAs('alvaro.pinheiro@rede-lab.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  tokens.labMember = await signInAs('member@rede-lab.local', SEED_PASSWORD);
  userIds.helena = await userOf('helena.kuster@rede-lab.local');
  userIds.marcos = await userOf('marcos.vinicius@rede-lab.local');
  userIds.alvaro = await userOf('alvaro.pinheiro@rede-lab.local');
  userIds.labAdmin = await userOf('admin@rede-lab.local');
  userIds.labMember = await userOf('member@rede-lab.local');
  const [lab] = await adminSql<
    { id: string }[]
  >`select id from public.tenants where slug = 'rede-lab'`;
  labTenantId = lab?.id ?? '';
  const [social] = await adminSql<{ settings: Record<string, unknown> }[]>`
    select settings from public.tenant_modules
     where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
  savedSocialSettings = social?.settings ?? {};
  const [org] = await adminSql<{ id: string }[]>`
    select id from public.communities
     where tenant_id = ${labTenantId}::uuid and kind = 'organization' and status = 'active'
       and deleted_at is null
     order by name limit 1`;
  orgCommunityId = org?.id ?? '';
  if (!orgCommunityId) throw new Error('rede-lab has no active organization community (seed)');
  await sweep();
});

// One member creates a handful of communities per file run; the per-process ceiling (A6) must not leak
// between cases. The limiter case itself counts to the ceiling inside one test.
beforeEach(() => {
  communityCreateLimiter.reset();
});

afterAll(async () => {
  await sweep();
  await writeSocialSettings(savedSocialSettings);
  await restoreStories();
  await restoreCommunities();
  await restoreSocial();
  await adminSql.end();
  await sqlClient.end();
});

describe('10 tracer', () => {
  const made: { community?: CommunitySummary; post?: FeedPost; videoPostId?: string } = {};

  it('1. MCOMM-01 / D-706: Helena creates a community: 201, stored kind member, creator her id, sentinel position', async () => {
    const res = await createCommunity(tokens.helena, {
      name: `${PREFIX}Corrida de rua`,
      description: 'Treinos e dicas',
    });
    expect(res.status).toBe(201);
    made.community = (await res.json()) as CommunitySummary;
    const row = await communityRow(made.community.id);
    expect(row?.kind).toBe('member');
    expect(row?.created_by_user_id).toBe(userIds.helena);
    expect(row?.position).toBe(1000000);
    expect(row?.status).toBe('active');
  });

  it('2. T-10-15: the body carries neither kind, creator nor position (.strict() answers 400); a plain body is the positive control', async () => {
    for (const extra of [
      { kind: 'organization' },
      { kind: 'member' },
      { createdByUserId: userIds.marcos },
      { position: 0 },
    ]) {
      const res = await createCommunity(tokens.helena, { name: `${PREFIX}forjada`, ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    const [forged] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.communities where name = ${`${PREFIX}forjada`}`;
    expect(forged?.n).toBe(0);
  });

  it('3. MPUB-01 / D-709: Helena publishes in her community: 201, audience community, stored visibility community with the community id', async () => {
    const res = await publish(tokens.helena, {
      caption: `${PREFIX}primeira corrida`,
      communityId: made.community?.id,
    });
    expect(res.status).toBe(201);
    made.post = (await res.json()) as FeedPost;
    expect(made.post.audience).toBe('community');
    expect(made.post.communityId).toBe(made.community?.id);
    const [row] = await adminSql<{ visibility: string; community_id: string | null }[]>`
      select visibility, community_id from public.feed_posts where id = ${made.post.id}::uuid`;
    expect(row?.visibility).toBe('community');
    expect(row?.community_id).toBe(made.community?.id);
  });

  it('4. D-706 / T-10-14: Marcos naming that community answers 403 (positive control: Helena’s post exists), and so does the lab admin; nothing is stored', async () => {
    expect((await postsIn(made.community?.id ?? '')).map((p) => p.author_user_id)).toEqual([
      userIds.helena,
    ]);
    for (const token of [tokens.marcos, tokens.labAdmin]) {
      const res = await publish(token, {
        caption: `${PREFIX}intruso`,
        communityId: made.community?.id,
      });
      expect(res.status).toBe(403);
      expect((await errorOf(res)).code).toBe('FORBIDDEN');
    }
    const after = await postsIn(made.community?.id ?? '');
    expect(after).toHaveLength(1);
    expect(after[0]?.author_user_id).toBe(userIds.helena);
  });

  it('5. D-709: the post is on the community page for Marcos and absent from his Início, Explorar and Reels Todos', async () => {
    const onPage = await feedOf(tokens.marcos, `&communityId=${made.community?.id}`);
    expect(onPage.map((p) => p.id)).toContain(made.post?.id);
    expect(onPage.find((p) => p.id === made.post?.id)?.audience).toBe('community');

    const inicio = await feedOf(tokens.marcos, '');
    expect(inicio.map((p) => p.id)).not.toContain(made.post?.id);
    const explorar = await feedOf(tokens.marcos, '&scope=explorar');
    expect(explorar.map((p) => p.id)).not.toContain(made.post?.id);
    const reels = await feedOf(tokens.marcos, '&media=video');
    expect(reels.map((p) => p.id)).not.toContain(made.post?.id);
  });

  it('6. RESEARCH Pitfall 1: a READY video in the community, by a creator a member FOLLOWS, never reaches Reels Todos, Início or Explorar', async () => {
    // Alvaro follows Helena (seed), so Helena's own `followers` videos would pass his Reels Todos; a
    // `community` video must not, or the creator's community content would leak out of its page.
    const [asset] = await adminSql<{ id: string }[]>`
      insert into public.media_assets
        (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, playback_id,
         mime, bytes, width, height, duration_seconds, aspect_ratio, filename, ready_at)
      values (${labTenantId}::uuid, ${userIds.helena}::uuid, 'video', 'post', 'ready', 'fake',
              ${`fake-${crypto.randomUUID()}`}, ${`pb-${crypto.randomUUID()}`},
              'video/mp4', 1048576, 1080, 1920, 15, '9:16', 'reel-10-05.mp4', now())
      returning id`;
    const [post] = await adminSql<{ id: string }[]>`
      insert into public.feed_posts
        (tenant_id, author_user_id, community_id, caption, visibility, media_kind)
      values (${labTenantId}::uuid, ${userIds.helena}::uuid, ${made.community?.id ?? ''}::uuid,
              ${`${PREFIX}vídeo da comunidade`}, 'community', 'video')
      returning id`;
    made.videoPostId = post?.id;
    await adminSql`
      insert into public.feed_post_media
        (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
      values (${labTenantId}::uuid, ${made.videoPostId ?? ''}::uuid, 'video', ${asset?.id ?? ''}::uuid, 'video', 0)`;

    for (const query of ['&media=video', '', '&scope=explorar']) {
      const items = await feedOf(tokens.alvaro, query);
      expect(
        items.map((p) => p.id),
        `alvaro ${query}`,
      ).not.toContain(made.videoPostId);
    }
    // Positive control: the same video IS on the community page, for the follower and for the stranger.
    for (const token of [tokens.alvaro, tokens.marcos]) {
      const onPage = await feedOf(token, `&communityId=${made.community?.id}&media=video`);
      expect(onPage.map((p) => p.id)).toContain(made.videoPostId);
    }
  });

  it('7. Escopo seam (no behaviour change): Marcos naming an ORGANIZATION community is 403 with no post stored; the admin posts there (201, no audience key, the organization voice)', async () => {
    const before = await postsIn(orgCommunityId);
    const refused = await publish(tokens.marcos, {
      caption: `${PREFIX}na comunidade da organização`,
      communityId: orgCommunityId,
    });
    expect(refused.status).toBe(403);
    expect((await errorOf(refused)).code).toBe('FORBIDDEN');
    expect(await postsIn(orgCommunityId)).toHaveLength(before.length);

    const ok = await publish(tokens.labAdmin, {
      caption: `${PREFIX}aviso da organização`,
      communityId: orgCommunityId,
    });
    expect(ok.status).toBe(201);
    const post = (await ok.json()) as FeedPost;
    expect(post).not.toHaveProperty('audience');
    const [row] = await adminSql<{ visibility: string }[]>`
      select visibility from public.feed_posts where id = ${post.id}::uuid`;
    expect(row?.visibility).toBe('tenant');
  });

  it('8. Escopo seam: app.community_action_allowed answers false for the five actions on a member and on an organization community', async () => {
    for (const communityId of [made.community?.id ?? '', orgCommunityId]) {
      for (const action of ['like', 'comment', 'share', 'post', 'story']) {
        const [row] = await adminSql<{ allowed: boolean | null }[]>`
          select app.community_action_allowed(${communityId}::uuid, ${action}) as allowed`;
        expect(row?.allowed, `${action} on ${communityId}`).toBe(false);
      }
    }
  });
});

describe('10 create rules', () => {
  const made: string[] = [];

  // The default allowance is 3 active communities per member: each case starts from none.
  beforeEach(async () => {
    await sweep();
  });

  it('EP-01 boundary: a name of exactly 80 and a description of exactly 280 are accepted; 81 and 281 answer 400', async () => {
    const name = 'á'.repeat(COMMUNITY_MAX_NAME);
    const description = 'ç'.repeat(COMMUNITY_MAX_DESCRIPTION);
    const ok = await createCommunity(tokens.helena, { name, description });
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as CommunitySummary;
    made.push(body.id);
    expect(body.name).toBe(name);
    expect(body.description).toBe(description);
    expect((await createCommunity(tokens.helena, { name: `${name}a` })).status).toBe(400);
    expect(
      (await createCommunity(tokens.helena, { name: 'x', description: `${description}a` })).status,
    ).toBe(400);
  });

  it('EP-02 empty: an empty or whitespace-only name is 400 name_required; an omitted description and cover are accepted', async () => {
    for (const name of ['', '   ']) {
      const res = await createCommunity(tokens.helena, { name });
      expect(res.status, JSON.stringify(name)).toBe(400);
      expect((await errorOf(res)).details?.community).toBe('name_required');
    }
    const ok = await createCommunity(tokens.helena, { name: `${PREFIX}sem descrição` });
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as CommunitySummary;
    made.push(body.id);
    expect(body.description).toBe('');
    expect(body.coverAssetId).toBeNull();
  });

  it('EP-03 encoding: accents, an emoji and a combining sequence are stored and returned byte for byte', async () => {
    const name = `${PREFIX}Café ☕ é 🎉`;
    const res = await createCommunity(tokens.helena, { name, description: 'ação — 🎉 é' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as CommunitySummary;
    made.push(body.id);
    expect(body.name).toBe(name);
    const row = await communityRow(body.id);
    expect(row?.name).toBe(name);
    expect(row?.description).toBe('ação — 🎉 é');
  });

  it('EP-39 ordering: after the community is archived the creator is told archived (400); a non-owner is 403 before that; an unknown id is 404', async () => {
    const res = await createCommunity(tokens.helena, { name: `${PREFIX}arquivável` });
    expect(res.status).toBe(201);
    const community = (await res.json()) as CommunitySummary;
    made.push(community.id);

    // Positive control first: the owner posts while it is active.
    const before = await publish(tokens.helena, {
      caption: `${PREFIX}antes do arquivo`,
      communityId: community.id,
    });
    expect(before.status).toBe(201);

    // A moderator archives it.
    const archived = await request(
      `/v1/communities/${community.id}`,
      tokens.labAdmin,
      patch({ status: 'archived' }),
    );
    expect(archived.status).toBe(200);

    const owner = await publish(tokens.helena, {
      caption: `${PREFIX}depois do arquivo`,
      communityId: community.id,
    });
    expect(owner.status).toBe(400);
    expect((await errorOf(owner)).details?.community).toBe('archived');
    // A non-owner learns nothing from the archive: 403 comes first.
    const stranger = await publish(tokens.marcos, {
      caption: `${PREFIX}intruso depois do arquivo`,
      communityId: community.id,
    });
    expect(stranger.status).toBe(403);
    const unknown = await publish(tokens.helena, {
      caption: `${PREFIX}fantasma`,
      communityId: crypto.randomUUID(),
    });
    expect(unknown.status).toBe(404);
    // No post landed after the archive committed.
    expect(await postsIn(community.id)).toHaveLength(1);
  });

  it('EP-43 empty: a creator’s post with no text and no media is 400 as any post is', async () => {
    const res = await createCommunity(tokens.helena, { name: `${PREFIX}vazia` });
    const community = (await res.json()) as CommunitySummary;
    made.push(community.id);
    const empty = await publish(tokens.helena, { caption: '', communityId: community.id });
    expect(empty.status).toBe(400);
    expect(await postsIn(community.id)).toHaveLength(0);
  });
});

describe('10 social switched off while the flags cache is warm (EP-41, T-10-18)', () => {
  beforeEach(async () => {
    await sweep();
  });

  it('a member’s community insert and post insert are refused by RLS and answer 403, never 500; an admin’s organization write is unaffected', async () => {
    const own = await createCommunity(tokens.helena, { name: `${PREFIX}antes de desligar` });
    expect(own.status).toBe(201);
    const community = (await own.json()) as CommunitySummary;
    // Warm the flags cache on this instance, then turn `social` off in SQL WITHOUT invalidating it.
    expect((await request('/v1/communities', tokens.helena)).status).toBe(200);
    await adminSql`
      update public.tenant_modules set enabled = false
       where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
    try {
      const create = await createCommunity(tokens.helena, {
        name: `${PREFIX}com social desligado`,
      });
      expect(create.status).toBe(403);
      const post = await publish(tokens.helena, {
        caption: `${PREFIX}com social desligado`,
        communityId: community.id,
      });
      expect(post.status).toBe(403);
      const admin = await publish(tokens.labAdmin, {
        caption: `${PREFIX}admin com social desligado`,
        communityId: orgCommunityId,
      });
      expect(admin.status).toBe(201);
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = true
         where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
      moduleFlags.invalidate(labTenantId);
    }
  });
});

describe('10 limit', () => {
  const limitOf = async (res: Response) => (await errorOf(res)).details?.community;

  beforeEach(async () => {
    await sweep();
  });

  it('EP-15 boundary: with the limit N the Nth active community is created and the (N+1)th is refused limit_reached; with N = 0 the first is refused', async () => {
    await setLimit(2);
    expect((await createCommunity(tokens.helena, { name: `${PREFIX}um` })).status).toBe(201);
    expect((await createCommunity(tokens.helena, { name: `${PREFIX}dois` })).status).toBe(201);
    const third = await createCommunity(tokens.helena, { name: `${PREFIX}três` });
    expect(third.status).toBe(400);
    expect(await limitOf(third)).toBe('limit_reached');
    expect(await activeOwned(userIds.helena)).toBe(2);

    await sweep();
    await setLimit(0);
    const first = await createCommunity(tokens.helena, { name: `${PREFIX}primeira` });
    expect(first.status).toBe(400);
    expect(await limitOf(first)).toBe('limit_reached');
    expect(await activeOwned(userIds.helena)).toBe(0);
  });

  it('EP-16 adjacency: archiving one frees a slot, reactivating one at the limit is refused, deleting an archived one changes no count', async () => {
    await setLimit(2);
    const ids: string[] = [];
    for (const name of ['a', 'b']) {
      const res = await createCommunity(tokens.helena, { name: `${PREFIX}${name}` });
      expect(res.status).toBe(201);
      ids.push(((await res.json()) as CommunitySummary).id);
    }
    // At the limit: a third is refused (positive control for what follows).
    expect((await createCommunity(tokens.helena, { name: `${PREFIX}c` })).status).toBe(400);
    // A moderator archives the first: the creator's slot is free again.
    const archive = await request(
      `/v1/communities/${ids[0]}`,
      tokens.labAdmin,
      patch({ status: 'archived' }),
    );
    expect(archive.status).toBe(200);
    expect(await activeOwned(userIds.helena)).toBe(1);
    const third = await createCommunity(tokens.helena, { name: `${PREFIX}c` });
    expect(third.status).toBe(201);
    ids.push(((await third.json()) as CommunitySummary).id);
    // Now at the limit again: reactivating the archived one is refused by the SAME check.
    const reactivate = await request(
      `/v1/communities/${ids[0]}`,
      tokens.labAdmin,
      patch({ status: 'active' }),
    );
    expect(reactivate.status).toBe(400);
    expect(await limitOf(reactivate)).toBe('limit_reached');
    expect((await communityRow(ids[0] ?? ''))?.status).toBe('archived');
    // Deleting the archived community changes no active count.
    const before = await activeOwned(userIds.helena);
    const del = await request(`/v1/communities/${ids[0]}`, tokens.labAdmin, { method: 'DELETE' });
    expect(del.status).toBe(204);
    expect(await activeOwned(userIds.helena)).toBe(before);
  });

  it('EP-17 empty: a member with no community creates under a limit of 3; a settings blob with no communities key behaves as 3', async () => {
    await setLimit(null);
    const [stored] = await adminSql<{ has: boolean }[]>`
      select (settings ? 'communities') as has from public.tenant_modules
       where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
    expect(stored?.has).toBe(false);
    for (const name of ['a', 'b', 'c']) {
      expect((await createCommunity(tokens.helena, { name: `${PREFIX}${name}` })).status).toBe(201);
    }
    const fourth = await createCommunity(tokens.helena, { name: `${PREFIX}d` });
    expect(fourth.status).toBe(400);
    expect(await limitOf(fourth)).toBe('limit_reached');
  });

  it('EP-18 ordering: other members’ and the admin’s communities never count; N+1 parallel creates leave exactly N rows', async () => {
    await setLimit(2);
    // Marcos owns one and the admin owns an organization community (the seed's): neither counts for Helena.
    expect((await createCommunity(tokens.marcos, { name: `${PREFIX}do Marcos` })).status).toBe(201);
    const org = await createCommunity(tokens.labAdmin, { name: `${PREFIX}da organização` });
    expect(org.status).toBe(201);
    const results = await Promise.all(
      [1, 2, 3].map((n) => createCommunity(tokens.helena, { name: `${PREFIX}paralela ${n}` })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(await activeOwned(userIds.helena)).toBe(2);
    expect(await activeOwned(userIds.marcos)).toBe(1);
  });

  it('EP-20 idempotency: the same body twice makes two communities with distinct slugs, and each counts toward the limit', async () => {
    await setLimit(3);
    const body = { name: `${PREFIX}repetida` };
    const first = (await (await createCommunity(tokens.helena, body)).json()) as CommunitySummary;
    const second = (await (await createCommunity(tokens.helena, body)).json()) as CommunitySummary;
    expect(first.id).not.toBe(second.id);
    expect(first.slug).not.toBe(second.slug);
    expect(await activeOwned(userIds.helena)).toBe(2);
  });

  it('EP-21 concurrency: N+1 parallel creates by one member give N successes and one limit_reached; two members do not block each other', async () => {
    await setLimit(2);
    const burst = await Promise.all(
      [1, 2, 3].map((n) => createCommunity(tokens.helena, { name: `${PREFIX}rajada ${n}` })),
    );
    const ok = burst.filter((r) => r.status === 201);
    const refused = burst.filter((r) => r.status === 400);
    expect(ok).toHaveLength(2);
    expect(refused).toHaveLength(1);
    for (const res of refused) expect(await limitOf(res)).toBe('limit_reached');

    // Two different members in parallel: both succeed (the lock is per member).
    await sweep();
    const [a, b] = await Promise.all([
      createCommunity(tokens.helena, { name: `${PREFIX}helena paralela` }),
      createCommunity(tokens.marcos, { name: `${PREFIX}marcos paralela` }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });

  it('A6: the 11th creation attempt of one member inside an hour answers 429 RATE_LIMITED; another member is unaffected', async () => {
    await setLimit(20);
    for (let i = 1; i <= 10; i += 1) {
      const res = await createCommunity(tokens.helena, { name: `${PREFIX}ritmo ${i}` });
      expect(res.status, `attempt ${i}`).toBe(201);
    }
    const eleventh = await createCommunity(tokens.helena, { name: `${PREFIX}ritmo 11` });
    expect(eleventh.status).toBe(429);
    expect((await errorOf(eleventh)).code).toBe('RATE_LIMITED');
    expect(
      (await createCommunity(tokens.marcos, { name: `${PREFIX}ritmo do Marcos` })).status,
    ).toBe(201);
  });

  it('an admin is never limited and never counted: organization creates skip the check', async () => {
    await setLimit(0);
    for (const name of ['x', 'y']) {
      expect((await createCommunity(tokens.labAdmin, { name: `${PREFIX}${name}` })).status).toBe(
        201,
      );
    }
  });
});

describe('10 lifecycle', () => {
  const idOf = async (res: Response): Promise<string> =>
    ((await res.json()) as CommunitySummary).id;

  beforeEach(async () => {
    await sweep();
    await writeSocialSettings(savedSocialSettings);
  });

  const archivedList = async (token: string): Promise<CommunitySummary[]> => {
    const res = await request('/v1/communities?status=archived&limit=25', token);
    expect(res.status).toBe(200);
    return ((await res.json()) as { items: CommunitySummary[] }).items;
  };

  it('D-713: the creator edits, archives, reactivates and deletes an ARCHIVED community; each answer is the positive control of the refusals below', async () => {
    const id = await idOf(await createCommunity(tokens.helena, { name: `${PREFIX}ciclo` }));
    const edit = await request(
      `/v1/communities/${id}`,
      tokens.helena,
      patch({ name: `${PREFIX}ciclo editado`, description: 'novo texto' }),
    );
    expect(edit.status).toBe(200);
    expect(((await edit.json()) as CommunitySummary).name).toBe(`${PREFIX}ciclo editado`);

    // Only an archived community can be deleted: an active one is the existing 409.
    const early = await request(`/v1/communities/${id}`, tokens.helena, { method: 'DELETE' });
    expect(early.status).toBe(409);
    expect((await errorOf(early)).details?.community).toBe('not_archived');

    const archive = await request(
      `/v1/communities/${id}`,
      tokens.helena,
      patch({ status: 'archived' }),
    );
    expect(archive.status).toBe(200);
    expect((await communityRow(id))?.status).toBe('archived');
    const reactivate = await request(
      `/v1/communities/${id}`,
      tokens.helena,
      patch({ status: 'active' }),
    );
    expect(reactivate.status).toBe(200);
    expect((await communityRow(id))?.status).toBe('active');

    expect(
      (await request(`/v1/communities/${id}`, tokens.helena, patch({ status: 'archived' }))).status,
    ).toBe(200);
    const del = await request(`/v1/communities/${id}`, tokens.helena, { method: 'DELETE' });
    expect(del.status).toBe(204);
    // The row is soft-deleted: a second delete is the bare 404.
    const again = await request(`/v1/communities/${id}`, tokens.helena, { method: 'DELETE' });
    expect(again.status).toBe(404);
    expect((await errorOf(again)).details).toBeUndefined();
  });

  it('D-706 / T-10-14: another member’s PATCH, status change and DELETE on the same id answer 403; an unknown id is 404; an organization community is 403 for a member', async () => {
    const id = await idOf(await createCommunity(tokens.helena, { name: `${PREFIX}alheia` }));
    // Archived first (by its creator), so the DELETE below is judged on ownership, not on status.
    expect(
      (await request(`/v1/communities/${id}`, tokens.helena, patch({ status: 'archived' }))).status,
    ).toBe(200);
    for (const [label, init] of [
      ['edit', patch({ name: `${PREFIX}sequestrada` })],
      ['reactivate', patch({ status: 'active' })],
      ['delete', { method: 'DELETE' }],
    ] as const) {
      const res = await request(`/v1/communities/${id}`, tokens.marcos, init);
      expect(res.status, label).toBe(403);
      expect((await errorOf(res)).code, label).toBe('FORBIDDEN');
    }
    const row = await communityRow(id);
    expect(row?.status).toBe('archived');
    expect(row?.name).toBe(`${PREFIX}alheia`);

    const unknown = await request(
      `/v1/communities/${crypto.randomUUID()}`,
      tokens.helena,
      patch({ name: 'x' }),
    );
    expect(unknown.status).toBe(404);
    const unknownDelete = await request(`/v1/communities/${crypto.randomUUID()}`, tokens.marcos, {
      method: 'DELETE',
    });
    expect(unknownDelete.status).toBe(404);

    for (const init of [patch({ name: `${PREFIX}org` }), { method: 'DELETE' }] as RequestInit[]) {
      const res = await request(`/v1/communities/${orgCommunityId}`, tokens.helena, init);
      expect(res.status).toBe(403);
    }
    // The admin keeps every right: an edit of the member community is allowed.
    expect(
      (await request(`/v1/communities/${id}`, tokens.labAdmin, patch({ description: 'moderada' })))
        .status,
    ).toBe(200);
  });

  it('D-713 / D-89: the creator’s archived list holds only their own archived rows; the admin’s holds every one', async () => {
    const mine = await idOf(
      await createCommunity(tokens.helena, { name: `${PREFIX}minha arquivada` }),
    );
    const theirs = await idOf(
      await createCommunity(tokens.marcos, { name: `${PREFIX}dele arquivada` }),
    );
    const active = await idOf(
      await createCommunity(tokens.helena, { name: `${PREFIX}minha ativa` }),
    );
    for (const [token, id] of [
      [tokens.helena, mine],
      [tokens.marcos, theirs],
    ] as const) {
      expect(
        (await request(`/v1/communities/${id}`, token, patch({ status: 'archived' }))).status,
      ).toBe(200);
    }
    const helena = (await archivedList(tokens.helena)).map((c) => c.id);
    expect(helena).toContain(mine);
    expect(helena).not.toContain(theirs);
    expect(helena).not.toContain(active);
    const marcos = (await archivedList(tokens.marcos)).map((c) => c.id);
    expect(marcos).toContain(theirs);
    expect(marcos).not.toContain(mine);
    const admin = (await archivedList(tokens.labAdmin)).map((c) => c.id);
    expect(admin).toEqual(expect.arrayContaining([mine, theirs]));
    // A member who is not a creator of anything holds manage_own too: an empty list, never a 403.
    expect(await archivedList(tokens.labMember)).toEqual([]);
  });

  it('D-713: a member body carrying productIds is 400 (the product link stays behind store.product.manage)', async () => {
    const id = await idOf(await createCommunity(tokens.helena, { name: `${PREFIX}produtos` }));
    const res = await request(
      `/v1/communities/${id}`,
      tokens.helena,
      patch({ productIds: [crypto.randomUUID()] }),
    );
    expect(res.status).toBe(400);
    const create = await createCommunity(tokens.helena, {
      name: `${PREFIX}produtos 2`,
      productIds: [],
    });
    expect(create.status).toBe(400);
  });

  it('EP-22: an empty JSON object changes nothing and writes nothing (observably inert, as today); a request with no body is 400', async () => {
    const id = await idOf(await createCommunity(tokens.helena, { name: `${PREFIX}vazio` }));
    const before = await communityRow(id);
    const empty = await request(`/v1/communities/${id}`, tokens.helena, patch({}));
    expect(empty.status).toBe(200);
    expect(await communityRow(id)).toEqual(before);
    const noBody = await request(`/v1/communities/${id}`, tokens.helena, { method: 'PATCH' });
    expect(noBody.status).toBe(400);
    const blank = await request(`/v1/communities/${id}`, tokens.helena, patch({ name: '   ' }));
    expect(blank.status).toBe(400);
    expect((await errorOf(blank)).details?.community).toBe('name_required');
  });

  it('EP-23 encoding: editing name or description with accents and emoji round-trips verbatim', async () => {
    const id = await idOf(await createCommunity(tokens.helena, { name: `${PREFIX}codificação` }));
    const name = `${PREFIX}Café ☕ e\u0301 🎉`;
    const description = 'ação — 🎉 e\u0301 ñ';
    const res = await request(`/v1/communities/${id}`, tokens.helena, patch({ name, description }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as CommunitySummary;
    expect(body.name).toBe(name);
    expect(body.description).toBe(description);
    const stored = await communityRow(id);
    expect(stored?.name).toBe(name);
    expect(stored?.description).toBe(description);
  });

  it('D-711: the creator is never notified by their own lifecycle (zero notification rows about the community)', async () => {
    const id = await idOf(await createCommunity(tokens.helena, { name: `${PREFIX}silenciosa` }));
    expect(
      (await request(`/v1/communities/${id}`, tokens.helena, patch({ status: 'archived' }))).status,
    ).toBe(200);
    expect(
      (await request(`/v1/communities/${id}`, tokens.helena, { method: 'DELETE' })).status,
    ).toBe(204);
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.notifications
       where tenant_id = ${labTenantId}::uuid and subject_id = ${id}::uuid`;
    expect(row?.n).toBe(0);
  });
});
