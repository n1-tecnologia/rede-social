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
const tokens = { helena: '', marcos: '', alvaro: '', labAdmin: '', labMember: '', support: '' };
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
  tokens.support = await signInAs('support@rede-lab.local', SEED_PASSWORD);
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
    // A JSON request with no body at all is the malformed-JSON 400 of the validator.
    const noBody = await api.request(`/v1/communities/${id}`, {
      method: 'PATCH',
      headers: {
        'x-tenant-host': HOSTS.lab,
        authorization: `Bearer ${tokens.helena}`,
        'content-type': 'application/json',
      },
    });
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

/**
 * 10-06 (D-701, D-702, D-703, D-712; MCOMM-02, MCOMM-03, MCOMM-04, MCOMM-08 and the Escopo seam
 * `viewer.actions`): the READ side of the creator rule. Helena is the creator; Marcos, Alvaro (who follows
 * Helena in the seed) and the lab member are other members; the lab admin is the organization's voice and
 * the moderator; `support@rede-lab.local` is a real `support_tenant` session.
 */
describe('10 reads', () => {
  type Item = CommunitySummary & {
    kind: 'organization' | 'member';
    createdBy: { membershipId: string; displayName: string; avatarAssetId: string | null } | null;
    viewer: {
      isOwner: boolean;
      canPublish: boolean;
      canEdit: boolean;
      canCurate: boolean;
      actions: Record<string, boolean>;
    };
  };
  type Page = {
    items: Item[];
    nextCursor: string | null;
    memberQuota: { ownedActive: number; limit: number } | null;
  };

  const listOf = async (token: string, query = '?limit=25'): Promise<Page> => {
    const res = await request(`/v1/communities${query}`, token);
    expect(res.status, `GET /v1/communities${query}`).toBe(200);
    return (await res.json()) as Page;
  };

  const detailOf = async (token: string, id: string): Promise<Item> => {
    const res = await request(`/v1/communities/${id}`, token);
    expect(res.status, `GET /v1/communities/${id}`).toBe(200);
    return (await res.json()) as Item;
  };

  /** Every page of a feed read, to its end (bounded). */
  const walkFeed = async (token: string, query: string): Promise<FeedPost[]> => {
    const seen: FeedPost[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 200; guard += 1) {
      const suffix: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const res = await request(`/v1/feed?limit=25${query}${suffix}`, token);
      expect(res.status, `GET /v1/feed?limit=25${query}`).toBe(200);
      const page = (await res.json()) as FeedPage;
      seen.push(...page.items);
      cursor = page.nextCursor;
      if (cursor === null) return seen;
    }
    throw new Error('feed walk did not end');
  };

  /** Every page of the community list, `limit` at a time, to its end (bounded). */
  const walkCommunities = async (token: string, limit: number): Promise<Item[]> => {
    const seen: Item[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 200; guard += 1) {
      const suffix: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const page = await listOf(token, `?limit=${limit}${suffix}`);
      seen.push(...page.items);
      cursor = page.nextCursor;
      if (cursor === null) return seen;
    }
    throw new Error('community walk did not end');
  };

  const idOf = async (res: Response): Promise<string> =>
    ((await res.json()) as CommunitySummary).id;

  /** A ready community video post of Helena's, audience `community` (the `fake` provider posture of the tracer). */
  async function seedCommunityVideo(communityId: string): Promise<string> {
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
      values (${labTenantId}::uuid, ${userIds.helena}::uuid, ${communityId}::uuid,
              ${`${PREFIX}vídeo de leitura`}, 'community', 'video')
      returning id`;
    await adminSql`
      insert into public.feed_post_media
        (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
      values (${labTenantId}::uuid, ${post?.id ?? ''}::uuid, 'video', ${asset?.id ?? ''}::uuid, 'video', 0)`;
    return post?.id ?? '';
  }

  const expectedLimit = (): number => {
    const communities = savedSocialSettings.communities as { maxPerMember?: number } | undefined;
    return communities?.maxPerMember ?? 3;
  };

  const ACTION_KEYS = ['comment', 'like', 'post', 'share', 'story'];

  /** The Escopo assertion for ONE item: five keys exactly, post and story = canPublish, the rest true. */
  const expectActions = (item: Item, label: string): void => {
    expect(Object.keys(item.viewer.actions).sort(), label).toEqual(ACTION_KEYS);
    expect(item.viewer.actions.post, `${label} post`).toBe(item.viewer.canPublish);
    expect(item.viewer.actions.story, `${label} story`).toBe(item.viewer.canPublish);
    for (const key of ['like', 'comment', 'share']) {
      expect(item.viewer.actions[key], `${label} ${key}`).toBe(true);
    }
  };

  beforeEach(async () => {
    await sweep();
    await writeSocialSettings(savedSocialSettings);
  });

  it('1. tracer D-701 / D-702 / D-703: organization communities first in the admin order, then Helena’s with her safe label; no user id anywhere; every live member opens it; its post lives on its page only', async () => {
    const helenaCommunity = await idOf(
      await createCommunity(tokens.helena, { name: `${PREFIX}Leitura 1` }),
    );
    const post = (await (
      await publish(tokens.helena, { caption: `${PREFIX}na página`, communityId: helenaCommunity })
    ).json()) as FeedPost;
    const videoPostId = await seedCommunityVideo(helenaCommunity);

    const body = await request('/v1/communities?limit=25', tokens.marcos);
    expect(body.status).toBe(200);
    const text = await body.text();
    const page = JSON.parse(text) as Page;

    // The order: organization items first (in the position order the statement gives), then the member one.
    const kinds = page.items.map((item) => item.kind);
    const firstMember = kinds.indexOf('member');
    expect(firstMember).toBeGreaterThan(0);
    expect(kinds.slice(0, firstMember).every((kind) => kind === 'organization')).toBe(true);
    expect(kinds.slice(firstMember).every((kind) => kind === 'member')).toBe(true);
    const organizationIds = page.items.slice(0, firstMember).map((item) => item.id);
    const expectedOrg = await adminSql<{ id: string }[]>`
      select id from public.communities
       where tenant_id = ${labTenantId}::uuid and kind = 'organization' and status = 'active'
         and deleted_at is null
       order by position asc, last_activity_at desc, id desc`;
    expect(organizationIds).toEqual(expectedOrg.map((row) => row.id));
    expect(page.items.at(-1)?.id).toBe(helenaCommunity);

    // The projection: an organization entry has no creator at all, the member entry exactly three keys.
    for (const item of page.items.slice(0, firstMember)) {
      expect(item.createdBy, item.id).toBeNull();
    }
    const entry = page.items.find((item) => item.id === helenaCommunity);
    const [helenaMembership] = await adminSql<{ id: string; display_name: string }[]>`
      select m.id, p.display_name from public.memberships m
        join public.member_profiles p on p.membership_id = m.id
       where m.tenant_id = ${labTenantId}::uuid and m.user_id = ${userIds.helena}::uuid`;
    expect(entry?.createdBy && Object.keys(entry.createdBy).sort()).toEqual([
      'avatarAssetId',
      'displayName',
      'membershipId',
    ]);
    expect(entry?.createdBy?.membershipId).toBe(helenaMembership?.id);
    expect(entry?.createdBy?.displayName).toBe(helenaMembership?.display_name);
    // D-703: not one user id of any member appears anywhere in the response.
    for (const [who, id] of Object.entries(userIds)) {
      expect(text.includes(id), `${who}'s user id in the list`).toBe(false);
    }

    // The page keys: only `memberQuota` is new (EP-06).
    expect(Object.keys(page).sort()).toEqual(['items', 'memberQuota', 'nextCursor']);

    // The detail opens for EVERY live member exactly like an organization one (no lock screen).
    for (const token of [
      tokens.marcos,
      tokens.alvaro,
      tokens.labMember,
      tokens.helena,
      tokens.support,
      tokens.labAdmin,
    ]) {
      const res = await request(`/v1/communities/${helenaCommunity}`, token);
      expect(res.status).toBe(200);
      const raw = await res.text();
      for (const id of Object.values(userIds)) expect(raw.includes(id)).toBe(false);
      const detail = JSON.parse(raw) as Item;
      expect(detail.kind).toBe('member');
      expect(detail.createdBy?.membershipId).toBe(helenaMembership?.id);
    }

    // D-702: her posts are on her page (positive control, for the follower too) and in NONE of the
    // three merged reads, for a follower of the creator, the creator and the moderator.
    for (const token of [tokens.alvaro, tokens.marcos]) {
      const onPage = await walkFeed(token, `&communityId=${helenaCommunity}`);
      expect(onPage.map((item) => item.id)).toContain(post.id);
    }
    for (const [who, token] of [
      ['alvaro (follows the creator)', tokens.alvaro],
      ['helena (the creator)', tokens.helena],
      ['admin (the moderator)', tokens.labAdmin],
    ] as const) {
      for (const query of ['', '&scope=explorar', '&media=video']) {
        const ids = (await walkFeed(token, query)).map((item) => item.id);
        expect(ids, `${who} ${query}`).not.toContain(post.id);
        expect(ids, `${who} ${query}`).not.toContain(videoPostId);
      }
    }
  });

  it('2. the quota: memberQuota is { ownedActive, limit } for a caller who can create and null for the admin and a support session; the creator’s count moves with the create', async () => {
    const before = await listOf(tokens.helena);
    expect(before.memberQuota).toEqual({ ownedActive: 0, limit: expectedLimit() });
    await createCommunity(tokens.helena, { name: `${PREFIX}Cota 1` });
    await createCommunity(tokens.helena, { name: `${PREFIX}Cota 2` });
    expect((await listOf(tokens.helena)).memberQuota).toEqual({
      ownedActive: 2,
      limit: expectedLimit(),
    });
    // Another member's count is their own.
    expect((await listOf(tokens.marcos)).memberQuota).toEqual({
      ownedActive: 0,
      limit: expectedLimit(),
    });
    expect((await listOf(tokens.labAdmin)).memberQuota).toBeNull();
    expect((await listOf(tokens.support)).memberQuota).toBeNull();
    // The archived list of the manager carries the same key.
    expect((await listOf(tokens.labAdmin, '?status=archived&limit=25')).memberQuota).toBeNull();
  });

  it('3. Escopo seam: viewer.actions is five booleans on the list item and on the detail, post and story equal canPublish, like, comment and share are true, for every kind of viewer', async () => {
    const mine = await idOf(await createCommunity(tokens.helena, { name: `${PREFIX}Escopo` }));
    const expected: Record<
      string,
      { member: [boolean, boolean, boolean, boolean]; org: [boolean, boolean, boolean, boolean] }
    > = {
      // [isOwner, canPublish, canEdit, canCurate]
      helena: { member: [true, true, true, true], org: [false, false, false, false] },
      marcos: { member: [false, false, false, false], org: [false, false, false, false] },
      labAdmin: { member: [false, false, true, false], org: [false, true, true, true] },
      support: { member: [false, false, false, false], org: [false, false, false, false] },
    };
    for (const [who, want] of Object.entries(expected)) {
      const token = tokens[who as keyof typeof tokens];
      const list = await listOf(token);
      for (const [label, id, flags] of [
        ['member', mine, want.member],
        ['org', orgCommunityId, want.org],
      ] as const) {
        const item = list.items.find((candidate) => candidate.id === id);
        const detail = await detailOf(token, id);
        for (const [source, view] of [
          ['list', item],
          ['detail', detail],
        ] as const) {
          expect(view, `${who} ${label} ${source} present`).toBeDefined();
          if (!view) continue;
          expect(
            [
              view.viewer.isOwner,
              view.viewer.canPublish,
              view.viewer.canEdit,
              view.viewer.canCurate,
            ],
            `${who} ${label} ${source} flags`,
          ).toEqual(flags);
          expectActions(view, `${who} ${label} ${source}`);
        }
      }
    }
  });

  it('EP-05 adjacency: a member community and an organization community with exactly equal last_activity_at list organization first', async () => {
    const orgRes = await createCommunity(tokens.labAdmin, { name: `${PREFIX}Org empate` });
    expect(orgRes.status).toBe(201);
    const org = await idOf(orgRes);
    const member = await idOf(
      await createCommunity(tokens.helena, { name: `${PREFIX}Membro empate` }),
    );
    await adminSql`
      update public.communities set last_activity_at = '2026-11-11T12:00:00.123456Z'
       where id = any (${[org, member]}::uuid[])`;
    const ids = (await listOf(tokens.marcos)).items.map((item) => item.id);
    expect(ids.indexOf(org), ids.join(',')).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(org)).toBeLessThan(ids.indexOf(member));
  });

  it('EP-06 empty: a tenant with no member community lists exactly the organization order of today, every creator null', async () => {
    const page = await listOf(tokens.marcos);
    const stored = await adminSql<{ id: string }[]>`
      select id from public.communities
       where tenant_id = ${labTenantId}::uuid and status = 'active' and deleted_at is null
       order by position asc, last_activity_at desc, id desc`;
    expect(page.items.map((item) => item.id)).toEqual(stored.map((row) => row.id));
    expect(
      page.items.every((item) => item.kind === 'organization' && item.createdBy === null),
    ).toBe(true);
    expect(Object.keys(page).sort()).toEqual(['items', 'memberQuota', 'nextCursor']);
  });

  it('EP-07 encoding: a creator display name with accents and an emoji is projected verbatim', async () => {
    const [original] = await adminSql<{ display_name: string }[]>`
      select p.display_name from public.member_profiles p
        join public.memberships m on m.id = p.membership_id
       where m.tenant_id = ${labTenantId}::uuid and m.user_id = ${userIds.helena}::uuid`;
    const fancy = 'Hélèna Küster 🏃‍♀️ São João';
    try {
      await adminSql`
        update public.member_profiles set display_name = ${fancy}
         where membership_id = (select id from public.memberships
                                 where tenant_id = ${labTenantId}::uuid and user_id = ${userIds.helena}::uuid)`;
      const id = await idOf(await createCommunity(tokens.helena, { name: `${PREFIX}Acentos` }));
      expect((await detailOf(tokens.marcos, id)).createdBy?.displayName).toBe(fancy);
      const listed = (await listOf(tokens.marcos)).items.find((item) => item.id === id);
      expect(listed?.createdBy?.displayName).toBe(fancy);
    } finally {
      await adminSql`
        update public.member_profiles set display_name = ${original?.display_name ?? ''}
         where membership_id = (select id from public.memberships
                                 where tenant_id = ${labTenantId}::uuid and user_id = ${userIds.helena}::uuid)`;
    }
  });

  it('EP-08 ordering: equal-activity member communities order by id desc and a limit=1 walk visits each exactly once', async () => {
    const ids = [
      await idOf(await createCommunity(tokens.helena, { name: `${PREFIX}Empate A` })),
      await idOf(await createCommunity(tokens.helena, { name: `${PREFIX}Empate B` })),
      await idOf(await createCommunity(tokens.marcos, { name: `${PREFIX}Empate C` })),
    ];
    await adminSql`
      update public.communities set last_activity_at = '2026-11-11T12:00:00.654321Z'
       where id = any (${ids}::uuid[])`;
    const walked = await walkCommunities(tokens.alvaro, 1);
    const seen = walked.map((item) => item.id);
    expect(new Set(seen).size, 'no repeat').toBe(seen.length);
    const members = walked.filter((item) => item.kind === 'member').map((item) => item.id);
    expect(members).toEqual([...ids].sort().reverse());
    // The whole walk equals one wide read.
    expect(seen).toEqual((await listOf(tokens.alvaro, '?limit=25')).items.map((item) => item.id));
  });

  it('EP-09 idempotency: reading the list and a community twice changes no stored value', async () => {
    const id = await idOf(
      await createCommunity(tokens.helena, { name: `${PREFIX}Leitura idempotente` }),
    );
    await publish(tokens.helena, { caption: `${PREFIX}um`, communityId: id });
    const snapshot = async () =>
      adminSql<{ id: string; post_count: number; last_activity_at: string; updated_at: string }[]>`
        select id, post_count, last_activity_at::text, updated_at::text
          from public.communities where tenant_id = ${labTenantId}::uuid order by id`;
    const before = await snapshot();
    for (let round = 0; round < 2; round += 1) {
      await listOf(tokens.marcos);
      await detailOf(tokens.marcos, id);
    }
    expect(await snapshot()).toEqual(before);
  });

  it('EP-12 empty: a tenant with zero organization communities and one member community lists that one item and its quota', async () => {
    const lab = await adminSql<{ id: string; updated_at: string }[]>`
      select id, updated_at::text from public.communities
       where tenant_id = ${labTenantId}::uuid and kind = 'organization' and status = 'active'
         and deleted_at is null`;
    const id = await idOf(await createCommunity(tokens.helena, { name: `${PREFIX}Sozinha` }));
    try {
      await adminSql`
        update public.communities set status = 'archived'
         where id = any (${lab.map((row) => row.id)}::uuid[])`;
      const page = await listOf(tokens.helena);
      expect(page.items.map((item) => item.id)).toEqual([id]);
      expect(page.memberQuota).toEqual({ ownedActive: 1, limit: expectedLimit() });
      expect(page.nextCursor).toBeNull();
    } finally {
      for (const row of lab) {
        await adminSql`
          update public.communities set status = 'active', updated_at = ${row.updated_at}::timestamptz
           where id = ${row.id}::uuid`;
      }
    }
  });

  it('EP-13 ordering: member communities list newest activity first after a creator posts; organization ones keep the admin’s order', async () => {
    const first = await idOf(
      await createCommunity(tokens.helena, { name: `${PREFIX}Atividade 1` }),
    );
    const second = await idOf(
      await createCommunity(tokens.marcos, { name: `${PREFIX}Atividade 2` }),
    );
    const orgOrder = async () =>
      (await listOf(tokens.alvaro)).items
        .filter((item) => item.kind === 'organization')
        .map((i) => i.id);
    const memberOrder = async () =>
      (await listOf(tokens.alvaro)).items.filter((item) => item.kind === 'member').map((i) => i.id);
    const orgBefore = await orgOrder();
    await publish(tokens.helena, { caption: `${PREFIX}movimenta 1`, communityId: first });
    expect((await memberOrder()).slice(0, 2)).toEqual([first, second]);
    await publish(tokens.marcos, { caption: `${PREFIX}movimenta 2`, communityId: second });
    expect((await memberOrder()).slice(0, 2)).toEqual([second, first]);
    expect(await orgOrder()).toEqual(orgBefore);
  });

  it('EP-29 adjacency: a member-community post created between two Início pages appears on neither', async () => {
    const id = await idOf(await createCommunity(tokens.helena, { name: `${PREFIX}Entre páginas` }));
    const firstRes = await request('/v1/feed?limit=2', tokens.alvaro);
    const firstPage = (await firstRes.json()) as FeedPage;
    expect(firstPage.nextCursor).not.toBeNull();
    const created = (await (
      await publish(tokens.helena, { caption: `${PREFIX}entre duas páginas`, communityId: id })
    ).json()) as FeedPost;
    const secondRes = await request(
      `/v1/feed?limit=25&cursor=${encodeURIComponent(firstPage.nextCursor ?? '')}`,
      tokens.alvaro,
    );
    const secondPage = (await secondRes.json()) as FeedPage;
    expect([...firstPage.items, ...secondPage.items].map((item) => item.id)).not.toContain(
      created.id,
    );
    // Positive control: it exists, and it is on its own page.
    expect((await walkFeed(tokens.alvaro, `&communityId=${id}`)).map((item) => item.id)).toContain(
      created.id,
    );
  });

  it('EP-30 empty: a community holding only community posts leaves Início and Explorar empty of them', async () => {
    const id = await idOf(await createCommunity(tokens.helena, { name: `${PREFIX}Só dela` }));
    const ids: string[] = [];
    for (const n of [1, 2]) {
      const res = await publish(tokens.helena, { caption: `${PREFIX}só ${n}`, communityId: id });
      ids.push(((await res.json()) as FeedPost).id);
    }
    expect((await walkFeed(tokens.marcos, `&communityId=${id}`)).map((p) => p.id).sort()).toEqual(
      [...ids].sort(),
    );
    for (const token of [tokens.marcos, tokens.alvaro, tokens.helena, tokens.labAdmin]) {
      for (const query of ['', '&scope=explorar']) {
        const walked = await walkFeed(token, query);
        expect(walked.filter((item) => item.communityId === id)).toEqual([]);
        expect(walked.some((item) => item.audience === 'community')).toBe(false);
      }
    }
  });

  it('EP-31 ordering: the community page orders newest first with id desc as the tiebreak across tenant and community posts, each exactly once at limit=1', async () => {
    const id = await idOf(
      await createCommunity(tokens.helena, { name: `${PREFIX}Ordem da página` }),
    );
    const at = '2026-11-11T12:30:00.111111Z';
    const rows = await adminSql<{ id: string }[]>`
      insert into public.feed_posts
        (tenant_id, author_user_id, community_id, caption, visibility, created_at)
      values
        (${labTenantId}::uuid, ${userIds.helena}::uuid, ${id}::uuid, ${`${PREFIX}ordem a`}, 'community', ${at}::timestamptz),
        (${labTenantId}::uuid, ${userIds.helena}::uuid, ${id}::uuid, ${`${PREFIX}ordem b`}, 'community', ${at}::timestamptz),
        (${labTenantId}::uuid, ${userIds.labAdmin}::uuid, ${id}::uuid, ${`${PREFIX}ordem c`}, 'tenant', ${at}::timestamptz),
        (${labTenantId}::uuid, ${userIds.helena}::uuid, ${id}::uuid, ${`${PREFIX}ordem d`}, 'community', '2026-11-11T12:31:00Z'::timestamptz)
      returning id`;
    const stored = rows.map((row) => row.id);
    const newest = stored[3] ?? '';
    const tied = stored.slice(0, 3).sort().reverse();
    const expected = [newest, ...tied];
    const wide = (await walkFeed(tokens.marcos, `&communityId=${id}`)).map((p) => p.id);
    expect(wide).toEqual(expected);
    const narrow: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const suffix: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const res = await request(`/v1/feed?limit=1&communityId=${id}${suffix}`, tokens.marcos);
      const page = (await res.json()) as FeedPage;
      narrow.push(...page.items.map((p) => p.id));
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    expect(narrow).toEqual(expected);
  });
});

/**
 * 10-06 (D-708, D-712, A12; MCOMM-03, MCOMM-07): the order and visibility edges of the read side. The reorder
 * never touches a member community; a blocked or departed creator's community answers the bare 404 on the
 * list, the detail, its feed and a like on one of its posts, for the moderator too (RLS is the backstop, the
 * statements say it too); a community whose creator the VIEWER blocked is absent for that viewer only.
 */
describe('10 visibility', () => {
  type Item = { id: string; kind: string; status: string };
  type Page = { items: Item[]; nextCursor: string | null };

  const listOf = async (token: string, query = '?limit=25'): Promise<Page> => {
    const res = await request(`/v1/communities${query}`, token);
    expect(res.status, `GET /v1/communities${query}`).toBe(200);
    return (await res.json()) as Page;
  };

  const idOf = async (res: Response): Promise<string> =>
    ((await res.json()) as CommunitySummary).id;

  const reorder = (token: string, ids: string[]) =>
    request('/v1/communities/order', token, {
      method: 'PUT',
      body: JSON.stringify({ ids }),
    });

  /** The BARE not-found of D-23: 404, code NOT_FOUND, no `details` at all. */
  const expectBare404 = async (res: Response, label: string): Promise<void> => {
    expect(res.status, label).toBe(404);
    const error = await errorOf(res);
    expect(error.code, label).toBe('NOT_FOUND');
    expect(error.details, label).toBeUndefined();
  };

  const setMembership = (userId: string, set: 'blocked' | 'deleted' | 'live') =>
    set === 'blocked'
      ? adminSql`update public.memberships set blocked_at = now()
                  where tenant_id = ${labTenantId}::uuid and user_id = ${userId}::uuid`
      : set === 'deleted'
        ? adminSql`update public.memberships set deleted_at = now()
                    where tenant_id = ${labTenantId}::uuid and user_id = ${userId}::uuid`
        : adminSql`update public.memberships set blocked_at = null, deleted_at = null
                    where tenant_id = ${labTenantId}::uuid and user_id = ${userId}::uuid`;

  beforeEach(async () => {
    await sweep();
    await writeSocialSettings(savedSocialSettings);
    await setMembership(userIds.helena, 'live');
    await setMembership(userIds.marcos, 'live');
    await adminSql`delete from public.member_blocks where tenant_id = ${labTenantId}::uuid and blocker_user_id = any (${memberUsers()}::uuid[])`;
  });

  afterAll(async () => {
    await setMembership(userIds.helena, 'live');
    await setMembership(userIds.marcos, 'live');
    await adminSql`delete from public.member_blocks where tenant_id = ${labTenantId}::uuid and blocker_user_id = any (${memberUsers()}::uuid[])`;
  });

  it('D-712 / MCOMM-03: an admin reorder with only organization ids succeeds and leaves the member community at position 1000000; a body holding the member id is order_stale', async () => {
    const member = await idOf(await createCommunity(tokens.helena, { name: `${PREFIX}Ordem 1` }));
    const original = await adminSql<{ id: string; position: number; updated_at: string }[]>`
      select id, position, updated_at::text from public.communities
       where tenant_id = ${labTenantId}::uuid and kind = 'organization' and status = 'active'
         and deleted_at is null`;
    try {
      const organization = (await listOf(tokens.labAdmin)).items
        .filter((item) => item.kind === 'organization')
        .map((item) => item.id);
      expect(organization.length).toBeGreaterThan(1);

      // The member id in the permutation: the stale answer, nothing written (positive control below).
      const stale = await reorder(tokens.labAdmin, [...organization, member]);
      expect(stale.status).toBe(409);
      const staleError = await errorOf(stale);
      expect(staleError.code).toBe('CONFLICT');
      expect(staleError.details).toEqual({ community: 'order_stale' });
      expect((await communityRow(member))?.position).toBe(1000000);

      // Only organization ids: the reorder lands, in the order asked, and the member stays last.
      const reversed = [...organization].reverse();
      const ok = await reorder(tokens.labAdmin, reversed);
      expect(ok.status).toBe(200);
      const page = (await ok.json()) as Page;
      expect(page.items.map((item) => item.id)).toEqual([...reversed, member]);
      expect((await communityRow(member))?.position).toBe(1000000);
      const [positions] = await adminSql<{ n: number; max: number }[]>`
        select count(*)::int as n, max(position)::int as max from public.communities
         where tenant_id = ${labTenantId}::uuid and kind = 'organization' and status = 'active'
           and deleted_at is null and position between 1 and 200`;
      expect(positions?.n).toBe(organization.length);
      expect(positions?.max).toBeLessThanOrEqual(200);
    } finally {
      for (const row of original) {
        await adminSql`
          update public.communities set position = ${row.position},
                 updated_at = ${row.updated_at}::timestamptz
           where id = ${row.id}::uuid`;
      }
    }
  });

  it('EP-11 adjacency: when the last organization community is archived the member communities still list, and a reorder naming a member community is order_stale (an empty body stays 400)', async () => {
    const member = await idOf(await createCommunity(tokens.helena, { name: `${PREFIX}Sobra` }));
    const original = await adminSql<{ id: string; updated_at: string }[]>`
      select id, updated_at::text from public.communities
       where tenant_id = ${labTenantId}::uuid and kind = 'organization' and status = 'active'
         and deleted_at is null`;
    try {
      await adminSql`
        update public.communities set status = 'archived'
         where id = any (${original.map((row) => row.id)}::uuid[])`;
      expect((await listOf(tokens.marcos)).items.map((item) => item.id)).toEqual([member]);
      const named = await reorder(tokens.labAdmin, [member]);
      expect(named.status).toBe(409);
      expect((await errorOf(named)).details).toEqual({ community: 'order_stale' });
      expect((await reorder(tokens.labAdmin, [])).status).toBe(400);
      expect((await communityRow(member))?.position).toBe(1000000);
    } finally {
      for (const row of original) {
        await adminSql`
          update public.communities set status = 'active', updated_at = ${row.updated_at}::timestamptz
           where id = ${row.id}::uuid`;
      }
    }
  });

  it('D-708 / EP-28: a blocked or departed creator hides the community on the list, the detail, its feed and a like, for a member AND the moderator; the rest keeps its order, the cursor still pages, and unblocking restores every byte', async () => {
    const hiddenOne = await idOf(await createCommunity(tokens.helena, { name: `${PREFIX}Some 1` }));
    const keptOne = await idOf(await createCommunity(tokens.marcos, { name: `${PREFIX}Fica 1` }));
    const keptTwo = await idOf(await createCommunity(tokens.marcos, { name: `${PREFIX}Fica 2` }));
    const post = (await (
      await publish(tokens.helena, { caption: `${PREFIX}curtir`, communityId: hiddenOne })
    ).json()) as FeedPost;

    const readBack = async () => ({
      marcos: await (await request('/v1/communities?limit=25', tokens.marcos)).text(),
      admin: await (await request('/v1/communities?limit=25', tokens.labAdmin)).text(),
    });
    const before = await readBack();
    const orderBefore = (JSON.parse(before.marcos) as Page).items.map((item) => item.id);
    expect(orderBefore).toContain(hiddenOne);
    // Positive controls: all four doors are open while the creator is live.
    expect((await request(`/v1/communities/${hiddenOne}`, tokens.marcos)).status).toBe(200);
    expect((await request(`/v1/feed?communityId=${hiddenOne}`, tokens.marcos)).status).toBe(200);
    expect((await request(`/v1/feed/posts/${post.id}`, tokens.marcos)).status).toBe(200);

    for (const state of ['blocked', 'deleted'] as const) {
      try {
        await setMembership(userIds.helena, state);
        for (const [who, token] of [
          ['marcos', tokens.marcos],
          ['admin (the moderator)', tokens.labAdmin],
        ] as const) {
          const label = `${state} ${who}`;
          const listed = await listOf(token);
          expect(
            listed.items.map((item) => item.id),
            label,
          ).not.toContain(hiddenOne);
          await expectBare404(
            await request(`/v1/communities/${hiddenOne}`, token),
            `${label} detail`,
          );
          await expectBare404(
            await request(`/v1/feed?communityId=${hiddenOne}`, token),
            `${label} feed`,
          );
          await expectBare404(
            await request(`/v1/feed/posts/${post.id}/like`, token, { method: 'POST' }),
            `${label} like`,
          );
        }
        // EP-28: the remaining items keep their relative order and the cursor pages without skipping.
        const remaining = orderBefore.filter((id) => id !== hiddenOne);
        const wide = (await listOf(tokens.marcos)).items.map((item) => item.id);
        expect(wide).toEqual(remaining);
        const narrow: string[] = [];
        let cursor: string | null = null;
        for (let guard = 0; guard < 100; guard += 1) {
          const suffix: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
          const page = await listOf(tokens.marcos, `?limit=1${suffix}`);
          narrow.push(...page.items.map((item) => item.id));
          cursor = page.nextCursor;
          if (cursor === null) break;
        }
        expect(narrow, `${state} limit=1 walk`).toEqual(remaining);
        expect(narrow).toEqual(expect.arrayContaining([keptOne, keptTwo]));
      } finally {
        await setMembership(userIds.helena, 'live');
      }
      // Unblocked (or restored): everything is back, byte for byte, nothing was deleted.
      const after = await readBack();
      expect(after.marcos, `${state} restored (member list)`).toBe(before.marcos);
      expect(after.admin, `${state} restored (admin list)`).toBe(before.admin);
      expect((await request(`/v1/communities/${hiddenOne}`, tokens.marcos)).status).toBe(200);
      expect((await request(`/v1/feed?communityId=${hiddenOne}`, tokens.marcos)).status).toBe(200);
    }
  });

  it('A12: a community whose creator the VIEWER blocked is absent from the viewer’s list and answers the bare 404 by id and on its feed; it stays for Alvaro, and the blocked creator sees nothing different', async () => {
    const id = await idOf(await createCommunity(tokens.helena, { name: `${PREFIX}Bloqueada` }));
    const before = {
      alvaro: await (await request('/v1/communities?limit=25', tokens.alvaro)).text(),
      helena: await (await request('/v1/communities?limit=25', tokens.helena)).text(),
    };
    expect((await listOf(tokens.marcos)).items.map((item) => item.id)).toContain(id);

    const block = await request('/v1/blocks', tokens.marcos, json({ userId: userIds.helena }));
    expect(block.status).toBe(200);

    expect((await listOf(tokens.marcos)).items.map((item) => item.id)).not.toContain(id);
    await expectBare404(await request(`/v1/communities/${id}`, tokens.marcos), 'marcos detail');
    await expectBare404(await request(`/v1/feed?communityId=${id}`, tokens.marcos), 'marcos feed');
    // Another viewer and the blocked creator read exactly what they read before.
    expect(await (await request('/v1/communities?limit=25', tokens.alvaro)).text()).toBe(
      before.alvaro,
    );
    expect(await (await request('/v1/communities?limit=25', tokens.helena)).text()).toBe(
      before.helena,
    );
    expect((await request(`/v1/communities/${id}`, tokens.helena)).status).toBe(200);

    const unblock = await request(`/v1/blocks/${userIds.helena}`, tokens.marcos, {
      method: 'DELETE',
    });
    expect(unblock.status).toBe(200);
    expect((await listOf(tokens.marcos)).items.map((item) => item.id)).toContain(id);
    expect((await request(`/v1/communities/${id}`, tokens.marcos)).status).toBe(200);
  });
});

describe('10-07 cover owner check (Pitfall 10, T-10-25)', () => {
  const assets: string[] = [];

  /** A ready `purpose: 'cover'` image of rede-lab owned by `ownerId`. */
  const coverAsset = async (ownerId: string): Promise<string> => {
    const [row] = await adminSql<{ id: string }[]>`
      insert into public.media_assets
        (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, variant_widths)
      values (${labTenantId}::uuid, ${ownerId}::uuid, 'image', 'cover', 'ready', 'supabase',
              'image/webp', 1024, '{640,1080}'::int[])
      returning id`;
    const id = row?.id ?? '';
    assets.push(id);
    return id;
  };

  beforeEach(async () => {
    await sweep();
  });

  afterAll(async () => {
    await sweep();
    for (const id of assets.splice(0)) {
      await adminSql`update public.communities set cover_asset_id = null where cover_asset_id = ${id}::uuid`;
      await adminSql`delete from public.media_assets where id = ${id}::uuid`;
    }
  });

  it('a member creating a community on ANOTHER user’s cover asset gets the bare 404 and nothing is stored; their own asset is the positive control', async () => {
    const foreign = await coverAsset(userIds.marcos);
    const mine = await coverAsset(userIds.helena);
    const res = await createCommunity(tokens.helena, {
      name: `${PREFIX}capa alheia`,
      coverAssetId: foreign,
    });
    expect(res.status).toBe(404);
    expect((await errorOf(res)).details).toBeUndefined();
    const [stored] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.communities where name = ${`${PREFIX}capa alheia`}`;
    expect(stored?.n).toBe(0);

    const own = await createCommunity(tokens.helena, {
      name: `${PREFIX}capa propria`,
      coverAssetId: mine,
    });
    expect(own.status).toBe(201);
    expect(((await own.json()) as CommunitySummary).coverAssetId).toBe(mine);
  });

  it('a member editing the cover: another user’s asset is 404, their own is 200, re-sending the stored one is 200; the admin may use any asset of the tenant', async () => {
    const foreign = await coverAsset(userIds.marcos);
    const mine = await coverAsset(userIds.helena);
    const created = await createCommunity(tokens.helena, { name: `${PREFIX}editar capa` });
    const id = ((await created.json()) as CommunitySummary).id;

    expect(
      (await request(`/v1/communities/${id}`, tokens.helena, patch({ coverAssetId: foreign })))
        .status,
    ).toBe(404);
    expect(
      (await request(`/v1/communities/${id}`, tokens.helena, patch({ coverAssetId: mine }))).status,
    ).toBe(200);
    expect(
      (await request(`/v1/communities/${id}`, tokens.helena, patch({ coverAssetId: mine }))).status,
    ).toBe(200);
    // An admin editing a member community (A8) is not held to the owner rule: the check is for members.
    expect(
      (await request(`/v1/communities/${id}`, tokens.labAdmin, patch({ coverAssetId: foreign })))
        .status,
    ).toBe(200);
    // ...and the creator re-sending the cover the admin set is not refused (it is the stored reference).
    expect(
      (await request(`/v1/communities/${id}`, tokens.helena, patch({ coverAssetId: foreign })))
        .status,
    ).toBe(200);
  });
});
